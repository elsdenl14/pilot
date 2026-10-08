/* Paiements, dépenses, comptabilité, analyses, paramètres */

/* ===================== Moteur comptable ===================== */
const COMPTA = {
  bornes(y, m1, m2) {
    const last = new Date(y, m2 + 1, 0).getDate();
    return [`${y}-${pad2(m1 + 1)}-01`, `${y}-${pad2(m2 + 1)}-${pad2(last)}`];
  },
  tvaPart(p, fById) {
    const f = fById[p.facture_id];
    return f && f.montant_ttc > 0 ? r2((p.montant * f.montant_tva) / f.montant_ttc) : 0;
  },
  htPart(p, fById) {
    const f = fById[p.facture_id];
    return f && f.montant_ttc > 0 ? r2((p.montant * f.montant_ht) / f.montant_ttc) : 0;
  },
  calc(from, to) {
    const reg = db.ent.tva_regime || "encaissements";
    const inR = (d) => d >= from && d <= to;
    const fById = Object.fromEntries(db.factures.map((f) => [f.id, f]));
    const ventes = emises().filter((f) => inR(f.date_emission));
    const pays = db.paiements.filter((p) => inR(p.date_paiement));
    const deps = db.depenses.filter((d) => inR(d.date_depense));
    const payees = db.depenses.filter((d) => d.statut === "Payée" && inR(d.date_paiement || d.date_depense));
    const caHT = sum(ventes, (f) => f.montant_ht);
    const tvaCollectee = r2(reg === "debits" ? sum(ventes, (f) => f.montant_tva) : sum(pays, (p) => COMPTA.tvaPart(p, fById)));
    const tvaDeductible = r2(sum(deps, (d) => d.montant_tva));
    const achats = sum(deps.filter((d) => d.type === "Achat"), (d) => d.montant_ht);
    const depenses = sum(deps.filter((d) => d.type !== "Achat"), (d) => d.montant_ht);
    const encaissements = sum(pays, (p) => p.montant);
    const decaissements = sum(payees, (d) => d.montant_ttc);
    const tresoFin =
      (Number(db.ent.tresorerie_initiale) || 0) +
      sum(db.paiements.filter((p) => p.date_paiement <= to), (p) => p.montant) -
      sum(db.depenses.filter((d) => d.statut === "Payée" && (d.date_paiement || d.date_depense) <= to), (d) => d.montant_ttc);
    return {
      caHT, tvaCollectee, tvaDeductible, tvaAPayer: r2(tvaCollectee - tvaDeductible), achats, depenses,
      resultat: r2(caHT - achats - depenses), encaissements, decaissements, tresorerie: r2(tresoFin),
    };
  },
  periode(y, m1, m2) { return COMPTA.calc(...COMPTA.bornes(y, m1, m2)); },
  journal(y) {
    const [from, to] = COMPTA.bornes(y, 0, 11);
    const inR = (d) => d >= from && d <= to;
    const fById = Object.fromEntries(db.factures.map((f) => [f.id, f]));
    const out = [];
    for (const f of emises().filter((f) => inR(f.date_emission)))
      out.push({ d: f.date_emission, piece: f.numero, tiers: f.client_nom, nature: "Vente", ht: f.montant_ht, tva: f.montant_tva, ttc: f.montant_ttc });
    for (const x of db.depenses.filter((x) => inR(x.date_depense)))
      out.push({ d: x.date_depense, piece: x.reference || "", tiers: x.fournisseur, nature: x.type === "Achat" ? "Achat" : "Dépense", ht: -x.montant_ht, tva: -x.montant_tva, ttc: -x.montant_ttc });
    for (const p of db.paiements.filter((p) => inR(p.date_paiement)))
      out.push({ d: p.date_paiement, piece: p.facture_numero, tiers: p.client_nom, nature: "Encaissement", ht: COMPTA.htPart(p, fById), tva: COMPTA.tvaPart(p, fById), ttc: p.montant });
    for (const x of db.depenses.filter((x) => x.statut === "Payée" && inR(x.date_paiement || x.date_depense)))
      out.push({ d: x.date_paiement || x.date_depense, piece: x.reference || "", tiers: x.fournisseur, nature: "Décaissement", ht: null, tva: null, ttc: -x.montant_ttc });
    return out.sort((a, b) => a.d.localeCompare(b.d) || a.nature.localeCompare(b.nature));
  },
};

/* ===================== Paiements & dépenses ===================== */
const MODES = ["Virement", "Chèque", "Carte", "Espèces"];
const MODES_DEP = [...MODES, "Prélèvement"];
const ACHAT_CATS = new Set(["Matériaux", "Sous-traitance"]);

V.paiements = () => {
  const tab = ST.tab.paiements || "enc";
  const t = tabs("paiements", [["enc", "Encaissements"], ["dep", "Dépenses et achats"]], tab);
  return tab === "enc" ? paiementsEnc(t) : paiementsDep(t);
};
V.depenses = (r) => {
  ST.tab.paiements = "dep";
  setTimeout(() => { location.replace("#/paiements"); if (r.arg && byId(db.depenses, r.arg)) ACT.depEdit(r.arg); }, 0);
  return "";
};

function paiementsEnc(tabsHtml) {
  const mk = [prevMonthKey(), curMonth()];
  const mois = (k) => sum(db.paiements.filter((p) => monthKey(p.date_paiement) === k), (p) => p.montant);
  const cur = mois(mk[1]), prev = mois(mk[0]);
  const fById = Object.fromEntries(db.factures.map((f) => [f.id, f]));
  const delais = db.paiements.filter((p) => fById[p.facture_id]).map((p) => daysBetween(fById[p.facture_id].date_emission, p.date_paiement));
  const delai = delais.length ? Math.round(sum(delais) / delais.length) : null;
  const ouv = ouvertes().sort((a, b) => a.echeance.localeCompare(b.echeance));
  const rows = db.paiements.map((p) => ({ go: `factures/${p.facture_id}`, t: `${p.client_nom} ${p.facture_numero} ${p.mode}`,
    c: [D(p.date_paiement), `<strong>${esc(p.client_nom)}</strong><small>${esc(p.facture_numero)}</small>`, esc(p.mode), `<span class="num">${E2(p.montant)}</span>`] }));
  return page("Paiements", "Ce qui entre, ce qui sort, et ce qu'il reste à encaisser.", btn("Enregistrer un paiement", "payNew", "", "", "w") + btn("Ajouter une dépense", "depNew", "", "", "o w"),
    tabsHtml + strip([
      ["Encaissé ce mois", E(cur), prev ? `${cur >= prev ? "+" : ""}${Math.round(((cur - prev) / prev) * 100)} % par rapport au mois précédent` : "TTC", cur > prev ? "up" : ""],
      ["À encaisser", E(sum(ouv, (f) => f.reste)), `${ouv.length} facture${ouv.length > 1 ? "s" : ""} ouverte${ouv.length > 1 ? "s" : ""}`],
      ["En retard", E(sum(enRetard(), (f) => f.reste)), `${enRetard().length} facture${enRetard().length > 1 ? "s" : ""}`, enRetard().length ? "dn" : ""],
      ["Délai moyen de paiement", delai === null ? "-" : delai + " j", "émission → paiement"],
    ]) +
      card("Factures à encaisser", tbl(["Facture", "Échéance", { h: "Reste dû", r: 1 }, ""],
        ouv.map((f) => ({ go: `factures/${f.id}`, t: `${f.numero} ${f.client_nom}`, c: [`<strong>${esc(f.numero)}</strong><small>${esc(f.client_nom)}</small>`, `${prochEch(f) ? `${D(prochEch(f).date_echeance)}<small>${esc(prochEch(f).libelle || "échéance")} : ${E2(prochEch(f).reste)}</small>` : D(f.echeance)}${f.statut_affiche === "En retard" ? ` <span class="chip dn">en retard</span>` : ""}`, `<span class="num">${E2(f.reste)}</span>`, `<span class="r">${btn("Encaisser", "payNew", f.id, "", "o sm w")}</span>`] })),
        "Aucune facture en attente de paiement.")) +
      card("Journal des encaissements", tbl(["Date", "Client / facture", "Mode", { h: "Montant", r: 1 }], rows, "Aucun paiement enregistré.")));
}

