/* Bons d'intervention (v21) : création, technicien, temps passé et pièces, photos avant/après, signature du client,
   transformation en facture, PDF. Tables : interventions, intervention_photos (migration_v21.sql). */

const IV_STATUTS = ["Planifiée", "En cours", "Terminée", "Facturée", "Annulée"];
Object.assign(CHIP, { "En cours": "ok", Terminée: "ac" });
const ivClient = (i) => byId(db.clients, i.client_id)?.nom || "Sans client";
const ivTech = (i) => byId(db.sal, i.salarie_id)?.nom || i.technicien || "Non affecté";
const ivPieces = (i) => (Array.isArray(i.pieces) ? i.pieces : []).filter((p) => p.designation);
const ivTotaux = (i) => {
  const mo = Number(i.heures) * Number(i.taux_horaire), dep = Number(i.deplacement_ht) || 0, pc = sum(ivPieces(i), (p) => Number(p.quantite) * Number(p.prix_unitaire_ht));
  const ht = mo + dep + pc, tva = ht * (Number(i.taux_tva) / 100);
  return { mo, dep, pc, ht, tva, ttc: ht + tva };
};
function ivNumero() {
  const y = new Date().getFullYear(), n = Math.max(0, ...(db.interv || []).map((c) => (String(c.numero || "").startsWith(`BI-${y}-`) ? parseInt(c.numero.slice(-3)) || 0 : 0)));
  return `BI-${y}-${String(n + 1).padStart(3, "0")}`;
}
const ivCompress = (file, max = 1400) => (typeof jrCompress === "function" ? jrCompress(file, max) : new Promise((ok, ko) => {
  const img = new Image(), u = URL.createObjectURL(file);
  img.onload = () => { const sc = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement("canvas"); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(u); ok(c.toDataURL("image/jpeg", 0.75)); };
  img.onerror = () => ko(new Error("Photo illisible")); img.src = u;
}));

V.interventions = (r) => {
  if (!db.v21) return page("Bons d'intervention", "", "", v21Setup());
  if (r.arg) return intervDetail(r.arg);
  const cur = ST.tab.interventions || "afaire", l = db.interv || [], t = today();
  const sel = { afaire: l.filter((i) => ["Planifiée", "En cours"].includes(i.statut)), afact: l.filter((i) => i.statut === "Terminée"), toutes: l }[cur];
  const rows = [...sel].sort((a, b) => (cur === "toutes" ? b.date_prevue.localeCompare(a.date_prevue) : a.date_prevue.localeCompare(b.date_prevue))).map((i) => {
    const late = ["Planifiée", "En cours"].includes(i.statut) && i.date_prevue < t;
    return { go: `interventions/${i.id}`, t: `${i.numero} ${ivClient(i)} ${i.motif || ""} ${ivTech(i)}`,
      c: [`<strong>${esc(i.numero || "Brouillon")}</strong><small>${esc(i.motif || "")}</small>`, esc(ivClient(i)), `<span class="${late ? "dn" : ""}">${D(i.date_prevue)}${i.heure ? " · " + esc(i.heure) : ""}</span>${late ? "<small>en retard</small>" : ""}`, esc(ivTech(i)), `<span class="num">${ivTotaux(i).ht ? E2(ivTotaux(i).ht) : "-"}</span>`, chip(i.statut)] };
  });
  const tb = tabs("interventions", [["afaire", `À faire (${l.filter((i) => ["Planifiée", "En cours"].includes(i.statut)).length})`], ["afact", `À facturer (${l.filter((i) => i.statut === "Terminée").length})`], ["toutes", "Toutes"]], cur);
  return page("Bons d'intervention", "Interventions, temps passé, pièces, photos et signature du client.", btn("Nouvelle intervention", "ivNew"),
    tb + searchBar("Rechercher une intervention, un client…", `${rows.length} bon${rows.length > 1 ? "s" : ""}`) + tbl(["Bon", "Client", "Date", "Technicien", "Montant HT", "État"], rows, "Aucune intervention."));
};

