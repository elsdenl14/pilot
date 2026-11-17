/* v16 · Sous-traitance et collaboration externe :
   dossier administratif des sous-traitants, situations de sous-traitants, offres de sous-traitance et candidatures. */

/* ---------- Dossier administratif ---------- */
// [type, validité par défaut en mois à partir de la date d'émission (0 = aucune), champ historique de la fiche, obligatoire]
const STO_TYPES = [
  ["Extrait Kbis", 3, null, true],
  ["Attestation de vigilance URSSAF", 6, "vigilance_urssaf_fin", true],
  ["Assurance décennale", 12, "assurance_decennale_fin", true],
  ["Assurance RC pro", 12, "assurance_rc_fin", true],
  ["Contrat de sous-traitance", 0, null, true],
  ["Attestation fiscale", 6, null, false],
  ["Acte spécial de sous-traitance (DC4)", 0, null, false],
  ["Qualification / certification (RGE, Qualibat…)", 12, null, false],
  ["RIB", 0, null, false],
  ["Autre document", 0, null, false],
];
const stoReq = STO_TYPES.filter((t) => t[3]).map((t) => t[0]);
const stoPieces = (id) => (db.stPieces || []).filter((p) => p.sous_traitant_id === id);
const stoAddMonths = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 10); };
function stoBest(stId, type) {
  const l = stoPieces(stId).filter((p) => p.type === type);
  return l.sort((a, b) => String(b.date_validite || "9999").localeCompare(String(a.date_validite || "9999")) || String(b.created_at).localeCompare(String(a.created_at)))[0] || null;
}
function stoState(p) {
  if (!p) return { k: "dn", l: "Manquant", n: null, miss: true };
  if (!p.date_validite) return { k: "ok", l: p.fichier ? "Au dossier" : "Sans échéance", n: null };
  const x = docState(p.date_validite);
  return { ...x, l: x.k === "ok" ? `Valide jusqu'au ${D(p.date_validite)}` : x.l };
}
function stoDossier(s) {
  const rows = stoReq.map((t) => { const p = stoBest(s.id, t); return { t, p, x: stoState(p) }; });
  const ko = rows.filter((r) => r.x.k === "dn"), wn = rows.filter((r) => r.x.k === "wn");
  return { rows, ko, wn, ok: !ko.length && !wn.length, label: ko.length ? "À régulariser" : wn.length ? "À renouveler" : "Complet" };
}
const stoChipK = (d) => (d.ko.length ? "dn" : d.wn.length ? "wn" : "ok");

