/* Navigation par domaines : menu repliable, barre de sous-pages, recherche rapide (Ctrl+K), menu « Nouveau ».
   Une seule source de vérité : DOMAINS. Chaque page (clé de V) appartient à un domaine. */

Object.assign(ic, {
  bc: "M6 3h9l4 4v14H6z M9 12h7 M9 16h5 M9 8h3",
  depenses: "M3 6h18v12H3z M3 10h18 M15 15h3",
  liens: "M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1 M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1",
  roles: "M12 3l8 3v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6z M9 12l2 2 4-4",
  moe: "M4 20V8l8-4 8 4v12 M9 20v-6h6v6 M4 20h16",
  stdossiers: "M3 6a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z M8 13h8",
  stsituations: "M5 3h14v18H5z M8 8h8 M8 12h8 M8 16h5",
  stoffres: "M4 5h16v14H4z M4 9h16 M8 13h5 M8 16h3",
  search: "M11 18a7 7 0 100-14 7 7 0 000 14z M20 20l-4-4",
  chev: "M9 6l6 6-6 6",
  d_ventes: "M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z M9 8h6 M9 12h6",
  d_chantiers: "M3 8h18v12H3z M8 8V4h8v4 M3 13h18",
  d_equipes: "M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7z M2.5 20c0-3.5 3-6 6.5-6s6.5 2.5 6.5 6 M16 4.5a3.5 3.5 0 010 6.5 M18 14.5c2 .8 3.5 2.6 3.5 5.5",
  d_stocks: "M3 8l9-5 9 5v8l-9 5-9-5z M3 8l9 5 9-5 M12 13v8",
  d_finances: "M3 6h18v12H3z M3 10h18 M7 15h3",
  d_pilotage: "M4 19V9 M10 19V5 M16 19v-7 M22 19H2",
  d_documents: "M3 6a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z",
  d_admin: "M4 7h10 M18 7h2 M4 17h2 M10 17h10 M14 5v4 M6 15v4",
});

