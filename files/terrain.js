/* Page mobile des compagnons : pointage, rapports signés, photos, mode hors connexion.
   Sans compte : tout passe par les fonctions terrain_* de Supabase avec le jeton privé du lien. */
(() => {
const CFG = window.PILOT_CONFIG || {};
const TOKEN = new URLSearchParams(location.search).get("t") || "";
const app = document.getElementById("app");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const dfr = (s) => (s ? String(s).slice(0, 10).split("-").reverse().join("/") : "");
const num = (v) => { const n = parseFloat(String(v ?? "").replace(",", ".")); return isFinite(n) ? n : 0; };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
const CK = "pilot-terrain-" + TOKEN.slice(0, 8);
const S = { data: null, tab: "heures", pending: [], online: navigator.onLine, syncing: false, msg: null, fatal: "", sig: null, photos: [], lignes: [{ designation: "", quantite: "1", unite: "u", prix: "" }], draft: {} };

/* ---------- File d'attente locale (IndexedDB) ---------- */
const idb = () => new Promise((ok, ko) => { const r = indexedDB.open("pilot-terrain", 1); r.onupgradeneeded = () => r.result.createObjectStore("q", { keyPath: "id", autoIncrement: true }); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
const tx = async (mode, fn) => { const db = await idb(); return new Promise((ok, ko) => { const t = db.transaction("q", mode), st = t.objectStore("q"), r = fn(st); t.oncomplete = () => ok(r && r.result); t.onerror = () => ko(t.error); }); };
const qAll = async () => (await tx("readonly", (s) => s.getAll())) || [];
const qAdd = (item) => tx("readwrite", (s) => s.add({ ...item, token: TOKEN, t: Date.now() }));
const qDel = (id) => tx("readwrite", (s) => s.delete(id));
const qPut = (item) => tx("readwrite", (s) => s.put(item));
const mine = (all) => all.filter((x) => x.token === TOKEN);

/* ---------- Réseau ---------- */
class NetErr extends Error {}
async function rpc(fn, args) {
  let r;
  try { r = await fetch(`${CFG.url}/rest/v1/rpc/${fn}`, { method: "POST", headers: { "Content-Type": "application/json", apikey: CFG.anonKey, Authorization: "Bearer " + CFG.anonKey }, body: JSON.stringify(args) }); }
  catch (e) { throw new NetErr("Pas de réseau"); }
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error((j && (j.message || j.hint)) || "Erreur " + r.status);
  return j;
}
async function refreshData() {
  const d = await rpc("terrain_get", { p_token: TOKEN });
  S.data = d; try { localStorage.setItem(CK, JSON.stringify(d)); } catch (e) { /* stockage plein */ }
}
async function sync() {
  if (S.syncing || !TOKEN) return;
  S.syncing = true; render();
  try {
    S.pending = mine(await qAll());
    const pts = S.pending.filter((x) => x.kind === "pointage" && !x.err);
    if (pts.length) { await rpc("terrain_pointer", { p_token: TOKEN, p: pts.map((x) => x.payload) }).then(() => Promise.all(pts.map((x) => qDel(x.id)))).catch(async (e) => { if (e instanceof NetErr) throw e; for (const x of pts) await qPut({ ...x, err: e.message }); }); }
    for (const x of mine(await qAll()).filter((x) => x.kind !== "pointage" && !x.err)) {
      try { await rpc(x.kind === "photo" ? "terrain_photo" : "terrain_rapport", { p_token: TOKEN, p: x.payload }); await qDel(x.id); }
      catch (e) { if (e instanceof NetErr) throw e; await qPut({ ...x, err: e.message }); }
    }
    S.online = true;
    await refreshData();
  } catch (e) {
    if (e instanceof NetErr) S.online = false; else if (/Lien invalide/.test(e.message)) S.fatal = e.message; else S.msg = { er: 1, t: e.message };
  }
  S.pending = mine(await qAll()); S.syncing = false; render();
}

/* ---------- Photos ---------- */
async function compress(file, max = 1280) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error("Photo illisible")); i.src = url; });
    const sc = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement("canvas");
    c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.72);
  } finally { URL.revokeObjectURL(url); }
}

/* ---------- Affichage ---------- */
const D = () => S.data || { chantiers: [], taches: [], pointages: [], absences: [] };
const chNom = (id) => D().chantiers.find((c) => c.id === id)?.nom || "Hors chantier";
const opts = (list, cur, none) => `${none ? `<option value="">${esc(none)}</option>` : ""}${list.map((o) => `<option value="${esc(o.v)}"${o.v === cur ? " selected" : ""}>${esc(o.l)}</option>`).join("")}`;
const chOpts = (cur, none) => opts(D().chantiers.map((c) => ({ v: c.id, l: c.nom + (c.ville ? ` (${c.ville})` : "") })), cur, none);
const H = (h) => String(Math.round(h * 100) / 100).replace(".", ",") + " h";
const CHIP = { "À valider": "wn", Validé: "ok", Refusé: "dn" };

