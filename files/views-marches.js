/* Appels d'offres et marchés complexes (v14) :
   import / export de bordereaux DPGF, DQE, BPU (Excel) en conservant leur structure, lots, sous-lots, tranches fermes et conditionnelles,
   axes analytiques personnalisés (type de marché, équipe, conducteur, activité, agence…). */

const MK_FMT = ["DPGF", "DQE", "BPU"];
const MK_FMT_L = { DPGF: "DPGF : décomposition du prix global et forfaitaire", DQE: "DQE : détail quantitatif estimatif", BPU: "BPU : bordereau des prix unitaires" };
const mkOff = (l) => !!(l && l.tranche_cond && !l.tranche_ok);
const mkCat = (l) => String(l.categorie || "").replace(/\u200B/g, "").trim();
const mkKey = (l) => [String(l.categorie || "").trim(), l.lot || "", l.sous_lot || "", l.tranche || "", l.tranche_cond ? 1 : 0].join("\u0001");
const mkLabel = (l) => [l.lot, l.sous_lot, mkCat(l)].filter(Boolean).join(" › ");
const mkExt = (l) => ({ lot: l.lot || null, sous_lot: l.sous_lot || null, tranche: l.tranche || null, tranche_cond: !!l.tranche_cond, tranche_ok: !!l.tranche_cond && !!l.tranche_ok, marche_ref: l.marche_ref || null });
const mkLht = (l) => r2(Number(l.quantite) * Number(l.prix_unitaire_ht));
const mkXlsx = async () => { await loadScript(LIBS.xlsx); return window.XLSX; };
const colLetter = (n) => { let s = ""; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const mkNorm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9°.\/ ]+/g, " ").replace(/\s+/g, " ").trim();
const mkNum = (v) => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const t = String(v).replace(/[\s €]/g, "").replace(",", ".");
  return /^-?\d+(\.\d+)?$/.test(t) ? parseFloat(t) : null;
};

/* ---------- Chargement ---------- */
async function loadV14() {
  const t = await sb.from("marche_imports").select("id").limit(1);
  if (t.error) throw t.error;
  const [mi, ax, av, pf, mr, iv, ai, at, de, dg, dv] = await Promise.all([
    q(sb.from("marche_imports").select("*")), q(sb.from("axes").select("*").order("nom")), q(sb.from("axe_valeurs").select("*")),
    q(sb.from("proformas").select("*").order("created_at", { ascending: false })), q(sb.from("marche_revisions").select("*")), q(sb.from("indices_valeurs").select("*").order("mois")),
    q(sb.from("aides").select("*").order("created_at")), q(sb.from("attestations_tva").select("*").order("created_at", { ascending: false })),
    q(sb.from("dechets").select("*").order("date_enlevement", { ascending: false })), q(sb.from("dgd").select("*").order("created_at", { ascending: false })),
    q(sb.from("devis").select("id,parent_id")),
  ]);
  pf.forEach((x) => nz(x, ["pct", "montant_ht", "montant_ttc"]));
  mr.forEach((x) => nz(x, ["i0_valeur", "part_fixe"]));
  iv.forEach((x) => nz(x, ["valeur"]));
  ai.forEach((x) => nz(x, ["montant"]));
  de.forEach((x) => nz(x, ["quantite", "cout_ht"]));
  Object.assign(db, { mimp: mi, axes: ax, axv: av, pfs: pf, mrev: mr, ivals: iv, aides: ai, atts: at, dech: de, dgds: dg, avn: Object.fromEntries(dv.filter((x) => x.parent_id).map((x) => [x.id, x.parent_id])), v14: true, v14err: "" });
}
const setupV14 = (what = "cette fonction") => `<p class="emp" style="padding:18px;margin:0;color:var(--mut)">Pour activer ${what}, exécutez <b>migration_v14.sql</b> dans Supabase (SQL Editor), puis rechargez la page.${db.v14err ? `<br><br>Erreur renvoyée par Supabase : <code>${esc(db.v14err)}</code>` : ""}</p>`;

/* ---------- Lots, sous-lots, tranches dans l'éditeur de devis ---------- */
function mkCatFields(g = {}) {
  if (!db.v14) return "";
  return `<div class="cat-x"><label class="cx-f">Lot<input type="text" data-f="lot" value="${esc(g.lot || "")}" placeholder="Ex : Lot 02 Gros œuvre"></label>
    <label class="cx-f">Sous-lot<input type="text" data-f="slot" value="${esc(g.sous_lot || "")}" placeholder="Ex : 2.1 Maçonnerie"></label>
    <label class="cx-f">Tranche<input type="text" data-f="tr" value="${esc(g.tranche || "")}" placeholder="Ex : Tranche 1"></label>
    <label class="cx-f">Type de tranche<select data-f="trc"><option value="">Ferme</option><option value="1"${g.tranche_cond ? " selected" : ""}>Conditionnelle</option></select></label>
    <input type="hidden" data-f="trok" value="${g.tranche_ok ? 1 : ""}"></div>`;
}
function mkReadCat(sec) {
  const g = (k) => $(`[data-f="${k}"]`, sec);
  if (!g("lot")) return {};
  const cond = g("trc").value === "1";
  return { lot: g("lot").value.trim(), sous_lot: g("slot").value.trim(), tranche: g("tr").value.trim(), tranche_cond: cond, tranche_ok: cond && g("trok").value === "1" };
}
const mkReadLine = (tr) => ({ marche_ref: tr.dataset.mref || null });

