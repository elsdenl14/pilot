/* Stocks, matériel et approvisionnements : stocks par dépôt et véhicule, inventaires, disponibilité du matériel, rapprochement commande / livraison / facture. */

const lxNm = (id) => byId(db.slx, id)?.nom || "?";
const arNm = (id) => byId(db.sar, id)?.designation || "?";
const qn = (n) => String(Math.round(n * 1000) / 1000).replace(".", ",");

/* ---------- Calcul des stocks (ordre chronologique, prix moyen pondéré) ---------- */
function stkCompute(upTo) {
  const mv = [...db.smv].filter((m) => !upTo || m.date_mouvement <= upTo).sort((a, b) => a.date_mouvement.localeCompare(b.date_mouvement) || (a.created_at || "").localeCompare(b.created_at || ""));
  const qty = {}, S = {}, V = {}, chant = {}, last = {};
  const k = (a, l) => `${a}|${l}`, add = (a, l, n) => { qty[k(a, l)] = (qty[k(a, l)] || 0) + n; };
  const pmp = (a) => (S[a] > 0 ? V[a] / S[a] : last[a] ?? Number(byId(db.sar, a)?.prix_unitaire) ?? 0);
  for (const m of mv) {
    const a = m.article_id, q_ = m.quantite;
    if (m.type === "Entrée") { const pu = m.prix_unitaire ?? pmp(a); S[a] = (S[a] || 0) + q_; V[a] = (V[a] || 0) + q_ * pu; last[a] = pu; add(a, m.lieu_dest_id, q_); }
    else if (m.type === "Sortie") { const p = pmp(a); add(a, m.lieu_source_id, -q_); S[a] = (S[a] || 0) - q_; V[a] = (V[a] || 0) - q_ * p; if (m.chantier_id) chant[m.chantier_id] = (chant[m.chantier_id] || 0) + q_ * p; }
    else if (m.type === "Transfert") { add(a, m.lieu_source_id, -q_); add(a, m.lieu_dest_id, q_); }
    else if (m.type === "Retour") { const p = pmp(a); add(a, m.lieu_dest_id, q_); S[a] = (S[a] || 0) + q_; V[a] = (V[a] || 0) + q_ * p; if (m.chantier_id) chant[m.chantier_id] = (chant[m.chantier_id] || 0) - q_ * p; }
    else if (m.type === "Inventaire") { const p = pmp(a); if (m.lieu_dest_id) { add(a, m.lieu_dest_id, q_); S[a] = (S[a] || 0) + q_; V[a] = (V[a] || 0) + q_ * p; } else { add(a, m.lieu_source_id, -q_); S[a] = (S[a] || 0) - q_; V[a] = (V[a] || 0) - q_ * p; } }
    if (S[a] !== undefined && Math.abs(S[a]) < 1e-9) { S[a] = 0; V[a] = 0; }
  }
  const P = {}; db.sar.forEach((a) => (P[a.id] = pmp(a.id)));
  return { qty, S, P, chant, at: (a, l) => qty[k(a, l)] || 0, total: (a) => S[a] || 0 };
}

