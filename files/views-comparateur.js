/* Comparateur fournisseurs (v21) : demande de prix à plusieurs fournisseurs, comparaison des tarifs et des délais,
   historique des prix, fournisseur le plus avantageux. Tables : demandes_prix, demande_prix_* (migration_v21.sql). */

const DP_STATUTS = ["Brouillon", "Envoyée", "Comparée", "Clôturée"];
Object.assign(CHIP, { Brouillon: "n", Comparée: "ac", Clôturée: "ok" });
const dpLignes = (id) => (db.dpLignes || []).filter((l) => l.demande_id === id).sort((a, b) => a.position - b.position);
const dpFourn = (id) => (db.dpFourn || []).filter((f) => f.demande_id === id);
const dpOffre = (ligneId, fId) => (db.dpOffres || []).find((o) => o.ligne_id === ligneId && o.fournisseur_id === fId);
const fNom = (id) => byId(db.fournisseurs, id)?.nom || "Fournisseur supprimé";
function dpNumero() {
  const y = new Date().getFullYear(), n = Math.max(0, ...(db.demPrix || []).map((c) => (String(c.numero || "").startsWith(`DP-${y}-`) ? parseInt(c.numero.slice(-3)) || 0 : 0)));
  return `DP-${y}-${String(n + 1).padStart(3, "0")}`;
}
// Analyse d'une demande : total par fournisseur, meilleurs prix par ligne, classement
function dpAnalyse(d, poids = 0.7) {
  const ls = dpLignes(d.id), fs = dpFourn(d.id);
  const best = {};
  ls.forEach((l) => { const ps = fs.map((f) => dpOffre(l.id, f.fournisseur_id)?.prix_unitaire_ht).filter((p) => p != null && p > 0); best[l.id] = ps.length ? Math.min(...ps) : null; });
  const cols = fs.map((f) => {
    const offs = ls.map((l) => dpOffre(l.id, f.fournisseur_id)), nb = offs.filter((o) => o && o.prix_unitaire_ht > 0).length;
    const ht = sum(ls, (l) => (dpOffre(l.id, f.fournisseur_id)?.prix_unitaire_ht || 0) * l.quantite), total = ht + Number(f.frais_livraison || 0);
    const delais = [f.delai_jours, ...offs.map((o) => o?.delai_jours)].filter((x) => x != null && x !== "");
    const delai = delais.length ? Math.max(...delais.map(Number)) : null;
    return { f, nom: fNom(f.fournisseur_id), nb, complet: ls.length > 0 && nb === ls.length, ht, total, delai };
  });
  const ok = cols.filter((c) => c.complet);
  if (ok.length) {
    const tmin = Math.min(...ok.map((c) => c.total)), tmax = Math.max(...ok.map((c) => c.total));
    const ds = ok.map((c) => c.delai ?? 0), dmin = Math.min(...ds), dmax = Math.max(...ds);
    ok.forEach((c) => { const sp = tmax > tmin ? (c.total - tmin) / (tmax - tmin) : 0, sd = dmax > dmin ? ((c.delai ?? 0) - dmin) / (dmax - dmin) : 0; c.score = poids * sp + (1 - poids) * sd; });
    ok.sort((a, b) => a.score - b.score || a.total - b.total);
    ok.forEach((c, i) => (c.rang = i + 1));
    const cheap = [...ok].sort((a, b) => a.total - b.total)[0], fast = [...ok].filter((c) => c.delai != null).sort((a, b) => a.delai - b.delai)[0];
    cheap.badgePrix = true; if (fast) fast.badgeDelai = true;
  }
  return { ls, cols, best, gagnant: ok[0] || null, nbOk: ok.length };
}