/* ---------- Structure d'un marché : montants par lot, sous-lot, chapitre et tranche ---------- */
function mkStruct(lignes) {
  const ls = lignes.filter((l) => l.type_ligne !== "image" && !(l.est_option && !l.option_choisie) && (l.designation || Number(l.prix_unitaire_ht)));
  const groups = [];
  for (const l of ls) {
    const k = mkKey(l);
    let g = groups.find((x) => x.k === k);
    if (!g) groups.push((g = { k, lot: l.lot || "", sous: l.sous_lot || "", cat: mkCat(l), tranche: l.tranche || "", cond: !!l.tranche_cond, ok: !!l.tranche_ok, ht: 0, n: 0 }));
    g.ht = r2(g.ht + mkLht(l)); g.n++;
  }
  const tr = {};
  for (const g of groups) { const k = g.tranche || (g.cond ? "Tranche conditionnelle" : "Tranche ferme"); (tr[k] ||= { nom: k, cond: g.cond, ok: g.ok, ht: 0 }).ht = r2(tr[k].ht + g.ht); }
  const ferme = r2(sum(groups.filter((g) => !mkOff(g)), (g) => g.ht)), cond = r2(sum(groups.filter((g) => mkOff(g)), (g) => g.ht));
  return { groups, tranches: Object.values(tr), ferme, cond, lots: new Set(groups.map((g) => g.lot).filter(Boolean)).size, any: groups.some((g) => g.lot || g.sous || g.tranche || g.cond) };
}
function mkStructCard(d, lignes) {
  if (!db.v14) return "";
  const s = mkStruct(lignes);
  if (!s.any) return "";
  const rows = s.groups.map((g) => `<tr><td>${[g.lot, g.sous, g.cat].filter(Boolean).map(esc).join(" › ") || "-"}${g.tranche || g.cond ? `<small>${esc(g.tranche || "Tranche")} · ${g.cond ? (g.ok ? "conditionnelle affermie" : "conditionnelle") : "ferme"}</small>` : ""}</td><td class="r"><span class="num${mkOff(g) ? " mut" : ""}">${E2(g.ht)}</span></td></tr>`).join("");
  const trs = s.tranches.filter((t) => t.cond).map((t) => `<div class="row"><div><b>${esc(t.nom)}</b><small>${E2(t.ht)} HT · ${t.ok ? "affermie : comprise dans le total" : "non affermie : hors total"}</small></div>${d.statut !== "Refusé" ? btn(t.ok ? "Désaffermir" : "Affermir", "mkAffermir", d.id, t.nom, "o sm w") : ""}</div>`).join("");
  return card("Lots et tranches", `<div class="tw"><table><tbody>${rows}</tbody></table></div>
    <dl class="kv"><dt>Total ferme</dt><dd><b>${E2(s.ferme)}</b> HT</dd>${s.cond ? `<dt>Conditionnelles</dt><dd>${E2(s.cond)} HT non affermies</dd>` : ""}</dl>${trs}
    ${s.cond ? `<p class="note">Une tranche conditionnelle n'est comptée dans le total du devis, des situations et de la facture qu'une fois affermie. Renvoyez le devis au client si les montants changent.</p>` : ""}`);
}

