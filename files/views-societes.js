/* Chargement des données v21 + gestion multi-entreprises (v21).
   Principe : une société = un « dossier » dans le même compte. Chaque ligne (client, chantier, devis, facture…) est rattachée
   à une société par la table societe_liens ; sans rattachement, elle appartient à la société principale. Les listes affichées
   sont filtrées sur la société active ; l'identité de l'entreprise (PDF, mentions) suit la société active.
   La page « Vue consolidée » additionne toutes les sociétés. */

const SOC_ENT = ["clients", "chantiers", "devis", "factures", "depenses", "fournisseurs", "contrats", "interv", "livr", "demPrix"];
const SOC = { liens: new Map(), known: null, all: null, entBase: null };
const socKey = () => { try { return localStorage.getItem("pilot_soc") || ""; } catch (e) { return ""; } };
const socSet = (id) => { try { localStorage.setItem("pilot_soc", id || ""); } catch (e) { /* ignoré */ } };
const socPrincipale = () => (db.societes || []).find((s) => s.principale) || (db.societes || [])[0];
const socActive = () => { const l = db.societes || []; return l.find((s) => s.id === socKey()) || socPrincipale() || null; };
const socEstPrincipale = () => { const a = socActive(); return !a || a.principale || (db.societes || []).length < 2; };
const socDeLigne = (ent, id) => SOC.liens.get(ent + ":" + id) || socPrincipale()?.id;
const socNom = (id) => byId(db.societes || [], id)?.nom || "-";

async function loadV21() {
  const T = (t, o) => q(sb.from(t).select("*").order(o || "created_at"));
  const [soc, liens, cv, ct, cvi, cf, iv, ivp, dp, dpl, dpf, dpo, bl, bll] = await Promise.all([
    T("societes"), q(sb.from("societe_liens").select("*")), T("champs_valeurs", "updated_at"), T("contrats"), T("contrat_visites", "date_prevue"), T("contrat_factures"), T("interventions"),
    q(sb.from("intervention_photos").select("id,intervention_id,phase,legende,created_at")), T("demandes_prix"), T("demande_prix_lignes", "position"), T("demande_prix_fournisseurs", "id"), T("demande_prix_offres"), T("livraisons"), T("livraison_lignes", "position"),
  ]);
  ct.forEach((c) => nz(c, ["montant_ht", "taux_tva", "visites_par_an", "preavis_jours", "rappel_jours", "duree_renouv_mois"]));
  cf.forEach((c) => nz(c, ["montant_ht"]));
  iv.forEach((i) => nz(i, ["heures", "taux_horaire", "deplacement_ht", "taux_tva"]));
  dpl.forEach((l) => nz(l, ["quantite", "position"])); dpf.forEach((f) => nz(f, ["frais_livraison"])); dpo.forEach((o) => { if (o.prix_unitaire_ht != null) o.prix_unitaire_ht = Number(o.prix_unitaire_ht); });
  bll.forEach((l) => nz(l, ["qte_prevue", "qte_livree", "prix_unitaire_ht", "taux_tva"]));
  let socs = soc;
  if (!socs.length && ownerId === uid && !ro) {
    try { socs = [await q(sb.from("societes").insert({ nom: db.ent.nom || "Ma société", siret: db.ent.siret || null, tva_intracom: db.ent.tva_intracom || null, adresse: db.ent.adresse || null, telephone: db.ent.telephone || null, email: db.ent.email || null, iban: db.ent.iban || null, bic: db.ent.bic || null, principale: true }).select("*").single())]; } catch (e) { console.warn("société principale", e); }
  }
  db.societes = socs; db.champsVal = cv; db.contrats = ct; db.ctVisites = cvi; db.ctFactures = cf; db.interv = iv; db.ivPhotos = ivp;
  db.demPrix = dp; db.dpLignes = dpl; db.dpFourn = dpf; db.dpOffres = dpo; db.livr = bl; db.blLignes = bll;
  SOC.liens = new Map(liens.map((l) => [l.entite + ":" + l.row_id, l.societe_id]));
  db.v21 = true; db.v21err = "";
  await socApply();
  setTimeout(() => { try { ctAutoRenew(); } catch (e) { console.warn(e); } }, 1500);
}

