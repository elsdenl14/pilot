/* Devis et factures : listes, fiche, éditeur, PDF, partage en ligne */

const KD = {
  devis: { list: "devis", route: "devis", lt: "devis_lignes", fk: "devis_id", df: "date_devis", label: "Devis", kind: "devis" },
  facture: { list: "factures", route: "factures", lt: "factures_lignes", fk: "facture_id", df: "date_emission", label: "Facture", kind: "facture" },
};
const docNum = (d, K) => d.numero || (K === "facture" ? "Brouillon" : "-");
const docStatut = (d, K) => (K === "facture" ? d.statut_affiche : d.statut);
const UNITES = ["u", "m²", "ml", "m³", "h", "jour", "forfait", "kg", "lot"];
const TVA_TAUX = [20, 10, 5.5, 0];

async function lignesOf(K, id) {
  const k = KD[K];
  const l = await q(sb.from(k.lt).select("*").eq(k.fk, id).order("position"));
  l.forEach((x) => nz(x, ["quantite", "prix_unitaire_ht", "taux_tva"]));
  return l;
}
function totauxParTaux(lignes, d) {
  const by = {};
  for (const l of lignes) {
    const ht = r2(Number(l.quantite) * Number(l.prix_unitaire_ht));
    const k = String(Number(l.taux_tva));
    by[k] ||= { ht: 0, tva: 0 };
    by[k].ht += ht;
  }
  for (const k of Object.keys(by)) by[k].tva = r2((by[k].ht * Number(k)) / 100);
  if (!lignes.length && d && d.montant_ht > 0) by[String(Number(d.taux_tva ?? 20))] = { ht: d.montant_ht, tva: d.montant_tva };
  return by;
}

/* ---------- Tableaux ---------- */
function docTable(K, list) {
  K = K === "devis" ? "devis" : K === "factures" ? "facture" : K;
  const k = KD[K];
  return tbl([k.label, "Date", { h: "Montant TTC", r: 1 }, "Statut"],
    list.map((d) => ({ go: `${k.route}/${d.id}`, t: `${d.numero} ${d.client_nom}`,
      c: [`<strong>${esc(docNum(d, K))}</strong><small>${esc(d.client_nom)}${d.chantier_nom ? " · " + esc(d.chantier_nom) : ""}</small>`,
        D(d[k.df]), `<span class="num">${E2(d.montant_ttc)}</span>`, chip(docStatut(d, K))] })),
    `Aucun ${k.label.toLowerCase()}.`);
}
function docList(K, r) {
  const k = KD[K];
  if (r.arg) return docDetail(K, r.arg);
  const tabsDef = K === "devis"
    ? [["tous", "Tous"], ["Brouillon", "Brouillons"], ["Envoyé", "Envoyés"], ["Accepté", "Acceptés"], ["Refusé", "Refusés"]]
    : [["tous", "Toutes"], ["Brouillon", "Brouillons"], ["ouv", "À encaisser"], ["En retard", "En retard"], ["Payée", "Payées"]];
  const cur = ST.tab[k.list] || "tous";
  const list = db[k.list].filter((d) => cur === "tous" || (cur === "ouv" ? ["Envoyée", "Partiellement payée"].includes(d.statut) : docStatut(d, K) === cur));
  const total = sum(list, (d) => d.montant_ttc);
  const rows = list.map((d) => ({ go: `${k.route}/${d.id}`, t: `${d.numero || ""} ${d.client_nom} ${d.chantier_nom || ""}`,
    c: [`<strong>${esc(docNum(d, K))}</strong>`, `${esc(d.client_nom)}${d.chantier_nom ? `<small>${esc(d.chantier_nom)}</small>` : ""}`,
      D(K === "devis" ? d.date_devis : d.statut === "Brouillon" ? d.date_emission : d.echeance),
      `<span class="num">${E2(d.montant_ttc)}</span>`,
      K === "facture" && d.reste > 0 && d.statut !== "Brouillon" ? `<span class="num ${d.statut_affiche === "En retard" ? "dn" : ""}">${E2(d.reste)}</span>` : K === "facture" ? "" : null,
      chip(docStatut(d, K))].filter((x) => x !== null) }));
  const cols = K === "devis"
    ? [k.label, "Client", "Date", { h: "Montant TTC", r: 1 }, "Statut"]
    : [k.label, "Client", "Échéance", { h: "Montant TTC", r: 1 }, { h: "Reste dû", r: 1 }, "Statut"];
  return page(K === "devis" ? "Devis" : "Factures",
    K === "devis" ? "Créer, envoyer et suivre vos propositions commerciales." : "Émettre, envoyer et suivre vos factures jusqu'au paiement.",
    btn(K === "devis" ? "Nouveau devis" : "Nouvelle facture", K === "devis" ? "devisNew" : "factureNew", "", "", "w"),
    tabs(k.list, tabsDef, cur) + searchBar("Rechercher un numéro, un client, un chantier…", `${list.length} document${list.length > 1 ? "s" : ""} · ${E(total)} TTC`) +
      card("", tbl(cols, rows, K === "devis" ? "Aucun devis. Créez le premier avec le bouton « Nouveau devis »." : "Aucune facture. Transformez un devis accepté en facture ou créez-en une.")));
}
V.devis = (r) => docList("devis", r);
V.factures = (r) => docList("facture", r);

