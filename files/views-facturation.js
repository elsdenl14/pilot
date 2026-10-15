/* Facturation BTP : acomptes, situations (par poste ou par ligne), facture finale, retenue de garantie, prime énergétique,
   compte prorata, escompte, postes libres, avoirs.
   Principe : chaque facture porte le montant de SA période (les totaux HT / TVA / TTC de la base restent donc justes, sans double compte).
   Retenue, prime, prorata et escompte se déduisent du TTC pour donner le « net à payer » : ils ne sont jamais enregistrés comme des paiements. */

const FX_NAT = { Facture: "Facture", Acompte: "Facture d'acompte", Situation: "Facture de situation", "Situation détaillée": "Situation détaillée", Finale: "Facture finale", Avoir: "Avoir" };
const fdOf = (id) => (db.fd || {})[id];
const fxNat = (f) => fdOf(f.id)?.nature || "Facture";
const fxLabel = (f) => {
  const d = fdOf(f.id), n = d?.nature || "Facture";
  return (FX_NAT[n] || "Facture") + ((n === "Situation" || n === "Situation détaillée") && d.situation_no ? ` n° ${d.situation_no}` : "");
};
const fxIsAvoir = (f) => fxNat(f) === "Avoir";

async function loadV8() {
  const rows = await q(sb.from("factures_details").select("*"));
  rows.forEach((r) => nz(r, ["marche_ht", "acompte_pct", "retenue_pct", "prime_montant", "prorata_pct", "prorata_montant", "escompte_pct", "escompte_jours", "situation_no"]));
  db.fd = Object.fromEntries(rows.map((r) => [r.facture_id, r]));
  fxAdjust();
}
const setupV8 = (what = "la facturation BTP") =>
  `<p class="emp" style="padding:18px;margin:0;color:var(--mut)">Pour activer ${what}, exécutez <b>migration_v8.sql</b> dans Supabase (SQL Editor), puis rechargez la page.${db.v8err ? `<br><br>Erreur renvoyée par Supabase : <code>${esc(db.v8err)}</code>` : ""}</p>`;

/* ---------- Calculs : déductions et net à payer ---------- */
function fxCalc(f) {
  const d = fdOf(f.id) || {};
  const ttc = Number(f.montant_ttc) || 0, ht = Number(f.montant_ht) || 0, pos = ttc > 0 && d.nature !== "Avoir";
  const caution = !!d.retenue_caution;
  const retenue = pos && !caution ? r2((ttc * (d.retenue_pct || 0)) / 100) : 0;
  const prime = pos ? r2(Math.min(d.prime_montant || 0, ttc)) : 0;
  const prorata = pos ? r2(Math.min(ttc, d.prorata_montant > 0 ? d.prorata_montant : (ht * (d.prorata_pct || 0)) / 100)) : 0;
  const net = r2(ttc - retenue - prime - prorata);
  const escompte = pos && d.escompte_pct > 0 && d.escompte_jours > 0 ? r2((net * d.escompte_pct) / 100) : 0;
  const limite = escompte && f.date_emission ? addDays(String(f.date_emission).slice(0, 10), d.escompte_jours) : "";
  return { ttc, ht, retenue, caution, retenuePct: d.retenue_pct || 0, prime, primeLib: d.prime_libelle || "", prorata, prorataPct: d.prorata_pct || 0, net, escompte, escomptePct: d.escompte_pct || 0, limite, netEsc: r2(net - escompte), any: retenue + prime + prorata + escompte > 0 || (caution && (d.retenue_pct || 0) > 0) };
}
// Recalcule « reste dû » et le statut affiché, en tenant compte des déductions, de la retenue non libérée et des avoirs
function fxAdjust() {
  const avoirs = {};
  for (const f of db.factures) {
    const d = fdOf(f.id);
    if (d?.nature === "Avoir" && d.parent_id && f.statut !== "Brouillon" && f.statut !== "Annulée") avoirs[d.parent_id] = r2((avoirs[d.parent_id] || 0) - f.montant_ttc);
  }
  for (const f of db.factures) {
    const d = fdOf(f.id), c = fxCalc(f);
    f.fx = c; f.avoirs = avoirs[f.id] || 0;
    if (!d && !f.avoirs) continue;
    if (d?.nature === "Avoir") {
      f.reste = 0;
      if (f.statut !== "Brouillon" && f.statut !== "Annulée") f.statut_affiche = "Avoir";
      continue;
    }
    if (f.statut === "Brouillon" || f.statut === "Annulée") continue;
    let due = c.net - f.avoirs + (d?.retenue_liberee_le ? c.retenue : 0) + (d?.prime_recue_le ? c.prime : 0);
    if (c.escompte > 0) {
      const inTime = sum(db.paiements.filter((p) => p.facture_id === f.id && String(p.date_paiement).slice(0, 10) <= c.limite), (p) => p.montant);
      if (inTime >= due - c.escompte - 0.005) { due = r2(due - c.escompte); f.escompteAppliquee = true; }
    }
    f.due = r2(due);
    f.reste = r2(Math.max(0, due - (f.paye || 0)));
    if (f.reste <= 0.005) f.statut_affiche = f.avoirs > 0 && !(f.paye > 0) ? "Soldée" : "Payée";
  }
}
const fxPending = () => {
  const out = [];
  for (const f of db.factures) {
    const d = fdOf(f.id);
    if (!d || ["Brouillon", "Annulée"].includes(f.statut) || d.nature === "Avoir") continue;
    if (f.fx.retenue > 0 && !d.retenue_liberee_le) out.push({ f, kind: "retenue", montant: f.fx.retenue, date: d.retenue_date });
    if (f.fx.prime > 0 && !d.prime_recue_le) out.push({ f, kind: "prime", montant: f.fx.prime, label: f.fx.primeLib });
  }
  return out;
};

