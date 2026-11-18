/* Chantier « pro » (v17) : tableau de bord intelligent par chantier, journal de chantier (météo, effectifs, photos, rapport PDF),
   assistant IA intégré. S'appuie sur chFin (budgets), chRenta (marges, heures), pointages, rapports, terrain_photos. */

Object.assign(ic, {
  tbchantiers: "M4 20V10 M10 20V4 M16 20v-7 M22 20H2 M3 7l4-3 4 2 5-4",
  journal: "M5 3h12a2 2 0 012 2v16H7a2 2 0 01-2-2z M9 8h6 M9 12h6 M9 16h3",
  spark: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z",
  send: "M4 12l16-8-6 16-3-6z",
  cam: "M4 8h3l2-3h6l2 3h3v11H4z M12 17a3.5 3.5 0 100-7 3.5 3.5 0 000 7z",
  warn: "M12 3l10 18H2z M12 10v5 M12 18h.01",
});
if (typeof PAGE_PERM !== "undefined") PAGE_PERM.tbchantiers = "marges";

const setupV17 = () => `<div class="empty" style="padding:30px 20px"><h2>Une étape manque</h2><p style="max-width:560px;margin:6px auto 14px">Exécutez <b>migration_v17.sql</b> dans Supabase (SQL Editor), puis rechargez la page.${db.v17err ? `<br><br><small>Erreur renvoyée : <code>${esc(db.v17err)}</code></small>` : ""}</p></div>`;

async function loadV17() {
  db.v17 = false; db.jr = []; db.jph = [];
  try {
    const jr = await q(sb.from("journal_chantier").select("*").order("date_jour", { ascending: false }));
    jr.forEach((j) => { nz(j, ["temp_min", "temp_max", "vent_kmh", "pluie_mm"]); if (!Array.isArray(j.effectifs)) j.effectifs = []; });
    db.jph = await q(sb.from("terrain_photos").select("id,chantier_id,journal_id,phase,legende,created_at").not("journal_id", "is", null));
    (db.budgets || []).forEach((b) => nz(b, ["heures_prevues"]));
    db.jr = jr; db.v17 = true; db.v17err = "";
  } catch (e) { db.v17 = false; db.v17err = e?.message || String(e); }
}

/* =====================================================================
   1. TABLEAU DE BORD INTELLIGENT PAR CHANTIER
   ===================================================================== */
