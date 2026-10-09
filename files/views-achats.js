/* Suivi financier par chantier (prévu / réel / marge) et module Fournisseurs & achats */

const norm = (s) => String(s ?? "").trim().toLowerCase();
const pc = (n, d) => (d > 0 ? Math.round((n / d) * 100) : 0);
const sg = (n) => (n > 0 ? "+" : n < 0 ? "-" : "") + E(Math.abs(n));
const budgetOf = (id) => db.budgets.find((b) => b.chantier_id === id);
const supName = (id) => byId(db.fournisseurs, id)?.nom || "-";
const chName = (id) => byId(db.chantiers, id)?.nom || "-";

const FIN_LINES = [
  { k: "materiaux", l: "Matériaux", cat: "Matériaux" },
  { k: "main_oeuvre", l: "Main-d'œuvre", cat: "Main-d'œuvre" },
  { k: "sous_traitance", l: "Sous-traitance", cat: "Sous-traitance" },
];
const FIN_NAMES = { materiaux: "Matériaux", main_oeuvre: "Main-d'œuvre", sous_traitance: "Sous-traitance", autres: "Autres coûts" };
const lineOf = (cat) => (FIN_LINES.find((x) => x.cat === cat) || { k: "autres" }).k;
const ENGAGE = new Set(["Commandée", "Livrée"]); // commandes passées, pas encore facturées
const SETUP_V5 = `<p class="emp" style="padding:18px;margin:0;color:var(--mut)">Pour activer ce module, exécutez <b>migration_v5.sql</b> dans Supabase (SQL Editor), puis rechargez la page.</p>`;

/* ===================== Suivi financier d'un chantier ===================== */
// Prévu  = budget saisi sur le chantier.
// Réel   = dépenses rattachées au chantier (HT).
// Engagé = commandes fournisseurs passées mais pas encore facturées (comptées dans "reste" pour ne pas se faire surprendre).
// Marge prévue = marché - budget. Marge actuelle = marché - coûts réels.
// Baisse de marge = (prévue - actuelle) / prévue.
function chFin(c) {
  const b = budgetOf(c.id);
  const base = c.montant_marche || sum(db.devis.filter((d) => d.chantier_id === c.id && d.statut === "Accepté"), (d) => d.montant_ht);
  const lines = { autres: { prevu: 0, reel: 0, engage: 0 } };
  FIN_LINES.forEach((x) => (lines[x.k] = { prevu: b ? Number(b[x.k]) || 0 : 0, reel: 0, engage: 0 }));
  db.depenses.filter((d) => d.chantier_id === c.id).forEach((d) => (lines[lineOf(d.categorie)].reel += d.montant_ht));
  db.achats
    .filter((a) => a.chantier_id === c.id && a.type === "Commande" && ENGAGE.has(a.statut))
    .forEach((a) => (lines[lineOf(a.categorie)].engage += a.montant_ht));
  const L = Object.values(lines);
  const budget = sum(L, (l) => l.prevu), reel = sum(L, (l) => l.reel), engage = sum(L, (l) => l.engage);
  const has = !!b && budget > 0 && base > 0;
  const margePrev = r2(base - budget), margeAct = r2(base - reel);
  const baisse = has && margePrev > 0 && margeAct < margePrev ? Math.round(((margePrev - margeAct) / margePrev) * 100) : 0;
  const depass = [], presque = [];
  FIN_LINES.forEach((x) => {
    const l = lines[x.k];
    if (l.prevu <= 0) return;
    const used = l.reel + l.engage, p = pc(used, l.prevu);
    if (used > l.prevu + 0.005) depass.push({ l: x.l, pct: Math.max(1, p - 100), ecart: r2(used - l.prevu) });
    else if (p >= 90) presque.push({ l: x.l, pct: p });
  });
  depass.sort((a, b2) => b2.pct - a.pct);
  let lv = null; // u = urgent, i = important, s = à suivre
  if (has) {
    const w = depass[0];
    if (margeAct < 0 || baisse >= 30) lv = "u";
    else if (baisse >= 10 || (w && w.pct >= 10)) lv = "i";
    else if (baisse > 0 || w || presque.length) lv = "s";
  }
  return { has, base, lines, budget, reel, engage, margePrev, margeAct, baisse, depass, presque, lv };
}
const finTitle = (f) =>
  f.margeAct < 0 ? "Marge négative"
  : f.baisse > 0 ? `Marge en baisse de ${f.baisse} %`
  : f.depass.length ? `${f.depass[0].l} au-dessus du budget`
  : "Budget presque consommé";
function finDetail(f) {
  const w = f.depass[0];
  if (f.margeAct < 0 || f.baisse > 0)
    return `${E(f.margeAct)} au lieu de ${E(f.margePrev)} prévus${w ? ` · ${w.l.toLowerCase()} +${w.pct} % au-dessus du budget` : ""}`;
  if (w) return `${E(w.ecart)} de dépassement (+${w.pct} %)`;
  return f.presque.length ? `${f.presque[0].l.toLowerCase()} consommé à ${f.presque[0].pct} % du budget` : "";
}
function finChip(c) {
  if (c.statut === "Terminé" || !db.v5) return "";
  const f = chFin(c);
  if (!f.lv) return "";
  const t = f.margeAct < 0 ? "Marge négative" : f.baisse > 0 ? `Marge -${f.baisse} %` : "Budget à surveiller";
  return ` <span class="chip ${f.lv === "u" ? "dn" : f.lv === "i" ? "wn" : "n"}">${t}</span>`;
}
const pbar = (p) =>
  `<div class="pbl"><div class="pb"><i class="${p > 100 ? "dn" : p >= 90 ? "wn" : ""}" style="width:${Math.min(p, 100)}%"></i></div><small>${p} %</small></div>`;

