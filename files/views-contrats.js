/* Contrats d'entretien (v21) : contrats annuels ou périodiques, renouvellement automatique, échéances et rappels,
   visites programmées, facturation récurrente. Tables : contrats, contrat_visites, contrat_factures (migration_v21.sql). */

Object.assign(ic, {
  contrats: "M6 3h9l4 4v14H6z M9 12h7 M9 16h4 M14 3v5h5",
  interventions: "M14 6a4 4 0 00-5 5l-6 6 3 3 6-6a4 4 0 005-5l-3 3-2-2z",
  livraisons: "M3 7h11v9H3z M14 10h4l3 3v3h-7z M7 19a1.5 1.5 0 100-3 1.5 1.5 0 000 3z M17 19a1.5 1.5 0 100-3 1.5 1.5 0 000 3z",
  comparateur: "M4 20V10 M10 20V4 M16 20v-7 M22 20H2 M13 7l3-3 3 3",
  societes: "M4 21V7l8-4 8 4v14 M9 21v-5h6v5 M8 10h2 M14 10h2 M8 13h2 M14 13h2",
  consolide: "M4 19V9 M10 19V5 M16 19v-7 M22 19H2 M3 5h4",
  perso: "M4 7h10 M18 7h2 M4 17h2 M10 17h10 M14 5v4 M6 15v4",
});

