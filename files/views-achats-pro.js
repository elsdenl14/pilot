/* Page « Achats » : vue d'ensemble, bons de commande, commandes, factures d'achat, règlements fournisseurs (lots de virements SEPA), catalogue.
   + fiches fournisseurs enrichies (SIRET, TVA, IBAN, conditions, contacts). */

const ACH_SUB = "Fournisseurs, catalogue, bons de commande, factures d'achat et règlements.";
const rfSel = () => (ST.rfSel ||= new Set());

/* ---------- Fiche fournisseur enrichie ---------- */
const SUP_MODES = ["Virement", "Chèque", "Prélèvement", "Carte bancaire", "Espèces"];
function supExtraFields(f) {
  const ct = (f?.contacts || []).map((c) => [c.nom, c.fonction, c.telephone, c.email].map((x) => x || "").join(" | ")).join("\n");
  return `<div class="sect-t">Identité</div>
    ${fld({ k: "siret", l: "SIRET", v: f?.siret, r: 0 })}${fld({ k: "tva_intracom", l: "N° de TVA intracommunautaire", v: f?.tva_intracom, r: 0 })}
    ${fld({ k: "code_client", l: "Votre n° de compte client chez lui", v: f?.code_client, r: 0 })}${fld({ k: "site_web", l: "Site internet", v: f?.site_web, r: 0 })}
    <div class="sect-t">Conditions commerciales</div>
    ${fld({ k: "mode_paiement", l: "Mode de paiement habituel", t: "select", o: SUP_MODES, v: f?.mode_paiement || "Virement" })}
    ${fld({ k: "remise_pct", l: "Remise habituelle (%)", t: "number", v: f?.remise_pct ? String(f.remise_pct).replace(".", ",") : "", r: 0 })}
    ${fld({ k: "escompte_pct", l: "Escompte paiement comptant (%)", t: "number", v: f?.escompte_pct ? String(f.escompte_pct).replace(".", ",") : "", r: 0 })}
    ${fld({ k: "franco", l: "Franco de port (€ HT)", t: "number", v: f?.franco ? String(f.franco).replace(".", ",") : "", r: 0, hint: "Montant de commande au-delà duquel la livraison est gratuite." })}
    <div class="sect-t">Coordonnées bancaires (pour vos virements)</div>
    ${fld({ k: "iban", l: "IBAN", v: f?.iban ? rgIbanFmt(f.iban) : "", r: 0, cls: "full" })}${fld({ k: "bic", l: "BIC", v: f?.bic, r: 0 })}
    <div class="sect-t">Autres contacts</div>
    ${fld({ k: "contacts", l: "Un contact par ligne : nom | fonction | téléphone | email", t: "textarea", v: ct, r: 0, cls: "full", rows: 3 })}
    <label class="chk full" style="display:flex;gap:8px"><input type="checkbox" name="actif" ${f && f.actif === false ? "" : "checked"}> <span>Fournisseur actif</span></label>`;
}
function supExtraRead(v) {
  const iban = rgIbanClean(v.iban);
  if (iban && !rgIbanOk(iban)) throw new Error("L'IBAN saisi n'est pas valide. Vérifiez-le (une erreur de frappe envoie le virement au mauvais endroit).");
  const contacts = String(v.contacts || "").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const [nom, fonction, telephone, email] = l.split("|").map((x) => x.trim()); return { nom, fonction: fonction || "", telephone: telephone || "", email: email || "" }; });
  const pct = (x) => (x ? Math.min(100, Math.max(0, parseNum(x))) : 0);
  return { siret: v.siret?.replace(/\s/g, "") || null, tva_intracom: v.tva_intracom?.trim() || null, code_client: v.code_client || null, site_web: v.site_web || null, mode_paiement: v.mode_paiement || "Virement",
    remise_pct: pct(v.remise_pct), escompte_pct: pct(v.escompte_pct), franco: v.franco ? Math.max(0, parseNum(v.franco)) : 0, iban: iban || null, bic: v.bic?.replace(/\s/g, "").toUpperCase() || null, contacts, actif: "actif" in v };
}
function supCoordHtml(f) {
  const base = `<dl class="kv"><dt>Contact</dt><dd>${esc(f.contact || "-")}</dd><dt>Téléphone</dt><dd>${esc(f.telephone || "-")}</dd><dt>Email</dt><dd>${f.email ? `<a href="mailto:${esc(f.email)}">${esc(f.email)}</a>` : "-"}</dd><dt>Adresse</dt><dd>${esc(f.adresse || "-")}</dd><dt>Ville</dt><dd>${esc(f.ville || "-")}</dd>`;
  const ext = db.v11 ? `<dt>SIRET</dt><dd>${esc(f.siret || "-")}</dd><dt>TVA intracom.</dt><dd>${esc(f.tva_intracom || "-")}</dd><dt>N° client</dt><dd>${esc(f.code_client || "-")}</dd>
    <dt>Paiement</dt><dd>${esc(f.mode_paiement || "Virement")} · ${f.delai_paiement_jours} j${f.escompte_pct ? ` · escompte ${String(f.escompte_pct).replace(".", ",")} %` : ""}</dd>
    ${f.remise_pct ? `<dt>Remise</dt><dd>${String(f.remise_pct).replace(".", ",")} %</dd>` : ""}${f.franco ? `<dt>Franco</dt><dd>${E2(f.franco)} HT</dd>` : ""}
    <dt>IBAN</dt><dd>${f.iban ? esc(bkMask ? bkMask(f.iban) : rgIbanFmt(f.iban)) : `<span class="chip wn">Non renseigné</span>`}</dd>${f.site_web ? `<dt>Site</dt><dd>${esc(f.site_web)}</dd>` : ""}
    ${(f.contacts || []).map((c) => `<dt>${esc(c.fonction || "Contact")}</dt><dd>${esc(c.nom)}${c.telephone ? " · " + esc(c.telephone) : ""}${c.email ? ` · <a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : ""}</dd>`).join("")}` : "";
  return `${base}${ext}<dt>Notes</dt><dd>${esc(f.notes || "-").replace(/\n/g, "<br>")}</dd></dl>`;
}
function supBcCard(fid) {
  if (!db.v11) return "";
  const l = db.bcs.filter((b) => b.fournisseur_id === fid).slice(0, 6);
  return card("Bons de commande", l.length ? l.map((b) => `<div class="row lnk" data-act="bcOpen" data-id="${b.id}"><div><b>${esc(b.numero)}</b><small>${D(b.date_commande)}</small></div><span class="num">${E2(bcTotOf(b).ttc)}</span>${chip(b.statut)}</div>`).join("") : `<p class="mut" style="margin:0;padding:16px 18px">Aucun bon de commande.</p>`, btn("Nouveau", "bcNew", fid, "", "o sm w"));
}

/* ---------- Règlements fournisseurs ---------- */
const rfOpen = () => db.depenses.filter((d) => d.statut === "À payer");
const rfLotOf = (d) => (d.lot_id ? byId(db.lots, d.lot_id) : null);
const rfFree = () => rfOpen().filter((d) => { const l = rfLotOf(d); return !l || l.statut === "Annulé"; });
const rfSup = (d) => db.fournisseurs.find((f) => norm(f.nom) === norm(d.fournisseur));
function rfEch(d) {
  if (!d.echeance) return `<span class="mut">sans échéance</span>`;
  const n = daysBetween(today(), d.echeance);
  return n < 0 ? `<span class="chip dn">${D(d.echeance)} · retard ${-n} j</span>` : n <= 7 ? `<span class="chip wn">${D(d.echeance)} · ${n === 0 ? "aujourd'hui" : "dans " + n + " j"}</span>` : D(d.echeance);
}
function rfTab(t) {
  if (!db.v11) return page("Achats", ACH_SUB, "", t + card("", setupV11()));
  const free = rfFree(), op = rfOpen(), t0 = today();
  const echu = op.filter((d) => d.echeance && d.echeance < t0), s7 = op.filter((d) => d.echeance && d.echeance >= t0 && d.echeance <= addDays(t0, 7));
  const paid = db.depenses.filter((d) => d.statut === "Payée" && d.date_paiement).sort((a, b) => b.date_paiement.localeCompare(a.date_paiement));
  const p30 = paid.filter((d) => d.date_paiement >= addDays(t0, -30)), delai = paid.length ? Math.round(sum(paid, (d) => daysBetween(d.date_depense, d.date_paiement)) / paid.length) : null;
  const S = rfSel(); [...S].forEach((id) => { if (!free.some((d) => d.id === id)) S.delete(id); });
  const selTot = sum(free.filter((d) => S.has(d.id)), (d) => d.montant_ttc);
  const rows = free.sort((a, b) => (a.echeance || "9999").localeCompare(b.echeance || "9999")).map((d) => { const f = rfSup(d);
    return { t: `${d.fournisseur} ${d.reference || ""}`, c: [`<input type="checkbox" data-act="rfSel" data-id="${d.id}" ${S.has(d.id) ? "checked" : ""} aria-label="Sélectionner">`,
      `<strong>${esc(d.fournisseur)}</strong><small>${esc(d.reference || d.categorie || "")}${f && !f.iban ? ` · <span class="dn">IBAN manquant</span>` : ""}</small>`, esc(d.chantier_nom || "-"), rfEch(d), `<span class="num">${E2(d.montant_ttc)}</span>`, esc(f?.mode_paiement || "Virement")] }; });
  const lots = db.lots.filter((l) => l.statut !== "Annulé").slice(0, 12);
  const lrows = lots.map((l) => ({ c: [`<strong>${esc(l.reference)}</strong><small>${esc(byId(db.comptes, l.compte_id)?.nom || "")}</small>`, D(l.date_execution), `${l.nb} facture${l.nb > 1 ? "s" : ""}`, `<span class="num">${E2(l.montant_total)}</span>`, chip(l.statut),
    `<span class="r">${l.statut === "Préparé" ? btn("Fichier SEPA", "rfLotSepa", l.id, "", "o sm") + btn("Payé", "rfLotDone", l.id, "", "sm w") + btn("Annuler", "rfLotCancel", l.id, "", "lk w") : ""}</span>`] }));
  const wk = {};
  free.filter((d) => d.echeance).forEach((d) => { const n = Math.max(0, Math.floor(daysBetween(t0, d.echeance) / 7)); if (n < 8) (wk[n] ||= []).push(d); });
  const wrows = Object.keys(wk).sort((a, b) => a - b).map((n) => ({ c: [Number(n) === 0 ? "Cette semaine (et retards)" : `Dans ${n} semaine${n > 1 ? "s" : ""}`, `${wk[n].length} facture${wk[n].length > 1 ? "s" : ""}`, `<span class="num">${E2(sum(wk[n], (d) => d.montant_ttc))}</span>`] }));
  const prows = paid.slice(0, 12).map((d) => ({ act: "depEdit", id: d.id, c: [D(d.date_paiement), `<strong>${esc(d.fournisseur)}</strong><small>${esc(d.reference || "")}</small>`, esc(d.mode || "-"), `<span class="num">${E2(d.montant_ttc)}</span>`, `${daysBetween(d.date_depense, d.date_paiement)} j`] }));
  return page("Achats", ACH_SUB, btn(`Préparer un lot${S.size ? ` (${S.size} · ${E2(selTot)})` : ""}`, "rfLot", "", "", S.size ? "w" : "o w"),
    t + strip([["À payer (TTC)", E2(sum(op, (d) => d.montant_ttc)), `${op.length} facture${op.length > 1 ? "s" : ""}`], ["Échu", E2(sum(echu, (d) => d.montant_ttc)), echu.length ? `${echu.length} en retard` : "rien en retard", echu.length ? "dn" : "up"],
      ["À régler sous 7 jours", E2(sum(s7, (d) => d.montant_ttc)), `${s7.length} facture${s7.length > 1 ? "s" : ""}`], ["Payé sur 30 jours", E2(sum(p30, (d) => d.montant_ttc)), delai === null ? "" : `délai moyen réel : ${delai} j`]]) +
    card(`Factures à régler <span class="mut" style="font-weight:400">· ${free.length}</span>`, tbl(["", "Fournisseur", "Chantier", "Échéance", { h: "TTC", r: 1 }, "Mode"], rows, "Aucune facture à régler."),
      `<div style="display:flex;gap:8px;flex-wrap:wrap">${btn("Sélectionner les échues", "rfSelEchu", "", "", "o sm")}${btn("Tout sélectionner", "rfSelAll", "", "", "o sm")}${S.size ? btn("Effacer", "rfSelClear", "", "", "lk") : ""}</div>`) +
    (lots.length ? card("Lots de règlements", tbl(["Lot", "Exécution", "Factures", { h: "Total", r: 1 }, "Statut", ""], lrows)) : "") +
    (wrows.length ? card("Prochaines semaines", tbl(["Période", "Factures", { h: "Montant", r: 1 }], wrows)) : "") +
    card("Derniers règlements", tbl(["Payé le", "Fournisseur", "Mode", { h: "TTC", r: 1 }, "Après"], prows, "Aucun règlement enregistré.")) +
    `<p class="note">Un lot regroupe plusieurs factures payées par un seul virement. Quand le débit apparaît sur votre relevé, Pilot le reconnaît dans Comptabilité > Banque et passe toutes les factures du lot en « Payée ».</p>`);
}

/* Fichier SEPA (pain.001.001.03) */
const sepaTxt = (s, n = 70) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9\/\-?:().,'+ ]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const sepaX = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function sepaXml(lot, deps, debtor) {
  const now = new Date().toISOString().slice(0, 19), tot = r2(sum(deps, (d) => d.montant_ttc)), id = sepaTxt(lot.reference.replace(/[^A-Za-z0-9-]/g, ""), 35);
  const tx = deps.map((d, i) => { const f = rfSup(d);
    return `<CdtTrfTxInf><PmtId><EndToEndId>${sepaX(sepaTxt(id + "-" + (i + 1), 35))}</EndToEndId></PmtId><Amt><InstdAmt Ccy="EUR">${d.montant_ttc.toFixed(2)}</InstdAmt></Amt>${f.bic ? `<CdtrAgt><FinInstnId><BIC>${sepaX(f.bic)}</BIC></FinInstnId></CdtrAgt>` : ""}<Cdtr><Nm>${sepaX(sepaTxt(f.nom))}</Nm></Cdtr><CdtrAcct><Id><IBAN>${rgIbanClean(f.iban)}</IBAN></Id></CdtrAcct><RmtInf><Ustrd>${sepaX(sepaTxt("Facture " + (d.reference || d.id.slice(0, 8)), 140))}</Ustrd></RmtInf></CdtTrfTxInf>`; }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><CstmrCdtTrfInitn><GrpHdr><MsgId>${sepaX(id)}</MsgId><CreDtTm>${now}</CreDtTm><NbOfTxs>${deps.length}</NbOfTxs><CtrlSum>${tot.toFixed(2)}</CtrlSum><InitgPty><Nm>${sepaX(sepaTxt(db.ent.nom || "Entreprise"))}</Nm></InitgPty></GrpHdr>`
    + `<PmtInf><PmtInfId>${sepaX(id)}</PmtInfId><PmtMtd>TRF</PmtMtd><BtchBookg>true</BtchBookg><NbOfTxs>${deps.length}</NbOfTxs><CtrlSum>${tot.toFixed(2)}</CtrlSum><PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl></PmtTpInf><ReqdExctnDt>${lot.date_execution}</ReqdExctnDt>`
    + `<Dbtr><Nm>${sepaX(sepaTxt(db.ent.nom || "Entreprise"))}</Nm></Dbtr><DbtrAcct><Id><IBAN>${rgIbanClean(debtor.iban)}</IBAN></Id></DbtrAcct><DbtrAgt><FinInstnId>${debtor.bic ? `<BIC>${sepaX(debtor.bic)}</BIC>` : "<Othr><Id>NOTPROVIDED</Id></Othr>"}</FinInstnId></DbtrAgt><ChrgBr>SLEV</ChrgBr>${tx}</PmtInf></CstmrCdtTrfInitn></Document>`;
}
function rfDebtor(lot) {
  const c = byId(db.comptes, lot.compte_id);
  const iban = c?.iban || db.ent.iban || "";
  return { iban, bic: db.ent.bic || "" };
}
function rfSepaDownload(lot) {
  const deps = db.depenses.filter((d) => d.lot_id === lot.id), miss = deps.filter((d) => { const f = rfSup(d); return !f || !f.iban; });
  if (miss.length) throw new Error(`IBAN manquant pour : ${[...new Set(miss.map((d) => d.fournisseur))].join(", ")}. Complétez les fiches fournisseurs.`);
  const deb = rfDebtor(lot);
  if (!rgIbanOk(deb.iban)) throw new Error("L'IBAN de votre compte à débiter est manquant ou invalide (Banque > compte, ou Paramètres).");
  downloadBlob(`${slug(lot.reference)}-virements-sepa.xml`, new Blob([sepaXml(lot, deps, deb)], { type: "application/xml" }));
}

