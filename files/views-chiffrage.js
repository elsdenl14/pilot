/* Chiffrage avancé : déboursés secs, coefficients, marge, métrés, options, images, dictée, sous-détail d'ouvrages.
   Tout ce qui touche au coût de revient et à la marge est INTERNE : jamais envoyé au PDF, à la page client ni aux RPC publiques. */

const CX_TYPES = { materiau: "Matériau", main_oeuvre: "Main-d'œuvre", materiel: "Matériel", sous_traitance: "Sous-traitance" };
const cxNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const cxIncluded = (l) => l.type_ligne !== "image" && !l.est_option;

/* ---------- Réglages et coefficient de vente ---------- */
function cxReglages() {
  const r = db.ent?.chiffrage_reglages || {};
  return {
    frais_fixes_annuels: cxNum(r.frais_fixes_annuels), ca_cible: cxNum(r.ca_cible),
    frais_generaux_pct: r.frais_generaux_pct ?? 15, benefice_pct: r.benefice_pct ?? 10,
    coef_st: r.coef_st ?? 1.1, taux_mo_cout: r.taux_mo_cout ?? (Number(db.ent?.taux_horaire_cout) || 35),
  };
}
function cxCoef(r = cxReglages()) {
  const fg = r.frais_fixes_annuels > 0 && r.ca_cible > 0 ? r.frais_fixes_annuels / r.ca_cible : cxNum(r.frais_generaux_pct) / 100;
  const b = cxNum(r.benefice_pct) / 100;
  const den = 1 - fg - b;
  return { fg, b, ok: den > 0.05, k: den > 0.05 ? 1 / den : 0, kst: cxNum(r.coef_st) || 1 };
}
function cxSettings() {
  if (!guard()) return;
  const r = cxReglages();
  const body = `<div class="frm">
    <p class="full cx-help">Le coefficient est calculé ainsi : <b>1 ÷ (1 − frais généraux − bénéfice visé)</b>. Il sert à proposer un prix de vente à partir du déboursé sec. Renseignez vos frais fixes annuels et le chiffre d'affaires visé, ou à défaut un pourcentage de frais généraux.</p>
    ${fld({ k: "frais_fixes_annuels", l: "Frais fixes annuels (€)", t: "number", v: r.frais_fixes_annuels || "", r: 0 })}
    ${fld({ k: "ca_cible", l: "Chiffre d'affaires visé sur l'année (€)", t: "number", v: r.ca_cible || "", r: 0 })}
    ${fld({ k: "frais_generaux_pct", l: "Frais généraux (% du prix de vente), si les deux champs ci-dessus sont vides", t: "number", v: r.frais_generaux_pct, r: 0 })}
    ${fld({ k: "benefice_pct", l: "Bénéfice visé (% du prix de vente)", t: "number", v: r.benefice_pct })}
    ${fld({ k: "coef_st", l: "Coefficient sur la sous-traitance", t: "number", v: r.coef_st })}
    ${fld({ k: "taux_mo_cout", l: "Coût horaire de la main-d'œuvre (€/h)", t: "number", v: r.taux_mo_cout })}
    <div class="full cx-prev" id="cxprev"></div></div>`;
  modal("Coefficient de vente et frais", body, {
    submit: "Enregistrer",
    onMount: (m) => {
      const read = () => {
        const g = (k) => parseNum($("#f_" + k, m)?.value || "");
        return { frais_fixes_annuels: g("frais_fixes_annuels"), ca_cible: g("ca_cible"), frais_generaux_pct: g("frais_generaux_pct"), benefice_pct: g("benefice_pct"), coef_st: g("coef_st") || 1, taux_mo_cout: g("taux_mo_cout") };
      };
      const show = () => {
        const c = cxCoef(read());
        $("#cxprev", m).innerHTML = c.ok
          ? `Frais généraux retenus : <b>${fmtNum(c.fg * 100, 1)} %</b> · Coefficient de vente : <b>${fmtNum(c.k, 3)}</b> · Sous-traitance : <b>${fmtNum(c.kst, 2)}</b><br><small>Un déboursé de 100 € est proposé à ${E2(100 * c.k)} HT.</small>`
          : `<span class="neg">Frais généraux + bénéfice trop élevés : le coefficient n'est pas calculable.</span>`;
      };
      m.addEventListener("input", show); show();
    },
    onSubmit: async (v, api) => {
      const g = (k) => parseNum(v[k] || "");
      const reg = { frais_fixes_annuels: g("frais_fixes_annuels"), ca_cible: g("ca_cible"), frais_generaux_pct: g("frais_generaux_pct"), benefice_pct: g("benefice_pct"), coef_st: g("coef_st") || 1, taux_mo_cout: g("taux_mo_cout") || 35 };
      if (!cxCoef(reg).ok) throw new Error("Frais généraux et bénéfice trop élevés : ils doivent rester sous 95 % du prix de vente.");
      await entPatch({ chiffrage_reglages: reg });
      api.close(); toast("Coefficient enregistré.", "ok");
      document.dispatchEvent(new CustomEvent("cx-settings"));
    },
  });
}

