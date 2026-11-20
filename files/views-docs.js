/* Devis et factures : listes, fiche, éditeur, PDF, partage en ligne */

const KD = {
  devis: { list: "devis", route: "devis", lt: "devis_lignes", fk: "devis_id", df: "date_devis", label: "Devis", kind: "devis" },
  facture: { list: "factures", route: "factures", lt: "factures_lignes", fk: "facture_id", df: "date_emission", label: "Facture", kind: "facture" },
};
const docNum = (d, K) => d.numero || (K === "facture" ? "Brouillon" : "-");
const docStatut = (d, K) => (K === "facture" ? d.statut_affiche : d.statut);
const PREST = { fourniture: "Fourniture", main_oeuvre: "Main d'œuvre", sous_traitance: "Sous-traitance", materiel: "Matériel", divers: "Divers", ouvrage: "Ouvrage" };
const PREST_PH = { fourniture: "Fourniture : carrelage, tuyaux, peinture…", main_oeuvre: "Main d'œuvre : pose, démolition…", sous_traitance: "Sous-traitance : électricien, plaquiste…", materiel: "Matériel : location de nacelle, benne…", divers: "Divers : frais, déplacement, remise…" };
const UNITES = ["u", "m²", "ml", "m³", "h", "jour", "forfait", "kg", "lot"];
const TVA_TAUX = [20, 10, 5.5, 0];

let cxCurK = ""; // "devis" quand le chiffrage avancé (migration v13) est actif dans l'éditeur
async function lignesOf(K, id) {
  const k = KD[K];
  const l = await q(sb.from(k.lt).select("*").eq(k.fk, id).order("position"));
  l.forEach((x) => nz(x, ["quantite", "prix_unitaire_ht", "taux_tva"]));
  return l;
}
function totauxParTaux(lignes, d) {
  const by = {};
  for (const l of lignes) {
    if (l.type_ligne === "image" || (l.est_option && !l.option_choisie) || (l.tranche_cond && !l.tranche_ok)) continue;
    const ht = r2(Number(l.quantite) * Number(l.prix_unitaire_ht));
    const k = String(Number(l.taux_tva));
    by[k] ||= { ht: 0, tva: 0 };
    by[k].ht += ht;
  }
  for (const k of Object.keys(by)) by[k].tva = r2((by[k].ht * Number(k)) / 100);
  if (!lignes.length && d && d.montant_ht > 0) by[String(Number(d.taux_tva ?? 20))] = { ht: d.montant_ht, tva: d.montant_tva };
  return by;
}

/* ---------- Tableaux ---------- */
function docTable(K, list) {
  K = K === "devis" ? "devis" : K === "factures" ? "facture" : K;
  const k = KD[K];
  return tbl([k.label, "Date", { h: "Montant TTC", r: 1 }, "Statut"],
    list.map((d) => ({ go: `${k.route}/${d.id}`, t: `${d.numero} ${d.client_nom}`,
      c: [`<strong>${esc(docNum(d, K))}</strong><small>${esc(d.client_nom)}${d.chantier_nom ? " · " + esc(d.chantier_nom) : ""}</small>`,
        D(d[k.df]), `<span class="num">${E2(d.montant_ttc)}</span>`, chip(docStatut(d, K))] })),
    `Aucun ${k.label.toLowerCase()}.`);
}
/* ---------- Tri des listes ---------- */
const DOC_SORTS = [
  ["crea_desc", "Création : plus récent d'abord"], ["crea_asc", "Création : plus ancien d'abord"],
  ["date_desc", "Date du document : récente"], ["date_asc", "Date du document : ancienne"],
  ["nom_asc", "Client : A → Z"], ["nom_desc", "Client : Z → A"],
  ["num_asc", "Numéro : croissant"], ["num_desc", "Numéro : décroissant"],
  ["mt_desc", "Montant : du plus élevé"], ["mt_asc", "Montant : du plus bas"],
];
const docSortOf = (K) => ST.docSort?.[K] || "crea_desc";
function docSortList(K, list) {
  const k = KD[K], [f, dir] = docSortOf(K).split("_"), m = dir === "asc" ? 1 : -1, df = (x) => String(x[k.df] || "");
  const key = { crea: (x) => String(x.created_at || ""), date: df, nom: (x) => String(x.client_nom || "").toLowerCase(), num: (x) => String(x.numero || ""), mt: (x) => Number(x.montant_ttc) || 0 }[f];
  return [...list].sort((a, b) => { const A = key(a), B = key(b); return (typeof A === "number" ? A - B : A.localeCompare(B, "fr", { numeric: true })) * m || String(b.created_at || "").localeCompare(String(a.created_at || "")); });
}
const dtCrea = (v) => { if (!v) return "-"; const d = new Date(v); return isNaN(d) ? "-" : `${D(localDay(d))}<small>${pad2(d.getHours())}h${pad2(d.getMinutes())}</small>`; };

function docList(K, r) {
  const k = KD[K];
  if (r.arg) return docDetail(K, r.arg);
  const tabsDef = K === "devis"
    ? [["tous", "Tous"], ["Brouillon", "Brouillons"], ["Envoyé", "Envoyés"], ["Accepté", "Acceptés"], ["Refusé", "Refusés"]]
    : [["tous", "Toutes"], ["Brouillon", "Brouillons"], ["ouv", "À encaisser"], ["En retard", "En retard"], ["Payée", "Payées"], ...(db.v8 ? [["Avoir", "Avoirs"]] : [])];
  const cur = ST.tab[k.list] || "tous";
  const list = docSortList(K, db[k.list]).filter((d) => cur === "tous" || (cur === "ouv" ? ["Envoyée", "Partiellement payée"].includes(d.statut) && d.reste > 0.005 : docStatut(d, K) === cur));
  const total = sum(list, (d) => d.montant_ttc);
  const rows = list.map((d) => ({ go: `${k.route}/${d.id}`, t: `${d.numero || ""} ${d.client_nom} ${d.chantier_nom || ""}`,
    c: [`<strong>${esc(docNum(d, K))}</strong>${K === "facture" ? fxTag(d) : ""}`, `${esc(d.client_nom)}${d.chantier_nom ? `<small>${esc(d.chantier_nom)}</small>` : ""}`,
      D(K === "devis" ? d.date_devis : d.statut === "Brouillon" ? d.date_emission : d.echeance),
      dtCrea(d.created_at),
      `<span class="num">${E2(d.montant_ttc)}</span>`,
      K === "facture" && d.reste > 0 && d.statut !== "Brouillon" ? `<span class="num ${d.statut_affiche === "En retard" ? "dn" : ""}">${E2(d.reste)}</span>` : K === "facture" ? "" : null,
      chip(docStatut(d, K))].filter((x) => x !== null) }));
  const cols = K === "devis"
    ? [k.label, "Client", "Date", "Créé le", { h: "Montant TTC", r: 1 }, "Statut"]
    : [k.label, "Client", "Échéance", "Créé le", { h: "Montant TTC", r: 1 }, { h: "Reste dû", r: 1 }, "Statut"];
  return page(K === "devis" ? "Devis" : "Factures",
    K === "devis" ? "Créer, envoyer et suivre vos propositions commerciales." : "Émettre, envoyer et suivre vos factures jusqu'au paiement.",
    btn(K === "devis" ? "Nouveau devis" : "Nouvelle facture", K === "devis" ? "devisNew" : "factureNew", "", "", "w"),
    (K === "facture" ? fxPendingCard() : "") + tabs(k.list, tabsDef, cur) + `<div class="sortbar">` + searchBar("Rechercher un numéro, un client, un chantier…", `${list.length} document${list.length > 1 ? "s" : ""} · ${E(total)} TTC`) + `<label class="sortsel"><span>Trier par</span><select data-chg="docSort${K === "devis" ? "Devis" : "Facture"}" aria-label="Trier">${DOC_SORTS.map(([v, l]) => `<option value="${v}"${v === docSortOf(K) ? " selected" : ""}>${l}</option>`).join("")}</select></label></div>` +
      card("", tbl(cols, rows, K === "devis" ? "Aucun devis. Créez le premier avec le bouton « Nouveau devis »." : "Aucune facture. Transformez un devis accepté en facture ou créez-en une.")));
}
V.devis = (r) => docList("devis", r);
V.factures = (r) => docList("facture", r);

