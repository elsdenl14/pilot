/* Procès-verbaux de réception des travaux, signés en ligne par le client.
   Le client signe depuis p.html?pv=<jeton> (signature dessinée). Pilot garde la preuve (nom, date, empreinte du PDF consulté),
   fabrique le PV signé avec certificat, le range dans Documents (Attestations) et suit la levée des réserves.
   Réception : art. 1792-6 du Code civil. La retenue de garantie est libérable 1 an après la réception si les réserves sont levées. */

const pvTypes = ["Sans réserve", "Avec réserves", "Refusée"];
const pvOf = (id) => byId(db.pv.list, id);
const pvRes = (id) => db.pv.reserves.filter((r) => r.pv_id === id);
const pvUrl = (pv) => { const u = new URL(shareLink(pv.token), location.href); u.searchParams.delete("t"); u.searchParams.set("pv", pv.token); return u.toString(); };
const pvOpen = (pv) => pvRes(pv.id).filter((r) => !r.levee);
CHIP["Brouillon"] ??= "n"; CHIP["Signé"] = "ok"; CHIP["Réserves levées"] = "ok"; CHIP["Refusée"] = "dn"; CHIP["Avec réserves"] = "wn"; CHIP["Sans réserve"] = "ok";

function pvNumero() {
  const y = new Date().getFullYear(), n = db.pv.list.filter((p) => String(p.numero || "").startsWith(`PV-${y}-`)).length + 1;
  return `PV-${y}-${String(n).padStart(3, "0")}`;
}

