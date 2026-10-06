/* Cœur de l'application : Supabase, données, routage, composants d'interface, notifications */

/* ===================== Supabase ===================== */
const CFG = window.PILOT_CONFIG || {};
const configured = CFG.url && CFG.anonKey && !/VOTRE/.test(CFG.url + CFG.anonKey);
const sb = configured && window.supabase ? window.supabase.createClient(CFG.url, CFG.anonKey) : null;
const q = async (p) => {
  const r = await p;
  if (r.error) throw r.error;
  return r.data;
};
const friendly = (e) => {
  const m = (e && e.message) || String(e);
  if (e && e.code === "23503") return "Action impossible : cet élément est encore utilisé (devis, factures, paiements…).";
  if (e && e.code === "23505") return "Ce numéro existe déjà.";
  return m;
};

let uid = null, // utilisateur connecté
  ownerId = null, // propriétaire des données (= uid, sauf accès comptable)
  email = "",
  ro = false; // lecture seule (accès comptable)

const emptyDb = () => ({
  clients: [], chantiers: [], devis: [], factures: [], paiements: [], depenses: [],
  notifs: [], partages: [], docsCompta: [], acces: [], ent: {},
});
let db = emptyDb();

const nz = (o, keys) => keys.forEach((k) => { if (k in o) o[k] = Number(o[k]); });

async function load() {
  const [cl, ch, dv, fa, pa, de, no, pt, dc, ac, en] = await Promise.all([
    q(sb.from("v_clients_stats").select("*").order("nom")),
    q(sb.from("v_chantiers").select("*").order("created_at", { ascending: false })),
    q(sb.from("v_devis").select("*").order("created_at", { ascending: false })),
    q(sb.from("v_factures").select("*").order("created_at", { ascending: false })),
    q(sb.from("v_paiements").select("*").order("date_paiement", { ascending: false })),
    q(sb.from("v_depenses").select("*").order("date_depense", { ascending: false })),
    q(sb.from("notifications").select("*").order("created_at", { ascending: false }).limit(60)),
    q(sb.from("partages").select("token,type,doc_id,vu_at,accepte_at,accepte_par,refuse_at,created_at").order("created_at", { ascending: false })),
    q(sb.from("documents_compta").select("*").order("created_at", { ascending: false })),
    q(sb.from("acces_comptable").select("*").order("created_at")),
    q(sb.from("entreprise").select("*").eq("user_id", ownerId || uid).maybeSingle()),
  ]);
  cl.forEach((c) => nz(c, ["nb_chantiers", "ca", "a_encaisser"]));
  ch.forEach((c) => nz(c, ["montant_marche"]));
  dv.forEach((d) => nz(d, ["montant_ht", "montant_tva", "montant_ttc"]));
  fa.forEach((f) => nz(f, ["montant_ht", "montant_tva", "montant_ttc", "paye", "reste"]));
  pa.forEach((p) => nz(p, ["montant"]));
  de.forEach((d) => nz(d, ["montant_ht", "montant_tva", "montant_ttc"]));
  db.clients = cl; db.chantiers = ch; db.devis = dv; db.factures = fa; db.paiements = pa; db.depenses = de;
  db.notifs = no; db.partages = pt; db.docsCompta = dc; db.acces = ac;
  db.ent = en || { nom: "", pdf_reglages: {}, tva_regime: "encaissements", tresorerie_initiale: 0, delai_paiement_jours: 30 };
  db.ent.tresorerie_initiale = Number(db.ent.tresorerie_initiale || 0);
  db.ent.pdf_reglages ||= {};
}

/* ===================== Accès rapides aux données ===================== */
const byId = (arr, id) => arr.find((x) => x.id === id);
const clientOf = (id) => byId(db.clients, id);
const emises = () => db.factures.filter((f) => f.statut !== "Brouillon" && f.statut !== "Annulée");
const ouvertes = () => db.factures.filter((f) => f.statut === "Envoyée" || f.statut === "Partiellement payée");
const enRetard = () => ouvertes().filter((f) => f.statut_affiche === "En retard");
const devisFacture = (id) => db.factures.find((f) => f.devis_id === id && f.statut !== "Annulée");
const aFacturer = () => db.devis.filter((d) => d.statut === "Accepté" && !devisFacture(d.id));
const depensesAPayer = () => db.depenses.filter((d) => d.statut === "À payer");
const partageOf = (id) => db.partages.find((p) => p.doc_id === id);
const encaisseTotal = () => sum(db.paiements, (p) => p.montant);
const decaisseTotal = () => sum(db.depenses.filter((d) => d.statut === "Payée"), (d) => d.montant_ttc);
const tresorerie = () => db.ent.tresorerie_initiale + encaisseTotal() - decaisseTotal();