/* ---------- Déboursés d'une ligne ---------- */
function cxCout(c) {
  c = c || {};
  const mo = cxNum(c.moh) * cxNum(c.mot);
  return { mat: cxNum(c.mat), mo, eq: cxNum(c.eq), st: cxNum(c.st), total: cxNum(c.mat) + mo + cxNum(c.eq) + cxNum(c.st) };
}
function cxPrixConseille(c) {
  const k = cxCoef(), d = cxCout(c);
  if (!k.ok) return 0;
  const coef = cxNum(c?.coef) || k.k, cst = cxNum(c?.coef) || k.kst;
  return r2((d.mat + d.mo + d.eq) * coef + d.st * cst);
}

/* ---------- Métrés : formules sans eval ---------- */
function cxEval(src) {
  const FN = { round: Math.round, ceil: Math.ceil, floor: Math.floor, sqrt: Math.sqrt, abs: Math.abs, max: Math.max, min: Math.min };
  const vars = { pi: Math.PI };
  const run = (expr) => {
    const t = expr.replace(/,/g, ".").replace(/×/g, "*").replace(/÷/g, "/").replace(/²/g, "^2").match(/\d+(?:\.\d+)?|[A-Za-zÀ-ÿ_][\wÀ-ÿ]*|[-+*/^(),]|\S/g) || [];
    let i = 0;
    const peek = () => t[i], next = () => t[i++];
    const prim = () => {
      const x = next();
      if (x === undefined) throw new Error("Formule incomplète");
      if (x === "(") { const v = add(); if (next() !== ")") throw new Error("Parenthèse manquante"); return v; }
      if (x === "-") return -pow();
      if (x === "+") return pow();
      if (/^\d/.test(x)) return Number(x);
      const k = x.toLowerCase();
      if (peek() === "(") {
        next(); const a = [];
        if (peek() !== ")") { a.push(add()); while (peek() === ",") { next(); a.push(add()); } }
        if (next() !== ")") throw new Error("Parenthèse manquante");
        if (!FN[k]) throw new Error("Fonction inconnue : " + x);
        return FN[k](...a);
      }
      if (x in vars) return vars[x];
      if (k in vars) return vars[k];
      throw new Error("Inconnu : " + x);
    };
    const pow = () => { let a = prim(); while (peek() === "^") { next(); a = Math.pow(a, prim()); } return a; };
    const mul = () => { let a = pow(); while (peek() === "*" || peek() === "/") { const o = next(), b = pow(); if (o === "/" && b === 0) throw new Error("Division par zéro"); a = o === "*" ? a * b : a / b; } return a; };
    const add = () => { let a = mul(); while (peek() === "+" || peek() === "-") { const o = next(), b = mul(); a = o === "+" ? a + b : a - b; } return a; };
    const v = add();
    if (i < t.length) throw new Error("Caractère inattendu : " + t[i]);
    return v;
  };
  const parts = String(src).split(/[;\n]/).map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  let last = null;
  for (const p of parts) {
    const m = p.match(/^([A-Za-zÀ-ÿ_][\wÀ-ÿ]*)\s*=\s*(.+)$/);
    if (m) { last = run(m[2]); vars[m[1]] = last; } else last = run(p);
  }
  if (!Number.isFinite(last)) throw new Error("Résultat invalide");
  return Math.round(last * 1000) / 1000;
}
// Applique la formule de métré d'une ligne à sa quantité (appelé avant chaque lecture)
function cxApplyMetre(tr) {
  const inp = $('[data-c="metre"]', tr), qte = $('[data-f="qte"]', tr);
  if (!inp || !qte) return;
  const f = inp.value.trim(), msg = $(".cx-metre-msg", tr);
  if (!f) { qte.readOnly = false; qte.classList.remove("cx-auto"); if (msg) msg.textContent = ""; return; }
  try {
    const v = cxEval(f);
    qte.value = String(v).replace(".", ","); qte.readOnly = true; qte.classList.add("cx-auto");
    if (msg) { msg.textContent = "= " + fmtNum(v, 3); msg.classList.remove("neg"); }
  } catch (e) { qte.readOnly = false; qte.classList.remove("cx-auto"); if (msg) { msg.textContent = e.message; msg.classList.add("neg"); } }
}