/* ---------- Fiche d'un document ---------- */
function docPreview(K, d, lignes) {
  const e = db.ent, c = clientOf(d.client_id) || {}, k = KD[K];
  const by = totauxParTaux(lignes, d);
  const rates = Object.keys(by).sort((a, b) => b - a);
  const lht = (l) => r2(l.quantite * l.prix_unitaire_ht);
  const gs = lignes.length ? groupCats(lignes) : [];
  gs.forEach((g) => (g.sum = r2(sum(g.lignes, lht))));
  const recap = gs.filter((g) => g.cat).length >= 2 ? `<div class="doc-recap"><b>Récapitulatif des travaux</b>${gs.map((g, i) => `<div><span>${i + 1}. ${esc(g.cat || "Divers")}</span><span class="num">${E2(g.sum)}</span></div>`).join("")}</div>` : "";
  const rows = gs.length
    ? gs.map((g, gi) => (g.cat ? `<tr class="cc"><td colspan="5">${gi + 1}. ${esc(g.cat)}</td><td class="r">Sous-total ${E2(g.sum)}</td></tr>` : "") +
      g.lignes.map((l, li) => `<tr><td class="n">${gi + 1}.${li + 1}</td><td>${esc(l.designation)}${l.description ? `<small class="ld">${esc(l.description).replace(/\n/g, "<br>")}</small>` : ""}</td><td class="r">${fmtNum(l.quantite, Number.isInteger(l.quantite) ? 0 : 2)} ${esc(l.unite || "")}</td><td class="r">${fmtNum(l.prix_unitaire_ht)}</td><td class="r">${fmtNum(l.taux_tva, l.taux_tva % 1 ? 1 : 0)} %</td><td class="r"><b>${fmtNum(lht(l))}</b></td></tr>`).join("")).join("")
    : `<tr><td colspan="6" class="mut">Aucune ligne détaillée (montant global).</td></tr>`;
  const paye = K === "facture" ? d.paye : 0;
  return `<div class="doc">
    <div class="doc-h doc-top"><div><b>${esc(e.nom || "Votre entreprise")}</b><small>${esc(e.adresse || "")}</small><small>${esc([e.telephone, e.email].filter(Boolean).join(" · "))}</small></div>
      <div style="text-align:right"><b>${k.label} ${esc(docNum(d, K))}</b><small>Date : ${D(d[k.df])}</small><small>${K === "devis" ? `Valable ${d.validite_jours} jours` : `Échéance : ${D(d.echeance)}`}</small></div></div>
    <div class="doc-h"><div><small>${K === "devis" ? "Destinataire" : "Facturé à"}</small><b>${esc(c.nom || d.client_nom)}</b><small>${esc(c.adresse || "")}</small><small>${esc(c.ville || "")}</small></div>
      ${d.chantier_nom ? `<div style="text-align:right"><small>Chantier</small><b>${esc(d.chantier_nom)}</b></div>` : ""}</div>
    ${recap}
    <div class="tw"><table class="dt"><thead><tr><th class="n">N°</th><th>Désignation</th><th class="r">Quantité</th><th class="r">P.U. HT</th><th class="r">TVA</th><th class="r">Total HT</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="totaux"><div><span>Total HT</span><span class="num">${E2(d.montant_ht)}</span></div>
      ${rates.map((t) => `<div><span>TVA ${fmtNum(t, t % 1 ? 1 : 0)} %</span><span class="num">${E2(by[t].tva)}</span></div>`).join("")}
      <div class="ttc"><span>Total TTC</span><span class="num">${E2(d.montant_ttc)}</span></div>
      ${K === "facture" && paye > 0 ? `<div><span>Déjà réglé</span><span class="num">- ${E2(paye)}</span></div><div class="reste"><span>Reste à payer</span><span class="num">${E2(d.reste)}</span></div>` : ""}</div>
    ${d.notes ? `<p class="mut" style="margin:18px 0 0;white-space:pre-line">${esc(d.notes)}</p>` : ""}</div>`;
}
const shareLink = (token) => new URL("p.html?t=" + token, location.href).href;

