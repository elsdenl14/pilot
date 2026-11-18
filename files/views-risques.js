/* v22 · Gestion des risques et rentabilité prédictive.
   Projette, chantier par chantier, ce que le suivi actuel (budget, heures, avancement, planning) annonce pour la fin :
   dépassement de budget, retard, marge finale, risque de déficit ; repère les dépenses atypiques et les heures supplémentaires à venir.
   Tout est calculé dans le navigateur à partir des données existantes : aucune migration. S'appuie sur chDashData (v19), chRenta, planning, pointages, affectations. */

Object.assign(ic, { risques: "M3 17l5-6 4 3 5-8 4 4 M3 21h18" });
if (typeof PAGE_PERM !== "undefined") PAGE_PERM.risques = "marges";

/* ---------- Outils ---------- */
const rkClamp = (x, a = 0, b = 100) => Math.min(b, Math.max(a, x));
const RK_LV = [[75, "Critique", "dn"], [55, "Élevé", "dn"], [30, "Modéré", "wn"], [0, "Faible", "ok"]];
const rkLv = (s) => (s === null || s === undefined ? ["", "Non évaluable", "mu"] : RK_LV.find((x) => s >= x[0]));
const rkChip = (s) => { const l = rkLv(s); return `<span class="chip ${l[2]}">${l[1]}</span>`; };
const rkMonday = (iso) => { const d = new Date(iso + "T12:00:00"); return addDays(iso, -((d.getDay() + 6) % 7)); };
const rkMedian = (a) => { const s = [...a].sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };
const rkMad = (a, med) => rkMedian(a.map((x) => Math.abs(x - med)));
const rkNorm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const rkDays = (a, b) => daysBetween(a, b);

/* ---------- 1. Avancement et planning ---------- */
function rkProgress(c) {
  if (c.statut === "Terminé") return { p: 100, src: "chantier terminé" };
  const ph = (db.phases || []).filter((p) => p.chantier_id === c.id), man = Number(c.avancement) || 0;
  if (man > 0) return { p: man, src: "avancement saisi sur le chantier" };
  if (ph.length) {
    const w = ph.map((p) => ({ w: Math.max(1, rkDays(p.date_debut, p.date_fin) + 1), a: Number(p.avancement) || 0 }));
    const v = Math.round(sum(w, (x) => x.w * x.a) / sum(w, (x) => x.w));
    if (v > 0) return { p: v, src: "avancement des phases du planning" };
  }
  return { p: 0, src: "aucun avancement renseigné" };
}
function rkSchedule(c, av) {
  const t = today(), ph = (db.phases || []).filter((p) => p.chantier_id === c.id);
  const start = c.date_debut || (ph.length ? ph.map((p) => p.date_debut).sort()[0] : null);
  const end = c.date_fin || (ph.length ? ph.map((p) => p.date_fin).sort().slice(-1)[0] : null);
  const tasks = (db.taches || []).filter((x) => x.chantier_id === c.id);
  const overduePh = ph.filter((p) => p.date_fin < t && (Number(p.avancement) || 0) < 100).length;
  const lateTasks = tasks.filter((x) => x.echeance && x.echeance < t && x.statut !== "Terminée").length;
  const blocked = tasks.filter((x) => x.statut === "Bloquée").length;
  const o = { start, end, known: !!(start && end && end > start), overduePh, lateTasks, blocked, delay: 0, projEnd: null, gap: null, score: null, note: "" };
  if (c.statut === "Terminé") { o.score = 0; o.note = "Chantier terminé."; return o; }
  const hint = Math.min(25, overduePh * 8 + lateTasks * 3 + blocked * 6);
  if (!o.known) { o.score = hint > 0 ? hint : null; o.note = hint > 0 ? "Dates du chantier non définies : risque estimé sur les phases et tâches en retard." : "Définissez la date de début et de fin du chantier (ou des phases) pour évaluer le retard."; return o; }
  const total = rkDays(start, end), el = Math.max(0, rkDays(start, t)), a = av / 100, elapsedPct = rkClamp(Math.round((el / total) * 100), 0, 100);
  o.gap = elapsedPct - av;
  if (t < start) { o.projEnd = end; o.note = "Le chantier n'a pas encore démarré."; o.score = hint; return o; }
  if (a >= 0.05 && el > 0) o.projEnd = addDays(start, Math.round(el / a));
  if (o.projEnd) o.delay = Math.max(0, rkDays(end, o.projEnd));
  if (t > end && av < 100) o.delay = Math.max(o.delay, rkDays(end, t));
  if (!o.projEnd && t > end) o.projEnd = addDays(t, 0);
  o.score = rkClamp(Math.round((o.delay / total) * 100 * 4) + hint, 0, 100);
  o.note = o.delay > 0 ? `Fin prévue le ${D(end)}, fin projetée vers le ${D(o.projEnd || addDays(end, o.delay))} (${o.delay} jour${o.delay > 1 ? "s" : ""} de retard).` : `Rythme compatible avec la fin prévue le ${D(end)}.`;
  return o;
}