/* ---------- Panneau de chiffrage d'une ligne (dans la cellule désignation) ---------- */
function cxPanel(l = {}) {
  const c = l.chiffrage || {}, r = cxReglages();
  const mot = c.mot ?? r.taux_mo_cout;
  const inp = (k, label, v, ph = "0", w = "") => `<label class="cx-f">${label}<input type="text" inputmode="decimal" data-c="${k}" value="${v === undefined || v === null || v === "" ? "" : String(v).replace(".", ",")}" placeholder="${ph}"${w}></label>`;
  const has = l.debourse_ht > 0 || l.metre || l.est_option || (l.chiffrage && Object.keys(l.chiffrage).length);
  return `<details class="cx"${has ? " open" : ""}><summary>Chiffrage interne <span class="cx-sum" data-f="cxsum"></span></summary>
    <div class="cx-grid">
      ${inp("mat", "Matériaux (€ / unité)", c.mat)}${inp("moh", "Main-d'œuvre (h / unité)", c.moh)}${inp("mot", "Coût horaire (€/h)", mot)}
      ${inp("eq", "Matériel (€ / unité)", c.eq)}${inp("st", "Sous-traitance (€ / unité)", c.st)}${inp("coef", "Coefficient (vide = auto)", c.coef)}
    </div>
    <div class="cx-line"><span data-f="cxcalc"></span><button type="button" class="btn o sm" data-cx="apply">Appliquer le prix proposé</button></div>
    <div class="cx-grid cx-2">
      <label class="cx-f">Métré (formule, ex : 4,5*3 + 2*1,2 ou L=4; l=3; L*l)<input type="text" data-c="metre" value="${esc(l.metre || "")}" placeholder="Laisser vide pour saisir la quantité"></label>
      <span class="cx-metre-msg"></span>
    </div>
    <div class="cx-grid cx-2">
      <label class="cx-chk"><input type="checkbox" data-c="opt"${l.est_option ? " checked" : ""}> Option : le client peut la retenir en ligne (non comprise dans le total)</label>
      <label class="cx-f">Variante (même nom = un seul choix possible)<input type="text" data-c="grp" value="${esc(l.option_groupe || "")}" placeholder="Ex : Type de parquet"></label>
    </div>
    <p class="cx-int">Ces informations ne figurent jamais sur le devis envoyé au client.</p></details>`;
}
function cxImageCell(l) {
  return `<span class="cx-imgrow"><img alt="" data-path="${esc(l.image_path || "")}"><span class="cx-imgcap"><b>Image</b> · légende sous l'image :</span></span>`;
}
function cxRead(tr) {
  const img = tr.dataset.type === "image";
  const g = (k) => $(`[data-c="${k}"]`, tr);
  const n = (k) => { const e = g(k); return e && e.value.trim() !== "" ? parseNum(e.value) : null; };
  const c = {};
  for (const k of ["mat", "moh", "mot", "eq", "st", "coef"]) { const v = n(k); if (v !== null && v !== 0) c[k] = v; }
  if (c.mot && !c.moh) delete c.mot;       // un taux horaire seul ne veut rien dire
  const has = ["mat", "moh", "eq", "st"].some((k) => c[k]);
  const deb = has ? r2(cxCout(c).total) : null;
  const opt = !!g("opt")?.checked;
  return {
    type_ligne: img ? "image" : "normale", image_path: img ? tr.dataset.img || null : null,
    chiffrage: has ? c : null, debourse_ht: img ? null : deb, metre: img ? null : g("metre")?.value.trim() || null,
    est_option: !img && opt, option_groupe: !img && opt ? g("grp")?.value.trim() || null : null,
  };
}
// Colonnes à écrire après sauver_document (par position)
const cxExt = (l) => ({
  type_ligne: l.type_ligne || "normale", image_path: l.image_path || null, chiffrage: l.chiffrage || null, debourse_ht: l.debourse_ht ?? null,
  metre: l.metre || null, est_option: !!l.est_option, option_groupe: l.option_groupe || null, option_choisie: false,
  ...(l.type_ligne === "image" ? { designation: l.designation || "Image" } : {}),
});
const cxExtFacture = (l) => ({ debourse_ht: l.debourse_ht ?? null });