async function docDetail(K, id) {
  const k = KD[K];
  const d = byId(db[k.list], id);
  if (!d) return `<div class="empty"><h2>${k.label} introuvable</h2><button class="btn" data-go="${k.route}">Retour à la liste</button></div>`;
  const lignes = await lignesOf(K, id);
  const p = partageOf(id);
  const st = docStatut(d, K);
  const fac = K === "devis" ? devisFacture(id) : null;
  const dv = K === "facture" && d.devis_id ? byId(db.devis, d.devis_id) : null;
  let actions = btn("Visualiser le PDF", K === "devis" ? "devisPdf" : "facturePdf", id, "", "");
  if (K === "devis") {
    if (fac) actions += `<a class="btn o" href="#/factures/${fac.id}">Voir la facture ${esc(fac.numero || "(brouillon)")}</a>`;
    else if (d.statut !== "Refusé") actions += btn("Transformer en facture", "devisToFacture", id, "", "o w");
    if (d.statut === "Brouillon" || d.statut === "Envoyé") actions += btn(d.statut === "Brouillon" ? "Envoyer au client" : "Lien client", "devisSend", id, "", "o w");
    if (d.statut === "Brouillon") actions += btn("Modifier", "devisEdit", id, "", "o w");
    if (d.statut === "Envoyé") actions += btn("Marquer accepté", "devisStatut", id, "Accepté", "o w") + btn("Refusé", "devisStatut", id, "Refusé", "o w");
    actions += btn("Dupliquer", "devisDup", id, "", "o w");
    if (d.statut === "Brouillon") actions += btn("Supprimer", "devisDel", id, "", "dn-o w");
  } else {
    if (d.statut === "Brouillon") actions += btn("Émettre la facture", "factureEmettre", id, "", "w") + btn("Modifier", "factureEdit", id, "", "o w") + btn("Supprimer", "factureDel", id, "", "dn-o w");
    else {
      if (d.reste > 0 && d.statut !== "Annulée") actions += btn("Enregistrer un paiement", "payNew", id, "", "w");
      if (d.statut !== "Annulée") actions += btn("Envoyer au client", "factureSend", id, "", "o w");
      if (d.statut_affiche === "En retard") actions += btn("Relancer", "factureRelance", id, "", "o w");
      if (d.statut === "Envoyée" && !d.paye) actions += btn("Annuler", "factureAnnuler", id, "", "dn-o w");
    }
  }
  const paiements = K === "facture" ? db.paiements.filter((x) => x.facture_id === id) : [];
  const suivi = `<dl class="kv"><dt>Statut</dt><dd>${chip(st)}</dd>
    <dt>Client</dt><dd><a href="#/clients/${d.client_id}">${esc(d.client_nom)}</a></dd>
    ${d.chantier_nom ? `<dt>Chantier</dt><dd><a href="#/chantiers/${d.chantier_id}">${esc(d.chantier_nom)}</a></dd>` : ""}
    <dt>${K === "devis" ? "Date" : "Émission"}</dt><dd>${D(d[k.df])}</dd>
    ${K === "facture" ? `<dt>Échéance</dt><dd>${D(d.echeance)}</dd>` : `<dt>Validité</dt><dd>${d.validite_jours} jours</dd>`}
    ${dv ? `<dt>Devis d'origine</dt><dd><a href="#/devis/${dv.id}">${esc(dv.numero)}</a></dd>` : ""}</dl>`;
  const partageHtml = p
    ? `<dl class="kv"><dt>Lien client</dt><dd><a href="${shareLink(p.token)}" target="_blank" rel="noopener">Ouvrir la page du client</a></dd>
        <dt>Consultation</dt><dd>${p.vu_at ? "Ouvert le " + new Date(p.vu_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "Pas encore ouvert"}</dd>
        ${K === "devis" ? `<dt>Réponse</dt><dd>${p.accepte_at ? `<span class="chip ok">Accepté</span> par ${esc(p.accepte_par || "")}` : p.refuse_at ? `<span class="chip dn">Refusé</span>` : "En attente"}</dd>` : ""}</dl>`
    : `<p class="mut" style="margin:0;padding:16px 18px">Pas encore envoyé en ligne. « ${K === "devis" ? "Envoyer au client" : "Envoyer au client"} » crée un lien que votre client ouvre sans compte${K === "devis" ? " pour accepter ou refuser le devis" : ""}.</p>`;
  const payHtml = K === "facture" && paiements.length
    ? card("Paiements reçus", paiements.map((x) => `<div class="row"><div><b>${E2(x.montant)}</b><small>${D(x.date_paiement)} · ${esc(x.mode)}</small></div><button class="lk w" data-act="payDel" data-id="${x.id}">Supprimer</button></div>`).join(""))
    : "";
  const echHtml = K === "facture" && d.statut !== "Annulée" ? echCard(d) : "";
  return page(`${esc(docNum(d, K))} ${chip(st)}`, `${esc(d.client_nom)} · ${E2(d.montant_ttc)} TTC`, `${actions}`,
    `<div class="g2"><div>${docPreview(K, d, lignes)}</div><div>${card("Suivi", suivi)}${card("Partage en ligne", partageHtml)}${echHtml}${payHtml}</div></div>`,
    crumbs([K === "devis" ? "Devis" : "Factures", k.route], [docNum(d, K)]));
}

