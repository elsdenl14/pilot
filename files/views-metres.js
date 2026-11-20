/* v23 · Métrés et quantitatifs.
   Import d'un plan (PDF ou image), mise à l'échelle, mesures directement sur le plan (surfaces, longueurs, comptages),
   annotations (texte, note, flèche, crayon) et quantitatif prêt à chiffrer : peinture, carrelage, mètres linéaires, béton,
   placo, fenêtres et portes. Export CSV / PDF annoté, création d'un devis brouillon.
   Données : table metres_plans (migration_v23.sql) ; le plan est stocké dans le bucket « documents ».
   Les calculs sont faits dans le navigateur. Réglages (hauteur, épaisseur, pertes, prix) enregistrés avec le plan. */

Object.assign(ic, { metres: "M3 17L17 3l4 4L7 21H3z M13 7l4 4 M7 13l2 2 M10 10l2 2", undo: "M9 14L4 9l5-5 M4 9h10a6 6 0 010 12h-3", redo: "M15 14l5-5-5-5 M20 9H10a6 6 0 000 12h3" });

/* ---------- Catégories de quantités ---------- */
// k : area (surface), line (longueur), count (comptage) ; u : unité du résultat ; perte : % de pertes par défaut
const MT_CATS = {
  peint_murs: { l: "Peinture des murs", s: "Murs", k: "line", u: "m²", c: "#2f6fcf", hint: "Tracez le contour des pièces : la longueur est multipliée par la hauteur sous plafond." },
  peint_plaf: { l: "Peinture des plafonds", s: "Plafond", k: "area", u: "m²", c: "#5b8def", hint: "Surface au sol = surface de plafond." },
  carrelage: { l: "Carrelage", s: "Carrelage", k: "area", u: "m²", c: "#8b5cf6", perte: 10 },
  lineaire: { l: "Mètres linéaires (plinthes, câbles, gaines…)", s: "Linéaire", k: "line", u: "ml", c: "#0e9f6e" },
  beton: { l: "Béton (dalle, chape)", s: "Béton", k: "area", u: "m³", c: "#6b7280", ep: 0.12, perte: 5, hint: "Surface × épaisseur de la dalle." },
  placo_cl: { l: "Placo : cloisons et doublages", s: "Cloison", k: "line", u: "m²", c: "#d97706", perte: 10, hint: "Longueur × hauteur × nombre de faces." },
  placo_pl: { l: "Placo : plafonds", s: "Placo plafond", k: "area", u: "m²", c: "#f59e0b", perte: 10 },
  fenetre: { l: "Fenêtres", s: "Fenêtres", k: "count", u: "u", c: "#06b6d4", ow: 1.2, oh: 1.25, hint: "Un clic par fenêtre." },
  porte: { l: "Portes", s: "Portes", k: "count", u: "u", c: "#a16207", ow: 0.9, oh: 2.04, hint: "Un clic par porte." },
};
const MT_KEYS = Object.keys(MT_CATS);
const MT_DEF = { h: 2.5, ep: 0.12, plaque: 3, deduire: true, perte: { carrelage: 10, beton: 5, placo_cl: 10, placo_pl: 10 }, prix: {} };
const MT_TOOLS = [
  ["sel", "Sélection", "V", "M5 3l14 8-6 2-2 6z"],
  ["rect", "Rectangle", "R", "M4 5h16v14H4z"],
  ["poly", "Polygone", "P", "M12 3l8 6-3 11H7L4 9z"],
  ["line", "Longueur", "L", "M4 20L20 4 M4 16v4h4 M16 4h4v4"],
  ["count", "Comptage", "C", "M12 12m-3 0a3 3 0 106 0 3 3 0 10-6 0 M12 3v3 M12 18v3 M3 12h3 M18 12h3"],
  ["calib", "Échelle", "E", "M3 17L17 3l4 4L7 21H3z M13 7l4 4 M7 13l2 2"],
];
const MT_ANNO = [
  ["pen", "Crayon", "D", "M4 20l4-1L19 8l-3-3L5 16z"],
  ["arrow", "Flèche", "A", "M5 19L19 5 M10 5h9v9"],
  ["text", "Texte", "T", "M5 5h14 M12 5v14"],
  ["note", "Note", "N", "M5 4h14v12H9l-4 4z"],
];
const MT_SCALES = [20, 25, 50, 75, 100, 125, 150, 200, 250, 500];
const mtPtToM = (den) => (den * 0.0254) / 72; // 1 point PDF = 1/72 pouce sur le papier

/* ---------- Géométrie et calcul des quantités (aucune dépendance au navigateur) ---------- */
const mtLen = (p, closed) => {
  let s = 0;
  for (let i = 1; i < p.length; i++) s += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  if (closed && p.length > 2) s += Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]);
  return s;
};
const mtArea = (p) => {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const j = (i + 1) % p.length; a += p[i][0] * p[j][1] - p[j][0] * p[i][1]; }
  return Math.abs(a) / 2;
};
const mtCentroid = (p) => {
  const a2 = p.reduce((t, q, i) => { const n = p[(i + 1) % p.length]; return t + (q[0] * n[1] - n[0] * q[1]); }, 0);
  if (Math.abs(a2) < 1e-9) return [p.reduce((t, q) => t + q[0], 0) / p.length, p.reduce((t, q) => t + q[1], 0) / p.length];
  let cx = 0, cy = 0;
  p.forEach((q, i) => { const n = p[(i + 1) % p.length], f = q[0] * n[1] - n[0] * q[1]; cx += (q[0] + n[0]) * f; cy += (q[1] + n[1]) * f; });
  return [cx / (3 * a2), cy / (3 * a2)];
};
const mtReg = (plan) => {
  const r = plan.data?.reg || {};
  return { ...MT_DEF, ...r, perte: { ...MT_DEF.perte, ...(r.perte || {}) }, prix: { ...(r.prix || {}) } };
};
const mtScaleOf = (plan, page) => { const k = plan.data?.pages?.[page]?.k; return k > 0 ? k : null; };

// Quantité d'une mesure. k = mètres par unité du plan (null = échelle non définie)
function mtItemQ(it, R, k) {
  const cat = MT_CATS[it.c];
  if (!cat) return null;
  const par = it.par || {};
  if (cat.k === "count") return { val: it.pts.length, n: it.pts.length, unit: "u" };
  if (k == null) return { val: null, unit: cat.u };
  if (cat.k === "area") {
    const base = mtArea(it.pts) * k * k, per = mtLen(it.pts, true) * k;
    if (it.c === "beton") { const ep = Number(par.ep ?? R.ep) || 0; return { val: base * ep, base, per, ep, unit: "m³" }; }
    return { val: base, base, per, unit: "m²" };
  }
  const L = mtLen(it.pts, it.closed) * k;
  if (it.c === "peint_murs" || it.c === "placo_cl") {
    const h = Number(par.h ?? R.h) || 0, faces = it.c === "placo_cl" ? Number(par.faces ?? 1) || 1 : 1;
    return { val: L * h * faces, L, h, faces, unit: "m²" };
  }
  return { val: L, L, unit: "ml" };
}

// Tableau quantitatif : une ligne par catégorie utilisée (+ plaques de placo)
function mtQuant(plan) {
  const R = mtReg(plan), items = (plan.data?.items || []).filter((i) => MT_CATS[i.c]);
  const rows = [], by = {};
  let openings = 0;
  for (const it of items) {
    const k = mtScaleOf(plan, it.p), q = mtItemQ(it, R, k), cat = MT_CATS[it.c];
    const b = (by[it.c] ||= { c: it.c, n: 0, brut: 0, sans: 0, items: 0 });
    b.items++;
    if (cat.k === "count") {
      b.n += it.pts.length; b.brut += it.pts.length;
      const par = it.par || {};
      b.surf = (b.surf || 0) + it.pts.length * (Number(par.ow ?? cat.ow) || 0) * (Number(par.oh ?? cat.oh) || 0);
    } else if (q.val == null) b.sans++;
    else b.brut += q.val;
  }
  for (const c of ["fenetre", "porte"]) if (by[c]) openings += by[c].surf || 0;
  for (const c of MT_KEYS) {
    const b = by[c]; if (!b) continue;
    const cat = MT_CATS[c];
    const ded = c === "peint_murs" && R.deduire && openings > 0 ? Math.min(openings, b.brut) : 0;
    const net = b.brut - ded;
    const perte = cat.k === "count" ? 0 : Number(R.perte[c] ?? 0) || 0;
    const prevoir = net * (1 + perte / 100);
    const prix = Number(R.prix[c]) || 0;
    rows.push({ c, l: cat.l, u: cat.u, items: b.items, brut: b.brut, ded, net, perte, prevoir: cat.k === "count" ? net : prevoir, prix, total: prix * (cat.k === "count" ? net : prevoir), sans: b.sans, n: b.n });
    if ((c === "placo_cl" || c === "placo_pl") && net > 0) b.plaq = (b.plaq || 0) + prevoir;
  }
  const plaq = (by.placo_cl?.plaq || 0) + (by.placo_pl?.plaq || 0);
  if (plaq > 0) {
    const sz = Number(R.plaque) || 3, n = Math.ceil(plaq / sz - 1e-9), prix = Number(R.prix.plaques) || 0;
    rows.push({ c: "plaques", l: `Plaques de placo (${fmtNum(sz, 2)} m² la plaque)`, u: "u", items: 0, brut: n, ded: 0, net: n, perte: 0, prevoir: n, prix, total: prix * n, sans: 0, n });
  }
  return rows;
}

// Synthèse affichée en bas de l'éditeur
function mtTotals(plan) {
  const R = mtReg(plan), t = { surf: 0, per: 0, len: 0, cnt: 0, sans: 0 };
  for (const it of plan.data?.items || []) {
    const cat = MT_CATS[it.c]; if (!cat) continue;
    if (cat.k === "count") { t.cnt += it.pts.length; continue; }
    const q = mtItemQ(it, R, mtScaleOf(plan, it.p));
    if (q.val == null) { t.sans++; continue; }
    if (cat.k === "area") { t.surf += q.base; t.per += q.per; } else t.len += q.L;
  }
  return t;
}
const mtFmt = (v, d = 2) => (v == null ? "-" : fmtNum(v, d));

