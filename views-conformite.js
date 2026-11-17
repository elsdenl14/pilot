/* Conformité « anti-fraude TVA » (art. 286 I 3° bis du CGI) + chargement des données v10.
   Ce que Pilot met en œuvre : inaltérabilité (factures émises verrouillées, journal chaîné par empreintes SHA-256 que même
   le propriétaire ne peut pas modifier), traçabilité (chaque émission, annulation, paiement, modification est journalisé),
   clôtures de période, archivage (export avec manifeste d'empreintes), numérotation continue contrôlée.
   Ce que Pilot NE PEUT PAS faire : se délivrer lui-même un certificat NF 525 ou une attestation individuelle. Cela relève
   d'un organisme accrédité (AFNOR, INFOCERT, LNE…) ou de l'éditeur du logiciel. Voir l'encart affiché dans l'onglet. */

const cfState = { verif: null, verifBusy: false, journalOpen: false };

/* ---------- Chargement des tables v10 ---------- */
async function loadV10() {
  db.v10 = false;
  db.cf = { journal: [], clotures: [] };
  db.ml = { modeles: [], gmail: null, mails: [] };
  db.nt = [];
  db.pv = { list: [], reserves: [] };
  try {
    const [cl, jr, mm, gm, ma, nt, pv, pr] = await Promise.all([
      q(sb.from("clotures").select("*").order("date_fin", { ascending: false })),
      q(sb.from("audit_journal").select("id,seq,at,evenement,table_name,record_id,detail,prev_hash,hash").order("seq", { ascending: false }).limit(300)),
      q(sb.from("mail_modeles").select("*").order("nom")),
      q(sb.from("gmail_connexions").select("user_id,email,statut,derniere_synchro,erreur,created_at").maybeSingle()),
      q(sb.from("mails_envoyes").select("*").order("date_mail", { ascending: false }).limit(300)),
      q(sb.from("notes").select("*").order("created_at", { ascending: false })),
      q(sb.from("pv_reception").select("id,numero,chantier_id,client_id,date_reception,type,lieu,objet,observations,delai_levee,statut,token,pdf_path,signataire_nom,signe_at,hash_pdf,user_agent,chemin_pdf,created_at").order("created_at", { ascending: false })),
      q(sb.from("pv_reserves").select("*").order("position")),
    ]);
    cl.forEach((c) => nz(c, ["total_ttc", "total_encaisse"]));
    db.cf = { journal: jr, clotures: cl };
    db.ml = { modeles: mm, gmail: gm || null, mails: ma };
    db.nt = nt;
    db.pv = { list: pv, reserves: pr };
    db.v10 = true;
  } catch (e) {
    db.v10err = e.message || String(e);
    console.warn("Migration v10 absente ou incomplète :", db.v10err);
  }
}

/* ---------- Événements applicatifs ---------- */
async function cfLog(evenement, detail = {}) {
  if (!db.v10 || ro) return;
  try { await sb.rpc("journal_ajouter", { p_ev: evenement, p_detail: detail }); } catch (e) { console.warn("Journal", e); }
}

/* ---------- Empreinte d'une facture émise ---------- */
async function cfEmpreinte(d, lignes) {
  const L = (lignes || []).map((l) => [l.designation, Number(l.quantite), Number(l.prix_unitaire_ht), Number(l.taux_tva)].join("~")).join("^");
  const s = ["v1", d.numero, d.date_emission, d.client_id, Number(d.montant_ht).toFixed(2), Number(d.montant_tva).toFixed(2), Number(d.montant_ttc).toFixed(2), L].join("|");
  return sha256Hex(new TextEncoder().encode(s));
}