/* ---------- Éditeur (devis / facture) : catégories > lignes (+ description) ---------- */
function ligneRow(l = {}) {
  const tva = l.taux_tva ?? (Number(db.ent.taux_tva_defaut) || 20);
  return `<tr class="lr"><td><input type="text" data-f="des" value="${esc(l.designation || "")}" placeholder="Désignation de la prestation"><textarea data-f="desc" rows="1" placeholder="Description (facultatif) : détails, matériaux, normes…">${esc(l.description || "")}</textarea></td>
    <td style="width:78px"><input type="text" inputmode="decimal" data-f="qte" value="${l.quantite !== undefined ? String(l.quantite).replace(".", ",") : "1"}"></td>
    <td style="width:86px"><input type="text" data-f="uni" list="unites" value="${esc(l.unite || "u")}"></td>
    <td style="width:104px"><input type="text" inputmode="decimal" data-f="pu" value="${l.prix_unitaire_ht !== undefined ? String(l.prix_unitaire_ht).replace(".", ",") : ""}" placeholder="0,00"></td>
    <td style="width:84px"><select data-f="tva">${[...new Set([...TVA_TAUX, Number(tva)])].map((t) => `<option value="${t}"${Number(t) === Number(tva) ? " selected" : ""}>${String(t).replace(".", ",")} %</option>`).join("")}</select></td>
    <td class="lt" style="width:100px"><span data-f="tot">0,00</span></td>
    <td style="width:34px"><button type="button" class="rm" data-rm title="Supprimer la ligne" aria-label="Supprimer la ligne">${svg(ic.x)}</button></td></tr>`;
}
// Regroupe les lignes consécutives qui ont la même catégorie
function groupCats(ls) {
  const out = [];
  for (const l of ls.length ? ls : [{}]) {
    const c = String(l.categorie || "").trim(), last = out[out.length - 1];
    if (last && last.cat === c) last.lignes.push(l); else out.push({ cat: c, lignes: [l] });
  }
  return out;
}
const catBlock = (g) => `<section class="cat"><div class="cat-h"><input type="text" data-f="cat" value="${esc(g.cat)}" placeholder="Nom de la catégorie (ex : Démolition, Plomberie…)" aria-label="Catégorie"><span class="num cat-sub" data-f="sub"></span><button type="button" class="rm" data-rmcat title="Supprimer la catégorie" aria-label="Supprimer la catégorie">${svg(ic.x)}</button></div>
  <div class="tw"><table class="lines"><thead><tr><th>Désignation</th><th>Qté</th><th>Unité</th><th>P.U. HT</th><th>TVA</th><th class="r">Total HT</th><th></th></tr></thead><tbody class="lb">${g.lignes.map(ligneRow).join("")}</tbody></table></div>
  <button type="button" class="btn o sm" data-addl>+ Ajouter une ligne</button></section>`;
function readLignes(root) {
  const out = [];
  $$(".cat", root).forEach((sec) => {
    const categorie = $('[data-f="cat"]', sec).value.trim();
    $$(".lr", sec).forEach((tr) => out.push({
      categorie, designation: $('[data-f="des"]', tr).value.trim(), description: $('[data-f="desc"]', tr).value.trim(),
      quantite: parseNum($('[data-f="qte"]', tr).value), unite: $('[data-f="uni"]', tr).value.trim() || "u",
      prix_unitaire_ht: parseNum($('[data-f="pu"]', tr).value), taux_tva: Number($('[data-f="tva"]', tr).value),
    }));
  });
  return out;
}
function recalcLignes(root) {
  const ls = readLignes(root);
  let i = 0;
  $$(".cat", root).forEach((sec) => {
    let s = 0;
    $$(".lr", sec).forEach((tr) => { const l = ls[i++], t = r2(l.quantite * l.prix_unitaire_ht); s += t; $('[data-f="tot"]', tr).textContent = fmtNum(t); });
    $('[data-f="sub"]', sec).textContent = "Sous-total " + E2(s);
  });
  const by = totauxParTaux(ls.filter((l) => l.designation || l.prix_unitaire_ht));
  const ht = sum(Object.values(by), (x) => x.ht), tva = sum(Object.values(by), (x) => x.tva);
  $("#totbox", root).innerHTML = `<div><span>Total HT</span><span class="num">${E2(ht)}</span></div>${Object.keys(by).sort((a, b) => b - a).map((t) => `<div><span>TVA ${String(t).replace(".", ",")} %</span><span class="num">${E2(by[t].tva)}</span></div>`).join("")}<div class="ttc"><span>Total TTC</span><span class="num">${E2(ht + tva)}</span></div>`;
}
// Les colonnes categorie / description sont écrites après l'enregistrement (par position)
async function saveCats(K, id, ls) {
  const k = KD[K];
  const rows = await q(sb.from(k.lt).select("id").eq(k.fk, id).order("position"));
  await Promise.all(rows.map((r, i) => (ls[i] ? q(sb.from(k.lt).update({ categorie: ls[i].categorie || null, description: ls[i].description || null }).eq("id", r.id)) : null)));
}
async function copyCats(did, fid) {
  try {
    const a = await q(sb.from("devis_lignes").select("categorie,description").eq("devis_id", did).order("position"));
    const b = await q(sb.from("factures_lignes").select("id").eq("facture_id", fid).order("position"));
    await Promise.all(b.map((r, i) => (a[i] ? q(sb.from("factures_lignes").update({ categorie: a[i].categorie, description: a[i].description }).eq("id", r.id)) : null)));
  } catch (e) { console.warn("Catégories non copiées", e); }
}

