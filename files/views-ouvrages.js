/* Bibliothèque d'ouvrages BTP : prix et temps de pose prêts à l'emploi.
   La table peut contenir des dizaines de milliers de lignes : la recherche se fait côté serveur, par pages. */

const OV_PAGE = 40;
const OV_UNITES = ["u", "m²", "ml", "m³", "h", "jour", "forfait", "kg", "lot"];
const ovSt = () => (ST.ov ||= { q: "", corps: "", n: OV_PAGE });
const ovH = (h) => (Number(h) ? fmtNum(h, Number(h) < 10 ? 2 : 1) + " h" : "-");
let _ovCorps = null; // cache des corps d'état

async function ovCorps(force = false) {
  if (_ovCorps && !force) return _ovCorps;
  try { _ovCorps = (await q(sb.rpc("ouvrages_corps"))).map((r) => ({ corps: r.corps_etat, nb: Number(r.nb) })); } catch (e) { _ovCorps = []; }
  return _ovCorps;
}

// Recherche : tous les mots doivent se trouver dans la désignation (ou le code)
async function ovSearch({ text = "", corps = "", limit = OV_PAGE }) {
  let r = sb.from("ouvrages").select("*", { count: "exact" }).order("corps_etat").order("designation").range(0, limit - 1);
  if (corps) r = r.eq("corps_etat", corps);
  for (const w of String(text).toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6)) {
    const t = w.replace(/[%,()*\\]/g, "");
    if (t) r = r.or(`designation.ilike.%${t}%,code.ilike.%${t}%,corps_etat.ilike.%${t}%`);
  }
  const { data, error, count } = await r;
  if (error) throw error;
  data.forEach((o) => nz(o, ["prix_ht", "temps_pose_h", "part_mo", "taux_tva"]));
  return { rows: data, total: count ?? data.length };
}

const ovRow = (o, withAct = true) => ({
  t: "",
  c: [`<strong>${esc(o.designation)}</strong><small>${esc(o.corps_etat)}${o.code ? " · " + esc(o.code) : ""}</small>`, esc(o.unite),
    `<span class="num">${E2(o.prix_ht)}</span>`, `<span class="num">${ovH(o.temps_pose_h)}</span>`,
    o.part_mo ? `<span class="num">${Math.round(o.part_mo)} %</span>` : "-", `<span class="mut">${esc(o.source || "")}</span>`,
    withAct ? `<span class="r"><button class="lk w" data-act="ovEdit" data-id="${o.id}">Modifier</button></span>` : ""],
});
const OV_COLS = ["Ouvrage", "Unité", { h: "Prix HT", r: 1 }, { h: "Temps de pose", r: 1 }, { h: "Part MO", r: 1 }, "Source", ""];

/* ---------- Page ---------- */
V.ouvrages = async () => {
  const s = ovSt();
  const corps = db.v7 ? await ovCorps() : [];
  const sel = `<select class="dcf" id="ovcorps" aria-label="Corps d'état"><option value="">Tous les corps d'état</option>${corps.map((c) => `<option value="${esc(c.corps)}"${c.corps === s.corps ? " selected" : ""}>${esc(c.corps)} (${c.nb})</option>`).join("")}</select>`;
  const actions = btn("Nouvel ouvrage", "ovNew", "", "", "w") + btn("Importer un fichier", "ovImport", "", "", "o w") +
    btn(db.nbOuvrages ? "Ajouter le jeu de départ" : "Charger le jeu de départ", "ovSeed", "", "", "o w");
  const body = !db.v7 ? card("", setupV7("la bibliothèque d'ouvrages")) : `
    ${strip([
      ["Ouvrages", fmtNum(db.nbOuvrages, 0), db.nbOuvrages ? "dans votre bibliothèque" : "bibliothèque vide"],
      ["Corps d'état", String(corps.length), corps.length ? "familles de travaux" : "-"],
      ["Utilisation", "Devis et factures", "bouton « Bibliothèque » dans l'éditeur"],
    ])}
    ${db.nbOuvrages ? "" : card("", `<div class="empty" style="padding:30px 20px"><h2>Votre bibliothèque est vide</h2><p style="max-width:620px;margin:6px auto 16px">Chargez le jeu de départ (environ 250 ouvrages courants avec prix indicatifs et temps de pose), puis importez votre propre base de prix au format CSV pour atteindre des dizaines de milliers de lignes.</p>${btn("Charger le jeu de départ", "ovSeed", "", "", "w")} ${btn("Importer un fichier CSV", "ovImport", "", "", "o w")}</div>`)}
    <div class="sr dcbar"><input id="ovq" type="search" placeholder="Rechercher : carrelage, cloison, chauffe-eau, tableau électrique…" aria-label="Rechercher un ouvrage" value="${esc(s.q)}"><div class="pa">${sel}</div></div>
    <div id="ovres">${card("", `<p class="emp" style="padding:20px;margin:0;color:var(--mut)">Chargement…</p>`)}</div>
    <p class="note">Les prix du jeu de départ sont des ordres de grandeur (fourniture et pose, HT). Vérifiez-les avec vos fournisseurs avant de chiffrer. Le temps de pose est indiqué par unité, en heures.</p>`;
  return { html: page("Bibliothèque d'ouvrages", "Prix et temps de pose prêts à l'emploi, à insérer dans vos devis et factures.", actions, body), after: db.v7 && db.nbOuvrages ? ovBind : null };
};