/* ---------- Fiche d'un document ---------- */
function docPreview(K, d, lignes, ex = {}) {
  const e = db.ent, c = clientOf(d.client_id) || {}, k = KD[K];
  lignes = lignes.filter((l) => l.nature !== "saut");
  if (typeof cxPreviewLignes === "function") lignes = cxPreviewLignes(lignes);
  const by = totauxParTaux(lignes, d);
  const rates = Object.keys(by).sort((a, b) => b - a);
  const lht = (l) => r2(l.quantite * l.prix_unitaire_ht);
  const gs = lignes.length ? groupCats(lignes, true) : [];
  gs.forEach((g) => (g.sum = r2(sum(g.lignes.filter((l) => !(l.est_option && !l.option_choisie) && !(l.tranche_cond && !l.tranche_ok)), lht))));
  const recap = gs.filter((g) => g.cat).length >= 2 ? `<div class="doc-recap"><b>Récapitulatif des travaux</b>${gs.map((g, i) => `<div><span>${i + 1}. ${esc(g.cat || "Divers")}</span><span class="num">${E2(g.sum)}</span></div>`).join("")}</div>` : "";
  const fd = K === "facture" ? fdOf(d.id) : null, isDed = (l) => l.nature === "deduction", isLibre = (l) => l.nature === "libre";
  const ded = lignes.filter(isDed);
  gs.forEach((g) => (g.lignes = g.lignes.filter((l) => !isDed(l))));
  const gsShown = gs.filter((g) => g.lignes.length);
  const rows = gsShown.length
    ? gsShown.map((g, gi) => (g.cat ? `<tr class="cc"><td colspan="5">${gi + 1}. ${esc(g.cat)}</td><td class="r">Sous-total ${E2(g.sum)}</td></tr>` : "") +
      g.lignes.map((l, li) => `<tr><td class="n">${gi + 1}.${li + 1}</td><td>${esc(l.designation)}${l.description ? `<small class="ld">${esc(l.description).replace(/\n/g, "<br>")}</small>` : ""}</td>${isLibre(l) ? `<td class="r"></td><td class="r"></td>` : `<td class="r">${fmtNum(l.quantite, Number.isInteger(l.quantite) ? 0 : 2)} ${esc(l.unite || "")}</td><td class="r">${fmtNum(l.prix_unitaire_ht)}</td>`}<td class="r">${fmtNum(l.taux_tva, l.taux_tva % 1 ? 1 : 0)} %</td><td class="r"><b>${isLibre(l) && !lht(l) ? "" : fmtNum(lht(l))}</b></td></tr>`).join("")).join("")
    : `<tr><td colspan="6" class="mut">Aucune ligne détaillée (montant global).</td></tr>`;
  const paye = K === "facture" ? d.paye : 0;
  const fc = K === "facture" ? d.fx : null, dedHt = r2(sum(ded, lht));
  const avancement = fd?.avancement?.length ? `<div class="doc-recap"><b>Avancement des travaux (marché ${E2(fd.marche_ht)} HT)</b>${fd.avancement.map((a) => `<div><span>${esc(a.label)}</span><span class="num">${fmtNum(a.prev, 1)} % → ${fmtNum(a.cum, 1)} %</span></div>`).join("")}</div>` : "";
  const fxTot = (fc && fc.any) || ded.length ? `${ded.length ? `<div><span>Total des travaux HT</span><span class="num">${E2(r2(d.montant_ht - dedHt))}</span></div>${ded.map((l) => `<div><span>${esc(l.designation)}</span><span class="num">- ${E2(-lht(l))}</span></div>`).join("")}` : ""}` : "";
  const fxAdj = fc && fc.any ? `${fc.retenue ? `<div><span>Retenue de garantie ${fmtNum(fc.retenuePct, 1)} %</span><span class="num">- ${E2(fc.retenue)}</span></div>` : ""}${fc.prime ? `<div><span>Prime ${esc(fc.primeLib || "énergétique")}</span><span class="num">- ${E2(fc.prime)}</span></div>` : ""}${fc.prorata ? `<div><span>Compte prorata</span><span class="num">- ${E2(fc.prorata)}</span></div>` : ""}<div class="reste"><span>Net à payer</span><span class="num">${E2(fc.net)}</span></div>${fc.escompte ? `<div><span>Si payé avant le ${D(fc.limite)} (escompte ${fmtNum(fc.escomptePct, 1)} %)</span><span class="num">${E2(fc.netEsc)}</span></div>` : ""}` : "";
  return `<div class="doc">
    <div class="doc-h doc-top"><div><b>${esc(e.nom || "Votre entreprise")}</b><small>${esc(e.adresse || "")}</small><small>${esc([e.telephone, e.email].filter(Boolean).join(" · "))}</small></div>
      <div style="text-align:right"><b>${K === "facture" ? esc(fxLabel(d)) : k.label} ${esc(docNum(d, K))}</b><small>Date : ${D(d[k.df])}</small><small>${K === "devis" ? `Valable ${d.validite_jours} jours` : `Échéance : ${D(d.echeance)}`}</small></div></div>
    <div class="doc-h"><div><small>${K === "devis" ? "Destinataire" : "Facturé à"}</small><b>${esc(c.nom || d.client_nom)}</b><small>${esc(c.adresse || "")}</small><small>${esc(c.ville || "")}</small></div>
      ${d.chantier_nom ? `<div style="text-align:right"><small>Chantier</small><b>${esc(d.chantier_nom)}</b></div>` : ""}</div>
    ${ex.titre ? `<h3 style="margin:0 0 10px">${esc(ex.titre)}</h3>` : ""}${[ex.debut_travaux ? `Début des travaux : ${D(ex.debut_travaux)}` : "", ex.duree_estimee ? `Durée estimée : ${esc(ex.duree_estimee)}` : "", ex.fin_chantier ? `Fin de chantier au plus tard : ${D(ex.fin_chantier)}` : ""].filter(Boolean).length ? `<p class="mut" style="margin:0 0 8px">${[ex.debut_travaux ? `Début des travaux : ${D(ex.debut_travaux)}` : "", ex.duree_estimee ? `Durée estimée : ${esc(ex.duree_estimee)}` : "", ex.fin_chantier ? `Fin de chantier au plus tard : ${D(ex.fin_chantier)}` : ""].filter(Boolean).join(" · ")}</p>` : ""}${ex.description ? `<p style="margin:0 0 12px;white-space:pre-line">${esc(ex.description)}</p>` : ""}
    ${recap}${avancement}
    <div class="tw"><table class="dt"><thead><tr><th class="n">N°</th><th>Désignation</th><th class="r">Quantité</th><th class="r">P.U. HT</th><th class="r">TVA</th><th class="r">Total HT</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="totaux">${fxTot}<div><span>${ded.length ? "Reste à facturer HT" : "Total HT"}</span><span class="num">${E2(d.montant_ht)}</span></div>
      ${rates.map((t) => `<div><span>TVA ${fmtNum(t, t % 1 ? 1 : 0)} %</span><span class="num">${E2(by[t].tva)}</span></div>`).join("")}
      <div class="ttc"><span>Total TTC</span><span class="num">${E2(d.montant_ttc)}</span></div>
      ${fxAdj}${K === "facture" && paye > 0 ? `<div><span>Déjà réglé</span><span class="num">- ${E2(paye)}</span></div><div class="reste"><span>Reste à payer</span><span class="num">${E2(d.reste)}</span></div>` : ""}</div>
    ${d.notes ? `<p class="mut" style="margin:18px 0 0;white-space:pre-line">${esc(d.notes)}</p>` : ""}</div>`;
}
const shareLink = (token) => new URL("p.html?t=" + token, location.href).href;

