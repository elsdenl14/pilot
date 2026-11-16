/* Aide à la déclaration URSSAF (micro-entrepreneur) : CA encaissé par période, cotisations estimées, échéances, suivi des déclarations, seuils.
   Estimation d'aide : la déclaration elle-même se fait sur autoentrepreneur.urssaf.fr. Taux et seuils modifiables (Paramètres de l'aide). */

const UR_ACT = {
  vente: { l: "Vente de marchandises (BIC)", taux: 12.3, acre: 6.2, vl: 1, plafond: 203100, tva: 91900 },
  prestations_bic: { l: "Prestations de services commerciales ou artisanales (BIC)", taux: 21.2, acre: 10.6, vl: 1.7, plafond: 83600, tva: 39100 },
  bnc: { l: "Prestations de services libérales (BNC)", taux: 21.1, acre: 10.6, vl: 2.2, plafond: 83600, tva: 39100 },
};
const urOn = () => !!(db.v11 && db.ent?.urssaf_actif);
const urAct = () => UR_ACT[db.ent.urssaf_activite] || UR_ACT.prestations_bic;
const urOpt = () => db.ent.urssaf_options || {};
function urRates() {
  const a = urAct(), o = urOpt(), cot = o.taux ?? (db.ent.urssaf_acre ? a.acre : a.taux), vl = db.ent.urssaf_liberatoire ? (o.vl ?? a.vl) : 0;
  return { cot, vl, tot: cot + vl, plafond: o.plafond ?? a.plafond, tva: o.seuil_tva ?? a.tva };
}
const urIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const urEom = (y, m) => urIso(new Date(y, m + 1, 0)); // dernier jour du mois m (0-11)

/* Périodes : mensuelles ou trimestrielles, avec échéance de déclaration */
function urPeriod(iso) {
  const y = +iso.slice(0, 4), m = +iso.slice(5, 7) - 1, mensuel = db.ent.urssaf_periodicite === "mensuelle";
  if (mensuel) return { deb: urIso(new Date(y, m, 1)), fin: urEom(y, m), lab: `${MNL[m]} ${y}`, due: urEom(m === 11 ? y + 1 : y, (m + 1) % 12) };
  const q = Math.floor(m / 3), due = [`${y}-04-30`, `${y}-07-31`, `${y}-10-31`, `${y + 1}-01-31`][q];
  return { deb: urIso(new Date(y, q * 3, 1)), fin: urEom(y, q * 3 + 2), lab: `T${q + 1} ${y}`, due };
}
function urPrev(p) { const d = new Date(p.deb + "T12:00:00"); d.setDate(0); return urPeriod(urIso(d)); }

/* CA encaissé HT : chaque paiement est ramené au HT au prorata de sa facture */
function urEnc() {
  return db.paiements.map((p) => {
    const f = db.factures.find((x) => x.id === p.facture_id), ratio = f && f.montant_ttc > 0 ? f.montant_ht / f.montant_ttc : 1;
    return { date: p.date_paiement, facture: p.facture_numero || f?.numero || "", client: p.client_nom || f?.client_nom || "", ttc: Number(p.montant) || 0, ht: r2((Number(p.montant) || 0) * ratio) };
  });
}
const urCa = (enc, deb, fin) => r2(sum(enc.filter((e) => e.date >= deb && e.date <= fin), (e) => e.ht));
const urDecl = (deb) => (db.urs || []).find((u) => u.periode_debut === deb);

function urPeriodsList() {
  const t = today(), cur = urPeriod(t), list = [cur], first = db.ent.urssaf_debut || db.paiements.map((p) => p.date_paiement).filter(Boolean).sort()[0] || null, start = first ? urPeriod(first).deb : null;
  let p = cur;
  for (let i = 0; i < 7; i++) { p = urPrev(p); if (start && p.fin < start) break; list.push(p); }
  return list;
}
function urCalc() {
  const enc = urEnc(), R = urRates(), t = today(), y = t.slice(0, 4);
  const periods = urPeriodsList().map((p) => {
    const ca = urCa(enc, p.deb, p.fin), cot = r2((ca * R.tot) / 100), d = urDecl(p.deb), fini = p.fin < t;
    const late = fini && p.due < t && !d, soon = fini && !d && daysBetween(t, p.due) <= 15 && !late;
    return { ...p, ca, cot, d, fini, late, soon, st: d ? d.statut : late ? "En retard" : fini ? "À déclarer" : "En cours" };
  });
  const caY = urCa(enc, `${y}-01-01`, `${y}-12-31`);
  return { enc, R, periods, caY, cotY: r2((caY * R.tot) / 100) };
}

