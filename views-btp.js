/* Facturation BTP avancée (v14) : proforma, révision de prix, DGD, autoliquidation, attestation de TVA, aides (CEE, MaPrimeRénov'), déchets.
   S'appuie sur la facturation de la v8 (acomptes, situations, avoirs, retenue de garantie). */

const AUTO_MENTION = "Autoliquidation de la TVA : TVA due par le preneur assujetti (art. 283-2 nonies du CGI).";
const BT_AIDES = ["MaPrimeRénov'", "Prime CEE", "Aide locale", "Autre"];
const BT_DECHETS = ["Gravats inertes", "Déchets non dangereux (DIB)", "Bois", "Métaux", "Plâtre", "Plastiques", "Déchets dangereux (amiante, etc.)"];
const pad3 = (n) => String(n).padStart(3, "0");
const aidesOf = (did) => (db.aides || []).filter((a) => a.devis_id === did);
const aidesTotal = (did, valides = false) => r2(sum(aidesOf(did).filter((a) => a.statut !== "Refusée" && (!valides || ["Validée", "Perçue"].includes(a.statut))), (a) => a.montant));
const autoliqHint = (client) => { const c = client && (db.cx?.[client.id] || {}); return !!client && (client.type === "Professionnel" || !!c?.siret); };

/* ---------- PDF simple (DGD, attestation) ---------- */
async function btpPdf(title, sub, sections, foot = "") {
  await loadScript(LIBS.pdflib);
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const T = PilotPdf.clean, W = 595.28, H = 841.89, M = 48, INK = rgb(0.1, 0.11, 0.13), GREY = rgb(0.4, 0.42, 0.45), ACC = rgb(0.14, 0.23, 0.35);
  let page, y;
  const np = () => { page = pdf.addPage([W, H]); page.drawRectangle({ x: 0, y: H - 10, width: W, height: 10, color: ACC }); y = H - 60; };
  np();
  page.drawText(T(title), { x: M, y, size: 19, font: bold, color: ACC }); y -= 20;
  for (const l of sigWrap(sub, font, 10, W - 2 * M)) { page.drawText(l, { x: M, y, size: 10, font, color: GREY }); y -= 13; }
  y -= 14;
  for (const s of sections) {
    if (y < 120) np();
    if (s.h) { page.drawText(T(s.h.toUpperCase()), { x: M, y, size: 8.5, font: bold, color: ACC }); y -= 16; }
    if (s.text) for (const l of sigWrap(s.text, font, s.size || 9.5, W - 2 * M)) { if (y < 60) np(); page.drawText(l, { x: M, y, size: s.size || 9.5, font, color: s.grey ? GREY : INK }); y -= 13; }
    for (const [k, v, b] of s.rows || []) {
      if (y < 60) np();
      const ls = sigWrap(String(v ?? ""), b ? bold : font, 10, W - 2 * M - 230);
      page.drawText(T(k), { x: M, y, size: 9.5, font, color: GREY });
      ls.forEach((l, i) => page.drawText(l, { x: M + 230, y: y - i * 13, size: 10, font: b ? bold : font, color: INK }));
      y -= Math.max(1, ls.length) * 13 + 4;
    }
    y -= 10;
  }
  if (foot) for (const p of pdf.getPages()) p.drawText(T(foot), { x: M, y: 24, size: 7.5, font, color: GREY });
  pdf.setProducer("Pilot"); pdf.setTitle(T(title));
  return await pdf.save();
}
async function btpSaveDoc(bytes, nom, categorie, extra = {}) {
  const chemin = `${uid}/btp/${Date.now()}-${slug(nom)}.pdf`;
  const up = await sb.storage.from("documents").upload(chemin, new Blob([bytes], { type: "application/pdf" }), { contentType: "application/pdf" });
  if (up.error) throw new Error("Enregistrement du PDF impossible : " + up.error.message);
  if (db.v6) await q(sb.from("documents").insert({ nom: nom + ".pdf", categorie, chemin, mime: "application/pdf", taille: bytes.length, ...extra }));
  return chemin;
}