/* [clé de page, libellé, mots-clés de recherche] */
const DOMAINS = [
  { id: "accueil", label: "Accueil", icon: "home", items: [["home", "Tableau de bord", "accueil"]] },
  { id: "ventes", label: "Ventes", icon: "d_ventes", items: [
    ["clients", "Clients", "contacts"], ["devis", "Devis", "propositions"], ["factures", "Factures", "facturation situations avoirs acomptes"],
    ["efacture", "Facture électronique", "chorus factur-x"], ["marches", "Marchés et analyses", "appels d'offres études de prix chiffrage"],
    ["ouvrages", "Bibliothèque d'ouvrages", "prix catalogue bordereau"], ["liens", "Liens partagés", "suivi consultation"], ["moe", "Maîtrise d'œuvre", "architecte moe"],
  ] },
  { id: "chantiers", label: "Chantiers", icon: "d_chantiers", items: [
    ["chantiers", "Chantiers", "projets"], ["planning", "Planning", "calendrier"], ["temps", "Temps passés", "heures"],
    ["pv", "PV de réception", "réception réserves"], ["notes", "Notes", "carnet"],
  ] },
  { id: "achats", label: "Achats", icon: "achats", items: [
    ["achats", "Achats et commandes", "bons de commande bc"], ["fournisseurs", "Fournisseurs", ""], ["depenses", "Dépenses", "frais"],
    ["rapprochement", "Rapprochement", "livraison facture fournisseur"], ["soustraitants", "Sous-traitants", ""],
    ["stdossiers", "Dossiers sous-traitance", "contrats"], ["stsituations", "Situations sous-traitants", "paiement direct"], ["stoffres", "Appels d'offres sous-traitance", "consultation"],
  ] },
  { id: "equipes", label: "Équipes", icon: "d_equipes", items: [
    ["equipes", "Salariés et équipes", "personnel"], ["pointages", "Pointages et paie", "heures sup absences"], ["affectations", "Affectations", "planning équipes conflits"], ["rapports", "Rapports et photos", "intervention"],
  ] },
  { id: "stocks", label: "Stocks et matériel", icon: "d_stocks", items: [
    ["stocks", "Stocks", "dépôts véhicules inventaires"], ["materiel", "Matériel", "engins outillage"], ["dispo", "Disponibilité matériel", "réservation"],
  ] },
  { id: "finances", label: "Finances", icon: "d_finances", items: [
    ["paiements", "Paiements", "encaissements banque"], ["tresorerie", "Trésorerie prévue", "prévisionnel"], ["compta", "Comptabilité", "export fec tva"],
  ] },
  { id: "pilotage", label: "Pilotage", icon: "d_pilotage", items: [
    ["analyses", "Analyses", "statistiques"], ["rentabilite", "Rentabilité", "marges"], ["objectifs", "Objectifs", "budget"],
  ] },
  { id: "documents", label: "Documents et échanges", icon: "d_documents", items: [
    ["documents", "Documents", "fichiers pièces"], ["mails", "Messagerie", "emails gmail"],
  ] },
  { id: "admin", label: "Administration", icon: "d_admin", bottom: true, items: [
    ["params", "Paramètres", "entreprise réglages"], ["roles", "Sécurité et rôles", "permissions profils rib"],
  ] },
];
/* pages qui vivent dans un autre écran : clé → page du menu à mettre en surbrillance */
const NAV_ALIAS = { bc: "achats" };
const navOk = (k) => (typeof permNav === "function" ? permNav(k) : true);
const navLabel = (k) => { for (const d of DOMAINS) for (const i of d.items) if (i[0] === k) return i[1]; return k; };
function navDomainOf(page) {
  const k = NAV_ALIAS[page] || page;
  return DOMAINS.find((d) => d.items.some((i) => i[0] === k)) || null;
}
const navVisible = (d) => d.items.filter((i) => navOk(i[0]));

/* ---------- Menu latéral ---------- */
const navOpenGet = () => { try { return JSON.parse(localStorage.getItem("pilot-nav-open") || "null"); } catch (e) { return null; } };
const navOpenSet = (a) => { try { localStorage.setItem("pilot-nav-open", JSON.stringify(a)); } catch (e) {} };
let NAV_OPEN = null;
function navSideHtml() {
  if (!NAV_OPEN) NAV_OPEN = navOpenGet() || [];
  const cur = navDomainOf(parseHash().name);
  const one = (d) => {
    const its = navVisible(d);
    if (!its.length) return "";
    if (its.length === 1 && !d.bottom) {
      const [k, l] = its[0];
      const ico = d.icon;
      return `<button class="nav" data-go="${k}" data-nk="${k}" aria-current="false" title="${esc(d.label === l ? l : d.label)}">${svg(ic[ico])}<span class="t">${esc(d.id === "accueil" ? "Accueil" : d.label)}</span></button>`;
    }
    const open = NAV_OPEN.includes(d.id) || (cur && cur.id === d.id);
    return `<div class="dom" data-dom="${d.id}"><button class="nav dh" data-dh="${d.id}" data-first="${its[0][0]}" aria-expanded="${open}" aria-controls="dg-${d.id}" title="${esc(d.label)}">${svg(ic[d.icon])}<span class="t">${esc(d.label)}</span><i class="chv">${svg(ic.chev)}</i></button>
      <div class="dg" id="dg-${d.id}" ${open ? "" : "hidden"}>${its.map(([k, l]) => `<button class="nav sub" data-go="${k}" data-nk="${k}" aria-current="false">${svg(ic[k] || ic[d.icon])}<span class="t">${esc(l)}</span></button>`).join("")}</div></div>`;
  };
  const main = DOMAINS.filter((d) => !d.bottom).map(one).join("");
  const bottom = DOMAINS.filter((d) => d.bottom).map(one).join("");
  return main + `<div class="sp"></div>` + bottom;
}
function navMark() {
  const r = parseHash(), key = NAV_ALIAS[r.name] || r.name, dom = navDomainOf(r.name);
  $$("#side .nav[data-nk]").forEach((n) => n.setAttribute("aria-current", n.dataset.nk === key ? "page" : "false"));
  $$("#side .dh").forEach((h) => h.classList.toggle("cur", !!dom && h.dataset.dh === dom.id));
  if (dom) {
    const h = $(`#side .dh[data-dh="${dom.id}"]`);
    if (h && h.getAttribute("aria-expanded") !== "true") navToggle(dom.id, true);
  }
}
function navToggle(id, force) {
  const h = $(`#side .dh[data-dh="${id}"]`), g = $(`#dg-${id}`);
  if (!h || !g) return;
  const open = force ?? h.getAttribute("aria-expanded") !== "true";
  h.setAttribute("aria-expanded", String(open));
  g.hidden = !open;
  NAV_OPEN = (NAV_OPEN || []).filter((x) => x !== id).concat(open ? [id] : []);
  navOpenSet(NAV_OPEN);
}
const navCompact = () => $("#app").classList.contains("compact") || window.matchMedia("(max-width: 860px)").matches;
function navHeaderClick(h) {
  if (navCompact()) return go(h.dataset.first);
  navToggle(h.dataset.dh);
}