/* ===================== Icônes ===================== */
const ic = {
  home: "M3 11l9-7 9 7 M5 10v10h14V10 M10 20v-6h4v6",
  chantiers: "M3 8h18v12H3z M8 8V4h8v4 M3 13h18",
  clients: "M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7z M2.5 20c0-3.5 3-6 6.5-6s6.5 2.5 6.5 6 M16 4.5a3.5 3.5 0 010 6.5 M18 14.5c2 .8 3.5 2.6 3.5 5.5",
  devis: "M6 3h9l4 4v14H6z M9 13h7 M9 17h7",
  factures: "M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z M9 8h6 M9 12h6",
  paiements: "M3 6h18v12H3z M3 10h18 M7 15h3",
  compta: "M5 3h14v18H5z M8 7h8 M8 11h3 M13 11h3 M8 15h3 M13 15h3",
  analyses: "M4 20v-9 M10 20V4 M16 20v-7 M22 20H2",
  params: "M4 7h10 M18 7h2 M4 17h2 M10 17h10 M14 5v4 M6 15v4",
  bell: "M6 16v-5a6 6 0 0112 0v5l2 2H4z M10 21h4",
  moon: "M20 14A8 8 0 1110 4a6.5 6.5 0 0010 10z",
  out: "M9 4H5v16h4 M16 8l4 4-4 4 M20 12H9",
  ar: "M5 12h14 M13 6l6 6-6 6",
  plus: "M12 5v14 M5 12h14",
  x: "M6 6l12 12 M18 6L6 18",
  file: "M6 3h9l4 4v14H6z",
};
const svg = (p, c = "") =>
  `<svg class="${c}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${p}"/></svg>`;

const NAV = [
  ["home", "Accueil", null],
  ["chantiers", "Chantiers", "Activité"],
  ["clients", "Clients", null],
  ["devis", "Devis", null],
  ["factures", "Factures", null],
  ["paiements", "Paiements", "Finances"],
  ["compta", "Comptabilité", null],
  ["analyses", "Analyses", "Pilotage"],
];

