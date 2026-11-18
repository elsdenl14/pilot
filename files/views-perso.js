/* Personnalisation avancée (v21) : champs personnalisés, statuts personnalisés, modèles de texte, vues enregistrées,
   plus les rappels v21 dans « À traiter ». Définitions dans prefs, valeurs dans champs_valeurs. */

const PERSO_ENT = [["clients", "Clients"], ["chantiers", "Chantiers"], ["devis", "Devis"], ["factures", "Factures"], ["contrats", "Contrats d'entretien"], ["interventions", "Bons d'intervention"], ["livraisons", "Bons de livraison"]];
const PERSO_TYPES = [["texte", "Texte"], ["nombre", "Nombre"], ["date", "Date"], ["liste", "Liste de choix"], ["case", "Oui / non"]];
const PERSO_COULEURS = [["n", "Gris"], ["ok", "Vert"], ["wn", "Orange"], ["dn", "Rouge"], ["ac", "Bleu"]];
const persoDef = (ent) => { const d = prefGet("champs_perso", {}) || {}; return { champs: d[ent]?.champs || [], statuts: d[ent]?.statuts || [] }; };
const persoVal = (ent, id) => (db.champsVal || []).find((v) => v.entite === ent && v.row_id === id)?.valeurs || {};
const persoShow = (c, v) => v == null || v === "" ? "-" : c.t === "case" ? (v === true || v === "oui" ? "Oui" : "Non") : c.t === "date" ? D(v) : esc(v);
async function persoSaveDef(ent, d) { const all = { ...(prefGet("champs_perso", {}) || {}), [ent]: d }; await prefSet("champs_perso", all); }
async function persoSaveVal(ent, id, valeurs) {
  const row = await q(sb.from("champs_valeurs").upsert({ user_id: uid, entite: ent, row_id: id, valeurs, updated_at: new Date().toISOString() }, { onConflict: "user_id,entite,row_id" }).select("*").single());
  db.champsVal = (db.champsVal || []).filter((v) => !(v.entite === ent && v.row_id === id)); db.champsVal.push(row);
}

/* ---------- Carte « Champs personnalisés » sur les fiches ---------- */
function persoCard(r) {
  const ent = r.name, d = persoDef(ent); if (!d.champs.length && !d.statuts.length) return;
  const v = persoVal(ent, r.arg), st = d.statuts.find((s) => s.l === v._statut);
  const lines = d.champs.map((c) => `<dt>${esc(c.l)}</dt><dd>${persoShow(c, v[c.id])}</dd>`).join("");
  const html = card("Informations personnalisées", `<div class="pad">${d.statuts.length ? `<p>Statut : ${st ? `<span class="chip ${st.c}">${esc(st.l)}</span>` : `<span class="mut">non défini</span>`}</p>` : ""}${d.champs.length ? `<dl class="kv">${lines}</dl>` : ""}</div>`, ro ? "" : btn("Modifier", "persoEdit", r.arg, ent, "o sm"));
  $("#v").insertAdjacentHTML("beforeend", html);
}
function persoForm(ent, id) {
  const d = persoDef(ent), v = persoVal(ent, id);
  const f = (c) => c.t === "liste" ? fld({ k: "c_" + c.id, l: esc(c.l), t: "select", o: [{ v: "", l: "-" }, ...(c.o || []).map((x) => ({ v: x, l: x }))], v: v[c.id] ?? "", r: 0 })
    : c.t === "case" ? fld({ k: "c_" + c.id, l: esc(c.l), t: "select", o: [{ v: "", l: "-" }, { v: "oui", l: "Oui" }, { v: "non", l: "Non" }], v: v[c.id] === true ? "oui" : v[c.id] === false ? "non" : v[c.id] ?? "", r: 0 })
    : fld({ k: "c_" + c.id, l: esc(c.l), t: c.t === "date" ? "date" : c.t === "nombre" ? "number" : "text", v: v[c.id] ?? "", r: 0 });
  modal("Informations personnalisées", `<div class="frm">${d.statuts.length ? fld({ k: "_statut", l: "Statut personnalisé", t: "select", o: [{ v: "", l: "Non défini" }, ...d.statuts.map((s) => ({ v: s.l, l: s.l }))], v: v._statut || "", r: 0 }) : ""}${d.champs.map(f).join("")}</div>`, {
    submit: "Enregistrer",
    onSubmit: async (x, api) => {
      const out = {}; if (x._statut) out._statut = x._statut;
      for (const c of d.champs) { const raw = String(x["c_" + c.id] ?? "").trim(); if (raw === "") continue; out[c.id] = c.t === "nombre" ? parseNum(raw) : c.t === "case" ? raw === "oui" : raw; }
      await persoSaveVal(ent, id, out); api.close(); await render(true); toast("Enregistré.", "ok");
    },
  });
}