function render() {
  if (S.fatal) { app.innerHTML = `<div class="empty"><h2>Lien indisponible</h2><p>${esc(S.fatal)}</p><p>Demandez un nouveau lien à votre responsable.</p></div>`; return; }
  if (!TOKEN) { app.innerHTML = `<div class="empty"><h2>Lien incomplet</h2><p>Ouvrez le lien complet envoyé par votre responsable.</p></div>`; return; }
  if (!S.data) { app.innerHTML = `<p class="boot">${S.online ? "Chargement…" : "Pas de réseau et rien en mémoire : ouvrez cette page une première fois avec du réseau."}</p>`; return; }
  const n = S.pending.filter((x) => !x.err).length, er = S.pending.filter((x) => x.err).length;
  const fresh = S.fresh; S.fresh = false;
  const keep = fresh ? null : saveDraft();
  const sigKeep = !fresh && S.sig && S.sig.strokes && S.sig.c.isConnected ? { url: S.sig.c.toDataURL(), n: S.sig.strokes } : null;
  app.innerHTML = `<header class="top"><div><h1>${esc(S.data.salarie.nom)}</h1><small>${esc(S.data.entreprise || "")}</small></div><span class="net ${S.online ? "on" : "off"}">${S.syncing ? "Envoi…" : S.online ? "En ligne" : "Hors connexion"}${n ? ` · ${n} à envoyer` : ""}</span></header>
    ${S.msg ? `<div class="msg ${S.msg.er ? "er" : "ok"}">${esc(S.msg.t)}</div>` : ""}
    ${er ? `<div class="msg er">${er} élément(s) refusé(s) par le serveur : <button class="btn o sm" data-a="clearErr">Les retirer</button><br><small>${esc(S.pending.find((x) => x.err).err)}</small></div>` : ""}
    <nav class="tabs">${[["heures", "Heures"], ["rapport", "Rapport"], ["photos", "Photos"], ["infos", "Infos"]].map(([k, l]) => `<button data-a="tab" data-v="${k}" aria-selected="${S.tab === k}">${l}</button>`).join("")}</nav>
    ${S.tab === "heures" ? vHeures() : S.tab === "rapport" ? vRapport() : S.tab === "photos" ? vPhotos() : vInfos()}`;
  restoreDraft(keep);
  if (S.tab === "rapport") {
    initSig();
    if (sigKeep) { const im = new Image(); im.onload = () => { const c = S.sig.c; c.getContext("2d").drawImage(im, 0, 0, c.clientWidth, c.clientHeight); S.sig.strokes = sigKeep.n; }; im.src = sigKeep.url; }
  }
}
// Conserve les champs saisis quand l'écran est redessiné (synchronisation en arrière-plan)
function saveDraft() { const o = {}; app.querySelectorAll("[name]").forEach((e) => { o[e.name] = e.type === "checkbox" ? e.checked : e.value; }); if (Object.keys(o).length) S.draft[S.tab] = o; return S.draft[S.tab]; }
function restoreDraft(d) { if (!d) return; app.querySelectorAll("[name]").forEach((e) => { if (e.name in d) { if (e.type === "checkbox") e.checked = d[e.name]; else if (e.tagName !== "SELECT" || [...e.options].some((o) => o.value === d[e.name])) e.value = d[e.name]; } }); }

