/* Facture électronique : fabrication du Factur-X (PDF + XML CII, profil EN 16931), contrôles, suivi, lecture des factures reçues.
   Pilot n'est pas une plateforme agréée (PA) : il prépare le fichier ; la transmission à l'administration et au client passe par la PA choisie. */

const EF_UNITS = { u: "C62", "m²": "MTK", ml: "MTR", "m³": "MTQ", h: "HUR", jour: "DAY", forfait: "C62", kg: "KGM", lot: "C62" };
const EF_STATUTS = ["Générée", "Transmise", "Acceptée", "Refusée", "Encaissée"];
const EF_CHIP = { Générée: "n", Transmise: "wn", Acceptée: "ok", Refusée: "dn", Encaissée: "ok" };
const EF_CATS = ["Prestation de services", "Livraison de biens", "Mixte (biens et services)"];
const efOf = (fid) => (db.efact || []).find((e) => e.facture_id === fid);
const efChip = (e) => (e ? `<span class="chip ${EF_CHIP[e.statut] || "n"}">${esc(e.statut)}</span>` : `<span class="chip n">Non générée</span>`);
const luhn = (s) => { let t = 0; [...String(s)].reverse().forEach((ch, i) => { let n = +ch; if (i % 2) { n *= 2; if (n > 9) n -= 9; } t += n; }); return t % 10 === 0; };
const siren = (siret) => String(siret || "").replace(/\s/g, "").slice(0, 9);
const xe = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
const n2 = (v) => Number(v).toFixed(2);
const nq = (v) => { const s = String(+Number(v).toFixed(4)); return s.includes(".") ? (s.split(".")[1].length < 2 ? Number(s).toFixed(2) : s) : Number(s).toFixed(2); };
const d102 = (iso) => String(iso || "").slice(0, 10).replace(/-/g, "");
const adrParts = (adresse, ville) => {
  let line = String(adresse || "").trim(), cp = "", city = "";
  const v = String(ville || "").trim();
  const m = (v || line).match(/(\d{5})\s+([^,\n]+?)\s*$/);
  if (m) { cp = m[1]; city = m[2]; if (!v) line = line.slice(0, m.index).replace(/[,\s]+$/, ""); }
  else city = v;
  return { line, cp, city };
};
const setupEF = () => setupV7("la facture électronique");

