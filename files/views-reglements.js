/* Règlements clients (migration v9) :
   RIB · paiement en ligne · suivi des règlements · relances · crédits clients · trop-perçus · chèques et remises en banque.
   Tous les noms globaux de ce fichier commencent par rg / rl pour ne pas entrer en collision avec les autres vues. */

Object.assign(CHIP, {
  Reçu: "wn", Remis: "ac", Encaissé: "ok", Impayé: "dn", Déposée: "wn", Créditée: "ok",
  Promesse: "ac", Litige: "dn", Relance: "wn", "Virement annoncé": "ac", Payé: "ok", Appel: "n", Note: "n",
});

const rgEmpty = () => ({ ribs: [], cribs: [], cheques: [], remises: [], credits: [], suivi: [], liens: [] });
const setupV9 = (what = "cette fonction") =>
  `<p class="emp" style="padding:18px;margin:0;color:var(--mut)">Pour activer ${what}, exécutez <b>migration_v9.sql</b> dans Supabase (SQL Editor), puis rechargez la page.${db.v9err ? `<br><br>Erreur renvoyée par Supabase : <code>${esc(db.v9err)}</code>` : ""}</p>`;

async function loadV9() {
  const lst = (n, o = "created_at") => q(sb.from(n).select("*").order(o, { ascending: false }));
  const [ribs, cribs, cheques, remises, credits, suivi, liens] = await Promise.all([
    q(sb.from("ribs").select("*").order("created_at")), q(sb.from("client_ribs").select("*").order("created_at")),
    lst("cheques"), lst("remises_cheques"), lst("client_credits"), lst("reglement_suivi"), lst("paiement_liens"),
  ]);
  cheques.forEach((c) => nz(c, ["montant"]));
  credits.forEach((c) => nz(c, ["montant"]));
  suivi.forEach((s) => nz(s, ["montant", "niveau"]));
  liens.forEach((l) => nz(l, ["montant"]));
  db.rg = { ribs, cribs, cheques, remises, credits, suivi, liens };
}

/* ===================== Outils : IBAN, QR de virement ===================== */
const rgIbanClean = (s) => String(s || "").replace(/\s/g, "").toUpperCase();
const rgIbanFmt = (s) => rgIbanClean(s).replace(/(.{4})/g, "$1 ").trim();
function rgIbanOk(s) {
  s = rgIbanClean(s);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  let rem = 0;
  for (const ch of s.slice(4) + s.slice(0, 4)) for (const d of /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55)) rem = (rem * 10 + Number(d)) % 97;
  return rem === 1;
}
const rgAscii = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7e]/g, " ");
// Rib par défaut : celui de la table `ribs`, sinon l'IBAN historique de la fiche entreprise
function rgRibDefaut() {
  const l = (db.rg?.ribs || []).filter((r) => r.actif !== false);
  const r = l.find((x) => x.par_defaut) || l[0];
  if (r) return r;
  return db.ent.iban ? { libelle: "RIB", titulaire: db.ent.nom, iban: db.ent.iban, bic: db.ent.bic, virtuel: true } : null;
}
const rgRibLine = (r = rgRibDefaut()) => (r ? `IBAN ${rgIbanFmt(r.iban)}${r.bic ? " · BIC " + r.bic : ""}${r.titulaire ? " · titulaire : " + r.titulaire : ""}` : "");
// Texte du QR code « virement SEPA » (norme EPC069-12) : montant et référence préremplis dans l'appli bancaire
function rgEpcText(f, r = rgRibDefaut()) {
  if (!r || !r.iban || !(f.reste > 0.005)) return null;
  return ["BCD", "002", "1", "SCT", rgAscii(r.bic || "").replace(/\s/g, ""), rgAscii(r.titulaire || db.ent.nom || "").slice(0, 70), rgIbanClean(r.iban), "EUR" + r2(f.reste).toFixed(2), "", "", rgAscii("Facture " + f.numero).slice(0, 140)].join("\n");
}
function rgQr(text) {
  if (!text || typeof qrcode !== "function") return null;
  try {
    const m = qrcode(0, "M");
    m.addData(text, "Byte");
    m.make();
    const n = m.getModuleCount(), rows = [];
    for (let r = 0; r < n; r++) { let s = ""; for (let c = 0; c < n; c++) s += m.isDark(r, c) ? "1" : "0"; rows.push(s); }
    return rows;
  } catch (e) { return null; }
}
const rgEpcMatrix = (f) => rgQr(rgEpcText(f));
function rgQrSvg(rows, px = 132) {
  const n = rows.length, t = n + 8;
  let d = "";
  rows.forEach((row, y) => { for (let x = 0; x < n; ) { if (row[x] === "1") { let k = x; while (k < n && row[k] === "1") k++; d += `M${x + 4} ${y + 4}h${k - x}v1h-${k - x}z`; x = k; } else x++; } });
  return `<svg class="rg-qr" viewBox="0 0 ${t} ${t}" width="${px}" height="${px}" role="img" aria-label="QR code de virement" shape-rendering="crispEdges"><rect width="${t}" height="${t}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

/* ===================== Données ===================== */
const rgCredit = (cid) => r2(sum((db.rg?.credits || []).filter((c) => c.client_id === cid), (c) => c.montant));
const rgCreditTotal = () => {
  const by = {};
  (db.rg?.credits || []).forEach((c) => (by[c.client_id] = (by[c.client_id] || 0) + c.montant));
  return Object.entries(by).map(([id, m]) => [id, r2(m)]).filter(([, m]) => m > 0.005);
};
// Mouvements qui ont réellement touché la trésorerie (un avoir ou un ajustement n'est pas un encaissement)
const RG_CASH = new Set(["Trop-perçu", "Avance", "Utilisation", "Remboursement"]);
const rgCashAdj = (to) => (db.v9 ? r2(sum(db.rg.credits.filter((c) => RG_CASH.has(c.type) && (!to || c.date_op <= to)), (c) => c.montant)) : 0);
const rgSuiviOf = (fid) => (db.rg?.suivi || []).filter((s) => s.facture_id === fid).sort((a, b) => String(b.created_at || b.date_op).localeCompare(String(a.created_at || a.date_op)));
const rgLastRelance = (fid) => rgSuiviOf(fid).find((s) => s.type === "Relance");
const rgPromesse = (fid) => rgSuiviOf(fid).find((s) => s.type === "Promesse" && s.date_promesse);
const rgAnnonce = (fid) => rgSuiviOf(fid).find((s) => s.type === "Virement annoncé");
const rgChequesOf = (fid) => (db.rg?.cheques || []).filter((c) => c.facture_id === fid);
const rgBucket = (f) => { const d = daysBetween(f.echeance, today()); return d <= 0 ? 0 : d <= 30 ? 1 : d <= 60 ? 2 : d <= 90 ? 3 : 4; };

// Enregistre un règlement ; si le montant dépasse le reste dû, l'excédent devient un crédit client (trop-perçu).
async function rgPay(f, montant, date, mode, reference, opt = {}) {
  const m = r2(montant), appl = Math.min(m, Math.max(0, f.reste)), ex = r2(m - appl);
  let pay = null;
  if (appl > 0.005) pay = await q(sb.from("paiements").insert({ facture_id: f.id, montant: appl, date_paiement: date, mode, reference: reference || null }).select("id").single());
  if (ex > 0.005) {
    try {
      await q(sb.from("client_credits").insert({ client_id: f.client_id, montant: ex, type: "Trop-perçu", facture_id: f.id, paiement_id: pay?.id || null, cheque_id: opt.cheque_id || null, date_op: date, mode, reference: reference || null, motif: `Excédent sur ${f.numero}` }));
    } catch (e) { if (pay) { try { await q(sb.from("paiements").delete().eq("id", pay.id)); } catch (e2) {} } throw e; }
  }
  return { pay, ex };
}
const rgExcessMsg = (f, m) => `Ce montant dépasse le reste dû (${E2(f.reste)}) de ${E2(r2(m - f.reste))}.\n\nPilot enregistre ${E2(f.reste)} sur la facture ${f.numero} et garde ${E2(r2(m - f.reste))} en crédit pour ${f.client_nom} (trop-perçu). Vous pourrez l'utiliser sur une prochaine facture ou le rembourser.`;

/* ===================== Navigation / onglets de « Paiements » ===================== */
function rgTab(tab, t) {
  if (!db.v9) {
    const what = { suivi: "le suivi des règlements et les relances", cheques: "la gestion des chèques", credits: "les crédits clients et les trop-perçus" }[tab] || "les règlements clients";
    return page("Paiements", "Ce qui entre, ce qui sort, et ce qu'il reste à encaisser.", "", t + card("", setupV9(what)));
  }
  return tab === "suivi" ? rgSuiviTab(t) : tab === "cheques" ? rgChequesTab(t) : rgCreditsTab(t);
}

/* ===================== Suivi des règlements ===================== */
function rgSuiviTab(t) {
  const ouv = ouvertes(), tj = today(), late = enRetard();
  const prom = ouv.filter((f) => { const p = rgPromesse(f.id); return p && p.date_promesse >= tj; });
  const rel30 = db.rg.suivi.filter((s) => s.type === "Relance" && daysBetween(s.date_op, tj) <= 30);
  const flt = ST.tab.rgf || "all";
  const list = ouv.filter((f) => flt === "late" ? f.statut_affiche === "En retard" : flt === "prom" ? !!rgPromesse(f.id) || !!rgAnnonce(f.id) : true)
    .sort((a, b) => (b.statut_affiche === "En retard") - (a.statut_affiche === "En retard") || a.echeance.localeCompare(b.echeance));
  // Balance âgée par client
  const by = {};
  ouv.forEach((f) => { const o = (by[f.client_id] ||= { nom: f.client_nom, b: [0, 0, 0, 0, 0] }); o.b[rgBucket(f)] += f.reste; });
  const tot = [0, 0, 0, 0, 0];
  const ageRows = Object.entries(by).map(([id, o]) => { o.b.forEach((v, i) => (tot[i] += v)); return { id, o, s: sum(o.b) }; }).sort((a, b) => b.s - a.s)
    .map(({ id, o, s }) => ({ go: `clients/${id}`, t: o.nom, c: [`<strong>${esc(o.nom)}</strong>`, ...o.b.map((v, i) => `<span class="num ${i >= 2 && v ? "dn" : ""}">${v ? E2(v) : "-"}</span>`), `<span class="num"><b>${E2(s)}</b></span>`] }));
  if (ageRows.length) ageRows.push({ cls: "tot", c: ["<strong>Total</strong>", ...tot.map((v) => `<span class="num">${v ? E2(v) : "-"}</span>`), `<span class="num"><b>${E2(sum(tot))}</b></span>`] });
  const rows = list.map((f) => {
    const lr = rgLastRelance(f.id), p = rgPromesse(f.id), an = rgAnnonce(f.id), d = daysBetween(f.echeance, tj);
    const aRel = f.statut_affiche === "En retard" && (!lr || daysBetween(lr.date_op, tj) >= 7) && !(p && p.date_promesse >= tj);
    return { go: `factures/${f.id}`, t: `${f.numero} ${f.client_nom}`, c: [
      `<strong>${esc(f.numero)}</strong><small>${esc(f.client_nom)}</small>`,
      `${D(f.echeance)}${d > 0 ? `<small class="dn">${d} j de retard</small>` : d === 0 ? "<small>aujourd'hui</small>" : `<small>dans ${-d} j</small>`}`,
      `<span class="num">${E2(f.reste)}</span>`,
      lr ? `<span class="chip wn">Relance ${lr.niveau || 1}</span><small>${D(lr.date_op)}${lr.canal ? " · " + esc(lr.canal) : ""}</small>` : (aRel ? `<span class="chip dn">à relancer</span>` : "-"),
      p ? `${D(p.date_promesse)}<small class="${p.date_promesse < tj ? "dn" : ""}">${p.date_promesse < tj ? "promesse non tenue" : "promesse de paiement"}${p.source === "client" ? " · faite par le client" : ""}</small>` : an ? `<span class="chip ac">Virement annoncé</span><small>${D(an.date_op)}</small>` : "-",
      `<span class="r">${btn("Relancer", "factureRelance", f.id, "", "o sm w")} ${btn("Noter", "rgNote", f.id, "", "o sm w")} ${btn("Encaisser", "payNew", f.id, "", "o sm w")}</span>`] };
  });
  const hist = db.rg.suivi.slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 25).map((s) => {
    const f = byId(db.factures, s.facture_id);
    return { go: `factures/${s.facture_id}`, t: `${f?.numero || ""} ${f?.client_nom || ""} ${s.type} ${s.note || ""}`, c: [D(s.date_op), `<strong>${esc(f?.numero || "-")}</strong><small>${esc(f?.client_nom || "")}</small>`, `${chip(s.type)}${s.niveau ? ` <small>niveau ${s.niveau}</small>` : ""}`, `${esc(s.canal || (s.source === "client" ? "Client" : ""))}${s.date_promesse ? `<small>pour le ${D(s.date_promesse)}</small>` : ""}`, `<small>${esc(s.note || "")}</small>`] };
  });
  const ft = tabs("rgf", [["all", `Toutes (${ouv.length})`], ["late", `En retard (${late.length})`], ["prom", "Promesses et virements annoncés"]], flt);
  return page("Paiements", "Ce qui entre, ce qui sort, et ce qu'il reste à encaisser.", btn("Enregistrer un paiement", "payNew", "", "", "w"),
    t + strip([
      ["À encaisser", E(sum(ouv, (f) => f.reste)), `${ouv.length} facture${ouv.length > 1 ? "s" : ""} ouverte${ouv.length > 1 ? "s" : ""}`],
      ["En retard", E(sum(late, (f) => f.reste)), `${late.length} facture${late.length > 1 ? "s" : ""}`, late.length ? "dn" : ""],
      ["Promesses de paiement", E(sum(prom, (f) => f.reste)), `${prom.length} en cours`],
      ["Relances (30 jours)", rel30.length, "envoyées depuis Pilot"],
    ]) +
    card("Balance âgée par client", tbl(["Client", { h: "Non échu", r: 1 }, { h: "1 à 30 j", r: 1 }, { h: "31 à 60 j", r: 1 }, { h: "61 à 90 j", r: 1 }, { h: "+ de 90 j", r: 1 }, { h: "Total", r: 1 }], ageRows, "Aucune facture en attente de paiement."), "", "rg-age") +
    card("Factures à suivre", ft + tbl(["Facture", "Échéance", { h: "Reste dû", r: 1 }, "Dernière relance", "Promesse / client", ""], rows, "Rien à suivre dans cette vue.")) +
    card("Historique des relances et échanges", tbl(["Date", "Facture", "Type", "Canal", "Détail"], hist, "Aucune relance enregistrée pour le moment. Elles apparaissent ici dès que vous relancez un client depuis Pilot.")));
}

