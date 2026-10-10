/* Accueil (priorités), chantiers, clients */

const monthKey = (iso) => String(iso || "").slice(0, 7);
const curMonth = () => today().slice(0, 7);
const prevMonthKey = (n = 1) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - n);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
};

/* ---------- Client à la volée (utilisé par chantier, devis, facture) ---------- */
function clientBlock(selected) {
  const opts = [...db.clients.map((c) => ({ v: c.id, l: c.nom })), { v: "__new", l: "+ Nouveau client…" }];
  const sel = selected || (db.clients.length ? db.clients[0].id : "__new");
  return `<div class="full">${fld({ k: "client_id", l: "Client", t: "select", o: opts, v: sel })}
    <div class="inline-new" id="newcl" ${sel === "__new" ? "" : "hidden"} style="margin-top:10px">
      <label class="fl full"><span>Nom du client <em>*</em></span><input type="text" name="ncl_nom" placeholder="Nom ou raison sociale"></label>
      <label class="fl"><span>Type</span><select name="ncl_type"><option>Particulier</option><option>Professionnel</option></select></label>
      <label class="fl"><span>Téléphone</span><input type="text" name="ncl_tel"></label>
      <label class="fl full"><span>Email</span><input type="email" name="ncl_email"></label>
      <label class="fl full"><span>Adresse</span><input type="text" name="ncl_adresse"></label>
      <label class="fl"><span>Ville</span><input type="text" name="ncl_ville" placeholder="Code postal et ville"></label>
    </div></div>`;
}
function bindClientBlock(m, onChange) {
  const s = $("#f_client_id", m);
  if (!s) return;
  s.onchange = () => {
    $("#newcl", m).hidden = s.value !== "__new";
    if (s.value === "__new") $('[name="ncl_nom"]', m).focus();
    onChange?.(s.value);
  };
}
async function resolveClient(v) {
  if (v.client_id !== "__new") return v.client_id;
  if (!String(v.ncl_nom || "").trim()) throw new Error("Indiquez le nom du nouveau client.");
  const c = await q(
    sb.from("clients").insert({
      nom: v.ncl_nom.trim(), type: v.ncl_type || "Particulier", email: v.ncl_email || null,
      telephone: v.ncl_tel || null, adresse: v.ncl_adresse || null, ville: v.ncl_ville || null,
    }).select("id").single(),
  );
  return c.id;
}

