/* v11 : chargement des tables achats (catalogue, bons de commande, lots, URSSAF) + catalogue fournisseurs.
   Les prix du catalogue alimentent les bons de commande ; chaque changement de prix est historisé par la base. */

async function loadV11() {
  db.v11 = false;
  db.cat = []; db.catPrix = []; db.bcs = []; db.bcl = []; db.bcr = []; db.lots = []; db.urs = [];
  try {
    const [ca, cp, bc, bl, br, lo, ur, dl] = await Promise.all([
      q(sb.from("catalogue_articles").select("*").order("designation")),
      q(sb.from("catalogue_prix").select("article_id,prix_ht,date_prix,created_at").order("date_prix", { ascending: false })),
      q(sb.from("bons_commande").select("*").order("date_commande", { ascending: false })),
      q(sb.from("bons_commande_lignes").select("*").order("position")),
      q(sb.from("bc_receptions").select("*").order("date_reception", { ascending: false })),
      q(sb.from("paiement_lots").select("*").order("created_at", { ascending: false })),
      q(sb.from("urssaf_declarations").select("*").order("periode_debut", { ascending: false })),
      q(sb.from("depenses").select("id,lot_id,bc_id")),
    ]);
    const dm = new Map(dl.map((x) => [x.id, x]));
    db.depenses.forEach((d) => { const x = dm.get(d.id); d.lot_id = x?.lot_id || null; d.bc_id = x?.bc_id || null; });
    ca.forEach((a) => nz(a, ["prix_ht", "tva_taux"]));
    cp.forEach((p) => nz(p, ["prix_ht"]));
    bl.forEach((l) => nz(l, ["quantite", "prix_unitaire_ht", "tva_taux", "recu"]));
    lo.forEach((l) => nz(l, ["montant_total"]));
    ur.forEach((u) => nz(u, ["ca_calcule", "ca_declare", "cotisations"]));
    Object.assign(db, { cat: ca, catPrix: cp, bcs: bc, bcl: bl, bcr: br, lots: lo, urs: ur, v11: true, v11err: "" });
    db.ent.urssaf_options ||= {};
  } catch (e) { db.v11err = e?.message || String(e); console.warn("Migration v11 absente ou incomplète :", db.v11err); }
}
const setupV11 = () => `<div class="empty" style="padding:30px 20px"><h2>Une étape manque</h2><p style="max-width:560px;margin:6px auto 14px">Exécutez <b>migration_v11.sql</b> dans Supabase (SQL Editor) pour activer le catalogue, les bons de commande, les lots de règlements et l'aide URSSAF.${db.v11err ? `<br><small class="mut">${esc(db.v11err)}</small>` : ""}</p></div>`;

/* ---------- Catalogue ---------- */
const catOf = (fid) => db.cat.filter((a) => a.fournisseur_id === fid);
const catPrevPrice = (a) => { const h = db.catPrix.filter((p) => p.article_id === a.id); return h.length > 1 ? h[1].prix_ht : null; };
function catEvol(a) {
  const prev = catPrevPrice(a);
  if (prev === null || prev <= 0 || Math.abs(prev - a.prix_ht) < 0.005) return "";
  const p = ((a.prix_ht - prev) / prev) * 100;
  return `<span class="chip ${p > 0 ? "dn" : "ok"}" title="Ancien prix : ${E2(prev)}">${p > 0 ? "+" : ""}${p.toFixed(1).replace(".", ",")} %</span>`;
}
const CAT_UNITS = ["u", "m", "m²", "m³", "ml", "kg", "t", "l", "sac", "palette", "rouleau", "boîte", "h", "forfait"];