// Filtrage par société + identité de l'entreprise
async function socApply() {
  // instantané complet pour la vue consolidée
  SOC.all = {}; SOC_ENT.forEach((k) => (SOC.all[k] = db[k] || [])); SOC.all.paiements = db.paiements || [];
  const act = socActive(), multi = (db.societes || []).length > 1;
  if (!multi || !act) { SOC.known = null; return; }
  const isP = act.principale;
  // rattachement automatique des lignes créées depuis le dernier chargement
  if (!isP && SOC.known && !ro) {
    const rows = [];
    for (const k of SOC_ENT) for (const r of SOC.all[k]) if (!SOC.known[k]?.has(r.id) && !SOC.liens.has(k + ":" + r.id)) rows.push({ entite: k, row_id: r.id, societe_id: act.id });
    if (rows.length) { try { await q(sb.from("societe_liens").insert(rows)); rows.forEach((r) => SOC.liens.set(r.entite + ":" + r.row_id, r.societe_id)); } catch (e) { console.warn("rattachement société", e); } }
  }
  SOC.known = {}; SOC_ENT.forEach((k) => (SOC.known[k] = new Set(SOC.all[k].map((r) => r.id))));
  const mine = (k, r) => socDeLigne(k, r.id) === act.id;
  SOC_ENT.forEach((k) => (db[k] = SOC.all[k].filter((r) => mine(k, r))));
  const fids = new Set(db.factures.map((f) => f.id));
  db.paiements = SOC.all.paiements.filter((p) => !p.facture_id || fids.has(p.facture_id));
  // visites, photos, lignes… suivent leur document parent
  const ids = (k) => new Set(db[k].map((r) => r.id));
  const c = ids("contrats"), i = ids("interv"), d = ids("demPrix"), l = ids("livr");
  db.ctVisites = db.ctVisites.filter((x) => c.has(x.contrat_id)); db.ctFactures = db.ctFactures.filter((x) => c.has(x.contrat_id));
  db.ivPhotos = db.ivPhotos.filter((x) => i.has(x.intervention_id)); db.dpLignes = db.dpLignes.filter((x) => d.has(x.demande_id)); db.dpFourn = db.dpFourn.filter((x) => d.has(x.demande_id)); db.dpOffres = db.dpOffres.filter((x) => d.has(x.demande_id)); db.blLignes = db.blLignes.filter((x) => l.has(x.livraison_id));
  if (!isP) {
    db.ent = { ...db.ent, nom: act.nom, siret: act.siret || "", tva_intracom: act.tva_intracom || "", adresse: act.adresse || "", telephone: act.telephone || "", email: act.email || "", iban: act.iban || "", bic: act.bic || "" };
  }
}

Object.assign(CHIP, { Actif: "ok", Suspendu: "wn", Résilié: "dn" });

/* ---------- Page : sociétés ---------- */
V.societes = () => {
  if (!db.v21) return page("Sociétés", "", "", v21Setup());
  const l = db.societes || [], act = socActive();
  const rows = l.map((s) => { const nb = SOC.all ? SOC_ENT.reduce((n, k) => n + (SOC.all[k] || []).filter((r) => socDeLigne(k, r.id) === s.id).length, 0) : 0;
    return { act: "socEdit", id: s.id, t: s.nom, c: [`<strong>${esc(s.nom)}</strong><small>${esc([s.forme, s.siret].filter(Boolean).join(" · "))}</small>`, s.principale ? chip("Principale") : "", `${nb} élément${nb > 1 ? "s" : ""}`, act?.id === s.id ? chip("Active") : `<button type="button" class="btn o sm" data-act="socUse" data-id="${s.id}">Travailler sur celle-ci</button>`] }; });
  return page("Sociétés", "Plusieurs entreprises dans un même compte, chacune avec ses clients, ses devis, ses factures et sa comptabilité.", `<a class="btn o" href="#/consolide">Vue consolidée</a>` + btn("Ajouter une société", "socNew"),
    tbl(["Société", "", "Contenu", ""], rows, "Aucune société.") + `<p class="mut pad">La société active change les listes, les PDF et les chiffres affichés. Les éléments créés pendant que vous travaillez sur une société lui sont rattachés automatiquement. La numérotation des devis et factures reste commune à tout le compte.</p>`);
};
Object.assign(CHIP, { Principale: "n", Active: "ok" });