function rfLotForm() {
  if (!guard()) return;
  const S = rfSel(), deps = rfFree().filter((d) => S.has(d.id));
  if (!deps.length) return toast("Cochez d'abord les factures à régler.", "dn");
  const tot = r2(sum(deps, (d) => d.montant_ttc)), d0 = today().replace(/-/g, ""), n = db.lots.filter((l) => l.reference.includes(d0)).length + 1;
  const noIban = [...new Set(deps.filter((d) => !rfSup(d)?.iban).map((d) => d.fournisseur))];
  modal("Préparer un lot de règlements", `<p style="margin:0 0 10px"><b>${deps.length} facture${deps.length > 1 ? "s" : ""}</b> pour un total de <b>${E2(tot)}</b> TTC.</p>
    <div class="frm">${fld({ k: "reference", l: "Référence du lot", v: `LOT-${d0}-${n}` })}${fld({ k: "date_execution", l: "Date d'exécution du virement", t: "date", v: today() })}
    ${fld({ k: "compte_id", l: "Compte à débiter", t: "select", o: [{ v: "", l: "Non précisé" }, ...db.comptes.map((c) => ({ v: c.id, l: c.nom }))], v: db.comptes[0]?.id || "", r: 0, cls: "full" })}
    <label class="chk full" style="display:flex;gap:8px"><input type="checkbox" name="sepa" ${noIban.length ? "" : "checked"}> <span>Télécharger le fichier de virements SEPA (à importer dans votre banque en ligne)</span></label></div>
    ${noIban.length ? `<p class="mut" style="margin:10px 0 0"><span class="dn">IBAN manquant :</span> ${esc(noIban.join(", "))}. Le fichier SEPA ne pourra pas être généré tant que ces fiches fournisseurs ne sont pas complétées.</p>` : ""}
    <div class="tw" style="margin-top:10px;max-height:200px;overflow:auto"><table><tbody>${deps.map((d) => `<tr><td>${esc(d.fournisseur)}<small>${esc(d.reference || "")}</small></td><td class="r">${E2(d.montant_ttc)}</td></tr>`).join("")}</tbody></table></div>`, {
    submit: "Créer le lot",
    onSubmit: async (v, api) => {
      if (v.sepa && noIban.length) throw new Error("Complétez l'IBAN des fournisseurs ou décochez le fichier SEPA.");
      const lot = await q(sb.from("paiement_lots").insert({ reference: v.reference.trim(), date_execution: v.date_execution, compte_id: v.compte_id || null, montant_total: tot, nb: deps.length, mode: "Virement" }).select("*").single());
      for (const d of deps) await q(sb.from("depenses").update({ lot_id: lot.id }).eq("id", d.id));
      S_clear();
      api.close();
      if (v.sepa) { lot.montant_total = tot; db.depenses.filter((d) => S_has(deps, d)).forEach((d) => (d.lot_id = lot.id)); try { rfSepaDownload({ ...lot }); } catch (e) { toast(esc(friendly(e)), "dn"); } }
      toast(`Lot ${lot.reference} créé.`, "ok"); await refresh();
    },
  });
}
const S_clear = () => rfSel().clear();
const S_has = (deps, d) => deps.some((x) => x.id === d.id);