/* ---------- 2. Heures et heures supplémentaires d'un chantier ---------- */
function rkCrew(c) {
  const t = today(), ids = new Set();
  (db.aff || []).filter((a) => a.chantier_id === c.id && a.date_fin >= t).forEach((a) => {
    if (a.ressource === "salarie" && a.salarie_id) ids.add(a.salarie_id);
    if (a.ressource === "equipe" && a.equipe_id) (db.sal || []).filter((s) => s.equipe_id === a.equipe_id).forEach((s) => ids.add(s.id));
  });
  const since = addDays(t, -28);
  (db.ptg || []).filter((p) => p.chantier_id === c.id && p.date_travail >= since && p.statut !== "Refusé").forEach((p) => ids.add(p.salarie_id));
  return [...ids].map((id) => byId(db.sal, id)).filter((s) => s && s.actif !== false);
}
function rkHours(c, av, endDate) {
  const d = typeof chDashData === "function" ? chDashData(c) : null;
  const hReal = d ? d.hReal : 0, hPrev = d ? d.hPrev : 0, a = av / 100, reg = typeof rhReg === "function" ? rhReg() : { seuil_hebdo: 35, hs1_pct: 25 };
  let proj = null;
  if (c.statut === "Terminé") proj = hReal;
  else if (a >= 0.1 && hReal > 0) { const trend = hReal / a, w = rkClamp(a / 0.5, 0, 1); proj = hPrev > 0 ? w * trend + (1 - w) * hPrev : trend; proj = Math.max(proj, hReal); }
  else if (hPrev > 0) proj = Math.max(hPrev, hReal);
  const rest = proj === null ? null : Math.max(0, proj - hReal), crew = rkCrew(c), t = today();
  const o = { hReal, hPrev, proj: proj === null ? null : Math.round(proj), rest: rest === null ? null : Math.round(rest), crew: crew.length, depass: hPrev > 0 && proj !== null ? Math.round(proj - hPrev) : null, hs: null, cost: null, score: null };
  if (c.statut === "Terminé" || rest === null || !crew.length || !endDate) return o;
  const weeks = Math.max(1, Math.ceil((Math.max(0, rkDays(t, endDate)) + 1) / 7)), cap = crew.length * reg.seuil_hebdo * weeks;
  o.cap = cap; o.weeks = weeks; o.hs = Math.round(Math.max(0, rest - cap));
  const ch = sum(crew, (s) => (typeof salCout === "function" ? salCout(s) : 0)) / crew.length;
  o.cost = r2(o.hs * ch * (reg.hs1_pct / 100));
  o.score = rest > 0 ? rkClamp(Math.round((o.hs / rest) * 300), 0, 100) : 0;
  return o;
}