function stoPieceForm(stId, p) {
  if (!guard()) return;
  modal(p ? "Modifier la pièce" : "Ajouter une pièce au dossier", `<div class="frm">
    ${fld({ k: "type", l: "Type de pièce", t: "select", o: STO_TYPES.map((t) => t[0]), v: p?.type || "Extrait Kbis", cls: "full" })}
    ${fld({ k: "libelle", l: "Libellé (facultatif)", v: p?.libelle || "", r: 0 })}${fld({ k: "numero", l: "N° / référence", v: p?.numero || "", r: 0, hint: "N° de police, code de sécurité de l'attestation…" })}
    ${fld({ k: "date_emission", l: "Date d'émission", t: "date", v: p?.date_emission || today(), r: 0 })}${fld({ k: "date_validite", l: "Fin de validité", t: "date", v: p?.date_validite || "", r: 0, hint: "Proposée selon le type de pièce, modifiable." })}
    <label class="fl full"><span>Fichier (PDF, photo)${p?.fichier ? " : un fichier est déjà au dossier" : ""}</span><input type="file" id="f_file" name="file" accept=".pdf,image/*"></label>
    ${fld({ k: "notes", l: "Notes", t: "textarea", v: p?.notes || "", r: 0, cls: "full" })}</div>
    <p class="note" style="margin:10px 0 0">Attestation de vigilance : contrôlez son authenticité sur le site de l'URSSAF avec le code de sécurité figurant sur le document.</p>`, {
    wide: true,
    onMount: (m) => {
      const sug = () => {
        const t = STO_TYPES.find((x) => x[0] === $("#f_type", m).value), e = $("#f_date_emission", m).value;
        if (!p && t && t[1] && e) $("#f_date_validite", m).value = stoAddMonths(e, t[1]);
      };
      $("#f_type", m).onchange = sug; $("#f_date_emission", m).onchange = sug; if (!p) sug();
    },
    onSubmit: async (v, api) => {
      const file = $("#f_file", api.el).files[0];
      let path = p?.fichier || null;
      if (file) path = await uploadDoc(file, "sous-traitants");
      const row = { sous_traitant_id: stId, type: v.type, libelle: v.libelle || null, numero: v.numero || null, date_emission: v.date_emission || null, date_validite: v.date_validite || null, fichier: path, notes: v.notes || null };
      if (p) await q(sb.from("st_pieces").update(row).eq("id", p.id)); else await q(sb.from("st_pieces").insert(row));
      // la fiche historique (assurances, vigilance) reste cohérente : alertes et priorités de l'accueil continuent de fonctionner
      const legacy = STO_TYPES.find((t) => t[0] === v.type)?.[2], st = byId(db.sts, stId);
      if (legacy && v.date_validite && (!st?.[legacy] || v.date_validite >= st[legacy])) await q(sb.from("sous_traitants").update({ [legacy]: v.date_validite }).eq("id", stId));
      api.close(); toast("Pièce enregistrée.", "ok"); await refresh();
    },
    extra: p ? btn("Supprimer", "stoPieceDel", p.id, "", "lk dn") : "",
  });
}
function stoDossierCard(s) {
  if (!db.v16) return "";
  const d = stoDossier(s), ps = stoPieces(s.id).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const miss = d.rows.filter((r) => r.x.miss).map((r) => r.t);
  return card(`Dossier administratif <span class="chip ${stoChipK(d)}">${d.label}</span>`,
    tbl(["Pièce", "N°", "Validité", ""], ps.map((p) => { const x = stoState(p); return { act: "stoPieceEdit", id: p.id, t: p.type, c: [`<strong>${esc(p.type)}</strong>${p.libelle ? `<small>${esc(p.libelle)}</small>` : ""}`, esc(p.numero || "-"), `<span class="chip ${x.k}">${esc(x.l)}</span>`, p.fichier ? btn("Ouvrir", "stoPieceOpen", p.id, "", "lk") : ""] }; }), "Aucune pièce au dossier.")
    + (miss.length ? `<p class="note" style="margin:0;padding:12px 18px"><b>Manquant :</b> ${miss.map(esc).join(", ")}. ${btn("Demander par email", "stoRelance", s.id, "", "lk")}</p>` : ""),
    btn("Ajouter une pièce", "stoPieceNew", s.id, "", "lk w"));
}
function stoRelance(id) {
  const s = byId(db.sts, id), d = stoDossier(s), need = d.rows.filter((r) => r.x.k !== "ok").map((r) => `- ${r.t} (${r.x.miss ? "manquant" : r.x.l.toLowerCase()})`);
  if (!need.length) return toast("Le dossier est complet.", "ok");
  const body = `Bonjour,\n\nPour mettre à jour votre dossier de sous-traitant, merci de nous transmettre :\n${need.join("\n")}\n\nCordialement,\n${db.ent.nom || ""}`;
  window.open(`mailto:${encodeURIComponent(s.email || "")}?subject=${encodeURIComponent("Dossier de sous-traitant : pièces à fournir")}&body=${encodeURIComponent(body)}`, "_blank");
}
V.stdossiers = () => {
  if (!db.v16) return page("Dossiers sous-traitants", "", "", card("", stoSetup()));
  const sts = db.sts.filter((s) => s.actif !== false), ds = sts.map((s) => ({ s, d: stoDossier(s) }));
  const head = ["Sous-traitant", ...stoReq.map((t) => t.replace("Attestation de vigilance URSSAF", "Vigilance").replace("Extrait ", "").replace("Assurance ", "").replace("Contrat de sous-traitance", "Contrat")), "Dossier"];
  const rows = ds.map(({ s, d }) => ({ go: `soustraitants/${s.id}`, t: s.nom, c: [`<strong>${esc(s.nom)}</strong><small>${esc(s.metier || "")}</small>`, ...d.rows.map((r) => `<span class="chip ${r.x.k}" title="${esc(r.x.l)}">${r.x.miss ? "Manquant" : r.x.k === "ok" ? "OK" : r.x.k === "wn" ? `${r.x.n} j` : "Expiré"}</span>`), `<span class="chip ${stoChipK(d)}">${d.label}</span>`] }));
  return page("Dossiers sous-traitants", "Pièces et dates de validité de chaque sous-traitant actif.", "",
    strip([["Dossiers complets", ds.filter((x) => x.d.ok).length, `sur ${ds.length}`], ["À renouveler (30 j)", ds.filter((x) => !x.d.ko.length && x.d.wn.length).length, "pièces bientôt échues", ds.some((x) => x.d.wn.length) ? "" : ""], ["À régulariser", ds.filter((x) => x.d.ko.length).length, "pièces manquantes ou expirées", ds.some((x) => x.d.ko.length) ? "dn" : ""]])
    + searchBar("Rechercher un sous-traitant…", `${rows.length}`) + card("", tbl(head, rows, "Aucun sous-traitant actif.")));
};