/* ---------- Données et contrôles ---------- */
async function efData(fid) {
  const f = byId(db.factures, fid);
  if (!f) throw new Error("Facture introuvable.");
  const lignes = await lignesOf("facture", fid);
  const c = { ...(clientOf(f.client_id) || {}), ...(db.cx[f.client_id] || {}) };
  const ch = f.chantier_id ? byId(db.chantiers, f.chantier_id) : null;
  const meta = (typeof fdOf === "function" && fdOf(fid)) || {};
  const refs = [];
  if (meta.nature === "Avoir" && meta.parent_id) { const p = byId(db.factures, meta.parent_id); if (p) refs.push({ numero: p.numero, date: p.date_emission }); }
  else [...new Set(lignes.filter((l) => l.nature === "deduction" && l.ref_facture_id).map((l) => l.ref_facture_id))].forEach((id) => { const p = byId(db.factures, id); if (p?.numero) refs.push({ numero: p.numero, date: p.date_emission }); });
  return { f, c, ch, ent: db.ent, lignes, meta, refs };
}
function efTotals(lignes, sign = 1) {
  const by = {};
  let ht = 0;
  lignes.forEach((l) => {
    const lt = r2(sign * Number(l.quantite) * Number(l.prix_unitaire_ht)), k = String(Number(l.taux_tva));
    by[k] ||= { basis: 0, tax: 0 };
    by[k].basis = r2(by[k].basis + lt);
    ht = r2(ht + lt);
  });
  let tva = 0;
  Object.keys(by).forEach((k) => { by[k].tax = r2((by[k].basis * Number(k)) / 100); tva = r2(tva + by[k].tax); });
  return { by, ht, tva, ttc: r2(ht + tva) };
}
async function efChecks(fid) {
  const { f, c, ent, lignes, meta, refs } = await efData(fid);
  const out = [];
  const add = (lv, t) => out.push({ lv, t });
  const siret = String(ent.siret || "").replace(/\s/g, "");
  if (!ent.nom) add("err", "Nom de l'entreprise manquant (Paramètres).");
  if (!/^\d{14}$/.test(siret)) add("err", "SIRET de l'entreprise manquant ou invalide : 14 chiffres attendus (Paramètres).");
  else if (!luhn(siret) && !siret.startsWith("356000000")) add("warn", "Le SIRET de l'entreprise ne passe pas le contrôle de clé : vérifiez-le.");
  else add("ok", "SIRET de l'entreprise valide.");
  if (!ent.adresse) add("err", "Adresse de l'entreprise manquante (Paramètres).");
  if (!ent.tva_intracom) add("warn", "N° de TVA intracommunautaire absent : la facture sera rattachée à votre SIREN. À renseigner si vous êtes assujetti à la TVA.");
  else add("ok", "N° de TVA intracommunautaire renseigné.");
  if (!ent.iban) add("warn", "IBAN absent : la facture ne contiendra pas de coordonnées de paiement.");
  if (!c.nom) add("err", "Nom du client manquant.");
  if (!c.adresse || !c.ville) add("warn", "Adresse du client incomplète : complétez sa fiche (adresse, code postal et ville).");
  if (c.type === "Professionnel") {
    const cs = String(c.siret || "").replace(/\s/g, "");
    if (!/^\d{9}(\d{5})?$/.test(cs)) add("warn", "SIRET du client manquant : la plateforme l'exige pour une facture entre entreprises (fiche client).");
    else add("ok", "SIRET du client renseigné.");
  } else add("warn", "Client particulier : une vente à un particulier relève de l'e-reporting, pas de la facture électronique. Vous pouvez générer le fichier si besoin.");
  if (f.statut === "Brouillon") add("err", "Émettez d'abord la facture : un brouillon n'a pas de numéro définitif.");
  if (!lignes.length) add("err", "La facture n'a aucune ligne détaillée (montant global) : ajoutez des lignes pour générer le fichier.");
  const t = efTotals(lignes);
  if (lignes.length && Math.abs(t.ttc - f.montant_ttc) > 0.02) add("warn", `Le total recalculé (${E2(t.ttc)}) diffère du total de la facture (${E2(f.montant_ttc)}) : arrondis de lignes.`);
  if (Object.keys(t.by).some((k) => ![0, 2.1, 5.5, 10, 20].includes(Number(k)))) add("warn", "Un taux de TVA inhabituel est utilisé sur une ligne.");
  if (Object.keys(t.by).some((k) => Number(k) === 0)) add("warn", "Une ligne est à 0 % de TVA : elle sera déclarée « exonérée ». Si c'est une autoliquidation (sous-traitance), faites valider ce point par votre plateforme.");
  if (!f.echeance) add("warn", "Date d'échéance absente.");
  if (meta.nature === "Avoir" && !refs.length) add("err", "L'avoir doit se rapporter à une facture émise (numéro de la facture d'origine).");
  if (meta.nature === "Avoir") add("ok", "Avoir : document de type 381, avec référence à la facture d'origine.");
  if (meta.nature === "Acompte") add("ok", "Facture d'acompte : document de type 386.");
  if (lignes.some((l) => l.nature === "deduction")) add("warn", "Cette facture déduit des factures précédentes par des lignes négatives. Certaines plateformes préfèrent le champ « montant déjà payé » : faites valider ce point par la vôtre.");
  const fcc = f.fx;
  if (fcc && (fcc.retenue || fcc.prime || fcc.prorata || fcc.escompte)) add("warn", "Retenue de garantie, prime, compte prorata ou escompte : ils figurent en note dans le fichier, et le montant à payer du fichier reste le TTC. Faites valider ce point par votre plateforme.");
  if (!ent.categorie_operation) add("warn", "Catégorie d'opération non choisie (prestation de services par défaut).");
  return out;
}

