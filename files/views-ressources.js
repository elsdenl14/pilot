/* Ressources : sous-traitants (fiches, documents de conformité, missions) et matériel (fiches, affectations, entretiens). */

const STDOCS = [["assurance_decennale_fin", "Assurance décennale"], ["assurance_rc_fin", "Assurance RC pro"], ["vigilance_urssaf_fin", "Attestation de vigilance URSSAF"]];
const rsNorm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
function docState(d) {
  if (!d) return { k: "mu", l: "Non renseigné", n: null };
  const n = daysBetween(today(), d);
  return n < 0 ? { k: "dn", l: `Expiré depuis ${-n} j`, n } : n <= 30 ? { k: "wn", l: `Expire dans ${n} j`, n } : { k: "ok", l: `Valide jusqu'au ${D(d)}`, n };
}
const stDocsBad = (s) => STDOCS.filter(([k]) => { const x = docState(s[k]); return x.n !== null && x.n <= 30 ? true : x.n === null && false; });
const stDeps = (s) => db.depenses.filter((d) => rsNorm(d.fournisseur) === rsNorm(s.nom));
const stMis = (id) => db.stm.filter((m) => m.sous_traitant_id === id);
const stStars = (n) => (n ? "★".repeat(n) + "☆".repeat(5 - n) : "-");

