/* Mentions légales automatiques (devis et factures BTP).
   19 mentions : certaines sont des DONNÉES de l'entreprise à renseigner (contrôlées), d'autres des TEXTES ajoutés
   automatiquement au PDF quand la situation l'exige (client particulier, TVA réduite, franchise, autoliquidation…).
   Chaque mention peut être désactivée dans Paramètres. Ce sont les mentions usuelles : elles ne remplacent pas l'avis d'un juriste. */

const lgOpts = () => (db.ent && db.ent.mentions_options) || {};
const lgIsPro = (c) => !!c && (c.type === "Professionnel" || !!c.siret);
const lgFranchise = () => db.ent.tva_regime === "franchise";

// kind : "donnee" (champ de l'entreprise à renseigner), "texte" (paragraphe ajouté au PDF), "integre" (déjà géré par Pilot)
// scope : "tous" | "devis" | "facture"
const LG = [
  { id: "identite", n: 1, kind: "donnee", scope: "tous", t: "Dénomination et forme juridique", ref: "Art. L123-1 et R123-237 C. com.", ok: (e) => !!e.nom && !!e.forme_juridique, manque: "Renseignez le nom et la forme juridique (ex. « SARL », « EI »)." },
  { id: "capital", n: 2, kind: "donnee", scope: "tous", t: "Capital social", ref: "Art. R123-237 C. com.", ok: (e) => /capital|\bEI\b|entrepreneur individuel|micro|auto/i.test(e.forme_juridique || ""), manque: "Pour une société, ajoutez « au capital de … € » dans la forme juridique." },
  { id: "siret", n: 3, kind: "donnee", scope: "tous", t: "N° SIRET", ref: "Art. L441-9 C. com.", ok: (e) => String(e.siret || "").replace(/\D/g, "").length === 14, manque: "SIRET de 14 chiffres manquant." },
  { id: "rcs", n: 4, kind: "donnee", scope: "tous", t: "RCS ou Répertoire des métiers", ref: "Art. R123-237 C. com.", ok: (e) => !!e.rcs, manque: "Indiquez « RCS Ville 000 000 000 » ou « RM Ville »." },
  { id: "tva", n: 5, kind: "donnee", scope: "tous", t: "N° de TVA intracommunautaire", ref: "Art. 242 nonies A annexe II CGI", ok: (e) => lgFranchise() || !!e.tva_intracom, manque: "N° de TVA intracommunautaire manquant (sauf franchise en base)." },
  { id: "adresse", n: 6, kind: "donnee", scope: "tous", t: "Adresse du siège", ref: "Art. L441-9 C. com.", ok: (e) => !!e.adresse, manque: "Adresse du siège manquante." },
  { id: "contact", n: 7, kind: "donnee", scope: "tous", t: "Contact (téléphone ou email)", ref: "Art. L111-1 C. conso.", ok: (e) => !!(e.telephone || e.email), manque: "Ajoutez un téléphone ou un email." },
  { id: "decennale", n: 8, kind: "texte", scope: "tous", t: "Assurance décennale", ref: "Art. L243-2 C. assurances", defaut: true,
    ok: (e, o) => !!(o.assureur && o.police), manque: "Renseignez l'assureur et le n° de contrat de votre décennale.",
    when: (x) => !!(x.o.assureur && x.o.police),
    text: (x) => `Assurance de responsabilité décennale : ${x.o.assureur}${x.o.assureur_adresse ? ", " + x.o.assureur_adresse : ""}, contrat n° ${x.o.police}. Couverture géographique : ${x.o.couverture || "France métropolitaine"}.` },
  { id: "numero", n: 9, kind: "integre", scope: "facture", t: "N° de facture unique et chronologique", ref: "Art. 242 nonies A annexe II CGI", note: "Attribué automatiquement à l'émission, sans trou, et contrôlé dans l'onglet Conformité." },
  { id: "lieu", n: 10, kind: "texte", scope: "tous", t: "Date et lieu d'exécution des travaux", ref: "Art. 242 nonies A annexe II CGI", defaut: true,
    when: (x) => x.K === "facture" && !!(x.ch && (x.ch.adresse || x.ch.ville || x.ch.nom)),
    text: (x) => `Lieu d'exécution des travaux : ${[x.ch.nom, x.ch.adresse, x.ch.ville].filter(Boolean).join(", ")}. Date de réalisation de la prestation : ${x.dateFr}.` },
  { id: "categorie", n: 11, kind: "texte", scope: "facture", t: "Catégorie d'opération", ref: "Art. 242 nonies A annexe II CGI (e-facturation)", defaut: true,
    when: () => true, text: (x) => `Catégorie d'opération : ${x.e.categorie_operation || "prestation de services"}.` },
  { id: "debits", n: 12, kind: "texte", scope: "facture", t: "Option pour la TVA sur les débits", ref: "Art. 269 CGI", defaut: true,
    when: (x) => x.e.tva_sur_debits === "oui" || x.e.tva_sur_debits === true || x.e.tva_regime === "debits",
    text: () => "Option pour le paiement de la TVA d'après les débits." },
  { id: "franchise", n: 13, kind: "texte", scope: "tous", t: "Franchise en base de TVA", ref: "Art. 293 B CGI", defaut: true,
    when: () => lgFranchise(), text: () => "TVA non applicable, art. 293 B du CGI." },
  { id: "tvareduite", n: 14, kind: "texte", scope: "tous", t: "TVA à taux réduit (10 % ou 5,5 %) : attestation", ref: "Art. 279-0 bis et 278-0 bis A CGI", defaut: true,
    when: (x) => x.taux.some((t) => t === 10 || t === 5.5) && !lgIsPro(x.c),
    text: (x) => `Taux de TVA réduit (${x.taux.filter((t) => t === 10 || t === 5.5).map((t) => String(t).replace(".", ",") + " %").join(" et ")}) : le client atteste que les travaux concernent un local à usage d'habitation achevé depuis plus de deux ans et qu'ils ne constituent pas une opération de construction ou d'agrandissement. Il s'engage à régler la différence de TVA si ces conditions ne sont pas remplies.` },
  { id: "autoliq", n: 15, kind: "texte", scope: "tous", t: "Autoliquidation de la TVA (sous-traitance)", ref: "Art. 283-2 nonies CGI", defaut: false,
    when: (x) => !!x.o.autoliq_pro && lgIsPro(x.c), text: () => "Autoliquidation de la TVA : TVA due par le preneur, art. 283-2 nonies du CGI (travaux de sous-traitance dans le bâtiment)." },
  { id: "penalites", n: 16, kind: "integre", scope: "facture", t: "Pénalités de retard et indemnité de 40 €", ref: "Art. L441-10 C. com.", note: "Déjà inscrites dans « Conditions de règlement » de chaque facture." },
  { id: "mediateur", n: 17, kind: "texte", scope: "tous", t: "Médiateur de la consommation (clients particuliers)", ref: "Art. L612-1 et R616-1 C. conso.", defaut: true,
    ok: (e, o) => !!o.mediateur_nom, manque: "Renseignez votre médiateur (obligatoire pour vendre à des particuliers).",
    when: (x) => !lgIsPro(x.c) && !!x.o.mediateur_nom,
    text: (x) => `En cas de litige, le client particulier peut recourir gratuitement au médiateur de la consommation : ${x.o.mediateur_nom}${x.o.mediateur_adresse ? ", " + x.o.mediateur_adresse : ""}${x.o.mediateur_site ? " - " + x.o.mediateur_site : ""}.` },
  { id: "retractation", n: 18, kind: "texte", scope: "devis", t: "Droit de rétractation de 14 jours (contrat hors établissement)", ref: "Art. L221-18 C. conso.", defaut: true,
    when: (x) => !lgIsPro(x.c) && !!x.o.retractation,
    text: () => "Si le contrat est conclu à votre domicile ou hors de nos locaux, vous disposez d'un délai de rétractation de 14 jours à compter de la signature, sans avoir à motiver votre décision (art. L221-18 du Code de la consommation). Les travaux ne débuteront avant la fin de ce délai que sur votre demande expresse écrite." },
  { id: "garanties", n: 19, kind: "texte", scope: "devis", t: "Garanties légales de construction", ref: "Art. 1792 et suiv. C. civil", defaut: true,
    when: (x) => !!x.o.garanties,
    text: () => "Les travaux sont couverts par les garanties légales : garantie de parfait achèvement (1 an), garantie de bon fonctionnement des éléments d'équipement (2 ans) et garantie décennale (10 ans), à compter de la réception." },
];