function chOverhead() {
  const since = addDays(today(), -365);
  const gen = sum(db.depenses.filter((d) => !d.chantier_id && d.type === "Dépense" && String(d.date_depense) >= since), (d) => d.montant_ht);
  const ca = sum(emises().filter((f) => String(f.date_emission || "") >= since), (f) => f.montant_ht);
  return { gen, ca, rate: ca > 0 ? Math.min(0.5, gen / ca) : 0 };
}
function chDashData(c) {
  const f = chFin(c), s = chStats(c), b = budgetOf(c.id), r = db.v12 && typeof chRenta === "function" ? chRenta(c) : null;
  const base = f.base, factureHT = s.factureHT, couts = r ? r.couts : f.reel, budget = f.budget, engage = f.engage, used = r2(couts + engage);
  const hPrev = Number(b?.heures_prevues) || 0, hReal = r ? r.heures : 0;
  const margeBrute = r2(factureHT - couts), pctBrute = factureHT > 0 ? Math.round((margeBrute / factureHT) * 100) : null;
  const oh = chOverhead(), fraisAlloues = r2(factureHT * oh.rate), margeNette = r2(margeBrute - fraisAlloues), pctNette = factureHT > 0 ? Math.round((margeNette / factureHT) * 100) : null;
  const reste = Math.max(0, r2(base - factureHT)), factPct = pc(factureHT, base), avance = Number(c.avancement) || 0;
  const alerts = [];
  const add = (lv, t, d) => alerts.push({ lv, t, d });
  if (budget > 0) {
    const p = pc(used, budget);
    if (used > budget + 0.005) add("dn", "Budget dépassé", `${E(r2(used - budget))} au-dessus du budget (${p} % consommé, engagements compris).`);
    else if (p >= 90) add("wn", "Budget presque épuisé", `${p} % du budget déjà consommé pour ${avance} % d'avancement.`);
    else if (avance > 0 && p > avance + 20) add("wn", "Coûts en avance sur le chantier", `${p} % du budget consommé pour ${avance} % d'avancement.`);
    f.depass.forEach((x) => add("dn", `${x.l} au-dessus du budget`, `+${E(x.ecart)} (${x.pct} %).`));
  }
  if (hPrev > 0) {
    const p = pc(hReal, hPrev);
    if (hReal > hPrev + 0.01) add("dn", "Heures dépassées", `${hn(hReal)} pointées pour ${hn(hPrev)} prévues (+${hn(hReal - hPrev)}).`);
    else if (p >= 90) add("wn", "Heures presque consommées", `${p} % des heures prévues déjà pointées.`);
  }
  if (factureHT > 0 && margeBrute < 0) add("dn", "Chantier déficitaire", `Les coûts dépassent le facturé de ${E(-margeBrute)}.`);
  else if (pctNette !== null && pctNette >= 0 && pctNette < 5 && factureHT > 0) add("wn", "Marge nette très faible", `${pctNette} % après frais généraux.`);
  if (base > 0 && avance - factPct >= 15 && c.statut !== "Terminé") add("wn", "Retard de facturation", `${avance} % d'avancement mais ${factPct} % facturé : ${E(r2((base * (avance - factPct)) / 100))} à facturer.`);
  if (c.date_fin && c.statut !== "Terminé" && c.date_fin < today()) add("wn", "Date de fin dépassée", `Fin prévue le ${D(c.date_fin)}.`);
  if (!budget && c.statut !== "Terminé") add("n", "Budget non défini", "Définissez le budget pour activer les alertes de dépassement.");
  const verdict = factureHT <= 0 ? (f.has ? { l: "Prévisionnel", c: "n", p: pc(f.margePrev, base) } : { l: "À évaluer", c: "n", p: null })
    : pctNette >= 15 ? { l: "Rentable", c: "ok", p: pctNette } : pctNette >= 0 ? { l: "Fragile", c: "wn", p: pctNette } : { l: "Déficitaire", c: "dn", p: pctNette };
  const rank = alerts.reduce((m, a) => Math.max(m, a.lv === "dn" ? 3 : a.lv === "wn" ? 2 : 1), 0);
  return { f, s, base, factureHT, couts, budget, engage, used, hPrev, hReal, margeBrute, pctBrute, margeNette, pctNette, fraisAlloues, oh, reste, factPct, avance, alerts, verdict, rank };
}
const dashBar = (p) => `<div class="dbar"><i class="${p > 100 ? "dn" : p >= 90 ? "wn" : ""}" style="width:${Math.min(Math.max(p, 0), 100)}%"></i></div>`;
function chDashHtml(c) {
  const marges = typeof permOk !== "function" || permOk("marges");
  const d = chDashData(c), pb = d.budget > 0 ? pc(d.used, d.budget) : 0, ph = d.hPrev > 0 ? pc(d.hReal, d.hPrev) : 0;
  const alerts = d.alerts.length
    ? d.alerts.map((a) => `<div class="al lv-${a.lv}"><span class="ai">${svg(ic.warn)}</span><div><b>${esc(a.t)}</b><span>${esc(a.d)}</span></div></div>`).join("")
    : `<div class="al lv-ok"><span class="ai">${svg("M5 13l4 4L19 7")}</span><div><b>Aucune alerte</b><span>Budget, heures et marge sont dans les prévisions.</span></div></div>`;
  const kpi = (t, v, sub, extra = "", cls = "") => `<div class="kpi ${cls ? "lv-" + cls : ""}"><small>${t}</small><b class="num">${v}</b><span>${sub}</span>${extra}</div>`;
  const hid = `<div class="kpi"><small>Marges</small><b>•••</b><span>accès limité</span></div>`;
  return `<div class="dsh"><div class="dsh-h"><div><h2>Tableau de bord du chantier</h2><span class="mut">Mis à jour avec vos dépenses, pointages et factures</span></div>
      <span class="verdict v-${d.verdict.c}">${marges ? `${d.verdict.l}${d.verdict.p !== null ? ` · ${d.verdict.p} %` : ""}` : "•••"}</span></div>
    ${marges ? `<div class="als">${alerts}</div>` : ""}
    <div class="kpis">
      ${marges ? kpi("Budget prévu / dépenses réelles", d.budget ? `${E(d.used)} <em>/ ${E(d.budget)}</em>` : `${E(d.used)}`, d.budget ? `${pb} % du budget consommé${d.engage ? ` · dont ${E(d.engage)} engagés` : ""}` : "budget non défini", d.budget ? dashBar(pb) : "", d.budget && d.used > d.budget ? "dn" : "") : hid}
      ${marges ? kpi("Marge brute", d.factureHT ? E(d.margeBrute) : "-", d.factureHT ? `${d.pctBrute} % du facturé · facturé − coûts directs` : d.f.has ? `prévue ${E(d.f.margePrev)}` : "rien de facturé", "", d.margeBrute < 0 ? "dn" : "") : hid}
      ${marges ? kpi("Marge nette", d.factureHT ? E(d.margeNette) : "-", d.factureHT ? `${d.pctNette} % · après ${E(d.fraisAlloues)} de frais généraux (${Math.round(d.oh.rate * 100)} % du CA)` : "après frais généraux", "", d.factureHT && d.margeNette < 0 ? "dn" : "") : hid}
      ${kpi("Heures prévues / réalisées", d.hPrev ? `${hn(d.hReal)} <em>/ ${hn(d.hPrev)}</em>` : hn(d.hReal), d.hPrev ? `${ph} % des heures prévues` : "heures prévues non définies", d.hPrev ? dashBar(ph) : "", d.hPrev && d.hReal > d.hPrev ? "dn" : "")}
      ${kpi("Reste à facturer", d.base ? E(d.reste) : "-", d.base ? `${d.factPct} % facturé sur ${E(d.base)} · avancement ${d.avance} %` : "montant du marché non défini", d.base ? dashBar(d.factPct) : "")}
      ${marges ? kpi("Rentabilité globale", d.verdict.p !== null ? `${d.verdict.p} %` : "-", `<span class="chip ${d.verdict.c}">${d.verdict.l}</span> ${d.factureHT ? "marge nette sur facturé" : "marge prévue sur marché"}`) : hid}
    </div></div>`;
}
function chDashMini(c) {
  const d = chDashData(c), marges = typeof permOk !== "function" || permOk("marges");
  const pb = d.budget > 0 ? pc(d.used, d.budget) : 0, ph = d.hPrev > 0 ? pc(d.hReal, d.hPrev) : 0;
  const top = d.alerts.filter((a) => a.lv !== "n")[0];
  return `<a class="dmini ${d.rank === 3 ? "lv-dn" : d.rank === 2 ? "lv-wn" : ""}" href="#/chantiers/${c.id}">
    <div class="dm-h"><div><b>${esc(c.nom)}</b><small>${esc(c.client_nom || "")}${c.ville ? " · " + esc(c.ville) : ""}</small></div>${chip(c.statut)}</div>
    ${marges ? `<div class="dm-r"><small>Budget</small>${d.budget ? dashBar(pb) : '<span class="mut">non défini</span>'}<span class="num">${d.budget ? pb + " %" : ""}</span></div>` : ""}
    <div class="dm-r"><small>Heures</small>${d.hPrev ? dashBar(ph) : '<span class="mut">non défini</span>'}<span class="num">${d.hPrev ? ph + " %" : hn(d.hReal)}</span></div>
    <div class="dm-r"><small>Facturé</small>${d.base ? dashBar(d.factPct) : '<span class="mut">-</span>'}<span class="num">${d.base ? d.factPct + " %" : ""}</span></div>
    <div class="dm-f">${marges ? `<span class="verdict v-${d.verdict.c}">${d.verdict.l}${d.verdict.p !== null ? ` · ${d.verdict.p} %` : ""}</span>` : "<span></span>"}<span class="num">${d.base ? "reste " + E(d.reste) : ""}</span></div>
    ${top && marges ? `<div class="dm-a lv-${top.lv}">${svg(ic.warn)}<span>${esc(top.t)}</span></div>` : ""}</a>`;
}
V.tbchantiers = () => {
  const f = ST.tbF || "actifs", L = db.chantiers.filter((c) => f === "tous" || c.statut !== "Terminé").map((c) => ({ c, d: chDashData(c) })).sort((a, b) => b.d.rank - a.d.rank || (b.d.base || 0) - (a.d.base || 0));
  const marges = typeof permOk !== "function" || permOk("marges");
  const nbAl = L.filter((x) => x.d.rank >= 2).length, reste = sum(L, (x) => x.d.reste), fact = sum(L, (x) => x.d.factureHT), mn = sum(L, (x) => x.d.margeNette);
  const hs = sum(L, (x) => x.d.hReal);
  return page("Tableau de bord chantiers", "Budget, marges, heures et alertes de chaque chantier, les plus à risque en premier.",
    `<div class="seg">${[["actifs", "En cours"], ["tous", "Tous"]].map(([k, l]) => `<button data-act="tbFilter" data-arg="${k}" aria-pressed="${f === k}">${l}</button>`).join("")}</div>`,
    strip([["Chantiers", String(L.length), f === "actifs" ? "en cours" : "au total"], ["À surveiller", String(nbAl), nbAl ? "alertes budget, heures ou marge" : "tout est dans les prévisions", nbAl ? "dn" : ""],
      ["Reste à facturer", E(reste), "sur le marché des chantiers"], marges ? ["Marge nette", E(mn), fact ? Math.round((mn / fact) * 100) + " % du facturé" : "rien de facturé", mn < 0 ? "dn" : ""] : ["Heures pointées", hn(hs), ""]]) +
    (L.length ? `<div class="dgrid">${L.map((x) => chDashMini(x.c)).join("")}</div>` : `<div class="empty"><h2>Aucun chantier</h2><p>Créez un chantier pour suivre son budget et sa rentabilité.</p><button class="btn" data-go="chantiers">Aller aux chantiers</button></div>`));
};

/* =====================================================================
   2. JOURNAL DE CHANTIER
   ===================================================================== */