/* ---------- Import d'un bordereau Excel ---------- */
function mkSheetRows(X, ws) {
  if (!ws || !ws["!ref"]) return { rows: [], r0: 0, c0: 0 };
  const rg = X.utils.decode_range(ws["!ref"]);
  return { rows: X.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true }), r0: rg.s.r, c0: rg.s.c };
}
function mkDetect(rows) {
  const RE = { code: /^(n°?|no|num|numero|code|ref|reference|art|article|poste|item|n° prix|n° art)\b/, des: /designation|libelle|description|intitule|nature (des )?(ouvrages|travaux|prestations)|^prestation/, uni: /^(u|un|unite|unites|u\.)$|^unite/, qte: /quant|^qte|^qt$|^q$/, pu: /prix unit|^p\.?u\b|unitaire|prix ht$|^prix$/, tot: /total|montant/ };
  for (let i = 0; i < Math.min(rows.length, 60); i++) {
    const h = (rows[i] || []).map(mkNorm);
    const f = (re, skip = []) => h.findIndex((x, j) => x && re.test(x) && !skip.includes(j));
    const des = f(RE.des);
    if (des < 0) continue;
    const pu = f(RE.pu, [des]), qte = f(RE.qte, [des, pu]), tot = f(RE.tot, [des, pu, qte]), uni = f(RE.uni, [des, pu, qte, tot]), code = f(RE.code, [des, pu, qte, tot, uni]);
    if (pu < 0 && qte < 0) continue;
    const label = h.join(" ");
    const fmt = qte < 0 ? "BPU" : /estimat/.test(label) ? "DQE" : "DPGF";
    return { hi: i, map: { code, des, uni, qte, pu, tot }, fmt };
  }
  return null;
}
function mkParseRows(rows, hi, m, r0, tva) {
  const out = [], stack = [];
  let tranche = "", cond = false, titres = 0;
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i] || [], g = (k) => (k >= 0 ? r[k] : null);
    const des = String(g(m.des) ?? "").trim(), code = String(g(m.code) ?? "").trim();
    if (!des && !code) continue;
    const label = des || code, uni = String(g(m.uni) ?? "").trim(), q = mkNum(g(m.qte)), pu = mkNum(g(m.pu));
    const isLine = !!uni || (q !== null && q !== 0) || (pu !== null && pu !== 0);
    const nl = mkNorm(label);
    if (!isLine) {
      if (/^(sous[- ]?total|total|montant|tva|report|net a payer|recapitulatif)\b/.test(nl)) continue;
      const tm = /tranche\s+(ferme|conditionnelle|optionnelle)(?:\s*(?:n°?|no)?\s*(\d+))?/i.exec(label);
      if (tm) { cond = !/ferme/i.test(tm[1]); tranche = label.replace(/\s+/g, " ").slice(0, 80); titres++; continue; }
      const cm = /^\d+(?:\.\d+)*\.?$/.test(code) ? code.replace(/\.$/, "").split(".").length : 0;
      const lotlike = /^lot\b/i.test(label);
      const hasLot = !!stack[0]?.lot;
      const depth = cm || (lotlike ? 1 : hasLot ? 2 : 1);
      stack.length = Math.min(stack.length, depth - 1);
      stack[depth - 1] = { t: (code && !lotlike && cm ? code + " " : "") + label, lot: lotlike };
      titres++;
      continue;
    }
    const titles = stack.filter(Boolean).map((x) => x.t);
    let lot = "", sous = "", cat = "";
    if (titles.length === 1) { if (stack[0]?.lot) lot = titles[0]; else cat = titles[0]; }
    else if (titles.length === 2) { lot = titles[0]; cat = titles[1]; }
    else if (titles.length >= 3) { lot = titles[0]; sous = titles[1]; cat = titles.slice(2).join(" / "); }
    out.push({ designation: label.slice(0, 300), description: code && des ? "Réf. " + code : "", quantite: q === null || q === 0 ? 1 : q, unite: uni || "u", prix_unitaire_ht: pu ?? 0, taux_tva: tva,
      categorie: cat, lot, sous_lot: sous, tranche, tranche_cond: cond, tranche_ok: false, marche_ref: String(r0 + i + 1) });
  }
  return { lignes: out, titres };
}