/* ---------- Priorités ---------- */
const LV = { u: "Urgent", i: "Important", s: "À suivre" };
function priorites() {
  const t = today();
  const out = [];
  const add = (lv, score, titre, detail, montant, action, go) => out.push({ lv, score, titre, detail, montant, action, go });

  for (const f of enRetard()) {
    const d = daysBetween(f.echeance, t);
    add(d > 30 || f.reste >= 5000 ? "u" : "i", 300 + Math.min(d, 120) + Math.min(f.reste / 100, 80),
      `${f.numero} · ${f.client_nom}`, `En retard de ${d} jour${d > 1 ? "s" : ""}, échue le ${D(f.echeance)}${typeof bkMatchFor === "function" && bkMatchFor(f) ? " · un virement correspondant est peut-être déjà arrivé en banque" : ""}`, f.reste,
      { label: "Relancer", act: "factureRelance", id: f.id }, `factures/${f.id}`);
  }
  for (const f of ouvertes()) {
    const d = daysBetween(t, f.echeance);
    if (d >= 0 && d <= 7)
      add(d <= 2 ? "i" : "s", 150 - d * 5, `${f.numero} · ${f.client_nom}`, d === 0 ? "Échéance aujourd'hui" : `Échéance dans ${d} jour${d > 1 ? "s" : ""}`, f.reste,
        null, `factures/${f.id}`);
  }
  for (const d of aFacturer())
    add("i", 200, `${d.numero} · ${d.client_nom}`, "Devis accepté, pas encore facturé", d.montant_ttc,
      { label: "Créer la facture", act: "devisToFacture", id: d.id }, `devis/${d.id}`);
  for (const d of db.devis.filter((x) => x.statut === "Envoyé")) {
    const age = daysBetween(d.date_devis, t);
    const p = partageOf(d.id);
    if (age >= 5)
      add(age >= 12 ? "i" : "s", 120 + age, `${d.numero} · ${d.client_nom}`,
        `Sans réponse depuis ${age} jours${p?.vu_at ? ", le client l'a ouvert" : ", pas encore ouvert par le client"}`, d.montant_ttc,
        { label: "Relancer", act: "devisRelance", id: d.id }, `devis/${d.id}`);
  }
  for (const c of db.chantiers.filter((x) => x.statut === "À facturer")) {
    const draft = db.factures.some((f) => f.chantier_id === c.id && f.statut === "Brouillon");
    add("i", 160, c.nom, draft ? "Chantier à facturer, une facture brouillon est prête" : "Chantier terminé : pensez à facturer", c.montant_marche || 0,
      null, `chantiers/${c.id}`);
  }
  for (const x of [...db.devis.filter((d) => d.statut === "Brouillon"), ...db.factures.filter((f) => f.statut === "Brouillon")]) {
    const age = daysBetween(String(x.created_at).slice(0, 10), t);
    if (age >= 3)
      add("s", 40 + age, `${x.numero || "Facture"} · ${x.client_nom}`, `Brouillon à finaliser depuis ${age} jours`, x.montant_ttc,
        null, `${x.numero?.startsWith("devis") || "date_devis" in x ? "devis" : "factures"}/${x.id}`);
  }
  for (const d of depensesAPayer()) {
    if (!d.echeance) continue;
    const dd = daysBetween(t, d.echeance);
    if (dd < 0)
      add("u", 280 + Math.min(-dd, 60), d.fournisseur, `Facture fournisseur échue depuis ${-dd} jour${-dd > 1 ? "s" : ""}`, d.montant_ttc,
        { label: "Marquer payée", act: "depPay", id: d.id }, `depenses/${d.id}`);
    else if (dd <= 7)
      add("i", 130 - dd, d.fournisseur, dd === 0 ? "À payer aujourd'hui" : `À payer dans ${dd} jour${dd > 1 ? "s" : ""}`, d.montant_ttc,
        { label: "Marquer payée", act: "depPay", id: d.id }, `depenses/${d.id}`);
  }
  // Rentabilité des chantiers (budget prévu vs réel)
  if (db.v5)
    for (const c of db.chantiers.filter((x) => x.statut !== "Terminé")) {
      const f = chFin(c);
      if (!f.lv) continue;
      add(f.lv, { u: 320, i: 170, s: 60 }[f.lv] + Math.min(f.baisse, 60), `${c.nom} · ${finTitle(f)}`, finDetail(f), f.margeAct < 0 ? f.margeAct : 0,
        { label: "Voir le suivi", act: "go", id: `chantiers/${c.id}` }, `chantiers/${c.id}`);
    }
  // Banque : opérations à rapprocher
  try {
    const bp = typeof bkPriorite === "function" ? bkPriorite() : null;
    if (bp) add(bp.lv, bp.score, bp.titre, bp.detail, bp.montant, { label: "Rapprocher", act: "go", id: "compta?tab=banque" }, "compta?tab=banque");
  } catch (e) {}
  // TVA
  try {
    const jour = Number(db.ent.jour_tva) || 20;
    const now = new Date();
    const reste = jour - now.getDate();
    const pm = prevMonthKey(1).split("-").map(Number);
    const c = COMPTA.periode(pm[0], pm[1] - 1, pm[1] - 1);
    if ((c.tvaCollectee || c.tvaDeductible) && reste >= -0 && now.getDate() <= jour) {
      const aPayer = r2(c.tvaCollectee - c.tvaDeductible);
      add(reste <= 2 ? "u" : reste <= 7 ? "i" : "s", 140 - reste, `TVA de ${MNL[pm[1] - 1].toLowerCase()} à déclarer`,
        `À déclarer avant le ${jour}. ${aPayer >= 0 ? "TVA à reverser" : "Crédit de TVA"} estimé${aPayer >= 0 ? "e" : ""}`, Math.abs(aPayer),
        { label: "Voir le détail", act: "go", id: "compta" }, "compta");
    }
  } catch (e) {}
  // Trésorerie à 30 jours
  const horizon = addDays(t, 30);
  const entrees = sum(ouvertes().filter((f) => f.echeance >= t && f.echeance <= horizon), (f) => f.reste);
  const sorties = sum(depensesAPayer().filter((d) => d.echeance && d.echeance <= horizon), (d) => d.montant_ttc);
  const prev = r2(tresorerie() + entrees - sorties);
  if (tresorerie() < 0) add("u", 400, "Trésorerie négative", `Solde estimé aujourd'hui`, tresorerie(), { label: "Voir la comptabilité", act: "go", id: "compta" }, "compta");
  else if (prev < 0) add("i", 250, "Trésorerie tendue à 30 jours", `${E(entrees)} attendus, ${E(sorties)} à payer d'ici le ${D(horizon)}`, prev, { label: "Voir les paiements", act: "go", id: "paiements" }, "paiements");

  const rank = { u: 0, i: 1, s: 2 };
  return out.sort((a, b) => rank[a.lv] - rank[b.lv] || b.score - a.score);
}