function intervDetail(id) {
  const i = byId(db.interv || [], id);
  if (!i) return page("Intervention introuvable", "", "", card("", `<p class="emp">Ce bon n'existe plus. <a href="#/interventions">Retour aux interventions</a></p>`));
  const T = ivTotaux(i), ph = (db.ivPhotos || []).filter((p) => p.intervention_id === id), pcs = ivPieces(i);
  const grid = (phase) => `<div class="iv-ph">${ph.filter((p) => p.phase === phase).map((p) => `<figure><img data-ivph="${p.id}" alt="${phase === "avant" ? "Avant" : "Après"} l'intervention"><button type="button" class="rm" data-act="ivPhotoDel" data-id="${p.id}" aria-label="Supprimer la photo">${svg(ic.x)}</button></figure>`).join("") || `<p class="mut">Aucune photo.</p>`}</div>`;
  const photoBtn = (phase) => `<label class="btn o sm">+ Ajouter<input type="file" accept="image/*" capture="environment" multiple hidden data-ivfile="${phase}"></label>`;
  const acts = [
    i.statut === "Planifiée" ? btn("Démarrer", "ivStatut", id, "En cours") : "",
    ["Planifiée", "En cours"].includes(i.statut) ? btn("Terminer l'intervention", "ivTerminer", id) : "",
    i.statut === "Terminée" ? btn("Transformer en facture", "ivFacturer", id) : "",
    i.facture_id ? `<a class="btn o" href="#/factures/${i.facture_id}">Voir la facture</a>` : "",
    btn("Bon en PDF", "ivPdf", id, "", "o"),
    `<details class="more"><summary class="btn o">Plus d'actions</summary><div class="mm"><button type="button" class="mi" data-act="ivEdit" data-id="${id}">Modifier les informations</button>
      ${i.statut === "Terminée" ? `<button type="button" class="mi" data-act="ivStatut" data-id="${id}" data-arg="En cours">Rouvrir</button>` : ""}
      ${["Planifiée", "En cours"].includes(i.statut) ? `<button type="button" class="mi" data-act="ivStatut" data-id="${id}" data-arg="Annulée">Annuler le bon</button>` : ""}
      <button type="button" class="mi dng" data-act="ivDel" data-id="${id}">Supprimer</button></div></details>`,
  ].join("");
  const info = `<dl class="kv"><dt>Client</dt><dd><a href="#/clients/${i.client_id}">${esc(ivClient(i))}</a></dd>${i.chantier_id ? `<dt>Chantier</dt><dd><a href="#/chantiers/${i.chantier_id}">${esc(byId(db.chantiers, i.chantier_id)?.nom || "")}</a></dd>` : ""}${i.contrat_id ? `<dt>Contrat</dt><dd><a href="#/contrats/${i.contrat_id}">${esc(byId(db.contrats, i.contrat_id)?.libelle || "")}</a></dd>` : ""}
    <dt>Technicien</dt><dd>${esc(ivTech(i))}</dd><dt>Date</dt><dd>${D(i.date_prevue)}${i.heure ? " à " + esc(i.heure) : ""}</dd><dt>Motif</dt><dd>${esc(i.motif || "-")}</dd></dl>`;
  const travaux = `<div class="pad">${i.description ? `<p>${esc(i.description).replace(/\n/g, "<br>")}</p>` : `<p class="mut">Rien de renseigné pour l'instant.</p>`}</div>`;
  const tp = tbl(["Poste", "Quantité", "Prix unit. HT", "Total HT"], [
    ...(Number(i.heures) ? [{ t: "", c: ["Main d'œuvre", `${fmtNum(i.heures, 2)} h`, `<span class="num">${E2(i.taux_horaire)}</span>`, `<span class="num">${E2(T.mo)}</span>`] }] : []),
    ...(T.dep ? [{ t: "", c: ["Déplacement", "1", `<span class="num">${E2(T.dep)}</span>`, `<span class="num">${E2(T.dep)}</span>`] }] : []),
    ...pcs.map((p) => ({ t: "", c: [esc(p.designation), `${fmtNum(p.quantite, 2)} ${esc(p.unite || "")}`, `<span class="num">${E2(p.prix_unitaire_ht)}</span>`, `<span class="num">${E2(Number(p.quantite) * Number(p.prix_unitaire_ht))}</span>`] })),
  ], "Aucun temps ni pièce saisi.") + (T.ht ? `<div class="totaux"><div><span>Total HT</span><span class="num">${E2(T.ht)}</span></div><div><span>TVA ${fmtNum(i.taux_tva, 1)} %</span><span class="num">${E2(T.tva)}</span></div><div class="ttc"><span>Total TTC</span><span class="num">${E2(T.ttc)}</span></div></div>` : "");
  const sig = i.signature_data ? `<div class="pad"><img class="iv-sig" src="${i.signature_data}" alt="Signature du client"><p class="mut">Signé par ${esc(i.signataire || "le client")} le ${D(i.signe_at)}</p></div>` : `<div class="pad"><p class="mut">Pas encore signé.</p>${btn("Faire signer le client", "ivSign", id, "", i.statut === "Annulée" ? "o sm" : "sm")}</div>`;
  const html = page(`${esc(i.numero)} ${chip(i.statut)}`, esc(ivClient(i)) + (i.motif ? " · " + esc(i.motif) : ""), acts,
    `<div class="g2"><div>${card("Travaux réalisés", travaux, btn("Compléter", "ivWork", id, "", "o sm"))}${card("Temps passé et pièces utilisées", tp, btn("Modifier", "ivWork", id, "", "o sm"))}
      ${card("Photos avant", grid("avant"), photoBtn("avant"))}${card("Photos après", grid("apres"), photoBtn("apres"))}</div>
      <div>${card("Informations", info)}${card("Signature du client", sig)}</div></div>`, crumbs(["Bons d'intervention", "interventions"], [i.numero]));
  return { html, after: () => { $$("img[data-ivph]").forEach(async (im) => { try { im.src = (await q(sb.from("intervention_photos").select("data").eq("id", im.dataset.ivph).single())).data; } catch (e) { /* ignorée */ } }); } };
}