/* ---------- Devis : ce qui est déjà facturé ---------- */
const fxLinked = (did) => db.factures.filter((f) => (fdOf(f.id)?.devis_id === did || f.devis_id === did) && f.statut !== "Annulée");
const fxBilledHt = (did) => r2(sum(fxLinked(did), (f) => f.montant_ht));
const fxResteDevis = (d) => (fxLinked(d.id).length ? r2(d.montant_ht - fxBilledHt(d.id)) : d.montant_ht);
const fxRates = (lignes, d) => Object.entries(totauxParTaux(lignes, d)).map(([taux, v]) => ({ taux: Number(taux), ht: r2(v.ht) })).filter((x) => Math.abs(x.ht) > 0.004);

/* ---------- Formulaire des déductions (retenue, prime, prorata, escompte) ---------- */
function fxAdjFields(d = {}) {
  const f = (k, l, v, o = {}) => fld({ k, l, t: "number", v: v ? String(v).replace(".", ",") : "", r: 0, ...o });
  return `<div class="full sect-t" style="margin-top:6px">Retenues et déductions (facultatif)</div>
    ${f("aj_ret", "Retenue de garantie (%)", d.retenue_pct, { hint: "5 % maximum (loi du 16 juillet 1971). Libérable un an après la réception." })}
    ${fld({ k: "aj_cau", l: "Retenue remplacée par une caution bancaire", t: "select", o: [{ v: "non", l: "Non, je retiens la somme" }, { v: "oui", l: "Oui, caution bancaire" }], v: d.retenue_caution ? "oui" : "non", r: 0 })}
    ${fld({ k: "aj_retd", l: "Libération prévue le", t: "date", v: d.retenue_date || "", r: 0 })}<span></span>
    ${f("aj_prime", "Prime énergétique déduite (€ TTC)", d.prime_montant, { hint: "MaPrimeRénov', CEE… : le client ne la paie pas, vous la percevez." })}
    ${fld({ k: "aj_primel", l: "Nom de la prime", v: d.prime_libelle || "", r: 0, ph: "MaPrimeRénov', prime CEE…" })}
    ${f("aj_pro", "Compte prorata (% du HT)", d.prorata_pct)}${f("aj_proe", "ou montant fixe du prorata (€)", d.prorata_montant)}
    ${f("aj_esc", "Escompte pour paiement anticipé (%)", d.escompte_pct)}${fld({ k: "aj_escj", l: "Si payé sous (jours)", t: "number", v: d.escompte_jours || "", r: 0 })}`;
}
function fxReadAdj(v) {
  const a = {
    retenue_pct: parseNum(v.aj_ret), retenue_caution: v.aj_cau === "oui", retenue_date: v.aj_retd || null,
    prime_montant: parseNum(v.aj_prime), prime_libelle: (v.aj_primel || "").trim() || null,
    prorata_pct: parseNum(v.aj_pro), prorata_montant: parseNum(v.aj_proe),
    escompte_pct: parseNum(v.aj_esc), escompte_jours: parseInt(v.aj_escj) || 0,
  };
  if (a.retenue_pct < 0 || a.retenue_pct > 5) throw new Error("La retenue de garantie ne peut pas dépasser 5 % du marché (loi du 16 juillet 1971).");
  if (a.prime_montant < 0 || a.prorata_pct < 0 || a.prorata_pct > 100 || a.prorata_montant < 0) throw new Error("Vérifiez les montants de prime et de compte prorata.");
  if (a.escompte_pct < 0 || a.escompte_pct > 100 || (a.escompte_pct > 0 && a.escompte_jours < 1)) throw new Error("Escompte : indiquez le pourcentage et le délai en jours.");
  return a;
}

/* ---------- Écritures ---------- */
async function fxSaveLines(fid, ls) {
  const rows = await q(sb.from("factures_lignes").select("id").eq("facture_id", fid).order("position"));
  await Promise.all(rows.map((r, i) => (ls[i] ? q(sb.from("factures_lignes").update({ categorie: ls[i].categorie || null, description: ls[i].description || null, nature: ls[i].nature || "normale", ref_facture_id: ls[i].ref_facture_id || null }).eq("id", r.id)) : null)));
}
async function fxSaveDetails(fid, patch) {
  await q(sb.from("factures_details").upsert({ facture_id: fid, ...patch }, { onConflict: "facture_id" }));
}
async function fxDraft({ id = null, client_id, chantier_id, date, echeance, notes, lignes, devis_id, details }) {
  const fid = await q(sb.rpc("sauver_document", { p_kind: "facture", p: { id, client_id, chantier_id: chantier_id || null, date, notes: notes || null, echeance, lignes } }));
  await fxSaveLines(fid, lignes);
  await fxSaveDetails(fid, { devis_id: devis_id || null, ...details });
  if (devis_id) { try { await sb.from("factures").update({ devis_id }).eq("id", fid); } catch (e) { /* facultatif */ } }
  return fid;
}
const fxPc = (n) => fmtNum(n, Number(n) % 1 ? 1 : 0);
const fxLine = (o) => ({ categorie: "", description: "", quantite: 1, unite: "forfait", nature: "normale", ...o });