function paiementsDep(tabsHtml) {
  const mois = curMonth();
  const dm = db.depenses.filter((d) => monthKey(d.date_depense) === mois);
  const ap = depensesAPayer();
  const apRetard = ap.filter((d) => d.echeance && d.echeance < today());
  const rows = db.depenses.map((d) => ({ go: `depenses/${d.id}`, t: `${d.fournisseur} ${d.categorie || ""} ${d.reference || ""} ${d.chantier_nom || ""}`,
    c: [`<strong>${esc(d.fournisseur)}</strong><small>${esc(d.categorie || d.type)}${d.reference ? " · " + esc(d.reference) : ""}${d.justificatif ? " · justificatif" : ""}</small>`,
      D(d.date_depense), d.echeance ? D(d.echeance) : "-", esc(d.chantier_nom || "-"), `<span class="num">${E2(d.montant_ht)}</span>`, `<span class="num">${E2(d.montant_ttc)}</span>`,
      d.statut === "À payer" && d.echeance && d.echeance < today() ? `<span class="chip dn">À payer, échue</span>` : chip(d.statut)] }));
  return page("Paiements", "Ce qui entre, ce qui sort, et ce qu'il reste à encaisser.", btn("Importer une facture fournisseur", "depImport", "", "", "w") + btn("Ajouter une dépense", "depNew", "", "", "o w"),
    tabsHtml + strip([
      ["Achats et dépenses du mois (HT)", E(sum(dm, (d) => d.montant_ht)), `dont achats ${E(sum(dm.filter((d) => d.type === "Achat"), (d) => d.montant_ht))}`],
      ["TVA déductible du mois", E(sum(dm, (d) => d.montant_tva)), "sur les factures reçues"],
      ["À payer", E(sum(ap, (d) => d.montant_ttc)), apRetard.length ? `${apRetard.length} échue${apRetard.length > 1 ? "s" : ""}` : `${ap.length} facture${ap.length > 1 ? "s" : ""}`, apRetard.length ? "dn" : ""],
      ["Payé ce mois", E(sum(db.depenses.filter((d) => d.statut === "Payée" && monthKey(d.date_paiement) === mois), (d) => d.montant_ttc)), "décaissements TTC"],
    ]) + searchBar("Rechercher un fournisseur, une catégorie, un chantier…", `${db.depenses.length} ligne${db.depenses.length > 1 ? "s" : ""}`) +
      card("", tbl(["Fournisseur", "Date", "Échéance", "Chantier", { h: "HT", r: 1 }, { h: "TTC", r: 1 }, "Statut"], rows,
        "Aucune dépense. Importez une facture fournisseur (PDF) : Pilot lit le fournisseur, les montants et les dates pour vous.")));
}

function payForm(fid, amount) {
  if (!guard()) return;
  const ouv = ouvertes();
  if (!ouv.length) return toast("Aucune facture émise à régler. Émettez d'abord une facture.", "dn");
  const sel = fid && ouv.find((f) => f.id === fid) ? fid : ouv[0].id;
  const body = `<div class="frm">
    ${fld({ k: "facture_id", l: "Facture", t: "select", o: ouv.map((f) => ({ v: f.id, l: `${f.numero} · ${f.client_nom} · reste ${E2(f.reste)}` })), v: sel, cls: "full" })}
    ${fld({ k: "montant", l: "Montant reçu (€)", t: "number", v: String(payDefault(byId(ouv, sel), amount)).replace(".", ",") })}
    ${fld({ k: "date_paiement", l: "Date du paiement", t: "date", v: today() })}
    ${fld({ k: "mode", l: "Mode de règlement", t: "select", o: MODES })}
    ${fld({ k: "reference", l: "Référence (facultatif)", r: 0 })}</div>`;
  modal("Enregistrer un paiement", body, {
    onMount: (m) => { $("#f_facture_id", m).onchange = (e) => { $("#f_montant", m).value = String(payDefault(byId(ouv, e.target.value))).replace(".", ","); }; },
    onSubmit: async (v, api) => {
      const f = byId(ouv, v.facture_id), m = parseNum(v.montant);
      if (m <= 0) throw new Error("Le montant doit être supérieur à zéro.");
      if (m > f.reste + 0.001) throw new Error(`Ce montant dépasse le reste dû (${E2(f.reste)}).`);
      await q(sb.from("paiements").insert({ facture_id: v.facture_id, montant: m, date_paiement: v.date_paiement, mode: v.mode, reference: v.reference || null }));
      api.close(); toast("Paiement enregistré.", "ok"); await refresh();
    },
  });
}