/* ---------- Formulaires ---------- */
function articleForm(a) {
  if (!guard()) return;
  modal(a ? "Modifier l'article" : "Nouvel article", `<div class="frm">${fld({ k: "designation", l: "Désignation", v: a?.designation || "", cls: "full" })}${fld({ k: "reference", l: "Référence", v: a?.reference || "", r: 0 })}${fld({ k: "unite", l: "Unité", v: a?.unite || "u" })}
    ${fld({ k: "categorie", l: "Catégorie", v: a?.categorie || "", r: 0 })}${fld({ k: "prix_unitaire", l: "Prix d'achat HT (€)", t: "number", v: rhNum(a?.prix_unitaire || ""), r: 0 })}
    ${fld({ k: "seuil_mini", l: "Seuil d'alerte (stock mini)", t: "number", v: rhNum(a?.seuil_mini || ""), r: 0 })}</div>`, {
    onSubmit: async (f, api) => {
      const row = { designation: f.designation.trim(), reference: f.reference || null, unite: f.unite.trim() || "u", categorie: f.categorie || null, prix_unitaire: parseNum(f.prix_unitaire), seuil_mini: parseNum(f.seuil_mini) };
      if (a) await q(sb.from("stock_articles").update(row).eq("id", a.id)); else await q(sb.from("stock_articles").insert(row));
      api.close(); toast("Article enregistré.", "ok"); await refresh();
    }, extra: a ? btn("Supprimer", "stArDel", a.id, "", "lk dn") : "" });
}
function lieuForm(l) {
  if (!guard()) return;
  modal(l ? "Modifier le lieu" : "Nouveau dépôt ou véhicule", `<div class="frm">${fld({ k: "nom", l: "Nom", v: l?.nom || "", ph: "Dépôt principal, Camion AB-123-CD…" })}${fld({ k: "type", l: "Type", t: "select", o: ["Dépôt", "Véhicule"], v: l?.type || "Dépôt" })}
    ${l ? fld({ k: "actif", l: "Statut", t: "select", o: [{ v: "1", l: "Actif" }, { v: "0", l: "Fermé" }], v: l.actif ? "1" : "0", r: 0 }) : ""}</div>`, {
    onSubmit: async (f, api) => {
      const row = { nom: f.nom.trim(), type: f.type }; if (l && f.actif !== undefined) row.actif = f.actif === "1";
      if (l) await q(sb.from("stock_lieux").update(row).eq("id", l.id)); else await q(sb.from("stock_lieux").insert(row));
      api.close(); toast("Lieu enregistré.", "ok"); await refresh();
    }, extra: l ? btn("Supprimer", "stLxDel", l.id, "", "lk dn") : "" });
}
function mouvementForm(type = "Entrée", pre = {}) {
  if (!guard()) return;
  const lx = db.slx.filter((l) => l.actif), ar = db.sar.filter((a) => a.actif);
  if (!lx.length || !ar.length) return toast(!lx.length ? "Créez d'abord un dépôt ou un véhicule." : "Créez d'abord un article.", "dn");
  const lo = lx.map((l) => ({ v: l.id, l: `${l.nom} (${l.type.toLowerCase()})` }));
  modal("Mouvement de stock", `<div class="frm">${fld({ k: "type", l: "Type", t: "select", o: [{ v: "Entrée", l: "Entrée (achat, réception)" }, { v: "Sortie", l: "Sortie vers un chantier" }, { v: "Transfert", l: "Transfert dépôt ↔ véhicule" }, { v: "Retour", l: "Retour de chantier" }], v: type })}
    ${fld({ k: "date_mouvement", l: "Date", t: "date", v: today() })}${fld({ k: "article_id", l: "Article", t: "select", o: ar.map((a) => ({ v: a.id, l: `${a.designation}${a.reference ? " · " + a.reference : ""}` })), v: pre.article_id || ar[0].id, cls: "full" })}
    <div id="mvs">${fld({ k: "lieu_source_id", l: "Depuis", t: "select", o: lo, v: pre.lieu_source_id || lo[0].v })}</div><div id="mvd">${fld({ k: "lieu_dest_id", l: "Vers", t: "select", o: lo, v: pre.lieu_dest_id || lo[0].v })}</div>
    <div id="mvc" class="full">${fld({ k: "chantier_id", l: "Chantier", t: "select", o: chOpts("Aucun chantier"), v: pre.chantier_id || "", r: 0 })}</div>
    ${fld({ k: "quantite", l: "Quantité", t: "number", v: pre.quantite ? rhNum(pre.quantite) : "" })}<div id="mvp">${fld({ k: "prix_unitaire", l: "Prix d'achat HT (€ / unité)", t: "number", v: "", r: 0, hint: "Laissez vide pour reprendre le prix de l'article." })}</div>
    ${fld({ k: "notes", l: "Note", v: "", r: 0, cls: "full" })}<div class="full" id="mvw"></div></div>`, {
    onMount: (m) => {
      const g = (k) => $("#f_" + k, m);
      const upd = () => {
        const t = g("type").value; $("#mvs", m).hidden = !["Sortie", "Transfert"].includes(t); $("#mvd", m).hidden = !["Entrée", "Transfert", "Retour"].includes(t); $("#mvc", m).hidden = !["Sortie", "Retour"].includes(t); $("#mvp", m).hidden = t !== "Entrée";
        const w = $("#mvw", m); w.innerHTML = "";
        if (["Sortie", "Transfert"].includes(t)) { const have = stkCompute().at(g("article_id").value, g("lieu_source_id").value), want = parseNum(g("quantite").value); if (want > have + 1e-9) w.innerHTML = `<div class="alert wn" style="padding:10px 12px;border-radius:8px;background:var(--wnbg,#fff4e0)">Stock insuffisant à cet endroit : ${qn(have)} disponible(s).</div>`; }
      };
      m.addEventListener("input", upd); m.addEventListener("change", upd); upd();
    },
    onSubmit: async (f, api) => {
      const qte = parseNum(f.quantite); if (!(qte > 0)) throw new Error("Saisissez une quantité supérieure à 0.");
      const t = f.type, row = { type: t, date_mouvement: f.date_mouvement, article_id: f.article_id, quantite: qte, notes: f.notes || null,
        lieu_source_id: ["Sortie", "Transfert"].includes(t) ? f.lieu_source_id : null, lieu_dest_id: ["Entrée", "Transfert", "Retour"].includes(t) ? f.lieu_dest_id : null,
        chantier_id: ["Sortie", "Retour"].includes(t) ? f.chantier_id || null : null, prix_unitaire: t === "Entrée" ? (parseNum(f.prix_unitaire) || Number(byId(db.sar, f.article_id)?.prix_unitaire) || 0) : null };
      if (t === "Transfert" && row.lieu_source_id === row.lieu_dest_id) throw new Error("Choisissez deux lieux différents.");
      if (["Sortie", "Transfert"].includes(t)) { const have = stkCompute().at(row.article_id, row.lieu_source_id); if (qte > have + 1e-9 && !confirm(`Stock insuffisant (${qn(have)} disponible). Enregistrer quand même ?`)) return; }
      await q(sb.from("stock_mouvements").insert(row));
      if (t === "Entrée" && row.prix_unitaire > 0) await q(sb.from("stock_articles").update({ prix_unitaire: row.prix_unitaire }).eq("id", row.article_id));
      api.close(); toast("Mouvement enregistré.", "ok"); await refresh();
    } });
}