function ovBind() {
  const s = ovSt(), inp = $("#ovq"), sel = $("#ovcorps");
  if (!inp) return;
  let timer;
  const run = async () => {
    const box = $("#ovres");
    if (!box) return;
    try {
      const { rows, total } = await ovSearch({ text: s.q, corps: s.corps, limit: s.n });
      box.innerHTML = card(`Résultats <span class="mut" style="font-weight:400">· ${fmtNum(total, 0)}</span>`,
        tbl(OV_COLS, rows.map((o) => ovRow(o)), "Aucun ouvrage ne correspond à cette recherche.") +
        (total > rows.length ? `<div class="cb" style="border-top:1px solid var(--line2);text-align:center"><button class="lk" data-act="ovMore">Afficher les ${Math.min(OV_PAGE, total - rows.length)} suivants (${fmtNum(total - rows.length, 0)} restants)</button></div>` : ""));
    } catch (e) { box.innerHTML = card("", `<p class="emp" style="padding:20px;margin:0">${esc(friendly(e))}</p>`); }
  };
  inp.oninput = () => { clearTimeout(timer); timer = setTimeout(() => { s.q = inp.value; s.n = OV_PAGE; run(); }, 250); };
  sel.onchange = () => { s.corps = sel.value; s.n = OV_PAGE; run(); };
  run();
  ST._ovRun = run;
}

/* ---------- Fiche d'un ouvrage ---------- */
function ovForm(o) {
  if (!guard()) return;
  if (!db.v7) return toast("Exécutez d'abord migration_v7.sql dans Supabase.", "dn");
  const num = (x) => (x === undefined || x === null || x === "" ? "" : String(x).replace(".", ","));
  const corps = (_ovCorps || []).map((c) => c.corps);
  const body = `<datalist id="dl_corps">${corps.map((c) => `<option value="${esc(c)}">`).join("")}</datalist><div class="frm">
    ${fld({ k: "designation", l: "Désignation", v: o?.designation, cls: "full" })}
    ${fld({ k: "corps_etat", l: "Corps d'état", v: o?.corps_etat || "Divers" })}
    ${fld({ k: "code", l: "Code (facultatif)", v: o?.code, r: 0 })}
    ${fld({ k: "unite", l: "Unité", t: "select", o: OV_UNITES, v: o?.unite || "u" })}
    ${fld({ k: "prix_ht", l: "Prix unitaire HT (€)", t: "number", v: num(o?.prix_ht), hint: "Fourniture et pose." })}
    ${fld({ k: "temps_pose_h", l: "Temps de pose (heures par unité)", t: "number", v: num(o?.temps_pose_h), r: 0 })}
    ${fld({ k: "part_mo", l: "Part de main-d'œuvre dans le prix (%)", t: "number", v: num(o?.part_mo), r: 0 })}
    ${fld({ k: "taux_tva", l: "TVA (%)", t: "select", o: ["20", "10", "5.5", "0"].map((x) => ({ v: x, l: x.replace(".", ",") + " %" })), v: String(o?.taux_tva ?? (Number(db.ent.taux_tva_defaut) || 20)) })}</div>`;
  const api = modal(o ? "Modifier l'ouvrage" : "Nouvel ouvrage", body, {
    wide: true,
    onSubmit: async (v, api) => {
      const row = { designation: v.designation.trim(), corps_etat: (v.corps_etat || "Divers").trim(), code: v.code?.trim() || null, unite: v.unite, prix_ht: Math.max(0, parseNum(v.prix_ht)),
        temps_pose_h: Math.max(0, parseNum(v.temps_pose_h)), part_mo: Math.min(100, Math.max(0, parseNum(v.part_mo))), taux_tva: Number(v.taux_tva) };
      if (o) await q(sb.from("ouvrages").update(row).eq("id", o.id));
      else await q(sb.from("ouvrages").insert({ ...row, source: "Perso" }));
      api.close();
      toast(o ? "Ouvrage modifié." : "Ouvrage ajouté.", "ok");
      _ovCorps = null;
      await refresh();
    },
  });
  $("#f_corps_etat", api.el).setAttribute("list", "dl_corps");
  if (o) {
    $(".fa", api.el).insertAdjacentHTML("afterbegin", `<button type="button" class="btn dn-o" id="ovdel" style="margin-right:auto">Supprimer</button>`);
    $("#ovdel", api.el).onclick = async () => {
      if (!confirm("Supprimer cet ouvrage de la bibliothèque ?")) return;
      await q(sb.from("ouvrages").delete().eq("id", o.id));
      api.close(); _ovCorps = null; toast("Ouvrage supprimé."); await refresh();
    };
  }
}