function socForm(s) {
  modal(s ? "Modifier la société" : "Ajouter une société", `<div class="frm">
    ${fld({ k: "nom", l: "Nom de la société", v: s?.nom || "", cls: "full" })}${fld({ k: "forme", l: "Forme juridique", v: s?.forme || "", ph: "SARL, SAS, EI…", r: 0 })}${fld({ k: "siret", l: "SIRET", v: s?.siret || "", r: 0 })}
    ${fld({ k: "tva_intracom", l: "N° de TVA intracommunautaire", v: s?.tva_intracom || "", r: 0 })}${fld({ k: "telephone", l: "Téléphone", v: s?.telephone || "", r: 0 })}${fld({ k: "email", l: "E-mail", v: s?.email || "", r: 0 })}
    ${fld({ k: "adresse", l: "Adresse", v: s?.adresse || "", r: 0, cls: "full" })}${fld({ k: "iban", l: "IBAN", v: s?.iban || "", r: 0 })}${fld({ k: "bic", l: "BIC", v: s?.bic || "", r: 0 })}</div>`, {
    wide: true, submit: s ? "Enregistrer" : "Ajouter", extra: s && !s.principale ? `<button type="button" class="btn o dng" id="socdel">Supprimer</button>` : "",
    onMount: (m, api) => { const d = $("#socdel", m); if (d) d.onclick = async () => { if (!confirm("Supprimer cette société ? Ses éléments ne sont pas effacés : ils repasseront dans la société principale.")) return; try { await q(sb.from("societes").delete().eq("id", s.id)); if (socKey() === s.id) socSet(""); api.close(); await refresh(); go("societes"); } catch (e) { api.error(friendly(e)); } }; },
    onSubmit: async (v, api) => {
      const r = Object.fromEntries(["nom", "forme", "siret", "tva_intracom", "telephone", "email", "adresse", "iban", "bic"].map((k) => [k, (v[k] || "").trim() || null])); r.nom = r.nom || "Société";
      if (s) await q(sb.from("societes").update(r).eq("id", s.id)); else await q(sb.from("societes").insert(r));
      api.close(); await refresh(); toast("Société enregistrée.", "ok");
    },
  });
}

/* ---------- Page : vue consolidée ---------- */
V.consolide = () => {
  if (!db.v21) return page("Vue consolidée", "", "", v21Setup());
  const A = SOC.all || {}, soc = db.societes || [], an = new Date().getFullYear(), yr = (s) => String(s || "").slice(0, 4) === String(an);
  const rows = soc.map((s) => {
    const of = (k) => (A[k] || []).filter((r) => socDeLigne(k, r.id) === s.id);
    const fa = of("factures").filter((f) => f.statut !== "Brouillon" && f.statut !== "Annulée" && yr(f.date_emission)), fids = new Set(of("factures").map((f) => f.id));
    const ca = sum(fa, (f) => f.montant_ht), enc = sum((A.paiements || []).filter((p) => fids.has(p.facture_id) && yr(p.date_paiement)), (p) => p.montant), dep = sum(of("depenses").filter((d) => yr(d.date_depense)), (d) => d.montant_ht);
    const reste = sum(of("factures").filter((f) => (f.statut === "Envoyée" || f.statut === "Partiellement payée") && f.reste > 0.005), (f) => f.reste), retard = of("factures").filter((f) => f.statut_affiche === "En retard").length;
    return { s, ca, enc, dep, marge: ca - dep, reste, retard, ch: of("chantiers").filter((c) => c.statut === "En cours").length, ct: of("contrats").filter((c) => c.statut === "Actif").length };
  });
  const tot = (k) => sum(rows, (r) => r[k]), mx = Math.max(1, ...rows.map((r) => Math.max(r.ca, r.dep)));
  const kpi = (l, v, c = "") => `<div class="kpi"><small>${l}</small><b class="num ${c}">${v}</b></div>`;
  const bars = rows.map((r) => `<div class="socbar"><span>${esc(r.s.nom)}</span><div><i class="a" style="width:${(r.ca / mx) * 100}%"></i><i class="b" style="width:${(r.dep / mx) * 100}%"></i></div><b class="num">${E2(r.ca)}</b></div>`).join("");
  const tb = tbl(["Société", "CA facturé HT", "Encaissé", "Dépenses HT", "Marge brute", "Reste à encaisser", "Chantiers en cours"],
    rows.map((r) => ({ act: "socUse", id: r.s.id, t: r.s.nom, c: [`<strong>${esc(r.s.nom)}</strong>${r.s.principale ? "<small>principale</small>" : ""}`, `<span class="num">${E2(r.ca)}</span>`, `<span class="num">${E2(r.enc)}</span>`, `<span class="num">${E2(r.dep)}</span>`, `<span class="num ${r.marge < 0 ? "dn" : ""}">${E2(r.marge)}</span>`, `<span class="num">${E2(r.reste)}</span>${r.retard ? `<small class="dn">${r.retard} en retard</small>` : ""}`, r.ch] })), "Aucune société.")
    + `<div class="totaux"><div class="ttc"><span>Total toutes sociétés · marge brute</span><span class="num">${E2(tot("marge"))}</span></div></div>`;
  return page("Vue consolidée", `Toutes vos sociétés réunies, année ${an}. Cliquez sur une ligne pour travailler sur cette société.`, `<a class="btn o" href="#/societes">Gérer les sociétés</a>`,
    `<div class="kpis k5">${kpi("CA facturé HT", E2(tot("ca")))}${kpi("Encaissé", E2(tot("enc")))}${kpi("Dépenses HT", E2(tot("dep")))}${kpi("Marge brute", E2(tot("marge")), tot("marge") < 0 ? "dn" : "")}${kpi("Reste à encaisser", E2(tot("reste")))}</div>`
    + card("CA facturé et dépenses par société", `<div class="pad">${bars}<p class="mut"><i class="lg a"></i> CA facturé <i class="lg b"></i> Dépenses</p></div>`) + card("Détail par société", tb)
    + `<p class="mut pad">Les chiffres s'appuient sur les statuts de facturation. Le CA est celui des factures émises dans l'année, hors brouillons et annulations.</p>`);
};

