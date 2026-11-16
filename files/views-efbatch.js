/* Import / export en lot au format Factur-X.
   - Export : toutes les factures émises d'une période, en Factur-X (PDF + XML), dans un ZIP avec un index CSV.
   - Import : plusieurs factures fournisseurs d'un coup (Factur-X, XML CII ou PDF classique), aperçu, détection des doublons, création des dépenses. */

const efb = { rows: [], busy: false };
const efbNorm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

function efbOpen(_id, mode) {
  if (!guard()) return;
  const imp = mode === "import";
  if (imp) return efbImportModal();
  return efbExportModal();
}

/* ---------- Export ---------- */
function efbExportModal() {
  if (!db.v7) return toast("Exécutez d'abord migration_v7.sql dans Supabase pour activer la facture électronique.", "dn");
  const y = new Date().getFullYear(), emis = db.factures.filter((f) => f.statut !== "Brouillon");
  modal("Exporter des factures en Factur-X", `<p class="mut" style="margin:0 0 10px">Pilot fabrique pour chaque facture émise un PDF Factur-X (avec le XML intégré) et un fichier XML seul, rassemblés dans un ZIP avec un index CSV. Les factures qui ne passent pas les contrôles (SIREN manquant, par exemple) sont listées à part.</p>
    <div class="frm">${fld({ k: "du", l: "Du", t: "date", v: `${y}-01-01` })}${fld({ k: "au", l: "Au", t: "date", v: today() })}
    ${fld({ k: "client_id", l: "Client", t: "select", o: [{ v: "", l: "Tous les clients" }, ...db.clients.map((c) => ({ v: c.id, l: c.nom }))], v: "", r: 0, cls: "full" })}</div>
    <p class="mut" id="efb_n" style="margin:10px 0 0">${emis.length} facture${emis.length > 1 ? "s" : ""} émise${emis.length > 1 ? "s" : ""} au total.</p>
    <p class="mut" id="efb_st" style="margin:6px 0 0"></p>`, {
    submit: "Générer le ZIP",
    onMount: (m) => {
      const upd = () => { const f = efbSel(Object.fromEntries(new FormData($("form", m)))); $("#efb_n", m).textContent = `${f.length} facture${f.length > 1 ? "s" : ""} dans cette sélection.`; };
      $$("input,select", m).forEach((i) => (i.onchange = upd)); upd();
    },
    onSubmit: async (v, api) => {
      const sel = efbSel(v);
      if (!sel.length) throw new Error("Aucune facture émise sur cette sélection.");
      if (sel.length > 150 && !confirm(`${sel.length} factures : la fabrication peut prendre plusieurs minutes. Continuer ?`)) return;
      await loadScript(LIBS.jszip);
      const zip = new JSZip(), idx = [], bad = [], st = $("#efb_st", api.el);
      let i = 0;
      for (const f of sel) {
        st.textContent = `Fabrication ${++i} / ${sel.length} : ${f.numero}…`;
        try {
          const chk = (await efChecks(f.id)).filter((x) => x.lv === "err");
          if (chk.length) { bad.push([f.numero, chk[0].t]); continue; }
          const { bytes, xml, hash } = await efBuild(f.id), n = slug(f.numero);
          zip.file(`facturx/${n}.pdf`, bytes); zip.file(`xml/${n}.xml`, xml);
          idx.push([f.numero, f.date_emission, f.client_nom, f.montant_ht, f.montant_tva, f.montant_ttc, `facturx/${n}.pdf`, hash]);
        } catch (e) { bad.push([f.numero, friendly(e)]); }
      }
      if (!idx.length) throw new Error("Aucune facture n'a pu être convertie. " + (bad[0] ? `${bad[0][0]} : ${bad[0][1]}` : ""));
      zip.file("index.csv", toCsv(["numero", "date", "client", "ht", "tva", "ttc", "fichier", "sha256"], idx));
      if (bad.length) zip.file("non_converties.csv", toCsv(["numero", "raison"], bad));
      downloadBlob(`factures-facturx-${today()}.zip`, await zip.generateAsync({ type: "blob", compression: "DEFLATE" }));
      api.close();
      toast(`${idx.length} facture${idx.length > 1 ? "s" : ""} exportée${idx.length > 1 ? "s" : ""}${bad.length ? `, ${bad.length} non convertie${bad.length > 1 ? "s" : ""} (voir non_converties.csv)` : ""}.`, bad.length ? "" : "ok");
    },
  });
}
const efbSel = (v) => db.factures.filter((f) => f.statut !== "Brouillon" && (!v.du || f.date_emission >= v.du) && (!v.au || f.date_emission <= v.au) && (!v.client_id || f.client_id === v.client_id));