/* ---------- Situations de sous-traitants ---------- */
const STS_STATUTS = ["Reçue", "Vérifiée", "Contestée", "Payée"];
const stsOf = (stId) => (db.stSits || []).filter((x) => x.sous_traitant_id === stId);
const stsPrev = (mid, stId, excl) => Math.max(0, ...(db.stSits || []).filter((x) => x.id !== excl && (mid ? x.mission_id === mid : x.sous_traitant_id === stId && !x.mission_id)).map((x) => Number(x.cumul_ht) || 0));
function stsCalc(o) {
  const ht = Math.max(0, r2(o.cumul - o.prev)), tva = o.auto ? 0 : r2((ht * o.taux) / 100), ttc = r2(ht + tva), ret = r2((ttc * o.ret) / 100);
  return { ht, tva, ttc, ret, net: r2(ttc - ret) };
}
function stsForm(s, pre = {}) {
  if (!guard()) return;
  const v0 = { ...pre, ...(s || {}) };
  if (!db.sts.length) return toast("Créez d'abord une fiche sous-traitant.", "dn");
  const mOpts = (stId) => [{ v: "", l: "Sans mission rattachée" }, ...db.stm.filter((m) => m.sous_traitant_id === stId && m.statut !== "Annulée").map((m) => ({ v: m.id, l: `${m.objet}${m.chantier_id ? " · " + chNm(m.chantier_id) : ""}` }))];
  const stId0 = v0.sous_traitant_id || db.sts[0].id;
  modal(s ? "Modifier la situation" : "Enregistrer une situation reçue", `<div class="frm">
    ${fld({ k: "sous_traitant_id", l: "Sous-traitant", t: "select", o: db.sts.map((x) => ({ v: x.id, l: x.nom })), v: stId0 })}
    ${fld({ k: "mission_id", l: "Mission", t: "select", o: mOpts(stId0), v: v0.mission_id || "", r: 0 })}
    ${fld({ k: "chantier_id", l: "Chantier", t: "select", o: chOpts("Aucun chantier"), v: v0.chantier_id || "", r: 0, hint: "Repris de la mission si elle en a un." })}
    ${fld({ k: "numero", l: "N° de situation", v: v0.numero || "", r: 0 })}${fld({ k: "date_situation", l: "Date de la situation", t: "date", v: v0.date_situation || today() })}
    ${fld({ k: "periode", l: "Période (ex. octobre 2026)", v: v0.periode || "", r: 0 })}
    ${fld({ k: "cumul_ht", l: "Montant cumulé HT à date (€)", t: "number", v: v0.cumul_ht ? String(v0.cumul_ht).replace(".", ",") : "", hint: "Le total de tous les travaux réalisés depuis le début, tel qu'annoncé par le sous-traitant." })}
    <label class="fl"><span>Déjà reçu avant cette situation (€ HT)</span><input type="text" id="f_prev" readonly></label>
    ${fld({ k: "tva_taux", l: "Taux de TVA", t: "select", o: ["20", "10", "5.5", "0"].map((x) => ({ v: x, l: x.replace(".", ",") + " %" })), v: String(v0.tva_taux ?? 20) })}
    ${fld({ k: "retenue_pct", l: "Retenue de garantie (%)", t: "number", v: v0.retenue_pct != null ? String(v0.retenue_pct).replace(".", ",") : "", r: 0 })}
    <label class="chk full" style="display:flex;gap:8px"><input type="checkbox" name="autoliquidation" ${v0.autoliquidation === false ? "" : "checked"}> <span>Autoliquidation de la TVA (sous-traitance du bâtiment : le sous-traitant facture sans TVA, vous la déclarez vous-même). À vérifier avec votre comptable.</span></label>
    <div class="full" id="stosum"></div>
    <label class="fl full"><span>Situation reçue (PDF, photo)${v0.fichier ? " : fichier déjà joint" : ""}</span><input type="file" id="f_file" name="file" accept=".pdf,image/*"></label>
    ${fld({ k: "statut", l: "Statut", t: "select", o: STS_STATUTS, v: v0.statut || "Reçue" })}${fld({ k: "notes", l: "Notes", t: "textarea", v: v0.notes || "", r: 0 })}</div>`, {
    wide: true,
    onMount: (m) => {
      const g = (k) => $(`#f_${k}`, m), auto = () => $('[name="autoliquidation"]', m).checked;
      const calc = () => {
        const prev = stsPrev(g("mission_id").value || null, g("sous_traitant_id").value, s?.id);
        $("#f_prev", m).value = fmtNum(prev, 2);
        const c = stsCalc({ cumul: parseNum(g("cumul_ht").value), prev, taux: parseNum(g("tva_taux").value), auto: auto(), ret: parseNum(g("retenue_pct").value) });
        $("#stosum", m).innerHTML = `<p class="note" style="margin:0">Cette situation : <b>${E2(c.ht)} HT</b> · TVA ${E2(c.tva)}${auto() ? " (autoliquidée)" : ""} · TTC ${E2(c.ttc)} · retenue ${E2(c.ret)} · <b>net à payer ${E2(c.net)}</b></p>`;
      };
      g("sous_traitant_id").onchange = () => { g("mission_id").innerHTML = mOpts(g("sous_traitant_id").value).map((o) => `<option value="${esc(o.v)}">${esc(o.l)}</option>`).join(""); calc(); };
      g("mission_id").onchange = () => {
        const ms = byId(db.stm, g("mission_id").value);
        if (ms) { if (ms.chantier_id) g("chantier_id").value = ms.chantier_id; if (!g("retenue_pct").value) g("retenue_pct").value = String(ms.retenue_pct || 0).replace(".", ","); }
        calc();
      };
      ["cumul_ht", "tva_taux", "retenue_pct"].forEach((k) => { g(k).oninput = calc; g(k).onchange = calc; });
      $('[name="autoliquidation"]', m).onchange = calc;
      if (!s) { const ms0 = byId(db.stm, g("mission_id").value); if (ms0 && !g("retenue_pct").value) g("retenue_pct").value = String(ms0.retenue_pct || 0).replace(".", ","); }
      calc();
    },
    onSubmit: async (v, api) => {
      const mid = v.mission_id || null, prev = stsPrev(mid, v.sous_traitant_id, s?.id), cumul = parseNum(v.cumul_ht);
      if (cumul < prev) throw new Error(`Le cumul (${E2(cumul)}) ne peut pas être inférieur à ce qui a déjà été reçu (${E2(prev)}).`);
      const ms = byId(db.stm, mid);
      if (ms && ms.montant_ht > 0 && cumul > ms.montant_ht * 1.0001 && !confirm(`Le cumul dépasse le montant convenu de la mission (${E2(ms.montant_ht)} HT). Enregistrer quand même ?`)) return;
      const c = stsCalc({ cumul, prev, taux: parseNum(v.tva_taux), auto: "autoliquidation" in v, ret: parseNum(v.retenue_pct) });
      const file = $("#f_file", api.el).files[0];
      let path = s?.fichier || null;
      if (file) path = await uploadDoc(file, "situations-st");
      const row = { sous_traitant_id: v.sous_traitant_id, mission_id: mid, chantier_id: v.chantier_id || ms?.chantier_id || null, numero: v.numero || null, date_situation: v.date_situation, periode: v.periode || null,
        cumul_ht: cumul, precedent_ht: prev, montant_ht: c.ht, tva_taux: parseNum(v.tva_taux), autoliquidation: "autoliquidation" in v, tva_montant: c.tva, montant_ttc: c.ttc,
        retenue_pct: parseNum(v.retenue_pct), retenue_eur: c.ret, net_a_payer: c.net, statut: v.statut, fichier: path, notes: v.notes || null };
      if (s) await q(sb.from("st_situations").update(row).eq("id", s.id)); else await q(sb.from("st_situations").insert(row));
      api.close(); toast("Situation enregistrée.", "ok"); await refresh();
    },
    extra: s ? btn("Supprimer", "stsDel", s.id, "", "lk dn") : "",
  });
}
async function stsCreerDepense(id) {
  if (!guard()) return;
  const x = byId(db.stSits, id), st = byId(db.sts, x.sous_traitant_id);
  if (x.depense_id) return toast("Une dépense est déjà rattachée.", "dn");
  const cat = (typeof PilotPdf !== "undefined" && PilotPdf.CATEGORIES.find((c) => /sous/i.test(c))) || "Autre";
  const dep = await q(sb.from("depenses").insert({ fournisseur: st.nom, reference: `Situation ${x.numero || ""}`.trim(), categorie: cat, type: "Achat", chantier_id: x.chantier_id || null, date_depense: x.date_situation,
    montant_ht: x.montant_ht, montant_tva: x.tva_montant, statut: "À payer", notes: `Situation de sous-traitant${x.periode ? " " + x.periode : ""}. Retenue de garantie ${E2(x.retenue_eur)} à ne pas verser avant la fin de garantie.${x.autoliquidation ? " TVA autoliquidée." : ""}` }).select("id").single());
  await q(sb.from("st_situations").update({ depense_id: dep.id, statut: x.statut === "Reçue" ? "Vérifiée" : x.statut }).eq("id", id));
  toast("Dépense créée dans les achats.", "ok"); await refresh();
}
async function stsPayee(id) {
  if (!guard()) return;
  const x = byId(db.stSits, id);
  await q(sb.from("st_situations").update({ statut: "Payée" }).eq("id", id));
  if (x.depense_id) await q(sb.from("depenses").update({ statut: "Payée", date_paiement: today(), mode: "Virement" }).eq("id", x.depense_id));
  toast("Situation marquée payée.", "ok"); await refresh();
}
const stsRow = (x, withSt = true) => ({ act: "stsEdit", id: x.id, t: `${chNm(x.chantier_id)} ${byId(db.sts, x.sous_traitant_id)?.nom || ""} ${x.numero || ""}`,
  c: [D(x.date_situation), ...(withSt ? [`<strong>${esc(byId(db.sts, x.sous_traitant_id)?.nom || "?")}</strong>`] : []), esc(chNm(x.chantier_id) || "-"), esc(x.numero || "-"), `<span class="num">${E2(x.montant_ht)}</span>`, `<span class="num">${E2(x.cumul_ht)}</span>`, `<span class="num">${E2(x.net_a_payer)}</span>`, chip(x.statut)] });