function finCard(c) {
  const f = chFin(c);
  const head = btn("Définir le budget", "chantierBudget", c.id, "", "o sm w") + btn("Ajouter de la main-d'œuvre", "depMO", c.id, "", "o sm w");
  const alert = f.lv && c.statut !== "Terminé" ? `<div class="fin-alert ${f.lv}"><b>${finTitle(f)}</b><span>${esc(finDetail(f))}</span></div>` : "";
  const noBudget = !f.has
    ? `<p class="emp" style="padding:14px 18px;margin:0;color:var(--mut)">${f.base ? "Définissez le budget prévu (matériaux, main-d'œuvre, sous-traitance)" : "Indiquez le montant du marché et le budget prévu"} : Pilot compare ensuite chaque dépense au budget et vous prévient dès que la marge baisse.</p>`
    : "";
  const rows = [...FIN_LINES.map((x) => x.k), "autres"].map((k) => {
    const l = f.lines[k], used = l.reel + l.engage, reste = r2(l.prevu - used);
    return { c: [
      `<strong>${FIN_NAMES[k]}</strong>${l.engage ? `<small>dont ${E(l.engage)} engagés en commandes</small>` : ""}`,
      l.prevu ? `<span class="num">${E(l.prevu)}</span>` : "-",
      `<span class="num">${E(l.reel)}</span>`,
      l.prevu ? `<span class="num ${reste < 0 ? "dn" : ""}">${E(reste)}</span>` : "-",
      l.prevu ? pbar(pc(used, l.prevu)) : "",
    ] };
  });
  const resteTot = r2(f.budget - f.reel - f.engage);
  rows.push({ cls: "tot", c: ["Total des coûts", f.budget ? `<span class="num">${E(f.budget)}</span>` : "-", `<span class="num">${E(f.reel)}</span>`,
    f.budget ? `<span class="num ${resteTot < 0 ? "dn" : ""}">${E(resteTot)}</span>` : "-", f.budget ? pbar(pc(f.reel + f.engage, f.budget)) : ""] });
  if (f.has)
    rows.push({ cls: "tot", c: ["Marge", `<span class="num">${E(f.margePrev)}</span>`, `<span class="num ${f.margeAct < 0 ? "dn" : ""}">${E(f.margeAct)}</span>`,
      `<span class="num ${f.margeAct < f.margePrev ? "dn" : "up"}">${sg(r2(f.margeAct - f.margePrev))}</span>`, `<small>${pc(f.margeAct, f.base)} % du marché</small>`] });
  return strip([
    ["Montant du marché (HT)", E(f.base), c.montant_marche ? "montant convenu" : "devis acceptés"],
    ["Marge prévue", f.has ? E(f.margePrev) : "-", f.has ? `${pc(f.margePrev, f.base)} % du marché` : "budget à définir"],
    ["Marge actuelle", f.has ? E(f.margeAct) : "-", f.baisse > 0 ? `en baisse de ${f.baisse} %` : f.has ? "dans les prévisions" : "budget à définir", f.margeAct < 0 || f.baisse >= 10 ? "dn" : ""],
    ["Coûts réels (HT)", E(f.reel), f.budget ? `sur ${E(f.budget)} prévus` : "aucun budget défini"],
  ]) + card("Suivi financier : prévu et réel", alert + noBudget +
    tbl(["Poste", { h: "Prévu HT", r: 1 }, { h: "Réel HT", r: 1 }, { h: "Reste / écart", r: 1 }, "Budget consommé"], rows), head, "mb");
}
function achatsCard(c) {
  if (!db.v5) return "";
  const l = db.achats.filter((a) => a.chantier_id === c.id);
  return card("Devis et commandes fournisseurs",
    tbl(["Fournisseur", "Date", { h: "HT", r: 1 }, "Statut"],
      l.map((a) => ({ act: "achatEdit", id: a.id, c: [`<strong>${esc(supName(a.fournisseur_id))}</strong><small>${a.type}${a.numero ? " · " + esc(a.numero) : ""}</small>`, D(a.date_doc), `<span class="num">${E2(a.montant_ht)}</span>`, chip(a.statut)] })),
      "Aucune commande rattachée à ce chantier."),
    btn("Nouvelle commande", "achatNewCh", c.id, "", "o sm w"));
}
function budgetForm(c) {
  if (!guard()) return;
  if (!db.v5) return toast("Exécutez d'abord migration_v5.sql dans Supabase.", "dn");
  const b = budgetOf(c.id) || {};
  const num = (x) => (x ? String(x).replace(".", ",") : "");
  const body = `<div class="frm">
    ${fld({ k: "montant_marche", l: "Montant du devis / marché (€ HT)", t: "number", v: num(c.montant_marche), r: 0, cls: "full", hint: "Ce que le client doit payer, hors taxes. Si vide, Pilot utilise les devis acceptés du chantier." })}
    <div class="sect-t">Coûts prévus (€ HT)</div>
    ${fld({ k: "materiaux", l: "Matériaux", t: "number", v: num(b.materiaux), r: 0 })}
    ${fld({ k: "main_oeuvre", l: "Main-d'œuvre", t: "number", v: num(b.main_oeuvre), r: 0 })}
    ${fld({ k: "sous_traitance", l: "Sous-traitance", t: "number", v: num(b.sous_traitance), r: 0 })}
    <label class="fl"><span>Marge prévue</span><input type="text" id="f_mp" readonly></label></div>`;
  modal(`Budget : ${esc(c.nom)}`, body, {
    onMount: (m) => {
      const accepte = sum(db.devis.filter((d) => d.chantier_id === c.id && d.statut === "Accepté"), (d) => d.montant_ht);
      const upd = () => {
        const base = parseNum($("#f_montant_marche", m).value) || accepte;
        const cost = parseNum($("#f_materiaux", m).value) + parseNum($("#f_main_oeuvre", m).value) + parseNum($("#f_sous_traitance", m).value);
        $("#f_mp", m).value = base ? `${E(base - cost)} (${pc(base - cost, base)} %)` : "-";
      };
      m.addEventListener("input", upd);
      upd();
    },
    onSubmit: async (v, api) => {
      const row = { chantier_id: c.id, materiaux: parseNum(v.materiaux), main_oeuvre: parseNum(v.main_oeuvre), sous_traitance: parseNum(v.sous_traitance), updated_at: new Date().toISOString() };
      if (row.materiaux < 0 || row.main_oeuvre < 0 || row.sous_traitance < 0) throw new Error("Les montants ne peuvent pas être négatifs.");
      await q(sb.from("chantiers").update({ montant_marche: parseNum(v.montant_marche) }).eq("id", c.id));
      await q(sb.from("chantier_budgets").upsert(row, { onConflict: "chantier_id" }));
      api.close();
      toast("Budget enregistré.", "ok");
      await refresh();
    },
  });
}

