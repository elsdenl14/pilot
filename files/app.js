const $ = (s) => document.querySelector(s);
const ic = {
  home: "M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z",
  chantiers: "M3 8h18v12H3z M8 8V4h8v4 M3 13h18",
  clients:
    "M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7z M2.5 20c0-3.5 3-6 6.5-6s6.5 2.500 6.500 6 M16 4.500a3.500 3.500 0 010 6.500 M18 14.500c2 .8 3.500 2.600 3.500 5.500",
  devis: "M6 3h9l4 4v14H6z M9 13h7 M9 17h7",
  factures: "M3 8h18v12H3z M9 8V5h6v3 M3 13h18",
  paiements:
    "M12 21a9 9 0 100-18 9 9 0 000 18z M12 7v10 M9.500 9.800c0-1.200 1.200-1.800 2.500-1.800s2.500.6 2.500 1.800-1.200 1.600-2.500 1.900-2.500.8-2.500 2.100c0 1.200 1.200 1.900 2.500 1.900s2.500-.7 2.500-1.800",
  analyses: "M4 20v-9 M10 20V4 M16 20v-7 M22 20H2",
  params: "M4 7h10 M18 7h2 M4 17h2 M10 17h10 M14 5v4 M6 15v4",
  bell: "M6 16v-5a6 6 0 0112 0v5l2 2H4z M10 21h4",
  moon: "M20 14A8 8 0 1110 4a6.500 6.500 0 0010 10z",
  ar: "M5 12h14 M13 6l6 6-6 6",
};
const svg = (p) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${p}"/></svg>`;
const NAV = [
  ["home", "Accueil"],
  ["chantiers", "Chantiers"],
  ["clients", "Clients"],
  ["devis", "Devis"],
  ["factures", "Factures"],
  ["paiements", "Paiements"],
  ["analyses", "Analyses"],
];

/* ===================== Supabase ===================== */
const CFG = window.PILOT_CONFIG || {};
const configured = CFG.url && CFG.anonKey && !/VOTRE/.test(CFG.url + CFG.anonKey);
const sb = configured && window.supabase ? window.supabase.createClient(CFG.url, CFG.anonKey) : null;
// Lance une requête Supabase et lève l'erreur si elle échoue
const q = async (p) => {
  const r = await p;
  if (r.error) throw r.error;
  return r.data;
};
let uid = null,
  email = "";

const empty = () => ({ chantiers: [], clients: [], devis: [], factures: [], paiements: [], ent: { n: "", s: "", a: "", e: "" }, tpl: { devis: "Devis standard", facture: "Facture standard" }, fich: {} });
let db = empty(),
  route = "home",
  period = "12",
  ed = false,
  th = "dark";
try {
  th = localStorage.getItem("pilot-th") || "dark";
} catch (e) {}
const setTh = (t) => {
  th = t;
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem("pilot-th", t);
  } catch (e) {}
};

// Charge toutes les données depuis Supabase et les met au format attendu par l'interface
async function load() {
  const [cl, ch, dv, fa, pa, en] = await Promise.all([
    q(sb.from("v_clients_stats").select("*").order("nom")),
    q(sb.from("v_chantiers").select("*").order("created_at", { ascending: false })),
    q(sb.from("v_devis").select("*").order("date_devis", { ascending: false }).order("numero", { ascending: false })),
    q(sb.from("v_factures").select("*").order("date_emission", { ascending: false }).order("numero", { ascending: false })),
    q(sb.from("v_paiements").select("*").order("date_paiement", { ascending: false })),
    q(sb.from("entreprise").select("*").maybeSingle()),
  ]);
  const n = Number;
  db.clients = cl.map((c) => ({ id: c.id, n: c.nom, ty: c.type, v: c.ville || "", ch: n(c.nb_chantiers), ca: n(c.ca), du: n(c.a_encaisser) }));
  db.chantiers = ch.map((c) => ({ id: c.id, cid: c.client_id, n: c.nom, cl: c.client_nom, v: c.ville || "", av: c.avancement, m: n(c.montant_marche), s: c.statut }));
  db.devis = dv.map((d) => ({ id: d.id, num: d.numero, cl: d.client_nom, ch: d.chantier_nom || "Sans chantier", d: d.date_devis, m: n(d.montant_ttc), ht: n(d.montant_ht), s: d.statut }));
  db.factures = fa.map((f) => ({ id: f.id, num: f.numero, cl: f.client_nom, ch: f.chantier_nom || "Sans chantier", d: f.echeance, de: f.date_emission, m: n(f.montant_ttc), ht: n(f.montant_ht), s: f.statut_affiche, raw: f.statut, reste: n(f.reste), paye: n(f.paye), devis_id: f.devis_id }));
  db.paiements = pa.map((p) => ({ d: p.date_paiement, cl: p.client_nom, f: p.facture_numero, fid: p.facture_id, m: n(p.montant), mo: p.mode }));
  if (en) {
    db.ent = { n: en.nom || "", s: en.siret || "", a: en.adresse || "", e: en.email || "" };
    db.tpl = { devis: en.modele_devis, facture: en.modele_facture };
    db.fich = { devis: en.modele_devis_fichier, facture: en.modele_facture_fichier };
  }
}

