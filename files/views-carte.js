/* Carte interactive des chantiers (v18).
   Chaque chantier est un repère qui montre le type de travaux (badge) et l'avancement : une maison se construit
   au fur et à mesure (partie bâtie en couleur, partie restante en pointillés bleus, grue tant que ce n'est pas fini).
   Carte : Leaflet + OpenStreetMap. Adresses -> GPS : API Adresse (data.gouv.fr), cache dans chantier_geo. */

Object.assign(ic, { carte: "M12 21s-7-6.2-7-11a7 7 0 0114 0c0 4.8-7 11-7 11z M12 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z", locate: "M12 3v3 M12 18v3 M3 12h3 M18 12h3 M12 16a4 4 0 100-8 4 4 0 000 8z" });

/* ---------- Types de travaux ---------- */
const METIERS = {
  gros_oeuvre: { l: "Gros œuvre, maçonnerie", c: "#b5651d", wall: "#d2a679", roof: "#8d4b3a", re: /ma[çc]on|extension|dalle|fondation|\bmur|terrass|gros|construction|garage|piscine|b[ée]ton|agrandissement|surélév/i, i: "M3 6h18v12H3z M3 12h18 M9 6v6 M15 12v6" },
  toiture: { l: "Toiture, charpente", c: "#b5472f", wall: "#ebe4d6", roof: "#b5472f", re: /toit|couvertur|zingu|charpente|tuile|ardoise|gouttière|gouttiere|velux/i, i: "M3 12l9-8 9 8 M6 11v9h12v-9" },
  plomberie: { l: "Plomberie, sanitaire", c: "#1d6fb8", wall: "#dcebf7", roof: "#5b6b7b", re: /plomb|sanitaire|salle de bain|sdb|chauff|douche|robinet|wc|baignoire|pompe à chaleur|pac\b/i, i: "M12 3c4 5 6 8 6 11a6 6 0 01-12 0c0-3 2-6 6-11z" },
  electricite: { l: "Électricité", c: "#c99700", wall: "#f3ecc9", roof: "#5b6b7b", re: /[ée]lectri|tableau|c[âa]blage|domotique|prise|éclairage|eclairage|vmc/i, i: "M13 2L4 14h7l-1 8 9-12h-7z" },
  peinture: { l: "Peinture, finitions", c: "#2f9e6e", wall: "#96cfae", roof: "#6b7b8b", re: /peintur|enduit|ravalement|fa[çc]ade|papier peint|finition|lasure/i, i: "M5 4h12v5H5z M17 6h3v5H11v4 M10 15h2v6h-2z" },
  carrelage: { l: "Carrelage, sols", c: "#6b5bb5", wall: "#f2f2f2", roof: "#6b7b8b", re: /carrel|fa[ïi]ence|parquet|\bsols?\b|rev[êe]tement|chape/i, i: "M3 3h18v18H3z M12 3v18 M3 12h18" },
  menuiserie: { l: "Menuiserie, cuisine", c: "#8a5a2b", wall: "#e9d6b9", roof: "#6d4c2f", re: /menuis|fen[êe]tre|porte|volet|escalier|cuisine|placard|dressing|baie|pergola|terrasse bois/i, i: "M6 3h12v18H6z M15 12h.01 M6 9h12" },
  isolation: { l: "Isolation, plâtrerie", c: "#d97706", wall: "#f6dcb0", roof: "#7a6a58", re: /isol|combles|laine|pl[âa]tre|cloison|placo|doublage/i, i: "M3 8c3-3 5 3 9 0s6 3 9 0 M3 15c3-3 5 3 9 0s6 3 9 0" },
  demolition: { l: "Démolition, dépose", c: "#555f6b", wall: "#b9bec4", roof: "#6b7078", re: /d[ée]mol|d[ée]pose|curage|d[ée]construction/i, i: "M14 4l6 6-3 3-6-6z M13 8L4 17l3 3 9-9" },
  renovation: { l: "Rénovation générale", c: "#2c5aa0", wall: "#eadfce", roof: "#7a5a4a", re: /^$/, i: "M4 16a8 8 0 0116 0z M2 16h20v3H2z M12 6v5" },
};
const METIER_KEYS = Object.keys(METIERS);
const metierOf = (c) => {
  const g = db.geo?.[c.id]?.metier;
  if (g && METIERS[g]) return g;
  const t = `${c.nom || ""} ${c.notes || ""}`;
  return METIER_KEYS.find((k) => METIERS[k].re.test(t) && k !== "renovation") || "renovation";
};
const avOf = (c) => (c.statut === "Terminé" ? 100 : Math.max(0, Math.min(100, Math.round(Number(c.avancement) || 0))));

