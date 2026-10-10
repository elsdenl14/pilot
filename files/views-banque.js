/* Banque : import de relevés (CSV / OFX), solde, rapprochement des opérations avec les factures et les dépenses.
   Pilot ne se connecte pas directement à la banque : l'utilisateur importe le relevé exporté depuis son espace bancaire. */

const bkSt = () => (ST.bk ||= { compte: "all", flow: "all", limit: 50 });
const bkNorm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const bkAlnum = (s) => bkNorm(s).replace(/ /g, "");
const setupV6b = () => setupV6();

/* ===================== Lecture des relevés ===================== */
function bkDecode(buf) {
  const u = new Uint8Array(buf);
  try { return new TextDecoder("utf-8", { fatal: true }).decode(u).replace(/^﻿/, ""); } catch (e) { return new TextDecoder("windows-1252").decode(u); }
}
function bkNum(s) {
  s = String(s ?? "").trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[\s  €$£]|EUR/gi, "");
  if (/-$/.test(s)) { neg = true; s = s.slice(0, -1); }
  if (s[0] === "-") { neg = true; s = s.slice(1); } else if (s[0] === "+") s = s.slice(1);
  if (!s) return null;
  const lc = s.lastIndexOf(","), ld = s.lastIndexOf(".");
  if (lc >= 0 && ld >= 0) s = lc > ld ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (lc >= 0) s = s.replace(/,/g, (m, i) => (i === lc ? "." : ""));
  else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const v = parseFloat(s);
  return neg ? -v : v;
}
function bkDate(s) {
  s = String(s ?? "").trim();
  let m, y, mo, d;
  if ((m = s.match(/^(\d{4})[-/.]?(\d{2})[-/.]?(\d{2})(?!\d)/))) [y, mo, d] = [m[1], m[2], m[3]];
  else if ((m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4}|\d{2})(?!\d)/))) { d = m[1]; mo = m[2]; y = m[3].length === 2 ? "20" + m[3] : m[3]; }
  else return null;
  y = +y; mo = +mo; d = +d;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1) return null;
  return `${y}-${pad2(mo)}-${pad2(d)}`;
}
function bkDelim(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 25);
  let best = ";", bn = -1;
  for (const d of [";", "\t", ",", "|"]) {
    let n = 0;
    for (const l of lines) {
      let q = false, c = 0;
      for (const ch of l) { if (ch === '"') q = !q; else if (ch === d && !q) c++; }
      n += (c > 0 ? 1 : 0) + c * 0.01;
    }
    if (n > bn) { bn = n; best = d; }
  }
  return best;
}
function bkCsvRows(text, delim) {
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}
function bkParseCsv(text) {
  const rows = bkCsvRows(text, bkDelim(text));
  let map = null, hi = -1;
  for (let i = 0; i < Math.min(rows.length, 60) && !map; i++) {
    const h = rows[i].map(bkNorm);
    const pick = (res) => { for (const re of res) { const k = h.findIndex((x) => re.test(x)); if (k >= 0) return k; } return -1; };
    const date = pick([/^date (de l )?(operation|comptabilisation|transaction|op)\b/, /^date$/, /^date\b(?!.*valeur)/, /^date/]);
    const deb = pick([/^(montant )?debit/, /^sorties?$/, /^retrait/]);
    const cre = pick([/^(montant )?credit/, /^entrees?$/, /^depot/]);
    let amt = h.findIndex((x, k) => k !== deb && k !== cre && /^(montant|amount|somme)(\b|$)/.test(x));
    const label = h.map((x, k) => (/(libelle|description|intitule|detail|memo|information|motif|objet|reference|beneficiaire|tiers|designation|^nom\b|type (d )?operation|^operation$)/.test(x) && !/(date|montant|solde|devise|categorie|cheque|numero)/.test(x) && k !== date ? k : -1)).filter((k) => k >= 0);
    const sens = h.findIndex((x) => /^(sens|d c|debit credit)$/.test(x));
    if (date >= 0 && label.length && (amt >= 0 || deb >= 0 || cre >= 0)) { map = { date, deb, cre, amt, label, sens }; hi = i; }
  }
  if (!map) throw new Error("Colonnes non reconnues. Le fichier doit avoir une ligne d'en-tête avec une colonne Date, un Libellé et un Montant (ou Débit / Crédit).");
  const out = [];
  for (const r of rows.slice(hi + 1)) {
    const date = bkDate(r[map.date]);
    if (!date) continue;
    let m;
    if (map.amt >= 0 && bkNum(r[map.amt]) !== null) {
      m = bkNum(r[map.amt]);
      if (map.sens >= 0 && /^d/i.test(String(r[map.sens]).trim()) && m > 0) m = -m;
    } else {
      const c = map.cre >= 0 ? bkNum(r[map.cre]) || 0 : 0, d = map.deb >= 0 ? bkNum(r[map.deb]) || 0 : 0;
      m = c - Math.abs(d);
    }
    if (!m) continue;
    const seen = new Set();
    const libelle = map.label.map((k) => String(r[k] ?? "").replace(/\s+/g, " ").trim()).filter((x) => x && !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase())).join(" ");
    out.push({ date, libelle: libelle || "(sans libellé)", montant: r2(m) });
  }
  return { rows: out, format: "CSV" };
}
function bkParseOfx(text) {
  const tag = (b, n) => { const m = b.match(new RegExp("<" + n + ">([^<\\r\\n]*)", "i")); return m ? m[1].trim() : ""; };
  const dec = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
  const out = [];
  for (const b of text.split(/<STMTTRN>/i).slice(1)) {
    const date = bkDate(tag(b, "DTPOSTED").slice(0, 8));
    const m = bkNum(tag(b, "TRNAMT"));
    if (!date || !m) continue;
    const parts = [tag(b, "NAME"), tag(b, "MEMO")].map(dec).filter(Boolean);
    out.push({ date, libelle: [...new Set(parts)].join(" ").replace(/\s+/g, " ") || "(sans libellé)", montant: r2(m) });
  }
  if (!out.length) throw new Error("Aucune opération trouvée dans ce fichier OFX.");
  const bal = bkNum(tag(text.slice(Math.max(0, text.search(/<LEDGERBAL>/i))), "BALAMT"));
  const iban = tag(text, "ACCTID");
  return { rows: out, format: "OFX", balance: /<LEDGERBAL>/i.test(text) ? bal : null, iban: /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/i.test(iban) ? iban.toUpperCase() : "" };
}
function bkParse(buf) {
  const text = bkDecode(buf);
  const r = /<OFX>|OFXHEADER|<STMTTRN>/i.test(text) ? bkParseOfx(text) : bkParseCsv(text);
  if (!r.rows.length) throw new Error("Aucune opération exploitable dans ce fichier.");
  const ds = r.rows.map((x) => x.date).sort();
  return { ...r, from: ds[0], to: ds[ds.length - 1] };
}
// Compte les opérations déjà connues par (date, montant) : un relevé qui se recoupe, même au format différent, n'est jamais importé deux fois.
function bkPlan(rows, existing) {
  const have = new Map();
  for (const t of existing) { const k = `${t.date_op}|${Math.round(t.montant * 100)}`; have.set(k, (have.get(k) || 0) + 1); }
  const seen = new Map();
  const fresh = [];
  let dup = 0;
  for (const r of rows) {
    const k = `${r.date}|${Math.round(r.montant * 100)}`, n = seen.get(k) || 0;
    seen.set(k, n + 1);
    if (n < (have.get(k) || 0)) { dup++; continue; }
    fresh.push({ ...r, ref: `${k}|${n}` });
  }
  return { fresh, dup };
}