/* ---------- Données ---------- */
async function loadV23() {
  db.v23 = false; db.metPlans = [];
  const rows = await q(sb.from("metres_plans").select("*").order("updated_at", { ascending: false }));
  rows.forEach((r) => { r.data ||= {}; r.data.items ||= []; r.data.pages ||= {}; r.data.reg ||= {}; });
  db.metPlans = rows; db.v23 = true; db.v23err = "";
}
const mtSetup = () => `<div class="empty"><h2>Activer les métrés</h2><p>Lancez une fois <b>migration_v23.sql</b> dans Supabase (SQL Editor), puis rechargez Pilot. Le reste de l'application n'est pas concerné.</p></div>`;

/* ---------- Liste des plans ---------- */
V.metres = async (r) => {
  if (!db.v23) return page("Métrés et quantitatifs", "", "", card("", mtSetup()));
  if (r.arg) return mtEditor(r.arg);
  const l = db.metPlans;
  const nm = (p) => (p.data.items || []).filter((i) => MT_CATS[i.c]).length;
  const rows = l.map((p) => ({ go: `metres/${p.id}`, t: p.nom, c: [`<strong>${esc(p.nom)}</strong>`, esc(byId(db.chantiers, p.chantier_id)?.nom || "-"), p.nb_pages, `<span class="num">${nm(p)}</span>`, D(p.updated_at)] }));
  const intro = l.length ? "" : card("Comment ça marche", `<div class="mt-how"><div><b>1. Importez un plan</b><span>PDF ou image : plan d'architecte, plan de pièce, relevé.</span></div><div><b>2. Mettez à l'échelle</b><span>Choisissez l'échelle imprimée, ou cliquez deux points dont vous connaissez la distance.</span></div><div><b>3. Mesurez</b><span>Surfaces, longueurs, fenêtres, portes : directement sur le plan, avec vos annotations.</span></div><div><b>4. Chiffrez</b><span>Le quantitatif est prêt : export Excel (CSV), PDF annoté ou devis brouillon.</span></div></div>`);
  return page("Métrés et quantitatifs", "Mesurez sur plan et obtenez vos quantités : peinture, carrelage, béton, placo, linéaires, fenêtres et portes.",
    btn("Importer un plan", "mtNew", "", "", "w") + btn("Plan d'exemple", "mtDemo", "", "", "o w"),
    strip([["Plans", l.length, ""], ["Mesures", sum(l, nm), "sur l'ensemble des plans"], ["Dernier plan", l[0] ? esc(l[0].nom) : "-", l[0] ? D(l[0].updated_at) : ""]]) + intro
    + card("", tbl(["Plan", "Chantier", { h: "Pages", r: 1 }, { h: "Mesures", r: 1 }, "Modifié"], rows, "Aucun plan. Importez un PDF pour commencer.")));
};

function mtImportForm() {
  if (!guard()) return;
  modal("Importer un plan", `<div class="frm">
    <label class="fl full"><span>Plan (PDF ou image) <em>*</em></span><input type="file" id="mtfile" accept=".pdf,application/pdf,image/png,image/jpeg,image/webp"></label>
    ${fld({ k: "nom", l: "Nom du plan", r: 0, ph: "Ex. Rez-de-chaussée, A2.1…" })}
    ${fld({ k: "chantier_id", l: "Chantier", t: "select", r: 0, o: [{ v: "", l: "Aucun" }, ...db.chantiers.map((c) => ({ v: c.id, l: c.nom }))] })}</div>
    <p class="note" style="margin:10px 0 0">Les PDF de plusieurs pages sont acceptés (25 Mo maximum). Le fichier est aussi rangé dans vos documents.</p>`, {
    submit: "Importer",
    onSubmit: async (v, api) => {
      const f = $("#mtfile", api.el).files[0];
      if (!f) throw new Error("Choisissez un fichier.");
      if (f.size > 25 * 1024 * 1024) throw new Error("Fichier trop lourd (25 Mo maximum).");
      api.error("Envoi du plan…");
      const row = await mtCreate(f, v.nom || f.name.replace(/\.[^.]+$/, ""), v.chantier_id || null, {});
      api.close(); await refresh(); go("metres/" + row.id);
    },
  });
}
async function mtCreate(file, nom, chantierId, data) {
  const isPdf = /pdf/i.test(file.type) || /\.pdf$/i.test(file.name);
  let nb = 1;
  if (isPdf) {
    try {
      const pdfjs = await import(LIBS.pdfjs); pdfjs.GlobalWorkerOptions.workerSrc = LIBS.pdfjsWorker;
      const d = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise; nb = d.numPages;
    } catch (e) { throw new Error("Ce PDF ne peut pas être lu : " + (e?.message || e)); }
  }
  const path = await uploadDoc(file, "metres");
  try {
    return await q(sb.from("metres_plans").insert({ nom, chemin: path, type: isPdf ? "pdf" : "image", nb_pages: nb, chantier_id: chantierId, data: { items: [], pages: {}, reg: {}, ...data } }).select("*").single());
  } catch (e) { sb.storage.from("documents").remove([path]); throw e; }
}

/* ---------- Plan d'exemple (créé avec pdf-lib, échelle 1/50) ---------- */
async function mtDemo() {
  if (!guard()) return;
  toast("Création du plan d'exemple…");
  await loadScript(LIBS.pdflib);
  const { PDFDocument, StandardFonts, rgb } = PDFLib, k = mtPtToM(50), W = 841.89, H = 595.28, ox = 100, oy = 95, mp = (m) => m / k;
  const doc = await PDFDocument.create(), pg = doc.addPage([W, H]), f = await doc.embedFont(StandardFonts.Helvetica), fb = await doc.embedFont(StandardFonts.HelveticaBold);
  const X = (m) => ox + mp(m), Y = (m) => H - (oy + mp(m)), ink = rgb(0.1, 0.12, 0.16), grey = rgb(0.55, 0.58, 0.63);
  const line = (x1, y1, x2, y2, t = 1, c = ink) => pg.drawLine({ start: { x: X(x1), y: Y(y1) }, end: { x: X(x2), y: Y(y2) }, thickness: t, color: c });
  // murs extérieurs 11 x 8 m, cloisons
  [[0, 0, 11, 0], [11, 0, 11, 8], [11, 8, 0, 8], [0, 8, 0, 0]].forEach((s) => line(...s, 7));
  [[6, 0, 6, 5], [0, 5, 11, 5], [3.5, 5, 3.5, 8], [7, 5, 7, 8]].forEach((s) => line(...s, 3.5));
  // ouvertures : on « efface » le mur puis on trace le battant
  const gap = (x1, y1, x2, y2, t = 9) => pg.drawLine({ start: { x: X(x1), y: Y(y1) }, end: { x: X(x2), y: Y(y2) }, thickness: t, color: rgb(1, 1, 1) });
  const door = (x, y, vertical) => { vertical ? (gap(x, y, x, y + 0.9), line(x, y, x + 0.9, y, 1, grey)) : (gap(x, y, x + 0.9, y), line(x, y, x, y + 0.9, 1, grey)); };
  door(2.2, 8, false); door(6, 3.6, true); door(1.2, 5, false); door(4.4, 5, false); door(8.6, 5, false);
  const win = (x1, y1, x2, y2) => { gap(x1, y1, x2, y2, 8); line(x1, y1, x2, y2, 1.2, rgb(0.1, 0.5, 0.8)); const dx = y1 === y2 ? 0 : 0.05, dy = y1 === y2 ? 0.05 : 0; line(x1 + dx, y1 + dy, x2 + dx, y2 + dy, 1.2, rgb(0.1, 0.5, 0.8)); };
  win(1.5, 0, 2.7, 0); win(3.6, 0, 4.8, 0); win(7.2, 0, 8.4, 0); win(11, 1.6, 11, 2.8); win(1, 8, 2.2, 8); win(4.4, 8, 5.6, 8);
  const txt = (s, x, y, size = 11, bold = false) => pg.drawText(s, { x: X(x) - (s.length * size * 0.28), y: Y(y), size, font: bold ? fb : f, color: ink });
  txt("SÉJOUR", 3, 2.3, 13, true); txt("CUISINE", 8.5, 2.3, 13, true);
  txt("CHAMBRE 1", 1.75, 6.4, 11, true); txt("SDB", 5.25, 6.4, 11, true); txt("CHAMBRE 2", 9, 6.4, 11, true);
  pg.drawText("MAISON INDIVIDUELLE · PLAN DU REZ-DE-CHAUSSÉE (EXEMPLE)", { x: 100, y: H - 45, size: 15, font: fb, color: ink });
  pg.drawText("Echelle 1/50 · plan fictif fourni pour essayer les métrés", { x: 100, y: H - 62, size: 9.5, font: f, color: grey });
  const bytes = await doc.save(), file = new File([bytes], "plan-exemple-rdc.pdf", { type: "application/pdf" });
  // mesures pré-remplies (coordonnées en points depuis le coin haut-gauche de la page)
  const P = (mx, my) => [ox + mp(mx), oy + mp(my)], rect = (a, b, c, d) => [P(a, b), P(c, b), P(c, d), P(a, d)];
  const items = [
    { id: "d1", p: 1, k: "area", c: "carrelage", label: "Séjour", pts: rect(0.1, 0.1, 5.9, 4.9), r: 1 },
    { id: "d2", p: 1, k: "area", c: "carrelage", label: "Cuisine", pts: rect(6.1, 0.1, 10.9, 4.9), r: 1 },
    { id: "d3", p: 1, k: "line", c: "peint_murs", label: "Chambre 1", pts: rect(0.1, 5.1, 3.4, 7.9), closed: true },
    { id: "d4", p: 1, k: "count", c: "fenetre", label: "Fenêtres", pts: [P(2.1, 0), P(4.2, 0), P(7.8, 0), P(11, 2.2), P(1.6, 8), P(5, 8)] },
    { id: "d5", p: 1, k: "count", c: "porte", label: "Portes", pts: [P(2.65, 8), P(6, 4.05), P(1.65, 5), P(4.85, 5), P(9.05, 5)] },
    { id: "d6", p: 1, k: "text", c: null, pts: [P(0, 8.45)], txt: "Dalle à reprendre ici ?" },
  ];
  const row = await mtCreate(file, "Plan d'exemple · rez-de-chaussée", null, { items, pages: { 1: { k, src: "1/50" } } });
  await refresh(); go("metres/" + row.id);
}

/* ---------- Éditeur ---------- */
const MT = { plan: null, doc: null, img: null, page: 1, np: 1, pw: 0, ph: 0, zoom: 1, tool: "sel", cat: "peint_murs", sel: null, draft: null, hist: [], redo: [], saveT: null, state: "ok", pdfPage: null, rt: null, pan: null, drag: null, space: false, rtimer: null, calib: null, key: null, cursor: null };