/* ---------- XML Factur-X (CII, profil EN 16931) ---------- */
function efXml({ f, c, ch, ent, lignes, meta = {}, refs = [] }) {
  const nat = meta.nature || "Facture", credit = nat === "Avoir", sg = credit ? -1 : 1;
  const typeCode = credit ? 381 : nat === "Acompte" ? 386 : 380;
  const t = efTotals(lignes, sg);
  const sa = adrParts(ent.adresse, ""), ba = adrParts(c.adresse, c.ville);
  const sSiren = siren(ent.siret), bSiren = siren(c.siret);
  const dl = Number(ent.delai_paiement_jours) || 30;
  const addr = (a) => `<ram:PostalTradeAddress>${a.cp ? `<ram:PostcodeCode>${xe(a.cp)}</ram:PostcodeCode>` : ""}${a.line ? `<ram:LineOne>${xe(a.line)}</ram:LineOne>` : ""}${a.city ? `<ram:CityName>${xe(a.city)}</ram:CityName>` : ""}<ram:CountryID>FR</ram:CountryID></ram:PostalTradeAddress>`;
  const cat = (rate) => (Number(rate) === 0 ? "E" : "S");
  const lineXml = lignes.map((l, i) => {
    // EN 16931 : le prix net d'une ligne n'est jamais négatif ; le signe passe par la quantité. Dans un avoir (381), les montants sont positifs.
    const pu0 = Number(l.prix_unitaire_ht), q0 = sg * Number(l.quantite), qty = pu0 < 0 ? -q0 : q0, pu = Math.abs(pu0);
    const lt = r2(qty * pu);
    return `<ram:IncludedSupplyChainTradeLineItem><ram:AssociatedDocumentLineDocument><ram:LineID>${i + 1}</ram:LineID></ram:AssociatedDocumentLineDocument>
<ram:SpecifiedTradeProduct><ram:Name>${xe(String(l.designation || "Prestation").slice(0, 200))}</ram:Name>${l.description ? `<ram:Description>${xe(l.description)}</ram:Description>` : ""}</ram:SpecifiedTradeProduct>
<ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>${nq(pu)}</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>
<ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="${EF_UNITS[l.unite] || "C62"}">${+Number(qty).toFixed(4)}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
<ram:SpecifiedLineTradeSettlement><ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>${cat(l.taux_tva)}</ram:CategoryCode><ram:RateApplicablePercent>${n2(l.taux_tva)}</ram:RateApplicablePercent></ram:ApplicableTradeTax>
<ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${n2(lt)}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation></ram:SpecifiedLineTradeSettlement></ram:IncludedSupplyChainTradeLineItem>`;
  }).join("\n");
  const taxXml = Object.keys(t.by).sort((a, b) => b - a).map((k) => `<ram:ApplicableTradeTax><ram:CalculatedAmount>${n2(t.by[k].tax)}</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode>${Number(k) === 0 ? `<ram:ExemptionReason>TVA non applicable</ram:ExemptionReason>` : ""}<ram:BasisAmount>${n2(t.by[k].basis)}</ram:BasisAmount><ram:CategoryCode>${cat(k)}</ram:CategoryCode><ram:RateApplicablePercent>${n2(k)}</ram:RateApplicablePercent></ram:ApplicableTradeTax>`).join("\n");
  const fc = f.fx || {};
  const nl = [];
  if (nat !== "Facture") nl.push([null, (typeof fxLabel === "function" ? fxLabel(f) : nat) + (credit && refs[0] ? ` sur la facture ${refs[0].numero}` : "")]);
  if (credit && meta.motif) nl.push([null, "Motif : " + meta.motif]);
  if (fc.retenue) nl.push([null, `Retenue de garantie ${nq(fc.retenuePct)} % : ${n2(fc.retenue)} EUR, libérable un an après la réception des travaux.`]);
  if (fc.prime) nl.push([null, `Prime ${fc.primeLib || "énergétique"} : ${n2(fc.prime)} EUR déduits du net à payer par le client.`]);
  if (fc.prorata) nl.push([null, `Compte prorata : ${n2(fc.prorata)} EUR retenus.`]);
  if (fc.retenue || fc.prime || fc.prorata) nl.push([null, `Net à payer par le client : ${n2(fc.net - (f.avoirs || 0))} EUR.`]);
  const notes = [
    ...nl,
    ["PMD", `En cas de retard de paiement, des pénalités égales à 3 fois le taux d'intérêt légal sont exigibles (art. L441-10 du Code de commerce).`],
    ["PMT", `Indemnité forfaitaire pour frais de recouvrement en cas de retard de paiement : 40 EUR (art. D441-5 du Code de commerce).`],
    ["AAB", fc.escompte ? `Escompte de ${nq(fc.escomptePct)} % pour règlement avant le ${D(fc.limite)}.` : `Pas d'escompte pour paiement anticipé.`],
  ].map(([code, txt]) => `<ram:IncludedNote><ram:Content>${xe(txt)}</ram:Content>${code ? `<ram:SubjectCode>${code}</ram:SubjectCode>` : ""}</ram:IncludedNote>`).join("\n");
  const catOp = ent.categorie_operation ? `<ram:IncludedNote><ram:Content>${xe("Catégorie d'opération : " + ent.categorie_operation + (ent.tva_sur_debits ? " - TVA sur les débits" : ""))}</ram:Content></ram:IncludedNote>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
<rsm:ExchangedDocumentContext><ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter></rsm:ExchangedDocumentContext>
<rsm:ExchangedDocument><ram:ID>${xe(f.numero)}</ram:ID><ram:TypeCode>${typeCode}</ram:TypeCode><ram:IssueDateTime><udt:DateTimeString format="102">${d102(f.date_emission)}</udt:DateTimeString></ram:IssueDateTime>
${notes}
${catOp}</rsm:ExchangedDocument>
<rsm:SupplyChainTradeTransaction>
${lineXml}
<ram:ApplicableHeaderTradeAgreement>
<ram:SellerTradeParty><ram:Name>${xe(ent.nom)}</ram:Name>${sSiren ? `<ram:SpecifiedLegalOrganization><ram:ID schemeID="0002">${xe(sSiren)}</ram:ID></ram:SpecifiedLegalOrganization>` : ""}${addr(sa)}<ram:SpecifiedTaxRegistration><ram:ID schemeID="${ent.tva_intracom ? "VA" : "FC"}">${xe(ent.tva_intracom ? String(ent.tva_intracom).replace(/\s/g, "") : sSiren)}</ram:ID></ram:SpecifiedTaxRegistration></ram:SellerTradeParty>
<ram:BuyerTradeParty><ram:Name>${xe(c.nom)}</ram:Name>${bSiren.length === 9 ? `<ram:SpecifiedLegalOrganization><ram:ID schemeID="0002">${xe(bSiren)}</ram:ID></ram:SpecifiedLegalOrganization>` : ""}${addr(ba)}${c.tva_intracom ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${xe(String(c.tva_intracom).replace(/\s/g, ""))}</ram:ID></ram:SpecifiedTaxRegistration>` : ""}</ram:BuyerTradeParty>
${ch ? `<ram:SpecifiedProcuringProject><ram:ID>${xe(ch.id)}</ram:ID><ram:Name>${xe(ch.nom)}</ram:Name></ram:SpecifiedProcuringProject>` : ""}
</ram:ApplicableHeaderTradeAgreement>
<ram:ApplicableHeaderTradeDelivery/>
<ram:ApplicableHeaderTradeSettlement><ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
${ent.iban ? `<ram:SpecifiedTradeSettlementPaymentMeans><ram:TypeCode>58</ram:TypeCode><ram:PayeePartyCreditorFinancialAccount><ram:IBANID>${xe(String(ent.iban).replace(/\s/g, ""))}</ram:IBANID></ram:PayeePartyCreditorFinancialAccount>${ent.bic ? `<ram:PayeeSpecifiedCreditorFinancialInstitution><ram:BICID>${xe(String(ent.bic).replace(/\s/g, ""))}</ram:BICID></ram:PayeeSpecifiedCreditorFinancialInstitution>` : ""}</ram:SpecifiedTradeSettlementPaymentMeans>` : ""}
${taxXml}
<ram:SpecifiedTradePaymentTerms><ram:Description>${xe(`Paiement à ${dl} jours`)}</ram:Description>${f.echeance ? `<ram:DueDateDateTime><udt:DateTimeString format="102">${d102(f.echeance)}</udt:DateTimeString></ram:DueDateDateTime>` : ""}</ram:SpecifiedTradePaymentTerms>
<ram:SpecifiedTradeSettlementHeaderMonetarySummation><ram:LineTotalAmount>${n2(t.ht)}</ram:LineTotalAmount><ram:TaxBasisTotalAmount>${n2(t.ht)}</ram:TaxBasisTotalAmount><ram:TaxTotalAmount currencyID="EUR">${n2(t.tva)}</ram:TaxTotalAmount><ram:GrandTotalAmount>${n2(t.ttc)}</ram:GrandTotalAmount><ram:DuePayableAmount>${n2(t.ttc)}</ram:DuePayableAmount></ram:SpecifiedTradeSettlementHeaderMonetarySummation>
${refs.map((r) => `<ram:InvoiceReferencedDocument><ram:IssuerAssignedID>${xe(r.numero)}</ram:IssuerAssignedID>${r.date ? `<ram:FormattedIssueDateTime><qdt:DateTimeString format="102">${d102(r.date)}</qdt:DateTimeString></ram:FormattedIssueDateTime>` : ""}</ram:InvoiceReferencedDocument>`).join("\n")}
</ram:ApplicableHeaderTradeSettlement>
</rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`.replace(/\n{2,}/g, "\n");
}
const efXmp = (f) => `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title><rdf:Alt><rdf:li xml:lang="x-default">Facture ${xe(f.numero)}</rdf:li></rdf:Alt></dc:title></rdf:Description>
<rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/"><pdf:Producer>Pilot</pdf:Producer></rdf:Description>
<rdf:Description rdf:about="" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#"><fx:DocumentType>INVOICE</fx:DocumentType><fx:DocumentFileName>factur-x.xml</fx:DocumentFileName><fx:Version>1.0</fx:Version><fx:ConformanceLevel>EN 16931</fx:ConformanceLevel></rdf:Description>
</rdf:RDF></x:xmpmeta>
<?xpacket end="w"?>`;

// PDF de la facture + XML embarqué = Factur-X
async function efBuild(fid) {
  const dd = await efData(fid);
  const xml = efXml(dd);
  const base = await docPdfBytes("facture", fid);
  await loadScript(LIBS.pdflib);
  const { PDFDocument, PDFName } = PDFLib;
  const pdf = await PDFDocument.load(base);
  if (typeof pdf.attach !== "function") throw new Error("La version de pdf-lib installée ne sait pas joindre de fichier : mettez à jour vendor/pdf-lib.min.js (1.17 ou plus).");
  await pdf.attach(new TextEncoder().encode(xml), "factur-x.xml", {
    mimeType: "text/xml", description: "Facture électronique Factur-X (EN 16931)", creationDate: new Date(), modificationDate: new Date(),
    ...(PDFLib.AFRelationship ? { afRelationship: PDFLib.AFRelationship.Data } : {}),
  });
  pdf.catalog.set(PDFName.of("Metadata"), pdf.context.register(pdf.context.stream(new TextEncoder().encode(efXmp(dd.f)), { Type: "Metadata", Subtype: "XML" })));
  pdf.setProducer("Pilot");
  const bytes = await pdf.save();
  return { bytes, xml, hash: await sha256Hex(bytes), dd };
}

/* ---------- Génération, archivage, statut ---------- */
async function efGenerate(fid) {
  if (!guard()) return;
  const checks = await efChecks(fid);
  const errs = checks.filter((x) => x.lv === "err");
  if (errs.length) throw new Error(errs[0].t);
  const old = efOf(fid);
  if (old && !["Générée", "Refusée"].includes(old.statut) && !confirm(`Cette facture est déjà « ${old.statut.toLowerCase()} ». Générer un nouveau fichier ne l'enverra pas de nouveau.\n\nContinuer ?`)) return;
  toast("Fabrication du fichier Factur-X…");
  const { bytes, xml, hash, dd } = await efBuild(fid);
  const base = `${uid}/efacture/${Date.now()}-${slug(dd.f.numero)}`;
  const pdfPath = base + "-facturx.pdf", xmlPath = base + "-facturx.xml";
  const u1 = await sb.storage.from("documents").upload(pdfPath, new Blob([bytes], { type: "application/pdf" }), { contentType: "application/pdf" });
  if (u1.error) throw new Error("Envoi impossible : " + u1.error.message);
  const u2 = await sb.storage.from("documents").upload(xmlPath, new Blob([xml], { type: "text/xml" }), { contentType: "text/xml" });
  if (u2.error) { sb.storage.from("documents").remove([pdfPath]); throw new Error("Envoi impossible : " + u2.error.message); }
  try {
    await q(sb.from("factures_electroniques").upsert({ facture_id: fid, profil: "EN 16931", statut: "Générée", categorie_operation: dd.ent.categorie_operation || "Prestation de services",
      hash, chemin_pdf: pdfPath, chemin_xml: xmlPath, erreur: null, transmis_at: null }, { onConflict: "facture_id" }));
    if (db.v6) {
      if (old?.chemin_pdf) await sb.from("documents").delete().eq("chemin", old.chemin_pdf);
      await q(sb.from("documents").insert({ nom: `${dd.f.numero} (Factur-X).pdf`, categorie: "Factures", client_id: dd.f.client_id, chantier_id: dd.f.chantier_id || null, chemin: pdfPath,
        mime: "application/pdf", taille: bytes.length, notes: "Facture électronique Factur-X (PDF avec XML EN 16931)" }));
    }
  } catch (e) { sb.storage.from("documents").remove([pdfPath, xmlPath]); throw e; }
  if (old) sb.storage.from("documents").remove([old.chemin_pdf, old.chemin_xml].filter(Boolean));
  toast(`Facture électronique ${esc(dd.f.numero)} générée et rangée dans Documents.`, "ok");
  await refresh();
}
async function efDownload(path, name) {
  const { data, error } = await sb.storage.from("documents").download(path);
  if (error) throw new Error("Fichier introuvable : " + error.message);
  downloadBlob(name, data);
}
const efReopen = (fid) => { $$(".md").forEach((m) => m.dataset.ef && m.remove()); return efOpen(fid); };