/* ---------- Page : personnalisation ---------- */
V.perso = () => {
  if (!db.v21) return page("Personnalisation", "", "", v21Setup());
  const ent = PERSO_ENT.map(([k, l]) => { const d = persoDef(k);
    return card(l, `<div class="pad"><p class="mut" style="margin-top:0">${d.champs.length ? d.champs.map((c) => `<span class="chip n">${esc(c.l)} <small>${PERSO_TYPES.find((t) => t[0] === c.t)?.[1]}</small> <button type="button" class="rm" data-act="persoChampDel" data-id="${k}" data-arg="${c.id}" aria-label="Supprimer ${esc(c.l)}">×</button></span>`).join(" ") : "Aucun champ personnalisé."}</p>
      <p>${d.statuts.length ? d.statuts.map((s) => `<span class="chip ${s.c}">${esc(s.l)} <button type="button" class="rm" data-act="persoStatutDel" data-id="${k}" data-arg="${esc(s.l)}" aria-label="Supprimer ${esc(s.l)}">×</button></span>`).join(" ") : `<span class="mut">Aucun statut personnalisé.</span>`}</p>
      <p>${btn("Ajouter un champ", "persoChampNew", k, "", "o sm")} ${btn("Ajouter un statut", "persoStatutNew", k, "", "o sm")}</p></div>`); }).join("");
  const mod = prefGet("modeles_textes", []) || [], vues = prefGet("vues_perso", []) || [];
  return page("Personnalisation", "Adaptez Pilot à votre façon de travailler.", `<button type="button" class="btn o" data-act="homeCustom">Configurer l'accueil</button>`,
    `<h3 class="sect">Champs et statuts personnalisés</h3><p class="mut">Ces champs apparaissent en bas de la fiche (client, chantier, devis…), avec un statut libre en plus des statuts habituels.</p><div class="g2">${ent}</div>
     <h3 class="sect">Modèles de texte</h3>${card("", tbl(["Modèle", "Aperçu", ""], mod.map((m) => ({ act: "persoModele", id: m.id, t: m.nom, c: [`<strong>${esc(m.nom)}</strong>`, esc(m.texte.slice(0, 90)) + (m.texte.length > 90 ? "…" : ""), `<button type="button" class="btn o sm dng" data-act="persoModeleDel" data-id="${m.id}">Supprimer</button>`] })), "Aucun modèle. Ex : conditions de paiement, mentions de garantie, texte de relance.") + `<div class="pad">${btn("Ajouter un modèle", "persoModele", "", "", "o sm")}<p class="mut">Dans toute fenêtre contenant une zone « Notes » ou « Conditions », un sélecteur permet d'insérer un modèle.</p></div>`)}
     <h3 class="sect">Vues enregistrées</h3>${card("", tbl(["Vue", "Page", ""], vues.map((v) => ({ go: v.page, t: v.nom, c: [`<strong>${esc(v.nom)}</strong>`, esc(navLabel(v.page)), `<button type="button" class="btn o sm dng" data-act="persoVueDel" data-id="${v.id}">Supprimer</button>`] })), "Aucune vue enregistrée. Sur une liste, utilisez le bouton « Vues » pour mémoriser un onglet et une recherche."))}`);
};

/* ---------- Vues enregistrées (bouton sur les listes) ---------- */
function persoVuesBtn(r) {
  const pa = $("#v .pa"); if (!pa || r.arg || !db.v21 || !($("#q") || $("#v .tabs")) || $("#vuesw")) return;
  const vues = (prefGet("vues_perso", []) || []).filter((v) => v.page === r.name);
  const w = document.createElement("div"); w.className = "pw"; w.id = "vuesw";
  w.innerHTML = `<button type="button" class="btn o" id="vuesb" aria-haspopup="true">Vues${vues.length ? ` (${vues.length})` : ""}</button><div class="pop sm" id="vuesp" hidden>${vues.map((v) => `<button type="button" class="mi" data-act="persoVueUse" data-id="${v.id}">${esc(v.nom)}</button>`).join("")}${vues.length ? "<hr>" : ""}<button type="button" class="mi" data-act="persoVueNew">Enregistrer la vue actuelle…</button></div>`;
  pa.prepend(w);
  $("#vuesb", w).onclick = (e) => { e.stopPropagation(); const p = $("#vuesp", w); p.hidden = !p.hidden; };
}
document.addEventListener("click", (e) => { const p = $("#vuesp"); if (p && !p.hidden && !e.target.closest("#vuesw")) p.hidden = true; });

/* ---------- Modèles de texte dans les formulaires ---------- */
new MutationObserver((ml) => {
  const mod = db.v21 ? prefGet("modeles_textes", []) || [] : []; if (!mod.length) return;
  for (const m of ml) for (const n of m.addedNodes) {
    if (!(n instanceof HTMLElement) || !n.matches?.(".md")) continue;
    const ta = $("textarea[name=notes],textarea[name=conditions],textarea[name=description]", n); if (!ta || $("#tplsel", n)) continue;
    const s = document.createElement("select"); s.id = "tplsel"; s.className = "tplsel"; s.setAttribute("aria-label", "Insérer un modèle de texte");
    s.innerHTML = `<option value="">Insérer un modèle de texte…</option>` + mod.map((x) => `<option value="${esc(x.id)}">${esc(x.nom)}</option>`).join("");
    s.onchange = () => { const t = mod.find((x) => x.id === s.value); if (t) { ta.value = ta.value ? ta.value + "\n" + t.texte : t.texte; ta.dispatchEvent(new Event("input", { bubbles: true })); } s.value = ""; };
    ta.closest("label")?.insertAdjacentElement("beforebegin", s);
  }
}).observe(document.body, { childList: true });

/* ---------- Rappels v21 dans « À traiter » ---------- */
function v21Priorites(add, t) {
  if (!db.v21) return;
  for (const a of typeof ctAlertes === "function" ? ctAlertes() : []) add(a.lv, a.lv === "u" ? 270 : 135, a.t.split(" : ")[0], a.t.split(" : ").slice(1).join(" : "), 0, null, a.go);
  for (const i of (db.interv || []).filter((x) => ["Planifiée", "En cours"].includes(x.statut) && x.date_prevue < t)) add("i", 175, `${i.numero} · ${ivClient(i)}`, `Intervention prévue le ${D(i.date_prevue)}, pas terminée`, 0, null, `interventions/${i.id}`);
  for (const i of (db.interv || []).filter((x) => x.statut === "Terminée" && !x.facture_id && (Number(x.heures) || (x.pieces || []).length))) add("s", 90, `${i.numero} · ${ivClient(i)}`, "Intervention terminée, à facturer", ivTotaux(i).ht, { label: "Facturer", act: "ivFacturer", id: i.id }, `interventions/${i.id}`);
  for (const b of (db.livr || []).filter((x) => ["En préparation", "Prête"].includes(x.statut) && x.date_prevue <= t)) add(b.date_prevue < t ? "i" : "s", 165, `${b.numero} · ${blClient(b)}`, b.date_prevue < t ? `Livraison en retard (prévue le ${D(b.date_prevue)})` : "Livraison prévue aujourd'hui", 0, null, `livraisons/${b.id}`);
  for (const b of (db.livr || []).filter((x) => ["Livrée", "Livrée partiellement"].includes(x.statut) && !x.facture_id && blTotal(x) > 0)) add("s", 85, `${b.numero} · ${blClient(b)}`, "Livraison effectuée, à facturer", blTotal(b), { label: "Facturer", act: "blFacturer", id: b.id }, `livraisons/${b.id}`);
  for (const d of (db.demPrix || []).filter((x) => x.statut === "Envoyée" && x.date_limite && x.date_limite < t)) add("s", 80, d.libelle, `Demande de prix : réponses attendues avant le ${D(d.date_limite)}`, 0, null, `comparateur/${d.id}`);
}

/* ---------- Appelé après chaque affichage de page ---------- */
function pilotAfterRender(r) {
  try { if (typeof socHeader === "function") socHeader(); } catch (e) { console.warn(e); }
  if (!db.v21) return;
  try {
    if (r.arg && PERSO_ENT.some((x) => x[0] === r.name)) persoCard(r);
    persoVuesBtn(r);
    if (ST.pendingQ && ST.pendingQ.page === r.name) { const s = $("#q"); if (s) { s.value = ST.pendingQ.q; s.dispatchEvent(new Event("input")); } ST.pendingQ = null; }
  } catch (e) { console.warn(e); }
}

const persoActions = {
  persoEdit: (id, arg) => guard() && persoForm(arg, id),
  persoChampNew: (ent) => guard() && modal("Nouveau champ", `<div class="frm">${fld({ k: "l", l: "Nom du champ", ph: "Ex : N° de commande client", cls: "full" })}${fld({ k: "t", l: "Type", t: "select", o: PERSO_TYPES.map(([v, l]) => ({ v, l })), v: "texte" })}${fld({ k: "o", l: "Choix possibles (séparés par une virgule)", r: 0, hint: "Pour une liste de choix uniquement." })}</div>`, {
    submit: "Ajouter", onSubmit: async (v, api) => {
      const d = persoDef(ent), c = { id: "c" + Date.now().toString(36), l: v.l.trim(), t: v.t }; if (v.t === "liste") { c.o = v.o.split(",").map((x) => x.trim()).filter(Boolean); if (!c.o.length) throw new Error("Indiquez au moins un choix."); }
      await persoSaveDef(ent, { ...d, champs: [...d.champs, c] }); api.close(); await render(true);
    } }),
  persoChampDel: async (ent, c) => { if (!guard() || !confirm("Supprimer ce champ ? Les valeurs déjà saisies ne s'afficheront plus.")) return; const d = persoDef(ent); await persoSaveDef(ent, { ...d, champs: d.champs.filter((x) => x.id !== c) }); await render(true); },
  persoStatutNew: (ent) => guard() && modal("Nouveau statut", `<div class="frm">${fld({ k: "l", l: "Nom du statut", ph: "Ex : En attente du client", cls: "full" })}${fld({ k: "c", l: "Couleur", t: "select", o: PERSO_COULEURS.map(([v, l]) => ({ v, l })), v: "ac" })}</div>`, {
    submit: "Ajouter", onSubmit: async (v, api) => { const d = persoDef(ent), l = v.l.trim(); if (d.statuts.some((s) => s.l === l)) throw new Error("Ce statut existe déjà."); await persoSaveDef(ent, { ...d, statuts: [...d.statuts, { l, c: v.c }] }); api.close(); await render(true); } }),
  persoStatutDel: async (ent, l) => { if (!guard() || !confirm("Supprimer ce statut ?")) return; const d = persoDef(ent); await persoSaveDef(ent, { ...d, statuts: d.statuts.filter((s) => s.l !== l) }); await render(true); },
  persoModele: (id) => { if (!guard()) return; const l = prefGet("modeles_textes", []) || [], m = l.find((x) => x.id === id);
    modal(m ? "Modifier le modèle" : "Nouveau modèle de texte", `<div class="frm">${fld({ k: "nom", l: "Nom du modèle", v: m?.nom || "", ph: "Ex : Conditions de paiement", cls: "full" })}${fld({ k: "texte", l: "Texte", t: "textarea", rows: 6, v: m?.texte || "", cls: "full" })}</div>`, {
      submit: "Enregistrer", onSubmit: async (v, api) => { const n = { id: m?.id || "m" + Date.now().toString(36), nom: v.nom.trim(), texte: v.texte.trim() }; await prefSet("modeles_textes", m ? l.map((x) => (x.id === m.id ? n : x)) : [...l, n]); api.close(); await render(true); } }); },
  persoModeleDel: async (id) => { if (!guard() || !confirm("Supprimer ce modèle ?")) return; await prefSet("modeles_textes", (prefGet("modeles_textes", []) || []).filter((x) => x.id !== id)); await render(true); },
  persoVueNew: () => { const r = parseHash(); modal("Enregistrer cette vue", `<p class="mut">La vue retient l'onglet affiché et le texte recherché.</p><div class="frm">${fld({ k: "nom", l: "Nom de la vue", ph: "Ex : Factures en retard", cls: "full" })}</div>`, {
    submit: "Enregistrer", onSubmit: async (v, api) => { const l = prefGet("vues_perso", []) || []; await prefSet("vues_perso", [...l, { id: "v" + Date.now().toString(36), nom: v.nom.trim(), page: r.name, tab: ST.tab[r.name] || null, q: $("#q")?.value || "" }]); api.close(); await render(true); toast("Vue enregistrée.", "ok"); } }); },
  persoVueUse: (id) => { const v = (prefGet("vues_perso", []) || []).find((x) => x.id === id); if (!v) return; if (v.tab) ST.tab[v.page] = v.tab; ST.pendingQ = { page: v.page, q: v.q || "" }; if (parseHash().name === v.page) render(true); else go(v.page); },
  persoVueDel: async (id) => { if (!guard()) return; await prefSet("vues_perso", (prefGet("vues_perso", []) || []).filter((x) => x.id !== id)); await render(true); },
};
