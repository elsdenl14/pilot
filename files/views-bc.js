/* Bons de commande fournisseurs : lignes (catalogue ou libres), PDF, envoi par email, réception, facture d'achat liée.
   Chaque bon de commande envoyé crée automatiquement une « commande » dans le suivi des chantiers (budget engagé). */

const BC_ST = ["Brouillon", "Envoyé", "Confirmé", "Reçu partiellement", "Reçu", "Facturé", "Annulé"];
Object.assign(CHIP, { "Envoyé": "ac", "Confirmé": "ac", "Reçu partiellement": "wn", "Reçu": "ok", "Facturé": "ok", "Annulé": "dn" });
const BC_ACHAT = { "Envoyé": "Commandée", "Confirmé": "Commandée", "Reçu partiellement": "Commandée", "Reçu": "Livrée", "Facturé": "Facturée", "Annulé": "Annulée" };
const bcOf = (id) => byId(db.bcs, id);
const bcLines = (id) => db.bcl.filter((l) => l.bc_id === id).sort((a, b) => a.position - b.position);
const bcLate = (b) => ["Envoyé", "Confirmé", "Reçu partiellement"].includes(b.statut) && b.date_livraison && b.date_livraison < today();
function bcTot(lines) {
  const ht = r2(sum(lines, (l) => l.quantite * l.prix_unitaire_ht)), tva = r2(sum(lines, (l) => (l.quantite * l.prix_unitaire_ht * l.tva_taux) / 100));
  return { ht, tva, ttc: r2(ht + tva) };
}
const bcTotOf = (b) => bcTot(bcLines(b.id));
function bcNumero() {
  const y = new Date().getFullYear(), p = `BC-${y}-`;
  const n = Math.max(0, ...db.bcs.filter((b) => b.numero.startsWith(p)).map((b) => parseInt(b.numero.slice(p.length), 10) || 0)) + 1;
  return p + String(n).padStart(3, "0");
}

/* ---------- Synchronisation avec le suivi des commandes ---------- */
async function bcSyncAchat(id) {
  const b = (await q(sb.from("bons_commande").select("*").eq("id", id).single())), lines = (await q(sb.from("bons_commande_lignes").select("*").eq("bc_id", id)));
  lines.forEach((l) => nz(l, ["quantite", "prix_unitaire_ht", "tva_taux"]));
  const t = bcTot(lines), st = BC_ACHAT[b.statut];
  if (!st) return;
  const row = { fournisseur_id: b.fournisseur_id, chantier_id: b.chantier_id, type: "Commande", numero: b.numero, date_doc: b.date_commande, date_livraison: b.date_livraison, statut: st,
    categorie: byId(db.fournisseurs, b.fournisseur_id)?.categorie || "Matériaux", montant_ht: t.ht, montant_tva: t.tva, notes: "Bon de commande " + b.numero };
  if (b.achat_id) await q(sb.from("achats_fournisseurs").update(row).eq("id", b.achat_id));
  else { const a = await q(sb.from("achats_fournisseurs").insert(row).select("id").single()); await q(sb.from("bons_commande").update({ achat_id: a.id }).eq("id", id)); }
}
async function bcSetStatut(id, statut, extra = {}) {
  await q(sb.from("bons_commande").update({ statut, ...extra }).eq("id", id));
  await bcSyncAchat(id);
}