/* ---------- Onglet Comptabilité > URSSAF ---------- */
function urssafTab(t) {
  if (!db.v11) return page("Comptabilité", "Aide à la déclaration URSSAF.", "", t + card("", setupV11()));
  if (!urOn()) return page("Comptabilité", "Aide à la déclaration URSSAF (micro-entrepreneur).", "", t + card("Aide à la déclaration URSSAF",
    `<div class="cb"><p style="margin:0 0 10px">Pilot calcule votre chiffre d'affaires encaissé à déclarer, estime vos cotisations, vous rappelle les échéances et suit vos déclarations. Réservé aux micro-entrepreneurs.</p>${btn("Activer et paramétrer", "urSettings", "", "", "w")}</div>`));
  const c = urCalc(), A = urAct(), o = c.R;
  const cur = c.periods[0], next = c.periods.find((p) => p.fini && !p.d) || cur, pPl = o.plafond ? (c.caY / o.plafond) * 100 : 0, pTva = o.tva ? (c.caY / o.tva) * 100 : 0;
  const alerts = [];
  if (pPl >= 80) alerts.push([pPl >= 100 ? "dn" : "wn", `Plafond micro-entreprise : ${Math.round(pPl)} % atteint (${E(c.caY)} sur ${E(o.plafond)}). ${pPl >= 100 ? "Vous dépassez le plafond : voyez votre expert-comptable." : "Surveillez votre chiffre d'affaires."}`]);
  if (pTva >= 80) alerts.push([pTva >= 100 ? "dn" : "wn", `Franchise de TVA : ${Math.round(pTva)} % du seuil (${E(o.tva)}). ${pTva >= 100 ? "Le seuil est atteint : la TVA peut devenir due, vérifiez avec le service des impôts." : "Au-delà, vous deviendrez redevable de la TVA."}`]);
  if (!db.ent.urssaf_debut) alerts.push(["n", "Renseignez votre date de début d'activité dans les paramètres de l'aide pour limiter l'historique aux périodes réelles."]);
  const rows = c.periods.map((p) => ({ c: [`<strong>${esc(p.lab)}</strong>`, p.late ? `<span class="chip dn">${D(p.due)} · dépassée</span>` : p.soon ? `<span class="chip wn">${D(p.due)}</span>` : D(p.due), `<span class="num">${E2(p.d ? p.d.ca_declare : p.ca)}</span>`, `<span class="num">${E2(p.d ? p.d.cotisations : p.cot)}</span>`, chip(p.st),
    `<span class="r">${btn("Détail", "urDetail", p.deb, "", "lk")}${p.fini && !p.d ? btn("J'ai déclaré", "urDeclare", p.deb, "", "sm w") : ""}${p.d && p.d.statut === "Déclaré" ? btn("Payée", "urPaid", p.d.id, "", "sm w") : ""}${p.d ? btn("Annuler", "urUndo", p.d.id, "", "lk w") : ""}</span>`] }));
  return page("Comptabilité", "Votre chiffre d'affaires encaissé à déclarer à l'URSSAF, et les cotisations à prévoir.", btn("Paramètres de l'aide", "urSettings", "", "", "o"),
    t + strip([[`CA encaissé ${new Date().getFullYear()}`, E(c.caY), `plafond ${E(o.plafond)} · ${Math.round(pPl)} %`, pPl >= 100 ? "dn" : ""], ["Cotisations estimées (année)", E(c.cotY), `taux ${String(o.tot).replace(".", ",")} %${db.ent.urssaf_liberatoire ? " (dont versement libératoire)" : ""}`],
      [`À déclarer : ${next.lab}`, E(next.ca), `échéance ${D(next.due)}`, next.late ? "dn" : ""], ["Cotisations à prévoir", E(next.cot), `période ${next.lab}`]]) +
    (alerts.length ? card("À surveiller", alerts.map(([k, m]) => `<div class="row"><span class="chip ${k}">${k === "dn" ? "Important" : k === "wn" ? "Attention" : "Info"}</span><div style="flex:1">${esc(m)}</div></div>`).join("")) : "") +
    card("Déclarations par période", tbl(["Période", "Échéance", { h: "CA à déclarer", r: 1 }, { h: "Cotisations", r: 1 }, "Statut", ""], rows)) +
    card("Comment déclarer", `<div class="cb"><ol style="margin:0;padding-left:18px;line-height:1.7"><li>Connectez-vous sur <b>autoentrepreneur.urssaf.fr</b> avant l'échéance.</li><li>Choisissez la période et saisissez le chiffre d'affaires de la colonne « CA à déclarer » (activité : ${esc(A.l)}). Saisissez 0 s'il n'y a rien eu.</li><li>Réglez le montant calculé par le site, puis cliquez sur « J'ai déclaré » ici pour garder la trace.</li></ol></div>
      <p class="note">Le CA est celui <b>encaissé</b> (paiements reçus) ramené en HT. C'est une estimation : le montant exact est calculé par l'URSSAF. Les taux et seuils sont modifiables dans les paramètres : vérifiez-les sur autoentrepreneur.urssaf.fr, ils changent selon les années.</p>`));
}