V.comparateur = (r) => {
  if (!db.v21) return page("Comparateur fournisseurs", "", "", v21Setup());
  if (r.arg === "historique") return dpHistorique();
  if (r.arg) return dpDetail(r.arg);
  const l = db.demPrix || [];
  const rows = l.map((d) => { const a = dpAnalyse(d), fs = dpFourn(d.id); return { go: `comparateur/${d.id}`, t: `${d.numero} ${d.libelle}`,
    c: [`<strong>${esc(d.libelle)}</strong><small>${esc(d.numero || "")}${d.chantier_id ? " · " + esc(byId(db.chantiers, d.chantier_id)?.nom || "") : ""}</small>`, D(d.date_demande), `${a.ls.length} ligne${a.ls.length > 1 ? "s" : ""}`, `${fs.filter((f) => a.cols.find((c) => c.f.id === f.id)?.nb).length} / ${fs.length} réponse${fs.length > 1 ? "s" : ""}`,
      a.gagnant ? `<strong>${esc(a.gagnant.nom)}</strong><small>${E2(a.gagnant.total)} HT</small>` : "-", chip(d.statut)] }; });
  return page("Comparateur fournisseurs", "Demandez des prix à plusieurs fournisseurs et trouvez le plus avantageux.", `<a class="btn o" href="#/comparateur/historique">Historique des prix</a>` + btn("Nouvelle demande de prix", "dpNew"),
    searchBar("Rechercher une demande…", `${rows.length} demande${rows.length > 1 ? "s" : ""}`) + tbl(["Demande", "Date", "Lignes", "Réponses", "Le plus avantageux", "État"], rows, "Aucune demande de prix. Créez-en une pour comparer vos fournisseurs."));
};