const prioRow = (p) =>
  `<div class="prio${p.go ? " link" : ""}"${p.go ? ` data-go="${p.go}"` : ""}><span class="lv ${p.lv}">${LV[p.lv]}</span>
    <div class="tt"><b>${esc(p.titre)}</b><small>${esc(p.detail)}</small></div>
    <span class="am num ${p.lv === "u" && p.montant < 0 ? "dn" : ""}">${p.montant ? E(p.montant) : ""}</span>
    <span>${p.action ? btn(p.action.label, p.action.act, p.action.id, "", "o sm") : ""}</span></div>`;

V.home = () => {
  const t = today();
  const mois = curMonth(), pm = prevMonthKey();
  const caM = sum(emises().filter((f) => monthKey(f.date_emission) === mois), (f) => f.montant_ht);
  const caP = sum(emises().filter((f) => monthKey(f.date_emission) === pm), (f) => f.montant_ht);
  const evo = caP ? Math.round(((caM - caP) / caP) * 100) : null;
  const enc = sum(ouvertes(), (f) => f.reste), encR = sum(enRetard(), (f) => f.reste);
  const aPayer = depensesAPayer();
  const pr = priorites();
  const n = { u: pr.filter((p) => p.lv === "u").length, i: pr.filter((p) => p.lv === "i").length, s: pr.filter((p) => p.lv === "s").length };

  // échéances des 14 prochains jours
  const h = addDays(t, 14);
  const ech = [
    ...ouvertes().flatMap((f) => {
      const l = echStatut(f).filter((e) => e.reste > 0.005);
      const it = l.length ? l.map((e) => ({ d: e.date_echeance, l: f.client_nom, s: `${f.numero} · ${e.libelle || "échéance"}`, m: e.reste, go: `factures/${f.id}` })) : [{ d: f.echeance, l: f.client_nom, s: f.numero, m: f.reste, go: `factures/${f.id}` }];
      return it.filter((x) => x.d >= t && x.d <= h);
    }),
    ...aPayer.filter((x) => x.echeance && x.echeance >= t && x.echeance <= h).map((x) => ({ d: x.echeance, l: x.fournisseur, s: "À payer", m: -x.montant_ttc, go: `depenses/${x.id}` })),
  ].sort((a, b) => a.d.localeCompare(b.d));

  const body = `
  ${strip([
    ["Trésorerie estimée", E(tresorerie()), "encaissements - décaissements", tresorerie() < 0 ? "dn" : ""],
    ["À encaisser", E(enc), encR ? `dont ${E(encR)} en retard` : "rien en retard", encR ? "" : ""],
    ["À payer aux fournisseurs", E(sum(aPayer, (d) => d.montant_ttc)), `${aPayer.length} facture${aPayer.length > 1 ? "s" : ""}`],
    ["CA du mois (HT)", E(caM), evo === null ? "pas de mois précédent" : `${evo >= 0 ? "+" : ""}${evo} % par rapport au mois précédent`, evo > 0 ? "up" : ""],
  ])}
  <div class="g2">
    <div>${card(
      "À traiter",
      pr.length ? pr.map(prioRow).join("") : `<div class="allgood"><b>Rien d'urgent.</b>Aucune facture en retard, aucun devis à relancer.</div>`,
      pr.length ? `<div class="sum-lv"><span><b>${n.u}</b> urgent${n.u > 1 ? "s" : ""}</span><span><b>${n.i}</b> important${n.i > 1 ? "s" : ""}</span><span><b>${n.s}</b> à suivre</span></div>` : "",
    )}</div>
    <div>
      ${card("Échéances des 14 prochains jours",
        ech.length ? ech.map((e) => `<div class="ech lnk" data-go="${e.go}" style="cursor:pointer"><time>${D(e.d).slice(0, 5)}</time><div><b>${esc(e.l)}</b><small>${esc(e.s)}</small></div><span class="num ${e.m < 0 ? "dn" : "up"}">${e.m < 0 ? "-" : "+"} ${E(Math.abs(e.m))}</span></div>`).join("") : `<p class="emp" style="padding:18px;margin:0;color:var(--mut)">Aucune échéance dans les 14 prochains jours.</p>`)}
      ${card("Chantiers en cours",
        (() => {
          const l = db.chantiers.filter((c) => c.statut === "En cours" || c.statut === "À surveiller").slice(0, 5);
          return l.length ? l.map((c) => `<div class="row lnk" data-go="chantiers/${c.id}" style="cursor:pointer"><div><b>${esc(c.nom)}</b><small>${esc(c.client_nom)}${c.ville ? " · " + esc(c.ville) : ""}</small></div><span>${chip(c.statut)}${finChip(c)}</span></div>`).join("") : `<p class="emp" style="padding:18px;margin:0;color:var(--mut)">Aucun chantier en cours.</p>`;
        })(),
        `<button class="lk" data-go="chantiers">Tous les chantiers ${svg(ic.ar)}</button>`)}
    </div>
  </div>`;
  const d = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  return page("Bonjour", `${d.charAt(0).toUpperCase() + d.slice(1)}. Voici ce qui demande une décision.`,
    btn("Nouveau devis", "devisNew", "", "", "w") + btn("Nouvelle facture", "factureNew", "", "", "o w"), body);
};

/* ---------- Chantiers ---------- */
const CH_STATUTS = ["En cours", "À surveiller", "À facturer", "Terminé"];
function chStats(c) {
  const fa = emises().filter((f) => f.chantier_id === c.id);
  const fids = new Set(db.factures.filter((f) => f.chantier_id === c.id).map((f) => f.id));
  const deps = db.depenses.filter((d) => d.chantier_id === c.id);
  const factureHT = sum(fa, (f) => f.montant_ht);
  const couts = sum(deps, (d) => d.montant_ht);
  return {
    factureHT, couts, marge: r2(factureHT - couts),
    encaisse: sum(db.paiements.filter((p) => fids.has(p.facture_id)), (p) => p.montant),
    acceptes: sum(db.devis.filter((d) => d.chantier_id === c.id && d.statut === "Accepté"), (d) => d.montant_ht),
  };
}
V.chantiers = (r) => {
  if (r.arg) return chantierDetail(r.arg);
  const cur = ST.tab.chantiers || "tous";
  const list = db.chantiers.filter((c) => cur === "tous" || c.statut === cur);
  const rows = list.map((c) => {
    const s = chStats(c);
    return {
      go: `chantiers/${c.id}`, t: `${c.nom} ${c.client_nom} ${c.ville || ""}`,
      c: [`<strong>${esc(c.nom)}</strong><small>${esc(c.client_nom)}${c.ville ? " · " + esc(c.ville) : ""}</small>`,
        `<span class="num">${E(c.montant_marche)}</span>`, `<span class="num">${E(s.factureHT)}</span>`, `<span class="num">${E(s.couts)}</span>`,
        `<span class="num ${s.marge < 0 ? "dn" : ""}">${s.factureHT || s.couts ? E(s.marge) : "-"}</span>`, chip(c.statut) + finChip(c)],
    };
  });
  const tabsHtml = tabs("chantiers", [["tous", "Tous"], ...CH_STATUTS.map((s) => [s, s])], cur);
  return page("Chantiers", "Suivi des chantiers, de ce qui est facturé et de ce qu'ils coûtent.", btn("Nouveau chantier", "chantierNew", "", "", "w"),
    tabsHtml + searchBar("Rechercher un chantier, un client, une ville…", `${list.length} chantier${list.length > 1 ? "s" : ""}`) +
      card("", tbl(["Chantier", { h: "Marché", r: 1 }, { h: "Facturé HT", r: 1 }, { h: "Coûts HT", r: 1 }, { h: "Marge", r: 1 }, "Statut"], rows,
        "Aucun chantier. Créez-en un pour y rattacher devis, factures et dépenses.")));
};
function chantierDetail(id) {
  const c = byId(db.chantiers, id);
  if (!c) return `<div class="empty"><h2>Chantier introuvable</h2><button class="btn" data-go="chantiers">Retour aux chantiers</button></div>`;
  const s = chStats(c);
  const devis = db.devis.filter((d) => d.chantier_id === id), fact = db.factures.filter((f) => f.chantier_id === id), deps = db.depenses.filter((d) => d.chantier_id === id);
  return page(`${esc(c.nom)} ${chip(c.statut)}`, `${esc(c.client_nom)}${c.ville ? " · " + esc(c.ville) : ""}`,
    btn("Modifier", "chantierEdit", id, "", "o w") + btn("Nouveau devis", "devisNew", "", "chantier:" + id, "w") + btn("Nouvelle facture", "factureNew", "", "chantier:" + id, "o w") + btn("Supprimer", "chantierDel", id, "", "dn-o w"),
    `${db.v5 ? finCard(c) : strip([
      ["Marché", E(c.montant_marche), "montant convenu"],
      ["Facturé HT", E(s.factureHT), `${E(s.encaisse)} encaissés (TTC)`],
      ["Coûts HT", E(s.couts), `${deps.length} dépense${deps.length > 1 ? "s" : ""} rattachée${deps.length > 1 ? "s" : ""}`],
      ["Marge estimée", s.factureHT || s.couts ? E(s.marge) : "-", "facturé - coûts", s.marge < 0 ? "dn" : ""],
    ])}
    <div class="g2"><div>
      ${card("Devis", docTable("devis", devis), "")}
      ${card("Factures", docTable("factures", fact), "")}
      ${card("Dépenses et achats", tbl(["Fournisseur", "Date", { h: "HT", r: 1 }, "Statut"], deps.map((d) => ({ go: `depenses/${d.id}`, c: [`<strong>${esc(d.fournisseur)}</strong><small>${esc(d.categorie || d.type)}</small>`, D(d.date_depense), `<span class="num">${E2(d.montant_ht)}</span>`, chip(d.statut)] })), "Aucune dépense rattachée à ce chantier."), btn("Ajouter", "depNew", "", "chantier:" + id, "o sm w"))}
      ${achatsCard(c)}
    </div><div>
      ${dcCard("chantier", id)}
      ${card("Informations", `<dl class="kv"><dt>Client</dt><dd><a href="#/clients/${c.client_id}">${esc(c.client_nom)}</a></dd><dt>Adresse</dt><dd>${esc(c.adresse || "-")}</dd><dt>Ville</dt><dd>${esc(c.ville || "-")}</dd><dt>Début</dt><dd>${c.date_debut ? D(c.date_debut) : "-"}</dd><dt>Fin prévue</dt><dd>${c.date_fin ? D(c.date_fin) : "-"}</dd><dt>Notes</dt><dd>${esc(c.notes || "-").replace(/\n/g, "<br>")}</dd></dl>`)}
    </div></div>`,
    crumbs(["Chantiers", "chantiers"], [c.nom]));
}
function chantierForm(c, preClient) {
  const sel = c?.client_id || preClient;
  const body = `<div class="frm">
    ${fld({ k: "nom", l: "Nom du chantier", v: c?.nom, cls: "full" })}
    ${clientBlock(sel)}
    ${fld({ k: "adresse", l: "Adresse du chantier", v: c?.adresse, r: 0, cls: "full" })}
    ${fld({ k: "ville", l: "Ville", v: c?.ville, r: 0 })}
    ${fld({ k: "statut", l: "Statut", t: "select", o: CH_STATUTS, v: c?.statut || "En cours" })}
    ${fld({ k: "montant_marche", l: "Montant du marché (€)", t: "number", v: c ? String(c.montant_marche).replace(".", ",") : "", r: 0, hint: "Facultatif : sert de repère de comparaison." })}
    ${fld({ k: "date_debut", l: "Début", t: "date", v: c?.date_debut || "", r: 0 })}
    ${fld({ k: "date_fin", l: "Fin prévue", t: "date", v: c?.date_fin || "", r: 0 })}
    ${fld({ k: "notes", l: "Notes", t: "textarea", v: c?.notes, r: 0, cls: "full" })}
  </div>`;
  modal(c ? "Modifier le chantier" : "Nouveau chantier", body, {
    wide: true,
    onMount: (m) => bindClientBlock(m),
    onSubmit: async (v, api) => {
      const cid = await resolveClient(v);
      const row = { nom: v.nom, client_id: cid, adresse: v.adresse || null, ville: v.ville || null, statut: v.statut, montant_marche: parseNum(v.montant_marche),
        date_debut: v.date_debut || null, date_fin: v.date_fin || null, notes: v.notes || null };
      if (c) await q(sb.from("chantiers").update(row).eq("id", c.id));
      else await q(sb.from("chantiers").insert(row));
      api.close();
      toast(c ? "Chantier modifié." : "Chantier créé.", "ok");
      await refresh();
    },
  });
}

/* ---------- Clients ---------- */
V.clients = (r) => {
  if (r.arg) return clientDetail(r.arg);
  const rows = db.clients.map((c) => ({
    go: `clients/${c.id}`, t: `${c.nom} ${c.ville || ""} ${c.email || ""} ${c.type}`,
    c: [`<strong>${esc(c.nom)}</strong><small>${c.type}${c.ville ? " · " + esc(c.ville) : ""}</small>`,
      `${esc(c.email || "-")}<small>${esc(c.telephone || "")}</small>`, c.nb_chantiers,
      `<span class="num">${E(c.ca)}</span>`, `<span class="num ${c.a_encaisser ? "dn" : ""}">${E(c.a_encaisser)}</span>`],
  }));
  return page("Clients", "Chaque client avec ses chantiers, ses documents et ce qu'il reste à encaisser.", btn("Nouveau client", "clientNew", "", "", "w"),
    searchBar("Rechercher par nom, ville, email…", `${db.clients.length} client${db.clients.length > 1 ? "s" : ""}`) +
      card("", tbl(["Client", "Contact", "Chantiers", { h: "CA HT", r: 1 }, { h: "À encaisser", r: 1 }], rows, "Aucun client pour le moment. Ajoutez le premier avec le bouton « Nouveau client ».")));
};
function clientDetail(id) {
  const c = byId(db.clients, id);
  if (!c) return `<div class="empty"><h2>Client introuvable</h2><button class="btn" data-go="clients">Retour aux clients</button></div>`;
  const devis = db.devis.filter((d) => d.client_id === id), fact = db.factures.filter((f) => f.client_id === id), chs = db.chantiers.filter((x) => x.client_id === id);
  return page(`${esc(c.nom)} ${chip(c.type)}`, c.ville ? esc(c.ville) : "",
    btn("Modifier", "clientEdit", id, "", "o w") + btn("Nouveau devis", "devisNew", "", "client:" + id, "w") + btn("Nouvelle facture", "factureNew", "", "client:" + id, "o w") + btn("Supprimer", "clientDel", id, "", "dn-o w"),
    `${strip([
      ["CA HT", E(c.ca), "factures émises"],
      ["À encaisser", E(c.a_encaisser), "TTC, factures ouvertes", c.a_encaisser ? "dn" : ""],
      ["Devis en attente", devis.filter((d) => d.statut === "Envoyé").length, E(sum(devis.filter((d) => d.statut === "Envoyé"), (d) => d.montant_ttc))],
      ["Chantiers", chs.length, `${chs.filter((x) => x.statut !== "Terminé").length} en cours`],
    ])}
    <div class="g2"><div>
      ${card("Devis", docTable("devis", devis))}
      ${card("Factures", docTable("factures", fact))}
    </div><div>
      ${dcCard("client", id)}
      ${card("Coordonnées", `<dl class="kv"><dt>Email</dt><dd>${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : "-"}</dd><dt>Téléphone</dt><dd>${esc(c.telephone || "-")}</dd><dt>Adresse</dt><dd>${esc(c.adresse || "-")}</dd><dt>Ville</dt><dd>${esc(c.ville || "-")}</dd><dt>Notes</dt><dd>${esc(c.notes || "-").replace(/\n/g, "<br>")}</dd></dl>`)}
      ${card("Chantiers", chs.length ? chs.map((x) => `<div class="row lnk" data-go="chantiers/${x.id}" style="cursor:pointer"><div><b>${esc(x.nom)}</b><small>${esc(x.ville || "")}</small></div>${chip(x.statut)}</div>`).join("") : `<p class="emp" style="padding:18px;margin:0;color:var(--mut)">Aucun chantier.</p>`, btn("Ajouter", "chantierNew", "", "client:" + id, "o sm w"))}
    </div></div>`,
    crumbs(["Clients", "clients"], [c.nom]));
}
function clientForm(c) {
  const body = `<div class="frm">
    ${fld({ k: "nom", l: "Nom ou raison sociale", v: c?.nom, cls: "full" })}
    ${fld({ k: "type", l: "Type", t: "select", o: ["Particulier", "Professionnel"], v: c?.type || "Particulier" })}
    ${fld({ k: "telephone", l: "Téléphone", v: c?.telephone, r: 0 })}
    ${fld({ k: "email", l: "Email", t: "email", v: c?.email, r: 0, cls: "full" })}
    ${fld({ k: "adresse", l: "Adresse", v: c?.adresse, r: 0, cls: "full" })}
    ${fld({ k: "ville", l: "Code postal et ville", v: c?.ville, r: 0, cls: "full" })}
    ${fld({ k: "notes", l: "Notes", t: "textarea", v: c?.notes, r: 0, cls: "full" })}
  </div>`;
  modal(c ? "Modifier le client" : "Nouveau client", body, {
    onSubmit: async (v, api) => {
      const row = { nom: v.nom.trim(), type: v.type, telephone: v.telephone || null, email: v.email || null, adresse: v.adresse || null, ville: v.ville || null, notes: v.notes || null };
      let id = c?.id;
      if (c) await q(sb.from("clients").update(row).eq("id", c.id));
      else id = (await q(sb.from("clients").insert(row).select("id").single())).id;
      api.close();
      toast(c ? "Client modifié." : "Client créé.", "ok");
      await refresh();
      if (!c && parseHash().name === "clients") go("clients/" + id);
    },
  });
}