/* ===================== Comptes et soldes ===================== */
const bkAcc = (id) => byId(db.comptes, id);
const bkTxOf = (id) => db.bankTx.filter((t) => t.compte_id === id);
const bkSolde = (a) => r2((Number(a.solde_initial) || 0) + sum(bkTxOf(a.id), (t) => t.montant));
const bkMask = (iban) => { const s = String(iban || "").replace(/\s/g, ""); return s.length > 8 ? `${s.slice(0, 4)} •••• ${s.slice(-4)}` : s; };
const bkPending = (cid) => db.bankTx.filter((t) => t.statut === "À rapprocher" && (!cid || cid === "all" || t.compte_id === cid));

/* ===================== Rapprochement : suggestions ===================== */
const BK_STOP = new Set(["sarl", "sas", "sasu", "eurl", "sa", "snc", "ets", "etablissements", "entreprise", "societe", "monsieur", "madame", "mme", "mlle", "mr", "des", "les", "groupe", "ste", "cie", "epoux", "famille", "consorts", "the", "and", "vir", "sepa", "cb"]);
function bkNameScore(name, L) {
  const toks = bkNorm(name).split(" ").filter((t) => t.length >= 3 && !BK_STOP.has(t));
  if (!toks.length) return 0;
  const words = L.split(" ");
  const hit = (t) => words.some((w) => w === t || (t.length >= 5 && w.startsWith(t)) || (w.length >= 5 && t.startsWith(w)));
  const n = toks.filter(hit).length, ratio = n / toks.length;
  return ratio === 1 ? 35 : ratio >= 0.5 ? 22 : n ? 12 : 0;
}
const bkLevel = (s) => (s >= 85 ? "c" : s >= 55 ? "p" : s >= 40 ? "s" : null);
const BK_LV = { c: ["Correspondance certaine", "ok"], p: ["Correspondance probable", "ac"], s: ["Correspondance possible", "wn"] };
const bkDown = (l) => (l === "c" ? "p" : "s");

