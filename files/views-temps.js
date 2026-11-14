/* Suivi des temps passés + rentabilité réelle des chantiers. */

const tpCost = (x) => r2(x.heures * x.taux_horaire);
const tpRange = () => {
  const k = ST.tpP || "mois", t = today(), y = +t.slice(0, 4), m = +t.slice(5, 7) - 1;
  if (k === "semaine") { const a = mondayOf(t); return [a, addD(a, 6), "Cette semaine"]; }
  if (k === "annee") return [`${y}-01-01`, `${y}-12-31`, `Année ${y}`];
  if (k === "tout") return ["0000-01-01", "9999-12-31", "Tout"];
  return [`${y}-${pad2(m + 1)}-01`, urIsoEom(y, m), `${MNL[m]} ${y}`];
};
const tpH = (h) => `${String(Math.round(h * 100) / 100).replace(".", ",")} h`;

function tempsForm(x, pre = {}) {
  if (!guard()) return;
  const v0 = { date_travail: today(), intervenant: "Moi", taux_horaire: db.ent.taux_horaire_cout, ...pre, ...(x || {}) };
  modal(x ? "Modifier le temps" : "Saisir du temps passé", `<div class="frm">${fld({ k: "date_travail", l: "Date", t: "date", v: v0.date_travail })}${fld({ k: "heures", l: "Heures (ex. 7,5)", t: "number", v: v0.heures ? String(v0.heures).replace(".", ",") : "" })}
    ${fld({ k: "chantier_id", l: "Chantier", t: "select", o: chOpts("Hors chantier (atelier, admin…)"), v: v0.chantier_id || "", r: 0, cls: "full" })}
    ${fld({ k: "intervenant", l: "Qui ?", v: v0.intervenant, hint: "Vous-même ou un salarié." })}${fld({ k: "taux_horaire", l: "Coût horaire (€)", t: "number", v: String(v0.taux_horaire).replace(".", ","), hint: "Salaire chargé / heure. Sert à calculer la rentabilité." })}
    ${db.taches.length ? fld({ k: "tache_id", l: "Tâche (facultatif)", t: "select", o: [{ v: "", l: "Aucune" }, ...db.taches.filter((t) => t.statut !== "Terminée" || t.id === v0.tache_id).map((t) => ({ v: t.id, l: t.titre }))], v: v0.tache_id || "", r: 0, cls: "full" }) : ""}
    ${fld({ k: "description", l: "Travail effectué", v: v0.description || "", r: 0, cls: "full" })}</div>`, {
    onSubmit: async (v, api) => {
      const h = parseNum(v.heures);
      if (!(h > 0 && h <= 24)) throw new Error("Saisissez un nombre d'heures entre 0 et 24.");
      const row = { date_travail: v.date_travail, heures: h, chantier_id: v.chantier_id || null, tache_id: v.tache_id || null, intervenant: v.intervenant.trim() || "Moi", taux_horaire: Math.max(0, parseNum(v.taux_horaire)), description: v.description || null };
      if (x) await q(sb.from("temps_passes").update(row).eq("id", x.id)); else await q(sb.from("temps_passes").insert(row));
      api.close(); toast("Temps enregistré.", "ok"); await refresh();
    }, extra: x ? btn("Supprimer", "tpDel", x.id, "", "lk dn") : "" });
}
function tauxForm() {
  if (!guard()) return;
  modal("Taux horaires", `<p class="mut" style="margin:0 0 10px">Valeurs proposées par défaut à chaque saisie. Le coût horaire correspond à ce que vous coûte une heure de travail (salaire chargé, ou ce que vous estimez valoir votre temps).</p><div class="frm">
    ${fld({ k: "taux_horaire_cout", l: "Coût horaire (€)", t: "number", v: String(db.ent.taux_horaire_cout).replace(".", ",") })}${fld({ k: "taux_horaire_vente", l: "Prix de vente horaire (€ HT)", t: "number", v: String(db.ent.taux_horaire_vente).replace(".", ","), hint: "Sert à comparer avec le CA réalisé par heure." })}</div>`, {
    onSubmit: async (v, api) => { await entPatch({ taux_horaire_cout: Math.max(0, parseNum(v.taux_horaire_cout)), taux_horaire_vente: Math.max(0, parseNum(v.taux_horaire_vente)) }); api.close(); toast("Taux enregistrés.", "ok"); await refresh(); } });
}

