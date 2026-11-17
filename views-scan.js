/* Numérisation : photographier ou choisir des pages, les nettoyer et les assembler en un seul PDF rangé dans Documents.
   Sur téléphone, le bouton « Prendre une photo » ouvre directement l'appareil photo. */

const SCAN_MAX = 2000; // plus grand côté, en pixels

// Redresse l'orientation, réduit et (option) passe en noir et blanc contrasté : fichier plus léger et texte plus net
async function scanPrepare(file, bw) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const k = Math.min(1, SCAN_MAX / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  cx.fillStyle = "#fff"; cx.fillRect(0, 0, w, h);
  cx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  if (bw) {
    const im = cx.getImageData(0, 0, w, h), d = im.data, hist = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) { const g = Math.round(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114); d[i] = d[i + 1] = d[i + 2] = g; hist[g]++; }
    const n = w * h; let acc = 0, lo = 0, hi = 255;
    for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= n * 0.02) { lo = i; break; } }
    acc = 0;
    for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= n * 0.25) { hi = i; break; } } // le papier est le fond clair dominant
    const span = Math.max(40, hi - lo);
    for (let i = 0; i < d.length; i += 4) { const v = Math.max(0, Math.min(255, ((d[i] - lo) / span) * 255)); d[i] = d[i + 1] = d[i + 2] = v; }
    cx.putImageData(im, 0, 0);
  }
  const blob = await new Promise((res) => cv.toBlob(res, "image/jpeg", bw ? 0.78 : 0.85));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), w, h };
}

async function scanToPdf(files, bw, onProgress) {
  await loadScript(LIBS.pdflib);
  const pdf = await PDFLib.PDFDocument.create();
  for (let i = 0; i < files.length; i++) {
    onProgress?.(i + 1, files.length);
    const p = await scanPrepare(files[i], bw);
    const img = await pdf.embedJpg(p.bytes);
    const land = p.w > p.h, W = land ? 841.89 : 595.28, H = land ? 595.28 : 841.89, m = 14;
    const s = Math.min((W - 2 * m) / p.w, (H - 2 * m) / p.h);
    const page = pdf.addPage([W, H]);
    page.drawImage(img, { x: (W - p.w * s) / 2, y: (H - p.h * s) / 2, width: p.w * s, height: p.h * s });
  }
  pdf.setProducer("Pilot");
  return pdf.save();
}

function dcScan(arg) {
  if (!guard()) return;
  if (!db.v6) return toast("Exécutez d'abord migration_v6.sql dans Supabase pour activer les documents.", "dn");
  let chantier = "", client = "";
  if (String(arg).startsWith("chantier:")) { chantier = arg.slice(9); client = byId(db.chantiers, chantier)?.client_id || ""; }
  else if (String(arg).startsWith("client:")) client = arg.slice(7);
  let pages = []; // { file, url }
  const body = `<div class="frm">
    <div class="full"><div class="drop"><div><b>Pages du document</b><small style="display:block" class="mut">Photographiez chaque page à plat, bien éclairée. Elles sont assemblées dans un seul PDF.</small></div>
      <input type="file" id="scshot" accept="image/*" capture="environment" hidden><input type="file" id="scfile" accept="image/*" multiple hidden>
      <span style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn" id="scbtn1">Prendre une photo</button><button type="button" class="btn o" id="scbtn2">Choisir des images</button></span></div>
      <div id="scpages" class="dclist" style="grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:10px"></div></div>
    ${fld({ k: "nom", l: "Nom du document", v: "Scan du " + D(today()), cls: "full" })}
    ${fld({ k: "categorie", l: "Catégorie", t: "select", o: [{ v: "auto", l: "Détection automatique" }, ...DC_CATS], v: "auto" })}
    <label class="fl" style="align-content:end"><span>Mise en page</span><select name="bw" id="f_bw"><option value="1">Document noir et blanc (recommandé)</option><option value="0">Couleur (plans, photos)</option></select></label>
    ${dcWhereFields(chantier, client)}
    ${fld({ k: "notes", l: "Note (facultatif)", t: "textarea", rows: 2, r: 0, cls: "full" })}</div>`;
  const draw = (m) => {
    $("#scpages", m).innerHTML = pages.map((p, i) => `<div style="position:relative;border:1px solid var(--line);border-radius:7px;overflow:hidden;background:var(--sunk)"><img src="${p.url}" alt="Page ${i + 1}" style="display:block;width:100%;height:132px;object-fit:cover">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:3px 6px;font-size:12px"><b>${i + 1}</b><span><button type="button" class="lk" data-mv="${i}:-1" aria-label="Avancer">‹</button> <button type="button" class="lk" data-mv="${i}:1" aria-label="Reculer">›</button> <button type="button" class="lk" data-del="${i}" aria-label="Retirer">✕</button></span></div></div>`).join("");
  };
  const api = modal("Scanner un document", body, {
    wide: true, submit: "Créer le PDF", noFocus: true,
    onMount: (m) => {
      const add = (list) => { for (const f of list) pages.push({ file: f, url: URL.createObjectURL(f) }); draw(m); };
      $("#scbtn1", m).onclick = () => $("#scshot", m).click();
      $("#scbtn2", m).onclick = () => $("#scfile", m).click();
      $("#scshot", m).onchange = (e) => { add([...e.target.files]); e.target.value = ""; };
      $("#scfile", m).onchange = (e) => { add([...e.target.files]); e.target.value = ""; };
      m.addEventListener("click", (e) => {
        const mv = e.target.closest("[data-mv]"), dl = e.target.closest("[data-del]");
        if (mv) { const [i, d] = mv.dataset.mv.split(":").map(Number), j = i + d; if (j >= 0 && j < pages.length) { [pages[i], pages[j]] = [pages[j], pages[i]]; draw(m); } }
        if (dl) { URL.revokeObjectURL(pages[+dl.dataset.del].url); pages.splice(+dl.dataset.del, 1); draw(m); }
      });
      dcBindWhere(m);
    },
    onSubmit: async (v, api) => {
      if (!pages.length) throw new Error("Ajoutez au moins une page.");
      const bytes = await scanToPdf(pages.map((p) => p.file), v.bw === "1", (i, n) => api.error(`Préparation de la page ${i} / ${n}…`));
      if (bytes.length > DC_MAX) throw new Error("Le PDF dépasse 25 Mo. Passez en noir et blanc ou retirez des pages.");
      api.error("Envoi…");
      const nom = (v.nom || "Scan").trim().replace(/\.pdf$/i, "") + ".pdf";
      const file = new File([bytes], nom, { type: "application/pdf" });
      const ch = v.chantier_id ? byId(db.chantiers, v.chantier_id) : null;
      const path = await uploadDoc(file, "documents");
      try {
        await q(sb.from("documents").insert({ nom, categorie: v.categorie === "auto" ? dcGuess(nom, "application/pdf") : v.categorie, client_id: ch?.client_id || v.client_id || null, chantier_id: ch?.id || null,
          chemin: path, mime: "application/pdf", taille: bytes.length, notes: v.notes || `Numérisé · ${pages.length} page${pages.length > 1 ? "s" : ""}` }));
      } catch (e) { sb.storage.from("documents").remove([path]); throw e; }
      pages.forEach((p) => URL.revokeObjectURL(p.url));
      api.close();
      toast(`Document numérisé : ${pages.length} page${pages.length > 1 ? "s" : ""}, ${dcSize(bytes.length)}.`, "ok");
      await refresh();
    },
  });
}

const scanActions = { dcScan: (id, arg) => dcScan(arg) };