async function efOpen(fid) {
  if (!db.v7) return toast("Exécutez d'abord migration_v7.sql dans Supabase pour activer la facture électronique.", "dn");
  const f = byId(db.factures, fid);
  if (!f) return;
  const checks = await efChecks(fid), e = efOf(fid), blocked = checks.some((x) => x.lv === "err");
  const ICON = { ok: ["ok", "✓"], warn: ["wn", "!"], err: ["dn", "✕"] };
  const list = checks.map((x) => `<div class="row" style="padding:8px 0;border:0;align-items:flex-start;justify-content:flex-start;gap:10px"><span class="chip ${ICON[x.lv][0]}" style="min-width:24px;text-align:center">${ICON[x.lv][1]}</span><span>${esc(x.t)}</span></div>`).join("");
  const stat = e ? `<div class="sect-t">Suivi</div><dl class="kv" style="padding:0"><dt>Statut</dt><dd>${efChip(e)}</dd><dt>Plateforme</dt><dd>${esc(e.plateforme || db.ent.pa_nom || "-")}${e.reference_pa ? " · réf. " + esc(e.reference_pa) : ""}</dd><dt>Généré le</dt><dd>${esc(new Date(e.created_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }))}</dd><dt>Empreinte</dt><dd><code>${esc((e.hash || "").slice(0, 16))}…</code></dd></dl>
    <div class="frm" style="margin-top:12px"><label class="fl"><span>Statut</span><select id="ef_st">${EF_STATUTS.map((s) => `<option${s === e.statut ? " selected" : ""}>${s}</option>`).join("")}</select></label>
    <label class="fl"><span>Plateforme agréée</span><input type="text" id="ef_pa" value="${esc(e.plateforme || db.ent.pa_nom || "")}" placeholder="Nom de votre plateforme"></label>
    <label class="fl full"><span>Référence donnée par la plateforme</span><input type="text" id="ef_ref" value="${esc(e.reference_pa || "")}"></label></div>
    <div style="margin-top:10px">${btn("Enregistrer le suivi", "efStatut", fid, "", "o sm w")}</div>` : "";
  const dl = e ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">${btn("Télécharger le Factur-X (PDF)", "efDl", fid, "pdf", "o")}${btn("Télécharger le XML", "efDl", fid, "xml", "o")}${btn("Transmettre par l'API de ma plateforme", "efSend", fid, "", "o w")}</div>` : "";
  const api = modal(`Facture électronique · ${esc(f.numero || "")}`, `<p class="mut" style="margin:0">Pilot fabrique un fichier <b>Factur-X</b> : votre facture en PDF avec les données lisibles par machine (XML, profil EN 16931) à l'intérieur. Vous le déposez ensuite sur votre plateforme agréée, ou vous le transmettez par son API.</p>
    <div class="sect-t" style="margin-top:6px">Contrôles avant génération</div>${list}
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">${btn(e ? "Régénérer le fichier" : "Générer la facture électronique", "efGen", fid, "", blocked ? "w" : "w")}${blocked ? btn("Compléter mes paramètres", "efSettings", "", "", "o w") : ""}</div>
    ${dl}${stat}
    <p class="note" style="margin:14px 0 0;border:1px solid var(--line2);border-radius:6px">Le fichier n'est pas certifié PDF/A-3 : faites-le valider par votre plateforme (la plupart acceptent le XML seul ou ce format) avant votre première transmission réelle.</p>`, { wide: true, submit: false, noFocus: true });
  api.el.dataset.ef = fid;
}