function vHeures() {
  const pend = S.pending.filter((x) => x.kind === "pointage").map((x) => ({ ...x.payload, statut: x.err ? "Refusé" : "En attente d'envoi", motif: x.err, local: 1 }));
  const known = new Set(pend.map((p) => p.client_uid)), srv = D().pointages.filter((p) => !known.has(p.client_uid)).map((p) => ({ ...p, date: p.date }));
  const L = [...pend, ...srv];
  const taches = D().taches;
  return `<form class="card" data-f="pointage"><h2>Saisir mes heures</h2>
    <label>Date<input type="date" name="date" value="${today()}"></label>
    <label>Chantier<select name="chantier_id">${chOpts("", "Hors chantier (atelier, dépôt…)")}</select></label>
    ${taches.length ? `<label>Tâche (facultatif)<select name="tache_id">${opts(taches.map((t) => ({ v: t.id, l: t.titre })), "", "Aucune")}</select></label>` : ""}
    <label>Heures travaillées<input name="heures" inputmode="decimal" placeholder="7,5" autocomplete="off"></label>
    <div class="quick">${[4, 7, 8].map((h) => `<button type="button" data-a="qh" data-v="${h}">${h} h</button>`).join("")}<button type="button" data-a="qh" data-v="7.5">7,5 h</button></div>
    <label>Travail effectué<input name="description" placeholder="Ex : pose du carrelage salle de bain"></label>
    <div class="row2"><label>Trajet (min)<input name="trajet_minutes" inputmode="numeric" placeholder="0"></label><label>Trajet (km)<input name="trajet_km" inputmode="decimal" placeholder="0"></label></div>
    <label class="chk"><input type="checkbox" name="panier"> Panier repas</label>
    <button class="btn" type="submit" style="margin-top:12px">Enregistrer</button>
    <p class="hint">Vos heures sont gardées sur le téléphone et envoyées dès que le réseau revient. Votre responsable les valide ensuite.</p></form>
    <section class="card"><h2>Mes 3 dernières semaines</h2>${L.length ? L.map((p) => `<div class="item"><div><b>${dfr(p.date)}</b> · ${esc(chNom(p.chantier_id))}${p.description ? `<small>${esc(p.description)}</small>` : ""}${p.motif ? `<small>${esc(p.motif)}</small>` : ""}</div><div style="text-align:right"><b>${H(p.heures)}</b><br><span class="chip ${CHIP[p.statut] || ""}">${esc(p.statut)}</span></div></div>`).join("") : `<p class="empty">Aucune heure saisie.</p>`}
    ${L.length ? `<p class="hint">Total affiché : ${H(L.reduce((a, p) => a + Number(p.heures), 0))}</p>` : ""}</section>`;
}
function vRapport() {
  return `<form class="card" data-f="rapport"><h2>Rapport d'intervention</h2>
    <label>Chantier (facultatif)<select name="chantier_id" data-a="chRap">${chOpts("", "Aucun : saisir le client")}</select></label>
    <label>Client<input name="client_nom" placeholder="Nom du client" autocomplete="off"></label>
    <label>Adresse de l'intervention<input name="adresse" autocomplete="off"></label>
    <div class="row2"><label>Début<input type="time" name="heure_debut"></label><label>Fin<input type="time" name="heure_fin"></label></div>
    <label>Date<input type="date" name="date" value="${today()}"></label>
    <label>Objet<input name="objet" placeholder="Ex : fuite sous l'évier"></label>
    <label>Constat<textarea name="constat"></textarea></label>
    <label>Travaux réalisés<textarea name="travaux"></textarea></label>
    <div><b style="font-size:14px">Fournitures posées</b>${S.lignes.map((l, i) => `<div class="fr"><input name="fd${i}" value="${esc(l.designation)}" placeholder="Désignation"><input name="fq${i}" value="${esc(l.quantite)}" inputmode="decimal" aria-label="Quantité"><input name="fu${i}" value="${esc(l.unite)}" aria-label="Unité"><input name="fp${i}" value="${esc(l.prix)}" inputmode="decimal" placeholder="€ HT" aria-label="Prix HT"><button type="button" data-a="rmLigne" data-v="${i}" aria-label="Retirer">×</button></div>`).join("")}<button type="button" class="btn o sm" data-a="addLigne">+ Ajouter une ligne</button></div>
    <label style="margin-top:12px">Reste à faire (facultatif)<textarea name="a_suivre" style="min-height:60px"></textarea></label>
    <label>Durée si pas d'heures de début et fin (h)<input name="heures" inputmode="decimal" placeholder="1,5"></label>
    <div><b style="font-size:14px">Photos</b><div class="thumbs">${S.photos.map((p) => `<img src="${p}" alt="">`).join("")}</div><label class="btn o sm" style="display:inline-block;width:auto;margin:0">Ajouter une photo<input type="file" accept="image/*" capture="environment" data-a="photoRap" hidden multiple></label></div>
    <label style="margin-top:14px">Nom du signataire (client)<input name="signataire_nom" autocomplete="off"></label>
    <div>Signature du client<canvas class="sig" id="sig"></canvas><button type="button" class="btn o sm" data-a="clrSig" style="margin-top:8px">Effacer la signature</button></div>
    <label class="chk" style="margin-top:12px"><input type="checkbox" name="ok"> Le client confirme la réalisation de l'intervention décrite</label>
    <button class="btn" type="submit" style="margin-top:12px">Valider et envoyer</button>
    <p class="hint">Faites signer le client avec le doigt. Le rapport reste sur le téléphone jusqu'à son envoi.</p></form>`;
}
function vPhotos() {
  const pend = S.pending.filter((x) => x.kind === "photo").length;
  return `<form class="card" data-f="photo"><h2>Photo de chantier</h2>
    <label>Chantier<select name="chantier_id">${chOpts("", "Sans chantier")}</select></label>
    <label>Légende (facultatif)<input name="legende" placeholder="Ex : avant travaux, état du compteur"></label>
    <label class="btn" style="margin:0">Prendre une photo<input type="file" accept="image/*" capture="environment" data-a="photo" hidden multiple></label>
    <p class="hint">Les photos sont réduites puis envoyées dès que possible.${pend ? ` ${pend} en attente d'envoi.` : ""}</p></form>`;
}
function vInfos() {
  const d = D(), ab = d.absences;
  return `<section class="card"><h2>Mes chantiers en cours</h2>${d.chantiers.length ? d.chantiers.map((c) => `<div class="item"><div><b>${esc(c.nom)}</b><small>${esc(c.client || "")}${c.ville ? " · " + esc(c.ville) : ""}</small></div>${c.ville ? `<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((c.nom + " " + c.ville))}" target="_blank" rel="noopener" class="chip">Itinéraire</a>` : ""}</div>`).join("") : `<p class="empty">Aucun chantier.</p>`}</section>
    <section class="card"><h2>Mes tâches</h2>${d.taches.length ? d.taches.map((t) => `<div class="item"><div><b>${esc(t.titre)}</b><small>${esc(chNom(t.chantier_id))}</small></div><span>${t.echeance ? dfr(t.echeance) : ""}</span></div>`).join("") : `<p class="empty">Aucune tâche.</p>`}</section>
    ${ab.length ? `<section class="card"><h2>Mes absences à venir</h2>${ab.map((a) => `<div class="item"><div>${esc(a.type)}</div><span>${dfr(a.debut)} au ${dfr(a.fin)}</span></div>`).join("")}</section>` : ""}
    <p class="hint">Ces informations restent disponibles sans réseau.</p>`;
}