async function docForm(K, d, opts = {}) {
  if (!guard()) return;
  const k = KD[K];
  const lignes = d ? await lignesOf(K, d.id) : opts.lignes || [];
  let preClient = opts.client || d?.client_id || "";
  if (opts.chantier) preClient = byId(db.chantiers, opts.chantier)?.client_id || preClient;
  const chOpts = (cid) => [{ v: "", l: "Sans chantier" }, ...db.chantiers.filter((c) => !cid || c.client_id === cid).map((c) => ({ v: c.id, l: c.nom }))];
  const body = `<datalist id="unites">${UNITES.map((u) => `<option value="${u}">`).join("")}</datalist><div class="frm">
    ${clientBlock(preClient)}
    ${fld({ k: "chantier_id", l: "Chantier", t: "select", o: chOpts(preClient || db.clients[0]?.id), v: opts.chantier || d?.chantier_id || "", r: 0 })}
    ${fld({ k: "date", l: K === "devis" ? "Date du devis" : "Date de la facture", t: "date", v: d?.[k.df] || today() })}
    ${K === "devis" ? fld({ k: "validite_jours", l: "Validité (jours)", t: "number", v: d?.validite_jours || 30 }) : fld({ k: "echeance", l: "Échéance de paiement", t: "date", v: d?.echeance || addDays(today(), Number(db.ent.delai_paiement_jours) || 30) })}
    <div class="full"><div id="cats">${groupCats(lignes).map(catBlock).join("")}</div>
      <div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-top:10px;flex-wrap:wrap"><button type="button" class="btn o sm" id="addc">+ Ajouter une catégorie</button><div class="totbox" id="totbox"></div></div></div>
    ${fld({ k: "notes", l: "Remarques (apparaissent sur le document)", t: "textarea", v: d?.notes || "", r: 0, cls: "full" })}
  </div>`;
  modal(d ? `Modifier ${esc(docNum(d, K))}` : `Nouveau ${k.label.toLowerCase()}`, body, {
    xl: true, wide: true, submit: d ? "Enregistrer" : "Créer le brouillon",
    onMount: (m) => {
      bindClientBlock(m, (cid) => { const s = $("#f_chantier_id", m); s.innerHTML = chOpts(cid === "__new" ? "none" : cid).map((o) => `<option value="${esc(o.v)}">${esc(o.l)}</option>`).join(""); });
      m.addEventListener("input", (e) => { if (e.target.closest(".cat")) recalcLignes(m); });
      m.addEventListener("click", (e) => {
        const t = e.target;
        if (t.closest("#addc")) { $("#cats", m).insertAdjacentHTML("beforeend", catBlock({ cat: "", lignes: [{}] })); $$('[data-f="cat"]', m).pop().focus(); }
        const al = t.closest("[data-addl]");
        if (al) { const lb = $(".lb", al.closest(".cat")); lb.insertAdjacentHTML("beforeend", ligneRow({ taux_tva: Number($('[data-f="tva"]', lb.lastElementChild)?.value) || undefined })); $$('[data-f="des"]', lb).pop().focus(); }
        const rc = t.closest("[data-rmcat]");
        if (rc) { const sec = rc.closest(".cat"); if ($$(".cat", m).length > 1) sec.remove(); else { $$("input,textarea", sec).forEach((i) => (i.value = "")); $$(".lr", sec).slice(1).forEach((r) => r.remove()); } }
        const rm = t.closest("[data-rm]");
        if (rm) { const lb = rm.closest(".lb"); if ($$(".lr", lb).length > 1) rm.closest("tr").remove(); else $$("input,textarea", rm.closest("tr")).forEach((i) => (i.value = "")); }
        recalcLignes(m);
      });
      recalcLignes(m);
    },
    onSubmit: async (v, api) => {
      const ls = readLignes(api.el).filter((l) => l.designation || l.prix_unitaire_ht);
      if (!ls.length) throw new Error("Ajoutez au moins une ligne avec une désignation et un prix.");
      const cid = await resolveClient(v);
      const payload = { id: d?.id || null, client_id: cid, chantier_id: v.chantier_id || null, date: v.date, notes: v.notes || null, lignes: ls,
        ...(K === "devis" ? { validite_jours: parseInt(v.validite_jours) || 30 } : { echeance: v.echeance }) };
      const id = await q(sb.rpc("sauver_document", { p_kind: K, p: payload }));
      try { await saveCats(K, id, ls); } catch (e) { console.warn(e); toast("Document enregistré, mais les catégories et descriptions n'ont pas pu l'être : exécutez migration_v4.sql dans Supabase.", "dn"); }
      api.close();
      toast(d ? "Modifications enregistrées." : `${k.label} créé en brouillon.`, "ok");
      await refresh();
      go(`${k.route}/${id}`);
    },
  });
}