/* ---------- Page « Facture électronique » ---------- */
V.efacture = () => {
  if (!db.v7) return page("Facture électronique", "Préparer les factures au format Factur-X et suivre leur transmission.", "", card("", setupEF()));
  const tab = ST.tab.efacture || "gen", em = emises();
  const withE = em.map((f) => ({ f, e: efOf(f.id) }));
  const rowsAll = { gen: withE.filter((x) => !x.e), fait: withE.filter((x) => x.e && x.e.statut === "Générée"), trans: withE.filter((x) => x.e && x.e.statut !== "Générée"), tous: withE }[tab] || withE;
  const rows = rowsAll.map(({ f, e }) => ({ act: "efOpen", id: f.id, t: `${f.numero} ${f.client_nom}`,
    c: [`<strong>${esc(f.numero)}</strong>`, `${esc(f.client_nom)}<small>${esc(clientOf(f.client_id)?.type || "")}</small>`, D(f.date_emission), `<span class="num">${E2(f.montant_ttc)}</span>`, efChip(e),
      `<span class="r">${btn(e ? "Ouvrir" : "Générer", "efOpen", f.id, "", e ? "o sm" : "sm w")}</span>`] }));
  const ent = db.ent, siretOk = /^\d{14}$/.test(String(ent.siret || "").replace(/\s/g, ""));
  const reg = card("Réglages", `<dl class="kv"><dt>SIRET</dt><dd>${siretOk ? esc(ent.siret) : `<span class="chip dn">À renseigner</span>`}</dd><dt>TVA intracom.</dt><dd>${ent.tva_intracom ? esc(ent.tva_intracom) : `<span class="chip wn">Non renseignée</span>`}</dd>
    <dt>Plateforme agréée</dt><dd>${ent.pa_nom ? esc(ent.pa_nom) : `<span class="chip wn">Non choisie</span>`}</dd><dt>Catégorie d'opération</dt><dd>${esc(ent.categorie_operation || "Prestation de services")}</dd><dt>TVA sur les débits</dt><dd>${ent.tva_sur_debits ? "Oui" : "Non"}</dd></dl>`, btn("Modifier", "efSettings", "", "", "o sm w"));
  const recep = card("Factures reçues", `<p class="mut" style="margin:0;padding:16px 18px">Vos fournisseurs vous envoient de plus en plus de factures électroniques (Factur-X ou XML). Pilot lit le fichier et pré-remplit la dépense avec les montants exacts, sans ressaisie.</p>`, btn("Lire une facture électronique reçue", "efReceive", "", "", "o sm w"));
  return page("Facture électronique", "Préparer vos factures au format Factur-X, suivre leur transmission, lire celles de vos fournisseurs.", "",
    `<div class="fin-alert i"><b>Réforme de la facturation électronique</b><span>Réception obligatoire pour toutes les entreprises depuis le 1er septembre 2026 ; émission obligatoire pour les PME et micro-entreprises à partir du 1er septembre 2027. L'envoi passe par une plateforme agréée : Pilot prépare le fichier, la plateforme le transmet. Vérifiez les dates et votre situation sur impots.gouv.fr.</span></div>` +
    strip([
      ["Factures émises", em.length, "au total"],
      ["À générer", withE.filter((x) => !x.e).length, "sans fichier Factur-X", withE.some((x) => !x.e) ? "" : "up"],
      ["Générées", withE.filter((x) => x.e && x.e.statut === "Générée").length, "à déposer sur la plateforme"],
      ["Transmises", withE.filter((x) => x.e && x.e.statut !== "Générée").length, "suivies dans Pilot"],
    ]) +
    `<div class="g2"><div>${tabs("efacture", [["gen", "À générer"], ["fait", "Générées"], ["trans", "Transmises"], ["tous", "Toutes"]], tab)}${searchBar("Rechercher une facture ou un client…", `${rows.length} facture${rows.length > 1 ? "s" : ""}`)}${card("", tbl(["Facture", "Client", "Émission", { h: "TTC", r: 1 }, "Statut", ""], rows, "Aucune facture dans cet onglet."))}</div><div>${reg}${recep}</div></div>`);
};

