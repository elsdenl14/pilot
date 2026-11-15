/* Terrain, équipes et ressources : salariés, pointages, paie, absences, affectations et conflits, rapports d'intervention, photos. */

const setupV15 = () => `<div class="empty" style="padding:30px 20px"><h2>Une étape manque</h2><p style="max-width:560px;margin:6px auto 14px">Exécutez <b>migration_v15.sql</b> dans Supabase (SQL Editor), puis rechargez cette page.</p>${db.v15err ? `<p class="mut"><small>${esc(db.v15err)}</small></p>` : ""}</div>`;

async function loadV15() {
  db.v15 = false;
  Object.assign(db, { eqp: [], sal: [], ptg: [], abs: [], aff: [], rap: [], ph: [], slx: [], sar: [], smv: [], sinv: [], sinl: [], per: [], rpr: [], rprl: [], rpre: [] });
  try {
    const t = (n, o) => q(sb.from(n).select(o || "*"));
    const [eqp, sal, ptg, abs, aff, rap, ph, slx, sar, smv, sinv, sinl, per, rpr, rprl, rpre] = await Promise.all([
      t("equipes"), t("salaries"), t("pointages"), t("absences"), t("affectations"), t("rapports"),
      t("terrain_photos", "id,salarie_id,chantier_id,rapport_id,legende,created_at"),
      t("stock_lieux"), t("stock_articles"), t("stock_mouvements"), t("stock_inventaires"), t("stock_inventaire_lignes"), t("materiel_periodes"),
      t("rapprochements"), t("rapprochement_lignes"), t("rapprochement_events"),
    ]);
    const N = (a, k) => a.forEach((x) => nz(x, k));
    N(eqp, ["cout_horaire"]); N(sal, ["salaire_brut_mensuel", "taux_charges", "heures_mensuelles", "cout_horaire"]); N(ptg, ["heures", "trajet_minutes", "trajet_km"]);
    N(rap, ["heures"]); N(sar, ["prix_unitaire", "seuil_mini"]); N(smv, ["quantite", "prix_unitaire"]); N(sinv, ["valeur_stock", "ecart_valeur"]); N(sinl, ["theorique", "pmp"]);
    N(per, ["cout_jour"]); N(rprl, ["qte_cmd", "pu_cmd"]); N(rpre, ["quantite", "prix_unitaire"]);
    Object.assign(db, { eqp, sal, ptg, abs, aff, rap, ph, slx, sar, smv, sinv, sinl, per, rpr, rprl, rpre, v15: true, v15err: "" });
  } catch (e) { db.v15 = false; db.v15err = e?.message || String(e); }
}

/* ---------- Outils ---------- */
const hn = (h) => `${String(Math.round(h * 100) / 100).replace(".", ",")} h`;
const salNm = (id) => byId(db.sal, id)?.nom || "?";
const eqNm = (id) => byId(db.eqp, id)?.nom || "";
const salCout = (s) => Number(s?.cout_horaire) || Number(byId(db.eqp, s?.equipe_id)?.cout_horaire) || Number(db.ent.taux_horaire_cout) || 0;
const rhReg = () => ({ seuil_hebdo: 35, hs1_pct: 25, hs1_jusqua: 43, hs2_pct: 50, panier_montant: 0, trajet_eur_km: 0, ...(db.ent.rh_reglages || {}) });
const terrainLink = (s) => new URL(`terrain.html?t=${s.token}`, location.href).href;
const workdays = (a, b) => { let n = 0; for (let d = a; d <= b; d = addD(d, 1)) if (dow(d) < 5) n++; return n; };
const eomOf = (ym) => { const [y, m] = ym.split("-").map(Number); return `${ym}-${pad2(new Date(y, m, 0).getDate())}`; };
const shiftYm = (ym, n) => { const [y, m] = ym.split("-").map(Number), d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; };
const ymLabel = (ym) => `${MNL[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;
const rhNum = (v) => String(v ?? "").replace(".", ",");

/* ---------- Salariés et équipes ---------- */
function salarieForm(s) {
  if (!guard()) return;
  const v = { taux_charges: 42, heures_mensuelles: 151.67, ...(s || {}) };
  modal(s ? "Modifier le salarié" : "Nouveau salarié", `<div class="frm">
    ${fld({ k: "nom", l: "Nom", v: v.nom || "" })}${fld({ k: "poste", l: "Poste", v: v.poste || "", r: 0 })}
    ${fld({ k: "telephone", l: "Téléphone", v: v.telephone || "", r: 0 })}${fld({ k: "equipe_id", l: "Équipe", t: "select", o: [{ v: "", l: "Aucune" }, ...db.eqp.map((e) => ({ v: e.id, l: e.nom }))], v: v.equipe_id || "", r: 0 })}
    <p class="full cx-help">Coût horaire chargé = salaire brut × (1 + charges patronales) ÷ heures mensuelles. Renseignez les trois champs pour le calculer, ou saisissez directement le coût horaire.</p>
    ${fld({ k: "salaire_brut_mensuel", l: "Salaire brut mensuel (€)", t: "number", v: rhNum(v.salaire_brut_mensuel), r: 0 })}${fld({ k: "taux_charges", l: "Charges patronales (%)", t: "number", v: rhNum(v.taux_charges), r: 0 })}
    ${fld({ k: "heures_mensuelles", l: "Heures par mois", t: "number", v: rhNum(v.heures_mensuelles), r: 0 })}${fld({ k: "cout_horaire", l: "Coût horaire chargé (€/h)", t: "number", v: rhNum(v.cout_horaire || ""), r: 0, hint: "Laissez vide pour le calculer ou reprendre celui de l'équipe." })}
    ${s ? fld({ k: "actif", l: "Statut", t: "select", o: [{ v: "1", l: "Actif" }, { v: "0", l: "Parti (lien désactivé)" }], v: s.actif ? "1" : "0", r: 0 }) : ""}</div>`, {
    onSubmit: async (f, api) => {
      const brut = parseNum(f.salaire_brut_mensuel), ch = parseNum(f.taux_charges), hm = parseNum(f.heures_mensuelles) || 151.67;
      let cout = parseNum(f.cout_horaire);
      if (!cout && brut > 0) cout = r2((brut * (1 + ch / 100)) / hm);
      const row = { nom: f.nom.trim(), poste: f.poste || null, telephone: f.telephone || null, equipe_id: f.equipe_id || null, salaire_brut_mensuel: brut || null, taux_charges: ch, heures_mensuelles: hm, cout_horaire: cout };
      if (s) { if (f.actif !== undefined) row.actif = f.actif === "1"; await q(sb.from("salaries").update(row).eq("id", s.id)); } else await q(sb.from("salaries").insert(row));
      api.close(); toast("Salarié enregistré.", "ok"); await refresh();
    },
    extra: s ? btn("Supprimer", "eqSalDel", s.id, "", "lk dn") : "",
  });
}
function equipeForm(e) {
  if (!guard()) return;
  modal(e ? "Modifier l'équipe" : "Nouvelle équipe", `<div class="frm">${fld({ k: "nom", l: "Nom de l'équipe", v: e?.nom || "" })}${fld({ k: "cout_horaire", l: "Coût horaire chargé par défaut (€/h)", t: "number", v: rhNum(e?.cout_horaire || ""), r: 0, hint: "Utilisé pour les salariés sans coût propre." })}</div>`, {
    onSubmit: async (f, api) => {
      const row = { nom: f.nom.trim(), cout_horaire: parseNum(f.cout_horaire) || null };
      if (e) await q(sb.from("equipes").update(row).eq("id", e.id)); else await q(sb.from("equipes").insert(row));
      api.close(); toast("Équipe enregistrée.", "ok"); await refresh();
    },
    extra: e ? btn("Supprimer", "eqEqDel", e.id, "", "lk dn") : "",
  });
}
V.equipes = () => {
  if (!db.v15) return page("Équipes et salariés", "Salariés, coûts horaires chargés et liens de pointage mobile.", "", card("", setupV15()));
  const act = db.sal.filter((s) => s.actif), apv = db.ptg.filter((p) => p.statut === "À valider").length;
  const rows = db.sal.map((s) => ({ act: "eqSalEdit", id: s.id, t: `${s.nom} ${s.poste || ""} ${eqNm(s.equipe_id)}`, cls: s.actif ? "" : "mut",
    c: [`<strong>${esc(s.nom)}</strong><small>${esc(s.poste || "")}${s.actif ? "" : " · parti"}</small>`, esc(eqNm(s.equipe_id) || "-"), `<span class="num">${E(salCout(s))}/h</span>${s.cout_horaire ? "" : "<small>par défaut</small>"}`,
      s.actif ? `<button class="lk w" data-act="eqCopy" data-id="${s.id}">Copier le lien</button> · <button class="lk w" data-act="eqSms" data-id="${s.id}">SMS</button> · <button class="lk w" data-act="eqNewLink" data-id="${s.id}">Régénérer</button>` : "-"] }));
  const er = db.eqp.map((e) => ({ act: "eqEqEdit", id: e.id, t: e.nom, c: [`<strong>${esc(e.nom)}</strong>`, `${db.sal.filter((s) => s.equipe_id === e.id && s.actif).length} salarié(s)`, e.cout_horaire ? `<span class="num">${E(e.cout_horaire)}/h</span>` : "-"] }));
  return page("Équipes et salariés", "Chaque salarié reçoit un lien privé pour pointer ses heures et faire ses rapports depuis son téléphone.", btn("Nouveau salarié", "eqSalNew", "", "", "w") + btn("Nouvelle équipe", "eqEqNew", "", "", "o w"),
    strip([["Salariés actifs", String(act.length), `${db.eqp.length} équipe(s)`], ["Coût horaire moyen", act.length ? E(sum(act, salCout) / act.length) : "-", "chargé"], ["Pointages à valider", String(apv), apv ? "voir Pointages et paie" : "tout est validé", apv ? "wn" : ""]]) +
    card("Salariés", tbl(["Salarié", "Équipe", { h: "Coût horaire chargé", r: 1 }, "Pointage mobile"], rows, "Ajoutez vos salariés pour leur donner un accès de pointage.")) +
    card("Équipes", tbl(["Équipe", "Composition", { h: "Coût horaire", r: 1 }], er, "Aucune équipe : facultatif.")) +
    `<p class="note">Le lien de pointage est personnel : toute personne qui le possède peut saisir des heures au nom du salarié. Régénérez-le si le téléphone est perdu ou si la personne quitte l'entreprise. Ouvrez-le sur le téléphone puis ajoutez-le à l'écran d'accueil.</p>`);
};