function mtUnmount() {
  if (MT.key) { document.removeEventListener("keydown", MT.key); document.removeEventListener("keyup", MT.keyup); MT.key = null; }
  clearTimeout(MT.rtimer);
  if (MT.saveT) { clearTimeout(MT.saveT); mtSaveNow(); }
  try { MT.doc?.destroy?.(); } catch (e) {}
  MT.doc = null; MT.img = null; MT.pdfPage = null;
}
async function mtEditor(id) {
  const p = byId(db.metPlans, id);
  if (!p) return `<div class="empty"><h2>Plan introuvable</h2><button class="btn" data-go="metres">Retour aux plans</button></div>`;
  mtUnmount();
  Object.assign(MT, { plan: p, page: 1, tool: "sel", cat: "peint_murs", sel: null, draft: null, hist: [], redo: [], state: "ok", calib: null, np: p.nb_pages || 1 });
  const tbtn = (t) => `<button type="button" class="mt-tb" data-mt-tool="${t[0]}" title="${t[1]} (${t[2]})" aria-pressed="false"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${t[3]}"/></svg><span>${t[1]}</span></button>`;
  const html = `<div class="mt" id="mt">
    <div class="mt-top"><a class="btn o sm" href="#/metres"><span>← Plans</span></a><h1>${esc(p.nom)}</h1>
      <span class="mt-chip">${esc(byId(db.chantiers, p.chantier_id)?.nom || "Sans chantier")}</span>
      <div class="mt-pager" id="mtpager"><button class="ib" data-mt="prev" aria-label="Page précédente">‹</button><span id="mtpn">1 / ${MT.np}</span><button class="ib" data-mt="next" aria-label="Page suivante">›</button></div>
      <span class="mt-save" id="mtsave" role="status">Enregistré</span>
      <button class="ib" data-mt="undo" title="Annuler (Ctrl+Z)" aria-label="Annuler">${svg(ic.undo)}</button><button class="ib" data-mt="redo" title="Rétablir (Ctrl+Y)" aria-label="Rétablir">${svg(ic.redo)}</button>
      <button class="btn sm" data-mt="quant">Quantitatif</button></div>
    <div class="mt-body">
      <div class="mt-tools" role="toolbar" aria-label="Outils">
        <h3>Mesurer</h3>${MT_TOOLS.map(tbtn).join("")}
        <h3>Quantité mesurée</h3><div id="mtcats"></div>
        <h3>Annoter</h3>${MT_ANNO.map(tbtn).join("")}
        <h3>Affichage</h3>
        <button type="button" class="mt-tb" data-mt="zin"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4M8 11h6M11 8v6"/></svg><span>Zoom +</span></button>
        <button type="button" class="mt-tb" data-mt="zout"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4M8 11h6"/></svg><span>Zoom −</span></button>
        <button type="button" class="mt-tb" data-mt="fit"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg><span>Ajuster</span></button>
        ${tbtn(["pan", "Déplacer", "H", "M8 13V5a1.5 1.5 0 013 0v6 M11 11V4a1.5 1.5 0 013 0v7 M14 11V6a1.5 1.5 0 013 0v8a6 6 0 01-6 6h-1a5 5 0 01-4-2l-3-4a1.5 1.5 0 012-2l2 2"])}
      </div>
      <div class="mt-view" id="mtv"><div class="mt-pg" id="mtpg"><canvas id="mtc"></canvas><svg id="mtsvg" xmlns="http://www.w3.org/2000/svg"></svg></div>
        <div class="mt-hint" id="mthint" aria-live="polite"></div><div class="mt-load" id="mtload">Chargement du plan…</div></div>
      <div class="mt-side" id="mtside" aria-label="Mesures"></div>
    </div>
    <div class="mt-sum" id="mtsum"></div></div>`;
  return { html, after: mtMount };
}

function mtHeight() {
  const m = $("#mt"); if (!m) return;
  if (window.innerWidth <= 1000) { m.style.height = ""; return; }
  m.style.height = Math.max(560, window.innerHeight - m.getBoundingClientRect().top - 14) + "px";
}
async function mtMount() {
  ST.editing = true;
  mtStyle(); mtHeight();
  const p = MT.plan;
  try {
    const { data, error } = await sb.storage.from("documents").download(p.chemin);
    if (error) throw new Error("Plan introuvable dans le stockage : " + error.message);
    if (!$("#mt")) return;
    if (p.type === "image") {
      const url = URL.createObjectURL(data);
      MT.img = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error("Image illisible.")); i.src = url; });
      MT.np = 1;
    } else {
      const pdfjs = await import(LIBS.pdfjs); pdfjs.GlobalWorkerOptions.workerSrc = LIBS.pdfjsWorker;
      MT.doc = await pdfjs.getDocument({ data: new Uint8Array(await data.arrayBuffer()) }).promise; MT.np = MT.doc.numPages;
    }
    if (!$("#mt") || MT.plan !== p) return;
    if (MT.np !== p.nb_pages) p.nb_pages = MT.np;
    $("#mtpn").textContent = `1 / ${MT.np}`; $("#mtpager").hidden = MT.np < 2;
    await mtLoadPage(1, true);
    mtBind(); mtTools(); mtSide(); mtSum();
    $("#mtload").hidden = true;
    mtSetSave("ok");
  } catch (e) {
    console.error(e);
    const l = $("#mtload"); if (l) l.innerHTML = `<b>Impossible d'ouvrir ce plan.</b><br>${esc(friendly(e))}`;
  }
}

async function mtLoadPage(n, fit) {
  MT.page = n; MT.sel = null; MT.draft = null; MT.calib = null;
  if (MT.doc) { MT.pdfPage = await MT.doc.getPage(n); const vp = MT.pdfPage.getViewport({ scale: 1 }); MT.pw = vp.width; MT.ph = vp.height; }
  else { MT.pw = MT.img.naturalWidth; MT.ph = MT.img.naturalHeight; }
  $("#mtpn").textContent = `${n} / ${MT.np}`;
  const svgEl = $("#mtsvg"); svgEl.setAttribute("viewBox", `0 0 ${MT.pw} ${MT.ph}`);
  if (fit) mtFit(); else mtSize();
  await mtRender(); mtDraw(); mtSide(); mtHint();
}
function mtFit() {
  const v = $("#mtv"), z = Math.min((v.clientWidth - 32) / MT.pw, (v.clientHeight - 32) / MT.ph);
  mtZoom(Math.max(0.05, z || 1), null, true);
}
function mtSize() {
  const pg = $("#mtpg"); pg.style.width = MT.pw * MT.zoom + "px"; pg.style.height = MT.ph * MT.zoom + "px";
}
function mtZoom(z, anchor, nodraw) {
  const v = $("#mtv"), old = MT.zoom;
  z = Math.min(8, Math.max(0.05, z));
  const ax = anchor ? anchor.x : v.clientWidth / 2, ay = anchor ? anchor.y : v.clientHeight / 2;
  const px = (v.scrollLeft + ax) / old, py = (v.scrollTop + ay) / old;
  MT.zoom = z; mtSize();
  if (anchor || old !== 1) { v.scrollLeft = px * z - ax; v.scrollTop = py * z - ay; }
  if (!nodraw) mtDraw();
  clearTimeout(MT.rtimer); MT.rtimer = setTimeout(mtRender, 160);
}
async function mtRender() {
  const c = $("#mtc"); if (!c || (!MT.pdfPage && !MT.img)) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1), sc = Math.min(MT.zoom * dpr, 5000 / Math.max(MT.pw, MT.ph));
  const oc = document.createElement("canvas");
  if (MT.img) {
    oc.width = Math.max(1, Math.round(MT.pw * sc)); oc.height = Math.max(1, Math.round(MT.ph * sc));
    oc.getContext("2d").drawImage(MT.img, 0, 0, oc.width, oc.height);
  } else {
    if (MT.rt) { try { MT.rt.cancel(); } catch (e) {} }
    const vp = MT.pdfPage.getViewport({ scale: sc }); oc.width = Math.round(vp.width); oc.height = Math.round(vp.height);
    const ctx = oc.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, oc.width, oc.height);
    const rt = (MT.rt = MT.pdfPage.render({ canvasContext: ctx, viewport: vp }));
    try { await rt.promise; } catch (e) { if (e?.name === "RenderingCancelledException") return; throw e; }
  }
  c.width = oc.width; c.height = oc.height; c.getContext("2d").drawImage(oc, 0, 0);
}

/* ----- état, historique, enregistrement ----- */
const mtData = () => MT.plan.data;
const mtSnap = () => JSON.stringify({ items: mtData().items, pages: mtData().pages });
function mtMut(fn) {
  if (!guard()) return false;
  MT.hist.push(mtSnap()); if (MT.hist.length > 60) MT.hist.shift(); MT.redo = [];
  fn(); mtChanged(); return true;
}
function mtRestore(s) { const o = JSON.parse(s); mtData().items = o.items; mtData().pages = o.pages; MT.sel = null; mtChanged(); }
function mtUndo() { if (!MT.hist.length) return; MT.redo.push(mtSnap()); mtRestore(MT.hist.pop()); }
function mtRedo() { if (!MT.redo.length) return; MT.hist.push(mtSnap()); mtRestore(MT.redo.pop()); }
function mtChanged() { mtDraw(); mtSide(); mtSum(); mtSaveSoon(); }
function mtSetSave(s) {
  MT.state = s; const el = $("#mtsave"); if (!el) return;
  el.textContent = s === "ok" ? "Enregistré" : s === "wait" ? "Enregistrement…" : "Non enregistré";
  el.className = "mt-save " + s;
}
function mtSaveSoon() { mtSetSave("wait"); clearTimeout(MT.saveT); MT.saveT = setTimeout(mtSaveNow, 900); }
async function mtSaveNow() {
  MT.saveT = null;
  const p = MT.plan; if (!p || ro) return;
  try {
    await q(sb.from("metres_plans").update({ data: p.data, nb_pages: p.nb_pages, updated_at: new Date().toISOString() }).eq("id", p.id));
    p.updated_at = new Date().toISOString(); mtSetSave("ok");
  } catch (e) { console.warn(e); mtSetSave("err"); toast("Enregistrement impossible : " + esc(friendly(e)), "dn"); }
}