/* ---------- Inventaires ---------- */
function inventaireNew() {
  if (!guard()) return;
  const lx = db.slx.filter((l) => l.actif); if (!lx.length) return toast("Créez d'abord un dépôt ou un véhicule.", "dn");
  modal("Nouvel inventaire", `<div class="frm">${fld({ k: "lieu_id", l: "Lieu à inventorier", t: "select", o: lx.map((l) => ({ v: l.id, l: l.nom })), v: lx[0].id })}${fld({ k: "date_inventaire", l: "Date", t: "date", v: today() })}</div><p class="mut" style="margin:10px 0 0">Tous les articles actifs sont listés avec leur quantité théorique. Vous saisissez ce que vous comptez réellement.</p>`, {
    submit: "Commencer", onSubmit: async (f, api) => {
      const c = stkCompute(), inv = await q(sb.from("stock_inventaires").insert({ lieu_id: f.lieu_id, date_inventaire: f.date_inventaire }).select("id").single());
      const L = db.sar.filter((a) => a.actif).map((a) => ({ inventaire_id: inv.id, article_id: a.id, theorique: Math.max(0, Math.round(c.at(a.id, f.lieu_id) * 1000) / 1000), pmp: r2(c.P[a.id] || 0) }));
      if (L.length) await q(sb.from("stock_inventaire_lignes").insert(L));
      api.close(); await refresh(); invDetail(inv.id);
    } });
}
function invDetail(id) {
  const inv = byId(db.sinv, id); if (!inv) return;
  const L = db.sinl.filter((l) => l.inventaire_id === id).sort((a, b) => arNm(a.article_id).localeCompare(arNm(b.article_id))), done = inv.statut === "Validé";
  const rows = L.map((l) => `<tr class="il" data-id="${l.id}" data-th="${l.theorique}" data-pmp="${l.pmp}"><td><b>${esc(arNm(l.article_id))}</b></td><td class="r">${qn(l.theorique)}</td><td style="width:110px">${done ? `<span class="num">${l.compte === null || l.compte === undefined ? "-" : qn(l.compte)}</span>` : `<input type="text" inputmode="decimal" data-k="compte" value="${l.compte === null || l.compte === undefined ? "" : qn(l.compte)}" placeholder="${qn(l.theorique)}">`}</td><td class="r ec">-</td><td class="r num">${E(l.pmp)}</td></tr>`).join("");
  modal(`Inventaire de ${esc(lxNm(inv.lieu_id))} · ${D(inv.date_inventaire)}`, `<div class="tw"><table class="lines"><thead><tr><th>Article</th><th class="r">Théorique</th><th>Compté</th><th class="r">Écart</th><th class="r">Prix moyen</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="emp">Aucun article.</td></tr>'}</tbody></table></div>
    <p id="invsum" class="note"></p>${done ? `<p class="note">Inventaire validé : valeur du stock ${E(inv.valeur_stock)} · écart de valeur ${E(inv.ecart_valeur)}.</p>` : `<p class="note">Une ligne laissée vide est considérée comme conforme au théorique. À la validation, les écarts créent des mouvements d'inventaire.</p>`}`, {
    xl: true, wide: true, submit: done ? false : "Valider l'inventaire", cancel: "Fermer", extra: done ? "" : btn("Enregistrer le comptage", "invSave", id, "", "o") + btn("Supprimer", "invDel", id, "", "lk dn"),
    onMount: (m) => {
      const calc = () => {
        let ec = 0, val = 0;
        $$(".il", m).forEach((tr) => { const th = +tr.dataset.th, p = +tr.dataset.pmp, i = $('[data-k="compte"]', tr), c = i ? (i.value.trim() === "" ? th : parseNum(i.value)) : (th + 0), d = Math.round((c - th) * 1000) / 1000; $(".ec", tr).innerHTML = d ? `<span class="${d < 0 ? "dn" : "ok"}">${d > 0 ? "+" : ""}${qn(d)}</span>` : "-"; ec += d * p; val += c * p; });
        if (!done) $("#invsum", m).innerHTML = `Valeur du stock après inventaire : <b>${E(val)}</b> · écart de valeur : <b class="${ec < 0 ? "dn" : ""}">${E(ec)}</b>`;
      };
      m.addEventListener("input", calc); if (!done) calc();
    },
    onSubmit: async (f, api) => {
      if (!confirm("Valider l'inventaire ? Les écarts seront enregistrés dans le stock.")) return;
      await invSaveCounts(api.el, id);
      let ec = 0, val = 0; const mv = [];
      for (const l of db.sinl.filter((x) => x.inventaire_id === id)) {
        const c = byId(db.sinl, l.id); const cnt = c.compte === null || c.compte === undefined ? l.theorique : c.compte, d = Math.round((cnt - l.theorique) * 1000) / 1000;
        ec += d * l.pmp; val += cnt * l.pmp;
        if (d) mv.push({ type: "Inventaire", date_mouvement: inv.date_inventaire, article_id: l.article_id, quantite: Math.abs(d), prix_unitaire: l.pmp, lieu_dest_id: d > 0 ? inv.lieu_id : null, lieu_source_id: d < 0 ? inv.lieu_id : null, origine: "inventaire", notes: "Écart d'inventaire" });
      }
      if (mv.length) await q(sb.from("stock_mouvements").insert(mv));
      await q(sb.from("stock_inventaires").update({ statut: "Validé", valeur_stock: r2(val), ecart_valeur: r2(ec) }).eq("id", id));
      api.close(); toast("Inventaire validé.", "ok"); await refresh();
    } });
}
async function invSaveCounts(root, id) {
  for (const tr of $$(".il", root)) {
    const i = $('[data-k="compte"]', tr); if (!i) continue; const v = i.value.trim() === "" ? null : parseNum(i.value);
    await q(sb.from("stock_inventaire_lignes").update({ compte: v }).eq("id", tr.dataset.id)); const l = byId(db.sinl, tr.dataset.id); if (l) l.compte = v;
  }
}