function catTab(t) {
  const st = (ST.cat ||= { f: "all", q: "" });
  const list = db.cat.filter((a) => st.f === "all" || a.fournisseur_id === st.f);
  const sel = `<div class="seg" style="flex-wrap:wrap"><button data-act="catFilter" data-arg="all" aria-pressed="${st.f === "all"}">Tous</button>${db.fournisseurs.filter((f) => catOf(f.id).length).map((f) => `<button data-act="catFilter" data-arg="${f.id}" aria-pressed="${st.f === f.id}">${esc(f.nom)}</button>`).join("")}</div>`;
  const rows = list.map((a) => ({ act: "catEdit", id: a.id, t: `${a.reference || ""} ${a.designation} ${supName(a.fournisseur_id)} ${a.categorie || ""}`,
    c: [`<strong>${esc(a.designation)}</strong><small>${esc(a.reference || "sans référence")}${a.conditionnement ? " · " + esc(a.conditionnement) : ""}</small>`, esc(supName(a.fournisseur_id)), esc(a.categorie || "-"), esc(a.unite || "u"),
      `<span class="num">${E2(a.prix_ht)}</span>`, catEvol(a) || `<small class="mut">${D(a.date_prix)}</small>`, a.actif ? "" : `<span class="chip n">Retiré</span>`] }));
  const maj = db.catPrix.filter((p) => p.created_at && Date.now() - new Date(p.created_at) < 30 * 86400000).length;
  return page("Achats", ACH_SUB, btn("Nouvel article", "catNew", "", st.f === "all" ? "" : st.f, "w") + btn("Importer (CSV)", "catImport", "", "", "o w") + btn("Exporter (CSV)", "catExport", "", "", "o w"),
    t + strip([["Articles", db.cat.length, `${new Set(db.cat.map((a) => a.fournisseur_id)).size} fournisseur${new Set(db.cat.map((a) => a.fournisseur_id)).size > 1 ? "s" : ""}`],
      ["Mises à jour de prix", maj, "sur 30 jours"], ["Articles retirés", db.cat.filter((a) => !a.actif).length, "masqués dans les commandes"]]) +
    `<div style="margin-bottom:12px">${sel}</div>` + searchBar("Rechercher une référence, un article, un fournisseur…", `${list.length} article${list.length > 1 ? "s" : ""}`) +
    card("", tbl(["Article", "Fournisseur", "Catégorie", "Unité", { h: "Prix HT", r: 1 }, "Évolution", ""], rows, "Catalogue vide. Ajoutez vos articles ou importez le tarif d'un fournisseur (CSV).")));
}

function catForm(a, o = {}) {
  if (!guard()) return;
  if (!db.fournisseurs.length) { toast("Créez d'abord la fiche du fournisseur.", "dn"); return fournisseurForm(null, {}); }
  const g = (k, d = "") => a?.[k] ?? o[k] ?? d;
  const hist = a ? db.catPrix.filter((p) => p.article_id === a.id).slice(0, 6) : [];
  modal(a ? "Modifier l'article" : "Nouvel article", `<div class="frm">
    ${fld({ k: "fournisseur_id", l: "Fournisseur", t: "select", o: db.fournisseurs.map((f) => ({ v: f.id, l: f.nom })), v: g("fournisseur_id", o.fournisseur || db.fournisseurs[0].id), cls: "full" })}
    ${fld({ k: "designation", l: "Désignation", v: g("designation"), cls: "full" })}
    ${fld({ k: "reference", l: "Référence fournisseur", v: g("reference"), r: 0 })}
    ${fld({ k: "categorie", l: "Catégorie", t: "select", o: PilotPdf.CATEGORIES, v: g("categorie", "Matériaux") })}
    ${fld({ k: "unite", l: "Unité", t: "select", o: CAT_UNITS, v: g("unite", "u") })}
    ${fld({ k: "prix_ht", l: "Prix unitaire HT (€)", t: "number", v: a ? String(a.prix_ht).replace(".", ",") : "" })}
    ${fld({ k: "tva_taux", l: "TVA", t: "select", o: RATES.map((r) => ({ v: r, l: r.replace(".", ",") + " %" })), v: String(g("tva_taux", 20)) })}
    ${fld({ k: "conditionnement", l: "Conditionnement", v: g("conditionnement"), r: 0, ph: "ex. palette de 48 sacs" })}
    ${fld({ k: "delai_jours", l: "Délai de livraison (jours)", t: "number", v: g("delai_jours", ""), r: 0 })}
    ${fld({ k: "notes", l: "Notes", t: "textarea", v: g("notes"), r: 0, cls: "full" })}
    <label class="chk full" style="display:flex;gap:8px"><input type="checkbox" name="actif" ${a && !a.actif ? "" : "checked"}> <span>Article en vente chez ce fournisseur</span></label>
    ${hist.length > 1 ? `<div class="full mut"><b>Historique des prix :</b> ${hist.map((p) => `${E2(p.prix_ht)} (${D(p.date_prix)})`).join(" · ")}</div>` : ""}</div>`, {
    wide: true,
    onMount: (m, api) => { if (a) { $(".fa", m).insertAdjacentHTML("afterbegin", `<button type="button" class="btn dn-o" id="cdel" style="margin-right:auto">Supprimer</button>`); $("#cdel", m).onclick = () => { api.close(); ACT.catDel(a.id); }; } },
    onSubmit: async (v, api) => {
      const prix = parseNum(v.prix_ht);
      if (prix < 0) throw new Error("Le prix ne peut pas être négatif.");
      const row = { fournisseur_id: v.fournisseur_id, designation: v.designation.trim(), reference: v.reference?.trim() || null, categorie: v.categorie, unite: v.unite, prix_ht: prix, tva_taux: Number(v.tva_taux),
        conditionnement: v.conditionnement || null, delai_jours: v.delai_jours ? Math.round(parseNum(v.delai_jours)) : null, notes: v.notes || null, actif: "actif" in v };
      if (!a || a.prix_ht !== prix) row.date_prix = today();
      try { if (a) await q(sb.from("catalogue_articles").update(row).eq("id", a.id)); else await q(sb.from("catalogue_articles").insert(row)); }
      catch (e) { if (e.code === "23505") throw new Error("Cette référence existe déjà chez ce fournisseur."); throw e; }
      api.close(); toast("Article enregistré.", "ok"); await refresh();
    },
  });
}