const v21Setup = () => `<div class="empty-state"><b>Module à activer</b><p>Exécutez <code>migration_v21.sql</code> dans Supabase (SQL Editor), puis rechargez la page.${db.v21err ? `<br><small>${esc(db.v21err)}</small>` : ""}</p></div>`;
const PERIODES = { mensuelle: 1, trimestrielle: 3, semestrielle: 6, annuelle: 12 };
const PERIODE_LBL = { mensuelle: "Mensuelle", trimestrielle: "Trimestrielle", semestrielle: "Semestrielle", annuelle: "Annuelle" };
function addMonths(iso, n) {
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1)), last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(Math.min(d, last))}`;
}
const ctClient = (c) => byId(db.clients, c.client_id)?.nom || "Sans client";
const ctVisites = (id) => (db.ctVisites || []).filter((v) => v.contrat_id === id).sort((a, b) => a.date_prevue.localeCompare(b.date_prevue));
const ctFactures = (id) => (db.ctFactures || []).filter((f) => f.contrat_id === id).sort((a, b) => a.periode_debut.localeCompare(b.periode_debut));
const ctNextVisite = (c) => ctVisites(c.id).find((v) => v.statut === "Planifiée");
const ctAnnuel = (c) => Number(c.montant_ht || 0) * (12 / PERIODES[c.facturation || "annuelle"]);
const ctDue = (c) => c.statut === "Actif" && c.prochaine_facturation && c.prochaine_facturation <= today() && c.prochaine_facturation <= c.date_fin;
function ctNumero() {
  const y = new Date().getFullYear(), n = Math.max(0, ...(db.contrats || []).map((c) => (String(c.numero || "").startsWith(`CE-${y}-`) ? parseInt(c.numero.slice(-3)) || 0 : 0)));
  return `CE-${y}-${String(n + 1).padStart(3, "0")}`;
}
function ctStatutAff(c) {
  if (c.statut !== "Actif") return c.statut;
  const t = today();
  if (c.date_fin < t && !c.renouvellement_auto) return "Échu";
  if (c.date_fin <= addDays(t, Number(c.rappel_jours) || 30)) return c.renouvellement_auto ? "Renouvellement proche" : "À renouveler";
  return "Actif";
}
Object.assign(CHIP, { Actif: "ok", Suspendu: "wn", Résilié: "n", Échu: "dn", "À renouveler": "wn", "Renouvellement proche": "ac", Planifiée: "ac", Réalisée: "ok" });

// Alertes à afficher (page Contrats, accueil)
function ctAlertes() {
  const t = today(), out = [];
  for (const c of db.contrats || []) {
    if (c.statut !== "Actif") continue;
    const rap = Number(c.rappel_jours) || 30, nom = `${c.libelle} (${ctClient(c)})`;
    if (c.date_fin >= t && c.date_fin <= addDays(t, rap)) {
      if (c.renouvellement_auto) {
        const lim = addDays(c.date_fin, -(Number(c.preavis_jours) || 0));
        out.push({ lv: "s", t: `${nom} : renouvellement automatique le ${D(c.date_fin)}${lim >= t ? ` (résiliation possible jusqu'au ${D(lim)})` : ""}`, go: `contrats/${c.id}` });
      } else out.push({ lv: "i", t: `${nom} : se termine le ${D(c.date_fin)}, à renouveler ou à clore`, go: `contrats/${c.id}` });
    }
    if (ctDue(c)) out.push({ lv: "i", t: `${nom} : échéance de facturation du ${D(c.prochaine_facturation)} (${E2(Number(c.montant_ht) * (1 + c.taux_tva / 100))} TTC)`, go: `contrats/${c.id}` });
    for (const v of ctVisites(c.id).filter((x) => x.statut === "Planifiée")) {
      if (v.date_prevue < t) out.push({ lv: "u", t: `${nom} : visite du ${D(v.date_prevue)} non réalisée`, go: `contrats/${c.id}` });
      else if (v.date_prevue <= addDays(t, 7)) out.push({ lv: "s", t: `${nom} : visite prévue le ${D(v.date_prevue)}`, go: `contrats/${c.id}` });
    }
  }
  return out.sort((a, b) => "uis".indexOf(a.lv) - "uis".indexOf(b.lv));
}
const alertRow = (a) => prioRow({ lv: a.lv, titre: a.t.split(" : ")[0], detail: a.t.split(" : ").slice(1).join(" : "), go: a.go });

// Génère les visites d'un contrat entre deux dates (sans doublon, sans historique passé)
async function ctGenVisites(c, from, to) {
  const step = 12 / (Number(c.visites_par_an) || 1), have = new Set(ctVisites(c.id).map((v) => v.date_prevue)), rows = [];
  const t = today();
  for (let k = 0; k < 400; k++) {
    const d = addMonths(c.date_debut, Math.round(k * step));
    if (d >= to) break;
    if (d >= from && d >= (c.date_debut < t ? t : c.date_debut) && !have.has(d)) rows.push({ contrat_id: c.id, date_prevue: d });
  }
  if (rows.length) await q(sb.from("contrat_visites").insert(rows));
  return rows.length;
}
// Renouvellement automatique : prolonge les contrats arrivés à échéance
async function ctRenouveler(c) {
  const ancienne = c.date_fin, nouvelle = addMonths(ancienne, Number(c.duree_renouv_mois) || 12);
  await q(sb.from("contrats").update({ date_fin: nouvelle }).eq("id", c.id));
  c.date_fin = nouvelle;
  await ctGenVisites(c, ancienne, nouvelle);
  return nouvelle;
}
async function ctAutoRenew() {
  if (ro || window.__ctRenew || !db.v21) return;
  window.__ctRenew = true;
  let n = 0;
  try {
    for (const c of (db.contrats || []).filter((x) => x.statut === "Actif" && x.renouvellement_auto && x.date_fin < today())) {
      let g = 0;
      while (c.date_fin < today() && g++ < 30) await ctRenouveler(c);
      n++;
    }
    if (n) { toast(`${n} contrat${n > 1 ? "s" : ""} d'entretien renouvelé${n > 1 ? "s" : ""} automatiquement.`, "ok"); await refresh(); }
  } catch (e) { console.warn("renouvellement auto", e); }
  finally { window.__ctRenew = false; }
}

