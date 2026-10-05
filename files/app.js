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
const SEED = {
  chantiers: [
    {
      n: "Rénovation Dupont",
      cl: "Jean Dupont",
      v: "Tours",
      av: 82,
      m: 48500,
      s: "En cours",
    },
    {
      n: "Maison Martin",
      cl: "Martin SARL",
      v: "Blois",
      av: 61,
      m: 126000,
      s: "À surveiller",
    },
    {
      n: "Appartement Durand",
      cl: "Sophie Durand",
      v: "Orléans",
      av: 91,
      m: 31800,
      s: "En cours",
    },
    {
      n: "Extension BatiCentre",
      cl: "BatiCentre",
      v: "Vierzon",
      av: 44,
      m: 54000,
      s: "En cours",
    },
    {
      n: "Rénovation Morel",
      cl: "Paul Morel",
      v: "Bourges",
      av: 94,
      m: 21600,
      s: "À facturer",
    },
  ],
  clients: [
    { n: "Jean Dupont", ty: "Particulier", v: "Tours", ch: 2, ca: 70500, du: 8000 },
    { n: "Martin SARL", ty: "Professionnel", v: "Blois", ch: 3, ca: 164800, du: 8450 },
    { n: "Sophie Durand", ty: "Particulier", v: "Orléans", ch: 2, ca: 58300, du: 0 },
    { n: "BatiCentre", ty: "Professionnel", v: "Vierzon", ch: 2, ca: 46900, du: 0 },
    { n: "Paul Morel", ty: "Particulier", v: "Bourges", ch: 1, ca: 21600, du: 2400 },
  ],
  devis: [
    {
      num: "q-042",
      cl: "BatiCentre",
      ch: "Extension BatiCentre",
      d: "2026-10-04",
      m: 28800,
      s: "Brouillon",
    },
    {
      num: "q-041",
      cl: "Jean Dupont",
      ch: "Rénovation Dupont",
      d: "2026-09-30",
      m: 29400,
      s: "Envoyé",
    },
    {
      num: "q-039",
      cl: "Martin SARL",
      ch: "Sans chantier",
      d: "2026-09-26",
      m: 21840,
      s: "Accepté",
    },
    {
      num: "q-037",
      cl: "Sophie Durand",
      ch: "Appartement Durand",
      d: "2026-09-24",
      m: 15480,
      s: "Accepté",
    },
  ],
  factures: [
    {
      num: "FAC-2026-001",
      cl: "Martin SARL",
      ch: "Sans chantier",
      d: "2026-11-03",
      m: 21840,
      s: "Brouillon",
    },
  ],
  paiements: [
    { d: "2026-10-03", cl: "Sophie Durand", f: "FAC-2026-018", m: 14250, mo: "Virement" },
    { d: "2026-10-02", cl: "Jean Dupont", f: "FAC-2026-021", m: 12000, mo: "Virement" },
    { d: "2026-09-29", cl: "BatiCentre", f: "FAC-2026-015", m: 9800, mo: "Virement" },
    { d: "2026-09-26", cl: "Martin SARL", f: "FAC-2026-010", m: 18000, mo: "Chèque" },
  ],
  ent: {
    n: "Entreprise Générale Martin",
    s: "123 456 789 00012",
    a: "12 rue des Artisans, 41000 Blois",
    e: "contact@eg-martin.fr",
  },
  tpl: { devis: "Devis standard", facture: "Facture standard" },
};
const M = [
  ["Nov", 61],
  ["Déc", 68],
  ["Jan", 55],
  ["Fév", 72],
  ["Mar", 67],
  ["Avr", 78],
  ["Mai", 73],
  ["Juin", 88],
  ["Juil", 76],
  ["Août", 81],
  ["Sept", 74],
  ["Oct", 84],
];
let db,
  route = "home",
  period = "12",
  ed = false,
  th = "dark";