function stoSituationsCard(s) {
  if (!db.v16) return "";
  const l = stsOf(s.id).sort((a, b) => String(b.date_situation).localeCompare(String(a.date_situation)));
  return card("Situations reçues", tbl(["Date", "Chantier", "N°", { h: "Période HT", r: 1 }, { h: "Cumul HT", r: 1 }, { h: "Net à payer", r: 1 }, "Statut"], l.map((x) => stsRow(x, false)), "Aucune situation enregistrée."), btn("Enregistrer une situation", "stsNew", s.id, "", "lk w"));
}
function stoChantierCard(cid) {
  if (!db.v16) return "";
  const l = (db.stSits || []).filter((x) => x.chantier_id === cid).sort((a, b) => String(b.date_situation).localeCompare(String(a.date_situation)));
  if (!l.length) return "";
  return card("Situations de sous-traitants", tbl(["Date", "Sous-traitant", "Chantier", "N°", { h: "Période HT", r: 1 }, { h: "Cumul HT", r: 1 }, { h: "Net à payer", r: 1 }, "Statut"], l.map((x) => stsRow(x)), ""), `<b class="num">${E2(sum(l, (x) => x.montant_ht))} HT</b>`);
}
V.stsituations = () => {
  if (!db.v16) return page("Situations sous-traitants", "", "", card("", stoSetup()));
  const l = [...(db.stSits || [])].sort((a, b) => String(b.date_situation).localeCompare(String(a.date_situation)));
  const aVerif = l.filter((x) => x.statut === "Reçue" || x.statut === "Contestée");
  const mois = today().slice(0, 7);
  return page("Situations sous-traitants", "Situations transmises par vos sous-traitants, rattachées à leurs chantiers.", btn("Enregistrer une situation", "stsNew", "", "", "w"),
    strip([["Reçues ce mois", E(sum(l.filter((x) => x.date_situation.startsWith(mois)), (x) => x.montant_ht)), "HT"], ["À vérifier", aVerif.length, E(sum(aVerif, (x) => x.net_a_payer)) + " net", aVerif.length ? "" : ""], ["Retenues de garantie", E(sum(l, (x) => x.retenue_eur)), "cumulées, à restituer"], ["Reste à payer", E(sum(l.filter((x) => x.statut !== "Payée"), (x) => x.net_a_payer)), "situations non payées"]])
    + searchBar("Rechercher un sous-traitant, un chantier…", `${l.length}`) + card("", tbl(["Date", "Sous-traitant", "Chantier", "N°", { h: "Période HT", r: 1 }, { h: "Cumul HT", r: 1 }, { h: "Net à payer", r: 1 }, "Statut"], l.map((x) => stsRow(x)), "Aucune situation enregistrée.")));
};