// Facture brouillon d'une échéance
async function ctFacturerEcheance(c) {
  const step = PERIODES[c.facturation], deb = c.prochaine_facturation, fin = addMonths(deb, step), finJ = addDays(fin, -1);
  const lib = `Contrat d'entretien ${c.numero || ""} - ${c.libelle}`.replace(/\s+/g, " ");
  const payload = {
    id: null, client_id: c.client_id, chantier_id: c.chantier_id || null, date: today(), echeance: addDays(today(), Number(db.ent.delai_paiement_jours) || 30),
    notes: `Période du ${D(deb)} au ${D(finJ)}.`,
    lignes: [{ categorie: "", nature: "normale", ref_facture_id: null, designation: lib, description: `Période du ${D(deb)} au ${D(finJ)}`, quantite: 1, unite: "forfait", prix_unitaire_ht: Number(c.montant_ht), taux_tva: Number(c.taux_tva) }],
  };
  const fid = await q(sb.rpc("sauver_document", { p_kind: "facture", p: payload }));
  await q(sb.from("contrat_factures").insert({ contrat_id: c.id, facture_id: fid, periode_debut: deb, periode_fin: finJ, montant_ht: c.montant_ht }));
  await q(sb.from("contrats").update({ prochaine_facturation: fin }).eq("id", c.id));
  c.prochaine_facturation = fin;
  return fid;
}