/* ---------- PDF ---------- */
async function pvPdfBytes(pv, sig) {
  await loadScript(LIBS.pdflib);
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const T = PilotPdf.clean, W = 595.28, H = 841.89, M = 48, INK = rgb(0.1, 0.11, 0.13), GREY = rgb(0.4, 0.42, 0.45), ACC = rgb(0.14, 0.23, 0.35), LINE = rgb(0.8, 0.82, 0.85);
  const e = db.ent, ch = byId(db.chantiers, pv.chantier_id) || {}, c = clientOf(pv.client_id) || {}, res = pvRes(pv.id);
  let page, y;
  const newPage = () => { page = pdf.addPage([W, H]); y = H - 56; page.drawRectangle({ x: 0, y: H - 8, width: W, height: 8, color: ACC }); };
  const wrap = (t, f, s, w) => { const out = []; for (const para of T(t).split("\n")) { let l = ""; for (const x of para.split(" ")) { const k = l ? l + " " + x : x; if (f.widthOfTextAtSize(k, s) <= w || !l) l = k; else { out.push(l); l = x; } } out.push(l); } return out; };
  const need = (h) => { if (y - h < 70) newPage(); };
  const text = (t, o = {}) => { const s = o.size || 10, f = o.bold ? bold : font; for (const l of wrap(t, f, s, o.w || W - 2 * M)) { need(s + 4); page.drawText(l, { x: o.x ?? M, y, size: s, font: f, color: o.color || INK }); y -= s + 4; } };
  newPage();
  page.drawText(T(e.nom || "Entreprise"), { x: M, y, size: 14, font: bold, color: INK }); y -= 15;
  for (const l of [e.adresse, [e.telephone, e.email].filter(Boolean).join(" - "), e.siret ? "SIRET " + e.siret : ""].filter(Boolean)) { page.drawText(T(l), { x: M, y, size: 8.5, font, color: GREY }); y -= 11; }
  y -= 14;
  page.drawText(T("PROCÈS-VERBAL DE RÉCEPTION DES TRAVAUX"), { x: M, y, size: 17, font: bold, color: ACC }); y -= 20;
  page.drawText(T(`${pv.numero || ""}  -  réception ${pv.type === "Sans réserve" ? "sans réserve" : pv.type === "Avec réserves" ? "avec réserves" : "refusée"}`), { x: M, y, size: 10.5, font, color: GREY }); y -= 26;
  const kv = (k, v) => { if (!v) return; need(16); page.drawText(T(k), { x: M, y, size: 9, font, color: GREY }); const ls = wrap(v, bold, 10, W - 2 * M - 140); ls.forEach((l, i) => { page.drawText(l, { x: M + 140, y: y - i * 13, size: 10, font: bold, color: INK }); }); y -= Math.max(1, ls.length) * 13 + 5; };
  kv("Maître d'ouvrage (client)", [c.nom, c.adresse, c.ville].filter(Boolean).join(", "));
  kv("Entreprise", [e.nom, e.siret ? "SIRET " + e.siret : ""].filter(Boolean).join(", "));
  kv("Chantier", [ch.nom, ch.adresse, ch.ville].filter(Boolean).join(", "));
  kv("Lieu de la réception", pv.lieu);
  kv("Objet des travaux", pv.objet);
  kv("Date de réception", D(pv.date_reception));
  y -= 8;
  const decl = pv.type === "Sans réserve" ? "Le maître d'ouvrage déclare réceptionner les travaux désignés ci-dessus sans réserve, à la date indiquée. La réception fait courir les garanties légales (parfait achèvement 1 an, bon fonctionnement 2 ans, décennale 10 ans)."
    : pv.type === "Avec réserves" ? `Le maître d'ouvrage déclare réceptionner les travaux avec les réserves listées ci-dessous. L'entreprise s'engage à les lever${pv.delai_levee ? " au plus tard le " + D(pv.delai_levee) : " dans les meilleurs délais"}. La retenue de garantie éventuelle reste due tant que les réserves ne sont pas levées.`
    : "Le maître d'ouvrage refuse la réception des travaux pour les motifs indiqués ci-dessous. Les parties conviennent de se rapprocher pour fixer les conditions d'une nouvelle réception.";
  text("Déclaration", { bold: true, size: 11, color: ACC }); text(decl, { size: 10 }); y -= 6;
  if (res.length) {
    text("Réserves", { bold: true, size: 11, color: ACC });
    res.forEach((r, i) => { text(`${i + 1}. ${r.description}${r.localisation ? " (" + r.localisation + ")" : ""}${r.levee ? "  - levée" + (r.levee_le ? " le " + D(r.levee_le) : "") : ""}`, { size: 10 }); });
    y -= 6;
  }
  if (pv.observations) { text("Observations", { bold: true, size: 11, color: ACC }); text(pv.observations, { size: 10 }); y -= 6; }
  need(130); y -= 10;
  const bw = (W - 2 * M - 20) / 2, top = y;
  [["Le maître d'ouvrage", sig ? `Signé électroniquement par ${sig.nom}` : "Date, mention « lu et approuvé » et signature"], ["L'entreprise", e.nom || ""]].forEach(([t, sub], i) => {
    const bx = M + i * (bw + 20);
    page.drawRectangle({ x: bx, y: top - 110, width: bw, height: 112, borderColor: LINE, borderWidth: 0.8 });
    page.drawText(T(t), { x: bx + 10, y: top - 16, size: 9.5, font: bold, color: ACC });
    for (const [j, l] of wrap(sub, font, 8, bw - 20).entries()) page.drawText(l, { x: bx + 10, y: top - 29 - j * 10, size: 8, font, color: GREY });
  });
  if (sig?.png) { const img = await pdf.embedPng(sig.png), s = Math.min((bw - 24) / img.width, 62 / img.height); page.drawImage(img, { x: M + 12, y: top - 104, width: img.width * s, height: img.height * s }); }
  y = top - 124;
  if (sig) { pdf.getPages().at(-1).drawText(T(`Signé électroniquement par ${sig.nom} le ${sigDate(sig.at)}. Certificat en dernière page.`), { x: M, y: 24, size: 7, font, color: GREY }); }
  pdf.setTitle(`${pv.numero || "PV"} - procès-verbal de réception`); pdf.setProducer("Pilot");
  if (sig) {
    const p = pdf.addPage([W, H]); let yy = H - 70;
    p.drawRectangle({ x: 0, y: H - 10, width: W, height: 10, color: ACC });
    p.drawText(T("Certificat de signature électronique"), { x: M, y: yy, size: 20, font: bold, color: ACC }); yy -= 30;
    const row = (k, v) => { p.drawText(T(k), { x: M, y: yy, size: 9, font, color: GREY }); for (const l of wrap(v, bold, 10, W - 2 * M - 150)) { p.drawText(l, { x: M + 150, y: yy, size: 10, font: bold, color: INK }); yy -= 14; } yy -= 6; };
    row("Document", `${pv.numero} - procès-verbal de réception - ${ch.nom || ""}`); row("Signataire", sig.nom); row("Date et heure", `${sigDate(sig.at)} (heure de Paris)`); row("Horodatage (UTC)", new Date(sig.at).toISOString());
    p.drawText(T("Empreinte SHA-256 du document consulté"), { x: M, y: yy, size: 9, font, color: GREY }); yy -= 14;
    for (const l of [sig.hash.slice(0, 32), sig.hash.slice(32)].filter(Boolean)) { p.drawText(l || "non disponible", { x: M, y: yy, size: 9.5, font: bold, color: INK }); yy -= 13; }
    if (!sig.hash) { p.drawText("non disponible", { x: M, y: yy, size: 9.5, font: bold, color: INK }); yy -= 13; }
    yy -= 14;
    for (const l of wrap("Ce procès-verbal a été signé au moyen d'une signature électronique simple au sens du règlement européen eIDAS (UE) n° 910/2014 : le signataire a ouvert le lien sécurisé envoyé par l'entreprise, dessiné sa signature et saisi son nom. La date, l'heure et l'empreinte du document consulté sont conservées.", font, 9, W - 2 * M)) { p.drawText(l, { x: M, y: yy, size: 9, font, color: INK }); yy -= 12.5; }
    if (sig.ua) { yy -= 8; for (const l of wrap("Navigateur : " + sig.ua, font, 7.5, W - 2 * M).slice(0, 3)) { p.drawText(l, { x: M, y: yy, size: 7.5, font, color: GREY }); yy -= 10; } }
  }
  return pdf.save();
}