function urDetail(deb) {
  const p = urPeriod(deb), enc = urEnc().filter((e) => e.date >= p.deb && e.date <= p.fin).sort((a, b) => a.date.localeCompare(b.date));
  modal(`CA encaissé · ${esc(p.lab)}`, `<div class="tw"><table><thead><tr><th>Date</th><th>Facture</th><th>Client</th><th class="r">TTC</th><th class="r">HT</th></tr></thead><tbody>${enc.map((e) => `<tr><td>${D(e.date)}</td><td>${esc(e.facture)}</td><td>${esc(e.client)}</td><td class="r"><span class="num">${E2(e.ttc)}</span></td><td class="r"><span class="num">${E2(e.ht)}</span></td></tr>`).join("") || `<tr><td colspan="5" class="emp">Aucun encaissement sur cette période.</td></tr>`}</tbody>
    <tfoot><tr class="tot"><td colspan="4">Total à déclarer (HT)</td><td class="r"><span class="num">${E2(sum(enc, (e) => e.ht))}</span></td></tr></tfoot></table></div>`, { submit: "Exporter en CSV", cancel: "Fermer",
    onSubmit: async (v, api) => { csvDl(`urssaf-${slug(p.lab)}.csv`, ["Date", "Facture", "Client", "TTC", "HT"], enc.map((e) => [e.date, e.facture, e.client, e.ttc, e.ht])); api.close(); } });
}

function urDeclare(deb) {
  if (!guard()) return;
  const c = urCalc(), p = c.periods.find((x) => x.deb === deb);
  modal(`Déclaration · ${esc(p.lab)}`, `<p class="mut" style="margin:0 0 10px">Reportez ici ce que vous avez réellement déclaré sur le site de l'URSSAF.</p><div class="frm">
    ${fld({ k: "ca_declare", l: "CA déclaré (€)", t: "number", v: String(p.ca).replace(".", ",") })}${fld({ k: "cotisations", l: "Cotisations à payer (€)", t: "number", v: String(p.cot).replace(".", ","), hint: "Montant indiqué par le site." })}
    ${fld({ k: "declare_le", l: "Déclaré le", t: "date", v: today() })}${fld({ k: "notes", l: "Notes", r: 0 })}
    <label class="chk full" style="display:flex;gap:8px"><input type="checkbox" name="paye"> <span>Cotisations déjà payées</span></label></div>`, {
    onSubmit: async (v, api) => {
      const ca = parseNum(v.ca_declare), cot = parseNum(v.cotisations);
      if (ca < 0 || cot < 0) throw new Error("Les montants ne peuvent pas être négatifs.");
      await q(sb.from("urssaf_declarations").upsert({ periode_debut: p.deb, periode_fin: p.fin, ca_calcule: p.ca, ca_declare: ca, cotisations: cot, statut: v.paye ? "Payé" : "Déclaré", declare_le: v.declare_le, paye_le: v.paye ? today() : null, notes: v.notes || null }, { onConflict: "user_id,periode_debut" }));
      api.close(); toast("Déclaration enregistrée.", "ok"); await refresh();
    } });
}