/* ---------- Données (position GPS, type de travaux) ---------- */
const GEO_LS = "pilot-geo";
async function loadV18() {
  db.v18 = false; db.geo = {};
  let ls = {}; try { ls = JSON.parse(localStorage.getItem(GEO_LS) || "{}"); } catch (e) {}
  try {
    (await q(sb.from("chantier_geo").select("*"))).forEach((g) => (db.geo[g.chantier_id] = g));
    db.v18 = true;
  } catch (e) { db.v18 = false; Object.assign(db.geo, ls); }
}
async function geoSave(id, patch) {
  const row = { ...(db.geo[id] || {}), chantier_id: id, ...patch };
  db.geo[id] = row;
  if (db.v18) {
    try { await q(sb.from("chantier_geo").upsert({ chantier_id: id, lat: row.lat ?? null, lng: row.lng ?? null, adresse_src: row.adresse_src ?? null, metier: row.metier ?? null, updated_at: new Date().toISOString() }, { onConflict: "chantier_id" })); } catch (e) { console.warn("chantier_geo", e); }
  } else { try { localStorage.setItem(GEO_LS, JSON.stringify(db.geo)); } catch (e) {} }
}
const geoQuery = (c) => [c.adresse, c.ville].filter(Boolean).join(" ").trim();
async function geoLookup(query) {
  try {
    const j = await (await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(query)}&limit=1`)).json();
    const f = j.features?.[0];
    if (f) return { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] };
  } catch (e) { /* on tente le service suivant */ }
  try {
    const j = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query.replace(/\d{5}/, "").trim())}&count=1&language=fr&countryCode=FR`)).json();
    if (j.results?.[0]) return { lat: j.results[0].latitude, lng: j.results[0].longitude };
  } catch (e) { /* introuvable */ }
  return null;
}
const needsGeo = (c) => { const q0 = geoQuery(c), g = db.geo[c.id]; return q0 && (!g || g.lat == null || (g.adresse_src !== "manuel" && g.adresse_src !== q0)); };