/* ---------- Choix de la facture à créer depuis un devis ---------- */
function fxBilling(did) {
  if (!guard()) return;
  if (!db.v8) return toast("Exécutez d'abord migration_v8.sql dans Supabase pour activer la facturation BTP.", "dn");
  const d = byId(db.devis, did);
  const linked = fxLinked(did), billed = fxBilledHt(did), reste = fxResteDevis(d);
  const rows = linked.map((f) => `<div class="row"><div><a href="#/factures/${f.id}" data-x>${esc(f.numero || "Brouillon")}</a> · ${esc(fxLabel(f))}<small>${D(f.date_emission)}</small></div><span class="num">${E2(f.montant_ht)} HT ${chip(f.statut_affiche || f.statut)}</span></div>`).join("");
  const opt = (nat, t, s) => `<button type="button" class="btn o w" data-act="fxNew" data-id="${did}" data-arg="${nat}" style="justify-content:flex-start;text-align:left;display:block;height:auto;padding:10px 14px"><b>${t}</b><small style="display:block;font-weight:400;opacity:.75">${s}</small></button>`;
  const prevSit = fxPrevSituations(did).length;
  modal(`Facturer le devis ${esc(d.numero)}`, `<dl class="kv"><dt>Marché HT</dt><dd>${E2(d.montant_ht)}</dd><dt>Déjà facturé HT</dt><dd>${E2(billed)}</dd><dt>Reste à facturer HT</dt><dd><b>${E2(reste)}</b></dd></dl>
    ${rows ? `<div class="sect-t">Factures déjà créées</div>${rows}` : ""}
    <div class="sect-t" style="margin-top:10px">Créer une facture</div>
    <div style="display:grid;gap:8px">
      ${linked.length ? "" : opt("Facture", "Facture unique", "Tout le devis en une seule facture.")}
      ${opt("Acompte", "Facture d'acompte", "Un pourcentage ou un montant à la commande, déduit ensuite de la facture finale.")}
      ${!prevSit || fxPrevSituations(did)[0]?.nature === "Situation" ? opt("Situation", "Situation de travaux par poste", "Avancement en % de chaque catégorie du devis, cumulé d'une situation à l'autre.") : ""}
      ${!prevSit || fxPrevSituations(did)[0]?.nature === "Situation détaillée" ? opt("Situation détaillée", "Situation détaillée par ligne", "Avancement en % de chaque ligne du devis.") : ""}
      ${opt("Finale", "Facture finale (solde)", "Tout le devis, moins les acomptes et situations déjà facturés.")}
    </div>`, { submit: false, noFocus: true });
}
function fxPrevSituations(did, excludeId) {
  return fxLinked(did).filter((f) => f.id !== excludeId && ["Situation", "Situation détaillée"].includes(fxNat(f))).map((f) => ({ f, ...fdOf(f.id) })).sort((a, b) => String(a.f.created_at).localeCompare(String(b.f.created_at)));
}

/* ---------- Formulaire commun : date, échéance ---------- */
const fxDates = (f) => fld({ k: "date", l: "Date de la facture", t: "date", v: f?.date_emission || today() }) + fld({ k: "echeance", l: "Échéance de paiement", t: "date", v: f?.echeance || addDays(today(), Number(db.ent.delai_paiement_jours) || 30) });