/* ---------- Pages ---------- */
V.contrats = (r) => {
  if (!db.v21) return page("Contrats d'entretien", "", "", v21Setup());
  if (r.arg) return contratDetail(r.arg);
  const cur = ST.tab.contrats || "contrats", t = today();
  const list = db.contrats || [];
  const actifs = list.filter((c) => c.statut === "Actif"), arr = actifs.filter((c) => c.date_fin <= addDays(t, 30) && c.date_fin >= t);
  const alt = ctAlertes();
  const strip1 = strip([["Contrats actifs", actifs.length, `${list.length} au total`], ["Revenu récurrent annuel", E(sum(actifs, ctAnnuel)), "HT, selon la facturation"], ["À renouveler (30 jours)", arr.length, "", arr.length ? "wn" : ""], ["À facturer", (list.filter(ctDue)).length, "échéances dues", list.filter(ctDue).length ? "wn" : ""]]);
  const tb = tabs("contrats", [["contrats", "Contrats"], ["visites", "Visites"], ["facturation", "Facturation"]], cur);
  const alertes = alt.length ? card("À traiter", alt.slice(0, 8).map(alertRow).join(""), alt.length > 8 ? `<small class="mut">+ ${alt.length - 8} autres</small>` : "") : "";
  let body = "";
  if (cur === "contrats") {
    const rows = list.map((c) => {
      const nv = ctNextVisite(c);
      return { go: `contrats/${c.id}`, t: `${c.numero} ${c.libelle} ${ctClient(c)}`,
        c: [`<strong>${esc(c.libelle)}</strong><small>${esc(c.numero || "")}${c.site_adresse ? " · " + esc(c.site_adresse) : ""}</small>`, esc(ctClient(c)),
          `<span class="num">${E2(c.montant_ht)}</span><small>${PERIODE_LBL[c.facturation].toLowerCase()} · ${c.visites_par_an} visite${c.visites_par_an > 1 ? "s" : ""}/an</small>`,
          nv ? D(nv.date_prevue) : "-", ctDue(c) ? `<span class="chip wn">${D(c.prochaine_facturation)}</span>` : c.prochaine_facturation ? D(c.prochaine_facturation) : "-",
          `${D(c.date_fin)}<small>${c.renouvellement_auto ? "renouvellement auto" : "sans renouvellement"}</small>`, chip(ctStatutAff(c))] };
    });
    body = searchBar("Rechercher un contrat, un client…", `${rows.length} contrat${rows.length > 1 ? "s" : ""}`) + tbl(["Contrat", "Client", "Montant", "Prochaine visite", "Prochaine facture", "Fin", "État"], rows, "Aucun contrat pour le moment. Créez le premier avec « Nouveau contrat ».");
  } else if (cur === "visites") {
    const vs = (db.ctVisites || []).filter((v) => v.statut === "Planifiée").sort((a, b) => a.date_prevue.localeCompare(b.date_prevue));
    const rows = vs.map((v) => { const c = byId(db.contrats, v.contrat_id); if (!c) return null; const late = v.date_prevue < t;
      return { t: `${c.libelle} ${ctClient(c)}`, c: [`<strong class="${late ? "dn" : ""}">${D(v.date_prevue)}</strong>${late ? "<small>en retard</small>" : ""}`, `<a href="#/contrats/${c.id}">${esc(c.libelle)}</a><small>${esc(ctClient(c))}</small>`,
        v.intervention_id ? `<a href="#/interventions/${v.intervention_id}">Voir le bon</a>` : btn("Créer le bon d'intervention", "intervFromVisite", v.id, "", "sm"),
        btn("Réalisée", "ctVisiteOk", v.id, "", "o sm") + " " + btn("Annuler", "ctVisiteNo", v.id, "", "o sm")] }; }).filter(Boolean);
    body = tbl(["Date prévue", "Contrat", "Intervention", ""], rows, "Aucune visite à venir.");
  } else {
    const due = list.filter(ctDue);
    body = card("Échéances à facturer", tbl(["Contrat", "Client", "Période", "Montant HT", ""], due.map((c) => ({ t: c.libelle, c: [`<a href="#/contrats/${c.id}">${esc(c.libelle)}</a>`, esc(ctClient(c)), `à partir du ${D(c.prochaine_facturation)}`, `<span class="num">${E2(c.montant_ht)}</span>`, btn("Créer la facture", "ctFacturer", c.id, "", "sm")] })), "Aucune échéance à facturer.")
      , due.length > 1 ? btn("Tout facturer (" + due.length + ")", "ctFacturerTout", "", "", "") : "") +
      card("Dernières factures de contrats", tbl(["Période", "Contrat", "Facture", "Montant HT"], [...(db.ctFactures || [])].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 25).map((f) => { const c = byId(db.contrats, f.contrat_id), fa = byId(db.factures, f.facture_id);
        return { t: c?.libelle || "", c: [`${D(f.periode_debut)} au ${D(f.periode_fin)}`, esc(c?.libelle || "-"), fa ? `<a href="#/factures/${fa.id}">${esc(fa.numero || "Brouillon")}</a>` : "-", `<span class="num">${E2(f.montant_ht)}</span>`] }; }), "Aucune facture générée."));
  }
  return page("Contrats d'entretien", "Contrats périodiques, visites programmées et facturation récurrente.", btn("Nouveau contrat", "ctNew"), strip1 + alertes + tb + body);
};