/* ===================== Utilitaires ===================== */
const E = (n) =>
  Number(n).toLocaleString("fr-FR", { maximumFractionDigits: 2 }).replace(/ /g, " ") + " €";
const E2 = (n) =>
  Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/ /g, " ") + " €";
const D = (d) => (d ? d.split("-").reverse().join("/") : "");
const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const CHIP = {
  "En cours": "c-ok", Accepté: "c-ok", Payée: "c-ok", Terminé: "c-ok",
  "À surveiller": "c-wn", Envoyé: "c-wn", Envoyée: "c-wn", "Partiellement payée": "c-wn",
  "À facturer": "c-ac", "En retard": "c-dn", Refusé: "c-dn",
};
const chip = (s) => `<span class="chip ${CHIP[s] || "c-n"}">${esc(s)}</span>`;
const sum = (a, f) => a.reduce((t, x) => t + f(x), 0);
const pad2 = (n) => String(n).padStart(2, "0");
const localDay = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const today = () => localDay();
const MN = ["Janv", "Fév", "Mars", "Avr", "Mai", "Juin", "Juil", "Août", "Sept", "Oct", "Nov", "Déc"];
const lastMonths = (n) => {
  const r = [];
  let y = new Date().getFullYear(), m = new Date().getMonth();
  for (let i = 0; i < n; i++) {
    r.unshift([`${y}-${pad2(m + 1)}`, MN[m]]);
    if (--m < 0) { m = 11; y--; }
  }
  return r;
};
const emises = () => db.factures.filter((f) => f.raw !== "Brouillon" && f.raw !== "Annulée");
const ouvertes = () => db.factures.filter((f) => f.raw === "Envoyée" || f.raw === "Partiellement payée");
const enRetard = () => ouvertes().filter((f) => f.s === "En retard");
const devisFactures = () => new Set(db.factures.filter((f) => f.devis_id && f.raw !== "Annulée").map((f) => f.devis_id));
const resteAFacturer = () => sum(db.devis.filter((d) => d.s === "Accepté" && !devisFactures().has(d.id)), (d) => d.m);

const hdr = (eb, t, sub, r = "") =>
  `<div class="hd"><div><div class="eb">${eb}</div><h1>${t}</h1><p class="sub">${sub}</p></div>${r}</div>`;
const kpi = (l, v, s, c = "") =>
  `<div class="kpi"><small>${l}</small><b class="num">${v}</b><span class="${c}">${s}</span></div>`;