/* ----- barre d'outils gauche ----- */
const mtKindOf = (tool) => ({ rect: "area", poly: "area", line: "line", count: "count" })[tool] || null;
function mtSetTool(t) {
  MT.tool = t; MT.draft = null; MT.calib = null;
  const kind = mtKindOf(t);
  if (kind && MT_CATS[MT.cat]?.k !== kind) MT.cat = MT_KEYS.find((c) => MT_CATS[c].k === kind);
  mtTools(); mtDraw(); mtHint();
}
function mtTools() {
  $$("[data-mt-tool]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.mtTool === MT.tool));
  const kind = mtKindOf(MT.tool), box = $("#mtcats"); if (!box) return;
  const keys = kind ? MT_KEYS.filter((c) => MT_CATS[c].k === kind) : MT_KEYS;
  box.innerHTML = keys.map((c) => `<button type="button" class="mt-cat" data-mt-cat="${c}" aria-pressed="${c === MT.cat}"${kind ? "" : " disabled"}><i style="background:${MT_CATS[c].c}"></i>${esc(MT_CATS[c].l)}</button>`).join("");
  box.classList.toggle("off", !kind);
}
function mtHint() {
  const h = $("#mthint"); if (!h) return;
  const k = mtScaleOf(MT.plan, MT.page), cat = MT_CATS[MT.cat];
  let t = "";
  if (!k && MT.tool !== "calib" && MT.tool !== "sel" && MT.tool !== "pan" && mtKindOf(MT.tool) !== "count") t = "Définissez d'abord l'échelle de cette page (outil Échelle).";
  else if (MT.tool === "calib") t = MT.calib?.length ? "Cliquez sur le deuxième point." : "Cliquez deux points dont vous connaissez la distance réelle, ou choisissez une échelle imprimée.";
  else if (MT.tool === "rect") t = "Glissez pour tracer un rectangle · " + (cat?.l || "");
  else if (MT.tool === "poly") t = "Cliquez les angles · double-clic ou Entrée pour terminer · Échap annule";
  else if (MT.tool === "line") t = "Cliquez les points · double-clic ou Entrée pour terminer · cliquez le premier point pour fermer · Maj = angle droit";
  else if (MT.tool === "count") t = "Cliquez pour compter · " + (cat?.hint || "");
  else if (MT.tool === "text" || MT.tool === "note") t = "Cliquez à l'endroit de l'annotation.";
  else if (MT.tool === "pen") t = "Maintenez et dessinez à main levée.";
  else if (MT.tool === "arrow") t = "Glissez pour tracer une flèche.";
  else if (MT.tool === "pan") t = "Glissez pour déplacer le plan (ou barre d'espace).";
  else t = "Cliquez une mesure pour la modifier · glissez-la pour la déplacer · Suppr pour l'effacer.";
  h.textContent = t; h.hidden = !t;
}

/* ----- dessin de la couche de mesures ----- */
const mtId = () => "m" + Math.random().toString(36).slice(2, 9);
function mtBadge(x, y, text, color, s, anchor = "middle") {
  const fs = 12 * s, w = (text.length * 0.58 + 1.2) * fs, h = 1.7 * fs, rx = anchor === "middle" ? x - w / 2 : x;
  return `<g class="mb" pointer-events="none"><rect x="${rx}" y="${y - h / 2}" width="${w}" height="${h}" rx="${3 * s}" fill="${color}"/><text x="${rx + w / 2}" y="${y + fs * 0.36}" font-size="${fs}" fill="#fff" text-anchor="middle" font-weight="600">${esc(text)}</text></g>`;
}
function mtItemSvg(it, s, sel) {
  const R = mtReg(MT.plan), k = mtScaleOf(MT.plan, it.p), cat = MT_CATS[it.c], col = cat?.c || it.col || "#e11d48", sw = 2 * s;
  const pts = it.pts, P = (a) => `${a[0]},${a[1]}`, id = `data-id="${it.id}"`;
  const lab = it.label ? it.label + " · " : "";
  let out = "";
  if (it.k === "area") {
    const q = mtItemQ(it, R, k), c = mtCentroid(pts);
    out += `<polygon ${id} points="${pts.map(P).join(" ")}" fill="${col}" fill-opacity="${sel ? 0.3 : 0.18}" stroke="${col}" stroke-width="${sw}" stroke-linejoin="round"/>`;
    if (q.val != null) out += mtBadge(c[0], c[1], `${lab}${mtFmt(q.val)} ${q.unit}`, col, s);
    else out += mtBadge(c[0], c[1], `${lab}échelle ?`, "#6b7280", s);
    if (it.r && k && pts.length === 4) {
      const w = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) * k, h = Math.hypot(pts[3][0] - pts[0][0], pts[3][1] - pts[0][1]) * k, fs = 12 * s;
      out += `<text x="${(pts[0][0] + pts[1][0]) / 2}" y="${Math.min(pts[0][1], pts[1][1]) - 5 * s}" font-size="${fs}" fill="${col}" text-anchor="middle" font-weight="600" pointer-events="none">${mtFmt(w)} m</text>`;
      out += `<text x="${Math.max(pts[0][0], pts[1][0]) + 6 * s}" y="${(pts[0][1] + pts[3][1]) / 2}" font-size="${fs}" fill="${col}" font-weight="600" pointer-events="none">${mtFmt(h)} m</text>`;
    }
  } else if (it.k === "line") {
    const q = mtItemQ(it, R, k), a = pts[pts.length - 1];
    const d = pts.map(P).join(" ") + (it.closed ? " " + P(pts[0]) : "");
    out += `<polyline ${id} points="${d}" fill="none" stroke="${col}" stroke-width="${3 * s}" stroke-linejoin="round" stroke-linecap="round"/>` + pts.map((a2) => `<circle cx="${a2[0]}" cy="${a2[1]}" r="${3 * s}" fill="#fff" stroke="${col}" stroke-width="${1.5 * s}" pointer-events="none"/>`).join("");
    const mid = it.closed && pts.length > 2 ? mtCentroid(pts) : pts.length > 1 ? [(pts[0][0] + a[0]) / 2, (pts[0][1] + a[1]) / 2] : a;
    if (q?.val != null) out += mtBadge(mid[0], it.closed ? mid[1] : mid[1] - 14 * s, `${lab}${q.unit === "m²" ? `${mtFmt(q.L)} ml × ${mtFmt(q.h, 2)} m = ${mtFmt(q.val)} m²` : `${mtFmt(q.val)} ml`}`, col, s);
  } else if (it.k === "count") {
    out += pts.map((a, i) => `<g ${id}><circle cx="${a[0]}" cy="${a[1]}" r="${10 * s}" fill="${col}" stroke="#fff" stroke-width="${1.5 * s}"/><text x="${a[0]}" y="${a[1] + 4 * s}" font-size="${11 * s}" fill="#fff" text-anchor="middle" font-weight="700" pointer-events="none">${i + 1}</text></g>`).join("");
    out += mtBadge(pts[0][0] + 14 * s, pts[0][1] - 14 * s, `${it.label || cat.s} : ${pts.length}`, col, s, "start");
  } else if (it.k === "text") {
    out += `<text ${id} x="${pts[0][0]}" y="${pts[0][1]}" font-size="${(it.fs || 16) * s * 1.2}" fill="${it.col || "#e11d48"}" font-weight="600">${String(it.txt || "").split("\n").map((l, i) => `<tspan x="${pts[0][0]}" dy="${i ? 1.2 : 0}em">${esc(l)}</tspan>`).join("")}</text>`;
  } else if (it.k === "note") {
    const lines = String(it.txt || "").split("\n"), fs = 12 * s, w = Math.max(...lines.map((l) => l.length), 6) * fs * 0.58 + 16 * s, h = lines.length * fs * 1.35 + 12 * s;
    out += `<g ${id}><rect x="${pts[0][0]}" y="${pts[0][1]}" width="${w}" height="${h}" rx="${3 * s}" fill="#fde68a" stroke="#d97706" stroke-width="${s}"/>${lines.map((l, i) => `<text x="${pts[0][0] + 8 * s}" y="${pts[0][1] + 8 * s + fs * (1.1 + i * 1.35)}" font-size="${fs}" fill="#1f2937">${esc(l)}</text>`).join("")}</g>`;
  } else if (it.k === "arrow") {
    const [a, b] = pts, ang = Math.atan2(b[1] - a[1], b[0] - a[0]), hs = 14 * s, c = it.col || "#e11d48";
    const h1 = [b[0] - hs * Math.cos(ang - 0.45), b[1] - hs * Math.sin(ang - 0.45)], h2 = [b[0] - hs * Math.cos(ang + 0.45), b[1] - hs * Math.sin(ang + 0.45)];
    out += `<g ${id}><line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${c}" stroke-width="${2.5 * s}" stroke-linecap="round"/><polygon points="${P(b)} ${P(h1)} ${P(h2)}" fill="${c}"/></g>`;
  } else if (it.k === "pen") {
    out += `<polyline ${id} points="${pts.map(P).join(" ")}" fill="none" stroke="${it.col || "#e11d48"}" stroke-width="${2.5 * s}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  if (sel) {
    const xs = pts.map((a) => a[0]), ys = pts.map((a) => a[1]), pad = 6 * s;
    out += `<rect x="${Math.min(...xs) - pad}" y="${Math.min(...ys) - pad}" width="${Math.max(...xs) - Math.min(...xs) + 2 * pad}" height="${Math.max(...ys) - Math.min(...ys) + 2 * pad}" fill="none" stroke="#2563eb" stroke-width="${s}" stroke-dasharray="${5 * s} ${4 * s}" pointer-events="none"/>`;
    if (["area", "line", "arrow"].includes(it.k)) out += pts.map((a, i) => `<circle data-h="${i}" cx="${a[0]}" cy="${a[1]}" r="${5 * s}" fill="#fff" stroke="#2563eb" stroke-width="${2 * s}" style="cursor:move"/>`).join("");
  }
  return out;
}
function mtDraw() {
  const el = $("#mtsvg"); if (!el) return;
  const s = 1 / MT.zoom;
  let h = (mtData().items || []).filter((i) => i.p === MT.page).map((i) => mtItemSvg(i, s, MT.sel === i.id)).join("");
  const d = MT.draft;
  if (d) {
    const col = MT_CATS[d.c]?.c || "#e11d48", pts = d.cur ? [...d.pts, d.cur] : d.pts, k = mtScaleOf(MT.plan, MT.page), R = mtReg(MT.plan);
    if (d.k === "area" || d.k === "line" || d.k === "calib") {
      const poly = d.k === "area" && pts.length > 2;
      h += poly ? `<polygon points="${pts.map((a) => a.join(",")).join(" ")}" fill="${col}" fill-opacity=".15" stroke="${col}" stroke-width="${2 * s}" stroke-dasharray="${6 * s} ${4 * s}"/>`
        : `<polyline points="${pts.map((a) => a.join(",")).join(" ")}" fill="none" stroke="${col}" stroke-width="${2.5 * s}" stroke-dasharray="${6 * s} ${4 * s}"/>`;
      h += d.pts.map((a) => `<circle cx="${a[0]}" cy="${a[1]}" r="${4 * s}" fill="#fff" stroke="${col}" stroke-width="${1.5 * s}"/>`).join("");
      if (d.cur && k && d.k !== "calib") {
        const tmp = { c: d.c, k: d.k, pts, closed: false, par: {} }, q = d.k === "area" ? mtItemQ({ ...tmp, pts: pts.length > 2 ? pts : [...pts, ...pts, ...pts] }, R, k) : mtItemQ(tmp, R, k);
        if (q?.val != null) h += mtBadge(d.cur[0] + 12 * s, d.cur[1] - 16 * s, d.k === "line" ? `${mtFmt(q.L ?? q.val)} ml` : `${mtFmt(q.val)} ${q.unit}`, col, s, "start");
      }
    } else if (d.k === "rect" && d.cur) {
      const a = d.pts[0], b = d.cur, r = [a, [b[0], a[1]], b, [a[0], b[1]]];
      h += `<polygon points="${r.map((x) => x.join(",")).join(" ")}" fill="${col}" fill-opacity=".15" stroke="${col}" stroke-width="${2 * s}" stroke-dasharray="${6 * s} ${4 * s}"/>`;
      if (k) { const q = mtItemQ({ c: d.c, k: "area", pts: r }, R, k); h += mtBadge((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, `${mtFmt(q.val)} ${q.unit}`, col, s); }
    } else if (d.k === "pen" || d.k === "arrow") {
      h += `<polyline points="${(d.k === "arrow" && d.cur ? [d.pts[0], d.cur] : d.pts).map((x) => x.join(",")).join(" ")}" fill="none" stroke="#e11d48" stroke-width="${2.5 * s}" stroke-linecap="round"/>`;
    }
  }
  el.innerHTML = h;
}

/* ----- événements de la zone de dessin ----- */
const mtPoint = (e) => { const r = $("#mtpg").getBoundingClientRect(); return [(e.clientX - r.left) / MT.zoom, (e.clientY - r.top) / MT.zoom]; };
const mtSnapAngle = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), d = Math.hypot(dx, dy); return [a[0] + d * Math.cos(ang), a[1] + d * Math.sin(ang)]; };
function mtAddItem(o) {
  const n = (mtData().items || []).filter((i) => i.c === o.c && i.k === o.k).length + 1, cat = MT_CATS[o.c];
  const it = { id: mtId(), p: MT.page, label: cat && o.k !== "count" ? `${cat.s} ${n}` : undefined, ...o };
  mtMut(() => mtData().items.push(it)); MT.sel = it.id; mtSide(); mtDraw();
  return it;
}
function mtFinishPoly() {
  const d = MT.draft; if (!d) return;
  const pts = []; d.pts.forEach((p) => { if (!pts.length || Math.hypot(p[0] - pts[pts.length - 1][0], p[1] - pts[pts.length - 1][1]) > 2 / MT.zoom) pts.push(p); });
  MT.draft = null;
  const min = d.k === "area" ? 3 : 2;
  if (pts.length >= min) mtAddItem({ k: d.k, c: d.c, pts, closed: !!d.closed }); else mtDraw();
}
function mtBind() {
  const v = $("#mtv"), svgEl = $("#mtsvg");
  svgEl.addEventListener("pointerdown", (e) => {
    if (e.button === 1 || MT.space || MT.tool === "pan") { MT.pan = { x: e.clientX, y: e.clientY, sl: v.scrollLeft, st: v.scrollTop }; svgEl.setPointerCapture(e.pointerId); e.preventDefault(); return; }
    if (e.button !== 0) return;
    const pt = mtPoint(e), t = MT.tool, cat = MT_CATS[MT.cat], k = mtScaleOf(MT.plan, MT.page);
    if (t === "sel") {
      const h = e.target.closest("[data-h]"), it = e.target.closest("[data-id]") ? (mtData().items || []).find((i) => i.id === e.target.closest("[data-id]").dataset.id) : null;
      if (h && MT.sel) { const sel = (mtData().items).find((i) => i.id === MT.sel); MT.drag = { it: sel, vi: +h.dataset.h, snap: mtSnap(), moved: false }; svgEl.setPointerCapture(e.pointerId); return; }
      if (it) { MT.sel = it.id; MT.drag = { it, start: pt, orig: it.pts.map((a) => [...a]), snap: mtSnap(), moved: false }; svgEl.setPointerCapture(e.pointerId); mtDraw(); mtSide(); }
      else { MT.sel = null; mtDraw(); mtSide(); }
      return;
    }
    if (["rect", "poly", "line"].includes(t) && !k) { toast("Définissez d'abord l'échelle de cette page (outil Échelle).", "wn"); return mtSetTool("calib"); }
    if (t === "rect") { MT.draft = { k: "rect", c: MT.cat, pts: [pt], cur: pt }; svgEl.setPointerCapture(e.pointerId); }
    else if (t === "poly" || t === "line") {
      const kind = t === "poly" ? "area" : "line", now = Date.now(), ld = MT.lastDown;
      MT.lastDown = { t: now, x: e.clientX, y: e.clientY };
      if (MT.draft && ld && now - ld.t < 380 && Math.hypot(e.clientX - ld.x, e.clientY - ld.y) < 8) return mtFinishPoly(); // double clic = terminer
      if (!MT.draft) MT.draft = { k: kind, c: MT.cat, pts: [pt] };
      else {
        const first = MT.draft.pts[0], close = MT.draft.pts.length >= (kind === "area" ? 3 : 3) && Math.hypot(pt[0] - first[0], pt[1] - first[1]) < 10 / MT.zoom;
        if (close) { MT.draft.closed = true; return mtFinishPoly(); }
        MT.draft.pts.push(e.shiftKey ? mtSnapAngle(MT.draft.pts[MT.draft.pts.length - 1], pt) : pt);
      }
      mtDraw();
    } else if (t === "count") {
      const ex = (mtData().items || []).find((i) => i.k === "count" && i.c === MT.cat && i.p === MT.page);
      if (ex) mtMut(() => ex.pts.push(pt)); else mtAddItem({ k: "count", c: MT.cat, pts: [pt] });
      mtDraw(); mtSide();
    } else if (t === "calib") {
      MT.draft = MT.draft || { k: "calib", pts: [] }; MT.draft.pts.push(pt);
      if (MT.draft.pts.length === 2) { const [a, b] = MT.draft.pts; MT.draft = null; mtCalibForm(a, b); }
      mtDraw(); mtHint();
    } else if (t === "text" || t === "note") mtTextForm(t, pt);
    else if (t === "pen") { MT.draft = { k: "pen", pts: [pt] }; svgEl.setPointerCapture(e.pointerId); }
    else if (t === "arrow") { MT.draft = { k: "arrow", pts: [pt], cur: pt }; svgEl.setPointerCapture(e.pointerId); }
  });
  svgEl.addEventListener("pointermove", (e) => {
    if (MT.pan) { v.scrollLeft = MT.pan.sl - (e.clientX - MT.pan.x); v.scrollTop = MT.pan.st - (e.clientY - MT.pan.y); return; }
    const pt = mtPoint(e);
    if (MT.drag) {
      const d = MT.drag; d.moved = true;
      if (d.vi != null) d.it.pts[d.vi] = e.shiftKey && d.it.pts.length > 1 ? mtSnapAngle(d.it.pts[d.vi ? d.vi - 1 : 1], pt) : pt;
      else { const dx = pt[0] - d.start[0], dy = pt[1] - d.start[1]; d.it.pts = d.orig.map((a) => [a[0] + dx, a[1] + dy]); }
      if (d.it.r && d.vi != null && d.it.pts.length === 4) { d.it.r = 0; }
      mtDraw(); return;
    }
    const d = MT.draft; if (!d) return;
    if (d.k === "pen") { const l = d.pts[d.pts.length - 1]; if (Math.hypot(pt[0] - l[0], pt[1] - l[1]) > 2 / MT.zoom) d.pts.push(pt); }
    else d.cur = (e.shiftKey && d.pts.length && ["line", "area", "calib"].includes(d.k)) ? mtSnapAngle(d.pts[d.pts.length - 1], pt) : pt;
    mtDraw();
  });
  const up = (e) => {
    if (MT.pan) { MT.pan = null; return; }
    if (MT.drag) {
      const d = MT.drag; MT.drag = null;
      if (d.moved && guard()) { MT.hist.push(d.snap); MT.redo = []; mtChanged(); } else if (d.moved) mtRestore(d.snap);
      return;
    }
    const d = MT.draft; if (!d) return;
    if (d.k === "rect") {
      const a = d.pts[0], b = mtPoint(e); MT.draft = null;
      if (Math.abs(a[0] - b[0]) > 4 / MT.zoom && Math.abs(a[1] - b[1]) > 4 / MT.zoom) mtAddItem({ k: "area", c: d.c, pts: [a, [b[0], a[1]], b, [a[0], b[1]]], r: 1 }); else mtDraw();
    } else if (d.k === "pen") { MT.draft = null; if (d.pts.length > 2) mtAddItem({ k: "pen", c: null, pts: d.pts }); else mtDraw(); }
    else if (d.k === "arrow") { const b = mtPoint(e); MT.draft = null; if (Math.hypot(b[0] - d.pts[0][0], b[1] - d.pts[0][1]) > 6 / MT.zoom) mtAddItem({ k: "arrow", c: null, pts: [d.pts[0], b] }); else mtDraw(); }
  };
  svgEl.addEventListener("pointerup", up);
  svgEl.addEventListener("pointercancel", () => { MT.pan = null; MT.drag = null; });
  svgEl.addEventListener("dblclick", () => { if (MT.draft && ["area", "line"].includes(MT.draft.k)) mtFinishPoly(); });
  v.addEventListener("wheel", (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault(); const r = v.getBoundingClientRect();
    mtZoom(MT.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), { x: e.clientX - r.left, y: e.clientY - r.top });
  }, { passive: false });
  // clics sur les boutons de l'éditeur
  $("#mt").addEventListener("click", (e) => {
    const b = e.target.closest("button,[data-mt-sel]"); if (!b) return;
    if (b.dataset.mtTool) return mtSetTool(b.dataset.mtTool);
    if (b.dataset.mtCat) { MT.cat = b.dataset.mtCat; mtTools(); mtHint(); return; }
    if (b.dataset.mtSel) { const it = mtData().items.find((i) => i.id === b.dataset.mtSel); if (it) { MT.sel = it.id; if (it.p !== MT.page) mtLoadPage(it.p); else { mtDraw(); mtSide(); } } return; }
    const a = b.dataset.mt; if (!a) return;
    ({ undo: mtUndo, redo: mtRedo, zin: () => mtZoom(MT.zoom * 1.25), zout: () => mtZoom(MT.zoom / 1.25), fit: mtFit,
      prev: () => MT.page > 1 && mtLoadPage(MT.page - 1, true), next: () => MT.page < MT.np && mtLoadPage(MT.page + 1, true),
      quant: mtQuantModal, del: () => mtDelete(), scale: mtScaleForm, csv: () => mtCsv(), pdf: () => mtExportPdf(), png: () => mtExportPng() })[a]?.();
  });
  $("#mt").addEventListener("change", (e) => { const t = e.target; if (t.dataset?.mtf) mtField(t); });
  MT.key = (e) => {
    if (!$("#mt")) return mtUnmount();
    if (e.target.closest("input,textarea,select") || document.querySelector(".md")) return;
    if (e.code === "Space") { MT.space = true; e.preventDefault(); return; }
    const key = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && key === "z") { e.preventDefault(); return e.shiftKey ? mtRedo() : mtUndo(); }
    if ((e.ctrlKey || e.metaKey) && key === "y") { e.preventDefault(); return mtRedo(); }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (key === "escape") { MT.draft = null; MT.calib = null; mtDraw(); mtHint(); return; }
    if (key === "enter" && MT.draft && ["area", "line"].includes(MT.draft.k)) return mtFinishPoly();
    if (key === "backspace" && MT.draft?.pts?.length) { MT.draft.pts.pop(); if (!MT.draft.pts.length) MT.draft = null; mtDraw(); return; }
    if ((key === "delete" || key === "backspace") && MT.sel) { e.preventDefault(); return mtDelete(); }
    if (key === "+" || key === "=") return mtZoom(MT.zoom * 1.25);
    if (key === "-") return mtZoom(MT.zoom / 1.25);
    const t = [...MT_TOOLS, ...MT_ANNO, ["pan", "", "H"]].find((x) => x[2].toLowerCase() === key);
    if (t) mtSetTool(t[0]);
  };
  MT.keyup = (e) => { if (e.code === "Space") MT.space = false; };
  document.addEventListener("keydown", MT.key); document.addEventListener("keyup", MT.keyup);
  window.addEventListener("resize", () => { if ($("#mt")) { mtHeight(); mtDraw(); } });
}
function mtDelete() {
  if (!MT.sel) return;
  const id = MT.sel; mtMut(() => { mtData().items = mtData().items.filter((i) => i.id !== id); }); MT.sel = null; mtSide(); mtDraw();
}

/* ----- formulaires : échelle, texte ----- */
function mtScaleForm() {
  const cur = mtScaleOf(MT.plan, MT.page), src = mtData().pages[MT.page]?.src;
  const isPdf = !!MT.doc;
  modal("Échelle de la page " + MT.page, `<div class="frm">
    ${isPdf ? `${fld({ k: "den", l: "Échelle imprimée", t: "select", r: 0, cls: "full", o: [{ v: "", l: "Choisir…" }, ...MT_SCALES.map((d) => ({ v: d, l: "1/" + d }))], v: /^1\/(\d+)/.test(src || "") ? src.slice(2) : "", hint: "Valable si le plan est imprimé à sa taille (A1, A3…). Sinon, utilisez le calibrage." })}` : ""}
    <p class="note full" style="margin:0">Ou, pour un calage précis : fermez cette fenêtre, choisissez l'outil <b>Échelle</b> et cliquez deux points dont vous connaissez la distance (une cote, une porte de 0,90 m…).</p></div>
    ${cur ? `<p class="mut" style="margin:10px 0 0">Actuellement : ${esc(src || "calibrage manuel")} (1 cm à l'écran à 100 % ≈ ${fmtNum(cur * 28.35, 2)} m).</p>` : ""}`, {
    submit: "Appliquer",
    onSubmit: async (v, api) => {
      if (!v.den) throw new Error("Choisissez une échelle, ou utilisez le calibrage par deux points.");
      mtMut(() => { mtData().pages[MT.page] = { k: mtPtToM(+v.den), src: "1/" + v.den }; }); api.close(); mtHint();
    },
  });
}
function mtCalibForm(a, b) {
  const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
  modal("Distance réelle entre les deux points", `<div class="frm">${fld({ k: "dist", l: "Distance réelle (mètres)", t: "number", ph: "Ex. 4,50", cls: "full" })}</div>`, {
    submit: "Définir l'échelle",
    onSubmit: async (v, api) => {
      const m = parseNum(v.dist); if (!(m > 0)) throw new Error("Saisissez une distance supérieure à 0.");
      mtMut(() => { mtData().pages[MT.page] = { k: m / d, src: "calibrage" }; }); api.close(); mtSetTool("sel");
      toast(`Échelle définie : ${fmtNum(m / d * 28.35, 2)} m pour 1 cm à l'écran (100 %).`, "ok");
    },
  });
}
function mtTextForm(kind, pt) {
  modal(kind === "note" ? "Note" : "Texte", `<div class="frm">${fld({ k: "txt", l: kind === "note" ? "Contenu de la note" : "Texte", t: "textarea", rows: 3, cls: "full" })}</div>`, {
    submit: "Ajouter",
    onSubmit: async (v, api) => { if (!v.txt.trim()) throw new Error("Saisissez un texte."); api.close(); mtAddItem({ k: kind, c: null, pts: [pt], txt: v.txt.trim() }); mtSetTool("sel"); },
  });
}