/* ---------- Acompte ---------- */
async function fxAcompte(did, edit) {
  const d = byId(db.devis, did), lignes = await lignesOf("devis", did);
  const rates = fxRates(lignes, d), ttcTotal = r2(sum(rates, (r) => r.ht * (1 + r.taux / 100)));
  const fd = edit ? fdOf(edit.id) : null;
  const left = r2(fxResteDevis(d) * (ttcTotal / (d.montant_ht || 1)) + (edit ? edit.montant_ttc : 0));
  const body = `<div class="frm"><p class="mut full" style="margin:0">Devis ${esc(d.numero)} · ${esc(d.client_nom)} · ${E2(ttcTotal)} TTC. L'acompte sera déduit de la facture finale.</p>
    ${fld({ k: "mode", l: "Calculer l'acompte en", t: "select", o: [{ v: "pct", l: "Pourcentage du devis" }, { v: "eur", l: "Montant TTC" }], v: fd?.acompte_pct ? "pct" : edit ? "eur" : "pct" })}
    ${fld({ k: "val", l: "Valeur", t: "number", v: fd?.acompte_pct ? String(fd.acompte_pct).replace(".", ",") : edit ? String(edit.montant_ttc).replace(".", ",") : "30" })}
    ${fxDates(edit)}
    <p class="full up" id="acpv" style="margin:0"></p></div>`;
  modal(edit ? "Modifier l'acompte" : "Facture d'acompte", body, {
    wide: true, submit: edit ? "Enregistrer" : "Créer le brouillon",
    onMount: (m) => {
      const calc = () => {
        const mode = $("#f_mode", m).value, v = parseNum($("#f_val", m).value);
        const T = mode === "pct" ? r2((ttcTotal * v) / 100) : v;
        $("#acpv", m).textContent = T > 0 ? `Acompte : ${E2(T)} TTC${T > left + 0.01 ? ` (dépasse le reste à facturer : ${E2(left)})` : ""}` : "";
        return T;
      };
      m.addEventListener("input", calc); m.addEventListener("change", calc); calc();
    },
    onSubmit: async (v, api) => {
      const mode = v.mode, val = parseNum(v.val), T = mode === "pct" ? r2((ttcTotal * val) / 100) : val;
      if (!(T > 0)) throw new Error("Indiquez un acompte supérieur à zéro.");
      if (T > left + 0.01) throw new Error(`L'acompte (${E2(T)}) dépasse le reste à facturer (${E2(left)} TTC).`);
      const pct = mode === "pct" ? val : r2((T / ttcTotal) * 100);
      let rest = T;
      const ls = rates.map((r, i) => {
        const share = (r.ht * (1 + r.taux / 100)) / ttcTotal;
        const ttcR = i === rates.length - 1 ? rest : r2(T * share);
        rest = r2(rest - ttcR);
        return fxLine({ designation: `Acompte de ${fmtNum(pct, pct % 1 ? 1 : 0)} % sur devis ${d.numero}${rates.length > 1 ? ` (travaux à TVA ${fmtNum(r.taux, r.taux % 1 ? 1 : 0)} %)` : ""}`, prix_unitaire_ht: r2(ttcR / (1 + r.taux / 100)), taux_tva: r.taux });
      });
      const fid = await fxDraft({ id: edit?.id || null, client_id: d.client_id, chantier_id: d.chantier_id, date: v.date, echeance: v.echeance, notes: edit?.notes || null, lignes: ls, devis_id: did,
        details: { nature: "Acompte", marche_ht: d.montant_ht, acompte_pct: pct } });
      api.close(); toast("Acompte enregistré en brouillon. Vérifiez-le puis émettez-le.", "ok");
      await refresh(); go("factures/" + fid);
    },
  });
}

