/* Mails types + connexion Gmail (envoi et lecture) + messagerie.
   Sans Gmail connecté, tout fonctionne quand même : le message s'ouvre dans la messagerie de l'ordinateur (mailto).
   Avec Gmail : envoi direct depuis Pilot avec le PDF en pièce jointe, historique par client, import des factures fournisseur reçues. */

/* ---------- Mails types ---------- */
const ML_VARS = [
  ["client", "Nom du client"], ["bonjour", "Formule d'appel"], ["numero", "N° du document"], ["montant", "Montant TTC"], ["reste", "Reste à payer"],
  ["date_doc", "Date du document"], ["echeance", "Échéance"], ["retard", "Jours de retard"], ["lien", "Lien client"], ["bloc_paiement", "Lien de paiement et RIB"],
  ["chantier", "Chantier"], ["entreprise", "Votre entreprise"], ["telephone", "Votre téléphone"], ["signature", "Signature (Cordialement…)"],
  ["precedent_rappel", "Rappel précédent"], ["penalites", "Pénalités (clients pro)"],
];
const ML_DEF = [
  { code: "devis_envoi", nom: "Envoi d'un devis", sujet: "Devis {numero} - {entreprise}",
    corps: "{bonjour}\n\nVeuillez trouver votre devis {numero} d'un montant de {montant} TTC.\nVous pouvez le consulter, l'accepter ou le refuser en ligne : {lien}\n\n{signature}" },
  { code: "devis_relance", nom: "Relance d'un devis", sujet: "Relance : devis {numero}",
    corps: "{bonjour}\n\nJe me permets de revenir vers vous au sujet du devis {numero} ({montant} TTC) envoyé le {date_doc}.\nAvez-vous eu le temps de le consulter ?\nVous pouvez l'accepter en ligne : {lien}\n\n{signature}" },
  { code: "facture_envoi", nom: "Envoi d'une facture", sujet: "Facture {numero} - {entreprise}",
    corps: "{bonjour}\n\nVeuillez trouver votre facture {numero} d'un montant de {montant} TTC, à régler avant le {echeance}.\nVous pouvez la consulter et la télécharger ici : {lien}\n\n{signature}" },
  { code: "relance_1", nom: "Relance de paiement 1 : rappel amiable", sujet: "Rappel : facture {numero}",
    corps: "{bonjour}\n\nSauf erreur de notre part, la facture n° {numero} du {date_doc} (échéance le {echeance}), d'un montant restant dû de {reste} TTC, n'a pas encore été réglée.\n\nMerci de procéder au règlement dans les meilleurs délais. Si votre paiement est déjà parti, ne tenez pas compte de ce message.\n\n{bloc_paiement}\n\n{signature}" },
  { code: "relance_2", nom: "Relance de paiement 2 : relance ferme", sujet: "Relance : facture {numero} impayée",
    corps: "{bonjour}\n\nMalgré {precedent_rappel}, la facture n° {numero} du {date_doc} (échéance le {echeance}) reste impayée à ce jour ({retard} jours de retard) pour un montant de {reste} TTC.\n\nNous vous demandons de la régler sous 8 jours.{penalites}\n\n{bloc_paiement}\n\nSi un problème empêche ce règlement, merci de nous contacter pour que nous trouvions une solution.\n\n{signature}" },
  { code: "relance_3", nom: "Relance de paiement 3 : mise en demeure", sujet: "Mise en demeure de payer : facture {numero}",
    corps: "{bonjour}\n\nMalgré nos relances, la facture n° {numero} du {date_doc} reste impayée : {reste} TTC.\n\nPar la présente, nous vous mettons en demeure de nous régler cette somme sous 8 jours à compter de la réception de ce courrier. À défaut, nous nous réservons le droit d'engager toute procédure de recouvrement, les frais en résultant restant à votre charge.{penalites}\n\n{bloc_paiement}\n\n{signature}" },
  { code: "paiement_recu", nom: "Remerciement après paiement", sujet: "Paiement reçu : facture {numero}",
    corps: "{bonjour}\n\nNous avons bien reçu votre règlement pour la facture {numero}. Nous vous en remercions.\n\n{signature}" },
  { code: "pv_envoi", nom: "Envoi d'un PV de réception", sujet: "Procès-verbal de réception {numero} - {chantier}",
    corps: "{bonjour}\n\nSuite à la réception des travaux du chantier « {chantier} », vous trouverez le procès-verbal {numero}.\nMerci de le consulter et de le signer en ligne : {lien}\n\n{signature}" },
  { code: "libre", nom: "Message libre", sujet: "", corps: "{bonjour}\n\n\n\n{signature}" },
];
const mlTpl = (code) => {
  const d = ML_DEF.find((x) => x.code === code) || ML_DEF[ML_DEF.length - 1];
  const m = (db.ml?.modeles || []).find((x) => x.code === code && x.actif !== false);
  return m ? { ...d, sujet: m.sujet, corps: m.corps, perso: true } : d;
};
const mlFill = (s, v) => String(s || "").replace(/\{(\w+)\}/g, (_, k) => (v[k] ?? "")).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
function mlVars(o = {}) {
  const e = db.ent, d = o.d || o.f || {}, c = o.c || clientOf(d.client_id) || {}, pro = c.type === "Professionnel";
  const ch = d.chantier_id ? byId(db.chantiers, d.chantier_id) : o.ch;
  const reste = d.reste != null ? E2(d.reste) : "";
  return {
    client: c.nom || d.client_nom || "", bonjour: pro ? "Madame, Monsieur," : "Bonjour,", numero: d.numero || o.numero || "", montant: d.montant_ttc != null ? E2(d.montant_ttc) : "",
    reste, date_doc: D(d.date_emission || d.date_devis || d.date_reception), echeance: D(d.echeance), retard: d.echeance ? Math.max(0, daysBetween(d.echeance, today())) : "",
    lien: o.lien || "", bloc_paiement: o.bloc || "", chantier: ch?.nom || "", entreprise: e.nom || "", telephone: e.telephone || "",
    signature: `Cordialement,\n${e.nom || ""}${e.telephone ? "\n" + e.telephone : ""}`, precedent_rappel: o.precedent || "notre rappel",
    penalites: o.penalites || "",
  };
}
const mlRender = (code, o) => { const t = mlTpl(code), v = mlVars(o); return { sujet: mlFill(t.sujet, v), corps: mlFill(t.corps, v) }; };