/* ---------- Liste et fiche ---------- */
V.pv = (r) => {
  if (!db.v10) return page("PV de réception", "", "", card("Migration requise", `<p class="note" style="margin:0">Exécutez migration_v10.sql dans Supabase pour activer les PV de réception.</p>`));
  if (r.arg) return pvDetail(r.arg);
  const rows = db.pv.list.map((p) => { const ch = byId(db.chantiers, p.chantier_id), op = pvOpen(p).length;
    return { go: `pv/${p.id}`, t: `${p.numero} ${ch?.nom || ""} ${p.statut}`, c: [`<b>${esc(p.numero || "")}</b>`, esc(ch?.nom || "-"), esc(clientOf(p.client_id)?.nom || "-"), D(p.date_reception), chip(p.type), chip(p.statut), op ? `<span class="chip wn">${op} réserve${op > 1 ? "s" : ""}</span>` : ""] }; });
  return page("PV de réception", "Procès-verbaux de réception des travaux, signés en ligne par vos clients.", btn("Nouveau PV", "pvNew", "", "", "w"),
    searchBar("Rechercher un PV, un chantier…", `${rows.length} PV`) + card("", tbl(["N°", "Chantier", "Client", "Réception", "Décision", "Statut", "Réserves"], rows, "Aucun PV. Créez-en un à la fin d'un chantier.")));
};

function pvChantierCard(cid) {
  if (!db.v10) return "";
  const l = db.pv.list.filter((p) => p.chantier_id === cid);
  return card("PV de réception", l.length ? l.map((p) => `<div class="row lnk" data-go="pv/${p.id}" style="cursor:pointer"><div><b>${esc(p.numero)}</b><small>${D(p.date_reception)}</small></div>${chip(p.statut)}</div>`).join("") : `<p class="mut" style="margin:0;padding:16px 18px">Aucun PV pour ce chantier.</p>`, btn("Nouveau PV", "pvNew", cid, "", "o sm w"));
}