/* ---------- PDF ---------- */
const _assets = new Map();
async function getAsset(path) {
  if (!path) return null;
  if (_assets.has(path)) return _assets.get(path);
  const { data, error } = await sb.storage.from("documents").download(path);
  if (error) throw new Error("Impossible de lire le fichier du modèle : " + error.message);
  const b = new Uint8Array(await data.arrayBuffer());
  _assets.set(path, b);
  return b;
}
async function pdfContext(K) {
  const e = db.ent, regl = e.pdf_reglages || {};
  const path = K === "devis" ? e.modele_devis_fichier : e.modele_facture_fichier;
  const ctx = { ent: e, regl };
  try {
    if (path) ctx.fond = { bytes: await getAsset(path) };
    else if (e.logo_path) ctx.logo = { bytes: await getAsset(e.logo_path) };
  } catch (err) { toast("Modèle importé illisible : le modèle classique est utilisé. " + esc(err.message), "dn"); }
  return ctx;
}
async function docPdfBytes(K, id) {
  const k = KD[K], d = byId(db[k.list], id);
  const lignes = await lignesOf(K, id);
  const c = clientOf(d.client_id) || {}, ch = d.chantier_id ? byId(db.chantiers, d.chantier_id) : null;
  const dv = K === "facture" && d.devis_id ? byId(db.devis, d.devis_id) : null;
  const data = {
    kind: K, numero: d.numero || (K === "facture" ? "(brouillon)" : ""), date: d[k.df], echeance: d.echeance, validite_jours: d.validite_jours,
    statut: d.statut, notes: d.notes, client: { nom: c.nom || d.client_nom, adresse: c.adresse, ville: c.ville, email: c.email, telephone: c.telephone },
    chantier: ch ? { nom: ch.nom, ville: ch.ville } : null, lignes, ht: d.montant_ht, tva: d.montant_tva, ttc: d.montant_ttc, taux_tva: d.taux_tva,
    paye: d.paye || 0, devis_numero: dv?.numero,
  };
  return PilotPdf.build(data, await pdfContext(K));
}
function openPdfModal(title, bytes, filename) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const api = modal(title, `<iframe class="pdfbox" src="${url}#toolbar=0" title="${esc(title)}"></iframe>
    <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap"><a class="btn o" href="${url}" target="_blank" rel="noopener">Ouvrir dans un onglet</a><button type="button" class="btn o" id="pp">Imprimer</button><a class="btn" href="${url}" download="${esc(filename)}">Télécharger le PDF</a></div>`,
    { xl: true, wide: true, submit: false, noFocus: true });
  $("#pp", api.el).onclick = () => { try { $("iframe", api.el).contentWindow.print(); } catch (e) { window.open(url); } };
  const close = api.close;
  api.close = () => { close(); setTimeout(() => URL.revokeObjectURL(url), 2000); };
  $$("[data-x]", api.el).forEach((b) => (b.onclick = api.close));
  return api;
}
async function docPdf(K, id) {
  const d = byId(db[KD[K].list], id);
  toast("Génération du PDF…");
  const bytes = await docPdfBytes(K, id);
  openPdfModal(`${KD[K].label} ${docNum(d, K)}`, bytes, `${slug(docNum(d, K) === "Brouillon" ? "facture-brouillon" : d.numero)}.pdf`);
}

/* ---------- Partage en ligne ---------- */
async function docShare(K, id) {
  if (!guard()) return;
  const k = KD[K], d = byId(db[k.list], id);
  if (K === "facture" && d.statut === "Brouillon") return toast("Émettez la facture avant de l'envoyer au client.", "dn");
  toast("Préparation du lien…");
  const bytes = await docPdfBytes(K, id);
  let p = partageOf(id);
  if (!p) p = await q(sb.from("partages").insert({ type: K, doc_id: id }).select("token").single());
  const path = `${uid}/${p.token}.pdf`;
  const up = await sb.storage.from("partages").upload(path, new Blob([bytes], { type: "application/pdf" }), { upsert: true, contentType: "application/pdf" });
  if (up.error) throw up.error;
  await q(sb.from("partages").update({ pdf_path: path }).eq("token", p.token));
  if (K === "devis" && d.statut === "Brouillon") await q(sb.from("devis").update({ statut: "Envoyé" }).eq("id", id));
  await refresh();
  showShare(K, id, p.token);
}
function mailFor(K, d, link) {
  const c = clientOf(d.client_id) || {}, e = db.ent;
  const sujet = K === "devis" ? `Devis ${d.numero} - ${e.nom || ""}` : `Facture ${d.numero} - ${e.nom || ""}`;
  const corps = K === "devis"
    ? `Bonjour,\n\nVeuillez trouver votre devis ${d.numero} d'un montant de ${E2(d.montant_ttc)} TTC.\nVous pouvez le consulter, l'accepter ou le refuser en ligne : ${link}\n\nCordialement,\n${e.nom || ""}`
    : `Bonjour,\n\nVeuillez trouver votre facture ${d.numero} d'un montant de ${E2(d.montant_ttc)} TTC, à régler avant le ${D(d.echeance)}.\nVous pouvez la consulter et la télécharger ici : ${link}\n\nCordialement,\n${e.nom || ""}`;
  return `mailto:${encodeURIComponent(c.email || "")}?subject=${encodeURIComponent(sujet)}&body=${encodeURIComponent(corps)}`;
}
function showShare(K, id, token) {
  const k = KD[K], d = byId(db[k.list], id), link = shareLink(token), c = clientOf(d.client_id) || {};
  const api = modal(`${k.label} ${esc(d.numero)} : lien client`, `<div class="sharebox">
      <p style="margin:0" class="mut">${K === "devis" ? "Votre client ouvre ce lien sans créer de compte : il voit le devis en PDF et peut l'accepter ou le refuser. Vous êtes notifié dans Pilot." : "Votre client ouvre ce lien sans créer de compte : il voit la facture, la télécharge et trouve vos coordonnées bancaires."}</p>
      <div class="lnk-in"><input type="text" readonly value="${esc(link)}" id="shl"><button type="button" class="btn o" id="cpl">Copier le lien</button></div>
      ${c.email ? "" : `<p class="badge-warn" style="margin:0">Ce client n'a pas d'adresse email : ajoutez-la dans sa fiche pour préremplir le message.</p>`}
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap"><a class="btn o" href="${esc(link)}" target="_blank" rel="noopener">Voir la page client</a><a class="btn" href="${mailFor(K, d, link)}">Écrire l'email</a></div>`, { submit: false, noFocus: true });
  $("#cpl", api.el).onclick = async () => { try { await navigator.clipboard.writeText(link); toast("Lien copié.", "ok"); } catch (e) { $("#shl", api.el).select(); } };
}
async function docRelance(K, id) {
  const k = KD[K], d = byId(db[k.list], id), c = clientOf(d.client_id) || {}, p = partageOf(id), e = db.ent;
  if (!c.email) return toast("Ajoutez l'adresse email du client dans sa fiche pour préparer la relance.", "dn");
  const link = p ? shareLink(p.token) : "";
  const sujet = K === "devis" ? `Relance : devis ${d.numero}` : `Relance : facture ${d.numero}`;
  const corps = K === "devis"
    ? `Bonjour,\n\nJe me permets de revenir vers vous au sujet du devis ${d.numero} (${E2(d.montant_ttc)} TTC) envoyé le ${D(d.date_devis)}.\nAvez-vous eu le temps de le consulter ?${link ? "\nVous pouvez l'accepter en ligne : " + link : ""}\n\nCordialement,\n${e.nom || ""}`
    : `Bonjour,\n\nSauf erreur de notre part, la facture ${d.numero} d'un montant restant dû de ${E2(d.reste)} TTC, échue le ${D(d.echeance)}, n'a pas encore été réglée.\nMerci de procéder au règlement dans les meilleurs délais, ou de nous contacter si un paiement est déjà en cours.${link ? "\nFacture : " + link : ""}\n\nCordialement,\n${e.nom || ""}`;
  location.href = `mailto:${encodeURIComponent(c.email)}?subject=${encodeURIComponent(sujet)}&body=${encodeURIComponent(corps)}`;
}

