/* Signature électronique des devis (côté entreprise).
   Le client signe depuis p.html (signature dessinée + nom + case d'accord). La fonction partage_signer garde la preuve.
   Ici : on affiche la preuve, et on fabrique le « devis signé » (PDF d'origine + certificat de signature) rangé dans Documents.
   Niveau : signature électronique simple (règlement eIDAS) : valable comme preuve d'accord, sans certificat qualifié. */

const sigOf = (devisId) => (db.sigs || []).find((s) => s.devis_id === devisId);
const sigBusy = new Set(), sigFailed = new Set();
const sigHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const sha256Hex = async (bytes) => sigHex(await crypto.subtle.digest("SHA-256", bytes));
const sigDate = (iso) => new Date(iso).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "medium", timeZone: "Europe/Paris" });
const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

function sigWrap(text, font, size, maxW) {
  const out = [];
  for (const para of PilotPdf.clean(text).split("\n")) {
    let line = "";
    for (const w of para.split(" ")) {
      const t = line ? line + " " + w : w;
      if (font.widthOfTextAtSize(t, size) <= maxW || !line) line = t; else { out.push(line); line = w; }
    }
    out.push(line);
  }
  return out;
}

// Fabrique le devis signé et l'archive dans Documents. Renvoie true si un nouveau fichier a été créé.
async function sigArchive(sig) {
  if (sigBusy.has(sig.id)) return false;
  sigBusy.add(sig.id);
  try {
    const d = byId(db.devis, sig.devis_id);
    if (!d) throw new Error("Devis introuvable.");
    const { data: blob, error } = await sb.storage.from("partages").download(`${uid}/${sig.partage_token}.pdf`);
    if (error) throw new Error("PDF du devis introuvable : " + error.message);
    const orig = new Uint8Array(await blob.arrayBuffer());
    const cur = await sha256Hex(orig);
    const { signature } = await q(sb.from("signatures").select("signature").eq("id", sig.id).single());
    await loadScript(LIBS.pdflib);
    const { PDFDocument, StandardFonts, rgb } = PDFLib;
    const pdf = await PDFDocument.load(orig, { ignoreEncryption: true });
    const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const T = PilotPdf.clean, INK = rgb(0.1, 0.11, 0.13), GREY = rgb(0.4, 0.42, 0.45), ACC = rgb(0.14, 0.23, 0.35);
    const nPages = pdf.getPageCount();
    const quand = sigDate(sig.signed_at);

    // Mention discrète au bas de la dernière page
    const last = pdf.getPage(nPages - 1);
    last.drawText(T(`Signé électroniquement par ${sig.nom} le ${quand}. Certificat en page ${nPages + 1}.`), { x: 42, y: 12, size: 7, font, color: GREY });

    // Page de certificat
    const W = 595.28, H = 841.89, M = 48, page = pdf.addPage([W, H]);
    let y = H - 70;
    page.drawRectangle({ x: 0, y: H - 10, width: W, height: 10, color: ACC });
    page.drawText(T("Certificat de signature électronique"), { x: M, y, size: 20, font: bold, color: ACC });
    y -= 22;
    page.drawText(T(`Devis ${d.numero || ""} · ${db.ent.nom || ""}`), { x: M, y, size: 10.5, font, color: GREY });
    y -= 34;
    const row = (k, v) => {
      page.drawText(T(k), { x: M, y, size: 9, font, color: GREY });
      for (const l of sigWrap(v, bold, 10, W - 2 * M - 150)) { page.drawText(l, { x: M + 150, y, size: 10, font: bold, color: INK }); y -= 14; }
      y -= 6;
    };
    row("Signataire", sig.nom);
    row("Date et heure", `${quand} (heure de Paris)`);
    row("Horodatage (UTC)", new Date(sig.signed_at).toISOString());
    row("Document", `Devis ${d.numero || ""} · ${E2(d.montant_ttc)} TTC · ${d.client_nom || ""}`);
    page.drawText(T("Empreinte SHA-256 du document consulté"), { x: M, y, size: 9, font, color: GREY }); y -= 14;
    for (const l of [sig.hash_pdf ? sig.hash_pdf.slice(0, 32) : "non disponible", sig.hash_pdf ? sig.hash_pdf.slice(32) : ""].filter(Boolean)) { page.drawText(l, { x: M, y, size: 9.5, font: bold, color: INK }); y -= 13; }
    y -= 4;
    const same = sig.hash_pdf && sig.hash_pdf === cur;
    page.drawText(T(same ? "Contrôle : le document archivé est identique à celui que le client a consulté." : sig.hash_pdf ? "Contrôle : le PDF a été régénéré depuis la signature, son empreinte diffère." : "Contrôle : empreinte non enregistrée au moment de la signature."), { x: M, y, size: 8.5, font, color: same ? rgb(0.1, 0.45, 0.28) : GREY });
    y -= 30;
    page.drawText(T("Signature"), { x: M, y, size: 9, font, color: GREY }); y -= 6;
    const img = await pdf.embedPng(b64ToBytes(String(signature).split(",")[1]));
    const s = Math.min(260 / img.width, 90 / img.height);
    page.drawRectangle({ x: M, y: y - img.height * s - 12, width: img.width * s + 24, height: img.height * s + 16, borderColor: rgb(0.8, 0.82, 0.85), borderWidth: 0.8 });
    page.drawImage(img, { x: M + 12, y: y - img.height * s - 4, width: img.width * s, height: img.height * s });
    y -= img.height * s + 46;
    const legal = "Ce document a été accepté au moyen d'une signature électronique simple au sens du règlement européen eIDAS (UE) n° 910/2014. Le signataire a ouvert le lien sécurisé envoyé par l'entreprise, dessiné sa signature, saisi son nom et confirmé son accord. Pilot conserve le nom saisi, l'image de la signature, la date et l'heure, le navigateur utilisé et l'empreinte numérique du document : toute modification ultérieure du PDF changerait cette empreinte. Cette signature n'est pas une signature électronique qualifiée.";
    for (const l of sigWrap(legal, font, 9, W - 2 * M)) { page.drawText(l, { x: M, y, size: 9, font, color: INK }); y -= 12.5; }
    y -= 8;
    if (sig.user_agent) for (const l of sigWrap("Navigateur : " + sig.user_agent, font, 7.5, W - 2 * M).slice(0, 3)) { page.drawText(l, { x: M, y, size: 7.5, font, color: GREY }); y -= 10; }
    pdf.setTitle(`Devis ${d.numero || ""} signé`);
    pdf.setProducer("Pilot");
    const bytes = await pdf.save();

    const nom = `${slug(d.numero || "devis")}-signe.pdf`;
    const chemin = `${uid}/signatures/${Date.now()}-${nom}`;
    const up = await sb.storage.from("documents").upload(chemin, new Blob([bytes], { type: "application/pdf" }), { contentType: "application/pdf" });
    if (up.error) throw new Error("Envoi du devis signé impossible : " + up.error.message);
    try {
      await q(sb.from("signatures").update({ chemin_pdf: chemin }).eq("id", sig.id));
      if (db.v6)
        await q(sb.from("documents").insert({ nom: `${d.numero || "Devis"} (signé).pdf`, categorie: "Devis", client_id: d.client_id, chantier_id: d.chantier_id || null, chemin,
          mime: "application/pdf", taille: bytes.length, notes: `Signé électroniquement par ${sig.nom} le ${quand}` }));
    } catch (e) { sb.storage.from("documents").remove([chemin]); throw e; }
    sig.chemin_pdf = chemin;
    return true;
  } finally { sigBusy.delete(sig.id); }
}