const JR_PHASES = [["avant", "Avant"], ["pendant", "Pendant"], ["apres", "Après"]];
const JR_COND = ["Normales", "Difficiles", "Arrêt intempéries"];
const jrChNom = (id) => byId(db.chantiers, id)?.nom || "?";
const jrDateLong = (iso) => { const d = new Date(iso + "T12:00:00"); const t = d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }); return t.charAt(0).toUpperCase() + t.slice(1); };
const jrPhotos = (id) => (db.jph || []).filter((p) => p.journal_id === id);
const WMO = { 0: "Ciel dégagé", 1: "Plutôt dégagé", 2: "Partiellement nuageux", 3: "Couvert", 45: "Brouillard", 48: "Brouillard givrant", 51: "Bruine légère", 53: "Bruine", 55: "Bruine forte", 56: "Bruine verglaçante", 57: "Bruine verglaçante",
  61: "Pluie faible", 63: "Pluie", 65: "Pluie forte", 66: "Pluie verglaçante", 67: "Pluie verglaçante", 71: "Neige faible", 73: "Neige", 75: "Neige forte", 77: "Grains de neige", 80: "Averses faibles", 81: "Averses", 82: "Averses violentes",
  85: "Averses de neige", 86: "Averses de neige", 95: "Orage", 96: "Orage et grêle", 99: "Orage et grêle" };

// Météo gratuite (Open-Meteo, sans clé) : géocode la ville du chantier puis lit la journée demandée
async function jrWeather(c, date) {
  const place = (c.ville || c.adresse || "").replace(/^\d{5}\s*/, "").trim();
  if (!place) throw new Error("Renseignez la ville du chantier pour récupérer la météo.");
  const gj = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1&language=fr&countryCode=FR`)).json();
  const g = gj.results?.[0];
  if (!g) throw new Error(`Ville introuvable : « ${place} ».`);
  const qs = `latitude=${g.latitude}&longitude=${g.longitude}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max&timezone=auto&start_date=${date}&end_date=${date}`;
  let j = await (await fetch(`https://api.open-meteo.com/v1/forecast?${qs}`)).json();
  if (j.error || !j.daily?.time?.length) j = await (await fetch(`https://archive-api.open-meteo.com/v1/archive?${qs}`)).json();
  const dd = j.daily;
  if (!dd?.time?.length) throw new Error("Météo indisponible pour cette date.");
  const out = { meteo: WMO[dd.weather_code[0]] || "Variable", temp_min: dd.temperature_2m_min[0], temp_max: dd.temperature_2m_max[0], pluie_mm: dd.precipitation_sum[0], vent_kmh: Math.round(dd.wind_speed_10m_max[0]) };
  out.conditions = out.pluie_mm >= 8 || out.vent_kmh >= 60 || out.temp_max <= 0 || out.temp_max >= 35 || (dd.weather_code[0] || 0) >= 95 ? "Difficiles" : "Normales";
  return out;
}
const jrCompress = (file, max = 1400) => new Promise((ok, ko) => {
  const img = new Image(), u = URL.createObjectURL(file);
  img.onload = () => { const sc = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement("canvas"); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(u); ok(c.toDataURL("image/jpeg", 0.75)); };
  img.onerror = () => ko(new Error("Photo illisible : " + file.name));
  img.src = u;
});
// Effectifs proposés d'après les pointages et temps saisis ce jour-là sur le chantier
function jrEffectifsAuto(chId, date) {
  const m = new Map();
  (db.ptg || []).filter((p) => p.chantier_id === chId && p.date_travail === date && p.statut !== "Refusé").forEach((p) => m.set(salNm(p.salarie_id), (m.get(salNm(p.salarie_id)) || 0) + Number(p.heures)));
  (db.tps || []).filter((t) => t.chantier_id === chId && t.date_travail === date && !m.has(t.intervenant) && !(db.ptg || []).some((p) => p.temps_id === t.id)).forEach((t) => m.set(t.intervenant, (m.get(t.intervenant) || 0) + Number(t.heures)));
  return [...m].map(([nom, heures]) => ({ nom, heures }));
}
function jrTravauxAuto(chId, date) {
  const L = [];
  (db.rap || []).filter((r) => r.chantier_id === chId && r.date_intervention === date).forEach((r) => { if (r.travaux || r.objet) L.push(r.travaux || r.objet); });
  (db.ptg || []).filter((p) => p.chantier_id === chId && p.date_travail === date && p.description).forEach((p) => L.push(`${salNm(p.salarie_id)} : ${p.description}`));
  return [...new Set(L)].join("\n");
}

V.journal = (r) => {
  if (!db.v17) return page("Journal de chantier", "Le carnet de bord quotidien de vos chantiers.", "", card("", setupV17()));
  const act = db.chantiers.filter((c) => c.statut !== "Terminé"), all = db.chantiers;
  const cur = ST.jrC ?? (r.qs.get("c") || act[0]?.id || all[0]?.id || "");
  const L = db.jr.filter((j) => !cur || j.chantier_id === cur);
  const sel = `<select data-chg="jrCh" aria-label="Chantier" style="max-width:320px">${[{ v: "", l: "Tous les chantiers" }, ...all.map((c) => ({ v: c.id, l: c.nom }))].map((o) => `<option value="${esc(o.v)}"${o.v === cur ? " selected" : ""}>${esc(o.l)}</option>`).join("")}</select>`;
  const rows = L.map((j) => {
    const ph = jrPhotos(j.id).length, h = sum(j.effectifs, (x) => x.heures);
    const c = [`<strong>${D(j.date_jour)}</strong><small>${jrDateLong(j.date_jour).split(" ")[0]}</small>`];
    if (!cur) c.push(esc(jrChNom(j.chantier_id)));
    c.push(`${esc(j.meteo || "-")}${j.temp_max != null ? `<small>${Math.round(j.temp_min)}° / ${Math.round(j.temp_max)}°</small>` : ""}`,
      `${j.effectifs.length} pers.<small>${hn(h)}</small>`, `<span class="jr-t">${esc((j.travaux || "").slice(0, 110))}${(j.travaux || "").length > 110 ? "…" : ""}</span>`,
      `${ph ? `<span class="chip n">${ph} photo${ph > 1 ? "s" : ""}</span> ` : ""}${j.incidents ? `<span class="chip dn">Incident</span>` : ""}${j.conditions !== "Normales" ? `<span class="chip wn">${esc(j.conditions)}</span>` : ""}`,
      `<button class="lk w" data-act="jrPdf" data-id="${j.id}">PDF</button>`);
    return { act: "jrOpen", id: j.id, t: `${jrChNom(j.chantier_id)} ${j.travaux || ""}`, c };
  });
  const cols = ["Jour", ...(cur ? [] : ["Chantier"]), "Météo", "Équipe", "Travaux réalisés", "Notes", ""];
  const hasToday = cur && db.jr.some((j) => j.chantier_id === cur && j.date_jour === today());
  return page("Journal de chantier", "Météo, équipe présente, travaux du jour, incidents et photos : un rapport PDF en un clic.",
    btn(hasToday ? "Compléter aujourd'hui" : "Entrée du jour", "jrNew", cur, today(), "w") + btn("Autre date", "jrNew", cur, "", "o w"),
    `<div class="sr" style="justify-content:flex-start">${sel}<span class="cnt">${L.length} entrée${L.length > 1 ? "s" : ""}</span></div>` +
    card("", tbl(cols, rows, "Aucune entrée. Cliquez sur « Entrée du jour » : la météo, l'équipe et les travaux sont pré-remplis.")));
};