/* ---- Dépense : formulaire, import de facture fournisseur ---- */
const RATES = ["20", "10", "5.5", "2.1", "0"];
function depForm(d, opts = {}) {
  if (!guard()) return;
  const pre = opts.prefill || {};
  const g = (k, dflt = "") => d?.[k] ?? pre[k] ?? dflt;
  const ht0 = g("montant_ht", ""), tva0 = g("montant_tva", "");
  const rate = ht0 !== "" && tva0 !== "" && Number(ht0) > 0 ? (Number(tva0) / Number(ht0)) * 100 : 20;
  const known = RATES.find((x) => Math.abs(Number(x) - rate) < 0.25);
  const cats = PilotPdf.CATEGORIES;
  const cat0 = g("categorie", "Autre");
  const num = (x) => (x === "" ? "" : String(x).replace(".", ","));
  const body = `<div class="frm">
    ${opts.badge || ""}
    ${fld({ k: "fournisseur", l: "Fournisseur", v: g("fournisseur"), cls: "full" })}
    ${fld({ k: "reference", l: "N° de facture fournisseur", v: g("reference"), r: 0 })}
    ${fld({ k: "categorie", l: "Catégorie", t: "select", o: cats, v: cats.includes(cat0) ? cat0 : "Autre" })}
    ${fld({ k: "type", l: "Nature", t: "select", o: [{ v: "Achat", l: "Achat (matériaux, sous-traitance)" }, { v: "Dépense", l: "Dépense (frais généraux)" }], v: g("type", "Dépense") })}
    ${fld({ k: "chantier_id", l: "Rattacher à un chantier", t: "select", o: [{ v: "", l: "Aucun" }, ...db.chantiers.map((c) => ({ v: c.id, l: c.nom }))], v: g("chantier_id", opts.chantier || ""), r: 0 })}
    ${fld({ k: "date_depense", l: "Date de la facture", t: "date", v: g("date_depense", today()) })}
    ${fld({ k: "echeance", l: "Échéance", t: "date", v: g("echeance", ""), r: 0 })}
    <div class="sect-t">Montants</div>
    ${fld({ k: "montant_ht", l: "Montant HT (€)", t: "number", v: num(ht0) })}
    <label class="fl"><span>Taux de TVA</span><select id="f_taux">${RATES.map((x) => `<option value="${x}"${x === known ? " selected" : ""}>${x.replace(".", ",")} %</option>`).join("")}<option value="autre"${known ? "" : " selected"}>Autre</option></select></label>
    ${fld({ k: "montant_tva", l: "TVA (€)", t: "number", v: num(tva0 === "" ? 0 : tva0), hint: "Calculée avec le taux, modifiable (facture à plusieurs taux)." })}
    <label class="fl"><span>Total TTC</span><input type="text" id="f_ttc" readonly></label>
    <div class="sect-t">Paiement</div>
    ${fld({ k: "statut", l: "Statut", t: "select", o: ["À payer", "Payée"], v: g("statut", "À payer") })}
    <div class="fl" id="payf" style="display:contents">
      ${fld({ k: "date_paiement", l: "Date de paiement", t: "date", v: g("date_paiement", today()), r: 0 })}
      ${fld({ k: "mode", l: "Mode", t: "select", o: MODES_DEP, v: g("mode", "Virement"), r: 0 })}</div>
    <div class="sect-t">Justificatif</div>
    <div class="full">${d?.justificatif ? `<p style="margin:0 0 8px">Justificatif enregistré : <button type="button" class="lk" id="seej">voir le fichier</button></p>` : ""}
      ${opts.file ? `<p style="margin:0"><span class="badge-auto">${esc(opts.file.name)}</span> sera conservé avec la dépense.</p>` : `<label class="fl"><span>${d?.justificatif ? "Remplacer le fichier" : "Joindre la facture (PDF ou image)"}</span><input type="file" id="f_file" accept=".pdf,image/*"></label>`}</div>
    ${fld({ k: "notes", l: "Notes", t: "textarea", v: g("notes"), r: 0, cls: "full" })}</div>
    ${d ? `<div style="display:flex;gap:8px;flex-wrap:wrap">${d.statut === "À payer" ? "" : ""}</div>` : ""}`;
  modal(d ? "Modifier la dépense" : "Nouvelle dépense", body, {
    wide: true,
    onMount: (m) => {
      const ht = $("#f_montant_ht", m), tv = $("#f_montant_tva", m), tx = $("#f_taux", m), tt = $("#f_ttc", m), st = $("#f_statut", m);
      const upd = () => { tt.value = E2(parseNum(ht.value) + parseNum(tv.value)); };
      const fromRate = () => { if (tx.value !== "autre") tv.value = String(r2((parseNum(ht.value) * Number(tx.value)) / 100)).replace(".", ","); upd(); };
      ht.oninput = fromRate; tx.onchange = fromRate;
      tv.oninput = () => { const h = parseNum(ht.value); const m2 = RATES.find((x) => h > 0 && Math.abs(r2((h * Number(x)) / 100) - parseNum(tv.value)) < 0.02); tx.value = m2 || "autre"; upd(); };
      const pay = () => { $("#payf", m).style.display = st.value === "Payée" ? "contents" : "none"; };
      st.onchange = pay; pay(); upd();
      $("#f_categorie", m).onchange = (e) => { $("#f_type", m).value = ACHAT_CATS.has(e.target.value) ? "Achat" : "Dépense"; };
      const see = $("#seej", m);
      if (see) see.onclick = () => openFile(d.justificatif);
    },
    onSubmit: async (v, api) => {
      const htv = parseNum(v.montant_ht), tvv = parseNum(v.montant_tva);
      if (htv < 0 || tvv < 0) throw new Error("Les montants ne peuvent pas être négatifs.");
      const file = opts.file || $("#f_file", api.el)?.files[0];
      let path = d?.justificatif || null;
      if (file) path = await uploadDoc(file, "justificatifs");
      const row = { fournisseur: v.fournisseur.trim(), reference: v.reference || null, categorie: v.categorie, type: v.type, chantier_id: v.chantier_id || null,
        date_depense: v.date_depense, echeance: v.echeance || null, montant_ht: htv, montant_tva: tvv, statut: v.statut,
        date_paiement: v.statut === "Payée" ? v.date_paiement || today() : null, mode: v.statut === "Payée" ? v.mode : null, justificatif: path, notes: v.notes || null };
      if (d) await q(sb.from("depenses").update(row).eq("id", d.id));
      else await q(sb.from("depenses").insert(row));
      api.close(); toast(d ? "Dépense modifiée." : "Dépense enregistrée.", "ok"); await refresh();
    },
  });
  if (d) {
    const fa = $(".fa", $$(".md").pop());
    if (fa) fa.insertAdjacentHTML("afterbegin", `<button type="button" class="btn dn-o" id="depdel" style="margin-right:auto">Supprimer</button>`);
    $("#depdel")?.addEventListener("click", () => { $$(".md").pop().remove(); ACT.depDel(d.id); });
  }
}
async function uploadDoc(file, dossier) {
  const path = `${uid}/${dossier}/${Date.now()}-${slug(file.name)}`;
  const { error } = await sb.storage.from("documents").upload(path, file, { contentType: file.type || undefined });
  if (error) throw new Error("Envoi du fichier impossible : " + error.message);
  return path;
}
async function openFile(path) {
  const { data, error } = await sb.storage.from("documents").createSignedUrl(path, 300);
  if (error) return toast("Fichier introuvable : " + esc(error.message), "dn");
  window.open(data.signedUrl, "_blank", "noopener");
}
function depImport() {
  if (!guard()) return;
  const api = modal("Importer une facture fournisseur", `<p class="mut" style="margin:0">Choisissez la facture reçue (PDF). Pilot lit le fournisseur, les montants HT, TVA et TTC, les dates et propose une catégorie. Vous vérifiez, puis vous enregistrez.</p>
    <div class="drop"><div><b>Facture fournisseur</b><small style="display:block" class="mut">PDF (lecture automatique) ou photo / scan (saisie manuelle, fichier conservé)</small></div><input type="file" id="impf" accept=".pdf,image/*" hidden><button type="button" class="btn" id="impb">Choisir un fichier</button></div><p class="mut" id="impst" style="margin:0"></p>`, { submit: false, noFocus: true });
  const inp = $("#impf", api.el), st = $("#impst", api.el);
  $("#impb", api.el).onclick = () => inp.click();
  inp.onchange = async () => {
    const f = inp.files[0];
    if (!f) return;
    st.textContent = "Lecture de la facture…";
    try {
      const r = await PilotPdf.extractSupplier(f);
      api.close();
      if (r.image || r.vide) {
        depForm(null, { file: f, badge: `<div class="full"><span class="badge-warn">${r.image ? "Image : la lecture automatique ne fonctionne que sur les PDF. Saisissez les montants, le fichier est conservé." : "Ce PDF ne contient pas de texte lisible (scan). Saisissez les montants, le fichier est conservé."}</span></div>` });
        return;
      }
      const warn = !r.coherent || r.ht === null || r.ttc === null;
      depForm(null, { file: f, badge: `<div class="full"><span class="${warn ? "badge-warn" : "badge-auto"}">${warn ? "Pré-rempli automatiquement : certains montants sont à vérifier" : "Pré-rempli automatiquement : vérifiez avant d'enregistrer"}</span></div>`,
        prefill: { fournisseur: r.fournisseur, reference: r.reference, date_depense: r.date || today(), echeance: r.echeance, categorie: r.categorie, type: r.type,
          montant_ht: r.ht ?? "", montant_tva: r.tva ?? "" } });
    } catch (e) { console.error(e); st.textContent = "Lecture impossible : " + friendly(e); }
  };
}