/* ===================== Routage (#/page/id) ===================== */
const V = {}; // vues : V.nom({arg, qs}) -> html | { html, after }
const ST = { tab: {}, period: "12", year: new Date().getFullYear(), editing: false };
const parseHash = () => {
  const [p, qs] = location.hash.replace(/^#\/?/, "").split("?");
  const seg = p.split("/").filter(Boolean);
  return { name: seg[0] || "home", arg: seg[1] || null, qs: new URLSearchParams(qs || "") };
};
const go = (path) => {
  const h = "#/" + String(path).replace(/^#?\/?/, "");
  if (location.hash === h) render();
  else location.hash = h;
};
let rid = 0,
  lastKey = "";
async function render(keepScroll = false) {
  if (!uid) return;
  const my = ++rid;
  const r = parseHash();
  if (!V[r.name]) r.name = "home";
  $$(".nav").forEach((n) => n.setAttribute("aria-current", n.dataset.go === r.name ? "page" : "false"));
  ST.editing = false;
  let out;
  try {
    out = await V[r.name](r);
  } catch (e) {
    console.error(e);
    out = `<div class="empty"><h2>Une erreur est survenue</h2><p>${esc(friendly(e))}</p><button class="btn" data-go="home">Retour à l'accueil</button></div>`;
  }
  if (my !== rid) return;
  $("#v").innerHTML = out.html ?? out;
  const key = location.hash;
  if (!keepScroll && key !== lastKey) window.scrollTo(0, 0);
  lastKey = key;
  const s = $("#q");
  if (s) s.oninput = () => {
    const t = s.value.toLowerCase().trim();
    $$("tbody tr[data-t]").forEach((r) => (r.hidden = !r.dataset.t.includes(t)));
  };
  out.after?.();
}
// Recharge les données puis redessine (sans perdre le défilement)
async function refresh() {
  await load();
  renderBell();
  await render(true);
}

/* ===================== Composants ===================== */
const CHIP = {
  "En cours": "ok", Accepté: "ok", Payée: "ok", Terminé: "ok",
  "À surveiller": "wn", Envoyé: "wn", Envoyée: "wn", "Partiellement payée": "wn", "À payer": "wn",
  "À facturer": "ac", "En retard": "dn", Refusé: "dn",
};
const chip = (s) => `<span class="chip ${CHIP[s] || "n"}">${esc(s)}</span>`;
const page = (title, sub, actions, body, crumb = "") =>
  `${crumb}<div class="ph"><div><h1>${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ""}</div><div class="pa">${actions || ""}</div></div>${body}`;
const strip = (items) =>
  `<div class="strip">${items.map(([l, v, s, c = ""]) => `<div class="st"><small>${l}</small><b class="num ${c}">${v}</b><span>${s || ""}</span></div>`).join("")}</div>`;
const card = (title, body, right = "", cls = "") =>
  `<section class="card ${cls}">${title ? `<div class="ch"><h2>${title}</h2>${right}</div>` : ""}${body}</section>`;
const crumbs = (...p) => `<nav class="bc">${p.map(([l, h]) => (h ? `<a href="#/${h}">${esc(l)}</a>` : `<span>${esc(l)}</span>`)).join(`<i>/</i>`)}</nav>`;
const tbl = (cols, rows, empty = "Rien à afficher pour le moment.") =>
  `<div class="tw"><table><thead><tr>${cols.map((c) => `<th${c.r ? ' class="r"' : ""}>${c.h ?? c}</th>`).join("")}</tr></thead><tbody>${
    rows.length
      ? rows.map((r) => `<tr${r.go ? ` data-go="${r.go}" class="lnk"` : ""} data-t="${esc((r.t || "").toLowerCase())}">${r.c.map((x, i) => `<td${cols[i]?.r ? ' class="r"' : ""}>${x}</td>`).join("")}</tr>`).join("")
      : `<tr><td colspan="${cols.length}" class="emp">${empty}</td></tr>`
  }</tbody></table></div>`;
const searchBar = (ph, meta) =>
  `<div class="sr"><input id="q" type="search" placeholder="${ph}" aria-label="${ph}"><span class="cnt">${meta || ""}</span></div>`;
const tabs = (key, items, cur) =>
  `<div class="tabs" role="tablist">${items.map(([k, l]) => `<button role="tab" aria-selected="${cur === k}" data-act="tab" data-id="${key}" data-arg="${k}">${l}</button>`).join("")}</div>`;
const btn = (label, act, id = "", arg = "", cls = "") =>
  `<button class="btn ${cls}" data-act="${act}" data-id="${esc(id)}" data-arg="${esc(arg)}">${label}</button>`;
const parseNum = (v) => {
  const n = parseFloat(String(v ?? "").replace(/\s/g, "").replace(",", "."));
  return isFinite(n) ? n : 0;
};

// Champ de formulaire. f = { k, l, t, v, o:[texte|{v,l}], r:0 (facultatif), ph, hint, cls }
const fld = (f) => {
  const opt = (o) => {
    const v = typeof o === "object" ? o.v : o, l = typeof o === "object" ? o.l : o;
    return `<option value="${esc(v)}"${String(v) === String(f.v ?? "") ? " selected" : ""}>${esc(l)}</option>`;
  };
  const req = f.r === 0 ? "" : " required";
  const attrs = `name="${f.k}" id="f_${f.k}"${f.ph ? ` placeholder="${esc(f.ph)}"` : ""}${f.dis ? " disabled" : ""}`;
  const input =
    f.t === "select" ? `<select ${attrs}>${f.o.map(opt).join("")}</select>`
    : f.t === "textarea" ? `<textarea ${attrs} rows="${f.rows || 3}">${esc(f.v ?? "")}</textarea>`
    : f.t === "number" ? `<input ${attrs} type="text" inputmode="decimal"${req} value="${esc(f.v ?? "")}">`
    : `<input ${attrs} type="${f.t || "text"}"${req} value="${esc(f.v ?? "")}">`;
  return `<label class="fl ${f.cls || ""}"><span>${f.l}${f.r === 0 ? "" : ' <em>*</em>'}</span>${input}${f.hint ? `<small>${f.hint}</small>` : ""}</label>`;
};

// Fenêtre modale. opts = { wide, submit, cancel, onSubmit(values, form), onMount(el, api) }
function modal(title, body, opts = {}) {
  const m = document.createElement("div");
  m.className = "md";
  m.innerHTML = `<form class="mc${opts.wide ? " wide" : ""}" novalidate><div class="mh"><h2>${title}</h2><button type="button" class="ib" data-x aria-label="Fermer">${svg(ic.x)}</button></div><div class="mb">${body}</div><p class="er" role="alert"></p>${
    opts.submit === false ? "" : `<div class="fa"><button type="button" class="btn o" data-x>${opts.cancel || "Annuler"}</button><button class="btn" type="submit">${opts.submit || "Enregistrer"}</button></div>`
  }</form>`;
  document.body.appendChild(m);
  const form = $("form", m);
  const api = {
    el: m, form,
    close: () => { m.remove(); document.removeEventListener("keydown", esck); },
    error: (t) => { $(".er", m).textContent = t || ""; },
  };
  const esck = (e) => { if (e.key === "Escape") api.close(); };
  document.addEventListener("keydown", esck);
  $$("[data-x]", m).forEach((b) => (b.onclick = api.close));
  m.addEventListener("mousedown", (e) => { if (e.target === m) api.close(); });
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!opts.onSubmit) return;
    if (!form.reportValidity()) return;
    const b = $('button[type="submit"]', form);
    b.disabled = true;
    api.error("");
    try {
      await opts.onSubmit(Object.fromEntries(new FormData(form)), api);
    } catch (err) {
      api.error(friendly(err));
    }
    b.disabled = false;
  };
  opts.onMount?.(m, api);
  const first = $("input:not([type=hidden]),select,textarea", m);
  if (first && !opts.noFocus) first.focus();
  return api;
}