/* ---------- Numérotation continue ---------- */
function cfNumerotation() {
  const groupes = {}, doublons = [], trous = [];
  const emis = db.factures.filter((f) => f.statut !== "Brouillon" && f.numero);
  for (const f of emis) {
    const m = String(f.numero).match(/^(.*?)(\d+)$/);
    if (!m) continue;
    (groupes[m[1]] ||= []).push({ n: parseInt(m[2], 10), w: m[2].length, num: f.numero });
  }
  for (const [pre, l] of Object.entries(groupes)) {
    l.sort((a, b) => a.n - b.n);
    for (let i = 1; i < l.length; i++) {
      if (l[i].n === l[i - 1].n) doublons.push(l[i].num);
      else if (l[i].n > l[i - 1].n + 1) trous.push(`${pre}${String(l[i - 1].n + 1).padStart(l[i].w, "0")}${l[i].n - l[i - 1].n > 2 ? " à " + pre + String(l[i].n - 1).padStart(l[i].w, "0") : ""}`);
    }
  }
  return { nb: emis.length, doublons, trous };
}

/* ---------- Contrôles ---------- */
function cfControles() {
  const num = cfNumerotation(), cl = db.cf.clotures[0], manq = typeof lgManquants === "function" ? lgManquants() : [];
  const v = cfState.verif, arch = db.cf.journal.find((j) => j.evenement === "archive_export");
  const jours = (iso) => Math.round((Date.now() - new Date(iso)) / 86400000);
  return [
    { t: "Journal d'audit inaltérable", ok: v ? v.ok : null, msg: v ? (v.ok ? `${v.nb} ligne${v.nb > 1 ? "s" : ""} vérifiée${v.nb > 1 ? "s" : ""}, chaîne intacte.` : `Anomalie à la ligne ${v.premier_defaut} : ${v.motif}`) : "Vérification en cours…" },
    { t: "Numérotation des factures continue", ok: !num.trous.length && !num.doublons.length, msg: !num.trous.length && !num.doublons.length ? `${num.nb} facture${num.nb > 1 ? "s" : ""} émise${num.nb > 1 ? "s" : ""}, sans trou ni doublon.` : `${num.trous.length ? "Numéro(s) manquant(s) : " + num.trous.join(", ") + ". " : ""}${num.doublons.length ? "Doublon(s) : " + num.doublons.join(", ") : ""}` },
    { t: "Mentions légales complètes", ok: !manq.length, msg: manq.length ? `${manq.length} point${manq.length > 1 ? "s" : ""} à compléter dans Paramètres (${manq.map((m) => m.t).join(", ")}).` : "Identité et mentions obligatoires renseignées." },
    { t: "Clôture périodique", ok: cl ? jours(cl.date_fin) <= 400 : false, warn: !cl, msg: cl ? `Dernière clôture : ${D(cl.date_fin)}.` : "Aucune clôture. Clôturez chaque mois ou chaque année pour figer les écritures." },
    { t: "Archivage (sauvegarde)", ok: arch ? jours(arch.at) <= 100 : false, warn: !arch, msg: arch ? `Dernière archive exportée le ${D(arch.at)}.` : "Aucune archive exportée. Faites-en une au moins chaque trimestre et conservez-la 6 ans." },
  ];
}

const CF_EV = {
  facture_creee: "Facture créée", facture_emise: "Facture émise", facture_annulee: "Facture annulée", facture_statut: "Statut de facture",
  facture_supprimee_brouillon: "Brouillon supprimé", paiement_enregistre: "Paiement enregistré", paiement_modifie: "Paiement modifié", paiement_supprime: "Paiement supprimé",
  cloture_periode: "Clôture de période", pv_signe: "PV de réception signé", archive_export: "Archive exportée", verification_journal: "Journal vérifié",
};
const cfDetail = (j) => {
  const d = j.detail || {};
  if (j.evenement.startsWith("paiement")) {
    const p = d.apres || d.avant || {};
    return `${p.montant != null ? E2(Number(p.montant)) : ""}${p.mode ? " · " + esc(p.mode) : ""}${p.date_paiement ? " · " + D(p.date_paiement) : ""}`;
  }
  if (j.evenement.startsWith("facture")) return `${esc(d.numero || "")}${d.vers ? " : " + esc(d.de) + " → " + esc(d.vers) : ""}${d.montant_ttc ? " · " + E2(Number(d.montant_ttc)) : ""}`;
  if (j.evenement === "cloture_periode") return `jusqu'au ${D(d.date_fin)}`;
  if (j.evenement === "pv_signe") return `${esc(d.numero || "")} · ${esc(d.signataire || "")}`;
  return esc(Object.entries(d).slice(0, 3).map(([k, v]) => `${k}: ${typeof v === "object" ? "…" : v}`).join(" · "));
};

