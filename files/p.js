/* Page publique client : p.html?t=<jeton>. Aucune connexion, uniquement les fonctions partage_* de Supabase. */
const CFG = window.PILOT_CONFIG || {};
const root = document.getElementById("p");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const eur = (n) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(Number(n || 0));
const dt = (s) => (s ? new Date(s).toLocaleDateString("fr-FR") : "");
const token = new URLSearchParams(location.search).get("t") || "";

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

async function show() {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return fail("Ce lien n'est pas valide.");
  if (!CFG.url || /VOTRE/.test(CFG.url)) return fail("Le site n'est pas configuré.");
  let d;
  try { d = await rpc("partage_get", { p_token: token }); } catch (e) { return fail(e.message); }
  if (!d) return fail("Ce document n'existe plus ou le lien est incorrect.");
  const isD = d.type === "devis", e = d.entreprise || {};
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
  root.innerHTML = `
    <div class="card top"><div><p class="mut" style="margin:0">${esc(e.nom || "")}</p><h1>${isD ? "Devis" : "Facture"} ${esc(d.numero)}</h1>
      <p class="mut" style="margin:0">Pour ${esc(d.client)} · ${dt(d.date)}${!isD && d.echeance ? " · échéance " + dt(d.echeance) : ""}</p></div>
      <div style="text-align:right"><div class="big">${eur(d.montant_ttc)}</div><div class="mut">TTC (${eur(d.montant_ht)} HT)</div></div></div>
    <div class="card">${etat ? `<p style="margin:0 0 12px">${etat}</p>` : ""}
      ${pdf ? `<iframe class="pdf" src="${esc(pdf)}" title="${esc(nom)}"></iframe><p class="row" style="margin:12px 0 0"><a class="btn o" href="${esc(pdf)}" target="_blank" rel="noopener" download="${esc(nom)}.pdf">Télécharger le PDF</a></p>` : `<p class="mut">Le PDF n'est pas disponible.</p>`}</div>
    ${peut ? `<form class="card" id="rep"><h2>Votre réponse</h2><label>Votre nom (pour valider l'acceptation)<input name="nom" autocomplete="name" maxlength="120"></label>
      <div class="row"><button class="btn" data-a="ok" type="submit">Accepter le devis</button><button class="btn dn" data-a="ko" type="button">Refuser</button></div>
      <p class="mut" style="font-size:13px;margin:10px 0 0">En acceptant, vous confirmez votre accord sur ce devis. ${esc(e.nom || "L'entreprise")} est prévenue immédiatement.</p><p class="er" role="alert"></p></form>` : ""}
    ${!isD && (e.iban) && Number(d.reste) > 0.005 ? `<div class="card"><h2>Règlement par virement</h2><dl><dt>IBAN</dt><dd>${esc(e.iban)}</dd>${e.bic ? `<dt>BIC</dt><dd>${esc(e.bic)}</dd>` : ""}<dt>Référence</dt><dd>${esc(nom)}</dd></dl></div>` : ""}
    <div class="card"><h2>Contact</h2><p class="mut" style="margin:0">${esc(e.nom || "")}${e.telephone ? " · " + esc(e.telephone) : ""}${e.email ? ` · <a href="mailto:${esc(e.email)}">${esc(e.email)}</a>` : ""}</p></div>`;
  const f = document.getElementById("rep");
  if (!f) return;
  const er = f.querySelector(".er");
  const send = async (fn, args, btn) => {
    er.textContent = "";
    f.querySelectorAll("button").forEach((b) => (b.disabled = true));
    try { await rpc(fn, args); await show(); } catch (x) { er.textContent = x.message; f.querySelectorAll("button").forEach((b) => (b.disabled = false)); }
  };
  f.onsubmit = (ev) => { ev.preventDefault(); if (!f.nom.value.trim()) { er.textContent = "Indiquez votre nom pour accepter."; return; } send("partage_accepter", { p_token: token, p_nom: f.nom.value }); };
  f.querySelector('[data-a="ko"]').onclick = () => { if (confirm("Refuser ce devis ?")) send("partage_refuser", { p_token: token, p_motif: "" }); };
}
show();