function urSettings() {
  if (!guard()) return;
  const e = db.ent, o = urOpt(), a = urAct(), n = (x) => (x == null ? "" : String(x).replace(".", ","));
  modal("Aide à la déclaration URSSAF", `<div class="frm">
    <label class="chk full" style="display:flex;gap:8px"><input type="checkbox" name="actif" ${e.urssaf_actif ? "checked" : ""}> <span>Activer l'aide (micro-entrepreneur)</span></label>
    ${fld({ k: "activite", l: "Activité", t: "select", o: Object.entries(UR_ACT).map(([v, x]) => ({ v, l: x.l })), v: e.urssaf_activite || "prestations_bic", cls: "full" })}
    ${fld({ k: "periodicite", l: "Fréquence de déclaration", t: "select", o: [{ v: "trimestrielle", l: "Trimestrielle" }, { v: "mensuelle", l: "Mensuelle" }], v: e.urssaf_periodicite || "trimestrielle" })}
    ${fld({ k: "debut", l: "Début d'activité", t: "date", v: e.urssaf_debut || "", r: 0 })}
    <label class="chk" style="display:flex;gap:8px"><input type="checkbox" name="acre" ${e.urssaf_acre ? "checked" : ""}> <span>Je bénéficie de l'ACRE</span></label>
    <label class="chk" style="display:flex;gap:8px"><input type="checkbox" name="liberatoire" ${e.urssaf_liberatoire ? "checked" : ""}> <span>Versement libératoire de l'impôt</span></label>
    <div class="sect-t">Taux et seuils (à vérifier sur autoentrepreneur.urssaf.fr)</div>
    ${fld({ k: "taux", l: "Taux de cotisations (%)", t: "number", v: n(o.taux), r: 0, hint: `Laissez vide pour le taux par défaut (${String(e.urssaf_acre ? a.acre : a.taux).replace(".", ",")} %).` })}
    ${fld({ k: "vl", l: "Taux versement libératoire (%)", t: "number", v: n(o.vl), r: 0, hint: `Par défaut ${String(a.vl).replace(".", ",")} %.` })}
    ${fld({ k: "plafond", l: "Plafond de CA (€)", t: "number", v: n(o.plafond), r: 0, hint: `Par défaut ${E(a.plafond)}.` })}
    ${fld({ k: "seuil_tva", l: "Seuil franchise de TVA (€)", t: "number", v: n(o.seuil_tva), r: 0, hint: `Par défaut ${E(a.tva)}.` })}</div>`, {
    wide: true,
    onSubmit: async (v, api) => {
      const num = (x) => (String(x || "").trim() === "" ? undefined : parseNum(x)), opts = {};
      for (const [k, key] of [["taux", "taux"], ["vl", "vl"], ["plafond", "plafond"], ["seuil_tva", "seuil_tva"]]) { const x = num(v[key]); if (x !== undefined) { if (x < 0) throw new Error("Valeur négative impossible."); opts[k] = x; } }
      await entPatch({ urssaf_actif: "actif" in v, urssaf_activite: v.activite, urssaf_periodicite: v.periodicite, urssaf_debut: v.debut || null, urssaf_acre: "acre" in v, urssaf_liberatoire: "liberatoire" in v, urssaf_options: opts });
      api.close(); toast("Paramètres enregistrés.", "ok"); await refresh();
    } });
}

function urssafPriorites(add, t) {
  if (!urOn()) return;
  for (const p of urCalc().periods) {
    if (p.d || !p.fini) continue;
    const n = daysBetween(t, p.due);
    if (n < 0) add("u", 260 + Math.min(-n, 60), `Déclaration URSSAF en retard : ${p.lab}`, `Échéance dépassée le ${D(p.due)} · CA encaissé ${E2(p.ca)}`, p.cot, { label: "Ouvrir", act: "urTab" }, "compta");
    else if (n <= 15) add("i", 150 - n, `Déclaration URSSAF à faire : ${p.lab}`, `À déclarer avant le ${D(p.due)} · CA encaissé ${E2(p.ca)}`, p.cot, { label: "Ouvrir", act: "urTab" }, "compta");
  }
}

const urssafActions = {
  urSettings, urTab: () => { ST.tab.compta = "urssaf"; return go("compta"); },
  urDetail: (id) => urDetail(id), urDeclare: (id) => urDeclare(id),
  urPaid: async (id) => { if (!guard()) return; await q(sb.from("urssaf_declarations").update({ statut: "Payé", paye_le: today() }).eq("id", id)); toast("Marquée payée.", "ok"); await refresh(); },
  urUndo: async (id) => { if (!guard() || !confirm("Annuler cet enregistrement de déclaration ?")) return; await q(sb.from("urssaf_declarations").delete().eq("id", id)); await refresh(); },
};