/* ---------- Formulaire ---------- */
function bcForm(b, pre = {}) {
  if (!guard()) return;
  if (!db.fournisseurs.length) { toast("Créez d'abord la fiche du fournisseur.", "dn"); return fournisseurForm(null, {}); }
  if (b && ["Reçu", "Facturé", "Annulé"].includes(b.statut)) return toast("Ce bon de commande n'est plus modifiable.", "dn");
  const g = (k, d = "") => b?.[k] ?? pre[k] ?? d;
  const sup0 = g("fournisseur_id", db.fournisseurs[0].id);
  const lines0 = b ? bcLines(b.id) : pre.lines || [];
  const lineRow = (l = {}) => `<tr class="bcl"><td><input class="l-ref" value="${esc(l.reference || "")}" placeholder="Réf."></td><td><input class="l-des" value="${esc(l.designation || "")}" placeholder="Désignation"></td>
    <td><input class="l-u" value="${esc(l.unite || "u")}" style="width:52px"></td><td><input class="l-q" inputmode="decimal" value="${l.quantite != null ? String(l.quantite).replace(".", ",") : "1"}" style="width:64px"></td>
    <td><input class="l-p" inputmode="decimal" value="${l.prix_unitaire_ht != null ? String(l.prix_unitaire_ht).replace(".", ",") : ""}" style="width:80px"></td>
    <td><select class="l-t">${RATES.map((r) => `<option value="${r}"${Number(r) === Number(l.tva_taux ?? 20) ? " selected" : ""}>${String(r).replace(".", ",")} %</option>`).join("")}</select></td>
    <td><button type="button" class="lk l-x" aria-label="Supprimer la ligne">✕</button></td></tr>`;
  const body = `<div class="frm">
    ${fld({ k: "fournisseur_id", l: "Fournisseur", t: "select", o: db.fournisseurs.map((f) => ({ v: f.id, l: f.nom })), v: sup0 })}
    ${fld({ k: "chantier_id", l: "Chantier", t: "select", o: [{ v: "", l: "Aucun" }, ...db.chantiers.map((c) => ({ v: c.id, l: c.nom }))], v: g("chantier_id", ""), r: 0 })}
    ${fld({ k: "date_commande", l: "Date de commande", t: "date", v: g("date_commande", today()) })}
    ${fld({ k: "date_livraison", l: "Livraison souhaitée", t: "date", v: g("date_livraison", ""), r: 0 })}
    ${fld({ k: "adresse_livraison", l: "Adresse de livraison", v: g("adresse_livraison", ""), r: 0, cls: "full", ph: "Chantier, dépôt… (laisser vide = adresse de l'entreprise)" })}
    <div class="sect-t">Articles commandés</div>
    <div class="full"><div class="tw"><table class="bct"><thead><tr><th>Réf.</th><th>Désignation</th><th>Unité</th><th>Qté</th><th>PU HT</th><th>TVA</th><th></th></tr></thead><tbody id="bcl">${lines0.map(lineRow).join("")}</tbody></table></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><select id="bc_cat" style="max-width:280px"></select><button type="button" class="btn o sm" id="bc_addcat">Ajouter du catalogue</button><button type="button" class="btn o sm" id="bc_add">Ligne libre</button></div>
      <p class="mut" id="bc_tot" style="margin:10px 0 0;text-align:right"></p></div>
    ${fld({ k: "reference_fournisseur", l: "Votre référence chez le fournisseur", v: g("reference_fournisseur", ""), r: 0 })}
    ${fld({ k: "conditions", l: "Conditions (paiement, livraison)", v: g("conditions", ""), r: 0 })}
    ${fld({ k: "notes", l: "Notes internes", t: "textarea", v: g("notes", ""), r: 0, cls: "full" })}</div>`;
  modal(b ? `Modifier ${esc(b.numero)}` : "Nouveau bon de commande", body, {
    wide: true,
    onMount: (m, api) => {
      const tb = $("#bcl", m), cat = $("#bc_cat", m), sup = $("#f_fournisseur_id", m);
      const readLines = () => [...tb.querySelectorAll("tr")].map((tr) => ({ reference: $(".l-ref", tr).value.trim(), designation: $(".l-des", tr).value.trim(), unite: $(".l-u", tr).value.trim() || "u",
        quantite: parseNum($(".l-q", tr).value), prix_unitaire_ht: parseNum($(".l-p", tr).value), tva_taux: Number($(".l-t", tr).value) }));
      const tot = () => { const t = bcTot(readLines().filter((l) => l.designation)); $("#bc_tot", m).innerHTML = `Total : <b>${E2(t.ht)}</b> HT · TVA ${E2(t.tva)} · <b>${E2(t.ttc)} TTC</b>`; };
      const wire = () => { tb.querySelectorAll("tr").forEach((tr) => { tr.querySelectorAll("input,select").forEach((i) => (i.oninput = i.onchange = tot)); $(".l-x", tr).onclick = () => { tr.remove(); tot(); }; }); };
      const fillCat = () => { const l = catOf(sup.value).filter((a) => a.actif); cat.innerHTML = l.length ? l.map((a) => `<option value="${a.id}">${esc(a.designation)}${a.reference ? " (" + esc(a.reference) + ")" : ""} · ${E2(a.prix_ht)}</option>`).join("") : `<option value="">Catalogue vide pour ce fournisseur</option>`; $("#bc_addcat", m).disabled = !l.length; };
      $("#bc_add", m).onclick = () => { tb.insertAdjacentHTML("beforeend", lineRow()); wire(); tb.lastElementChild.querySelector(".l-des").focus(); };
      $("#bc_addcat", m).onclick = () => { const a = byId(db.cat, cat.value); if (!a) return; tb.insertAdjacentHTML("beforeend", lineRow({ reference: a.reference, designation: a.designation, unite: a.unite, quantite: 1, prix_unitaire_ht: a.prix_ht, tva_taux: a.tva_taux })); wire(); tot(); };
      sup.onchange = fillCat;
      const chs = $("#f_chantier_id", m), adr = $("#f_adresse_livraison", m);
      chs.onchange = () => { const c = byId(db.chantiers, chs.value); if (c && !adr.value) adr.value = [c.adresse, c.ville].filter(Boolean).join(", "); };
      if (!lines0.length) tb.insertAdjacentHTML("beforeend", lineRow());
      fillCat(); wire(); tot();
      m.__readLines = readLines;
    },
    onSubmit: async (v, api) => {
      const lines = api.el.__readLines().filter((l) => l.designation);
      if (!lines.length) throw new Error("Ajoutez au moins un article.");
      if (lines.some((l) => !(l.quantite > 0))) throw new Error("Chaque quantité doit être supérieure à 0.");
      if (lines.some((l) => l.prix_unitaire_ht < 0)) throw new Error("Un prix ne peut pas être négatif.");
      const row = { fournisseur_id: v.fournisseur_id, chantier_id: v.chantier_id || null, date_commande: v.date_commande, date_livraison: v.date_livraison || null, adresse_livraison: v.adresse_livraison || null,
        reference_fournisseur: v.reference_fournisseur || null, conditions: v.conditions || null, notes: v.notes || null };
      let id = b?.id;
      if (b) { await q(sb.from("bons_commande").update(row).eq("id", id)); await q(sb.from("bons_commande_lignes").delete().eq("bc_id", id)); }
      else id = (await q(sb.from("bons_commande").insert({ ...row, numero: bcNumero() }).select("id").single())).id;
      const keepRecu = b ? Object.fromEntries(bcLines(id).map((l) => [(l.reference || "") + "|" + l.designation, l.recu])) : {};
      await q(sb.from("bons_commande_lignes").insert(lines.map((l, i) => ({ ...l, bc_id: id, position: i, article_id: db.cat.find((a) => a.fournisseur_id === v.fournisseur_id && a.reference && a.reference === l.reference)?.id || null, recu: keepRecu[l.reference + "|" + l.designation] || 0 }))));
      if (b && b.statut !== "Brouillon") await bcSyncAchat(id);
      api.close(); toast("Bon de commande enregistré.", "ok"); await refresh(); go(`bc/${id}`);
    },
  });
}