function pvDetail(id) {
  const p = pvOf(id); if (!p) return page("PV", "", "", `<p class="mut">PV introuvable.</p>`);
  const ch = byId(db.chantiers, p.chantier_id) || {}, c = clientOf(p.client_id) || {}, res = pvRes(id), signed = !!p.signe_at, op = pvOpen(p).length;
  const actions = btn("Voir le PDF", "pvPdf", id, "", "o") + (signed ? (p.chemin_pdf ? btn("PV signé (PDF)", "pvOpenSigned", id, "", "o") : "") : btn(p.statut === "Brouillon" ? "Envoyer au client" : "Lien client", "pvSend", id, "", "w") + btn("Faire signer sur place", "pvOnsite", id, "", "o w") + btn("Modifier", "pvEdit", id, "", "o w") + btn("Supprimer", "pvDel", id, "", "dn-o w"));
  const reserves = res.length ? res.map((r) => `<div class="row" style="padding:10px 18px"><div><b${r.levee ? ' style="text-decoration:line-through"' : ""}>${esc(r.description)}</b><small>${esc(r.localisation || "")}${r.levee && r.levee_le ? " · levée le " + D(r.levee_le) : ""}</small></div>${r.levee ? `<span class="chip ok">Levée</span>` : btn("Marquer levée", "pvLever", r.id, "", "o sm w")}</div>`).join("") : `<p class="mut" style="margin:0;padding:16px 18px">Aucune réserve.</p>`;
  const garantie = pvGarantieCard(p);
  return page(`${esc(p.numero || "PV")}`, `Procès-verbal de réception · ${esc(ch.nom || "")}`, actions, `<div class="g2"><div>
    ${card("Réserves", reserves, res.length ? `<span class="mut">${op ? op + " à lever" : "toutes levées"}</span>` : "")}
    ${p.observations ? card("Observations", `<p style="margin:0;padding:16px 18px;white-space:pre-wrap">${esc(p.observations)}</p>`) : ""}</div><div>
    ${card("Suivi", `<dl class="kv"><dt>Statut</dt><dd>${chip(p.statut)}</dd><dt>Décision</dt><dd>${chip(p.type)}</dd><dt>Réception</dt><dd>${D(p.date_reception)}</dd>${p.delai_levee ? `<dt>Levée avant le</dt><dd>${D(p.delai_levee)}</dd>` : ""}
      <dt>Client</dt><dd><a href="#/clients/${p.client_id}">${esc(c.nom || "-")}</a></dd><dt>Chantier</dt><dd><a href="#/chantiers/${p.chantier_id}">${esc(ch.nom || "-")}</a></dd>
      ${signed ? `<dt>Signé par</dt><dd>${esc(p.signataire_nom)}</dd><dt>Le</dt><dd>${esc(sigDate(p.signe_at))}</dd><dt>Empreinte</dt><dd><code>${esc((p.hash_pdf || "").slice(0, 16) || "-")}…</code></dd>` : ""}</dl>`)}
    ${garantie}</div></div>`, crumbs(["PV de réception", "pv"], [p.numero || "PV"]));
}

// Retenue de garantie : proposer la date de libération (réception + 1 an) pour les factures du chantier
function pvGarantieCard(p) {
  if (typeof fdOf !== "function" || p.type === "Refusée") return "";
  const fs = db.factures.filter((f) => f.chantier_id === p.chantier_id && f.statut !== "Brouillon" && f.statut !== "Annulée").map((f) => ({ f, d: fdOf(f.id) })).filter((x) => x.d && Number(x.d.retenue_pct) > 0 && !x.d.retenue_liberee_le);
  if (!fs.length) return "";
  const date = addDays(p.date_reception, 365);
  return card("Retenue de garantie", `<p class="note" style="margin:0;padding:14px 18px 4px">Réception le ${D(p.date_reception)} : la retenue de garantie est libérable à partir du <b>${D(date)}</b>${p.type === "Avec réserves" ? ", une fois toutes les réserves levées" : ""}.</p>
    ${fs.map(({ f, d }) => `<div class="row" style="padding:8px 18px"><div><b>${esc(f.numero)}</b><small>${d.retenue_date ? "Libération prévue le " + D(d.retenue_date) : "Date non fixée"}</small></div>${d.retenue_date === date ? `<span class="chip ok">À jour</span>` : btn("Fixer au " + D(date), "pvRetenue", f.id, date, "o sm w")}</div>`).join("")}`);
}