/* ---------- Dessin : la maison qui se construit ---------- */
// p = avancement 0-100. La maison complète est dessinée puis « découpée » à la hauteur déjà construite ;
// au-dessus : plan en pointillés. Échafaudage en cours de route, grue tant que ce n'est pas fini, drapeau à 100 %.
let _sid = 0;
function sceneSvg(p, mk, { sky = false, w = "100%", h = "100%" } = {}) {
  const M = METIERS[mk] || METIERS.renovation, id = "s" + ++_sid, top = 14, ground = 88, y = ground - (ground - top) * (p / 100);
  const wall = M.wall, roof = M.roof;
  const deco = {
    gros_oeuvre: [...Array(8)].map((_, i) => `<path d="M28 ${46 + i * 6}h64" stroke="#a9794a" stroke-width=".9"/>`).join("") + [...Array(8)].map((_, i) => `<path d="M${i % 2 ? 40 : 34} ${46 + i * 6}v6 M${i % 2 ? 58 : 52} ${46 + i * 6}v6 M${i % 2 ? 76 : 70} ${46 + i * 6}v6 M${i % 2 ? 90 : 88} ${46 + i * 6}v6" stroke="#a9794a" stroke-width=".9"/>`).join(""),
    toiture: [...Array(5)].map((_, i) => `<path d="M${24 + i * 4} ${40 - i * 5}h${72 - i * 8}" stroke="#7d2f1d" stroke-width="1"/>`).join(""),
    plomberie: `<path d="M34 80V60h22V50h28" stroke="#1d6fb8" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M84 56c3 4 4 6 4 8a4 4 0 01-8 0c0-2 1-4 4-8z" fill="#1d6fb8"/>`,
    electricite: `<path d="M64 46l-10 16h8l-3 14 14-19h-9z" fill="#f2b705" stroke="#a87c00" stroke-width="1"/>`,
    peinture: `<rect x="28" y="60" width="64" height="8" fill="#6fb88f"/><rect x="40" y="46" width="30" height="7" rx="2" fill="#e5484d"/><path d="M70 49.5h8v8" stroke="#555" stroke-width="1.5" fill="none"/>`,
    carrelage: [...Array(8)].map((_, i) => [...Array(4)].map((__, j) => ((i + j) % 2 ? `<rect x="${28 + i * 8}" y="${58 + j * 8}" width="8" height="8" fill="#c9cdd6"/>` : "")).join("")).join(""),
    menuiserie: `<rect x="34" y="54" width="14" height="14" fill="#8a5a2b"/><rect x="76" y="54" width="14" height="14" fill="#8a5a2b"/>`,
    isolation: `<path d="M30 52c4-3 6 3 10 0s6 3 10 0 6 3 10 0 6 3 10 0 6 3 10 0 M30 62c4-3 6 3 10 0s6 3 10 0 6 3 10 0 6 3 10 0 6 3 10 0" stroke="#e0a026" stroke-width="2" fill="none"/>`,
    demolition: `<path d="M30 46l10 12-8 6 12 10-6 8 M92 50l-10 14 8 6-10 10" stroke="#555f6b" stroke-width="1.6" fill="none"/>`,
    renovation: "",
  }[mk] || "";
  const house = `<rect x="28" y="42" width="64" height="46" fill="${wall}"/><polygon points="20,44 60,14 100,44" fill="${roof}"/>${deco}
    <rect x="54" y="64" width="14" height="24" fill="#7a5230"/><rect x="36" y="52" width="12" height="12" fill="#bfe3f5" stroke="#fff" stroke-width="1.5"/><rect x="74" y="52" width="12" height="12" fill="#bfe3f5" stroke="#fff" stroke-width="1.5"/>`;
  const plan = `<g fill="none" stroke="#7aa2c8" stroke-width="1.4" stroke-dasharray="3 3"><rect x="28" y="42" width="64" height="46"/><polygon points="20,44 60,14 100,44"/><rect x="54" y="64" width="14" height="24"/><rect x="36" y="52" width="12" height="12"/><rect x="74" y="52" width="12" height="12"/></g>`;
  const scaff = p > 4 && p < 100 ? `<g stroke="#e0a526" stroke-width="1.6">${[22, 98].map((x) => `<path d="M${x} ${ground}V${Math.min(y, ground - 8)}"/>`).join("")}${[...Array(6)].map((_, i) => { const yy = ground - 12 - i * 12; return yy > y ? `<path d="M22 ${yy}h8 M90 ${yy}h8"/>` : ""; }).join("")}</g>` : "";
  const crane = p < 100 ? `<g stroke="#f0b429" stroke-width="2.2" fill="none"><path d="M110 ${ground}V8"/><path d="M110 8H52"/><path d="M110 8l-8 8 M110 8l8 5"/></g><path d="M58 8V30" stroke="#555" stroke-width="1"/><rect x="54" y="30" width="8" height="5" fill="#f0b429"/>` : `<path d="M60 14V2" stroke="#555" stroke-width="1.4"/><path d="M60 2h14l-3 4 3 4H60z" fill="#e5484d"/>`;
  const start = p === 0 ? `<rect x="30" y="64" width="26" height="14" rx="1.5" fill="#fff" stroke="#e0a526" stroke-width="2"/><path d="M34 71h18" stroke="#e0a526" stroke-width="2"/><path d="M26 80v8 M60 80v8" stroke="#8a6d4b" stroke-width="2"/><path d="M70 88l8-9 8 9z" fill="#d9b779"/>` : "";
  return `<svg viewBox="0 0 120 100" width="${w}" height="${h}" preserveAspectRatio="xMidYMax meet" role="img" aria-label="Avancement ${p} %">
    <defs><clipPath id="${id}"><rect x="0" y="${y.toFixed(1)}" width="120" height="${(100 - y).toFixed(1)}"/></clipPath></defs>
    ${sky ? `<rect width="120" height="100" fill="#d9eefa"/><circle cx="18" cy="16" r="7" fill="#ffe08a"/><ellipse cx="86" cy="22" rx="14" ry="4.5" fill="#fff" opacity=".85"/>` : ""}
    <rect x="0" y="88" width="120" height="12" fill="#8a6d4b"/><rect x="0" y="86" width="120" height="3.5" fill="#6aa84f"/>
    ${p < 100 ? plan : ""}${p > 0 ? `<rect x="22" y="86" width="76" height="4" fill="#6b7078"/>` : ""}
    <g clip-path="url(#${id})">${house}</g>${scaff}${crane}${start}</svg>`;
}
const iconSvg = (mk, size = 14) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${(METIERS[mk] || METIERS.renovation).i}"/></svg>`;