function efSettings() {
  if (!guard()) return;
  const e = db.ent, f = (k, l, o = {}) => fld({ k, l, v: e[k] ?? "", r: 0, ...o });
  modal("Réglages de la facture électronique", `<div class="frm">${f("siret", "SIRET (14 chiffres)")}${f("tva_intracom", "N° de TVA intracommunautaire", { ph: "FR12345678901" })}${f("adresse", "Adresse de l'entreprise", { cls: "full", hint: "Avec le code postal et la ville : 12 rue des Lilas, 37000 Tours." })}
    ${f("pa_nom", "Plateforme agréée choisie", { cls: "full", ph: "Nom de la plateforme", hint: "La liste officielle est sur impots.gouv.fr." })}
    ${fld({ k: "categorie_operation", l: "Catégorie d'opération", t: "select", o: EF_CATS, v: e.categorie_operation || EF_CATS[0] })}
    ${fld({ k: "tva_sur_debits", l: "TVA sur les débits", t: "select", o: [{ v: "non", l: "Non (sur les encaissements)" }, { v: "oui", l: "Oui" }], v: e.tva_sur_debits ? "oui" : "non" })}</div>`, {
    wide: true,
    onSubmit: async (v, api) => {
      const s = String(v.siret || "").replace(/\s/g, "");
      if (s && !/^\d{14}$/.test(s)) throw new Error("Le SIRET doit comporter 14 chiffres.");
      await entPatch({ siret: s || null, tva_intracom: v.tva_intracom?.trim() || null, adresse: v.adresse?.trim() || null, pa_nom: v.pa_nom?.trim() || null, categorie_operation: v.categorie_operation, tva_sur_debits: v.tva_sur_debits === "oui" });
      api.close(); toast("Réglages enregistrés.", "ok"); await refresh();
    },
  });
}