/* ===================== Comptabilité ===================== */
const csvDl = (name, headers, rows) => downloadBlob(name, new Blob([toCsv(headers, rows)], { type: "text/csv;charset=utf-8" }));
const periodsOf = (gran) => gran === "t" ? [["T1", 0, 2], ["T2", 3, 5], ["T3", 6, 8], ["T4", 9, 11]] : MN.map((l, i) => [l, i, i]);
const neg = (v, f = E) => (v < 0 ? `<span class="dn">${f(v)}</span>` : f(v));

V.compta = () => {
  const tab = ST.tab.compta || "synthese", y = ST.year;
  const t = tabs("compta", [["synthese", "Synthèse"], ["journal", "Journal"], ["tva", "TVA"], ["comptable", "Espace comptable"]], tab);
  const yr = `<div class="seg"><button data-act="yearPrev" aria-label="Année précédente">‹</button><button disabled style="font-weight:600;color:var(--tx)">${y}</button><button data-act="yearNext" aria-label="Année suivante">›</button></div>`;
  const reg = (db.ent.tva_regime || "encaissements") === "debits" ? "sur les débits (à la facturation)" : "sur les encaissements (au paiement)";
  const note = `<p class="note">Chiffres estimés d'après vos factures, paiements et dépenses saisis dans Pilot. TVA collectée calculée ${reg}, réglable dans Paramètres. À valider avec votre comptable.</p>`;
  const an = COMPTA.periode(y, 0, 11);
  if (tab === "synthese") {
    const gran = ST.gran || "m";
    const ps = periodsOf(gran), cols = ps.map(([l, a, b]) => ({ l, c: COMPTA.periode(y, a, b) }));
    const row = (label, key, opt = {}) => `<tr class="${opt.bold ? "tot" : ""}"><td>${label}</td>${cols.map((x) => `<td class="r"><span class="num">${neg(x.c[key])}</span></td>`).join("")}<td class="r"><span class="num">${neg(opt.last ? cols[cols.length - 1].c[key] : an[key])}</span></td></tr>`;
    const sep = (l) => `<tr class="sep"><td colspan="${cols.length + 2}">${l}</td></tr>`;
    const table = `<div class="tw"><table><thead><tr><th></th>${cols.map((x) => `<th class="r">${x.l}</th>`).join("")}<th class="r">${gran === "t" ? "Année" : "Total"}</th></tr></thead><tbody>
      ${sep("Activité")}${row("Chiffre d'affaires HT", "caHT", { bold: 1 })}${row("Achats HT", "achats")}${row("Dépenses HT", "depenses")}${row("Résultat estimé", "resultat", { bold: 1 })}
      ${sep("TVA")}${row("TVA collectée", "tvaCollectee")}${row("TVA déductible", "tvaDeductible")}${row("TVA à reverser (crédit si négatif)", "tvaAPayer", { bold: 1 })}
      ${sep("Trésorerie")}${row("Encaissements TTC", "encaissements")}${row("Décaissements TTC", "decaissements")}${row("Trésorerie en fin de période", "tresorerie", { bold: 1, last: 1 })}</tbody></table></div>`;
    return page("Comptabilité", "Le tableau comptable de l'entreprise, alimenté par les devis, factures, paiements et dépenses.",
      `<div class="seg"><button data-act="gran" data-arg="m" aria-pressed="${gran === "m"}">Par mois</button><button data-act="gran" data-arg="t" aria-pressed="${gran === "t"}">Par trimestre</button></div>${yr}`,
      t + strip([
        ["Chiffre d'affaires HT", E(an.caHT), `année ${y}`], ["Résultat estimé", E(an.resultat), "CA - achats - dépenses", an.resultat < 0 ? "dn" : ""],
        [an.tvaAPayer >= 0 ? "TVA à reverser" : "Crédit de TVA", E(Math.abs(an.tvaAPayer)), `${E(an.tvaCollectee)} collectée - ${E(an.tvaDeductible)} déductible`],
        ["Trésorerie estimée", E(tresorerie()), "aujourd'hui", tresorerie() < 0 ? "dn" : ""],
      ]) + card("", table + note));
  }
  if (tab === "journal") {
    const j = COMPTA.journal(y);
    const rows = j.map((e) => ({ t: `${e.piece} ${e.tiers} ${e.nature}`, c: [D(e.d), esc(e.piece || "-"), esc(e.tiers), `<span class="chip ${e.nature === "Vente" || e.nature === "Encaissement" ? "ok" : "n"}">${e.nature}</span>`,
      `<span class="num">${e.ht === null ? "" : neg(e.ht, E2)}</span>`, `<span class="num">${e.tva === null ? "" : neg(e.tva, E2)}</span>`, `<span class="num">${neg(e.ttc, E2)}</span>`] }));
    return page("Comptabilité", "Toutes les écritures de l'année, dans l'ordre.", btn("Exporter le journal (CSV)", "exportCsv", "", "journal", "o") + yr,
      t + searchBar("Rechercher une pièce, un tiers…", `${j.length} écriture${j.length > 1 ? "s" : ""}`) + card("", tbl(["Date", "Pièce", "Tiers", "Nature", { h: "HT", r: 1 }, { h: "TVA", r: 1 }, { h: "TTC", r: 1 }], rows, "Aucune écriture sur cette année.") + note));
  }
  if (tab === "tva") {
    let cumul = 0;
    const rows = MN.map((l, i) => { const c = COMPTA.periode(y, i, i); cumul = r2(cumul + c.tvaAPayer);
      return { c: [`<strong>${MNL[i]}</strong>`, `<span class="num">${E2(c.caHT)}</span>`, `<span class="num">${E2(c.tvaCollectee)}</span>`, `<span class="num">${E2(c.tvaDeductible)}</span>`, `<span class="num">${neg(c.tvaAPayer, E2)}</span>`, `<span class="num">${neg(cumul, E2)}</span>`] }; });
    return page("Comptabilité", `TVA mois par mois. À déclarer avant le ${Number(db.ent.jour_tva) || 20} du mois suivant.`, "", t + yr.replace("seg", "seg pa") +
      card("", tbl(["Mois", { h: "CA HT", r: 1 }, { h: "TVA collectée", r: 1 }, { h: "TVA déductible", r: 1 }, { h: "À reverser", r: 1 }, { h: "Cumul", r: 1 }], rows) + note));
  }
  return comptableTab(t, yr);
};