/* ---------- 3. Projection de coûts, de marge, de budget ---------- */
function rkData(c) {
  const d = chDashData(c), pr = rkProgress(c), av = pr.p, a = av / 100, done = c.statut === "Terminé";
  const used = d.used, budget = d.budget;
  let eac, conf;
  if (done) { eac = d.couts; conf = "chantier terminé : coûts définitifs"; }
  else if (a >= 0.1) {
    const trend = used / a, w = rkClamp(a / 0.5, 0, 1);
    eac = budget > 0 ? w * trend + (1 - w) * Math.max(budget, used) : trend;
    conf = a < 0.25 ? "faible (chantier peu avancé)" : a < 0.6 ? "moyenne" : "bonne";
  } else { eac = budget > 0 ? Math.max(budget, used) : used; conf = budget > 0 ? "faible : repose sur le budget prévu" : "aucune : ni avancement ni budget"; }
  eac = r2(Math.max(eac, used));
  const dayRev = d.base > 0 ? d.base : d.factureHT;
  const u = done ? 0 : rkClamp(0.2 * (1 - a) + 0.03, 0.03, 0.2), eacP = r2(eac * (1 + u)), eacO = r2(Math.max(used, eac * (1 - u / 2)));
  const hasRev = dayRev > 0, oh = d.oh.rate;
  const marge = hasRev ? r2(dayRev - eac) : null, margeP = hasRev ? r2(dayRev - eacP) : null, margeO = hasRev ? r2(dayRev - eacO) : null;
  const nette = hasRev ? r2(marge - dayRev * oh) : null, netteP = hasRev ? r2(margeP - dayRev * oh) : null;
  const pct = hasRev ? Math.round((marge / dayRev) * 100) : null, pctNette = hasRev ? Math.round((nette / dayRev) * 100) : null;
  // Budget
  const ratio = budget > 0 ? eac / budget : null;
  let sBudget = budget > 0 ? rkClamp(Math.round(((ratio - 0.97) / 0.18) * 100)) : null;
  if (budget > 0 && used > budget + 0.005) sBudget = Math.max(sBudget, 90);
  if (done && budget > 0) sBudget = d.couts > budget ? 100 : 0;
  // Déficit
  let sDef = null, defClass = { l: "Non évaluable", c: "mu" };
  if (hasRev) {
    if (done) sDef = nette < 0 ? 100 : 0;
    else { sDef = rkClamp(Math.round(((15 - pctNette) / 25) * 100)); if (netteP < 0) sDef = Math.max(sDef, 45); if (nette < 0) sDef = Math.max(sDef, 80); }
    defClass = nette < 0 ? { l: done ? "Déficitaire" : "Déficit prévu", c: "dn" } : netteP < 0 || pctNette < 5 ? { l: "À risque", c: "wn" } : { l: "Sain", c: "ok" };
  }
  const sch = rkSchedule(c, av), hrs = rkHours(c, av, sch.end);
  const parts = [sBudget, sch.score, sDef].filter((x) => x !== null), all = [...parts, hrs.score].filter((x) => x !== null);
  const score = all.length ? Math.round(0.75 * Math.max(...all) + 0.25 * (sum(all, (x) => x) / all.length)) : null;
  const reasons = [];
  if (!budget && !done) reasons.push({ lv: "n", t: "Budget non défini", d: "Sans budget, le risque de dépassement ne peut pas être évalué : définissez-le dans « Définir le budget »." });
  if (sBudget >= 55) reasons.push({ lv: "dn", t: "Dépassement de budget probable", d: `Coût final estimé ${E(eac)} pour ${E(budget)} prévus (${Math.round((ratio - 1) * 100) >= 0 ? "+" : ""}${Math.round((ratio - 1) * 100)} %).` });
  else if (sBudget >= 30) reasons.push({ lv: "wn", t: "Budget sous tension", d: `Coût final estimé ${E(eac)} pour ${E(budget)} prévus.` });
  if (sch.score !== null && sch.score >= 30) reasons.push({ lv: sch.score >= 55 ? "dn" : "wn", t: "Risque de retard", d: sch.note + (sch.overduePh || sch.lateTasks || sch.blocked ? ` ${[sch.overduePh && sch.overduePh + " phase(s) en retard", sch.lateTasks && sch.lateTasks + " tâche(s) échue(s)", sch.blocked && sch.blocked + " tâche(s) bloquée(s)"].filter(Boolean).join(", ")}.` : "") });
  if (hasRev && defClass.c === "dn" && !done) reasons.push({ lv: "dn", t: "Chantier probablement déficitaire", d: `Marge nette finale estimée ${E(nette)} (${pctNette} %), même en retirant les frais généraux ${Math.round(oh * 100)} % du CA.` });
  else if (hasRev && defClass.c === "wn") reasons.push({ lv: "wn", t: "Marge fragile", d: `Marge nette finale estimée ${pctNette} % ; dans le scénario pessimiste ${E(netteP)}.` });
  if (hrs.hs > 0) reasons.push({ lv: hrs.score >= 55 ? "dn" : "wn", t: "Heures supplémentaires à prévoir", d: `Environ ${hn(hrs.hs)} au-delà de la capacité des ${hrs.crew} personne(s) affectée(s) d'ici la fin prévue (surcoût de majoration ≈ ${E(hrs.cost)}).` });
  if (hrs.depass > 0 && hrs.hPrev) reasons.push({ lv: "wn", t: "Heures au-dessus du prévu", d: `Projection de ${hn(hrs.proj)} pour ${hn(hrs.hPrev)} prévues.` });
  return { c, d, pr, av, done, eac, conf, eacP, eacO, rev: dayRev, hasRev, marge, margeP, margeO, nette, netteP, pct, pctNette, margePrev: d.f.has ? d.f.margePrev : null, ratio, budget, used,
    dep: budget > 0 ? r2(eac - budget) : null, sBudget, sDef, defClass, sch, hrs, score, reasons };
}
const rkAll = () => db.chantiers.filter((c) => c.statut !== "Terminé").map(rkData).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