function contratDetail(id) {
  const c = byId(db.contrats, id);
  if (!c) return page("Contrat introuvable", "", "", card("", `<p class="emp">Ce contrat n'existe plus. <a href="#/contrats">Retour aux contrats</a></p>`));
  const vs = ctVisites(id), fs = ctFactures(id), t = today();
  const info = `<dl class="kv"><dt>Client</dt><dd><a href="#/clients/${c.client_id}">${esc(ctClient(c))}</a></dd>${c.chantier_id ? `<dt>Chantier</dt><dd><a href="#/chantiers/${c.chantier_id}">${esc(byId(db.chantiers, c.chantier_id)?.nom || "")}</a></dd>` : ""}${c.site_adresse ? `<dt>Lieu</dt><dd>${esc(c.site_adresse)}</dd>` : ""}
    <dt>Durée</dt><dd>du ${D(c.date_debut)} au ${D(c.date_fin)}</dd><dt>Renouvellement</dt><dd>${c.renouvellement_auto ? `automatique, par périodes de ${c.duree_renouv_mois} mois (préavis de résiliation : ${c.preavis_jours} jours)` : "aucun"}</dd>
    <dt>Rappel</dt><dd>${c.rappel_jours} jours avant l'échéance</dd><dt>Visites</dt><dd>${c.visites_par_an} par an</dd>
    <dt>Facturation</dt><dd>${PERIODE_LBL[c.facturation].toLowerCase()} : ${E2(c.montant_ht)} HT (TVA ${fmtNum(c.taux_tva, c.taux_tva % 1 ? 1 : 0)} %)</dd><dt>Prochaine facture</dt><dd>${c.prochaine_facturation ? D(c.prochaine_facturation) : "-"}</dd></dl>${c.notes ? `<p class="mut">${esc(c.notes).replace(/\n/g, "<br>")}</p>` : ""}`;
  const visTbl = tbl(["Date prévue", "État", "Intervention", ""], vs.map((v) => ({ t: v.date_prevue, c: [`<strong class="${v.statut === "Planifiée" && v.date_prevue < t ? "dn" : ""}">${D(v.date_prevue)}</strong>`, chip(v.statut) + (v.date_realisee ? `<small>le ${D(v.date_realisee)}</small>` : ""),
    v.intervention_id ? `<a href="#/interventions/${v.intervention_id}">Voir le bon</a>` : v.statut === "Planifiée" ? btn("Créer le bon d'intervention", "intervFromVisite", v.id, "", "sm") : "-",
    v.statut === "Planifiée" ? btn("Réalisée", "ctVisiteOk", v.id, "", "o sm") + " " + btn("Annuler", "ctVisiteNo", v.id, "", "o sm") : ""] })), "Aucune visite programmée.");
  const facTbl = tbl(["Période", "Facture", "Montant HT"], fs.map((f) => { const fa = byId(db.factures, f.facture_id); return { t: "", c: [`${D(f.periode_debut)} au ${D(f.periode_fin)}`, fa ? `<a href="#/factures/${fa.id}">${esc(fa.numero || "Brouillon")}</a> ${chip(fa.statut_affiche || fa.statut)}` : "supprimée", `<span class="num">${E2(f.montant_ht)}</span>`] }; }), "Aucune facture générée.");
  const acts = (ctDue(c) ? btn("Facturer l'échéance", "ctFacturer", id) : "") + btn("Modifier", "ctEdit", id, "", "o") +
    `<details class="more"><summary class="btn o">Plus d'actions</summary><div class="mm">
      <button type="button" class="mi" data-act="ctVisitesGen" data-id="${id}">Générer les visites manquantes</button>
      ${c.statut === "Actif" ? `<button type="button" class="mi" data-act="ctRenewNow" data-id="${id}">Renouveler maintenant</button><button type="button" class="mi" data-act="ctStatut" data-id="${id}" data-arg="Suspendu">Suspendre</button><button type="button" class="mi" data-act="ctStatut" data-id="${id}" data-arg="Résilié">Résilier</button>` : `<button type="button" class="mi" data-act="ctStatut" data-id="${id}" data-arg="Actif">Réactiver</button>`}
      <button type="button" class="mi dng" data-act="ctDel" data-id="${id}">Supprimer</button></div></details>`;
  return page(`${esc(c.libelle)} ${chip(ctStatutAff(c))}`, `${esc(c.numero || "")} · ${esc(ctClient(c))}`, acts, `<div class="g2"><div>${card("Visites d'entretien", visTbl, btn("+ Visite", "ctVisiteAdd", id, "", "o sm"))}${card("Factures générées", facTbl)}</div><div>${card("Conditions", info)}</div></div>`, crumbs(["Contrats d'entretien", "contrats"], [c.numero || "Contrat"]));
}