const tbl = (cols, rows) =>
  `<div class="tw"><table><thead><tr>${cols.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map((r) => `<tr data-t="${esc(r.t.toLowerCase())}">${r.c.map((x, i) => `<td${r.a && i === r.c.length - 1 ? ' class="ac"' : ""}>${x}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${cols.length}">Rien à afficher pour le moment. Utilisez le bouton en haut à droite pour ajouter un élément.</td></tr>`}</tbody></table></div>`;
const list = (eb, t, sub, cta, ph, cols, rows, meta) =>
  hdr(eb, t, sub, `<button class="btn" data-new>${cta}</button>`) +
  `<div class="sr"><input id="q" type="search" placeholder="${ph}" aria-label="${ph}"><span class="cnt">${meta}</span></div><div class="card">${tbl(cols, rows)}</div>`;
const btn = (label, act, id, arg = "") =>
  `<button class="btn o sm" data-do="${act}|${id}|${esc(arg)}">${label}</button>`;

const chR = (c) => ({
  t: `${c.n} ${c.cl} ${c.v}`,
  a: 1,
  c: [
    `<strong>${esc(c.n)}</strong><small>${esc(c.cl)} · ${esc(c.v)}</small>`,
    `<b>${c.av} %</b><div class="bar"><i style="width:${c.av}%"></i></div>`,
    `<span class="num">${E(c.m)}</span>`,
    chip(c.s),
    btn("Mettre à jour", "chantierEdit", c.id),
  ],
});
const homeChR = (c) => ({ ...chR(c), c: chR(c).c.slice(0, 4), a: 0 });

/* ===================== Vues ===================== */
const V = {};
V.home = () => {
  const now = new Date(),
    mk = lastMonths(2),
    caMois = sum(emises().filter((f) => f.de.startsWith(mk[1][0])), (f) => f.ht),
    caPrec = sum(emises().filter((f) => f.de.startsWith(mk[0][0])), (f) => f.ht),
    evo = caPrec ? Math.round(((caMois - caPrec) / caPrec) * 100) : null,
    retard = enRetard(),
    attente = db.devis.filter((d) => d.s === "Envoyé"),
    aFact = db.chantiers.filter((c) => c.s === "À facturer"),
    surv = db.chantiers.filter((c) => c.s === "À surveiller").length,
    enc = sum(ouvertes(), (f) => f.reste),
    encRetard = sum(retard, (f) => f.reste);
  return (
    hdr(
      now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
      "Bonjour" + (db.ent.n ? " · " + esc(db.ent.n) : ""),
      "Voici les éléments qui méritent votre attention.",
    ) +
    `<div class="card at"><div class="ch"><div><div class="eb">À votre attention</div><b>Les sujets à traiter en priorité</b></div><button class="lk" data-go="factures">Tout afficher ${svg(ic.ar)}</button></div>${[
      [`${retard.length} facture${retard.length > 1 ? "s" : ""} en retard`, `${new Set(retard.map((f) => f.cl)).size} client(s) concerné(s)`, sum(retard, (f) => f.reste)],
      [`${aFact.length} chantier${aFact.length > 1 ? "s" : ""} à facturer`, "Avancement terminé, facture à émettre", sum(aFact, (c) => c.m)],
      [`${attente.length} devis en attente`, "Envoyés, sans réponse du client", sum(attente, (d) => d.m)],
    ]
      .map((a) => `<div class="row"><div><b>${a[0]}</b><small>${a[1]}</small></div>${a[2] ? `<span class="num">${E(a[2])}</span>` : ""}</div>`)
      .join("")}</div>
<div class="kp">${kpi("Chantiers en cours", db.chantiers.filter((c) => c.s === "En cours" || c.s === "À surveiller").length, `${surv} à surveiller`)}${kpi("CA du mois (HT)", E(caMois), evo === null ? "—" : `${evo >= 0 ? "↑" : "↓"} ${Math.abs(evo)} % vs mois précédent`, evo > 0 ? "up" : "")}${kpi("Devis en attente", attente.length, `${E(sum(attente, (d) => d.m))} de potentiel`)}${kpi("À encaisser", E(enc), `dont ${E(encRetard)} en retard`)}</div>
<div class="g2"><div class="card"><div class="ch"><div><div class="eb">Chantiers</div><b>Vue opérationnelle</b></div><button class="lk" data-go="chantiers">Voir les chantiers ${svg(ic.ar)}</button></div>${tbl(["Chantier", "Avancement", "Montant", "Statut"], db.chantiers.slice(0, 3).map(homeChR))}</div>
<div class="card"><div class="ch"><div><div class="eb">Finances</div><b>À suivre</b></div></div>${[
      ["Factures en retard", encRetard, "dn"],
      ["À encaisser", enc, ""],
      ["Devis acceptés (TTC)", sum(db.devis.filter((d) => d.s === "Accepté"), (d) => d.m), ""],
      ["Reste à facturer", resteAFacturer(), ""],
    ]
      .map((r) => `<div class="row"><span>${r[0]}</span><span class="num ${r[2]}">${E(r[1])}</span></div>`)
      .join("")}</div></div>`
  );
};
V.chantiers = () =>
  list("Opérations", "Chantiers", "Les chantiers actifs, leur avancement et ce qu'il reste à facturer.", "+ Nouveau chantier",
    "Rechercher un chantier, un client, une ville…", ["Chantier", "Avancement", "Marché", "Statut", ""],
    db.chantiers.map(chR),
    `${db.chantiers.length} chantiers · ${db.chantiers.filter((c) => c.s === "À surveiller").length} à surveiller`);
V.clients = () =>
  list("Relation client", "Clients", "Tous les clients et leur situation financière au même endroit.", "+ Nouveau client",
    "Rechercher par nom, ville…", ["Client", "Chantiers", "CA (HT)", "À encaisser"],
    db.clients.map((c) => ({
      t: `${c.n} ${c.v} ${c.ty}`,
      c: [`<strong>${esc(c.n)}</strong><small>${c.ty} · ${esc(c.v)}</small>`, c.ch, `<span class="num">${E(c.ca)}</span>`, `<span class="num ${c.du ? "dn" : ""}">${E(c.du)}</span>`],
    })),
    `${db.clients.length} clients`);

const devisActions = (x) => {
  const fait = devisFactures().has(x.id);
  return {
    Brouillon: btn("Marquer envoyé", "devisStatut", x.id, "Envoyé") + btn("Supprimer", "devisDel", x.id),
    Envoyé: btn("Accepté", "devisStatut", x.id, "Accepté") + btn("Refusé", "devisStatut", x.id, "Refusé"),
    Accepté: fait ? "<small>Facturé</small>" : btn("Créer la facture", "devisFacturer", x.id),
    Refusé: "",
  }[x.s];
};
const factureActions = (x) =>
  x.raw === "Brouillon"
    ? btn("Émettre", "factureStatut", x.id, "Envoyée") + btn("Supprimer", "factureDel", x.id)
    : x.raw === "Envoyée" && !x.paye
      ? btn("Annuler", "factureStatut", x.id, "Annulée")
      : "";
const docRow = (x, actions) => ({
  t: `${x.num} ${x.cl} ${x.ch}`,
  a: 1,
  c: [`<strong>${esc(x.num)}</strong><small>${esc(x.cl)} · ${esc(x.ch)}</small>`, D(x.d), `<span class="num">${E2(x.m)}</span>`, chip(x.s), actions(x)],
});
V.devis = () =>
  list("Commercial", "Devis", "Créer, envoyer et suivre les propositions commerciales.", "+ Nouveau devis",
    "Rechercher un numéro, client, chantier…", ["Devis", "Date", "Montant TTC", "Statut", ""],
    db.devis.map((x) => docRow(x, devisActions)),
    `${db.devis.length} devis · ${E(sum(db.devis.filter((d) => d.s === "Brouillon" || d.s === "Envoyé"), (d) => d.m))} en attente`);
V.factures = () =>
  list("Finances", "Factures", "Suivi de la facturation, des échéances et des règlements.", "+ Nouvelle facture",
    "Rechercher un numéro, client, chantier…", ["Facture", "Échéance", "Montant TTC", "Statut", ""],
    db.factures.map((x) => docRow(x, factureActions)),
    `${db.factures.length} facture${db.factures.length > 1 ? "s" : ""} · ${E(sum(ouvertes(), (f) => f.reste))} à encaisser`);

V.paiements = () => {
  const mk = lastMonths(2),
    mois = (k) => sum(db.paiements.filter((p) => p.d.startsWith(k)), (p) => p.m),
    cur = mois(mk[1][0]),
    prev = mois(mk[0][0]),
    evo = prev ? Math.round(((cur - prev) / prev) * 1000) / 10 : null,
    fById = Object.fromEntries(db.factures.map((f) => [f.id, f])),
    delais = db.paiements.filter((p) => fById[p.fid]).map((p) => (new Date(p.d) - new Date(fById[p.fid].de)) / 864e5),
    delai = delais.length ? Math.round(sum(delais, (x) => x) / delais.length) : null;
  return (
    hdr("Trésorerie", "Paiements", "Règlements reçus, associés aux factures et aux chantiers.", `<button class="btn" data-new>+ Enregistrer un paiement</button>`) +
    `<div class="kp" style="grid-template-columns:repeat(auto-fit,minmax(220px,300px))">${kpi("Encaissé ce mois", E(cur), evo === null ? "—" : `${evo >= 0 ? "↑" : "↓"} ${Math.abs(evo)} %`, evo > 0 ? "up" : "")}${kpi("À encaisser", E(sum(ouvertes(), (f) => f.reste)), `dont ${E(sum(enRetard(), (f) => f.reste))} en retard`)}${kpi("Délai moyen", delai === null ? "—" : delai + " j", "émission → paiement")}</div><div class="card"><div class="ch"><div><div class="eb">Journal des règlements</div><b>Derniers paiements</b></div></div>${tbl(
      ["Date", "Client / facture", "Montant", "Mode"],
      db.paiements.map((p) => ({
        t: `${p.cl} ${p.f} ${p.mo}`,
        c: [`<b>${new Date(p.d).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })}</b>`, `<b>${esc(p.cl)}</b><small>${esc(p.f)}</small>`, `<span class="num">${E(p.m)}</span>`, p.mo],
      })),
    )}</div>`
  );
};

const chart = (d) => {
  const mx = Math.max(1, ...d.map((x) => x[1])),
    w = 600 / d.length;
  return (
    `<svg class="chart" viewBox="0 0 600 250" role="img" aria-label="Chiffre d'affaires mensuel HT en milliers d'euros">` +
    d.map((x, i) => {
      const h = (x[1] / mx) * 180, xx = i * w + w * 0.18, bw = w * 0.64;
      return `<rect x="${xx}" y="${215 - h}" width="${bw}" height="${h}" rx="2" fill="var(--acc)"/><text x="${xx + bw / 2}" y="${208 - h}" text-anchor="middle" class="t b">${x[1]}k</text><text x="${xx + bw / 2}" y="236" text-anchor="middle" class="t">${x[0]}</text>`;
    }).join("") + `</svg>`
  );
};
V.analyses = () => {
  const nMois = period === "y" ? new Date().getMonth() + 1 : +period,
    mois = lastMonths(nMois),
    cles = new Set(mois.map((m) => m[0])),
    ca = (k) => sum(emises().filter((f) => f.de.startsWith(k)), (f) => f.ht),
    serie = mois.map(([k, l]) => [l, Math.round(ca(k) / 100) / 10]),
    caPer = sum(mois, ([k]) => ca(k)),
    encPer = sum(db.paiements.filter((p) => cles.has(p.d.slice(0, 7))), (p) => p.m),
    envoyes = db.devis.filter((d) => d.s !== "Brouillon"),
    acc = db.devis.filter((d) => d.s === "Accepté"),
    taux = envoyes.length ? Math.round((acc.length / envoyes.length) * 100) : null,
    attente = db.devis.filter((d) => d.s === "Envoyé"),
    jours = (f) => Math.floor((new Date(today()) - new Date(f.d)) / 864e5),
    tranche = (a, b) => sum(ouvertes().filter((f) => jours(f) >= a && jours(f) <= b), (f) => f.reste);
  return (
    hdr("Pilotage", "Analyses", "Les chiffres utiles pour piloter l'activité et prendre les décisions.",
      `<div class="seg">${[["12", "12 mois"], ["6", "6 mois"], ["y", "Cette année"]].map(([v, l]) => `<button data-p="${v}" aria-pressed="${period === v}">${l}</button>`).join("")}</div>`) +
    `<div class="kp">${kpi("CA sur la période (HT)", E(caPer), `${emises().length} facture(s) émise(s)`)}${kpi("Encaissé sur la période", E(encPer), "paiements reçus")}${kpi("Reste à facturer", E(resteAFacturer()), `${acc.length} devis accepté(s)`)}${kpi("Taux de transformation", taux === null ? "—" : taux + " %", "acceptés / envoyés")}</div>
<div class="g2"><div class="card"><div class="ch"><div><div class="eb">Évolution</div><b>Chiffre d'affaires mensuel</b></div></div>${chart(serie)}</div>
<div class="card"><div class="ch"><div><div class="eb">Commercial</div><b>Devis</b></div></div>${[
      ["Devis créés", db.devis.length], ["Envoyés", envoyes.length], ["Acceptés", acc.length],
      ["En attente", attente.length], ["Refusés", db.devis.filter((d) => d.s === "Refusé").length],
    ].map((r) => `<div class="row"><span>${r[0]}</span><b class="num">${r[1]}</b></div>`).join("")}<p class="note">${E(sum(attente, (d) => d.m))} de potentiel commercial reste à convertir.</p></div></div>
<div class="g2"><div class="card"><div class="ch"><div><div class="eb">Encaissement</div><b>Créances</b></div></div>${[
      ["À l'heure", tranche(-99999, 0), ""], ["1–30 jours", tranche(1, 30), ""], ["31–60 jours", tranche(31, 60), "dn"], ["60+ jours", tranche(61, 99999), "dn"],
    ].map((r) => `<div class="row"><span>${r[0]}</span><b class="num ${r[2]}">${E(r[1])}</b></div>`).join("")}</div>
<div class="card"><div class="ch"><div><div class="eb">Clients</div><b>Top clients par CA</b></div></div>${[...db.clients]
      .sort((a, b) => b.ca - a.ca).slice(0, 5)
      .map((c, i) => `<div class="row"><span class="num" style="color:var(--mut)">0${i + 1}</span><div style="flex:1"><b>${esc(c.n)}</b><small>${c.ch} chantier${c.ch > 1 ? "s" : ""}</small></div><span class="num">${E(c.ca)}</span></div>`).join("")}</div></div>`
  );
};
V.params = () => {
  const e = db.ent;
  return (
    hdr("Configuration", "Paramètres", "Les réglages de l'entreprise et des documents.") +
    `<div class="card" style="max-width:680px"><div class="ch"><div><div class="eb">Entreprise</div><b>Identité</b></div></div>${[["n", "Nom"], ["s", "SIRET"], ["a", "Adresse"], ["e", "Email"]]
      .map(([k, l]) => `<div class="row"><small>${l}</small>${ed ? `<input class="ei" data-ent="${k}" value="${esc(e[k])}" aria-label="${l}">` : `<b>${esc(e[k]) || "—"}</b>`}</div>`).join("")}<div class="row"><button class="btn o" data-act="${ed ? "save" : "edit"}">${ed ? "Enregistrer" : "Modifier les informations"}</button></div><div class="row"><small>Compte</small><b>${esc(email)}</b></div></div>
<div class="g3">${[["devis", "Modèle de devis"], ["facture", "Modèle de facture"]]
      .map(([k, t], i) => `<div class="card"><div class="ch"><div><b>${t}</b><small style="color:var(--mut)">Votre document de référence et votre charte graphique.</small></div><span class="chip c-ok">Actif</span></div><div class="pad"><label class="lb">Nom du modèle<input data-tpl="${k}" value="${esc(db.tpl[k])}"></label><div class="drop"><div><b>Importer un document de référence</b><small style="display:block;color:var(--mut);font-size:12px">PDF ou image. Stocké dans votre espace privé Supabase.</small></div><input type="file" id="f${i}" accept=".pdf,image/*" hidden><span class="fn">${esc((db.fich[k] || "").split("/").pop().replace(/^\w+-\d+-/, ""))}</span><button class="btn o" data-file="f${i}">Choisir un fichier</button></div></div></div>`).join("")}</div>
<p class="sub" style="margin-top:14px">Les données du document restent dynamiques : client, lignes, montants, dates, numéro, etc.</p>`
  );
};

/* ===================== Formulaires ===================== */
// Options : "texte" ou { v: valeur, l: libellé }. f.v = valeur par défaut.
function openForm(title, fields, ok) {
  const m = document.createElement("div");
  m.className = "md";
  const opt = (o, sel) => {
    const v = typeof o === "object" ? o.v : o, l = typeof o === "object" ? o.l : o;
    return `<option value="${esc(v)}"${String(v) === String(sel) ? " selected" : ""}>${esc(l)}</option>`;
  };
  m.innerHTML = `<form class="mc"><h2>${title}</h2>${fields.map((f) => `<label>${f.l}${f.t === "select" ? `<select name="${f.k}">${f.o.map((o) => opt(o, f.v)).join("")}</select>` : `<input name="${f.k}" type="${f.t || "text"}" ${f.t === "number" ? 'min="0" step="any"' : ""} ${f.r === 0 ? "" : "required"} value="${esc(f.v ?? "")}">`}</label>`).join("")}<p class="er" role="alert"></p><div class="fa"><button type="button" class="btn o" data-x>Annuler</button><button class="btn">Enregistrer</button></div></form>`;
  document.body.appendChild(m);
  const cl = () => m.remove();
  m.querySelector("[data-x]").onclick = cl;
  m.onclick = (e) => { if (e.target === m) cl(); };
  m.onkeydown = (e) => { if (e.key === "Escape") cl(); };
  m.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    const b = e.target.querySelector(".fa .btn:last-child");
    b.disabled = true;
    try {
      await ok(Object.fromEntries(new FormData(e.target)));
      await load();
      cl();
      render();
    } catch (err) {
      e.target.querySelector(".er").textContent = err.message || String(err);
      b.disabled = false;
    }
  };
  m.querySelector("input,select").focus();
}
const clientOpts = () => db.clients.map((c) => ({ v: c.id, l: c.n }));
const chantierOpts = () => [{ v: "", l: "Sans chantier" }, ...db.chantiers.map((c) => ({ v: c.id, l: `${c.n} (${c.cl})` }))];
const TVA = ["20", "10", "5.5", "0"];
const needClients = () => {
  if (!db.clients.length) { alert("Créez d'abord un client."); go("clients"); return true; }
};
const NEW = {
  chantiers: () => needClients() || openForm("Nouveau chantier", [
    { k: "n", l: "Nom du chantier" },
    { k: "cl", l: "Client", t: "select", o: clientOpts() },
    { k: "v", l: "Ville", r: 0 },
    { k: "m", l: "Montant du marché (€)", t: "number" },
    { k: "av", l: "Avancement (%)", t: "number", v: 0 },
  ], (o) => q(sb.from("chantiers").insert({ nom: o.n, client_id: o.cl, ville: o.v || null, montant_marche: +o.m, avancement: Math.min(100, +o.av) }))),
  clients: () => openForm("Nouveau client", [
    { k: "n", l: "Nom" },
    { k: "ty", l: "Type", t: "select", o: ["Particulier", "Professionnel"] },
    { k: "v", l: "Ville", r: 0 },
    { k: "e", l: "Email", t: "email", r: 0 },
    { k: "tel", l: "Téléphone", r: 0 },
  ], (o) => q(sb.from("clients").insert({ nom: o.n, type: o.ty, ville: o.v || null, email: o.e || null, telephone: o.tel || null }))),
  devis: () => needClients() || openForm("Nouveau devis", [
    { k: "cl", l: "Client", t: "select", o: clientOpts() },
    { k: "ch", l: "Chantier", t: "select", o: chantierOpts() },
    { k: "m", l: "Montant HT (€)", t: "number" },
    { k: "tva", l: "TVA (%)", t: "select", o: TVA },
    { k: "d", l: "Date", t: "date", v: today() },
  ], (o) => q(sb.from("devis").insert({ client_id: o.cl, chantier_id: o.ch || null, montant_ht: +o.m, taux_tva: +o.tva, date_devis: o.d }))),
  factures: () => needClients() || openForm("Nouvelle facture", [
    { k: "cl", l: "Client", t: "select", o: clientOpts() },
    { k: "ch", l: "Chantier", t: "select", o: chantierOpts() },
    { k: "m", l: "Montant HT (€)", t: "number" },
    { k: "tva", l: "TVA (%)", t: "select", o: TVA },
    { k: "d", l: "Échéance", t: "date", v: localDay(new Date(Date.now() + 30 * 864e5)) },
  ], (o) => q(sb.from("factures").insert({ client_id: o.cl, chantier_id: o.ch || null, montant_ht: +o.m, taux_tva: +o.tva, echeance: o.d }))),
  paiements: () => {
    const f = ouvertes();
    if (!f.length) return alert("Aucune facture émise à régler. Émettez d'abord une facture (bouton « Émettre »).");
    openForm("Enregistrer un paiement", [
      { k: "f", l: "Facture", t: "select", o: f.map((x) => ({ v: x.id, l: `${x.num} · ${x.cl} · reste ${E2(x.reste)}` })) },
      { k: "m", l: "Montant (€)", t: "number" },
      { k: "mo", l: "Mode", t: "select", o: ["Virement", "Chèque", "Carte", "Espèces"] },
      { k: "d", l: "Date", t: "date", v: today() },
    ], (o) => q(sb.from("paiements").insert({ facture_id: o.f, montant: +o.m, mode: o.mo, date_paiement: o.d })));
  },
};

// Actions rapides des boutons dans les tableaux
const ACT = {
  devisStatut: (id, s) => q(sb.from("devis").update({ statut: s }).eq("id", id)),
  devisDel: (id) => confirm("Supprimer ce brouillon de devis ?") && q(sb.from("devis").delete().eq("id", id)),
  devisFacturer: async (id) => { await q(sb.rpc("devis_vers_facture", { p_devis: id })); route = "factures"; },
  factureStatut: (id, s) => (s !== "Annulée" || confirm("Annuler cette facture ? Elle restera dans la numérotation.")) && q(sb.from("factures").update({ statut: s }).eq("id", id)),
  factureDel: (id) => confirm("Supprimer ce brouillon de facture ?") && q(sb.from("factures").delete().eq("id", id)),
  chantierEdit: async (id) => {
    const c = db.chantiers.find((x) => x.id === id);
    openForm(`Mettre à jour · ${esc(c.n)}`, [
      { k: "av", l: "Avancement (%)", t: "number", v: c.av },
      { k: "s", l: "Statut", t: "select", o: ["En cours", "À surveiller", "À facturer", "Terminé"], v: c.s },
    ], (o) => q(sb.from("chantiers").update({ avancement: Math.min(100, +o.av), statut: o.s }).eq("id", id)));
  },
};

/* ===================== Rendu & navigation ===================== */
function render() {
  $("#v").innerHTML = V[route]();
  document.querySelectorAll(".nav").forEach((n) => n.setAttribute("aria-current", n.dataset.go === route ? "page" : "false"));
  const s = $("#q");
  if (s) s.oninput = () => {
    const t = s.value.toLowerCase().trim();
    document.querySelectorAll("tbody tr[data-t]").forEach((r) => (r.hidden = !r.dataset.t.includes(t)));
  };
}
function go(r) {
  route = r;
  ed = false;
  render();
  window.scrollTo(0, 0);
}
$("#side").innerHTML =
  `<div class="logo"><i>P</i>Pilot</div>` +
  NAV.map(([k, l]) => `<button class="nav" data-go="${k}">${svg(ic[k])}${l}</button>`).join("") +
  `<div class="sp"></div><button class="nav" data-go="params">${svg(ic.params)}Paramètres</button><button class="nav" data-do="logout||">${svg(ic.ar)}Déconnexion</button>`;
$("#bell").innerHTML = svg(ic.bell);
$("#th").innerHTML = svg(ic.moon);
$("#th").onclick = () => setTh(th === "dark" ? "light" : "dark");

const saveEnt = (extra = {}) =>
  q(sb.from("entreprise").upsert({ user_id: uid, nom: db.ent.n, siret: db.ent.s, adresse: db.ent.a, email: db.ent.e, ...extra }));

document.addEventListener("click", async (e) => {
  const t = e.target;
  let x;
  if ((x = t.closest("[data-do]"))) {
    const [a, id, arg] = x.dataset.do.split("|");
    if (a === "logout") return sb.auth.signOut();
    x.disabled = true;
    try {
      await ACT[a](id, arg);
      await load();
    } catch (err) {
      alert(err.message || err);
    }
    return render();
  }
  if ((x = t.closest("[data-go]"))) return go(x.dataset.go);
  if (t.closest("[data-new]") && NEW[route]) return NEW[route]();
  if ((x = t.closest("[data-p]"))) { period = x.dataset.p; return render(); }
  if ((x = t.closest("[data-file]"))) return document.getElementById(x.dataset.file).click();
  if ((x = t.closest("[data-act]"))) {
    if (x.dataset.act === "save") {
      document.querySelectorAll("[data-ent]").forEach((i) => (db.ent[i.dataset.ent] = i.value));
      try { await saveEnt(); } catch (err) { return alert(err.message); }
    }
    ed = x.dataset.act === "edit";
    render();
  }
});
document.addEventListener("change", async (e) => {
  const el = e.target;
  if (el.type === "file") {
    const f = el.files[0], s = el.parentElement.querySelector(".fn"), k = el.id === "f0" ? "devis" : "facture";
    if (!f || !s) return;
    s.textContent = "Envoi…";
    try {
      const path = `${uid}/modeles/${k}-${Date.now()}-${f.name.replace(/[^\w.-]/g, "_")}`;
      const { error } = await sb.storage.from("documents").upload(path, f);
      if (error) throw error;
      await saveEnt({ ["modele_" + k + "_fichier"]: path });
      db.fich[k] = path;
      s.textContent = f.name;
    } catch (err) {
      s.textContent = "Échec : " + (err.message || err);
    }
  }
  if (el.dataset.tpl) {
    db.tpl[el.dataset.tpl] = el.value;
    try { await saveEnt({ ["modele_" + el.dataset.tpl]: el.value }); } catch (err) { alert(err.message); }
  }
});

/* ===================== Connexion ===================== */
const authBox = (html) => {
  let a = $("#au");
  if (!a) { a = document.createElement("div"); a.id = "au"; a.className = "au"; document.body.appendChild(a); }
  a.innerHTML = html;
  return a;
};
function showSetup() {
  authBox(`<div class="box"><h2>Configuration requise</h2><p class="sub">Ouvrez <b>config.js</b> et collez l'URL de votre projet Supabase ainsi que la clé « anon / publishable » (Project Settings → API). Rechargez ensuite cette page.</p></div>`);
}
function showLogin(msg = "") {
  const a = authBox(`<form><h2>Pilot · Connexion</h2><label>Email<input name="e" type="email" autocomplete="username" required></label><label>Mot de passe<input name="p" type="password" autocomplete="current-password" minlength="6" required></label><p class="er" role="alert">${esc(msg)}</p><div class="row2"><button class="btn" data-m="in">Se connecter</button><button type="button" class="btn o" data-m="up">Créer le compte</button></div></form>`);
  const f = a.querySelector("form"), er = a.querySelector(".er");
  const run = async (mode) => {
    if (!f.reportValidity()) return;
    er.textContent = "";
    const c = { email: f.e.value, password: f.p.value };
    const { data, error } = mode === "up" ? await sb.auth.signUp(c) : await sb.auth.signInWithPassword(c);
    if (error) er.textContent = error.message;
    else if (mode === "up" && !data.session) er.textContent = "Compte créé. Confirmez votre email puis connectez-vous.";
  };
  f.onsubmit = (e) => { e.preventDefault(); run("in"); };
  f.querySelector('[data-m="up"]').onclick = () => run("up");
}
async function start(session) {
  uid = session.user.id;
  email = session.user.email || "";
  $("#av").textContent = email.slice(0, 2).toUpperCase();
  authBox(`<div class="box">Chargement…</div>`);
  try {
    await load();
    $("#au")?.remove();
    render();
  } catch (err) {
    authBox(`<div class="box"><h2>Erreur de chargement</h2><p class="er">${esc(err.message || err)}</p><p class="sub">Avez-vous exécuté <b>supabase/schema.sql</b> dans le SQL Editor ?</p><button class="btn o" onclick="location.reload()">Réessayer</button></div>`);
  }
}

setTh(th);
if (!sb) showSetup();
else {
  sb.auth.onAuthStateChange((ev, s) => {
    // setTimeout : évite d'appeler Supabase à l'intérieur du callback d'auth
    setTimeout(() => {
      if (!s) { uid = null; db = empty(); showLogin(); }
      else if (s.user.id !== uid) start(s);
    }, 0);
  });
}