async function cfVerifier(silencieux) {
  if (!db.v10) return;
  cfState.verifBusy = true;
  try {
    cfState.verif = await q(sb.rpc("journal_verifier"));
    if (!silencieux) { cfLog("verification_journal", { ok: cfState.verif.ok, nb: cfState.verif.nb }); toast(cfState.verif.ok ? "Journal vérifié : aucune altération." : "Anomalie détectée dans le journal.", cfState.verif.ok ? "ok" : "dn"); }
  } catch (e) { cfState.verif = { ok: false, nb: 0, motif: friendly(e) }; }
  cfState.verifBusy = false;
}

/* ---------- Onglet Conformité ---------- */
function cfTab(t) {
  if (!db.v10) {
    return page("Comptabilité", "Conformité anti-fraude TVA.", "", t + card("Migration requise", `<p class="note" style="margin:0">Exécutez <b>migration_v10.sql</b> dans Supabase (SQL Editor) pour activer le journal inaltérable, le verrouillage des factures émises et les clôtures.${db.v10err ? `<br><small class="mut">${esc(db.v10err)}</small>` : ""}</p>`));
  }
  const ctl = cfControles(), ko = ctl.filter((c) => c.ok === false).length;
  const cl = db.cf.clotures;
  const rowsCtl = ctl.map((c) => ({ c: [`<b>${esc(c.t)}</b>`, esc(c.msg), c.ok === null ? `<span class="chip n">…</span>` : c.ok ? `<span class="chip ok">OK</span>` : `<span class="chip ${c.warn ? "wn" : "dn"}">${c.warn ? "À faire" : "À corriger"}</span>`] }));
  const jr = db.cf.journal.slice(0, cfState.journalOpen ? 300 : 12);
  const rowsJ = jr.map((j) => ({ t: `${j.evenement} ${j.record_id}`, c: [`<span class="num">${j.seq}</span>`, esc(new Date(j.at).toLocaleString("fr-FR")), esc(CF_EV[j.evenement] || j.evenement), cfDetail(j), `<code title="${esc(j.hash)}">${esc(j.hash.slice(0, 10))}…</code>`] }));
  const rowsC = cl.map((c) => ({ c: [`<b>${D(c.date_fin)}</b>`, esc(c.libelle || ""), `${c.nb_factures} facture${c.nb_factures > 1 ? "s" : ""}`, `<span class="num">${E2(c.total_ttc)}</span>`, `<span class="num">${E2(c.total_encaisse)}</span>`, `<code title="${esc(c.empreinte || "")}">${esc((c.empreinte || "").slice(0, 10))}…</code>`] }));
  const html = page("Comptabilité", "Conformité à la loi anti-fraude à la TVA : inaltérabilité, traçabilité, clôture et archivage.", "", t +
    strip([
      ["Journal", String(db.cf.journal[0]?.seq || 0), "événements enregistrés"],
      ["Contrôles", ko ? `${ko} à corriger` : "Tout est conforme", "voir ci-dessous", ko ? "dn" : ""],
      ["Dernière clôture", cl[0] ? D(cl[0].date_fin) : "Aucune", "période figée"],
    ]) +
    card("Ce que Pilot fait, et ce qu'il ne fait pas", `<div class="cb" style="font-size:14px;line-height:1.55">
      <p style="margin:0 0 8px">La loi (art. 286 I 3° bis du CGI) impose aux logiciels qui enregistrent des paiements de clients d'être <b>inaltérables, sécurisés, conservés et archivés</b>. Pilot met en place :</p>
      <ul style="margin:0 0 10px 18px;padding:0">
        <li><b>Factures verrouillées</b> : une facture émise ne peut plus être modifiée ni supprimée (base de données), il faut passer par un avoir.</li>
        <li><b>Journal inaltérable</b> : chaque émission, annulation et paiement est enregistré avec la date exacte et une empreinte SHA-256 reliée à la précédente. Personne, pas même vous, ne peut en modifier une ligne sans casser la chaîne.</li>
        <li><b>Paiements tracés</b> : une correction ou une suppression de paiement reste visible dans le journal avec les valeurs avant / après.</li>
        <li><b>Clôtures</b> : une période clôturée ne peut plus recevoir ni perdre de paiement.</li>
        <li><b>Archive</b> : export complet (factures, paiements, journal, PDF) avec un manifeste d'empreintes, à conserver 6 ans.</li></ul>
      <p style="margin:0;padding:10px 12px;border:1px solid var(--line2);border-radius:8px;background:var(--bg2,#f6f7f9)"><b>Important :</b> Pilot applique ces principes mais ne détient <b>pas</b> de certificat NF 525 ni d'attestation d'un organisme accrédité. Si un contrôle fiscal vous le demande, ce justificatif doit venir d'un organisme accrédité ou de l'éditeur du logiciel ; Pilot ne peut pas se le délivrer lui-même. Les sanctions visent l'absence de logiciel conforme ou de justificatif (jusqu'à 7 500 € par logiciel). En cas de doute, demandez à votre comptable.</p></div>`) +
    card("Contrôles", tbl(["Contrôle", "Résultat", "État"], rowsCtl), btn("Vérifier maintenant", "cfVerifier", "", "", "o sm")) +
    card("Journal d'audit", tbl(["N°", "Date et heure", "Événement", "Détail", "Empreinte"], rowsJ, "Aucun événement pour le moment."),
      `${btn(cfState.journalOpen ? "Voir moins" : "Tout voir", "cfJournalToggle", "", "", "o sm")}${btn("Exporter (CSV)", "cfJournalCsv", "", "", "o sm")}`) +
    card("Clôtures de période", tbl(["Jusqu'au", "Libellé", "Factures", { h: "TTC émis", r: 1 }, { h: "Encaissé", r: 1 }, "Empreinte"], rowsC, "Aucune clôture."), btn("Clôturer une période", "cfCloture", "", "", "w")) +
    card("Archive fiscale", `<p class="note" style="margin:0;padding:14px 18px 4px">Télécharge un fichier ZIP : factures, lignes, paiements, journal, clôtures, PDF des factures et un manifeste avec l'empreinte de chaque fichier. Conservez-le 6 ans (10 ans pour les pièces comptables) sur un support autre que Pilot.</p><div class="cb">${btn("Télécharger l'archive", "cfArchive", "", "", "o")}</div>`));
  return { html, after: () => { if (!cfState.verif && !cfState.verifBusy) cfVerifier(true).then(() => { if (location.hash.startsWith("#/compta") && ST.tab.compta === "conformite") render(true); }); } };
}