/* ---------- Lecture d'une facture électronique reçue ---------- */
async function efXmlFromPdf(file) {
  const pdfjs = await import(/* @vite-ignore */ LIBS.pdfjs);
  pdfjs.GlobalWorkerOptions.workerSrc = LIBS.pdfjsWorker;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const att = await doc.getAttachments();
  const list = Object.values(att || {}).filter((a) => /\.xml$/i.test(a.filename || ""));
  const pick = list.find((a) => /factur|zugferd|xrechnung|cii/i.test(a.filename)) || list[0];
  return pick ? new TextDecoder().decode(pick.content) : null;
}
function efParseXml(xml) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) return null;
  const root = doc.documentElement;
  if (!root || root.localName !== "CrossIndustryInvoice") return null;
  const kids = (n, name) => [...n.children].filter((c) => c.localName === name);
  const at = (n, path) => path.split("/").reduce((cur, nm) => (cur ? kids(cur, nm)[0] : null), n);
  const tx = (n, path) => at(n, path)?.textContent?.trim() || "";
  const dt = (s) => (/^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : "");
  const trade = at(root, "SupplyChainTradeTransaction"), agr = at(trade, "ApplicableHeaderTradeAgreement"), set = at(trade, "ApplicableHeaderTradeSettlement");
  const sum_ = at(set, "SpecifiedTradeSettlementHeaderMonetarySummation");
  const ht = parseFloat(tx(sum_, "TaxBasisTotalAmount")), ttc = parseFloat(tx(sum_, "GrandTotalAmount")), tva = parseFloat(tx(sum_, "TaxTotalAmount"));
  return {
    fournisseur: tx(agr, "SellerTradeParty/Name"), siren: tx(agr, "SellerTradeParty/SpecifiedLegalOrganization/ID"), reference: tx(root, "ExchangedDocument/ID"),
    date: dt(tx(root, "ExchangedDocument/IssueDateTime/DateTimeString")), echeance: dt(tx(set, "SpecifiedTradePaymentTerms/DueDateDateTime/DateTimeString")),
    ht: isFinite(ht) ? ht : null, tva: isFinite(tva) ? tva : isFinite(ttc) && isFinite(ht) ? r2(ttc - ht) : null, ttc: isFinite(ttc) ? ttc : null,
    avoir: tx(root, "ExchangedDocument/TypeCode") === "381",
  };
}
async function efReadIncoming(file) {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  let xml = null;
  if (sniff(head) === "pdf") xml = await efXmlFromPdf(file);
  else if (/\.xml$/i.test(file.name) || /xml/.test(file.type)) xml = await file.text();
  return xml ? efParseXml(xml) : null;
}
async function efIncomingToForm(file, ei, api) {
  if (api) api.close();
  let t = null;
  if (/\.pdf$/i.test(file.name)) { try { t = await PilotPdf.extractSupplier(file); } catch (e) {} }
  depForm(null, { file, badge: `<div class="full"><span class="badge-auto">Facture électronique lue (Factur-X) : montants exacts, vérifiez avant d'enregistrer${ei.avoir ? ". Attention : c'est un avoir" : ""}</span></div>`,
    prefill: { fournisseur: ei.fournisseur, reference: ei.reference, date_depense: ei.date || today(), echeance: ei.echeance, categorie: t?.categorie || "Autre", type: t?.type || "Dépense", montant_ht: ei.ht ?? "", montant_tva: ei.tva ?? "" } });
}
function efReceive() {
  if (!guard()) return;
  pickFile(".pdf,.xml,application/xml,text/xml", async (f) => {
    const ei = await efReadIncoming(f).catch(() => null);
    if (!ei) return toast("Ce fichier ne contient pas de facture électronique lisible (Factur-X ou XML CII). Pour un PDF classique, utilisez « Importer une facture fournisseur ».", "dn");
    await efIncomingToForm(f, ei, null);
  });
}