/* ---------- Hub Achats ---------- */
const ACH_TABS = [["synthese", "Vue d'ensemble"], ["bc", "Bons de commande"], ["commandes", "Commandes"], ["factures", "Factures d'achat"], ["reglements", "Règlements"], ["catalogue", "Catalogue"]];
V.achats = () => {
  const tab = ST.tab.achats || "synthese", t = tabs("achats", ACH_TABS, tab);
  if (!db.v5) return page("Achats", ACH_SUB, "", t + card("", `<p class="note" style="margin:0">Exécutez migration_v5.sql dans Supabase pour activer les fournisseurs et les achats.</p>`));
  if (["bc", "catalogue", "reglements"].includes(tab) && !db.v11) return page("Achats", ACH_SUB, "", t + card("", setupV11()));
  if (tab === "reglements") return rfTab(t);
  if (tab === "catalogue") return catTab(t);
  const t0 = today();
  if (tab === "bc") {
    const f = ST.bcf || "cours", L = { cours: ["Envoyé", "Confirmé", "Reçu partiellement"], recus: ["Reçu", "Facturé"], brouillons: ["Brouillon"], annules: ["Annulé"] };
    const list = db.bcs.filter((b) => f === "tous" || L[f].includes(b.statut));
    const rows = list.map((b) => ({ act: "bcOpen", id: b.id, t: `${b.numero} ${supName(b.fournisseur_id)} ${byId(db.chantiers, b.chantier_id)?.nom || ""}`,
      c: [`<strong>${esc(b.numero)}</strong>`, esc(supName(b.fournisseur_id)), esc(byId(db.chantiers, b.chantier_id)?.nom || "-"), D(b.date_commande), bcLate(b) ? `<span class="chip dn">${D(b.date_livraison)} · en retard</span>` : b.date_livraison ? D(b.date_livraison) : "-", `<span class="num">${E2(bcTotOf(b).ttc)}</span>`, chip(b.statut)] }));
    return page("Achats", ACH_SUB, btn("Nouveau bon de commande", "bcNew", "", "", "w"), t + `<div style="margin-bottom:12px"><div class="seg">${[["cours", "En cours"], ["recus", "Reçus"], ["brouillons", "Brouillons"], ["annules", "Annulés"], ["tous", "Tous"]].map(([k, l]) => `<button data-act="bcFilter" data-arg="${k}" aria-pressed="${f === k}">${l}</button>`).join("")}</div></div>` +
      searchBar("Rechercher un bon de commande, un fournisseur…", `${list.length} bon${list.length > 1 ? "s" : ""}`) + card("", tbl(["N°", "Fournisseur", "Chantier", "Date", "Livraison", { h: "TTC", r: 1 }, "Statut"], rows, "Aucun bon de commande ici.")));
  }
  if (tab === "commandes") {
    const rows = db.achats.map((a) => { const bc = db.bcs.find((b) => b.achat_id === a.id); return { act: bc ? "bcOpen" : "achatEdit", id: bc ? bc.id : a.id, t: `${a.numero || ""} ${supName(a.fournisseur_id)}`,
      c: [`<strong>${esc(a.type)}</strong><small>${esc(a.numero || "")}${bc ? " · bon de commande" : ""}</small>`, esc(supName(a.fournisseur_id)), esc(byId(db.chantiers, a.chantier_id)?.nom || "-"), D(a.date_doc), a.date_livraison ? D(a.date_livraison) : "-", `<span class="num">${E2(a.montant_ht)}</span>`, chip(a.statut)] }; });
    return page("Achats", ACH_SUB, btn("Nouveau devis fournisseur", "achatNew", "", "Devis", "o") + btn("Commande simple", "achatNew", "", "Commande", "o w"),
      t + strip([["Budget engagé (HT)", E2(sum(engagees(), (a) => a.montant_ht)), `${engagees().length} commande${engagees().length > 1 ? "s" : ""} non facturée${engagees().length > 1 ? "s" : ""}`], ["Devis en attente", db.achats.filter((a) => a.type === "Devis" && a.statut === "En attente").length, "à accepter ou refuser"]]) +
      searchBar("Rechercher…", `${rows.length}`) + card("", tbl(["Document", "Fournisseur", "Chantier", "Date", "Livraison", { h: "HT", r: 1 }, "Statut"], rows, "Aucune commande.")));
  }
  if (tab === "factures") {
    const ff = ST.achf || "tous", list = db.depenses.filter((d) => ff === "tous" || (ff === "achat" ? d.type === "Achat" : ff === "apayer" ? d.statut === "À payer" : d.type !== "Achat"));
    const rows = list.map((d) => ({ act: "depEdit", id: d.id, t: `${d.fournisseur} ${d.reference || ""}`, c: [D(d.date_depense), `<strong>${esc(d.fournisseur)}</strong><small>${esc(d.reference || "")}</small>`, esc(d.chantier_nom || "-"), d.statut === "À payer" ? rfEch(d) : D(d.date_paiement), `<span class="num">${E2(d.montant_ttc)}</span>`, chip(d.statut)] }));
    return page("Achats", ACH_SUB, btn("Importer (PDF, Factur-X)", "depImport", "", "", "o") + (typeof efbOpen === "function" ? btn("Importer en lot", "efbOpen", "", "import", "o w") : "") + btn("Nouvelle facture d'achat", "depNew", "", "", "w"),
      t + `<div style="margin-bottom:12px"><div class="seg">${[["tous", "Toutes"], ["achat", "Achats"], ["frais", "Frais généraux"], ["apayer", "À payer"]].map(([k, l]) => `<button data-act="achFilter" data-arg="${k}" aria-pressed="${ff === k}">${l}</button>`).join("")}</div></div>` +
      searchBar("Rechercher un fournisseur, une référence…", `${rows.length}`) + card("", tbl(["Date", "Fournisseur", "Chantier", "Échéance / payée", { h: "TTC", r: 1 }, "Statut"], rows, "Aucune facture.")));
  }
  // vue d'ensemble
  const bcs = db.v11 ? db.bcs.filter((b) => ["Envoyé", "Confirmé", "Reçu partiellement"].includes(b.statut)) : [], late = bcs.filter(bcLate), op = rfOpen(), echu = op.filter((d) => d.echeance && d.echeance < t0);
  const soon = op.filter((d) => d.echeance).sort((a, b) => a.echeance.localeCompare(b.echeance)).slice(0, 6);
  return page("Achats", ACH_SUB, (db.v11 ? btn("Nouveau bon de commande", "bcNew", "", "", "w") : "") + btn("Nouvelle facture d'achat", "depNew", "", "", "o w") + btn("Fournisseurs", "go", "fournisseurs", "", "o w") + btn("Nouveau fournisseur", "fournisseurNew", "", "", "o w"),
    t + strip([["Budget engagé (HT)", E2(sum(engagees(), (a) => a.montant_ht)), "commandes non facturées"], ["Commandes en cours", bcs.length, late.length ? `${late.length} livraison${late.length > 1 ? "s" : ""} en retard` : "dans les délais", late.length ? "dn" : ""],
      ["À payer (TTC)", E2(sum(op, (d) => d.montant_ttc)), echu.length ? `dont ${E2(sum(echu, (d) => d.montant_ttc))} échu` : "rien d'échu", echu.length ? "dn" : ""], ["Fournisseurs", db.fournisseurs.filter((f) => f.actif !== false).length, `${db.cat.length} article${db.cat.length > 1 ? "s" : ""} au catalogue`]]) +
    `<div class="g2"><div>${card("Commandes à suivre", bcs.length ? bcs.sort((a, b) => (a.date_livraison || "9999").localeCompare(b.date_livraison || "9999")).slice(0, 6).map((b) => `<div class="row lnk" data-act="bcOpen" data-id="${b.id}"><div><b>${esc(b.numero)}</b><small>${esc(supName(b.fournisseur_id))}${b.date_livraison ? " · livraison " + D(b.date_livraison) : ""}</small></div>${bcLate(b) ? `<span class="chip dn">En retard</span>` : chip(b.statut)}</div>`).join("") : `<p class="mut" style="margin:0;padding:16px 18px">Aucune commande en cours.</p>`)}</div>
    <div>${card("Prochains paiements", soon.length ? soon.map((d) => `<div class="row lnk" data-act="depEdit" data-id="${d.id}"><div><b>${esc(d.fournisseur)}</b><small>${esc(d.reference || "")}</small></div><span>${rfEch(d)}</span><span class="num">${E2(d.montant_ttc)}</span></div>`).join("") : `<p class="mut" style="margin:0;padding:16px 18px">Rien à payer avec échéance.</p>`, btn("Voir les règlements", "achTab", "", "reglements", "o sm w"))}</div></div>`);
};

