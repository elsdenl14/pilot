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
  String(s ?? "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
const chip = (s) =>
  `<span class="chip ${{ "En cours": "c-ok", Accepté: "c-ok", Payée: "c-ok", Envoyée: "c-wn", "À surveiller": "c-wn", Envoyé: "c-wn", "À facturer": "c-ac" }[s] || "c-n"}">${s}</span>`;
const hdr = (eb, t, sub, r = "") =>
  `<div class="hd"><div><div class="eb">${eb}</div><h1>${t}</h1><p class="sub">${sub}</p></div>${r}</div>`;
const kpi = (l, v, s, c = "") =>
  `<div class="kpi"><small>${l}</small><b class="num">${v}</b><span class="${c}">${s}</span></div>`;
const tbl = (cols, rows) =>
  `<div class="tw"><table><thead><tr>${cols.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map((r) => `<tr data-t="${esc(r.t.toLowerCase())}"${r.o ? ` data-o="${r.o}" tabindex="0"` : ""}>${r.c.map((x) => `<td>${x}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${cols.length}">Rien à afficher pour le moment. Utilisez le bouton en haut à droite pour ajouter un élément.</td></tr>`}</tbody></table></div>`;
const list = (eb, t, sub, cta, ph, cols, rows, meta) =>
  hdr(eb, t, sub, `<button class="btn" data-new>${cta}</button>`) +
  `<div class="sr"><input id="q" type="search" placeholder="${ph}" aria-label="${ph}"><span class="cnt">${meta}</span></div><div class="card">${tbl(cols, rows)}</div>`;
const chR = (c, i) => ({
  o: "chantiers:" + i,
  t: `${c.n} ${c.cl} ${c.v}`,
  c: [
    `<strong>${esc(c.n)}</strong><small>${esc(c.cl)} · ${esc(c.v)}</small>`,
    `<b>${c.av} %</b><div class="bar"><i style="width:${c.av}%"></i></div>`,
    `<span class="num">${E(c.m)}</span>`,
    chip(c.s),
  ],
});
const doc = (t) => (x, i) => ({
  o: t + ":" + i,
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
    db.clients.map((c, i) => ({
      o: "clients:" + i,
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
    db.devis.map(doc("devis")),
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
    db.factures.map(doc("factures")),
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
      ["t", "Téléphone"],
      ["ib", "IBAN"],
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
      n.setAttribute("aria-current", n.dataset.go === curNav() ? "page" : "false"),
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
/* ===== Fiches cliquables, éditeur de devis/facture, transformation, PDF ===== */
let sel = {},
  dr = {};
const CX = {
  "Jean Dupont": ["8 rue Colbert", "37000", "jean.dupont@mail.fr", "06 12 34 56 78"],
  "Martin SARL": ["27 avenue de Vendôme", "41000", "contact@martin-sarl.fr", "02 54 11 22 33"],
  "Sophie Durand": ["15 rue Bannier", "45000", "sophie.durand@mail.fr", "06 98 76 54 32"],
  BatiCentre: ["4 zone artisanale Les Prés", "18100", "info@baticentre.fr", "02 48 55 66 77"],
  "Paul Morel": ["31 rue Jacques Cœur", "18000", "paul.morel@mail.fr", "07 44 55 66 77"],
};
db.clients.forEach((c) => {
  const x = CX[c.n];
  if (x && c.ad === undefined) [c.ad, c.cp, c.em, c.tel] = x;
});
db.ent.t ??= "02 54 00 00 00";
db.ent.ib ??= "FR76 3000 4000 5000 6000 7000 189";

const curNav = () => (route === "detail" ? sel.t : route === "edit" ? dr.t : route);
const cl = (n) => db.clients.find((k) => k.n === n) || {};
const p30 = () => new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
const lines = (x) =>
  x.lines && x.lines.length
    ? x.lines
    : [{ d: "Prestation – " + x.ch, q: 1, u: "forfait", pu: +(x.m / 1.2).toFixed(2), tva: 20 }];
const tot = (ls) => {
  let ht = 0,
    tv = 0;
  ls.forEach((l) => {
    const h = (+l.q || 0) * (+l.pu || 0);
    ht += h;
    tv += (h * (+l.tva || 0)) / 100;
  });
  return { ht, tv, ttc: ht + tv };
};
const openItem = (t, i) => {
  sel = { t, i };
  route = "detail";
  render();
  window.scrollTo(0, 0);
};
const clk = (n) => {
  const i = db.clients.findIndex((k) => k.n === n);
  return i < 0 ? esc(n) : `<button class="lk" data-open="clients:${i}">${esc(n)}</button>`;
};
const back = (t, l) => `<button class="lk" data-go="${t}" style="margin-bottom:12px">← ${l}</button>`;
const info = (rows) =>
  rows.map(([l, v]) => `<div class="row"><small>${l}</small><b>${v}</b></div>`).join("");
const sect = (eb, t, f) => {
  const r = db[t].map((x, i) => ({ x, i })).filter((o) => f(o.x));
  return `<div class="card" style="margin-top:16px"><div class="ch"><div><div class="eb">${eb}</div><b>${r.length}</b></div></div>${tbl(
    t === "chantiers"
      ? ["Chantier", "Avancement", "Marché", "Statut"]
      : ["Document", "Date", "Montant", "Statut"],
    r.map((o) => (t === "chantiers" ? chR(o.x, o.i) : doc(t)(o.x, o.i))),
  )}</div>`;
};

/* ---- Fiches ---- */
const fClient = (c) =>
  back("clients", "Clients") +
  hdr("Fiche client", esc(c.n), `${c.ty} · ${esc(c.v)}`, `<button class="btn" data-a="newDevis">+ Nouveau devis</button>`) +
  `<div class="card">${info([
    ["Adresse", esc(c.ad ? `${c.ad}, ${c.cp || ""} ${c.v}` : c.v)],
    ["Email", esc(c.em || "—")],
    ["Téléphone", esc(c.tel || "—")],
  ])}</div><div class="kp">${kpi("Chantiers", c.ch, "")}${kpi("Chiffre d'affaires", E(c.ca), "")}${kpi("À encaisser", E(c.du), c.du ? "En attente" : "À jour", c.du ? "dn" : "up")}</div>` +
  sect("Chantiers", "chantiers", (x) => x.cl === c.n) +
  sect("Devis", "devis", (x) => x.cl === c.n) +
  sect("Factures", "factures", (x) => x.cl === c.n);
const fChantier = (c) =>
  back("chantiers", "Chantiers") +
  hdr("Fiche chantier", esc(c.n), esc(c.v), `<button class="btn" data-a="newDevis">+ Nouveau devis</button>`) +
  `<div class="card">${info([
    ["Client", clk(c.cl)],
    ["Ville", esc(c.v)],
    ["Avancement", `${c.av} %<div class="bar"><i style="width:${c.av}%"></i></div>`],
    ["Marché", `<span class="num">${E(c.m)}</span>`],
    ["Statut", chip(c.s)],
  ])}</div>` +
  sect("Devis", "devis", (x) => x.ch === c.n) +
  sect("Factures", "factures", (x) => x.ch === c.n);

/* ---- Document (aperçu = PDF) ---- */
const paper = (x, t) => {
  const e = db.ent,
    c = cl(x.cl),
    ls = lines(x),
    T = tot(ls),
    isD = t === "devis",
    ac = x.ac ?? 30,
    em = x.de || (isD ? x.d : "");
  return `<div class="paper"><div class="ph"><div class="lg">${esc(e.n.split(" ").map((w) => w[0]).slice(0, 2).join(""))}</div><div class="pt1"><h2>${isD ? "DEVIS" : "FACTURE"}</h2><p>Numéro : <b>${esc(x.num)}</b></p><p>Date d'émission : ${em ? D(em) : "—"}</p><p>${isD ? `Validité : ${x.val ?? 3} mois` : `Échéance : ${D(x.d)}`}</p></div></div>
<div class="pb"><div><b>${esc(e.n)}</b><br>${esc(e.a)}<br>Tél : ${esc(e.t || "")}<br>Mail : ${esc(e.e)}<br>SIRET : ${esc(e.s)}</div><div><b>Client :</b><br>${esc(x.cl)}<br>${esc(c.ad || "")}<br>${esc(c.cp || "")} ${esc(c.v || "")}<br>${esc(c.em || "")}</div></div>
${x.obj ? `<p><b>Objet :</b> ${esc(x.obj)}</p>` : ""}
<table class="pl"><thead><tr>${["Désignation", "Qté", "Unité", "PU HT", "% TVA", "Total TVA", "Total HT"].map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${ls
    .map((l) => {
      const h = (+l.q || 0) * (+l.pu || 0);
      return `<tr><td class="l">${esc(l.d)}</td><td>${l.q}</td><td>${esc(l.u)}</td><td>${E2(l.pu)}</td><td>${l.tva} %</td><td>${E2((h * l.tva) / 100)}</td><td>${E2(h)}</td></tr>`;
    })
    .join("")}</tbody></table>
<div class="pf"><div>${isD ? `<b>Conditions de règlement :</b><p>Acompte de ${ac} % à la commande : <b>${E2((T.ttc * ac) / 100)}</b></p><p>Solde à la livraison.</p>` : x.from ? `<p>Issue du devis ${esc(x.from)}</p>` : ""}</div>
<table class="pt"><tr><th>Total HT</th><td>${E2(T.ht)}</td></tr><tr><th>Total TVA</th><td>${E2(T.tv)}</td></tr><tr><th>Net à payer</th><td><b>${E2(T.ttc)}</b></td></tr></table></div>
${isD ? `<div class="sg">Signature du client (précédée de la mention « Bon pour accord »)</div>` : ""}
<p class="pft">${esc(e.n)} · SIRET ${esc(e.s)}${e.ib ? ` · IBAN ${esc(e.ib)}` : ""}</p></div>`;
};
const fDoc = (x, t) => {
  const isD = t === "devis",
    ST = isD ? ["Brouillon", "Envoyé", "Accepté", "Refusé"] : ["Brouillon", "Envoyée", "Payée"],
    ok = !isD || ["Brouillon", "Envoyé"].includes(x.s),
    acc = isD && x.s === "Accepté";
  return (
    back(t, isD ? "Devis" : "Factures") +
    hdr(
      isD ? "Devis" : "Facture",
      esc(x.num),
      `${clk(x.cl)} · ${esc(x.ch)}${isD && !acc ? " · Passez le statut à « Accepté » pour le transformer en facture." : ""}`,
      `<div class="fa" style="flex-wrap:wrap"><select class="ei" data-st aria-label="Statut" style="width:auto">${ST.map((s) => `<option ${s === x.s ? "selected" : ""}>${s}</option>`).join("")}</select>${ok ? `<button class="btn o" data-a="edit">Modifier</button>` : ""}${acc ? (x.fact ? `<button class="btn o" data-a="seeFac">Voir la facture ${esc(x.fact)}</button>` : `<button class="btn o" data-a="toFac">Transformer en facture</button>`) : ""}<button class="btn" data-a="pdf">Télécharger en PDF</button></div>`,
    ) +
    `<div class="pv">${paper(x, t)}</div>`
  );
};
V.detail = () => {
  const { t, i } = sel,
    x = (db[t] || [])[i];
  if (!x) {
    route = t || "home";
    return V[route]();
  }
  return t === "clients" ? fClient(x) : t === "chantiers" ? fChantier(x) : fDoc(x, t);
};

/* ---- Éditeur ---- */
const fld = (l, k, v, ty = "text", ex = "") =>
  `<label class="lb">${l}<input class="ei" data-f="${k}" type="${ty}" ${ty === "number" ? 'min="0" step="any"' : ""} value="${esc(v)}" ${ex}></label>`;
const totHtml = (T, x) =>
  `<div class="row"><span>Total HT</span><b class="num">${E2(T.ht)}</b></div><div class="row"><span>Total TVA</span><b class="num">${E2(T.tv)}</b></div><div class="row"><span>Net à payer (TTC)</span><b class="num" style="font-size:18px">${E2(T.ttc)}</b></div>${dr.t === "devis" ? `<div class="row"><span>Acompte ${x.ac} %</span><b class="num">${E2((T.ttc * x.ac) / 100)}</b></div>` : ""}`;
V.edit = () => {
  const { t, x } = dr,
    isD = t === "devis",
    c = cl(x.cl),
    chs = ["Sans chantier", ...db.chantiers.filter((h) => h.cl === x.cl).map((h) => h.n)];
  if (!chs.includes(x.ch)) x.ch = "Sans chantier";
  const opt = (a, v) => a.map((o) => `<option ${o === v ? "selected" : ""}>${esc(o)}</option>`).join("");
  return (
    hdr(
      isD ? "Commercial" : "Finances",
      `${dr.i === null ? "Nouveau" : "Modifier le"} ${isD ? "devis" : "facture"}`,
      `Numéro ${esc(x.num)}`,
      `<div class="fa"><button class="btn o" data-a="cancel">Annuler</button><button class="btn" data-a="saveDoc">Enregistrer</button></div>`,
    ) +
    `<div class="card"><div class="ch"><div><div class="eb">Informations</div><b>Client et chantier</b></div></div><div class="pad"><div class="fg"><label class="lb">Client<select class="ei" data-f="cl">${opt(cn(), x.cl)}</select></label><label class="lb">Chantier<select class="ei" data-f="ch">${opt(chs, x.ch)}</select></label>${
      isD
        ? fld("Date du devis", "d", x.d, "date") + fld("Validité (mois)", "val", x.val, "number") + fld("Acompte (%)", "ac", x.ac, "number")
        : fld("Date d'émission", "de", x.de, "date") + fld("Échéance", "d", x.d, "date")
    }${fld("Objet", "obj", x.obj, "text", 'placeholder="Ex : Rénovation cuisine"')}</div><div class="note" style="margin:0"><b>${esc(x.cl)}</b><br>${esc(c.ad || "Adresse non renseignée")}, ${esc(c.cp || "")} ${esc(c.v || "")}<br>${esc(c.em || "")} ${esc(c.tel || "")}</div></div></div>
<div class="g2"><div class="card"><div class="ch"><div><div class="eb">Prestations</div><b>Lignes</b></div><button class="btn o" data-a="addL">+ Ajouter une ligne</button></div><div class="tw ed"><table><thead><tr>${["Désignation", "Qté", "Unité", "PU HT (€)", "TVA %", "Total HT", ""].map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${x.lines
      .map(
        (l, k) =>
          `<tr><td><input class="ei li" style="min-width:200px" data-l="${k}:d" value="${esc(l.d)}" placeholder="Désignation" aria-label="Désignation"></td><td><input class="ei li" type="number" min="0" step="any" data-l="${k}:q" value="${l.q}" aria-label="Quantité"></td><td><input class="ei li" data-l="${k}:u" value="${esc(l.u)}" aria-label="Unité"></td><td><input class="ei li" type="number" min="0" step="any" data-l="${k}:pu" value="${l.pu}" aria-label="Prix unitaire HT"></td><td><select class="ei li" data-l="${k}:tva" aria-label="TVA">${[0, 5.5, 10, 20].map((v) => `<option ${+l.tva === v ? "selected" : ""}>${v}</option>`).join("")}</select></td><td class="num" id="lt${k}">${E2((+l.q || 0) * (+l.pu || 0))}</td><td><button class="lk" data-a="rm" data-k="${k}" aria-label="Supprimer la ligne">✕</button></td></tr>`,
      )
      .join("")}</tbody></table></div></div>
<div class="card"><div class="ch"><div><div class="eb">Totaux</div><b>Calcul automatique</b></div></div><div id="ttot">${totHtml(tot(x.lines), x)}</div></div></div>`
  );
};
const startEdit = (t, i = null, cli, ch) => {
  const n =
    t === "devis"
      ? nextNum(db.devis)
      : "FAC-2026-" + String(Math.max(0, ...db.factures.map((f) => +f.num.slice(9) || 0)) + 1).padStart(3, "0");
  const x =
    i !== null
      ? JSON.parse(JSON.stringify(db[t][i]))
      : { num: n, cl: cli || (db.clients[0] || {}).n || "", ch: ch || "Sans chantier", obj: "", s: "Brouillon", de: today(), d: t === "devis" ? today() : p30() };
  x.lines = i !== null ? JSON.parse(JSON.stringify(lines(x))) : [{ d: "", q: 1, u: "u", pu: 0, tva: 20 }];
  x.val ??= 3;
  x.ac ??= 30;
  x.de ||= x.d;
  dr = { t, i, x };
  route = "edit";
  render();
  window.scrollTo(0, 0);
};
NEW.devis = () => startEdit("devis");
NEW.factures = () => startEdit("factures");
NEW.clients = () =>
  openForm(
    "Nouveau client",
    [
      { k: "n", l: "Nom" },
      { k: "ty", l: "Type", t: "select", o: ["Particulier", "Professionnel"] },
      { k: "ad", l: "Adresse", r: 0 },
      { k: "cp", l: "Code postal", r: 0 },
      { k: "v", l: "Ville" },
      { k: "em", l: "Email", t: "email", r: 0 },
      { k: "tel", l: "Téléphone", t: "tel", r: 0 },
    ],
    (o) => db.clients.push({ ...o, ch: 0, ca: 0, du: 0 }),
  );

/* ---- Actions ---- */
const upd = () => {
  dr.x.lines.forEach((l, k) => {
    const e = $("#lt" + k);
    if (e) e.textContent = E2((+l.q || 0) * (+l.pu || 0));
  });
  $("#ttot").innerHTML = totHtml(tot(dr.x.lines), dr.x);
};
const A = {
  pdf() {
    const x = db[sel.t][sel.i],
      p = document.createElement("div"),
      old = document.title;
    p.id = "print";
    p.innerHTML = paper(x, sel.t);
    document.body.appendChild(p);
    document.title = (sel.t === "devis" ? "Devis " : "Facture ") + x.num;
    const done = () => {
      p.remove();
      document.title = old;
      window.removeEventListener("afterprint", done);
    };
    window.addEventListener("afterprint", done);
    window.print();
  },
  edit: () => startEdit(sel.t, sel.i),
  cancel: () => (dr.i === null ? go(dr.t) : openItem(dr.t, dr.i)),
  addL() {
    dr.x.lines.push({ d: "", q: 1, u: "u", pu: 0, tva: 20 });
    render();
    const f = document.querySelectorAll('[data-l$=":d"]');
    f[f.length - 1]?.focus();
  },
  rm(d) {
    dr.x.lines.splice(+d.k, 1);
    if (!dr.x.lines.length) dr.x.lines.push({ d: "", q: 1, u: "u", pu: 0, tva: 20 });
    render();
  },
  saveDoc() {
    const { t, i, x } = dr;
    x.lines = x.lines.filter((l) => String(l.d).trim());
    if (!x.lines.length) {
      x.lines = [{ d: "", q: 1, u: "u", pu: 0, tva: 20 }];
      render();
      return alert("Ajoutez au moins une ligne avec une désignation.");
    }
    x.m = +tot(x.lines).ttc.toFixed(2);
    if (t === "devis") x.de = x.d;
    if (i === null) db[t].unshift(x);
    else db[t][i] = x;
    save();
    openItem(t, i === null ? 0 : i);
  },
  toFac() {
    const x = db.devis[sel.i],
      n = "FAC-2026-" + String(Math.max(0, ...db.factures.map((f) => +f.num.slice(9) || 0)) + 1).padStart(3, "0");
    db.factures.unshift({ num: n, cl: x.cl, ch: x.ch, obj: x.obj, lines: JSON.parse(JSON.stringify(lines(x))), m: x.m, de: today(), d: p30(), s: "Brouillon", from: x.num });
    x.fact = n;
    save();
    openItem("factures", 0);
  },
  seeFac() {
    const i = db.factures.findIndex((f) => f.num === db.devis[sel.i].fact);
    if (i >= 0) openItem("factures", i);
  },
  newDevis() {
    const o = db[sel.t][sel.i];
    sel.t === "clients" ? startEdit("devis", null, o.n) : startEdit("devis", null, o.cl, o.n);
  },
};
document.addEventListener("click", (e) => {
  const t = e.target;
  let x;
  if ((x = t.closest("[data-open]"))) {
    const [a, b] = x.dataset.open.split(":");
    return openItem(a, +b);
  }
  if ((x = t.closest("[data-a]")) && A[x.dataset.a]) return A[x.dataset.a](x.dataset);
  if ((x = t.closest("tr[data-o]"))) {
    const [a, b] = x.dataset.o.split(":");
    openItem(a, +b);
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.matches("tr[data-o]")) e.target.click();
});
document.addEventListener("input", (e) => {
  const t = e.target;
  if (t.dataset.st) {
    db[sel.t][sel.i].s = t.value;
    save();
    return render();
  }
  if (route !== "edit") return;
  if (t.dataset.l) {
    const [k, f] = t.dataset.l.split(":");
    dr.x.lines[k][f] = ["q", "pu", "tva"].includes(f) ? +t.value : t.value;
    return upd();
  }
  const f = t.dataset.f;
  if (!f) return;
  dr.x[f] = t.type === "number" ? +t.value : t.value;
  if (f === "cl") render();
  else if (f === "ac") upd();
});

setTh(th);
render();