/* ----- panneau de droite et synthèse ----- */
function mtSide() {
  const side = $("#mtside"); if (!side) return;
  const R = mtReg(MT.plan), items = (mtData().items || []);
  const ms = items.filter((i) => MT_CATS[i.c]), an = items.filter((i) => !MT_CATS[i.c]);
  const val = (i) => { const q = mtItemQ(i, R, mtScaleOf(MT.plan, i.p)); return q?.val == null ? "<em>échelle ?</em>" : `${mtFmt(q.val)} ${q.unit}`; };
  const t = mtTotals(MT.plan), sel = items.find((i) => i.id === MT.sel);
  let det = "";
  if (sel) {
    const cat = MT_CATS[sel.c], k = mtScaleOf(MT.plan, sel.p), q = cat ? mtItemQ(sel, R, k) : null, par = sel.par || {}, inp = (key, label, v, unit) => `<label class="mt-f"><span>${label}</span><input data-mtf="${key}" inputmode="decimal" value="${esc(v ?? "")}"><em>${unit}</em></label>`;
    det = `<h3>Détails de la mesure</h3><div class="mt-det">
      ${cat ? `<label class="mt-f"><span>Nom</span><input data-mtf="label" value="${esc(sel.label || "")}"></label>
      <label class="mt-f"><span>Catégorie</span><select data-mtf="c">${MT_KEYS.filter((c) => MT_CATS[c].k === cat.k).map((c) => `<option value="${c}"${c === sel.c ? " selected" : ""}>${esc(MT_CATS[c].l)}</option>`).join("")}</select></label>`
      : `<label class="mt-f"><span>Texte</span><textarea data-mtf="txt" rows="2">${esc(sel.txt || "")}</textarea></label>`}
      ${q && q.val != null ? `<dl class="mt-dl"><dt>Résultat</dt><dd><b>${mtFmt(q.val)} ${q.unit}</b></dd>${q.base != null && q.unit !== "m²" ? `<dt>Surface</dt><dd>${mtFmt(q.base)} m²</dd>` : ""}${q.per != null ? `<dt>Périmètre</dt><dd>${mtFmt(q.per)} m</dd>` : ""}${q.L != null ? `<dt>Longueur</dt><dd>${mtFmt(q.L)} m</dd>` : ""}${q.n != null ? `<dt>Nombre</dt><dd>${q.n}</dd>` : ""}</dl>` : ""}
      ${sel.c === "peint_murs" || sel.c === "placo_cl" ? inp("h", "Hauteur", par.h ?? "", `m (défaut ${fmtNum(R.h, 2)})`) : ""}
      ${sel.c === "placo_cl" ? inp("faces", "Faces", par.faces ?? 1, "1 ou 2") : ""}
      ${sel.c === "beton" ? inp("ep", "Épaisseur", par.ep ?? "", `m (défaut ${fmtNum(R.ep, 2)})`) : ""}
      ${cat?.k === "count" ? inp("ow", "Largeur", par.ow ?? "", `m (défaut ${fmtNum(cat.ow, 2)})`) + inp("oh", "Hauteur", par.oh ?? "", `m (défaut ${fmtNum(cat.oh, 2)})`) : ""}
      <button type="button" class="btn o sm" data-mt="del">Supprimer</button></div>`;
  }
  const sc = mtScaleOf(MT.plan, MT.page), mm = (u) => fmtNum(u * 25.4 / 72, 0);
  side.innerHTML = `<h3>Mesures</h3>
    <div class="mt-list">${ms.length ? ms.map((i) => `<button type="button" class="mt-row${i.id === MT.sel ? " on" : ""}" data-mt-sel="${i.id}"><i style="background:${MT_CATS[i.c].c}"></i><span>${esc(i.label || MT_CATS[i.c].s)}${MT.np > 1 ? `<small>p. ${i.p}</small>` : ""}</span><b>${val(i)}</b></button>`).join("") : `<p class="mt-empty">Aucune mesure. Choisissez un outil à gauche.</p>`}</div>
    ${an.length ? `<h3>Annotations</h3><div class="mt-list">${an.map((i) => `<button type="button" class="mt-row${i.id === MT.sel ? " on" : ""}" data-mt-sel="${i.id}"><i style="background:#e11d48"></i><span>${({ text: "Texte", note: "Note", arrow: "Flèche", pen: "Crayon" })[i.k]}${i.txt ? " · " + esc(i.txt.slice(0, 22)) : ""}</span></button>`).join("")}</div>` : ""}
    <div class="mt-tot"><span>Surface totale</span><b>${mtFmt(t.surf)} m²</b></div>${det}
    <h3>Informations du plan</h3><dl class="mt-dl"><dt>Fichier</dt><dd>${esc(MT.plan.nom)}</dd><dt>Page</dt><dd>${MT.page} / ${MT.np}</dd><dt>Taille</dt><dd>${mm(MT.pw)} × ${mm(MT.ph)} mm</dd>
      <dt>Échelle</dt><dd>${sc ? esc(mtData().pages[MT.page]?.src || "calibrage") : '<b class="mt-warn">non définie</b>'} <button type="button" class="mt-link" data-mt="scale">modifier</button></dd><dt>Modifié</dt><dd>${D(MT.plan.updated_at)}</dd></dl>`;
}
function mtField(el) {
  const sel = (mtData().items || []).find((i) => i.id === MT.sel); if (!sel) return;
  const key = el.dataset.mtf, num = (v) => { const n = parseNum(v); return String(v).trim() === "" ? null : n; };
  mtMut(() => {
    if (key === "label") sel.label = el.value.trim();
    else if (key === "txt") sel.txt = el.value;
    else if (key === "c") sel.c = el.value;
    else { sel.par ||= {}; const n = num(el.value); if (n == null) delete sel.par[key]; else sel.par[key] = n; }
  });
}
function mtSum() {
  const s = $("#mtsum"); if (!s) return;
  const t = mtTotals(MT.plan);
  s.innerHTML = `<b class="mt-st">Synthèse des quantités</b>
    <div><small>Surface totale</small><b>${mtFmt(t.surf)} m²</b></div><div><small>Périmètre total</small><b>${mtFmt(t.per)} m</b></div>
    <div><small>Longueur totale</small><b>${mtFmt(t.len)} m</b></div><div><small>Éléments comptés</small><b>${t.cnt}</b></div>
    <span class="mt-sp"></span><button class="btn o" data-mt="csv">Export CSV</button><button class="btn o" data-mt="pdf">PDF annoté</button><button class="btn" data-mt="quant">Quantitatif</button>`;
}