function toast(msg, type = "") {
  let box = $("#toasts");
  if (!box) { box = document.createElement("div"); box.id = "toasts"; document.body.appendChild(box); }
  const t = document.createElement("div");
  t.className = "toast " + type;
  t.innerHTML = msg;
  box.appendChild(t);
  setTimeout(() => t.remove(), type === "dn" ? 7000 : 4500);
}
const guard = () => {
  if (ro) { toast("Accès en lecture seule.", "dn"); return false; }
  return true;
};

/* ===================== Notifications ===================== */
const nonLues = () => db.notifs.filter((n) => !n.lu);
function renderBell() {
  const n = nonLues().length;
  const b = $("#bdg");
  if (b) { b.textContent = n > 9 ? "9+" : n; b.hidden = !n; }
  const pop = $("#notifpop");
  if (!pop || pop.hidden) return;
  pop.innerHTML = notifPanel();
}
const ago = (iso) => {
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  return m < 1 ? "à l'instant" : m < 60 ? `il y a ${m} min` : m < 1440 ? `il y a ${Math.round(m / 60)} h` : `il y a ${Math.round(m / 1440)} j`;
};
const NOTIF_ICON = { paiement: "paiements", devis_accepte: "devis", devis_refuse: "devis", consultation: "file" };
function notifPanel() {
  const l = db.notifs.slice(0, 15);
  return `<div class="pop-h"><b>Notifications</b>${nonLues().length ? `<button class="lk" data-act="notifAll">Tout marquer comme lu</button>` : ""}</div>${
    l.length
      ? l.map((n) => `<button class="nt ${n.lu ? "" : "new"}" data-act="notif" data-id="${n.id}">${svg(ic[NOTIF_ICON[n.type]] || ic.bell)}<span><b>${esc(n.titre)}</b><small>${esc(n.message || "")}</small><em>${ago(n.created_at)}</em></span></button>`).join("")
      : `<p class="emp">Aucune notification. Vous serez prévenu ici quand un client ouvre ou accepte un devis, ou qu'un paiement arrive.</p>`
  }`;
}
let channel = null;
function subscribeNotifs() {
  if (!sb || channel || ro) return;
  try {
    channel = sb
      .channel("notifs-" + uid)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${uid}` }, async (p) => {
        toast(`<b>${esc(p.new.titre)}</b><br>${esc(p.new.message || "")}`, "ok");
        if (ST.editing) { await load(); renderBell(); } else await refresh();
      })
      .subscribe();
  } catch (e) { console.warn("Temps réel indisponible", e); }
  // filet de sécurité si le temps réel est coupé : vérification toutes les 90 s
  setInterval(async () => {
    if (document.hidden || !uid) return;
    const before = db.notifs.length ? db.notifs[0].id : null;
    try {
      const n = await q(sb.from("notifications").select("*").order("created_at", { ascending: false }).limit(60));
      if (n.length && n[0].id !== before) { await (ST.editing ? load() : refresh()); renderBell(); toast(`<b>${esc(n[0].titre)}</b>`, "ok"); }
    } catch (e) {}
  }, 90000);
}