/* ---------- Signature ---------- */
function initSig() {
  const c = document.getElementById("sig"); if (!c) return;
  const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight; c.width = w * dpr; c.height = h * dpr;
  const g = c.getContext("2d"); g.scale(dpr, dpr); g.lineWidth = 2.4; g.lineCap = "round"; g.strokeStyle = "#111";
  let draw = false, last = null; S.sig = { c, strokes: 0 };
  const pos = (e) => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  c.onpointerdown = (e) => { draw = true; last = pos(e); c.setPointerCapture(e.pointerId); S.sig.strokes++; g.beginPath(); g.moveTo(...last); g.lineTo(last[0] + 0.1, last[1] + 0.1); g.stroke(); e.preventDefault(); };
  c.onpointermove = (e) => { if (!draw) return; const p = pos(e); g.beginPath(); g.moveTo(...last); g.lineTo(...p); g.stroke(); last = p; e.preventDefault(); };
  c.onpointerup = c.onpointercancel = () => { draw = false; };
}

/* ---------- Actions ---------- */
const say = (t, er) => { S.msg = { t, er }; render(); window.scrollTo({ top: 0, behavior: "smooth" }); setTimeout(() => { if (S.msg && S.msg.t === t) { S.msg = null; render(); } }, 6000); };
async function enqueue(item) { await qAdd(item); S.pending = mine(await qAll()); }
app.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target, kind = f.dataset.f, v = Object.fromEntries(new FormData(f));
  try {
    if (kind === "pointage") {
      const h = num(v.heures); if (!(h > 0 && h <= 24)) return say("Saisissez un nombre d'heures entre 0 et 24.", 1);
      await enqueue({ kind: "pointage", payload: { client_uid: uid(), date: v.date, heures: h, chantier_id: v.chantier_id || "", tache_id: v.tache_id || "", description: v.description || "", panier: !!v.panier, trajet_minutes: Math.round(num(v.trajet_minutes)), trajet_km: num(v.trajet_km) } });
      S.draft.heures = null; S.fresh = true;
      say("Heures enregistrées.");
    } else if (kind === "rapport") {
      if (!v.signataire_nom || !v.signataire_nom.trim()) return say("Indiquez le nom du signataire.", 1);
      if (!S.sig || S.sig.strokes < 1) return say("Le client doit signer.", 1);
      if (!v.ok) return say("Cochez la confirmation du client.", 1);
      if (!(v.objet || v.travaux)) return say("Décrivez l'objet ou les travaux réalisés.", 1);
      const fourn = S.lignes.map((_, i) => ({ designation: (v["fd" + i] || "").trim(), quantite: num(v["fq" + i]) || 1, unite: (v["fu" + i] || "u").trim(), prix_unitaire_ht: num(v["fp" + i]) })).filter((x) => x.designation);
      let heures = num(v.heures);
      if (v.heure_debut && v.heure_fin) { const [a, b] = [v.heure_debut, v.heure_fin].map((t) => +t.slice(0, 2) * 60 + +t.slice(3, 5)); if (b > a) heures = Math.round(((b - a) / 60) * 100) / 100; }
      const ru = uid();
      await enqueue({ kind: "rapport", payload: { client_uid: ru, chantier_id: v.chantier_id || "", client_nom: v.client_nom || "", adresse: v.adresse || "", date: v.date, heure_debut: v.heure_debut || "", heure_fin: v.heure_fin || "", objet: v.objet || "", constat: v.constat || "", travaux: v.travaux || "", fournitures: fourn, heures, a_suivre: v.a_suivre || "", signataire_nom: v.signataire_nom.trim(), signature: S.sig.c.toDataURL("image/png") } });
      for (const p of S.photos) await enqueue({ kind: "photo", payload: { client_uid: uid(), rapport_uid: ru, chantier_id: v.chantier_id || "", legende: "Rapport : " + (v.objet || ""), data: p } });
      S.fresh = true; S.sig = null; S.photos = []; S.lignes = [{ designation: "", quantite: "1", unite: "u", prix: "" }]; S.draft.rapport = null;
      say("Rapport enregistré. Il sera envoyé dès que possible.");
    } else return;
    sync();
  } catch (err) { say("Enregistrement impossible : " + err.message, 1); }
});
app.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-a]"); if (!b || b.tagName === "INPUT" || b.tagName === "SELECT") return;
  const a = b.dataset.a, v = b.dataset.v;
  if (a === "tab") { saveDraft(); S.tab = v; S.msg = null; render(); }
  else if (a === "qh") { const i = app.querySelector('[name="heures"]'); i.value = String(v).replace(".", ","); }
  else if (a === "addLigne") { saveDraft(); syncLignes(); S.lignes.push({ designation: "", quantite: "1", unite: "u", prix: "" }); render(); }
  else if (a === "rmLigne") { saveDraft(); syncLignes(); S.lignes.splice(+v, 1); if (!S.lignes.length) S.lignes.push({ designation: "", quantite: "1", unite: "u", prix: "" }); for (const k of Object.keys(S.draft.rapport || {})) if (/^f[dqup]\d+$/.test(k)) delete S.draft.rapport[k]; render(); }
  else if (a === "clrSig") { S.sig = null; initSig(); }
  else if (a === "clearErr") { for (const x of S.pending.filter((x) => x.err)) await qDel(x.id); S.pending = mine(await qAll()); render(); }
});
function syncLignes() { const d = S.draft.rapport || {}; S.lignes = S.lignes.map((l, i) => ({ designation: d["fd" + i] ?? l.designation, quantite: d["fq" + i] ?? l.quantite, unite: d["fu" + i] ?? l.unite, prix: d["fp" + i] ?? l.prix })); }
app.addEventListener("change", async (e) => {
  const t = e.target, a = t.dataset?.a;
  if (a === "chRap") { const c = D().chantiers.find((x) => x.id === t.value); if (c) { const f = t.form; if (!f.client_nom.value) f.client_nom.value = c.client || ""; if (!f.adresse.value) f.adresse.value = c.ville || ""; } }
  else if (a === "photoRap") { try { for (const f of t.files) S.photos.push(await compress(f)); saveDraft(); render(); } catch (err) { say(err.message, 1); } }
  else if (a === "photo") {
    try {
      const f = t.form, ch = f.chantier_id.value, lg = f.legende.value;
      for (const file of t.files) await enqueue({ kind: "photo", payload: { client_uid: uid(), chantier_id: ch || "", legende: lg || "", data: await compress(file) } });
      say(`${t.files.length} photo(s) enregistrée(s).`); sync();
    } catch (err) { say("Photo impossible : " + err.message, 1); }
  }
});
window.addEventListener("online", () => { S.online = true; sync(); });
window.addEventListener("offline", () => { S.online = false; render(); });
setInterval(() => { if (navigator.onLine && !S.syncing) sync(); }, 45000);

/* ---------- Démarrage ---------- */
(async () => {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw-terrain.js").catch(() => {});
  try { const c = localStorage.getItem(CK); if (c) S.data = JSON.parse(c); } catch (e) { /* vide */ }
  try { S.pending = mine(await qAll()); } catch (e) { S.pending = []; }
  render();
  sync();
})();
})();