/* ---------- PDF ---------- */
async function bcPdfBytes(b) {
  await loadScript(LIBS.pdflib);
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const T = PilotPdf.clean, W = 595.28, H = 841.89, M = 44, INK = rgb(0.1, 0.11, 0.13), GREY = rgb(0.4, 0.42, 0.45), ACC = rgb(0.14, 0.23, 0.35), LINE = rgb(0.82, 0.84, 0.87);
  const e = db.ent, f = byId(db.fournisseurs, b.fournisseur_id) || {}, ch = byId(db.chantiers, b.chantier_id), lines = bcLines(b.id), t = bcTot(lines);
  let page, y;
  const np = () => { page = pdf.addPage([W, H]); y = H - 54; page.drawRectangle({ x: 0, y: H - 8, width: W, height: 8, color: ACC }); };
  const wrap = (s, fo, sz, w) => { const out = []; for (const p of T(s).split("\n")) { let l = ""; for (const x of p.split(" ")) { const k = l ? l + " " + x : x; if (fo.widthOfTextAtSize(k, sz) <= w || !l) l = k; else { out.push(l); l = x; } } out.push(l); } return out; };
  const txt = (s, x, yy, o = {}) => page.drawText(T(s), { x, y: yy, size: o.size || 10, font: o.bold ? bold : font, color: o.color || INK });
  const right = (s, xr, yy, o = {}) => { const fo = o.bold ? bold : font; txt(s, xr - fo.widthOfTextAtSize(T(s), o.size || 10), yy, o); };
  np();
  txt(e.nom || "Entreprise", M, y, { size: 14, bold: true }); y -= 15;
  for (const l of [e.adresse, [e.telephone, e.email].filter(Boolean).join(" - "), e.siret ? "SIRET " + e.siret : "", e.tva_intracom ? "TVA " + e.tva_intracom : ""].filter(Boolean)) { txt(l, M, y, { size: 8.5, color: GREY }); y -= 11; }
  txt("BON DE COMMANDE", W - M - bold.widthOfTextAtSize("BON DE COMMANDE", 18), H - 62, { size: 18, bold: true, color: ACC });
  right(b.numero, W - M, H - 80, { size: 11 }); right("Date : " + D(b.date_commande), W - M, H - 94, { size: 9, color: GREY });
  y -= 14;
  const bx = (x, w, title, ls) => { page.drawRectangle({ x, y: y - 82, width: w, height: 84, borderColor: LINE, borderWidth: 0.8 }); txt(title, x + 10, y - 14, { size: 8, bold: true, color: ACC }); let yy = y - 28; ls.filter(Boolean).slice(0, 5).forEach((l, i) => { wrap(l, i ? font : bold, 9.5, w - 20).slice(0, 1).forEach((w1) => { txt(w1, x + 10, yy, { size: 9.5, bold: !i }); yy -= 12; }); }); };
  const cw = (W - 2 * M - 14) / 2;
  bx(M, cw, "FOURNISSEUR", [f.nom, f.adresse, f.ville, f.code_client ? "N° client : " + f.code_client : "", f.email || f.telephone]);
  bx(M + cw + 14, cw, "LIVRAISON", [b.adresse_livraison ? "À l'adresse indiquée" : e.nom, b.adresse_livraison || e.adresse, b.date_livraison ? "Souhaitée le " + D(b.date_livraison) : "", ch ? "Chantier : " + ch.nom : "", b.reference_fournisseur ? "Réf. : " + b.reference_fournisseur : ""]);
  y -= 100;
  const cols = [M, M + 62, M + 290, M + 330, M + 382, M + 440], hdr = ["Réf.", "Désignation", "Qté", "Unité", "PU HT", "Total HT"];
  const head = () => { page.drawRectangle({ x: M, y: y - 4, width: W - 2 * M, height: 18, color: ACC }); hdr.forEach((h, i) => { const c = rgb(1, 1, 1); if (i >= 4) page.drawText(T(h), { x: W - M - (i === 4 ? 70 : 6) - bold.widthOfTextAtSize(T(h), 8.5), y: y + 1, size: 8.5, font: bold, color: c }); else page.drawText(T(h), { x: cols[i] + 4, y: y + 1, size: 8.5, font: bold, color: c }); }); y -= 20; };
  head();
  for (const l of lines) {
    const ds = wrap(l.designation, font, 9, 222), hh = Math.max(15, ds.length * 11 + 5);
    if (y - hh < 120) { np(); head(); }
    txt(l.reference || "", cols[0] + 4, y - 8, { size: 8.5, color: GREY });
    ds.forEach((d, i) => txt(d, cols[1] + 4, y - 8 - i * 11, { size: 9 }));
    txt(String(l.quantite).replace(".", ","), cols[2] + 4, y - 8, { size: 9 }); txt(l.unite || "", cols[3] + 4, y - 8, { size: 9 });
    right(E2(l.prix_unitaire_ht), W - M - 70, y - 8, { size: 9 }); right(E2(l.quantite * l.prix_unitaire_ht), W - M - 6, y - 8, { size: 9 });
    y -= hh; page.drawLine({ start: { x: M, y: y + 2 }, end: { x: W - M, y: y + 2 }, thickness: 0.4, color: LINE });
  }
  if (y < 190) np();
  y -= 10;
  [["Total HT", E2(t.ht)], ["TVA", E2(t.tva)], ["Total TTC", E2(t.ttc)]].forEach(([k, v], i) => { const bo = i === 2; txt(k, W - M - 190, y, { size: bo ? 11 : 9.5, bold: bo }); right(v, W - M - 6, y, { size: bo ? 11 : 9.5, bold: bo }); y -= bo ? 18 : 14; });
  y -= 6;
  if (b.conditions) { txt("Conditions", M, y, { size: 9, bold: true, color: ACC }); y -= 12; for (const l of wrap(b.conditions, font, 9, W - 2 * M)) { txt(l, M, y, { size: 9 }); y -= 11; } y -= 6; }
  txt("Merci de nous confirmer la réception de cette commande, la date de livraison et de rappeler le numéro " + b.numero + " sur votre facture.", M, y, { size: 8.5, color: GREY });
  y -= 24;
  page.drawRectangle({ x: W - M - 200, y: y - 66, width: 200, height: 68, borderColor: LINE, borderWidth: 0.8 }); txt("Bon pour accord (fournisseur)", W - M - 190, y - 12, { size: 8.5, bold: true, color: ACC });
  pdf.setTitle(`${b.numero} - bon de commande`); pdf.setProducer("Pilot");
  return pdf.save();
}