// Mentions à imprimer sur un document
function lgBuild(K, d, c, ch, lignes) {
  const o = lgOpts(), off = o.off || {}, e = db.ent;
  const taux = [...new Set((lignes || []).filter((l) => l.taux_tva !== undefined && l.taux_tva !== null).map((l) => Number(l.taux_tva)))];
  if (!taux.length && d && d.taux_tva != null) taux.push(Number(d.taux_tva));
  const x = { K, d, c: c || {}, ch, e, o, taux, dateFr: new Date(d?.date_emission || d?.date_devis || Date.now()).toLocaleDateString("fr-FR") };
  return LG.filter((m) => m.kind === "texte" && (m.scope === "tous" || m.scope === K) && !off[m.id] && m.when(x))
    .map((m) => ({ id: m.id, label: m.t, text: m.text(x) }));
}

// Contrôle de l'entreprise : liste des mentions et de leur état
function lgControle() {
  const e = db.ent, o = lgOpts(), off = o.off || {};
  return LG.map((m) => {
    let etat = "ok", msg = "";
    if (m.kind === "integre") { etat = "ok"; msg = m.note; }
    else if (off[m.id]) { etat = "off"; msg = "Désactivée"; }
    else if (m.ok && !m.ok(e, o)) { etat = "ko"; msg = m.manque; }
    else if (m.kind === "texte") {
      const auto = m.id === "decennale" || m.id === "mediateur" ? "Ajoutée automatiquement" : m.id === "autoliq" && !o.autoliq_pro ? "Désactivée (option)" : "Ajoutée automatiquement quand elle s'applique";
      msg = auto;
      if (m.id === "autoliq" && !o.autoliq_pro) etat = "off";
    } else msg = "Renseignée";
    return { ...m, etat, msg };
  });
}
const lgManquants = () => lgControle().filter((m) => m.etat === "ko");