/* ---------- Sélecteur dans l'en-tête ---------- */
function socHeader() {
  const multi = (db.societes || []).length > 1; let w = $("#socw");
  if (!multi || !db.v21) { w?.remove(); return; }
  const act = socActive();
  if (!w) { w = document.createElement("div"); w.className = "pw"; w.id = "socw"; $(".top .sp")?.insertAdjacentElement("afterend", w); if (!w.parentNode) return; }
  w.innerHTML = `<button class="btn o sm socbtn" id="socbtn" aria-haspopup="true" aria-expanded="false" title="Changer de société"><span class="socdot" style="background:${esc(act?.couleur || "var(--acc)")}"></span>${esc(act?.nom || "Société")}</button><div id="socpop" class="pop sm" hidden>${(db.societes || []).map((s) => `<button type="button" class="mi" data-act="socUse" data-id="${s.id}">${s.id === act?.id ? "✓ " : ""}${esc(s.nom)}</button>`).join("")}<hr><button type="button" class="mi" data-go="consolide">Vue consolidée</button><button type="button" class="mi" data-go="societes">Gérer les sociétés</button></div>`;
  $("#socbtn", w).onclick = (e) => { e.stopPropagation(); const p = $("#socpop", w); p.hidden = !p.hidden; $("#socbtn", w).setAttribute("aria-expanded", String(!p.hidden)); };
}
document.addEventListener("click", (e) => { const p = $("#socpop"); if (p && !p.hidden && !e.target.closest("#socw")) p.hidden = true; });

// Les réglages de l'entreprise ne se modifient que sur la société principale
if (typeof V.params === "function") { const p0 = V.params; V.params = (r) => (db.v21 && !socEstPrincipale() ? page("Paramètres", "", "", card("Société active : " + esc(socActive()?.nom || ""), `<p class="pad">Les paramètres de l'entreprise (logo, mentions légales, réglages des documents) se modifient depuis la société principale. Les coordonnées de cette société se changent dans <a href="#/societes">Sociétés</a>.</p><p class="pad">${btn("Passer à la société principale", "socUse", socPrincipale()?.id || "")}</p>`)) : p0(r)); }

const societesActions = {
  socNew: () => guard() && socForm(null),
  socEdit: (id) => guard() && socForm(byId(db.societes, id)),
  socUse: async (id) => { if (!id) return; socSet(byId(db.societes, id)?.principale ? "" : id); const p = $("#socpop"); if (p) p.hidden = true; await refresh(); toast("Société active : " + socNom(id), "ok"); },
};