/* ----- quantitatif détaillé, exports, devis ----- */
function mtQuantRows() { return mtQuant(MT.plan); }
function mtQuantTable(rows, edit) {
  const R = mtReg(MT.plan);
  if (!rows.length) return `<p class="mt-empty">Aucune quantité pour le moment : mesurez d'abord sur le plan.</p>`;
  return `<div class="tw"><table class="mt-qt"><thead><tr><th>Poste</th><th class="r">Brut</th><th class="r">Déduction</th><th class="r">Pertes</th><th class="r">À prévoir</th><th>Unité</th><th class="r">Prix HT</th><th class="r">Total HT</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td><b>${esc(r.l)}</b>${r.sans ? `<small class="mt-warn">${r.sans} mesure(s) sans échelle ignorée(s)</small>` : ""}${r.c === "peint_murs" && r.ded ? `<small>Ouvertures déduites (fenêtres, portes)</small>` : ""}</td>
      <td class="r num">${r.c === "plaques" ? "-" : mtFmt(r.brut, MT_CATS[r.c]?.k === "count" ? 0 : 2)}</td><td class="r num">${r.ded ? "− " + mtFmt(r.ded) : "-"}</td>
      <td class="r">${MT_CATS[r.c] && MT_CATS[r.c].k !== "count" ? (edit ? `<input class="mt-in" data-q="perte:${r.c}" inputmode="decimal" value="${fmtNum(r.perte, 0).replace(/\s/g, "")}"> %` : r.perte + " %") : "-"}</td>
      <td class="r num"><b>${mtFmt(r.prevoir, r.u === "u" ? 0 : 2)}</b></td><td>${r.u}</td>
      <td class="r">${edit ? `<input class="mt-in" data-q="prix:${r.c}" inputmode="decimal" value="${r.prix || ""}" placeholder="0">` : mtFmt(r.prix)}</td><td class="r num" data-tot="${r.c}">${r.prix ? E2(r.total) : "-"}</td></tr>`).join("")}
    </tbody></table></div>
    <p class="note" style="margin:10px 0 0">Hauteur sous plafond ${fmtNum(R.h, 2)} m · épaisseur de dalle ${fmtNum(R.ep, 2)} m · plaque de placo ${fmtNum(R.plaque, 2)} m² · ouvertures ${R.deduire ? "déduites" : "non déduites"} de la peinture. Modifiables ci-dessous.</p>`;
}
function mtQuantModal() {
  const R = mtReg(MT.plan), canDevis = typeof permOk !== "function" || permOk("ventes");
  const body = () => `<div class="frm mt-reg">
      ${fld({ k: "h", l: "Hauteur sous plafond (m)", t: "number", v: fmtNum(R.h, 2), r: 0 })}${fld({ k: "ep", l: "Épaisseur de béton (m)", t: "number", v: fmtNum(R.ep, 2), r: 0 })}
      ${fld({ k: "plaque", l: "Surface d'une plaque de placo (m²)", t: "number", v: fmtNum(R.plaque, 2), r: 0 })}
      ${fld({ k: "deduire", l: "Déduire fenêtres et portes de la peinture", t: "select", v: R.deduire ? "1" : "0", r: 0, o: [{ v: "1", l: "Oui" }, { v: "0", l: "Non" }] })}</div>
    <div id="mtqt">${mtQuantTable(mtQuantRows(), true)}</div>`;
  const api = modal("Quantitatif détaillé", body(), {
    wide: true, submit: canDevis ? "Créer un devis brouillon" : false, cancel: "Fermer",
    extra: `<button type="button" class="btn o" id="mtqcsv">Export CSV</button> <button type="button" class="btn o" id="mtqcopy">Copier</button>`,
    onSubmit: async (v, a) => { await mtToDevis(a); },
    onMount: (m) => {
      const upd = () => { $("#mtqt", m).innerHTML = mtQuantTable(mtQuantRows(), true); };
      m.addEventListener("change", (e) => {
        const t = e.target; if (!guard()) return;
        if (t.name && ["h", "ep", "plaque", "deduire"].includes(t.name)) { mtMut(() => { const r = (mtData().reg ||= {}); r[t.name] = t.name === "deduire" ? t.value === "1" : parseNum(t.value); }); upd(); return; }
        if (t.dataset?.q) { const [kind, c] = t.dataset.q.split(":"); mtMut(() => { const r = (mtData().reg ||= {}); r[kind] ||= {}; r[kind][c] = parseNum(t.value); }); upd(); }
      });
      $("#mtqcsv", m).onclick = () => mtCsv();
      $("#mtqcopy", m).onclick = async () => { try { await navigator.clipboard.writeText(mtQuantRows().map((r) => `${r.l}\t${fmtNum(r.prevoir, 2)}\t${r.u}`).join("\n")); toast("Quantitatif copié.", "ok"); } catch (e) { toast("Copie impossible.", "dn"); } };
    },
  });
}
function mtCsv() {
  const rows = mtQuantRows();
  if (!rows.length) return toast("Aucune quantité à exporter.", "wn");
  const n = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
  const head = ["Poste", "Brut", "Déduction", "Pertes (%)", "À prévoir", "Unité", "Prix unitaire HT", "Total HT"];
  const body = rows.map((r) => [r.l, n(r.brut), n(r.ded), r.perte, n(r.prevoir), r.u, r.prix || "", r.prix ? n(r.total) : ""]);
  const detail = [[], ["Détail des mesures"], ["Page", "Nom", "Catégorie", "Résultat", "Unité"]];
  const R = mtReg(MT.plan);
  for (const i of MT.plan.data.items.filter((x) => MT_CATS[x.c])) { const q = mtItemQ(i, R, mtScaleOf(MT.plan, i.p)); detail.push([i.p, i.label || "", MT_CATS[i.c].l, q?.val == null ? "échelle manquante" : n(q.val), q?.unit || ""]); }
  downloadBlob(`metres-${slug(MT.plan.nom)}.csv`, new Blob([toCsv(head, [...body, ...detail])], { type: "text/csv;charset=utf-8" }));
}
async function mtToDevis(api) {
  const rows = mtQuantRows().filter((r) => r.prevoir > 0);
  if (!rows.length) throw new Error("Aucune quantité à transférer.");
  const ch = byId(db.chantiers, MT.plan.chantier_id);
  if (!ch?.client_id) throw new Error("Rattachez ce plan à un chantier qui a un client pour créer le devis.");
  const lignes = rows.map((r) => ({ designation: r.l.replace(/ \(.*\)$/, ""), quantite: Math.round(r.prevoir * 100) / 100, unite: r.u === "u" ? "u" : r.u, prix_unitaire_ht: r.prix || 0, taux_tva: 20 }));
  const id = await q(sb.rpc("sauver_document", { p_kind: "devis", p: { id: null, client_id: ch.client_id, chantier_id: ch.id, date: today(), notes: `Quantités issues du métré « ${MT.plan.nom} ».`, validite_jours: 30, lignes } }));
  api.close(); await mtSaveNow(); toast("Devis brouillon créé à partir du métré.", "ok"); await refresh(); go("devis/" + id);
}
// Rendu d'une page (plan + mesures) en PNG
async function mtPagePng(n, scale = 2) {
  const prev = { page: MT.page, doc: MT.pdfPage, pw: MT.pw, ph: MT.ph };
  const pg = MT.doc ? await MT.doc.getPage(n) : null, vp = pg ? pg.getViewport({ scale: 1 }) : { width: MT.img.naturalWidth, height: MT.img.naturalHeight };
  const sc = Math.min(scale, 4000 / Math.max(vp.width, vp.height)), c = document.createElement("canvas");
  c.width = Math.round(vp.width * sc); c.height = Math.round(vp.height * sc);
  const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  if (pg) await pg.render({ canvasContext: ctx, viewport: pg.getViewport({ scale: sc }) }).promise; else ctx.drawImage(MT.img, 0, 0, c.width, c.height);
  const savePage = MT.page, saveZoom = MT.zoom, savePw = MT.pw, savePh = MT.ph;
  MT.page = n; MT.zoom = sc; MT.pw = vp.width; MT.ph = vp.height;
  const inner = (mtData().items || []).filter((i) => i.p === n).map((i) => mtItemSvg(i, 1 / sc, false)).join("");
  MT.page = savePage; MT.zoom = saveZoom; MT.pw = savePw; MT.ph = savePh;
  const xml = `<svg xmlns="http://www.w3.org/2000/svg" width="${c.width}" height="${c.height}" viewBox="0 0 ${vp.width} ${vp.height}" font-family="Arial,Helvetica,sans-serif">${inner}</svg>`;
  const img = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error("Rendu des mesures impossible.")); i.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml); });
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}
async function mtExportPng() {
  const c = await mtPagePng(MT.page); c.toBlob((b) => downloadBlob(`plan-${slug(MT.plan.nom)}-p${MT.page}.png`, b), "image/png");
}
async function mtExportPdf() {
  toast("Préparation du PDF annoté…");
  await loadScript(LIBS.pdflib);
  const { PDFDocument, StandardFonts, rgb } = PDFLib, doc = await PDFDocument.create(), f = await doc.embedFont(StandardFonts.Helvetica), fb = await doc.embedFont(StandardFonts.HelveticaBold);
  const pages = [...new Set((mtData().items || []).map((i) => i.p))].sort((a, b) => a - b);
  if (!pages.length) pages.push(1);
  for (const n of pages) {
    const c = await mtPagePng(n, 2), png = await doc.embedPng(await new Promise((ok) => c.toBlob((b) => b.arrayBuffer().then(ok), "image/png")));
    const p = doc.addPage([c.width / 2, c.height / 2]); p.drawImage(png, { x: 0, y: 0, width: c.width / 2, height: c.height / 2 });
  }
  const rows = mtQuantRows(), p = doc.addPage([595.28, 841.89]); let y = 790;
  p.drawText("Quantitatif", { x: 40, y, size: 20, font: fb, color: rgb(0.1, 0.15, 0.25) }); y -= 20;
  p.drawText(`${MT.plan.nom} · ${D(today())}`, { x: 40, y, size: 10, font: f, color: rgb(0.4, 0.4, 0.45) }); y -= 34;
  const cols = [40, 290, 360, 430, 490];
  ["Poste", "Brut", "Pertes", "À prévoir", "Unité"].forEach((h, i) => p.drawText(h, { x: cols[i], y, size: 9, font: fb }));
  y -= 8; p.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: 0.7, color: rgb(0.7, 0.7, 0.75) }); y -= 16;
  for (const r of rows) {
    if (y < 60) break;
    [r.l.length > 48 ? r.l.slice(0, 46) + "…" : r.l, mtFmt(r.brut, r.u === "u" ? 0 : 2), r.perte ? r.perte + " %" : "-", mtFmt(r.prevoir, r.u === "u" ? 0 : 2), r.u].forEach((t, i) => p.drawText(String(t).replace(/[ ]/g, " "), { x: cols[i], y, size: 9, font: f }));
    y -= 16;
  }
  p.drawText("Quantités estimées à partir des mesures prises sur plan : à vérifier avant commande.", { x: 40, y: 40, size: 8, font: f, color: rgb(0.45, 0.45, 0.5) });
  downloadBlob(`metres-${slug(MT.plan.nom)}.pdf`, new Blob([await doc.save()], { type: "application/pdf" }));
}

/* ---------- Actions ---------- */
const metresActions = { mtNew: () => mtImportForm(), mtDemo: () => mtDemo() };

/* ---------- Style de l'éditeur (variables de l'application : thème clair et sombre) ---------- */
function mtStyle() {
  if (document.getElementById("mt-css")) return;
  const s = document.createElement("style"); s.id = "mt-css";
  s.textContent = `