/* ---------- Page Stocks ---------- */
const ST_TABS = [["stock", "Stock"], ["mouvements", "Mouvements"], ["inventaires", "Inventaires"], ["catalogue", "Articles et lieux"]];
V.stocks = () => {
  if (!db.v15) return page("Stocks", "Stocks par dépôt et véhicule, inventaires, valorisation.", "", card("", setupV15()));
  const tab = ST.tab.stocks || "stock", c = stkCompute(), lx = db.slx.filter((l) => l.actif), ar = db.sar.filter((a) => a.actif);
  const totVal = sum(ar, (a) => c.total(a.id) * c.P[a.id]), low = ar.filter((a) => a.seuil_mini > 0 && c.total(a.id) < a.seuil_mini);
  const m0 = today().slice(0, 7), nbMois = db.smv.filter((m) => m.date_mouvement.slice(0, 7) === m0).length;
  let body = "";
  if (tab === "stock") {
    const rows = ar.map((a) => { const t = c.total(a.id), lowA = a.seuil_mini > 0 && t < a.seuil_mini; return { act: "stArEdit", id: a.id, t: `${a.designation} ${a.reference || ""}`,
      c: [`<strong>${esc(a.designation)}</strong><small>${esc(a.reference || "")}${a.categorie ? " · " + esc(a.categorie) : ""}</small>`, ...lx.map((l) => { const x = c.at(a.id, l.id); return `<span class="num ${x < 0 ? "dn" : ""}">${x ? qn(x) : "-"}</span>`; }), `<b class="num ${t < 0 ? "dn" : ""}">${qn(t)} ${esc(a.unite)}</b>${lowA ? '<small class="dn">sous le seuil</small>' : ""}`, `<span class="num">${E(c.P[a.id] || 0)}</span>`, `<span class="num">${E(t * (c.P[a.id] || 0))}</span>`] }; });
    const byL = lx.map((l) => ({ l, v: sum(ar, (a) => c.at(a.id, l.id) * (c.P[a.id] || 0)) }));
    const cons = Object.entries(c.chant).filter(([, v]) => Math.abs(v) > 0.004).sort((a, b) => b[1] - a[1]);
    body = card("État du stock", tbl(["Article", ...lx.map((l) => ({ h: `${esc(l.nom)}<small>${l.type.toLowerCase()}</small>`, r: 1 })), { h: "Total", r: 1 }, { h: "Prix moyen", r: 1 }, { h: "Valeur", r: 1 }], rows, "Créez vos articles et vos dépôts (onglet Articles et lieux), puis enregistrez une première entrée.")) +
      `<div class="g2">${card("Valeur par lieu", byL.map((x) => `<div class="row"><div><b>${esc(x.l.nom)}</b><small>${x.l.type}</small></div><span class="num">${E(x.v)}</span></div>`).join("") || `<p class="mut" style="padding:14px 18px;margin:0">Aucun lieu.</p>`)}
      ${card("Matière sortie par chantier", cons.map(([id, v]) => `<div class="row"><div><b>${esc(chNm(id) || "?")}</b></div><span class="num">${E(v)}</span></div>`).join("") || `<p class="mut" style="padding:14px 18px;margin:0">Aucune sortie vers un chantier.</p>`)}</div>
      <p class="note">Valorisation au prix moyen pondéré. Les sorties vers un chantier sont valorisées à ce prix : c'est le coût matière pris dans le stock, à ne pas compter une seconde fois si vous saisissez aussi l'achat en dépense du chantier.</p>`;
  } else if (tab === "mouvements") {
    const rows = [...db.smv].sort((a, b) => b.date_mouvement.localeCompare(a.date_mouvement) || (b.created_at || "").localeCompare(a.created_at || "")).slice(0, 200).map((m) => ({ t: arNm(m.article_id), c: [D(m.date_mouvement), `<span class="chip ${m.type === "Entrée" || m.type === "Retour" ? "ok" : m.type === "Sortie" ? "wn" : "n"}">${m.type}</span>`, esc(arNm(m.article_id)), `${m.lieu_source_id ? esc(lxNm(m.lieu_source_id)) : ""}${m.lieu_source_id && m.lieu_dest_id ? " → " : ""}${m.lieu_dest_id ? esc(lxNm(m.lieu_dest_id)) : ""}${m.chantier_id ? `<small>${esc(chNm(m.chantier_id))}</small>` : ""}`, `<span class="num">${qn(m.quantite)}</span>`, `<button class="lk dn w" data-act="stMvDel" data-id="${m.id}">Supprimer</button>`] }));
    body = card("Derniers mouvements", tbl(["Date", "Type", "Article", "Lieu / chantier", { h: "Qté", r: 1 }, ""], rows, "Aucun mouvement."));
  } else if (tab === "inventaires") {
    const rows = [...db.sinv].sort((a, b) => b.date_inventaire.localeCompare(a.date_inventaire)).map((i) => ({ act: "invOpen", id: i.id, t: lxNm(i.lieu_id), c: [D(i.date_inventaire), `<strong>${esc(lxNm(i.lieu_id))}</strong>`, `<span class="chip ${i.statut === "Validé" ? "ok" : "wn"}">${i.statut}</span>`, i.valeur_stock !== null && i.valeur_stock !== undefined ? `<span class="num">${E(i.valeur_stock)}</span>` : "-", i.ecart_valeur ? `<span class="num ${i.ecart_valeur < 0 ? "dn" : ""}">${E(i.ecart_valeur)}</span>` : "-"] }));
    body = card("Inventaires", tbl(["Date", "Lieu", "Statut", { h: "Valeur du stock", r: 1 }, { h: "Écart de valeur", r: 1 }], rows, "Aucun inventaire. Lancez-en un pour comparer le comptage au stock théorique."), btn("Nouvel inventaire", "invNew", "", "", "o sm"));
  } else {
    const ra = db.sar.map((a) => ({ act: "stArEdit", id: a.id, t: a.designation, cls: a.actif ? "" : "mut", c: [`<strong>${esc(a.designation)}</strong>`, esc(a.reference || ""), esc(a.unite), `<span class="num">${E(a.prix_unitaire)}</span>`, a.seuil_mini ? qn(a.seuil_mini) : "-"] }));
    const rl = db.slx.map((l) => ({ act: "stLxEdit", id: l.id, t: l.nom, cls: l.actif ? "" : "mut", c: [`<strong>${esc(l.nom)}</strong>`, l.type, l.actif ? "Actif" : "Fermé"] }));
    body = card("Lieux de stockage", tbl(["Nom", "Type", "Statut"], rl, "Aucun lieu."), btn("Nouveau lieu", "stLxNew", "", "", "o sm")) + card("Articles", tbl(["Désignation", "Réf.", "Unité", { h: "Dernier prix", r: 1 }, "Seuil"], ra, "Aucun article."), btn("Nouvel article", "stArNew", "", "", "o sm"));
  }
  return page("Stocks", "Stocks par dépôt et véhicule, inventaires, valorisation.", btn("Entrée", "stMv", "", "Entrée", "w") + btn("Sortie chantier", "stMv", "", "Sortie", "o w") + btn("Transfert", "stMv", "", "Transfert", "o w"),
    strip([["Valeur du stock", E(totVal), `${ar.length} article(s) · ${lx.length} lieu(x)`], ["Sous le seuil", String(low.length), low.slice(0, 2).map((a) => a.designation).join(", ") || "tout va bien", low.length ? "wn" : ""], ["Mouvements du mois", String(nbMois), ""]]) + tabs("stocks", ST_TABS, tab) + body);
};