/* ---------- Pointages : validation ---------- */
const ptgTemps = (p) => ({ date_travail: p.date_travail, heures: p.heures, chantier_id: p.chantier_id || null, tache_id: p.tache_id || null, intervenant: salNm(p.salarie_id), taux_horaire: salCout(byId(db.sal, p.salarie_id)), description: p.description || null });
async function ptgValider(ids) {
  for (const id of ids) {
    const p = byId(db.ptg, id); if (!p || p.statut === "Validé") continue;
    const t = await q(sb.from("temps_passes").insert(ptgTemps(p)).select("id").single());
    await q(sb.from("pointages").update({ statut: "Validé", temps_id: t.id, valide_at: new Date().toISOString(), motif_refus: null }).eq("id", id));
  }
}
function pointageForm(p) {
  if (!guard()) return;
  const v = { date_travail: today(), heures: "", panier: false, trajet_minutes: 0, trajet_km: 0, ...(p || {}) };
  if (!db.sal.length) return toast("Ajoutez d'abord un salarié.", "dn");
  modal(p ? "Modifier le pointage" : "Saisir des heures pour un salarié", `<div class="frm">
    ${fld({ k: "salarie_id", l: "Salarié", t: "select", o: db.sal.filter((s) => s.actif || s.id === v.salarie_id).map((s) => ({ v: s.id, l: s.nom })), v: v.salarie_id || db.sal[0].id })}
    ${fld({ k: "date_travail", l: "Date", t: "date", v: v.date_travail })}${fld({ k: "heures", l: "Heures", t: "number", v: rhNum(v.heures) })}
    ${fld({ k: "chantier_id", l: "Chantier", t: "select", o: chOpts("Hors chantier"), v: v.chantier_id || "", r: 0 })}
    ${db.taches.length ? fld({ k: "tache_id", l: "Tâche", t: "select", o: [{ v: "", l: "Aucune" }, ...db.taches.map((t) => ({ v: t.id, l: t.titre }))], v: v.tache_id || "", r: 0 }) : ""}
    ${fld({ k: "description", l: "Travail effectué", v: v.description || "", r: 0, cls: "full" })}
    ${fld({ k: "trajet_minutes", l: "Trajet (minutes)", t: "number", v: rhNum(v.trajet_minutes || ""), r: 0 })}${fld({ k: "trajet_km", l: "Trajet (km)", t: "number", v: rhNum(v.trajet_km || ""), r: 0 })}
    <label class="chk full"><input type="checkbox" name="panier"${v.panier ? " checked" : ""}> Panier repas</label></div>`, {
    onSubmit: async (f, api) => {
      const h = parseNum(f.heures); if (!(h > 0 && h <= 24)) throw new Error("Saisissez un nombre d'heures entre 0 et 24.");
      const row = { salarie_id: f.salarie_id, date_travail: f.date_travail, heures: h, chantier_id: f.chantier_id || null, tache_id: f.tache_id || null, description: f.description || null, panier: !!f.panier && f.panier !== "false",
        trajet_minutes: Math.round(parseNum(f.trajet_minutes)), trajet_km: parseNum(f.trajet_km) };
      if (p) {
        if (p.statut === "Validé" && p.temps_id) await q(sb.from("temps_passes").update(ptgTemps({ ...p, ...row })).eq("id", p.temps_id));
        await q(sb.from("pointages").update(row).eq("id", p.id));
      } else { const n = await q(sb.from("pointages").insert({ ...row, source: "bureau" }).select("id").single()); await ptgValider([n.id]); }
      api.close(); toast("Pointage enregistré.", "ok"); await refresh();
    },
    extra: p ? btn("Supprimer", "ptDel", p.id, "", "lk dn") : "",
  });
}
function refusForm(id) {
  modal("Refuser le pointage", `<div class="frm">${fld({ k: "motif", l: "Motif (visible par le salarié)", r: 0, cls: "full" })}</div>`, {
    submit: "Refuser", onSubmit: async (f, api) => { await q(sb.from("pointages").update({ statut: "Refusé", motif_refus: f.motif || null }).eq("id", id)); api.close(); await refresh(); } });
}