function ctForm(c) {
  const t = today(), pre = c || {};
  modal(c ? "Modifier le contrat" : "Nouveau contrat d'entretien", `<div class="frm">
    ${fld({ k: "libelle", l: "Intitulé du contrat", v: pre.libelle || "", ph: "Ex : Entretien chaudière gaz", cls: "full" })}
    ${fld({ k: "client_id", l: "Client", t: "select", o: [{ v: "", l: "Choisir un client…" }, ...db.clients.map((x) => ({ v: x.id, l: x.nom }))], v: pre.client_id || "" })}
    ${fld({ k: "chantier_id", l: "Chantier (facultatif)", t: "select", o: [{ v: "", l: "Aucun" }, ...db.chantiers.map((x) => ({ v: x.id, l: x.nom }))], v: pre.chantier_id || "", r: 0 })}
    ${fld({ k: "site_adresse", l: "Lieu d'intervention", v: pre.site_adresse || "", r: 0, cls: "full" })}
    ${fld({ k: "date_debut", l: "Début du contrat", t: "date", v: pre.date_debut || t })}
    ${fld({ k: "date_fin", l: "Fin du contrat", t: "date", v: pre.date_fin || addDays(addMonths(t, 12), -1) })}
    ${fld({ k: "renouvellement_auto", l: "Renouvellement automatique", t: "select", o: [{ v: "1", l: "Oui" }, { v: "0", l: "Non" }], v: pre.renouvellement_auto === false ? "0" : "1" })}
    ${fld({ k: "duree_renouv_mois", l: "Durée de chaque renouvellement (mois)", t: "number", v: pre.duree_renouv_mois || 12 })}
    ${fld({ k: "preavis_jours", l: "Préavis de résiliation (jours)", t: "number", v: pre.preavis_jours ?? 60 })}
    ${fld({ k: "rappel_jours", l: "Me rappeler avant l'échéance (jours)", t: "number", v: pre.rappel_jours ?? 30 })}
    ${fld({ k: "visites_par_an", l: "Visites d'entretien par an", t: "select", o: [1, 2, 3, 4, 6, 12].map((n) => ({ v: n, l: n === 1 ? "1 visite par an" : n + " visites par an" })), v: pre.visites_par_an || 1 })}
    ${fld({ k: "facturation", l: "Facturation", t: "select", o: Object.entries(PERIODE_LBL).map(([v, l]) => ({ v, l })), v: pre.facturation || "annuelle" })}
    ${fld({ k: "montant_ht", l: "Montant HT par facture", t: "number", v: pre.montant_ht ?? "", hint: "Montant facturé à chaque échéance." })}
    ${fld({ k: "taux_tva", l: "TVA (%)", t: "select", o: [20, 10, 5.5, 0].map((n) => ({ v: n, l: n + " %" })), v: pre.taux_tva ?? 20 })}
    ${c ? fld({ k: "statut", l: "État", t: "select", o: ["Actif", "Suspendu", "Résilié", "Terminé"], v: pre.statut }) : ""}
    ${fld({ k: "notes", l: "Notes", t: "textarea", v: pre.notes || "", r: 0, cls: "full" })}</div>`, {
    wide: true, submit: c ? "Enregistrer" : "Créer le contrat",
    onSubmit: async (v, api) => {
      if (v.date_fin < v.date_debut) throw new Error("La fin du contrat doit être après son début.");
      const row = { libelle: v.libelle.trim(), client_id: v.client_id, chantier_id: v.chantier_id || null, site_adresse: v.site_adresse || null, date_debut: v.date_debut, date_fin: v.date_fin,
        renouvellement_auto: v.renouvellement_auto === "1", duree_renouv_mois: parseInt(v.duree_renouv_mois) || 12, preavis_jours: parseInt(v.preavis_jours) || 0, rappel_jours: parseInt(v.rappel_jours) || 30,
        visites_par_an: parseInt(v.visites_par_an) || 1, facturation: v.facturation, montant_ht: parseNum(v.montant_ht), taux_tva: parseNum(v.taux_tva), notes: v.notes || null, ...(c ? { statut: v.statut } : {}) };
      let id = c?.id;
      if (c) await q(sb.from("contrats").update(row).eq("id", id));
      else { row.numero = ctNumero(); row.prochaine_facturation = v.date_debut; id = (await q(sb.from("contrats").insert(row).select("id").single())).id; }
      const full = { ...(c || {}), ...row, id };
      await ctGenVisites(full, full.date_debut, full.date_fin);
      api.close(); await refresh(); toast(c ? "Contrat enregistré." : `Contrat ${row.numero} créé : visites programmées.`, "ok"); if (!c) go("contrats/" + id);
    },
  });
}