function ivForm(i, pre = {}) {
  const v0 = { ...pre, ...(i || {}) };
  modal(i ? "Modifier l'intervention" : "Nouvelle intervention", `<div class="frm">
    ${fld({ k: "client_id", l: "Client", t: "select", o: [{ v: "", l: "Choisir un client…" }, ...db.clients.map((x) => ({ v: x.id, l: x.nom }))], v: v0.client_id || "" })}
    ${fld({ k: "chantier_id", l: "Chantier (facultatif)", t: "select", o: [{ v: "", l: "Aucun" }, ...db.chantiers.map((x) => ({ v: x.id, l: x.nom }))], v: v0.chantier_id || "", r: 0 })}
    ${fld({ k: "motif", l: "Motif de l'intervention", v: v0.motif || "", ph: "Ex : Entretien annuel chaudière, dépannage fuite…", cls: "full" })}
    ${fld({ k: "salarie_id", l: "Technicien", t: "select", o: [{ v: "", l: "Non affecté" }, ...(db.sal || []).filter((s) => s.actif || s.id === v0.salarie_id).map((s) => ({ v: s.id, l: s.nom }))], v: v0.salarie_id || "", r: 0 })}
    ${fld({ k: "date_prevue", l: "Date", t: "date", v: v0.date_prevue || today() })}
    ${fld({ k: "heure", l: "Heure (facultatif)", t: "time", v: v0.heure || "", r: 0 })}
    ${fld({ k: "taux_horaire", l: "Taux horaire facturé HT (€/h)", t: "number", v: v0.taux_horaire ?? (Number(db.ent.taux_horaire_vente) || 55), r: 0 })}</div>`, {
    wide: true, submit: i ? "Enregistrer" : "Créer le bon",
    onSubmit: async (v, api) => {
      const row = { client_id: v.client_id, chantier_id: v.chantier_id || null, motif: v.motif.trim(), salarie_id: v.salarie_id || null, date_prevue: v.date_prevue, heure: v.heure || null, taux_horaire: parseNum(v.taux_horaire) };
      if (i) await q(sb.from("interventions").update(row).eq("id", i.id));
      else {
        Object.assign(row, { numero: ivNumero(), contrat_id: pre.contrat_id || null, visite_id: pre.visite_id || null });
        const nid = (await q(sb.from("interventions").insert(row).select("id").single())).id;
        if (pre.visite_id) await q(sb.from("contrat_visites").update({ intervention_id: nid }).eq("id", pre.visite_id));
        api.close(); await refresh(); toast(`Bon ${row.numero} créé.`, "ok"); return go("interventions/" + nid);
      }
      api.close(); await refresh();
    },
  });
}