function mkImport() {
  if (!guard()) return;
  if (!db.v14) return toast("Exécutez d'abord migration_v14.sql dans Supabase.", "dn");
  const S = { X: null, wb: null, file: null, sheet: "", rows: [], r0: 0, c0: 0, hi: -1, map: null, fmt: "DPGF", parsed: null };
  const tva = Number(db.ent.taux_tva_defaut) || 20;
  const body = `<p class="mut" style="margin:0 0 12px">Importez le bordereau de l'appel d'offres (Excel .xlsx ou .xls). Pilot reconnaît les colonnes, les lots, les chapitres et les tranches, crée un devis en brouillon et garde le fichier d'origine pour le réexporter chiffré, dans la même mise en page.</p>
    <div class="frm"><div class="full"><div class="drop"><div><b>Bordereau Excel</b><small style="display:block" class="mut">DPGF, DQE ou BPU</small></div><input type="file" id="mkfile" accept=".xlsx,.xls,.xlsm,.ods" hidden><button type="button" class="btn" id="mkpick">Choisir le fichier</button></div></div>
    <div class="full" id="mkprev"></div>
    ${clientBlock("")}
    ${fld({ k: "chantier_id", l: "Chantier", t: "select", o: [{ v: "", l: "Sans chantier" }, ...db.chantiers.map((c) => ({ v: c.id, l: c.nom }))], v: "", r: 0 })}</div>`;
  const colOpts = (sel) => { const h = S.rows[S.hi] || []; const n = Math.max(h.length, ...S.rows.slice(S.hi + 1, S.hi + 30).map((r) => (r || []).length), 1);
    return `<option value="-1">- non utilisée -</option>` + Array.from({ length: n }, (_, j) => `<option value="${j}"${sel === j ? " selected" : ""}>${colLetter(S.c0 + j)}${h[j] ? " · " + esc(String(h[j]).slice(0, 30)) : ""}</option>`).join(""); };
  const api = modal("Importer un DPGF / DQE / BPU", body, {
    wide: true, xl: true, submit: "Créer le devis", noFocus: true,
    onMount: (m) => {
      const prev = $("#mkprev", m), inp = $("#mkfile", m);
      $("#mkpick", m).onclick = () => inp.click();
      bindClientBlock(m);
      const reparse = () => {
        S.parsed = S.hi >= 0 && S.map && S.map.des >= 0 ? mkParseRows(S.rows, S.hi, S.map, S.r0, tva) : null;
        const n = S.parsed ? S.parsed.lignes.length : 0, lots = S.parsed ? new Set(S.parsed.lignes.map((l) => l.lot).filter(Boolean)).size : 0, trs = S.parsed ? new Set(S.parsed.lignes.map((l) => l.tranche).filter(Boolean)).size : 0;
        const priced = S.parsed ? S.parsed.lignes.filter((l) => l.prix_unitaire_ht > 0).length : 0;
        const el = $("#mksum", m);
        if (el) el.innerHTML = S.parsed ? `<b>${n} ligne${n > 1 ? "s" : ""}</b> à chiffrer · ${S.parsed.titres} titre${S.parsed.titres > 1 ? "s" : ""}, ${lots} lot${lots > 1 ? "s" : ""}${trs ? `, ${trs} tranche${trs > 1 ? "s" : ""}` : ""}${priced ? ` · ${priced} prix déjà renseigné${priced > 1 ? "s" : ""}` : ""}` : `<span class="badge-warn">Colonne « Désignation » non reconnue : choisissez-la ci-dessus.</span>`;
      };
      const draw = () => {
        const sheets = S.wb.SheetNames;
        const maps = [["des", "Désignation"], ["code", "N° / code"], ["uni", "Unité"], ["qte", "Quantité"], ["pu", "Prix unitaire"], ["tot", "Total"]];
        prev.innerHTML = `<div class="bkprev"><div class="frm3">
          <label class="fl"><span>Feuille</span><select id="mksh">${sheets.map((s) => `<option${s === S.sheet ? " selected" : ""}>${esc(s)}</option>`).join("")}</select></label>
          <label class="fl"><span>Format</span><select id="mkfmt">${MK_FMT.map((f) => `<option value="${f}"${f === S.fmt ? " selected" : ""}>${f}</option>`).join("")}</select></label>
          <label class="fl"><span>Ligne des en-têtes</span><input type="text" id="mkhi" inputmode="numeric" value="${S.hi >= 0 ? S.r0 + S.hi + 1 : ""}"></label>
          ${maps.map(([k, l]) => `<label class="fl"><span>${l}</span><select data-mk="${k}">${colOpts(S.map ? S.map[k] : -1)}</select></label>`).join("")}</div>
          <p style="margin:10px 0 0" id="mksum"></p></div>`;
        reparse();
      };
      const loadSheet = (name) => {
        S.sheet = name;
        const sr = mkSheetRows(S.X, S.wb.Sheets[name]);
        Object.assign(S, sr);
        const det = mkDetect(S.rows);
        S.hi = det ? det.hi : -1; S.map = det ? det.map : { code: -1, des: -1, uni: -1, qte: -1, pu: -1, tot: -1 };
        if (det) S.fmt = det.fmt;
      };
      inp.onchange = async () => {
        const f = inp.files[0];
        if (!f) return;
        prev.innerHTML = `<span class="mut">Lecture de ${esc(f.name)}…</span>`;
        try {
          if (f.size > 25 * 1024 * 1024) throw new Error("Fichier trop volumineux (25 Mo maximum).");
          S.X = await mkXlsx(); S.file = f;
          S.wb = S.X.read(new Uint8Array(await f.arrayBuffer()), { type: "array", cellFormula: true, cellStyles: true });
          const best = S.wb.SheetNames.find((n) => mkDetect(mkSheetRows(S.X, S.wb.Sheets[n]).rows)) || S.wb.SheetNames[0];
          loadSheet(best); draw();
        } catch (e) { S.wb = null; prev.innerHTML = `<span class="badge-warn">${esc(friendly(e))}</span>`; }
      };
      m.addEventListener("change", (e) => {
        const t = e.target;
        if (!S.wb) return;
        if (t.id === "mksh") { loadSheet(t.value); draw(); }
        else if (t.id === "mkfmt") S.fmt = t.value;
        else if (t.id === "mkhi") { const n = parseInt(t.value) - S.r0 - 1; if (n >= 0 && n < S.rows.length) { S.hi = n; const det = mkDetect(S.rows.slice(n)); if (det && det.hi === 0) S.map = det.map; } draw(); }
        else if (t.dataset?.mk) { S.map[t.dataset.mk] = parseInt(t.value); reparse(); }
      });
    },
    onSubmit: async (v, api) => {
      if (!S.wb) throw new Error("Choisissez d'abord un fichier.");
      if (!S.parsed || !S.parsed.lignes.length) throw new Error("Aucune ligne exploitable : vérifiez la ligne des en-têtes et les colonnes.");
      if (S.map.pu < 0) throw new Error("Indiquez la colonne du prix unitaire : Pilot y écrira vos prix à l'export.");
      const ls = S.parsed.lignes, cid = await resolveClient(v);
      const id = await q(sb.rpc("sauver_document", { p_kind: "devis", p: { id: null, client_id: cid, chantier_id: v.chantier_id || null, date: today(), notes: `Marché importé (${S.fmt}) : ${S.file.name}`, validite_jours: 30, lignes: ls } }));
      await saveCats("devis", id, ls);
      const path = await uploadDoc(S.file, "marches");
      await q(sb.from("marche_imports").insert({ devis_id: id, format: S.fmt, nom_fichier: S.file.name, fichier_path: path, feuille: S.sheet, col_qte: S.map.qte >= 0 ? S.c0 + S.map.qte : null, col_pu: S.c0 + S.map.pu, col_tot: S.map.tot >= 0 ? S.c0 + S.map.tot : null }));
      api.close(); toast(`${ls.length} lignes importées en brouillon : chiffrez-les, puis exportez le fichier.`, "ok");
      await refresh(); go("devis/" + id);
    },
  });
}