/* ---------- Jeu de départ ---------- */
async function ovSeed() {
  if (!guard()) return;
  if (!db.v7) return toast("Exécutez d'abord migration_v7.sql dans Supabase.", "dn");
  const src = "Pilot (indicatif)";
  const have = await q(sb.from("ouvrages").select("id", { count: "exact", head: false }).eq("source", src).limit(1));
  if (have.length && !confirm("Le jeu de départ est déjà dans votre bibliothèque. Le remplacer par une version propre ?\n\nVos propres ouvrages et vos imports ne sont pas touchés.")) return;
  if (!have.length && !confirm("Ajouter environ 250 ouvrages courants à votre bibliothèque ?\n\nLes prix sont indicatifs (ordre de grandeur, HT, fourniture et pose) : à adapter avec vos propres tarifs.")) return;
  toast("Ajout des ouvrages…");
  await q(sb.from("ouvrages").delete().eq("source", src));
  const rows = [];
  for (const [corps, pre, items] of OUVRAGES_DEPART)
    items.forEach(([designation, unite, prix, tp, mo, tva], i) =>
      rows.push({ code: `${pre}-${String(i + 1).padStart(3, "0")}`, corps_etat: corps, designation, unite, prix_ht: prix, temps_pose_h: tp, part_mo: mo, taux_tva: tva, source: src }));
  for (let i = 0; i < rows.length; i += 200) await q(sb.from("ouvrages").insert(rows.slice(i, i + 200)));
  _ovCorps = null;
  toast(`${rows.length} ouvrages ajoutés. Vérifiez les prix avant de les utiliser.`, "ok");
  await refresh();
}