function ivWorkForm(i) {
  const pcs = ivPieces(i).length ? ivPieces(i) : [{}];
  const row = (p = {}) => `<tr class="ivp"><td><input data-p="designation" value="${esc(p.designation || "")}" placeholder="Pièce ou fourniture" aria-label="Désignation"></td><td><input data-p="quantite" value="${esc(p.quantite ?? 1)}" inputmode="decimal" aria-label="Quantité"></td><td><input data-p="unite" value="${esc(p.unite || "u")}" aria-label="Unité"></td><td><input data-p="prix_unitaire_ht" value="${esc(p.prix_unitaire_ht ?? "")}" inputmode="decimal" placeholder="0,00" aria-label="Prix unitaire HT"></td><td><button type="button" class="rm" data-ivprm aria-label="Supprimer la ligne">${svg(ic.x)}</button></td></tr>`;
  modal("Travaux, temps et pièces", `<div class="frm">
    ${fld({ k: "description", l: "Travaux réalisés", t: "textarea", rows: 4, v: i.description || "", r: 0, cls: "full" })}
    ${fld({ k: "heures", l: "Temps passé (heures)", t: "number", v: i.heures || "", r: 0 })}
    ${fld({ k: "taux_horaire", l: "Taux horaire HT (€/h)", t: "number", v: i.taux_horaire || "", r: 0 })}
    ${fld({ k: "deplacement_ht", l: "Déplacement HT (€)", t: "number", v: i.deplacement_ht || "", r: 0 })}
    ${fld({ k: "taux_tva", l: "TVA (%)", t: "select", o: [20, 10, 5.5, 0].map((n) => ({ v: n, l: n + " %" })), v: i.taux_tva ?? 20 })}</div>
    <h3 class="sect">Pièces utilisées</h3><div class="tw"><table class="ivt"><thead><tr><th>Désignation</th><th>Qté</th><th>Unité</th><th>Prix HT</th><th></th></tr></thead><tbody id="ivpb">${pcs.map(row).join("")}</tbody></table></div>
    <button type="button" class="btn o sm" id="ivpadd">+ Ajouter une pièce</button>`, {
    wide: true, submit: "Enregistrer",
    onMount: (m) => {
      $("#ivpadd", m).onclick = () => { $("#ivpb", m).insertAdjacentHTML("beforeend", row()); $$('.ivp [data-p="designation"]', m).pop().focus(); };
      m.addEventListener("click", (e) => { const b = e.target.closest("[data-ivprm]"); if (b) { const tr = b.closest("tr"); if ($$(".ivp", m).length > 1) tr.remove(); else $$("input", tr).forEach((x) => (x.value = "")); } });
    },
    onSubmit: async (v, api) => {
      const pieces = $$(".ivp", api.el).map((tr) => Object.fromEntries($$("[data-p]", tr).map((x) => [x.dataset.p, x.value]))).filter((p) => p.designation.trim()).map((p) => ({ designation: p.designation.trim(), quantite: parseNum(p.quantite) || 1, unite: p.unite.trim() || "u", prix_unitaire_ht: parseNum(p.prix_unitaire_ht) }));
      await q(sb.from("interventions").update({ description: v.description || null, heures: parseNum(v.heures), taux_horaire: parseNum(v.taux_horaire), deplacement_ht: parseNum(v.deplacement_ht), taux_tva: parseNum(v.taux_tva), pieces: pieces }).eq("id", i.id));
      api.close(); await refresh();
    },
  });
}

// Pad de signature (souris, doigt ou stylet)
function sigPad(m, canvasId) {
  const c = $("#" + canvasId, m), dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
  c.width = w * dpr; c.height = h * dpr;
  const g = c.getContext("2d"); g.scale(dpr, dpr); g.lineWidth = 2.4; g.lineCap = "round"; g.strokeStyle = "#111";
  let draw = false, last = null; const st = { strokes: 0, c };
  const pos = (e) => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  c.onpointerdown = (e) => { draw = true; last = pos(e); c.setPointerCapture(e.pointerId); st.strokes++; g.beginPath(); g.moveTo(...last); g.lineTo(last[0] + 0.1, last[1] + 0.1); g.stroke(); e.preventDefault(); };
  c.onpointermove = (e) => { if (!draw) return; const p = pos(e); g.beginPath(); g.moveTo(...last); g.lineTo(...p); g.stroke(); last = p; e.preventDefault(); };
  c.onpointerup = c.onpointercancel = () => { draw = false; };
  st.clear = () => { g.clearRect(0, 0, w, h); st.strokes = 0; };
  st.png = () => { const o = document.createElement("canvas"); o.width = c.width; o.height = c.height; const x = o.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, o.width, o.height); x.drawImage(c, 0, 0); return o.toDataURL("image/png"); };
  return st;
}
function signForm(titre, nomDefaut, onSave) {
  let pad;
  modal(titre, `<div class="frm">${fld({ k: "signataire", l: "Nom du signataire", v: nomDefaut || "", cls: "full" })}</div><p class="mut">Signez dans le cadre ci-dessous.</p><canvas id="sigc" class="sigpad" aria-label="Zone de signature"></canvas><button type="button" class="btn o sm" id="sigclr">Effacer</button>`, {
    submit: "Enregistrer la signature",
    onMount: (m) => { pad = sigPad(m, "sigc"); $("#sigclr", m).onclick = () => pad.clear(); },
    onSubmit: async (v, api) => { if (!pad.strokes) throw new Error("La signature est vide : signez dans le cadre."); await onSave(v.signataire.trim(), pad.png()); api.close(); },
  });
}