/* ---------- État et couleurs ---------- */
const CM = { map: null, markers: {}, sel: null, filt: { st: new Set(["En cours", "À surveiller", "À facturer"]), mk: "", q: "" }, placing: null, geocoding: false };
const cmState = (c) => {
  const d = chDashData(c), done = c.statut === "Terminé";
  return { d, col: done ? "#1a7f4b" : d.rank >= 3 ? "#b42318" : d.rank === 2 ? "#c27803" : "#2c5aa0", lbl: done ? "Terminé" : d.rank >= 3 ? "Alerte" : d.rank === 2 ? "À surveiller" : "Dans les temps" };
};
function markerHtml(c, sel) {
  const p = avOf(c), mk = metierOf(c), M = METIERS[mk], { col } = cmState(c), C = 2 * Math.PI * 29;
  return `<div class="cm${sel ? " sel" : ""}" title="${esc(c.nom)}">
    <div class="cm-disc"><svg class="cm-ring" viewBox="0 0 64 64"><circle cx="32" cy="32" r="29" fill="none" stroke="#dde3ea" stroke-width="5"/><circle cx="32" cy="32" r="29" fill="none" stroke="${col}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${((C * p) / 100).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 32 32)"/></svg>
    <div class="cm-in">${sceneSvg(p, mk, { sky: true })}</div></div>
    <span class="cm-badge" style="background:${M.c}">${iconSvg(mk, 13)}</span><span class="cm-pct" style="background:${col}">${p} %</span><i class="cm-tail" style="border-top-color:${col}"></i></div>`;
}

/* ---------- Page ---------- */
const cmVisible = () => db.chantiers.filter((c) => CM.filt.st.has(c.statut) && (!CM.filt.mk || metierOf(c) === CM.filt.mk) && (!CM.filt.q || `${c.nom} ${c.client_nom || ""} ${c.ville || ""} ${c.adresse || ""}`.toLowerCase().includes(CM.filt.q)));
function cmListHtml() {
  const L = cmVisible().sort((a, b) => cmState(b).d.rank - cmState(a).d.rank || avOf(a) - avOf(b));
  if (!L.length) return `<p class="mut" style="padding:14px">Aucun chantier ne correspond aux filtres.</p>`;
  return L.map((c) => { const p = avOf(c), mk = metierOf(c), { col, lbl } = cmState(c), g = db.geo[c.id], located = g && g.lat != null;
    return `<button type="button" class="cl${CM.sel === c.id ? " on" : ""}" data-act="cmSel" data-id="${c.id}">
      <span class="cl-sc">${sceneSvg(p, mk, { sky: true })}</span>
      <span class="cl-b"><b>${esc(c.nom)}</b><small>${esc(c.client_nom || "")}${c.ville ? " · " + esc(c.ville) : ""}</small>
        <span class="cl-bar"><i style="width:${p}%;background:${col}"></i></span>
        <small><span style="color:${col};font-weight:700">${p} %</span> · ${esc(METIERS[mk].l)}${located ? "" : ` · <em>${geoQuery(c) ? "localisation…" : "adresse manquante"}</em>`}</small></span></button>`; }).join("");
}
V.carte = (r) => {
  const open = r.qs.get("c"); if (open) CM.sel = open;
  const all = db.chantiers, act = all.filter((c) => c.statut !== "Terminé"), al = act.filter((c) => cmState(c).d.rank >= 2).length;
  const nl = all.filter((c) => !(db.geo[c.id]?.lat != null)).length;
  const chips = CH_STATUTS.map((s) => `<button type="button" class="fchip" data-act="cmSt" data-arg="${s}" aria-pressed="${CM.filt.st.has(s)}">${s}</button>`).join("");
  const html = page("Carte des chantiers", "Tous vos chantiers sur une carte : type de travaux et avancement d'un coup d'œil.",
    `<button class="btn o" data-act="cmFit">${svg(ic.locate)} Tout voir</button>`,
    strip([["Chantiers en cours", String(act.length), `${all.length} au total`], ["À surveiller", String(al), al ? "budget, heures ou marge" : "tout est dans les prévisions", al ? "dn" : ""], ["Avancement moyen", act.length ? Math.round(sum(act, avOf) / act.length) + " %" : "-", "chantiers en cours"], ["Non localisés", String(nl), nl ? "adresse à compléter" : "tous placés"]]) +
    `<div class="cmap"><div class="cm-side"><div class="cm-f"><input type="search" id="cmq" placeholder="Chercher un chantier, client, ville…" value="${esc(CM.filt.q)}" aria-label="Rechercher">
        <select id="cmm" aria-label="Type de travaux"><option value="">Tous les types de travaux</option>${METIER_KEYS.map((k) => `<option value="${k}"${CM.filt.mk === k ? " selected" : ""}>${METIERS[k].l}</option>`).join("")}</select>
        <div class="fchips">${chips}</div></div><div class="cm-list" id="cml">${cmListHtml()}</div></div>
      <div class="cm-main"><div id="cmel" class="cm-el"></div><div class="cm-legend" aria-label="Légende"><b>Légende</b>
        <span><i style="background:#2c5aa0"></i>Dans les temps</span><span><i style="background:#c27803"></i>À surveiller</span><span><i style="background:#b42318"></i>Alerte</span><span><i style="background:#1a7f4b"></i>Terminé</span>
        <small>L'anneau = % d'avancement ; la maison se construit ; la pastille = type de travaux.</small></div>
        <div class="cm-detail" id="cmd" hidden></div><div class="cm-hint" id="cmh" hidden></div></div></div>`);
  return { html, after: cmInit };
};