/* ---------- Sous-traitants ---------- */
function stForm(s) {
  if (!guard()) return;
  modal(s ? "Modifier le sous-traitant" : "Nouveau sous-traitant", `<div class="frm">${fld({ k: "nom", l: "Nom / raison sociale", v: s?.nom, cls: "full" })}
    ${fld({ k: "metier", l: "Métier", v: s?.metier || "", r: 0 })}${fld({ k: "siret", l: "SIRET", v: s?.siret || "", r: 0 })}
    ${fld({ k: "contact", l: "Contact", v: s?.contact || "", r: 0 })}${fld({ k: "telephone", l: "Téléphone", v: s?.telephone || "", r: 0 })}
    ${fld({ k: "email", l: "Email", t: "email", v: s?.email || "", r: 0 })}${fld({ k: "taux_horaire", l: "Taux horaire (€ HT)", t: "number", v: s?.taux_horaire ? String(s.taux_horaire).replace(".", ",") : "", r: 0 })}
    ${fld({ k: "adresse", l: "Adresse", v: s?.adresse || "", r: 0 })}${fld({ k: "ville", l: "Ville", v: s?.ville || "", r: 0 })}
    <div class="sect-t">Documents obligatoires : dates de fin de validité</div>
    ${STDOCS.map(([k, l]) => fld({ k, l, t: "date", v: s?.[k] || "", r: 0 })).join("")}
    ${fld({ k: "qualite", l: "Qualité du travail (1 à 5)", t: "select", o: [{ v: "", l: "Non noté" }, 1, 2, 3, 4, 5], v: s?.qualite || "", r: 0 })}
    ${fld({ k: "notes", l: "Notes", t: "textarea", v: s?.notes || "", r: 0, cls: "full" })}
    <label class="chk full" style="display:flex;gap:8px"><input type="checkbox" name="actif" ${s && s.actif === false ? "" : "checked"}> <span>Sous-traitant actif</span></label></div>`, {
    wide: true,
    onSubmit: async (v, api) => {
      const row = { nom: v.nom.trim(), metier: v.metier || null, siret: v.siret?.replace(/\s/g, "") || null, contact: v.contact || null, telephone: v.telephone || null, email: v.email || null, adresse: v.adresse || null, ville: v.ville || null,
        taux_horaire: v.taux_horaire ? parseNum(v.taux_horaire) : null, qualite: v.qualite ? Number(v.qualite) : null, notes: v.notes || null, actif: "actif" in v };
      STDOCS.forEach(([k]) => (row[k] = v[k] || null));
      if (s) await q(sb.from("sous_traitants").update(row).eq("id", s.id)); else await q(sb.from("sous_traitants").insert(row));
      api.close(); toast("Sous-traitant enregistré.", "ok"); await refresh();
    } });
}
function missionForm(m, pre = {}) {
  if (!guard()) return;
  const v0 = { ...pre, ...(m || {}) }, st = byId(db.sts, v0.sous_traitant_id);
  const bad = st ? STDOCS.filter(([k]) => { const x = docState(st[k]); return x.n === null || x.n < 0; }) : [];
  modal(m ? "Modifier la mission" : "Nouvelle mission", `${bad.length ? `<p class="note" style="margin:0 0 10px"><b>Attention :</b> ${esc(st.nom)} n'a pas de ${bad.map(([, l]) => l.toLowerCase()).join(", ")} à jour. Vous restez responsable en cas de contrôle.</p>` : ""}<div class="frm">
    ${fld({ k: "sous_traitant_id", l: "Sous-traitant", t: "select", o: db.sts.map((s) => ({ v: s.id, l: s.nom })), v: v0.sous_traitant_id || "", cls: "full" })}
    ${fld({ k: "objet", l: "Objet de la mission", v: v0.objet, cls: "full" })}${fld({ k: "chantier_id", l: "Chantier", t: "select", o: chOpts(), v: v0.chantier_id || "", r: 0 })}
    ${fld({ k: "montant_ht", l: "Montant convenu (€ HT)", t: "number", v: v0.montant_ht ? String(v0.montant_ht).replace(".", ",") : "" })}
    ${fld({ k: "date_debut", l: "Début", t: "date", v: v0.date_debut || "", r: 0 })}${fld({ k: "date_fin", l: "Fin", t: "date", v: v0.date_fin || "", r: 0 })}
    ${fld({ k: "statut", l: "Statut", t: "select", o: ["Prévue", "En cours", "Terminée", "Annulée"], v: v0.statut || "Prévue" })}${fld({ k: "retenue_pct", l: "Retenue de garantie (%)", t: "number", v: v0.retenue_pct ? String(v0.retenue_pct).replace(".", ",") : "", r: 0 })}</div>`, {
    onSubmit: async (v, api) => {
      const row = { sous_traitant_id: v.sous_traitant_id, objet: v.objet.trim(), chantier_id: v.chantier_id || null, montant_ht: Math.max(0, parseNum(v.montant_ht)), date_debut: v.date_debut || null, date_fin: v.date_fin || null, statut: v.statut, retenue_pct: Math.min(100, Math.max(0, parseNum(v.retenue_pct) || 0)) };
      if (m) await q(sb.from("st_missions").update(row).eq("id", m.id)); else await q(sb.from("st_missions").insert(row));
      api.close(); toast("Mission enregistrée.", "ok"); await refresh();
    }, extra: m ? btn("Supprimer", "smDel", m.id, "", "lk dn") : "" });
}
function stDetail(id) {
  const s = byId(db.sts, id);
  if (!s) return `<div class="empty"><h2>Sous-traitant introuvable</h2><button class="btn" data-go="soustraitants">Retour</button></div>`;
  const ms = stMis(id), dep = stDeps(s), fact = sum(dep, (d) => d.montant_ht), paye = sum(dep.filter((d) => d.statut === "Payée"), (d) => d.montant_ht), conv = sum(ms.filter((m) => m.statut !== "Annulée"), (m) => m.montant_ht);
  return page(`${esc(s.nom)} ${s.actif === false ? `<span class="chip mu">Inactif</span>` : ""}`, `${esc(s.metier || "Sous-traitant")}${s.ville ? " · " + esc(s.ville) : ""}`,
    btn("Modifier", "stEdit", id, "", "o w") + btn("Nouvelle mission", "smNew", id, "", "w") + btn("Supprimer", "stDel", id, "", "o w"),
    strip([["Missions convenues", E(conv), `${ms.length} mission${ms.length > 1 ? "s" : ""}`], ["Facturé (dépenses)", E(fact), `${dep.length} facture${dep.length > 1 ? "s" : ""} saisie${dep.length > 1 ? "s" : ""}`], ["Payé", E(paye), "dépenses payées"], ["Reste à facturer", E(Math.max(0, conv - fact)), "convenu - facturé", conv - fact < 0 ? "dn" : ""]]) +
    `<div class="g2"><div>${card("Missions", tbl(["Objet", "Chantier", "Période", { h: "Montant HT", r: 1 }, "Statut"], ms.map((m) => ({ act: "smEdit", id: m.id, c: [`<strong>${esc(m.objet)}</strong>`, esc(chNm(m.chantier_id) || "-"), m.date_debut ? `${D(m.date_debut)}${m.date_fin ? " → " + D(m.date_fin) : ""}` : "-", `<span class="num">${E2(m.montant_ht)}</span>`, chip(m.statut)] })), "Aucune mission."))}
    ${card("Factures reçues", tbl(["Date", "Réf.", "Chantier", { h: "HT", r: 1 }, "Statut"], dep.map((d) => ({ act: "depEdit", id: d.id, c: [D(d.date_depense), esc(d.reference || "-"), esc(d.chantier_nom || "-"), `<span class="num">${E2(d.montant_ht)}</span>`, chip(d.statut)] })), "Aucune dépense au nom de « " + esc(s.nom) + " ». Saisissez ses factures avec ce nom de fournisseur pour les suivre ici."))}</div>
    <div>${card("Documents obligatoires", STDOCS.map(([k, l]) => { const x = docState(s[k]); return `<div class="row"><div><b>${l}</b></div><span class="chip ${x.k}">${x.l}</span></div>`; }).join("") + `<p class="note" style="margin:0;padding:12px 18px">Avant de confier un chantier, exigez une attestation de vigilance URSSAF à jour (tous les 6 mois) et une assurance décennale.</p>`)}
    ${card("Coordonnées", `<dl class="kv"><dt>Contact</dt><dd>${esc(s.contact || "-")}</dd><dt>Téléphone</dt><dd>${esc(s.telephone || "-")}</dd><dt>Email</dt><dd>${s.email ? `<a href="mailto:${esc(s.email)}">${esc(s.email)}</a>` : "-"}</dd><dt>Adresse</dt><dd>${esc(s.adresse || "-")}</dd><dt>SIRET</dt><dd>${esc(s.siret || "-")}</dd><dt>Taux horaire</dt><dd>${s.taux_horaire ? E2(s.taux_horaire) + " HT" : "-"}</dd><dt>Qualité</dt><dd>${stStars(s.qualite)}</dd><dt>Notes</dt><dd>${esc(s.notes || "-")}</dd></dl>`)}</div></div>`,
    crumbs(["Sous-traitants", "soustraitants"], [s.nom]));
}
V.soustraitants = (r) => {
  if (!db.v12) return page("Sous-traitants", "Fiches, documents obligatoires et missions.", "", card("", setupV12()));
  if (r.arg) return stDetail(r.arg);
  const rows = db.sts.map((s) => { const bad = STDOCS.map(([k, l]) => [l, docState(s[k])]).filter(([, x]) => x.k === "dn" || x.k === "wn"), conv = sum(stMis(s.id).filter((m) => m.statut !== "Annulée"), (m) => m.montant_ht);
    return { go: `soustraitants/${s.id}`, t: `${s.nom} ${s.metier || ""}`, c: [`<strong>${esc(s.nom)}</strong><small>${esc(s.metier || "")}</small>`, esc(s.telephone || s.email || "-"), bad.length ? bad.map(([l, x]) => `<span class="chip ${x.k}" title="${esc(l)}">${esc(l.replace("Attestation de vigilance URSSAF", "Vigilance").replace("Assurance ", ""))} : ${x.k === "dn" ? "expiré" : x.n + " j"}</span>`).join(" ") : STDOCS.every(([k]) => s[k]) ? `<span class="chip ok">À jour</span>` : `<span class="chip mu">Incomplet</span>`, `<span class="num">${E(conv)}</span>`, stStars(s.qualite)] }; });
  return page("Sous-traitants", "Fiches, documents obligatoires et missions confiées.", btn("Nouveau sous-traitant", "stNew", "", "", "w") + btn("Nouvelle mission", "smNew", "", "", "o w"),
    strip([["Sous-traitants actifs", db.sts.filter((s) => s.actif !== false).length, `${db.sts.length} fiche${db.sts.length > 1 ? "s" : ""}`], ["Documents à renouveler", db.sts.reduce((n, s) => n + STDOCS.filter(([k]) => { const x = docState(s[k]); return x.k === "dn" || x.k === "wn"; }).length, 0), "expirés ou sous 30 jours", db.sts.some((s) => STDOCS.some(([k]) => docState(s[k]).k === "dn")) ? "dn" : ""],
      ["Missions en cours", db.stm.filter((m) => m.statut === "En cours").length, E(sum(db.stm.filter((m) => m.statut === "En cours"), (m) => m.montant_ht)) + " HT"], ["Convenu (hors annulées)", E(sum(db.stm.filter((m) => m.statut !== "Annulée"), (m) => m.montant_ht)), "toutes missions"]]) +
    searchBar("Rechercher un sous-traitant, un métier…", `${rows.length}`) + card("", tbl(["Sous-traitant", "Contact", "Documents", { h: "Missions", r: 1 }, "Qualité"], rows, "Aucun sous-traitant. Ajoutez le premier.")));
};

/* ---------- Matériel ---------- */
const MAT_ST = ["Disponible", "En service", "En maintenance", "Hors service", "Vendu"];
const maOpen = (id) => db.matA.find((a) => a.materiel_id === id && (!a.date_fin || a.date_fin >= today()) && a.date_debut <= today());
const maDays = (a) => Math.max(1, daysBetween(a.date_debut, a.date_fin && a.date_fin < today() ? a.date_fin : today()) + 1);
const matCostByChantier = (cid) => { let t = 0; for (const a of db.matA) if (a.chantier_id === cid && a.date_debut <= today()) { const m = byId(db.mat, a.materiel_id); if (m) t += maDays(a) * m.cout_jour; } return r2(t); };
function materielForm(m) {
  if (!guard()) return;
  modal(m ? "Modifier le matériel" : "Nouveau matériel", `<div class="frm">${fld({ k: "nom", l: "Désignation", v: m?.nom, cls: "full" })}
    ${fld({ k: "categorie", l: "Catégorie (outillage, engin, véhicule…)", v: m?.categorie || "", r: 0 })}${fld({ k: "marque", l: "Marque", v: m?.marque || "", r: 0 })}
    ${fld({ k: "reference", l: "Référence / modèle", v: m?.reference || "", r: 0 })}${fld({ k: "numero_serie", l: "N° de série / immatriculation", v: m?.numero_serie || "", r: 0 })}
    ${fld({ k: "date_achat", l: "Date d'achat", t: "date", v: m?.date_achat || "", r: 0 })}${fld({ k: "prix_achat", l: "Prix d'achat (€ HT)", t: "number", v: m?.prix_achat ? String(m.prix_achat).replace(".", ",") : "", r: 0 })}
    ${fld({ k: "cout_jour", l: "Coût d'utilisation par jour (€)", t: "number", v: m?.cout_jour ? String(m.cout_jour).replace(".", ",") : "", r: 0, hint: "Amortissement + entretien, imputé aux chantiers où il est affecté." })}
    ${fld({ k: "statut", l: "Statut", t: "select", o: MAT_ST, v: m?.statut || "Disponible" })}${fld({ k: "prochaine_verification", l: "Prochaine vérification / contrôle", t: "date", v: m?.prochaine_verification || "", r: 0 })}
    ${fld({ k: "localisation", l: "Rangé à", v: m?.localisation || "", r: 0 })}${fld({ k: "notes", l: "Notes", t: "textarea", v: m?.notes || "", r: 0, cls: "full" })}</div>`, {
    wide: true,
    onSubmit: async (v, api) => {
      const row = { nom: v.nom.trim(), categorie: v.categorie || null, marque: v.marque || null, reference: v.reference || null, numero_serie: v.numero_serie || null, date_achat: v.date_achat || null, prix_achat: Math.max(0, parseNum(v.prix_achat)), cout_jour: Math.max(0, parseNum(v.cout_jour)),
        statut: v.statut, prochaine_verification: v.prochaine_verification || null, localisation: v.localisation || null, notes: v.notes || null };
      if (m) await q(sb.from("materiel").update(row).eq("id", m.id)); else await q(sb.from("materiel").insert(row));
      api.close(); toast("Matériel enregistré.", "ok"); await refresh();
    } });
}
function affForm(mid, a) {
  if (!guard()) return;
  modal("Affecter à un chantier", `<div class="frm">${fld({ k: "chantier_id", l: "Chantier", t: "select", o: db.chantiers.map((c) => ({ v: c.id, l: c.nom })), v: a?.chantier_id || db.chantiers[0]?.id || "", cls: "full" })}
    ${fld({ k: "date_debut", l: "Du", t: "date", v: a?.date_debut || today() })}${fld({ k: "date_fin", l: "Au (vide = en cours)", t: "date", v: a?.date_fin || "", r: 0 })}${fld({ k: "notes", l: "Notes", v: a?.notes || "", r: 0, cls: "full" })}</div>`, {
    onSubmit: async (v, api) => {
      const fin = v.date_fin || "9999-12-31";
      if (fin < v.date_debut) throw new Error("La fin précède le début.");
      const clash = db.matA.find((x) => x.materiel_id === mid && x.id !== a?.id && x.date_debut <= fin && (x.date_fin || "9999-12-31") >= v.date_debut);
      if (clash && !confirm(`Ce matériel est déjà affecté à « ${chNm(clash.chantier_id) || "un autre chantier"} » sur cette période. Affecter quand même ?`)) return;
      const row = { materiel_id: mid, chantier_id: v.chantier_id, date_debut: v.date_debut, date_fin: v.date_fin || null, notes: v.notes || null };
      if (a) await q(sb.from("materiel_affectations").update(row).eq("id", a.id)); else await q(sb.from("materiel_affectations").insert(row));
      api.close(); toast("Affectation enregistrée.", "ok"); await refresh();
    } });
}
function entForm(mid) {
  if (!guard()) return;
  modal("Entretien / vérification", `<div class="frm">${fld({ k: "type", l: "Nature", t: "select", o: ["Entretien", "Réparation", "Contrôle réglementaire", "Révision", "Autre"], v: "Entretien" })}${fld({ k: "date_entretien", l: "Date", t: "date", v: today() })}
    ${fld({ k: "cout", l: "Coût (€ HT)", t: "number", v: "", r: 0 })}${fld({ k: "prochaine", l: "Prochaine échéance", t: "date", v: "", r: 0 })}${fld({ k: "notes", l: "Détails", t: "textarea", v: "", r: 0, cls: "full" })}</div>`, {
    onSubmit: async (v, api) => {
      await q(sb.from("materiel_entretiens").insert({ materiel_id: mid, type: v.type, date_entretien: v.date_entretien, cout: Math.max(0, parseNum(v.cout)), prochaine: v.prochaine || null, notes: v.notes || null }));
      if (v.prochaine) await q(sb.from("materiel").update({ prochaine_verification: v.prochaine }).eq("id", mid));
      api.close(); toast("Entretien enregistré.", "ok"); await refresh();
    } });
}
function matDetail(id) {
  const m = byId(db.mat, id);
  if (!m) return `<div class="empty"><h2>Matériel introuvable</h2><button class="btn" data-go="materiel">Retour</button></div>`;
  const aff = db.matA.filter((a) => a.materiel_id === id), ent = db.matE.filter((e) => e.materiel_id === id), cur = maOpen(id), v = docState(m.prochaine_verification);
  const jours = sum(aff.filter((a) => a.date_debut <= today()), maDays), cost = sum(ent, (e) => e.cout);
  return page(`${esc(m.nom)} ${chip(cur ? "En service" : m.statut)}`, `${esc([m.categorie, m.marque, m.reference].filter(Boolean).join(" · "))}`, btn("Modifier", "matEdit", id, "", "o w") + btn("Affecter à un chantier", "maAff", id, "", "w") + btn("Entretien", "maEnt", id, "", "o w") + btn("Supprimer", "matDel", id, "", "o w"),
    strip([["Prix d'achat", E(m.prix_achat), m.date_achat ? "acheté le " + D(m.date_achat) : ""], ["Jours d'utilisation", jours, `${E2(m.cout_jour)} / jour`], ["Coût imputé aux chantiers", E(jours * m.cout_jour), "jours × coût journalier"], ["Entretiens", E(cost), `${ent.length} intervention${ent.length > 1 ? "s" : ""}`]]) +
    `<div class="g2"><div>${card("Affectations aux chantiers", tbl(["Chantier", "Période", { h: "Jours", r: 1 }, ""], aff.map((a) => ({ c: [`<strong>${esc(chNm(a.chantier_id) || "-")}</strong>`, `${D(a.date_debut)} → ${a.date_fin ? D(a.date_fin) : "en cours"}`, a.date_debut <= today() ? maDays(a) : "-", `<span class="r">${!a.date_fin ? btn("Rentré", "maAffEnd", a.id, "", "sm w") : ""}${btn("Modifier", "maAffEdit", a.id, "", "lk")}${btn("×", "maAffDel", a.id, "", "lk dn")}</span>`] })), "Jamais affecté."))}
    ${card("Historique d'entretien", tbl(["Date", "Nature", { h: "Coût", r: 1 }, ""], ent.map((e) => ({ c: [D(e.date_entretien), `<strong>${esc(e.type)}</strong><small>${esc(e.notes || "")}</small>`, `<span class="num">${E2(e.cout)}</span>`, btn("×", "maEntDel", e.id, "", "lk dn")] })), "Aucun entretien enregistré."))}</div>
    <div>${card("Prochaine vérification", `<div class="row"><div><b>${m.prochaine_verification ? D(m.prochaine_verification) : "Non planifiée"}</b></div><span class="chip ${v.k}">${v.l}</span></div>`)}
    ${card("Fiche", `<dl class="kv"><dt>N° de série</dt><dd>${esc(m.numero_serie || "-")}</dd><dt>Localisation</dt><dd>${cur ? "Sur " + esc(chNm(cur.chantier_id)) : esc(m.localisation || "-")}</dd><dt>Statut</dt><dd>${esc(m.statut)}</dd><dt>Notes</dt><dd>${esc(m.notes || "-")}</dd></dl>`)}</div></div>`, crumbs(["Matériel", "materiel"], [m.nom]));
}
V.materiel = (r) => {
  if (!db.v12) return page("Matériel", "Fiches, affectations et entretiens.", "", card("", setupV12()));
  if (r.arg) return matDetail(r.arg);
  const live = db.mat.filter((m) => m.statut !== "Vendu"), rows = db.mat.map((m) => { const cur = maOpen(m.id), v = docState(m.prochaine_verification);
    return { go: `materiel/${m.id}`, t: `${m.nom} ${m.categorie || ""} ${m.marque || ""}`, c: [`<strong>${esc(m.nom)}</strong><small>${esc([m.categorie, m.marque].filter(Boolean).join(" · "))}</small>`, chip(cur ? "En service" : m.statut), cur ? esc(chNm(cur.chantier_id)) : esc(m.localisation || "-"), m.prochaine_verification ? `<span class="chip ${v.k === "ok" ? "" : v.k}">${D(m.prochaine_verification)}</span>` : "-", `<span class="num">${E(m.prix_achat)}</span>`] }; });
  return page("Matériel", "Fiches, affectations aux chantiers et entretiens.", btn("Nouveau matériel", "matNew", "", "", "w"),
    strip([["Matériel suivi", live.length, `${db.mat.length - live.length} vendu${db.mat.length - live.length > 1 ? "s" : ""}`], ["Sur chantier", live.filter((m) => maOpen(m.id)).length, "affecté aujourd'hui"], ["Vérifications à prévoir", live.filter((m) => { const x = docState(m.prochaine_verification); return x.k === "dn" || x.k === "wn"; }).length, "échues ou sous 30 jours", live.some((m) => docState(m.prochaine_verification).k === "dn") ? "dn" : ""], ["Valeur d'achat", E(sum(live, (m) => m.prix_achat)), "matériel suivi"]]) +
    searchBar("Rechercher du matériel…", `${rows.length}`) + card("", tbl(["Matériel", "Statut", "Où ?", "Prochaine vérif.", { h: "Achat HT", r: 1 }], rows, "Aucun matériel. Ajoutez votre premier outil ou engin.")));
};

function ressPriorites(add, t) {
  if (!db.v12) return;
  for (const s of db.sts) if (s.actif !== false) for (const [k, l] of STDOCS) { const x = docState(s[k]); if (x.n !== null && x.n <= 30 && db.stm.some((m) => m.sous_traitant_id === s.id && ["Prévue", "En cours"].includes(m.statut))) add(x.n < 0 ? "u" : "i", 170 - Math.max(x.n, 0), `${s.nom} : ${l.toLowerCase()} ${x.n < 0 ? "expirée" : "bientôt expirée"}`, x.l + " · mission en cours ou prévue", 0, { label: "Ouvrir", act: "stOpen", id: s.id }, `soustraitants/${s.id}`); }
  for (const m of db.mat) if (!["Vendu", "Hors service"].includes(m.statut) && m.prochaine_verification && m.prochaine_verification <= addD(t, 14)) add(m.prochaine_verification < t ? "i" : "s", 120, `Vérification matériel : ${m.nom}`, m.prochaine_verification < t ? `Échue le ${D(m.prochaine_verification)}` : `À faire avant le ${D(m.prochaine_verification)}`, 0, { label: "Ouvrir", act: "matOpen", id: m.id }, `materiel/${m.id}`);
}

const ressourcesActions = {
  stNew: () => stForm(null), stEdit: (id) => stForm(byId(db.sts, id)), stOpen: (id) => go("soustraitants/" + id),
  stDel: (id) => del("sous_traitants", id, "Supprimer ce sous-traitant et ses missions ?", "soustraitants"),
  smNew: (id) => missionForm(null, id ? { sous_traitant_id: id } : {}), smEdit: (id) => missionForm(byId(db.stm, id)),
  smDel: async (id) => { if (!guard() || !confirm("Supprimer cette mission ?")) return; await q(sb.from("st_missions").delete().eq("id", id)); document.querySelectorAll(".md").forEach((m) => m.remove()); await refresh(); },
  matNew: () => materielForm(null), matEdit: (id) => materielForm(byId(db.mat, id)), matOpen: (id) => go("materiel/" + id),
  matDel: (id) => del("materiel", id, "Supprimer ce matériel, ses affectations et son historique ?", "materiel"),
  maAff: (id) => affForm(id), maAffEdit: (id) => { const a = byId(db.matA, id); affForm(a.materiel_id, a); },
  maAffEnd: async (id) => { if (!guard()) return; await q(sb.from("materiel_affectations").update({ date_fin: today() }).eq("id", id)); toast("Matériel rentré.", "ok"); await refresh(); },
  maAffDel: (id) => del("materiel_affectations", id, "Supprimer cette affectation ?"),
  maEnt: (id) => entForm(id), maEntDel: (id) => del("materiel_entretiens", id, "Supprimer cet entretien ?"),
};
