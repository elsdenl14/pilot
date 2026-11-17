/* Pilotage : objectifs de fin d'année et projection de trésorerie. */

/* ---------- Objectifs ---------- */
const obOf = (y) => db.obj.find((o) => o.annee === y);
function obReal(y) {
  const c = COMPTA.periode(y, 0, 11), t = today(), env = db.devis.filter((d) => d.statut !== "Brouillon" && (d.date_emission || d.created_at || "").slice(0, 4) === String(y)), acc = env.filter((d) => d.statut === "Accepté");
  const cost = c.achats + c.depenses + sum(db.tps.filter((x) => x.date_travail.slice(0, 4) === String(y)), tpCost);
  const chs = new Set(emises().filter((f) => f.date_emission.slice(0, 4) === String(y) && f.chantier_id).map((f) => f.chantier_id));
  const monthsDone = y < +t.slice(0, 4) ? 12 : y > +t.slice(0, 4) ? 0 : +t.slice(5, 7) - 1 + +t.slice(8) / 30;
  const backlog = sum(db.chantiers.filter((c2) => c2.statut !== "Terminé"), (c2) => Math.max(0, chFin(c2).base - chStats(c2).factureHT));
  const open = db.devis.filter((d) => d.statut === "Envoyé"), tx = env.length ? acc.length / env.length : 0.4;
  return { ca: c.caHT, cost, marge: c.caHT - cost, pct: c.caHT ? ((c.caHT - cost) / c.caHT) * 100 : 0, nb: chs.size, transfo: env.length ? Math.round((acc.length / env.length) * 100) : 0, monthsDone, backlog: r2(backlog), pipe: r2(sum(open, (d) => d.montant_ht) * tx), run: monthsDone >= 1 ? r2((c.caHT / monthsDone) * 12) : null };
}
function objForm(y) {
  if (!guard()) return;
  const o = obOf(y), n = (v) => (v ? String(v).replace(".", ",") : "");
  modal(`Objectifs ${y}`, `<p class="mut" style="margin:0 0 10px">Fixez vos cibles pour l'année. Laissez à 0 ce que vous ne souhaitez pas suivre.</p><div class="frm">${fld({ k: "ca_ht", l: "Chiffre d'affaires HT (€)", t: "number", v: n(o?.ca_ht), r: 0 })}${fld({ k: "marge_pct", l: "Marge visée (% du CA)", t: "number", v: n(o?.marge_pct), r: 0 })}
    ${fld({ k: "resultat", l: "Résultat visé (€)", t: "number", v: n(o?.resultat), r: 0 })}${fld({ k: "nb_chantiers", l: "Nombre de chantiers facturés", t: "number", v: n(o?.nb_chantiers), r: 0 })}
    ${fld({ k: "taux_transfo", l: "Taux de transformation des devis (%)", t: "number", v: n(o?.taux_transfo), r: 0 })}${fld({ k: "tresorerie_fin", l: "Trésorerie au 31/12 (€)", t: "number", v: n(o?.tresorerie_fin), r: 0 })}
    ${fld({ k: "notes", l: "Notes", t: "textarea", v: o?.notes || "", r: 0, cls: "full" })}</div>`, {
    onSubmit: async (v, api) => {
      const g = (k) => Math.max(0, parseNum(v[k]) || 0);
      await q(sb.from("objectifs").upsert({ annee: y, ca_ht: g("ca_ht"), marge_pct: Math.min(100, g("marge_pct")), resultat: g("resultat"), nb_chantiers: Math.round(g("nb_chantiers")), taux_transfo: Math.min(100, g("taux_transfo")), tresorerie_fin: g("tresorerie_fin"), notes: v.notes || null }, { onConflict: "user_id,annee" }));
      api.close(); toast("Objectifs enregistrés.", "ok"); await refresh();
    } });
}
const obBar = (label, real, target, fmt, hint, inverse) => {
  const p = target > 0 ? Math.min(100, Math.round((real / target) * 100)) : 0, ok = target > 0 && real >= target;
  return `<div class="cb" style="border-top:1px solid var(--line2)"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><b>${label}</b><span class="num">${fmt(real)} <span class="mut">/ ${target ? fmt(target) : "pas d'objectif"}</span></span></div>
    <div style="height:9px;border-radius:5px;background:var(--sunk);border:1px solid var(--line);margin:8px 0 4px;overflow:hidden"><div style="height:100%;width:${p}%;background:${ok ? "var(--ok)" : "var(--acc)"}"></div></div><small class="mut">${target ? p + " % de l'objectif" : "Définissez un objectif pour suivre"}${hint ? " · " + hint : ""}</small></div>`;
};
function objectifsPage() {
  const y = ST.obY || new Date().getFullYear(), o = obOf(y), R = obReal(y), t = today(), curY = +t.slice(0, 4), left = y === curY ? 12 - R.monthsDone : y > curY ? 12 : 0;
  const proj = r2(R.ca + R.backlog + R.pipe), mois = [];
  for (let m = 0; m < 12; m++) mois.push({ l: MN[m], ca: COMPTA.periode(y, m, m).caHT });
  let cum = 0; const cumul = mois.map((x) => (cum += x.ca));
  const tgt = o?.ca_ht || 0, gap = tgt - R.ca, permois = left > 0 ? Math.max(0, gap) / left : 0;
  const verdict = !tgt ? "" : R.ca >= tgt ? `<div class="fin-alert s"><b>Objectif de CA atteint</b><span>Vous avez facturé ${E(R.ca)} sur ${E(tgt)} visés.</span></div>` : proj >= tgt ? `<div class="fin-alert s"><b>Objectif atteignable</b><span>Avec le carnet et les devis en attente, la projection (${E(proj)}) dépasse l'objectif. Il reste ${E(gap)} à facturer${left > 0 ? `, soit ${E(permois)} par mois` : ""}.</span></div>` :
    `<div class="fin-alert ${left < 3 ? "u" : "i"}"><b>Il manque ${E(tgt - proj)} pour atteindre l'objectif</b><span>Projection ${E(proj)} (réalisé ${E(R.ca)} + carnet ${E(R.backlog)} + devis en attente pondérés ${E(R.pipe)}). Il faut signer environ ${E(tgt - proj)} HT de chantiers supplémentaires${left > 0 ? ` d'ici la fin de l'année, soit ${E((tgt - proj) / Math.max(left, 1))} par mois` : ""}.</span></div>`;
  const yrs = [curY - 1, curY, curY + 1];
  return page("Objectifs", "Vos cibles de l'année et où vous en êtes.", `<div class="seg">${yrs.map((v) => `<button data-act="obYear" data-arg="${v}" aria-pressed="${v === y}">${v}</button>`).join("")}</div>` + btn(o ? "Modifier les objectifs" : "Fixer mes objectifs", "obEdit", String(y), "", "w"),
    strip([["CA HT facturé", E(R.ca), tgt ? `${Math.round((R.ca / tgt) * 100)} % de ${E(tgt)}` : "pas d'objectif"], ["Marge", R.ca ? Math.round(R.pct) + " %" : "-", `${E(R.marge)} · après achats, dépenses et temps pointés`], ["Carnet à facturer", E(R.backlog), "chantiers en cours : marché - facturé"], ["Projection fin d'année", E(proj), "réalisé + carnet + devis pondérés", tgt && proj < tgt ? "wn" : ""]]) + verdict +
    card(`Objectifs ${y}`, obBar("Chiffre d'affaires HT", R.ca, o?.ca_ht || 0, E, R.run ? `au rythme actuel : ${E(R.run)} sur l'année` : "") + obBar("Marge (% du CA)", Math.round(R.pct), o?.marge_pct || 0, (v) => v + " %", "") + obBar("Résultat", Math.max(0, R.marge), o?.resultat || 0, E, "") +
      obBar("Chantiers facturés", R.nb, o?.nb_chantiers || 0, (v) => String(v), "") + obBar("Taux de transformation des devis", R.transfo, o?.taux_transfo || 0, (v) => v + " %", "devis acceptés / envoyés") + obBar("Trésorerie au 31/12", Math.max(0, tresorerie()), o?.tresorerie_fin || 0, E, "aujourd'hui, à comparer à la projection de trésorerie")) +
    card("CA cumulé par mois", tbl(["Mois", { h: "Facturé HT", r: 1 }, { h: "Cumulé", r: 1 }, { h: "Cible cumulée", r: 1 }, "Avance"], mois.map((x, i) => { const c = tgt ? (tgt * (i + 1)) / 12 : 0, d = cumul[i] - c, fut = y === curY && i > new Date().getMonth() || y > curY; return { c: [MNL[i], `<span class="num">${E(x.ca)}</span>`, `<span class="num">${fut ? "-" : E(cumul[i])}</span>`, `<span class="num">${tgt ? E(c) : "-"}</span>`, tgt && !fut ? `<span class="chip ${d >= 0 ? "ok" : "wn"}">${d >= 0 ? "+" : ""}${E(d)}</span>` : "-"] }; }))));
}
V.objectifs = () => (db.v12 ? objectifsPage() : page("Objectifs", "Vos cibles de l'année.", "", card("", setupV12())));