// Feuille de style Leaflet : on essaie vendor/leaflet/, la racine, puis le CDN, et on vérifie qu'elle s'applique vraiment
// (un hébergeur qui renvoie la page d'accueil pour un fichier absent donnerait sinon une carte cassée : tuiles en vrac).
async function cmCss() {
  const ok = () => { const p = document.createElement("div"); p.className = "leaflet-pane"; p.style.cssText = "visibility:hidden"; document.body.appendChild(p); const r = getComputedStyle(p).position === "absolute"; p.remove(); return r; };
  if (ok()) return;
  for (const url of ["vendor/leaflet/leaflet.css", "leaflet.css", "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css"]) {
    const l = document.createElement("link"); l.rel = "stylesheet"; l.href = url; l.className = "leafcss";
    await new Promise((res) => { l.onload = res; l.onerror = res; document.head.appendChild(l); setTimeout(res, 4000); });
    if (ok()) return;
    l.remove();
  }
}
async function cmInit() {
  const el = $("#cmel");
  if (!el) return;
  try {
    await cmCss();
    try { await loadScript("vendor/leaflet/leaflet.js"); } catch (e) { await loadScript("leaflet.js"); }
    if (!window.L?.map) { delete _scripts["vendor/leaflet/leaflet.js"]; await loadScript("leaflet.js"); }
  } catch (e) { el.innerHTML = `<div class="empty"><h2>Carte indisponible</h2><p>${esc(friendly(e))}</p></div>`; return; }
  if (CM.map) { try { CM.map.remove(); } catch (e) {} }
  CM.markers = {}; CM.placing = null;
  const map = (CM.map = L.map(el, { zoomControl: true, attributionControl: true, worldCopyJump: true }).setView([46.6, 2.4], 6));
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
  map.on("click", async (e) => {
    if (!CM.placing) return;
    const id = CM.placing; CM.placing = null; $("#cmh").hidden = true; el.classList.remove("placing");
    await geoSave(id, { lat: e.latlng.lat, lng: e.latlng.lng, adresse_src: "manuel" });
    cmDraw(); cmSelect(id, true); toast("Position du chantier enregistrée.", "ok");
  });
  $("#cmq").oninput = (e) => { CM.filt.q = e.target.value.toLowerCase().trim(); cmDraw(); };
  $("#cmm").onchange = (e) => { CM.filt.mk = e.target.value; cmDraw(); };
  cmDraw(true);
  if (CM.sel && byId(db.chantiers, CM.sel)) cmSelect(CM.sel, true); else CM.sel = null;
  cmGeocodeMissing();
  setTimeout(() => map.invalidateSize(), 200);
  try { new ResizeObserver(() => { if (CM.map === map) map.invalidateSize(); }).observe(el); } catch (e) {}
}
function cmDraw(fit) {
  const map = CM.map; if (!map) return;
  Object.values(CM.markers).forEach((m) => m.remove()); CM.markers = {};
  const pts = [], seen = {};
  cmVisible().forEach((c) => {
    const g = db.geo[c.id]; if (!g || g.lat == null) return;
    const key = g.lat.toFixed(4) + g.lng.toFixed(4), n = (seen[key] = (seen[key] || 0) + 1) - 1; // décale légèrement les chantiers superposés
    const ll = [g.lat + (n ? 0.0012 * Math.sin(n * 2.4) : 0), g.lng + (n ? 0.0016 * Math.cos(n * 2.4) : 0)];
    const m = L.marker(ll, { icon: L.divIcon({ className: "cm-wrap", html: markerHtml(c, CM.sel === c.id), iconSize: [70, 92], iconAnchor: [35, 90] }), riseOnHover: true, zIndexOffset: CM.sel === c.id ? 1000 : 0 }).addTo(map);
    m.on("click", () => cmSelect(c.id)); CM.markers[c.id] = m; pts.push(ll);
  });
  const lst = $("#cml"); if (lst) lst.innerHTML = cmListHtml();
  if (fit && pts.length) map.fitBounds(pts, { padding: [70, 70], maxZoom: 14 });
}
async function cmGeocodeMissing() {
  if (CM.geocoding) return;
  CM.geocoding = true;
  try {
    for (const c of db.chantiers.filter(needsGeo).slice(0, 30)) {
      if (!CM.map) break;
      const qy = geoQuery(c), r = await geoLookup(qy);
      await geoSave(c.id, r ? { lat: r.lat, lng: r.lng, adresse_src: qy } : { lat: null, lng: null, adresse_src: qy });
      if ($("#cmel")) { cmDraw(Object.keys(CM.markers).length === 0); }
    }
  } finally { CM.geocoding = false; }
}
function cmSelect(id, silent) {
  const c = byId(db.chantiers, id); if (!c) return;
  CM.sel = id; const g = db.geo[id];
  Object.entries(CM.markers).forEach(([k, m]) => { const cc = byId(db.chantiers, k); m.setIcon(L.divIcon({ className: "cm-wrap", html: markerHtml(cc, k === id), iconSize: [70, 92], iconAnchor: [35, 90] })); m.setZIndexOffset(k === id ? 1000 : 0); });
  if (g?.lat != null && CM.map) CM.map.flyTo([g.lat, g.lng], Math.max(CM.map.getZoom(), 13), { duration: silent ? 0.2 : 0.6 });
  $("#cml")?.querySelectorAll(".cl").forEach((b) => b.classList.toggle("on", b.dataset.id === id));
  cmDetail(c);
}
function cmDetail(c) {
  const box = $("#cmd"); if (!box) return;
  const p = avOf(c), mk = metierOf(c), M = METIERS[mk], { d, col, lbl } = cmState(c), marges = typeof permOk !== "function" || permOk("marges");
  const cl = clientOf(c.client_id) || {}, g = db.geo[c.id], addr = [c.adresse, c.ville].filter(Boolean).join(", ");
  const late = c.date_fin && c.statut !== "Terminé" && c.date_fin < today();
  const st = (k, v, sub = "", cls = "") => `<div class="cd-s ${cls}"><small>${k}</small><b class="num">${v}</b>${sub ? `<span>${sub}</span>` : ""}</div>`;
  box.innerHTML = `<button type="button" class="cd-x" data-act="cmClose" aria-label="Fermer">${svg(ic.x)}</button>
    <div class="cd-scene">${sceneSvg(p, mk, { sky: true })}<span class="cd-pct" style="background:${col}">${p} %</span><span class="cd-mk" style="background:${M.c}">${iconSvg(mk, 15)} ${esc(M.l)}</span></div>
    <div class="cd-b"><h3>${esc(c.nom)}</h3><div class="cd-st"><span class="verdict v-${d.rank >= 3 ? "dn" : d.rank === 2 ? "wn" : c.statut === "Terminé" ? "ok" : "n"}">${lbl}</span> ${chip(c.statut)}</div>
      <div class="cd-bar"><i style="width:${p}%;background:${col}"></i></div>
      <dl class="kv"><dt>Client</dt><dd>${esc(c.client_nom || cl.nom || "-")}${cl.telephone ? ` · <a href="tel:${esc(cl.telephone)}">${esc(cl.telephone)}</a>` : ""}</dd>
        <dt>Adresse</dt><dd>${addr ? esc(addr) : `<em>non renseignée</em>`}</dd>
        <dt>Période</dt><dd>${c.date_debut ? D(c.date_debut) : "?"} → <span${late ? ' class="dn"' : ""}>${c.date_fin ? D(c.date_fin) : "?"}${late ? " (dépassée)" : ""}</span></dd></dl>
      <div class="cd-g">${st("Facturé", d.base ? `${d.factPct} %` : E(d.factureHT), d.base ? `${E(d.factureHT)} sur ${E(d.base)}` : "")}
        ${st("Reste à facturer", d.base ? E(d.reste) : "-")}
        ${st("Heures", d.hPrev ? `${hn(d.hReal)} / ${hn(d.hPrev)}` : hn(d.hReal), d.hPrev ? `${pc(d.hReal, d.hPrev)} % des prévues` : "", d.hPrev && d.hReal > d.hPrev ? "dn" : "")}
        ${marges ? st("Budget", d.budget ? `${pc(d.used, d.budget)} %` : "-", d.budget ? `${E(d.used)} sur ${E(d.budget)}` : "non défini", d.budget && d.used > d.budget ? "dn" : "") : ""}
        ${marges ? st("Marge nette", d.factureHT ? `${d.pctNette} %` : "-", d.factureHT ? E(d.margeNette) : "rien facturé", d.factureHT && d.margeNette < 0 ? "dn" : "") : ""}</div>
      ${marges && d.alerts.filter((a) => a.lv !== "n").length ? `<div class="als">${d.alerts.filter((a) => a.lv !== "n").slice(0, 3).map((a) => `<div class="al lv-${a.lv}"><span class="ai">${svg(ic.warn)}</span><div><b>${esc(a.t)}</b><span>${esc(a.d)}</span></div></div>`).join("")}</div>` : ""}
      <label class="fl cd-t"><span>Type de travaux</span><select data-chg="cmMetier" data-id="${c.id}">${METIER_KEYS.map((k) => `<option value="${k}"${k === mk ? " selected" : ""}>${METIERS[k].l}</option>`).join("")}</select></label>
      <div class="cd-a"><a class="btn" href="#/chantiers/${c.id}">Ouvrir la fiche</a>
        ${addr ? `<a class="btn o" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(g?.lat != null ? g.lat + "," + g.lng : addr)}">Itinéraire</a>` : ""}
        ${typeof jrForm === "function" && db.v17 ? `<button class="btn o" data-act="jrNew" data-id="${c.id}" data-arg="${today()}">Journal du jour</button>` : ""}
        <button class="btn o" data-act="cmPlace" data-id="${c.id}">${svg(ic.carte)} ${g?.lat != null ? "Corriger la position" : "Placer sur la carte"}</button></div></div>`;
  box.hidden = false;
}

const carteActions = {
  cmSel: (id) => cmSelect(id),
  cmClose: () => { CM.sel = null; $("#cmd").hidden = true; cmDraw(); },
  cmFit: () => { const p = Object.values(CM.markers).map((m) => m.getLatLng()); if (p.length) CM.map.fitBounds(p, { padding: [70, 70], maxZoom: 14 }); },
  cmSt: (id, arg) => { CM.filt.st.has(arg) ? CM.filt.st.delete(arg) : CM.filt.st.add(arg); $$('[data-act="cmSt"]').forEach((b) => b.setAttribute("aria-pressed", CM.filt.st.has(b.dataset.arg))); cmDraw(true); },
  cmMetier: async (v, _, el) => { const id = el.dataset.id; await geoSave(id, { metier: v }); cmDraw(); cmDetail(byId(db.chantiers, id)); },
  cmPlace: (id) => { CM.placing = id; const h = $("#cmh"); h.textContent = "Cliquez sur la carte à l'emplacement exact du chantier."; h.hidden = false; $("#cmel").classList.add("placing"); },
};