function dpDetail(id) {
  const d = byId(db.demPrix || [], id);
  if (!d) return page("Demande introuvable", "", "", card("", `<p class="emp">Cette demande n'existe plus. <a href="#/comparateur">Retour</a></p>`));
  const poids = ST.dpPoids ?? 0.7, A = dpAnalyse(d, poids);
  const head = `<tr><th>Désignation</th><th class="r">Qté</th>${A.cols.map((c) => `<th class="r cmp-h ${A.gagnant?.f.id === c.f.id ? "win" : ""}">${esc(c.nom)}${c.f.envoyee_at ? `<small>envoyée le ${D(c.f.envoyee_at)}</small>` : ""}<div class="cmp-b">${btn(c.nb ? "Modifier l'offre" : "Saisir l'offre", "dpOffre", c.f.id, "", "o sm")}</div></th>`).join("")}</tr>`;
  const body = A.ls.map((l) => `<tr><td>${esc(l.designation)}</td><td class="r">${fmtNum(l.quantite, 2)} ${esc(l.unite)}</td>${A.cols.map((c) => { const o = dpOffre(l.id, c.f.fournisseur_id), p = o?.prix_unitaire_ht; const isBest = p > 0 && p === A.best[l.id];
    return `<td class="r ${isBest ? "cmp-best" : ""}">${p > 0 ? `<span class="num">${E2(p)}</span>${o.delai_jours ? `<small>${o.delai_jours} j</small>` : ""}` : `<span class="mut">-</span>`}</td>`; }).join("")}</tr>`).join("");
  const foot = `<tr class="cmp-f"><td colspan="2">Frais de livraison</td>${A.cols.map((c) => `<td class="r"><span class="num">${E2(c.f.frais_livraison || 0)}</span></td>`).join("")}</tr>
    <tr class="cmp-f"><td colspan="2">Délai de livraison</td>${A.cols.map((c) => `<td class="r">${c.delai != null ? c.delai + " j" : "-"}</td>`).join("")}</tr>
    <tr class="cmp-t"><td colspan="2">Total HT</td>${A.cols.map((c) => `<td class="r"><span class="num">${c.nb ? E2(c.total) : "-"}</span>${c.nb && !c.complet ? `<small class="dn">offre incomplète</small>` : ""}${c.badgePrix ? `<small class="ok">le moins cher</small>` : ""}${c.badgeDelai ? `<small class="ok">le plus rapide</small>` : ""}</td>`).join("")}</tr>`;
  const matrix = A.cols.length ? `<div class="tw"><table class="cmp"><thead>${head}</thead><tbody>${body}${foot}</tbody></table></div>` : `<p class="emp">Ajoutez des fournisseurs à consulter (bouton « Modifier la demande »).</p>`;
  const verdict = A.gagnant
    ? `<div class="dpv"><div><small>Fournisseur le plus avantageux</small><b>${esc(A.gagnant.nom)}</b><span>${E2(A.gagnant.total)} HT${A.gagnant.delai != null ? " · livraison en " + A.gagnant.delai + " j" : ""}</span></div>
        <label class="pri"><span>Priorité : <b>${poids >= 0.8 ? "le prix" : poids <= 0.2 ? "le délai" : "prix et délai"}</b></span><input type="range" min="0" max="100" value="${Math.round(poids * 100)}" data-dppoids aria-label="Priorité entre le prix et le délai"><small><span>Délai</span><span>Prix</span></small></label>
        ${d.fournisseur_retenu ? `<div>${chip("Retenu : " + fNom(d.fournisseur_retenu))}</div>` : btn("Retenir " + esc(A.gagnant.nom), "dpRetenir", id, A.gagnant.f.fournisseur_id)}</div>
       ${A.nbOk > 1 ? `<ol class="rank">${A.cols.filter((c) => c.rang).sort((a, b) => a.rang - b.rang).map((c) => `<li><b>${esc(c.nom)}</b> ${E2(c.total)} · ${c.delai != null ? c.delai + " j" : "délai non précisé"}${d.fournisseur_retenu !== c.f.fournisseur_id && !d.fournisseur_retenu ? ` ${btn("Retenir", "dpRetenir", id, c.f.fournisseur_id, "o sm")}` : ""}</li>`).join("")}</ol>` : ""}`
    : `<p class="mut pad">Saisissez les offres reçues pour voir le fournisseur le plus avantageux (seules les offres complètes sont classées).</p>`;
  const acts = btn("Envoyer les demandes", "dpEnvoyer", id) + btn("Modifier la demande", "dpEdit", id, "", "o") +
    `<details class="more"><summary class="btn o">Plus d'actions</summary><div class="mm">${d.fournisseur_retenu ? `<button type="button" class="mi" data-act="dpCommande" data-id="${id}">Créer la commande chez ${esc(fNom(d.fournisseur_retenu))}</button>` : ""}<button type="button" class="mi dng" data-act="dpDel" data-id="${id}">Supprimer</button></div></details>`;
  return page(`${esc(d.libelle)} ${chip(d.statut)}`, `${esc(d.numero)} · demande du ${D(d.date_demande)}${d.date_limite ? " · réponse avant le " + D(d.date_limite) : ""}`, acts, card("Comparaison des offres", matrix) + card("Résultat", verdict), crumbs(["Comparateur fournisseurs", "comparateur"], [d.numero]));
}