/* ---------- Disponibilité du matériel ---------- */
function periodeForm(x, pre = {}) {
  if (!guard()) return;
  const v = { type: "Indisponibilité", date_debut: today(), date_fin: today(), ...pre, ...(x || {}) };
  modal(x ? "Modifier la période" : "Location ou indisponibilité", `<div class="frm">${fld({ k: "type", l: "Type", t: "select", o: [{ v: "Indisponibilité", l: "Indisponibilité (panne, entretien, prêt…)" }, { v: "Location", l: "Location d'un engin" }], v: v.type })}
    ${fld({ k: "materiel_id", l: "Équipement", t: "select", o: [{ v: "", l: "Engin loué (hors de mon parc)" }, ...db.mat.map((m) => ({ v: m.id, l: m.nom }))], v: v.materiel_id || "", r: 0 })}
    ${fld({ k: "libelle", l: "Nom de l'engin loué", v: v.libelle || "", r: 0, hint: "Si ce n'est pas un équipement de votre parc." })}${fld({ k: "loueur", l: "Loueur", v: v.loueur || "", r: 0 })}
    ${fld({ k: "date_debut", l: "Du", t: "date", v: v.date_debut })}${fld({ k: "date_fin", l: "Au (inclus)", t: "date", v: v.date_fin })}
    ${fld({ k: "cout_jour", l: "Coût par jour (€ HT)", t: "number", v: rhNum(v.cout_jour || ""), r: 0 })}${fld({ k: "chantier_id", l: "Chantier", t: "select", o: chOpts("Aucun"), v: v.chantier_id || "", r: 0 })}
    ${fld({ k: "motif", l: "Motif / note", v: v.motif || "", r: 0, cls: "full" })}</div>`, {
    onSubmit: async (f, api) => {
      if (f.date_fin < f.date_debut) throw new Error("La date de fin est avant la date de début.");
      if (!f.materiel_id && !f.libelle.trim()) throw new Error("Choisissez un équipement ou nommez l'engin loué.");
      const row = { type: f.type, materiel_id: f.materiel_id || null, libelle: f.libelle || null, loueur: f.loueur || null, date_debut: f.date_debut, date_fin: f.date_fin, cout_jour: parseNum(f.cout_jour), chantier_id: f.chantier_id || null, motif: f.motif || null };
      if (x) await q(sb.from("materiel_periodes").update(row).eq("id", x.id)); else await q(sb.from("materiel_periodes").insert(row));
      api.close(); await refresh(); toast("Enregistré.", "ok");
    }, extra: x ? btn("Supprimer", "pdDel", x.id, "", "lk dn") : "" });
}
V.dispo = () => {
  if (!db.v15 || !db.v12) return page("Disponibilité du matériel", "Affectations, locations et indisponibilités des engins.", "", card("", setupV15()));
  const d0 = ST.dpD || today(), days = [...Array(21)].map((_, i) => addD(d0, i)), it = afItems().filter((i) => i.key[0] === "m");
  const cell = (m, d) => it.filter((i) => i.key === "m:" + m.id && i.from <= d && d <= i.to).map((i) => `<span class="afb ${i.kind}" title="${esc(afLabel(i))}">${i.kind === "aff" ? esc((chNm(i.chantier_id) || "Affecté").slice(0, 10)) : i.kind === "loc" ? "Loué" : "Indispo"}</span>`).join("");
  const grid = db.mat.filter((m) => m.statut !== "Vendu").map((m) => `<tr><th class="afn"><b>${esc(m.nom)}</b><small>${esc(m.statut)}</small></th>${days.map((d) => `<td class="afc" data-act="pdNewDay" data-id="${m.id}" data-arg="${d}">${cell(m, d)}</td>`).join("")}</tr>`).join("");
  const a = ST.dpA || today(), b = ST.dpB || addD(today(), 4);
  const libres = db.mat.filter((m) => !["Vendu", "Hors service", "En maintenance"].includes(m.statut) && !it.some((i) => i.key === "m:" + m.id && afOver({ from: a, to: b, h1: "", h2: "" }, i)));
  const loc = [...db.per].sort((x, y) => y.date_debut.localeCompare(x.date_debut)).map((p) => { const nb = Math.round((new Date(p.date_fin) - new Date(p.date_debut)) / 864e5) + 1; return { act: "pdEdit", id: p.id, t: `${p.libelle || ""} ${p.loueur || ""}`, c: [`<span class="chip ${p.type === "Location" ? "ac" : "wn"}">${p.type}</span>`, `<strong>${esc(p.materiel_id ? byId(db.mat, p.materiel_id)?.nom || "?" : p.libelle || "?")}</strong><small>${esc(p.loueur || p.motif || "")}</small>`, `${D(p.date_debut)} au ${D(p.date_fin)}`, esc(chNm(p.chantier_id) || ""), p.cout_jour ? `<span class="num">${E(p.cout_jour * nb)}</span><small>${E(p.cout_jour)} / j</small>` : "-"] }; });
  const cf = afConflits().filter((c) => c.mat);
  return page("Disponibilité du matériel", "Affectations, locations et indisponibilités des engins.", btn("Location ou indisponibilité", "pdNew", "", "", "w") + btn("Nouvelle affectation", "afNew", "", "", "o w"),
    strip([["Équipements suivis", String(db.mat.filter((m) => m.statut !== "Vendu").length), `${db.mat.filter((m) => m.statut === "Hors service" || m.statut === "En maintenance").length} indisponible(s)`], ["Conflits matériel", String(cf.length), cf.length ? "voir Affectations" : "aucun", cf.length ? "dn" : "ok"], ["Locations en cours", String(db.per.filter((p) => p.type === "Location" && p.date_debut <= today() && p.date_fin >= today()).length), ""]]) +
    card("Calendrier 3 semaines", `<div style="display:flex;gap:10px;align-items:center;padding:0 0 10px"><button class="btn o sm" data-act="dpWeek" data-arg="-7">‹</button><b>Du ${D(days[0])} au ${D(days[20])}</b><button class="btn o sm" data-act="dpWeek" data-arg="7">›</button><button class="btn o sm" data-act="dpWeek" data-arg="0">Aujourd'hui</button></div>
      <div class="tw"><table class="afg"><thead><tr><th></th>${days.map((d) => `<th>${d.slice(8)}/${d.slice(5, 7)}</th>`).join("")}</tr></thead><tbody>${grid || '<tr><td class="emp" colspan="22">Aucun équipement : ajoutez-en dans la fiche Matériel.</td></tr>'}</tbody></table></div><p class="note">Vert : libre. Les affectations viennent de la fiche Matériel et de la page Affectations. Cliquez une case pour déclarer une indisponibilité ou une location.</p>`) +
    card("Qui est libre ?", `<div class="frm" style="padding:0 0 10px"><label class="fl"><span>Du</span><input type="date" value="${a}" data-chg="dpA"></label><label class="fl"><span>Au</span><input type="date" value="${b}" data-chg="dpB"></label></div>${libres.length ? libres.map((m) => `<div class="row"><div><b>${esc(m.nom)}</b><small>${esc(m.categorie || "")}</small></div>${m.cout_jour ? `<span class="num">${E(m.cout_jour)} / j</span>` : ""}</div>`).join("") : `<p class="mut" style="margin:0">Aucun équipement libre sur cette période.</p>`}`) +
    card("Locations et indisponibilités", tbl(["Type", "Équipement", "Période", "Chantier", { h: "Coût", r: 1 }], loc, "Aucune période déclarée.")));
};