async function ivPdfBytes(i) {
  await loadScript(LIBS.pdflib);
  const { PDFDocument, StandardFonts, rgb } = PDFLib, pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89, ML = 42, A = rgb(0.11, 0.3, 0.56), GREY = rgb(0.42, 0.45, 0.5), clean = (s) => String(s ?? "").replace(/[   ]/g, " ").replace(/[^\x20-\xff\n]/g, "");
  let page = pdf.addPage([W, H]), y = H - 50;
  const txt = (t, x, yy, o = {}) => { const f = o.f || font, sz = o.size || 9.5, s = clean(t), w = o.right ? f.widthOfTextAtSize(s, sz) : 0; page.drawText(s, { x: x - w, y: yy, size: sz, font: f, color: o.color || rgb(0.1, 0.1, 0.12) }); };
  const wrap = (t, f, sz, mw) => { const out = []; for (const para of clean(t).split("\n")) { let l = ""; for (const w of para.split(" ")) { const n = l ? l + " " + w : w; if (f.widthOfTextAtSize(n, sz) > mw && l) { out.push(l); l = w; } else l = n; } out.push(l); } return out; };
  const need = (h) => { if (y - h < 50) { page = pdf.addPage([W, H]); y = H - 50; } };
  const e = db.ent || {};
  page.drawRectangle({ x: 0, y: H - 5, width: W, height: 5, color: A });
  txt(e.nom || "Votre entreprise", ML, y, { size: 15, f: bold }); txt("BON D'INTERVENTION", W - ML, y, { size: 18, f: bold, color: A, right: true });
  txt([e.adresse, [e.telephone, e.email].filter(Boolean).join(" - ")].filter(Boolean).join("  |  "), ML, y - 15, { size: 8.5, color: GREY }); txt("N° " + (i.numero || ""), W - ML, y - 18, { size: 11, f: bold, right: true });
  y -= 48;
  const cl = byId(db.clients, i.client_id) || {}, ch = byId(db.chantiers, i.chantier_id);
  page.drawRectangle({ x: ML, y: y - 62, width: W - 2 * ML, height: 66, color: rgb(0.94, 0.95, 0.97) });
  txt("CLIENT", ML + 12, y - 10, { size: 7.5, f: bold, color: A }); txt(cl.nom || "", ML + 12, y - 25, { size: 11, f: bold }); txt([cl.adresse, cl.ville].filter(Boolean).join(", "), ML + 12, y - 39, { size: 9, color: GREY }); if (ch) txt("Chantier : " + ch.nom, ML + 12, y - 53, { size: 9, color: GREY });
  txt("DATE", 360, y - 10, { size: 7.5, f: bold, color: A }); txt(D(i.date_prevue) + (i.heure ? " " + i.heure : ""), 360, y - 25, { size: 11, f: bold }); txt("Technicien : " + ivTech(i), 360, y - 39, { size: 9, color: GREY });
  y -= 86;
  const sect = (t) => { need(40); txt(t.toUpperCase(), ML, y, { size: 8, f: bold, color: A }); page.drawLine({ start: { x: ML, y: y - 4 }, end: { x: W - ML, y: y - 4 }, thickness: 0.8, color: A }); y -= 18; };
  if (i.motif) { sect("Motif"); for (const l of wrap(i.motif, font, 10, W - 2 * ML)) { txt(l, ML, y); y -= 13; } y -= 8; }
  sect("Travaux réalisés");
  for (const l of wrap(i.description || "-", font, 10, W - 2 * ML)) { need(14); txt(l, ML, y); y -= 13; }
  y -= 10;
  const T = ivTotaux(i), lines = [...(Number(i.heures) ? [["Main d'oeuvre", `${fmtNum(i.heures, 2)} h`, i.taux_horaire, T.mo]] : []), ...(T.dep ? [["Déplacement", "1", T.dep, T.dep]] : []), ...ivPieces(i).map((p) => [p.designation, `${fmtNum(p.quantite, 2)} ${p.unite || ""}`, p.prix_unitaire_ht, Number(p.quantite) * Number(p.prix_unitaire_ht)])];
  if (lines.length) {
    sect("Temps passé et pièces");
    for (const [d, qt, pu, tt] of lines) { need(16); txt(d, ML, y); txt(qt, 360, y, { right: true }); txt(fmtNum(pu, 2), 440, y, { right: true }); txt(fmtNum(tt, 2), W - ML, y, { right: true, f: bold }); y -= 15; }
    y -= 6; need(60);
    txt("Total HT", 400, y, { color: GREY }); txt(E2(T.ht), W - ML, y, { right: true }); y -= 14; txt(`TVA ${fmtNum(i.taux_tva, 1)} %`, 400, y, { color: GREY }); txt(E2(T.tva), W - ML, y, { right: true }); y -= 8;
    page.drawRectangle({ x: 392, y: y - 22, width: W - ML - 392 + 6, height: 24, color: A }); txt("TOTAL TTC", 400, y - 14, { f: bold, color: rgb(1, 1, 1) }); txt(E2(T.ttc), W - ML - 4, y - 15, { f: bold, size: 11, color: rgb(1, 1, 1), right: true }); y -= 42;
  }
  const ph = (db.ivPhotos || []).filter((p) => p.intervention_id === i.id);
  if (ph.length) {
    sect("Photos");
    for (const phase of ["avant", "apres"]) {
      const l = ph.filter((p) => p.phase === phase); if (!l.length) continue;
      need(24); txt(phase === "avant" ? "Avant" : "Après", ML, y, { f: bold, size: 9 }); y -= 8; let x = ML;
      for (const p of l) {
        try {
          const d = (await q(sb.from("intervention_photos").select("data").eq("id", p.id).single())).data, bytes = Uint8Array.from(atob(d.split(",")[1]), (c) => c.charCodeAt(0));
          const im = d.startsWith("data:image/png") ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes), sc = Math.min(160 / im.width, 120 / im.height);
          if (x + im.width * sc > W - ML) { x = ML; y -= 128; } need(im.height * sc + 10);
          page.drawImage(im, { x, y: y - im.height * sc, width: im.width * sc, height: im.height * sc }); x += im.width * sc + 10;
        } catch (er) { /* photo ignorée */ }
      }
      y -= 130;
    }
  }
  need(130);
  txt("SIGNATURE DU CLIENT", ML, y, { size: 8, f: bold, color: A }); page.drawRectangle({ x: ML, y: y - 100, width: 240, height: 92, borderColor: GREY, borderWidth: 0.6 });
  if (i.signature_data) { try { const im = await pdf.embedPng(Uint8Array.from(atob(i.signature_data.split(",")[1]), (c) => c.charCodeAt(0))), sc = Math.min(224 / im.width, 78 / im.height); page.drawImage(im, { x: ML + 8, y: y - 94, width: im.width * sc, height: im.height * sc }); } catch (er) { /* ignorée */ } txt(`${i.signataire || ""} - ${D(i.signe_at)}`, ML + 252, y - 20, { size: 9, color: GREY }); }
  pdf.setTitle("Bon d'intervention " + (i.numero || ""));
  return await pdf.save();
}