function dpHistorique() {
  const groups = new Map();
  for (const o of db.dpOffres || []) {
    if (!(o.prix_unitaire_ht > 0)) continue;
    const l = (db.dpLignes || []).find((x) => x.id === o.ligne_id); if (!l) continue;
    const k = norm(l.designation), g = groups.get(k) || { des: l.designation, unite: l.unite, o: [] };
    g.o.push({ ...o, date: (byId(db.demPrix, o.demande_id)?.date_demande) || String(o.created_at).slice(0, 10), nom: fNom(o.fournisseur_id) }); groups.set(k, g);
  }
  const rows = [...groups.entries()].map(([k, g]) => { g.o.sort((a, b) => b.date.localeCompare(a.date)); const last = g.o[0], min = [...g.o].sort((a, b) => a.prix_unitaire_ht - b.prix_unitaire_ht)[0], avg = sum(g.o, (x) => x.prix_unitaire_ht) / g.o.length;
    return { act: "dpHist", id: k, t: g.des, c: [`<strong>${esc(g.des)}</strong><small>par ${esc(g.unite)}</small>`, `<span class="num">${E2(last.prix_unitaire_ht)}</span><small>${esc(last.nom)} · ${D(last.date)}</small>`, `<span class="num ok">${E2(min.prix_unitaire_ht)}</span><small>${esc(min.nom)}</small>`, `<span class="num">${E2(avg)}</span>`, g.o.length] }; });
  return page("Historique des prix", "Les prix reçus de vos fournisseurs, par produit ou prestation.", `<a class="btn o" href="#/comparateur">Retour aux demandes</a>`,
    searchBar("Rechercher un produit…", `${rows.length} produit${rows.length > 1 ? "s" : ""}`) + tbl(["Produit ou prestation", "Dernier prix HT", "Meilleur prix", "Prix moyen", "Offres"], rows, "Aucun prix enregistré : saisissez des offres dans vos demandes de prix."), crumbs(["Comparateur fournisseurs", "comparateur"], ["Historique"]));
}

function dpForm(d) {
  const ls = d ? dpLignes(d.id) : [{}], sel = new Set(d ? dpFourn(d.id).map((f) => f.fournisseur_id) : []);
  const row = (l = {}) => `<tr class="dpl" data-lid="${l.id || ""}"><td><input data-p="designation" value="${esc(l.designation || "")}" placeholder="Produit ou prestation" aria-label="Désignation"></td><td><input data-p="quantite" value="${esc(l.quantite ?? 1)}" inputmode="decimal" aria-label="Quantité"></td><td><input data-p="unite" value="${esc(l.unite || "u")}" aria-label="Unité"></td><td><button type="button" class="rm" data-dprm aria-label="Supprimer la ligne">${svg(ic.x)}</button></td></tr>`;
  modal(d ? "Modifier la demande de prix" : "Nouvelle demande de prix", `<div class="frm">
    ${fld({ k: "libelle", l: "Objet de la demande", v: d?.libelle || "", ph: "Ex : Matériaux salle de bain - chantier Dupont", cls: "full" })}
    ${fld({ k: "chantier_id", l: "Chantier (facultatif)", t: "select", o: [{ v: "", l: "Aucun" }, ...db.chantiers.map((x) => ({ v: x.id, l: x.nom }))], v: d?.chantier_id || "", r: 0 })}
    ${fld({ k: "date_limite", l: "Réponse souhaitée avant le", t: "date", v: d?.date_limite || addDays(today(), 7), r: 0 })}</div>
    <h3 class="sect">Ce que vous demandez</h3><div class="tw"><table class="ivt"><thead><tr><th>Produit ou prestation</th><th>Quantité</th><th>Unité</th><th></th></tr></thead><tbody id="dpb">${ls.map(row).join("")}</tbody></table></div>
    <button type="button" class="btn o sm" id="dpadd">+ Ajouter une ligne</button>
    <h3 class="sect">Fournisseurs consultés</h3>${db.fournisseurs.length ? `<div class="chk-grid">${db.fournisseurs.map((f) => `<label class="chk"><input type="checkbox" name="four_${f.id}" ${sel.has(f.id) ? "checked" : ""}> ${esc(f.nom)}</label>`).join("")}</div>` : `<p class="mut">Aucune fiche fournisseur : créez-en d'abord dans Achats > Fournisseurs.</p>`}`, {
    wide: true, submit: d ? "Enregistrer" : "Créer la demande",
    onMount: (m) => {
      $("#dpadd", m).onclick = () => { $("#dpb", m).insertAdjacentHTML("beforeend", row()); $$('.dpl [data-p="designation"]', m).pop().focus(); };
      m.addEventListener("click", (e) => { const b = e.target.closest("[data-dprm]"); if (b) { const tr = b.closest("tr"); if ($$(".dpl", m).length > 1) tr.remove(); else $$("input", tr).forEach((x) => (x.value = "")); } });
    },
    onSubmit: async (v, api) => {
      const lignes = $$(".dpl", api.el).map((tr) => ({ id: tr.dataset.lid || null, ...Object.fromEntries($$("[data-p]", tr).map((x) => [x.dataset.p, x.value])) })).filter((l) => l.designation.trim());
      if (!lignes.length) throw new Error("Ajoutez au moins une ligne.");
      const fids = db.fournisseurs.filter((f) => v["four_" + f.id] !== undefined).map((f) => f.id);
      if (!fids.length) throw new Error("Choisissez au moins un fournisseur à consulter.");
      const row0 = { libelle: v.libelle.trim(), chantier_id: v.chantier_id || null, date_limite: v.date_limite || null };
      const id = d ? d.id : (await q(sb.from("demandes_prix").insert({ ...row0, numero: dpNumero() }).select("id").single())).id;
      if (d) await q(sb.from("demandes_prix").update(row0).eq("id", id));
      const keep = new Set(lignes.filter((l) => l.id).map((l) => l.id));
      for (const old of d ? dpLignes(id).filter((l) => !keep.has(l.id)) : []) await q(sb.from("demande_prix_lignes").delete().eq("id", old.id));
      for (const [i, l] of lignes.entries()) {
        const r = { designation: l.designation.trim(), quantite: parseNum(l.quantite) || 1, unite: l.unite.trim() || "u", position: i };
        if (l.id) await q(sb.from("demande_prix_lignes").update(r).eq("id", l.id)); else await q(sb.from("demande_prix_lignes").insert({ ...r, demande_id: id }));
      }
      const have = new Set(d ? dpFourn(id).map((f) => f.fournisseur_id) : []);
      for (const fid of fids.filter((x) => !have.has(x))) await q(sb.from("demande_prix_fournisseurs").insert({ demande_id: id, fournisseur_id: fid }));
      for (const fid of [...have].filter((x) => !fids.includes(x))) await q(sb.from("demande_prix_fournisseurs").delete().eq("demande_id", id).eq("fournisseur_id", fid));
      api.close(); await refresh(); if (!d) go("comparateur/" + id);
    },
  });
}

