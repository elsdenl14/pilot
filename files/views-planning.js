/* Planning : calendrier, planning des chantiers (Gantt), tâches. + chargement des données v12. */

async function loadV12() {
  db.v12 = false;
  Object.assign(db, { taches: [], evts: [], phases: [], sts: [], stm: [], mat: [], matA: [], matE: [], tps: [], obj: [], chg: [] });
  try {
    const [ta, ev, ph, st, sm, ma, mf, me, tp, ob, cg] = await Promise.all([
      q(sb.from("taches").select("*").order("echeance")), q(sb.from("evenements").select("*").order("date_debut")),
      q(sb.from("planning_phases").select("*").order("date_debut")), q(sb.from("sous_traitants").select("*").order("nom")),
      q(sb.from("st_missions").select("*").order("created_at", { ascending: false })), q(sb.from("materiel").select("*").order("nom")),
      q(sb.from("materiel_affectations").select("*").order("date_debut", { ascending: false })), q(sb.from("materiel_entretiens").select("*").order("date_entretien", { ascending: false })),
      q(sb.from("temps_passes").select("*").order("date_travail", { ascending: false })), q(sb.from("objectifs").select("*").order("annee", { ascending: false })),
      q(sb.from("tresorerie_charges").select("*").order("created_at")),
    ]);
    sm.forEach((x) => nz(x, ["montant_ht", "retenue_pct"])); ma.forEach((x) => nz(x, ["prix_achat", "cout_jour"])); me.forEach((x) => nz(x, ["cout"]));
    tp.forEach((x) => nz(x, ["heures", "taux_horaire"])); ob.forEach((x) => nz(x, ["ca_ht", "marge_pct", "resultat", "nb_chantiers", "taux_transfo", "tresorerie_fin"])); cg.forEach((x) => nz(x, ["montant"]));
    st.forEach((x) => nz(x, ["taux_horaire"])); ta.forEach((x) => nz(x, ["duree_estimee_h"]));
    Object.assign(db, { taches: ta, evts: ev, phases: ph, sts: st, stm: sm, mat: ma, matA: mf, matE: me, tps: tp, obj: ob, chg: cg, v12: true, v12err: "" });
    db.ent.taux_horaire_cout = Number(db.ent.taux_horaire_cout ?? 35); db.ent.taux_horaire_vente = Number(db.ent.taux_horaire_vente ?? 55);
  } catch (e) { db.v12 = false; db.v12err = e?.message || String(e); }
}
const setupV12 = () => `<div class="empty" style="padding:30px 20px"><h2>Une étape manque</h2><p style="max-width:560px;margin:6px auto 14px">Exécutez <b>migration_v12.sql</b> dans Supabase (SQL Editor) pour activer le calendrier, les tâches, le planning, le matériel, les sous-traitants, les temps passés, les objectifs et la projection de trésorerie.${db.v12err ? `<br><small class="mut">${esc(db.v12err)}</small>` : ""}</p></div>`;
const chOpts = (none = "Aucun chantier") => [{ v: "", l: none }, ...db.chantiers.map((c) => ({ v: c.id, l: c.nom }))];
const chNm = (id) => byId(db.chantiers, id)?.nom || "";
const addD = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const dow = (iso) => (new Date(iso + "T12:00:00").getDay() + 6) % 7; // 0 = lundi
const mondayOf = (iso) => addD(iso, -dow(iso));