const efActions = {
  efOpen: (id) => efOpen(id),
  efGen: async (id) => { await efGenerate(id); await efReopen(id); },
  efDl: async (id, arg) => { const e = efOf(id), f = byId(db.factures, id); if (e) await efDownload(arg === "xml" ? e.chemin_xml : e.chemin_pdf, `${slug(f.numero)}-facturx.${arg === "xml" ? "xml" : "pdf"}`); },
  efStatut: async (id, arg, el) => {
    if (!guard()) return;
    const m = el.closest(".md"), e = efOf(id);
    if (!m || !e) return;
    const st = $("#ef_st", m).value;
    await q(sb.from("factures_electroniques").update({ statut: st, plateforme: $("#ef_pa", m).value.trim() || null, reference_pa: $("#ef_ref", m).value.trim() || null,
      transmis_at: st !== "Générée" ? e.transmis_at || new Date().toISOString() : null }).eq("id", e.id));
    toast("Suivi enregistré.", "ok");
    await refresh();
    await efReopen(id);
  },
  efSend: async (id) => {
    if (!guard()) return;
    toast("Envoi à la plateforme…");
    const { data, error } = await sb.functions.invoke("efacture-envoyer", { body: { facture_id: id } });
    if (error) throw new Error("Transmission impossible : " + (error.message || "fonction « efacture-envoyer » non installée. Voir supabase/functions/README.md"));
    toast(data?.message || "Facture transmise.", "ok");
    await refresh();
    await efReopen(id);
  },
  efSettings: () => efSettings(),
  efReceive: () => efReceive(),
};