/* ===================== Fournisseurs ===================== */
const depsOf = (f) => db.depenses.filter((d) => norm(d.fournisseur) === norm(f.nom));
// Fiches créées + fournisseurs déjà vus dans vos factures (sans fiche)
function supplierList() {
  const reg = db.fournisseurs.map((f) => ({ ...f, virtual: false }));
  const known = new Set(reg.map((f) => norm(f.nom)));
  const seen = new Map();
  db.depenses.forEach((d) => { const k = norm(d.fournisseur); if (k && !known.has(k) && !seen.has(k)) seen.set(k, String(d.fournisseur).trim()); });
  return [...reg, ...[...seen.values()].map((nom) => ({ id: null, nom, virtual: true }))];
}
const engagees = () => db.achats.filter((a) => a.type === "Commande" && ENGAGE.has(a.statut));
const SUP_SUB = "Vos fournisseurs, ce que vous commandez, ce que vous payez, et ce que cela coûte chantier par chantier.";

V.fournisseurs = (r) => {
  if (r.arg) return fournisseurDetail(r.arg);
  const cur = ST.tab.fournisseurs || "liste";
  const t = tabs("fournisseurs", [["liste", "Fournisseurs"], ["commandes", "Devis et commandes"], ["factures", "Factures et dépenses"], ["echeances", "Échéances"], ["chantiers", "Budget par chantier"]], cur);
  if (!db.v5 && ["liste", "commandes", "chantiers"].includes(cur))
    return page("Fournisseurs", SUP_SUB, "", t + card("", SETUP_V5));
  return ({ liste: supTabListe, commandes: supTabCommandes, factures: supTabFactures, echeances: supTabEcheances, chantiers: supTabChantiers })[cur](t);
};

function supTabListe(t) {
  const yr = String(new Date().getFullYear()), list = supplierList();
  const virt = list.filter((f) => f.virtual).length;
  const rows = list.map((f) => {
    const dp = depsOf(f), ap = dp.filter((d) => d.statut === "À payer"), last = dp[0]?.date_depense;
    return {
      go: f.id ? `fournisseurs/${f.id}` : undefined, t: `${f.nom} ${f.ville || ""} ${f.categorie || ""} ${f.contact || ""}`,
      c: [`<strong>${esc(f.nom)}</strong><small>${esc(f.categorie || "Sans fiche")}${f.ville ? " · " + esc(f.ville) : ""}</small>`,
        f.virtual ? btn("Créer la fiche", "fournisseurNew", "", f.nom, "o sm w") : `${esc(f.contact || "-")}<small>${esc(f.telephone || f.email || "")}</small>`,
        `<span class="num">${E(sum(dp.filter((d) => String(d.date_depense).startsWith(yr)), (d) => d.montant_ht))}</span>`,
        `<span class="num">${E(sum(dp, (d) => d.montant_ht))}</span>`,
        `<span class="num ${ap.length ? "dn" : ""}">${E(sum(ap, (d) => d.montant_ttc))}</span>`, last ? D(last) : "-"],
    };
  });
  const echu = depensesAPayer().filter((d) => d.echeance && d.echeance < today());
  return page("Fournisseurs", SUP_SUB, btn("Nouveau fournisseur", "fournisseurNew", "", "", "w"),
    t + strip([
      ["Fournisseurs", db.fournisseurs.length, virt ? `${virt} à enregistrer (vus dans vos factures)` : "fiches créées"],
      [`Dépensé en ${yr} (HT)`, E(sum(db.depenses.filter((d) => String(d.date_depense).startsWith(yr)), (d) => d.montant_ht)), "factures et dépenses"],
      ["À payer (TTC)", E(sum(depensesAPayer(), (d) => d.montant_ttc)), echu.length ? `${echu.length} échue${echu.length > 1 ? "s" : ""}` : "rien d'échu", echu.length ? "dn" : ""],
      ["Engagé en commandes (HT)", E(sum(engagees(), (a) => a.montant_ht)), `${engagees().length} commande${engagees().length > 1 ? "s" : ""} non facturée${engagees().length > 1 ? "s" : ""}`],
    ]) + searchBar("Rechercher un fournisseur, une catégorie, une ville…", `${list.length} fournisseur${list.length > 1 ? "s" : ""}`) +
      card("", tbl(["Fournisseur", "Contact", { h: `Dépensé ${yr} HT`, r: 1 }, { h: "Total HT", r: 1 }, { h: "À payer TTC", r: 1 }, "Dernier achat"], rows,
        "Aucun fournisseur. Créez une fiche, ou importez une facture fournisseur : le fournisseur apparaîtra ici.")));
}