/* ---------- 4. Dépenses atypiques ---------- */
function rkAnomalies() {
  const t = today(), recent = addDays(t, -120), deps = (db.depenses || []).filter((d) => d.montant_ht > 0), out = [];
  const byCat = {}, bySup = {};
  deps.forEach((d) => { const k = rkNorm(d.categorie) || "autre"; (byCat[k] ||= []).push(d.montant_ht); (bySup[rkNorm(d.fournisseur) + "|" + k] ||= []).push(d.montant_ht); });
  const lineBudget = (d) => { if (!d.chantier_id) return 0; const b = budgetOf(d.chantier_id); if (!b) return 0; const ln = typeof lineOf === "function" ? lineOf(d.categorie) : "autres"; return Number(b[ln]) || 0; };
  for (const d of deps) {
    if (String(d.date_depense) < recent) continue;
    const why = [], k = rkNorm(d.categorie) || "autre", g = byCat[k], gs = bySup[rkNorm(d.fournisseur) + "|" + k];
    let sev = 0;
    if (g.length >= 6) {
      const med = rkMedian(g), mad = rkMad(g, med), sc = mad > 0 ? mad * 1.4826 : med * 0.25, z = (d.montant_ht - med) / (sc || 1);
      if (z >= 3.5 && d.montant_ht >= 1.5 * med && d.montant_ht >= 150) { why.push(`${(d.montant_ht / med).toFixed(1).replace(".", ",")} × la dépense habituelle en « ${d.categorie || "autre"} » (médiane ${E(med)})`); sev += Math.min(60, 20 + z * 4); }
    }
    if (gs.length >= 4) {
      const med = rkMedian(gs);
      if (d.montant_ht >= 2.5 * med && d.montant_ht >= 150) { why.push(`${(d.montant_ht / med).toFixed(1).replace(".", ",")} × le montant habituel chez ${d.fournisseur} (${E(med)})`); sev += 25; }
    }
    const twin = deps.find((x) => x.id !== d.id && rkNorm(x.fournisseur) === rkNorm(d.fournisseur) && Math.abs(x.montant_ht - d.montant_ht) < 0.011 && Math.abs(rkDays(x.date_depense, d.date_depense)) <= 10 && (String(x.created_at) < String(d.created_at) || (x.created_at === d.created_at && x.id < d.id)));
    if (twin) { why.push(`possible doublon : même fournisseur et même montant le ${D(twin.date_depense)}`); sev += 35; }
    const lb = lineBudget(d);
    if (lb > 0 && d.montant_ht >= 300 && d.montant_ht >= 0.4 * lb) { why.push(`${Math.round((d.montant_ht / lb) * 100)} % du budget prévu de la ligne « ${d.categorie || "autres"} » du chantier`); sev += 20; }
    if (why.length) out.push({ kind: "depense", d, why, sev: Math.round(sev), recent: String(d.date_depense) >= addDays(t, -30) });
  }
  // Pics de dépenses par chantier (30 derniers jours contre moyenne mensuelle des 90 jours précédents)
  for (const c of db.chantiers.filter((x) => x.statut !== "Terminé")) {
    const l = deps.filter((d) => d.chantier_id === c.id), last = sum(l.filter((d) => String(d.date_depense) >= addDays(t, -30)), (d) => d.montant_ht);
    const prev = sum(l.filter((d) => String(d.date_depense) < addDays(t, -30) && String(d.date_depense) >= addDays(t, -120)), (d) => d.montant_ht) / 3;
    if (last >= 1000 && prev > 0 && last >= 2.5 * prev) out.push({ kind: "pic", c, last, prev, why: [`${E(last)} dépensés en 30 jours, ${(last / prev).toFixed(1).replace(".", ",")} × la moyenne mensuelle des trois mois précédents (${E(prev)})`], sev: Math.round(Math.min(70, 25 + (last / prev) * 8)), recent: true });
  }
  return out.sort((a, b) => b.sev - a.sev);
}

/* ---------- 5. Heures supplémentaires par salarié ---------- */
function rkOvertime() {
  const reg = rhReg(), t = today(), mon = rkMonday(t), weeks = [addDays(mon, -21), addDays(mon, -14), addDays(mon, -7)], cur = mon, nxt = addDays(mon, 7);
  const rows = [];
  for (const s of (db.sal || []).filter((x) => x.actif !== false)) {
    const pts = (db.ptg || []).filter((p) => p.salarie_id === s.id && p.statut !== "Refusé");
    const wk = (m) => sum(pts.filter((p) => p.date_travail >= m && p.date_travail <= addDays(m, 6)), (p) => p.heures);
    const past = weeks.map(wk), hasPast = past.some((h) => h > 0), avg = hasPast ? sum(past, (x) => x) / past.length : 0;
    const absDays = (m) => { let n = 0; for (let i = 0; i < 5; i++) { const day = addDays(m, i); if ((db.abs || []).some((a) => a.salarie_id === s.id && a.date_debut <= day && a.date_fin >= day)) n++; } return n; };
    const planned = (m, fromDay) => { // heures planifiées (affectations) du lundi au vendredi, à partir de fromDay
      let h = 0, any = false;
      for (let i = 0; i < 5; i++) {
        const day = addDays(m, i); if (day < fromDay) continue;
        if ((db.abs || []).some((a) => a.salarie_id === s.id && a.date_debut <= day && a.date_fin >= day)) continue;
        const af = (db.aff || []).filter((a) => (a.ressource === "salarie" && a.salarie_id === s.id) || (a.ressource === "equipe" && a.equipe_id && a.equipe_id === s.equipe_id)).filter((a) => a.date_debut <= day && a.date_fin >= day);
        if (af.length) { any = true; h += Math.max(...af.map((a) => { if (a.heure_debut && a.heure_fin) { const [h1, m1] = a.heure_debut.split(":").map(Number), [h2, m2] = a.heure_fin.split(":").map(Number); return Math.max(0, h2 + m2 / 60 - h1 - m1 / 60); } return 7; })); }
      }
      return any ? h : null;
    };
    const done = wk(cur), tomorrow = addDays(t, 1), pc1 = planned(cur, tomorrow);
    const fCur = done + (pc1 !== null ? pc1 : Math.max(0, avg - (avg / 5) * absDays(cur) - done) * (hasPast ? 1 : 0));
    const pn = planned(nxt, nxt), fNxt = pn !== null ? pn : Math.max(0, avg - (avg / 5) * absDays(nxt));
    const basis = pc1 !== null || pn !== null ? "planning (affectations)" : hasPast ? "moyenne des 3 dernières semaines" : "aucune donnée";
    const cost = typeof salCout === "function" ? salCout(s) : 0;
    const hsOf = (F) => { const x1 = Math.min(Math.max(F - reg.seuil_hebdo, 0), reg.hs1_jusqua - reg.seuil_hebdo), x2 = Math.max(F - reg.hs1_jusqua, 0); return { h: x1 + x2, maj: cost * (x1 * (reg.hs1_pct / 100) + x2 * (reg.hs2_pct / 100)), pay: cost * (x1 * (1 + reg.hs1_pct / 100) + x2 * (1 + reg.hs2_pct / 100)) }; };
    const h1 = hsOf(fCur), h2 = hsOf(fNxt), hsPast = sum(past, (h) => Math.max(0, h - reg.seuil_hebdo));
    rows.push({ s, avg, done, fCur, fNxt, hs: h1.h + h2.h, maj: h1.maj + h2.maj, pay: h1.pay + h2.pay, hsPast, basis, past });
  }
  return rows.sort((a, b) => b.hs - a.hs || b.avg - a.avg);
}