/* ---------- Formulaire ---------- */
function pvForm(pv, chantierId) {
  if (!guard()) return;
  const x = pv || {}, ch0 = byId(db.chantiers, x.chantier_id || chantierId) || db.chantiers[0];
  if (!ch0) return toast("Créez d'abord un chantier.", "dn");
  const res0 = pv ? pvRes(pv.id).map((r) => r.description + (r.localisation ? " | " + r.localisation : "")).join("\n") : "";
  modal(pv ? "Modifier le PV" : "Nouveau PV de réception", `<div class="frm">
    ${fld({ k: "chantier_id", l: "Chantier", t: "select", o: db.chantiers.map((c) => ({ v: c.id, l: `${c.nom} · ${c.client_nom}` })), v: ch0.id, cls: "full" })}
    ${fld({ k: "date_reception", l: "Date de réception", t: "date", v: x.date_reception || today() })}
    ${fld({ k: "type", l: "Décision du client", t: "select", o: pvTypes, v: x.type || "Sans réserve" })}
    ${fld({ k: "lieu", l: "Lieu", v: x.lieu ?? [ch0.adresse, ch0.ville].filter(Boolean).join(", "), r: 0, cls: "full" })}
    ${fld({ k: "objet", l: "Objet des travaux", v: x.objet ?? ch0.nom, r: 0, cls: "full" })}
    ${fld({ k: "reserves", l: "Réserves (une par ligne, « description | emplacement »)", t: "textarea", v: res0, r: 0, cls: "full", rows: 5, hint: "Seulement si la réception est avec réserves ou refusée." })}
    ${fld({ k: "delai_levee", l: "Réserves à lever avant le", t: "date", v: x.delai_levee || "", r: 0 })}
    ${fld({ k: "observations", l: "Observations", t: "textarea", v: x.observations || "", r: 0, cls: "full", rows: 3 })}</div>`, {
    wide: true,
    onSubmit: async (v, api) => {
      const ch = byId(db.chantiers, v.chantier_id), lines = (v.reserves || "").split("\n").map((s) => s.trim()).filter(Boolean);
      if (v.type !== "Sans réserve" && !lines.length) throw new Error("Listez au moins une réserve (ou choisissez « Sans réserve »).");
      const row = { chantier_id: ch.id, client_id: ch.client_id, date_reception: v.date_reception, type: v.type, lieu: v.lieu || null, objet: v.objet || null, observations: v.observations || null,
        delai_levee: v.type === "Sans réserve" ? null : v.delai_levee || addDays(v.date_reception, 30) };
      let id = pv?.id;
      if (pv) { await q(sb.from("pv_reception").update(row).eq("id", id)); await q(sb.from("pv_reserves").delete().eq("pv_id", id)); }
      else id = (await q(sb.from("pv_reception").insert({ ...row, numero: pvNumero() }).select("id").single())).id;
      if (v.type !== "Sans réserve" && lines.length) await q(sb.from("pv_reserves").insert(lines.map((l, i) => { const [d, loc] = l.split("|").map((s) => s.trim()); return { pv_id: id, position: i, description: d, localisation: loc || null }; })));
      api.close(); toast("PV enregistré.", "ok"); await refresh(); go(`pv/${id}`);
    },
  });
}