// Appelé après chaque chargement : range automatiquement les devis signés dans Documents
async function sigAutoArchive() {
  if (ro || !db.v7) return;
  const todo = db.sigs.filter((s) => !s.chemin_pdf && !sigFailed.has(s.id) && !sigBusy.has(s.id));
  if (!todo.length) return;
  let ok = 0;
  for (const s of todo) {
    try { if (await sigArchive(s)) ok++; } catch (e) { sigFailed.add(s.id); console.warn("Archivage du devis signé", e); }
  }
  if (ok) { toast(`${ok > 1 ? ok + " devis signés rangés" : "Devis signé rangé"} dans Documents.`, "ok"); await refresh(); }
}

function sigCard(devisId) {
  if (!db.v7) return "";
  const sg = sigOf(devisId), p = partageOf(devisId);
  if (!sg) {
    if (!p) return "";
    return card("Signature électronique", p.accepte_at
      ? `<p class="mut" style="margin:0;padding:16px 18px">Accepté par saisie du nom, sans signature dessinée.</p>`
      : `<p class="mut" style="margin:0;padding:16px 18px">Votre client signe en ligne depuis le lien : il dessine sa signature au doigt ou à la souris. Pour une signature sur place, ouvrez la page client sur votre tablette ou votre téléphone et tendez-la-lui.</p><div class="cb" style="border-top:1px solid var(--line2)"><a class="btn o sm" href="${shareLink(p.token)}" target="_blank" rel="noopener">Ouvrir la page de signature</a></div>`);
  }
  return card("Signature électronique",
    `<dl class="kv"><dt>Signataire</dt><dd>${esc(sg.nom)}</dd><dt>Signé le</dt><dd>${esc(sigDate(sg.signed_at))}</dd>
     <dt>Empreinte</dt><dd><code>${esc((sg.hash_pdf || "").slice(0, 16) || "-")}${sg.hash_pdf ? "…" : ""}</code></dd>
     <dt>Devis signé</dt><dd>${sg.chemin_pdf ? `<button class="lk" data-act="sigOpen" data-id="${sg.id}">Ouvrir le PDF signé</button>` : sigFailed.has(sg.id) ? `${btn("Réessayer l'archivage", "sigArchive", sg.id, "", "o sm w")}` : "Archivage en cours…"}</dd></dl>
     <p class="note">Signature électronique simple (règlement eIDAS) : elle prouve l'accord du client, avec date, heure et empreinte du document. Le PDF signé contient un certificat et se trouve dans Documents.</p>`);
}

const signatureActions = {
  sigOpen: (id) => { const s = (db.sigs || []).find((x) => x.id === id); if (s?.chemin_pdf) return openFile(s.chemin_pdf); },
  sigArchive: async (id) => {
    const s = (db.sigs || []).find((x) => x.id === id);
    if (!s || !guard()) return;
    sigFailed.delete(id);
    toast("Préparation du devis signé…");
    await sigArchive(s);
    toast("Devis signé rangé dans Documents.", "ok");
    await refresh();
  },
};