/* ---------- Heures supplémentaires et paie ---------- */
function paieCalc(s, ym) {
  const reg = rhReg(), a = `${ym}-01`, b = eomOf(ym);
  const ps = db.ptg.filter((p) => p.salarie_id === s.id && p.statut === "Validé");
  const weeks = {}; ps.forEach((p) => { const m = mondayOf(p.date_travail); (weeks[m] ||= 0); weeks[m] += p.heures; });
  let hn_ = 0, h1 = 0, h2 = 0;
  Object.entries(weeks).filter(([m]) => m >= a && m <= b).forEach(([, H]) => {
    const n = Math.min(H, reg.seuil_hebdo), x1 = Math.min(Math.max(H - reg.seuil_hebdo, 0), reg.hs1_jusqua - reg.seuil_hebdo), x2 = Math.max(H - reg.hs1_jusqua, 0);
    hn_ += n; h1 += x1; h2 += x2;
  });
  const inM = ps.filter((p) => p.date_travail >= a && p.date_travail <= b);
  const abs = {}; db.abs.filter((x) => x.salarie_id === s.id && x.date_fin >= a && x.date_debut <= b).forEach((x) => {
    const d1 = x.date_debut > a ? x.date_debut : a, d2 = x.date_fin < b ? x.date_fin : b; abs[x.type] = (abs[x.type] || 0) + workdays(d1, d2);
  });
  const paniers = inM.filter((p) => p.panier).length, km = sum(inM, (p) => p.trajet_km), min = sum(inM, (p) => p.trajet_minutes);
  const heures = sum(inM, (p) => p.heures), cout = r2(heures * salCout(s));
  return { s, heures, hn: hn_, h1, h2, abs, absTot: Object.values(abs).reduce((x, y) => x + y, 0), paniers, km, min, indPanier: r2(paniers * reg.panier_montant), indTrajet: r2(km * reg.trajet_eur_km), cout };
}
function reglagesRhForm() {
  if (!guard()) return;
  const r = rhReg();
  modal("Heures supplémentaires et indemnités", `<div class="frm"><p class="full cx-help">Valeurs par défaut du code du travail. Vérifiez-les avec votre convention collective (BTP : voir vos accords). Les heures supplémentaires sont calculées par semaine, sur les heures validées.</p>
    ${fld({ k: "seuil_hebdo", l: "Seuil hebdomadaire (h)", t: "number", v: rhNum(r.seuil_hebdo) })}${fld({ k: "hs1_pct", l: "Majoration 1re tranche (%)", t: "number", v: rhNum(r.hs1_pct) })}
    ${fld({ k: "hs1_jusqua", l: "1re tranche jusqu'à (h / semaine)", t: "number", v: rhNum(r.hs1_jusqua) })}${fld({ k: "hs2_pct", l: "Majoration au-delà (%)", t: "number", v: rhNum(r.hs2_pct) })}
    ${fld({ k: "panier_montant", l: "Indemnité de panier (€ par jour)", t: "number", v: rhNum(r.panier_montant), r: 0 })}${fld({ k: "trajet_eur_km", l: "Indemnité de trajet (€ par km)", t: "number", v: rhNum(r.trajet_eur_km), r: 0 })}</div>`, {
    onSubmit: async (f, api) => {
      const n = (k) => parseNum(f[k]); const reg = { seuil_hebdo: n("seuil_hebdo") || 35, hs1_pct: n("hs1_pct"), hs1_jusqua: n("hs1_jusqua") || 43, hs2_pct: n("hs2_pct"), panier_montant: n("panier_montant"), trajet_eur_km: n("trajet_eur_km") };
      if (reg.hs1_jusqua <= reg.seuil_hebdo) throw new Error("La 1re tranche doit aller au-delà du seuil.");
      await entPatch({ rh_reglages: reg }); api.close(); toast("Réglages enregistrés.", "ok"); await refresh();
    } });
}
function absenceForm(x) {
  if (!guard()) return;
  if (!db.sal.length) return toast("Ajoutez d'abord un salarié.", "dn");
  const v = { type: "Congés payés", date_debut: today(), date_fin: today(), ...(x || {}) };
  modal(x ? "Modifier l'absence" : "Nouvelle absence", `<div class="frm">
    ${fld({ k: "salarie_id", l: "Salarié", t: "select", o: db.sal.map((s) => ({ v: s.id, l: s.nom })), v: v.salarie_id || db.sal[0].id })}
    ${fld({ k: "type", l: "Type", t: "select", o: ["Congés payés", "RTT", "Maladie", "Accident du travail", "Sans solde", "Formation", "Intempéries", "Autre"], v: v.type })}
    ${fld({ k: "date_debut", l: "Du", t: "date", v: v.date_debut })}${fld({ k: "date_fin", l: "Au (inclus)", t: "date", v: v.date_fin })}
    ${fld({ k: "notes", l: "Note", v: v.notes || "", r: 0, cls: "full" })}</div>`, {
    onSubmit: async (f, api) => {
      if (f.date_fin < f.date_debut) throw new Error("La date de fin est avant la date de début.");
      const row = { salarie_id: f.salarie_id, type: f.type, date_debut: f.date_debut, date_fin: f.date_fin, jours: workdays(f.date_debut, f.date_fin), notes: f.notes || null };
      if (x) await q(sb.from("absences").update(row).eq("id", x.id)); else await q(sb.from("absences").insert(row));
      api.close(); toast("Absence enregistrée.", "ok"); await refresh();
    }, extra: x ? btn("Supprimer", "abDel", x.id, "", "lk dn") : "" });
}
const PY_TABS = [["valider", "À valider"], ["paie", "Heures et paie"], ["absences", "Absences"], ["historique", "Historique"]];
V.pointages = () => {
  if (!db.v15) return page("Pointages et paie", "Heures des salariés, heures supplémentaires, absences, export pour la paie.", "", card("", setupV15()));
  const tab = ST.tab.pointages || "valider", ym = ST.paieM || today().slice(0, 7), reg = rhReg();
  const apv = db.ptg.filter((p) => p.statut === "À valider").sort((a, b) => a.date_travail.localeCompare(b.date_travail));
  let body = "";
  if (tab === "valider") {
    const rows = apv.map((p) => ({ act: "ptEdit", id: p.id, t: salNm(p.salarie_id), c: [D(p.date_travail), `<strong>${esc(salNm(p.salarie_id))}</strong>`, esc(chNm(p.chantier_id) || "Hors chantier") + (p.description ? `<small>${esc(p.description)}</small>` : ""),
      `<span class="num">${hn(p.heures)}</span>${p.panier ? "<small>panier</small>" : ""}${p.trajet_km || p.trajet_minutes ? `<small>trajet ${p.trajet_km ? rhNum(p.trajet_km) + " km" : ""} ${p.trajet_minutes ? p.trajet_minutes + " min" : ""}</small>` : ""}`,
      `<button class="lk w" data-act="ptOk" data-id="${p.id}">Valider</button> · <button class="lk dn w" data-act="ptNo" data-id="${p.id}">Refuser</button>`] }));
    body = card(`Pointages à contrôler (${apv.length})`, tbl(["Date", "Salarié", "Chantier / travail", { h: "Heures", r: 1 }, ""], rows, "Aucun pointage en attente."), apv.length ? btn("Tout valider", "ptAll", "", "", "o sm") : "") +
      `<p class="note">À la validation, les heures sont ajoutées à « Temps passés » avec le coût horaire chargé du salarié : elles alimentent la rentabilité des chantiers. Cliquez une ligne pour la corriger avant de valider.</p>`;
  } else if (tab === "paie") {
    const L = db.sal.filter((s) => s.actif || db.ptg.some((p) => p.salarie_id === s.id && p.date_travail.slice(0, 7) === ym)).map((s) => paieCalc(s, ym));
    const T = (k) => sum(L, (x) => x[k]);
    const rows = L.map((x) => ({ t: x.s.nom, c: [`<strong>${esc(x.s.nom)}</strong>`, `<span class="num">${hn(x.heures)}</span>`, `<span class="num">${hn(x.hn)}</span>`, `<span class="num ${x.h1 ? "wn" : ""}">${hn(x.h1)}</span>`, `<span class="num ${x.h2 ? "wn" : ""}">${hn(x.h2)}</span>`,
      x.absTot ? `${x.absTot} j<small>${Object.entries(x.abs).map(([k, v]) => `${k} ${v}`).join(", ")}</small>` : "-", x.paniers || "-", x.km || x.min ? `${rhNum(x.km)} km<small>${x.min} min</small>` : "-", `<span class="num">${E(x.cout)}</span>`] }));
    body = `<div style="display:flex;gap:10px;align-items:center;margin-bottom:12px"><button class="btn o sm" data-act="pyMonth" data-arg="-1">‹</button><b>${ymLabel(ym)}</b><button class="btn o sm" data-act="pyMonth" data-arg="1">›</button>${btn("Exporter pour la paie (CSV)", "pyCsv", "", "", "w")}${btn("Réglages HS et indemnités", "pyReg", "", "", "o w")}</div>` +
      strip([["Heures validées", hn(T("heures")), `${L.length} salarié(s)`], ["Heures supplémentaires", hn(T("h1") + T("h2")), `${hn(T("h1"))} à ${reg.hs1_pct} % · ${hn(T("h2"))} à ${reg.hs2_pct} %`], ["Absences", `${T("absTot")} j`, "jours ouvrés"], ["Paniers", String(T("paniers")), reg.panier_montant ? E(T("indPanier")) : "montant non réglé"]]) +
      card(`Synthèse ${ymLabel(ym)}`, tbl(["Salarié", { h: "Heures", r: 1 }, { h: "Normales", r: 1 }, { h: `HS ${reg.hs1_pct} %`, r: 1 }, { h: `HS ${reg.hs2_pct} %`, r: 1 }, "Absences", "Paniers", "Trajets", { h: "Coût chargé", r: 1 }], rows, "Aucun salarié.")) +
      `<p class="note">Heures supplémentaires calculées par semaine civile (lundi à dimanche), rattachées au mois du lundi, sur les heures validées. Seuil ${reg.seuil_hebdo} h ; majorations ${reg.hs1_pct} % jusqu'à ${reg.hs1_jusqua} h, ${reg.hs2_pct} % au-delà. Le coût chargé est calculé au taux normal. Ce tableau prépare la paie : il ne remplace pas votre logiciel de paie ni les règles de votre convention.</p>`;
  } else if (tab === "absences") {
    const rows = [...db.abs].sort((a, b) => b.date_debut.localeCompare(a.date_debut)).map((x) => ({ act: "abEdit", id: x.id, t: `${salNm(x.salarie_id)} ${x.type}`, c: [`<strong>${esc(salNm(x.salarie_id))}</strong>`, esc(x.type), `${D(x.date_debut)} au ${D(x.date_fin)}`, `${x.jours ?? workdays(x.date_debut, x.date_fin)} j`, esc(x.notes || "")] }));
    body = card("Absences", tbl(["Salarié", "Type", "Période", { h: "Jours ouvrés", r: 1 }, "Note"], rows, "Aucune absence saisie."), btn("Nouvelle absence", "abNew", "", "", "o sm"));
  } else {
    const rows = db.ptg.filter((p) => p.statut !== "À valider").sort((a, b) => b.date_travail.localeCompare(a.date_travail)).slice(0, 200).map((p) => ({ act: "ptEdit", id: p.id, t: salNm(p.salarie_id), c: [D(p.date_travail), esc(salNm(p.salarie_id)), esc(chNm(p.chantier_id) || "Hors chantier"), `<span class="num">${hn(p.heures)}</span>`, chip(p.statut) + (p.motif_refus ? `<small>${esc(p.motif_refus)}</small>` : "")] }));
    body = card("Pointages traités (200 derniers)", tbl(["Date", "Salarié", "Chantier", { h: "Heures", r: 1 }, "Statut"], rows, "Rien pour le moment."), btn("Saisir des heures", "ptNew", "", "", "o sm"));
  }
  return page("Pointages et paie", "Heures des salariés, heures supplémentaires, absences, export pour la paie.", btn("Saisir des heures", "ptNew", "", "", "w"), tabs("pointages", PY_TABS.map(([k, l]) => [k, k === "valider" && apv.length ? `${l} (${apv.length})` : l]), tab) + body);
};