/* ---------- Réception ---------- */
function bcReceive(id) {
  if (!guard()) return;
  const b = bcOf(id), lines = bcLines(id).filter((l) => l.recu < l.quantite);
  if (!lines.length) return toast("Tout est déjà reçu.", "ok");
  modal(`Réception · ${esc(b.numero)}`, `<p class="mut" style="margin:0 0 10px">Indiquez les quantités reçues aujourd'hui (pré-rempli avec le reste à recevoir).</p>
    ${fld({ k: "date_reception", l: "Date de réception", t: "date", v: today() })}
    <div class="tw"><table><thead><tr><th>Article</th><th class="r">Commandé</th><th class="r">Déjà reçu</th><th class="r">Reçu ce jour</th></tr></thead><tbody>${lines.map((l) => `<tr data-lid="${l.id}"><td>${esc(l.designation)}</td><td class="r">${String(l.quantite).replace(".", ",")} ${esc(l.unite || "")}</td><td class="r">${String(l.recu).replace(".", ",")}</td><td class="r"><input class="rq" inputmode="decimal" style="width:72px" value="${String(r2(l.quantite - l.recu)).replace(".", ",")}"></td></tr>`).join("")}</tbody></table></div>
    ${fld({ k: "note", l: "Note (bon de livraison, anomalies…)", v: "", r: 0, cls: "full" })}`, {
    onSubmit: async (v, api) => {
      const rows = [...api.el.querySelectorAll("tr[data-lid]")].map((tr) => ({ l: byId(db.bcl, tr.dataset.lid), q: parseNum($(".rq", tr).value) })).filter((x) => x.q > 0);
      if (!rows.length) throw new Error("Indiquez au moins une quantité reçue.");
      for (const x of rows) await q(sb.from("bons_commande_lignes").update({ recu: r2(x.l.recu + x.q) }).eq("id", x.l.id));
      await q(sb.from("bc_receptions").insert({ bc_id: id, date_reception: v.date_reception, note: v.note || null, detail: rows.map((x) => ({ designation: x.l.designation, quantite: x.q, unite: x.l.unite })) }));
      const all = bcLines(id).map((l) => ({ ...l, recu: l.recu + (rows.find((x) => x.l.id === l.id)?.q || 0) }));
      const full = all.every((l) => l.recu + 0.0001 >= l.quantite);
      await bcSetStatut(id, full ? "Reçu" : "Reçu partiellement");
      api.close(); toast(full ? "Commande reçue en totalité." : "Réception partielle enregistrée.", "ok"); await refresh();
    },
  });
}