// Prochaine étape d'un devis / d'une commande : [libellé du bouton, nouveau statut]
const achatNext = (a) =>
  a.type === "Devis" ? (a.statut === "En attente" ? ["Accepter", "Accepté"] : a.statut === "Accepté" ? ["Commander", "__cmd"] : null)
  : a.statut === "Commandée" ? ["Reçue", "Livrée"] : a.statut === "Livrée" ? ["Facturée", "Facturée"] : null;

function supTabCommandes(t) {
  const rows = db.achats.map((a) => {
    const n = achatNext(a);
    return { t: `${a.numero || ""} ${supName(a.fournisseur_id)} ${chName(a.chantier_id)} ${a.type}`,
      c: [`<strong>${esc(supName(a.fournisseur_id))}</strong><small>${a.type}${a.numero ? " · " + esc(a.numero) : ""}${a.categorie ? " · " + esc(a.categorie) : ""}</small>`,
        esc(chName(a.chantier_id)), `${D(a.date_doc)}${a.date_livraison ? `<small>livraison ${D(a.date_livraison)}</small>` : ""}`,
        `<span class="num">${E2(a.montant_ht)}</span>`, chip(a.statut),
        `<span class="r">${n ? btn(n[0], "achatStatut", a.id, n[1], "o sm w") : ""} ${btn("Modifier", "achatEdit", a.id, "", "o sm w")}</span>`] };
  });
  const sm = (f) => sum(db.achats.filter(f), (a) => a.montant_ht), nb = (f) => db.achats.filter(f).length;
  const dv = (a) => a.type === "Devis" && a.statut === "En attente", cm = (a) => a.type === "Commande" && a.statut === "Commandée", lv = (a) => a.type === "Commande" && a.statut === "Livrée";
  return page("Fournisseurs", SUP_SUB, btn("Nouvelle commande", "achatNew", "", "Commande", "w") + btn("Nouveau devis fournisseur", "achatNew", "", "Devis", "o w"),
    t + strip([
      ["Devis en attente", nb(dv), E(sm(dv)) + " HT"], ["À livrer", nb(cm), E(sm(cm)) + " HT"],
      ["Livrées, à facturer", nb(lv), E(sm(lv)) + " HT"], ["Engagé (HT)", E(sum(engagees(), (a) => a.montant_ht)), "commandes non facturées"],
    ]) + searchBar("Rechercher un fournisseur, un chantier, un numéro…", `${db.achats.length} document${db.achats.length > 1 ? "s" : ""}`) +
      card("", tbl(["Fournisseur", "Chantier", "Date", { h: "HT", r: 1 }, "Statut", ""], rows, "Aucun devis ni commande. Enregistrez vos devis fournisseurs et vos bons de commande pour savoir ce qui est déjà engagé.")));
}

function supTabFactures(t) {
  const mois = curMonth(), dm = db.depenses.filter((d) => monthKey(d.date_depense) === mois), ap = depensesAPayer();
  const rows = db.depenses.map((d) => ({ act: "depEdit", id: d.id, t: `${d.fournisseur} ${d.categorie || ""} ${d.reference || ""} ${d.chantier_nom || ""}`,
    c: [`<strong>${esc(d.fournisseur)}</strong><small>${esc(d.categorie || d.type)}${d.reference ? " · " + esc(d.reference) : ""}</small>`, D(d.date_depense), esc(d.chantier_nom || "-"),
      `<span class="num">${E2(d.montant_ht)}</span>`, `<span class="num">${E2(d.montant_ttc)}</span>`,
      d.statut === "À payer" && d.echeance && d.echeance < today() ? `<span class="chip dn">À payer, échue</span>` : chip(d.statut)] }));
  return page("Fournisseurs", SUP_SUB, btn("Importer une facture fournisseur", "depImport", "", "", "w") + btn("Ajouter une dépense", "depNew", "", "", "o w"),
    t + strip([
      ["Achats et dépenses du mois (HT)", E(sum(dm, (d) => d.montant_ht)), `${dm.length} ligne${dm.length > 1 ? "s" : ""}`],
      ["À payer (TTC)", E(sum(ap, (d) => d.montant_ttc)), `${ap.length} facture${ap.length > 1 ? "s" : ""}`],
      ["Payé ce mois (TTC)", E(sum(db.depenses.filter((d) => d.statut === "Payée" && monthKey(d.date_paiement) === mois), (d) => d.montant_ttc)), "décaissements"],
    ]) + searchBar("Rechercher un fournisseur, une catégorie, un chantier…", `${db.depenses.length} ligne${db.depenses.length > 1 ? "s" : ""}`) +
      card("", tbl(["Fournisseur", "Date", "Chantier", { h: "HT", r: 1 }, { h: "TTC", r: 1 }, "Statut"], rows, "Aucune facture fournisseur. Importez un PDF : Pilot lit les montants et les dates.")));
}