try {
  db = JSON.parse(localStorage.getItem("pilot-v1"));
} catch (e) {}
if (!db) db = JSON.parse(JSON.stringify(SEED));
try {
  th = localStorage.getItem("pilot-th") || "dark";
} catch (e) {}
const save = () => {
  try {
    localStorage.setItem("pilot-v1", JSON.stringify(db));
  } catch (e) {}
};
const setTh = (t) => {
  th = t;
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem("pilot-th", t);
  } catch (e) {}
};
const E = (n) =>
  Number(n)
    .toLocaleString("fr-FR", { maximumFractionDigits: 2 })
    .replace(/\u202f/g, "\u00a0") + "\u00a0€";
const E2 = (n) =>
  Number(n)
    .toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .replace(/\u202f/g, "\u00a0") + "\u00a0€";
const D = (d) => d.split("-").reverse().join("/");
const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
const chip = (s) =>
  `<span class="chip ${{ "En cours": "c-ok", Accepté: "c-ok", "À surveiller": "c-wn", Envoyé: "c-wn", "À facturer": "c-ac" }[s] || "c-n"}">${s}</span>`;
const hdr = (eb, t, sub, r = "") =>
  `<div class="hd"><div><div class="eb">${eb}</div><h1>${t}</h1><p class="sub">${sub}</p></div>${r}</div>`;
const kpi = (l, v, s, c = "") =>
  `<div class="kpi"><small>${l}</small><b class="num">${v}</b><span class="${c}">${s}</span></div>`;