function bkCtx() {
  const linkedPay = new Set(db.bankTx.filter((t) => t.paiement_id).map((t) => t.paiement_id));
  const linkedDep = new Set(db.bankTx.filter((t) => t.depense_id).map((t) => t.depense_id));
  return { openF: ouvertes().filter((f) => f.reste > 0.005), pays: db.paiements.filter((p) => !linkedPay.has(p.id)), deps: db.depenses.filter((d) => !linkedDep.has(d.id)) };
}
const bkFExact = (f, amt) => {
  if (Math.abs(amt - f.reste) < 0.005) return "solde";
  const pe = typeof prochEch === "function" ? prochEch(f) : null;
  return pe && Math.abs(amt - pe.reste) < 0.005 ? "échéance" : "";
};
function bkCands(tx, cx) {
  const L = bkNorm(tx.libelle), LA = L.replace(/ /g, "");
  const out = [];
  if (tx.montant > 0) {
    const amt = tx.montant;
    const exactF = cx.openF.filter((f) => bkFExact(f, amt));
    for (const f of cx.openF) {
      if (amt > f.reste + 0.005) continue; // une facture ne peut pas être payée au-delà de son reste dû
      const ex = bkFExact(f, amt), why = [];
      let s = 0;
      if (ex) { s += 50; why.push(ex === "solde" ? "montant égal au reste dû" : "montant égal à l'échéance"); if (exactF.length === 1) s += 10; }
      else { s += 8; why.push("paiement partiel"); }
      const na = bkAlnum(f.numero);
      if (na.length >= 5 && LA.includes(na)) { s += 55; why.push("n° de facture dans le libellé"); }
      const ns = bkNameScore(f.client_nom, L);
      if (ns) { s += ns; why.push(ns === 35 ? "nom du client reconnu" : "nom du client en partie reconnu"); }
      if (f.date_emission && tx.date_op < f.date_emission) s -= 25;
      out.push({ type: "facture", f, s, why });
    }
    for (const p of cx.pays) {
      if (Math.abs(p.montant - amt) > 0.005) continue;
      const dd = Math.abs(daysBetween(p.date_paiement, tx.date_op));
      if (dd > 10) continue;
      const ns = bkNameScore(p.client_nom, L), why = ["paiement déjà saisi pour ce montant"];
      if (ns) why.push("nom du client reconnu");
      out.push({ type: "lie", p, f: byId(db.factures, p.facture_id), s: 60 + ns + (dd <= 2 ? 10 : 0), why });
    }
  } else {
    const amt = -tx.montant;
    const exactD = cx.deps.filter((d) => d.statut === "À payer" && Math.abs(d.montant_ttc - amt) < 0.005);
    for (const d of cx.deps) {
      if (Math.abs(d.montant_ttc - amt) > 0.005) continue;
      const paid = d.statut === "Payée";
      if (paid && Math.abs(daysBetween(d.date_paiement || d.date_depense, tx.date_op)) > 20) continue;
      let s = 50;
      const why = ["montant égal à la facture fournisseur"];
      if (!paid && exactD.length === 1) s += 10;
      const nr = bkAlnum(d.reference);
      if (nr.length >= 4 && LA.includes(nr)) { s += 55; why.push("n° de facture dans le libellé"); }
      const ns = bkNameScore(d.fournisseur, L);
      if (ns) { s += ns; why.push("fournisseur reconnu"); }
      if (!paid && d.date_depense > tx.date_op) s -= 20;
      out.push({ type: paid ? "deplie" : "dep", d, s, why });
    }
  }
  return out.sort((a, b) => b.s - a.s);
}
function bkSuggest(tx, cx) {
  const c = bkCands(tx, cx || bkCtx());
  const top = c[0];
  if (!top) return null;
  let lv = bkLevel(top.s);
  if (!lv) return null;
  if (c[1] && c[1].s >= top.s - 10 && lv !== "s") lv = bkDown(lv); // plusieurs candidats aussi crédibles : on baisse la confiance
  return { ...top, lv, alts: c.length - 1 };
}
// Suggestions de toutes les opérations en attente (calculées une fois par chargement des données)
function bkSugs() {
  if (db.bkSug) return db.bkSug;
  const cx = bkCtx(), m = new Map();
  for (const t of bkPending()) { const s = bkSuggest(t, cx); if (s) m.set(t.id, s); }
  return (db.bkSug = m);
}
const bkSugOf = (id) => bkSugs().get(id) || null;
// Pour l'accueil : une opération en attente correspond-elle à cette facture ?
function bkMatchFor(f) {
  if (!db.v6) return null;
  for (const [id, s] of bkSugs()) if (s.type === "facture" && s.f.id === f.id && s.lv !== "s") return byId(db.bankTx, id);
  return null;
}
// Pour l'accueil : résumé des opérations à rapprocher
function bkPriorite() {
  if (!db.v6) return null;
  const p = bkPending();
  if (!p.length) return null;
  const cr = p.filter((t) => t.montant > 0), sg = bkSugs();
  const sure = [...sg.values()].filter((s) => s.lv === "c").length;
  return {
    lv: cr.length ? "i" : "s", score: 135 + Math.min(sure * 5, 25),
    titre: `${dcPlural(p.length, "opération")} bancaire${p.length > 1 ? "s" : ""} à rapprocher`,
    detail: cr.length ? `${dcPlural(cr.length, "encaissement")} reçu${cr.length > 1 ? "s" : ""} en banque, pas encore rattaché${cr.length > 1 ? "s" : ""} à une facture${sure ? ` · ${sure} reconnu${sure > 1 ? "s" : ""} automatiquement` : ""}` : "Opérations du relevé à contrôler",
    montant: sum(cr, (t) => t.montant),
  };
}