function supTabEcheances(t) {
  const t0 = today(), ap = depensesAPayer().sort((a, b) => (a.echeance || "9999").localeCompare(b.echeance || "9999"));
  const dd = (d) => (d.echeance ? daysBetween(t0, d.echeance) : 9999);
  const tot = (f) => E(sum(ap.filter(f), (d) => d.montant_ttc));
  const rows = ap.map((d) => {
    const n = dd(d);
    const chipE = !d.echeance ? `<span class="chip n">sans échéance</span>` : n < 0 ? `<span class="chip dn">échue depuis ${-n} j</span>` : n <= 7 ? `<span class="chip wn">${n === 0 ? "aujourd'hui" : "dans " + n + " j"}</span>` : "";
    return { act: "depEdit", id: d.id, t: `${d.fournisseur} ${d.reference || ""} ${d.chantier_nom || ""}`,
      c: [d.echeance ? D(d.echeance) : "-", `<strong>${esc(d.fournisseur)}</strong><small>${esc(d.reference || d.categorie || "")}</small>`, esc(d.chantier_nom || "-"), chipE,
        `<span class="num">${E2(d.montant_ttc)}</span>`, `<span class="r">${btn("Marquer payée", "depPay", d.id, "", "o sm w")}</span>`] };
  });
  return page("Fournisseurs", SUP_SUB, btn("Ajouter une dépense", "depNew", "", "", "w"),
    t + strip([
      ["Échu", tot((d) => dd(d) < 0), `${ap.filter((d) => dd(d) < 0).length} facture(s)`, ap.some((d) => dd(d) < 0) ? "dn" : ""],
      ["Cette semaine", tot((d) => dd(d) >= 0 && dd(d) <= 7), "dans les 7 jours"],
      ["Sous 30 jours", tot((d) => dd(d) > 7 && dd(d) <= 30), "8 à 30 jours"],
      ["Total à payer", tot(() => true), `${ap.length} facture${ap.length > 1 ? "s" : ""}`],
    ]) + searchBar("Rechercher un fournisseur ou un chantier…", `${ap.length} échéance${ap.length > 1 ? "s" : ""}`) +
      card("", tbl(["Échéance", "Fournisseur", "Chantier", "", { h: "TTC", r: 1 }, ""], rows, "Aucune facture fournisseur à payer.")));
}

// Budget matériaux par chantier : budget, dépensé, engagé, reste
function supTabChantiers(t) {
  const list = db.chantiers.map((c) => ({ c, f: chFin(c) })).filter((x) => x.c.statut !== "Terminé" || x.f.reel > 0);
  const M = (x) => x.f.lines.materiaux;
  const rows = list.map((x) => {
    const m = M(x), reste = r2(m.prevu - m.reel - m.engage);
    return { go: `chantiers/${x.c.id}`, t: `${x.c.nom} ${x.c.client_nom}`,
      c: [`<strong>${esc(x.c.nom)}</strong><small>${esc(x.c.client_nom)}</small>`, m.prevu ? `<span class="num">${E(m.prevu)}</span>` : "-", `<span class="num">${E(m.reel)}</span>`,
        `<span class="num">${E(m.engage)}</span>`, m.prevu ? `<span class="num ${reste < 0 ? "dn" : ""}">${E(reste)}</span>` : "-", `<span class="num">${E(x.f.reel)}</span>`] };
  });
  const bud = sum(list, (x) => M(x).prevu), dep = sum(list, (x) => M(x).reel), eng = sum(list, (x) => M(x).engage);
  return page("Fournisseurs", SUP_SUB, "",
    t + strip([["Budget matériaux", E(bud), "chantiers suivis"], ["Déjà dépensé", E(dep), "factures matériaux"], ["Engagé", E(eng), "commandes non facturées"], ["Reste", E(bud - dep - eng), "budget - dépensé - engagé", bud - dep - eng < 0 ? "dn" : ""]]) +
      searchBar("Rechercher un chantier…", `${list.length} chantier${list.length > 1 ? "s" : ""}`) +
      card("", tbl(["Chantier", { h: "Budget matériaux", r: 1 }, { h: "Dépensé", r: 1 }, { h: "Engagé", r: 1 }, { h: "Reste", r: 1 }, { h: "Tous coûts HT", r: 1 }], rows,
        "Aucun chantier en cours. Définissez un budget sur un chantier pour suivre ce qui reste à dépenser.")));
}