function dpOffreForm(fr) {
  const d = byId(db.demPrix, fr.demande_id), ls = dpLignes(d.id);
  modal(`Offre de ${esc(fNom(fr.fournisseur_id))}`, `<p class="mut">Saisissez les prix reçus. Laissez vide une ligne que le fournisseur n'a pas chiffrée.</p>
    <div class="tw"><table class="ivt"><thead><tr><th>Désignation</th><th>Qté</th><th>Prix unit. HT</th><th>Délai (jours)</th></tr></thead><tbody>${ls.map((l) => { const o = dpOffre(l.id, fr.fournisseur_id); return `<tr><td>${esc(l.designation)}</td><td>${fmtNum(l.quantite, 2)} ${esc(l.unite)}</td><td><input name="p_${l.id}" value="${esc(o?.prix_unitaire_ht ?? "")}" inputmode="decimal" placeholder="0,00" aria-label="Prix ${esc(l.designation)}"></td><td><input name="d_${l.id}" value="${esc(o?.delai_jours ?? "")}" inputmode="numeric" aria-label="Délai ${esc(l.designation)}"></td></tr>`; }).join("")}</tbody></table></div>
    <div class="frm">${fld({ k: "frais", l: "Frais de livraison HT (€)", t: "number", v: fr.frais_livraison || "", r: 0 })}${fld({ k: "delai", l: "Délai global de livraison (jours)", t: "number", v: fr.delai_jours ?? "", r: 0 })}
    ${fld({ k: "validite", l: "Offre valable jusqu'au", t: "date", v: fr.validite || "", r: 0 })}${fld({ k: "conditions", l: "Conditions (paiement, franco…)", v: fr.conditions || "", r: 0 })}</div>`, {
    wide: true, submit: "Enregistrer l'offre",
    onSubmit: async (v, api) => {
      for (const l of ls) {
        const p = String(v["p_" + l.id] ?? "").trim(), dl = String(v["d_" + l.id] ?? "").trim(), o = dpOffre(l.id, fr.fournisseur_id);
        if (!p) { if (o) await q(sb.from("demande_prix_offres").delete().eq("id", o.id)); continue; }
        const row = { prix_unitaire_ht: parseNum(p), delai_jours: dl ? parseInt(dl) : null };
        if (o) await q(sb.from("demande_prix_offres").update(row).eq("id", o.id)); else await q(sb.from("demande_prix_offres").insert({ ...row, demande_id: d.id, ligne_id: l.id, fournisseur_id: fr.fournisseur_id }));
      }
      await q(sb.from("demande_prix_fournisseurs").update({ frais_livraison: parseNum(v.frais), delai_jours: String(v.delai || "").trim() ? parseInt(v.delai) : null, validite: v.validite || null, conditions: v.conditions || null }).eq("id", fr.id));
      if (["Brouillon", "Envoyée"].includes(d.statut)) await q(sb.from("demandes_prix").update({ statut: "Comparée" }).eq("id", d.id));
      api.close(); await refresh(); toast("Offre enregistrée.", "ok");
    },
  });
}