/* ---------- Affectations et conflits ---------- */
const FAR = "9999-12-31";
function afItems() {
  const it = [], reg = (o) => it.push(o);
  db.aff.forEach((a) => {
    const base = { from: a.date_debut, to: a.date_fin, h1: a.heure_debut?.slice(0, 5) || "", h2: a.heure_fin?.slice(0, 5) || "", chantier_id: a.chantier_id, src: "aff:" + a.id, kind: "aff", ref: a.id };
    if (a.ressource === "salarie") reg({ ...base, key: "s:" + a.salarie_id, who: salNm(a.salarie_id) });
    else if (a.ressource === "equipe") {
      reg({ ...base, key: "e:" + a.equipe_id, who: "Équipe " + eqNm(a.equipe_id) });
      db.sal.filter((s) => s.equipe_id === a.equipe_id && s.actif).forEach((s) => reg({ ...base, key: "s:" + s.id, who: s.nom, via: "équipe " + eqNm(a.equipe_id) }));
    } else reg({ ...base, key: "m:" + a.materiel_id, who: byId(db.mat, a.materiel_id)?.nom || "Matériel" });
  });
  db.abs.forEach((x) => reg({ key: "s:" + x.salarie_id, who: salNm(x.salarie_id), from: x.date_debut, to: x.date_fin, h1: "", h2: "", kind: "abs", label: x.type, src: "abs:" + x.id }));
  (db.matA || []).forEach((a) => reg({ key: "m:" + a.materiel_id, who: byId(db.mat, a.materiel_id)?.nom || "Matériel", from: a.date_debut, to: a.date_fin || FAR, h1: "", h2: "", chantier_id: a.chantier_id, kind: "aff", src: "mat:" + a.id }));
  db.per.filter((p) => p.materiel_id).forEach((p) => reg({ key: "m:" + p.materiel_id, who: byId(db.mat, p.materiel_id)?.nom || "Matériel", from: p.date_debut, to: p.date_fin, h1: "", h2: "", kind: p.type === "Location" ? "loc" : "indispo", label: p.type === "Location" ? "Loué" : "Indisponible", src: "per:" + p.id, chantier_id: p.chantier_id }));
  db.mat.filter((m) => m.statut === "Hors service" || m.statut === "Vendu").forEach((m) => reg({ key: "m:" + m.id, who: m.nom, from: "0000-01-01", to: FAR, h1: "", h2: "", kind: "indispo", label: m.statut, src: "ms:" + m.id }));
  return it;
}
const afOver = (a, b) => a.from <= b.to && b.from <= a.to && (!(a.h1 && a.h2 && b.h1 && b.h2) || (a.h1 < b.h2 && b.h1 < a.h2));
function afConflits() {
  const it = afItems(), by = {}; it.forEach((x) => (by[x.key] ||= []).push(x));
  const out = [], seen = new Set();
  const passive = (k) => k === "abs" || k === "indispo";
  for (const [key, L] of Object.entries(by)) for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
    const a = L[i], b = L[j];
    if (a.src === b.src || (passive(a.kind) && passive(b.kind)) || !afOver(a, b)) continue;
    if (a.kind === "loc" && b.kind === "loc") continue;
    const id = [a.src, b.src].sort().join("|") + key; if (seen.has(id)) continue; seen.add(id);
    out.push({ key, who: a.who, a, b, from: a.from > b.from ? a.from : b.from, to: a.to < b.to ? a.to : b.to, mat: key[0] === "m" });
  }
  return out.sort((x, y) => x.from.localeCompare(y.from));
}
const afLabel = (x) => (x.kind === "abs" ? `Absent (${x.label})` : x.kind === "indispo" || x.kind === "loc" ? x.label : (chNm(x.chantier_id) || "Sans chantier") + (x.via ? ` (${x.via})` : "")) + (x.h1 && x.h2 ? ` ${x.h1}-${x.h2}` : "");
const afPer = (c) => (c.from === c.to ? D(c.from) : `${D(c.from)} au ${c.to === FAR ? "…" : D(c.to)}`);
function affectationForm(x, pre = {}) {
  if (!guard()) return;
  const v = { ressource: "salarie", date_debut: today(), date_fin: today(), ...pre, ...(x || {}) };
  const opts = { salarie: db.sal.filter((s) => s.actif).map((s) => ({ v: s.id, l: s.nom })), equipe: db.eqp.map((e) => ({ v: e.id, l: e.nom })), materiel: db.mat.filter((m) => !["Vendu"].includes(m.statut)).map((m) => ({ v: m.id, l: m.nom })) };
  const cur = v.ressource === "salarie" ? v.salarie_id : v.ressource === "equipe" ? v.equipe_id : v.materiel_id;
  modal(x ? "Modifier l'affectation" : "Nouvelle affectation", `<div class="frm">
    ${fld({ k: "ressource", l: "Qui ou quoi", t: "select", o: [{ v: "salarie", l: "Un salarié" }, { v: "equipe", l: "Une équipe" }, { v: "materiel", l: "Un équipement" }], v: v.ressource })}
    <label class="fl"><span>Choix <em>*</em></span><select name="cible" id="f_cible">${(opts[v.ressource] || []).map((o) => `<option value="${o.v}"${o.v === cur ? " selected" : ""}>${esc(o.l)}</option>`).join("")}</select></label>
    ${fld({ k: "chantier_id", l: "Chantier", t: "select", o: chOpts("Sans chantier"), v: v.chantier_id || "", r: 0, cls: "full" })}
    ${fld({ k: "date_debut", l: "Du", t: "date", v: v.date_debut })}${fld({ k: "date_fin", l: "Au (inclus)", t: "date", v: v.date_fin })}
    ${fld({ k: "heure_debut", l: "De (facultatif)", t: "time", v: v.heure_debut?.slice(0, 5) || "", r: 0 })}${fld({ k: "heure_fin", l: "À (facultatif)", t: "time", v: v.heure_fin?.slice(0, 5) || "", r: 0 })}
    ${fld({ k: "notes", l: "Note", v: v.notes || "", r: 0, cls: "full" })}<div class="full" id="afwarn"></div></div>`, {
    onMount: (m) => {
      const sel = $("#f_ressource", m), cb = $("#f_cible", m);
      sel.addEventListener("change", () => { cb.innerHTML = (opts[sel.value] || []).map((o) => `<option value="${o.v}">${esc(o.l)}</option>`).join(""); chk(); });
      const chk = () => {
        const g = (k) => $("#f_" + k, m)?.value || "", r = g("ressource"), c = g("cible"), a = g("date_debut"), b = g("date_fin"); if (!c || !a || !b || b < a) return ($("#afwarn", m).innerHTML = "");
        const tmp = { src: "new", from: a, to: b, h1: g("heure_debut"), h2: g("heure_fin") }, keys = r === "salarie" ? ["s:" + c] : r === "equipe" ? ["e:" + c, ...db.sal.filter((s) => s.equipe_id === c && s.actif).map((s) => "s:" + s.id)] : ["m:" + c];
        const hit = afItems().filter((i) => keys.includes(i.key) && i.src !== (x ? "aff:" + x.id : "") && afOver(tmp, i) && i.src !== "new");
        $("#afwarn", m).innerHTML = hit.length ? `<div class="alert wn" style="padding:10px 12px;border-radius:8px;background:var(--wnbg,#fff4e0)"><b>Conflit :</b> ${[...new Set(hit.map((i) => `${esc(i.who)} : ${esc(afLabel(i))} (${afPer(i)})`))].join("<br>")}</div>` : "";
      };
      m.addEventListener("change", chk); chk();
    },
    onSubmit: async (f, api) => {
      if (f.date_fin < f.date_debut) throw new Error("La date de fin est avant la date de début.");
      if (f.heure_debut && f.heure_fin && f.heure_fin <= f.heure_debut) throw new Error("L'heure de fin doit suivre l'heure de début.");
      const row = { ressource: f.ressource, salarie_id: f.ressource === "salarie" ? f.cible : null, equipe_id: f.ressource === "equipe" ? f.cible : null, materiel_id: f.ressource === "materiel" ? f.cible : null,
        chantier_id: f.chantier_id || null, date_debut: f.date_debut, date_fin: f.date_fin, heure_debut: f.heure_debut || null, heure_fin: f.heure_fin || null, notes: f.notes || null };
      if (x) await q(sb.from("affectations").update(row).eq("id", x.id)); else await q(sb.from("affectations").insert(row));
      api.close(); await refresh();
      const n = afConflits().filter((c) => c.a.src.startsWith("aff:") || c.b.src.startsWith("aff:")).length;
      toast(n ? "Affectation enregistrée. Attention : des conflits existent (voir la page Affectations)." : "Affectation enregistrée.", n ? "dn" : "ok");
    }, extra: x ? btn("Supprimer", "afDel", x.id, "", "lk dn") : "" });
}
const passiveKind = (k) => k === "abs" || k === "indispo";
V.affectations = () => {
  if (!db.v15) return page("Affectations", "Qui travaille où, et conflits de planning.", "", card("", setupV15()));
  const w = ST.afW || mondayOf(today()), days = [...Array(7)].map((_, i) => addD(w, i)), items = afItems(), cf = afConflits();
  const rows = [
    ...db.sal.filter((s) => s.actif).map((s) => ({ key: "s:" + s.id, name: s.nom, sub: eqNm(s.equipe_id) })),
    ...db.eqp.map((e) => ({ key: "e:" + e.id, name: "Équipe " + e.nom, sub: "" })),
    ...db.mat.filter((m) => m.statut !== "Vendu").map((m) => ({ key: "m:" + m.id, name: m.nom, sub: "matériel" })),
  ];
  const grid = rows.map((r) => `<tr><th class="afn"><b>${esc(r.name)}</b><small>${esc(r.sub)}</small></th>${days.map((d) => {
    const here = items.filter((i) => i.key === r.key && i.from <= d && d <= i.to), real = here.filter((i) => !passiveKind(i.kind) && i.kind !== "loc"), bad = real.length > 1 || (real.length && here.some((i) => passiveKind(i.kind)));
    return `<td class="afc${bad ? " bad" : ""}" data-act="afNewDay" data-id="${r.key}" data-arg="${d}">${here.map((i) => `<span class="afb ${i.kind}">${esc(afLabel(i))}</span>`).join("") || ""}</td>`;
  }).join("")}</tr>`).join("");
  const list = [...db.aff].sort((a, b) => b.date_debut.localeCompare(a.date_debut)).slice(0, 60).map((a) => ({ act: "afEdit", id: a.id, t: "", c: [a.ressource === "salarie" ? "Salarié" : a.ressource === "equipe" ? "Équipe" : "Équipement", `<strong>${esc(a.ressource === "salarie" ? salNm(a.salarie_id) : a.ressource === "equipe" ? eqNm(a.equipe_id) : byId(db.mat, a.materiel_id)?.nom || "?")}</strong>`, esc(chNm(a.chantier_id) || "Sans chantier"), `${D(a.date_debut)} au ${D(a.date_fin)}${a.heure_debut ? ` · ${a.heure_debut.slice(0, 5)}-${(a.heure_fin || "").slice(0, 5)}` : ""}`] }));
  return page("Affectations", "Qui travaille où, avec détection des doubles affectations.", btn("Nouvelle affectation", "afNew", "", "", "w"),
    strip([["Conflits détectés", String(cf.length), cf.length ? "à résoudre" : "aucun", cf.length ? "dn" : "ok"], ["Salariés", String(db.sal.filter((s) => s.actif).length), "actifs"], ["Équipements", String(db.mat.filter((m) => m.statut !== "Vendu").length), "suivis"]]) +
    (cf.length ? card(`Conflits d'affectation (${cf.length})`, cf.slice(0, 40).map((c) => `<div class="row"><div><b>${esc(c.who)}</b><small>${esc(afLabel(c.a))} <b>↔</b> ${esc(afLabel(c.b))}</small></div><span class="chip dn">${afPer(c)}</span></div>`).join(""), "", "") : "") +
    card("Semaine", `<div style="display:flex;gap:10px;align-items:center;padding:0 0 10px"><button class="btn o sm" data-act="afWeek" data-arg="-7">‹</button><b>Du ${D(days[0])} au ${D(days[6])}</b><button class="btn o sm" data-act="afWeek" data-arg="7">›</button><button class="btn o sm" data-act="afWeek" data-arg="0">Aujourd'hui</button></div>
      <div class="tw"><table class="afg"><thead><tr><th></th>${days.map((d, i) => `<th>${["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"][i]} ${d.slice(8)}</th>`).join("")}</tr></thead><tbody>${grid || '<tr><td class="emp" colspan="8">Ajoutez des salariés ou du matériel.</td></tr>'}</tbody></table></div>
      <p class="note">Cliquez une case pour affecter. Les cases rouges signalent une double affectation, une absence ou une indisponibilité qui se chevauchent. Les affectations d'une équipe comptent pour chacun de ses membres.</p>`) +
    card("Affectations récentes", tbl(["Type", "Qui", "Chantier", "Période"], list, "Aucune affectation. Les affectations de matériel saisies dans la fiche Matériel sont aussi contrôlées.")));
};