function fournisseurDetail(id) {
  const f = byId(db.fournisseurs, id);
  if (!f) return `<div class="empty"><h2>Fournisseur introuvable</h2><button class="btn" data-go="fournisseurs">Retour aux fournisseurs</button></div>`;
  const dp = depsOf(f), docs = db.achats.filter((a) => a.fournisseur_id === id), yr = String(new Date().getFullYear());
  const ap = dp.filter((d) => d.statut === "À payer"), pay = dp.filter((d) => d.statut === "Payée" && d.date_paiement);
  const delai = pay.length ? Math.round(sum(pay, (d) => daysBetween(d.date_depense, d.date_paiement)) / pay.length) : null;
  const hist = [
    ...dp.map((d) => ({ d: d.date_depense, act: "depEdit", id: d.id, k: "Facture", n: d.reference || d.categorie || "", ch: d.chantier_nom, ht: d.montant_ht, s: d.statut })),
    ...docs.map((a) => ({ d: a.date_doc, act: "achatEdit", id: a.id, k: a.type, n: a.numero || "", ch: byId(db.chantiers, a.chantier_id)?.nom, ht: a.montant_ht, s: a.statut })),
  ].sort((a, b) => String(b.d).localeCompare(String(a.d)));
  const byCh = {};
  dp.forEach((d) => { const k = d.chantier_nom || "Sans chantier"; byCh[k] = (byCh[k] || 0) + d.montant_ht; });
  const chRows = Object.entries(byCh).sort((a, b) => b[1] - a[1]);
  return page(esc(f.nom), esc(f.categorie || ""),
    btn("Modifier", "fournisseurEdit", id, "", "o w") + btn("Nouvelle commande", "achatNew", id, "Commande", "w") + btn("Nouveau devis", "achatNew", id, "Devis", "o w") + btn("Supprimer", "fournisseurDel", id, "", "dn-o w"),
    `${strip([
      [`Dépensé en ${yr} (HT)`, E(sum(dp.filter((d) => String(d.date_depense).startsWith(yr)), (d) => d.montant_ht)), "factures et dépenses"],
      ["Total depuis le début (HT)", E(sum(dp, (d) => d.montant_ht)), `${dp.length} facture${dp.length > 1 ? "s" : ""}`],
      ["À payer (TTC)", E(sum(ap, (d) => d.montant_ttc)), `${ap.length} facture${ap.length > 1 ? "s" : ""}`, ap.some((d) => d.echeance && d.echeance < today()) ? "dn" : ""],
      ["Délai de paiement moyen", delai === null ? "-" : delai + " j", `délai accordé : ${f.delai_paiement_jours} j`],
    ])}
    <div class="g2"><div>
      ${card("Historique", tbl(["Date", "Document", "Chantier", { h: "HT", r: 1 }, "Statut"],
        hist.map((h) => ({ act: h.act, id: h.id, c: [D(h.d), `<strong>${h.k}</strong><small>${esc(h.n)}</small>`, esc(h.ch || "-"), `<span class="num">${E2(h.ht)}</span>`, chip(h.s)] })), "Aucun historique pour ce fournisseur."))}
    </div><div>
      ${card("Coordonnées", `<dl class="kv"><dt>Contact</dt><dd>${esc(f.contact || "-")}</dd><dt>Téléphone</dt><dd>${esc(f.telephone || "-")}</dd><dt>Email</dt><dd>${f.email ? `<a href="mailto:${esc(f.email)}">${esc(f.email)}</a>` : "-"}</dd><dt>Adresse</dt><dd>${esc(f.adresse || "-")}</dd><dt>Ville</dt><dd>${esc(f.ville || "-")}</dd><dt>Notes</dt><dd>${esc(f.notes || "-").replace(/\n/g, "<br>")}</dd></dl>`)}
      ${card("Dépensé par chantier (HT)", chRows.length ? chRows.map(([k, v]) => `<div class="row"><span>${esc(k)}</span><span class="num">${E(v)}</span></div>`).join("") : `<p class="emp" style="padding:18px;margin:0;color:var(--mut)">Aucune dépense.</p>`)}
    </div></div>`,
    crumbs(["Fournisseurs", "fournisseurs"], [f.nom]));
}

function fournisseurForm(f, o = {}) {
  if (!guard()) return;
  if (!db.v5) return toast("Exécutez d'abord migration_v5.sql dans Supabase.", "dn");
  const body = `<div class="frm">
    ${fld({ k: "nom", l: "Nom du fournisseur", v: f?.nom ?? o.nom, cls: "full", hint: f ? "Les factures déjà enregistrées gardent l'ancien nom." : "" })}
    ${fld({ k: "categorie", l: "Catégorie habituelle", t: "select", o: PilotPdf.CATEGORIES, v: f?.categorie || o.categorie || "Matériaux" })}
    ${fld({ k: "delai_paiement_jours", l: "Délai de paiement (jours)", t: "number", v: f ? String(f.delai_paiement_jours) : "30" })}
    ${fld({ k: "contact", l: "Contact", v: f?.contact, r: 0 })}
    ${fld({ k: "telephone", l: "Téléphone", v: f?.telephone, r: 0 })}
    ${fld({ k: "email", l: "Email", t: "email", v: f?.email, r: 0, cls: "full" })}
    ${fld({ k: "adresse", l: "Adresse", v: f?.adresse, r: 0, cls: "full" })}
    ${fld({ k: "ville", l: "Code postal et ville", v: f?.ville, r: 0, cls: "full" })}
    ${fld({ k: "notes", l: "Notes", t: "textarea", v: f?.notes, r: 0, cls: "full" })}</div>`;
  modal(f ? "Modifier le fournisseur" : "Nouveau fournisseur", body, {
    wide: true,
    onSubmit: async (v, api) => {
      const row = { nom: v.nom.trim(), categorie: v.categorie, delai_paiement_jours: Math.max(0, Math.round(parseNum(v.delai_paiement_jours))),
        contact: v.contact || null, telephone: v.telephone || null, email: v.email || null, adresse: v.adresse || null, ville: v.ville || null, notes: v.notes || null };
      try {
        if (f) await q(sb.from("fournisseurs").update(row).eq("id", f.id));
        else await q(sb.from("fournisseurs").insert(row));
      } catch (e) {
        if (e.code === "23505") throw new Error("Un fournisseur porte déjà ce nom.");
        throw e;
      }
      api.close();
      toast(f ? "Fournisseur modifié." : "Fournisseur créé.", "ok");
      await refresh();
    },
  });
}