V.temps = () => {
  if (!db.v12) return page("Temps passés", "Heures par chantier et par personne.", "", card("", setupV12()));
  const [a, b, lab] = tpRange(), all = db.tps.filter((x) => x.date_travail >= a && x.date_travail <= b), f = ST.tpC || "";
  const L = all.filter((x) => !f || (f === "none" ? !x.chantier_id : x.chantier_id === f));
  const t0 = today(), wk = db.tps.filter((x) => x.date_travail >= mondayOf(t0) && x.date_travail <= addD(mondayOf(t0), 6)), mo = db.tps.filter((x) => x.date_travail.slice(0, 7) === t0.slice(0, 7));
  const byCh = {}; L.forEach((x) => { const k = x.chantier_id || "none"; (byCh[k] ||= { h: 0, c: 0 }); byCh[k].h += x.heures; byCh[k].c += tpCost(x); });
  const byWho = {}; L.forEach((x) => { (byWho[x.intervenant] ||= { h: 0, c: 0 }); byWho[x.intervenant].h += x.heures; byWho[x.intervenant].c += tpCost(x); });
  const rows = L.map((x) => ({ act: "tpEdit", id: x.id, t: `${x.intervenant} ${chNm(x.chantier_id)} ${x.description || ""}`, c: [D(x.date_travail), esc(x.intervenant), esc(chNm(x.chantier_id) || "Hors chantier") + (x.description ? `<small>${esc(x.description)}</small>` : ""), `<span class="num">${tpH(x.heures)}</span>`, `<span class="num">${E2(tpCost(x))}</span>`] }));
  const seg = (key, items, cur) => `<div class="seg">${items.map(([k, l]) => `<button data-act="tpPeriod" data-arg="${k}" aria-pressed="${cur === k}">${l}</button>`).join("")}</div>`;
  return page("Temps passés", "Les heures par chantier et par personne, pour connaître la vraie rentabilité.", btn("Saisir du temps", "tpNew", "", "", "w") + btn("Taux horaires", "tpTaux", "", "", "o w") + btn("Exporter (CSV)", "tpCsv", "", "", "o w"),
    strip([["Cette semaine", tpH(sum(wk, (x) => x.heures)), E(sum(wk, tpCost)) + " de main-d'œuvre"], ["Ce mois-ci", tpH(sum(mo, (x) => x.heures)), E(sum(mo, tpCost)) + " de main-d'œuvre"], ["Sur la période", tpH(sum(L, (x) => x.heures)), lab], ["Coût horaire par défaut", E2(db.ent.taux_horaire_cout), `vente ${E2(db.ent.taux_horaire_vente)}`]]) +
    `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">${seg("p", [["semaine", "Semaine"], ["mois", "Mois"], ["annee", "Année"], ["tout", "Tout"]], ST.tpP || "mois")}<select data-chg="tpCh" aria-label="Chantier" style="max-width:240px">${[{ v: "", l: "Tous les chantiers" }, { v: "none", l: "Hors chantier" }, ...db.chantiers.map((c) => ({ v: c.id, l: c.nom }))].map((o) => `<option value="${o.v}" ${o.v === f ? "selected" : ""}>${esc(o.l)}</option>`).join("")}</select></div>` +
    `<div class="g2"><div>${card(`Saisies · ${lab}`, tbl(["Date", "Qui", "Chantier / travail", { h: "Heures", r: 1 }, { h: "Coût", r: 1 }], rows, "Aucun temps saisi sur cette période."))}</div>
    <div>${card("Par chantier", Object.entries(byCh).sort((x, y) => y[1].h - x[1].h).map(([k, v]) => `<div class="row"><div><b>${esc(k === "none" ? "Hors chantier" : chNm(k) || "?")}</b></div><span class="num">${tpH(v.h)} · ${E(v.c)}</span></div>`).join("") || `<p class="mut" style="margin:0;padding:14px 18px">Rien sur cette période.</p>`)}
    ${card("Par personne", Object.entries(byWho).sort((x, y) => y[1].h - x[1].h).map(([k, v]) => `<div class="row"><div><b>${esc(k)}</b></div><span class="num">${tpH(v.h)} · ${E(v.c)}</span></div>`).join("") || `<p class="mut" style="margin:0;padding:14px 18px">Rien sur cette période.</p>`)}</div></div>`);
};

