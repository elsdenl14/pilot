/* Page publique client : p.html?t=<jeton>. Aucune connexion, uniquement les fonctions partage_* de Supabase. */
const CFG = window.PILOT_CONFIG || {};
const root = document.getElementById("p");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const eur = (n) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(Number(n || 0));
const dt = (s) => (s ? new Date(s).toLocaleDateString("fr-FR") : "");
const token = new URLSearchParams(location.search).get("t") || "";
const pvToken = new URLSearchParams(location.search).get("pv") || "";

async function rpc(fn, args) {
  const r = await fetch(`${CFG.url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: CFG.anonKey, Authorization: "Bearer " + CFG.anonKey },
    body: JSON.stringify(args),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error((j && (j.message || j.hint)) || "Erreur " + r.status);
  return j;
}
const fail = (m) => (root.innerHTML = `<div class="card c"><h1>Lien indisponible</h1><p class="mut">${esc(m)}</p></div>`);

/* ---------- Règlement d'une facture : RIB, QR de virement, paiement en ligne, échéancier ---------- */
const ibanFmt = (s) => String(s || "").replace(/\s/g, "").replace(/(.{4})/g, "$1 ").trim();
const asc = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e]/g, " ");
function epc(rg) {
  const r = (rg.ribs || [])[0];
  if (!r || !(Number(rg.reste) > 0.005)) return "";
  return ["BCD", "002", "1", "SCT", asc(r.bic || "").replace(/\s/g, ""), asc(r.titulaire || rg.beneficiaire).slice(0, 70), String(r.iban).replace(/\s/g, ""), "EUR" + Number(rg.reste).toFixed(2), "", "", asc("Facture " + rg.numero).slice(0, 140)].join("\n");
}
function echeancier(rg) {
  let rest = Number(rg.paye) || 0;
  const t = new Date().toISOString().slice(0, 10);
  return (rg.echeances || []).map((x) => {
    const part = Math.min(Number(x.montant), Math.max(0, rest));
    rest = Math.round((rest - part) * 100) / 100;
    const reste = Math.round((Number(x.montant) - part) * 100) / 100;
    return { ...x, reste, etat: reste <= 0.005 ? "Payée" : part > 0 ? "Partiellement payée" : x.date < t ? "En retard" : "À venir" };
  });
}
function payBlock(rg) {
  const reste = Number(rg.reste), paid = reste <= 0.005, ech = echeancier(rg), prochaine = ech.find((x) => x.reste > 0.005);
  const hist = (rg.paiements || []).length ? `<div class="card"><h2>Paiements reçus</h2><dl>${rg.paiements.map((p) => `<dt>${dt(p.date)}</dt><dd>${eur(p.montant)} · ${esc(p.mode || "")}</dd>`).join("")}</dl></div>` : "";
  if (paid) return `<div class="card"><p style="margin:0"><span class="badge ok">Facture réglée</span> Merci pour votre règlement.</p></div>${hist}`;
  const sig = (rg.signalements || []);
  const sv = sig.find((s) => s.type === "Virement annoncé"), sp = sig.find((s) => s.type === "Promesse");
  const paidNotice = new URLSearchParams(location.search).get("paid") ? `<div class="card"><p style="margin:0"><span class="badge ok">Merci !</span> Votre paiement par carte est en cours de confirmation : cette page se met à jour dans quelques instants.</p></div>` : "";
  let online = "";
  if (rg.en_ligne === "stripe") online = `<div class="payopt"><b>Payer par carte bancaire</b><p class="mut" style="margin:2px 0 10px">Paiement sécurisé, enregistré automatiquement.</p><div class="row"><button class="btn" data-pay="${reste}">Payer ${eur(reste)}</button>${prochaine && prochaine.reste < reste - 0.005 ? `<button class="btn o" data-pay="${prochaine.reste}">Payer l'échéance : ${eur(prochaine.reste)}</button>` : ""}</div><p class="er" id="payer" role="alert"></p></div>`;
  else if (rg.en_ligne === "lien" && rg.lien_modele) {
    const u = rg.lien_modele.replace(/\{montant\}/g, reste.toFixed(2)).replace(/\{(facture|reference)\}/g, encodeURIComponent(rg.numero));
    if (/^https:\/\//i.test(u)) online = `<div class="payopt"><b>Payer en ligne</b><p class="mut" style="margin:2px 0 10px">Vous serez redirigé vers la page de paiement.</p><a class="btn" href="${esc(u)}" target="_blank" rel="noopener">Payer ${eur(reste)}</a></div>`;
  }
  const ribs = (rg.ribs || []).map((r, i) => `<div class="payopt"><b>${i ? esc(r.libelle || "Autre compte") : "Virement bancaire"}</b>${i === 0 ? `<p class="mut" style="margin:2px 0 10px">Indiquez la référence pour que votre paiement soit identifié.</p>` : ""}<div class="ribrow"><dl>
      ${r.titulaire ? `<dt>Bénéficiaire</dt><dd>${esc(r.titulaire)}</dd>` : ""}<dt>IBAN</dt><dd>${esc(ibanFmt(r.iban))} <button class="lk" data-copy="${esc(String(r.iban).replace(/\s/g, ""))}">Copier</button></dd>
      ${r.bic ? `<dt>BIC</dt><dd>${esc(r.bic)} <button class="lk" data-copy="${esc(r.bic)}">Copier</button></dd>` : ""}<dt>Montant</dt><dd>${eur(reste)}</dd><dt>Référence</dt><dd>${esc(rg.numero)} <button class="lk" data-copy="${esc(rg.numero)}">Copier</button></dd></dl>
      ${i === 0 ? `<div class="qrbox" id="qrbox" hidden><div id="qr"></div><small class="mut">Scannez avec l'appli de votre banque</small></div>` : ""}</div></div>`).join("");
  const chq = rg.beneficiaire ? `<div class="payopt"><b>Par chèque</b><p class="mut" style="margin:2px 0 0">À l'ordre de <b>${esc(rg.beneficiaire)}</b>${rg.adresse ? `, à envoyer à : ${esc(rg.adresse)}` : ""}. Indiquez ${esc(rg.numero)} au dos.</p></div>` : "";
  const ech2 = ech.length ? `<div class="card"><h2>Échéancier</h2><dl>${ech.map((x) => `<dt>${dt(x.date)}</dt><dd>${eur(x.montant)} · ${esc(x.libelle || "Échéance")} · <span class="badge ${x.etat === "Payée" ? "ok" : x.etat === "En retard" ? "dn" : ""}">${x.etat}</span></dd>`).join("")}</dl></div>` : "";
  const signal = `<div class="payopt"><b>Vous avez déjà payé, ou vous avez besoin de temps ?</b>
    ${sv ? `<p class="mut" style="margin:6px 0">Vous avez indiqué le virement effectué le ${dt(sv.date)}. Nous vérifions notre compte.</p>` : `<p style="margin:6px 0"><button class="btn o" id="sigv">J'ai effectué le virement</button></p>`}
    ${sp ? `<p class="mut" style="margin:6px 0">Vous avez indiqué que vous paierez le ${dt(sp.date_promesse)}.</p>` : `<div class="row" style="margin-top:6px"><input type="date" id="prd" style="max-width:170px" aria-label="Date de paiement prévue"><button class="btn o" id="prb">Je paierai à cette date</button></div>`}
    <p class="er" id="sigr" role="alert"></p></div>`;
  return `${paidNotice}<div class="card"><h2>Comment régler</h2><p style="margin:0 0 12px">Reste à régler : <b>${eur(reste)}</b>${rg.echeance ? ` · échéance ${dt(rg.echeance)}` : ""}</p>${online}${ribs}${chq}</div>${ech2}${hist}<div class="card">${signal}</div>`;
}
function loadQr(cb) {
  if (typeof qrcode === "function") return cb();
  const s = document.createElement("script");
  s.src = "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js";
  s.onload = cb; s.onerror = () => {};
  document.head.appendChild(s);
}
function wirePay(rg) {
  const box = document.getElementById("qrbox"), text = epc(rg);
  if (box && text) loadQr(() => {
    try {
      const m = qrcode(0, "M"); m.addData(text, "Byte"); m.make();
      const n = m.getModuleCount(); let d = "";
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (m.isDark(y, x)) d += `M${x + 4} ${y + 4}h1v1h-1z`;
      document.getElementById("qr").innerHTML = `<svg viewBox="0 0 ${n + 8} ${n + 8}" width="150" height="150" shape-rendering="crispEdges" role="img" aria-label="QR code de virement"><rect width="${n + 8}" height="${n + 8}" fill="#fff"/><path d="${d}"/></svg>`;
      box.hidden = false;
    } catch (x) {}
  });
  root.querySelectorAll("[data-copy]").forEach((b) => (b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copy); const t = b.textContent; b.textContent = "Copié"; setTimeout(() => (b.textContent = t), 1500); } catch (x) {} }));
  root.querySelectorAll("[data-pay]").forEach((b) => (b.onclick = async () => {
    const er = document.getElementById("payer"); er.textContent = ""; b.disabled = true;
    try {
      const r = await fetch(`${CFG.url}/functions/v1/pay-checkout`, { method: "POST", headers: { "Content-Type": "application/json", apikey: CFG.anonKey, Authorization: "Bearer " + CFG.anonKey }, body: JSON.stringify({ token, montant: Number(b.dataset.pay) }) });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j || !j.url) throw new Error((j && j.error) || "Le paiement en ligne n'est pas disponible pour le moment.");
      location.href = j.url;
    } catch (x) { er.textContent = x.message; b.disabled = false; }
  }));
  const sg2 = async (type, date, btn) => {
    const er = document.getElementById("sigr"); er.textContent = ""; btn.disabled = true;
    try { await rpc("partage_signaler", { p_token: token, p_type: type, p_date: date || null, p_note: null }); await show(); } catch (x) { er.textContent = x.message; btn.disabled = false; }
  };
  const sv = document.getElementById("sigv"); if (sv) sv.onclick = () => sg2("Virement annoncé", null, sv);
  const pb = document.getElementById("prb"); if (pb) pb.onclick = () => { const v = document.getElementById("prd").value; if (!v) { document.getElementById("sigr").textContent = "Choisissez une date."; return; } sg2("Promesse", v, pb); };
}

/* ---- Options et variantes (migration v13, facultatif) ---- */
let OPTS = null;
const optHt = (o) => Math.round(Number(o.quantite) * Number(o.prix_unitaire_ht) * 100) / 100;
function optsHtml(o) {
  if (!o || !o.options || !o.options.length) return "";
  const groups = {};
  o.options.forEach((x) => { const g = (x.groupe || "").trim(); (groups[g || "_" + x.id] ||= []).push(x); });
  const line = (x, type, name) => `<label class="chk opt"><input type="${type}" name="${esc(name)}" value="${esc(x.id)}"${x.choisie ? " checked" : ""}><span>${esc(x.designation)}<small class="mut"> · ${Number(x.quantite).toLocaleString("fr-FR")} ${esc(x.unite || "")}</small></span><b>+ ${eur(optHt(x))} HT</b></label>`;
  const body = Object.entries(groups).map(([g, xs]) => g.startsWith("_") ? line(xs[0], "checkbox", "o_" + xs[0].id)
    : `<fieldset class="optg"><legend>${esc(g)}</legend>${xs.map((x) => line(x, "radio", "g_" + g)).join("")}<label class="chk opt"><input type="radio" name="g_${esc(g)}" value=""${xs.some((x) => x.choisie) ? "" : " checked"}><span>Aucune</span></label></fieldset>`).join("");
  return `<div class="card" id="optcard"><h2>Options proposées</h2><p class="mut" style="margin:0 0 10px">Cochez celles que vous souhaitez : le total est recalculé. Le PDF ci-dessous présente le devis de base.</p>${body}
    <div class="opttot"><span>Total avec vos choix</span><b id="opttot"></b></div></div>`;
}
const optsChosen = () => [...document.querySelectorAll("#optcard input:checked")].map((i) => i.value).filter(Boolean);
function optsTotal() {
  if (!OPTS) return;
  const chosen = new Set(optsChosen()), all = OPTS.options;
  let ht = Number(OPTS.montant_ht), ttc = Number(OPTS.montant_ttc);
  all.forEach((x) => { if (x.choisie) { const h = optHt(x); ht -= h; ttc -= h * (1 + Number(x.taux_tva) / 100); } });
  all.forEach((x) => { if (chosen.has(x.id)) { const h = optHt(x); ht += h; ttc += h * (1 + Number(x.taux_tva) / 100); } });
  const el = document.getElementById("opttot"); if (el) el.textContent = `${eur(ttc)} TTC (${eur(ht)} HT)`;
}
async function optsSave() { if (OPTS && OPTS.options.length) await rpc("partage_options", { p_token: token, p_ids: optsChosen() }); }
async function show() {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return fail("Ce lien n'est pas valide.");
  if (!CFG.url || /VOTRE/.test(CFG.url)) return fail("Le site n'est pas configuré.");
  // v16 : suivi de consultation, expiration et révocation (ignoré si la migration v16 n'est pas faite)
  try {
    const vu = await rpc("partage_vue", { p_token: token, p_ua: navigator.userAgent });
    if (vu && vu.ok === false && vu.raison !== "inconnu") return fail(vu.raison === "expire" ? "Ce lien a expiré. Demandez-en un nouveau à l'entreprise." : "Ce lien a été désactivé par l'entreprise.");
  } catch (e) { /* migration v16 absente */ }
  let d;
  try { d = await rpc("partage_get", { p_token: token }); } catch (e) { return fail(e.message); }
  if (!d) return fail("Ce document n'existe plus ou le lien est incorrect.");
  const isD = d.type === "devis", e = d.entreprise || {};
  let rg = null;
  if (!isD) { try { rg = await rpc("partage_reglement", { p_token: token }); } catch (x) { rg = null; } }
  const pdf = d.pdf_path ? `${CFG.url}/storage/v1/object/public/partages/${d.pdf_path.split("/").map(encodeURIComponent).join("/")}` : "";
  const nom = (isD ? "devis-" : "facture-") + d.numero;
  let etat = "";
  if (isD) {
    if (d.accepte_at) etat = `<span class="badge ok">Accepté le ${dt(d.accepte_at)} par ${esc(d.accepte_par)}</span>`;
    else if (d.refuse_at) etat = `<span class="badge dn">Refusé le ${dt(d.refuse_at)}</span>`;
  } else {
    etat = Number(d.reste) <= 0.005 ? `<span class="badge ok">Réglée</span>` : `<span class="badge">Reste à régler : ${eur(d.reste)}</span>`;
  }
  const peut = isD && d.statut === "Envoyé" && !d.accepte_at && !d.refuse_at;
  OPTS = null;
  if (peut) { try { OPTS = await rpc("partage_options_get", { p_token: token }); } catch (x) { OPTS = null; } }
  root.innerHTML = `
    <div class="card top"><div><p class="mut" style="margin:0">${esc(e.nom || "")}</p><h1>${isD ? "Devis" : "Facture"} ${esc(d.numero)}</h1>
      <p class="mut" style="margin:0">Pour ${esc(d.client)} · ${dt(d.date)}${!isD && d.echeance ? " · échéance " + dt(d.echeance) : ""}</p></div>
      <div style="text-align:right"><div class="big">${eur(d.montant_ttc)}</div><div class="mut">TTC (${eur(d.montant_ht)} HT)</div></div></div>
    <div class="card">${etat ? `<p style="margin:0 0 12px">${etat}</p>` : ""}
      ${pdf ? `<iframe class="pdf" src="${esc(pdf)}" title="${esc(nom)}"></iframe><p class="row" style="margin:12px 0 0"><a class="btn o" href="${esc(pdf)}" target="_blank" rel="noopener" download="${esc(nom)}.pdf">Télécharger le PDF</a></p>` : `<p class="mut">Le PDF n'est pas disponible.</p>`}</div>
    ${peut ? optsHtml(OPTS) : ""}
    ${peut ? `<form class="card" id="rep"><h2>Votre réponse</h2><label>Votre nom (pour valider l'acceptation)<input name="nom" autocomplete="name" maxlength="120"></label>
      <div class="sigbox"><div class="sigh"><span>Votre signature</span><button type="button" class="lk" id="sigclr">Effacer</button></div><canvas id="sig" width="720" height="240" aria-label="Zone de signature : dessinez avec le doigt ou la souris"></canvas><p class="mut sigtip">Dessinez votre signature dans le cadre.</p></div>
      <label class="chk"><input type="checkbox" name="ok"> J'ai lu ce devis et je l'accepte. Cette signature électronique a valeur d'accord.</label>
      <div class="row"><button class="btn" data-a="ok" type="submit">Signer et accepter le devis</button><button class="btn dn" data-a="ko" type="button">Refuser</button></div>
      <p class="mut" style="font-size:13px;margin:10px 0 0">${esc(e.nom || "L'entreprise")} est prévenue immédiatement. Sont conservés avec votre signature : la date et l'heure, et l'empreinte numérique du document que vous avez consulté.</p><p class="er" role="alert"></p></form>` : ""}
    ${!isD && rg ? payBlock(rg) : (!isD && (e.iban) && Number(d.reste) > 0.005 ? `<div class="card"><h2>Règlement par virement</h2><dl><dt>IBAN</dt><dd>${esc(e.iban)}</dd>${e.bic ? `<dt>BIC</dt><dd>${esc(e.bic)}</dd>` : ""}<dt>Référence</dt><dd>${esc(nom)}</dd></dl></div>` : "")}
    <div class="card"><h2>Contact</h2><p class="mut" style="margin:0">${esc(e.nom || "")}${e.telephone ? " · " + esc(e.telephone) : ""}${e.email ? ` · <a href="mailto:${esc(e.email)}">${esc(e.email)}</a>` : ""}</p></div>`;
  if (rg) wirePay(rg);
  document.getElementById("optcard")?.addEventListener("change", optsTotal); optsTotal();
  const f = document.getElementById("rep");
  if (!f) return;
  const er = f.querySelector(".er");
  const send = async (fn, args, btn) => {
    er.textContent = "";
    f.querySelectorAll("button").forEach((b) => (b.disabled = true));
    try { await rpc(fn, args); await show(); } catch (x) { er.textContent = x.message; f.querySelectorAll("button").forEach((b) => (b.disabled = false)); }
  };
  /* ---- Zone de signature (doigt, stylet ou souris) ---- */
  const cv = f.querySelector("#sig"), cx = cv.getContext("2d");
  let drawing = false, strokes = 0, last = null;
  const paint = () => { cx.lineWidth = 3.2; cx.lineCap = "round"; cx.lineJoin = "round"; cx.strokeStyle = "#0b1b3a"; };
  paint();
  const pos = (ev) => { const r = cv.getBoundingClientRect(); return { x: ((ev.clientX - r.left) / r.width) * cv.width, y: ((ev.clientY - r.top) / r.height) * cv.height }; };
  cv.addEventListener("pointerdown", (ev) => { ev.preventDefault(); cv.setPointerCapture(ev.pointerId); drawing = true; last = pos(ev); cx.beginPath(); cx.arc(last.x, last.y, 1.6, 0, 7); cx.fillStyle = "#0b1b3a"; cx.fill(); });
  cv.addEventListener("pointermove", (ev) => { if (!drawing) return; ev.preventDefault(); const p = pos(ev); cx.beginPath(); cx.moveTo(last.x, last.y); cx.lineTo(p.x, p.y); cx.stroke(); strokes += Math.hypot(p.x - last.x, p.y - last.y); last = p; });
  const stop = () => { drawing = false; };
  cv.addEventListener("pointerup", stop); cv.addEventListener("pointercancel", stop);
  f.querySelector("#sigclr").onclick = () => { cx.clearRect(0, 0, cv.width, cv.height); strokes = 0; };
  const sha256 = async (url) => {
    try {
      const buf = await (await fetch(url, { cache: "no-store" })).arrayBuffer();
      return [...new Uint8Array(await crypto.subtle.digest("SHA-256", buf))].map((b) => b.toString(16).padStart(2, "0")).join("");
    } catch (x) { return ""; }
  };
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    if (!f.nom.value.trim()) { er.textContent = "Indiquez votre nom pour signer."; return; }
    if (strokes < 60) { er.textContent = "Dessinez votre signature dans le cadre."; return; }
    if (!f.ok.checked) { er.textContent = "Cochez la case pour confirmer votre accord."; return; }
    er.textContent = "";
    f.querySelectorAll("button").forEach((b) => (b.disabled = true));
    try {
      await optsSave();
      const hash = pdf ? await sha256(pdf) : "";
      try {
        await rpc("partage_signer", { p_token: token, p_nom: f.nom.value.trim(), p_signature: cv.toDataURL("image/png"), p_hash: hash, p_ua: navigator.userAgent });
      } catch (x) {
        // Anciennes bases (migration v7 pas encore lancée) : on garde au moins l'acceptation par le nom
        if (/partage_signer|schema cache|404|PGRST202/i.test(x.message)) await rpc("partage_accepter", { p_token: token, p_nom: f.nom.value.trim() });
        else throw x;
      }
      await show();
    } catch (x) { er.textContent = x.message; f.querySelectorAll("button").forEach((b) => (b.disabled = false)); }
  };
  f.querySelector('[data-a="ko"]').onclick = async () => {
    if (!confirm("Refuser ce devis ?")) return;
    f.querySelectorAll("button").forEach((b) => (b.disabled = true));
    try { await rpc("partage_refuser", { p_token: token, p_motif: "" }); await show(); } catch (x) { er.textContent = x.message; f.querySelectorAll("button").forEach((b) => (b.disabled = false)); }
  };
}
/* ---------- Procès-verbal de réception : lecture et signature ---------- */
async function showPv() {
  if (!/^[0-9a-f-]{36}$/i.test(pvToken)) return fail("Ce lien n'est pas valide.");
  if (!CFG.url || /VOTRE/.test(CFG.url)) return fail("Le site n'est pas configuré.");
  let d;
  try { d = await rpc("pv_get", { p_token: pvToken }); } catch (e) { return fail(e.message); }
  if (!d) return fail("Ce document n'existe plus ou le lien est incorrect.");
  const e = d.entreprise || {}, pdf = d.pdf_path ? `${CFG.url}/storage/v1/object/public/partages/${d.pdf_path.split("/").map(encodeURIComponent).join("/")}` : "";
  const signed = !!d.signe_at, res = d.reserves || [];
  root.innerHTML = `
    <div class="card top"><div><p class="mut" style="margin:0">${esc(e.nom || "")}</p><h1>Procès-verbal de réception ${esc(d.numero || "")}</h1>
      <p class="mut" style="margin:0">${esc((d.chantier || {}).nom || "")} · réception du ${dt(d.date_reception)}</p></div>
      <div style="text-align:right"><span class="badge ${d.type === "Refusée" ? "dn" : d.type === "Sans réserve" ? "ok" : ""}">${d.type === "Sans réserve" ? "Sans réserve" : d.type === "Avec réserves" ? "Avec réserves" : "Réception refusée"}</span></div></div>
    <div class="card">${signed ? `<p style="margin:0 0 12px"><span class="badge ok">Signé le ${dt(d.signe_at)} par ${esc(d.signataire_nom)}</span></p>` : ""}
      ${res.length ? `<h2>Réserves</h2><ol style="margin:0 0 12px 18px;padding:0">${res.map((r) => `<li>${esc(r.description)}${r.localisation ? " <span class='mut'>(" + esc(r.localisation) + ")</span>" : ""}${r.levee ? " <span class='badge ok'>levée</span>" : ""}</li>`).join("")}</ol>${d.delai_levee ? `<p class="mut" style="margin:0 0 12px">À lever avant le ${dt(d.delai_levee)}.</p>` : ""}` : ""}
      ${pdf ? `<iframe class="pdf" src="${esc(pdf)}" title="Procès-verbal"></iframe><p class="row" style="margin:12px 0 0"><a class="btn o" href="${esc(pdf)}" target="_blank" rel="noopener" download="${esc(d.numero || "pv")}.pdf">Télécharger le PDF</a></p>` : ""}</div>
    ${!signed ? `<form class="card" id="rep"><h2>Signer le procès-verbal</h2><label>Votre nom<input name="nom" autocomplete="name" maxlength="120"></label>
      <div class="sigbox"><div class="sigh"><span>Votre signature</span><button type="button" class="lk" id="sigclr">Effacer</button></div><canvas id="sig" width="720" height="240" aria-label="Zone de signature : dessinez avec le doigt ou la souris"></canvas><p class="mut sigtip">Dessinez votre signature dans le cadre.</p></div>
      <label class="chk"><input type="checkbox" name="ok"> J'ai lu ce procès-verbal et je le signe. Cette signature électronique a valeur d'accord.</label>
      <div class="row"><button class="btn" type="submit">Signer le procès-verbal</button></div>
      <p class="mut" style="font-size:13px;margin:10px 0 0">${esc(e.nom || "L'entreprise")} est prévenue immédiatement. Sont conservés avec votre signature : la date et l'heure, et l'empreinte numérique du document consulté.</p><p class="er" role="alert"></p></form>` : ""}
    <div class="card"><h2>Contact</h2><p class="mut" style="margin:0">${esc(e.nom || "")}${e.telephone ? " · " + esc(e.telephone) : ""}${e.email ? ` · <a href="mailto:${esc(e.email)}">${esc(e.email)}</a>` : ""}</p></div>`;
  const f = document.getElementById("rep");
  if (!f) return;
  const er = f.querySelector(".er"), cv = f.querySelector("#sig"), cx = cv.getContext("2d");
  let drawing = false, strokes = 0, last = null;
  cx.lineWidth = 3.2; cx.lineCap = "round"; cx.lineJoin = "round"; cx.strokeStyle = "#0b1b3a";
  const pos = (ev) => { const r = cv.getBoundingClientRect(); return { x: ((ev.clientX - r.left) / r.width) * cv.width, y: ((ev.clientY - r.top) / r.height) * cv.height }; };
  cv.addEventListener("pointerdown", (ev) => { ev.preventDefault(); cv.setPointerCapture(ev.pointerId); drawing = true; last = pos(ev); cx.beginPath(); cx.arc(last.x, last.y, 1.6, 0, 7); cx.fillStyle = "#0b1b3a"; cx.fill(); });
  cv.addEventListener("pointermove", (ev) => { if (!drawing) return; ev.preventDefault(); const p = pos(ev); cx.beginPath(); cx.moveTo(last.x, last.y); cx.lineTo(p.x, p.y); cx.stroke(); strokes += Math.hypot(p.x - last.x, p.y - last.y); last = p; });
  const stop = () => { drawing = false; };
  cv.addEventListener("pointerup", stop); cv.addEventListener("pointercancel", stop);
  f.querySelector("#sigclr").onclick = () => { cx.clearRect(0, 0, cv.width, cv.height); strokes = 0; };
  const sha256 = async (url) => { try { const buf = await (await fetch(url, { cache: "no-store" })).arrayBuffer(); return [...new Uint8Array(await crypto.subtle.digest("SHA-256", buf))].map((b) => b.toString(16).padStart(2, "0")).join(""); } catch (x) { return ""; } };
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    if (!f.nom.value.trim()) { er.textContent = "Indiquez votre nom pour signer."; return; }
    if (strokes < 60) { er.textContent = "Dessinez votre signature dans le cadre."; return; }
    if (!f.ok.checked) { er.textContent = "Cochez la case pour confirmer votre accord."; return; }
    er.textContent = ""; f.querySelectorAll("button").forEach((b) => (b.disabled = true));
    try {
      const hash = pdf ? await sha256(pdf) : "";
      await rpc("pv_signer", { p_token: pvToken, p_nom: f.nom.value.trim(), p_signature: cv.toDataURL("image/png"), p_hash: hash, p_ua: navigator.userAgent });
      await showPv();
    } catch (x) { er.textContent = x.message; f.querySelectorAll("button").forEach((b) => (b.disabled = false)); }
  };
}

/* ---------- Portail du maître d'œuvre : p.html?m=<jeton> ---------- */
const moeToken = new URLSearchParams(location.search).get("m") || "";
const offreToken = new URLSearchParams(location.search).get("o") || "";
async function showMoe() {
  if (!/^[0-9a-f-]{36}$/i.test(moeToken)) return fail("Ce lien n'est pas valide.");
  if (!CFG.url || /VOTRE/.test(CFG.url)) return fail("Le site n'est pas configuré.");
  let d;
  try { d = await rpc("moe_get", { p_token: moeToken }); } catch (e) { return fail(e.message); }
  const e = d.entreprise || {}, L = d.lignes || [], av = {};
  (d.avis || []).forEach((a) => (av[a.i] = a));
  const locked = ["Validée", "Validée avec réserves", "Refusée"].includes(d.statut);
  const pct = (n) => (Math.round(Number(n) * 100) / 100).toLocaleString("fr-FR") + " %";
  root.innerHTML = `
    <div class="card top"><div><p class="mut" style="margin:0">${esc(e.nom || "")}</p><h1>${esc(d.titre)}</h1><p class="mut" style="margin:0">${d.chantier ? esc(d.chantier) + " · " : ""}version ${d.version}${d.dest_nom ? " · pour " + esc(d.dest_nom) : ""}</p></div>
      <div style="text-align:right"><div class="big">${eur(d.total_ht)}</div><span class="mut">HT sur la période</span></div></div>
    ${d.message ? `<div class="card"><p style="margin:0;white-space:pre-wrap">${esc(d.message)}</p></div>` : ""}
    ${locked ? `<div class="card"><p style="margin:0"><span class="badge ${d.statut === "Refusée" ? "dn" : "ok"}">${esc(d.statut)}</span> par ${esc(d.decide_par || "")} le ${dt(d.decide_at)}.</p>${d.commentaire ? `<p style="margin:8px 0 0;white-space:pre-wrap">${esc(d.commentaire)}</p>` : ""}</div>` : ""}
    <form class="card" id="mf"><h2>Lignes à valider</h2>
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse"><thead><tr style="text-align:left"><th>Désignation</th><th style="text-align:right">Cumul</th><th style="text-align:right">Montant HT</th><th>Avis</th></tr></thead><tbody>
      ${L.map((l, i) => { const a = av[i] || {}; return `<tr style="border-top:1px solid var(--line)"><td style="padding:8px 6px 8px 0">${esc(l.label)}</td><td style="text-align:right;white-space:nowrap">${pct(l.cum)}</td><td style="text-align:right;white-space:nowrap">${eur(l.montant)}</td>
        <td style="padding:6px 0;min-width:210px">${locked ? `${a.ok === true ? "✓ OK" : a.ok === false ? "✗ À revoir" : ""} ${esc(a.c || "")}` : `<select name="ok${i}" aria-label="Avis sur ${esc(l.label)}"><option value="">Pas d'avis</option><option value="true"${a.ok === true ? " selected" : ""}>OK</option><option value="false"${a.ok === false ? " selected" : ""}>À revoir</option></select><input name="c${i}" maxlength="1000" placeholder="Commentaire" value="${esc(a.c || "")}" style="width:100%;margin-top:4px">`}</td></tr>`; }).join("")}
      </tbody></table></div>
      ${locked ? "" : `<label style="display:block;margin-top:14px">Commentaire général<textarea name="g" rows="3" maxlength="3000" style="width:100%">${esc(d.commentaire || "")}</textarea></label>
      <label style="display:block;margin-top:10px">Votre nom<input name="nom" autocomplete="name" maxlength="120" style="width:100%" value="${esc(d.decide_par || "")}"></label>
      <div class="row" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px"><button class="btn" type="submit" data-d="Validée">Valider</button><button class="btn o" type="submit" data-d="Validée avec réserves">Valider avec réserves</button><button class="btn o" type="submit" data-d="Commentée">Envoyer mes commentaires</button><button class="btn dn" type="submit" data-d="Refusée">Refuser</button></div>
      <p class="er" role="alert"></p>
      <p class="mut" style="font-size:13px;margin:8px 0 0">${esc(e.nom || "L'entreprise")} est prévenue de votre réponse. Ce lien est valable jusqu'au ${dt(d.expire_at)}.</p>`}
    </form>
    <div class="card"><h2>Contact</h2><p class="mut" style="margin:0">${esc(e.nom || "")}${e.telephone ? " · " + esc(e.telephone) : ""}${e.email ? ` · <a href="mailto:${esc(e.email)}">${esc(e.email)}</a>` : ""}</p></div>`;
  const f = document.getElementById("mf");
  if (locked) return;
  let dec = "";
  f.querySelectorAll("button[data-d]").forEach((b) => (b.onclick = () => (dec = b.dataset.d)));
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const er = f.querySelector(".er");
    if (!f.elements.nom.value.trim()) { er.textContent = "Indiquez votre nom."; return; }
    const avis = L.map((_, i) => ({ i, ok: f.elements["ok" + i].value === "" ? null : f.elements["ok" + i].value === "true", c: f.elements["c" + i].value.trim() })).filter((a) => a.ok !== null || a.c);
    if (dec === "Validée" && avis.some((a) => a.ok === false)) { er.textContent = "Une ligne est marquée « À revoir » : choisissez « Valider avec réserves » ou « Envoyer mes commentaires »."; return; }
    if (dec === "Refusée" && !f.elements.g.value.trim() && !avis.some((a) => a.c)) { er.textContent = "Indiquez le motif du refus dans un commentaire."; return; }
    er.textContent = ""; f.querySelectorAll("button").forEach((b) => (b.disabled = true));
    try { await rpc("moe_avis", { p_token: moeToken, p_nom: f.elements.nom.value.trim(), p_decision: dec, p_global: f.elements.g.value, p_avis: avis }); await showMoe(); }
    catch (x) { er.textContent = x.message; f.querySelectorAll("button").forEach((b) => (b.disabled = false)); }
  };
}

/* ---------- Offre de sous-traitance : p.html?o=<jeton> ---------- */
async function showOffre() {
  if (!/^[0-9a-f-]{36}$/i.test(offreToken)) return fail("Ce lien n'est pas valide.");
  if (!CFG.url || /VOTRE/.test(CFG.url)) return fail("Le site n'est pas configuré.");
  let o;
  try { o = await rpc("offre_get", { p_token: offreToken }); } catch (e) { return fail(e.message); }
  const e = o.entreprise || {};
  root.innerHTML = `
    <div class="card"><p class="mut" style="margin:0">${esc(e.nom || "")} recherche un sous-traitant</p><h1>${esc(o.titre)}</h1>
      <p class="mut" style="margin:0">${[o.metier, o.lieu, o.duree ? "durée " + o.duree : "", o.date_debut ? "démarrage " + dt(o.date_debut) : "", o.budget_ht ? "budget indicatif " + eur(o.budget_ht) + " HT" : ""].filter(Boolean).map(esc).join(" · ")}</p>
      ${o.description ? `<p style="white-space:pre-wrap;margin:12px 0 0">${esc(o.description)}</p>` : ""}${o.date_limite ? `<p class="mut" style="margin:10px 0 0">Candidatures jusqu'au ${dt(o.date_limite)}.</p>` : ""}</div>
    <form class="card" id="cf"><h2>Votre candidature</h2>
      <label style="display:block;margin-bottom:8px">Entreprise *<input name="nom" required maxlength="160" style="width:100%"></label>
      <label style="display:block;margin-bottom:8px">SIRET<input name="siret" inputmode="numeric" maxlength="17" style="width:100%"></label>
      <label style="display:block;margin-bottom:8px">Personne à contacter<input name="contact" maxlength="120" style="width:100%"></label>
      <label style="display:block;margin-bottom:8px">Email *<input name="email" type="email" required maxlength="160" style="width:100%"></label>
      <label style="display:block;margin-bottom:8px">Téléphone<input name="tel" type="tel" maxlength="30" style="width:100%"></label>
      <label style="display:block;margin-bottom:8px">Métier<input name="metier" maxlength="80" style="width:100%" value="${esc(o.metier || "")}"></label>
      <label style="display:block;margin-bottom:8px">Prix proposé (€ HT)<input name="prix" inputmode="decimal" style="width:100%"></label>
      <label style="display:block;margin-bottom:8px">Délai d'intervention (jours)<input name="delai" inputmode="numeric" style="width:100%"></label>
      <label style="display:block;margin-bottom:8px">Références de chantiers similaires<textarea name="refs" rows="3" maxlength="2000" style="width:100%"></textarea></label>
      <label style="display:block;margin-bottom:8px">Message<textarea name="msg" rows="3" maxlength="3000" style="width:100%"></textarea></label>
      <label class="chk" style="margin-bottom:6px"><input type="checkbox" name="ass"> J'ai une assurance décennale et RC professionnelle en cours de validité</label>
      <label class="chk" style="margin-bottom:6px"><input type="checkbox" name="vig"> Je peux fournir une attestation de vigilance URSSAF à jour</label>
      <div style="position:absolute;left:-9999px" aria-hidden="true"><input name="hp" tabindex="-1" autocomplete="off"></div>
      <label class="chk" style="margin:10px 0"><input type="checkbox" name="rgpd"> J'accepte que ${esc(e.nom || "l'entreprise")} conserve ces informations pour traiter ma candidature. Ma réponse n'engage aucune des deux parties.</label>
      <div class="row"><button class="btn" type="submit">Envoyer ma candidature</button></div><p class="er" role="alert"></p></form>`;
  const f = document.getElementById("cf"), num = (v) => (String(v).trim() === "" ? null : Number(String(v).replace(/\s/g, "").replace(",", ".")));
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const er = f.querySelector(".er"); er.textContent = "";
    const prix = num(f.elements.prix.value), delai = num(f.elements.delai.value);
    if (prix !== null && !isFinite(prix)) { er.textContent = "Prix invalide."; return; }
    f.querySelector("button").disabled = true;
    try {
      await rpc("offre_candidater", { p_token: offreToken, p_nom: f.elements.nom.value, p_siret: f.elements.siret.value, p_contact: f.elements.contact.value, p_email: f.elements.email.value, p_telephone: f.elements.tel.value, p_metier: f.elements.metier.value, p_prix: prix,
        p_delai: delai === null || !isFinite(delai) ? null : Math.round(delai), p_refs: f.elements.refs.value, p_message: f.elements.msg.value, p_assurance: f.elements.ass.checked, p_vigilance: f.elements.vig.checked, p_rgpd: f.elements.rgpd.checked, p_hp: f.elements.hp.value });
      root.innerHTML = `<div class="card c"><h1>Candidature envoyée</h1><p class="mut">Merci. ${esc(e.nom || "L'entreprise")} vous répondra si votre profil est retenu.</p></div>`;
    } catch (x) { er.textContent = x.message; f.querySelector("button").disabled = false; }
  };
}

moeToken ? showMoe() : offreToken ? showOffre() : pvToken ? showPv() : show();