/* ---------- Recalcul : marges et totaux internes ---------- */
function cxMargeOf(l) {
  const qte = Number(l.quantite) || 0, pu = Number(l.prix_unitaire_ht) || 0, deb = Number(l.debourse_ht) || 0;
  const ca = r2(qte * pu), cout = r2(qte * deb), m = r2(ca - cout);
  return { ca, cout, m, pct: ca ? (m / ca) * 100 : 0 };
}
function cxAfterRecalc(root, ls) {
  const rows = $$(".lr", root);
  let ca = 0, cout = 0, sans = 0, opt = 0, nopt = 0;
  const k = cxCoef();
  rows.forEach((tr, i) => {
    const l = ls[i]; if (!l) return;
    cxApplyPanel(tr, l, k);
  });
  $$(".cat", root).forEach((sec) => {
    let sca = 0, scout = 0;
    $$(".lr", sec).forEach((tr) => {
      const l = ls[rows.indexOf(tr)];
      if (!l || !cxIncluded(l) || !(l.designation || l.prix_unitaire_ht)) return;
      if (l.debourse_ht > 0) { const x = cxMargeOf(l); sca += x.ca; scout += x.cout; } else if (l.prix_unitaire_ht > 0) sans++;
    });
    ca += sca; cout += scout;
    let mg = $('[data-f="mg"]', sec);
    if (!mg) { const sub = $('[data-f="sub"]', sec); if (sub) sub.insertAdjacentHTML("afterend", '<span class="num cx-mg" data-f="mg"></span>'); mg = $('[data-f="mg"]', sec); }
    if (mg) mg.textContent = sca > 0 ? `Marge ${E2(sca - scout)} (${fmtNum(((sca - scout) / sca) * 100, 1)} %)` : "";
  });
  ls.forEach((l) => { if (l.est_option && (l.designation || l.prix_unitaire_ht)) { nopt++; opt += r2(l.quantite * l.prix_unitaire_ht); } });
  const tb = $("#totbox", root);
  let mb = $("#margebox", root);
  if (!mb && tb) { tb.insertAdjacentHTML("afterend", '<div class="margebox" id="margebox"></div>'); mb = $("#margebox", root); }
  if (!mb) return;
  const parts = [];
  if (nopt) parts.push(`<div class="cx-opt"><span>Options proposées (${nopt})</span><span class="num">+ ${E2(opt)} HT</span></div><small>Non comprises dans le total ci-dessus.</small>`);
  if (ca > 0) {
    const m = ca - cout, p = (m / ca) * 100;
    parts.push(`<div class="cx-mb ${p < 10 ? "low" : ""}"><b>Marge prévisionnelle (interne)</b><div><span>Coût de revient</span><span class="num">${E2(cout)}</span></div><div><span>Marge</span><span class="num">${E2(m)} · ${fmtNum(p, 1)} %</span></div>${sans ? `<small>${sans} ligne(s) sans déboursé ne sont pas comptées.</small>` : ""}<small>Masquée sur le document envoyé au client.</small></div>`);
  }
  mb.innerHTML = parts.join("");
}
function cxApplyPanel(tr, l, k) {
  const c = l.chiffrage, sum = $('[data-f="cxsum"]', tr), calc = $('[data-f="cxcalc"]', tr);
  if (!sum || !calc) return;
  if (!c) { sum.textContent = l.metre || l.est_option ? "" : ""; calc.textContent = "Saisissez au moins un déboursé pour obtenir un prix proposé."; tr.dataset.cxprix = ""; return; }
  const d = cxCout(c), p = cxPrixConseille(c);
  tr.dataset.cxprix = p;
  calc.innerHTML = `Déboursé sec <b>${E2(d.total)}</b> / unité${k.ok ? ` · prix proposé <b>${E2(p)}</b> HT (coef. ${fmtNum(cxNum(c.coef) || k.k, 3)})` : " · coefficient non calculable (voir réglages)"}`;
  const x = cxMargeOf(l);
  sum.textContent = x.ca ? ` · marge ${fmtNum(x.pct, 1)} %` : "";
  sum.classList.toggle("neg", x.ca > 0 && x.pct < 10);
}

/* ---------- Images ---------- */
async function cxCompress(file, max = 1400) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error("Image illisible.")); i.src = url; });
    const sc = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement("canvas"); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
    const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((ok, ko) => c.toBlob((b) => (b ? ok(b) : ko(new Error("Conversion impossible."))), "image/jpeg", 0.85));
  } finally { URL.revokeObjectURL(url); }
}
function cxImageRow(l = {}) {
  return `<tr class="lr lr-img" data-nat="normale" data-ref="" data-tp="" data-type="image" data-img="${esc(l.image_path || "")}"><td colspan="6">
    <img class="cx-img" alt="" data-path="${esc(l.image_path || "")}">
    <input type="text" data-f="des" value="${esc(l.designation || "")}" placeholder="Légende de l'image (facultatif)">
    <input type="hidden" data-f="desc" value=""><input type="hidden" data-f="qte" value="1"><input type="hidden" data-f="uni" value="u"><input type="hidden" data-f="pu" value="0"><input type="hidden" data-f="tva" value="${l.taux_tva ?? 20}"><span class="lt" hidden><span data-f="tot">0,00</span></span></td>
    <td style="width:34px"><button type="button" class="rm" data-rm title="Supprimer l'image" aria-label="Supprimer l'image">${svg(ic.x)}</button></td></tr>`;
}
async function cxLoadImgs(root) {
  for (const im of $$("img[data-path]", root)) {
    const p = im.dataset.path;
    if (!p || im.dataset.ok) continue;
    im.dataset.ok = "1";
    try { const b = await getAsset(p); im.src = URL.createObjectURL(new Blob([b], { type: sniff(b) === "png" ? "image/png" : "image/jpeg" })); } catch (e) { im.alt = "Image introuvable"; }
  }
}
function cxAddImage(m) {
  if (!db.v13) return toast("Exécutez migration_v13.sql dans Supabase pour ajouter des images.", "dn");
  pickFile("image/png,image/jpeg,image/webp", async (f) => {
    const blob = await cxCompress(f);
    const path = `${uid}/devis-img/${Date.now()}.jpg`;
    const { error } = await sb.storage.from("documents").upload(path, blob, { contentType: "image/jpeg" });
    if (error) throw new Error("Envoi de l'image impossible : " + error.message);
    const lb = $$(".lb", m).pop();
    lb.insertAdjacentHTML("beforeend", cxImageRow({ image_path: path }));
    cxLoadImgs(m); $$('[data-f="des"]', lb).pop().focus();
    recalcLignes(m);
  });
}
async function cxPdfImages(lignes) {
  const out = {};
  for (const l of lignes) if (l.type_ligne === "image" && l.image_path && !out[l.image_path]) { try { out[l.image_path] = await getAsset(l.image_path); } catch (e) { console.warn(e); } }
  return out;
}