/* ---------- Situations (par poste ou par ligne) ---------- */
function fxPostes(lignes, d, detaille) {
  const out = [];
  if (!lignes.length) { const r = fxRates([], d); return r.length ? [{ key: "c:Travaux", label: "Travaux", cat: "", rates: Object.fromEntries(r.map((x) => [x.taux, x.ht])), marche: r2(sum(r, (x) => x.ht)) }] : []; }
  lignes.forEach((l, i) => {
    const ht = r2(Number(l.quantite) * Number(l.prix_unitaire_ht));
    if (!ht) return;
    const cat = String(l.categorie || "").trim();
    const key = detaille ? `l${i}` : "c:" + (cat || "Travaux");
    let p = out.find((x) => x.key === key);
    if (!p) out.push((p = { key, label: detaille ? l.designation : cat || "Travaux", cat, rates: {}, marche: 0 }));
    p.rates[Number(l.taux_tva)] = r2((p.rates[Number(l.taux_tva)] || 0) + ht);
    p.marche = r2(p.marche + ht);
  });
  return out;
}
async function fxSituation(did, nat, edit) {
  const d = byId(db.devis, did), lignes = await lignesOf("devis", did), detaille = nat === "Situation détaillée";
  const postes = fxPostes(lignes, d, detaille);
  if (!postes.length) return toast("Ce devis n'a aucune ligne chiffrée : impossible de faire une situation.", "dn");
  const prevInv = fxPrevSituations(did, edit?.id);
  const prev = {};
  prevInv.forEach((p) => (p.avancement || []).forEach((a) => (prev[a.key] = Math.max(prev[a.key] || 0, Number(a.cum) || 0))));
  const cur = {};
  (edit ? fdOf(edit.id)?.avancement || [] : []).forEach((a) => (cur[a.key] = Number(a.cum) || 0));
  const no = edit ? fdOf(edit.id)?.situation_no || prevInv.length + 1 : prevInv.length + 1;
  const marcheTot = r2(sum(postes, (p) => p.marche));
  const rows = postes.map((p, i) => `<tr data-i="${i}"><td>${esc(p.label)}${!detaille || !p.cat ? "" : `<small class="mut" style="display:block">${esc(p.cat)}</small>`}</td><td class="r num">${fmtNum(p.marche)}</td><td class="r num">${fmtNum(prev[p.key] || 0, 1)} %</td>
    <td style="width:96px"><input type="text" inputmode="decimal" data-cum value="${String(cur[p.key] ?? prev[p.key] ?? 0).replace(".", ",")}" aria-label="Avancement cumulé de ${esc(p.label)}"></td><td class="r num" data-ce>0,00</td></tr>`).join("");
  const body = `<div class="frm"><p class="mut full" style="margin:0">Devis ${esc(d.numero)} · ${esc(d.client_nom)} · marché ${E2(marcheTot)} HT. Indiquez l'avancement <b>cumulé</b> de chaque ${detaille ? "ligne" : "poste"} : Pilot déduit ce qui a déjà été facturé.</p>
    ${fxDates(edit)}
    <div class="full"><div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap"><span class="mut">Appliquer le même avancement partout :</span><input type="text" inputmode="decimal" id="allpct" style="width:80px" placeholder="%"><button type="button" class="btn o sm" id="allgo">Appliquer</button></div>
    <div class="tw"><table class="lines"><thead><tr><th>${detaille ? "Ligne" : "Poste"}</th><th class="r">Marché HT</th><th class="r">Déjà facturé</th><th>Avancement cumulé</th><th class="r">Cette situation HT</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="totbox" id="sitot" style="margin-top:10px"></div></div>
    ${fxAdjFields(edit ? fdOf(edit.id) : {})}</div>`;
  const read = (m) => $$("tr[data-i]", m).map((tr) => {
    const p = postes[+tr.dataset.i], cum = Math.max(0, Math.min(100, parseNum($("[data-cum]", tr).value))), pv = prev[p.key] || 0;
    return { p, cum, pv, ce: r2((p.marche * (cum - pv)) / 100) };
  });
  modal(`${edit ? "Modifier la" : "Nouvelle"} situation n° ${no}${detaille ? " détaillée" : ""}`, body, {
    xl: true, wide: true, submit: edit ? "Enregistrer" : "Créer le brouillon",
    onMount: (m) => {
      const calc = () => {
        const r = read(m);
        $$("tr[data-i]", m).forEach((tr, i) => ($("[data-ce]", tr).textContent = fmtNum(r[i].ce)));
        const ce = r2(sum(r, (x) => x.ce)), cumHt = r2(sum(r, (x) => (x.p.marche * x.cum) / 100));
        $("#sitot", m).innerHTML = `<div><span>Cette situation HT</span><span class="num">${E2(ce)}</span></div><div><span>Avancement global cumulé</span><span class="num">${fmtNum((cumHt / marcheTot) * 100, 1)} %</span></div>`;
      };
      m.addEventListener("input", calc);
      $("#allgo", m).onclick = () => { const v = parseNum($("#allpct", m).value); $$("[data-cum]", m).forEach((i, k) => { i.value = String(Math.max(v, prev[postes[k].key] || 0)).replace(".", ","); }); calc(); };
      calc();
    },
    onSubmit: async (v, api) => {
      const r = read(api.el), adj = fxReadAdj(v);
      for (const x of r) { if (parseNum($(`tr[data-i="${postes.indexOf(x.p)}"] [data-cum]`, api.el).value) > 100) throw new Error("Un avancement ne peut pas dépasser 100 %."); if (x.cum < x.pv - 0.001) throw new Error(`« ${x.p.label} » : l'avancement cumulé ne peut pas être inférieur à ce qui est déjà facturé (${fmtNum(x.pv, 1)} %).`); }
      const ls = [];
      for (const x of r) {
        if (Math.abs(x.cum - x.pv) < 0.001) continue;
        for (const [taux, ht] of Object.entries(x.p.rates)) {
          const delta = r2((ht * (x.cum - x.pv)) / 100);
          if (Math.abs(delta) < 0.005) continue;
          ls.push(fxLine({ categorie: detaille ? x.p.cat : "", designation: `${x.p.label} : avancement cumulé ${fxPc(x.cum)} % (déjà facturé ${fxPc(x.pv)} %)`, prix_unitaire_ht: delta, taux_tva: Number(taux) }));
        }
      }
      if (!ls.length) throw new Error("Aucun avancement nouveau : augmentez le pourcentage d'au moins un poste.");
      const fid = await fxDraft({ id: edit?.id || null, client_id: d.client_id, chantier_id: d.chantier_id, date: v.date, echeance: v.echeance, notes: edit?.notes || null, lignes: ls, devis_id: did,
        details: { nature: nat, situation_no: no, marche_ht: d.montant_ht, avancement: r.map((x) => ({ key: x.p.key, label: x.p.label, marche: x.p.marche, prev: x.pv, cum: x.cum })), ...adj } });
      api.close(); toast(`Situation n° ${no} enregistrée en brouillon.`, "ok");
      await refresh(); go("factures/" + fid);
    },
  });
}