/* ---------- Rentabilité ---------- */
function chRenta(c) {
  const f = chFin(c), s = chStats(c), tps = db.tps.filter((x) => x.chantier_id === c.id), heures = sum(tps, (x) => x.heures), mo = sum(tps, tpCost), mat = typeof matCostByChantier === "function" && db.v12 ? matCostByChantier(c.id) : 0;
  const achats = f.lines.materiaux.reel + f.lines.autres.reel, st = f.lines.sous_traitance.reel, moDep = f.lines.main_oeuvre.reel;
  const couts = r2(achats + st + moDep + mo + mat), base = f.base, factureHT = s.factureHT;
  const margeFact = r2(factureHT - couts), margeMarche = r2(base - couts - f.engage);
  return { f, heures, mo, moDep, mat, achats, st, couts, base, factureHT, margeFact, margeMarche, pctFact: factureHT > 0 ? Math.round((margeFact / factureHT) * 100) : null, pctMarche: base > 0 ? Math.round((margeMarche / base) * 100) : null,
    caH: heures > 0 && factureHT > 0 ? r2(factureHT / heures) : null, budget: f.budget, engage: f.engage };
}
function rentaTab() {
  const per = ST.rtF || "actifs", L = db.chantiers.filter((c) => per === "tous" || c.statut !== "Terminé");
  const R = L.map((c) => ({ c, r: chRenta(c) })).filter(({ r }) => r.base || r.factureHT || r.couts).sort((a, b) => a.r.margeFact - b.r.margeFact);
  const T = { fact: sum(R, (x) => x.r.factureHT), couts: sum(R, (x) => x.r.couts), h: sum(R, (x) => x.r.heures) }, tauxV = db.ent.taux_horaire_vente;
  const rows = R.map(({ c, r }) => ({ go: `chantiers/${c.id}`, t: c.nom, c: [`<strong>${esc(c.nom)}</strong><small>${esc(c.client_nom || "")}</small>`, `<span class="num">${r.base ? E(r.base) : "-"}</span>`, `<span class="num">${E(r.factureHT)}</span>`,
    `<span class="num">${E(r.couts)}</span><small>${r.mo ? "dont MO pointée " + E(r.mo) : ""}${r.mat ? " · matériel " + E(r.mat) : ""}</small>`, `<span class="num ${r.margeFact < 0 ? "dn" : ""}">${E(r.margeFact)}</span>`,
    r.pctFact === null ? "-" : `<span class="chip ${r.pctFact < 0 ? "dn" : r.pctFact < 15 ? "wn" : "ok"}">${r.pctFact} %</span>`, r.heures ? `${tpH(r.heures)}<small>${r.caH ? E(r.caH) + " facturés / h" : ""}</small>` : "-"] }));
  return page("Rentabilité", "Ce que rapporte vraiment chaque chantier : facturé, coûts réels, main-d'œuvre pointée, matériel.", `<div class="seg">${[["actifs", "En cours"], ["tous", "Tous"]].map(([k, l]) => `<button data-act="rtFilter" data-arg="${k}" aria-pressed="${per === k}">${l}</button>`).join("")}</div>`,
    strip([["Facturé HT", E(T.fact), `${R.length} chantier${R.length > 1 ? "s" : ""}`], ["Coûts réels HT", E(T.couts), "achats, sous-traitance, MO, matériel"], ["Marge réelle", E(T.fact - T.couts), T.fact ? Math.round(((T.fact - T.couts) / T.fact) * 100) + " % du facturé" : "", T.fact - T.couts < 0 ? "dn" : ""],
      ["Heures pointées", tpH(T.h), T.h ? `${E(T.fact / T.h)} facturés / h · objectif ${E(tauxV)}` : "saisissez vos temps"]]) +
    card("Rentabilité par chantier (du moins au plus rentable)", tbl(["Chantier", { h: "Marché", r: 1 }, { h: "Facturé HT", r: 1 }, { h: "Coûts réels", r: 1 }, { h: "Marge", r: 1 }, "Marge %", "Heures"], rows, "Pas encore de chiffres. Renseignez des factures, des dépenses ou des temps passés.")) +
    `<p class="note">Marge réelle = facturé HT − (achats + sous-traitance + main-d'œuvre saisie en dépense + temps pointés × coût horaire + matériel affecté × coût journalier). Si vous saisissez la main-d'œuvre à la fois en dépense et en temps passés, elle est comptée deux fois : choisissez l'une des deux méthodes.</p>`);
}
V.rentabilite = () => (db.v12 ? rentaTab() : page("Rentabilité", "Rentabilité réelle des chantiers.", "", card("", setupV12())));