/* ---------- Rapprochement commande / livraison / facture ---------- */
function rprStat(r) {
  const L = db.rprl.filter((l) => l.rapprochement_id === r.id), ev = db.rpre.filter((e) => e.rapprochement_id === r.id);
  const rows = L.map((l) => {
    const li = ev.filter((e) => e.ligne_id === l.id && e.type === "Livraison"), fa = ev.filter((e) => e.ligne_id === l.id && e.type === "Facture");
    const liv = sum(li, (e) => e.quantite), fac = sum(fa, (e) => e.quantite), facHT = sum(fa, (e) => e.quantite * (e.prix_unitaire ?? l.pu_cmd));
    const puF = fac ? facHT / fac : null, flags = [];
    if (liv > l.qte_cmd + 1e-9) flags.push(["Livré en trop", "wn"]);
    if (fac > liv + 1e-9) flags.push(["Facturé non livré", "dn"]);
    if (fac > l.qte_cmd + 1e-9) flags.push(["Facturé au-delà de la commande", "dn"]);
    if (puF !== null && Math.abs(puF - l.pu_cmd) > 0.005) flags.push([`Prix facturé ${E(puF)} ≠ commandé ${E(l.pu_cmd)}`, "dn"]);
    const reliq = Math.max(0, l.qte_cmd - liv), afac = Math.max(0, liv - fac);
    return { l, liv, fac, facHT, puF, flags, reliq, afac };
  });
  const ecarts = sum(rows, (x) => x.flags.length), solde = rows.length && rows.every((x) => x.reliq < 1e-9 && x.afac < 1e-9 && !x.flags.length);
  return { rows, ecarts, solde, statut: r.cloture ? "Clôturé" : solde ? "Soldé" : ecarts ? "Écarts" : "Ouvert", cmdHT: sum(rows, (x) => x.l.qte_cmd * x.l.pu_cmd), livHT: sum(rows, (x) => x.liv * x.l.pu_cmd), facHT: sum(rows, (x) => x.facHT) };
}
const RPR_CHIP = { Soldé: "ok", Clôturé: "n", Écarts: "dn", Ouvert: "wn" };
function rapprochementForm(r) {
  if (!guard()) return;
  const achats = (db.achats || []).filter((a) => a.type === "Commande" || !a.type);
  modal(r ? "Modifier la commande" : "Nouvelle commande à rapprocher", `<div class="frm">${fld({ k: "fournisseur", l: "Fournisseur", v: r?.fournisseur || "", ph: "Nom du fournisseur" })}${fld({ k: "ref_commande", l: "N° de commande", v: r?.ref_commande || "", r: 0 })}
    ${fld({ k: "date_commande", l: "Date de commande", t: "date", v: r?.date_commande || today(), r: 0 })}${fld({ k: "chantier_id", l: "Chantier", t: "select", o: chOpts("Aucun"), v: r?.chantier_id || "", r: 0 })}
    ${achats.length ? fld({ k: "achat_id", l: "Lier à un achat existant (facultatif)", t: "select", o: [{ v: "", l: "Aucun" }, ...achats.map((a) => ({ v: a.id, l: `${a.numero || "Sans n°"} · ${(byId(db.fournisseurs, a.fournisseur_id) || {}).nom || ""} · ${E(a.montant_ht || 0)}` }))], v: r?.achat_id || "", r: 0, cls: "full" }) : ""}
    ${fld({ k: "notes", l: "Note", v: r?.notes || "", r: 0, cls: "full" })}</div>`, {
    onSubmit: async (f, api) => {
      const row = { fournisseur: f.fournisseur.trim(), ref_commande: f.ref_commande || null, date_commande: f.date_commande || null, chantier_id: f.chantier_id || null, achat_id: f.achat_id || null, notes: f.notes || null };
      let id = r?.id; if (r) await q(sb.from("rapprochements").update(row).eq("id", r.id)); else id = (await q(sb.from("rapprochements").insert(row).select("id").single())).id;
      api.close(); await refresh(); if (!r) go(`rapprochement/${id}`);
    }, extra: r ? btn("Supprimer", "rpRDel", r.id, "", "lk dn") : "" });
}
function rprLigneForm(rid, x) {
  if (!guard()) return;
  modal(x ? "Modifier la ligne" : "Ligne de commande", `<div class="frm">${fld({ k: "designation", l: "Désignation", v: x?.designation || "", cls: "full" })}${fld({ k: "qte_cmd", l: "Quantité commandée", t: "number", v: rhNum(x?.qte_cmd || "") })}${fld({ k: "unite", l: "Unité", v: x?.unite || "u" })}
    ${fld({ k: "pu_cmd", l: "Prix unitaire HT commandé (€)", t: "number", v: rhNum(x?.pu_cmd || ""), r: 0 })}${db.sar.length ? fld({ k: "article_id", l: "Article de stock (pour entrer la livraison en stock)", t: "select", o: [{ v: "", l: "Aucun" }, ...db.sar.filter((a) => a.actif).map((a) => ({ v: a.id, l: a.designation }))], v: x?.article_id || "", r: 0 }) : ""}</div>`, {
    onSubmit: async (f, api) => {
      const row = { rapprochement_id: rid, designation: f.designation.trim(), qte_cmd: parseNum(f.qte_cmd), unite: f.unite.trim() || "u", pu_cmd: parseNum(f.pu_cmd), article_id: f.article_id || null };
      if (!(row.qte_cmd > 0)) throw new Error("Saisissez la quantité commandée.");
      if (x) await q(sb.from("rapprochement_lignes").update(row).eq("id", x.id)); else await q(sb.from("rapprochement_lignes").insert({ ...row, position: db.rprl.filter((l) => l.rapprochement_id === rid).length + 1 }));
      api.close(); await refresh();
    }, extra: x ? btn("Supprimer", "rpLDel", x.id, "", "lk dn") : "" });
}
function rprEvent(rid, type) {
  if (!guard()) return;
  const st = rprStat(byId(db.rpr, rid)), L = st.rows; if (!L.length) return toast("Ajoutez d'abord des lignes de commande.", "dn");
  const lieux = db.slx.filter((l) => l.actif), liv = type === "Livraison";
  const rows = L.map((x) => `<tr><td><b>${esc(x.l.designation)}</b><small>commandé ${qn(x.l.qte_cmd)} · livré ${qn(x.liv)} · facturé ${qn(x.fac)}</small></td><td style="width:100px"><input type="text" inputmode="decimal" name="q_${x.l.id}" value="${qn(liv ? x.reliq : x.afac) === "0" ? "" : qn(liv ? x.reliq : x.afac)}" placeholder="0"></td>${liv ? "" : `<td style="width:110px"><input type="text" inputmode="decimal" name="p_${x.l.id}" value="${rhNum(x.l.pu_cmd)}"></td>`}</tr>`).join("");
  modal(liv ? "Enregistrer une livraison" : "Enregistrer une facture fournisseur", `<div class="frm">${fld({ k: "date_event", l: "Date", t: "date", v: today() })}${fld({ k: "doc_ref", l: liv ? "N° de bon de livraison" : "N° de facture", r: 0 })}
    ${liv && lieux.length ? fld({ k: "lieu_id", l: "Entrer en stock dans (si l'article est lié)", t: "select", o: [{ v: "", l: "Ne pas entrer en stock" }, ...lieux.map((l) => ({ v: l.id, l: l.nom }))], v: "", r: 0, cls: "full" }) : ""}</div>
    <div class="tw" style="margin-top:12px"><table class="lines"><thead><tr><th>Ligne</th><th>${liv ? "Quantité reçue" : "Quantité facturée"}</th>${liv ? "" : "<th>Prix unit. HT</th>"}</tr></thead><tbody>${rows}</tbody></table></div>`, {
    xl: true, wide: true, onSubmit: async (f, api) => {
      const ev = []; for (const x of L) { const n = parseNum(f["q_" + x.l.id]); if (n > 0) ev.push({ rapprochement_id: rid, ligne_id: x.l.id, type, date_event: f.date_event, doc_ref: f.doc_ref || null, quantite: n, prix_unitaire: liv ? null : parseNum(f["p_" + x.l.id]), x }); }
      if (!ev.length) throw new Error("Saisissez au moins une quantité.");
      for (const e of ev) {
        const { x, ...row } = e;
        if (liv && f.lieu_id && x.l.article_id) { const mv = await q(sb.from("stock_mouvements").insert({ type: "Entrée", date_mouvement: f.date_event, article_id: x.l.article_id, lieu_dest_id: f.lieu_id, quantite: row.quantite, prix_unitaire: x.l.pu_cmd || null, origine: "livraison", notes: `Livraison ${f.doc_ref || ""} · ${byId(db.rpr, rid).fournisseur}`.trim() }).select("id").single()); row.mouvement_id = mv.id; }
        await q(sb.from("rapprochement_events").insert(row));
      }
      api.close(); toast(liv ? "Livraison enregistrée." : "Facture enregistrée.", "ok"); await refresh();
    } });
}
function rprDetail(id) {
  const r = byId(db.rpr, id); if (!r) return page("Rapprochement", "", "", card("", `<p class="mut" style="padding:20px">Commande introuvable.</p>`), crumbs(["Rapprochement", "rapprochement"]));
  const s = rprStat(r), ev = db.rpre.filter((e) => e.rapprochement_id === id).sort((a, b) => b.date_event.localeCompare(a.date_event)), achat = r.achat_id ? (db.achats || []).find((a) => a.id === r.achat_id) : null;
  const rows = s.rows.map((x) => ({ act: "rpLEdit", id: x.l.id, t: x.l.designation, c: [`<strong>${esc(x.l.designation)}</strong><small>${E(x.l.pu_cmd)} / ${esc(x.l.unite)}${x.l.article_id ? " · lié au stock" : ""}</small>`, `<span class="num">${qn(x.l.qte_cmd)}</span>`, `<span class="num">${qn(x.liv)}</span>`, `<span class="num">${qn(x.fac)}</span>`, `<span class="num ${x.reliq ? "wn" : ""}">${x.reliq ? qn(x.reliq) : "-"}</span>`,
    x.flags.length ? x.flags.map(([t, c]) => `<span class="chip ${c}">${esc(t)}</span>`).join(" ") : x.afac > 1e-9 ? `<span class="chip wn">${qn(x.afac)} à facturer</span>` : x.liv >= x.l.qte_cmd ? '<span class="chip ok">Conforme</span>' : ""] }));
  const evr = ev.map((e) => ({ t: "", c: [D(e.date_event), `<span class="chip ${e.type === "Livraison" ? "ok" : "ac"}">${e.type}</span>`, esc(e.doc_ref || ""), esc(byId(db.rprl, e.ligne_id)?.designation || ""), `<span class="num">${qn(e.quantite)}</span>${e.prix_unitaire !== null && e.prix_unitaire !== undefined ? `<small>${E(e.prix_unitaire)}</small>` : ""}`, `<button class="lk dn w" data-act="rpEDel" data-id="${e.id}">Supprimer</button>`] }));
  return page(`${esc(r.fournisseur)}${r.ref_commande ? " · " + esc(r.ref_commande) : ""}`, `${r.date_commande ? "Commande du " + D(r.date_commande) : ""}${r.chantier_id ? " · " + esc(chNm(r.chantier_id)) : ""}`,
    btn("Livraison reçue", "rpEv", id, "Livraison", "w") + btn("Facture reçue", "rpEv", id, "Facture", "o w") + btn("Ajouter une ligne", "rpLNew", id, "", "o w") + btn("Modifier", "rpREdit", id, "", "o w") + (r.cloture ? btn("Rouvrir", "rpRClose", id, "0", "o w") : btn("Clôturer", "rpRClose", id, "1", "o w")),
    strip([["Statut", `<span class="chip ${RPR_CHIP[s.statut]}">${s.statut}</span>`, s.ecarts ? `${s.ecarts} écart(s)` : "aucun écart"], ["Commandé HT", E(s.cmdHT), ""], ["Livré HT", E(s.livHT), "au prix commandé"], ["Facturé HT", E(s.facHT), achat ? `achat lié : ${E(achat.montant_ht || 0)}` : "", achat && Math.abs((achat.montant_ht || 0) - s.facHT) > 0.01 ? "dn" : ""]]) +
    card("Rapprochement par ligne", tbl(["Ligne", { h: "Commandé", r: 1 }, { h: "Livré", r: 1 }, { h: "Facturé", r: 1 }, { h: "Reliquat", r: 1 }, "Contrôle"], rows, "Ajoutez les lignes de la commande.")) +
    card("Livraisons et factures enregistrées", tbl(["Date", "Type", "N°", "Ligne", { h: "Qté", r: 1 }, ""], evr, "Rien d'enregistré pour le moment.")) + (r.notes ? `<p class="note">${esc(r.notes)}</p>` : ""),
    crumbs(["Rapprochement", "rapprochement"], [r.fournisseur]));
}
V.rapprochement = (r) => {
  if (!db.v15) return page("Rapprochement", "Commandes, livraisons et factures fournisseurs.", "", card("", setupV15()));
  if (r.arg) return rprDetail(r.arg);
  const L = db.rpr.map((x) => ({ x, s: rprStat(x) })).sort((a, b) => (a.x.cloture - b.x.cloture) || (b.x.date_commande || "").localeCompare(a.x.date_commande || ""));
  const rows = L.map(({ x, s }) => ({ go: `rapprochement/${x.id}`, t: `${x.fournisseur} ${x.ref_commande || ""}`, c: [D(x.date_commande), `<strong>${esc(x.fournisseur)}</strong><small>${esc(x.ref_commande || "")}</small>`, esc(chNm(x.chantier_id) || ""), `<span class="num">${E(s.cmdHT)}</span>`, `<span class="num">${E(s.livHT)}</span>`, `<span class="num">${E(s.facHT)}</span>`, `<span class="chip ${RPR_CHIP[s.statut]}">${s.statut}</span>${s.ecarts ? `<small>${s.ecarts} écart(s)</small>` : ""}`] }));
  const ouv = L.filter(({ x }) => !x.cloture);
  return page("Rapprochement", "Comparez ce qui a été commandé, livré et facturé, et repérez les écarts et les reliquats.", btn("Nouvelle commande", "rpRNew", "", "", "w") + btn("Exporter les écarts (CSV)", "rpCsv", "", "", "o w"),
    strip([["Commandes ouvertes", String(ouv.length), ""], ["Avec écarts", String(ouv.filter(({ s }) => s.ecarts).length), "à vérifier", ouv.some(({ s }) => s.ecarts) ? "dn" : ""], ["Reliquats à recevoir", String(sum(ouv, ({ s }) => s.rows.filter((x) => x.reliq > 1e-9).length)), "ligne(s)"], ["Livré non facturé", E(sum(ouv, ({ s }) => s.livHT - s.facHT > 0 ? s.livHT - s.facHT : 0)), "HT, approximatif"]]) +
    card("Commandes fournisseurs", tbl(["Date", "Fournisseur", "Chantier", { h: "Commandé", r: 1 }, { h: "Livré", r: 1 }, { h: "Facturé", r: 1 }, "Statut"], rows, "Aucune commande saisie. Créez-en une, ajoutez ses lignes, puis enregistrez les livraisons et les factures reçues.")) +
    `<p class="note">Ce suivi est indépendant de vos bons de commande : saisissez ici la commande que vous voulez contrôler. Une livraison peut entrer directement en stock si la ligne est liée à un article.</p>`);
};