/* ---------- Facture finale ---------- */
async function fxFinale(did, edit) {
  const d = byId(db.devis, did), dl = await lignesOf("devis", did);
  const prevs = fxLinked(did).filter((f) => f.id !== edit?.id && !fxIsAvoir(f) && fxNat(f) !== "Finale").sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const ded = [];
  for (const p of prevs) {
    const pl = await lignesOf("facture", p.id);
    for (const r of fxRates(pl, p)) ded.push({ p, ...r });
  }
  const dedHt = r2(sum(ded, (x) => x.ht));
  const draft = prevs.some((p) => p.statut === "Brouillon");
  const body = `<div class="frm"><p class="mut full" style="margin:0">Facture de solde du devis ${esc(d.numero)} : le montant total des travaux, moins ce qui a déjà été facturé.</p>
    <div class="full"><dl class="kv"><dt>Total des travaux HT</dt><dd>${E2(d.montant_ht)}</dd>
    ${prevs.map((p) => `<dt>${esc(p.numero || "Brouillon")} · ${esc(fxLabel(p))}</dt><dd>- ${E2(sum(ded.filter((x) => x.p.id === p.id), (x) => x.ht))} HT</dd>`).join("") || `<dt>Déjà facturé</dt><dd>Rien</dd>`}
    <dt><b>Reste à facturer HT</b></dt><dd><b>${E2(r2(d.montant_ht - dedHt))}</b></dd></dl>
    ${draft ? `<p class="badge-warn" style="margin:8px 0 0">Une facture précédente est encore en brouillon : émettez-la avant la facture finale.</p>` : ""}</div>
    ${fxDates(edit)}${fxAdjFields(edit ? fdOf(edit.id) : {})}</div>`;
  modal(edit ? "Modifier la facture finale" : "Facture finale", body, {
    wide: true, submit: edit ? "Enregistrer" : "Créer le brouillon",
    onSubmit: async (v, api) => {
      const adj = fxReadAdj(v);
      const ls = dl.length ? dl.map((l) => fxLine({ categorie: l.categorie, description: l.description, designation: l.designation, quantite: l.quantite, unite: l.unite, prix_unitaire_ht: l.prix_unitaire_ht, taux_tva: l.taux_tva }))
        : fxRates([], d).map((r) => fxLine({ designation: `Travaux du devis ${d.numero}`, prix_unitaire_ht: r.ht, taux_tva: r.taux }));
      ded.forEach((x) => ls.push(fxLine({ categorie: "Déjà facturé", designation: `Déduction : ${x.p.numero || "facture en brouillon"} (${fxLabel(x.p).toLowerCase()})${ded.some((y) => y.p.id === x.p.id && y !== x) ? ` - TVA ${fmtNum(x.taux, x.taux % 1 ? 1 : 0)} %` : ""}`, unite: "", prix_unitaire_ht: -x.ht, taux_tva: x.taux, nature: "deduction", ref_facture_id: x.p.id })));
      const fid = await fxDraft({ id: edit?.id || null, client_id: d.client_id, chantier_id: d.chantier_id, date: v.date, echeance: v.echeance, notes: edit?.notes || null, lignes: ls, devis_id: did,
        details: { nature: "Finale", marche_ht: d.montant_ht, deduit: prevs.map((p) => ({ id: p.id, numero: p.numero, nature: fxNat(p) })), ...adj } });
      api.close(); toast("Facture finale enregistrée en brouillon.", "ok");
      await refresh(); go("factures/" + fid);
    },
  });
}

/* ---------- Avoir ---------- */
async function fxAvoir(fid) {
  if (!guard()) return;
  if (!db.v8) return toast("Exécutez d'abord migration_v8.sql dans Supabase pour créer des avoirs.", "dn");
  const f = byId(db.factures, fid);
  if (!f || f.statut === "Brouillon" || f.statut === "Annulée" || fxIsAvoir(f)) return;
  const ls = (await lignesOf("facture", fid)).filter((l) => Number(l.quantite) !== 0);
  const dejaCredite = f.avoirs || 0, maxTtc = r2(f.montant_ttc - dejaCredite);
  if (maxTtc <= 0.005) return toast("Cette facture est déjà entièrement créditée par des avoirs.", "dn");
  const rows = ls.map((l, i) => `<tr data-i="${i}"><td>${esc(l.designation)}${l.categorie ? `<small class="mut" style="display:block">${esc(l.categorie)}</small>` : ""}</td><td class="r num">${fmtNum(Math.abs(l.quantite), Number.isInteger(Math.abs(l.quantite)) ? 0 : 2)} ${esc(l.unite || "")}</td><td class="r num">${fmtNum(l.prix_unitaire_ht)}</td>
    <td style="width:90px"><input type="text" inputmode="decimal" data-q value="${String(Math.abs(l.quantite)).replace(".", ",")}" aria-label="Quantité à créditer"></td></tr>`).join("");
  const body = `<div class="frm"><p class="mut full" style="margin:0">Avoir sur la facture ${esc(f.numero)} (${E2(f.montant_ttc)} TTC${dejaCredite ? `, déjà crédité ${E2(dejaCredite)}` : ""}). Gardez les quantités pour un avoir total, ou réduisez-les pour un avoir partiel.</p>
    ${fld({ k: "motif", l: "Motif de l'avoir (imprimé sur le document)", v: "", ph: "Erreur de facturation, remise accordée, travaux non réalisés…", cls: "full" })}
    ${fld({ k: "date", l: "Date de l'avoir", t: "date", v: today() })}<span></span>
    <div class="full"><div class="tw"><table class="lines"><thead><tr><th>Ligne facturée</th><th class="r">Facturé</th><th class="r">P.U. HT</th><th>À créditer</th></tr></thead><tbody>${rows}</tbody></table></div><div class="totbox" id="avtot" style="margin-top:10px"></div></div></div>`;
  const build = (m) => ls.map((l, i) => {
    const q0 = Math.abs(Number(l.quantite)), qv = Math.max(0, Math.min(q0, parseNum($(`tr[data-i="${i}"] [data-q]`, m).value)));
    return { l, qv, qty: -qv * Math.sign(Number(l.quantite)) };
  }).filter((x) => x.qv > 0);
  const totals = (r) => { const by = {}; r.forEach((x) => { const k = Number(x.l.taux_tva), h = r2(x.qty * x.l.prix_unitaire_ht); by[k] = (by[k] || 0) + h; }); const ht = r2(sum(Object.values(by))); const tva = r2(sum(Object.entries(by), ([k, h]) => (h * k) / 100)); return { ht, tva, ttc: r2(ht + tva) }; };
  modal("Créer un avoir", body, {
    wide: true, submit: "Créer l'avoir en brouillon",
    onMount: (m) => { const calc = () => { const t = totals(build(m)); $("#avtot", m).innerHTML = `<div><span>Total HT de l'avoir</span><span class="num">${E2(t.ht)}</span></div><div class="ttc"><span>Total TTC de l'avoir</span><span class="num">${E2(t.ttc)}</span></div>`; }; m.addEventListener("input", calc); calc(); },
    onSubmit: async (v, api) => {
      if (!v.motif.trim()) throw new Error("Indiquez le motif de l'avoir.");
      const r = build(api.el);
      if (!r.length) throw new Error("Indiquez au moins une quantité à créditer.");
      const t = totals(r);
      if (-t.ttc > maxTtc + 0.01) throw new Error(`L'avoir (${E2(-t.ttc)}) dépasse ce qui peut encore être crédité (${E2(maxTtc)} TTC).`);
      const lines = r.map((x) => fxLine({ categorie: x.l.categorie, description: x.l.description, designation: x.l.designation, quantite: x.qty, unite: x.l.unite, prix_unitaire_ht: x.l.prix_unitaire_ht, taux_tva: x.l.taux_tva, nature: x.l.nature === "deduction" ? "deduction" : x.l.nature === "libre" ? "libre" : "normale", ref_facture_id: x.l.ref_facture_id }));
      const id = await fxDraft({ client_id: f.client_id, chantier_id: f.chantier_id, date: v.date, echeance: v.date, notes: `Avoir sur la facture ${f.numero} du ${D(f.date_emission)}.\nMotif : ${v.motif.trim()}`, lignes: lines, devis_id: fdOf(fid)?.devis_id || f.devis_id || null,
        details: { nature: "Avoir", parent_id: fid, motif: v.motif.trim() } });
      api.close(); toast("Avoir créé en brouillon : émettez-le pour lui donner son numéro.", "ok");
      await refresh(); go("factures/" + id);
    },
  });
}