/* ---------- Fiche ---------- */
V.bc = (r) => bcDetail(r.arg);
function bcDetail(id) {
  const b = bcOf(id);
  if (!b) return `<div class="empty"><h2>Bon de commande introuvable</h2><button class="btn" data-go="achats">Retour aux achats</button></div>`;
  const f = byId(db.fournisseurs, b.fournisseur_id) || {}, ch = byId(db.chantiers, b.chantier_id), lines = bcLines(id), t = bcTot(lines), recs = db.bcr.filter((x) => x.bc_id === id);
  const deps = db.depenses.filter((d) => d.bc_id === id), late = bcLate(b);
  const open = !["Reçu", "Facturé", "Annulé"].includes(b.statut);
  const next = b.statut === "Brouillon" ? btn("Envoyer au fournisseur", "bcSend", id, "", "w") : b.statut === "Envoyé" ? btn("Marquer confirmé", "bcConfirm", id, "", "w") : "";
  const recv = ["Envoyé", "Confirmé", "Reçu partiellement"].includes(b.statut) ? btn("Réceptionner", "bcReceive", id, "", b.statut === "Brouillon" ? "o" : "w") : "";
  const fact = ["Reçu", "Reçu partiellement", "Confirmé", "Envoyé"].includes(b.statut) ? btn("Saisir la facture", "bcInvoice", id, "", "o") : "";
  const actions = next + recv + fact + btn("PDF", "bcPdf", id, "", "o") + (open ? btn("Modifier", "bcEdit", id, "", "o w") : "") + btn("Dupliquer", "bcDup", id, "", "o w") +
    (b.statut === "Brouillon" ? btn("Supprimer", "bcDel", id, "", "dn-o w") : open ? btn("Annuler la commande", "bcCancel", id, "", "dn-o w") : "");
  const rows = lines.map((l) => ({ c: [`<strong>${esc(l.designation)}</strong><small>${esc(l.reference || "")}</small>`, `${String(l.quantite).replace(".", ",")} ${esc(l.unite || "")}`,
    `<span class="num">${E2(l.prix_unitaire_ht)}</span>`, `<span class="num">${E2(l.quantite * l.prix_unitaire_ht)}</span>`,
    l.recu >= l.quantite ? `<span class="chip ok">Reçu</span>` : l.recu > 0 ? `<span class="chip wn">${String(l.recu).replace(".", ",")} / ${String(l.quantite).replace(".", ",")}</span>` : `<span class="chip n">En attente</span>`] }));
  return page(esc(b.numero), `Bon de commande · ${esc(f.nom || "")}`, actions,
    `${late ? `<div class="fin-alert dn"><b>Livraison en retard</b><span>Prévue le ${D(b.date_livraison)} : relancez ${esc(f.nom || "le fournisseur")}.</span></div>` : ""}
    ${strip([["Statut", b.statut, b.envoye_le ? "envoyé le " + D(b.envoye_le) : ""], ["Total HT", E2(t.ht), `TVA ${E2(t.tva)}`], ["Total TTC", E2(t.ttc), `${lines.length} ligne${lines.length > 1 ? "s" : ""}`], ["Livraison", b.date_livraison ? D(b.date_livraison) : "-", late ? "en retard" : "souhaitée", late ? "dn" : ""]])}
    <div class="g2"><div>${card("Articles", tbl(["Article", "Quantité", { h: "PU HT", r: 1 }, { h: "Total HT", r: 1 }, "Réception"], rows))}
      ${recs.length ? card("Réceptions", recs.map((x) => `<div class="row"><div><b>${D(x.date_reception)}</b><small>${esc((x.detail || []).map((d) => `${String(d.quantite).replace(".", ",")} ${d.unite || ""} ${d.designation}`).join(" · "))}${x.note ? " · " + esc(x.note) : ""}</small></div></div>`).join("")) : ""}</div>
    <div>${card("Informations", `<dl class="kv"><dt>Statut</dt><dd>${chip(b.statut)}</dd><dt>Fournisseur</dt><dd><a href="#/fournisseurs/${f.id}">${esc(f.nom || "-")}</a></dd><dt>Chantier</dt><dd>${ch ? `<a href="#/chantiers/${ch.id}">${esc(ch.nom)}</a>` : "-"}</dd>
      <dt>Date</dt><dd>${D(b.date_commande)}</dd><dt>Livraison à</dt><dd>${esc(b.adresse_livraison || "Adresse de l'entreprise")}</dd>${b.reference_fournisseur ? `<dt>Votre réf.</dt><dd>${esc(b.reference_fournisseur)}</dd>` : ""}${b.conditions ? `<dt>Conditions</dt><dd>${esc(b.conditions)}</dd>` : ""}${b.notes ? `<dt>Notes</dt><dd>${esc(b.notes).replace(/\n/g, "<br>")}</dd>` : ""}</dl>`)}
      ${card("Factures reçues", deps.length ? deps.map((d) => `<div class="row lnk" data-act="depEdit" data-id="${d.id}"><div><b>${esc(d.reference || "Facture")}</b><small>${D(d.date_depense)}</small></div><span class="num">${E2(d.montant_ttc)}</span>${chip(d.statut)}</div>`).join("") : `<p class="mut" style="margin:0;padding:16px 18px">Aucune facture rattachée.</p>`)}</div></div>`,
    crumbs(["Achats", "achats"], [b.numero]));
}