/* ---------- Rapports d'intervention ---------- */
const rpFourn = (r) => (Array.isArray(r.fournitures) ? r.fournitures : []);
const rpClient = (r) => clientOf(r.client_id)?.nom || r.client_nom || "-";
async function rpPdf(r) {
  if (!window.PDFLib) await loadScript(LIBS.pdflib);
  const { PDFDocument, StandardFonts, rgb } = window.PDFLib, pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 595, H = 842, M = 42, clean = (s) => String(s ?? "").replace(/[^\x20-\x7E -ÿ€]/g, "?").replace(/€/g, "EUR"), G = rgb(0.4, 0.4, 0.4);
  let pg = pdf.addPage([W, H]), y = H - M;
  const need = (h) => { if (y - h < M) { pg = pdf.addPage([W, H]); y = H - M; } };
  const wrap = (t, f, s, mw) => { const out = []; for (const para of clean(t).split("\n")) { let line = ""; for (const w of para.split(/\s+/)) { const x = line ? line + " " + w : w; if (f.widthOfTextAtSize(x, s) > mw && line) { out.push(line); line = w; } else line = x; } out.push(line); } return out; };
  const text = (t, o = {}) => { const s = o.size || 10, f = o.bold ? bold : font; for (const l of wrap(t, f, s, W - 2 * M - (o.indent || 0))) { need(s + 4); pg.drawText(l, { x: M + (o.indent || 0), y: y - s, size: s, font: f, color: o.color || rgb(0.1, 0.1, 0.1) }); y -= s + 4; } };
  text(db.ent.nom || "Entreprise", { size: 14, bold: true }); text(`Rapport d'intervention ${r.numero || ""}`, { size: 18, bold: true }); y -= 6;
  text(`Date : ${D(r.date_intervention)}${r.heure_debut ? `   de ${r.heure_debut} à ${r.heure_fin || ""}` : ""}`); text(`Client : ${rpClient(r)}`); if (r.adresse) text(`Adresse : ${r.adresse}`);
  if (r.chantier_id) text(`Chantier : ${chNm(r.chantier_id)}`); text(`Intervenant : ${salNm(r.salarie_id)}   Durée : ${hn(r.heures)}`); y -= 6;
  for (const [t, v] of [["Objet", r.objet], ["Constat", r.constat], ["Travaux réalisés", r.travaux], ["Reste à faire", r.a_suivre]]) if (v) { text(t, { bold: true, size: 11 }); text(v, { indent: 6 }); y -= 4; }
  const F = rpFourn(r); if (F.length) { text("Fournitures", { bold: true, size: 11 }); F.forEach((f) => text(`- ${f.designation}  ${f.quantite} ${f.unite || ""}`, { indent: 6 })); y -= 4; }
  const photos = await q(sb.from("terrain_photos").select("data,legende").eq("rapport_id", r.id)).catch(() => []);
  for (const p of photos.slice(0, 6)) {
    try {
      const b = Uint8Array.from(atob(p.data.split(",")[1]), (c) => c.charCodeAt(0)), im = p.data.startsWith("data:image/png") ? await pdf.embedPng(b) : await pdf.embedJpg(b), sc = Math.min(240 / im.width, 170 / im.height, 1), dw = im.width * sc, dh = im.height * sc;
      need(dh + 22); pg.drawImage(im, { x: M, y: y - dh, width: dw, height: dh }); y -= dh + 4; if (p.legende) text(p.legende, { size: 8, color: G }); y -= 6;
    } catch (e) { /* photo ignorée */ }
  }
  need(130); y -= 8; text("Signature du client", { bold: true, size: 11 });
  try { const b = Uint8Array.from(atob(r.signature.split(",")[1]), (c) => c.charCodeAt(0)), im = await pdf.embedPng(b), sc = Math.min(200 / im.width, 80 / im.height), dw = im.width * sc, dh = im.height * sc; pg.drawImage(im, { x: M, y: y - dh, width: dw, height: dh }); y -= dh + 4; } catch (e) { /* signature illisible */ }
  text(`${r.signataire_nom || ""} - signé le ${r.signe_at ? new Date(r.signe_at).toLocaleString("fr-FR") : ""} sur l'appareil du technicien`, { size: 9, color: G });
  return await pdf.save();
}
function rpFacture(r) {
  const taux = Number(db.ent.taux_horaire_vente) || 0, tva = Number(db.ent.taux_tva_defaut ?? 20), L = [];
  if (r.heures > 0) L.push({ designation: `Main-d'œuvre : ${r.objet || "intervention"} du ${D(r.date_intervention)}`, quantite: r.heures, unite: "h", prix_unitaire_ht: taux, taux_tva: tva });
  rpFourn(r).forEach((f) => L.push({ designation: f.designation, quantite: Number(f.quantite) || 1, unite: f.unite || "u", prix_unitaire_ht: Number(f.prix_unitaire_ht) || 0, taux_tva: tva }));
  return docForm("facture", null, { client: r.client_id || undefined, chantier: r.chantier_id || undefined, lignes: L, notes: `Intervention ${r.numero || ""} du ${D(r.date_intervention)}.` });
}
async function rpDetail(id) {
  const r = byId(db.rap, id); if (!r) return;
  const photos = await q(sb.from("terrain_photos").select("id,data,legende").eq("rapport_id", id)).catch(() => []);
  const F = rpFourn(r);
  modal(`Rapport ${esc(r.numero || "")}`, `<dl class="kv"><dt>Date</dt><dd>${D(r.date_intervention)} ${esc(r.heure_debut || "")}${r.heure_fin ? " - " + esc(r.heure_fin) : ""}</dd><dt>Client</dt><dd>${esc(rpClient(r))}${r.adresse ? `<small>${esc(r.adresse)}</small>` : ""}</dd><dt>Chantier</dt><dd>${esc(chNm(r.chantier_id) || "-")}</dd>
    <dt>Intervenant</dt><dd>${esc(salNm(r.salarie_id))} · ${hn(r.heures)}</dd><dt>Objet</dt><dd>${esc(r.objet || "-")}</dd><dt>Constat</dt><dd>${esc(r.constat || "-")}</dd><dt>Travaux</dt><dd>${esc(r.travaux || "-")}</dd>
    ${r.a_suivre ? `<dt>Reste à faire</dt><dd>${esc(r.a_suivre)}</dd>` : ""}${F.length ? `<dt>Fournitures</dt><dd>${F.map((f) => `${esc(f.designation)} · ${f.quantite} ${esc(f.unite || "")}${f.prix_unitaire_ht ? " · " + E(f.prix_unitaire_ht) : ""}`).join("<br>")}</dd>` : ""}
    <dt>Statut</dt><dd>${chip(r.statut)}</dd><dt>Signature</dt><dd>${esc(r.signataire_nom || "")}<br><img src="${esc(r.signature || "")}" alt="Signature" style="max-width:220px;max-height:90px;background:#fff;border:1px solid var(--line);border-radius:6px"></dd></dl>
    ${photos.length ? `<div class="phg">${photos.map((p) => `<figure><img src="${p.data}" alt="${esc(p.legende || "Photo")}"><figcaption>${esc(p.legende || "")}</figcaption></figure>`).join("")}</div>` : ""}`, {
    wide: true, submit: false,
    onMount: (m) => { const fa = document.createElement("div"); fa.className = "fa"; fa.innerHTML = `${btn("Télécharger le PDF", "rpPdf", id, "", "o")}${btn("Préparer la facture", "rpFact", id, "", "")}${r.statut !== "Facturé" ? btn("Marquer facturé", "rpDone", id, "", "o") : ""}`; $(".mb", m).after(fa); },
  });
}
const RP_TABS = [["rapports", "Rapports"], ["photos", "Photos"]];
V.rapports = () => {
  if (!db.v15) return page("Rapports et photos", "Rapports d'intervention signés sur mobile et photos de chantier.", "", card("", setupV15()));
  const tab = ST.tab.rapports || "rapports";
  let body;
  if (tab === "rapports") {
    const rows = [...db.rap].sort((a, b) => b.date_intervention.localeCompare(a.date_intervention) || (b.created_at || "").localeCompare(a.created_at || "")).map((r) => ({ act: "rpOpen", id: r.id, t: `${r.numero} ${rpClient(r)} ${r.objet}`, c: [`<strong>${esc(r.numero || "")}</strong>`, D(r.date_intervention), esc(rpClient(r)) + `<small>${esc(r.objet || "")}</small>`, esc(salNm(r.salarie_id)), `<span class="num">${hn(r.heures)}</span>`, chip(r.statut)] }));
    body = card("Rapports d'intervention", tbl(["N°", "Date", "Client", "Intervenant", { h: "Durée", r: 1 }, "Statut"], rows, "Aucun rapport. Vos salariés les créent depuis leur lien mobile."));
  } else {
    const f = ST.phC || "", L = db.ph.filter((p) => !f || p.chantier_id === f).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 60);
    body = `<div style="margin-bottom:12px"><select data-chg="phCh" aria-label="Chantier">${chOpts("Tous les chantiers").map((o) => `<option value="${o.v}"${o.v === f ? " selected" : ""}>${esc(o.l)}</option>`).join("")}</select></div>` +
      card(`Photos (${db.ph.filter((p) => !f || p.chantier_id === f).length})`, L.length ? `<div class="phg" id="phg">${L.map((p) => `<figure data-act="phOpen" data-id="${p.id}"><img data-ph="${p.id}" alt="" loading="lazy"><figcaption>${esc(chNm(p.chantier_id) || "Sans chantier")} · ${D(p.created_at)}<br>${esc(p.legende || "")}</figcaption></figure>`).join("")}</div>` : `<p class="mut" style="padding:14px 18px;margin:0">Aucune photo.</p>`);
  }
  return { html: page("Rapports et photos", "Rapports d'intervention signés sur mobile et photos de chantier.", "", tabs("rapports", RP_TABS, tab) + body), after: () => phLoad() };
};
async function phLoad() {
  for (const im of document.querySelectorAll("img[data-ph]")) {
    if (im.src) continue;
    try { const r = await q(sb.from("terrain_photos").select("data").eq("id", im.dataset.ph).single()); im.src = r.data; } catch (e) { /* ignorée */ }
  }
}