/* ---------- Import ---------- */
function efbDup(r) {
  const fn = efbNorm(r.fournisseur);
  return db.depenses.find((d) => efbNorm(d.fournisseur) === fn && ((r.reference && d.reference && efbNorm(d.reference) === efbNorm(r.reference)) || (!r.reference && r.ttc != null && Math.abs(d.montant_ttc - r.ttc) < 0.005 && d.date_depense === r.date)));
}
async function efbRead(file) {
  const r = { file, name: file.name, source: "", fournisseur: "", reference: "", date: "", echeance: "", ht: null, tva: null, ttc: null, categorie: "Autre", type: "Dépense", avoir: false, warn: "" };
  try {
    const ei = await efReadIncoming(file).catch(() => null);
    if (ei) {
      Object.assign(r, { source: "Factur-X", fournisseur: ei.fournisseur, reference: ei.reference, date: ei.date, echeance: ei.echeance, ht: ei.ht, tva: ei.tva, ttc: ei.ttc ?? (ei.ht != null && ei.tva != null ? r2(ei.ht + ei.tva) : null), avoir: ei.avoir });
      if (/\.pdf$/i.test(file.name)) { try { const t = await PilotPdf.extractSupplier(file); r.categorie = t.categorie || "Autre"; r.type = t.type || "Dépense"; } catch (e) { /* ignore */ } }
    } else if (/\.pdf$/i.test(file.name) || /pdf/.test(file.type)) {
      const t = await PilotPdf.extractSupplier(file);
      if (t.image || t.vide) r.warn = "PDF sans texte lisible (scan) : à saisir à la main.";
      else Object.assign(r, { source: "PDF lu", fournisseur: t.fournisseur || "", reference: t.reference || "", date: t.date || "", echeance: t.echeance || "", ht: t.ht, tva: t.tva, ttc: t.ttc ?? (t.ht != null && t.tva != null ? r2(t.ht + t.tva) : null), categorie: t.categorie || "Autre", type: t.type || "Dépense", warn: !t.coherent || t.ht == null || t.ttc == null ? "Montants à vérifier." : "" });
    } else r.warn = "Format non pris en charge (PDF, Factur-X ou XML CII).";
  } catch (e) { r.warn = "Lecture impossible : " + friendly(e); }
  if (r.avoir) r.warn = "Avoir : à saisir à la main (montants négatifs).";
  if (!r.warn && (!r.fournisseur || r.ht == null || r.ttc == null || !r.date)) r.warn = "Informations incomplètes (fournisseur, date ou montants).";
  r.dup = r.warn ? null : efbDup(r);
  r.ok = !r.warn && !r.dup;
  return r;
}
function efbImportModal() {
  efb.rows = [];
  const api = modal("Importer des factures fournisseurs en lot", `<p class="mut" style="margin:0 0 10px">Choisissez plusieurs fichiers d'un coup : factures Factur-X, XML, ou PDF classiques. Pilot lit chacun, signale les doublons et les lignes à compléter, puis vous validez.</p>
    <div class="drop"><div><b>Factures reçues</b><small style="display:block" class="mut">Jusqu'à 60 fichiers à la fois</small></div><input type="file" id="efb_f" accept=".pdf,.xml,application/xml,text/xml,application/pdf" multiple hidden><button type="button" class="btn" id="efb_b">Choisir des fichiers</button></div>
    <p class="mut" id="efb_st" style="margin:8px 0"></p><div id="efb_tbl"></div>`, { submit: "Importer la sélection", wide: true, noFocus: true,
    onMount: (m) => {
      const inp = $("#efb_f", m);
      $("#efb_b", m).onclick = () => inp.click();
      inp.onchange = async () => {
        const files = [...inp.files].slice(0, 60);
        if (!files.length) return;
        efb.rows = [];
        for (let i = 0; i < files.length; i++) { $("#efb_st", m).textContent = `Lecture ${i + 1} / ${files.length}…`; efb.rows.push(await efbRead(files[i])); efbRender(m); }
        $("#efb_st", m).textContent = "";
      };
    },
    onSubmit: async (v, api2) => {
      const todo = efb.rows.filter((r) => r.ok && r.on !== false);
      if (!todo.length) throw new Error("Aucune ligne à importer. Cochez au moins une facture valide.");
      let made = 0, sup = 0;
      for (const r of todo) {
        $("#efb_st", api2.el).textContent = `Enregistrement ${made + 1} / ${todo.length}…`;
        const path = await uploadDoc(r.file, "justificatifs");
        const row = { fournisseur: r.fournisseur.trim(), reference: r.reference || null, categorie: PilotPdf.CATEGORIES.includes(r.categorie) ? r.categorie : "Autre", type: r.type, chantier_id: null,
          date_depense: r.date, echeance: r.echeance || null, montant_ht: r.ht, montant_tva: r.tva ?? r2(r.ttc - r.ht), statut: "À payer", date_paiement: null, mode: null, justificatif: path, notes: `Importé en lot (${r.source})` };
        const f = db.fournisseurs.find((x) => efbNorm(x.nom) === efbNorm(r.fournisseur));
        if (!f && db.v5 && $("#efb_newsup", api2.el)?.checked) { const nf = await q(sb.from("fournisseurs").insert({ nom: r.fournisseur.trim() }).select("*").single()); db.fournisseurs.push(nf); sup++; }
        if (db.v11 && f) { const bc = db.bcs.find((b) => b.fournisseur_id === f.id && ["Envoyé", "Confirmé", "Reçu partiellement", "Reçu"].includes(b.statut) && Math.abs(bcTotOf(b).ht - r.ht) < 0.01); if (bc) row.bc_id = bc.id; }
        await q(sb.from("depenses").insert(row)); made++;
      }
      api2.close(); toast(`${made} facture${made > 1 ? "s" : ""} importée${made > 1 ? "s" : ""}${sup ? `, ${sup} fournisseur${sup > 1 ? "s" : ""} créé${sup > 1 ? "s" : ""}` : ""}.`, "ok"); await refresh();
    } });
  return api;
}
function efbRender(m) {
  const R = efb.rows, ok = R.filter((r) => r.ok).length, newSup = [...new Set(R.filter((r) => r.ok && !db.fournisseurs.some((f) => efbNorm(f.nom) === efbNorm(r.fournisseur))).map((r) => r.fournisseur))];
  $("#efb_tbl", m).innerHTML = `<div class="tw"><table><thead><tr><th></th><th>Fichier</th><th>Fournisseur / n°</th><th>Date</th><th class="r">TTC</th><th>État</th></tr></thead><tbody>${R.map((r, i) => `<tr><td><input type="checkbox" data-i="${i}" ${r.ok && r.on !== false ? "checked" : ""} ${r.ok ? "" : "disabled"}></td><td>${esc(r.name)}<small class="mut" style="display:block">${esc(r.source)}</small></td>
    <td>${esc(r.fournisseur || "-")}<small class="mut" style="display:block">${esc(r.reference || "")}</small></td><td>${r.date ? D(r.date) : "-"}</td><td class="r"><span class="num">${r.ttc != null ? E2(r.ttc) : "-"}</span></td>
    <td>${r.dup ? `<span class="chip wn">Déjà enregistrée</span>` : r.warn ? `<span class="chip dn" title="${esc(r.warn)}">${esc(r.warn)}</span>` : `<span class="chip ok">Prête</span>`}</td></tr>`).join("")}</tbody></table></div>
    <p class="mut" style="margin:10px 0 0">${ok} facture${ok > 1 ? "s" : ""} prête${ok > 1 ? "s" : ""} sur ${R.length}. Les factures importées sont en « À payer » ; complétez le chantier depuis la fiche si besoin.</p>
    ${newSup.length && db.v5 ? `<label class="chk" style="display:flex;gap:8px;margin-top:8px"><input type="checkbox" id="efb_newsup" checked> <span>Créer les ${newSup.length} nouveau${newSup.length > 1 ? "x" : ""} fournisseur${newSup.length > 1 ? "s" : ""} : ${esc(newSup.slice(0, 4).join(", "))}${newSup.length > 4 ? "…" : ""}</span></label>` : ""}`;
  $$("input[data-i]", m).forEach((c) => (c.onchange = () => { R[+c.dataset.i].on = c.checked; }));
}

const efbatchActions = { efbOpen: (id, arg) => efbOpen(id, arg), efbExport: () => efbOpen("", "export") };