/* ===================== Rapprochement : actions ===================== */
const bkMode = (lib, debit) => {
  const L = bkNorm(lib);
  if (/\b(cheque|chq|cheq)\b/.test(L)) return "Chèque";
  if (/\b(cb|carte)\b/.test(L)) return "Carte";
  if (/\b(espece|especes|retrait|versement especes)\b/.test(L)) return "Espèces";
  if (debit && /\b(prlv|prelevement|prelev)\b/.test(L)) return "Prélèvement";
  return "Virement";
};
const bkBusy = new Set();
const bkLinkTx = async (id, patch) => {
  const r = await q(sb.from("banque_transactions").update(patch).eq("id", id).eq("statut", "À rapprocher").select("id"));
  if (!r.length) throw new Error("Cette opération a déjà été traitée. Actualisez la page.");
};
// Applique un rapprochement. `rest` : reste dû par facture déjà consommé (rapprochement en lot).
async function bkApply(tx, s, rest) {
  if (bkBusy.has(tx.id)) return;
  bkBusy.add(tx.id);
  try {
    if (s.type === "facture") {
      const f = s.f, left = rest ? (rest[f.id] ?? f.reste) : f.reste;
      if (tx.montant > left + 0.005) throw new Error(`Ce montant (${E2(tx.montant)}) dépasse le reste dû de la facture ${f.numero} (${E2(left)}).`);
      const pay = await q(sb.from("paiements").insert({ facture_id: f.id, montant: tx.montant, date_paiement: tx.date_op, mode: bkMode(tx.libelle, false), reference: ("Banque · " + tx.libelle).slice(0, 120) }).select("id").single());
      try { await bkLinkTx(tx.id, { statut: "Rapprochée", lien_type: "paiement", facture_id: f.id, paiement_id: pay.id }); }
      catch (e) { try { await q(sb.from("paiements").delete().eq("id", pay.id)); } catch (e2) {} throw e; }
      if (rest) rest[f.id] = r2(left - tx.montant);
      return { msg: left - tx.montant < 0.005 ? `Facture ${f.numero} marquée payée.` : `Paiement partiel enregistré sur ${f.numero} : il reste ${E2(left - tx.montant)} à encaisser.` };
    }
    if (s.type === "lie") {
      await bkLinkTx(tx.id, { statut: "Rapprochée", lien_type: "paiement_lie", facture_id: s.p.facture_id, paiement_id: s.p.id });
      return { msg: "Opération liée au paiement déjà enregistré (aucun doublon créé)." };
    }
    if (s.type === "dep") {
      const d = s.d;
      await q(sb.from("depenses").update({ statut: "Payée", date_paiement: tx.date_op, mode: bkMode(tx.libelle, true) }).eq("id", d.id));
      try { await bkLinkTx(tx.id, { statut: "Rapprochée", lien_type: "depense_payee", depense_id: d.id }); }
      catch (e) { try { await q(sb.from("depenses").update({ statut: "À payer", date_paiement: null, mode: null }).eq("id", d.id)); } catch (e2) {} throw e; }
      return { msg: `Dépense ${d.fournisseur} marquée payée.` };
    }
    if (s.type === "deplie") {
      await bkLinkTx(tx.id, { statut: "Rapprochée", lien_type: "depense_liee", depense_id: s.d.id });
      return { msg: "Opération liée à la dépense déjà payée." };
    }
    throw new Error("Rapprochement impossible.");
  } finally { bkBusy.delete(tx.id); }
}
async function bkMatch(id) {
  if (!guard()) return;
  const tx = byId(db.bankTx, id), s = tx && bkSugOf(id);
  if (!tx || !s) return toast("Plus de suggestion pour cette opération. Utilisez « Autre… ».", "dn");
  const r = await bkApply(tx, s);
  if (r) toast(r.msg, "ok");
  await refresh();
}
async function bkMatchAll() {
  if (!guard()) return;
  const list = bkPending(bkSt().compte).map((t) => [t, bkSugOf(t.id)]).filter(([, s]) => s && s.lv === "c");
  if (!list.length) return;
  if (!confirm(`Rapprocher ${dcPlural(list.length, "opération")} reconnue${list.length > 1 ? "s" : ""} avec certitude ?\n\nChaque encaissement sera enregistré sur sa facture, chaque dépense marquée payée. Vous pourrez annuler une par une.`)) return;
  const rest = {}, used = new Set();
  let ok = 0;
  const bad = [];
  for (const [t, s] of list) {
    const key = s.p?.id || s.d?.id;
    if (key && used.has(key)) { bad.push(t.libelle); continue; }
    try { await bkApply(t, s, rest); if (key) used.add(key); ok++; } catch (e) { bad.push(`${t.libelle} (${friendly(e)})`); }
  }
  toast(`${dcPlural(ok, "opération")} rapprochée${ok > 1 ? "s" : ""}.${bad.length ? ` ${bad.length} à traiter à la main.` : ""}`, bad.length ? "dn" : "ok");
  await refresh();
}
async function bkIgnore(id) {
  if (!guard()) return;
  await bkLinkTx(id, { statut: "Ignorée" });
  toast("Opération ignorée (virement interne, dépense personnelle…).");
  await refresh();
}
async function bkUndo(id) {
  if (!guard()) return;
  const tx = byId(db.bankTx, id);
  if (!tx) return;
  const clear = { statut: "À rapprocher", lien_type: null, facture_id: null, paiement_id: null, depense_id: null };
  if (tx.statut === "Rapprochée") {
    const txt = { paiement: "Le paiement créé sera supprimé et la facture redeviendra impayée (ou partiellement payée).", depense_payee: "La dépense repassera en « À payer ».", paiement_lie: "Le paiement déjà enregistré est conservé.", depense_liee: "La dépense est conservée.", depense_creee: "La dépense créée est conservée : supprimez-la à la main si besoin." }[tx.lien_type] || "";
    if (!confirm(`Annuler ce rapprochement ?\n\n${txt}`)) return;
    if (tx.lien_type === "paiement" && tx.paiement_id) await q(sb.from("paiements").delete().eq("id", tx.paiement_id));
    if (tx.lien_type === "depense_payee" && tx.depense_id) await q(sb.from("depenses").update({ statut: "À payer", date_paiement: null, mode: null }).eq("id", tx.depense_id));
  }
  await q(sb.from("banque_transactions").update(clear).eq("id", id));
  toast("Opération remise à rapprocher.");
  await refresh();
}