/* ---------- Modification d'un brouillon selon son type ---------- */
function fxEdit(id) {
  const f = byId(db.factures, id), d = fdOf(id);
  if (!f) return;
  if (d?.devis_id && ["Acompte", "Situation", "Situation détaillée", "Finale"].includes(d.nature) && f.statut === "Brouillon") {
    return d.nature === "Acompte" ? fxAcompte(d.devis_id, f) : d.nature === "Finale" ? fxFinale(d.devis_id, f) : fxSituation(d.devis_id, d.nature, f);
  }
  return docForm("facture", f);
}

/* ---------- Libération de la retenue, prime accordée ---------- */
function fxRelease(fid, kind) {
  if (!guard()) return;
  const f = byId(db.factures, fid), c = f.fx, isR = kind === "retenue";
  modal(isR ? "Libérer la retenue de garantie" : "Prime accordée : à encaisser", `<div class="frm"><p class="mut full" style="margin:0">${isR
    ? `Retenue de ${E2(c.retenue)} sur la facture ${esc(f.numero)}. Une fois libérée, elle réapparaît dans « à encaisser » : enregistrez ensuite le paiement reçu.`
    : `Prime ${esc(c.primeLib || "énergétique")} de ${E2(c.prime)} sur la facture ${esc(f.numero)}. Une fois accordée, elle réapparaît dans « à encaisser » : enregistrez ensuite le virement reçu.`}</p>
    ${fld({ k: "date", l: "Date", t: "date", v: today() })}</div>`, {
    submit: "Valider",
    onSubmit: async (v, api) => {
      await fxSaveDetails(fid, isR ? { retenue_liberee_le: v.date } : { prime_recue_le: v.date });
      api.close(); toast(isR ? "Retenue libérée : elle est maintenant à encaisser." : "Prime à encaisser.", "ok"); await refresh();
    },
  });
}