/* ---------- Offres de sous-traitance et candidatures ---------- */
const stoPubLink = (token) => new URL("p.html?o=" + token, location.href).href;
const stoSiretOk = (s) => { const d = String(s || "").replace(/\s/g, ""); if (!/^\d{14}$/.test(d)) return false; let t = 0; for (let i = 0; i < 14; i++) { let n = +d[i]; if (i % 2 === 0) { n *= 2; if (n > 9) n -= 9; } t += n; } return t % 10 === 0 || d.startsWith("356000000"); };
const stoCands = (oid) => (db.cands || []).filter((c) => c.offre_id === oid);
function offreForm(o) {
  if (!guard()) return;
  modal(o ? "Modifier l'offre" : "Nouvelle offre de sous-traitance", `<div class="frm">
    ${fld({ k: "titre", l: "Besoin (titre)", v: o?.titre, cls: "full", ph: "Ex. Carrelage 320 m², résidence Les Lilas" })}
    ${fld({ k: "metier", l: "Corps de métier", v: o?.metier || "", r: 0 })}${fld({ k: "chantier_id", l: "Chantier lié", t: "select", o: chOpts(), v: o?.chantier_id || "", r: 0 })}
    ${fld({ k: "lieu", l: "Lieu (ville, département)", v: o?.lieu || "", r: 0 })}${fld({ k: "duree", l: "Durée estimée", v: o?.duree || "", r: 0 })}
    ${fld({ k: "date_debut", l: "Démarrage souhaité", t: "date", v: o?.date_debut || "", r: 0 })}${fld({ k: "date_limite", l: "Date limite de candidature", t: "date", v: o?.date_limite || "", r: 0 })}
    ${fld({ k: "budget_ht", l: "Budget indicatif (€ HT)", t: "number", v: o?.budget_ht ? String(o.budget_ht).replace(".", ",") : "", r: 0 })}
    <label class="chk" style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="budget_visible" ${o?.budget_visible ? "checked" : ""}> <span>Afficher le budget aux candidats</span></label>
    ${fld({ k: "description", l: "Description du besoin", t: "textarea", v: o?.description || "", r: 0, cls: "full", rows: 5, hint: "Ne mentionnez pas d'information confidentielle sur votre client : la page est publique." })}</div>`, {
    wide: true,
    onSubmit: async (v, api) => {
      const row = { titre: v.titre.trim(), metier: v.metier || null, chantier_id: v.chantier_id || null, lieu: v.lieu || null, duree: v.duree || null, date_debut: v.date_debut || null, date_limite: v.date_limite || null,
        budget_ht: v.budget_ht ? parseNum(v.budget_ht) : null, budget_visible: "budget_visible" in v, description: v.description || null };
      if (o) await q(sb.from("st_offres").update(row).eq("id", o.id));
      else { const n = await q(sb.from("st_offres").insert(row).select("id").single()); api.close(); await refresh(); go("stoffres/" + n.id); return; }
      api.close(); toast("Offre enregistrée.", "ok"); await refresh();
    },
  });
}
function candForm(c) {
  if (!guard()) return;
  modal(`Candidature : ${esc(c.nom)}`, `<div class="frm">
    ${fld({ k: "statut", l: "Statut", t: "select", o: ["Reçue", "Présélectionnée", "Retenue", "Refusée"], v: c.statut })}
    ${fld({ k: "note", l: "Ma note (1 à 5)", t: "select", o: [{ v: "", l: "Non noté" }, 1, 2, 3, 4, 5], v: c.note || "", r: 0 })}</div>
    <dl class="kv" style="margin-top:12px"><dt>Contact</dt><dd>${esc(c.contact || "-")} · ${esc(c.telephone || "-")} · ${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : "-"}</dd>
    <dt>SIRET</dt><dd>${esc(c.siret || "-")} ${c.siret ? (stoSiretOk(c.siret) ? `<span class="chip ok">Format valide</span>` : `<span class="chip dn">Format invalide</span>`) : ""}</dd>
    <dt>Références</dt><dd style="white-space:pre-wrap">${esc(c.references_txt || "-")}</dd><dt>Message</dt><dd style="white-space:pre-wrap">${esc(c.message || "-")}</dd>
    <dt>Déclaré</dt><dd>Assurance : ${c.assurance_ok ? "oui" : "non"} · Vigilance URSSAF : ${c.vigilance_ok ? "oui" : "non"} <small class="mut">(déclaratif : à contrôler sur pièces)</small></dd></dl>`, {
    wide: true,
    extra: (c.sous_traitant_id ? "" : btn("Créer la fiche sous-traitant", "candToSt", c.id, "", "lk")) + btn("Supprimer", "candDel", c.id, "", "lk dn"),
    onSubmit: async (v, api) => { await q(sb.from("st_candidatures").update({ statut: v.statut, note: v.note ? Number(v.note) : null }).eq("id", c.id)); api.close(); await refresh(); },
  });
}
function offreDetail(id) {
  const o = byId(db.offres, id);
  if (!o) return `<div class="empty"><h2>Offre introuvable</h2><button class="btn" data-go="stoffres">Retour</button></div>`;
  const cs = stoCands(id), prix = cs.map((c) => Number(c.prix_ht)).filter((n) => n > 0), mini = prix.length ? Math.min(...prix) : null;
  const link = stoPubLink(o.token), known = (c) => c.siret && db.sts.find((s) => String(s.siret || "").replace(/\s/g, "") === c.siret);
  const rows = cs.sort((a, b) => (Number(a.prix_ht) || 1e12) - (Number(b.prix_ht) || 1e12)).map((c) => { const k = known(c); return { act: "candEdit", id: c.id, t: c.nom,
    c: [`<strong>${esc(c.nom)}</strong><small>${esc(c.metier || "")}${k ? " · déjà dans vos sous-traitants" : ""}</small>`, c.prix_ht ? `<span class="num${Number(c.prix_ht) === mini && prix.length > 1 ? " up" : ""}">${E2(c.prix_ht)}${Number(c.prix_ht) === mini && prix.length > 1 ? " ★" : ""}</span>` : "-",
      c.delai_jours ? `${c.delai_jours} j` : "-", c.siret ? (stoSiretOk(c.siret) ? `<span class="chip ok">SIRET</span>` : `<span class="chip dn">SIRET ?</span>`) : `<span class="chip mu">Sans SIRET</span>`,
      `${c.assurance_ok ? "Assur. ✓" : "Assur. ?"} · ${c.vigilance_ok ? "Vigil. ✓" : "Vigil. ?"}`, stStars(c.note), chip(c.statut)] }; });
  return page(`${esc(o.titre)} <span class="chip ${o.statut === "Ouverte" ? "ok" : "mu"}">${o.statut}</span>`, `${esc(o.metier || "Sous-traitance")}${o.lieu ? " · " + esc(o.lieu) : ""}`,
    btn("Modifier", "offreEdit", id, "", "o w") + (o.statut === "Ouverte" ? btn("Clôturer", "offreStatut", id, "Clôturée", "o w") : btn("Rouvrir", "offreStatut", id, "Ouverte", "o w")) + btn("Supprimer", "offreDel", id, "", "o w"),
    strip([["Candidatures", cs.length, `${cs.filter((c) => c.statut === "Reçue").length} à traiter`], ["Meilleur prix", mini ? E(mini) : "-", "HT proposé"], ["Budget indicatif", o.budget_ht ? E(o.budget_ht) : "-", o.budget_visible ? "visible des candidats" : "non affiché"], ["Date limite", o.date_limite ? D(o.date_limite) : "-", o.date_limite && o.date_limite < today() ? "dépassée" : ""]])
    + card("Publication", `<p style="margin:0 0 10px" class="mut">${o.publie ? "Le lien ci-dessous est actif : toute personne qui le possède peut candidater, sans compte. Envoyez-le à vos sous-traitants ou publiez-le sur votre site." : "L'offre n'est pas publiée : le lien est inactif."}</p>
      <div class="lnk-in"><input type="text" readonly value="${esc(link)}" id="stolk"><button type="button" class="btn o" data-act="offreCopy" data-id="${o.id}">Copier le lien</button>${btn(o.publie ? "Retirer la publication" : "Publier", "offrePub", id, "", o.publie ? "o w" : "w")}</div>`)
    + card("Comparer les candidatures", tbl(["Candidat", { h: "Prix HT", r: 1 }, "Délai", "SIRET", "Déclaré", "Note", "Statut"], rows, "Aucune candidature pour l'instant.")
      + `<p class="note" style="margin:0;padding:12px 18px">Les mentions « assurance » et « vigilance » sont déclaratives. Avant d'attribuer, exigez les pièces (attestation de vigilance, assurance décennale) et contrôlez-les : un candidat retenu devient une fiche sous-traitant avec son dossier administratif.</p>`),
    crumbs(["Offres de sous-traitance", "stoffres"], [o.titre]));
}
V.stoffres = (r) => {
  if (!db.v16) return page("Offres de sous-traitance", "", "", card("", stoSetup()));
  if (r.arg) return offreDetail(r.arg);
  const rows = [...(db.offres || [])].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).map((o) => { const n = stoCands(o.id).length; return { go: `stoffres/${o.id}`, t: o.titre, c: [`<strong>${esc(o.titre)}</strong><small>${esc(o.metier || "")}${o.lieu ? " · " + esc(o.lieu) : ""}</small>`, o.date_limite ? D(o.date_limite) : "-", `${n}`, o.publie ? `<span class="chip ok">Publiée</span>` : `<span class="chip mu">Non publiée</span>`, chip(o.statut)] }; });
  return page("Offres de sous-traitance", "Publiez un besoin, recevez des candidatures et comparez les profils.", btn("Nouvelle offre", "offreNew", "", "", "w"),
    strip([["Offres ouvertes", (db.offres || []).filter((o) => o.statut === "Ouverte").length, `${(db.offres || []).length} au total`], ["Candidatures à traiter", (db.cands || []).filter((c) => c.statut === "Reçue").length, "non encore examinées"]])
    + card("", tbl(["Besoin", "Date limite", { h: "Candidatures", r: 0 }, "Publication", "Statut"], rows, "Aucune offre. Créez-en une pour recevoir des candidatures.")));
};
function stoSetup() {
  return `<div class="empty"><h2>Mise à jour de la base à faire</h2><p>Exécutez <b>migration_v16.sql</b> dans Supabase > SQL Editor, puis rechargez Pilot.${db.v16err ? `<br><small class="mut">${esc(db.v16err)}</small>` : ""}</p></div>`;
}