/* ---- Rapprochement manuel (choix de la cible) ---- */
function bkManual(id) {
  if (!guard()) return;
  const tx = byId(db.bankTx, id);
  if (!tx) return;
  const cx = bkCtx(), cr = tx.montant > 0;
  const cand = bkCands(tx, cx);
  const score = (type, key) => cand.find((c) => c.type === type && (c.f?.id || c.p?.id || c.d?.id) === key)?.s || 0;
  let opts = [];
  if (cr) {
    const fs = cx.openF.map((f) => ({ v: "f:" + f.id, s: score("facture", f.id), l: `${f.numero} · ${f.client_nom} · reste ${E2(f.reste)}${tx.montant > f.reste + 0.005 ? " (montant trop élevé)" : ""}`, dis: tx.montant > f.reste + 0.005 }));
    const ps = cx.pays.filter((p) => Math.abs(p.montant - tx.montant) < 0.005).map((p) => ({ v: "p:" + p.id, s: score("lie", p.id) + 1, l: `Déjà saisi : ${p.facture_numero} · ${p.client_nom} · ${D(p.date_paiement)}` }));
    opts = [...ps, ...fs.sort((a, b) => b.s - a.s)];
  } else {
    const ds = cx.deps.filter((d) => Math.abs(d.montant_ttc + tx.montant) < 0.005 || d.statut === "À payer").map((d) => ({ v: "d:" + d.id, s: score(d.statut === "Payée" ? "deplie" : "dep", d.id), l: `${d.fournisseur}${d.reference ? " · " + d.reference : ""} · ${E2(d.montant_ttc)} · ${d.statut}${Math.abs(d.montant_ttc + tx.montant) > 0.005 ? " (montant différent)" : ""}`, dis: Math.abs(d.montant_ttc + tx.montant) > 0.005 }));
    opts = ds.sort((a, b) => b.s - a.s);
  }
  const enabled = opts.filter((o) => !o.dis);
  if (!opts.length) return toast(cr ? "Aucune facture ouverte à laquelle rattacher cette entrée." : "Aucune dépense correspondante. Utilisez « Créer la dépense ».", "dn");
  const body = `<p style="margin:0 0 12px"><b>${esc(tx.libelle)}</b><br><span class="mut">${D(tx.date_op)} · </span><b class="${cr ? "ok" : "dn"}">${cr ? "+" : ""}${E2(tx.montant)}</b></p>
    <div class="frm">${fld({ k: "cible", l: cr ? "Rattacher à" : "Rattacher à la dépense", t: "select", cls: "full", v: enabled[0]?.v || "",
      o: opts.map((o) => ({ v: o.v, l: o.l })) })}</div>
    ${cr ? `<p class="mut" style="margin:10px 0 0;font-size:13px">Si le montant est inférieur au reste dû, il est enregistré comme paiement partiel. Les lignes « Déjà saisi » évitent de compter deux fois un paiement que vous avez déjà enregistré à la main.</p>` : ""}`;
  modal("Rapprocher l'opération", body, {
    submit: "Rapprocher",
    onSubmit: async (v, api) => {
      const [k, rid_] = v.cible.split(":");
      let s;
      if (k === "f") s = { type: "facture", f: byId(db.factures, rid_) };
      else if (k === "p") s = { type: "lie", p: byId(db.paiements, rid_) };
      else { const d = byId(db.depenses, rid_); s = { type: d?.statut === "Payée" ? "deplie" : "dep", d }; }
      if (!(s.f || s.p || s.d)) throw new Error("Cible introuvable. Actualisez la page.");
      const r = await bkApply(tx, s);
      api.close();
      if (r) toast(r.msg, "ok");
      await refresh();
    },
  });
  // le menu ne propose pas les cibles refusées : on les désactive
  const sel = $("#f_cible", $$(".md").pop());
  if (sel) opts.filter((o) => o.dis).forEach((o) => { const el = [...sel.options].find((x) => x.value === o.v); if (el) el.disabled = true; });
}