/* ---------- Pages et blocs ---------- */
const rkBar = (p) => `<div class="dbar"><i class="${p >= 75 ? "dn" : p >= 30 ? "wn" : ""}" style="width:${rkClamp(p)}%"></i></div>`;
const rkMoney = (v) => (v === null || v === undefined ? "-" : `<span class="num ${v < 0 ? "dn" : ""}">${E(v)}</span>`);
function rkRow(x) {
  const c = x.c;
  return { act: "rkDetail", id: c.id, t: `${c.nom} ${c.client_nom || ""}`, c: [`<strong>${esc(c.nom)}</strong><small>${esc(c.client_nom || "")} · avancement ${x.av} %</small>`,
    x.sBudget === null ? `<span class="chip mu">Budget ?</span>` : `${rkChip(x.sBudget)}<small>${x.dep > 0 ? "+" + E(x.dep) : "dans le budget"}</small>`,
    x.sch.score === null ? `<span class="chip mu">Dates ?</span>` : `${rkChip(x.sch.score)}<small>${x.sch.delay ? x.sch.delay + " j de retard prévu" : x.sch.known ? "dans les délais" : ""}</small>`,
    x.hasRev ? `${rkMoney(x.marge)}<small>${x.pct} % · nette ${x.pctNette} %</small>` : "-",
    `<span class="chip ${x.defClass.c}">${x.defClass.l}</span>`, x.hrs.hs ? `${hn(x.hrs.hs)}<small>≈ ${E(x.hrs.cost)} de majoration</small>` : x.hrs.hs === 0 ? "0 h" : "-",
    x.score === null ? "-" : `<div style="min-width:90px">${rkChip(x.score)}${rkBar(x.score)}</div>`] };
}
function rkChantiersTab(L) {
  return card("Chantiers en cours, du plus risqué au moins risqué", tbl(["Chantier", "Dépassement budget", "Retard", { h: "Marge finale estimée", r: 1 }, "Déficit", { h: "Heures sup.", r: 1 }, "Risque global"], L.map(rkRow), "Aucun chantier en cours."))
    + `<p class="note">Cliquez sur un chantier pour voir le raisonnement et les chiffres de la projection.</p>`;
}
function rkExpTab() {
  const L = rkAnomalies();
  const rows = L.map((x) => x.kind === "pic" ? { go: `chantiers/${x.c.id}`, t: x.c.nom, c: [`<strong>Pic de dépenses</strong><small>${esc(x.c.nom)}</small>`, "-", `<span class="num">${E(x.last)}</span>`, esc(x.why.join(" ; ")), `<span class="chip ${x.sev >= 60 ? "dn" : "wn"}">${x.sev >= 60 ? "Fort" : "À vérifier"}</span>`] }
    : { go: `depenses/${x.d.id}`, t: `${x.d.fournisseur} ${x.d.reference || ""}`, c: [`<strong>${esc(x.d.fournisseur)}</strong><small>${esc(x.d.categorie || "")}${x.d.reference ? " · " + esc(x.d.reference) : ""}</small>`, D(x.d.date_depense) + `<small>${esc(chNm(x.d.chantier_id) || "sans chantier")}</small>`, `<span class="num">${E(x.d.montant_ht)}</span>`, esc(x.why.join(" ; ")), `<span class="chip ${x.sev >= 60 ? "dn" : "wn"}">${x.sev >= 60 ? "Fort" : "À vérifier"}</span>`] });
  return card("Dépenses anormalement élevées (120 derniers jours)", tbl(["Dépense", "Date / chantier", { h: "HT", r: 1 }, "Pourquoi elle ressort", "Signal"], rows, "Aucune dépense atypique détectée."))
    + `<p class="note">Une dépense ressort quand elle dépasse nettement la norme de sa catégorie ou de son fournisseur (écart statistique robuste, minimum 150 €), ressemble à un doublon (même fournisseur et même montant à 10 jours près) ou pèse lourd dans le budget d'une ligne. C'est un signal à vérifier, pas une erreur avérée : une grosse commande légitime ressortira aussi.</p>`;
}
function rkOtTab() {
  const rows = rkOvertime(), reg = rhReg(), tot = sum(rows, (r) => r.hs), maj = sum(rows, (r) => r.maj);
  const tb = tbl(["Salarié", { h: "Moy. 3 sem.", r: 1 }, { h: "Cette semaine (prévue)", r: 1 }, { h: "Semaine prochaine (prévue)", r: 1 }, { h: "HS prévues (2 sem.)", r: 1 }, { h: "Majoration estimée", r: 1 }, "Base de calcul"],
    rows.map((r) => ({ go: "pointages", t: r.s.nom, c: [`<strong>${esc(r.s.nom)}</strong><small>${esc(r.s.poste || "")}</small>`, `<span class="num">${hn(r.avg)}</span>`, `<span class="num ${r.fCur > reg.seuil_hebdo ? "wn" : ""}">${hn(r.fCur)}</span>`, `<span class="num ${r.fNxt > reg.seuil_hebdo ? "wn" : ""}">${hn(r.fNxt)}</span>`,
      r.hs > 0 ? `<span class="num"><b>${hn(r.hs)}</b></span>` : "0 h", r.maj > 0 ? `<span class="num">${E(r.maj)}</span>` : "-", `<small>${r.basis}</small>`] })), "Aucun salarié actif.");
  return strip([["Heures sup. prévues (2 semaines)", hn(tot), `au-delà de ${reg.seuil_hebdo} h par semaine`, tot > 0 ? "wn" : ""], ["Majorations estimées", E(maj), `${reg.hs1_pct} % puis ${reg.hs2_pct} % selon vos réglages`]]) + card("Heures supplémentaires prévisibles par salarié", tb)
    + `<p class="note">Prévision = heures planifiées dans les affectations (absences déduites) ou, à défaut, moyenne des trois dernières semaines de pointages. Seuil, tranches et majorations : réglages de « Pointages et paie ». Les HS réellement dues dépendent de votre convention et de vos accords : ceci reste une estimation de gestion.</p>`;
}
function rkMethodTab() {
  return card("Comment les prévisions sont calculées", `<div class="cb" style="line-height:1.55"><ul style="margin:0;padding-left:18px">
    <li><b>Avancement</b> : celui saisi sur le chantier, sinon la moyenne des phases du planning pondérée par leur durée.</li>
    <li><b>Coût final estimé</b> : coûts réels + commandes engagées, rapportés à l'avancement (coût ÷ avancement). Tant que le chantier est peu avancé (moins de 50 %), la prévision s'appuie davantage sur le budget prévu ; en dessous de 10 %, uniquement sur le budget.</li>
    <li><b>Marge finale estimée</b> : marché (ou facturé à défaut) − coût final estimé, puis marge nette après frais généraux (taux calculé sur les 12 derniers mois, comme le tableau de bord chantier). Le scénario pessimiste majore le coût de 3 à 20 % selon ce qu'il reste à faire.</li>
    <li><b>Dépassement de budget</b> : coût final estimé ÷ budget prévu. 97 % ou moins = risque nul ; 100 % = faible ; 105 % = modéré ; 110 % = élevé ; 115 % et plus = critique ; un budget déjà dépassé = au moins 90.</li>
    <li><b>Retard</b> : rythme actuel (avancement ÷ temps écoulé) projeté jusqu'à la fin, plus les phases et tâches échues ou bloquées. Sans dates de début et de fin, le retard n'est pas évalué.</li>
    <li><b>Déficit</b> : marge nette finale estimée négative = « déficit prévu » ; négative dans le scénario pessimiste ou inférieure à 5 % = « à risque ».</li>
    <li><b>Heures supplémentaires d'un chantier</b> : heures restantes (projection des heures pointées) moins la capacité des salariés affectés (seuil hebdomadaire × semaines restantes).</li>
    <li><b>Risque global</b> : 75 % du pire des indicateurs + 25 % de leur moyenne. Faible &lt; 30, modéré 30-54, élevé 55-74, critique 75 et plus.</li></ul></div>`)
    + `<p class="note"><b>Limites :</b> ce sont des projections linéaires, fiables seulement si l'avancement, les budgets, les heures et les dates sont tenus à jour. Un chantier dont l'avancement n'est jamais renseigné ne peut pas être projeté. Les indicateurs aident à décider où regarder en premier ; ils ne remplacent ni le jugement du conducteur de travaux ni un chiffrage de reste à faire.</p>`;
}
V.risques = () => {
  const L = rkAll(), tab = ST.tab?.risques || "chantiers";
  const items = [["chantiers", "Chantiers"], ...(permOk("achats") ? [["depenses", "Dépenses atypiques"]] : []), ...(permOk("rh") ? [["heures", "Heures supplémentaires"]] : []), ["methode", "Méthode"]];
  const cur = items.some((i) => i[0] === tab) ? tab : "chantiers";
  const deficit = L.filter((x) => x.defClass.c === "dn"), risque = L.filter((x) => x.score !== null && x.score >= 55), depass = L.filter((x) => x.sBudget !== null && x.sBudget >= 55), retard = L.filter((x) => x.sch.score !== null && x.sch.score >= 55);
  const margeEst = sum(L.filter((x) => x.hasRev), (x) => x.marge), margePrev = sum(L.filter((x) => x.margePrev !== null), (x) => x.margePrev), perte = sum(deficit, (x) => x.nette);
  const an = permOk("achats") ? rkAnomalies() : [], hs = permOk("rh") ? sum(rkOvertime(), (r) => r.hs) : null;
  const head = strip([
    ["Chantiers à risque élevé", String(risque.length), `sur ${L.length} en cours`, risque.length ? "dn" : ""],
    ["Dépassement de budget probable", String(depass.length), depass.length ? E(sum(depass, (x) => x.dep || 0)) + " de dépassement estimé" : "aucun", depass.length ? "dn" : ""],
    ["Retard probable", String(retard.length), retard.length ? "chantiers en retard de plus de 14 % de leur durée" : "aucun", retard.length ? "wn" : ""],
    ["Déficit prévu", String(deficit.length), deficit.length ? E(perte) + " de marge nette perdue" : "aucun chantier déficitaire prévu", deficit.length ? "dn" : ""],
    ["Marge finale estimée", E(margeEst), margePrev ? `${E(margePrev)} prévus au budget` : "chantiers en cours"],
    ...(permOk("achats") ? [["Dépenses atypiques", String(an.filter((x) => x.recent).length), "ces 30 jours", an.some((x) => x.recent) ? "wn" : ""]] : []),
    ...(hs !== null ? [["Heures sup. prévues", hn(hs), "sur 2 semaines", hs > 0 ? "wn" : ""]] : []),
  ]);
  const body = cur === "depenses" ? rkExpTab() : cur === "heures" ? rkOtTab() : cur === "methode" ? rkMethodTab() : rkChantiersTab(L);
  return page("Risques et prévisions", "Ce que vos chantiers annoncent pour la fin : budget, délais, marge, dépenses inhabituelles et heures supplémentaires.", "", head + tabs("risques", items, cur) + body);
};