const contratsActions = {
  ctNew: () => guard() && ctForm(null),
  ctEdit: (id) => guard() && ctForm(byId(db.contrats, id)),
  ctDel: async (id) => { if (!guard() || !confirm("Supprimer ce contrat, ses visites et son historique de facturation ? Les factures déjà créées sont conservées.")) return; await q(sb.from("contrats").delete().eq("id", id)); await refresh(); go("contrats"); },
  ctStatut: async (id, arg) => { if (!guard()) return; await q(sb.from("contrats").update({ statut: arg }).eq("id", id)); await refresh(); toast(`Contrat ${arg.toLowerCase()}.`, "ok"); },
  ctRenewNow: async (id) => { if (!guard()) return; const c = byId(db.contrats, id); if (!confirm(`Prolonger ce contrat de ${c.duree_renouv_mois} mois (jusqu'au ${D(addMonths(c.date_fin, c.duree_renouv_mois))}) ?`)) return; await ctRenouveler(c); await refresh(); toast("Contrat renouvelé.", "ok"); },
  ctVisitesGen: async (id) => { if (!guard()) return; const c = byId(db.contrats, id), n = await ctGenVisites(c, c.date_debut, c.date_fin); await refresh(); toast(n ? `${n} visite${n > 1 ? "s" : ""} ajoutée${n > 1 ? "s" : ""}.` : "Toutes les visites sont déjà programmées.", "ok"); },
  ctVisiteAdd: (id) => {
    if (!guard()) return;
    modal("Ajouter une visite", fld({ k: "date_prevue", l: "Date prévue", t: "date", v: today() }), { submit: "Ajouter", onSubmit: async (v, api) => { await q(sb.from("contrat_visites").insert({ contrat_id: id, date_prevue: v.date_prevue })); api.close(); await refresh(); } });
  },
  ctVisiteOk: async (id) => { if (!guard()) return; await q(sb.from("contrat_visites").update({ statut: "Réalisée", date_realisee: today() }).eq("id", id)); await refresh(); toast("Visite marquée comme réalisée.", "ok"); },
  ctVisiteNo: async (id) => { if (!guard() || !confirm("Annuler cette visite ?")) return; await q(sb.from("contrat_visites").update({ statut: "Annulée" }).eq("id", id)); await refresh(); },
  ctFacturer: async (id) => {
    if (!guard()) return;
    const c = byId(db.contrats, id);
    if (!confirm(`Créer la facture (brouillon) de ${E2(c.montant_ht)} HT pour la période à partir du ${D(c.prochaine_facturation)} ?`)) return;
    const fid = await ctFacturerEcheance(c); await refresh(); toast("Facture créée en brouillon. Vérifiez-la puis émettez-la.", "ok"); go("factures/" + fid);
  },
  ctFacturerTout: async () => {
    if (!guard()) return;
    const due = (db.contrats || []).filter(ctDue);
    if (!confirm(`Créer ${due.length} facture${due.length > 1 ? "s" : ""} en brouillon ?`)) return;
    let n = 0; for (const c of due) { try { await ctFacturerEcheance(c); n++; } catch (e) { toast(esc(`${c.libelle} : ${friendly(e)}`), "dn"); } }
    await refresh(); toast(`${n} facture${n > 1 ? "s" : ""} créée${n > 1 ? "s" : ""} en brouillon.`, "ok"); go("factures");
  },
};