/* ---------- Export ---------- */
const MK_U = ["zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize", "dix-sept", "dix-huit", "dix-neuf"];
const MK_D = ["", "", "vingt", "trente", "quarante", "cinquante", "soixante"];
function mkLettres(n) {
  n = Math.floor(n);
  if (n < 20) return MK_U[n];
  if (n < 70) { const d = Math.floor(n / 10), u = n % 10; return MK_D[d] + (u === 1 ? " et un" : u ? "-" + MK_U[u] : ""); }
  if (n < 80) return "soixante" + (n === 71 ? " et " : "-") + MK_U[n - 60];
  if (n < 100) return n === 80 ? "quatre-vingts" : "quatre-vingt-" + MK_U[n - 80];
  if (n < 1000) { const c = Math.floor(n / 100), r = n % 100; return (c === 1 ? "cent" : MK_U[c] + " cent" + (r ? "" : "s")) + (r ? " " + mkLettres(r) : ""); }
  if (n < 1000000) { const k = Math.floor(n / 1000), r = n % 1000; return (k === 1 ? "mille" : mkLettres(k) + " mille") + (r ? " " + mkLettres(r) : ""); }
  return String(n);
}
const mkEurosLettres = (v) => { const e = Math.floor(v + 1e-9), c = Math.round((v - e) * 100); return `${mkLettres(e)} euro${e > 1 ? "s" : ""}${c ? " et " + mkLettres(c) + " centime" + (c > 1 ? "s" : "") : ""}`; };