/* Détail d'un chantier (fenêtre) */
function rkDetailHtml(x) {
  const lv = (s) => rkChip(s), c = x.c;
  const bar = (label, a, b) => `<tr><td>${label}</td><td class="num" style="text-align:right">${a}</td><td class="num" style="text-align:right">${b}</td></tr>`;
  return `<div class="als">${x.reasons.length ? x.reasons.map((a) => `<div class="al lv-${a.lv}"><span class="ai">${svg(ic.warn)}</span><div><b>${esc(a.t)}</b><span>${esc(a.d)}</span></div></div>`).join("") : `<div class="al lv-ok"><span class="ai">${svg("M5 13l4 4L19 7")}</span><div><b>Aucun risque détecté</b><span>Budget, délais et marge sont cohérents avec la projection.</span></div></div>`}</div>
    <div class="kpis" style="margin-top:14px">
      <div class="kpi"><small>Risque global</small><b>${lv(x.score)}</b><span>${x.score === null ? "données insuffisantes" : "score " + x.score + " / 100"}</span></div>
      <div class="kpi"><small>Avancement retenu</small><b class="num">${x.av} %</b><span>${esc(x.pr.src)}</span></div>
      <div class="kpi"><small>Fiabilité de la projection</small><b style="font-size:15px">${esc(x.conf)}</b></div></div>
    <div class="tw" style="margin-top:14px"><table><thead><tr><th></th><th style="text-align:right">Prévu / marché</th><th style="text-align:right">Projection fin de chantier</th></tr></thead><tbody>
      ${bar("Coûts directs HT", x.budget ? E(x.budget) : "-", `${E(x.eac)} <small class="mut">(pessimiste ${E(x.eacP)})</small>`)}
      ${bar("Marché / facturé HT", x.rev ? E(x.rev) : "-", x.rev ? E(x.rev) : "-")}
      ${bar("Marge brute", x.margePrev !== null ? E(x.margePrev) : "-", x.hasRev ? `${E(x.marge)} <small class="mut">(${x.pct} %)</small>` : "-")}
      ${bar("Marge nette après frais généraux", "-", x.hasRev ? `<b class="${x.nette < 0 ? "dn" : ""}">${E(x.nette)}</b> <small class="mut">(${x.pctNette} %)</small>` : "-")}
      ${bar("Heures", x.hrs.hPrev ? hn(x.hrs.hPrev) : "-", x.hrs.proj !== null ? hn(x.hrs.proj) : "-")}
      ${bar("Fin du chantier", x.sch.end ? D(x.sch.end) : "-", x.sch.projEnd ? D(x.sch.projEnd) : "-")}
    </tbody></table></div>
    <p class="mut" style="font-size:13px;margin:10px 0 0">Déficit : <span class="chip ${x.defClass.c}">${x.defClass.l}</span> · Retard : ${lv(x.sch.score)} · Dépassement de budget : ${lv(x.sBudget)}${x.hrs.hs !== null ? ` · Heures supplémentaires : ${hn(x.hrs.hs)} (${x.hrs.crew} personne(s), ${x.hrs.weeks} semaine(s))` : ""}</p>`;
}
function rkDetail(id) {
  const c = byId(db.chantiers, id); if (!c) return;
  const x = rkData(c);
  modal(`Risques : ${esc(c.nom)}`, rkDetailHtml(x), { wide: true, xl: true, submit: false, cancel: "Fermer", extra: `<button type="button" class="btn o" data-go="chantiers/${c.id}">Ouvrir le chantier</button>` });
}
/* Carte compacte sur la fiche chantier */
function rkChantierHtml(c) {
  if (typeof permOk === "function" && !permOk("marges")) return "";
  if (c.statut === "Terminé") return "";
  const x = rkData(c);
  const k = (t, v, s, cls = "") => `<div class="kpi ${cls ? "lv-" + cls : ""}"><small>${t}</small><b class="num">${v}</b><span>${s}</span></div>`;
  return `<div class="dsh"><div class="dsh-h"><div><h2>Risques et prévisions</h2><span class="mut">Projection de fin de chantier d'après l'avancement actuel (${x.av} %)</span></div>${x.score === null ? "" : `<span class="verdict v-${rkLv(x.score)[2]}">${rkLv(x.score)[1]}</span>`}</div>
    <div class="kpis">
      ${k("Dépassement de budget", x.sBudget === null ? "?" : rkLv(x.sBudget)[1], x.sBudget === null ? "budget non défini" : x.dep > 0 ? `coût final estimé ${E(x.eac)} · +${E(x.dep)}` : `coût final estimé ${E(x.eac)}`, x.sBudget === null ? "" : rkLv(x.sBudget)[2] === "ok" ? "" : rkLv(x.sBudget)[2])}
      ${k("Retard", x.sch.score === null ? "?" : rkLv(x.sch.score)[1], x.sch.delay ? `${x.sch.delay} j de retard prévus` : x.sch.known ? "dans les délais" : "dates non définies", x.sch.score !== null && rkLv(x.sch.score)[2] !== "ok" ? rkLv(x.sch.score)[2] : "")}
      ${k("Marge finale estimée", x.hasRev ? E(x.marge) : "-", x.hasRev ? `${x.pct} % · nette ${x.pctNette} % · pessimiste ${E(x.margeP)}` : "rien à comparer", x.hasRev && x.nette < 0 ? "dn" : "")}
      ${k("Déficit", x.defClass.l, x.hasRev ? `marge nette estimée ${E(x.nette)}` : "marché non défini", x.defClass.c === "ok" || x.defClass.c === "mu" ? "" : x.defClass.c)}
      ${k("Heures supplémentaires", x.hrs.hs === null ? "-" : hn(x.hrs.hs), x.hrs.hs === null ? "non évaluable (dates, équipe ou heures prévues manquantes)" : x.hrs.hs ? `≈ ${E(x.hrs.cost)} de majoration` : "capacité suffisante", x.hrs.hs > 0 ? "wn" : "")}
    </div><p style="margin:10px 4px 0;font-size:13px"><button class="lk" data-act="rkDetail" data-id="${c.id}">Voir le détail du calcul ${svg(ic.ar)}</button></p></div>`;
}
/* Bloc d'accueil */
function rkHome() {
  if (!permOk("marges")) return "";
  const L = rkAll().filter((x) => x.score !== null && x.score >= 30).slice(0, 5);
  if (!L.length) return "";
  return card("Chantiers à risque", L.map((x) => `<div class="row lnk" data-act="rkDetail" data-id="${x.c.id}" style="cursor:pointer"><div><b>${esc(x.c.nom)}</b><small>${esc((x.reasons.find((r) => r.lv !== "n") || { t: "" }).t)}</small></div><span>${rkChip(x.score)}</span></div>`).join(""),
    `<button class="lk" data-go="risques">Tous les risques ${svg(ic.ar)}</button>`);
}
/* Alertes « À traiter » */
function rkPriorites(add) {
  if (typeof permOk === "function" && !permOk("marges")) return;
  for (const x of rkAll()) {
    if (x.defClass.c === "dn") add("u", 150 + (x.score || 0) / 2, `Déficit prévu : ${x.c.nom}`, `Marge nette finale estimée ${E(x.nette)} (${x.pctNette} %)`, 0, null, `chantiers/${x.c.id}`);
    else if (x.sBudget !== null && x.sBudget >= 75) add("i", 120 + (x.score || 0) / 2, `Dépassement de budget probable : ${x.c.nom}`, `Coût final estimé ${E(x.eac)} pour ${E(x.budget)} prévus`, 0, null, `chantiers/${x.c.id}`);
    else if (x.sch.score !== null && x.sch.score >= 75) add("i", 110 + (x.score || 0) / 2, `Retard important probable : ${x.c.nom}`, x.sch.note, 0, null, `chantiers/${x.c.id}`);
  }
  if (typeof permOk !== "function" || permOk("achats")) {
    const n = rkAnomalies().filter((a) => a.recent && a.sev >= 40).length;
    if (n) add("s", 90, `${n} dépense${n > 1 ? "s" : ""} atypique${n > 1 ? "s" : ""} à vérifier`, "Montants inhabituels ou doublons possibles", 0, null, "risques");
  }
}
/* Résumé pour l'assistant IA */
function rkAiNote() {
  return rkAll().slice(0, 12).map((x) => ({ chantier: x.c.nom, risque: rkLv(x.score)[1], avancement_pct: x.av, cout_final_estime_ht: x.eac, budget_ht: x.budget || null, depassement_estime: x.dep, retard_jours_prevus: x.sch.delay, marge_finale_estimee_ht: x.marge, marge_nette_finale_pct: x.pctNette, deficit: x.defClass.l, heures_sup_prevues: x.hrs.hs }));
}

const risquesActions = { rkDetail: (id) => rkDetail(id) };

// Bloc « Chantiers à risque » proposé dans la personnalisation de l'accueil
if (typeof HOME_W !== "undefined" && !HOME_W.some((w) => w[0] === "risques")) HOME_W.push(["risques", "Chantiers à risque (prévisions)"]);
if (typeof homeWidget === "function") { const rkHomeWidgetBase = homeWidget; homeWidget = function (id, c) { return id === "risques" ? rkHome() : rkHomeWidgetBase(id, c); }; }