/* ---------- Tâches ---------- */
const TA_PRIO = { Urgente: 0, Haute: 1, Normale: 2, Basse: 3 };
const TA_CHIP = { Urgente: "dn", Haute: "wn", Normale: "", Basse: "mu" };
const taLate = (t) => t.statut !== "Terminée" && t.echeance && t.echeance < today();
function tacheForm(t, pre = {}) {
  if (!guard()) return;
  const v0 = { ...pre, ...(t || {}) };
  modal(t ? "Modifier la tâche" : "Nouvelle tâche", `<div class="frm">${fld({ k: "titre", l: "Tâche", v: v0.titre, cls: "full" })}
    ${fld({ k: "chantier_id", l: "Chantier", t: "select", o: chOpts(), v: v0.chantier_id || "", r: 0 })}${fld({ k: "assigne", l: "Assignée à", v: v0.assigne || "", r: 0, hint: "Vous, un salarié, un sous-traitant…" })}
    ${fld({ k: "priorite", l: "Priorité", t: "select", o: Object.keys(TA_PRIO), v: v0.priorite || "Normale" })}${fld({ k: "statut", l: "Statut", t: "select", o: ["À faire", "En cours", "Bloquée", "Terminée"], v: v0.statut || "À faire" })}
    ${fld({ k: "echeance", l: "Échéance", t: "date", v: v0.echeance || "", r: 0 })}${fld({ k: "duree_estimee_h", l: "Durée estimée (heures)", t: "number", v: v0.duree_estimee_h ? String(v0.duree_estimee_h).replace(".", ",") : "", r: 0 })}
    ${fld({ k: "description", l: "Détails", t: "textarea", v: v0.description || "", r: 0, cls: "full" })}</div>`, {
    onSubmit: async (v, api) => {
      const row = { titre: v.titre.trim(), chantier_id: v.chantier_id || null, assigne: v.assigne || null, priorite: v.priorite, statut: v.statut, echeance: v.echeance || null, duree_estimee_h: v.duree_estimee_h ? parseNum(v.duree_estimee_h) : null, description: v.description || null,
        termine_le: v.statut === "Terminée" ? (t?.termine_le || today()) : null };
      if (t) await q(sb.from("taches").update(row).eq("id", t.id)); else await q(sb.from("taches").insert(row));
      api.close(); toast(t ? "Tâche modifiée." : "Tâche ajoutée.", "ok"); await refresh();
    } });
}
function tachesTab(t) {
  const f = ST.taF || "ouvertes", all = db.taches;
  const L = { ouvertes: (x) => x.statut !== "Terminée", retard: taLate, moi: (x) => x.statut !== "Terminée" && /^(moi|)$/i.test(x.assigne || ""), finies: (x) => x.statut === "Terminée", toutes: () => true };
  const list = all.filter(L[f] || L.ouvertes).sort((a, b) => (a.statut === "Terminée") - (b.statut === "Terminée") || (a.echeance || "9999").localeCompare(b.echeance || "9999") || TA_PRIO[a.priorite] - TA_PRIO[b.priorite]);
  const rows = list.map((x) => ({ t: `${x.titre} ${chNm(x.chantier_id)} ${x.assigne || ""}`, c: [`<input type="checkbox" data-act="taDone" data-id="${x.id}" ${x.statut === "Terminée" ? "checked" : ""} aria-label="Terminée">`,
    `<span class="lnk" data-act="taEdit" data-id="${x.id}" style="cursor:pointer"><strong${x.statut === "Terminée" ? ' style="text-decoration:line-through;opacity:.6"' : ""}>${esc(x.titre)}</strong></span><small>${esc(chNm(x.chantier_id) || "Sans chantier")}${x.assigne ? " · " + esc(x.assigne) : ""}</small>`,
    `<span class="chip ${TA_CHIP[x.priorite]}">${x.priorite}</span>`, x.echeance ? (taLate(x) ? `<span class="chip dn">${D(x.echeance)} · en retard</span>` : D(x.echeance)) : "-", chip(x.statut)] }));
  const ouv = all.filter(L.ouvertes);
  return page("Planning", "Calendrier, planning des chantiers et tâches.", btn("Nouvelle tâche", "taNew", "", "", "w"),
    t + strip([["Tâches ouvertes", ouv.length, `${all.filter((x) => x.statut === "Terminée").length} terminée${all.filter((x) => x.statut === "Terminée").length > 1 ? "s" : ""}`], ["En retard", all.filter(taLate).length, "échéance dépassée", all.filter(taLate).length ? "dn" : ""],
      ["Cette semaine", ouv.filter((x) => x.echeance && x.echeance >= today() && x.echeance <= addD(today(), 7)).length, "à faire d'ici 7 jours"], ["Bloquées", all.filter((x) => x.statut === "Bloquée").length, "à débloquer", all.some((x) => x.statut === "Bloquée") ? "wn" : ""]]) +
    `<div style="margin-bottom:12px"><div class="seg">${[["ouvertes", "Ouvertes"], ["retard", "En retard"], ["moi", "À moi"], ["finies", "Terminées"], ["toutes", "Toutes"]].map(([k, l]) => `<button data-act="taFilter" data-arg="${k}" aria-pressed="${f === k}">${l}</button>`).join("")}</div></div>` +
    searchBar("Rechercher une tâche, un chantier…", `${rows.length}`) + card("", tbl(["", "Tâche", "Priorité", "Échéance", "Statut"], rows, "Aucune tâche ici. Ajoutez la première.")));
}