async function mkExport(did, mode) {
  const d = byId(db.devis, did), lignes = await lignesOf("devis", did), X = await mkXlsx();
  const imp = (db.mimp || []).find((x) => x.devis_id === did);
  const base = slug(d.numero || "devis");
  const real = lignes.filter((l) => l.type_ligne !== "image");
  const unpriced = real.filter((l) => !(Number(l.prix_unitaire_ht) > 0)).length;
  let wb, name;
  if (mode === "source") {
    if (!imp) throw new Error("Ce devis ne vient pas d'un bordereau importé.");
    const bytes = await getAsset(imp.fichier_path);
    wb = X.read(bytes, { type: "array", cellFormula: true, cellStyles: true, cellNF: true });
    const ws = wb.Sheets[imp.feuille];
    if (!ws) throw new Error("La feuille « " + imp.feuille + " » n'existe plus dans le fichier d'origine.");
    const setNum = (r, c, val, force) => {
      const a = X.utils.encode_cell({ r: r - 1, c }), old = ws[a];
      if (old && old.f && !force) return;
      if (old) { old.t = "n"; old.v = val; delete old.w; if (force) delete old.f; } else ws[a] = { t: "n", v: val };
      const rg = X.utils.decode_range(ws["!ref"]); if (r - 1 > rg.e.r) rg.e.r = r - 1; if (c > rg.e.c) rg.e.c = c; ws["!ref"] = X.utils.encode_range(rg);
    };
    for (const l of real) {
      const r = parseInt(l.marche_ref);
      if (!r) continue;
      if (imp.col_qte !== null && imp.col_qte !== undefined) setNum(r, imp.col_qte, Number(l.quantite));
      setNum(r, imp.col_pu, Number(l.prix_unitaire_ht), true);
      if (imp.col_tot !== null && imp.col_tot !== undefined) setNum(r, imp.col_tot, mkLht(l));
    }
    wb.Workbook = wb.Workbook || {}; wb.Workbook.CalcPr = { fullCalcOnLoad: true };
    name = `${base}-${imp.format}-chiffre.xlsx`;
  } else {
    const fmt = mode, aoa = [];
    const st = mkStruct(lignes), ent = db.ent || {};
    aoa.push([`${fmt} : ${d.numero || "devis"}`], [`${ent.nom || ""} · ${d.client_nom || ""}${d.chantier_nom ? " · " + d.chantier_nom : ""}`], []);
    aoa.push(fmt === "BPU" ? ["N°", "Désignation", "Unité", "Prix unitaire HT (€)", "Prix unitaire HT en lettres"] : ["N°", "Désignation", "Unité", fmt === "DQE" ? "Quantité estimative" : "Quantité", "Prix unitaire HT (€)", fmt === "DQE" ? "Montant HT (€)" : "Total HT (€)"]);
    const groups = [];
    for (const l of real) { const k = mkKey(l); let g = groups[groups.length - 1]; if (!g || g.k !== k) groups.push((g = { k, l, items: [] })); g.items.push(l); }
    let tot = 0;
    groups.forEach((g, gi) => {
      const lab = [mkLabel(g.l) || "Travaux", g.l.tranche ? `[${g.l.tranche}${g.l.tranche_cond ? ", conditionnelle" : ""}]` : g.l.tranche_cond ? "[tranche conditionnelle]" : ""].filter(Boolean).join(" ");
      aoa.push([String(gi + 1), lab]);
      let sub = 0;
      g.items.forEach((l, li) => {
        const ht = mkLht(l); if (!mkOff(l)) sub += ht;
        aoa.push(fmt === "BPU" ? [`${gi + 1}.${li + 1}`, l.designation, l.unite, Number(l.prix_unitaire_ht), mkEurosLettres(Number(l.prix_unitaire_ht))]
          : [`${gi + 1}.${li + 1}`, l.designation, l.unite, Number(l.quantite), Number(l.prix_unitaire_ht), ht]);
      });
      if (fmt !== "BPU") aoa.push(["", `Sous-total ${lab}`, "", "", "", r2(sub)]);
      tot += sub;
    });
    if (fmt !== "BPU") { const tvaT = sum(real.filter((l) => !mkOff(l) && !(l.est_option && !l.option_choisie)), (l) => r2((mkLht(l) * Number(l.taux_tva)) / 100)); aoa.push([], ["", "Total HT", "", "", "", r2(tot)], ["", "TVA", "", "", "", r2(tvaT)], ["", "Total TTC", "", "", "", r2(tot + tvaT)]); }
    const ws = X.utils.aoa_to_sheet(aoa);
    ws["!cols"] = fmt === "BPU" ? [{ wch: 8 }, { wch: 60 }, { wch: 8 }, { wch: 18 }, { wch: 50 }] : [{ wch: 8 }, { wch: 60 }, { wch: 8 }, { wch: 14 }, { wch: 18 }, { wch: 16 }];
    wb = X.utils.book_new(); X.utils.book_append_sheet(wb, ws, fmt);
    name = `${base}-${fmt}.xlsx`;
  }
  const out = X.write(wb, { bookType: "xlsx", type: "array", cellStyles: true });
  downloadBlob(name, new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  toast(unpriced ? `Fichier exporté. ${unpriced} ligne${unpriced > 1 ? "s" : ""} sans prix : à chiffrer avant de répondre à l'appel d'offres.` : "Fichier exporté.", unpriced ? "" : "ok");
}
function mkBordereauCard(d) {
  if (!db.v14) return "";
  const imp = (db.mimp || []).find((x) => x.devis_id === d.id);
  return card("Bordereau (DPGF / DQE / BPU)", `${imp ? `<dl class="kv"><dt>Fichier d'origine</dt><dd>${esc(imp.nom_fichier || "")} <span class="chip ac">${imp.format}</span></dd></dl>` : `<p class="mut" style="margin:0;padding:16px 18px 6px">Exportez ce devis en bordereau Excel, ou importez un bordereau d'appel d'offres depuis la page Marchés.</p>`}
    <div class="cb" style="display:flex;gap:8px;flex-wrap:wrap">${imp ? btn("Réexporter dans le fichier d'origine", "mkExport", d.id, "source", "sm") : ""}${MK_FMT.map((f) => btn("Exporter " + f, "mkExport", d.id, f, "o sm")).join("")}</div>`);
}

/* ---------- Axes analytiques ---------- */
const axVal = (ent, id, axeId) => (db.axv || []).find((x) => x.entite === ent && x.entite_id === id && x.axe_id === axeId)?.valeur || "";
function axesCard(ent, id) {
  if (!db.v14) return "";
  if (!db.axes.length) return card("Axes analytiques", `<p class="mut" style="margin:0;padding:16px 18px">Aucun axe défini (type de marché, équipe, conducteur, agence…).</p>`, btn("Créer des axes", "go", "marches", "", "o sm"));
  return card("Axes analytiques", `<dl class="kv">${db.axes.map((a) => { const cur = axVal(ent, id, a.id), vals = [...new Set([...(a.valeurs || []), ...(cur ? [cur] : [])])];
    return `<dt>${esc(a.nom)}</dt><dd><select data-chg="axSet" data-ent="${ent}" data-eid="${id}" data-axe="${a.id}"${ro ? " disabled" : ""}><option value="">-</option>${vals.map((x) => `<option${x === cur ? " selected" : ""}>${esc(x)}</option>`).join("")}</select></dd>`; }).join("")}</dl>`);
}
const AX_TYPES = { "Type de marché": ["Public", "Privé", "Bailleur social", "Particulier"], "Activité": ["Rénovation", "Neuf", "Maintenance", "Aménagement"], "Équipe": [], "Conducteur de travaux": [], "Agence": [] };
function axeForm(a) {
  if (!guard()) return;
  modal(a ? "Modifier l'axe" : "Nouvel axe analytique", `<div class="frm">${fld({ k: "nom", l: "Nom de l'axe", v: a?.nom || "", cls: "full", hint: "Ex : Type de marché, Équipe, Conducteur de travaux, Activité, Agence." })}
    ${fld({ k: "valeurs", l: "Valeurs possibles (séparées par des virgules)", v: (a?.valeurs || []).join(", "), r: 0, cls: "full" })}</div>`, {
    extra: a ? `<button type="button" class="lk" style="color:var(--dn)" id="axdel">Supprimer l'axe</button>` : "",
    onMount: (m, api) => { $("#axdel", m)?.addEventListener("click", async () => { if (!confirm("Supprimer cet axe et ses étiquettes ?")) return; await q(sb.from("axes").delete().eq("id", a.id)); api.close(); await refresh(); }); },
    onSubmit: async (v, api) => {
      const row = { nom: v.nom.trim(), valeurs: [...new Set(String(v.valeurs || "").split(/[,;\n]/).map((x) => x.trim()).filter(Boolean))] };
      if (a) await q(sb.from("axes").update(row).eq("id", a.id)); else await q(sb.from("axes").insert(row));
      api.close(); toast("Axe enregistré.", "ok"); await refresh();
    },
  });
}
function axesTab() {
  const axes = db.axes, cur = ST.axC && byId(axes, ST.axC) ? ST.axC : axes[0]?.id, ax = cur ? byId(axes, cur) : null;
  const list = card("Axes de suivi", axes.length ? axes.map((a) => `<div class="row"><div><b>${esc(a.nom)}</b><small>${(a.valeurs || []).map(esc).join(" · ") || "valeurs libres à définir"}</small></div>${btn("Modifier", "axEdit", a.id, "", "o sm w")}</div>`).join("")
    : `<p class="mut" style="margin:0;padding:16px 18px">Les axes ajoutent des étiquettes à vos chantiers et devis pour les filtrer et les comparer. Créez les vôtres, ou partez des axes types.</p>`,
    btn("Nouvel axe", "axNew", "", "", "sm w") + (axes.length ? "" : " " + btn("Créer les axes types", "axSeed", "", "", "o sm w")));
  if (!ax) return list;
  const vals = [...new Set([...(ax.valeurs || []), ...db.axv.filter((x) => x.axe_id === ax.id).map((x) => x.valeur)]), ""];
  const R = vals.map((v) => {
    const chs = db.chantiers.filter((c) => (axVal("chantier", c.id, ax.id) || "") === v), rs = chs.map(chRentaSafe);
    const dvs = db.devis.filter((d) => (axVal("devis", d.id, ax.id) || "") === v);
    return { v, chs, nch: chs.length, base: sum(rs, (r) => r.base), fact: sum(rs, (r) => r.factureHT), couts: sum(rs, (r) => r.couts), dv: dvs, dvAcc: sum(dvs.filter((d) => d.statut === "Accepté"), (d) => d.montant_ht), dvPend: sum(dvs.filter((d) => d.statut === "Envoyé"), (d) => d.montant_ht) };
  }).filter((x) => x.nch || x.dv.length);
  const rows = R.map((x) => { const m = x.fact - x.couts; return { act: "axVal", id: x.v || "__none", t: x.v, c: [`<strong>${esc(x.v || "Non renseigné")}</strong>`, String(x.nch), `<span class="num">${E(x.fact)}</span>`, `<span class="num">${E(x.couts)}</span>`, `<span class="num ${m < 0 ? "dn" : ""}">${E(m)}</span>`, x.fact ? `${Math.round((m / x.fact) * 100)} %` : "-", String(x.dv.length), `<span class="num">${E(x.dvAcc)}</span>`, `<span class="num">${E(x.dvPend)}</span>`] }; });
  const fv = ST.axV, sel = fv !== undefined ? R.find((x) => (x.v || "__none") === fv) : null;
  const detail = sel ? card(`Opérations : ${esc(sel.v || "non renseigné")} <span class="mut" style="font-weight:400">· ${esc(ax.nom)}</span>`, tbl(["Opération", "Client", { h: "Montant HT", r: 1 }, "Statut"], [
    ...sel.chs.map((c) => ({ go: "chantiers/" + c.id, t: c.nom, c: [`<strong>${esc(c.nom)}</strong><small>Chantier</small>`, esc(c.client_nom || ""), `<span class="num">${E(chRentaSafe(c).factureHT)}</span>`, chip(c.statut)] })),
    ...sel.dv.map((d) => ({ go: "devis/" + d.id, t: d.numero, c: [`<strong>${esc(d.numero || "Devis")}</strong><small>Devis</small>`, esc(d.client_nom || ""), `<span class="num">${E(d.montant_ht)}</span>`, chip(d.statut)] }))])) : "";
  return list + `<div class="sr"><div class="seg">${axes.map((a) => `<button data-act="axChoose" data-id="${a.id}" aria-pressed="${a.id === cur}">${esc(a.nom)}</button>`).join("")}</div></div>` +
    card(`Comparaison par « ${esc(ax.nom)} »`, tbl(["Valeur", "Chantiers", { h: "Facturé HT", r: 1 }, { h: "Coûts réels", r: 1 }, { h: "Marge", r: 1 }, "Marge %", "Devis", { h: "Acceptés HT", r: 1 }, { h: "En attente HT", r: 1 }], rows, "Aucune étiquette posée pour cet axe : ouvrez un chantier ou un devis et renseignez-la.")) + detail +
    `<p class="note">Les coûts réels et la marge viennent de la page Rentabilité (achats, sous-traitance, temps pointés, matériel). Cliquez sur une ligne pour voir les opérations.</p>`;
}
const chRentaSafe = (c) => (typeof chRenta === "function" && db.v12 ? chRenta(c) : { base: Number(c.montant_marche) || 0, factureHT: 0, couts: 0 });