function chRentaCard(id) {
  if (!db.v12) return "";
  const c = byId(db.chantiers, id), r = chRenta(c);
  return card("Rentabilité réelle", `<dl class="kv"><dt>Facturé HT</dt><dd>${E(r.factureHT)}</dd><dt>Achats et autres</dt><dd>${E(r.achats)}</dd><dt>Sous-traitance</dt><dd>${E(r.st)}</dd><dt>Main-d'œuvre</dt><dd>${E(r.mo + r.moDep)}${r.heures ? ` <small class="mut">(${tpH(r.heures)} pointées)</small>` : ""}</dd><dt>Matériel</dt><dd>${E(r.mat)}</dd>
    <dt><b>Marge réelle</b></dt><dd><b class="${r.margeFact < 0 ? "dn" : ""}">${E(r.margeFact)}${r.pctFact !== null ? ` · ${r.pctFact} %` : ""}</b></dd>${r.base ? `<dt>Marge prévue sur le marché</dt><dd>${E(r.margeMarche)}${r.pctMarche !== null ? ` · ${r.pctMarche} %` : ""} <small class="mut">(après commandes engagées)</small></dd>` : ""}</dl>`, btn("Saisir du temps", "tpNew", "", "chantier:" + id, "o sm w"));
}

const tempsActions = {
  tpNew: (id, arg) => tempsForm(null, (arg || "").startsWith("chantier:") ? { chantier_id: arg.slice(9) } : {}),
  tpEdit: (id) => tempsForm(byId(db.tps, id)),
  tpDel: async (id) => { if (!guard() || !confirm("Supprimer cette saisie ?")) return; await q(sb.from("temps_passes").delete().eq("id", id)); document.querySelectorAll(".md").forEach((m) => m.remove()); await refresh(); },
  tpTaux: () => tauxForm(), tpPeriod: (id, arg) => { ST.tpP = arg; render(true); }, tpCh: (id) => { ST.tpC = id || ""; render(true); },
  tpCsv: () => { const [a, b] = tpRange(); csvDl(`temps-passes-${today()}.csv`, ["Date", "Intervenant", "Chantier", "Heures", "Coût horaire", "Coût", "Travail"], db.tps.filter((x) => x.date_travail >= a && x.date_travail <= b).map((x) => [x.date_travail, x.intervenant, chNm(x.chantier_id), x.heures, x.taux_horaire, tpCost(x), x.description || ""])); },
  rtFilter: (id, arg) => { ST.rtF = arg; render(true); },
};