// Relances de paiement (utilisé par views-reglements.js : rlText)
function mlRelance(f, n, o = {}) {
  const c = clientOf(f.client_id) || {}, p = partageOf(f.id), link = o.lien && p ? shareLink(p.token) : "", rib = o.rib && typeof rgRibLine === "function" ? rgRibLine() : "";
  const last = typeof rgLastRelance === "function" ? rgLastRelance(f.id) : null;
  const bloc = [link ? `Vous pouvez la régler directement depuis cette page : ${link}` : "", rib ? `Coordonnées bancaires : ${rib} (référence à indiquer : ${f.numero}).` : ""].filter(Boolean).join("\n");
  const pen = c.type === "Professionnel" ? " Des pénalités de retard (trois fois le taux d'intérêt légal) ainsi que l'indemnité forfaitaire de recouvrement de 40 € (art. L441-10 du Code de commerce) sont exigibles." : "";
  return mlRender(`relance_${n}`, { f, c, lien: link, bloc, penalites: pen, precedent: last ? `notre précédent rappel du ${D(last.date_op)}` : "notre rappel" });
}

/* ---------- Gmail ---------- */
const gmOn = () => !!(db.v10 && db.ml.gmail && db.ml.gmail.statut === "Active");
async function gmCall(body) {
  const { data, error } = await sb.functions.invoke("gmail", { body });
  if (error) {
    let msg = "";
    try { msg = (await error.context.json()).error || ""; } catch (e) { /* pas de JSON */ }
    if (!msg) msg = error.context?.status === 404 || /not found|failed to send/i.test(error.message || "") ? "La fonction « gmail » n'est pas installée sur votre Supabase. Voir GMAIL.md." : error.message || "Gmail indisponible.";
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
async function gmConnect() {
  if (!guard()) return;
  const r = await gmCall({ action: "auth_url", email: email });
  try { sessionStorage.setItem("pilot-gm", r.state); } catch (e) { /* ignoré */ }
  location.href = r.url;
}
// Retour de Google : ?state=gm:xxx&code=…
async function gmHandleReturn() {
  const p = new URLSearchParams(location.search), state = p.get("state") || "";
  if (!state.startsWith("gm:")) return false;
  const code = p.get("code"), err = p.get("error");
  history.replaceState(null, "", location.pathname + "#/params");
  if (err || !code) { toast("Gmail n'a pas été connecté : " + (err || "autorisation refusée"), "dn"); return true; }
  toast("Connexion à Gmail…");
  try { const r = await gmCall({ action: "callback", code, state }); await load(); toast(`Gmail connecté : ${esc(r.email || "")}.`, "ok"); } catch (e) { toast(friendly(e), "dn"); }
  return true;
}
async function gmSync(quiet) {
  if (!gmOn() || ro) return 0;
  try {
    const emails = [...new Set([...db.clients, ...db.fournisseurs].map((x) => (x.email || "").trim().toLowerCase()).filter(Boolean))];
    const r = await gmCall({ action: "sync", emails, days: 45 });
    const have = new Set(db.ml.mails.map((m) => m.gmail_id));
    const me = (db.ml.gmail.email || "").toLowerCase();
    const rows = [];
    for (const m of r.messages) {
      if (have.has(m.gmail_id)) continue;
      const other = ((m.direction === "sortant" ? m.a : m.de) || "").toLowerCase();
      const cl = db.clients.find((c) => c.email && other.includes(c.email.trim().toLowerCase()));
      rows.push({ ...m, client_id: cl?.id || null });
    }
    if (rows.length) await q(sb.from("mails_envoyes").insert(rows));
    if (rows.length) { const n = rows.filter((x) => x.direction === "entrant").length; await refresh(); if (!quiet) toast(`${rows.length} message${rows.length > 1 ? "s" : ""} importé${rows.length > 1 ? "s" : ""}${n ? ` dont ${n} reçu${n > 1 ? "s" : ""}` : ""}.`, "ok"); }
    else if (!quiet) toast("Aucun nouveau message.", "ok");
    return rows.length;
  } catch (e) { if (!quiet) toast(friendly(e), "dn"); else console.warn(e); return 0; }
}
let gmLast = 0;
function gmAutoSync() { if (!gmOn() || ro || Date.now() - gmLast < 10 * 60 * 1000) return; gmLast = Date.now(); gmSync(true); }

const mlBytesB64 = (bytes) => { let s = ""; const a = new Uint8Array(bytes); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };

async function mlSendRaw(o) {
  const attachments = [];
  if (o.pdf) attachments.push({ filename: o.pdf.nom, mime: "application/pdf", b64: mlBytesB64(await o.pdf.bytes()) });
  const r = await gmCall({ action: "send", to: o.to, subject: o.sujet, text: o.corps, attachments, from_name: db.ent.nom || "" });
  await q(sb.from("mails_envoyes").insert({ direction: "sortant", gmail_id: r.id, thread_id: r.thread_id, de: r.from, a: o.to, sujet: o.sujet, extrait: String(o.corps).slice(0, 200), client_id: o.client_id || null, doc_type: o.doc_type || null, doc_id: o.doc_id || null, lu: true,
    pieces: attachments.map((a) => ({ nom: a.filename, mime: a.mime })) }));
  return r;
}

/* ---------- Fenêtre d'envoi ---------- */
// o = { to, sujet, corps, client_id, doc_type, doc_id, pdf: { nom, bytes: () => Promise<Uint8Array> }, titre, onSent }
function mlCompose(o) {
  if (!guard()) return;
  const gm = gmOn();
  const body = `<div class="frm">
    ${fld({ k: "to", l: "À", t: "email", v: o.to || "", cls: "full", r: gm ? undefined : 0 })}
    ${fld({ k: "sujet", l: "Objet", v: o.sujet || "", cls: "full" })}
    ${fld({ k: "corps", l: "Message", t: "textarea", v: o.corps || "", cls: "full", rows: 12 })}
    ${o.pdf ? `<label class="chk full" style="display:flex;gap:8px"><input type="checkbox" name="pj" ${gm ? "checked" : "disabled"}> <span>Joindre ${esc(o.pdf.nom)}</span></label>` : ""}
    <p class="mut full" style="margin:0">${gm ? `Envoyé depuis votre Gmail (${esc(db.ml.gmail.email || "")}) et classé dans l'historique du client.` : "Gmail n'est pas connecté : le message s'ouvrira dans votre messagerie habituelle (sans pièce jointe). Connectez Gmail dans Paramètres pour l'envoi direct."}</p></div>`;
  modal(o.titre || "Envoyer un email", body, {
    wide: true, submit: gm ? "Envoyer avec Gmail" : "Ouvrir dans ma messagerie",
    onSubmit: async (v, api) => {
      if (!gm) {
        if (!v.to) throw new Error("Indiquez l'adresse du destinataire.");
        location.href = `mailto:${encodeURIComponent(v.to)}?subject=${encodeURIComponent(v.sujet)}&body=${encodeURIComponent(v.corps)}`;
        api.close(); o.onSent && (await o.onSent({ via: "mailto" })); return;
      }
      await mlSendRaw({ to: v.to, sujet: v.sujet, corps: v.corps, client_id: o.client_id, doc_type: o.doc_type, doc_id: o.doc_id, pdf: o.pdf && v.pj ? o.pdf : null });
      api.close(); toast("Email envoyé.", "ok");
      o.onSent && (await o.onSent({ via: "gmail" }));
      await refresh();
    },
  });
}

// Envoi d'un devis / d'une facture (depuis la fenêtre « lien client »)
function mlSendDoc(K, id, token) {
  const d = byId(db[KD[K].list], id), c = clientOf(d.client_id) || {};
  const t = mlRender(K === "devis" ? "devis_envoi" : "facture_envoi", { d, c, lien: shareLink(token) });
  mlCompose({ titre: `Envoyer ${KD[K].label.toLowerCase()} ${esc(d.numero)}`, to: c.email || "", ...t, client_id: d.client_id, doc_type: K, doc_id: id,
    pdf: { nom: `${slug(d.numero)}.pdf`, bytes: () => docPdfBytes(K, id) } });
}
function mlWriteClient(cid) {
  const c = byId(db.clients, cid);
  mlCompose({ titre: `Écrire à ${esc(c.nom)}`, to: c.email || "", ...mlRender("libre", { c }), client_id: cid });
}

/* ---------- Paramètres : Gmail + mails types ---------- */
function mlCard() {
  if (!db.v10) return "";
  const g = db.ml.gmail;
  const gmBlock = g
    ? `<dl class="kv"><dt>Compte</dt><dd>${esc(g.email || "")} ${g.statut === "Active" ? `<span class="chip ok">Connecté</span>` : `<span class="chip dn">À reconnecter</span>`}</dd>
       <dt>Dernière lecture</dt><dd>${g.derniere_synchro ? esc(new Date(g.derniere_synchro).toLocaleString("fr-FR")) : "Jamais"}</dd>${g.erreur ? `<dt>Erreur</dt><dd class="dn">${esc(g.erreur)}</dd>` : ""}</dl>
       <div class="cb" style="border-top:1px solid var(--line2);display:flex;gap:8px;flex-wrap:wrap">${btn("Lire ma boîte maintenant", "gmSync", "", "", "o sm")}${btn("Reconnecter", "gmConnect", "", "", "o sm w")}${btn("Déconnecter", "gmDisconnect", "", "", "dn-o sm w")}</div>`
    : `<p class="note" style="margin:0;padding:14px 18px 6px">Connectez votre compte Google pour envoyer devis, factures et relances directement depuis Pilot (avec le PDF), retrouver les échanges de chaque client et importer les factures fournisseur reçues par mail. Mise en place : voir <b>GMAIL.md</b>.</p><div class="cb">${btn("Connecter Gmail", "gmConnect", "", "", "w")}</div>`;
  const rows = ML_DEF.map((d) => { const t = mlTpl(d.code); return { t: d.nom, c: [`<b>${esc(d.nom)}</b>`, `<small class="mut">${esc(t.sujet || "(libre)")}</small>`, t.perso ? `<span class="chip ac">Personnalisé</span>` : `<span class="chip n">Par défaut</span>`, btn("Modifier", "mlEdit", d.code, "", "o sm w")] }; });
  return card("Connexion Gmail", gmBlock) + card("Mails types", `<p class="note" style="margin:0;padding:14px 18px 6px">Modèles utilisés pour l'envoi des devis et factures, les relances de paiement et les PV. Les mots entre accolades, comme {client} ou {montant}, sont remplacés automatiquement.</p>${tbl(["Modèle", "Objet", "", ""], rows)}`);
}
function mlEdit(code) {
  if (!guard()) return;
  const d = ML_DEF.find((x) => x.code === code), t = mlTpl(code);
  const demo = { d: db.factures[0] || db.devis[0] || {}, lien: "https://…/p.html?t=…" };
  modal(`Mail type : ${esc(d.nom)}`, `<div class="frm">${fld({ k: "sujet", l: "Objet", v: t.sujet, cls: "full", r: 0 })}${fld({ k: "corps", l: "Message", t: "textarea", v: t.corps, cls: "full", rows: 13 })}
    <p class="full mut" style="margin:0"><b>Mots disponibles :</b> ${ML_VARS.map(([k, l]) => `<code title="${esc(l)}">{${k}}</code>`).join(" ")}</p>
    <div class="full"><button type="button" class="btn o sm" id="ml_prev">Aperçu avec un exemple</button> <button type="button" class="btn o sm" id="ml_def">Revenir au texte par défaut</button><pre id="ml_out" class="mut" style="white-space:pre-wrap;margin:10px 0 0;font:inherit"></pre></div></div>`, {
    wide: true,
    onMount: (m) => {
      $("#ml_prev", m).onclick = () => { const v = mlVars(demo); $("#ml_out", m).textContent = mlFill($("#f_sujet", m).value, v) + "\n\n" + mlFill($("#f_corps", m).value, v); };
      $("#ml_def", m).onclick = () => { $("#f_sujet", m).value = d.sujet; $("#f_corps", m).value = d.corps; };
    },
    onSubmit: async (v, api) => {
      await q(sb.from("mail_modeles").upsert({ user_id: uid, code, nom: d.nom, sujet: v.sujet || "", corps: v.corps || "", actif: true }, { onConflict: "user_id,code" }));
      api.close(); toast("Mail type enregistré.", "ok"); await refresh();
    },
  });
}

/* ---------- Historique par client ---------- */
const mlRow = (m) => `<tr${m.client_id ? ` data-go="clients/${m.client_id}" class="lnk"` : ""}><td>${m.direction === "entrant" ? `<span class="chip ok">Reçu</span>` : `<span class="chip n">Envoyé</span>`}</td><td><b>${esc(m.sujet || "(sans objet)")}</b><small style="display:block" class="mut">${esc(m.direction === "entrant" ? m.de : m.a)} · ${esc((m.extrait || "").slice(0, 90))}</small></td><td>${(m.pieces || []).length ? `<span class="chip n">${m.pieces.length} pièce${m.pieces.length > 1 ? "s" : ""}</span>` : ""}</td><td>${D(m.date_mail)}</td></tr>`;
function mlClientCard(cid) {
  if (!db.v10) return "";
  const l = db.ml.mails.filter((m) => m.client_id === cid).slice(0, 8);
  return card("Échanges par email", l.length ? `<div class="tw"><table><tbody>${l.map(mlRow).join("")}</tbody></table></div>` : `<p class="mut" style="margin:0;padding:16px 18px">Aucun email enregistré${gmOn() ? "." : ". Connectez Gmail pour les retrouver ici."}</p>`, btn("Écrire", "mlWriteClient", cid, "", "o sm w"));
}

/* ---------- Page Messagerie ---------- */
V.mails = () => {
  if (!db.v10) return page("Messagerie", "", "", card("Migration requise", `<p class="note" style="margin:0">Exécutez migration_v10.sql dans Supabase pour activer la messagerie.</p>`));
  const l = db.ml.mails;
  const pj = [];
  l.filter((m) => m.direction === "entrant").forEach((m) => (m.pieces || []).forEach((p, i) => { if (/pdf/i.test(p.mime || "") || /\.pdf$/i.test(p.nom || "")) pj.push({ m, p, i }); }));
  const rows = l.map((m) => `${mlRow(m)}`).join("");
  const imp = pj.length ? card("Factures reçues en pièce jointe", tbl(["Expéditeur", "Fichier", ""], pj.slice(0, 15).map(({ m, p, i }) => ({ c: [esc(m.de), esc(p.nom), btn("Importer comme dépense", "mlImport", m.id, String(i), "sm w")] })))) : "";
  return page("Messagerie", gmOn() ? `Compte Gmail : ${esc(db.ml.gmail.email || "")}` : "Gmail n'est pas connecté.", gmOn() ? btn("Lire ma boîte", "gmSync", "", "", "o") + btn("Nouveau message", "mlNew", "", "", "w") : btn("Connecter Gmail", "gmConnect", "", "", "w"),
    imp + card("", `<div class="tw"><table><tbody>${rows || `<tr><td class="emp">Aucun message. ${gmOn() ? "Cliquez sur « Lire ma boîte »." : "Connectez Gmail pour les retrouver ici."}</td></tr>`}</tbody></table></div>`));
};
async function mlImport(mid, i) {
  const m = byId(db.ml.mails, mid), p = m.pieces[Number(i)];
  toast("Récupération de la pièce jointe…");
  const r = await gmCall({ action: "attachment", gmail_id: m.gmail_id, attachment_id: p.attachment_id });
  const f = new File([b64ToBytes(r.data)], p.nom || "facture.pdf", { type: "application/pdf" });
  const ei = await efReadIncoming(f).catch(() => null);
  const api = { close() {} };
  if (ei) return efIncomingToForm(f, ei, api);
  const x = await PilotPdf.extractSupplier(f);
  const warn = x.image || x.vide || !x.coherent || x.ht === null || x.ttc === null;
  depForm(null, { file: f, badge: `<div class="full"><span class="${warn ? "badge-warn" : "badge-auto"}">${warn ? "Lecture partielle : vérifiez les montants" : "Pré-rempli depuis le mail : vérifiez avant d'enregistrer"}</span></div>`,
    prefill: { fournisseur: x.fournisseur, reference: x.reference, date_depense: x.date || today(), echeance: x.echeance, categorie: x.categorie, type: x.type, montant_ht: x.ht ?? "", montant_tva: x.tva ?? "" } });
}

const mailActions = {
  gmConnect, gmSync: () => gmSync(false), mlEdit, mlWriteClient, mlImport, mlSendDocAct: (id, arg) => { const [K, t] = arg.split(":"); return mlSendDoc(K, id, t); },
  mlNew: () => mlCompose({ titre: "Nouveau message", ...mlRender("libre", {}) }),
  gmDisconnect: async () => { if (!guard() || !confirm("Déconnecter Gmail ? Les messages déjà importés restent dans Pilot.")) return; await gmCall({ action: "disconnect" }); await refresh(); toast("Gmail déconnecté.", "ok"); },
};