function jrForm(j, init = {}) {
  if (!guard()) return;
  if (!db.v17) return toast("Exécutez d'abord migration_v17.sql dans Supabase.", "dn");
  const chId = j?.chantier_id || init.chantier_id || ST.jrC || db.chantiers.find((c) => c.statut !== "Terminé")?.id || db.chantiers[0]?.id;
  if (!chId) return toast("Créez d'abord un chantier.", "dn");
  const date0 = j?.date_jour || init.date || today();
  const ex = j || db.jr.find((x) => x.chantier_id === chId && x.date_jour === date0);
  const v = ex || { chantier_id: chId, date_jour: date0, conditions: "Normales", effectifs: jrEffectifsAuto(chId, date0), travaux: jrTravauxAuto(chId, date0) };
  const pending = []; // photos ajoutées dans cette fenêtre : { phase, data, legende }
  const num = (x) => (x == null ? "" : String(x).replace(".", ","));
  const edc = (t, inner, cls = "") => `<section class="edc ${cls}"><h3>${t}</h3>${inner}</section>`;
  const effRow = (e = {}) => `<div class="efr"><input type="text" data-e="nom" value="${esc(e.nom || "")}" placeholder="Nom" aria-label="Nom"><input type="text" inputmode="decimal" data-e="h" value="${num(e.heures)}" placeholder="Heures" aria-label="Heures"><button type="button" class="rm" data-effrm aria-label="Retirer">${svg(ic.x)}</button></div>`;
  const phCol = ([k, l]) => `<div class="phc" data-ph="${k}"><div class="phc-h"><b>${l}</b><label class="btn o sm" style="margin:0">${svg(ic.cam)} Ajouter<input type="file" accept="image/*" multiple hidden data-addph="${k}"></label></div><div class="phc-g" data-grid="${k}"></div></div>`;
  const body = `<div class="ed jr">
    <div class="ed-top">
      ${edc("Chantier et date", `<div class="frm1">${fld({ k: "chantier_id", l: "Chantier", t: "select", o: db.chantiers.map((c) => ({ v: c.id, l: c.nom })), v: v.chantier_id })}${fld({ k: "date_jour", l: "Jour", t: "date", v: v.date_jour })}</div>`)}
      ${edc("Météo et conditions", `<div class="frm1"><button type="button" class="btn o sm" id="jrMeteo">${svg(ic.spark)} Récupérer la météo du jour</button><span class="mut" id="jrMeteoMsg" style="font-size:12.5px"></span>
        <div class="frm">${fld({ k: "meteo", l: "Météo", v: v.meteo || "", r: 0, cls: "full" })}${fld({ k: "temp_min", l: "Temp. min (°C)", t: "number", v: num(v.temp_min), r: 0 })}${fld({ k: "temp_max", l: "Temp. max (°C)", t: "number", v: num(v.temp_max), r: 0 })}
        ${fld({ k: "vent_kmh", l: "Vent max (km/h)", t: "number", v: num(v.vent_kmh), r: 0 })}${fld({ k: "pluie_mm", l: "Pluie (mm)", t: "number", v: num(v.pluie_mm), r: 0 })}${fld({ k: "conditions", l: "Conditions de travail", t: "select", o: JR_COND, v: v.conditions || "Normales", cls: "full" })}</div></div>`)}
    </div>
    ${edc("Effectifs présents", `<div id="effl">${(v.effectifs.length ? v.effectifs : [{}]).map(effRow).join("")}</div><div class="edtools"><button type="button" class="btn o sm" id="effadd">+ Personne</button><button type="button" class="btn o sm" id="effauto">Pré-remplir avec les pointages du jour</button><span class="mut" id="efftot" style="margin-left:auto"></span></div>`)}
    <div class="ed-top">
      ${edc("Travaux réalisés", fld({ k: "travaux", l: "Ce qui a été fait aujourd'hui", t: "textarea", rows: 6, v: v.travaux || "", r: 0, cls: "full" }))}
      ${edc("Incidents et observations", `<div class="frm1">${fld({ k: "incidents", l: "Incidents (retard, accident, dégât, livraison manquante…)", t: "textarea", rows: 3, v: v.incidents || "", r: 0 })}${fld({ k: "observations", l: "Observations (client, sécurité, points à suivre)", t: "textarea", rows: 3, v: v.observations || "", r: 0 })}</div>`)}
    </div>
    ${edc("Photos avant / pendant / après", `<div class="phs">${JR_PHASES.map(phCol).join("")}</div>`)}
  </div>`;
  const dlKey = "pilot-jr-pdf";
  let dl = true; try { dl = localStorage.getItem(dlKey) !== "0"; } catch (e) {}
  modal(ex ? `Journal du ${D(v.date_jour)}` : "Nouvelle entrée de journal", body, {
    xl: true, wide: true, submit: "Enregistrer", noFocus: true,
    extra: `<label class="jr-dl"><input type="checkbox" id="jrDl"${dl ? " checked" : ""}> Générer le rapport PDF à l'enregistrement</label>`,
    onMount: (m) => {
      const tot = () => { const h = sum($$(".efr", m), (r) => parseNum($('[data-e="h"]', r).value)), n = $$(".efr", m).filter((r) => $('[data-e="nom"]', r).value.trim()).length; $("#efftot", m).textContent = `${n} personne${n > 1 ? "s" : ""} · ${hn(h)}`; };
      const grid = () => JR_PHASES.forEach(([k]) => {
        const old = ex ? jrPhotos(ex.id).filter((p) => p.phase === k) : [], g = $(`[data-grid="${k}"]`, m);
        g.innerHTML = old.map((p) => `<figure><img data-jph="${p.id}" alt=""><button type="button" class="rm" data-jphdel="${p.id}" aria-label="Supprimer la photo">${svg(ic.x)}</button></figure>`).join("")
          + pending.map((p, i) => (p.phase === k ? `<figure><img src="${p.data}" alt=""><button type="button" class="rm" data-pdel="${i}" aria-label="Retirer la photo">${svg(ic.x)}</button></figure>` : "")).join("");
        if (!old.length && !pending.some((p) => p.phase === k)) g.innerHTML = `<p class="mut" style="margin:0;font-size:12.5px">Aucune photo</p>`;
      });
      grid(); tot();
      (async () => { for (const im of $$("img[data-jph]", m)) { try { im.src = (await q(sb.from("terrain_photos").select("data").eq("id", im.dataset.jph).single())).data; } catch (e) { /* ignorée */ } } })();
      m.addEventListener("input", (e) => { if (e.target.closest(".efr")) tot(); });
      m.addEventListener("click", async (e) => {
        const t = e.target;
        if (t.closest("#effadd")) { $("#effl", m).insertAdjacentHTML("beforeend", effRow({})); $$('[data-e="nom"]', m).pop().focus(); }
        const rm = t.closest("[data-effrm]"); if (rm) { if ($$(".efr", m).length > 1) rm.closest(".efr").remove(); else $$("input", rm.closest(".efr")).forEach((i) => (i.value = "")); tot(); }
        if (t.closest("#effauto")) { const a = jrEffectifsAuto($("#f_chantier_id", m).value, $("#f_date_jour", m).value); if (!a.length) return toast("Aucun pointage ce jour-là sur ce chantier.", ""); $("#effl", m).innerHTML = a.map(effRow).join(""); tot(); }
        const pd = t.closest("[data-pdel]"); if (pd) { pending.splice(+pd.dataset.pdel, 1); grid(); }
        const jd = t.closest("[data-jphdel]");
        if (jd && confirm("Supprimer cette photo ?")) { try { await q(sb.from("terrain_photos").delete().eq("id", jd.dataset.jphdel)); db.jph = db.jph.filter((p) => p.id !== jd.dataset.jphdel); grid(); } catch (err) { toast(esc(friendly(err)), "dn"); } }
        if (t.closest("#jrMeteo")) {
          const c = byId(db.chantiers, $("#f_chantier_id", m).value), msg = $("#jrMeteoMsg", m);
          msg.textContent = "Recherche de la météo…";
          try { const w = await jrWeather(c, $("#f_date_jour", m).value); Object.entries(w).forEach(([k, val]) => { const el = $(`#f_${k}`, m); if (el) el.value = typeof val === "number" ? String(val).replace(".", ",") : val; }); msg.textContent = "Météo remplie (source Open-Meteo). Vous pouvez la corriger."; }
          catch (err) { msg.textContent = ""; toast(esc(err.message || "Météo indisponible"), "dn"); }
        }
      });
      m.addEventListener("change", async (e) => {
        const f = e.target;
        if (f.dataset?.addph) {
          const ph = f.dataset.addph;
          for (const file of [...f.files]) { try { pending.push({ phase: ph, data: await jrCompress(file), legende: "" }); } catch (err) { toast(esc(err.message), "dn"); } }
          f.value = ""; grid();
        }
        if (f.id === "f_chantier_id" || f.id === "f_date_jour") { // nouvelle cible : on propose l'équipe et les travaux du jour si les champs sont vides
          const c = $("#f_chantier_id", m).value, d = $("#f_date_jour", m).value;
          if (!ex && !$$('[data-e="nom"]', m).some((i) => i.value.trim())) { const a = jrEffectifsAuto(c, d); if (a.length) { $("#effl", m).innerHTML = a.map(effRow).join(""); tot(); } }
          if (!ex && !$("#f_travaux", m).value.trim()) $("#f_travaux", m).value = jrTravauxAuto(c, d);
        }
      });
    },
    onSubmit: async (f, api) => {
      if (!f.chantier_id || !f.date_jour) throw new Error("Choisissez le chantier et le jour.");
      const eff = $$(".efr", api.el).map((r) => ({ nom: $('[data-e="nom"]', r).value.trim(), heures: parseNum($('[data-e="h"]', r).value) })).filter((x) => x.nom);
      const n = (x) => (String(x ?? "").trim() === "" ? null : parseNum(x));
      const row = { chantier_id: f.chantier_id, date_jour: f.date_jour, meteo: f.meteo || null, temp_min: n(f.temp_min), temp_max: n(f.temp_max), vent_kmh: n(f.vent_kmh), pluie_mm: n(f.pluie_mm), conditions: f.conditions || "Normales",
        effectifs: eff, travaux: f.travaux || null, incidents: f.incidents || null, observations: f.observations || null, updated_at: new Date().toISOString() };
      const saved = await q(sb.from("journal_chantier").upsert(row, { onConflict: "chantier_id,date_jour" }).select("id").single());
      for (const p of pending) await q(sb.from("terrain_photos").insert({ chantier_id: f.chantier_id, journal_id: saved.id, phase: p.phase, legende: p.legende || null, data: p.data }));
      const wantPdf = $("#jrDl", api.el).checked;
      try { localStorage.setItem(dlKey, wantPdf ? "1" : "0"); } catch (e) {}
      api.close(); ST.jrC = f.chantier_id;
      toast(ex ? "Journal mis à jour." : "Entrée de journal enregistrée.", "ok");
      await refresh();
      if (wantPdf) jrDownload(saved.id);
    },
  });
}
async function jrDownload(id) {
  const j = byId(db.jr, id);
  if (!j) return;
  try { toast("Génération du rapport PDF…"); downloadBlob(`journal-${slug(jrChNom(j.chantier_id))}-${j.date_jour}.pdf`, new Blob([await jrPdf(j)], { type: "application/pdf" })); }
  catch (e) { console.error(e); toast("PDF impossible : " + esc(friendly(e)), "dn"); }
}
function jrChantierCard(id) {
  if (!db.v17) return "";
  const L = db.jr.filter((j) => j.chantier_id === id).slice(0, 5);
  return card("Journal de chantier", L.length ? L.map((j) => `<div class="row lnk" data-act="jrOpen" data-id="${j.id}" style="cursor:pointer"><div><b>${D(j.date_jour)}</b><small>${esc((j.travaux || "Sans détail").slice(0, 70))}</small></div><span>${j.incidents ? '<span class="chip dn">Incident</span>' : ""}${jrPhotos(j.id).length ? `<span class="chip n">${jrPhotos(j.id).length} 📷</span>` : ""}</span></div>`).join("")
    : `<p class="mut" style="margin:0;padding:14px 18px">Aucune entrée pour l'instant.</p>`, btn("Entrée du jour", "jrNew", id, today(), "sm w") + ` <a class="lk" href="#/journal?c=${id}" onclick="ST.jrC='${id}'">Tout voir</a>`);
}