const comparateurActions = {
  dpNew: () => guard() && dpForm(null),
  dpEdit: (id) => guard() && dpForm(byId(db.demPrix, id)),
  dpDel: async (id) => { if (!guard() || !confirm("Supprimer cette demande de prix et toutes les offres saisies ?")) return; await q(sb.from("demandes_prix").delete().eq("id", id)); await refresh(); go("comparateur"); },
  dpOffre: (id) => guard() && dpOffreForm((db.dpFourn || []).find((f) => f.id === id)),
  dpEnvoyer: async (id) => {
    if (!guard()) return;
    const d = byId(db.demPrix, id), ls = dpLignes(id), fs = dpFourn(id);
    const texte = (f) => `Bonjour,\n\nPouvez-vous nous communiquer votre meilleur prix (HT) et votre délai de livraison pour :\n\n${ls.map((l) => `- ${l.designation} : ${fmtNum(l.quantite, 2)} ${l.unite}`).join("\n")}\n\n${d.chantier_id ? "Livraison sur chantier : " + (byId(db.chantiers, d.chantier_id)?.nom || "") + "\n" : ""}${d.date_limite ? "Réponse souhaitée avant le " + D(d.date_limite) + ".\n" : ""}\nMerci d'avance.\n\n${db.ent.nom || ""}\n${[db.ent.telephone, db.ent.email].filter(Boolean).join(" - ")}`;
    modal("Envoyer la demande de prix", `<p class="mut">Un message est préparé pour chaque fournisseur. Le bouton ouvre votre messagerie.</p>${fs.map((f) => { const fo = byId(db.fournisseurs, f.fournisseur_id); return `<div class="dpmail"><div><b>${esc(fNom(f.fournisseur_id))}</b><small>${esc(fo?.email || "pas d'adresse e-mail")}${f.envoyee_at ? " · envoyée le " + D(f.envoyee_at) : ""}</small></div>
      <div>${fo?.email ? `<a class="btn sm" data-dpmail="${f.id}" href="mailto:${encodeURIComponent(fo.email)}?subject=${encodeURIComponent("Demande de prix " + d.numero + " - " + d.libelle)}&body=${encodeURIComponent(texte(f))}">Ouvrir la messagerie</a>` : ""}<button type="button" class="btn o sm" data-dpcopy="${f.id}">Copier le texte</button></div></div>`; }).join("")}`, {
      submit: false, cancel: "Fermer", wide: true,
      onMount: (m) => m.addEventListener("click", async (e) => {
        const a = e.target.closest("[data-dpmail]"), c = e.target.closest("[data-dpcopy]"), fid = (a || c)?.dataset.dpmail || c?.dataset.dpcopy; if (!fid) return;
        if (c) { try { await navigator.clipboard.writeText(texte(null)); toast("Texte copié.", "ok"); } catch (er) { toast("Copie impossible : sélectionnez le texte à la main.", "dn"); } }
        try { await q(sb.from("demande_prix_fournisseurs").update({ envoyee_at: new Date().toISOString() }).eq("id", fid)); if (d.statut === "Brouillon") await q(sb.from("demandes_prix").update({ statut: "Envoyée" }).eq("id", id)); await refresh(); } catch (er) { console.warn(er); }
      }),
    });
  },
  dpRetenir: async (id, arg) => {
    if (!guard() || !confirm(`Retenir ${fNom(arg)} pour cette demande ?`)) return;
    await q(sb.from("demandes_prix").update({ fournisseur_retenu: arg, statut: "Clôturée" }).eq("id", id)); await refresh(); toast("Fournisseur retenu. Vous pouvez créer la commande.", "ok");
  },
  dpCommande: async (id) => {
    if (!guard()) return;
    const d = byId(db.demPrix, id), A = dpAnalyse(d), c = A.cols.find((x) => x.f.fournisseur_id === d.fournisseur_retenu);
    if (!c || !c.nb) return toast("Aucune offre saisie pour ce fournisseur.", "dn");
    if (!confirm(`Créer une commande de ${E2(c.total)} HT chez ${c.nom} ?`)) return;
    await q(sb.from("achats_fournisseurs").insert({ fournisseur_id: d.fournisseur_retenu, chantier_id: d.chantier_id || null, type: "Commande", numero: null, date_doc: today(), date_livraison: c.delai != null ? addDays(today(), c.delai) : null, statut: "Commandée", categorie: "Matériaux", montant_ht: c.total, montant_tva: Math.round(c.total * 0.2 * 100) / 100, notes: `Issue de la demande de prix ${d.numero}.` }));
    await refresh(); toast("Commande créée (TVA 20 % par défaut : à ajuster dans Achats).", "ok"); go("fournisseurs");
  },
  dpHist: (key) => {
    const rows = []; for (const o of db.dpOffres || []) { const l = (db.dpLignes || []).find((x) => x.id === o.ligne_id); if (l && norm(l.designation) === key && o.prix_unitaire_ht > 0) rows.push({ date: byId(db.demPrix, o.demande_id)?.date_demande || String(o.created_at).slice(0, 10), nom: fNom(o.fournisseur_id), p: o.prix_unitaire_ht, dl: o.delai_jours, des: l.designation }); }
    rows.sort((a, b) => a.date.localeCompare(b.date));
    const mx = Math.max(...rows.map((r) => r.p)), mn = Math.min(...rows.map((r) => r.p));
    modal(esc(rows[0]?.des || "Historique"), `<div class="tw"><table><thead><tr><th>Date</th><th>Fournisseur</th><th class="r">Prix HT</th><th class="r">Délai</th><th></th></tr></thead><tbody>${rows.map((r) => `<tr><td>${D(r.date)}</td><td>${esc(r.nom)}</td><td class="r"><span class="num">${E2(r.p)}</span></td><td class="r">${r.dl ? r.dl + " j" : "-"}</td><td><span class="bar"><i style="width:${mx > mn ? 20 + ((r.p - mn) / (mx - mn)) * 80 : 60}%"></i></span></td></tr>`).join("")}</tbody></table></div>`, { submit: false, cancel: "Fermer", wide: true });
  },
};
document.addEventListener("input", (e) => { const r = e.target.closest?.("[data-dppoids]"); if (r) { ST.dpPoids = Number(r.value) / 100; clearTimeout(window.__dpT); window.__dpT = setTimeout(() => render(true), 120); } });