/* ---------- Clôture ---------- */
function cfCloture() {
  if (!guard()) return;
  const d = new Date(), fin = new Date(d.getFullYear(), d.getMonth(), 0).toISOString().slice(0, 10);
  modal("Clôturer une période", `<p class="mut" style="margin:0 0 12px">Après la clôture, les paiements jusqu'à cette date ne pourront plus être ajoutés, modifiés ni supprimés. <b>Cette action est définitive.</b></p>
    ${fld({ k: "date_fin", l: "Clôturer jusqu'au (inclus)", t: "date", v: fin })}${fld({ k: "libelle", l: "Libellé", r: 0, v: "", ph: "ex. Mois de septembre 2026" })}`,
    { submit: "Clôturer définitivement", onSubmit: async (v, api) => {
      if (!confirm(`Clôturer définitivement jusqu'au ${D(v.date_fin)} ?`)) return;
      await q(sb.rpc("cloturer_periode", { p_date: v.date_fin, p_libelle: v.libelle || null }));
      api.close(); toast("Période clôturée.", "ok"); cfState.verif = null; await refresh();
    } });
}

/* ---------- Archive ---------- */
async function cfArchive() {
  if (!guard()) return;
  const ok = confirm("Préparer l'archive ? Les PDF des factures émises y seront inclus : cela peut prendre une minute.");
  if (!ok) return;
  toast("Préparation de l'archive…");
  await loadScript(LIBS.jszip);
  const zip = new JSZip(), files = {};
  const add = (name, content) => { zip.file(name, content); files[name] = content; };
  const emis = db.factures.filter((f) => f.statut !== "Brouillon");
  add("factures.csv", toCsv(["numero", "date_emission", "echeance", "client", "statut", "ht", "tva", "ttc", "paye"], emis.map((f) => [f.numero, f.date_emission, f.echeance, f.client_nom, f.statut, f.montant_ht, f.montant_tva, f.montant_ttc, f.paye])));
  const lg = [];
  for (const f of emis) { try { (await lignesOf("facture", f.id)).forEach((l) => lg.push([f.numero, l.designation, l.quantite, l.unite || "", l.prix_unitaire_ht, l.taux_tva])); } catch (e) { /* ignore */ } }
  add("lignes_factures.csv", toCsv(["facture", "designation", "quantite", "unite", "prix_unitaire_ht", "taux_tva"], lg));
  add("paiements.csv", toCsv(["date", "facture", "client", "montant", "mode", "reference"], db.paiements.map((p) => [p.date_paiement, p.facture_numero || "", p.client_nom || "", p.montant, p.mode || "", p.reference || ""])));
  const jr = await q(sb.from("audit_journal").select("seq,at,evenement,table_name,record_id,detail,prev_hash,hash").order("seq"));
  add("journal_audit.csv", toCsv(["seq", "date_utc", "evenement", "table", "enregistrement", "detail", "empreinte_precedente", "empreinte"], jr.map((j) => [j.seq, j.at, j.evenement, j.table_name || "", j.record_id || "", JSON.stringify(j.detail), j.prev_hash, j.hash])));
  add("clotures.csv", toCsv(["date_fin", "libelle", "factures", "total_ttc", "total_encaisse", "empreinte"], db.cf.clotures.map((c) => [c.date_fin, c.libelle || "", c.nb_factures, c.total_ttc, c.total_encaisse, c.empreinte || ""])));
  for (const f of emis.slice(0, 400)) {
    try { const b = await docPdfBytes("facture", f.id); zip.file(`factures_pdf/${slug(f.numero)}.pdf`, b); files[`factures_pdf/${slug(f.numero)}.pdf`] = b; } catch (e) { console.warn("PDF", f.numero, e); }
  }
  const man = [`Archive Pilot - ${db.ent.nom || ""}`, `Générée le ${new Date().toISOString()}`, `Dernière empreinte du journal : ${jr.length ? jr[jr.length - 1].hash : "(vide)"}`, "", "Empreintes SHA-256 des fichiers :"];
  for (const [n, c] of Object.entries(files)) man.push(`${await sha256Hex(typeof c === "string" ? new TextEncoder().encode(c) : c)}  ${n}`);
  man.push("", "Vérification : recalculer l'empreinte SHA-256 de chaque fichier (sha256sum) et la comparer à la liste ci-dessus.");
  zip.file("MANIFESTE.txt", man.join("\n"));
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  downloadBlob(`archive-pilot-${new Date().toISOString().slice(0, 10)}.zip`, blob);
  await cfLog("archive_export", { factures: emis.length, journal: jr.length });
  toast("Archive téléchargée. Conservez-la hors de Pilot.", "ok");
  await refresh();
}

async function cfJournalCsv() {
  const jr = await q(sb.from("audit_journal").select("seq,at,evenement,table_name,record_id,detail,prev_hash,hash").order("seq"));
  csvDl("journal-audit.csv", ["seq", "date_utc", "evenement", "table", "enregistrement", "detail", "empreinte_precedente", "empreinte"], jr.map((j) => [j.seq, j.at, j.evenement, j.table_name || "", j.record_id || "", JSON.stringify(j.detail), j.prev_hash, j.hash]));
}

const conformiteActions = {
  cfVerifier: async () => { await cfVerifier(false); await render(true); },
  cfJournalToggle: () => { cfState.journalOpen = !cfState.journalOpen; render(true); },
  cfJournalCsv, cfCloture, cfArchive,
};