/* ---------- Actions ---------- */
const equipesActions = {
  eqSalNew: () => salarieForm(null), eqSalEdit: (id) => salarieForm(byId(db.sal, id)), eqEqNew: () => equipeForm(null), eqEqEdit: (id) => equipeForm(byId(db.eqp, id)),
  eqSalDel: async (id) => { if (!guard() || !confirm("Supprimer ce salarié ? Ses pointages et absences seront supprimés. Les heures déjà validées restent dans Temps passés.")) return; await q(sb.from("salaries").delete().eq("id", id)); document.querySelectorAll(".md").forEach((m) => m.remove()); await refresh(); },
  eqEqDel: async (id) => { if (!guard() || !confirm("Supprimer cette équipe ?")) return; await q(sb.from("equipes").delete().eq("id", id)); document.querySelectorAll(".md").forEach((m) => m.remove()); await refresh(); },
  eqCopy: async (id) => { try { await navigator.clipboard.writeText(terrainLink(byId(db.sal, id))); toast("Lien copié.", "ok"); } catch (e) { prompt("Copiez ce lien :", terrainLink(byId(db.sal, id))); } },
  eqSms: (id) => { const s = byId(db.sal, id); location.href = `sms:${(s.telephone || "").replace(/\s/g, "")}?&body=${encodeURIComponent(`Bonjour ${s.nom}, voici ton lien pour pointer tes heures : ${terrainLink(s)}`)}`; },
  eqNewLink: async (id) => { if (!guard() || !confirm("Régénérer le lien ? L'ancien ne fonctionnera plus.")) return; await q(sb.from("salaries").update({ token: crypto.randomUUID() }).eq("id", id)); toast("Nouveau lien créé.", "ok"); await refresh(); },
  ptNew: () => pointageForm(null), ptEdit: (id) => pointageForm(byId(db.ptg, id)),
  ptOk: async (id) => { if (!guard()) return; await ptgValider([id]); toast("Pointage validé.", "ok"); await refresh(); },
  ptNo: (id) => refusForm(id),
  ptAll: async () => { if (!guard() || !confirm("Valider tous les pointages en attente ?")) return; await ptgValider(db.ptg.filter((p) => p.statut === "À valider").map((p) => p.id)); toast("Pointages validés.", "ok"); await refresh(); },
  ptDel: async (id) => { if (!guard() || !confirm("Supprimer ce pointage (et les heures liées dans Temps passés) ?")) return; const p = byId(db.ptg, id); if (p?.temps_id) await q(sb.from("temps_passes").delete().eq("id", p.temps_id)); await q(sb.from("pointages").delete().eq("id", id)); document.querySelectorAll(".md").forEach((m) => m.remove()); await refresh(); },
  pyMonth: (id, arg) => { ST.paieM = shiftYm(ST.paieM || today().slice(0, 7), +arg); render(true); }, pyReg: () => reglagesRhForm(),
  pyCsv: () => {
    const ym = ST.paieM || today().slice(0, 7), reg = rhReg(), L = db.sal.map((s) => paieCalc(s, ym)).filter((x) => x.heures || x.absTot);
    csvDl(`paie-${ym}.csv`, ["Salarié", "Mois", "Heures totales", "Heures normales", `HS ${reg.hs1_pct} %`, `HS ${reg.hs2_pct} %`, "Jours absence", "Détail absences", "Paniers", "Indemnité paniers", "Km trajet", "Minutes trajet", "Indemnité trajet", "Coût chargé"],
      L.map((x) => [x.s.nom, ym, x.heures, x.hn, x.h1, x.h2, x.absTot, Object.entries(x.abs).map(([k, v]) => `${k} ${v}`).join(" ; "), x.paniers, x.indPanier, x.km, x.min, x.indTrajet, x.cout]));
  },
  abNew: () => absenceForm(null), abEdit: (id) => absenceForm(byId(db.abs, id)),
  abDel: async (id) => { if (!guard() || !confirm("Supprimer cette absence ?")) return; await q(sb.from("absences").delete().eq("id", id)); document.querySelectorAll(".md").forEach((m) => m.remove()); await refresh(); },
  afNew: () => affectationForm(null), afEdit: (id) => affectationForm(byId(db.aff, id)),
  afNewDay: (id, arg) => { const [k, rid] = id.split(":"); affectationForm(null, { ressource: k === "s" ? "salarie" : k === "e" ? "equipe" : "materiel", [k === "s" ? "salarie_id" : k === "e" ? "equipe_id" : "materiel_id"]: rid, date_debut: arg, date_fin: arg }); },
  afDel: async (id) => { if (!guard() || !confirm("Supprimer cette affectation ?")) return; await q(sb.from("affectations").delete().eq("id", id)); document.querySelectorAll(".md").forEach((m) => m.remove()); await refresh(); },
  afWeek: (id, arg) => { ST.afW = +arg ? addD(ST.afW || mondayOf(today()), +arg) : mondayOf(today()); render(true); },
  rpOpen: (id) => rpDetail(id), rpFact: (id) => { document.querySelectorAll(".md").forEach((m) => m.remove()); rpFacture(byId(db.rap, id)); },
  rpPdf: async (id) => { const r = byId(db.rap, id); try { downloadBlob(`rapport-${r.numero || id}.pdf`, new Blob([await rpPdf(r)], { type: "application/pdf" })); } catch (e) { toast("PDF impossible : " + friendly(e), "dn"); } },
  rpDone: async (id) => { if (!guard()) return; await q(sb.from("rapports").update({ statut: "Facturé" }).eq("id", id)); document.querySelectorAll(".md").forEach((m) => m.remove()); await refresh(); },
  phCh: (id) => { ST.phC = id || ""; render(true); },
  phOpen: async (id) => { try { const r = await q(sb.from("terrain_photos").select("data,legende").eq("id", id).single()); modal(esc(r.legende || "Photo"), `<img src="${r.data}" alt="" style="max-width:100%;border-radius:8px"><p style="margin:12px 0 0">${btn("Supprimer la photo", "phDel", id, "", "lk dn")}</p>`, { submit: false, wide: true }); } catch (e) { toast(friendly(e), "dn"); } },
  phDel: async (id) => { if (!guard() || !confirm("Supprimer cette photo ?")) return; await q(sb.from("terrain_photos").delete().eq("id", id)); document.querySelectorAll(".md").forEach((m) => m.remove()); await refresh(); },
};