async function docDetail(K, id) {
  const k = KD[K];
  const d = byId(db[k.list], id);
  if (!d) return `<div class="empty"><h2>${k.label} introuvable</h2><button class="btn" data-go="${k.route}">Retour à la liste</button></div>`;
  const lignes = await lignesOf(K, id);
  const ex = await docExtra(K, id);
  const p = partageOf(id);
  const st = docStatut(d, K);
  const fac = K === "devis" ? devisFacture(id) : null;
  const dv = K === "facture" && (fdOf(id)?.devis_id || d.devis_id) ? byId(db.devis, fdOf(id)?.devis_id || d.devis_id) : null;
  let actions = btn("Visualiser le PDF", K === "devis" ? "devisPdf" : "facturePdf", id, "", "");
  if (K === "devis") {
    const nl = typeof fxLinked === "function" ? fxLinked(id).length : fac ? 1 : 0;
    if (nl) actions += `<a class="btn o" href="#/factures/${(typeof fxLinked === "function" ? fxLinked(id)[0] : fac).id}">Voir ${nl > 1 ? "les " + nl + " factures" : "la facture"}</a>`;
    if (d.statut === "Accepté" && db.v8 && fxResteDevis(d) > 0.5) actions += btn(nl ? "Facturer la suite" : "Facturer en plusieurs fois", "fxBilling", id, "", "o w");
    if (!nl && d.statut !== "Refusé") actions += btn("Transformer en facture", "devisToFacture", id, "", "o w");
    if (d.statut === "Brouillon" || d.statut === "Envoyé") actions += btn(d.statut === "Brouillon" ? "Envoyer au client" : "Lien client", "devisSend", id, "", "o w");
    if (d.statut === "Brouillon") actions += btn("Modifier", "devisEdit", id, "", "o w");
    if (d.statut === "Envoyé") actions += btn("Marquer accepté", "devisStatut", id, "Accepté", "o w") + btn("Refusé", "devisStatut", id, "Refusé", "o w");
    actions += btn("Dupliquer", "devisDup", id, "", "o w");
    if (db.v13 && d.statut === "Accepté") actions += btn("Avenant", "cxAvenant", id, "", "o w");
    if (d.statut === "Brouillon") actions += btn("Supprimer", "devisDel", id, "", "dn-o w");
  } else {
    if (d.statut === "Brouillon") actions += btn("Émettre la facture", "factureEmettre", id, "", "w") + btn("Modifier", "factureEdit", id, "", "o w") + btn("Supprimer", "factureDel", id, "", "dn-o w");
    else {
      if (d.reste > 0 && d.statut !== "Annulée") actions += btn("Enregistrer un paiement", "payNew", id, "", "w");
      if (db.v8 && d.statut !== "Annulée" && !fxIsAvoir(d)) actions += btn("Créer un avoir", "fxAvoir", id, "", "o w");
      if (d.statut !== "Annulée") actions += btn("Envoyer au client", "factureSend", id, "", "o w");
      if (d.statut !== "Annulée" && db.v7) actions += btn("Facture électronique", "efOpen", id, "", "o");
      if (d.statut_affiche === "En retard" && !db.v9) actions += btn("Relancer", "factureRelance", id, "", "o w");
      if (d.statut === "Envoyée" && !d.paye) actions += btn("Annuler", "factureAnnuler", id, "", "dn-o w");
    }
  }
  const paiements = K === "facture" ? db.paiements.filter((x) => x.facture_id === id) : [];
  const suivi = `<dl class="kv"><dt>Statut</dt><dd>${chip(st)}</dd>
    <dt>Client</dt><dd><a href="#/clients/${d.client_id}">${esc(d.client_nom)}</a></dd>
    ${d.chantier_nom ? `<dt>Chantier</dt><dd><a href="#/chantiers/${d.chantier_id}">${esc(d.chantier_nom)}</a></dd>` : ""}
    <dt>${K === "devis" ? "Date" : "Émission"}</dt><dd>${D(d[k.df])}</dd>
    <dt>Créé le</dt><dd>${dtCrea(d.created_at).replace("<small>", " · ").replace("</small>", "")}</dd>
    ${K === "facture" ? `<dt>Échéance</dt><dd>${D(d.echeance)}</dd>` : `<dt>Validité</dt><dd>${d.validite_jours} jours</dd>`}
    ${K === "devis" && db.v13 ? cxDetailMarge(lignes) : ""}
    ${dv ? `<dt>Devis d'origine</dt><dd><a href="#/devis/${dv.id}">${esc(dv.numero)}</a></dd>` : ""}
    ${K === "facture" && db.v7 && d.statut !== "Brouillon" ? `<dt>Facture électronique</dt><dd>${efChip(efOf(id))}</dd>` : ""}</dl>`;
  const partageHtml = p
    ? `<dl class="kv"><dt>Lien client</dt><dd><a href="${shareLink(p.token)}" target="_blank" rel="noopener">Ouvrir la page du client</a></dd>
        <dt>Consultation</dt><dd>${p.vu_at ? "Ouvert le " + new Date(p.vu_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "Pas encore ouvert"}${p.nb_vues ? ` · ${p.nb_vues} consultation${p.nb_vues > 1 ? "s" : ""}` : ""}${p.revoque_at ? " · <b>lien révoqué</b>" : ""}</dd>
        ${K === "devis" ? `<dt>Réponse</dt><dd>${p.accepte_at ? `<span class="chip ok">Accepté</span> par ${esc(p.accepte_par || "")}${sigOf(id) ? " · signé électroniquement" : ""}` : p.refuse_at ? `<span class="chip dn">Refusé</span>` : "En attente"}</dd>` : ""}</dl>`
    : `<p class="mut" style="margin:0;padding:16px 18px">Pas encore envoyé en ligne. « ${K === "devis" ? "Envoyer au client" : "Envoyer au client"} » crée un lien que votre client ouvre sans compte${K === "devis" ? " pour accepter ou refuser le devis" : ""}.</p>`;
  const payHtml = K === "facture" && paiements.length
    ? card("Paiements reçus", paiements.map((x) => `<div class="row"><div><b>${E2(x.montant)}</b><small>${D(x.date_paiement)} · ${esc(x.mode)}</small></div><button class="lk w" data-act="payDel" data-id="${x.id}">Supprimer</button></div>`).join(""))
    : "";
  const echHtml = K === "facture" && d.statut !== "Annulée" && !fxIsAvoir(d) ? echCard(d) : "";
  return page(`${esc(docNum(d, K))} ${chip(st)}`, `${ex.titre ? "<b>" + esc(ex.titre) + "</b> · " : ""}${K === "facture" && fxNat(d) !== "Facture" ? esc(fxLabel(d)) + " · " : ""}${esc(d.client_nom)} · ${E2(d.montant_ttc)} TTC`, `${actions}`,
    `<div class="g2"><div>${docPreview(K, d, lignes, ex)}</div><div>${card("Suivi", suivi)}${card("Partage en ligne", partageHtml)}${K === "devis" ? sigCard(id) + fxDevisCard(d) + (typeof mkDevisCards === "function" ? mkDevisCards(d, lignes) : "") : fxDetailCard(d) + fxLinkedCard(d)}${echHtml}${payHtml}${K === "facture" ? rgInvoiceCard(d) : ""}</div></div>`,
    crumbs([K === "devis" ? "Devis" : "Factures", k.route], [docNum(d, K)]));
}

/* ---------- Éditeur (devis / facture) : catégories > lignes (+ description) ---------- */
const LCOLS = `<colgroup><col class="c-ln"><col class="c-des"><col class="c-q"><col class="c-u"><col class="c-p"><col class="c-t"><col class="c-tot"><col class="c-a"></colgroup>`;
function ligneRow(l = {}) {
  if (cxCurK === "devis" && l.type_ligne === "image") return cxImageRow(l);
  const tva = l.taux_tva ?? (Number(db.ent.taux_tva_defaut) || 20);
  const nat = l.nature || "normale";
  const dg = `<span class="dg-h" data-drag title="Glisser pour déplacer" aria-label="Déplacer la ligne">⋮⋮</span>`;
  const act = (dup) => `<td class="lact"><span class="lmore"><button type="button" class="rm" data-up title="Monter" aria-label="Monter la ligne">${svg(ic.up)}</button><button type="button" class="rm" data-down title="Descendre" aria-label="Descendre la ligne">${svg(ic.down)}</button>${dup ? `<button type="button" class="rm" data-dup title="Dupliquer la ligne" aria-label="Dupliquer la ligne">${svg(ic.dup)}</button>` : ""}</span><button type="button" class="rm" data-rm title="Supprimer la ligne" aria-label="Supprimer la ligne">${svg(ic.x)}</button></td>`;
  if (nat === "saut") {
    return `<tr class="lr lr-pb" data-tp="" data-mref="" data-nat="saut" data-ref=""><td class="ln">${dg}</td><td colspan="6"><span class="pb-line">Saut de page : la suite commence sur une nouvelle page du PDF</span>
      <input type="hidden" data-f="des" value="Saut de page"><input type="hidden" data-f="desc" value=""><input type="hidden" data-f="qte" value="1"><input type="hidden" data-f="uni" value=""><input type="hidden" data-f="pu" value="0"><input type="hidden" data-f="tva" value="${tva}"><span data-f="tot" hidden></span></td>${act(false)}</tr>`;
  }
  const txt = nat === "libre" && !(Number(l.prix_unitaire_ht) > 0);
  return `<tr class="lr${nat !== "normale" ? " lr-x" : ""}${txt ? " lr-txt" : ""}" data-tp="${l._tp ?? ""}" data-mref="${esc(l.marche_ref || "")}" data-nat="${nat}" data-ref="${l.ref_facture_id || ""}"><td class="ln">${dg}<span class="ln-n" data-f="num"></span></td>
    <td class="ld">${nat === "libre" ? "" : `<select class="typ typ-${esc(l.type_prestation || "")}" data-f="typ" aria-label="Type de ligne"><option value="">Type…</option>${Object.entries(PREST).map(([v, t]) => `<option value="${v}"${v === l.type_prestation ? " selected" : ""}>${t}</option>`).join("")}</select>`}<input type="text" data-f="des" value="${esc(l.designation || "")}" placeholder="${nat === "libre" ? "Texte libre, ou poste libre (frais de déplacement, remise commerciale…)" : PREST_PH[l.type_prestation] || "Désignation de la prestation"}"><textarea data-f="desc" rows="1" placeholder="Description (facultatif) : détails, matériaux, normes…">${esc(l.description || "")}</textarea>${cxCurK === "devis" ? cxPanel(l) : ""}</td>
    <td><input type="text" inputmode="decimal" data-f="qte" value="${l.quantite !== undefined ? String(l.quantite).replace(".", ",") : "1"}" aria-label="Quantité"></td>
    <td><input type="text" data-f="uni" list="unites" value="${esc(l.unite || "u")}" aria-label="Unité"></td>
    <td><input type="text" inputmode="decimal" data-f="pu" value="${l.prix_unitaire_ht !== undefined ? String(l.prix_unitaire_ht).replace(".", ",") : ""}" placeholder="0,00" aria-label="Prix unitaire HT"></td>
    <td><select data-f="tva" aria-label="TVA">${[...new Set([...TVA_TAUX, Number(tva)])].map((t) => `<option value="${t}"${Number(t) === Number(tva) ? " selected" : ""}>${String(t).replace(".", ",")} %</option>`).join("")}</select></td>
    <td class="lt"><span data-f="tot">0,00</span></td>${act(true)}</tr>`;
}

// Regroupe les lignes consécutives qui ont la même catégorie
function groupCats(ls, composite = false) {
  const out = [];
  for (const l of ls.length ? ls : [{}]) {
    const c = String(l.categorie || "").trim(), k = typeof mkKey === "function" ? mkKey(l) : c, last = out[out.length - 1];
    if (last && last.k === k) last.lignes.push(l);
    else out.push({ k, cat: composite && typeof mkLabel === "function" ? mkLabel(l) : c, lot: l.lot || "", sous_lot: l.sous_lot || "", tranche: l.tranche || "", tranche_cond: !!l.tranche_cond, tranche_ok: !!l.tranche_ok, lignes: [l] });
  }
  return out;
}
const catBlock = (g) => `<section class="cat"><div class="cat-h"><button type="button" class="rm cat-fold" data-fold title="Replier / déplier la section" aria-label="Replier ou déplier la section">${svg(ic.down)}</button><span class="dg-h cat-dg" data-dragcat title="Glisser pour déplacer la section" aria-label="Déplacer la section">⋮⋮</span><span class="cat-n" data-f="catn"></span><input type="text" data-f="cat" value="${esc(g.cat)}" placeholder="Titre de la section (facultatif) : Démolition, Plomberie…" aria-label="Titre de la section"><span class="num cat-sub" data-f="sub"></span><span class="cat-act"><button type="button" class="rm" data-upcat title="Monter la section" aria-label="Monter la section">${svg(ic.up)}</button><button type="button" class="rm" data-downcat title="Descendre la section" aria-label="Descendre la section">${svg(ic.down)}</button><button type="button" class="rm" data-rmcat title="Supprimer la section et ses lignes" aria-label="Supprimer la section">${svg(ic.x)}</button></span></div>${cxCurK === "devis" && typeof mkCatFields === "function" && db.v14 ? `<details class="cat-more"${g.lot || g.sous_lot || g.tranche || g.tranche_cond ? " open" : ""}><summary>Marché public : lot, sous-lot, tranche</summary>${mkCatFields(g)}</details>` : ""}
  <div class="tw"><table class="lines">${LCOLS}<tbody class="lb">${g.lignes.map(ligneRow).join("")}</tbody></table></div>
  <div class="addbar"><span>Ajouter :</span>${["fourniture", "main_oeuvre", "sous_traitance", "materiel", "divers"].map((t) => `<button type="button" class="chip-b t-${t}" data-addt="${t}">${PREST[t]}</button>`).join("")}<button type="button" class="chip-b" data-addt="ouvrage">Ouvrage</button><button type="button" class="addl" data-addl>Ligne vide</button></div></section>`;
function readLignes(root) {
  const out = [];
  $$(".cat", root).forEach((sec) => {
    const categorie = $('[data-f="cat"]', sec).value.trim();
    const mkc = cxCurK === "devis" && typeof mkReadCat === "function" ? mkReadCat(sec) : {};
    $$(".lr", sec).forEach((tr) => out.push({
      ...(cxCurK === "devis" ? (cxApplyMetre(tr), cxRead(tr), { ...cxRead(tr), ...mkc, ...(typeof mkReadLine === "function" ? mkReadLine(tr) : {}) }) : {}),
      categorie, type_prestation: $('[data-f="typ"]', tr)?.value || null, nature: tr.dataset.nat || "normale", ref_facture_id: tr.dataset.ref || null, designation: $('[data-f="des"]', tr).value.trim(), description: $('[data-f="desc"]', tr).value.trim(),
      quantite: parseNum($('[data-f="qte"]', tr).value), unite: $('[data-f="uni"]', tr).value.trim() || "u",
      prix_unitaire_ht: parseNum($('[data-f="pu"]', tr).value), taux_tva: Number($('[data-f="tva"]', tr).value),
    }));
  });
  return out;
}
// Ajoute un ouvrage de la bibliothèque dans l'éditeur (dans la catégorie du même corps d'état)
function ovInsertLine(m, o) {
  const isEmpty = (tr) => !$('[data-f="des"]', tr).value.trim() && !parseNum($('[data-f="pu"]', tr).value);
  const secs = $$(".cat", m);
  let sec = secs.find((x) => $('[data-f="cat"]', x).value.trim().toLowerCase() === String(o.corps_etat).toLowerCase());
  if (!sec) {
    const last = secs[secs.length - 1];
    if (last && !$('[data-f="cat"]', last).value.trim() && $$(".lr", last).length === 1 && isEmpty($(".lr", last))) { sec = last; $('[data-f="cat"]', sec).value = o.corps_etat; }
    else { $("#cats", m).insertAdjacentHTML("beforeend", catBlock({ cat: o.corps_etat, lignes: [{}] })); sec = $$(".cat", m).pop(); }
  }
  const lb = $(".lb", sec);
  let tr = $$(".lr", lb).pop();
  if (!tr || !isEmpty(tr)) { lb.insertAdjacentHTML("beforeend", ligneRow({})); tr = $$(".lr", lb).pop(); }
  $('[data-f="des"]', tr).value = o.designation;
  $('[data-f="qte"]', tr).value = "1";
  $('[data-f="uni"]', tr).value = o.unite;
  $('[data-f="pu"]', tr).value = String(o.prix_ht).replace(".", ",");
  const sel = $('[data-f="tva"]', tr), t = String(Number(o.taux_tva));
  if (![...sel.options].some((x) => x.value === t)) sel.insertAdjacentHTML("beforeend", `<option value="${t}">${t.replace(".", ",")} %</option>`);
  sel.value = t;
  tr.dataset.tp = o.temps_pose_h || "";
  recalcLignes(m);
  if (cxCurK === "devis") cxFillFromOuvrage(m, tr, o);
}
function recalcLignes(root) {
  const ls = readLignes(root);
  let i = 0, sn = 0;
  const rows = $$(".lr", root);
  $$(".cat", root).forEach((sec) => {
    let s = 0, n = 0;
    const titled = !!$('[data-f="cat"]', sec).value.trim();
    if (titled) sn++;
    const cn = $('[data-f="catn"]', sec); if (cn) cn.textContent = titled ? sn + "." : "";
    $$(".lr", sec).forEach((tr) => {
      const l = ls[i++], t = r2(l.quantite * l.prix_unitaire_ht);
      if (cxIncluded(l)) s += t;
      const isTxt = tr.dataset.nat === "libre" && !(l.prix_unitaire_ht > 0); tr.classList.toggle("lr-txt", isTxt);
      const real = tr.dataset.nat !== "saut" && tr.dataset.type !== "image" && !isTxt;
      if (real) n++;
      const num = $('[data-f="num"]', tr); if (num) num.textContent = real ? (titled ? `${sn}.${n}` : String(n)) : "";
      const tt = $('[data-f="tot"]', tr); if (tt) tt.textContent = isTxt || tr.dataset.nat === "saut" ? "" : fmtNum(t);
    });
    $('[data-f="sub"]', sec).textContent = $$(".lr", sec).length ? (sec.classList.contains("fold") ? `${n} ligne${n > 1 ? "s" : ""} · ` : "") + "Sous-total " + E2(s) : "";
    sec.dataset.sum = s; sec.dataset.n = n;
  });
  const by = totauxParTaux(ls.filter((l) => (l.designation || l.prix_unitaire_ht) && l.nature !== "saut" && cxIncluded(l)));
  const tp = sum(rows, (tr) => (Number(tr.dataset.tp) || 0) * parseNum($('[data-f="qte"]', tr).value));
  const ht = sum(Object.values(by), (x) => x.ht), tva = sum(Object.values(by), (x) => x.tva);
  const tb = $("#totbox", root);
  if (tb) tb.innerHTML = `<div class="tb-r"><span>Total net HT</span><span class="num">${E2(ht)}</span></div>${Object.keys(by).sort((a, b) => b - a).map((t) => `<div class="tb-r"><span>TVA ${String(t).replace(".", ",")} %</span><span class="num">${E2(by[t].tva)}</span></div>`).join("")}${Object.keys(by).length ? "" : `<div class="tb-r"><span>TVA</span><span class="num">${E2(0)}</span></div>`}<div class="ttc"><span>Total TTC</span><span class="num">${E2(ht + tva)}</span></div>${tp > 0 ? `<div class="tb-r" title="Information interne, non imprimée sur le document"><span>Temps de pose estimé</span><span class="num">${fmtNum(tp, 1)} h</span></div>` : ""}`;
  const real = ls.filter((l) => (l.designation || l.prix_unitaire_ht) && l.type_ligne !== "image" && l.nature !== "saut" && !(l.nature === "libre" && !(l.prix_unitaire_ht > 0)));
  const st = $("#edstat", root);
  if (st) { const n = real.length; st.innerHTML = n ? `<b>${n} prestation${n > 1 ? "s" : ""}</b> · HT ${E2(ht)} · <strong>TTC ${E2(ht + tva)}</strong>` : "Ajoutez au moins une prestation pour continuer."; }
  const em = $("#shempty", root); if (em) em.hidden = rows.length > 0;
  if (typeof shNav === "function") shNav(root);
  if (cxCurK === "devis") cxAfterRecalc(root, ls);
  root.dispatchEvent(new CustomEvent("sheet-changed"));
}
// Les colonnes categorie / description sont écrites après l'enregistrement (par position)
async function saveCats(K, id, ls) {
  const k = KD[K];
  const rows = await q(sb.from(k.lt).select("id").eq(k.fk, id).order("position"));
  const ext0 = (l) => (K === "facture" && db.v8 ? { nature: l.nature || "normale", ref_facture_id: l.ref_facture_id || null } : K === "devis" && db.v13 ? { ...cxExt(l), ...(db.v14 && typeof mkExt === "function" ? mkExt(l) : {}), ...(db.v24 ? { nature: l.nature || "normale" } : {}) } : K === "devis" && db.v24 ? { nature: l.nature || "normale" } : {});
  const ext = (l) => ({ ...ext0(l), ...(db.v25 ? { type_prestation: l.type_prestation || null } : {}) });
  await Promise.all(rows.map((r, i) => (ls[i] ? q(sb.from(k.lt).update({ categorie: ls[i].categorie || null, description: ls[i].description || null, ...ext(ls[i]) }).eq("id", r.id)) : null)));
}
async function copyCats(did, fid) {
  try {
    await docV24();
    let a = await q(sb.from("devis_lignes").select((db.v13 ? "categorie,description,type_ligne,est_option,option_choisie" : "categorie,description") + (db.v24 ? ",nature" : "") + (db.v25 ? ",type_prestation" : "")).eq("devis_id", did).order("position"));
    if (db.v13) a = a.filter((x) => x.type_ligne !== "image" && (!x.est_option || x.option_choisie));
    const b = await q(sb.from("factures_lignes").select("id").eq("facture_id", fid).order("position"));
    await Promise.all(b.map((r, i) => (a[i] ? q(sb.from("factures_lignes").update({ categorie: a[i].categorie, description: a[i].description, ...(db.v25 ? { type_prestation: a[i].type_prestation || null } : {}), ...(db.v24 && a[i].nature && a[i].nature !== "normale" ? { nature: a[i].nature } : {}) }).eq("id", r.id)) : null)));
  } catch (e) { console.warn("Catégories non copiées", e); }
}

// Migration v24 : description, dates de travaux, lignes « texte » et « saut de page »
async function docV24() {
  if (db.v24 !== undefined) return db.v24;
  try {
    const a = await sb.from("devis").select("description,debut_travaux,duree_estimee,fin_chantier").limit(1);
    const b = await sb.from("devis_lignes").select("nature").limit(1);
    db.v24 = !a.error && !b.error;
  } catch (e) { db.v24 = false; }
  return db.v24;
}
// Migration v25 : nom du document (titre) et type de ligne (fourniture, main d'œuvre, sous-traitance, matériel, divers)
async function docV25() {
  if (db.v25 !== undefined) return db.v25;
  try {
    const a = await sb.from("devis").select("titre").limit(1);
    const b = await sb.from("devis_lignes").select("type_prestation").limit(1);
    db.v25 = !a.error && !b.error;
  } catch (e) { db.v25 = false; }
  return db.v25;
}
async function docExtra(K, id) {
  if (!id) return {};
  const v25 = await docV25();
  if (!(await docV24())) { if (!v25) return {}; try { const r = await sb.from(KD[K].list).select("titre").eq("id", id).maybeSingle(); return r.data || {}; } catch (e) { return {}; } }
  try { const r = await sb.from(KD[K].list).select("description,debut_travaux,duree_estimee,fin_chantier" + (v25 ? ",titre" : "")).eq("id", id).maybeSingle(); return r.data || {}; } catch (e) { return {}; }
}
const docRealLine = (l) => l.type_ligne !== "image" && l.nature !== "saut" && !(l.nature === "libre" && !(Number(l.prix_unitaire_ht) > 0));

async function docForm(K, d, opts = {}) {
  if (!guard()) return;
  const k = KD[K], v24 = await docV24(), v25 = await docV25();
  cxCurK = K === "devis" && db.v13 ? "devis" : "";
  const lignes = d ? await lignesOf(K, d.id) : opts.lignes || [];
  const ex = d ? await docExtra(K, d.id) : {};
  let preClient = opts.client || d?.client_id || "";
  if (opts.chantier) preClient = byId(db.chantiers, opts.chantier)?.client_id || preClient;
  const chOpts = (cid) => [{ v: "", l: "Sans chantier" }, ...db.chantiers.filter((c) => !cid || c.client_id === cid).map((c) => ({ v: c.id, l: c.nom }))];
  const isD = K === "devis", noAvoir = K === "facture" && db.v8 && fxNat(d || {}) !== "Avoir";
  const canTxt = v24 || (K === "facture" && !!db.v8), canPb = v24;
  const num = d ? docNum(d, K) : "";
  const title = isD ? "Devis" : d && typeof fxLabel === "function" ? esc(fxLabel(d)) : "Facture";
  const inl = (name, type, val, extra = "") => `<input class="inl" type="${type}" id="f_${name}" name="${name}" value="${esc(val ?? "")}" ${extra}>`;
  const body = `<datalist id="unites">${UNITES.map((u) => `<option value="${u}">`).join("")}</datalist>
  <div class="sheet-wrap" id="shw"><div class="sheet-main">
    <div class="sheet-bar"><span><b>1.</b> Remplissez l'en-tête · <b>2.</b> Ajoutez vos lignes par section · <b>3.</b> Vérifiez à droite : tout se met à jour en direct.</span><button type="button" class="btn o sm" id="shprev" aria-pressed="false">Aperçu PDF en direct</button></div>
    <div class="sheet">
      <div class="sh-head">
        <div class="sh-meta">
          <h2 class="sh-title">${title} ${num && num !== "Brouillon" && num !== "-" ? "n° " + esc(num) : `<span class="sh-new">${d ? "(brouillon)" : "(nouveau)"}</span>`}</h2>
          ${v25 ? `<label class="sh-name"><span>Nom du ${isD ? "devis" : "document"}</span>${inl("titre", "text", ex.titre || "", `placeholder="${isD ? "ex : Rénovation salle de bain, M. Dupont" : "ex : Facture d'acompte, chantier Dupont"}" maxlength="120"`)}</label>` : ""}
          <div class="sh-l">En date du ${inl("date", "date", d?.[k.df] || today(), "required")}</div>
          ${isD ? `<div class="sh-l">Valable ${inl("validite_jours", "number", d?.validite_jours || 30, 'min="1" required')} jours, soit jusqu'au <b id="shuntil"></b></div>
            <div class="chips sh-chips" data-chips="validite_jours">${[15, 30, 60, 90].map((n) => `<button type="button" class="chip-b" data-set="validite_jours" data-val="${n}">${n} j</button>`).join("")}</div>`
            : `<div class="sh-l">À payer avant le ${inl("echeance", "date", d?.echeance || addDays(today(), Number(db.ent.delai_paiement_jours) || 30), "required")}</div>
            <div class="chips sh-chips" data-chips="echeance">${[[0, "À réception"], [30, "30 j"], [45, "45 j"], [60, "60 j"]].map(([n, l]) => `<button type="button" class="chip-b" data-days="${n}">${l}</button>`).join("")}</div>`}
          ${v24 ? `<div class="sh-l">Début des travaux le ${inl("debut_travaux", "date", ex.debut_travaux || "")}</div>
          <div class="sh-l">Durée estimée à ${inl("duree_estimee", "text", ex.duree_estimee || "", 'placeholder="définir (ex : 3 semaines)"')}</div>
          <div class="sh-l">Date limite de fin de chantier le ${inl("fin_chantier", "date", ex.fin_chantier || "")}</div>` : ""}
        </div>
        <div class="sh-who">${clientBlock(preClient)}
          ${fld({ k: "chantier_id", l: "Chantier (facultatif)", t: "select", o: chOpts(preClient || db.clients[0]?.id), v: opts.chantier || d?.chantier_id || "", r: 0 })}</div>
      </div>
      ${v24 ? `<div class="sh-desc"><button type="button" class="lk-add" id="shdescb"${ex.description ? " hidden" : ""}>⊕ Ajouter une description</button><textarea class="inl-ta" id="f_description" name="description" rows="2" placeholder="Description du projet ou des travaux (affichée avant le détail)"${ex.description ? "" : " hidden"}>${esc(ex.description || "")}</textarea></div>` : ""}
      <div class="qadd"><div class="qin">${svg(ic.search)}<input id="qaq" type="text" autocomplete="off" placeholder="${isD ? "Que faut-il chiffrer" : "Que faut-il facturer"} ? Tapez « carrelage », « cloison »… puis Entrée" aria-label="Ajouter une prestation"><button type="button" class="btn sm" id="qaok">Ajouter</button></div><div id="qasug" class="qsug" hidden></div></div>
      <div class="sh-th"><table class="lines lines-h">${LCOLS}<thead><tr><th>N°</th><th>Désignation</th><th class="r">Qté</th><th>Unité</th><th class="r">Prix U. HT</th><th>TVA</th><th class="r">Total HT</th><th></th></tr></thead></table></div>
      <div class="secnav" id="secnav" hidden></div>
      <div id="cats">${lignes.length ? groupCats(lignes).map(catBlock).join("") : ""}</div>
      <p class="sh-empty" id="shempty"${lignes.length ? " hidden" : ""}>Commencez par choisir un type de ligne ci-dessous (fourniture, main d'œuvre, sous-traitance, matériel, divers) :</p>
      <div class="sh-add">
        <div class="sh-add-l"><span class="sh-add-t">Ajouter dans la section active :</span>${["fourniture", "main_oeuvre", "sous_traitance", "materiel", "divers"].map((t) => `<button type="button" class="btn o sm t-${t}" data-addt="${t}">+ ${PREST[t]}</button>`).join("")}<button type="button" class="btn o sm" id="addov">+ Ouvrage</button>
          <details class="more sh-more"><summary class="btn o sm" aria-label="Plus d'éléments" title="Plus d'éléments">…</summary><div class="mm">${canTxt ? `<button type="button" class="mi" id="addlibre">Poste libre (remise, frais, déplacement…)</button>` : ""}${cxCurK === "devis" ? cxToolbar(K) : ""}</div></details></div>
        <div class="sh-add-r"><button type="button" class="btn o sm" id="addc">+ Nouvelle section</button>${canTxt ? `<button type="button" class="btn o sm" id="addtxt">Texte</button>` : ""}${canPb ? `<button type="button" class="btn o sm" id="addpb">Saut de page</button>` : ""}</div>
      </div>
      ${!v24 ? `<p class="sh-note">Pour ajouter des textes libres, des sauts de page, une description et les dates de travaux : exécutez migration_v24.sql dans Supabase.</p>` : ""}
      <div class="sh-foot">
        <div class="sh-foot-l">
          <h3>Conditions de paiement</h3>
          <div class="chips"><span class="edt-l">Ajouter une condition :</span>${(isD ? ["Acompte de 30 % à la signature du devis.", "Solde à la réception des travaux.", "Délai de démarrage à convenir avec le client."] : ["Règlement par virement bancaire.", "Solde à la réception des travaux.", "Aucun escompte pour paiement anticipé."]).map((t) => `<button type="button" class="chip-b" data-note="${esc(t)}">${esc(t.replace(/\.$/, ""))}</button>`).join("")}</div>
          <h3>Notes de bas de page</h3>
          ${fld({ k: "notes", l: "Texte affiché en bas du document", t: "textarea", v: d?.notes || opts.notes || "", r: 0, cls: "full" })}
        </div>
        <div class="sh-foot-r">
          ${noAvoir ? `<details class="edadv sh-adj"><summary>Définir un ajustement (retenue de garantie, acomptes, autoliquidation…)</summary><div class="frm">${fxAdjFields(d ? fdOf(d.id) : {})}</div></details>` : ""}
          <div class="totbox" id="totbox"></div>
        </div>
      </div>
    </div></div>
    <aside class="sheet-prev" id="shpv" hidden><div class="sp-h"><b>Aperçu du PDF</b><span id="shpvst" class="mut"></span></div><iframe id="shpvf" title="Aperçu du PDF"></iframe></aside>
  </div>`;
  modal(d ? `Modifier ${esc(docNum(d, K))}` : K === "devis" ? "Nouveau devis" : "Nouvelle facture", body, {
    xl: true, wide: true, submit: d ? "Enregistrer" : "Créer le brouillon", extra: `<span id="edstat" class="edstat"></span>`,
    onMount: (m) => {
      m.classList.add("sheetmd");
      bindClientBlock(m, (cid) => { const s = $("#f_chantier_id", m); s.innerHTML = chOpts(cid === "__new" ? "none" : cid).map((o) => `<option value="${esc(o.v)}">${esc(o.l)}</option>`).join(""); });
      m.addEventListener("input", (e) => { if (e.target.closest(".cat")) recalcLignes(m); });
      recalcLignes(m);
      if (typeof edEnhance === "function") edEnhance(m, K);
      if (typeof edSheet === "function") edSheet(m, K, d, { v24, canTxt, canPb });
      if (cxCurK === "devis") { cxEditorMount(m, K); if (opts.dictee) setTimeout(() => cxDictee(m), 80); }
    },
    onSubmit: async (v, api) => {
      const ls = readLignes(api.el).filter((l) => l.designation || l.prix_unitaire_ht || l.type_ligne === "image");
      if (!ls.some(docRealLine)) throw new Error("Ajoutez au moins une ligne avec une désignation et un prix.");
      const cid = await resolveClient(v);
      const adj = K === "facture" && db.v8 && $("#f_aj_ret", api.el) ? fxReadAdj(v) : null;
      if (adj?.autoliquidation) ls.forEach((l) => (l.taux_tva = 0));
      const payload = { id: d?.id || null, client_id: cid, chantier_id: v.chantier_id || null, date: v.date, notes: v.notes || null, lignes: ls,
        ...(K === "devis" ? { validite_jours: parseInt(v.validite_jours) || 30 } : { echeance: v.echeance }) };
      const id = await q(sb.rpc("sauver_document", { p_kind: K, p: payload }));
      if (K === "devis" && opts.parent && db.v14) { try { await q(sb.from("devis").update({ parent_id: opts.parent }).eq("id", id)); } catch (e) { console.warn(e); } }
      if (adj) await fxSaveDetails(id, adj);
      try { await saveCats(K, id, ls); } catch (e) { console.warn(e); toast("Document enregistré, mais les catégories et descriptions n'ont pas pu l'être : exécutez migration_v4.sql dans Supabase.", "dn"); }
      if (v25) { try { await q(sb.from(k.list).update({ titre: (v.titre || "").trim() || null }).eq("id", id)); } catch (e) { console.warn(e); } }
      if (v24) { try { await q(sb.from(k.list).update({ description: (v.description || "").trim() || null, debut_travaux: v.debut_travaux || null, duree_estimee: (v.duree_estimee || "").trim() || null, fin_chantier: v.fin_chantier || null }).eq("id", id)); } catch (e) { console.warn(e); toast("Document enregistré, mais la description et les dates de travaux n'ont pas pu l'être.", "dn"); } }
      api.close();
      toast(d ? "Modifications enregistrées." : `${k.label} créé en brouillon.`, "ok");
      await refresh();
      go(`${k.route}/${id}`);
    },
  });
}

/* ---------- PDF ---------- */
const _assets = new Map();
async function getAsset(path) {
  if (!path) return null;
  if (_assets.has(path)) return _assets.get(path);
  const { data, error } = await sb.storage.from("documents").download(path);
  if (error) throw new Error("Impossible de lire le fichier du modèle : " + error.message);
  const b = new Uint8Array(await data.arrayBuffer());
  _assets.set(path, b);
  return b;
}
async function pdfContext(K) {
  const e = db.ent, regl = e.pdf_reglages || {};
  const path = K === "devis" ? e.modele_devis_fichier : e.modele_facture_fichier;
  const ctx = { ent: e, regl };
  try {
    if (path) ctx.fond = { bytes: await getAsset(path) };
    else if (e.logo_path) ctx.logo = { bytes: await getAsset(e.logo_path) };
  } catch (err) { toast("Modèle importé illisible : le modèle classique est utilisé. " + esc(err.message), "dn"); }
  return ctx;
}
async function docPdfBytes(K, id) {
  const k = KD[K], d = byId(db[k.list], id);
  const lignes = await lignesOf(K, id);
  const ex = await docExtra(K, id);
  const c = clientOf(d.client_id) || {}, ch = d.chantier_id ? byId(db.chantiers, d.chantier_id) : null;
  const dv = K === "facture" && (fdOf(id)?.devis_id || d.devis_id) ? byId(db.devis, fdOf(id)?.devis_id || d.devis_id) : null;
  const data = {
    kind: K, numero: d.numero || (K === "facture" ? "(brouillon)" : ""), date: d[k.df], echeance: d.echeance, validite_jours: d.validite_jours,
    statut: d.statut, notes: d.notes, client: { nom: c.nom || d.client_nom, adresse: c.adresse, ville: c.ville, email: c.email, telephone: c.telephone },
    chantier: ch ? { nom: ch.nom, ville: ch.ville } : null, lignes, ht: d.montant_ht, tva: d.montant_tva, ttc: d.montant_ttc, taux_tva: d.taux_tva,
    paye: d.paye || 0, devis_numero: dv?.numero, titre: ex.titre || "", intro: ex.description || "", travaux: { debut: ex.debut_travaux, duree: ex.duree_estimee, fin: ex.fin_chantier },
    qr: K === "facture" && d.statut !== "Brouillon" && typeof rgEpcMatrix === "function" ? rgEpcMatrix(d) : null,
    fx: K === "facture" && typeof fxPdfData === "function" ? fxPdfData(d) : null,
    empreinte: K === "facture" && d.statut !== "Brouillon" && typeof cfEmpreinte === "function" ? await cfEmpreinte(d, lignes) : "",
    mentions: [...(typeof lgBuild === "function" ? lgBuild(K, d, c, ch, lignes) : []), ...(K === "facture" && fdOf(id)?.autoliquidation ? [{ text: AUTO_MENTION }] : [])],
    aides: K === "devis" && db.v14 && typeof aidesOf === "function" ? aidesOf(id).filter((a) => a.statut !== "Refusée") : [],
  };
  const pctx = await pdfContext(K);
  if (typeof cxPdfImages === "function") pctx.images = await cxPdfImages(lignes);
  return PilotPdf.build(data, pctx);
}
function openPdfModal(title, bytes, filename) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const api = modal(title, `<iframe class="pdfbox" src="${url}#toolbar=0" title="${esc(title)}"></iframe>
    <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap"><a class="btn o" href="${url}" target="_blank" rel="noopener">Ouvrir dans un onglet</a><button type="button" class="btn o" id="pp">Imprimer</button><a class="btn" href="${url}" download="${esc(filename)}">Télécharger le PDF</a></div>`,
    { xl: true, wide: true, submit: false, noFocus: true });
  $("#pp", api.el).onclick = () => { try { $("iframe", api.el).contentWindow.print(); } catch (e) { window.open(url); } };
  const close = api.close;
  api.close = () => { close(); setTimeout(() => URL.revokeObjectURL(url), 2000); };
  $$("[data-x]", api.el).forEach((b) => (b.onclick = api.close));
  return api;
}
async function docPdf(K, id) {
  const d = byId(db[KD[K].list], id);
  toast("Génération du PDF…");
  const bytes = await docPdfBytes(K, id);
  openPdfModal(`${KD[K].label} ${docNum(d, K)}`, bytes, `${slug(docNum(d, K) === "Brouillon" ? "facture-brouillon" : d.numero)}.pdf`);
}

/* ---------- Partage en ligne ---------- */
async function docShare(K, id) {
  if (!guard()) return;
  const k = KD[K], d = byId(db[k.list], id);
  if (K === "facture" && d.statut === "Brouillon") return toast("Émettez la facture avant de l'envoyer au client.", "dn");
  toast("Préparation du lien…");
  const bytes = await docPdfBytes(K, id);
  let p = partageOf(id);
  if (p && p.revoque_at) { await q(sb.from("partages").update({ revoque_at: null }).eq("token", p.token)); }
  if (typeof ribRecent === "function" && K === "facture" && ribRecent().length) toast("Rappel : vos coordonnées bancaires ont été modifiées récemment. Vérifiez que l'IBAN de cette facture est le bon.", "dn");
  if (!p) p = await q(sb.from("partages").insert({ type: K, doc_id: id }).select("token").single());
  const path = `${uid}/${p.token}.pdf`;
  const up = await sb.storage.from("partages").upload(path, new Blob([bytes], { type: "application/pdf" }), { upsert: true, contentType: "application/pdf" });
  if (up.error) throw up.error;
  await q(sb.from("partages").update({ pdf_path: path }).eq("token", p.token));
  if (K === "devis" && d.statut === "Brouillon") await q(sb.from("devis").update({ statut: "Envoyé" }).eq("id", id));
  await refresh();
  showShare(K, id, p.token);
}
function mailFor(K, d, link) {
  const c = clientOf(d.client_id) || {}, e = db.ent;
  if (db.v10 && typeof mlRender === "function") { const t = mlRender(K === "devis" ? "devis_envoi" : "facture_envoi", { d, c, lien: link }); return `mailto:${encodeURIComponent(c.email || "")}?subject=${encodeURIComponent(t.sujet)}&body=${encodeURIComponent(t.corps)}`; }
  const sujet = K === "devis" ? `Devis ${d.numero} - ${e.nom || ""}` : `Facture ${d.numero} - ${e.nom || ""}`;
  const corps = K === "devis"
    ? `Bonjour,\n\nVeuillez trouver votre devis ${d.numero} d'un montant de ${E2(d.montant_ttc)} TTC.\nVous pouvez le consulter, l'accepter ou le refuser en ligne : ${link}\n\nCordialement,\n${e.nom || ""}`
    : `Bonjour,\n\nVeuillez trouver votre facture ${d.numero} d'un montant de ${E2(d.montant_ttc)} TTC, à régler avant le ${D(d.echeance)}.\nVous pouvez la consulter et la télécharger ici : ${link}\n\nCordialement,\n${e.nom || ""}`;
  return `mailto:${encodeURIComponent(c.email || "")}?subject=${encodeURIComponent(sujet)}&body=${encodeURIComponent(corps)}`;
}
function showShare(K, id, token) {
  const k = KD[K], d = byId(db[k.list], id), link = shareLink(token), c = clientOf(d.client_id) || {};
  const api = modal(`${k.label} ${esc(d.numero)} : lien client`, `<div class="sharebox">
      <p style="margin:0" class="mut">${K === "devis" ? "Votre client ouvre ce lien sans créer de compte : il voit le devis en PDF et peut l'accepter ou le refuser. Vous êtes notifié dans Pilot." : "Votre client ouvre ce lien sans créer de compte : il voit la facture, la télécharge et trouve vos coordonnées bancaires."}</p>
      <div class="lnk-in"><input type="text" readonly value="${esc(link)}" id="shl"><button type="button" class="btn o" id="cpl">Copier le lien</button></div>
      ${c.email ? "" : `<p class="badge-warn" style="margin:0">Ce client n'a pas d'adresse email : ajoutez-la dans sa fiche pour préremplir le message.</p>`}
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap"><a class="btn o" href="${esc(link)}" target="_blank" rel="noopener">Voir la page client</a>${db.v10 ? btn(gmOn() ? "Envoyer avec Gmail" : "Écrire l'email", "mlSendDocAct", id, K + ":" + token) : `<a class="btn" href="${mailFor(K, d, link)}">Écrire l'email</a>`}</div>`, { submit: false, noFocus: true });
  $("#cpl", api.el).onclick = async () => { try { await navigator.clipboard.writeText(link); toast("Lien copié.", "ok"); } catch (e) { $("#shl", api.el).select(); } };
}
async function docRelance(K, id) {
  const k = KD[K], d = byId(db[k.list], id), c = clientOf(d.client_id) || {}, p = partageOf(id), e = db.ent;
  if (db.v10 && typeof mlCompose === "function") return mlCompose({ titre: `Relance ${esc(d.numero)}`, to: c.email || "", ...mlRender(K === "devis" ? "devis_relance" : "relance_1", { d, c, lien: p ? shareLink(p.token) : "" }), client_id: d.client_id, doc_type: K, doc_id: id, pdf: { nom: `${slug(d.numero)}.pdf`, bytes: () => docPdfBytes(K, id) } });
  if (!c.email) return toast("Ajoutez l'adresse email du client dans sa fiche pour préparer la relance.", "dn");
  const link = p ? shareLink(p.token) : "";
  const sujet = K === "devis" ? `Relance : devis ${d.numero}` : `Relance : facture ${d.numero}`;
  const corps = K === "devis"
    ? `Bonjour,\n\nJe me permets de revenir vers vous au sujet du devis ${d.numero} (${E2(d.montant_ttc)} TTC) envoyé le ${D(d.date_devis)}.\nAvez-vous eu le temps de le consulter ?${link ? "\nVous pouvez l'accepter en ligne : " + link : ""}\n\nCordialement,\n${e.nom || ""}`
    : `Bonjour,\n\nSauf erreur de notre part, la facture ${d.numero} d'un montant restant dû de ${E2(d.reste)} TTC, échue le ${D(d.echeance)}, n'a pas encore été réglée.\nMerci de procéder au règlement dans les meilleurs délais, ou de nous contacter si un paiement est déjà en cours.${link ? "\nFacture : " + link : ""}\n\nCordialement,\n${e.nom || ""}`;
  location.href = `mailto:${encodeURIComponent(c.email)}?subject=${encodeURIComponent(sujet)}&body=${encodeURIComponent(corps)}`;
}

/* ---------- Actions sur les documents ---------- */
const docActions = {
  docSortDevis: (v) => { (ST.docSort ||= {}).devis = v; render(true); },
  docSortFacture: (v) => { (ST.docSort ||= {}).facture = v; render(true); },
  devisNew: (id, arg) => docForm("devis", null, { client: arg?.startsWith("client:") ? arg.slice(7) : "", chantier: arg?.startsWith("chantier:") ? arg.slice(9) : "" }),
  factureNew: (id, arg) => docForm("facture", null, { client: arg?.startsWith("client:") ? arg.slice(7) : "", chantier: arg?.startsWith("chantier:") ? arg.slice(9) : "" }),
  devisEdit: (id) => docForm("devis", byId(db.devis, id)),
  factureEdit: (id) => docForm("facture", byId(db.factures, id)),
  devisDup: async (id) => { const d = byId(db.devis, id); const l = await lignesOf("devis", id); docForm("devis", null, { client: d.client_id, chantier: d.chantier_id, lignes: l }); },
  devisPdf: (id) => docPdf("devis", id),
  facturePdf: (id) => docPdf("facture", id),
  devisSend: (id) => docShare("devis", id),
  factureSend: (id) => docShare("facture", id),
  devisRelance: (id) => docRelance("devis", id),
  factureRelance: (id) => (db.v9 && typeof rlOpen === "function" ? rlOpen(id) : docRelance("facture", id)),
  devisStatut: async (id, s) => { await q(sb.from("devis").update({ statut: s }).eq("id", id)); toast(`Devis marqué « ${s.toLowerCase()} ».`, "ok"); await refresh(); },
  devisDel: async (id) => {
    if (!confirm("Supprimer ce brouillon de devis ?")) return;
    await q(sb.from("devis").delete().eq("id", id)); toast("Devis supprimé."); await refresh(); go("devis");
  },
  devisToFacture: async (id) => {
    const d = byId(db.devis, id);
    const fid = await q(sb.rpc("devis_vers_facture", { p_devis: id }));
    await copyCats(id, fid);
    await refresh();
    toast(`Facture créée en brouillon depuis ${esc(d.numero)}. Vérifiez-la puis émettez-la.`, "ok");
    go("factures/" + fid);
  },
  factureEmettre: async (id) => {
    if (!confirm("Émettre cette facture ?\n\nUn numéro définitif lui sera attribué (sans trou dans la numérotation) et elle ne pourra plus être modifiée ni supprimée.")) return;
    await q(sb.from("factures").update({ statut: "Envoyée" }).eq("id", id));
    await refresh();
    toast(`Facture ${esc(byId(db.factures, id).numero)} émise.`, "ok");
  },
  factureAnnuler: async (id) => {
    if (!confirm("Annuler cette facture ? Son numéro reste utilisé dans la numérotation.")) return;
    await q(sb.from("factures").update({ statut: "Annulée" }).eq("id", id)); await refresh();
  },
  factureDel: async (id) => {
    if (!confirm("Supprimer ce brouillon de facture ?")) return;
    await q(sb.from("factures").delete().eq("id", id)); toast("Facture supprimée."); await refresh(); go("factures");
  },
};

/* ---------- Échéancier : payer une facture en plusieurs fois ---------- */
const echOf = (fid) => db.echeances.filter((e) => e.facture_id === fid);
// Les paiements reçus remplissent les échéances dans l'ordre
function echStatut(f) {
  let rest = Number(f.paye) || 0;
  const t = today();
  return echOf(f.id).map((e) => {
    const part = Math.min(e.montant, Math.max(0, rest));
    rest = r2(rest - part);
    const reste = r2(e.montant - part);
    return { ...e, payeE: part, reste, etat: reste <= 0.005 ? "Payée" : part > 0 ? "Partiellement payée" : e.date_echeance < t ? "En retard" : "À venir" };
  });
}
const prochEch = (f) => echStatut(f).find((e) => e.reste > 0.005);
const payDefault = (f, a) => (a && Number(a) > 0 ? Math.min(Number(a), f.reste) : (prochEch(f)?.reste ?? f.reste));

function echCard(f) {
  const l = echStatut(f), ouvert = f.reste > 0.005 && f.statut !== "Brouillon";
  const act = ouvert ? btn(l.length ? "Modifier" : "Payer en plusieurs fois", "echForm", f.id, "", "o sm w") : "";
  if (!l.length) return ouvert ? card("Échéancier", `<p class="mut" style="margin:0;padding:16px 18px">Paiement en une fois. Pour un acompte ou des mensualités, utilisez « Payer en plusieurs fois » : chaque paiement reçu est suivi échéance par échéance.</p>`, act) : "";
  return card("Échéancier de paiement", l.map((e) => `<div class="row"><div><b>${E2(e.montant)}</b><small>${esc(e.libelle || "Échéance")} · ${D(e.date_echeance)}</small></div><span>${chip(e.etat)} ${e.reste > 0.005 && ouvert ? btn("Encaisser", "payNew", f.id, String(e.reste), "o sm w") : ""}</span></div>`).join("") +
    (ouvert ? `<div class="row"><button class="lk w" data-act="echDel" data-id="${f.id}">Supprimer l'échéancier</button></div>` : ""), act);
}

function echForm(fid) {
  if (!guard()) return;
  const f = byId(db.factures, fid), T = f.montant_ttc, ex = echOf(fid);
  const gen = (n, ac, d0, step) => {
    const out = [];
    let rest = T;
    if (ac > 0) { const a = r2((T * ac) / 100); out.push(a); rest = r2(T - a); }
    const nn = ac > 0 ? n - 1 : n, part = r2(rest / nn);
    for (let i = 0; i < nn; i++) out.push(i === nn - 1 ? r2(rest - part * (nn - 1)) : part);
    return out.map((m, i) => ({ libelle: ac > 0 ? (i === 0 ? "Acompte" : i === out.length - 1 ? "Solde" : `Échéance ${i}`) : `Échéance ${i + 1}`, montant: m, date_echeance: addDays(d0, i * step) }));
  };
  const draw = (m, list) => {
    $("#echl", m).innerHTML = list.map((e) => `<div class="echr"><input type="text" data-e="lib" value="${esc(e.libelle || "")}" aria-label="Libellé"><input type="date" data-e="d" value="${e.date_echeance}" aria-label="Date"><input type="text" inputmode="decimal" data-e="m" value="${String(e.montant).replace(".", ",")}" aria-label="Montant"></div>`).join("") + `<p class="mut" id="echs" style="margin:6px 0 0"></p>`;
    sumUp(m);
  };
  const read = (m) => $$(".echr", m).map((r) => ({ libelle: $('[data-e="lib"]', r).value.trim(), date_echeance: $('[data-e="d"]', r).value, montant: parseNum($('[data-e="m"]', r).value) }));
  const sumUp = (m) => { const s = r2(sum(read(m), (e) => e.montant)), ok = Math.abs(s - T) < 0.01; const el = $("#echs", m); el.className = ok ? "up" : "dn"; el.textContent = `Total des échéances : ${E2(s)} sur ${E2(T)} TTC${ok ? "" : ` (écart ${E2(r2(T - s))})`}`; };
  const body = `<div class="frm">${fld({ k: "n", l: "Nombre d'échéances", t: "select", o: [2, 3, 4, 5, 6, 8, 10, 12].map(String), v: String(ex.length || 3) })}
    ${fld({ k: "ac", l: "Acompte à la commande (%)", t: "number", v: ex.length ? "0" : "30", r: 0, hint: "0 = échéances égales" })}
    ${fld({ k: "d0", l: "Première échéance", t: "date", v: ex[0]?.date_echeance || today() })}
    ${fld({ k: "step", l: "Intervalle (jours)", t: "number", v: "30" })}<div class="full" id="echl"></div></div>`;
  modal("Payer en plusieurs fois · " + esc(f.numero), body, {
    wide: true, submit: "Enregistrer l'échéancier",
    onMount: (m) => {
      const regen = () => { const v = Object.fromEntries(new FormData(m.querySelector("form"))); draw(m, gen(Number(v.n) || 2, Math.min(95, parseNum(v.ac)), v.d0 || today(), parseInt(v.step) || 30)); };
      ["n", "ac", "d0", "step"].forEach((k) => ($("#f_" + k, m).onchange = regen));
      m.addEventListener("input", (e) => { if (e.target.closest(".echr")) sumUp(m); });
      if (ex.length) draw(m, ex); else regen();
    },
    onSubmit: async (v, api) => {
      const l = read(api.el);
      if (l.some((e) => !e.date_echeance || e.montant <= 0)) throw new Error("Chaque échéance doit avoir une date et un montant.");
      if (Math.abs(r2(sum(l, (e) => e.montant)) - T) >= 0.01) throw new Error(`Le total des échéances doit être égal au montant TTC (${E2(T)}).`);
      await q(sb.from("facture_echeances").delete().eq("facture_id", fid));
      await q(sb.from("facture_echeances").insert(l.map((e, i) => ({ facture_id: fid, position: i, libelle: e.libelle || null, date_echeance: e.date_echeance, montant: e.montant }))));
      api.close(); toast("Échéancier enregistré.", "ok"); await refresh();
    },
  });
}
Object.assign(docActions, {
  echForm: (id) => echForm(id),
  echDel: async (id) => { if (!guard() || !confirm("Supprimer l'échéancier ? Les paiements déjà reçus sont conservés.")) return; await q(sb.from("facture_echeances").delete().eq("facture_id", id)); await refresh(); },
});