/* ---------- Ouvrages composés ---------- */
async function cxComposants(id) {
  const r = await q(sb.from("ouvrage_composants").select("*").eq("ouvrage_id", id).order("position"));
  r.forEach((x) => nz(x, ["quantite", "cout_unitaire"]));
  return r;
}
function cxFromComposants(cs) {
  const c = { mat: 0, moh: 0, mot: 0, eq: 0, st: 0 };
  let moCost = 0;
  for (const x of cs) {
    const v = x.quantite * x.cout_unitaire;
    if (x.type === "materiau") c.mat += v;
    else if (x.type === "main_oeuvre") { c.moh += x.quantite; moCost += v; }
    else if (x.type === "materiel") c.eq += v;
    else c.st += v;
  }
  c.mot = c.moh ? r2(moCost / c.moh) : 0;
  for (const k of Object.keys(c)) c[k] = r2(c[k]);
  return c;
}
async function cxFillFromOuvrage(m, tr, o) {
  if (!db.v13 || !o?.id) return;
  try {
    const cs = await cxComposants(o.id);
    if (!cs.length) return;
    const c = cxFromComposants(cs);
    for (const k of ["mat", "moh", "mot", "eq", "st"]) { const e = $(`[data-c="${k}"]`, tr); if (e) e.value = c[k] ? String(c[k]).replace(".", ",") : ""; }
    $("details.cx", tr).open = true;
    recalcLignes(m);
  } catch (e) { console.warn(e); }
}
const cxCompRow = (x = {}) => `<tr class="cc"><td><select data-k="type">${Object.entries(CX_TYPES).map(([k, v]) => `<option value="${k}"${x.type === k ? " selected" : ""}>${v}</option>`).join("")}</select></td>
  <td><input type="text" data-k="des" value="${esc(x.designation || "")}" placeholder="Ex : carreaux 60×60, carreleur…"></td>
  <td style="width:80px"><input type="text" inputmode="decimal" data-k="qte" value="${x.quantite !== undefined ? String(x.quantite).replace(".", ",") : "1"}"></td>
  <td style="width:76px"><input type="text" data-k="uni" value="${esc(x.unite || "u")}"></td>
  <td style="width:96px"><input type="text" inputmode="decimal" data-k="cout" value="${x.cout_unitaire !== undefined ? String(x.cout_unitaire).replace(".", ",") : ""}" placeholder="0,00"></td>
  <td class="lt" style="width:90px"><span data-k="tot">0,00</span></td>
  <td style="width:34px"><button type="button" class="rm" data-rm title="Supprimer" aria-label="Supprimer">${svg(ic.x)}</button></td></tr>`;
async function cxCompEditor(id) {
  if (!guard()) return;
  if (!db.v13) return toast("Exécutez migration_v13.sql dans Supabase pour activer le sous-détail de prix.", "dn");
  const o = (await q(sb.from("ouvrages").select("*").eq("id", id).single())); nz(o, ["prix_ht", "taux_tva"]);
  const cs = await cxComposants(id);
  const body = `<p class="cx-help">Décomposez l'ouvrage pour une unité (1 ${esc(o.unite)}) : matériaux, main-d'œuvre (en heures), matériel et sous-traitance. Le coût de revient est interne.</p>
    <div class="tw"><table class="lines"><thead><tr><th>Type</th><th>Désignation</th><th>Qté</th><th>Unité</th><th>Coût unit. HT</th><th class="r">Total</th><th></th></tr></thead><tbody id="ccb">${(cs.length ? cs : [{ type: "materiau" }]).map(cxCompRow).join("")}</tbody></table></div>
    <div class="cx-line"><button type="button" class="btn o sm" id="ccadd">+ Ajouter un composant</button><span id="ccsum"></span></div>`;
  modal(`Sous-détail de prix : ${esc(o.designation)}`, body, {
    xl: true, wide: true, submit: "Enregistrer",
    onMount: (m) => {
      const calc = () => {
        let t = 0;
        $$(".cc", m).forEach((tr) => { const v = r2(parseNum($('[data-k="qte"]', tr).value) * parseNum($('[data-k="cout"]', tr).value)); t += v; $('[data-k="tot"]', tr).textContent = fmtNum(v); });
        const k = cxCoef();
        $("#ccsum", m).innerHTML = `Coût de revient : <b>${E2(t)}</b>${k.ok ? ` · prix proposé : <b>${E2(r2(t * k.k))}</b> HT · prix actuel : ${E2(o.prix_ht)}` : ""}`;
        return t;
      };
      m.addEventListener("input", calc);
      m.addEventListener("click", (e) => {
        if (e.target.closest("#ccadd")) { $("#ccb", m).insertAdjacentHTML("beforeend", cxCompRow({ type: "materiau" })); calc(); }
        const rm = e.target.closest("[data-rm]");
        if (rm) { if ($$(".cc", m).length > 1) rm.closest("tr").remove(); else $$("input", rm.closest("tr")).forEach((i) => (i.value = "")); calc(); }
      });
      calc();
    },
    onSubmit: async (v, api) => {
      const rows = $$(".cc", api.el).map((tr, i) => ({
        ouvrage_id: id, position: i + 1, type: $('[data-k="type"]', tr).value, designation: $('[data-k="des"]', tr).value.trim(),
        quantite: parseNum($('[data-k="qte"]', tr).value), unite: $('[data-k="uni"]', tr).value.trim() || "u", cout_unitaire: parseNum($('[data-k="cout"]', tr).value),
      })).filter((r) => r.designation || r.cout_unitaire);
      await q(sb.from("ouvrage_composants").delete().eq("ouvrage_id", id));
      if (rows.length) await q(sb.from("ouvrage_composants").insert(rows));
      const cout = r2(rows.reduce((s, r) => s + r.quantite * r.cout_unitaire, 0));
      await q(sb.from("ouvrages").update({ debourse_ht: rows.length ? cout : null }).eq("id", id));
      api.close(); toast("Sous-détail enregistré.", "ok");
      if (rows.length && cxCoef().ok && cout > 0 && confirm(`Mettre le prix de vente de l'ouvrage à ${E2(r2(cout * cxCoef().k))} HT (coefficient ${fmtNum(cxCoef().k, 3)}) ?`)) {
        await q(sb.from("ouvrages").update({ prix_ht: r2(cout * cxCoef().k) }).eq("id", id)); toast("Prix de vente mis à jour.", "ok");
      }
      if (typeof refresh === "function") await refresh();
    },
  });
}