/* ---------- Projection de trésorerie ---------- */
const PR_SRC = { fa: ["Encaissement client", "ok"], ca: ["Carnet de commandes", "bl"], de: ["Paiement fournisseur", "wn"], ch: ["Charge récurrente", "wn"], tv: ["TVA estimée", "wn"], ur: ["Cotisations URSSAF", "wn"], en: ["Entrée prévue", "ok"] };
function prRecur(c, from, to) {
  const out = []; let d = c.date_debut;
  const step = (x) => { const dt = new Date(x + "T12:00:00"), day = new Date(c.date_debut + "T12:00:00").getDate(), mths = c.frequence === "Mensuelle" ? 1 : c.frequence === "Trimestrielle" ? 3 : 12; const n = new Date(dt.getFullYear(), dt.getMonth() + mths, 1, 12); n.setDate(Math.min(day, new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate())); return n.toISOString().slice(0, 10); };
  for (let i = 0; i < 400 && d <= to; i++) { if (d >= from && (!c.date_fin || d <= c.date_fin)) out.push(d); if (c.frequence === "Ponctuelle") break; d = step(d); }
  return out;
}
function prevision(horizonDays, o) {
  const t = today(), end = addD(t, horizonDays - 1), moves = [], add = (d, amt, label, src) => { if (!amt) return; const dd = d < t ? t : d; if (dd <= end) moves.push({ d: dd, amt: r2(amt), label, src }); };
  const delay = o.delay || 0;
  for (const f of ouvertes()) { const pm = db.v9 && typeof rgPromesse === "function" ? rgPromesse(f.id) : null; let d = pm && pm.date_promesse >= t ? pm.date_promesse : f.echeance < t ? addD(t, 7) : f.echeance; add(addD(d, delay), f.reste, `${f.numero} · ${f.client_nom}`, "fa"); }
  if (o.carnet) for (const c of db.chantiers) { if (c.statut === "Terminé") continue; const acc = sum(db.devis.filter((d) => d.chantier_id === c.id && d.statut === "Accepté"), (d) => d.montant_ttc), fac = sum(emises().filter((f) => f.chantier_id === c.id), (f) => f.montant_ttc), rest = r2(acc - fac);
    if (rest > 1) add(addD(c.date_fin && c.date_fin >= t ? c.date_fin : addD(t, 45), (db.ent.delai_paiement_jours || 30) + delay), -0 + rest * 0.9, `Reste à facturer : ${c.nom}`, "ca"); }
  for (const d of db.depenses) if (d.statut === "À payer" && !d.lot_id) add(d.echeance || addD(d.date_depense, 30), -d.montant_ttc, `${d.fournisseur}${d.reference ? " · " + d.reference : ""}`, "de");
  if (db.v11) for (const d of db.depenses) if (d.statut === "À payer" && d.lot_id) { const l = byId(db.lots, d.lot_id); if (l && l.statut === "Préparé") add(l.date_execution, -d.montant_ttc, `${d.fournisseur} (lot ${l.reference})`, "de"); }
  for (const c of db.chg) if (c.actif) for (const d of prRecur(c, t, end)) add(d, c.sens === "Entrée" ? c.montant : -c.montant, c.libelle, c.sens === "Entrée" ? "en" : "ch");
  if (o.tva && (db.ent.tva_regime || "") !== "franchise") {
    const jt = Math.min(28, Math.max(1, db.ent.jour_tva ?? 20)), y0 = +t.slice(0, 4), m0 = +t.slice(5, 7) - 1, hist = [];
    for (let k = 1; k <= 3; k++) { const dt = new Date(y0, m0 - k, 1); hist.push(COMPTA.periode(dt.getFullYear(), dt.getMonth(), dt.getMonth()).tvaAPayer); }
    const avg = Math.max(0, sum(hist, (x) => x) / 3);
    for (let k = 0; k < 8; k++) { const dt = new Date(y0, m0 + k, jt, 12), d = dt.toISOString().slice(0, 10); if (d < t || d > end) continue; const prev = new Date(y0, m0 + k - 1, 1), val = k === 0 ? Math.max(0, COMPTA.periode(prev.getFullYear(), prev.getMonth(), prev.getMonth()).tvaAPayer) : avg; add(d, -val, `TVA ${/^[aeiouéû]/i.test(MNL[prev.getMonth()]) ? "d'" : "de "}${MNL[prev.getMonth()].toLowerCase()}`, "tv"); }
  }
  if (o.urssaf && typeof urOn === "function" && urOn()) for (const p of urCalc().periods) { if (p.d || p.cot <= 0) continue; add(p.due, -p.cot, `Cotisations URSSAF ${p.lab}`, "ur"); }
  return moves.sort((a, b) => a.d.localeCompare(b.d));
}
function prBuckets(mode) {
  const t = today(), B = [];
  if (mode === "mois") { let y = +t.slice(0, 4), m = +t.slice(5, 7) - 1; for (let i = 0; i < 6; i++) { const a = i === 0 ? t : `${y}-${pad2(m + 1)}-01`; B.push([a, urIsoEom(y, m), i === 0 ? "Fin " + MN[m] : MN[m] + " " + String(y).slice(2)]); if (++m > 11) { m = 0; y++; } } return B; }
  for (let i = 0; i < 13; i++) B.push([addD(t, i * 7), addD(t, i * 7 + 6), i === 0 ? "Sem. 1" : `S${i + 1}`]);
  return B;
}
function prChart(pts, labels) {
  const W = 760, H = 190, P = 28, vals = pts, mn = Math.min(0, ...vals), mx = Math.max(0, ...vals), span = mx - mn || 1, X = (i) => P + (i * (W - 2 * P)) / Math.max(1, vals.length - 1), Y = (v) => H - P - ((v - mn) / span) * (H - 2 * P);
  const line = vals.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" "), neg = vals.some((v) => v < 0);
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto" role="img" aria-label="Solde de trésorerie prévu"><line x1="${P}" x2="${W - P}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--line)" stroke-width="1"/>
    <polyline points="${line}" fill="none" stroke="${neg ? "var(--dn)" : "var(--acc)"}" stroke-width="2.5" stroke-linejoin="round"/>${vals.map((v, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="3.5" fill="${v < 0 ? "var(--dn)" : "var(--acc)"}"><title>${labels[i]} : ${E(v)}</title></circle>`).join("")}
    ${labels.map((l, i) => (labels.length <= 8 || i % 2 === 0 ? `<text x="${X(i).toFixed(1)}" y="${H - 8}" font-size="10" text-anchor="middle" fill="var(--mut)">${l}</text>` : "")).join("")}</svg>`;
}
function chargeForm(c) {
  if (!guard()) return;
  modal(c ? "Modifier la charge" : "Charge ou entrée récurrente", `<p class="mut" style="margin:0 0 10px">Ce qui revient régulièrement et n'est pas dans vos factures : loyer, assurance, véhicule, salaires, emprunt, abonnements…</p><div class="frm">
    ${fld({ k: "libelle", l: "Libellé", v: c?.libelle, cls: "full" })}${fld({ k: "sens", l: "Nature", t: "select", o: ["Sortie", "Entrée"], v: c?.sens || "Sortie" })}${fld({ k: "montant", l: "Montant TTC (€)", t: "number", v: c ? String(c.montant).replace(".", ",") : "" })}
    ${fld({ k: "frequence", l: "Fréquence", t: "select", o: ["Mensuelle", "Trimestrielle", "Annuelle", "Ponctuelle"], v: c?.frequence || "Mensuelle" })}${fld({ k: "date_debut", l: "Prochaine échéance / début", t: "date", v: c?.date_debut || today() })}
    ${fld({ k: "date_fin", l: "Jusqu'au (facultatif)", t: "date", v: c?.date_fin || "", r: 0 })}<label class="chk" style="display:flex;gap:8px"><input type="checkbox" name="actif" ${c && !c.actif ? "" : "checked"}> <span>Actif</span></label></div>`, {
    onSubmit: async (v, api) => {
      const m = parseNum(v.montant); if (!(m >= 0)) throw new Error("Montant invalide.");
      const row = { libelle: v.libelle.trim(), sens: v.sens, montant: m, frequence: v.frequence, date_debut: v.date_debut, date_fin: v.date_fin || null, actif: "actif" in v };
      if (c) await q(sb.from("tresorerie_charges").update(row).eq("id", c.id)); else await q(sb.from("tresorerie_charges").insert(row));
      api.close(); toast("Enregistré.", "ok"); await refresh();
    }, extra: c ? btn("Supprimer", "chgDel", c.id, "", "lk dn") : "" });
}
function tresoPage() {
  const mode = ST.prM || "sem", o = { delay: ST.prD || 0, carnet: !!ST.prC, tva: ST.prT !== false, urssaf: ST.prU !== false }, B = prBuckets(mode), end = B[B.length - 1][1], hor = daysBetween(today(), end) + 1;
  const moves = prevision(hor, o), start = tresorerie();
  let bal = start; const rows = B.map(([a, b, l]) => { const M = moves.filter((m) => m.d >= a && m.d <= b), ent = sum(M.filter((m) => m.amt > 0), (m) => m.amt), sor = -sum(M.filter((m) => m.amt < 0), (m) => m.amt); bal = r2(bal + ent - sor); return { a, b, l, ent, sor, bal }; });
  const low = rows.reduce((x, y) => (y.bal < x.bal ? y : x), rows[0]), firstNeg = rows.find((r) => r.bal < 0), finalB = rows[rows.length - 1].bal;
  const alert = firstNeg ? `<div class="fin-alert u"><b>Trésorerie négative prévue ${mode === "mois" ? "en " + firstNeg.l : "la semaine du " + D(firstNeg.a)}</b><span>Point bas : ${E(low.bal)} (${low.l}). Relancez les clients en retard, décalez des paiements fournisseurs ou prévoyez un financement.</span></div>` : `<div class="fin-alert s"><b>Pas de tension de trésorerie prévue</b><span>Point bas : ${E(low.bal)} (${low.l}).</span></div>`;
  const tgl = (k, l, on) => `<label class="mut" style="display:flex;gap:6px;align-items:center;font-size:13px"><input type="checkbox" data-act="prToggle" data-id="${k}" ${on ? "checked" : ""}> ${l}</label>`;
  const list = moves.slice(0, 40).map((m) => ({ c: [D(m.d), `${esc(m.label)}`, `<span class="chip ${PR_SRC[m.src][1]}">${PR_SRC[m.src][0]}</span>`, `<span class="num ${m.amt < 0 ? "dn" : ""}">${m.amt < 0 ? "-" : "+"}${E2(Math.abs(m.amt))}</span>`] }));
  return page("Trésorerie prévue", "Votre solde estimé semaine après semaine : encaissements attendus, paiements à faire, charges et impôts.", `<div class="seg">${[["sem", "13 semaines"], ["mois", "6 mois"]].map(([k, l]) => `<button data-act="prMode" data-arg="${k}" aria-pressed="${mode === k}">${l}</button>`).join("")}</div>`,
    strip([["Solde estimé aujourd'hui", E(start), "encaissements - décaissements"], ["Solde prévu", E(finalB), `au ${D(end)}`, finalB < 0 ? "dn" : ""], ["Point bas", E(low.bal), low.l, low.bal < 0 ? "dn" : ""], ["Mouvements prévus", moves.length, `${E(sum(moves.filter((m) => m.amt > 0), (m) => m.amt))} entrées · ${E(-sum(moves.filter((m) => m.amt < 0), (m) => m.amt))} sorties`]]) + alert +
    card("Solde prévu", `<div class="cb">${prChart([start, ...rows.map((r) => r.bal)], ["Auj.", ...rows.map((r) => r.l)])}</div>`) +
    card("Hypothèses", `<div class="cb" style="display:flex;gap:10px 22px;flex-wrap:wrap;align-items:center">${tgl("carnet", "Inclure le reste à facturer des devis acceptés", o.carnet)}${tgl("tva", "TVA estimée", o.tva)}${tgl("urssaf", "Cotisations URSSAF", o.urssaf)}
      <label class="mut" style="display:flex;gap:6px;align-items:center;font-size:13px">Clients qui paient avec <select data-chg="prDelay">${[0, 15, 30, 45].map((n) => `<option value="${n}" ${n === o.delay ? "selected" : ""}>${n ? n + " jours de retard" : "aucun retard"}</option>`).join("")}</select></label></div>`) +
    card("Semaine par semaine".replace("Semaine par semaine", mode === "mois" ? "Mois par mois" : "Semaine par semaine"), tbl(["Période", { h: "Entrées", r: 1 }, { h: "Sorties", r: 1 }, { h: "Solde", r: 1 }], rows.map((r) => ({ c: [`<strong>${r.l}</strong><small>${D(r.a)} → ${D(r.b)}</small>`, `<span class="num">${E(r.ent)}</span>`, `<span class="num">${E(r.sor)}</span>`, `<span class="num ${r.bal < 0 ? "dn" : ""}"><b>${E(r.bal)}</b></span>`] })))) +
    card("Charges et entrées récurrentes", tbl(["Libellé", "Fréquence", "Prochaine", { h: "Montant", r: 1 }], db.chg.map((c) => ({ act: "chgEdit", id: c.id, c: [`<strong>${esc(c.libelle)}</strong>${c.actif ? "" : "<small>Inactif</small>"}`, c.frequence, D(c.date_debut), `<span class="num ${c.sens === "Sortie" ? "dn" : ""}">${c.sens === "Sortie" ? "-" : "+"}${E2(c.montant)}</span>`] })), "Aucune. Ajoutez votre loyer, vos assurances, salaires…"), btn("Ajouter", "chgNew", "", "", "o sm w")) +
    card("Détail des prochains mouvements", tbl(["Date", "Libellé", "Origine", { h: "Montant", r: 1 }], list, "Aucun mouvement prévu.")) +
    `<p class="note">Projection indicative : les clients sont supposés payer à l'échéance (ou à la date de paiement promise) ; une facture déjà échue est attendue sous 7 jours. Les paiements fournisseurs suivent leur échéance. La TVA du premier mois est calculée, les suivants reposent sur la moyenne des 3 derniers mois.</p>`);
}
V.tresorerie = () => (db.v12 ? tresoPage() : page("Trésorerie prévue", "Projection de trésorerie.", "", card("", setupV12())));

const pilotageActions = {
  obYear: (id, arg) => { ST.obY = Number(arg); render(true); }, obEdit: (id) => objForm(Number(id)),
  prMode: (id, arg) => { ST.prM = arg; render(true); }, prDelay: (id) => { ST.prD = Number(id) || 0; render(true); },
  prToggle: (id) => { const k = { carnet: "prC", tva: "prT", urssaf: "prU" }[id], cur = k === "prC" ? !!ST.prC : ST[k] !== false; ST[k] = !cur; render(true); },
  chgNew: () => chargeForm(null), chgEdit: (id) => chargeForm(byId(db.chg, id)),
  chgDel: async (id) => { if (!guard() || !confirm("Supprimer cette ligne ?")) return; await q(sb.from("tresorerie_charges").delete().eq("id", id)); document.querySelectorAll(".md").forEach((m) => m.remove()); await refresh(); },
};