function lgCard() {
  const ctl = lgControle(), ko = ctl.filter((m) => m.etat === "ko").length;
  const chipE = (s) => (s === "ok" ? `<span class="chip ok">OK</span>` : s === "ko" ? `<span class="chip dn">À compléter</span>` : `<span class="chip n">Désactivée</span>`);
  return card("Mentions légales automatiques", `
    <p class="note" style="margin:0;padding:14px 18px 6px">Pilot ajoute seul au bas des devis et des factures les mentions qui s'appliquent (assurance décennale, TVA réduite, médiateur, rétractation…) et vérifie que votre identité est complète. ${ko ? `<b class="dn">${ko} point${ko > 1 ? "s" : ""} à compléter.</b>` : `<b>Tout est en ordre.</b>`}</p>
    ${tbl(["N°", "Mention", "Base légale", "État"], ctl.map((m) => ({ t: m.t, c: [String(m.n), `<b>${esc(m.t)}</b><small class="mut" style="display:block">${esc(m.msg || "")}</small>`, `<small class="mut">${esc(m.ref)}</small>`, chipE(m.etat)] })))}
    <div class="cb" style="border-top:1px solid var(--line2)">${btn("Configurer les mentions", "lgConfig", "", "", "o w")}</div>`);
}

function lgConfig() {
  if (!guard()) return;
  const o = lgOpts(), off = o.off || {};
  const f = (k, l, extra = {}) => fld({ k, l, v: o[k] ?? "", r: 0, ...extra });
  const checks = LG.filter((m) => m.kind === "texte").map((m) => `<label class="chk" style="display:flex;gap:8px;margin:4px 0"><input type="checkbox" name="m_${m.id}" ${off[m.id] || (m.id === "autoliq" && !o.autoliq_pro) ? "" : "checked"}> <span><b>${m.n}. ${esc(m.t)}</b><small class="mut" style="display:block">${esc(m.ref)}</small></span></label>`).join("");
  modal("Mentions légales", `
    <div class="frm">
      <div class="full"><b>Assurance décennale</b></div>
      ${f("assureur", "Assureur", { ph: "Nom de la compagnie" })}${f("police", "N° de contrat")}${f("assureur_adresse", "Adresse de l'assureur", { cls: "full" })}${f("couverture", "Couverture géographique", { ph: "France métropolitaine", cls: "full" })}
      <div class="full" style="margin-top:6px"><b>Médiateur de la consommation</b></div>
      ${f("mediateur_nom", "Nom du médiateur", { ph: "ex. CNPM - Médiation de la consommation" })}${f("mediateur_site", "Site internet")}${f("mediateur_adresse", "Adresse postale", { cls: "full" })}
      <div class="full" style="margin-top:6px"><b>Options</b></div>
      <label class="chk full" style="display:flex;gap:8px"><input type="checkbox" name="autoliq_pro" ${o.autoliq_pro ? "checked" : ""}> <span>Je travaille en sous-traitance : appliquer l'autoliquidation de TVA aux clients professionnels</span></label>
      <label class="chk full" style="display:flex;gap:8px"><input type="checkbox" name="retractation" ${o.retractation === false ? "" : "checked"}> <span>Ajouter le délai de rétractation de 14 jours sur les devis aux particuliers</span></label>
      <label class="chk full" style="display:flex;gap:8px"><input type="checkbox" name="garanties" ${o.garanties === false ? "" : "checked"}> <span>Ajouter le rappel des garanties légales sur les devis</span></label>
      <div class="full" style="margin-top:6px"><b>Mentions ajoutées automatiquement</b><small class="mut" style="display:block">Décochez une mention pour ne plus l'imprimer.</small>${checks}</div>
    </div>`, {
    wide: true,
    onSubmit: async (v, api) => {
      const offN = {};
      LG.filter((m) => m.kind === "texte").forEach((m) => { if (!("m_" + m.id in v)) offN[m.id] = true; });
      const next = { ...o, off: offN, assureur: v.assureur?.trim() || "", police: v.police?.trim() || "", assureur_adresse: v.assureur_adresse?.trim() || "", couverture: v.couverture?.trim() || "",
        mediateur_nom: v.mediateur_nom?.trim() || "", mediateur_site: v.mediateur_site?.trim() || "", mediateur_adresse: v.mediateur_adresse?.trim() || "",
        autoliq_pro: "autoliq_pro" in v, retractation: "retractation" in v, garanties: "garanties" in v };
      delete next.on;
      await entPatch({ mentions_options: next });
      api.close();
      toast("Mentions légales enregistrées.", "ok");
      await refresh();
    },
  });
}

const legalActions = { lgConfig };