/* ---------- Événements ---------- */
const EV_TYPES = ["RDV", "Visite", "Réunion", "Livraison", "Congé", "Autre"];
function evenementForm(e, pre = {}) {
  if (!guard()) return;
  const v0 = { date_debut: today(), ...pre, ...(e || {}) };
  modal(e ? "Modifier l'événement" : "Nouvel événement", `<div class="frm">${fld({ k: "titre", l: "Titre", v: v0.titre, cls: "full" })}
    ${fld({ k: "type", l: "Type", t: "select", o: EV_TYPES, v: v0.type || "RDV" })}${fld({ k: "chantier_id", l: "Chantier", t: "select", o: chOpts(), v: v0.chantier_id || "", r: 0 })}
    ${fld({ k: "date_debut", l: "Date", t: "date", v: v0.date_debut })}${fld({ k: "date_fin", l: "Jusqu'au (si plusieurs jours)", t: "date", v: v0.date_fin || "", r: 0 })}
    ${fld({ k: "heure_debut", l: "De", t: "time", v: v0.heure_debut || "", r: 0 })}${fld({ k: "heure_fin", l: "À", t: "time", v: v0.heure_fin || "", r: 0 })}
    ${fld({ k: "lieu", l: "Lieu", v: v0.lieu || "", r: 0, cls: "full" })}${fld({ k: "notes", l: "Notes", t: "textarea", v: v0.notes || "", r: 0, cls: "full" })}</div>`, {
    onSubmit: async (v, api) => {
      if (v.date_fin && v.date_fin < v.date_debut) throw new Error("La date de fin précède la date de début.");
      const row = { titre: v.titre.trim(), type: v.type, chantier_id: v.chantier_id || null, date_debut: v.date_debut, date_fin: v.date_fin || null, heure_debut: v.heure_debut || null, heure_fin: v.heure_fin || null, lieu: v.lieu || null, notes: v.notes || null };
      if (e) await q(sb.from("evenements").update(row).eq("id", e.id)); else await q(sb.from("evenements").insert(row));
      api.close(); toast("Événement enregistré.", "ok"); await refresh();
    }, extra: e ? btn("Supprimer", "evDel", e.id, "", "lk dn") : "" });
}