/* ---------- Proforma ---------- */
function proformaForm(did) {
  if (!guard()) return;
  const d = byId(db.devis, did);
  modal("Facture proforma", `<div class="frm"><p class="mut full" style="margin:0">Document provisoire, sans numéro de facture ni effet comptable. Il sert à demander un paiement préalable, un dossier de financement ou une prise en charge avant la facture définitive.</p>
    ${fld({ k: "pct", l: "Part du devis à faire figurer (%)", t: "number", v: "100" })}${fld({ k: "date", l: "Date", t: "date", v: today() })}
    ${fld({ k: "notes", l: "Mention libre", t: "textarea", v: "", r: 0, cls: "full" })}</div>`, {
    submit: "Créer le proforma",
    onSubmit: async (v, api) => {
      const pct = parseNum(v.pct);
      if (!(pct > 0 && pct <= 100)) throw new Error("Indiquez un pourcentage entre 0 et 100.");
      const src = cxBillable(await lignesOf("devis", did)).filter((l) => !mkOff(l)), by = totauxParTaux(src, d);
      const lignes = pct === 100 ? src.map((l) => ({ designation: l.designation, quantite: l.quantite, unite: l.unite, prix_unitaire_ht: l.prix_unitaire_ht, taux_tva: l.taux_tva, categorie: l.categorie || "" }))
        : Object.entries(by).map(([t, x]) => ({ designation: `${fmtNum(pct, pct % 1 ? 1 : 0)} % du devis ${d.numero}${Object.keys(by).length > 1 ? ` (TVA ${t} %)` : ""}`, quantite: 1, unite: "forfait", prix_unitaire_ht: r2((x.ht * pct) / 100), taux_tva: Number(t), categorie: "" }));
      const ht = r2(sum(lignes, (l) => r2(l.quantite * l.prix_unitaire_ht))), ttc = r2(ht + sum(lignes, (l) => r2((r2(l.quantite * l.prix_unitaire_ht) * l.taux_tva) / 100)));
      const numero = `PRO-${v.date.slice(0, 4)}-${pad3((db.pfs || []).filter((x) => String(x.date_emission).startsWith(v.date.slice(0, 4))).length + 1)}`;
      const row = await q(sb.from("proformas").insert({ devis_id: did, numero, date_emission: v.date, pct, montant_ht: ht, montant_ttc: ttc, lignes, notes: v.notes || null }).select("id").single());
      api.close(); toast(`Proforma ${numero} créé.`, "ok");
      await refresh(); proformaPdf(row.id);
    },
  });
}
async function proformaPdf(id) {
  const p = byId(db.pfs, id), d = byId(db.devis, p.devis_id), c = clientOf(d.client_id) || {}, ch = d.chantier_id ? byId(db.chantiers, d.chantier_id) : null;
  toast("Génération du PDF…");
  const by = totauxParTaux(p.lignes, null), tva = r2(sum(Object.values(by), (x) => x.tva));
  const data = { kind: "facture", numero: p.numero, date: p.date_emission, echeance: addDays(p.date_emission, Number(db.ent.delai_paiement_jours) || 30), statut: "Envoyée", notes: p.notes, client: { nom: c.nom || d.client_nom, adresse: c.adresse, ville: c.ville, email: c.email, telephone: c.telephone },
    chantier: ch ? { nom: ch.nom, ville: ch.ville } : null, lignes: p.lignes, ht: p.montant_ht, tva, ttc: p.montant_ttc, taux_tva: d.taux_tva, paye: 0, devis_numero: d.numero, fx: { nature: "Proforma", label: "Facture proforma" }, mentions: [] };
  const bytes = await PilotPdf.build(data, await pdfContext("facture"));
  openPdfModal(`Proforma ${p.numero}`, bytes, `${slug(p.numero)}.pdf`);
}
function proformaCard(d) {
  const L = (db.pfs || []).filter((x) => x.devis_id === d.id);
  return card("Factures proforma", L.length ? L.map((p) => `<div class="row"><div><b>${esc(p.numero)}</b><small>${D(p.date_emission)} · ${fmtNum(p.pct, p.pct % 1 ? 1 : 0)} % du devis</small></div><span class="num">${E2(p.montant_ttc)} ${btn("PDF", "btPfPdf", p.id, "", "o sm")}</span></div>`).join("")
    : `<p class="mut" style="margin:0;padding:16px 18px">Préparez un document provisoire avant d'émettre la facture définitive.</p>`, btn("Créer un proforma", "btPfNew", d.id, "", "o sm w"));
}