/* ---------- Page Marchés ---------- */
async function marchesTab() {
  const lg = db.v14 ? await q(sb.from("devis_lignes").select("devis_id,lot,sous_lot,tranche,tranche_cond,tranche_ok,type_ligne,est_option,option_choisie,quantite,prix_unitaire_ht")) : [];
  const by = {};
  lg.forEach((l) => (by[l.devis_id] ||= []).push(l));
  const rows = [];
  for (const d of db.devis) {
    const imp = db.mimp.find((x) => x.devis_id === d.id), ls = by[d.id] || [], s = mkStruct(ls.map((l) => ({ ...l, quantite: Number(l.quantite), prix_unitaire_ht: Number(l.prix_unitaire_ht), designation: "x" }))), av = Object.entries(db.avn).filter(([, p]) => p === d.id).length;
    if (!imp && !s.any && !av && !db.avn[d.id]) continue;
    rows.push({ go: "devis/" + d.id, t: `${d.numero} ${d.client_nom}`, c: [`<strong>${esc(d.numero || "Brouillon")}</strong>${db.avn[d.id] ? `<small>Avenant</small>` : ""}`, esc(d.client_nom || ""), d.chantier_nom ? esc(d.chantier_nom) : "-", `<span class="num">${E(d.montant_ht)}</span>`,
      imp ? `<span class="chip ac">${imp.format}</span>` : "-", s.lots ? `${s.lots} lot${s.lots > 1 ? "s" : ""}` : "-", s.cond ? `<span class="chip wn">${E(s.cond)} conditionnel</span>` : s.tranches.length > 1 ? `${s.tranches.length} tranches` : "-", av ? String(av) : "-", chip(d.statut)] });
  }
  return strip([["Marchés structurés", String(rows.length), "avec bordereau, lots ou tranches"], ["Bordereaux importés", String(db.mimp.length), "DPGF, DQE, BPU"], ["Avenants", String(Object.keys(db.avn).length), "devis complémentaires"], ["Axes", String(db.axes.length), "étiquettes de suivi"]]) +
    card("Marchés et appels d'offres", tbl(["Devis", "Client", "Chantier", { h: "Montant HT", r: 1 }, "Bordereau", "Lots", "Tranches", "Avenants", "Statut"], rows, "Aucun marché structuré. Importez un bordereau d'appel d'offres, ou ajoutez des lots et des tranches dans l'éditeur de devis."), btn("Importer un bordereau", "mkImport", "", "", "sm w")) +
    `<p class="note">Import : feuille Excel avec une colonne de désignation, d'unité, de quantité et de prix. Les lignes sans unité ni quantité deviennent des lots, sous-lots ou chapitres (d'après leur numérotation 1, 1.1, 1.1.1 ou le mot « Lot »), les titres « Tranche ferme » ou « Tranche conditionnelle » ouvrent une tranche.</p>`;
}
V.marches = async (r) => {
  const extra = typeof btpTabs === "function" ? btpTabs() : [];
  const items = [["marches", "Marchés"], ["axes", "Axes analytiques"], ...extra.map(([k, l]) => [k, l])];
  const cur = ST.tab.marches && items.some((x) => x[0] === ST.tab.marches) ? ST.tab.marches : "marches";
  let body;
  if (!db.v14) body = card("", setupV14("les appels d'offres, les lots et les axes analytiques"));
  else if (cur === "marches") body = await marchesTab();
  else if (cur === "axes") body = axesTab();
  else body = await extra.find((x) => x[0] === cur)[2]();
  return page("Marchés et analyses", "Appels d'offres, lots et tranches, axes de suivi, indices, déchets et attestations.", cur === "marches" ? btn("Importer un bordereau", "mkImport", "", "", "w") : cur === "axes" ? btn("Nouvel axe", "axNew", "", "", "w") : "", tabs("marches", items, cur) + body);
};