/* ---------- Calendrier ---------- */
const CAL_SRC = { ev: "Rendez-vous", ta: "Tâches", ph: "Phases de chantier", fa: "Factures à encaisser", de: "Paiements fournisseurs", bc: "Livraisons", vg: "Documents sous-traitants", ma: "Matériel" };
const calSet = () => (ST.calOff ||= new Set());
function calItems(from, to) {
  const out = [], off = calSet(), add = (src, d, label, cls, act, id) => { if (!off.has(src) && d >= from && d <= to) out.push({ src, d, label, cls, act, id }); };
  for (const e of db.evts) { const end = e.date_fin || e.date_debut; for (let d = e.date_debut < from ? from : e.date_debut; d <= end && d <= to; d = addD(d, 1)) add("ev", d, `${e.heure_debut && d === e.date_debut ? e.heure_debut + " " : ""}${e.titre}`, "bl", "evEdit", e.id); }
  for (const t of db.taches) if (t.statut !== "Terminée" && t.echeance) add("ta", t.echeance, `☐ ${t.titre}`, taLate(t) ? "dn" : "wn", "taEdit", t.id);
  for (const p of db.phases) for (let d = p.date_debut < from ? from : p.date_debut; d <= p.date_fin && d <= to; d = addD(d, 1)) if (dow(d) < 5) add("ph", d, `${p.nom} · ${chNm(p.chantier_id)}`, "ok", "phEdit", p.id);
  for (const f of ouvertes()) if (f.echeance) add("fa", f.echeance, `Encaisser ${f.numero} (${E(f.reste)})`, f.echeance < today() ? "dn" : "ok", "go", `factures/${f.id}`);
  for (const d of db.depenses) if (d.statut === "À payer" && d.echeance) add("de", d.echeance, `Payer ${d.fournisseur} (${E(d.montant_ttc)})`, d.echeance < today() ? "dn" : "wn", "depEdit", d.id);
  if (db.v11) for (const b of db.bcs) if (b.date_livraison && ["Envoyé", "Confirmé", "Reçu partiellement"].includes(b.statut)) add("bc", b.date_livraison, `Livraison ${b.numero} · ${supName(b.fournisseur_id)}`, "bl", "bcOpen", b.id);
  for (const s of db.sts) for (const [k, l] of STDOCS) if (s.actif !== false && s[k]) add("vg", s[k], `${s.nom} : ${l} expire`, "dn", "stOpen", s.id);
  for (const m of db.mat) if (m.prochaine_verification && !["Vendu", "Hors service"].includes(m.statut)) add("ma", m.prochaine_verification, `Vérification ${m.nom}`, "wn", "matOpen", m.id);
  for (const c of db.chantiers) { if (c.date_debut) add("ph", c.date_debut, `Début : ${c.nom}`, "ok", "go", `chantiers/${c.id}`); if (c.date_fin) add("ph", c.date_fin, `Fin prévue : ${c.nom}`, "ok", "go", `chantiers/${c.id}`); }
  return out;
}
function calendrierTab(t) {
  const now = new Date(), cm = ST.calM || { y: now.getFullYear(), m: now.getMonth() }, first = `${cm.y}-${pad2(cm.m + 1)}-01`, start = mondayOf(first), last = urIsoEom(cm.y, cm.m), end = addD(mondayOf(last), 6);
  const items = calItems(start, end), by = {}; items.forEach((i) => (by[i.d] ||= []).push(i));
  const cells = []; for (let d = start; d <= end; d = addD(d, 1)) cells.push(d);
  const off = calSet(), t0 = today();
  const html = `<div class="cal"><div class="cal-h">${["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map((x) => `<div>${x}</div>`).join("")}</div><div class="cal-g">${cells.map((d) => { const L = by[d] || [], inM = +d.slice(5, 7) === cm.m + 1;
    return `<div class="cal-c${inM ? "" : " out"}${d === t0 ? " today" : ""}${dow(d) > 4 ? " we" : ""}" data-act="calDay" data-id="${d}"><b>${+d.slice(8)}</b>${L.slice(0, 3).map((i) => `<span class="cal-i ${i.cls}" title="${esc(i.label)}">${esc(i.label)}</span>`).join("")}${L.length > 3 ? `<span class="cal-m">+${L.length - 3}</span>` : ""}</div>`; }).join("")}</div></div>`;
  return page("Planning", "Calendrier, planning des chantiers et tâches.", btn("Nouvel événement", "evNew", "", "", "w"),
    t + `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px">${btn("‹", "calNav", "", "-1", "o sm")}<strong style="min-width:150px;text-align:center">${MNL[cm.m]} ${cm.y}</strong>${btn("›", "calNav", "", "1", "o sm")}${btn("Aujourd'hui", "calNav", "", "0", "o sm")}</div>` + html +
    `<div style="display:flex;gap:6px 14px;flex-wrap:wrap;margin-top:12px">${Object.entries(CAL_SRC).map(([k, l]) => `<label class="mut" style="display:flex;gap:6px;align-items:center;font-size:13px"><input type="checkbox" data-act="calSrc" data-id="${k}" ${off.has(k) ? "" : "checked"}> ${l}</label>`).join("")}</div>`);
}
const urIsoEom = (y, m) => { const d = new Date(y, m + 1, 0); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
function calDay(d) {
  const L = calItems(d, d);
  modal(D(d), `${L.length ? L.map((i) => `<div class="row lnk" data-act="calOpen" data-id="${i.id}" data-arg="${i.act}" style="cursor:pointer"><span class="chip ${i.cls}">${CAL_SRC[i.src]}</span><div style="flex:1">${esc(i.label)}</div></div>`).join("") : `<p class="mut" style="margin:0">Rien de prévu ce jour.</p>`}
    <div style="display:flex;gap:8px;margin-top:14px">${btn("Ajouter un événement", "evNew", "", d, "w")}${btn("Ajouter une tâche", "taNew", "", d, "o w")}</div>`, { submit: false });
}

/* ---------- Planning des chantiers (Gantt) ---------- */
function phaseForm(p, pre = {}) {
  if (!guard()) return;
  const v0 = { ...pre, ...(p || {}) };
  modal(p ? "Modifier la phase" : "Nouvelle phase de chantier", `<div class="frm">${fld({ k: "chantier_id", l: "Chantier", t: "select", o: db.chantiers.map((c) => ({ v: c.id, l: c.nom })), v: v0.chantier_id || db.chantiers[0]?.id || "", cls: "full" })}
    ${fld({ k: "nom", l: "Phase (ex. Démolition, Électricité, Peinture)", v: v0.nom, cls: "full" })}
    ${fld({ k: "date_debut", l: "Début", t: "date", v: v0.date_debut || today() })}${fld({ k: "date_fin", l: "Fin", t: "date", v: v0.date_fin || addD(today(), 4) })}
    ${fld({ k: "avancement", l: "Avancement (%)", t: "number", v: String(v0.avancement ?? 0), r: 0 })}${fld({ k: "equipe", l: "Équipe / intervenant", v: v0.equipe || "", r: 0 })}
    ${db.sts.length ? fld({ k: "sous_traitant_id", l: "Sous-traitant", t: "select", o: [{ v: "", l: "Aucun (en direct)" }, ...db.sts.map((s) => ({ v: s.id, l: s.nom }))], v: v0.sous_traitant_id || "", r: 0, cls: "full" }) : ""}</div>`, {
    onSubmit: async (v, api) => {
      if (v.date_fin < v.date_debut) throw new Error("La fin ne peut pas précéder le début.");
      const row = { chantier_id: v.chantier_id, nom: v.nom.trim(), date_debut: v.date_debut, date_fin: v.date_fin, avancement: Math.min(100, Math.max(0, Math.round(parseNum(v.avancement) || 0))), equipe: v.equipe || null, sous_traitant_id: v.sous_traitant_id || null };
      if (p) await q(sb.from("planning_phases").update(row).eq("id", p.id)); else await q(sb.from("planning_phases").insert(row));
      api.close(); toast("Phase enregistrée.", "ok"); await refresh();
    }, extra: p ? btn("Supprimer", "phDel", p.id, "", "lk dn") : "" });
}
function planningTab(t) {
  const span = 12 * 7, start = ST.plStart || mondayOf(addD(today(), -7)), end = addD(start, span - 1), f = ST.plCh || "";
  const pos = (a, b) => { const A = Math.max(0, daysBetween(start, a)), B = Math.min(span, daysBetween(start, b) + 1); return B <= A ? null : [(A / span) * 100, ((B - A) / span) * 100]; };
  const wk = []; for (let i = 0; i < 12; i++) wk.push(addD(start, i * 7));
  const chs = db.chantiers.filter((c) => (!f || c.id === f) && (db.phases.some((p) => p.chantier_id === c.id) || (c.date_debut && c.date_fin)));
  const rows = chs.map((c) => { const ps = db.phases.filter((p) => p.chantier_id === c.id);
    const head = `<div class="gt-r gt-ch"><div class="gt-l"><a href="#/chantiers/${c.id}">${esc(c.nom)}</a></div><div class="gt-t">${c.date_debut && c.date_fin ? (() => { const p = pos(c.date_debut, c.date_fin); return p ? `<span class="gt-b gt-m" style="left:${p[0]}%;width:${p[1]}%"></span>` : ""; })() : ""}</div></div>`;
    return head + ps.map((p) => { const q2 = pos(p.date_debut, p.date_fin), st = byId(db.sts, p.sous_traitant_id), late = p.date_fin < today() && p.avancement < 100;
      return `<div class="gt-r"><div class="gt-l" data-act="phEdit" data-id="${p.id}" style="cursor:pointer">${esc(p.nom)}<small>${esc(st ? st.nom : p.equipe || "")}</small></div><div class="gt-t">${q2 ? `<span class="gt-b${late ? " late" : ""}" data-act="phEdit" data-id="${p.id}" style="left:${q2[0]}%;width:${q2[1]}%" title="${esc(p.nom)} · ${D(p.date_debut)} → ${D(p.date_fin)} · ${p.avancement} %"><i style="width:${p.avancement}%"></i><em>${p.avancement}%</em></span>` : ""}</div></div>`; }).join(""); }).join("");
  const tp = pos(today(), today());
  return page("Planning", "Calendrier, planning des chantiers et tâches.", btn("Nouvelle phase", "phNew", "", f, "w"),
    t + `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px">${btn("‹", "plNav", "", "-4", "o sm")}${btn("Aujourd'hui", "plNav", "", "0", "o sm")}${btn("›", "plNav", "", "4", "o sm")}
      <select data-chg="plCh" aria-label="Chantier" style="max-width:240px">${chOpts("Tous les chantiers").map((o) => `<option value="${o.v}" ${o.v === f ? "selected" : ""}>${esc(o.l)}</option>`).join("")}</select><span class="mut">${D(start)} → ${D(end)}</span></div>` +
    (chs.length ? `<div class="gt"><div class="gt-r gt-hd"><div class="gt-l"></div><div class="gt-t">${wk.map((d) => `<span class="gt-w">${D(d).slice(0, 5)}</span>`).join("")}${tp ? `<span class="gt-today" style="left:${tp[0]}%"></span>` : ""}</div></div>${rows}</div>` :
      card("", `<div class="empty" style="padding:30px 20px"><h2>Aucun planning</h2><p style="max-width:520px;margin:6px auto 14px">Découpez un chantier en phases (démolition, électricité, peinture…) avec leurs dates : elles s'affichent ici et dans le calendrier. Les dates de début et de fin du chantier apparaissent aussi.</p>${btn("Créer une phase", "phNew", "", "", "w")}</div>`)) +
    `<p class="note">Cliquez sur une barre pour modifier la phase. Barre rouge : phase dont la date de fin est dépassée sans être terminée.</p>`);
}

/* ---------- Page Planning ---------- */
const PL_TABS = [["calendrier", "Calendrier"], ["planning", "Planning chantiers"], ["taches", "Tâches"]];
V.planning = () => {
  const tab = ST.tab.planning || "calendrier", t = tabs("planning", PL_TABS, tab);
  if (!db.v12) return page("Planning", "Calendrier, planning des chantiers et tâches.", "", t + card("", setupV12()));
  return tab === "taches" ? tachesTab(t) : tab === "planning" ? planningTab(t) : calendrierTab(t);
};

/* ---------- Carte sur la fiche chantier ---------- */
function chPlanCard(id) {
  if (!db.v12) return "";
  const ph = db.phases.filter((p) => p.chantier_id === id), ta = db.taches.filter((x) => x.chantier_id === id && x.statut !== "Terminée").slice(0, 6), av = ph.length ? Math.round(sum(ph, (p) => (p.avancement * (daysBetween(p.date_debut, p.date_fin) + 1))) / sum(ph, (p) => daysBetween(p.date_debut, p.date_fin) + 1)) : null;
  return card(`Planning${av !== null ? ` <span class="mut" style="font-weight:400">· ${av} % d'avancement</span>` : ""}`,
    (ph.length ? ph.map((p) => `<div class="row lnk" data-act="phEdit" data-id="${p.id}"><div><b>${esc(p.nom)}</b><small>${D(p.date_debut)} → ${D(p.date_fin)}${p.equipe ? " · " + esc(p.equipe) : ""}</small></div><span class="num">${p.avancement} %</span></div>`).join("") : `<p class="mut" style="margin:0;padding:12px 18px">Aucune phase planifiée.</p>`) +
    ta.map((x) => `<div class="row lnk" data-act="taEdit" data-id="${x.id}"><div><b>☐ ${esc(x.titre)}</b><small>${x.echeance ? D(x.echeance) : "sans échéance"}${x.assigne ? " · " + esc(x.assigne) : ""}</small></div>${taLate(x) ? `<span class="chip dn">En retard</span>` : ""}</div>`).join(""),
    btn("Phase", "phNew", "", id, "o sm w") + btn("Tâche", "taNew", "", "chantier:" + id, "o sm w"));
}

function planPriorites(add, t) {
  if (!db.v12) return;
  for (const x of db.taches) if (taLate(x)) add(x.priorite === "Urgente" || x.priorite === "Haute" ? "u" : "i", 200 + Math.min(daysBetween(x.echeance, t), 60), `Tâche en retard : ${x.titre}`, `Échéance ${D(x.echeance)}${x.chantier_id ? " · " + chNm(x.chantier_id) : ""}`, 0, { label: "Ouvrir", act: "taEdit", id: x.id }, "planning");
  for (const p of db.phases) if (p.date_fin < t && p.avancement < 100) add("i", 140, `Phase en retard : ${p.nom}`, `${chNm(p.chantier_id)} · prévue jusqu'au ${D(p.date_fin)} · ${p.avancement} %`, 0, { label: "Ouvrir", act: "phEdit", id: p.id }, "planning");
}

const planningActions = {
  taNew: (id, arg) => { const pre = {}; if (/^\d{4}-/.test(arg || "")) pre.echeance = arg; else if ((arg || "").startsWith("chantier:")) pre.chantier_id = arg.slice(9); document.querySelectorAll(".md").forEach((m) => m.remove()); tacheForm(null, pre); },
  taEdit: (id) => tacheForm(byId(db.taches, id)),
  taDone: async (id) => { if (!guard()) return render(true); const x = byId(db.taches, id), done = x.statut !== "Terminée"; await q(sb.from("taches").update({ statut: done ? "Terminée" : "À faire", termine_le: done ? today() : null }).eq("id", id)); await refresh(); },
  taFilter: (id, arg) => { ST.taF = arg; render(true); },
  evNew: (id, arg) => { document.querySelectorAll(".md").forEach((m) => m.remove()); evenementForm(null, /^\d{4}-/.test(arg || "") ? { date_debut: arg } : {}); },
  evEdit: (id) => evenementForm(byId(db.evts, id)),
  evDel: async (id) => { if (!guard() || !confirm("Supprimer cet événement ?")) return; await q(sb.from("evenements").delete().eq("id", id)); document.querySelectorAll(".md").forEach((m) => m.remove()); await refresh(); },
  phNew: (id, arg) => phaseForm(null, arg ? { chantier_id: arg } : {}),
  phEdit: (id) => phaseForm(byId(db.phases, id)),
  phDel: async (id) => { if (!guard() || !confirm("Supprimer cette phase ?")) return; await q(sb.from("planning_phases").delete().eq("id", id)); document.querySelectorAll(".md").forEach((m) => m.remove()); await refresh(); },
  calNav: (id, arg) => { const n = new Date(), c = ST.calM || { y: n.getFullYear(), m: n.getMonth() }; if (arg === "0") ST.calM = { y: n.getFullYear(), m: n.getMonth() }; else { const d = new Date(c.y, c.m + Number(arg), 1); ST.calM = { y: d.getFullYear(), m: d.getMonth() }; } render(true); },
  calSrc: (id) => { const s = calSet(); s.has(id) ? s.delete(id) : s.add(id); render(true); },
  calDay: (id) => calDay(id),
  calOpen: (id, arg) => { document.querySelectorAll(".md").forEach((m) => m.remove()); if (arg === "go") return go(id); ACT[arg](id); },
  plNav: (id, arg) => { ST.plStart = arg === "0" ? undefined : addD(ST.plStart || mondayOf(addD(today(), -7)), Number(arg) * 7); render(true); },
  plCh: (id) => { ST.plCh = id || ""; render(true); },
};