/* ---------- Actions sur les documents ---------- */
const docActions = {
  devisNew: (id, arg) => docForm("devis", null, { client: arg?.startsWith("client:") ? arg.slice(7) : "", chantier: arg?.startsWith("chantier:") ? arg.slice(9) : "" }),
  factureNew: (id, arg) => docForm("facture", null, { client: arg?.startsWith("client:") ? arg.slice(7) : "", chantier: arg?.startsWith("chantier:") ? arg.slice(9) : "" }),
  devisEdit: (id) => docForm("devis", byId(db.devis, id)),
  factureEdit: (id) => docForm("facture", byId(db.factures, id)),
  devisDup: async (id) => { const d = byId(db.devis, id); const l = await lignesOf("devis", id); docForm("devis", null, { client: d.client_id, chantier: d.chantier_id, lignes: l }); },
  devisPdf: (id) => docPdf("devis", id),
  facturePdf: (id) => docPdf("facture", id),
  devisSend: (id) => docShare("devis", id),
  factureSend: (id) => docShare("facture", id),
  devisRelance: (id) => docRelance("devis", id),
  factureRelance: (id) => docRelance("facture", id),
  devisStatut: async (id, s) => { await q(sb.from("devis").update({ statut: s }).eq("id", id)); toast(`Devis marqué « ${s.toLowerCase()} ».`, "ok"); await refresh(); },
  devisDel: async (id) => {
    if (!confirm("Supprimer ce brouillon de devis ?")) return;
    await q(sb.from("devis").delete().eq("id", id)); toast("Devis supprimé."); await refresh(); go("devis");
  },
  devisToFacture: async (id) => {
    const d = byId(db.devis, id);
    const fid = await q(sb.rpc("devis_vers_facture", { p_devis: id }));
    await copyCats(id, fid);
    await refresh();
    toast(`Facture créée en brouillon depuis ${esc(d.numero)}. Vérifiez-la puis émettez-la.`, "ok");
    go("factures/" + fid);
  },
  factureEmettre: async (id) => {
    if (!confirm("Émettre cette facture ?\n\nUn numéro définitif lui sera attribué (sans trou dans la numérotation) et elle ne pourra plus être modifiée ni supprimée.")) return;
    await q(sb.from("factures").update({ statut: "Envoyée" }).eq("id", id));
    await refresh();
    toast(`Facture ${esc(byId(db.factures, id).numero)} émise.`, "ok");
  },
  factureAnnuler: async (id) => {
    if (!confirm("Annuler cette facture ? Son numéro reste utilisé dans la numérotation.")) return;
    await q(sb.from("factures").update({ statut: "Annulée" }).eq("id", id)); await refresh();
  },
  factureDel: async (id) => {
    if (!confirm("Supprimer ce brouillon de facture ?")) return;
    await q(sb.from("factures").delete().eq("id", id)); toast("Facture supprimée."); await refresh(); go("factures");
  },
};

/* ---------- Échéancier : payer une facture en plusieurs fois ---------- */
const echOf = (fid) => db.echeances.filter((e) => e.facture_id === fid);
// Les paiements reçus remplissent les échéances dans l'ordre
function echStatut(f) {
  let rest = Number(f.paye) || 0;
  const t = today();
  return echOf(f.id).map((e) => {
    const part = Math.min(e.montant, Math.max(0, rest));
    rest = r2(rest - part);
    const reste = r2(e.montant - part);
    return { ...e, payeE: part, reste, etat: reste <= 0.005 ? "Payée" : part > 0 ? "Partiellement payée" : e.date_echeance < t ? "En retard" : "À venir" };
  });
}
const prochEch = (f) => echStatut(f).find((e) => e.reste > 0.005);
const payDefault = (f, a) => (a && Number(a) > 0 ? Math.min(Number(a), f.reste) : (prochEch(f)?.reste ?? f.reste));