/* ---------- Import CSV (jusqu'à plusieurs dizaines de milliers de lignes) ---------- */
function ovParse(buf) {
  const text = bkDecode(buf);
  const rows = bkCsvRows(text, bkDelim(text));
  let map = null, hi = -1;
  for (let i = 0; i < Math.min(rows.length, 30) && !map; i++) {
    const h = rows[i].map(bkNorm);
    const f = (re) => h.findIndex((x) => re.test(x));
    const des = f(/^(designation|libelle|ouvrage|description|intitule|nom)\b/), prix = f(/(prix|pu|tarif|montant)\b.*(ht|unitaire|u)?|^pu\b/);
    if (des >= 0 && prix >= 0) {
      map = { des, prix, code: f(/^(code|ref|reference|n)\b/), corps: f(/(corps|lot|famille|categorie|chapitre|metier)/), unite: f(/^(unite|u)\b/),
        tp: f(/(temps|duree|heures?|h pose)/), mo: f(/(part|taux).*(mo|main)|^mo\b|main d oeuvre/), tva: f(/^tva\b/) };
      hi = i;
    }
  }
  if (!map) throw new Error("Colonnes non reconnues. Il faut au minimum une colonne « Désignation » et une colonne « Prix ». Téléchargez le modèle pour voir le format attendu.");
  const out = [];
  let bad = 0;
  for (const r of rows.slice(hi + 1)) {
    const designation = String(r[map.des] ?? "").trim(), prix = bkNum(r[map.prix]);
    if (!designation) continue;
    if (prix === null || prix < 0) { bad++; continue; }
    const tva = map.tva >= 0 ? bkNum(r[map.tva]) : null;
    out.push({
      code: map.code >= 0 ? String(r[map.code] ?? "").trim().slice(0, 40) || null : null,
      corps_etat: (map.corps >= 0 ? String(r[map.corps] ?? "").trim() : "") || "Divers",
      designation: designation.slice(0, 300), unite: (map.unite >= 0 ? String(r[map.unite] ?? "").trim() : "") || "u",
      prix_ht: r2(prix), temps_pose_h: map.tp >= 0 ? Math.max(0, bkNum(r[map.tp]) || 0) : 0,
      part_mo: map.mo >= 0 ? Math.min(100, Math.max(0, bkNum(r[map.mo]) || 0)) : 0, taux_tva: tva !== null && [0, 5.5, 10, 20].includes(tva) ? tva : 10, source: "Import",
    });
  }
  if (!out.length) throw new Error("Aucune ligne exploitable dans ce fichier.");
  return { rows: out, bad };
}
function ovImport() {
  if (!guard()) return;
  if (!db.v7) return toast("Exécutez d'abord migration_v7.sql dans Supabase.", "dn");
  let parsed = null;
  const body = `<p class="mut" style="margin:0 0 12px">Importez votre base de prix au format <b>CSV</b> (export Excel, logiciel de métrés, bordereau de prix d'un fournisseur ou d'une base sous licence). Pilot accepte plusieurs dizaines de milliers de lignes. Colonnes reconnues : <b>Code</b>, <b>Corps d'état</b>, <b>Désignation</b>, <b>Unité</b>, <b>Prix HT</b>, <b>Temps de pose (h)</b>, <b>Part MO (%)</b>, <b>TVA</b>.</p>
    <div class="frm"><div class="full"><div class="drop"><div><b>Fichier CSV</b><small style="display:block" class="mut">Séparateur « ; » ou « , », 40 Mo maximum</small></div><input type="file" id="ovfile" accept=".csv,.txt,text/csv" hidden><span><button type="button" class="btn o" id="ovmodel">Télécharger le modèle</button> <button type="button" class="btn" id="ovpick">Choisir le fichier</button></span></div></div>
    <div class="full" id="ovprev"></div>
    ${fld({ k: "mode", l: "Si un code existe déjà", t: "select", o: [{ v: "replace", l: "Remplacer l'ouvrage existant" }, { v: "add", l: "Ajouter quand même (doublons)" }], v: "replace", cls: "full" })}</div>`;
  modal("Importer des ouvrages", body, {
    wide: true, submit: "Importer", noFocus: true,
    onMount: (m) => {
      const inp = $("#ovfile", m), prev = $("#ovprev", m);
      $("#ovpick", m).onclick = () => inp.click();
      $("#ovmodel", m).onclick = () => downloadBlob("modele-ouvrages.csv", new Blob([toCsv(["Code", "Corps d'état", "Désignation", "Unité", "Prix HT", "Temps de pose (h)", "Part MO (%)", "TVA"],
        [["CAR-001", "Carrelage et faïence", "Carrelage sol grès cérame 60 x 60, pose collée", "m²", 62, 0.9, 50, 10], ["PLO-001", "Plomberie et sanitaire", "Remplacement d'un WC complet", "u", 320, 2.5, 40, 10]])], { type: "text/csv;charset=utf-8" }));
      inp.onchange = async () => {
        const f = inp.files[0];
        if (!f) return;
        prev.innerHTML = `<span class="mut">Lecture de ${esc(f.name)}…</span>`;
        parsed = null;
        try {
          if (f.size > 40 * 1024 * 1024) throw new Error("Fichier trop volumineux (40 Mo maximum).");
          parsed = ovParse(await f.arrayBuffer());
          const corps = new Set(parsed.rows.map((r) => r.corps_etat)).size;
          prev.innerHTML = `<div class="bkprev"><b>${fmtNum(parsed.rows.length, 0)} ouvrages</b> dans ${corps} corps d'état${parsed.bad ? `<br><span class="mut">${parsed.bad} ligne${parsed.bad > 1 ? "s" : ""} ignorée${parsed.bad > 1 ? "s" : ""} (prix illisible)</span>` : ""}</div>`;
        } catch (e) { prev.innerHTML = `<span class="badge-warn">${esc(friendly(e))}</span>`; }
      };
    },
    onSubmit: async (v, api) => {
      if (!parsed) throw new Error("Choisissez d'abord un fichier lisible.");
      const rows = parsed.rows;
      for (let i = 0; i < rows.length; i += 500) {
        api.error(`Import ${Math.min(i + 500, rows.length).toLocaleString("fr-FR")} / ${rows.length.toLocaleString("fr-FR")}…`);
        const chunk = rows.slice(i, i + 500);
        if (v.mode === "replace") {
          const codes = chunk.map((r) => r.code).filter(Boolean);
          if (codes.length) await q(sb.from("ouvrages").delete().in("code", codes));
        }
        await q(sb.from("ouvrages").insert(chunk));
      }
      api.close(); _ovCorps = null;
      toast(`${fmtNum(rows.length, 0)} ouvrages importés.`, "ok");
      await refresh();
    },
  });
}