function achatForm(a, o = {}) {
  if (!guard()) return;
  if (!db.v5) return toast("Exécutez d'abord migration_v5.sql dans Supabase.", "dn");
  if (!db.fournisseurs.length) { toast("Créez d'abord la fiche du fournisseur.", "dn"); return fournisseurForm(null, {}); }
  const g = (k, d = "") => a?.[k] ?? o[k] ?? d;
  const STS = (ty) => (ty === "Devis" ? ["En attente", "Accepté", "Refusé"] : ["Commandée", "Livrée", "Facturée", "Annulée"]);
  const type0 = g("type", "Commande"), sup0 = g("fournisseur_id", o.fournisseur || db.fournisseurs[0].id);
  const ht0 = g("montant_ht", ""), tv0 = g("montant_tva", "");
  const rate = ht0 !== "" && Number(ht0) > 0 && tv0 !== "" ? (Number(tv0) / Number(ht0)) * 100 : 20;
  const known = RATES.find((x) => Math.abs(Number(x) - rate) < 0.25);
  const num = (x) => (x === "" ? "" : String(x).replace(".", ","));
  const body = `<div class="frm">
    ${fld({ k: "type", l: "Type de document", t: "select", o: [{ v: "Commande", l: "Commande (bon de commande)" }, { v: "Devis", l: "Devis fournisseur" }], v: type0 })}
    ${fld({ k: "fournisseur_id", l: "Fournisseur", t: "select", o: db.fournisseurs.map((x) => ({ v: x.id, l: x.nom })), v: sup0 })}
    ${fld({ k: "numero", l: "N° du document", v: g("numero"), r: 0 })}
    ${fld({ k: "chantier_id", l: "Chantier", t: "select", o: [{ v: "", l: "Aucun" }, ...db.chantiers.map((c) => ({ v: c.id, l: c.nom }))], v: g("chantier_id", o.chantier || ""), r: 0 })}
    ${fld({ k: "categorie", l: "Catégorie", t: "select", o: PilotPdf.CATEGORIES, v: g("categorie", byId(db.fournisseurs, sup0)?.categorie || "Matériaux") })}
    ${fld({ k: "statut", l: "Statut", t: "select", o: STS(type0), v: g("statut", STS(type0)[0]) })}
    ${fld({ k: "date_doc", l: "Date", t: "date", v: g("date_doc", today()) })}
    ${fld({ k: "date_livraison", l: "Livraison prévue", t: "date", v: g("date_livraison", ""), r: 0 })}
    <div class="sect-t">Montants</div>
    ${fld({ k: "montant_ht", l: "Montant HT (€)", t: "number", v: num(ht0) })}
    <label class="fl"><span>Taux de TVA</span><select id="f_taux">${RATES.map((x) => `<option value="${x}"${x === known ? " selected" : ""}>${x.replace(".", ",")} %</option>`).join("")}<option value="autre"${known ? "" : " selected"}>Autre</option></select></label>
    ${fld({ k: "montant_tva", l: "TVA (€)", t: "number", v: num(tv0 === "" ? 0 : tv0) })}
    <label class="fl"><span>Total TTC</span><input type="text" id="f_ttc" readonly></label>
    ${fld({ k: "notes", l: "Notes", t: "textarea", v: g("notes"), r: 0, cls: "full" })}</div>`;
  modal(a ? "Modifier le document" : type0 === "Devis" ? "Nouveau devis fournisseur" : "Nouvelle commande", body, {
    wide: true,
    onMount: (m, api) => {
      const ht = $("#f_montant_ht", m), tv = $("#f_montant_tva", m), tx = $("#f_taux", m), tt = $("#f_ttc", m);
      const upd = () => { tt.value = E2(parseNum(ht.value) + parseNum(tv.value)); };
      const fromRate = () => { if (tx.value !== "autre") tv.value = String(r2((parseNum(ht.value) * Number(tx.value)) / 100)).replace(".", ","); upd(); };
      ht.oninput = fromRate; tx.onchange = fromRate;
      tv.oninput = () => { const h = parseNum(ht.value); tx.value = RATES.find((x) => h > 0 && Math.abs(r2((h * Number(x)) / 100) - parseNum(tv.value)) < 0.02) || "autre"; upd(); };
      upd();
      $("#f_type", m).onchange = (e) => { $("#f_statut", m).innerHTML = STS(e.target.value).map((s) => `<option>${s}</option>`).join(""); };
      if (!a) $("#f_fournisseur_id", m).onchange = (e) => {
        const c = byId(db.fournisseurs, e.target.value)?.categorie;
        if (c) $("#f_categorie", m).value = c;
      };
      if (a) {
        $(".fa", m).insertAdjacentHTML("afterbegin", `<button type="button" class="btn dn-o" id="adel" style="margin-right:auto">Supprimer</button>`);
        $("#adel", m).onclick = () => { api.close(); ACT.achatDel(a.id); };
      }
    },
    onSubmit: async (v, api) => {
      const htv = parseNum(v.montant_ht), tvv = parseNum(v.montant_tva);
      if (htv <= 0) throw new Error("Indiquez le montant HT.");
      if (tvv < 0) throw new Error("La TVA ne peut pas être négative.");
      const row = { fournisseur_id: v.fournisseur_id, chantier_id: v.chantier_id || null, type: v.type, numero: v.numero || null, date_doc: v.date_doc,
        date_livraison: v.date_livraison || null, statut: v.statut, categorie: v.categorie, montant_ht: htv, montant_tva: tvv, notes: v.notes || null };
      if (a) await q(sb.from("achats_fournisseurs").update(row).eq("id", a.id));
      else await q(sb.from("achats_fournisseurs").insert(row));
      api.close();
      toast(a ? "Document modifié." : "Document enregistré.", "ok");
      await refresh();
    },
  });
}