.mt{color:var(--tx,#161a22);display:flex;flex-direction:column;height:calc(100vh - 150px);min-height:560px;background:var(--panel,#fff);border:1px solid var(--line,#e0e3e8);border-radius:10px;overflow:hidden}
.mt-top{display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--line,#e0e3e8);flex-wrap:wrap}
.mt-top h1{font-size:16px;margin:0 4px;font-weight:700}.mt-chip{font-size:12px;background:var(--sunk,#f1f3f6);border-radius:99px;padding:3px 10px;color:var(--mut,#5a6473)}
.mt-pager{display:flex;align-items:center;gap:4px;margin-left:auto}.mt-save{font-size:12.5px;color:var(--mut,#5a6473);margin-left:auto}.mt-pager:not([hidden])+.mt-save{margin-left:8px}
.mt-save.ok:before{content:"✓ ";color:#1b7a4b}.mt-save.err{color:#c0392b}
.mt-body{flex:1;display:grid;grid-template-columns:190px 1fr 290px;min-height:0}
.mt-tools,.mt-side{overflow:auto;padding:10px;background:var(--panel,#fff)}.mt-tools{border-right:1px solid var(--line,#e0e3e8)}.mt-side{border-left:1px solid var(--line,#e0e3e8)}
.mt h3{font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:var(--mut,#5a6473);margin:14px 6px 6px;font-weight:700}.mt h3:first-child{margin-top:2px}
.mt-tb,.mt-cat{display:flex;align-items:center;gap:9px;width:100%;border:0;background:none;color:inherit;font:inherit;font-size:13.5px;padding:8px 10px;border-radius:7px;cursor:pointer;text-align:left}
.mt-tb:hover,.mt-cat:hover{background:var(--sunk,#f1f3f6)}.mt-tb[aria-pressed=true]{background:var(--acc,#1d4d8f);color:#fff}
.mt-cat{font-size:12.5px;padding:6px 10px}.mt-cat i{width:10px;height:10px;border-radius:3px;flex:none}.mt-cat[aria-pressed=true]{background:var(--sunk,#f1f3f6);box-shadow:inset 3px 0 0 var(--acc,#1d4d8f);font-weight:600}.mt-cat[disabled]{opacity:.45;cursor:default}#mtcats.off{opacity:.6}
.mt-view{position:relative;overflow:auto;background:var(--sunk,#e9ecf0);min-width:0}.mt-pg{position:relative;margin:16px;background:#fff;box-shadow:0 2px 14px rgba(0,0,0,.2);width:fit-content}
.mt-pg canvas{position:absolute;inset:0;width:100%;height:100%;display:block}.mt-pg svg{position:absolute;inset:0;width:100%;height:100%;touch-action:none;font-family:inherit}
.mt-hint{position:sticky;left:0;bottom:0;display:block;width:fit-content;margin:0 auto;transform:translateY(-12px);background:rgba(20,37,63,.92);color:#fff;font-size:12.5px;padding:6px 14px;border-radius:99px;pointer-events:none;max-width:90%;text-align:center}
.mt-load{position:absolute;inset:0;display:grid;place-items:center;background:var(--sunk,#e9ecf0);color:var(--mut,#5a6473);text-align:center;padding:20px}
.mt-list{display:flex;flex-direction:column;gap:2px}.mt-row{display:flex;align-items:center;gap:8px;width:100%;border:0;background:none;color:inherit;font:inherit;font-size:13px;padding:7px 8px;border-radius:7px;cursor:pointer;text-align:left}
.mt-row:hover{background:var(--sunk,#f1f3f6)}.mt-row.on{background:var(--accb,#e7eef9)}.mt-row i{width:12px;height:12px;border-radius:3px;flex:none}.mt-row span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.mt-row small{color:var(--mut,#5a6473);margin-left:6px}.mt-row b{font-variant-numeric:tabular-nums;font-size:12.5px}.mt-row em{color:var(--mut,#5a6473);font-weight:400}
.mt-tot{display:flex;justify-content:space-between;align-items:baseline;padding:12px 8px;margin-top:8px;border-top:1px solid var(--line,#e0e3e8)}.mt-tot b{font-size:20px;color:var(--acc,#1d4d8f)}
.mt-empty{color:var(--mut,#5a6473);font-size:13px;padding:6px 8px;margin:0}
.mt-dl{display:grid;grid-template-columns:auto 1fr;gap:6px 12px;font-size:12.5px;margin:6px 6px 0}.mt-dl dt{color:var(--mut,#5a6473)}.mt-dl dd{margin:0;text-align:right;overflow:hidden;text-overflow:ellipsis}
.mt-det{display:grid;gap:8px;padding:0 6px}.mt-f{display:grid;grid-template-columns:70px 1fr;align-items:center;gap:6px;font-size:12.5px}.mt-f span{color:var(--mut,#5a6473)}.mt-f em{grid-column:2;font-style:normal;font-size:11px;color:var(--mut,#5a6473);margin-top:-4px}
.mt-f input,.mt-f select,.mt-f textarea,.mt-in{font:inherit;font-size:13px;padding:5px 8px;border:1px solid var(--line,#e0e3e8);border-radius:6px;background:var(--panel,#fff);color:inherit;width:100%;min-width:0}.mt-in{width:74px;text-align:right}
.mt-warn{color:#b45309}.mt-link{border:0;background:none;color:var(--acc,#1d4d8f);cursor:pointer;font:inherit;font-size:12px;padding:0;text-decoration:underline}
.mt-sum{display:flex;align-items:center;gap:26px;padding:10px 16px;border-top:1px solid var(--line,#e0e3e8);flex-wrap:wrap}.mt-sum>div small{display:block;color:var(--mut,#5a6473);font-size:11.5px}.mt-sum>div b{font-size:17px;color:var(--acc,#1d4d8f);font-variant-numeric:tabular-nums}.mt-st{font-size:12px;text-transform:uppercase;letter-spacing:.06em}.mt-sp{flex:1}
.mt-qt td{white-space:nowrap}.mt-qt td:first-child{white-space:normal;min-width:200px}.mt-qt small{display:block;color:var(--mut,#5a6473);font-size:11.5px}.mt-reg{margin-bottom:12px}
.mt-how{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;padding:16px 18px}.mt-how b{display:block}.mt-how span{color:var(--mut,#5a6473);font-size:13px}
@media(max-width:1000px){.mt{height:auto!important}.mt-body{display:flex;flex-direction:column;flex:none}.mt-tools{display:flex;flex-wrap:wrap;gap:4px;border-right:0;border-bottom:1px solid var(--line,#e0e3e8);overflow:visible;flex:none}.mt-tools h3{width:100%;margin:6px 4px 0}.mt-tb{width:auto}.mt-tb span{display:none}#mtcats{display:flex;flex-wrap:wrap;gap:4px;width:100%}.mt-cat{width:auto}.mt-view{height:62vh;flex:none}.mt-side{border-left:0;border-top:1px solid var(--line,#e0e3e8);overflow:visible;flex:none}.mt-how{grid-template-columns:1fr 1fr}.mt-pager{margin-left:0}}`;
  document.head.appendChild(s);
}