/* ---------- Cartes d'affichage ---------- */
function fxPendingCard() {
  if (!db.v8) return "";
  const p = fxPending();
  if (!p.length) return "";
  const tr = sum(p.filter((x) => x.kind === "retenue"), (x) => x.montant), tp = sum(p.filter((x) => x.kind === "prime"), (x) => x.montant);
  return card(`À récupérer plus tard <span class="mut" style="font-weight:400">· ${E2(tr + tp)}</span>`, p.map((x) => `<div class="row"><div><b>${x.kind === "retenue" ? "Retenue de garantie" : "Prime " + esc(x.label || "énergétique")}</b><small>${esc(x.f.numero)} · ${esc(x.f.client_nom)}${x.kind === "retenue" && x.date ? " · libérable le " + D(x.date) : ""}</small></div>
    <div style="display:flex;align-items:center;gap:12px"><b class="num">${E2(x.montant)}</b>${btn(x.kind === "retenue" ? "Libérer" : "Prime accordée", "fxRelease", x.f.id, x.kind, "o sm w")}</div></div>`).join(""), "");
}
// Récapitulatif du règlement d'une facture (fiche facture)
function fxDetailCard(f) {
  const d = fdOf(f.id);
  if (!d && !f.avoirs) return "";
  const c = f.fx, rows = [];
  const r = (k, v, cls = "") => rows.push(`<dt>${k}</dt><dd class="${cls}">${v}</dd>`);
  if (d?.nature === "Avoir") {
    const o = d.parent_id ? byId(db.factures, d.parent_id) : null;
    if (o) r("Facture d'origine", `<a href="#/factures/${o.id}">${esc(o.numero)}</a>`);
    if (d.motif) r("Motif", esc(d.motif));
    return card("Avoir", `<dl class="kv">${rows.join("")}</dl>`);
  }
  r("Total TTC", E2(c.ttc));
  if (c.retenue) r(`Retenue de garantie ${fmtNum(c.retenuePct, 1)} %`, `- ${E2(c.retenue)}${d.retenue_liberee_le ? ` (libérée le ${D(d.retenue_liberee_le)})` : d.retenue_date ? ` (libérable le ${D(d.retenue_date)})` : ""}`);
  if (c.caution) r("Retenue de garantie", "Remplacée par une caution bancaire");
  if (c.prime) r(`Prime ${esc(c.primeLib || "énergétique")}`, `- ${E2(c.prime)}${d.prime_recue_le ? " (accordée, à encaisser)" : " (à percevoir)"}`);
  if (c.prorata) r(`Compte prorata${c.prorataPct ? " " + fmtNum(c.prorataPct, 1) + " %" : ""}`, `- ${E2(c.prorata)}`);
  if (f.avoirs) r("Avoirs", `- ${E2(f.avoirs)}`);
  r("<b>Net à payer</b>", `<b>${E2(r2(c.net - f.avoirs))}</b>`);
  if (c.escompte) r(`Escompte ${fmtNum(c.escomptePct, 1)} %`, `${f.escompteAppliquee ? "appliqué" : `si payé avant le ${D(c.limite)}`} : ${E2(c.netEsc - f.avoirs)} à payer`);
  const over = r2((f.paye || 0) - (f.due ?? 0));
  if (f.statut !== "Brouillon" && over > 0.005) r("Trop-perçu", `<b class="dn">${E2(over)}</b> : à rembourser ou à imputer`, "");
  const actions = [];
  if (f.statut !== "Brouillon" && f.statut !== "Annulée") {
    if (c.retenue && !d.retenue_liberee_le) actions.push(btn("Libérer la retenue", "fxRelease", f.id, "retenue", "o sm w"));
    if (c.prime && !d.prime_recue_le) actions.push(btn("Prime accordée", "fxRelease", f.id, "prime", "o sm w"));
  }
  return card("Règlement", `<dl class="kv">${rows.join("")}</dl>`, actions.join(""));
}
// Avoirs liés, et facturation d'un devis (fiche devis)
function fxLinkedCard(f) {
  const av = db.factures.filter((x) => fdOf(x.id)?.parent_id === f.id);
  if (!av.length) return "";
  return card("Avoirs sur cette facture", av.map((x) => `<div class="row"><div><a href="#/factures/${x.id}">${esc(x.numero || "Brouillon")}</a><small>${D(x.date_emission)}</small></div><span class="num">${E2(x.montant_ttc)} ${chip(x.statut_affiche || x.statut)}</span></div>`).join(""));
}
function fxDevisCard(d) {
  if (!db.v8 || d.statut !== "Accepté") return "";
  const linked = fxLinked(d.id), billed = fxBilledHt(d.id), reste = fxResteDevis(d), pct = d.montant_ht ? Math.max(0, Math.min(100, (billed / d.montant_ht) * 100)) : 0;
  const rows = linked.map((f) => `<div class="row"><div><a href="#/factures/${f.id}">${esc(f.numero || "Brouillon")}</a> · ${esc(fxLabel(f))}<small>${D(f.date_emission)}</small></div><span class="num">${E2(f.montant_ht)} HT ${chip(f.statut_affiche || f.statut)}</span></div>`).join("");
  return card("Facturation du devis", `<div style="padding:14px 18px 4px"><div style="display:flex;justify-content:space-between;font-size:13px"><span>${fmtNum(pct, 0)} % facturé</span><span class="mut">Reste ${E2(reste)} HT</span></div><div style="height:6px;border-radius:3px;background:var(--line2);margin-top:6px"><div style="height:6px;border-radius:3px;background:var(--accent,#243b53);width:${pct}%"></div></div></div>${rows}`,
    reste > 0.5 ? btn(linked.length ? "Facturer la suite" : "Facturer en plusieurs fois", "fxBilling", d.id, "", "o sm w") : "");
}
const fxTag = (f) => { const n = fxNat(f); return n === "Facture" ? "" : `<small>${esc(fxLabel(f))}</small>`; };

/* ---------- Actions ---------- */
Object.assign(docActions, {
  fxBilling: (id) => fxBilling(id),
  fxNew: (id, nat, el) => {
    el?.closest(".md")?.remove();
    if (nat === "Facture") return docActions.devisToFacture(id);
    return nat === "Acompte" ? fxAcompte(id) : nat === "Finale" ? fxFinale(id) : fxSituation(id, nat);
  },
  fxAvoir: (id) => fxAvoir(id),
  fxRelease: (id, kind) => fxRelease(id, kind),
  factureEdit: (id) => fxEdit(id),
});

/* ---------- Données transmises au PDF ---------- */
function fxPdfData(f) {
  const d = fdOf(f.id) || {}, c = f.fx || fxCalc(f), parent = d.parent_id ? byId(db.factures, d.parent_id) : null;
  return { nature: d.nature || "Facture", label: fxLabel(f), parentNumero: parent?.numero || "", parentDate: parent?.date_emission || "", motif: d.motif || "", avancement: d.avancement || null, marche_ht: d.marche_ht || 0,
    calc: c, retenueDate: d.retenue_date || "", avoirs: f.avoirs || 0, reste: f.statut === "Brouillon" ? null : f.reste };
}