/* Formulaire de dépense : suggestions de fournisseurs, délai de paiement, rapprochement avec une commande */
function supplierHints(m, isNew) {
  const inp = $("#f_fournisseur", m);
  if (!inp || !db.v5 || !db.fournisseurs.length) return;
  const dl = document.createElement("datalist");
  dl.id = "dl_four";
  dl.innerHTML = db.fournisseurs.map((f) => `<option value="${esc(f.nom)}">`).join("");
  m.appendChild(dl);
  inp.setAttribute("list", "dl_four");
  if (!isNew) return;
  inp.addEventListener("change", () => {
    const f = db.fournisseurs.find((x) => norm(x.nom) === norm(inp.value));
    if (!f) return;
    const cs = $("#f_categorie", m);
    if (f.categorie && cs && [...cs.options].some((o) => o.value === f.categorie)) { cs.value = f.categorie; cs.onchange?.({ target: cs }); }
    const ec = $("#f_echeance", m), dt = $("#f_date_depense", m);
    if (ec && !ec.value && dt?.value && f.delai_paiement_jours) ec.value = addDays(dt.value, f.delai_paiement_jours);
  });
}
async function offerInvoicedLink(row) {
  if (!db.v5) return;
  const f = db.fournisseurs.find((x) => norm(x.nom) === norm(row.fournisseur));
  if (!f) return;
  const open = db.achats.filter((a) => a.fournisseur_id === f.id && a.type === "Commande" && ENGAGE.has(a.statut) && (!row.chantier_id || a.chantier_id === row.chantier_id));
  const a = open.length === 1 ? open[0] : open.find((x) => Math.abs(x.montant_ht - row.montant_ht) < 0.01);
  if (!a) return;
  if (confirm(`Cette facture correspond-elle à la commande ${a.numero || "du " + D(a.date_doc)} (${E(a.montant_ht)} HT) ?\n\nElle sera marquée « Facturée » pour ne pas être comptée deux fois dans le budget du chantier.`))
    await q(sb.from("achats_fournisseurs").update({ statut: "Facturée" }).eq("id", a.id));
}

/* ===================== Actions (fusionnées dans ACT) ===================== */
const achatActions = {
  fournisseurNew: (id, arg) => {
    const d = arg ? db.depenses.find((x) => norm(x.fournisseur) === norm(arg)) : null;
    return guard() && fournisseurForm(null, { nom: arg, categorie: d?.categorie });
  },
  fournisseurEdit: (id) => guard() && fournisseurForm(byId(db.fournisseurs, id)),
  fournisseurDel: (id) => {
    const f = byId(db.fournisseurs, id), n = db.achats.filter((a) => a.fournisseur_id === id).length;
    return del("fournisseurs", id, `Supprimer le fournisseur « ${f.nom} » ?${n ? `\n\nSes ${n} devis et commandes seront aussi supprimés.` : ""}\n\nLes factures déjà enregistrées sont conservées.`, "fournisseurs", "Fournisseur supprimé.");
  },
  achatNew: (id, arg) => achatForm(null, { type: arg === "Devis" ? "Devis" : "Commande", fournisseur: id || undefined }),
  achatNewCh: (id) => achatForm(null, { type: "Commande", chantier: id }),
  achatEdit: (id) => achatForm(byId(db.achats, id)),
  achatDel: (id) => del("achats_fournisseurs", id, "Supprimer ce document ?"),
  achatStatut: async (id, arg) => {
    if (!guard()) return;
    const patch = arg === "__cmd" ? { type: "Commande", statut: "Commandée" } : { statut: arg };
    await q(sb.from("achats_fournisseurs").update(patch).eq("id", id));
    toast("Document mis à jour.", "ok");
    await refresh();
  },
  chantierBudget: (id) => budgetForm(byId(db.chantiers, id)),
  depMO: (id) => depForm(null, { chantier: id, taux: 0, prefill: { categorie: "Main-d'œuvre", type: "Dépense", fournisseur: "Main-d'œuvre", montant_tva: 0, statut: "Payée" } }),
};