// Livraisons en retard dans les priorités
function bcPriorites(add, t) {
  if (!db.v11) return;
  for (const b of db.bcs) if (bcLate(b)) add("i", 140, `Livraison en retard : ${b.numero}`, `${supName(b.fournisseur_id)} · prévue le ${D(b.date_livraison)}`, bcTotOf(b).ttc, { label: "Ouvrir", act: "bcOpen", id: b.id }, "bc/" + b.id);
}

const bcActions = {
  bcNew: (id, arg) => bcForm(null, { fournisseur_id: id || undefined, chantier_id: arg || undefined }),
  bcOpen: (id) => go(`bc/${id}`),
  bcEdit: (id) => bcForm(bcOf(id)),
  bcPdf: async (id) => { const b = bcOf(id); openPdfModal(`Bon de commande ${b.numero}`, await bcPdfBytes(b), `${slug(b.numero)}.pdf`); },
  bcReceive: (id) => bcReceive(id),
  bcDel: (id) => del("bons_commande", id, "Supprimer ce brouillon ?", "achats"),
  bcConfirm: async (id) => { if (!guard()) return; await bcSetStatut(id, "Confirmé"); toast("Commande confirmée par le fournisseur.", "ok"); await refresh(); },
  bcCancel: async (id) => { if (!guard() || !confirm("Annuler cette commande ? Elle ne sera plus comptée dans le budget engagé du chantier.")) return; await bcSetStatut(id, "Annulé"); await refresh(); },
  bcDup: (id) => { const b = bcOf(id); bcForm(null, { fournisseur_id: b.fournisseur_id, chantier_id: b.chantier_id, adresse_livraison: b.adresse_livraison, conditions: b.conditions, lines: bcLines(id).map((l) => ({ ...l, recu: 0 })) }); },
  bcSend: async (id) => {
    if (!guard()) return;
    const b = bcOf(id), f = byId(db.fournisseurs, b.fournisseur_id) || {}, t = bcTotOf(b);
    const m = typeof mlRender === "function" ? mlRender("bc_envoi", { d: { numero: b.numero, montant_ttc: t.ttc, date_emission: b.date_commande, echeance: b.date_livraison, chantier_id: b.chantier_id }, c: { nom: f.nom, type: "Professionnel" } }) : { sujet: `Bon de commande ${b.numero}`, corps: "" };
    const done = async () => { await bcSetStatut(id, "Envoyé", { envoye_le: new Date().toISOString() }); await refresh(); };
    if (typeof mlCompose !== "function") { await done(); return; }
    mlCompose({ titre: `Envoyer ${esc(b.numero)} à ${esc(f.nom || "")}`, to: f.email || "", ...m, doc_type: "bc", doc_id: id, pdf: { nom: `${slug(b.numero)}.pdf`, bytes: () => bcPdfBytes(bcOf(id)) }, onSent: done });
  },
  bcInvoice: (id) => {
    if (!guard()) return;
    const b = bcOf(id), f = byId(db.fournisseurs, b.fournisseur_id) || {}, t = bcTotOf(b);
    depForm(null, { chantier: b.chantier_id || "", prefill: { fournisseur: f.nom, categorie: f.categorie || "Matériaux", type: "Achat", montant_ht: t.ht, montant_tva: t.tva, date_depense: today(), echeance: f.delai_paiement_jours ? addDays(today(), f.delai_paiement_jours) : "", notes: "Bon de commande " + b.numero },
      onSaved: async (depId) => {
        await q(sb.from("depenses").update({ bc_id: id }).eq("id", depId));
        await bcSetStatut(id, "Facturé");
        const a = byId(db.achats, b.achat_id); if (a) a.statut = "Facturée";
      } });
  },
};