function comptableTab(t, yr) {
  const y = ST.year;
  const exps = [["factures", "Factures émises"], ["paiements", "Paiements reçus"], ["depenses", "Achats et dépenses"], ["clients", "Clients"], ["journal", "Journal"], ["tva", "TVA par mois"]];
  const body = `${card(`Exports pour le comptable, année ${y}`, `<div class="cb" style="display:flex;gap:8px;flex-wrap:wrap">${exps.map(([k, l]) => btn(l + " (CSV)", "exportCsv", "", k, "o sm")).join("")}</div>
      <div class="cb" style="border-top:1px solid var(--line2);display:flex;gap:14px;align-items:center;flex-wrap:wrap">${btn("Télécharger le dossier complet (ZIP)", "exportZip", "", "", "")}<span class="mut">CSV, PDF des factures émises, justificatifs des dépenses et pièces déposées ci-dessous.</span></div>`, yr)}
    ${card("Pièces pour le comptable", tbl(["Document", "Type", "Période", ""], db.docsCompta.map((x) => ({ t: x.libelle, c: [`<strong>${esc(x.libelle)}</strong>`, esc(x.type), x.periode ? D(x.periode).slice(3) : "-", `<span class="r"><button class="lk" data-act="docOpen" data-id="${x.id}">Ouvrir</button> <button class="lk w" data-act="docDel" data-id="${x.id}" style="margin-left:10px">Supprimer</button></span>`] })), "Aucune pièce. Déposez ici les relevés bancaires, attestations, déclarations…"), btn("Déposer un document", "docNew", "", "", "o sm w"))}
    ${ro ? "" : card("Accès du comptable", `${db.acces.map((a) => `<div class="row"><div><b>${esc(a.email)}</b><small>Lecture seule : factures, paiements, dépenses, justificatifs</small></div><button class="lk" data-act="accesDel" data-id="${a.id}">Retirer</button></div>`).join("") || `<p class="mut" style="margin:0;padding:16px 18px">Aucun accès donné.</p>`}
      <form data-form="acces" class="cb" style="display:flex;gap:8px;border-top:1px solid var(--line2);flex-wrap:wrap"><input type="email" name="email" placeholder="email@cabinet-comptable.fr" required style="flex:1;min-width:220px"><button class="btn">Donner l'accès</button></form>
      <p class="note">Votre comptable crée son compte avec cet email (vous pouvez l'inviter depuis Supabase : Authentication, Users, Invite user), puis se connecte à Pilot : il voit vos données en lecture seule et ne peut rien modifier.</p>`)}`;
  return page("Comptabilité", "Un espace pour transmettre les données et les justificatifs à votre comptable.", "", t + body);
}

async function exportCsv(kind) {
  const y = String(ST.year), inY = (d) => String(d || "").startsWith(y);
  if (kind === "factures")
    csvDl(`factures-${y}.csv`, ["Numéro", "Date émission", "Échéance", "Client", "Chantier", "Statut", "HT", "TVA", "TTC", "Payé", "Reste dû"],
      emises().filter((f) => inY(f.date_emission)).map((f) => [f.numero, f.date_emission, f.echeance, f.client_nom, f.chantier_nom || "", f.statut, f.montant_ht, f.montant_tva, f.montant_ttc, f.paye, f.reste]));
  else if (kind === "paiements")
    csvDl(`paiements-${y}.csv`, ["Date", "Facture", "Client", "Mode", "Montant TTC", "Référence"], db.paiements.filter((p) => inY(p.date_paiement)).map((p) => [p.date_paiement, p.facture_numero, p.client_nom, p.mode, p.montant, p.reference || ""]));
  else if (kind === "depenses")
    csvDl(`achats-depenses-${y}.csv`, ["Date", "Fournisseur", "N° facture", "Nature", "Catégorie", "Chantier", "HT", "TVA", "TTC", "Statut", "Date paiement", "Mode", "Justificatif"],
      db.depenses.filter((d) => inY(d.date_depense)).map((d) => [d.date_depense, d.fournisseur, d.reference || "", d.type, d.categorie || "", d.chantier_nom || "", d.montant_ht, d.montant_tva, d.montant_ttc, d.statut, d.date_paiement || "", d.mode || "", d.justificatif ? d.justificatif.split("/").pop() : ""]));
  else if (kind === "clients")
    csvDl("clients.csv", ["Nom", "Type", "Email", "Téléphone", "Adresse", "Ville", "CA HT", "À encaisser"], db.clients.map((c) => [c.nom, c.type, c.email || "", c.telephone || "", c.adresse || "", c.ville || "", c.ca, c.a_encaisser]));
  else if (kind === "journal")
    csvDl(`journal-${y}.csv`, ["Date", "Pièce", "Tiers", "Nature", "HT", "TVA", "TTC"], COMPTA.journal(ST.year).map((e) => [e.d, e.piece, e.tiers, e.nature, e.ht ?? "", e.tva ?? "", e.ttc]));
  else if (kind === "tva")
    csvDl(`tva-${y}.csv`, ["Mois", "CA HT", "TVA collectée", "TVA déductible", "TVA à reverser"], MNL.map((l, i) => { const c = COMPTA.periode(ST.year, i, i); return [l, c.caHT, c.tvaCollectee, c.tvaDeductible, c.tvaAPayer]; }));
}
async function exportZip() {
  await loadScript(LIBS.jszip);
  const y = String(ST.year), zip = new JSZip();
  toast("Préparation du dossier comptable…");
  const keep = ST.year; // les CSV utilisent ST.year
  const add = (name, headers, rows) => zip.file(name, toCsv(headers, rows));
  add(`exports/factures-${y}.csv`, ["Numéro", "Date émission", "Échéance", "Client", "Statut", "HT", "TVA", "TTC", "Reste dû"], emises().filter((f) => f.date_emission.startsWith(y)).map((f) => [f.numero, f.date_emission, f.echeance, f.client_nom, f.statut, f.montant_ht, f.montant_tva, f.montant_ttc, f.reste]));
  add(`exports/paiements-${y}.csv`, ["Date", "Facture", "Client", "Mode", "Montant TTC"], db.paiements.filter((p) => p.date_paiement.startsWith(y)).map((p) => [p.date_paiement, p.facture_numero, p.client_nom, p.mode, p.montant]));
  add(`exports/achats-depenses-${y}.csv`, ["Date", "Fournisseur", "N° facture", "Nature", "Catégorie", "HT", "TVA", "TTC", "Statut"], db.depenses.filter((d) => d.date_depense.startsWith(y)).map((d) => [d.date_depense, d.fournisseur, d.reference || "", d.type, d.categorie || "", d.montant_ht, d.montant_tva, d.montant_ttc, d.statut]));
  add(`exports/journal-${y}.csv`, ["Date", "Pièce", "Tiers", "Nature", "HT", "TVA", "TTC"], COMPTA.journal(keep).map((e) => [e.d, e.piece, e.tiers, e.nature, e.ht ?? "", e.tva ?? "", e.ttc]));
  add(`exports/tva-${y}.csv`, ["Mois", "CA HT", "TVA collectée", "TVA déductible", "TVA à reverser"], MNL.map((l, i) => { const c = COMPTA.periode(keep, i, i); return [l, c.caHT, c.tvaCollectee, c.tvaDeductible, c.tvaAPayer]; }));
  const problems = [];
  for (const f of emises().filter((f) => f.date_emission.startsWith(y))) {
    try { zip.file(`factures/${slug(f.numero)}.pdf`, await docPdfBytes("facture", f.id)); } catch (e) { problems.push(f.numero); }
  }
  for (const d of db.depenses.filter((d) => d.date_depense.startsWith(y) && d.justificatif)) {
    try { const b = await getAsset(d.justificatif); zip.file(`justificatifs/${d.date_depense}_${slug(d.fournisseur)}_${slug(d.justificatif.split("/").pop().replace(/^\d+-/, ""))}`, b); } catch (e) { problems.push(d.fournisseur); }
  }
  for (const x of db.docsCompta) {
    try { zip.file(`pieces/${slug(x.libelle)}_${slug(x.chemin.split("/").pop().replace(/^\d+-/, ""))}`, await getAsset(x.chemin)); } catch (e) { problems.push(x.libelle); }
  }
  const blob = await zip.generateAsync({ type: "blob" });
  downloadBlob(`dossier-comptable-${y}.zip`, blob);
  toast(problems.length ? `Dossier téléchargé, mais ${problems.length} fichier(s) manquant(s) : ${esc(problems.slice(0, 3).join(", "))}` : "Dossier comptable téléchargé.", problems.length ? "dn" : "ok");
}
function docComptaForm() {
  if (!guard()) return;
  modal("Déposer un document", `<div class="frm">${fld({ k: "libelle", l: "Libellé", cls: "full", ph: "Relevé bancaire septembre 2026" })}
    ${fld({ k: "type", l: "Type", t: "select", o: ["Relevé bancaire", "Attestation", "Déclaration", "Contrat", "Autre"] })}
    ${fld({ k: "periode", l: "Période", t: "date", r: 0 })}
    <label class="fl full"><span>Fichier <em>*</em></span><input type="file" id="docf" accept=".pdf,image/*,.csv,.xlsx,.xls" required></label></div>`, {
    onSubmit: async (v, api) => {
      const f = $("#docf", api.el).files[0];
      if (!f) throw new Error("Choisissez un fichier.");
      const chemin = await uploadDoc(f, "compta");
      await q(sb.from("documents_compta").insert({ type: v.type, libelle: v.libelle, periode: v.periode || null, chemin }));
      api.close(); toast("Document déposé.", "ok"); await refresh();
    },
  });
}

/* ===================== Analyses ===================== */
function chartBars(series) {
  const mx = Math.max(1, ...series.flatMap((s) => [s.ca, s.cout])), n = series.length, w = 640 / n;
  const bars = series.map((s, i) => {
    const x = i * w, bw = w * 0.34, h1 = (s.ca / mx) * 170, h2 = (s.cout / mx) * 170;
    return `<rect x="${x + w * 0.12}" y="${200 - h1}" width="${bw}" height="${h1}" rx="2" fill="var(--acc)"/><rect x="${x + w * 0.12 + bw + 2}" y="${200 - h2}" width="${bw}" height="${h2}" rx="2" fill="var(--faint)"/>
      <text x="${x + w / 2}" y="220" text-anchor="middle" font-size="11" fill="var(--mut)">${s.l}</text>`;
  }).join("");
  return `<svg viewBox="0 0 640 232" role="img" aria-label="Chiffre d'affaires HT et coûts HT par mois" style="width:100%;height:auto;display:block;padding:14px 16px 4px"><line x1="0" x2="640" y1="200" y2="200" stroke="var(--line)"/>${bars}</svg>
    <div style="display:flex;gap:18px;padding:0 18px 14px;color:var(--mut);font-size:12.5px"><span><i style="display:inline-block;width:10px;height:10px;background:var(--acc);border-radius:2px;margin-right:6px"></i>Chiffre d'affaires HT</span><span><i style="display:inline-block;width:10px;height:10px;background:var(--faint);border-radius:2px;margin-right:6px"></i>Achats et dépenses HT</span></div>`;
}
V.analyses = () => {
  const per = ST.period, n = per === "y" ? new Date().getMonth() + 1 : Number(per);
  const ms = []; let yy = new Date().getFullYear(), mm = new Date().getMonth();
  for (let i = 0; i < n; i++) { ms.unshift([yy, mm]); if (--mm < 0) { mm = 11; yy--; } }
  const series = ms.map(([y, m]) => { const c = COMPTA.periode(y, m, m); return { l: MN[m], ca: c.caHT, cout: c.achats + c.depenses, c }; });
  const ca = sum(series, (s) => s.ca), cout = sum(series, (s) => s.cout), keys = new Set(ms.map(([y, m]) => `${y}-${pad2(m + 1)}`));
  const env = db.devis.filter((d) => d.statut !== "Brouillon"), acc = db.devis.filter((d) => d.statut === "Accepté");
  const attente = db.devis.filter((d) => d.statut === "Envoyé");
  const jours = (f) => daysBetween(f.echeance, today());
  const tr = (a, b) => sum(ouvertes().filter((f) => jours(f) >= a && jours(f) <= b), (f) => f.reste);
  const chRows = db.chantiers.map((c) => ({ c, s: chStats(c) })).filter((x) => x.s.factureHT || x.s.couts).sort((a, b) => b.s.marge - a.s.marge).slice(0, 6);
  const sel = `<div class="seg">${[["12", "12 mois"], ["6", "6 mois"], ["y", "Cette année"]].map(([v, l]) => `<button data-act="period" data-arg="${v}" aria-pressed="${per === v}">${l}</button>`).join("")}</div>`;
  return page("Analyses", "Les chiffres utiles pour piloter l'activité et décider.", sel,
    strip([["Chiffre d'affaires HT", E(ca), `${series.length} mois`], ["Achats et dépenses HT", E(cout), "coûts saisis"], ["Résultat estimé", E(ca - cout), ca ? `${Math.round(((ca - cout) / ca) * 100)} % du CA` : "-", ca - cout < 0 ? "dn" : ""],
      ["Taux de transformation", env.length ? Math.round((acc.length / env.length) * 100) + " %" : "-", "devis acceptés / envoyés"]]) +
    `<div class="g2"><div>${card("Chiffre d'affaires et coûts par mois", chartBars(series))}
      ${card("Marge par chantier", tbl(["Chantier", { h: "Facturé HT", r: 1 }, { h: "Coûts HT", r: 1 }, { h: "Marge", r: 1 }], chRows.map(({ c, s }) => ({ go: `chantiers/${c.id}`, c: [`<strong>${esc(c.nom)}</strong><small>${esc(c.client_nom)}</small>`, `<span class="num">${E(s.factureHT)}</span>`, `<span class="num">${E(s.couts)}</span>`, `<span class="num ${s.marge < 0 ? "dn" : ""}">${E(s.marge)}</span>`] })), "Rattachez vos dépenses à des chantiers pour voir la marge réelle."))}</div>
    <div>${card("Devis", [["Créés", db.devis.length], ["Envoyés", env.length], ["Acceptés", acc.length], ["En attente", attente.length], ["Refusés", db.devis.filter((d) => d.statut === "Refusé").length]].map((r) => `<div class="row"><span>${r[0]}</span><b class="num">${r[1]}</b></div>`).join("") + `<p class="note">${E(sum(attente, (d) => d.montant_ttc))} TTC de devis attendent une réponse.</p>`)}
      ${card("Créances par ancienneté", [["Pas encore échues", tr(-99999, 0)], ["1 à 30 jours de retard", tr(1, 30)], ["31 à 60 jours", tr(31, 60)], ["Plus de 60 jours", tr(61, 99999)]].map((r, i) => `<div class="row"><span>${r[0]}</span><b class="num ${i > 1 && r[1] ? "dn" : ""}">${E(r[1])}</b></div>`).join(""))}
      ${card("Meilleurs clients", [...db.clients].sort((a, b) => b.ca - a.ca).slice(0, 5).map((c) => `<div class="row lnk" data-go="clients/${c.id}" style="cursor:pointer"><div><b>${esc(c.nom)}</b><small>${c.nb_chantiers} chantier${c.nb_chantiers > 1 ? "s" : ""}</small></div><span class="num">${E(c.ca)}</span></div>`).join("") || `<p class="mut" style="margin:0;padding:16px 18px">Pas encore de client.</p>`)}</div></div>`);
};

/* ===================== Paramètres ===================== */
const MM = 2.8346;
const modeleBlock = (K, label) => {
  const e = db.ent, regl = e.pdf_reglages || {}, path = K === "devis" ? e.modele_devis_fichier : e.modele_facture_fichier, tp = regl[K] || {};
  const fname = path ? path.split("/").pop().replace(/^[a-z]+-\d+-/, "") : "";
  return `<div class="cb" style="${K === "facture" ? "border-top:1px solid var(--line2)" : ""}"><div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap">
    <div><b>${label}</b><div class="mut">${path ? `Votre design importé : <b>${esc(fname)}</b>` : "Modèle classique Pilot (simple, en noir et blanc avec une couleur d'accent)"}</div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">${btn(path ? "Remplacer mon design" : "Importer mon design", "modelePick", "", K, "o sm w")}${path ? btn("Revenir au classique", "modeleDel", "", K, "o sm w") : ""}${btn("Aperçu", "modelePreview", "", K, "o sm")}</div></div>
    ${path ? `<div class="frm" style="margin-top:12px;max-width:420px"><label class="fl"><span>Marge haute (mm)</span><input type="text" inputmode="decimal" data-marge="${K}:top" value="${Math.round(((tp.top ?? 150) / MM) * 10) / 10}"></label><label class="fl"><span>Marge basse (mm)</span><input type="text" inputmode="decimal" data-marge="${K}:bottom" value="${Math.round(((tp.bottom ?? 90) / MM) * 10) / 10}"></label>
      <small class="mut full" style="grid-column:1/-1">Espace laissé libre en haut et en bas de chaque page pour votre en-tête et votre pied de page. Cliquez sur « Aperçu » pour vérifier.</small></div>` : ""}</div>`;
};
V.params = () => {
  const e = db.ent, regl = e.pdf_reglages || {};
  const f = (k, l, o = {}) => fld({ k, l, v: e[k] ?? "", r: 0, ...o });
  return page("Paramètres", "L'identité de l'entreprise, la facturation et l'apparence des documents.", "",
    `<form data-form="ent">${card("Entreprise", `<div class="cb"><div class="frm">${f("nom", "Nom de l'entreprise", { r: 1, cls: "full" })}${f("forme_juridique", "Forme juridique et capital", { ph: "SARL au capital de 10 000 €" })}${f("siret", "SIRET")}${f("tva_intracom", "N° de TVA intracommunautaire")}${f("rcs", "RCS / RM")}${f("adresse", "Adresse", { cls: "full" })}${f("telephone", "Téléphone")}${f("email", "Email", { t: "email" })}${f("mentions_legales", "Mentions en bas des documents", { t: "textarea", cls: "full", rows: 2, hint: "Assurance décennale, médiateur, etc." })}</div></div>`)}
    ${card("Facturation et comptabilité", `<div class="cb"><div class="frm">${f("delai_paiement_jours", "Délai de paiement par défaut (jours)", { t: "number", v: e.delai_paiement_jours ?? 30 })}${f("taux_tva_defaut", "TVA par défaut (%)", { t: "number", v: String(e.taux_tva_defaut ?? 20).replace(".", ",") })}
      ${fld({ k: "tva_regime", l: "TVA collectée", t: "select", o: [{ v: "encaissements", l: "Sur les encaissements (au paiement)" }, { v: "debits", l: "Sur les débits (à la facturation)" }], v: e.tva_regime || "encaissements", hint: "Pour des prestations de services, la TVA est en général exigible à l'encaissement. Demandez à votre comptable." })}
      ${f("jour_tva", "Jour limite de déclaration de TVA", { t: "number", v: e.jour_tva ?? 20, hint: "Sert au rappel sur l'accueil." })}${f("tresorerie_initiale", "Trésorerie de départ (€)", { t: "number", v: String(e.tresorerie_initiale ?? 0).replace(".", ","), hint: "Solde du compte avant votre premier paiement dans Pilot." })}${f("iban", "IBAN")}${f("bic", "BIC")}</div></div>`)}
    <div class="pa w" style="margin:16px 0"><button class="btn" type="submit">Enregistrer</button></div></form>
    ${card("Documents PDF : devis et factures", `<div class="cb" style="display:flex;gap:22px;flex-wrap:wrap;align-items:center"><label class="fl"><span>Couleur d'accent (modèle classique)</span><input type="color" class="swatch" id="couleur" value="${esc(regl.couleur || "#243b53")}" ${ro ? "disabled" : ""}></label>
      <div class="fl"><span>Logo (modèle classique)</span><div style="display:flex;gap:8px;align-items:center">${e.logo_path ? `<span class="badge-auto">Logo enregistré</span>${btn("Retirer", "logoDel", "", "", "o sm w")}` : ""}${btn(e.logo_path ? "Remplacer" : "Importer un logo", "logoPick", "", "", "o sm w")}</div></div></div>
      <p class="note" style="border-top:1px solid var(--line2)">Importez votre propre design de devis ou de facture (PDF, PNG ou JPG, une page A4) : Pilot le place en fond de chaque page et écrit le contenu par-dessus, à chaque génération.</p>
      ${modeleBlock("devis", "Devis")}${modeleBlock("facture", "Facture")}`)}
    ${card("Compte", `<dl class="kv"><dt>Connecté</dt><dd>${esc(email)}</dd></dl><div class="cb" style="border-top:1px solid var(--line2)">${btn("Se déconnecter", "logout", "", "", "o")}</div>`)}`);
};
const entPatch = async (patch) => {
  const row = await q(sb.from("entreprise").upsert({ user_id: uid, ...patch }, { onConflict: "user_id" }).select("*").single());
  Object.assign(db.ent, row);
  db.ent.tresorerie_initiale = Number(row.tresorerie_initiale || 0);
  db.ent.pdf_reglages ||= {};
  return row;
};
async function saveEntForm(form) {
  if (!guard()) return;
  const v = Object.fromEntries(new FormData(form));
  await entPatch({ nom: v.nom, forme_juridique: v.forme_juridique || null, siret: v.siret || null, tva_intracom: v.tva_intracom || null, rcs: v.rcs || null, adresse: v.adresse || null,
    telephone: v.telephone || null, email: v.email || null, mentions_legales: v.mentions_legales || null,
    delai_paiement_jours: parseInt(v.delai_paiement_jours) || 30, taux_tva_defaut: parseNum(v.taux_tva_defaut) || 20, tva_regime: v.tva_regime,
    jour_tva: Math.min(28, Math.max(1, parseInt(v.jour_tva) || 20)), tresorerie_initiale: parseNum(v.tresorerie_initiale), iban: v.iban || null, bic: v.bic || null });
  toast("Paramètres enregistrés.", "ok");
  await refresh();
}
async function saveRegl(patchFn) {
  const regl = JSON.parse(JSON.stringify(db.ent.pdf_reglages || {}));
  patchFn(regl);
  await entPatch({ pdf_reglages: regl });
}
async function pickFile(accept, cb) {
  const i = document.createElement("input");
  i.type = "file"; i.accept = accept;
  i.onchange = async () => { if (i.files[0]) { try { await cb(i.files[0]); } catch (e) { toast(esc(friendly(e)), "dn"); } } };
  i.click();
}
async function modelePick(K) {
  if (!guard()) return;
  pickFile(".pdf,image/png,image/jpeg", async (f) => {
    const bytes = new Uint8Array(await f.arrayBuffer()), t = sniff(bytes);
    if (!t) throw new Error("Format non pris en charge : utilisez un PDF, un PNG ou un JPG.");
    if (t === "pdf") { await loadScript(LIBS.pdflib); const d = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true }); if (!d.getPageCount()) throw new Error("Ce PDF ne contient aucune page."); }
    toast("Import du modèle…");
    const col = K === "devis" ? "modele_devis_fichier" : "modele_facture_fichier", old = db.ent[col];
    const path = await uploadDoc(f, "modeles");
    await saveRegl((r) => { r[K] ||= {}; r[K].top ??= 150; r[K].bottom ??= 90; });
    await entPatch({ [col]: path });
    if (old) { _assets.delete(old); sb.storage.from("documents").remove([old]); }
    toast("Votre design est enregistré : il sera utilisé pour tous les " + (K === "devis" ? "devis" : "factures") + ". Vérifiez les marges avec l'aperçu.", "ok");
    await refresh();
    modelePreview(K);
  });
}
async function modeleDel(K) {
  if (!guard() || !confirm("Revenir au modèle classique Pilot pour les " + (K === "devis" ? "devis" : "factures") + " ?")) return;
  const col = K === "devis" ? "modele_devis_fichier" : "modele_facture_fichier", old = db.ent[col];
  await entPatch({ [col]: null });
  if (old) { _assets.delete(old); sb.storage.from("documents").remove([old]); }
  await refresh();
}
async function modelePreview(K) {
  toast("Génération de l'aperçu…");
  const ctx = await pdfContext(K);
  const bytes = await PilotPdf.build(PilotPdf.sample(K, db.ent), ctx);
  openPdfModal("Aperçu : " + (K === "devis" ? "devis" : "facture") + " avec vos paramètres", bytes, `apercu-${K}.pdf`);
}