/* ---------- Aides et primes ---------- */
function aideForm(did, a) {
  if (!guard()) return;
  modal(a ? "Modifier l'aide" : "Aide ou prime", `<div class="frm">${fld({ k: "type", l: "Dispositif", t: "select", o: BT_AIDES, v: a?.type || BT_AIDES[0] })}${fld({ k: "montant", l: "Montant (€)", t: "number", v: a ? String(a.montant).replace(".", ",") : "" })}
    ${fld({ k: "statut", l: "État", t: "select", o: ["Estimée", "Validée", "Perçue", "Refusée"], v: a?.statut || "Estimée", hint: "Seules les aides validées ou perçues sont reprises dans la facture finale." })}${fld({ k: "reference", l: "N° de dossier", v: a?.reference || "", r: 0 })}</div>`, {
    extra: a ? `<button type="button" class="lk" style="color:var(--dn)" id="aidel">Supprimer</button>` : "",
    onMount: (m, api) => { $("#aidel", m)?.addEventListener("click", async () => { await q(sb.from("aides").delete().eq("id", a.id)); api.close(); await refresh(); }); },
    onSubmit: async (v, api) => {
      const row = { devis_id: did, type: v.type, montant: Math.max(0, parseNum(v.montant)), statut: v.statut, reference: v.reference || null };
      if (a) await q(sb.from("aides").update(row).eq("id", a.id)); else await q(sb.from("aides").insert(row));
      api.close(); toast("Aide enregistrée.", "ok"); await refresh();
    },
  });
}
function aidesCard(d) {
  const L = aidesOf(d.id), tot = aidesTotal(d.id), val = aidesTotal(d.id, true);
  return card("Aides et primes", `${L.map((a) => `<div class="row"><div><b>${esc(a.type)}</b><small>${esc(a.reference || "")}</small></div><span class="num">${E2(a.montant)} ${chip(a.statut === "Estimée" ? "En attente" : a.statut === "Perçue" ? "Payée" : a.statut === "Refusée" ? "Refusé" : "Accepté")} ${btn("Modifier", "btAide", d.id, a.id, "o sm w")}</span></div>`).join("") || `<p class="mut" style="margin:0;padding:16px 18px">Ajoutez MaPrimeRénov', les primes CEE ou une aide locale : elles apparaissent sur le devis et réduisent le reste à charge.</p>`}
    ${tot ? `<dl class="kv"><dt>Total des aides</dt><dd>${E2(tot)} <small class="mut">dont validées ${E2(val)}</small></dd><dt>Reste à charge estimé</dt><dd><b>${E2(r2(d.montant_ttc - tot))}</b> TTC</dd></dl>` : ""}`, btn("Ajouter une aide", "btAide", d.id, "", "o sm w"));
}

/* ---------- Révision de prix ---------- */
const revOf = (did) => (db.mrev || []).find((x) => x.devis_id === did);
const indVal = (indice, mois) => (db.ivals || []).find((x) => x.indice === indice && x.mois === mois)?.valeur;
const moisOpts = (n = 36) => Array.from({ length: n }, (_, i) => { const dt = new Date(); dt.setMonth(dt.getMonth() - i); return dt.toISOString().slice(0, 7); });
// Cn = a + b × (In / I0), avec b = 1 - a. Renvoie null si le marché n'a pas de révision ou si l'indice du mois manque.
function btRevision(did, mois) {
  const r = revOf(did);
  if (!r || !mois) return null;
  const i = indVal(r.indice, mois);
  if (!i) return { manque: true, indice: r.indice, mois };
  const b = 1 - r.part_fixe, cn = r2(r.part_fixe + b * (i / r.i0_valeur) * 1) , cnExact = r.part_fixe + b * (i / r.i0_valeur);
  return { indice: r.indice, mois, i0: r.i0_valeur, i0_mois: r.i0_mois, in: i, a: r.part_fixe, b: r2(b), cn: Math.round(cnExact * 10000) / 10000, txt: `Cn = ${fmtNum(r.part_fixe, 2)} + ${fmtNum(b, 2)} × (${r.indice} ${mois} ${fmtNum(i, 2)} / ${r.indice} ${r.i0_mois} ${fmtNum(r.i0_valeur, 2)}) = ${fmtNum(Math.round(cnExact * 10000) / 10000, 4)}` };
}
function revisionForm(did) {
  if (!guard()) return;
  const r = revOf(did), idx = [...new Set((db.ivals || []).map((x) => x.indice))];
  modal("Révision de prix du marché", `<div class="frm"><p class="mut full" style="margin:0">Formule : <b>Cn = a + (1 − a) × In / I0</b>. « a » est la part fixe non révisable (souvent 0,15), I0 l'indice du mois de référence du marché (date de remise des prix), In l'indice du mois de la situation. Reprenez les paramètres de votre cahier des charges.</p>
    <datalist id="dlidx">${idx.map((i) => `<option value="${esc(i)}">`).join("")}<option value="BT01"><option value="BT02"><option value="BT03"><option value="BT16"><option value="TP01"></datalist>
    ${fld({ k: "indice", l: "Indice", v: r?.indice || "BT01" })}${fld({ k: "part_fixe", l: "Part fixe « a »", t: "number", v: String(r?.part_fixe ?? 0.15).replace(".", ",") })}
    ${fld({ k: "i0_mois", l: "Mois de référence I0", t: "select", o: moisOpts(60), v: r?.i0_mois || moisOpts(1)[0] })}${fld({ k: "i0_valeur", l: "Valeur de l'indice I0", t: "number", v: r ? String(r.i0_valeur).replace(".", ",") : "", hint: "Valeurs publiées par l'INSEE : saisissez-les dans l'onglet Indices." })}</div>`, {
    extra: r ? `<button type="button" class="lk" style="color:var(--dn)" id="revdel">Retirer la révision</button>` : "",
    onMount: (m, api) => { $("#f_indice", m).setAttribute("list", "dlidx"); $("#revdel", m)?.addEventListener("click", async () => { await q(sb.from("marche_revisions").delete().eq("id", r.id)); api.close(); await refresh(); }); },
    onSubmit: async (v, api) => {
      const a = parseNum(v.part_fixe), i0 = parseNum(v.i0_valeur);
      if (!(a >= 0 && a < 1)) throw new Error("La part fixe doit être comprise entre 0 et 1 (ex : 0,15).");
      if (!(i0 > 0)) throw new Error("Indiquez la valeur de l'indice de référence.");
      await q(sb.from("marche_revisions").upsert({ devis_id: did, indice: v.indice.trim().toUpperCase(), part_fixe: a, i0_mois: v.i0_mois, i0_valeur: i0 }, { onConflict: "devis_id" }));
      await q(sb.from("indices_valeurs").upsert({ indice: v.indice.trim().toUpperCase(), mois: v.i0_mois, valeur: i0 }, { onConflict: "user_id,indice,mois" }));
      api.close(); toast("Révision paramétrée.", "ok"); await refresh();
    },
  });
}
function indiceForm() {
  if (!guard()) return;
  const idx = [...new Set((db.ivals || []).map((x) => x.indice))];
  modal("Valeur d'un indice", `<div class="frm">${fld({ k: "indice", l: "Indice", v: idx[0] || "BT01" })}${fld({ k: "mois", l: "Mois", t: "select", o: moisOpts(36), v: moisOpts(1)[0] })}${fld({ k: "valeur", l: "Valeur", t: "number", v: "" })}</div>`, {
    onMount: (m) => { $("#f_indice", m).setAttribute("list", "dlidx2"); m.insertAdjacentHTML("beforeend", `<datalist id="dlidx2">${idx.map((i) => `<option value="${esc(i)}">`).join("")}</datalist>`); },
    onSubmit: async (v, api) => {
      const x = parseNum(v.valeur);
      if (!(x > 0)) throw new Error("Indiquez la valeur de l'indice.");
      await q(sb.from("indices_valeurs").upsert({ indice: v.indice.trim().toUpperCase(), mois: v.mois, valeur: x }, { onConflict: "user_id,indice,mois" }));
      api.close(); toast("Indice enregistré.", "ok"); await refresh();
    },
  });
}
function indicesTab() {
  const idx = [...new Set((db.ivals || []).map((x) => x.indice))];
  return card("Valeurs d'indices (révision de prix)", (db.ivals || []).length ? tbl(["Indice", "Mois", { h: "Valeur", r: 1 }, ""], [...db.ivals].sort((a, b) => (a.indice + b.mois < b.indice + a.mois ? 1 : -1)).map((x) => ({ t: x.indice, c: [`<strong>${esc(x.indice)}</strong>`, esc(x.mois), `<span class="num">${fmtNum(x.valeur, 2)}</span>`, `<span class="r"><button class="lk w" data-act="btIndDel" data-id="${x.id}">Supprimer</button></span>`] })))
    : `<p class="mut" style="margin:0;padding:16px 18px">Saisissez les valeurs des indices BT ou TP publiées par l'INSEE : Pilot ne les récupère pas automatiquement. Elles servent à calculer la révision des situations.</p>`, btn("Ajouter une valeur", "btIndNew", "", "", "sm w")) + `<p class="note">${idx.length ? `${idx.length} indice${idx.length > 1 ? "s" : ""} suivi${idx.length > 1 ? "s" : ""}. ` : ""}La révision se paramètre sur chaque devis (fiche devis, carte « Révision de prix »), puis s'applique en cochant la case dans la situation.</p>`;
}
function revisionCard(d) {
  const r = revOf(d.id);
  return card("Révision de prix", r ? `<dl class="kv"><dt>Indice</dt><dd>${esc(r.indice)} · I0 ${esc(r.i0_mois)} = ${fmtNum(r.i0_valeur, 2)}</dd><dt>Part fixe</dt><dd>${fmtNum(r.part_fixe, 2)}</dd></dl>` : `<p class="mut" style="margin:0;padding:16px 18px">Si le marché prévoit une révision de prix, paramétrez l'indice : elle sera proposée dans chaque situation, avec le détail du calcul.</p>`, btn(r ? "Modifier" : "Paramétrer", "btRev", d.id, "", "o sm w"));
}

/* ---------- Décompte général définitif ---------- */
function dgdData(did) {
  const d = byId(db.devis, did), avs = db.devis.filter((x) => db.avn[x.id] === did && x.statut === "Accepté"), ids = [did, ...avs.map((a) => a.id)];
  const fs = db.factures.filter((f) => ids.includes(fdOf(f.id)?.devis_id || f.devis_id) && !["Brouillon", "Annulée"].includes(f.statut));
  const nat = (f) => fxNat(f), isF = (f) => nat(f) !== "Avoir";
  const initial = r2(d.montant_ht), avenants = r2(sum(avs, (a) => a.montant_ht)), marche = r2(initial + avenants);
  const rev = r2(sum(fs, (f) => Number(fdOf(f.id)?.revision?.montant) || 0));
  const act = fs.filter((f) => nat(f) === "Acompte"), sit = fs.filter((f) => ["Situation", "Situation détaillée"].includes(nat(f))), fin = fs.filter((f) => nat(f) === "Finale"), av = fs.filter((f) => !isF(f)), std = fs.filter((f) => nat(f) === "Facture");
  const ht = (L) => r2(sum(L, (f) => f.montant_ht));
  const factureHT = r2(sum(fs, (f) => f.montant_ht)), factureTTC = r2(sum(fs, (f) => f.montant_ttc));
  const retenue = r2(sum(fs.filter(isF), (f) => (f.fx.retenue && !fdOf(f.id)?.retenue_liberee_le ? f.fx.retenue : 0))), prime = r2(sum(fs.filter(isF), (f) => (f.fx.prime && !fdOf(f.id)?.prime_recue_le ? f.fx.prime : 0)));
  const paye = r2(sum(fs, (f) => f.paye || 0)), due = r2(sum(fs.filter(isF), (f) => f.due ?? f.montant_ttc) - sum(av, (f) => -f.montant_ttc));
  return { d, avs, marche, initial, avenants, rev, act: ht(act), sit: ht(sit), fin: ht(fin), std: ht(std), av: ht(av), factureHT, factureTTC, resteHT: r2(marche + rev - factureHT), retenue, prime, paye, solde: r2(due - paye), nb: fs.length };
}
async function dgdOpen(did) {
  if (!guard()) return;
  const g = dgdData(did), d = g.d, c = clientOf(d.client_id) || {}, e = db.ent;
  const sections = [
    { h: "Parties", rows: [["Entreprise", e.nom || ""], ["Maître d'ouvrage", c.nom || d.client_nom || ""], ["Chantier", d.chantier_nom || "-"], ["Marché de référence", `Devis ${d.numero || ""} du ${D(d.date_devis)}`]] },
    { h: "Montant du marché", rows: [["Marché initial HT", E2(g.initial)], ...g.avs.map((a) => [`Avenant ${a.numero || ""}`, E2(a.montant_ht)]), ["Total des avenants HT", E2(g.avenants)], ["Révision de prix HT", E2(g.rev)], ["Montant du marché révisé HT", E2(r2(g.marche + g.rev)), true]] },
    { h: "Sommes facturées HT", rows: [["Acomptes", E2(g.act)], ["Situations de travaux", E2(g.sit)], ["Facture finale et autres factures", E2(r2(g.fin + g.std))], ["Avoirs", E2(g.av)], ["Total facturé HT", E2(g.factureHT), true], ["Reste à facturer HT", E2(g.resteHT)]] },
    { h: "Règlements", rows: [["Total facturé TTC", E2(g.factureTTC)], ["Retenue de garantie non libérée", E2(g.retenue)], ["Primes à percevoir", E2(g.prime)], ["Déjà réglé par le client", E2(g.paye)], ["Solde à régler par le client", E2(g.solde), true]] },
    { text: "Ce décompte est établi à partir des factures émises dans Pilot. Il doit être vérifié, signé par l'entreprise puis notifié au maître d'ouvrage : en marché privé (norme NF P03-001), le maître d'ouvrage dispose d'un délai pour l'accepter ou le contester, ce qui le rend définitif. Le solde ne tient pas compte des pénalités éventuelles.", grey: true, size: 8.5 },
    { h: "Signatures", text: "Pour l'entreprise : ______________________      Pour le maître d'ouvrage : ______________________\nDate : ____ / ____ / ________", size: 9.5 },
  ];
  toast("Génération du DGD…");
  const bytes = await btpPdf("Décompte général définitif", `${e.nom || ""} · ${d.numero || ""} · établi le ${D(today())}`, sections, "Décompte général définitif");
  await q(sb.from("dgd").insert({ devis_id: did, donnees: g.d ? { ...g, d: undefined, avs: g.avs.map((a) => a.numero) } : {} }));
  openPdfModal("Décompte général définitif", bytes, `dgd-${slug(d.numero || "marche")}.pdf`);
  await refresh();
}
function dgdCard(d) {
  if (d.statut !== "Accepté") return "";
  const g = dgdData(d.id), n = (db.dgds || []).filter((x) => x.devis_id === d.id).length;
  return card("Décompte général définitif", `<dl class="kv"><dt>Marché (avenants inclus)</dt><dd>${E2(g.marche)} HT</dd><dt>Facturé</dt><dd>${E2(g.factureHT)} HT · ${g.nb} facture${g.nb > 1 ? "s" : ""}</dd><dt>Reste à facturer</dt><dd>${E2(g.resteHT)} HT</dd><dt>Solde client</dt><dd><b>${E2(g.solde)}</b> TTC</dd></dl>${n ? `<p class="note">${n} DGD déjà généré${n > 1 ? "s" : ""}.</p>` : ""}`, btn("Générer le DGD", "btDgd", d.id, "", "o sm w"));
}

/* ---------- Attestation de TVA à taux réduit : pré-remplissage ---------- */
function attForm(chId, did) {
  if (!guard()) return;
  const ch = chId ? byId(db.chantiers, chId) : null, d0 = did ? byId(db.devis, did) : null, cl = clientOf(ch?.client_id || d0?.client_id) || {};
  modal("Attestation de TVA à taux réduit", `<div class="frm"><p class="mut full" style="margin:0">Pilot pré-remplit les informations du client et du chantier. Le formulaire officiel (Cerfa n° 1301-SD, attestation simplifiée, ou n° 1300-SD) se remplit et se signe sur impots.gouv.fr : ce document sert d'aide au report. Vérifiez les conditions d'éligibilité auprès de l'administration.</p>
    ${fld({ k: "client_id", l: "Client", t: "select", o: db.clients.map((c) => ({ v: c.id, l: c.nom })), v: cl.id || "" })}
    ${fld({ k: "adresse", l: "Adresse des travaux", v: ch?.adresse ? `${ch.adresse}${ch.ville ? ", " + ch.ville : ""}` : [cl.adresse, cl.ville].filter(Boolean).join(", "), cls: "full" })}
    ${fld({ k: "qualite", l: "Qualité du client", t: "select", o: ["Propriétaire", "Copropriétaire / syndicat", "Locataire", "Occupant à titre gratuit", "Autre"], v: "Propriétaire" })}
    ${fld({ k: "local", l: "Nature du local", t: "select", o: ["Maison individuelle", "Appartement", "Immeuble collectif", "Autre"], v: "Maison individuelle" })}
    ${fld({ k: "usage", l: "Usage", t: "select", o: ["Habitation principale", "Habitation secondaire", "Local mixte (habitation > 50 %)"], v: "Habitation principale" })}
    ${fld({ k: "taux", l: "Taux de TVA visé", t: "select", o: ["10 %", "5,5 % (travaux d'amélioration de la qualité énergétique)"], v: "10 %" })}
    ${fld({ k: "age", l: "Local achevé depuis plus de 2 ans", t: "select", o: ["Oui", "Non : TVA à 20 %"], v: "Oui" })}
    ${fld({ k: "nature", l: "Nature des travaux", t: "textarea", v: d0 ? `Travaux du devis ${d0.numero}` : "", cls: "full" })}</div>`, {
    submit: "Générer le PDF",
    onSubmit: async (v, api) => {
      if (v.age !== "Oui") throw new Error("Le taux réduit suppose un local achevé depuis plus de 2 ans : l'attestation n'est pas applicable.");
      const c = clientOf(v.client_id) || {}, e = db.ent;
      const bytes = await btpPdf("Attestation de TVA à taux réduit : aide au remplissage", `Pré-remplissage établi le ${D(today())} par ${e.nom || "l'entreprise"}. À reporter sur le formulaire officiel Cerfa n° 1301-SD (ou 1300-SD).`, [
        { h: "Client (donneur d'ordre)", rows: [["Nom", c.nom || ""], ["Adresse", [c.adresse, c.ville].filter(Boolean).join(", ")], ["Qualité", v.qualite], ["Email / téléphone", [c.email, c.telephone].filter(Boolean).join(" · ") || "-"]] },
        { h: "Immeuble concerné", rows: [["Adresse des travaux", v.adresse], ["Nature du local", v.local], ["Usage", v.usage], ["Achevé depuis plus de 2 ans", "Oui"]] },
        { h: "Travaux", rows: [["Taux de TVA applicable", v.taux], ["Nature des travaux", v.nature]] },
        { h: "Entreprise", rows: [["Nom", e.nom || ""], ["SIRET", e.siret || "-"], ["Adresse", e.adresse || ""]] },
        { h: "Attestation à signer par le client", text: "Je soussigné(e) atteste que les travaux portent sur un local à usage d'habitation achevé depuis plus de deux ans, et que les travaux ne concourent pas à la production d'un immeuble neuf ni n'entraînent une surélévation ou un agrandissement supérieur aux seuils prévus.\n\nFait à ______________, le ____ / ____ / ________      Signature : ____________________" },
      ], "Aide au remplissage : ne remplace pas le formulaire officiel");
      const chemin = await btpSaveDoc(bytes, `Attestation TVA ${c.nom || ""}`, "Autre", { client_id: c.id || null, chantier_id: chId || null });
      await q(sb.from("attestations_tva").insert({ chantier_id: chId || null, client_id: c.id || null, devis_id: did || null, donnees: v, chemin_pdf: chemin }));
      api.close(); toast("Attestation préparée et rangée dans Documents.", "ok");
      await refresh(); openPdfModal("Attestation de TVA", bytes, `attestation-tva-${slug(c.nom || "client")}.pdf`);
    },
  });
}
function attTab() {
  const L = db.atts || [];
  return card("Attestations de TVA préparées", tbl(["Date", "Client", "Chantier", ""], L.map((a) => ({ t: clientOf(a.client_id)?.nom || "", c: [D(a.created_at), esc(clientOf(a.client_id)?.nom || "-"), esc(a.chantier_id ? byId(db.chantiers, a.chantier_id)?.nom || "-" : "-"), `<span class="r"><button class="lk" data-act="btAttOpen" data-id="${a.id}">Ouvrir</button></span>`] })), "Aucune attestation préparée."), btn("Nouvelle attestation", "btAtt", "", "", "sm w")) +
    `<p class="note">Pilot prépare les informations ; l'attestation officielle est à remplir et à signer par le client. Elle est à conserver 5 ans avec la facture.</p>`;
}

/* ---------- Déchets de chantier ---------- */
function dechetForm(x, chId) {
  if (!guard()) return;
  modal(x ? "Modifier l'enlèvement" : "Enlèvement de déchets", `<div class="frm">${fld({ k: "chantier_id", l: "Chantier", t: "select", o: [{ v: "", l: "Sans chantier" }, ...db.chantiers.map((c) => ({ v: c.id, l: c.nom }))], v: x?.chantier_id || chId || "", r: 0 })}${fld({ k: "date", l: "Date", t: "date", v: x?.date_enlevement || today() })}
    ${fld({ k: "type", l: "Type de déchet", t: "select", o: BT_DECHETS, v: x?.type || BT_DECHETS[0] })}${fld({ k: "unite", l: "Unité", t: "select", o: ["t", "m³", "benne", "kg"], v: x?.unite || "t" })}
    ${fld({ k: "quantite", l: "Quantité", t: "number", v: x ? String(x.quantite).replace(".", ",") : "" })}${fld({ k: "cout", l: "Coût d'enlèvement HT (€)", t: "number", v: x ? String(x.cout_ht).replace(".", ",") : "", r: 0 })}
    ${fld({ k: "prestataire", l: "Prestataire / déchetterie", v: x?.prestataire || "", r: 0 })}${fld({ k: "destination", l: "Filière de traitement", v: x?.destination || "", r: 0, ph: "Centre de tri, ISDI, recyclage…" })}
    ${fld({ k: "bsd", l: "N° de bordereau (BSD) ou de bon", v: x?.bsd_numero || "", r: 0 })}
    <div class="full"><div class="drop"><div><b>Justificatif de traçabilité</b><small style="display:block" class="mut" id="dcname">${x?.justificatif_path ? "Un justificatif est déjà joint." : "Bordereau, bon de dépôt, facture (PDF ou photo)"}</small></div><input type="file" id="dcfile" accept=".pdf,image/*" hidden><button type="button" class="btn o" id="dcpick">Joindre</button></div></div></div>`, {
    extra: x ? `<button type="button" class="lk" style="color:var(--dn)" id="dcdel">Supprimer</button>` : "",
    onMount: (m, api) => {
      $("#dcpick", m).onclick = () => $("#dcfile", m).click();
      $("#dcfile", m).onchange = () => { $("#dcname", m).textContent = $("#dcfile", m).files[0]?.name || ""; };
      $("#dcdel", m)?.addEventListener("click", async () => { if (!confirm("Supprimer cet enlèvement ?")) return; await q(sb.from("dechets").delete().eq("id", x.id)); api.close(); await refresh(); });
    },
    onSubmit: async (v, api) => {
      const f = $("#dcfile", api.el).files[0];
      const row = { chantier_id: v.chantier_id || null, date_enlevement: v.date, type: v.type, unite: v.unite, quantite: Math.max(0, parseNum(v.quantite)), cout_ht: Math.max(0, parseNum(v.cout)), prestataire: v.prestataire || null, destination: v.destination || null, bsd_numero: v.bsd || null };
      if (f) row.justificatif_path = await uploadDoc(f, "dechets");
      if (x) await q(sb.from("dechets").update(row).eq("id", x.id)); else await q(sb.from("dechets").insert(row));
      api.close(); toast("Enlèvement enregistré.", "ok"); await refresh();
    },
  });
}
function dechetsTab() {
  const L = db.dech || [], tot = {};
  L.forEach((x) => { const k = x.unite; tot[k] = r2((tot[k] || 0) + x.quantite); });
  const sans = L.filter((x) => !x.justificatif_path).length;
  return strip([["Enlèvements", String(L.length), ""], ["Coût HT", E(sum(L, (x) => x.cout_ht)), "traitement et transport"], ["Volumes", Object.entries(tot).map(([u, q]) => `${fmtNum(q, 1)} ${u}`).join(" · ") || "-", ""], ["Sans justificatif", String(sans), sans ? "à compléter" : "tout est tracé", sans ? "dn" : ""]]) +
    card("Déchets de chantier", tbl(["Date", "Chantier", "Type", { h: "Quantité", r: 1 }, { h: "Coût HT", r: 1 }, "Traçabilité", ""], L.map((x) => ({ t: `${x.type} ${chNm(x.chantier_id)}`, c: [D(x.date_enlevement), esc(chNm(x.chantier_id)), `<strong>${esc(x.type)}</strong><small>${esc(x.prestataire || "")}${x.destination ? " · " + esc(x.destination) : ""}</small>`, `<span class="num">${fmtNum(x.quantite, 2)} ${esc(x.unite)}</span>`, `<span class="num">${E2(x.cout_ht)}</span>`,
      x.justificatif_path ? `<button class="lk" data-act="btDcOpen" data-id="${x.id}">Justificatif</button>${x.bsd_numero ? `<small>BSD ${esc(x.bsd_numero)}</small>` : ""}` : `<span class="chip wn">Manquant</span>`, `<span class="r"><button class="lk w" data-act="btDc" data-id="${x.id}">Modifier</button></span>`] })), "Aucun enlèvement enregistré."), btn("Nouvel enlèvement", "btDc", "", "", "sm w")) +
    `<p class="note">Conservez les bordereaux de suivi (BSD pour les déchets dangereux) et les bons de dépôt : ils prouvent la filière de traitement. Si le coût figure déjà dans vos dépenses du chantier, ne le saisissez pas deux fois dans la rentabilité.</p>`;
}
function dechetsCard(id) {
  const L = (db.dech || []).filter((x) => x.chantier_id === id);
  return card("Déchets de chantier", L.length ? `<dl class="kv"><dt>Enlèvements</dt><dd>${L.length}</dd><dt>Coût HT</dt><dd>${E2(sum(L, (x) => x.cout_ht))}</dd><dt>Justificatifs</dt><dd>${L.filter((x) => x.justificatif_path).length} / ${L.length}</dd></dl>` : `<p class="mut" style="margin:0;padding:16px 18px">Aucun enlèvement suivi sur ce chantier.</p>`, btn("Ajouter", "btDc", "", "chantier:" + id, "o sm w") + (L.length ? ` ${btn("Voir tout", "go", "marches", "", "o sm")}` : ""));
}

/* ---------- Cartes et onglets ---------- */
const btpTabs = () => (db.v14 ? [["indices", "Indices (révision)", async () => indicesTab()], ["dechets", "Déchets", async () => dechetsTab()], ["attestations", "Attestations TVA", async () => attTab()]] : []);
function btpDevisCards(d, lignes) {
  const auto = (db.fd || {})[d.id] ? "" : "";
  return aidesCard(d) + proformaCard(d) + revisionCard(d) + dgdCard(d) + auto;
}
function btpChantierCards(id) {
  return dechetsCard(id) + card("Attestation de TVA", `<p class="mut" style="margin:0;padding:16px 18px">Préparez l'attestation de TVA à taux réduit du client pour ce chantier.</p>`, btn("Préparer", "btAtt", "", "chantier:" + id, "o sm w"));
}
// Aides validées reprises dans la facture finale
const btPrimeDefaut = (did) => { const L = aidesOf(did).filter((a) => ["Validée", "Perçue"].includes(a.statut)); return L.length ? { prime_montant: r2(sum(L, (a) => a.montant)), prime_libelle: [...new Set(L.map((a) => a.type))].join(" + ") } : {}; };

const btpActions = {
  btPfNew: (id) => proformaForm(id), btPfPdf: (id) => proformaPdf(id),
  btAide: (id, arg) => aideForm(id, arg ? byId(db.aides, arg) : null),
  btRev: (id) => revisionForm(id), btIndNew: () => indiceForm(),
  btIndDel: async (id) => { if (!guard() || !confirm("Supprimer cette valeur d'indice ?")) return; await q(sb.from("indices_valeurs").delete().eq("id", id)); await refresh(); },
  btDgd: (id) => dgdOpen(id),
  btAtt: (id, arg) => attForm((arg || "").startsWith("chantier:") ? arg.slice(9) : "", ""),
  btAttOpen: (id) => { const a = byId(db.atts, id); if (a?.chemin_pdf) return openFile(a.chemin_pdf); },
  btDc: (id, arg) => dechetForm(id ? byId(db.dech, id) : null, (arg || "").startsWith("chantier:") ? arg.slice(9) : ""),
  btDcOpen: (id) => { const x = byId(db.dech, id); if (x?.justificatif_path) return openFile(x.justificatif_path); },
};