/* ---------- Actions ---------- */
const stocksActions = {
  stMv: (id, arg) => mouvementForm(arg || "Entrée"), stArNew: () => articleForm(null), stArEdit: (id) => articleForm(byId(db.sar, id)), stLxNew: () => lieuForm(null), stLxEdit: (id) => lieuForm(byId(db.slx, id)),
  stArDel: async (id) => { if (!guard() || !confirm("Supprimer cet article et tous ses mouvements ?")) return; await q(sb.from("stock_articles").delete().eq("id", id)); document.querySelectorAll(".md").forEach((m) => m.remove()); await refresh(); },
  stLxDel: async (id) => { if (!guard() || !confirm("Supprimer ce lieu ?")) return; try { await q(sb.from("stock_lieux").delete().eq("id", id)); } catch (e) { return toast("Ce lieu a des mouvements : fermez-le plutôt (statut Fermé).", "dn"); } document.querySelectorAll(".md").forEach((m) => m.remove()); await refresh(); },
  stMvDel: async (id) => { if (!guard() || !confirm("Supprimer ce mouvement ?")) return; await q(sb.from("stock_mouvements").delete().eq("id", id)); await refresh(); },
  invNew: () => inventaireNew(), invOpen: (id) => invDetail(id),
  invSave: async (id) => { await invSaveCounts(document, id); toast("Comptage enregistré.", "ok"); },
  invDel: async (id) => { if (!guard() || !confirm("Supprimer cet inventaire ?")) return; await q(sb.from("stock_inventaires").delete().eq("id", id)); document.querySelectorAll(".md").forEach((m) => m.remove()); await refresh(); },
  pdNew: () => periodeForm(null), pdEdit: (id) => periodeForm(byId(db.per, id)), pdNewDay: (id, arg) => periodeForm(null, { materiel_id: id, date_debut: arg, date_fin: arg }),
  pdDel: async (id) => { if (!guard() || !confirm("Supprimer cette période ?")) return; await q(sb.from("materiel_periodes").delete().eq("id", id)); document.querySelectorAll(".md").forEach((m) => m.remove()); await refresh(); },
  dpWeek: (id, arg) => { ST.dpD = +arg ? addD(ST.dpD || today(), +arg) : today(); render(true); }, dpA: (v) => { ST.dpA = v; render(true); }, dpB: (v) => { ST.dpB = v; render(true); },
  rpRNew: () => rapprochementForm(null), rpREdit: (id) => rapprochementForm(byId(db.rpr, id)),
  rpRDel: async (id) => { if (!guard() || !confirm("Supprimer cette commande et son suivi ?")) return; await q(sb.from("rapprochements").delete().eq("id", id)); document.querySelectorAll(".md").forEach((m) => m.remove()); go("rapprochement"); await refresh(); },
  rpRClose: async (id, arg) => { await q(sb.from("rapprochements").update({ cloture: arg === "1" }).eq("id", id)); await refresh(); },
  rpLNew: (id) => rprLigneForm(id, null), rpLEdit: (id) => { const l = byId(db.rprl, id); rprLigneForm(l.rapprochement_id, l); },
  rpLDel: async (id) => { if (!guard() || !confirm("Supprimer cette ligne ?")) return; await q(sb.from("rapprochement_lignes").delete().eq("id", id)); document.querySelectorAll(".md").forEach((m) => m.remove()); await refresh(); },
  rpEv: (id, arg) => rprEvent(id, arg),
  rpEDel: async (id) => { if (!guard() || !confirm("Supprimer cet enregistrement (et l'entrée en stock liée) ?")) return; const e = byId(db.rpre, id); if (e?.mouvement_id) await q(sb.from("stock_mouvements").delete().eq("id", e.mouvement_id)); await q(sb.from("rapprochement_events").delete().eq("id", id)); await refresh(); },
  rpCsv: () => {
    const out = []; db.rpr.forEach((r) => rprStat(r).rows.forEach((x) => { if (x.flags.length || x.reliq > 1e-9 || x.afac > 1e-9) out.push([r.fournisseur, r.ref_commande || "", x.l.designation, x.l.qte_cmd, x.liv, x.fac, x.reliq, x.afac, x.flags.map((f) => f[0]).join(" ; ")]); }));
    csvDl(`rapprochement-${today()}.csv`, ["Fournisseur", "N° commande", "Ligne", "Commandé", "Livré", "Facturé", "Reliquat à recevoir", "Livré non facturé", "Écarts"], out);
  },
};