const achatsProActions = {
  achTab: (id, arg) => { ST.tab.achats = arg; return render(true); },
  bcFilter: (id, arg) => { ST.bcf = arg; return render(true); },
  achFilter: (id, arg) => { ST.achf = arg; return render(true); },
  rfSel: (id) => { const S = rfSel(); S.has(id) ? S.delete(id) : S.add(id); return render(true); },
  rfSelAll: () => { rfFree().forEach((d) => rfSel().add(d.id)); return render(true); },
  rfSelEchu: () => { rfSel().clear(); rfFree().filter((d) => d.echeance && d.echeance <= today()).forEach((d) => rfSel().add(d.id)); return render(true); },
  rfSelClear: () => { rfSel().clear(); return render(true); },
  rfLot: () => rfLotForm(),
  rfLotSepa: (id) => { try { rfSepaDownload(byId(db.lots, id)); } catch (e) { toast(esc(friendly(e)), "dn"); } },
  rfLotDone: (id) => {
    if (!guard()) return;
    const l = byId(db.lots, id);
    modal(`Lot ${esc(l.reference)} payé`, `<p class="mut" style="margin:0 0 10px">Les ${l.nb} factures du lot passeront en « Payée ». Si le débit est déjà sur votre relevé, utilisez plutôt Comptabilité > Banque : Pilot reconnaît le lot.</p>${fld({ k: "date", l: "Date du paiement", t: "date", v: l.date_execution <= today() ? l.date_execution : today() })}`, {
      onSubmit: async (v, api) => {
        for (const d of db.depenses.filter((x) => x.lot_id === id)) await q(sb.from("depenses").update({ statut: "Payée", date_paiement: v.date, mode: l.mode || "Virement" }).eq("id", d.id));
        await q(sb.from("paiement_lots").update({ statut: "Exécuté", executed_at: new Date().toISOString() }).eq("id", id));
        api.close(); toast("Lot marqué payé.", "ok"); await refresh();
      } });
  },
  rfLotCancel: async (id) => {
    if (!guard() || !confirm("Annuler ce lot ? Les factures redeviennent disponibles pour un autre règlement.")) return;
    for (const d of db.depenses.filter((x) => x.lot_id === id)) await q(sb.from("depenses").update({ lot_id: null }).eq("id", d.id));
    await q(sb.from("paiement_lots").update({ statut: "Annulé" }).eq("id", id));
    toast("Lot annulé."); await refresh();
  },
};