/* ---- Créer une dépense depuis une sortie d'argent ---- */
const bkClean = (lib) => {
  let s = String(lib || "").replace(/\s+/g, " ").trim();
  s = s.replace(/^(paiement|achat|retrait)\s+(par\s+)?(cb|carte)\s*(bancaire)?\s*/i, "")
    .replace(/^(prlv|prelevement|prélèvement)\s*(sepa)?\s*/i, "")
    .replace(/^(vir|virement)\s*(sepa|inst|instantane|instantané)?\s*(emis|émis)?\s*(a|à|vers)?\s*/i, "")
    .replace(/^(cheque|chèque|chq)\s*(n°?\s*\d+)?\s*/i, "")
    .replace(/\bcarte\s*x?\d+\b/gi, "").replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, "").replace(/\b\d{5,}\b/g, "").replace(/\s+/g, " ").trim();
  s = s || String(lib || "").trim();
  return s.toLowerCase().replace(/(^|[\s'-])([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase()).slice(0, 80);
};
function bkCreateDep(id) {
  if (!guard()) return;
  const tx = byId(db.bankTx, id);
  if (!tx || tx.montant >= 0) return;
  const ttc = -tx.montant, ht = r2(ttc / 1.2);
  depForm(null, {
    badge: `<div class="full"><span class="badge-auto">Pré-rempli depuis la banque : ${esc(tx.libelle)}. Ajustez le taux de TVA si besoin.</span></div>`,
    prefill: { fournisseur: bkClean(tx.libelle), date_depense: tx.date_op, montant_ht: ht, montant_tva: r2(ttc - ht), statut: "Payée", date_paiement: tx.date_op, mode: bkMode(tx.libelle, true), categorie: "Autre" },
    onSaved: async (depId) => {
      try { await bkLinkTx(tx.id, { statut: "Rapprochée", lien_type: "depense_creee", depense_id: depId }); }
      catch (e) { toast("Dépense créée, mais l'opération bancaire n'a pas pu être liée : " + esc(friendly(e)), "dn"); }
    },
  });
}

/* ===================== Import d'un relevé ===================== */
function bkImport() {
  if (!guard()) return;
  if (!db.v6) return toast("Exécutez d'abord migration_v6.sql dans Supabase pour activer la banque.", "dn");
  let parsed = null, plan = null;
  const accs = db.comptes;
  const cur = bkSt().compte !== "all" && bkAcc(bkSt().compte) ? bkSt().compte : accs[0]?.id || "__new";
  const body = `<p class="mut" style="margin:0 0 12px">Exportez le relevé de votre compte depuis l'espace de votre banque (format <b>CSV</b> ou <b>OFX</b>), puis déposez-le ici. Pilot ne se connecte pas à votre banque : il lit le fichier, ne garde que les opérations et ne reprend jamais deux fois la même.</p>
    <div class="frm">
    ${fld({ k: "compte", l: "Compte bancaire", t: "select", o: [...accs.map((a) => ({ v: a.id, l: a.nom })), { v: "__new", l: "+ Nouveau compte" }], v: cur })}
    <span></span>
    <div class="full bknew" id="bknew" hidden><div class="frm">${fld({ k: "nom", l: "Nom du compte", ph: "Ex. Compte pro Crédit Agricole", r: 0 })}${fld({ k: "iban", l: "IBAN (facultatif)", r: 0 })}</div></div>
    <div class="full"><div class="drop"><div><b>Relevé bancaire</b><small style="display:block" class="mut">.csv, .ofx ou .qfx</small></div><input type="file" id="bkfile" accept=".csv,.ofx,.qfx,.txt,text/csv" hidden><button type="button" class="btn o" id="bkpick">Choisir le fichier</button></div></div>
    <div class="full" id="bkprev"></div>
    ${fld({ k: "solde", l: "Solde du compte après la dernière opération (€)", t: "text", r: 0, cls: "full", hint: "Facultatif mais conseillé : sans lui, le solde affiché ne compte que les opérations importées." })}</div>`;
  modal("Importer un relevé bancaire", body, {
    wide: true, submit: "Importer", noFocus: true,
    onMount: (m) => {
      const sel = $("#f_compte", m), nw = $("#bknew", m), inp = $("#bkfile", m), prev = $("#bkprev", m), solde = $("#f_solde", m);
      const sync = () => { nw.hidden = sel.value !== "__new"; if (sel.value !== "__new" && parsed) showPlan(); };
      const showPlan = () => {
        const ex = sel.value === "__new" ? [] : bkTxOf(sel.value);
        plan = bkPlan(parsed.rows, ex);
        const cr = sum(plan.fresh.filter((r) => r.montant > 0), (r) => r.montant), de = sum(plan.fresh.filter((r) => r.montant < 0), (r) => r.montant);
        prev.innerHTML = `<div class="bkprev"><b>${parsed.format} · ${dcPlural(parsed.rows.length, "opération")}</b> du ${D(parsed.from)} au ${D(parsed.to)}<br>
          <span class="ok">${dcPlural(plan.fresh.length, "nouvelle")} à importer</span>${plan.dup ? ` · <span class="mut">${plan.dup} déjà importée${plan.dup > 1 ? "s" : ""}</span>` : ""}
          ${plan.fresh.length ? `<br><span class="mut">Entrées ${E2(cr)} · Sorties ${E2(Math.abs(de))}</span>` : ""}</div>`;
      };
      sel.onchange = sync;
      sync();
      $("#bkpick", m).onclick = () => inp.click();
      inp.onchange = async () => {
        const f = inp.files[0];
        if (!f) return;
        prev.innerHTML = `<span class="mut">Lecture de ${esc(f.name)}…</span>`;
        parsed = null; plan = null;
        try {
          if (f.size > 8 * 1024 * 1024) throw new Error("Fichier trop volumineux (8 Mo maximum).");
          parsed = bkParse(await f.arrayBuffer());
          if (parsed.balance !== null && parsed.balance !== undefined && !solde.value) solde.value = String(parsed.balance).replace(".", ",");
          if (parsed.iban && sel.value === "__new" && !$("#f_iban", m).value) $("#f_iban", m).value = parsed.iban;
          if (sel.value === "__new" && !$("#f_nom", m).value) $("#f_nom", m).value = "Compte principal";
          showPlan();
        } catch (e) { prev.innerHTML = `<span class="badge-warn">${esc(friendly(e))}</span>`; }
      };
    },
    onSubmit: async (v, api) => {
      if (!parsed || !plan) throw new Error("Choisissez d'abord un relevé lisible.");
      const bal = String(v.solde || "").trim() ? bkNum(v.solde) : null;
      if (String(v.solde || "").trim() && bal === null) throw new Error("Solde illisible. Exemple : 38 420,50");
      if (!plan.fresh.length && bal === null) throw new Error("Rien de nouveau à importer : toutes ces opérations sont déjà dans Pilot.");
      let acc = v.compte === "__new" ? null : bkAcc(v.compte), created = false;
      if (!acc) {
        if (!String(v.nom || "").trim()) throw new Error("Donnez un nom au nouveau compte.");
        const ib = String(v.iban || "").replace(/\s/g, "").toUpperCase();
        acc = await q(sb.from("banque_comptes").insert({ nom: v.nom.trim(), iban: /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(ib) ? ib : null, solde_initial: 0 }).select("*").single());
        created = true;
      }
      try {
        for (let i = 0; i < plan.fresh.length; i += 300) {
          const chunk = plan.fresh.slice(i, i + 300).map((r) => ({ compte_id: acc.id, date_op: r.date, libelle: r.libelle.slice(0, 300), montant: r.montant, ref_import: r.ref }));
          await q(sb.from("banque_transactions").upsert(chunk, { onConflict: "compte_id,ref_import", ignoreDuplicates: true }));
        }
        if (bal !== null) {
          const total = sum(bkTxOf(acc.id), (t) => t.montant) + sum(plan.fresh, (r) => r.montant);
          await q(sb.from("banque_comptes").update({ solde_initial: r2(bal - total) }).eq("id", acc.id));
        }
      } catch (e) {
        if (created) { try { await sb.from("banque_comptes").delete().eq("id", acc.id); } catch (e2) {} }
        throw e;
      }
      bkSt().compte = acc.id;
      api.close();
      toast(`${dcPlural(plan.fresh.length, "opération")} importée${plan.fresh.length > 1 ? "s" : ""}.`, "ok");
      await refresh();
    },
  });
}
function bkBalance(id) {
  if (!guard()) return;
  const a = bkAcc(id);
  if (!a) return;
  modal("Recaler le solde", `<p class="mut" style="margin:0 0 12px">Indiquez le solde réel de « ${esc(a.nom)} » après la dernière opération importée (celui de votre espace bancaire). Pilot ajuste son point de départ.</p>
    <div class="frm">${fld({ k: "solde", l: "Solde réel (€)", t: "number", v: String(bkSolde(a)).replace(".", ","), cls: "full" })}</div>`, {
    onSubmit: async (v, api) => {
      const bal = bkNum(v.solde);
      if (bal === null) throw new Error("Solde illisible. Exemple : 38 420,50");
      await q(sb.from("banque_comptes").update({ solde_initial: r2(bal - sum(bkTxOf(a.id), (t) => t.montant)) }).eq("id", a.id));
      api.close(); toast("Solde recalé.", "ok"); await refresh();
    },
  });
}
async function bkAccDel(id) {
  if (!guard()) return;
  const a = bkAcc(id);
  if (!a) return;
  const n = bkTxOf(id).length, l = bkTxOf(id).filter((t) => t.statut === "Rapprochée").length;
  if (!confirm(`Supprimer le compte « ${a.nom} » et ses ${dcPlural(n, "opération")} importée${n > 1 ? "s" : ""} ?\n\n${l ? `Les ${l} paiements et dépenses déjà rapprochés restent enregistrés dans Pilot. ` : ""}Vous pourrez réimporter un relevé à tout moment.`)) return;
  await q(sb.from("banque_comptes").delete().eq("id", id));
  bkSt().compte = "all";
  toast("Compte supprimé.");
  await refresh();
}

/* ===================== Affichage : onglet Banque de la comptabilité ===================== */
function bkLinkText(t) {
  const f = t.facture_id ? byId(db.factures, t.facture_id) : null, d = t.depense_id ? byId(db.depenses, t.depense_id) : null;
  if (t.statut === "Ignorée") return `<span class="mut">Ignorée</span>`;
  if (f) return `Facture <a href="#/factures/${f.id}">${esc(f.numero)}</a> · ${esc(f.client_nom)}`;
  if (d) return `Dépense <a href="#/depenses/${d.id}">${esc(d.fournisseur)}</a>`;
  return `<span class="mut">${t.lien_type === "paiement" || t.lien_type === "paiement_lie" ? "Paiement (facture supprimée)" : "Élément supprimé"}</span>`;
}
function bkSugCell(t) {
  const s = bkSugOf(t.id);
  if (!s) {
    return t.montant > 0
      ? `<span class="mut">Aucune facture ne correspond</span>`
      : `<span class="mut">Aucune dépense ne correspond</span>`;
  }
  const [lbl, cls] = BK_LV[s.lv];
  let head;
  if (s.type === "facture") head = `→ Facture <b>${esc(s.f.numero)}</b> · ${esc(s.f.client_nom)}<small>reste dû ${E2(s.f.reste)}</small>`;
  else if (s.type === "lie") head = `→ Paiement déjà saisi (${esc(s.p.facture_numero)}) · ${esc(s.p.client_nom)}<small>${D(s.p.date_paiement)}</small>`;
  else if (s.type === "dep") head = `→ Dépense <b>${esc(s.d.fournisseur)}</b>${s.d.reference ? " · " + esc(s.d.reference) : ""}<small>à payer · ${E2(s.d.montant_ttc)}</small>`;
  else head = `→ Dépense déjà payée <b>${esc(s.d.fournisseur)}</b><small>${E2(s.d.montant_ttc)} · ${D(s.d.date_paiement || s.d.date_depense)}</small>`;
  return `<div class="bksug">${head}<small><span class="chip ${cls}">${lbl}</span> ${esc(s.why.join(" · "))}${s.alts ? ` · ${s.alts} autre${s.alts > 1 ? "s" : ""} possibilité${s.alts > 1 ? "s" : ""}` : ""}</small></div>`;
}
const BK_VERB = { facture: "Rapprocher", lie: "Lier", dep: "Marquer payée", deplie: "Lier" };

function banqueTab(t) {
  const st = bkSt();
  const sub = "Le solde du compte et les opérations à rattacher aux factures et dépenses.";
  if (!db.v6) return page("Comptabilité", sub, "", t + card("", setupV6b()));
  if (!db.comptes.length)
    return page("Comptabilité", sub, btn("Importer un relevé", "bkImport", "", "", "w"),
      t + card("Banque", `<div class="empty" style="padding:34px 20px"><h2>Aucun compte bancaire</h2><p style="max-width:560px;margin:6px auto 16px">Importez un relevé (CSV ou OFX, exportable depuis l'espace de votre banque). Pilot affiche le solde, reconnaît les virements de vos clients et rattache chacun à la bonne facture en un clic.</p>${btn("Importer un relevé", "bkImport", "", "", "w")}<p class="mut" style="font-size:13px;margin:16px auto 0;max-width:560px">Pilot ne se connecte pas directement à votre banque : vous gardez la main sur ce qui est importé.</p></div>`));
  if (st.compte !== "all" && !bkAcc(st.compte)) st.compte = "all";
  const accs = st.compte === "all" ? db.comptes : [bkAcc(st.compte)];
  const solde = sum(accs, bkSolde);
  const last = [...bkTxOf(st.compte === "all" ? undefined : st.compte)];
  const all = st.compte === "all" ? db.bankTx : bkTxOf(st.compte);
  const lastOp = all.reduce((m, x) => (x.date_op > m ? x.date_op : m), "");
  const pend = bkPending(st.compte);
  const pendCr = pend.filter((x) => x.montant > 0);
  const sg = bkSugs();
  const rank = { c: 0, p: 1, s: 2 };
  let list = pend.filter((x) => st.flow === "all" || (st.flow === "in" ? x.montant > 0 : x.montant < 0))
    .sort((a, b) => (rank[sg.get(a.id)?.lv] ?? 3) - (rank[sg.get(b.id)?.lv] ?? 3) || b.date_op.localeCompare(a.date_op));
  const total = list.length;
  list = list.slice(0, st.limit);
  const sure = pend.filter((x) => sg.get(x.id)?.lv === "c");
  const accSel = db.comptes.length > 1 ? `<div class="seg"><button data-act="bkAccSel" data-arg="all" aria-pressed="${st.compte === "all"}">Tous les comptes</button>${db.comptes.map((a) => `<button data-act="bkAccSel" data-arg="${a.id}" aria-pressed="${st.compte === a.id}">${esc(a.nom)}</button>`).join("")}</div>` : "";
  const ecart = r2(solde - tresorerie());
  const accRows = accs.map((a) => `<div class="row"><div><b>${esc(a.nom)}</b><small>${a.iban ? esc(bkMask(a.iban)) + " · " : ""}${bkTxOf(a.id).length} opérations importées${Number(a.solde_initial) === 0 ? " · solde à recaler" : ""}</small></div>
      <div style="display:flex;align-items:center;gap:14px"><b class="num ${bkSolde(a) < 0 ? "dn" : ""}" style="font-size:16px">${E2(bkSolde(a))}</b><button class="lk w" data-act="bkBalance" data-id="${a.id}">Recaler</button><button class="lk w" data-act="bkAccDel" data-id="${a.id}">Supprimer</button></div></div>`).join("");
  const flow = `<div class="seg">${[["all", "Toutes"], ["in", "Entrées"], ["out", "Sorties"]].map(([k, l]) => `<button data-act="bkFlow" data-arg="${k}" aria-pressed="${st.flow === k}">${l}</button>`).join("")}</div>`;
  const rows = list.map((x) => {
    const s = sg.get(x.id), cr = x.montant > 0;
    const acts = [];
    if (s) acts.push(btn(BK_VERB[s.type], "bkMatch", x.id, "", "sm w"));
    else if (!cr) acts.push(btn("Créer la dépense", "bkCreateDep", x.id, "", "sm w"));
    acts.push(`<button class="lk w" data-act="bkManual" data-id="${x.id}">${s ? "Autre…" : "Rapprocher…"}</button>`);
    if (s && !cr) acts.push(`<button class="lk w" data-act="bkCreateDep" data-id="${x.id}">Créer</button>`);
    acts.push(`<button class="lk w" data-act="bkIgnore" data-id="${x.id}">Ignorer</button>`);
    const acc = db.comptes.length > 1 ? `<small>${esc(bkAcc(x.compte_id)?.nom || "")}</small>` : "";
    return { t: `${x.libelle} ${s?.f?.numero || ""} ${s?.f?.client_nom || ""} ${s?.d?.fournisseur || ""}`,
      c: [D(x.date_op), `<strong>${esc(x.libelle)}</strong>${acc}`, bkSugCell(x), `<span class="num ${cr ? "ok" : "dn"}">${cr ? "+" : ""}${E2(x.montant)}</span>`, `<span class="bkact">${acts.join("")}</span>`] };
  });
  const more = total > list.length ? `<div class="cb" style="border-top:1px solid var(--line2);text-align:center"><button class="lk" data-act="bkMore">Afficher les ${Math.min(50, total - list.length)} suivantes (${total - list.length} restantes)</button></div>` : "";
  const done = all.filter((x) => x.statut !== "À rapprocher").sort((a, b) => b.date_op.localeCompare(a.date_op) || String(b.created_at).localeCompare(String(a.created_at))).slice(0, 30);
  const drows = done.map((x) => ({ c: [D(x.date_op), `<strong>${esc(x.libelle)}</strong>`, bkLinkText(x), `<span class="num ${x.montant > 0 ? "ok" : "dn"}">${x.montant > 0 ? "+" : ""}${E2(x.montant)}</span>`, `<span class="r"><button class="lk w" data-act="bkUndo" data-id="${x.id}">${x.statut === "Ignorée" ? "Remettre" : "Annuler"}</button></span>`] }));
  return page("Comptabilité", sub, btn("Importer un relevé", "bkImport", "", "", "w"),
    t + (accSel ? `<div style="margin-bottom:14px">${accSel}</div>` : "") +
    strip([
      ["Solde bancaire", E2(solde), `d'après ${dcPlural(all.length, "opération")} importée${all.length > 1 ? "s" : ""}${lastOp ? ", dernière le " + D(lastOp) : ""}`, solde < 0 ? "dn" : ""],
      ["À rapprocher", String(pend.length), pendCr.length ? `dont ${dcPlural(pendCr.length, "entrée")} pour ${E2(sum(pendCr, (x) => x.montant))}` : "rien en attente", pendCr.length ? "up" : ""],
      ["Reconnues avec certitude", String(sure.length), sure.length ? "rapprochables en un clic" : "aucune pour le moment"],
      ["Trésorerie estimée Pilot", E2(tresorerie()), Math.abs(ecart) < 0.01 ? "identique à la banque" : `écart avec la banque : ${ecart > 0 ? "+" : ""}${E2(ecart)}`],
    ]) +
    card("Banque", accRows, "") +
    card(`Transactions à rapprocher <span class="mut" style="font-weight:400">· ${total}</span>`,
      tbl(["Date", "Opération", "Suggestion", { h: "Montant", r: 1 }, ""], rows, pend.length ? "Aucune opération dans ce filtre." : "Tout est rapproché. Importez un nouveau relevé pour continuer.") + more,
      `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${sure.length ? btn(`Rapprocher les ${sure.length} certaines`, "bkMatchAll", "", "", "sm w") : ""}${flow}</div>`) +
    (done.length ? card("Dernières opérations traitées", tbl(["Date", "Opération", "Rattachée à", { h: "Montant", r: 1 }, ""], drows), "") : "") +
    `<p class="note">Le rapprochement enregistre le paiement sur la facture à la date de l'opération bancaire : la facture passe en « Payée » (ou « Partiellement payée ») et la comptabilité suit. Annulable à tout moment.</p>`);
}

const banqueActions = {
  bkImport: () => bkImport(),
  bkMatch: (id) => bkMatch(id),
  bkMatchAll: () => bkMatchAll(),
  bkManual: (id) => bkManual(id),
  bkIgnore: (id) => bkIgnore(id),
  bkUndo: (id) => bkUndo(id),
  bkCreateDep: (id) => bkCreateDep(id),
  bkBalance: (id) => bkBalance(id),
  bkAccDel: (id) => bkAccDel(id),
  bkAccSel: (id, arg) => { bkSt().compte = arg; bkSt().limit = 50; return render(true); },
  bkFlow: (id, arg) => { bkSt().flow = arg; bkSt().limit = 50; return render(true); },
  bkMore: () => { bkSt().limit += 50; return render(true); },
};