/* ---------- Rapport PDF quotidien ---------- */
async function jrPdf(j) {
  await loadScript(LIBS.pdflib);
  const { PDFDocument, StandardFonts, rgb } = window.PDFLib, pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const e = db.ent, c = byId(db.chantiers, j.chantier_id) || {}, cl = clientOf(c.client_id) || {};
  const W = 595.28, H = 841.89, ML = 42, CW = W - 2 * ML, cc = PilotPdf.clean;
  const hx = /^#?([0-9a-f]{6})$/i.exec((e.pdf_reglages || {}).couleur || "") || [0, "243b53"], nn = parseInt(hx[1], 16), acc = [(nn >> 16) / 255, ((nn >> 8) & 255) / 255, (nn & 255) / 255];
  const A = rgb(...acc), ASoft = rgb(...acc.map((x) => x * 0.08 + 0.92)), INK = rgb(0.1, 0.11, 0.13), GREY = rgb(0.4, 0.42, 0.45), LINE = rgb(0.84, 0.85, 0.87), BORD = rgb(0.68, 0.71, 0.76), RED = rgb(0.7, 0.25, 0.2);
  let logo = null;
  try { if (e.logo_path) { const b = await getAsset(e.logo_path), t = sniff(b); logo = t === "png" ? await pdf.embedPng(b) : t === "jpg" ? await pdf.embedJpg(b) : null; } } catch (er) { /* logo facultatif */ }
  let page, y;
  const txt = (s, x, yy, { size = 9.5, f = font, color = INK, right = false } = {}) => { s = cc(s); const w = f.widthOfTextAtSize(s, size); page.drawText(s, { x: right ? x - w : x, y: yy, size, font: f, color }); };
  const wrap = (t, f, size, maxW) => { const out = []; for (const para of cc(t).split("\n")) { let line = ""; for (const w of para.split(" ")) { const x = line ? line + " " + w : w; if (f.widthOfTextAtSize(x, size) <= maxW || !line) line = x; else { out.push(line); line = w; } } out.push(line); } return out; };
  const newPage = (first) => { page = pdf.addPage([W, H]); page.drawRectangle({ x: 0, y: H - 5, width: W, height: 5, color: A }); y = H - 42; if (!first) { txt(`Journal de chantier - ${c.nom || ""} - ${D(j.date_jour)} (suite)`, ML, y, { size: 8.5, color: GREY }); y -= 24; } };
  const need = (h) => { if (y - h < 70) newPage(false); };
  const label = (t) => { need(30); txt(t.toUpperCase(), ML, y - 8, { size: 7.5, f: bold, color: A }); y -= 18; };
  newPage(true);
  // En-tête
  let hy = y;
  if (logo) { const s = Math.min(150 / logo.width, 50 / logo.height, 1); page.drawImage(logo, { x: ML, y: hy - logo.height * s + 8, width: logo.width * s, height: logo.height * s }); hy -= logo.height * s + 6; } else { txt(e.nom || "Votre entreprise", ML, hy - 6, { size: 15, f: bold }); hy -= 22; }
  for (const l of [logo ? e.nom : null, e.adresse, [e.telephone, e.email].filter(Boolean).join("  -  ")].filter(Boolean)) { txt(l, ML, hy - 4, { size: 8.5, color: GREY }); hy -= 11.5; }
  txt("RAPPORT JOURNALIER", W - ML, y - 10, { size: 20, f: bold, color: A, right: true });
  txt(jrDateLong(j.date_jour), W - ML, y - 30, { size: 11, f: bold, right: true });
  y = Math.min(hy, y - 36) - 14;
  page.drawLine({ start: { x: ML, y }, end: { x: W - ML, y }, thickness: 0.8, color: LINE }); y -= 16;
  // Chantier + client
  txt("CHANTIER", ML, y - 8, { size: 7.5, f: bold, color: A }); txt(c.nom || "-", ML, y - 24, { size: 11.5, f: bold });
  let cy = y - 38;
  for (const l of [[c.adresse, c.ville].filter(Boolean).join(", "), cl.nom ? "Client : " + cl.nom : ""].filter(Boolean)) { txt(l, ML, cy, { size: 9, color: GREY }); cy -= 12.5; }
  const h = sum(j.effectifs, (x) => x.heures);
  [["Équipe présente", `${j.effectifs.length} pers. - ${hn(h)}`], ["Conditions de travail", j.conditions || "Normales"], ["Photos", String(jrPhotos(j.id).length)]].forEach(([k, v], i) => {
    const ky = y - 8 - i * 20, kx = W - ML - 215; page.drawLine({ start: { x: kx, y: ky - 7 }, end: { x: W - ML, y: ky - 7 }, thickness: 0.4, color: LINE });
    txt(k, kx, ky - 3, { size: 8.5, color: GREY }); txt(v, W - ML, ky - 3, { size: 9.5, f: bold, right: true, color: k === "Conditions de travail" && v !== "Normales" ? RED : INK });
  });
  y = Math.min(cy, y - 8 - 3 * 20 + 8) - 14;
  // Météo (4 cases)
  label("Météo");
  const cells = [["Ciel", j.meteo || "-"], ["Températures", j.temp_min != null || j.temp_max != null ? `${j.temp_min != null ? Math.round(j.temp_min) : "?"}° / ${j.temp_max != null ? Math.round(j.temp_max) : "?"}°C` : "-"], ["Vent max", j.vent_kmh != null ? `${Math.round(j.vent_kmh)} km/h` : "-"], ["Précipitations", j.pluie_mm != null ? `${String(j.pluie_mm).replace(".", ",")} mm` : "-"]];
  const cw = CW / 4; page.drawRectangle({ x: ML, y: y - 38, width: CW, height: 38, color: ASoft, borderColor: BORD, borderWidth: 0.6 });
  cells.forEach(([k, v], i) => { if (i) page.drawLine({ start: { x: ML + i * cw, y }, end: { x: ML + i * cw, y: y - 38 }, thickness: 0.6, color: BORD }); txt(k, ML + i * cw + 9, y - 14, { size: 7.5, color: GREY }); txt(v, ML + i * cw + 9, y - 29, { size: 10, f: bold }); });
  y -= 54;
  // Effectifs (tableau cadrillé)
  label("Effectifs présents");
  const rows = j.effectifs.length ? j.effectifs : [{ nom: "Aucun effectif renseigné", heures: null }];
  need(24 + rows.length * 20);
  const cx = [ML, ML + CW - 110, ML + CW];
  page.drawRectangle({ x: ML, y: y - 22, width: CW, height: 22, color: ASoft, borderColor: BORD, borderWidth: 0.6 }); txt("Nom", ML + 8, y - 15, { size: 8.5, f: bold, color: A }); txt("Heures", ML + CW - 8, y - 15, { size: 8.5, f: bold, color: A, right: true }); page.drawLine({ start: { x: cx[1], y }, end: { x: cx[1], y: y - 22 }, thickness: 0.6, color: BORD }); y -= 22;
  for (const r of rows) { need(22); page.drawRectangle({ x: ML, y: y - 20, width: CW, height: 20, borderColor: BORD, borderWidth: 0.4 }); page.drawLine({ start: { x: cx[1], y }, end: { x: cx[1], y: y - 20 }, thickness: 0.4, color: BORD }); txt(r.nom, ML + 8, y - 14, { size: 9.5 }); if (r.heures != null) txt(hn(r.heures).replace(" h", ""), ML + CW - 8, y - 14, { size: 9.5, right: true }); y -= 20; }
  if (j.effectifs.length) { need(24); txt("Total : " + hn(h), W - ML - 8, y - 15, { size: 9.5, f: bold, right: true }); y -= 24; } else y -= 8;
  y -= 6;
  // Textes
  const para = (title, text, tint) => {
    if (!text) return; const ls = wrap(text, font, 9.5, CW - 20); label(title);
    let i = 0;
    while (i < ls.length) { need(40); const room = Math.max(1, Math.floor((y - 70 - 16) / 13)), part = ls.slice(i, i + room), hh = part.length * 13 + 14;
      page.drawRectangle({ x: ML, y: y - hh, width: CW, height: hh, color: tint || rgb(0.975, 0.978, 0.982) }); if (tint) page.drawRectangle({ x: ML, y: y - hh, width: 3, height: hh, color: RED });
      part.forEach((l, k) => txt(l, ML + 10, y - 17 - k * 13, { size: 9.5 })); y -= hh + 6; i += part.length; }
    y -= 8;
  };
  para("Travaux réalisés", j.travaux || "Aucun travail renseigné.");
  para("Incidents", j.incidents, rgb(0.99, 0.93, 0.92));
  para("Observations", j.observations);
  // Photos
  const photos = jrPhotos(j.id);
  if (photos.length) {
    for (const [k, lab] of JR_PHASES) {
      const L = photos.filter((p) => p.phase === k); if (!L.length) continue;
      label(`Photos - ${lab}`);
      const gap = 10, pw = (CW - 2 * gap) / 3, ph = 125; let col = 0;
      for (const p of L) {
        let im = null;
        try { const d = (await q(sb.from("terrain_photos").select("data").eq("id", p.id).single())).data, bytes = Uint8Array.from(atob(d.split(",")[1]), (ch) => ch.charCodeAt(0)); im = sniff(bytes) === "png" ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes); } catch (er) { continue; }
        if (col === 0) need(ph + 22);
        const s = Math.min(pw / im.width, ph / im.height), w = im.width * s, hh = im.height * s, x = ML + col * (pw + gap);
        page.drawRectangle({ x, y: y - ph, width: pw, height: ph, borderColor: LINE, borderWidth: 0.6 });
        page.drawImage(im, { x: x + (pw - w) / 2, y: y - ph + (ph - hh) / 2, width: w, height: hh });
        col++; if (col === 3) { col = 0; y -= ph + 10; }
      }
      if (col) y -= ph + 10; y -= 6;
    }
  }
  // Visa
  need(70); label("Visa");
  const bw = (CW - 20) / 2;
  [["Conducteur de travaux / chef de chantier", ""], ["Client (facultatif)", ""]].forEach(([t], i) => { const bx = ML + i * (bw + 20); page.drawRectangle({ x: bx, y: y - 52, width: bw, height: 54, borderColor: LINE, borderWidth: 0.8 }); txt(t, bx + 8, y - 13, { size: 8, color: GREY }); });
  y -= 64;
  // Pieds de page
  const pgs = pdf.getPages();
  pgs.forEach((p, i) => { page = p; p.drawLine({ start: { x: ML, y: 50 }, end: { x: W - ML, y: 50 }, thickness: 0.5, color: LINE });
    const foot = [e.nom, e.forme_juridique, e.siret ? "SIRET " + e.siret : null].filter(Boolean).join("  -  "); const w = font.widthOfTextAtSize(cc(foot), 7); txt(foot, W / 2 - w / 2, 38, { size: 7, color: GREY });
    txt(`Rapport généré le ${D(today())} - Page ${i + 1} / ${pgs.length}`, W - ML, 24, { size: 7, color: GREY, right: true }); });
  pdf.setTitle(`Journal de chantier ${c.nom || ""} ${j.date_jour}`); pdf.setProducer("Pilot");
  return await pdf.save();
}