const sousTraitanceActions = {
  stoPieceNew: (id) => stoPieceForm(id), stoPieceEdit: (id) => { const p = byId(db.stPieces, id); stoPieceForm(p.sous_traitant_id, p); },
  stoPieceOpen: (id) => openFile(byId(db.stPieces, id).fichier),
  stoPieceDel: async (id) => { if (!guard() || !confirm("Supprimer cette pièce du dossier ?")) return; await q(sb.from("st_pieces").delete().eq("id", id)); document.querySelectorAll(".md").forEach((m) => m.remove()); await refresh(); },
  stoRelance: (id) => stoRelance(id),
  stsNew: (id) => stsForm(null, id ? { sous_traitant_id: id } : {}), stsEdit: (id) => stsForm(byId(db.stSits, id)),
  stsDel: async (id) => { if (!guard() || !confirm("Supprimer cette situation ?")) return; await q(sb.from("st_situations").delete().eq("id", id)); document.querySelectorAll(".md").forEach((m) => m.remove()); await refresh(); },
  stsDep: (id) => stsCreerDepense(id), stsPaid: (id) => stsPayee(id),
  offreNew: () => offreForm(null), offreEdit: (id) => offreForm(byId(db.offres, id)),
  offreDel: (id) => del("st_offres", id, "Supprimer cette offre et ses candidatures ?", "stoffres"),
  offreStatut: async (id, arg) => { if (!guard()) return; await q(sb.from("st_offres").update({ statut: arg }).eq("id", id)); await refresh(); },
  offrePub: async (id) => { if (!guard()) return; const o = byId(db.offres, id); await q(sb.from("st_offres").update({ publie: !o.publie }).eq("id", id)); toast(o.publie ? "Publication retirée." : "Offre publiée : le lien est actif.", "ok"); await refresh(); },
  offreCopy: async (id) => { const o = byId(db.offres, id), l = stoPubLink(o.token); try { await navigator.clipboard.writeText(l); toast("Lien copié.", "ok"); } catch (e) { $("#stolk")?.select(); } },
  candEdit: (id) => candForm(byId(db.cands, id)),
  candDel: async (id) => { if (!guard() || !confirm("Supprimer cette candidature ?")) return; await q(sb.from("st_candidatures").delete().eq("id", id)); document.querySelectorAll(".md").forEach((m) => m.remove()); await refresh(); },
  candToSt: async (id) => {
    if (!guard()) return;
    const c = byId(db.cands, id), o = byId(db.offres, c.offre_id);
    const st = await q(sb.from("sous_traitants").insert({ nom: c.nom, metier: c.metier || o?.metier || null, siret: c.siret || null, contact: c.contact || null, telephone: c.telephone || null, email: c.email || null, notes: `Issu de l'offre « ${o?.titre || ""} ». Pièces à contrôler.`, actif: true }).select("id").single());
    await q(sb.from("st_candidatures").update({ sous_traitant_id: st.id, statut: "Retenue" }).eq("id", id));
    document.querySelectorAll(".md").forEach((m) => m.remove()); toast("Fiche sous-traitant créée : complétez son dossier administratif.", "ok"); await refresh(); go("soustraitants/" + st.id);
  },
};

/* Alertes de l'accueil : pièces obligatoires manquantes ou échues pour les sous-traitants ayant une mission active */
function stoPriorites(add, t) {
  if (!db.v16 || !db.v12) return;
  for (const s of db.sts) {
    if (s.actif === false || !db.stm.some((m) => m.sous_traitant_id === s.id && ["Prévue", "En cours"].includes(m.statut))) continue;
    const d = stoDossier(s);
    if (d.ko.length) add("i", 130, `Dossier incomplet : ${s.nom}`, d.ko.map((r) => r.t).join(", "), 0, null, `soustraitants/${s.id}`);
  }
  const nv = (db.stSits || []).filter((x) => x.statut === "Reçue").length;
  if (nv) add("s", 131, `${nv} situation${nv > 1 ? "s" : ""} de sous-traitant à vérifier`, "Situations reçues non vérifiées", 0, null, "stsituations");
  const nc = (db.cands || []).filter((c) => c.statut === "Reçue").length;
  if (nc) add("s", 132, `${nc} candidature${nc > 1 ? "s" : ""} à examiner`, "Offres de sous-traitance", 0, null, "stoffres");
}