/* ===================== Relances ===================== */
const RL_NIV = { 1: "Rappel amiable", 2: "Relance ferme", 3: "Mise en demeure" };
function rlSuggere(f) {
  const d = daysBetween(f.echeance, today()), last = rgLastRelance(f.id)?.niveau || 0;
  return Math.min(3, Math.max(d > 45 ? 3 : d > 15 ? 2 : 1, last ? last + 1 : 1));
}
function rlText(f, n, o = {}) {
  const c = clientOf(f.client_id) || {}, e = db.ent, pro = c.type === "Professionnel", tj = today();
  const p = partageOf(f.id), link = o.lien && p ? shareLink(p.token) : "", rib = o.rib ? rgRibLine() : "";
  const retard = Math.max(0, daysBetween(f.echeance, tj)), last = rgLastRelance(f.id);
  const m = E2(f.reste), ref = `facture n° ${f.numero} du ${D(f.date_emission)} (échéance le ${D(f.echeance)})`;
  const hello = pro ? "Madame, Monsieur," : "Bonjour,";
  const pay = [link ? `Vous pouvez la régler directement depuis cette page : ${link}` : "", rib ? `Coordonnées bancaires : ${rib} (référence à indiquer : ${f.numero}).` : ""].filter(Boolean).join("\n");
  const pen = pro ? " Des pénalités de retard (trois fois le taux d'intérêt légal) ainsi que l'indemnité forfaitaire de recouvrement de 40 € (art. L441-10 du Code de commerce) sont exigibles." : "";
  const sign = `Cordialement,\n${e.nom || ""}${e.telephone ? "\n" + e.telephone : ""}`;
  if (n === 1) return { sujet: `Rappel : facture ${f.numero}`, corps: `${hello}\n\nSauf erreur de notre part, la ${ref}, d'un montant restant dû de ${m} TTC, n'a pas encore été réglée.\n\nMerci de procéder au règlement dans les meilleurs délais. Si votre paiement est déjà parti, ne tenez pas compte de ce message.${pay ? "\n\n" + pay : ""}\n\n${sign}` };
  if (n === 2) return { sujet: `Relance : facture ${f.numero} impayée`, corps: `${hello}\n\nMalgré ${last ? `notre précédent rappel du ${D(last.date_op)}` : "notre rappel"}, la ${ref} reste impayée à ce jour (${retard} jour${retard > 1 ? "s" : ""} de retard) pour un montant de ${m} TTC.\n\nNous vous demandons de la régler sous 8 jours.${pen}${pay ? "\n\n" + pay : ""}\n\nSi un problème empêche ce règlement, merci de nous contacter pour que nous trouvions une solution.\n\n${sign}` };
  return { sujet: `Mise en demeure de payer : facture ${f.numero}`, corps: `${hello}\n\nMalgré nos relances${last ? ` (dernière en date du ${D(last.date_op)})` : ""}, la ${ref} reste impayée : ${m} TTC.\n\nPar la présente, nous vous mettons en demeure de nous régler cette somme sous 8 jours à compter de la réception de ce courrier. À défaut, nous nous réservons le droit d'engager toute procédure de recouvrement, les frais en résultant restant à votre charge.${pen}${pay ? "\n\n" + pay : ""}\n\n${sign}` };
}
function rlOpen(fid) {
  if (!guard()) return;
  const f = byId(db.factures, fid), c = clientOf(f.client_id) || {};
  if (!f || !(f.reste > 0.005)) return toast("Cette facture est déjà réglée.", "dn");
  const p = partageOf(fid), n0 = rlSuggere(f), lr = rgLastRelance(fid), pr = rgPromesse(fid);
  const o0 = { lien: !!p, rib: !!rgRibDefaut() };
  const t0 = rlText(f, n0, o0);
  const info = [lr ? `Dernière relance : niveau ${lr.niveau || 1} le ${D(lr.date_op)}.` : "Aucune relance envoyée pour l'instant.", pr ? `Promesse de paiement pour le ${D(pr.date_promesse)}${pr.date_promesse >= today() ? " : pas encore échue" : " : non tenue"}.` : ""].filter(Boolean).join(" ");
  const body = `<p class="mut" style="margin:0 0 12px">${esc(info)}</p><div class="frm">
    ${fld({ k: "niveau", l: "Niveau de relance", t: "select", o: [1, 2, 3].map((n) => ({ v: n, l: `${n} · ${RL_NIV[n]}` })), v: n0 })}
    ${fld({ k: "canal", l: "Canal", t: "select", o: ["Email", "SMS / WhatsApp", "Téléphone", "Courrier"], v: "Email" })}
    <label class="fl"><span>Joindre</span><span style="display:flex;gap:14px;flex-wrap:wrap;padding:8px 0"><label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="rl_lien" ${p ? "checked" : "disabled"}> le lien de paiement</label><label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="rl_rib" ${o0.rib ? "checked" : "disabled"}> mon RIB</label></span>${p ? "" : `<small>Envoyez d'abord la facture au client (« Envoyer au client ») pour pouvoir joindre le lien de paiement.</small>`}</label>
    ${fld({ k: "sujet", l: "Objet", v: t0.sujet, cls: "full" })}
    ${fld({ k: "corps", l: "Message", t: "textarea", v: t0.corps, cls: "full", rows: 13 })}
    <p class="mut full" id="rl_n3" style="margin:0" ${n0 === 3 ? "" : "hidden"}>Pour avoir une valeur probante, envoyez la mise en demeure par lettre recommandée avec accusé de réception (canal « Courrier »). Pilot enregistre la relance, il ne remplace pas un conseil juridique.</p></div>`;
  modal(`Relancer · ${esc(f.numero)} · ${esc(f.client_nom)}`, body, {
    wide: true, submit: "Envoyer et enregistrer la relance",
    onMount: (m) => {
      let edited = false;
      const regen = () => { if (edited) return; const t = rlText(f, Number($("#f_niveau", m).value), { lien: $("#rl_lien", m).checked, rib: $("#rl_rib", m).checked }); $("#f_sujet", m).value = t.sujet; $("#f_corps", m).value = t.corps; };
      $("#f_corps", m).addEventListener("input", () => (edited = true));
      $("#f_niveau", m).onchange = () => { $("#rl_n3", m).hidden = $("#f_niveau", m).value !== "3"; if (edited && !confirm("Remplacer le message que vous avez modifié par le modèle de ce niveau ?")) return; edited = false; regen(); };
      $("#rl_lien", m).onchange = regen; $("#rl_rib", m).onchange = regen;
    },
    onSubmit: async (v, api) => {
      const canal = v.canal;
      if (canal === "Email" && !c.email) throw new Error("Ce client n'a pas d'adresse email : ajoutez-la dans sa fiche ou choisissez un autre canal.");
      await q(sb.from("reglement_suivi").insert({ facture_id: fid, type: "Relance", niveau: Number(v.niveau), canal, date_op: today(), montant: f.reste, note: v.sujet }));
      api.close();
      await refresh();
      if (canal === "Email") location.href = `mailto:${encodeURIComponent(c.email)}?subject=${encodeURIComponent(v.sujet)}&body=${encodeURIComponent(v.corps)}`;
      else if (canal === "Téléphone") toast("Appel noté dans l'historique.", "ok");
      else { try { await navigator.clipboard.writeText(v.corps); toast("Message copié : collez-le dans votre messagerie ou votre courrier. Relance enregistrée.", "ok"); } catch (e) { toast("Relance enregistrée.", "ok"); } }
    },
  });
}
function rgNote(fid) {
  if (!guard()) return;
  const f = byId(db.factures, fid);
  const body = `<div class="frm">${fld({ k: "type", l: "Que voulez-vous noter ?", t: "select", o: [{ v: "Promesse", l: "Une promesse de paiement" }, { v: "Appel", l: "Un appel / un échange" }, { v: "Note", l: "Une note" }, { v: "Litige", l: "Un litige (contestation)" }], v: "Promesse", cls: "full" })}
    ${fld({ k: "date_promesse", l: "Le client paiera le", t: "date", v: addDays(today(), 7), r: 0 })}
    ${fld({ k: "montant", l: "Montant promis (€)", t: "number", v: String(f.reste).replace(".", ","), r: 0 })}
    ${fld({ k: "note", l: "Détail", t: "textarea", v: "", r: 0, cls: "full" })}</div>`;
  modal(`Noter un échange · ${esc(f.numero)}`, body, {
    onMount: (m) => { const s = $("#f_type", m), sync = () => { const pm = s.value === "Promesse"; $("#f_date_promesse", m).closest("label").hidden = !pm; $("#f_montant", m).closest("label").hidden = !pm; }; s.onchange = sync; sync(); },
    onSubmit: async (v, api) => {
      if (v.type === "Promesse" && !v.date_promesse) throw new Error("Indiquez la date promise.");
      if (v.type !== "Promesse" && !String(v.note || "").trim()) throw new Error("Ajoutez un détail.");
      await q(sb.from("reglement_suivi").insert({ facture_id: f.id, type: v.type, date_op: today(), date_promesse: v.type === "Promesse" ? v.date_promesse : null, montant: v.type === "Promesse" ? parseNum(v.montant) || null : null, note: v.note || null }));
      api.close(); toast("Enregistré dans l'historique de la facture.", "ok"); await refresh();
    },
  });
}

/* ===================== Carte « Suivi du règlement » dans la fiche facture ===================== */
function rgInvoiceCard(d) {
  if (!db.v9 || d.statut === "Brouillon" || d.statut === "Annulée") return "";
  const ouvert = d.reste > 0.005, cr = rgCredit(d.client_id), suivi = rgSuiviOf(d.id), cq = rgChequesOf(d.id), liens = db.rg.liens.filter((l) => l.facture_id === d.id);
  const epc = ouvert ? rgEpcMatrix(d) : null, rib = rgRibDefaut();
  let h = "";
  if (ouvert && rib) h += `<div class="row rg-pay"><div><b>Paiement par virement</b><small>${esc(rgRibLine(rib))}<br>Référence : ${esc(d.numero)}</small></div>${epc ? rgQrSvg(epc, 104) : ""}</div>`;
  if (ouvert && cr > 0.005) h += `<div class="row"><div><b>Crédit disponible : ${E2(cr)}</b><small>Trop-perçu ou avoir de ${esc(d.client_nom)}</small></div>${btn("Utiliser", "rgCrUse", d.client_id, d.id, "o sm w")}</div>`;
  h += liens.map((l) => `<div class="row"><div><b>Paiement en ligne · ${E2(l.montant)}</b><small>${D(l.created_at)}${l.paid_at ? " · payé le " + D(l.paid_at) : ""}</small></div>${chip(l.statut)}</div>`).join("");
  h += cq.map((c) => `<div class="row"><div><b>Chèque ${esc(c.numero || "")} · ${E2(c.montant)}</b><small>reçu le ${D(c.date_reception)}${c.banque ? " · " + esc(c.banque) : ""}</small></div>${chip(c.statut)}</div>`).join("");
  h += suivi.slice(0, 8).map((s) => `<div class="row"><div><b>${chip(s.type)}${s.niveau ? ` niveau ${s.niveau}` : ""}</b><small>${D(s.date_op)}${s.canal ? " · " + esc(s.canal) : ""}${s.source === "client" ? " · client" : ""}${s.date_promesse ? " · pour le " + D(s.date_promesse) : ""}${s.note ? "<br>" + esc(s.note) : ""}</small></div></div>`).join("");
  if (!h) h = `<p class="mut" style="margin:0;padding:16px 18px">Aucune relance, promesse ou chèque pour cette facture.</p>`;
  return card("Suivi du règlement", h, ouvert ? btn("Relancer", "factureRelance", d.id, "", "o sm w") + btn("Noter", "rgNote", d.id, "", "o sm w") : btn("Noter", "rgNote", d.id, "", "o sm w"));
}

/* ===================== Crédits clients et trop-perçus ===================== */
function rgCreditsTab(t) {
  const soldes = rgCreditTotal().sort((a, b) => b[1] - a[1]), tj = today();
  const rows = soldes.map(([id, m]) => {
    const c = clientOf(id), mv = db.rg.credits.filter((x) => x.client_id === id).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
    const ouv = ouvertes().filter((f) => f.client_id === id);
    return { go: `clients/${id}`, t: c?.nom || "", c: [`<strong>${esc(c?.nom || "?")}</strong>${ouv.length ? `<small>${ouv.length} facture${ouv.length > 1 ? "s" : ""} ouverte${ouv.length > 1 ? "s" : ""} : ${E2(sum(ouv, (f) => f.reste))}</small>` : ""}`,
      `<span class="num"><b>${E2(m)}</b></span>`, mv ? `${esc(mv.type)}<small>${D(mv.date_op)}</small>` : "-",
      `<span class="r">${ouv.length ? btn("Utiliser", "rgCrUse", id, "", "o sm w") : ""} ${btn("Rembourser", "rgCrRef", id, "", "o sm w")}</span>`] };
  });
  const mv = db.rg.credits.slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 40).map((x) => {
    const f = x.facture_id ? byId(db.factures, x.facture_id) : null;
    return { t: `${clientOf(x.client_id)?.nom || ""} ${x.type} ${x.motif || ""}`, c: [D(x.date_op), `<strong>${esc(clientOf(x.client_id)?.nom || "?")}</strong>`, `${esc(x.type)}${f ? `<small>${esc(f.numero)}</small>` : ""}`, `<small>${esc([x.mode, x.reference, x.motif].filter(Boolean).join(" · "))}</small>`,
      `<span class="num ${x.montant < 0 ? "" : "up"}">${x.montant > 0 ? "+" : ""}${E2(x.montant)}</span>`, `<span class="r">${guardless() ? "" : btn("Annuler", "rgCrDel", x.id, "", "lk w")}</span>`] };
  });
  const tp = db.rg.credits.filter((x) => x.type === "Trop-perçu" && daysBetween(x.date_op, tj) <= 365);
  return page("Paiements", "Ce qui entre, ce qui sort, et ce qu'il reste à encaisser.", btn("Ajouter un crédit", "rgCrAdd", "", "", "o w"),
    t + strip([
      ["Crédits clients disponibles", E(sum(soldes, ([, m]) => m)), `${soldes.length} client${soldes.length > 1 ? "s" : ""}`, soldes.length ? "up" : ""],
      ["Trop-perçus (12 mois)", E(sum(tp, (x) => x.montant)), `${tp.length} cas`],
      ["Remboursés (12 mois)", E(-sum(db.rg.credits.filter((x) => x.type === "Remboursement" && daysBetween(x.date_op, tj) <= 365), (x) => x.montant)), "argent rendu aux clients"],
      ["Imputés sur des factures", E(-sum(db.rg.credits.filter((x) => x.type === "Utilisation" && daysBetween(x.date_op, tj) <= 365), (x) => x.montant)), "12 derniers mois"],
    ]) +
    `<p class="note" style="margin:0 0 14px">Un <b>trop-perçu</b> naît quand un client paie plus que le reste dû : Pilot solde la facture et garde l'excédent ici, en crédit. Vous pouvez l'<b>imputer</b> sur une autre facture du client ou le <b>rembourser</b>. Un avoir ou une avance reçue sans facture se gèrent de la même façon.</p>` +
    card("Clients ayant un crédit", tbl(["Client", { h: "Crédit disponible", r: 1 }, "Dernier mouvement", ""], rows, "Aucun crédit client. Un trop-perçu apparaît ici automatiquement.")) +
    card("Mouvements", tbl(["Date", "Client", "Type", "Détail", { h: "Montant", r: 1 }, ""], mv, "Aucun mouvement.")));
}
const guardless = () => ro;

function rgCreditForm(kind, cid, fidPref) {
  if (!guard()) return;
  const clients = db.clients;
  const bal0 = cid ? rgCredit(cid) : 0;
  const pick = !cid;
  const cl = pick ? (rgCreditTotal()[0]?.[0] || clients[0]?.id) : cid;
  if (!clients.length) return toast("Créez d'abord un client.", "dn");
  const title = { use: "Utiliser un crédit sur une facture", ref: "Rembourser un crédit client", add: "Ajouter un crédit client" }[kind];
  const avoirsOf = (id) => (typeof fxIsAvoir === "function" && db.v8 ? db.factures.filter((f) => f.client_id === id && fxIsAvoir(f) && f.statut !== "Brouillon" && f.statut !== "Annulée" && !db.rg.credits.some((x) => x.facture_id === f.id && x.type === "Avoir")) : []);
  const body = `<div class="frm">${pick || kind === "add" ? fld({ k: "client_id", l: "Client", t: "select", o: clients.map((c) => ({ v: c.id, l: c.nom })), v: cl, cls: "full" }) : `<input type="hidden" name="client_id" id="f_client_id" value="${esc(cl)}"><p class="full" style="margin:0"><b>${esc(clientOf(cl)?.nom || "")}</b><span class="mut" id="rg_bal"></span></p>`}
    ${kind === "use" ? fld({ k: "facture_id", l: "Facture à régler", t: "select", o: [{ v: "", l: "…" }], v: "", cls: "full" }) : ""}
    ${kind === "add" ? fld({ k: "type", l: "Nature du crédit", t: "select", o: [{ v: "Avoir", l: "Avoir / geste commercial (aucun argent reçu)" }, { v: "Avance", l: "Avance reçue sans facture (argent encaissé)" }], v: "Avoir", cls: "full" }) + `<div id="rg_av" class="full"></div>` : ""}
    ${fld({ k: "montant", l: "Montant (€)", t: "number", v: "" })}
    ${fld({ k: "date_op", l: "Date", t: "date", v: today() })}
    ${kind === "ref" ? fld({ k: "mode", l: "Remboursé par", t: "select", o: ["Virement", "Chèque", "Espèces", "Carte"], v: "Virement" }) + `<div class="full" id="rg_rib"></div>` : ""}
    ${kind === "add" ? fld({ k: "motif", l: "Motif", v: "", r: 0, cls: "full" }) : fld({ k: "reference", l: "Référence (facultatif)", v: "", r: 0, cls: "full" })}</div>`;
  const api = modal(title, body, {
    onMount: (m) => {
      const sel = $("#f_client_id", m);
      const upd = () => {
        const id = sel.value, bal = rgCredit(id);
        if ($("#rg_bal", m)) $("#rg_bal", m).textContent = ` · crédit disponible ${E2(bal)}`;
        if (kind === "use") {
          const ouv = ouvertes().filter((f) => f.client_id === id), fs = $("#f_facture_id", m);
          fs.innerHTML = ouv.length ? ouv.map((f) => `<option value="${f.id}"${f.id === fidPref ? " selected" : ""}>${esc(f.numero)} · reste ${E2(f.reste)}</option>`).join("") : `<option value="">Aucune facture ouverte</option>`;
          const f = byId(ouv, fs.value);
          $("#f_montant", m).value = String(f ? Math.min(bal, f.reste) : bal).replace(".", ",");
          fs.onchange = () => { const g = byId(ouv, fs.value); if (g) $("#f_montant", m).value = String(Math.min(bal, g.reste)).replace(".", ","); };
        } else if (kind === "ref") {
          $("#f_montant", m).value = String(Math.max(0, bal)).replace(".", ",");
          const ribs = db.rg.cribs.filter((r) => r.client_id === id);
          $("#rg_rib", m).innerHTML = ribs.length ? `<p class="mut" style="margin:0">RIB du client : ${ribs.map((r) => esc(rgIbanFmt(r.iban))).join(" · ")}</p>` : `<p class="mut" style="margin:0">Aucun RIB enregistré pour ce client : ajoutez-le depuis sa fiche pour le retrouver ici.</p>`;
        } else {
          const av = avoirsOf(id);
          $("#rg_av", m).innerHTML = av.length ? `<label class="fl"><span>Créditer depuis un avoir émis</span><select id="rg_avs"><option value="">Non, saisir un montant</option>${av.map((f) => `<option value="${f.id}">${esc(f.numero)} · ${E2(Math.abs(f.montant_ttc))}</option>`).join("")}</select></label>` : "";
          const s2 = $("#rg_avs", m);
          if (s2) s2.onchange = () => { const f = byId(av, s2.value); if (f) { $("#f_montant", m).value = String(Math.abs(f.montant_ttc)).replace(".", ","); $("#f_type", m).value = "Avoir"; $("#f_motif", m).value = "Avoir " + f.numero; } };
        }
      };
      if (sel.tagName === "SELECT") sel.onchange = upd;
      upd();
    },
    onSubmit: async (v, api) => {
      const id = v.client_id, m = parseNum(v.montant), bal = rgCredit(id);
      if (m <= 0) throw new Error("Le montant doit être supérieur à zéro.");
      if (kind === "use") {
        const f = byId(db.factures, v.facture_id);
        if (!f) throw new Error("Choisissez la facture à régler.");
        if (m > bal + 0.005) throw new Error(`Le crédit disponible est de ${E2(bal)}.`);
        if (m > f.reste + 0.005) throw new Error(`Ce montant dépasse le reste dû de la facture (${E2(f.reste)}).`);
        const pay = await q(sb.from("paiements").insert({ facture_id: f.id, montant: m, date_paiement: v.date_op, mode: "Crédit client", reference: v.reference || "Imputation d'un crédit client" }).select("id").single());
        try { await q(sb.from("client_credits").insert({ client_id: id, montant: -m, type: "Utilisation", facture_id: f.id, paiement_id: pay.id, date_op: v.date_op, mode: "Crédit client", reference: v.reference || null })); }
        catch (e) { try { await q(sb.from("paiements").delete().eq("id", pay.id)); } catch (e2) {} throw e; }
        toast(`${E2(m)} imputés sur ${esc(f.numero)}.`, "ok");
      } else if (kind === "ref") {
        if (m > bal + 0.005) throw new Error(`Le crédit disponible est de ${E2(bal)}.`);
        await q(sb.from("client_credits").insert({ client_id: id, montant: -m, type: "Remboursement", date_op: v.date_op, mode: v.mode, reference: v.reference || null }));
        toast(`Remboursement de ${E2(m)} enregistré. Pensez à effectuer le virement ou le chèque.`, "ok");
      } else {
        const av = $("#rg_avs", api.el)?.value || null;
        await q(sb.from("client_credits").insert({ client_id: id, montant: m, type: v.type, facture_id: av, date_op: v.date_op, motif: v.motif || null }));
        toast("Crédit ajouté.", "ok");
      }
      api.close(); await refresh();
    },
  });
}

/* ===================== Chèques et remises en banque ===================== */
function rgChequesTab(t) {
  const ch = db.rg.cheques, tj = today(), mois = curMonth();
  const recus = ch.filter((c) => c.statut === "Reçu"), remis = ch.filter((c) => c.statut === "Remis"), imp = ch.filter((c) => c.statut === "Impayé");
  const rowC = (c) => {
    const f = c.facture_id ? byId(db.factures, c.facture_id) : null, cl = clientOf(c.client_id);
    return { t: `${c.numero || ""} ${c.banque || ""} ${c.emetteur || ""} ${cl?.nom || ""} ${f?.numero || ""}`, c: [
      c.statut === "Reçu" ? `<input type="checkbox" data-chq="${c.id}" aria-label="Sélectionner le chèque ${esc(c.numero || "")}">` : "",
      D(c.date_reception), `<strong>${esc(cl?.nom || c.emetteur || "?")}</strong><small>${f ? esc(f.numero) : "sans facture (avance)"}</small>`,
      `${esc(c.numero || "-")}<small>${esc(c.banque || "")}</small>`, `<span class="num">${E2(c.montant)}</span>`,
      `${chip(c.statut)}${c.statut === "Reçu" && daysBetween(c.date_reception, tj) >= 7 ? ' <span class="chip wn">à déposer</span>' : ""}`,
      `<span class="r">${c.statut === "Reçu" || c.statut === "Remis" ? btn("Impayé", "rgChqImp", c.id, "", "lk w") : ""}${c.statut === "Reçu" ? " " + btn("Supprimer", "rgChqDel", c.id, "", "lk w") : ""}</span>`] };
  };
  const rem = db.rg.remises.map((r) => {
    const cs = ch.filter((c) => c.remise_id === r.id), tot = r2(sum(cs, (c) => c.montant));
    const tx = r.statut === "Déposée" && db.v6 ? rgRemiseTx(r, tot) : null;
    return { t: `${r.numero}`, c: [`<strong>${esc(r.numero)}</strong><small>${cs.length} chèque${cs.length > 1 ? "s" : ""}</small>`, D(r.date_remise), `<span class="num">${E2(tot)}</span>`,
      `${chip(r.statut)}${r.date_credit ? `<small>crédité le ${D(r.date_credit)}</small>` : ""}${tx ? `<small>Banque : ${D(tx.date_op)} · ${esc(tx.libelle.slice(0, 40))}</small>` : ""}`,
      `<span class="r">${btn("Bordereau", "rgRemPrint", r.id, "", "o sm")}${r.statut === "Déposée" ? " " + (tx ? btn("Rapprocher", "rgRemCredit", r.id, tx.id, "o sm w") : btn("Marquer créditée", "rgRemCredit", r.id, "", "o sm w")) : ""}${r.statut === "Déposée" ? " " + btn("Supprimer", "rgRemDel", r.id, "", "lk w") : ""}</span>`] };
  });
  return page("Paiements", "Ce qui entre, ce qui sort, et ce qu'il reste à encaisser.", btn("Enregistrer un chèque", "rgChqNew", "", "", "w") + btn("Créer une remise", "rgChqSel", "", "", "o w"),
    t + strip([
      ["Chèques à déposer", E(sum(recus, (c) => c.montant)), `${recus.length} chèque${recus.length > 1 ? "s" : ""} en votre possession`, recus.length ? "" : ""],
      ["Remis, en attente de crédit", E(sum(remis, (c) => c.montant)), `${remis.length} chèque${remis.length > 1 ? "s" : ""}`],
      ["Encaissés ce mois", E(sum(ch.filter((c) => c.statut === "Encaissé" && String(c.date_reception).slice(0, 7) === mois), (c) => c.montant)), "crédités en banque"],
      ["Impayés", E(sum(imp, (c) => c.montant)), `${imp.length} chèque${imp.length > 1 ? "s" : ""}`, imp.length ? "dn" : ""],
    ]) +
    card("Chèques", `<p class="note" style="margin:0;border-bottom:1px solid var(--line2)">Cochez les chèques reçus, puis « Créer une remise » pour préparer le bordereau de dépôt. Le chèque est compté comme paiement dès sa réception : la facture passe à « Payée ». Si la banque le rejette, « Impayé » rouvre la facture.</p>` + tbl(["", "Reçu le", "Client", "Chèque", { h: "Montant", r: 1 }, "Statut", ""], ch.map(rowC), "Aucun chèque enregistré. Utilisez « Enregistrer un chèque » à la réception d'un règlement.")) +
    card("Remises en banque", tbl(["Bordereau", "Date", { h: "Total", r: 1 }, "Statut", ""], rem, "Aucune remise. Sélectionnez des chèques reçus pour en créer une.")));
}
// Opération bancaire (crédit) correspondant à une remise : même montant, après la date de dépôt
function rgRemiseTx(r, tot) {
  return db.bankTx.find((x) => x.statut === "À rapprocher" && x.montant > 0 && Math.abs(x.montant - tot) < 0.005 && x.date_op >= addDays(r.date_remise, -1) && x.date_op <= addDays(r.date_remise, 30)) || null;
}

function rgChequeForm() {
  if (!guard()) return;
  if (!db.clients.length) return toast("Créez d'abord un client.", "dn");
  const c0 = (ouvertes()[0]?.client_id) || db.clients[0].id;
  const body = `<div class="frm">${fld({ k: "client_id", l: "Client", t: "select", o: db.clients.map((c) => ({ v: c.id, l: c.nom })), v: c0, cls: "full" })}
    ${fld({ k: "facture_id", l: "Facture réglée", t: "select", o: [{ v: "", l: "…" }], v: "", cls: "full" })}
    ${fld({ k: "numero", l: "N° du chèque", ph: "7 chiffres" })}${fld({ k: "banque", l: "Banque émettrice", r: 0, ph: "Ex. Crédit Agricole" })}
    ${fld({ k: "emetteur", l: "Émetteur (si différent du client)", r: 0, cls: "full" })}
    ${fld({ k: "montant", l: "Montant (€)", t: "number", v: "" })}${fld({ k: "date_reception", l: "Reçu le", t: "date", v: today() })}
    ${fld({ k: "date_cheque", l: "Date inscrite sur le chèque", t: "date", v: today(), r: 0 })}</div>`;
  modal("Enregistrer un chèque reçu", body, {
    onMount: (m) => {
      const cs = $("#f_client_id", m), fs = $("#f_facture_id", m);
      const fill = () => {
        const ouv = ouvertes().filter((f) => f.client_id === cs.value);
        fs.innerHTML = ouv.map((f) => `<option value="${f.id}">${esc(f.numero)} · reste ${E2(f.reste)}</option>`).join("") + `<option value="">Aucune : avance ou acompte sans facture</option>`;
        const f = ouv[0];
        $("#f_montant", m).value = f ? String(f.reste).replace(".", ",") : "";
      };
      cs.onchange = fill;
      fs.onchange = () => { const f = byId(db.factures, fs.value); if (f) $("#f_montant", m).value = String(f.reste).replace(".", ","); };
      fill();
    },
    onSubmit: async (v, api) => {
      const f = v.facture_id ? byId(db.factures, v.facture_id) : null, m = parseNum(v.montant), cl = byId(db.clients, v.client_id);
      if (m <= 0) throw new Error("Le montant doit être supérieur à zéro.");
      if (f && m > f.reste + 0.005 && !confirm(rgExcessMsg(f, m))) return;
      const ch = await q(sb.from("cheques").insert({ client_id: v.client_id, facture_id: f?.id || null, numero: v.numero.trim(), banque: v.banque || null, emetteur: v.emetteur || cl?.nom || null, montant: m, date_cheque: v.date_cheque || null, date_reception: v.date_reception, statut: "Reçu" }).select("*").single());
      try {
        if (f) {
          const r = await rgPay(f, m, v.date_reception, "Chèque", `Chèque n° ${v.numero.trim()}`, { cheque_id: ch.id });
          if (r.pay) await q(sb.from("cheques").update({ paiement_id: r.pay.id }).eq("id", ch.id));
        } else await q(sb.from("client_credits").insert({ client_id: v.client_id, montant: m, type: "Avance", cheque_id: ch.id, date_op: v.date_reception, mode: "Chèque", reference: `Chèque n° ${v.numero.trim()}`, motif: "Avance sans facture" }));
      } catch (e) { try { await q(sb.from("cheques").delete().eq("id", ch.id)); } catch (e2) {} throw e; }
      api.close(); toast(f ? `Chèque enregistré : ${esc(f.numero)} mis à jour.` : "Chèque enregistré, en crédit client.", "ok"); await refresh();
    },
  });
}
// Retire du dossier les écritures (paiement, crédit) nées d'un chèque ; refuse si le crédit a déjà servi
async function rgUnwindCheque(c) {
  const cr = db.rg.credits.filter((x) => x.cheque_id === c.id && (x.type === "Trop-perçu" || x.type === "Avance"));
  if (cr.length) {
    const cid = cr[0].client_id;
    if (rgCredit(cid) - sum(cr, (x) => x.montant) < -0.005) throw new Error("Le crédit issu de ce chèque a déjà été utilisé ou remboursé. Annulez d'abord cette utilisation dans « Crédits clients ».");
    for (const x of cr) await q(sb.from("client_credits").delete().eq("id", x.id));
  }
  if (c.paiement_id) await q(sb.from("paiements").delete().eq("id", c.paiement_id));
}
function rgRemiseForm(ids) {
  if (!guard()) return;
  const cs = db.rg.cheques.filter((c) => ids.includes(c.id) && c.statut === "Reçu");
  if (!cs.length) return toast("Cochez au moins un chèque à déposer dans la liste.", "dn");
  const n = Math.max(0, ...db.rg.remises.map((r) => parseInt(String(r.numero).replace(/\D/g, "")) || 0)) + 1;
  const body = `<p class="mut" style="margin:0 0 12px">${cs.length} chèque${cs.length > 1 ? "s" : ""} pour un total de <b>${E2(sum(cs, (c) => c.montant))}</b>.</p><div class="frm">
    ${fld({ k: "numero", l: "N° de bordereau", v: "R-" + String(n).padStart(3, "0") })}${fld({ k: "date_remise", l: "Date de dépôt", t: "date", v: today() })}
    ${db.comptes.length ? fld({ k: "compte_id", l: "Compte crédité", t: "select", o: [{ v: "", l: "Non précisé" }, ...db.comptes.map((a) => ({ v: a.id, l: a.nom }))], v: db.comptes[0].id, cls: "full" }) : ""}</div>`;
  modal("Créer une remise de chèques", body, {
    submit: "Créer la remise",
    onSubmit: async (v, api) => {
      const r = await q(sb.from("remises_cheques").insert({ numero: v.numero.trim(), date_remise: v.date_remise, compte_id: v.compte_id || null, statut: "Déposée" }).select("*").single());
      try { await q(sb.from("cheques").update({ remise_id: r.id, statut: "Remis" }).in("id", cs.map((c) => c.id))); }
      catch (e) { try { await q(sb.from("remises_cheques").delete().eq("id", r.id)); } catch (e2) {} throw e; }
      api.close(); await refresh(); toast("Remise créée.", "ok");
      if (confirm("Remise enregistrée. Imprimer le bordereau de dépôt maintenant ?")) rgPrintRemise(r.id);
    },
  });
}
function rgPrintRemise(id) {
  const r = byId(db.rg.remises, id), cs = db.rg.cheques.filter((c) => c.remise_id === id), e = db.ent, rib = rgRibDefaut(), cpt = r.compte_id ? byId(db.comptes, r.compte_id) : null;
  const w = window.open("", "_blank");
  if (!w) return toast("Votre navigateur a bloqué la fenêtre d'impression : autorisez les fenêtres pour ce site.", "dn");
  w.document.write(`<!doctype html><meta charset="utf-8"><title>Bordereau ${esc(r.numero)}</title><style>body{font:14px system-ui,sans-serif;margin:32px;color:#111}h1{font-size:20px;margin:0 0 4px}table{border-collapse:collapse;width:100%;margin-top:18px}th,td{border:1px solid #999;padding:7px 9px;text-align:left}th{background:#eee}td.n,th.n{text-align:right}.s{color:#555}</style>
    <h1>Bordereau de remise de chèques n° ${esc(r.numero)}</h1><p class="s">${esc(e.nom || "")} · remise du ${D(r.date_remise)}${cpt ? " · compte " + esc(cpt.nom) : ""}${rib ? "<br>" + esc(rgRibLine(rib)) : ""}</p>
    <table><thead><tr><th>#</th><th>N° du chèque</th><th>Banque émettrice</th><th>Émetteur</th><th class="n">Montant</th></tr></thead><tbody>${cs.map((c, i) => `<tr><td>${i + 1}</td><td>${esc(c.numero || "")}</td><td>${esc(c.banque || "")}</td><td>${esc(c.emetteur || clientOf(c.client_id)?.nom || "")}</td><td class="n">${E2(c.montant)}</td></tr>`).join("")}
    <tr><th colspan="4" class="n">Total (${cs.length} chèque${cs.length > 1 ? "s" : ""})</th><th class="n">${E2(sum(cs, (c) => c.montant))}</th></tr></tbody></table><p class="s" style="margin-top:40px">Date et signature :</p><script>setTimeout(function(){print()},300)<\/script>`);
  w.document.close();
}

/* ===================== RIB (Paramètres et fiche client) ===================== */
function rgRibCard() {
  if (!db.v9) return card("RIB et paiement en ligne", setupV9("la gestion des RIB et le paiement en ligne"));
  const rs = db.rg.ribs, virt = !rs.length && db.ent.iban;
  const rows = rs.map((r) => `<div class="row"><div><b>${esc(r.libelle)}</b> ${r.par_defaut ? '<span class="chip ok">Par défaut</span>' : ""}${r.actif === false ? ' <span class="chip n">Désactivé</span>' : ""}<small>${esc(rgIbanFmt(r.iban))}${r.bic ? " · " + esc(r.bic) : ""}${r.banque ? " · " + esc(r.banque) : ""}${r.titulaire ? " · " + esc(r.titulaire) : ""}</small></div>
    <span class="r">${r.par_defaut ? "" : btn("Par défaut", "rgRibDef", r.id, "", "o sm w")} ${btn("Modifier", "rgRibEdit", r.id, "", "o sm w")} ${btn("Supprimer", "rgRibDel", r.id, "", "lk w")}</span></div>`).join("");
  const virtRow = virt ? `<div class="row"><div><b>IBAN saisi dans la fiche entreprise</b><small>${esc(rgIbanFmt(db.ent.iban))}</small></div>${btn("Le gérer ici", "rgRibImport", "", "", "o sm w")}</div>` : "";
  const m = db.ent.paiement_en_ligne || "";
  const pay = `<div class="row"><div><b>Paiement en ligne</b><small>${m === "stripe" ? "Stripe Checkout : le paiement est enregistré automatiquement" : m === "lien" ? "Lien de paiement externe : " + esc(db.ent.paiement_lien_modele || "") : "Désactivé : vos clients paient par virement (RIB, QR code) ou par chèque"}</small></div><span class="r">${btn("Configurer", "rgPayCfg", "", "", "o sm w")}</span></div>`;
  return card("RIB et paiement en ligne", `<p class="note" style="margin:0;border-bottom:1px solid var(--line2)">Les RIB actifs sont montrés à vos clients sur la page de leur facture. Le RIB « par défaut » figure sur les factures PDF avec un QR code de virement.</p>${rows || virtRow || '<p class="mut" style="margin:0;padding:16px 18px">Aucun RIB enregistré.</p>'}${pay}`, btn("Ajouter un RIB", "rgRibNew", "", "", "o sm w"));
}
function rgRibForm(r) {
  if (!guard()) return;
  const body = `<div class="frm">${fld({ k: "libelle", l: "Nom du compte", v: r?.libelle || (db.rg.ribs.length ? "" : "Compte principal"), ph: "Ex. Compte professionnel" })}${fld({ k: "banque", l: "Banque", v: r?.banque, r: 0 })}
    ${fld({ k: "titulaire", l: "Titulaire", v: r?.titulaire || db.ent.nom, cls: "full", r: 0 })}${fld({ k: "iban", l: "IBAN", v: r ? rgIbanFmt(r.iban) : "", cls: "full" })}${fld({ k: "bic", l: "BIC", v: r?.bic, r: 0 })}
    ${fld({ k: "actif", l: "Montré aux clients", t: "select", o: [{ v: "1", l: "Oui" }, { v: "0", l: "Non (désactivé)" }], v: r?.actif === false ? "0" : "1" })}
    ${fld({ k: "par_defaut", l: "RIB par défaut (sur les factures PDF)", t: "select", o: [{ v: "0", l: "Non" }, { v: "1", l: "Oui" }], v: r?.par_defaut || (!db.rg.ribs.length && !r) ? "1" : "0", cls: "full" })}</div>`;
  modal(r ? "Modifier le RIB" : "Ajouter un RIB", body, {
    onSubmit: async (v, api) => {
      const iban = rgIbanClean(v.iban);
      if (!rgIbanOk(iban)) throw new Error("Cet IBAN semble incorrect (clé de contrôle invalide). Vérifiez-le caractère par caractère.");
      const def = v.par_defaut === "1" && v.actif === "1";
      const row = { libelle: v.libelle.trim(), banque: v.banque || null, titulaire: v.titulaire || null, iban, bic: (v.bic || "").replace(/\s/g, "").toUpperCase() || null, actif: v.actif === "1" };
      if (def) await q(sb.from("ribs").update({ par_defaut: false }).eq("par_defaut", true));
      let saved;
      if (r) saved = await q(sb.from("ribs").update({ ...row, par_defaut: def ? true : (r.par_defaut && !def ? false : r.par_defaut) }).eq("id", r.id).select("*").single());
      else saved = await q(sb.from("ribs").insert({ ...row, par_defaut: def }).select("*").single());
      await rgSyncDefault();
      api.close(); toast("RIB enregistré.", "ok"); await refresh();
    },
  });
}
// Recopie le RIB par défaut dans la fiche entreprise : les PDF et la page client historique continuent de fonctionner
async function rgSyncDefault() {
  const l = await q(sb.from("ribs").select("*").eq("actif", true).order("created_at"));
  const d = l.find((x) => x.par_defaut) || l[0];
  await entPatch({ iban: d ? rgIbanFmt(d.iban) : null, bic: d?.bic || null });
}
function rgCribCard(cid) {
  if (!db.v9) return "";
  const rs = db.rg.cribs.filter((r) => r.client_id === cid), cr = rgCredit(cid), ch = db.rg.cheques.filter((c) => c.client_id === cid);
  const h = `<div class="row"><div><b>Crédit client : ${E2(cr)}</b><small>${cr > 0.005 ? "Trop-perçu ou avoir à imputer ou à rembourser" : "Aucun crédit"}</small></div><span class="r">${cr > 0.005 ? btn("Utiliser", "rgCrUse", cid, "", "o sm w") + " " + btn("Rembourser", "rgCrRef", cid, "", "o sm w") : btn("Ajouter", "rgCrAdd", cid, "", "o sm w")}</span></div>` +
    (ch.length ? `<div class="row"><div><b>Chèques</b><small>${ch.length} reçu${ch.length > 1 ? "s" : ""} · ${E2(sum(ch, (c) => c.montant))}</small></div></div>` : "") +
    rs.map((r) => `<div class="row"><div><b>RIB du client</b><small>${esc(rgIbanFmt(r.iban))}${r.bic ? " · " + esc(r.bic) : ""}${r.titulaire ? " · " + esc(r.titulaire) : ""}${r.mandat_ref ? `<br>Mandat SEPA ${esc(r.mandat_ref)}${r.mandat_date ? " du " + D(r.mandat_date) : ""}` : ""}</small></div>${btn("Supprimer", "rgCribDel", r.id, "", "lk w")}</div>`).join("");
  return card("Règlements", h, btn("Ajouter un RIB", "rgCribNew", cid, "", "o sm w"));
}
function rgCribForm(cid) {
  if (!guard()) return;
  const body = `<div class="frm">${fld({ k: "titulaire", l: "Titulaire du compte", v: clientOf(cid)?.nom, cls: "full" })}${fld({ k: "iban", l: "IBAN", cls: "full" })}${fld({ k: "bic", l: "BIC", r: 0 })}
    ${fld({ k: "mandat_ref", l: "Référence de mandat SEPA (facultatif)", r: 0 })}${fld({ k: "mandat_date", l: "Date de signature du mandat", t: "date", r: 0, v: "" })}</div><p class="mut" style="margin:10px 0 0;font-size:13px">Ce RIB sert à rembourser un trop-perçu et à garder la trace d'un mandat de prélèvement. Pilot n'émet pas de prélèvements SEPA : l'ordre de prélèvement se fait auprès de votre banque.</p>`;
  modal("RIB du client", body, {
    onSubmit: async (v, api) => {
      if (!rgIbanOk(v.iban)) throw new Error("Cet IBAN semble incorrect (clé de contrôle invalide).");
      await q(sb.from("client_ribs").insert({ client_id: cid, titulaire: v.titulaire.trim(), iban: rgIbanClean(v.iban), bic: (v.bic || "").replace(/\s/g, "").toUpperCase() || null, mandat_ref: v.mandat_ref || null, mandat_date: v.mandat_date || null }));
      api.close(); toast("RIB enregistré.", "ok"); await refresh();
    },
  });
}
function rgPayForm() {
  if (!guard()) return;
  const e = db.ent;
  const body = `<div class="frm">${fld({ k: "mode", l: "Comment vos clients peuvent payer en ligne", t: "select", cls: "full", v: e.paiement_en_ligne || "", o: [
      { v: "", l: "Pas de paiement en ligne (virement avec RIB et QR code, chèque)" },
      { v: "lien", l: "Un lien de paiement externe (Stripe Payment Link, PayPal.me, SumUp, Mollie…)" },
      { v: "stripe", l: "Stripe Checkout, automatique (nécessite les fonctions serveur fournies)" }] })}
    <div class="full" id="rg_lien">${fld({ k: "modele", l: "Adresse du lien de paiement", v: e.paiement_lien_modele, r: 0, ph: "https://paypal.me/monentreprise/{montant}", hint: "Vous pouvez utiliser {montant} (ex. 1250.00), {facture} (n° de facture) et {reference}. Le paiement n'est pas enregistré automatiquement : vous le rapprochez ensuite avec votre relevé bancaire." })}</div>
    <div class="full" id="rg_stripe"><p class="note" style="margin:0">Avec Stripe Checkout, le client paie par carte sur une page sécurisée Stripe. Dès que Stripe confirme, Pilot enregistre le paiement et solde la facture tout seul. Il faut un compte Stripe et déployer deux petites fonctions Supabase : le pas-à-pas est dans <b>PAIEMENT_EN_LIGNE.md</b>. Tant qu'elles ne sont pas déployées, laissez cette option désactivée.</p></div></div>`;
  modal("Paiement en ligne", body, {
    onMount: (m) => { const s = $("#f_mode", m), sync = () => { $("#rg_lien", m).hidden = s.value !== "lien"; $("#rg_stripe", m).hidden = s.value !== "stripe"; }; s.onchange = sync; sync(); },
    onSubmit: async (v, api) => {
      if (v.mode === "lien" && !/^https:\/\/[^\s]+$/i.test(v.modele || "")) throw new Error("Saisissez une adresse commençant par https://");
      await entPatch({ paiement_en_ligne: v.mode || null, paiement_lien_modele: v.mode === "lien" ? v.modele : null });
      api.close(); toast("Paiement en ligne mis à jour.", "ok"); await refresh();
    },
  });
}

/* ===================== Priorités de l'accueil ===================== */
function rgPriorites(add, t) {
  if (!db.v9) return;
  const recus = db.rg.cheques.filter((c) => c.statut === "Reçu"), vieux = recus.filter((c) => daysBetween(c.date_reception, t) >= 7);
  if (recus.length) add(vieux.length ? "i" : "s", vieux.length ? 170 : 90, `${recus.length} chèque${recus.length > 1 ? "s" : ""} à déposer en banque`, vieux.length ? `${vieux.length} reçu${vieux.length > 1 ? "s" : ""} depuis plus de 7 jours` : "Reçus, pas encore remis en banque", sum(recus, (c) => c.montant), { label: "Voir les chèques", act: "rgGoTab", id: "cheques" }, null);
  for (const c of db.rg.cheques.filter((x) => x.statut === "Impayé" && daysBetween(x.date_reception, t) <= 90))
    add("u", 350, `Chèque impayé · ${clientOf(c.client_id)?.nom || c.emetteur || ""}`, `Chèque n° ${c.numero || "?"} rejeté : la facture a été rouverte`, c.montant, { label: "Voir les chèques", act: "rgGoTab", id: "cheques" }, null);
  for (const f of ouvertes()) {
    const p = rgPromesse(f.id), an = rgAnnonce(f.id);
    if (p && p.date_promesse < t && daysBetween(p.date_promesse, t) <= 60) add("u", 310, `${f.numero} · ${f.client_nom}`, `Promesse de paiement non tenue (prévue le ${D(p.date_promesse)})`, f.reste, { label: "Relancer", act: "factureRelance", id: f.id }, `factures/${f.id}`);
    if (an && daysBetween(an.date_op, t) <= 10) add("i", 260, `${f.numero} · ${f.client_nom}`, `Le client a indiqué avoir fait le virement le ${D(an.date_op)} : vérifiez votre compte`, f.reste, { label: "Enregistrer le paiement", act: "payNew", id: f.id }, `factures/${f.id}`);
  }
  for (const [id, m] of rgCreditTotal())
    add("s", 60, `Crédit client · ${clientOf(id)?.nom || ""}`, "Trop-perçu ou avoir à imputer sur une facture ou à rembourser", m, { label: "Voir les crédits", act: "rgGoTab", id: "credits" }, null);
}

/* ===================== Actions ===================== */
const rgActions = {
  rgGoTab: (id) => { ST.tab.paiements = id; go("paiements"); },
  rgNote: (id) => rgNote(id),
  rgRibNew: () => rgRibForm(null),
  rgRibEdit: (id) => rgRibForm(byId(db.rg.ribs, id)),
  rgRibDef: async (id) => { if (!guard()) return; await q(sb.from("ribs").update({ par_defaut: false }).eq("par_defaut", true)); await q(sb.from("ribs").update({ par_defaut: true, actif: true }).eq("id", id)); await rgSyncDefault(); toast("RIB par défaut modifié.", "ok"); await refresh(); },
  rgRibDel: async (id) => {
    if (!guard() || !confirm("Supprimer ce RIB ? Il ne sera plus montré à vos clients.")) return;
    await q(sb.from("ribs").delete().eq("id", id));
    const rest = await q(sb.from("ribs").select("id,par_defaut").eq("actif", true).order("created_at"));
    if (rest.length && !rest.some((r) => r.par_defaut)) await q(sb.from("ribs").update({ par_defaut: true }).eq("id", rest[0].id));
    await rgSyncDefault(); toast("RIB supprimé.", "ok"); await refresh();
  },
  rgRibImport: async () => {
    if (!guard()) return;
    const iban = rgIbanClean(db.ent.iban);
    await q(sb.from("ribs").insert({ libelle: "Compte principal", titulaire: db.ent.nom || null, iban, bic: db.ent.bic || null, par_defaut: true, actif: true }));
    toast(rgIbanOk(iban) ? "RIB repris dans la liste." : "RIB repris, mais sa clé de contrôle semble incorrecte : vérifiez-le.", rgIbanOk(iban) ? "ok" : "dn"); await refresh();
  },
  rgCribNew: (id) => rgCribForm(id),
  rgCribDel: async (id) => { if (!guard() || !confirm("Supprimer ce RIB client ?")) return; await q(sb.from("client_ribs").delete().eq("id", id)); await refresh(); },
  rgPayCfg: () => rgPayForm(),
  rgCrAdd: (id) => rgCreditForm("add", id || ""),
  rgCrUse: (id, arg) => rgCreditForm("use", id, arg),
  rgCrRef: (id) => rgCreditForm("ref", id),
  rgCrDel: async (id) => {
    if (!guard()) return;
    const x = byId(db.rg.credits, id);
    if (!confirm(`Annuler ce mouvement (${x.type} de ${E2(Math.abs(x.montant))}) ?${x.type === "Utilisation" ? "\n\nLe paiement correspondant sur la facture sera supprimé et la facture redeviendra impayée." : ""}`)) return;
    if (x.montant > 0 && rgCredit(x.client_id) - x.montant < -0.005) return toast("Ce crédit a déjà été utilisé ou remboursé : annulez d'abord l'utilisation.", "dn");
    if (x.type === "Utilisation" && x.paiement_id) await q(sb.from("paiements").delete().eq("id", x.paiement_id));
    await q(sb.from("client_credits").delete().eq("id", id));
    if (x.type === "Trop-perçu" && x.paiement_id) toast("Mouvement annulé. Le paiement de la facture reste enregistré pour son montant exact.", "ok"); else toast("Mouvement annulé.", "ok");
    await refresh();
  },
  rgChqNew: () => rgChequeForm(),
  rgChqSel: () => rgRemiseForm($$("[data-chq]:checked").map((x) => x.dataset.chq)),
  rgChqImp: async (id) => {
    if (!guard()) return;
    const c = byId(db.rg.cheques, id), f = c.facture_id ? byId(db.factures, c.facture_id) : null;
    if (!confirm(`Marquer le chèque n° ${c.numero || "?"} (${E2(c.montant)}) comme impayé ?\n\nLe paiement correspondant est supprimé${f ? ` et la facture ${f.numero} redevient à payer` : ""}.`)) return;
    await rgUnwindCheque(c);
    await q(sb.from("cheques").update({ statut: "Impayé", paiement_id: null }).eq("id", id));
    if (c.facture_id) await q(sb.from("reglement_suivi").insert({ facture_id: c.facture_id, type: "Litige", date_op: today(), note: `Chèque n° ${c.numero || "?"} impayé (${E2(c.montant)})` }));
    toast("Chèque marqué impayé.", "ok"); await refresh();
  },
  rgChqDel: async (id) => {
    if (!guard()) return;
    const c = byId(db.rg.cheques, id);
    if (!confirm(`Supprimer le chèque n° ${c.numero || "?"} ? Le paiement qui en découle est supprimé aussi.`)) return;
    await rgUnwindCheque(c);
    await q(sb.from("cheques").delete().eq("id", id));
    toast("Chèque supprimé.", "ok"); await refresh();
  },
  rgRemPrint: (id) => rgPrintRemise(id),
  rgRemCredit: async (id, tx) => {
    if (!guard()) return;
    const r = byId(db.rg.remises, id), cs = db.rg.cheques.filter((c) => c.remise_id === id), t = tx ? byId(db.bankTx, tx) : null;
    if (!t && !confirm(`Marquer la remise ${r.numero} comme créditée en banque (${E2(sum(cs, (c) => c.montant))}) ?`)) return;
    if (t) await q(sb.from("banque_transactions").update({ statut: "Rapprochée", lien_type: "paiement_lie", paiement_id: cs.find((c) => c.paiement_id)?.paiement_id || null }).eq("id", t.id).eq("statut", "À rapprocher"));
    await q(sb.from("remises_cheques").update({ statut: "Créditée", date_credit: t?.date_op || today() }).eq("id", id));
    await q(sb.from("cheques").update({ statut: "Encaissé" }).eq("remise_id", id).neq("statut", "Impayé"));
    toast(t ? "Remise rapprochée avec l'opération bancaire." : "Remise marquée créditée.", "ok"); await refresh();
  },
  rgRemDel: async (id) => {
    if (!guard() || !confirm("Supprimer cette remise ? Les chèques redeviennent « Reçu ».")) return;
    await q(sb.from("cheques").update({ remise_id: null, statut: "Reçu" }).eq("remise_id", id).eq("statut", "Remis"));
    await q(sb.from("remises_cheques").delete().eq("id", id));
    toast("Remise supprimée.", "ok"); await refresh();
  },
};

/* ===================== Suppression d'un paiement lié à un crédit ou à un chèque ===================== */
// Retire les mouvements de crédit nés d'un paiement ; refuse si le crédit a déjà servi
async function rgUnwindPay(payId, types) {
  const cr = db.rg.credits.filter((x) => x.paiement_id === payId && types.includes(x.type));
  if (!cr.length) return;
  const pos = sum(cr.filter((x) => x.montant > 0), (x) => x.montant);
  if (pos > 0 && rgCredit(cr[0].client_id) - pos < -0.005) throw new Error("Ce paiement a généré un crédit client déjà utilisé ou remboursé. Annulez d'abord cette utilisation dans « Crédits clients ».");
  for (const x of cr) await q(sb.from("client_credits").delete().eq("id", x.id));
}
// Renvoie "default" si le paiement n'a aucun lien particulier (la suppression normale s'applique)
async function rgPayDel(id) {
  if (!guard()) return "done";
  const cq = db.rg.cheques.find((c) => c.paiement_id === id), cr = db.rg.credits.filter((x) => x.paiement_id === id);
  if (!cq && !cr.length) return "default";
  const lignes = [cq ? `Ce paiement correspond au chèque n° ${cq.numero || "?"} : le chèque sera aussi supprimé.` : "", cr.some((x) => x.type === "Utilisation") ? "Le crédit client utilisé sera rendu au client." : "", cr.some((x) => x.type === "Trop-perçu") ? "Le trop-perçu enregistré avec ce paiement sera retiré." : ""].filter(Boolean);
  if (!confirm(`Supprimer ce paiement ?\n\n${lignes.join("\n")}`)) return "done";
  try {
    await rgUnwindPay(id, ["Trop-perçu", "Utilisation"]);
    if (cq) {
      await rgUnwindCheque({ ...cq, paiement_id: null });
      await q(sb.from("paiements").delete().eq("id", id));
      await q(sb.from("cheques").delete().eq("id", cq.id));
    } else await q(sb.from("paiements").delete().eq("id", id));
    toast("Paiement supprimé.", "ok"); await refresh();
  } catch (e) { toast(friendly(e), "dn"); }
  return "done";
}