/* ---------- Barre de sous-pages (en haut de chaque écran) ---------- */
function navSubbar(page) {
  const d = navDomainOf(page);
  if (!d || d.id === "accueil") return "";
  const its = navVisible(d), key = NAV_ALIAS[page] || page;
  if (its.length < 2) return "";
  return `<nav class="dsub" aria-label="${esc(d.label)}"><span class="dsl">${esc(d.label)}</span>${its.map(([k, l]) => `<button class="dst" data-go="${k}" aria-current="${k === key ? "page" : "false"}">${esc(l)}</button>`).join("")}</nav>`;
}

/* ---------- Recherche rapide (Ctrl+K) ---------- */
const nrm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
function navIndex() {
  const out = [];
  DOMAINS.forEach((d) => d.items.forEach(([k, l, kw]) => { if (navOk(k)) out.push({ g: "Pages", l, s: d.label, go: k, ico: ic[k] || ic[d.icon], k: nrm(l + " " + d.label + " " + kw) }); }));
  const ent = (g, arr, f, goFn, ico) => (arr || []).slice(0, 400).forEach((x) => { const [l, s] = f(x); out.push({ g, l, s, go: goFn(x), ico: ic[ico], k: nrm(l + " " + s) }); });
  if (navOk("clients")) ent("Clients", db.clients, (c) => [c.nom || "Client", c.email || c.ville || ""], (c) => `clients/${c.id}`, "clients");
  ent("Chantiers", db.chantiers, (c) => [c.nom || "Chantier", c.client_nom || ""], (c) => `chantiers/${c.id}`, "chantiers");
  if (navOk("devis")) ent("Devis", db.devis, (d) => [`${d.numero || "Brouillon"} · ${d.client_nom || ""}`, d.objet || d.statut || ""], (d) => `devis/${d.id}`, "devis");
  if (navOk("factures")) ent("Factures", db.factures, (f) => [`${f.numero || "Brouillon"} · ${f.client_nom || ""}`, f.statut || ""], (f) => `factures/${f.id}`, "factures");
  if (navOk("fournisseurs")) ent("Fournisseurs", db.fournisseurs, (f) => [f.nom || "Fournisseur", f.email || ""], (f) => `fournisseurs/${f.id}`, "fournisseurs");
  return out;
}
const NAVQ = { items: [], sel: 0 };
function navSearchOpen() {
  if ($("#cmdk")) return navSearchClose();
  const el = document.createElement("div");
  el.id = "cmdk"; el.className = "cmdk";
  el.innerHTML = `<div class="cmd-box" role="dialog" aria-modal="true" aria-label="Aller à"><div class="cmd-in">${svg(ic.search)}<input id="cmdq" type="text" autocomplete="off" placeholder="Aller à une page, un client, un devis, une facture…" aria-label="Rechercher"><kbd>Échap</kbd></div><div class="cmd-l" id="cmdl" role="listbox"></div><div class="cmd-f">↑ ↓ pour choisir · Entrée pour ouvrir</div></div>`;
  document.body.appendChild(el);
  el.addEventListener("mousedown", (e) => { if (e.target === el) navSearchClose(); });
  const inp = $("#cmdq");
  NAVQ.all = navIndex();
  const draw = () => {
    const t = nrm(inp.value).trim().split(/\s+/).filter(Boolean);
    let l = NAVQ.all.filter((x) => t.every((w) => x.k.includes(w)));
    if (!t.length) l = l.filter((x) => x.g === "Pages");
    NAVQ.items = l.slice(0, 40); NAVQ.sel = 0;
    let last = "";
    $("#cmdl").innerHTML = NAVQ.items.length ? NAVQ.items.map((x, i) => {
      const h = x.g !== last ? `<div class="cmd-g">${esc(x.g)}</div>` : ""; last = x.g;
      return `${h}<button class="cmd-i" role="option" data-ci="${i}" aria-selected="${i === 0}">${svg(x.ico || ic.file)}<span><b>${esc(x.l)}</b>${x.s ? `<small>${esc(x.s)}</small>` : ""}</span></button>`;
    }).join("") : `<p class="cmd-e">Aucun résultat.</p>`;
  };
  const pick = (i) => { const x = NAVQ.items[i]; if (!x) return; navSearchClose(); go(x.go); };
  const mark = () => $$("#cmdl .cmd-i").forEach((b, i) => { b.setAttribute("aria-selected", String(i === NAVQ.sel)); if (i === NAVQ.sel) b.scrollIntoView({ block: "nearest" }); });
  inp.addEventListener("input", draw);
  inp.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); NAVQ.sel = Math.min(NAVQ.items.length - 1, NAVQ.sel + 1); mark(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); NAVQ.sel = Math.max(0, NAVQ.sel - 1); mark(); }
    else if (e.key === "Enter") { e.preventDefault(); pick(NAVQ.sel); }
    else if (e.key === "Escape") { e.preventDefault(); navSearchClose(); }
  });
  $("#cmdl").addEventListener("click", (e) => { const b = e.target.closest("[data-ci]"); if (b) pick(+b.dataset.ci); });
  draw(); inp.focus();
}
function navSearchClose() { $("#cmdk")?.remove(); }

/* ---------- Menu « Nouveau » ---------- */
const NAV_NEW = [
  ["Ventes", [["Devis", "devisNew", "devis"], ["Facture", "factureNew", "factures"], ["Client", "clientNew", "clients"]]],
  ["Chantiers", [["Chantier", "chantierNew", "chantiers"], ["Note", "ntNew", "notes"]]],
  ["Achats", [["Bon de commande", "bcNew", "achats"], ["Dépense", "depNew", "depenses"], ["Fournisseur", "fournisseurNew", "fournisseurs"]]],
  ["Équipes", [["Salarié", "eqSalNew", "equipes"], ["Pointage", "ptNew", "pointages"]]],
];
function navNewHtml() {
  const g = NAV_NEW.map(([t, l]) => [t, l.filter((x) => navOk(x[2]) && ACT[x[1]])]).filter((x) => x[1].length);
  if (!g.length) return `<p class="emp">Aucune création disponible pour ce profil.</p>`;
  return g.map(([t, l]) => `<div class="mg">${esc(t)}</div>` + l.map(([n, a]) => `<button class="mi" data-act="${a}">${svg(ic.plus)}${esc(n)}</button>`).join("")).join("");
}