/* ---------- Cartes de la fiche devis / chantier ---------- */
function mkDevisCards(d, lignes) {
  if (!db.v14) return "";
  return mkStructCard(d, lignes) + mkBordereauCard(d) + axesCard("devis", d.id) + (typeof btpDevisCards === "function" ? btpDevisCards(d, lignes) : "");
}
function mkChantierCards(id) {
  if (!db.v14) return "";
  return axesCard("chantier", id) + (typeof btpChantierCards === "function" ? btpChantierCards(id) : "");
}

const marchesActions = {
  mkImport: () => mkImport(),
  mkExport: (id, arg) => mkExport(id, arg),
  mkAffermir: async (id, name) => {
    if (!guard()) return;
    const rows = await q(sb.from("devis_lignes").select("id,tranche,tranche_cond,tranche_ok").eq("devis_id", id));
    const ts = rows.filter((x) => x.tranche_cond && (x.tranche || "Tranche conditionnelle") === name);
    if (!ts.length) return;
    const to = !ts.every((x) => x.tranche_ok);
    if (to && !confirm(`Affermir « ${name} » ? Son montant sera compté dans le total du devis.`)) return;
    await q(sb.from("devis_lignes").update({ tranche_ok: to }).eq("devis_id", id).eq("tranche_cond", true).eq("tranche", ts[0].tranche));
    toast(to ? "Tranche affermie." : "Tranche remise en conditionnelle.", "ok");
    await refresh();
  },
  axNew: () => axeForm(null), axEdit: (id) => axeForm(byId(db.axes, id)),
  axSeed: async () => { if (!guard()) return; await q(sb.from("axes").insert(Object.entries(AX_TYPES).map(([nom, valeurs]) => ({ nom, valeurs })))); toast("Axes types créés : complétez leurs valeurs.", "ok"); await refresh(); },
  axChoose: (id) => { ST.axC = id; ST.axV = undefined; return render(true); },
  axVal: (id) => { ST.axV = ST.axV === id ? undefined : id; return render(true); },
  axSet: async (v, _, el) => {
    if (!guard()) return;
    const { ent, eid, axe } = el.dataset;
    if (!v) await q(sb.from("axe_valeurs").delete().eq("entite", ent).eq("entite_id", eid).eq("axe_id", axe));
    else await q(sb.from("axe_valeurs").upsert({ entite: ent, entite_id: eid, axe_id: axe, valeur: v }, { onConflict: "entite,entite_id,axe_id" }));
    toast("Étiquette enregistrée.", "ok");
    await refresh();
  },
};