function echCard(f) {
  const l = echStatut(f), ouvert = f.reste > 0.005 && f.statut !== "Brouillon";
  const act = ouvert ? btn(l.length ? "Modifier" : "Payer en plusieurs fois", "echForm", f.id, "", "o sm w") : "";
  if (!l.length) return ouvert ? card("Échéancier", `<p class="mut" style="margin:0;padding:16px 18px">Paiement en une fois. Pour un acompte ou des mensualités, utilisez « Payer en plusieurs fois » : chaque paiement reçu est suivi échéance par échéance.</p>`, act) : "";
  return card("Échéancier de paiement", l.map((e) => `<div class="row"><div><b>${E2(e.montant)}</b><small>${esc(e.libelle || "Échéance")} · ${D(e.date_echeance)}</small></div><span>${chip(e.etat)} ${e.reste > 0.005 && ouvert ? btn("Encaisser", "payNew", f.id, String(e.reste), "o sm w") : ""}</span></div>`).join("") +
    (ouvert ? `<div class="row"><button class="lk w" data-act="echDel" data-id="${f.id}">Supprimer l'échéancier</button></div>` : ""), act);
}

function echForm(fid) {
  if (!guard()) return;
  const f = byId(db.factures, fid), T = f.montant_ttc, ex = echOf(fid);
  const gen = (n, ac, d0, step) => {
    const out = [];
    let rest = T;
    if (ac > 0) { const a = r2((T * ac) / 100); out.push(a); rest = r2(T - a); }
    const nn = ac > 0 ? n - 1 : n, part = r2(rest / nn);
    for (let i = 0; i < nn; i++) out.push(i === nn - 1 ? r2(rest - part * (nn - 1)) : part);
    return out.map((m, i) => ({ libelle: ac > 0 ? (i === 0 ? "Acompte" : i === out.length - 1 ? "Solde" : `Échéance ${i}`) : `Échéance ${i + 1}`, montant: m, date_echeance: addDays(d0, i * step) }));
  };
  const draw = (m, list) => {
    $("#echl", m).innerHTML = list.map((e) => `<div class="echr"><input type="text" data-e="lib" value="${esc(e.libelle || "")}" aria-label="Libellé"><input type="date" data-e="d" value="${e.date_echeance}" aria-label="Date"><input type="text" inputmode="decimal" data-e="m" value="${String(e.montant).replace(".", ",")}" aria-label="Montant"></div>`).join("") + `<p class="mut" id="echs" style="margin:6px 0 0"></p>`;
    sumUp(m);
  };
  const read = (m) => $$(".echr", m).map((r) => ({ libelle: $('[data-e="lib"]', r).value.trim(), date_echeance: $('[data-e="d"]', r).value, montant: parseNum($('[data-e="m"]', r).value) }));
  const sumUp = (m) => { const s = r2(sum(read(m), (e) => e.montant)), ok = Math.abs(s - T) < 0.01; const el = $("#echs", m); el.className = ok ? "up" : "dn"; el.textContent = `Total des échéances : ${E2(s)} sur ${E2(T)} TTC${ok ? "" : ` (écart ${E2(r2(T - s))})`}`; };
  const body = `<div class="frm">${fld({ k: "n", l: "Nombre d'échéances", t: "select", o: [2, 3, 4, 5, 6, 8, 10, 12].map(String), v: String(ex.length || 3) })}
    ${fld({ k: "ac", l: "Acompte à la commande (%)", t: "number", v: ex.length ? "0" : "30", r: 0, hint: "0 = échéances égales" })}
    ${fld({ k: "d0", l: "Première échéance", t: "date", v: ex[0]?.date_echeance || today() })}
    ${fld({ k: "step", l: "Intervalle (jours)", t: "number", v: "30" })}<div class="full" id="echl"></div></div>`;
  modal("Payer en plusieurs fois · " + esc(f.numero), body, {
    wide: true, submit: "Enregistrer l'échéancier",
    onMount: (m) => {
      const regen = () => { const v = Object.fromEntries(new FormData(m.querySelector("form"))); draw(m, gen(Number(v.n) || 2, Math.min(95, parseNum(v.ac)), v.d0 || today(), parseInt(v.step) || 30)); };
      ["n", "ac", "d0", "step"].forEach((k) => ($("#f_" + k, m).onchange = regen));
      m.addEventListener("input", (e) => { if (e.target.closest(".echr")) sumUp(m); });
      if (ex.length) draw(m, ex); else regen();
    },
    onSubmit: async (v, api) => {
      const l = read(api.el);
      if (l.some((e) => !e.date_echeance || e.montant <= 0)) throw new Error("Chaque échéance doit avoir une date et un montant.");
      if (Math.abs(r2(sum(l, (e) => e.montant)) - T) >= 0.01) throw new Error(`Le total des échéances doit être égal au montant TTC (${E2(T)}).`);
      await q(sb.from("facture_echeances").delete().eq("facture_id", fid));
      await q(sb.from("facture_echeances").insert(l.map((e, i) => ({ facture_id: fid, position: i, libelle: e.libelle || null, date_echeance: e.date_echeance, montant: e.montant }))));
      api.close(); toast("Échéancier enregistré.", "ok"); await refresh();
    },
  });
}
Object.assign(docActions, {
  echForm: (id) => echForm(id),
  echDel: async (id) => { if (!guard() || !confirm("Supprimer l'échéancier ? Les paiements déjà reçus sont conservés.")) return; await q(sb.from("facture_echeances").delete().eq("facture_id", id)); await refresh(); },
});