/* ---------- Sélecteur dans l'éditeur de devis / facture ---------- */
// onPick(ouvrage) est appelé à chaque ouvrage choisi ; la fenêtre reste ouverte pour en ajouter plusieurs.
function ovPicker(onPick) {
  if (!db.v7 || !db.nbOuvrages) {
    toast(!db.v7 ? "Exécutez migration_v7.sql dans Supabase pour activer la bibliothèque." : "Votre bibliothèque est vide : chargez le jeu de départ depuis la page « Bibliothèque ».", "dn");
    return;
  }
  const picked = new Map();
  const api = modal("Bibliothèque d'ouvrages", `<div class="sr dcbar" style="margin:0"><input id="pkq" type="search" placeholder="Rechercher : carrelage, cloison, chauffe-eau…" aria-label="Rechercher un ouvrage" autocomplete="off"><div class="pa"><select class="dcf" id="pkc" aria-label="Corps d'état"><option value="">Tous les corps d'état</option></select></div></div>
    <div id="pkres" class="tw" style="max-height:52vh;overflow:auto"></div>`, { wide: true, submit: false, noFocus: false });
  // Échap ferme seulement ce sélecteur, pas l'éditeur en dessous
  const esc2 = (e) => { if (e.key === "Escape") { e.stopImmediatePropagation(); api.close(); } };
  document.addEventListener("keydown", esc2, true);
  const close0 = api.close;
  api.close = () => { document.removeEventListener("keydown", esc2, true); close0(); };
  $$("[data-x]", api.el).forEach((b) => (b.onclick = api.close));
  const inp = $("#pkq", api.el), sel = $("#pkc", api.el), res = $("#pkres", api.el);
  ovCorps().then((l) => { sel.insertAdjacentHTML("beforeend", l.map((c) => `<option value="${esc(c.corps)}">${esc(c.corps)} (${c.nb})</option>`).join("")); });
  let timer, seq = 0, n = 30;
  const run = async () => {
    const my = ++seq;
    try {
      const { rows, total } = await ovSearch({ text: inp.value, corps: sel.value, limit: n });
      if (my !== seq) return;
      rows.forEach((o) => picked.set(o.id, o));
      res.innerHTML = `<table><tbody>${rows.length ? rows.map((o) => `<tr><td><strong>${esc(o.designation)}</strong><small>${esc(o.corps_etat)}${o.temps_pose_h ? " · pose " + ovH(o.temps_pose_h) + " / " + esc(o.unite) : ""}</small></td>
        <td class="r"><span class="num">${E2(o.prix_ht)}</span><small>par ${esc(o.unite)}</small></td><td class="r" style="width:96px"><button type="button" class="btn sm" data-pk="${o.id}">Ajouter</button></td></tr>`).join("") : `<tr><td class="emp">Aucun ouvrage ne correspond.</td></tr>`}</tbody></table>
        ${total > rows.length ? `<div class="cb" style="text-align:center"><button type="button" class="lk" id="pkmore">Afficher plus (${fmtNum(total - rows.length, 0)} restants)</button></div>` : ""}`;
    } catch (e) { res.innerHTML = `<p class="emp" style="padding:16px">${esc(friendly(e))}</p>`; }
  };
  inp.oninput = () => { clearTimeout(timer); timer = setTimeout(() => { n = 30; run(); }, 250); };
  sel.onchange = () => { n = 30; run(); };
  api.el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-pk]");
    if (b) { const o = picked.get(b.dataset.pk); if (o) { onPick(o); b.textContent = "Ajouté"; b.classList.add("o"); toast(`« ${esc(o.designation.slice(0, 60))} » ajouté.`, "ok"); } }
    if (e.target.closest("#pkmore")) { n += 30; run(); }
  });
  api.el.querySelector(".fa")?.remove();
  $(".mb", api.el).insertAdjacentHTML("beforeend", `<div style="display:flex;justify-content:flex-end"><button type="button" class="btn" data-x>Terminer</button></div>`);
  $$("[data-x]", api.el).forEach((b) => (b.onclick = api.close));
  run();
  inp.focus();
}

const ovActions = {
  ovNew: () => ovForm(null),
  ovEdit: async (id) => { const { data } = await sb.from("ouvrages").select("*").eq("id", id).single(); if (data) { nz(data, ["prix_ht", "temps_pose_h", "part_mo", "taux_tva"]); await ovCorps(); ovForm(data); } },
  ovImport: () => ovImport(),
  ovSeed: () => ovSeed(),
  ovMore: () => { ovSt().n += OV_PAGE; return ST._ovRun?.(); },
};