/* =====================================================================
   3. ASSISTANT IA
   ===================================================================== */
const AI_SUGG = ["Quels chantiers risquent de perdre de l'argent ?", "Qui me doit de l'argent en ce moment ?", "Quels devis dois-je relancer ?", "Où en est ma trésorerie ?", "Résume la semaine sur mes chantiers"];
const AI = { open: false, busy: false, msgs: [] };
try { AI.msgs = JSON.parse(sessionStorage.getItem("pilot-ai") || "[]"); } catch (e) { AI.msgs = []; }

// Résumé compact et filtré selon les permissions : c'est tout ce que l'IA voit (jamais les clés, RIB ou pièces jointes)
function aiContext() {
  const marges = typeof permOk !== "function" || permOk("marges"), ventes = typeof permOk !== "function" || permOk("ventes"), banque = typeof permOk !== "function" || permOk("banque");
  const since = addDays(today(), -365), ctx = { date: today(), entreprise: db.ent.nom || "" };
  if (ventes) {
    const em = emises();
    ctx.ca_ht_12_mois = r2(sum(em.filter((f) => String(f.date_emission || "") >= since), (f) => f.montant_ht));
    ctx.factures_impayees = ouvertes().slice(0, 30).map((f) => ({ numero: f.numero, client: f.client_nom, chantier: f.chantier_nom || null, reste_ttc: f.reste, echeance: f.echeance, en_retard: f.statut_affiche === "En retard", jours_retard: f.statut_affiche === "En retard" ? daysBetween(f.echeance, today()) : 0 }));
    ctx.devis_envoyes_sans_reponse = db.devis.filter((d) => d.statut === "Envoyé").slice(0, 25).map((d) => ({ numero: d.numero, client: d.client_nom, montant_ttc: d.montant_ttc, date: d.date_devis, jours: daysBetween(d.date_devis, today()) }));
    ctx.devis_acceptes_a_facturer = aFacturer().slice(0, 15).map((d) => ({ numero: d.numero, client: d.client_nom, montant_ht: d.montant_ht }));
  }
  if (banque) ctx.tresorerie_actuelle = r2(tresorerie());
  ctx.depenses_a_payer = depensesAPayer().slice(0, 20).map((d) => ({ fournisseur: d.fournisseur, montant_ttc: d.montant_ttc, echeance: d.echeance }));
  ctx.chantiers = db.chantiers.filter((c) => c.statut !== "Terminé").slice(0, 30).map((c) => {
    const d = chDashData(c), o = { nom: c.nom, client: c.client_nom, ville: c.ville, statut: c.statut, avancement_pct: d.avance, heures_pointees: d.hReal, heures_prevues: d.hPrev || null, reste_a_facturer_ht: d.reste, fin_prevue: c.date_fin || null };
    if (marges) Object.assign(o, { marche_ht: d.base, facture_ht: d.factureHT, couts_reels_ht: d.couts, budget_prevu_ht: d.budget || null, marge_brute: d.margeBrute, marge_brute_pct: d.pctBrute, marge_nette: d.margeNette, marge_nette_pct: d.pctNette, verdict: d.verdict.l, alertes: d.alerts.filter((a) => a.lv !== "n").map((a) => `${a.t} : ${a.d}`) });
    return o;
  });
  if (marges && typeof rkAiNote === "function") ctx.previsions_risques = rkAiNote();
  if (db.v17) ctx.journal_recent = db.jr.slice(0, 12).map((j) => ({ chantier: jrChNom(j.chantier_id), jour: j.date_jour, meteo: j.meteo, conditions: j.conditions, equipe: j.effectifs.length, travaux: (j.travaux || "").slice(0, 200), incidents: (j.incidents || "").slice(0, 200) || null }));
  return ctx;
}
// Réponses locales simples quand l'assistant IA n'est pas encore activé sur le serveur
function aiLocal(question) {
  const t = question.toLowerCase(), c = aiContext(), L = [], fmt = (n) => E(n);
  const has = (...w) => w.some((x) => t.includes(x));
  if (has("doit", "impay", "retard", "relanc") && !has("devis")) {
    const f = c.factures_impayees || [];
    if (!f.length) return "Aucune facture impayée en ce moment.";
    return `**${f.length} facture${f.length > 1 ? "s" : ""} à encaisser, ${fmt(sum(f, (x) => x.reste_ttc))} TTC au total :**\n` + f.slice(0, 8).map((x) => `- ${x.numero} · ${x.client} · ${fmt(x.reste_ttc)}${x.en_retard ? ` · **${x.jours_retard} j de retard**` : ""}`).join("\n");
  }
  if (has("devis")) {
    const d = c.devis_envoyes_sans_reponse || [];
    return d.length ? `**${d.length} devis sans réponse :**\n` + d.slice(0, 8).map((x) => `- ${x.numero} · ${x.client} · ${fmt(x.montant_ttc)} · envoyé il y a ${x.jours} j`).join("\n") + "\n\nRelancez en priorité les plus anciens." : "Aucun devis en attente de réponse.";
  }
  if (has("trésor", "treso", "banque", "solde")) return c.tresorerie_actuelle != null ? `Votre trésorerie actuelle est de **${fmt(c.tresorerie_actuelle)}**. À encaisser : ${fmt(sum(c.factures_impayees || [], (x) => x.reste_ttc))} · à payer : ${fmt(sum(c.depenses_a_payer || [], (x) => x.montant_ttc))}.` : "Vous n'avez pas accès aux données bancaires avec ce profil.";
  if (has("perdre", "risque", "rentab", "marge", "budget", "dépass", "depass", "alerte")) {
    const ch = (c.chantiers || []).filter((x) => x.alertes?.length);
    return ch.length ? "**Chantiers à surveiller :**\n" + ch.map((x) => `- **${x.nom}** (${x.verdict}${x.marge_nette_pct != null ? ", marge nette " + x.marge_nette_pct + " %" : ""}) : ${x.alertes.join(" ; ")}`).join("\n") : "Aucun chantier en alerte : budget, heures et marges sont dans les prévisions.";
  }
  if (has("chiffre", "ca ", "facturé")) return c.ca_ht_12_mois != null ? `Chiffre d'affaires facturé sur 12 mois : **${fmt(c.ca_ht_12_mois)} HT**.` : "Accès aux ventes non autorisé avec ce profil.";
  if (has("semaine", "résum", "resum", "journal")) {
    const j = c.journal_recent || [];
    return j.length ? "**Dernières entrées du journal :**\n" + j.slice(0, 6).map((x) => `- ${D(x.jour)} · ${x.chantier} · ${x.equipe} pers. · ${x.travaux || "sans détail"}${x.incidents ? " · ⚠ " + x.incidents : ""}`).join("\n") : "Le journal de chantier est vide.";
  }
  return "Je sais répondre ici sur : factures impayées, devis à relancer, trésorerie, chantiers à risque, chiffre d'affaires et journal. Pour des questions libres, activez l'assistant IA (voir ASSISTANT_IA.md).";
}
async function aiAsk(question) {
  AI.msgs.push({ r: "user", t: question }); AI.busy = true; aiDraw();
  let answer, note = "";
  try {
    const { data, error } = await sb.functions.invoke("assistant-ia", { body: { messages: AI.msgs.slice(-12).map((m) => ({ role: m.r === "user" ? "user" : "assistant", content: m.t })), context: aiContext() } });
    if (error) throw error;
    if (!data?.answer) throw new Error(data?.error || "Réponse vide");
    answer = data.answer;
  } catch (e) { console.warn("Assistant IA", e); answer = aiLocal(question); note = "Réponse automatique simple : l'assistant IA n'est pas activé sur votre serveur (voir ASSISTANT_IA.md)."; }
  AI.msgs.push({ r: "ai", t: answer, n: note }); AI.busy = false;
  try { sessionStorage.setItem("pilot-ai", JSON.stringify(AI.msgs.slice(-30))); } catch (e) {}
  aiDraw();
}
const aiFmt = (src) => {
  const out = []; let inList = false;
  for (const l of String(src).split("\n")) {
    const li = /^\s*[-•]\s+(.*)$/.exec(l), h = (x) => esc(x).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
    if (li) { if (!inList) { out.push("<ul>"); inList = true; } out.push(`<li>${h(li[1])}</li>`); }
    else { if (inList) { out.push("</ul>"); inList = false; } if (l.trim()) out.push(`<p>${h(l)}</p>`); }
  }
  if (inList) out.push("</ul>");
  return out.join("");
};
function aiDraw() {
  const p = $("#aip");
  if (!p) return;
  const box = $(".aim", p);
  box.innerHTML = (AI.msgs.length ? AI.msgs.map((m) => `<div class="am ${m.r}">${m.r === "ai" ? aiFmt(m.t) : esc(m.t)}${m.n ? `<small>${esc(m.n)}</small>` : ""}</div>`).join("")
    : `<div class="am ai"><p>Bonjour ! Posez-moi une question sur vos chantiers, factures, devis ou trésorerie.</p></div><div class="asg">${AI_SUGG.map((s) => `<button type="button" data-act="aiSug" data-arg="${esc(s)}">${esc(s)}</button>`).join("")}</div>`)
    + (AI.busy ? `<div class="am ai"><span class="dots"><i></i><i></i><i></i></span></div>` : "");
  box.scrollTop = box.scrollHeight;
  p.hidden = !AI.open; $("#aifab").setAttribute("aria-expanded", String(AI.open));
}
function aiMount() {
  if ($("#aifab") || !uid) return;
  document.body.insertAdjacentHTML("beforeend", `<button id="aifab" class="aifab" aria-label="Assistant IA" aria-expanded="false" title="Poser une question à l'assistant">${svg(ic.spark)}<span>Assistant</span></button>
    <section id="aip" class="aip" hidden aria-label="Assistant IA"><header><b>${svg(ic.spark)} Assistant Pilot</b><span><button type="button" class="ib" data-act="aiClear" title="Nouvelle conversation" aria-label="Nouvelle conversation">${svg("M4 4v6h6 M20 20v-6h-6 M5 15a8 8 0 0013 3 M19 9A8 8 0 006 6")}</button><button type="button" class="ib" data-act="aiToggle" aria-label="Fermer">${svg(ic.x)}</button></span></header>
      <div class="aim"></div><form class="aif"><textarea rows="1" placeholder="Ex : quel chantier est le moins rentable ?" aria-label="Votre question"></textarea><button class="btn" aria-label="Envoyer">${svg(ic.send)}</button></form>
      <p class="aid">L'assistant lit un résumé de vos données et peut se tromper : vérifiez les chiffres importants.</p></section>`);
  $("#aifab").onclick = () => { AI.open = !AI.open; aiDraw(); if (AI.open) $("#aip textarea").focus(); };
  const f = $("#aip form"), ta = $("textarea", f);
  f.onsubmit = (e) => { e.preventDefault(); const t = ta.value.trim(); if (!t || AI.busy) return; ta.value = ""; ta.style.height = ""; aiAsk(t); };
  ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); f.requestSubmit(); } });
  ta.addEventListener("input", () => { ta.style.height = "auto"; ta.style.height = Math.min(120, ta.scrollHeight) + "px"; });
  aiDraw();
}

/* ---------- Actions ---------- */
const chProActions = {
  tbFilter: (id, arg) => { ST.tbF = arg; render(true); },
  jrCh: (v) => { ST.jrC = v; render(true); },
  jrNew: (id, arg) => jrForm(null, { chantier_id: id || "", date: arg || "" }),
  jrOpen: (id) => jrForm(byId(db.jr, id)),
  jrPdf: (id) => jrDownload(id),
  aiToggle: () => { AI.open = false; aiDraw(); },
  aiClear: () => { AI.msgs = []; try { sessionStorage.removeItem("pilot-ai"); } catch (e) {} aiDraw(); },
  aiSug: (id, arg) => aiAsk(arg),
};
