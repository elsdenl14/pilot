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
  const rows = lignes.length
    ? lignes.map((l) => `<tr><td>${esc(l.designation)}</td><td class="r">${fmtNum(l.quantite, Number.isInteger(l.quantite) ? 0 : 2)} ${esc(l.unite || "")}</td><td class="r">${fmtNum(l.prix_unitaire_ht)}</td><td class="r">${fmtNum(l.taux_tva, l.taux_tva % 1 ? 1 : 0)} %</td><td class="r"><b>${fmtNum(r2(l.quantite * l.prix_unitaire_ht))}</b></td></tr>`).join("")
    : `<tr><td colspan="5" class="mut">Aucune ligne détaillée (montant global).</td></tr>`;
  const paye = K === "facture" ? d.paye : 0;
  return `<div class="doc">
    <div class="doc-h"><div><b>${esc(e.nom || "Votre entreprise")}</b><small>${esc(e.adresse || "")}</small><small>${esc([e.telephone, e.email].filter(Boolean).join(" · "))}</small></div>
      <div style="text-align:right"><b>${k.label} ${esc(docNum(d, K))}</b><small>Date : ${D(d[k.df])}</small><small>${K === "devis" ? `Valable ${d.validite_jours} jours` : `Échéance : ${D(d.echeance)}`}</small></div></div>
    <div class="doc-h"><div><small>${K === "devis" ? "Destinataire" : "Facturé à"}</small><b>${esc(c.nom || d.client_nom)}</b><small>${esc(c.adresse || "")}</small><small>${esc(c.ville || "")}</small></div>
      ${d.chantier_nom ? `<div style="text-align:right"><small>Chantier</small><b>${esc(d.chantier_nom)}</b></div>` : ""}</div>
    <div class="tw"><table><thead><tr><th>Désignation</th><th class="r">Quantité</th><th class="r">P.U. HT</th><th class="r">TVA</th><th class="r">Total HT</th></tr></thead><tbody>${rows}</tbody></table></div>
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
  return page(`${esc(docNum(d, K))} ${chip(st)}`, `${esc(d.client_nom)} · ${E2(d.montant_ttc)} TTC`, `${actions}`,
    `<div class="g2"><div>${docPreview(K, d, lignes)}</div><div>${card("Suivi", suivi)}${card("Partage en ligne", partageHtml)}${payHtml}</div></div>`,
    crumbs([K === "devis" ? "Devis" : "Factures", k.route], [docNum(d, K)]));
}

/* ---------- Éditeur (devis / facture) ---------- */
function ligneRow(l = {}) {
  const tva = l.taux_tva ?? (Number(db.ent.taux_tva_defaut) || 20);
  return `<tr class="lr"><td><input type="text" data-f="des" value="${esc(l.designation || "")}" placeholder="Description de la prestation"></td>
    <td style="width:78px"><input type="text" inputmode="decimal" data-f="qte" value="${l.quantite !== undefined ? String(l.quantite).replace(".", ",") : "1"}"></td>
    <td style="width:86px"><input type="text" data-f="uni" list="unites" value="${esc(l.unite || "u")}"></td>
    <td style="width:104px"><input type="text" inputmode="decimal" data-f="pu" value="${l.prix_unitaire_ht !== undefined ? String(l.prix_unitaire_ht).replace(".", ",") : ""}" placeholder="0,00"></td>
    <td style="width:84px"><select data-f="tva">${[...new Set([...TVA_TAUX, Number(tva)])].map((t) => `<option value="${t}"${Number(t) === Number(tva) ? " selected" : ""}>${String(t).replace(".", ",")} %</option>`).join("")}</select></td>
    <td class="lt" style="width:100px"><span data-f="tot">0,00</span></td>
    <td style="width:34px"><button type="button" class="rm" data-rm title="Supprimer la ligne" aria-label="Supprimer la ligne">${svg(ic.x)}</button></td></tr>`;
}
function readLignes(root) {
  return $$(".lr", root).map((tr) => ({
    designation: $('[data-f="des"]', tr).value.trim(), quantite: parseNum($('[data-f="qte"]', tr).value), unite: $('[data-f="uni"]', tr).value.trim() || "u",
    prix_unitaire_ht: parseNum($('[data-f="pu"]', tr).value), taux_tva: Number($('[data-f="tva"]', tr).value),
  }));
}
function recalcLignes(root) {
  const ls = readLignes(root);
  $$(".lr", root).forEach((tr, i) => { $('[data-f="tot"]', tr).textContent = fmtNum(r2(ls[i].quantite * ls[i].prix_unitaire_ht)); });
  const by = totauxParTaux(ls.filter((l) => l.designation || l.prix_unitaire_ht));
  const ht = sum(Object.values(by), (x) => x.ht), tva = sum(Object.values(by), (x) => x.tva);
  $("#totbox", root).innerHTML = `<div><span>Total HT</span><span class="num">${E2(ht)}</span></div>${Object.keys(by).sort((a, b) => b - a).map((t) => `<div><span>TVA ${String(t).replace(".", ",")} %</span><span class="num">${E2(by[t].tva)}</span></div>`).join("")}<div class="ttc"><span>Total TTC</span><span class="num">${E2(ht + tva)}</span></div>`;
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
    <div class="full"><div class="tw"><table class="lines"><thead><tr><th>Description</th><th>Qté</th><th>Unité</th><th>P.U. HT</th><th>TVA</th><th class="r">Total HT</th><th></th></tr></thead><tbody id="lbody">${(lignes.length ? lignes : [{}]).map(ligneRow).join("")}</tbody></table></div>
      <div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-top:8px;flex-wrap:wrap"><button type="button" class="btn o sm" id="addl">+ Ajouter une ligne</button><div class="totbox" id="totbox"></div></div></div>
    ${fld({ k: "notes", l: "Remarques (apparaissent sur le document)", t: "textarea", v: d?.notes || "", r: 0, cls: "full" })}
  </div>`;
  modal(d ? `Modifier ${esc(docNum(d, K))}` : `Nouveau ${k.label.toLowerCase()}`, body, {
    xl: true, wide: true, submit: d ? "Enregistrer" : "Créer le brouillon",
    onMount: (m) => {
      bindClientBlock(m, (cid) => { const s = $("#f_chantier_id", m); s.innerHTML = chOpts(cid === "__new" ? "none" : cid).map((o) => `<option value="${esc(o.v)}">${esc(o.l)}</option>`).join(""); });
      const lb = $("#lbody", m);
      m.addEventListener("input", (e) => { if (e.target.closest(".lr")) recalcLignes(m); });
      m.addEventListener("click", (e) => {
        if (e.target.closest("#addl")) { lb.insertAdjacentHTML("beforeend", ligneRow({ taux_tva: Number($('[data-f="tva"]', lb.lastElementChild)?.value) || undefined })); $$('[data-f="des"]', lb).pop().focus(); recalcLignes(m); }
        const rm = e.target.closest("[data-rm]");
        if (rm) { if ($$(".lr", m).length > 1) rm.closest("tr").remove(); else $$("input", rm.closest("tr")).forEach((i) => (i.value = "")); recalcLignes(m); }
      });
      recalcLignes(m);
    },
    onSubmit: async (v, api) => {
      const ls = readLignes(api.el).filter((l) => l.designation || l.prix_unitaire_ht);
      if (!ls.length) throw new Error("Ajoutez au moins une ligne avec une description et un prix.");
      const cid = await resolveClient(v);
      const payload = { id: d?.id || null, client_id: cid, chantier_id: v.chantier_id || null, date: v.date, notes: v.notes || null, lignes: ls,
        ...(K === "devis" ? { validite_jours: parseInt(v.validite_jours) || 30 } : { echeance: v.echeance }) };
      const id = await q(sb.rpc("sauver_document", { p_kind: K, p: payload }));
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