/* ---------- Dictée vocale -> lignes proposées ---------- */
const CX_NB = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, douze: 12, quinze: 15, vingt: 20, trente: 30, quarante: 40, cinquante: 50, cent: 100 };
const CX_UNITS = [
  [/^(m²|m2|mètres? carrés?|metres? carres?|m carrés?)\b/i, "m²"], [/^(ml|mètres? linéaires?|metres? lineaires?)\b/i, "ml"],
  [/^(m³|m3|mètres? cubes?|metres? cubes?)\b/i, "m³"], [/^(heures?|h)\b/i, "h"], [/^(jours?|journées?)\b/i, "jour"],
  [/^(forfaits?)\b/i, "forfait"], [/^(kg|kilos?)\b/i, "kg"], [/^(lots?)\b/i, "lot"], [/^(mètres?|metres?|m)\b/i, "ml"],
  [/^(unités?|unites?|pièces?|pieces?|u)\b/i, "u"],
];
const CX_STOP = new Set(["de", "du", "des", "la", "le", "les", "un", "une", "d", "l", "en", "à", "au", "aux", "avec", "sur", "pour", "et", "environ", "prévoir", "prevoir", "ajouter", "faire", "fournir"]);
function cxParseDictee(text) {
  const segs = String(text).replace(/\n+/g, ". ").split(/\s*(?:[.;]|\bpuis\b|\bensuite\b|\bégalement\b|\baussi\b)\s*|\s+et\s+(?=\d|(?:un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix)\b)|,\s*(?=\d|(?:un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix)\b)/i).map((s) => s && s.trim()).filter((s) => s && s.length > 2);
  return segs.map((s) => {
    let qte = null, unite = "", rest = s;
    const m = s.match(/(\d+(?:[.,]\d+)?|\b(?:un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|douze|quinze|vingt|trente|quarante|cinquante|cent)\b)\s*/i);
    if (m) {
      const raw = m[1].toLowerCase();
      qte = /^\d/.test(raw) ? parseNum(raw) : CX_NB[raw];
      const after = s.slice(m.index + m[0].length);
      rest = (s.slice(0, m.index) + " " + after).trim();
      for (const [re, u] of CX_UNITS) { const mm = after.match(re); if (mm) { unite = u; rest = (s.slice(0, m.index) + " " + after.slice(mm[0].length)).trim(); break; } }
    }
    const words = rest.replace(/[^\p{L}\p{N}\s'-]/gu, " ").split(/\s+/).filter((w) => w && !CX_STOP.has(w.toLowerCase()));
    return { src: s, quantite: qte ?? 1, unite, words, designation: rest.replace(/^(de|du|des|d'|la|le|les)\s+/i, "").replace(/\s+/g, " ").trim() };
  }).filter((x) => x.words.length);
}
async function cxMatch(p) {
  if (!db.v7) return null;
  for (const n of [Math.min(4, p.words.length), 2, 1]) {
    if (n < 1) continue;
    try {
      const { rows } = await ovSearch({ text: p.words.slice(0, n).join(" "), limit: 1 });
      if (rows[0]) return rows[0];
    } catch (e) { return null; }
  }
  return null;
}
function cxDictee(m) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const body = `<p class="cx-help">Décrivez les travaux à voix haute ou au clavier, par exemple : « 30 mètres carrés de carrelage, 12 mètres linéaires de plinthes, deux portes intérieures ». Pilot propose des lignes, que vous relisez avant de les ajouter au devis.</p>
    <textarea id="dt" rows="5" placeholder="Votre description…" style="width:100%"></textarea>
    <div class="cx-line"><span style="display:flex;gap:8px;flex-wrap:wrap">${SR ? '<button type="button" class="btn o" id="dtmic">Dicter</button>' : ""}<button type="button" class="btn" id="dtgo">Proposer des lignes</button></span><small id="dtst">${SR ? "" : "La dictée vocale n'est pas disponible sur ce navigateur : saisissez le texte."}</small></div>
    <div id="dtres"></div>`;
  const api = modal("Dictée : devis ou avenant", body, { xl: true, wide: true, submit: false, noFocus: true });
  const el = api.el;
  let rec = null, props = [];
  const stop = () => { try { rec?.stop(); } catch (e) {} rec = null; const b = $("#dtmic", el); if (b) b.textContent = "Dicter"; };
  const close = api.close; api.close = () => { stop(); close(); };
  $("#dtmic", el)?.addEventListener("click", () => {
    if (rec) return stop();
    rec = new SR(); rec.lang = "fr-FR"; rec.continuous = true; rec.interimResults = true;
    const base = $("#dt", el).value ? $("#dt", el).value.trim() + " " : "";
    rec.onresult = (e) => { let t = ""; for (const r of e.results) t += r[0].transcript + " "; $("#dt", el).value = base + t.trim(); };
    rec.onerror = (e) => { $("#dtst", el).textContent = e.error === "not-allowed" ? "Micro refusé par le navigateur." : "Erreur de dictée : " + e.error; stop(); };
    rec.onend = () => stop();
    rec.start(); $("#dtmic", el).textContent = "Arrêter";
  });
  const render = () => {
    $("#dtres", el).innerHTML = props.length ? `<div class="tw"><table class="lines"><thead><tr><th></th><th>Désignation</th><th>Qté</th><th>Unité</th><th>P.U. HT</th><th>Source</th></tr></thead><tbody>${props.map((p, i) => `<tr class="dp" data-i="${i}"><td style="width:34px"><input type="checkbox" data-k="on" checked aria-label="Garder"></td>
      <td><input type="text" data-k="des" value="${esc(p.designation)}"></td><td style="width:78px"><input type="text" data-k="qte" value="${String(p.quantite).replace(".", ",")}"></td>
      <td style="width:80px"><input type="text" data-k="uni" value="${esc(p.unite)}"></td><td style="width:100px"><input type="text" data-k="pu" value="${p.pu ? String(p.pu).replace(".", ",") : ""}" placeholder="0,00"></td>
      <td><small>${p.match ? "Bibliothèque : " + esc(p.match.corps_etat) : "À compléter"}</small></td></tr>`).join("")}</tbody></table></div>
      <div class="cx-line"><small>Vérifiez chaque ligne : les prix viennent de votre bibliothèque, sinon ils restent à renseigner.</small><button type="button" class="btn" id="dtadd">Ajouter au devis</button></div>` : "";
  };
  $("#dtgo", el).addEventListener("click", async () => {
    stop();
    const ps = cxParseDictee($("#dt", el).value);
    if (!ps.length) return ($("#dtst", el).textContent = "Rien à proposer : décrivez au moins un poste (ex : « 20 m² de peinture »).");
    $("#dtst", el).textContent = "Recherche dans la bibliothèque…";
    props = [];
    for (const p of ps) { const mt = await cxMatch(p); props.push({ ...p, match: mt, designation: mt ? mt.designation : p.designation.charAt(0).toUpperCase() + p.designation.slice(1), unite: p.unite || mt?.unite || "u", pu: mt?.prix_ht || 0, tva: mt?.taux_tva, cat: mt?.corps_etat || "" }); }
    $("#dtst", el).textContent = `${props.length} ligne(s) proposée(s).`;
    render();
  });
  el.addEventListener("click", (e) => {
    if (!e.target.closest("#dtadd")) return;
    const out = $$(".dp", el).filter((tr) => $('[data-k="on"]', tr).checked).map((tr) => {
      const p = props[Number(tr.dataset.i)];
      return { designation: $('[data-k="des"]', tr).value.trim(), quantite: parseNum($('[data-k="qte"]', tr).value) || 1, unite: $('[data-k="uni"]', tr).value.trim() || "u", prix_unitaire_ht: parseNum($('[data-k="pu"]', tr).value), taux_tva: p.tva, categorie: p.cat, id: p.match?.id };
    }).filter((l) => l.designation);
    if (!out.length) return toast("Aucune ligne à ajouter.", "dn");
    if (m) cxInsertLines(m, out);
    api.close(); toast(`${out.length} ligne(s) ajoutée(s) : relisez-les avant d'enregistrer.`, "ok");
  });
}
function cxInsertLines(m, ls) {
  const isEmpty = (tr) => !$('[data-f="des"]', tr).value.trim() && !parseNum($('[data-f="pu"]', tr).value) && tr.dataset.type !== "image";
  for (const l of ls) {
    const cat = l.categorie || "";
    const secs = $$(".cat", m);
    let sec = cat ? secs.find((x) => $('[data-f="cat"]', x).value.trim().toLowerCase() === cat.toLowerCase()) : secs[secs.length - 1];
    if (!sec) {
      const last = secs[secs.length - 1];
      if (last && !$('[data-f="cat"]', last).value.trim() && $$(".lr", last).length === 1 && isEmpty($(".lr", last))) { sec = last; $('[data-f="cat"]', sec).value = cat; }
      else { $("#cats", m).insertAdjacentHTML("beforeend", catBlock({ cat, lignes: [] })); sec = $$(".cat", m).pop(); $(".lb", sec).innerHTML = ""; }
    }
    const lb = $(".lb", sec);
    let tr = $$(".lr", lb).pop();
    if (!tr || !isEmpty(tr)) { lb.insertAdjacentHTML("beforeend", ligneRow({ taux_tva: l.taux_tva })); tr = $$(".lr", lb).pop(); }
    $('[data-f="des"]', tr).value = l.designation; $('[data-f="qte"]', tr).value = String(l.quantite).replace(".", ",");
    $('[data-f="uni"]', tr).value = l.unite; $('[data-f="pu"]', tr).value = l.prix_unitaire_ht ? String(l.prix_unitaire_ht).replace(".", ",") : "";
    if (l.taux_tva !== undefined) { const sel = $('[data-f="tva"]', tr), t = String(Number(l.taux_tva)); if (![...sel.options].some((x) => x.value === t)) sel.insertAdjacentHTML("beforeend", `<option value="${t}">${t.replace(".", ",")} %</option>`); sel.value = t; }
    if (l.id) cxFillFromOuvrage(m, tr, { id: l.id });
  }
  recalcLignes(m);
}

/* ---------- Branchement dans l'éditeur de devis ---------- */
function cxToolbar(K) {
  if (K !== "devis") return "";
  return `<button type="button" class="btn o sm" id="cximg">+ Image</button><button type="button" class="btn o sm" id="cxdict">Dictée vocale</button><button type="button" class="btn o sm" id="cxset">Coefficient de vente</button>`;
}
function cxEditorMount(m, K) {
  if (K !== "devis") return;
  m.addEventListener("click", (e) => {
    const t = e.target;
    if (t.closest("#cximg")) return cxAddImage(m);
    if (t.closest("#cxdict")) return cxDictee(m);
    if (t.closest("#cxset")) return cxSettings();
    const ap = t.closest('[data-cx="apply"]');
    if (ap) {
      const tr = ap.closest("tr"), p = Number(tr.dataset.cxprix);
      if (!p) return toast("Saisissez d'abord les déboursés.", "dn");
      $('[data-f="pu"]', tr).value = String(p).replace(".", ","); recalcLignes(m);
    }
  });
  m.addEventListener("change", (e) => { if (e.target.closest("details.cx")) recalcLignes(m); });
  document.addEventListener("cx-settings", () => { if (document.body.contains(m)) recalcLignes(m); });
  cxLoadImgs(m);
}
// Avenant : nouveau devis rattaché au devis d'origine, avec dictée
async function cxAvenant(id) {
  const d = byId(db.devis, id);
  if (!d) return;
  await docForm("devis", null, { client: d.client_id, chantier: d.chantier_id, lignes: [], notes: `Avenant au devis ${d.numero || ""} : travaux complémentaires.`, dictee: true });
}
const cxMargeDevis = (ls) => {
  let ca = 0, cout = 0, sans = 0;
  for (const l of ls) { if (!cxIncluded(l) && !(l.est_option && l.option_choisie)) continue; if (l.type_ligne === "image") continue; if (l.debourse_ht > 0) { const x = cxMargeOf(l); ca += x.ca; cout += x.cout; } else if (l.prix_unitaire_ht > 0) sans++; }
  return { ca, cout, m: ca - cout, pct: ca ? ((ca - cout) / ca) * 100 : 0, sans };
};

const chiffrageActions = {
  cxSettings: () => cxSettings(),
  cxComp: (id) => cxCompEditor(id),
  cxAvenant: (id) => cxAvenant(id),
};

async function loadV13() {
  const r = await sb.from("devis_lignes").select("est_option").limit(1);
  if (r.error) throw r.error;
  db.v13 = true;
}

/* ---------- Aides diverses ---------- */
// Lignes qu'on peut facturer : sans images ni options non retenues
const cxBillable = (ls) => ls.filter((l) => l.type_ligne !== "image" && (!l.est_option || l.option_choisie));
// Aperçu à l'écran : les images ne sont pas listées, les options sont repérées
const cxPreviewLignes = (ls) => ls.filter((l) => l.type_ligne !== "image").map((l) => (l.est_option ? { ...l, designation: `${l.designation} (option ${l.option_choisie ? "retenue" : "non retenue"})` } : l));
// Ligne de la fiche devis (page interne uniquement)
function cxDetailMarge(ls) {
  const x = cxMargeDevis(ls), opts = ls.filter((l) => l.est_option);
  let h = "";
  if (x.ca > 0) h += `<dt>Marge prévisionnelle</dt><dd><span class="${x.pct < 10 ? "neg" : ""}">${E2(x.m)} · ${fmtNum(x.pct, 1)} %</span><small class="mut"> (interne${x.sans ? ", " + x.sans + " ligne(s) sans déboursé" : ""})</small></dd>`;
  if (opts.length) h += `<dt>Options</dt><dd>${opts.filter((o) => o.option_choisie).length} retenue(s) sur ${opts.length}</dd>`;
  return h;
}