/* Import / export CSV du tarif */
const CAT_HEAD = ["reference", "designation", "unite", "prix_ht", "tva", "categorie", "conditionnement"];
function catExport() {
  csvDl("catalogue-fournisseurs.csv", ["fournisseur", ...CAT_HEAD, "actif"], db.cat.map((a) => [supName(a.fournisseur_id), a.reference || "", a.designation, a.unite, String(a.prix_ht).replace(".", ","), String(a.tva_taux).replace(".", ","), a.categorie || "", a.conditionnement || "", a.actif ? "oui" : "non"]));
}
function catImport(fid) {
  if (!guard()) return;
  if (!db.fournisseurs.length) { toast("Créez d'abord la fiche du fournisseur.", "dn"); return fournisseurForm(null, {}); }
  const api = modal("Importer un tarif fournisseur", `<p class="mut" style="margin:0 0 12px">Fichier CSV ou Excel enregistré en CSV, une ligne par article. Colonnes reconnues : <b>référence, désignation, unité, prix HT, TVA, catégorie, conditionnement</b> (et <b>fournisseur</b> si le fichier concerne plusieurs fournisseurs). Les articles déjà présents (même référence) sont mis à jour et leur évolution de prix est enregistrée.</p>
    ${fld({ k: "fournisseur_id", l: "Fournisseur par défaut", t: "select", o: db.fournisseurs.map((f) => ({ v: f.id, l: f.nom })), v: fid || db.fournisseurs[0].id })}
    <div class="drop"><div><b>Tarif (CSV)</b><small style="display:block" class="mut">Séparateur ; , ou tabulation reconnu automatiquement</small></div><input type="file" id="cif" accept=".csv,.txt,text/csv" hidden><button type="button" class="btn" id="cib">Choisir le fichier</button></div>
    <div id="cipv"></div>`, { submit: false });
  let plan = null;
  $("#cib", api.el).onclick = () => $("#cif", api.el).click();
  $("#cif", api.el).onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const text = bkDecode(await f.arrayBuffer());
    plan = catPlan(bkCsvRows(text, bkDelim(text)), $("#f_fournisseur_id", api.el).value);
    $("#cipv", api.el).innerHTML = catPlanHtml(plan);
    $("#ciok", api.el)?.addEventListener("click", async () => {
      $("#ciok", api.el).disabled = true;
      try { await catApply(plan); api.close(); toast(`${plan.news.length + plan.upd.length} article(s) importé(s).`, "ok"); await refresh(); } catch (er) { toast(esc(friendly(er)), "dn"); $("#ciok", api.el).disabled = false; }
    });
  };
}
const catNormH = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
function catPlan(rows, defFid) {
  const out = { news: [], upd: [], bad: [], same: 0 };
  if (rows.length < 2) { out.bad.push("Fichier vide."); return out; }
  const H = rows[0].map(catNormH), col = (...n) => H.findIndex((h) => n.includes(h));
  const ix = { f: col("fournisseur", "supplier"), r: col("reference", "ref", "refarticle", "code", "codearticle"), d: col("designation", "libelle", "description", "article", "nom"), u: col("unite", "unit", "u"),
    p: col("prixht", "prix", "pu", "puht", "prixunitaireht", "tarif", "prixunitaire"), t: col("tva", "tauxtva"), c: col("categorie", "famille"), k: col("conditionnement", "colisage") };
  if (ix.d < 0 || ix.p < 0) { out.bad.push("Colonnes « désignation » et « prix HT » introuvables dans la première ligne."); return out; }
  const seen = new Set();
  rows.slice(1).forEach((r, i) => {
    if (!r.some((x) => String(x).trim())) return;
    const des = String(r[ix.d] || "").trim(), prix = parseNum(r[ix.p]);
    if (!des) return out.bad.push(`Ligne ${i + 2} : désignation vide.`);
    if (!isFinite(prix) || prix < 0 || String(r[ix.p] ?? "").trim() === "") return out.bad.push(`Ligne ${i + 2} : prix illisible (« ${r[ix.p] ?? ""} »).`);
    let fid = defFid;
    if (ix.f >= 0 && String(r[ix.f] || "").trim()) { const f = db.fournisseurs.find((x) => norm(x.nom) === norm(r[ix.f])); if (!f) return out.bad.push(`Ligne ${i + 2} : fournisseur « ${r[ix.f]} » inconnu.`); fid = f.id; }
    const ref = ix.r >= 0 ? String(r[ix.r] || "").trim() : "";
    const tva = ix.t >= 0 && String(r[ix.t] ?? "").trim() !== "" ? parseNum(r[ix.t]) : 20;
    const key = fid + "|" + (ref ? norm(ref) : "d:" + norm(des));
    if (seen.has(key)) return out.bad.push(`Ligne ${i + 2} : doublon dans le fichier (${ref || des}).`);
    seen.add(key);
    const row = { fournisseur_id: fid, reference: ref || null, designation: des, unite: ix.u >= 0 && r[ix.u] ? String(r[ix.u]).trim() : "u", prix_ht: prix, tva_taux: isFinite(tva) ? tva : 20,
      categorie: ix.c >= 0 && r[ix.c] ? String(r[ix.c]).trim() : null, conditionnement: ix.k >= 0 && r[ix.k] ? String(r[ix.k]).trim() : null };
    const ex = db.cat.find((a) => a.fournisseur_id === fid && (ref ? norm(a.reference) === norm(ref) : norm(a.designation) === norm(des)));
    if (!ex) out.news.push(row);
    else if (Math.abs(ex.prix_ht - prix) < 0.005 && ex.designation === des) out.same++;
    else out.upd.push({ id: ex.id, row, old: ex.prix_ht });
  });
  return out;
}
function catPlanHtml(p) {
  const up = p.upd.filter((u) => u.row.prix_ht > u.old).length, down = p.upd.length - up;
  return `<div style="margin-top:14px"><div class="strip" style="margin:0 0 10px"><div><small>Nouveaux articles</small><b>${p.news.length}</b></div><div><small>Prix modifiés</small><b>${p.upd.length}</b><small>${up} hausse${up > 1 ? "s" : ""}, ${down} baisse${down > 1 ? "s" : ""}</small></div><div><small>Inchangés</small><b>${p.same}</b></div><div><small>Lignes refusées</small><b class="${p.bad.length ? "dn" : ""}">${p.bad.length}</b></div></div>
    ${p.bad.length ? `<ul class="mut" style="margin:0 0 10px 18px;padding:0;max-height:120px;overflow:auto">${p.bad.slice(0, 20).map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : ""}
    ${p.news.length + p.upd.length ? `<button class="btn w" id="ciok" type="button">Importer ${p.news.length + p.upd.length} article${p.news.length + p.upd.length > 1 ? "s" : ""}</button>` : `<p class="mut">Rien à importer.</p>`}</div>`;
}
async function catApply(p) {
  const today_ = today();
  for (let i = 0; i < p.news.length; i += 200) await q(sb.from("catalogue_articles").insert(p.news.slice(i, i + 200).map((r) => ({ ...r, date_prix: today_ }))));
  for (const u of p.upd) await q(sb.from("catalogue_articles").update({ ...u.row, date_prix: today_ }).eq("id", u.id));
}

// Carte « Catalogue » sur la fiche fournisseur
function catSupCard(fid) {
  if (!db.v11) return "";
  const l = catOf(fid).slice(0, 6);
  return card("Catalogue", l.length ? l.map((a) => `<div class="row lnk" data-act="catEdit" data-id="${a.id}"><div><b>${esc(a.designation)}</b><small>${esc(a.reference || "")} · ${esc(a.unite)}</small></div><span class="num">${E2(a.prix_ht)}</span></div>`).join("") + (catOf(fid).length > 6 ? `<p class="mut" style="margin:0;padding:8px 18px">+ ${catOf(fid).length - 6} autre(s)</p>` : "") : `<p class="mut" style="margin:0;padding:16px 18px">Aucun article.</p>`,
    btn("Ajouter", "catNew", "", fid, "o sm w") + btn("Importer", "catImport", fid, "", "o sm w"));
}

const catalogueActions = {
  catNew: (id, arg) => catForm(null, { fournisseur: arg || undefined }),
  catEdit: (id) => catForm(byId(db.cat, id)),
  catDel: (id) => del("catalogue_articles", id, "Supprimer cet article du catalogue ?"),
  catImport: (id) => catImport(id),
  catExport,
  catFilter: (id, arg) => { (ST.cat ||= {}).f = arg; return render(true); },
};