const tbl = (cols, rows) =>
  `<div class="tw"><table><thead><tr>${cols.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map((r) => `<tr data-t="${esc(r.t.toLowerCase())}">${r.c.map((x) => `<td>${x}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${cols.length}">Rien à afficher pour le moment. Utilisez le bouton en haut à droite pour ajouter un élément.</td></tr>`}</tbody></table></div>`;
const list = (eb, t, sub, cta, ph, cols, rows, meta) =>
  hdr(eb, t, sub, `<button class="btn" data-new>${cta}</button>`) +
  `<div class="sr"><input id="q" type="search" placeholder="${ph}" aria-label="${ph}"><span class="cnt">${meta}</span></div><div class="card">${tbl(cols, rows)}</div>`;
const chR = (c) => ({
  t: `${c.n} ${c.cl} ${c.v}`,
  c: [
    `<strong>${esc(c.n)}</strong><small>${esc(c.cl)} · ${esc(c.v)}</small>`,
    `<b>${c.av} %</b><div class="bar"><i style="width:${c.av}%"></i></div>`,
    `<span class="num">${E(c.m)}</span>`,
    chip(c.s),
  ],
});
const doc = (x, c) => ({
  t: `${x.num} ${x.cl} ${x.ch}`,
  c: [
    `<strong>${x.num}</strong><small>${esc(x.cl)} · ${esc(x.ch)}</small>`,
    D(x.d),
    `<span class="num">${E2(x.m)}</span>`,
    chip(x.s),
  ],
});
const V = {};
V.home = () =>
  hdr(
    new Date().toLocaleDateString("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }),
    "Bonjour Jean",
    "Voici les éléments qui méritent votre attention.",
  ) +
  `<div class="card at"><div class="ch"><div><div class="eb">À votre attention</div><b>Les sujets à traiter en priorité</b></div><button class="lk" data-go="factures">Tout afficher ${svg(ic.ar)}</button></div>${[
    ["3 factures en retard", "2 clients concernés", 12450],
    ["4 clients à relancer", "Dernier échange depuis plus de 7 jours", 0],
    ["7 devis en attente", "5 ont été envoyés cette semaine", 58200],
  ]
    .map(
      (a) =>
        `<div class="row"><div><b>${a[0]}</b><small>${a[1]}</small></div>${a[2] ? `<span class="num">${E(a[2])}</span>` : ""}</div>`,
    )
    .join("")}</div>
<div class="kp">${kpi("Chantiers en cours", "12", "3 à surveiller")}${kpi("CA du mois", E(84250), "↑ 12 % vs septembre", "up")}${kpi("Devis en attente", "7", "58 200 € de potentiel")}${kpi("À encaisser", E(31480), "dont 12 450 € en retard")}</div>
<div class="g2"><div class="card"><div class="ch"><div><div class="eb">Chantiers</div><b>Vue opérationnelle</b></div><button class="lk" data-go="chantiers">Voir les chantiers ${svg(ic.ar)}</button></div>${tbl(["Chantier", "Avancement", "Montant", "Statut"], db.chantiers.slice(0, 3).map(chR))}</div>
<div class="card"><div class="ch"><div><div class="eb">Finances</div><b>À suivre</b></div></div>${[
    ["Factures en retard", 12450, "dn"],
    ["À encaisser", 31480, ""],
    ["Devis acceptés", 42800, ""],
    ["Reste à facturer", 116500, ""],
  ]
    .map(
      (r) =>
        `<div class="row"><span>${r[0]}</span><span class="num ${r[2]}">${E(r[1])}</span></div>`,
    )
    .join("")}</div></div>`;
V.chantiers = () =>
  list(
    "Opérations",
    "Chantiers",
    "Les chantiers actifs, leur avancement et ce qu'il reste à facturer.",
    "+ Nouveau chantier",
    "Rechercher un chantier, un client, une ville…",
    ["Chantier", "Avancement", "Marché", "Statut"],
    db.chantiers.map(chR),
    `${db.chantiers.length} chantiers · ${db.chantiers.filter((c) => c.s === "À surveiller").length} à surveiller`,
  );
V.clients = () =>
  list(
    "Relation client",
    "Clients",
    "Tous les clients et leur situation financière au même endroit.",
    "+ Nouveau client",
    "Rechercher par nom, ville…",
    ["Client", "Chantiers", "CA", "À encaisser"],
    db.clients.map((c) => ({
      t: `${c.n} ${c.v} ${c.ty}`,
      c: [
        `<strong>${esc(c.n)}</strong><small>${c.ty} · ${esc(c.v)}</small>`,
        c.ch,
        `<span class="num">${E(c.ca)}</span>`,
        `<span class="num ${c.du ? "dn" : ""}">${E(c.du)}</span>`,
      ],
    })),
    `${db.clients.length} clients`,
  );
V.devis = () =>
  list(
    "Commercial",
    "Devis",
    "Créer, envoyer et suivre les propositions commerciales.",
    "+ Nouveau devis",
    "Rechercher un numéro, client, chantier…",
    ["Devis", "Date", "Montant", "Statut"],
    db.devis.map(doc),
    `${db.devis.length} devis · ${E(db.devis.filter((d) => d.s === "Brouillon" || d.s === "Envoyé").reduce((a, d) => a + d.m, 0))} en attente`,
  );
V.factures = () =>
  list(
    "Finances",
    "Factures",
    "Suivi de la facturation, des échéances et des règlements.",
    "+ Nouvelle facture",
    "Rechercher un numéro, client, chantier…",
    ["Facture", "Échéance", "Montant", "Statut"],
    db.factures.map(doc),
    `${db.factures.length} facture${db.factures.length > 1 ? "s" : ""} · à jour en temps réel`,
  );
V.paiements = () =>
  hdr(
    "Trésorerie",
    "Paiements",
    "Règlements reçus, associés aux factures et aux chantiers.",
    `<button class="btn" data-new>+ Enregistrer un paiement</button>`,
  ) +
  `<div class="kp" style="grid-template-columns:repeat(auto-fit,minmax(220px,300px))">${kpi("Encaissé ce mois", E(54050), "↑ 10,1 %", "up")}${kpi("À encaisser", E(31480), "dont 12 450 € en retard")}${kpi("Délai moyen", "34 j", "−4 jours", "up")}</div><div class="card"><div class="ch"><div><div class="eb">Journal des règlements</div><b>Derniers paiements</b></div></div>${tbl(
    ["Date", "Client / facture", "Montant", "Mode"],
    db.paiements.map((p) => ({
      t: `${p.cl} ${p.f} ${p.mo}`,
      c: [
        `<b>${new Date(p.d).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })}</b>`,
        `<b>${esc(p.cl)}</b><small>${esc(p.f)}</small>`,
        `<span class="num">${E(p.m)}</span>`,
        p.mo,
      ],
    })),
  )}</div>`;
const chart = () => {
  const d = period === "y" ? M.slice(2) : M.slice(-Number(period)),
    mx = Math.max(...d.map((x) => x[1])),
    w = 600 / d.length;
  return (
    `<svg class="chart" viewBox="0 0 600 250" role="img" aria-label="Chiffre d'affaires mensuel en milliers d'euros">` +
    d
      .map((x, i) => {
        const h = (x[1] / mx) * 180,
          xx = i * w + w * 0.18,
          bw = w * 0.64;
        return `<rect x="${xx}" y="${215 - h}" width="${bw}" height="${h}" rx="2" fill="var(--acc)"/><text x="${xx + bw / 2}" y="${208 - h}" text-anchor="middle" class="t b">${x[1]}k</text><text x="${xx + bw / 2}" y="236" text-anchor="middle" class="t">${x[0]}</text>`;
      })
      .join("") +
    `</svg>`
  );
};
V.analyses = () =>
  hdr(
    "Pilotage",
    "Analyses",
    "Les chiffres utiles pour piloter l'activité et prendre les décisions.",
    `<div class="seg">${[
      ["12", "12 mois"],
      ["6", "6 mois"],
      ["y", "Cette année"],
    ]
      .map(
        ([v, l]) => `<button data-p="${v}" aria-pressed="${period === v}">${l}</button>`,
      )
      .join("")}</div>`,
  ) +
  `<div class="kp">${kpi("CA sur 12 mois", E(918450), "↑ 8,4 %", "up")}${kpi("Marge estimée", E(184600), "20,1 % du CA")}${kpi("Carnet de commandes", E(426800), "17 chantiers signés")}${kpi("Taux de transformation", "55 %", "+5 points", "up")}</div>
<div class="g2"><div class="card"><div class="ch"><div><div class="eb">Évolution</div><b>Chiffre d'affaires mensuel</b></div></div>${chart()}</div>
<div class="card"><div class="ch"><div><div class="eb">Commercial</div><b>Devis</b></div></div>${[
    ["Devis créés", 31],
    ["Envoyés", 28],
    ["Acceptés", 17],
    ["En attente", 7],
    ["Refusés", 7],
  ]
    .map((r) => `<div class="row"><span>${r[0]}</span><b class="num">${r[1]}</b></div>`)
    .join(
      "",
    )}<p class="note">58 200 € de potentiel commercial reste à convertir.</p></div></div>
<div class="g2"><div class="card"><div class="ch"><div><div class="eb">Encaissement</div><b>Créances</b></div></div>${[
    ["À l'heure", 25800, ""],
    ["1–30 jours", 3600, ""],
    ["31–60 jours", 5200, "dn"],
    ["60+ jours", 3650, "dn"],
  ]
    .map(
      (r) =>
        `<div class="row"><span>${r[0]}</span><b class="num ${r[2]}">${E(r[1])}</b></div>`,
    )
    .join("")}</div>
<div class="card"><div class="ch"><div><div class="eb">Clients</div><b>Top clients par CA</b></div></div>${[
    ...db.clients,
  ]
    .sort((a, b) => b.ca - a.ca)
    .slice(0, 5)
    .map(
      (c, i) =>
        `<div class="row"><span class="num" style="color:var(--mut)">0${i + 1}</span><div style="flex:1"><b>${esc(c.n)}</b><small>${c.ch} chantier${c.ch > 1 ? "s" : ""}</small></div><span class="num">${E(c.ca)}</span></div>`,
    )
    .join("")}</div></div>`;
V.params = () => {
  const e = db.ent;
  return (
    hdr("Configuration", "Paramètres", "Les réglages de l'entreprise et des documents.") +
    `<div class="card" style="max-width:680px"><div class="ch"><div><div class="eb">Entreprise</div><b>Identité</b></div></div>${[
      ["n", "Nom"],
      ["s", "SIRET"],
      ["a", "Adresse"],
      ["e", "Email"],
    ]
      .map(
        ([k, l]) =>
          `<div class="row"><small>${l}</small>${ed ? `<input class="ei" data-ent="${k}" value="${esc(e[k])}" aria-label="${l}">` : `<b>${esc(e[k])}</b>`}</div>`,
      )
      .join(
        "",
      )}<div class="row"><button class="btn o" data-act="${ed ? "save" : "edit"}">${ed ? "Enregistrer" : "Modifier les informations"}</button></div></div>
<div class="g3">${[
      ["devis", "Modèle de devis"],
      ["facture", "Modèle de facture"],
    ]
      .map(
        ([k, t], i) =>
          `<div class="card"><div class="ch"><div><b>${t}</b><small style="color:var(--mut)">Votre document de référence et votre charte graphique.</small></div><span class="chip c-ok">Actif</span></div><div class="pad"><label class="lb">Nom du modèle<input data-tpl="${k}" value="${esc(db.tpl[k])}"></label><div class="drop"><div><b>Importer un document de référence</b><small style="display:block;color:var(--mut);font-size:12px">PDF ou image. Le fichier reste privé sur cet appareil.</small></div><input type="file" id="f${i}" accept=".pdf,image/*" hidden><span class="fn"></span><button class="btn o" data-file="f${i}">Choisir un fichier</button></div></div></div>`,
      )
      .join("")}</div>
<p class="sub" style="margin-top:14px">Les données du document restent dynamiques : client, lignes, montants, dates, numéro, etc.</p>`
  );
};
function openForm(title, fields, ok) {
  const m = document.createElement("div");
  m.className = "md";
  m.innerHTML = `<form class="mc"><h2>${title}</h2>${fields.map((f) => `<label>${f.l}${f.t === "select" ? `<select name="${f.k}">${f.o.map((o) => `<option>${esc(o)}</option>`).join("")}</select>` : `<input name="${f.k}" type="${f.t || "text"}" ${f.t === "number" ? 'min="0" step="any"' : ""} ${f.r === 0 ? "" : "required"} value="${f.v ?? ""}">`}</label>`).join("")}<div class="fa"><button type="button" class="btn o" data-x>Annuler</button><button class="btn">Enregistrer</button></div></form>`;
  document.body.appendChild(m);
  const cl = () => m.remove();
  m.querySelector("[data-x]").onclick = cl;
  m.onclick = (e) => {
    if (e.target === m) cl();
  };
  m.onkeydown = (e) => {
    if (e.key === "Escape") cl();
  };
  m.querySelector("form").onsubmit = (e) => {
    e.preventDefault();
    ok(Object.fromEntries(new FormData(e.target)));
    save();
    cl();
    render();
  };
  m.querySelector("input,select").focus();
}
const cn = () => db.clients.map((c) => c.n),
  today = () => new Date().toISOString().slice(0, 10);
const nextNum = (a) =>
  "q-" + String(Math.max(0, ...a.map((d) => +d.num.slice(2))) + 1).padStart(3, "0");
const NEW = {
  chantiers: () =>
    openForm(
      "Nouveau chantier",
      [
        { k: "n", l: "Nom du chantier" },
        { k: "cl", l: "Client", t: "select", o: cn() },
        { k: "v", l: "Ville" },
        { k: "m", l: "Montant du marché (€)", t: "number" },
        { k: "av", l: "Avancement (%)", t: "number", v: 0 },
      ],
      (o) => {
        db.chantiers.unshift({
          n: o.n,
          cl: o.cl,
          v: o.v,
          av: Math.min(100, +o.av),
          m: +o.m,
          s: "En cours",
        });
        const c = db.clients.find((x) => x.n === o.cl);
        if (c) {
          c.ch++;
          c.ca += +o.m;
        }
      },
    ),
  clients: () =>
    openForm(
      "Nouveau client",
      [
        { k: "n", l: "Nom" },
        { k: "ty", l: "Type", t: "select", o: ["Particulier", "Professionnel"] },
        { k: "v", l: "Ville" },
      ],
      (o) => db.clients.push({ n: o.n, ty: o.ty, v: o.v, ch: 0, ca: 0, du: 0 }),
    ),
  devis: () =>
    openForm(
      "Nouveau devis",
      [
        { k: "cl", l: "Client", t: "select", o: cn() },
        {
          k: "ch",
          l: "Chantier",
          t: "select",
          o: ["Sans chantier", ...db.chantiers.map((c) => c.n)],
        },
        { k: "m", l: "Montant (€)", t: "number" },
        { k: "d", l: "Date", t: "date", v: today() },
      ],
      (o) =>
        db.devis.unshift({
          num: nextNum(db.devis),
          cl: o.cl,
          ch: o.ch,
          d: o.d,
          m: +o.m,
          s: "Brouillon",
        }),
    ),
  factures: () =>
    openForm(
      "Nouvelle facture",
      [
        { k: "cl", l: "Client", t: "select", o: cn() },
        {
          k: "ch",
          l: "Chantier",
          t: "select",
          o: ["Sans chantier", ...db.chantiers.map((c) => c.n)],
        },
        { k: "m", l: "Montant (€)", t: "number" },
        {
          k: "d",
          l: "Échéance",
          t: "date",
          v: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
        },
      ],
      (o) =>
        db.factures.unshift({
          num: "FAC-2026-" + String(db.factures.length + 1).padStart(3, "0"),
          cl: o.cl,
          ch: o.ch,
          d: o.d,
          m: +o.m,
          s: "Brouillon",
        }),
    ),
  paiements: () =>
    openForm(
      "Enregistrer un paiement",
      [
        { k: "cl", l: "Client", t: "select", o: cn() },
        { k: "f", l: "Facture (numéro)" },
        { k: "m", l: "Montant (€)", t: "number" },
        {
          k: "mo",
          l: "Mode",
          t: "select",
          o: ["Virement", "Chèque", "Carte", "Espèces"],
        },
        { k: "d", l: "Date", t: "date", v: today() },
      ],
      (o) => {
        db.paiements.unshift({ d: o.d, cl: o.cl, f: o.f, m: +o.m, mo: o.mo });
        const c = db.clients.find((x) => x.n === o.cl);
        if (c) c.du = Math.max(0, c.du - +o.m);
      },
    ),
};
function render() {
  $("#v").innerHTML = V[route]();
  document
    .querySelectorAll(".nav")
    .forEach((n) =>
      n.setAttribute("aria-current", n.dataset.go === route ? "page" : "false"),
    );
  const q = $("#q");
  if (q)
    q.oninput = () => {
      const s = q.value.toLowerCase().trim();
      document
        .querySelectorAll("tbody tr[data-t]")
        .forEach((r) => (r.hidden = !r.dataset.t.includes(s)));
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
  NAV.map(
    ([k, l]) => `<button class="nav" data-go="${k}">${svg(ic[k])}${l}</button>`,
  ).join("") +
  `<div class="sp"></div><button class="nav" data-go="params">${svg(ic.params)}Paramètres</button>`;
$("#bell").innerHTML = svg(ic.bell);
$("#th").innerHTML = svg(ic.moon);
$("#th").onclick = () => setTh(th === "dark" ? "light" : "dark");
document.addEventListener("click", (e) => {
  const t = e.target;
  let x;
  if ((x = t.closest("[data-go]"))) return go(x.dataset.go);
  if (t.closest("[data-new]") && NEW[route]) return NEW[route]();
  if ((x = t.closest("[data-p]"))) {
    period = x.dataset.p;
    return render();
  }
  if ((x = t.closest("[data-file]")))
    return document.getElementById(x.dataset.file).click();
  if ((x = t.closest("[data-act]"))) {
    if (x.dataset.act === "save")
      document
        .querySelectorAll("[data-ent]")
        .forEach((i) => (db.ent[i.dataset.ent] = i.value));
    save();
    ed = x.dataset.act === "edit";
    render();
  }
});
document.addEventListener("change", (e) => {
  if (e.target.type === "file") {
    const s = e.target.parentElement.querySelector(".fn");
    if (s) s.textContent = e.target.files[0] ? e.target.files[0].name : "";
  }
});
document.addEventListener("input", (e) => {
  if (e.target.dataset.tpl) {
    db.tpl[e.target.dataset.tpl] = e.target.value;
    save();
  }
});
setTh(th);
render();