/* ===================== Connexion ===================== */
const authBox = (html) => {
  let a = $("#au");
  if (!a) { a = document.createElement("div"); a.id = "au"; a.className = "au"; document.body.appendChild(a); }
  a.innerHTML = html;
  return a;
};
function showSetup() {
  authBox(`<div class="box"><div class="logo"><i>P</i>Pilot</div><h2>Configuration requise</h2><p class="sub">Ouvrez <b>config.js</b> et collez l'URL de votre projet Supabase ainsi que la clé « anon / publishable » (Project Settings → API). Rechargez ensuite cette page.</p></div>`);
}
function showLogin(msg = "") {
  const a = authBox(`<form class="box"><div class="logo"><i>P</i>Pilot</div><h2>Connexion</h2><label class="fl"><span>Email</span><input name="e" type="email" autocomplete="username" required></label><label class="fl"><span>Mot de passe</span><input name="p" type="password" autocomplete="current-password" minlength="6" required></label><p class="er" role="alert">${esc(msg)}</p><div class="row2"><button class="btn" data-m="in">Se connecter</button><button type="button" class="btn o" data-m="up">Créer le compte</button></div></form>`);
  const f = $("form", a), er = $(".er", a);
  const run = async (mode) => {
    if (!f.reportValidity()) return;
    er.textContent = "";
    const c = { email: f.e.value, password: f.p.value };
    const { data, error } = mode === "up" ? await sb.auth.signUp(c) : await sb.auth.signInWithPassword(c);
    if (error) er.textContent = error.message;
    else if (mode === "up" && !data.session) er.textContent = "Compte créé. Confirmez votre email puis connectez-vous.";
  };
  f.onsubmit = (e) => { e.preventDefault(); run("in"); };
  $('[data-m="up"]', f).onclick = () => run("up");
}
async function start(session) {
  uid = session.user.id;
  email = session.user.email || "";
  $("#av").textContent = email.slice(0, 2).toUpperCase();
  authBox(`<div class="box"><div class="logo"><i>P</i>Pilot</div><p class="sub">Chargement…</p></div>`);
  try {
    // Accès comptable ? (invité sur le compte d'un autre, sans compte entreprise propre)
    ownerId = uid;
    ro = false;
    const mine = await q(sb.from("entreprise").select("user_id").eq("user_id", uid).maybeSingle());
    if (!mine) {
      const inv = await q(sb.from("acces_comptable").select("owner_id,email"));
      const o = inv.find((i) => i.owner_id !== uid);
      if (o) { ownerId = o.owner_id; ro = true; }
    }
    document.body.classList.toggle("ro", ro);
    $("#robadge").hidden = !ro;
    if (!ro) { try { await sb.rpc("generer_alertes"); } catch (e) { console.warn("alertes", e); } }
    await load();
    $("#au")?.remove();
    renderBell();
    if (!location.hash) location.hash = "#/";
    await render();
    subscribeNotifs();
  } catch (err) {
    console.error(err);
    authBox(`<div class="box"><div class="logo"><i>P</i>Pilot</div><h2>Erreur de chargement</h2><p class="er">${esc(friendly(err))}</p><p class="sub">Avez-vous exécuté <b>supabase/schema.sql</b> (version 2) dans le SQL Editor ?</p><button class="btn o" onclick="location.reload()">Réessayer</button></div>`);
  }
}