/* ---------- Envoi, signature, archivage ---------- */
async function pvShare(id) {
  const p = pvOf(id), bytes = await pvPdfBytes(p);
  const path = `${uid}/pv-${p.token}.pdf`;
  const up = await sb.storage.from("partages").upload(path, new Blob([bytes], { type: "application/pdf" }), { upsert: true, contentType: "application/pdf" });
  if (up.error) throw up.error;
  await q(sb.from("pv_reception").update({ pdf_path: path, statut: p.statut === "Brouillon" ? "Envoyé" : p.statut }).eq("id", id));
  await refresh();
  return pvUrl(pvOf(id));
}
async function pvSend(id) {
  if (!guard()) return;
  toast("Préparation du lien…");
  const link = await pvShare(id), p = pvOf(id), c = clientOf(p.client_id) || {};
  const t = typeof mlRender === "function" ? mlRender("pv_envoi", { d: p, c, lien: link, ch: byId(db.chantiers, p.chantier_id) }) : { sujet: `PV de réception ${p.numero}`, corps: link };
  const api = modal(`${esc(p.numero)} : lien client`, `<div class="sharebox"><p class="mut" style="margin:0">Votre client ouvre ce lien sans créer de compte, lit le PV et le signe au doigt ou à la souris. Vous êtes prévenu dès la signature.</p>
    <div class="lnk-in"><input type="text" readonly value="${esc(link)}" id="pvl"><button type="button" class="btn o" id="pvc">Copier</button></div></div>
    <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;margin-top:12px"><a class="btn o" href="${esc(link)}" target="_blank" rel="noopener">Voir la page client</a><button type="button" class="btn" id="pvm">${typeof gmOn === "function" && gmOn() ? "Envoyer avec Gmail" : "Écrire l'email"}</button></div>`, { submit: false });
  $("#pvc", api.el).onclick = async () => { try { await navigator.clipboard.writeText(link); toast("Lien copié.", "ok"); } catch (e) { $("#pvl", api.el).select(); } };
  $("#pvm", api.el).onclick = () => { api.close(); if (typeof mlCompose === "function") mlCompose({ titre: `Envoyer ${esc(p.numero)}`, to: c.email || "", ...t, client_id: p.client_id, doc_type: "pv", doc_id: id, pdf: { nom: `${slug(p.numero)}.pdf`, bytes: () => pvPdfBytes(pvOf(id)) } }); else location.href = `mailto:${c.email || ""}?subject=${encodeURIComponent(t.sujet)}&body=${encodeURIComponent(t.corps)}`; };
}
const pvBusy = new Set(), pvFailed = new Set();
async function pvArchive(p) {
  if (pvBusy.has(p.id)) return false;
  pvBusy.add(p.id);
  try {
    const { signature_client } = await q(sb.from("pv_reception").select("signature_client").eq("id", p.id).single());
    const png = b64ToBytes(String(signature_client).split(",")[1]);
    const bytes = await pvPdfBytes(p, { nom: p.signataire_nom, at: p.signe_at, hash: p.hash_pdf || "", ua: p.user_agent || "", png });
    const chemin = `${uid}/pv/${Date.now()}-${slug(p.numero || "pv")}-signe.pdf`;
    const up = await sb.storage.from("documents").upload(chemin, new Blob([bytes], { type: "application/pdf" }), { contentType: "application/pdf" });
    if (up.error) throw up.error;
    try {
      await q(sb.from("pv_reception").update({ chemin_pdf: chemin }).eq("id", p.id));
      if (db.v6) await q(sb.from("documents").insert({ nom: `${p.numero} (signé).pdf`, categorie: "Attestations", client_id: p.client_id, chantier_id: p.chantier_id, chemin, mime: "application/pdf", taille: bytes.length, notes: `PV de réception signé par ${p.signataire_nom} le ${sigDate(p.signe_at)}` }));
    } catch (e) { sb.storage.from("documents").remove([chemin]); throw e; }
    p.chemin_pdf = chemin; return true;
  } finally { pvBusy.delete(p.id); }
}
async function pvAutoArchive() {
  if (ro || !db.v10) return;
  const todo = db.pv.list.filter((p) => p.signe_at && !p.chemin_pdf && !pvFailed.has(p.id) && !pvBusy.has(p.id));
  let ok = 0;
  for (const p of todo) { try { if (await pvArchive(p)) ok++; } catch (e) { pvFailed.add(p.id); console.warn("Archivage PV", e); } }
  if (ok) { toast(`PV signé${ok > 1 ? "s" : ""} rangé${ok > 1 ? "s" : ""} dans Documents.`, "ok"); await refresh(); }
}

const pvActions = {
  pvNew: (id) => pvForm(null, id),
  pvEdit: (id) => pvForm(pvOf(id)),
  pvPdf: async (id) => { const p = pvOf(id); openPdfModal(`PV ${p.numero}`, await pvPdfBytes(p), `${slug(p.numero)}.pdf`); },
  pvOpenSigned: (id) => openFile(pvOf(id).chemin_pdf),
  pvSend,
  pvOnsite: async (id) => { if (!guard()) return; toast("Préparation…"); const link = await pvShare(id); window.open(link, "_blank", "noopener"); },
  pvDel: async (id) => { if (!guard() || !confirm("Supprimer ce PV ?")) return; await q(sb.from("pv_reception").delete().eq("id", id)); await refresh(); go("pv"); },
  pvLever: async (id) => {
    if (!guard()) return;
    const r = db.pv.reserves.find((x) => x.id === id);
    await q(sb.from("pv_reserves").update({ levee: true, levee_le: today() }).eq("id", id));
    const p = pvOf(r.pv_id), reste = pvRes(p.id).filter((x) => x.id !== id && !x.levee).length;
    if (!reste && p.signe_at) await q(sb.from("pv_reception").update({ statut: "Réserves levées" }).eq("id", p.id));
    await refresh(); toast(reste ? "Réserve levée." : "Toutes les réserves sont levées.", "ok");
  },
  pvRetenue: async (id, arg) => {
    if (!guard()) return;
    await q(sb.from("factures_details").upsert({ facture_id: id, retenue_date: arg }, { onConflict: "facture_id" }));
    await refresh(); toast(`Libération de la retenue fixée au ${D(arg)}.`, "ok");
  },
};