const interventionsActions = {
  ivNew: () => guard() && ivForm(null),
  ivEdit: (id) => guard() && ivForm(byId(db.interv, id)),
  intervFromVisite: (id) => { if (!guard()) return; const v = (db.ctVisites || []).find((x) => x.id === id), c = byId(db.contrats, v?.contrat_id); if (!c) return; ivForm(null, { client_id: c.client_id, chantier_id: c.chantier_id, contrat_id: c.id, visite_id: v.id, date_prevue: v.date_prevue, motif: `Visite d'entretien - ${c.libelle}` }); },
  ivWork: (id) => guard() && ivWorkForm(byId(db.interv, id)),
  ivStatut: async (id, arg) => { if (!guard()) return; await q(sb.from("interventions").update({ statut: arg }).eq("id", id)); await refresh(); },
  ivTerminer: async (id) => {
    if (!guard()) return;
    const i = byId(db.interv, id);
    if (!i.description && !Number(i.heures) && !confirm("Aucun travail ni temps n'est renseigné. Terminer quand même ?")) return;
    await q(sb.from("interventions").update({ statut: "Terminée" }).eq("id", id));
    if (i.visite_id) await q(sb.from("contrat_visites").update({ statut: "Réalisée", date_realisee: today() }).eq("id", i.visite_id));
    await refresh(); toast(i.signature_data ? "Intervention terminée." : "Intervention terminée. Pensez à faire signer le client.", "ok");
  },
  ivSign: (id) => { if (!guard()) return; const i = byId(db.interv, id); signForm("Signature du client", i.signataire || ivClient(i), async (nom, png) => { await q(sb.from("interventions").update({ signataire: nom, signature_data: png, signe_at: new Date().toISOString() }).eq("id", id)); await refresh(); toast("Signature enregistrée.", "ok"); }); },
  ivDel: async (id) => { if (!guard() || !confirm("Supprimer ce bon d'intervention et ses photos ?")) return; await q(sb.from("interventions").delete().eq("id", id)); await refresh(); go("interventions"); },
  ivPhotoDel: async (id) => { if (!guard() || !confirm("Supprimer cette photo ?")) return; await q(sb.from("intervention_photos").delete().eq("id", id)); await refresh(); },
  ivPdf: async (id) => {
    try { const b = await ivPdfBytes(byId(db.interv, id)), u = URL.createObjectURL(new Blob([b], { type: "application/pdf" })), a = document.createElement("a"); a.href = u; a.download = `${byId(db.interv, id).numero}.pdf`; a.click(); setTimeout(() => URL.revokeObjectURL(u), 4000); }
    catch (e) { toast(esc(friendly(e)), "dn"); }
  },
  ivFacturer: async (id) => {
    if (!guard()) return;
    const i = byId(db.interv, id), T = ivTotaux(i);
    if (i.facture_id) return go("factures/" + i.facture_id);
    if (!T.ht) return toast("Renseignez d'abord le temps passé, le déplacement ou des pièces.", "dn");
    if (!confirm(`Créer la facture (brouillon) de ${E2(T.ht)} HT depuis ${i.numero} ?`)) return;
    const L = (designation, quantite, unite, pu, description = "") => ({ categorie: "", nature: "normale", ref_facture_id: null, designation, description, quantite, unite, prix_unitaire_ht: pu, taux_tva: Number(i.taux_tva) });
    const lignes = [...(Number(i.heures) ? [L(`Main d'œuvre${i.motif ? " - " + i.motif : ""}`, Number(i.heures), "h", Number(i.taux_horaire), `Intervention ${i.numero} du ${D(i.date_prevue)}`)] : []), ...(T.dep ? [L("Déplacement", 1, "forfait", T.dep)] : []), ...ivPieces(i).map((p) => L(p.designation, Number(p.quantite), p.unite || "u", Number(p.prix_unitaire_ht)))];
    const fid = await q(sb.rpc("sauver_document", { p_kind: "facture", p: { id: null, client_id: i.client_id, chantier_id: i.chantier_id || null, date: today(), echeance: addDays(today(), Number(db.ent.delai_paiement_jours) || 30), notes: `Intervention ${i.numero} du ${D(i.date_prevue)}${i.description ? " : " + i.description.slice(0, 300) : ""}`, lignes } }));
    await q(sb.from("interventions").update({ facture_id: fid, statut: "Facturée" }).eq("id", id));
    await refresh(); toast("Facture créée en brouillon. Vérifiez-la puis émettez-la.", "ok"); go("factures/" + fid);
  },
};
// Ajout de photos (input fichier caché dans la fiche)
document.addEventListener("change", async (e) => {
  const inp = e.target.closest?.("[data-ivfile]"); if (!inp || !inp.files.length) return;
  const id = parseHash().arg, phase = inp.dataset.ivfile;
  try { for (const f of [...inp.files]) await q(sb.from("intervention_photos").insert({ intervention_id: id, phase, data: await ivCompress(f) })); await refresh(); toast("Photo ajoutée.", "ok"); }
  catch (er) { toast(esc(friendly(er)), "dn"); }
});
