/* Éditeur de devis et factures : aides à la saisie (recherche de prestations, clavier, raccourcis).
   Se branche sur l'éditeur de views-docs.js sans changer le format des lignes. */

Object.assign(ic, {
  up: "M6 14l6-6 6 6",
  down: "M6 10l6 6 6-6",
  dup: "M9 9h11v11H9z M5 15V4h11",
});

function edEmptyRow(tr) { return !$('[data-f="des"]', tr).value.trim() && !parseNum($('[data-f="pu"]', tr).value); }
function edLastTva(m) { const t = $$('.lr [data-f="tva"]', m).pop(); return t ? Number(t.value) : undefined; }
// Ligne libre : réutilise la dernière ligne vide, sinon en crée une dans la dernière section
function edAddFree(m, text) {
  const lb = shLastLb(m);
  let tr = $$(".lr", lb).pop();
  if (!tr || !edEmptyRow(tr) || tr.dataset.nat === "libre") { lb.insertAdjacentHTML("beforeend", ligneRow({ taux_tva: edLastTva(m) })); tr = $$(".lr", lb).pop(); }
  $('[data-f="des"]', tr).value = text;
  recalcLignes(m);
  const pu = $('[data-f="pu"]', tr); pu.focus(); pu.select();
  tr.scrollIntoView({ block: "center", behavior: "smooth" });
  return tr;
}
function edAfterLibrary(m, o) {
  ovInsertLine(m, o);
  const tr = $$(".lr", m).reverse().find((x) => $('[data-f="des"]', x).value === o.designation);
  if (tr) { const q = $('[data-f="qte"]', tr); q.focus(); q.select(); tr.scrollIntoView({ block: "center", behavior: "smooth" }); }
}
function edDupRow(tr) {
  const c = tr.cloneNode(true), a = [...tr.querySelectorAll("input,select,textarea")], b = [...c.querySelectorAll("input,select,textarea")];
  a.forEach((x, i) => { if (b[i]) { if (x.type === "checkbox") b[i].checked = x.checked; else b[i].value = x.value; } });
  tr.after(c);
  return c;
}

function edEnhance(m, K) {
  const q = $("#qaq", m), sug = $("#qasug", m);
  let items = [], sel = -1, timer = 0, seq = 0;
  const hide = () => { sug.hidden = true; sel = -1; };
  const draw = () => {
    const text = q.value.trim();
    if (!text) return hide();
    sug.innerHTML = items.map((o, i) => `<button type="button" class="qs" data-qi="${i}" aria-selected="${i === sel}"><span><b>${esc(o.designation)}</b><small>${esc(o.corps_etat)}</small></span><span class="num">${E2(o.prix_ht)} <small>/ ${esc(o.unite)}</small></span></button>`).join("")
      + `<button type="button" class="qs free" data-qi="-1" aria-selected="${sel === -2}"><span><b>Ajouter « ${esc(text)} » comme ligne libre</b><small>Vous saisissez vous-même la quantité et le prix</small></span></button>`;
    sug.hidden = false;
  };
  const search = async () => {
    const my = ++seq, text = q.value.trim();
    if (!text) { items = []; return hide(); }
    if (db.v7 && db.nbOuvrages) { try { const r = await ovSearch({ text, limit: 6 }); if (my !== seq) return; items = r.rows; } catch (e) { items = []; } } else items = [];
    sel = items.length ? 0 : -2; draw();
  };
  const pick = (i) => {
    const text = q.value.trim();
    q.value = ""; hide();
    if (i >= 0 && items[i]) edAfterLibrary(m, items[i]); else if (text) edAddFree(m, text);
  };
  q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(search, 180); });
  q.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" && items.length) { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); draw(); }
    else if (e.key === "ArrowUp" && items.length) { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); }
    else if (e.key === "Enter") { e.preventDefault(); if (q.value.trim()) pick(sel >= 0 ? sel : -1); }
    else if (e.key === "Escape" && !sug.hidden) { e.stopPropagation(); hide(); }
  });
  q.addEventListener("blur", () => setTimeout(hide, 150));
  sug.addEventListener("mousedown", (e) => { const b = e.target.closest("[data-qi]"); if (b) { e.preventDefault(); pick(+b.dataset.qi); } });
  $("#qaok", m).addEventListener("click", () => { if (q.value.trim()) pick(sel >= 0 ? sel : -1); else q.focus(); });

  // Clavier dans les lignes : Entrée passe au champ suivant, jamais d'envoi involontaire
  m.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); return $("form", m).requestSubmit(); }
    const f = e.target.dataset?.f;
    if (e.key !== "Enter" || e.target.tagName === "TEXTAREA" || e.target.tagName === "BUTTON" || !e.target.closest(".cat")) return;
    e.preventDefault();
    const tr = e.target.closest(".lr");
    if (!tr) { const first = $('[data-f="des"]', e.target.closest(".cat")); return first?.focus(); }
    const order = ["des", "qte", "uni", "pu"], i = order.indexOf(f);
    if (i >= 0 && i < order.length - 1) { const n = $(`[data-f="${order[i + 1]}"]`, tr); n.focus(); n.select?.(); return; }
    let nx = tr.nextElementSibling;
    while (nx && !nx.classList.contains("lr")) nx = nx.nextElementSibling;
    if (!nx) { tr.closest(".cat").querySelector("[data-addl]").click(); nx = $$(".lr", tr.closest(".cat")).pop(); }
    $('[data-f="des"]', nx)?.focus();
  });
  m.addEventListener("focusin", (e) => { if (["qte", "pu"].includes(e.target.dataset?.f)) e.target.select?.(); });

  m.addEventListener("click", (e) => {
    const t = e.target, tr = t.closest(".lr");
    if (tr && t.closest("[data-dup]")) { const c = edDupRow(tr); recalcLignes(m); $('[data-f="des"]', c)?.focus(); }
    else if (tr && t.closest("[data-up]")) { const p = tr.previousElementSibling; if (p?.classList.contains("lr")) { p.before(tr); recalcLignes(m); } }
    else if (tr && t.closest("[data-down]")) { const n = tr.nextElementSibling; if (n?.classList.contains("lr")) { n.after(tr); recalcLignes(m); } }
    const set = t.closest("[data-set]");
    if (set) { const i = $("#f_" + set.dataset.set, m); i.value = set.dataset.val; i.dispatchEvent(new Event("input", { bubbles: true })); }
    const dy = t.closest("[data-days]");
    if (dy) { const i = $("#f_echeance", m), base = $("#f_date", m).value || today(); i.value = addDays(base, Number(dy.dataset.days)); }
    const nt = t.closest("[data-note]");
    if (nt) { const a = $("#f_notes", m), v = nt.dataset.note; if (!a.value.includes(v)) a.value = (a.value.trim() ? a.value.trim() + "\n" : "") + v; a.focus(); }
  });
  // Première ouverture sur un document vide : le curseur est dans la recherche
  if (!$$(".lr", m).some((tr) => !edEmptyRow(tr))) setTimeout(() => q.focus(), 60);
}


/* ---------- Feuille de document (v24) : boutons d'ajout, glisser-déposer, aperçu PDF en direct ---------- */
function shLastLb(m) {
  let lb = $$(".lb", m).pop();
  if (!lb) { $("#cats", m).insertAdjacentHTML("beforeend", catBlock({ cat: "", lignes: [] })); lb = $$(".lb", m).pop(); }
  return lb;
}
function shAddRow(m, l, focusField = "des") {
  const lb = shLastLb(m);
  lb.insertAdjacentHTML("beforeend", ligneRow({ taux_tva: edLastTva(m), ...l }));
  const tr = $$(".lr", lb).pop();
  recalcLignes(m);
  const f = $(`[data-f="${focusField}"]`, tr) || $('[data-f="des"]', tr);
  if (f && f.type !== "hidden") { f.focus(); f.select?.(); }
  tr.scrollIntoView({ block: "center", behavior: "smooth" });
  return tr;
}
function shGrow(ta) { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight + 2, 400) + "px"; }

// Données du PDF construites à partir de l'état de l'éditeur (sans enregistrer)
async function shLiveBytes(m, K, d) {
  const k = KD[K], v = Object.fromEntries(new FormData($("form", m)));
  const ls = readLignes(m).filter((l) => l.designation || l.prix_unitaire_ht || l.type_ligne === "image");
  const real = ls.filter((l) => l.type_ligne !== "image" && l.nature !== "saut" && cxIncluded(l) && (l.designation || l.prix_unitaire_ht));
  const by = totauxParTaux(real, {});
  const ht = r2(sum(Object.values(by), (x) => x.ht)), tva = r2(sum(Object.values(by), (x) => x.tva));
  const c = v.client_id === "__new" ? { nom: v.ncl_nom || "Nouveau client", adresse: v.ncl_adresse, ville: v.ncl_ville, email: v.ncl_email, telephone: v.ncl_tel } : clientOf(v.client_id) || {};
  const ch = v.chantier_id ? byId(db.chantiers, v.chantier_id) : null;
  const dd = { ...(d || {}), id: d?.id, [k.df]: v.date, montant_ht: ht, montant_tva: tva, montant_ttc: r2(ht + tva), validite_jours: parseInt(v.validite_jours) || 30, echeance: v.echeance, statut: d?.statut || "Brouillon", client_id: v.client_id };
  let mentions = [];
  try { if (typeof lgBuild === "function") mentions = lgBuild(K, dd, c, ch, ls) || []; } catch (e) { /* mentions facultatives */ }
  const data = {
    kind: K, numero: d?.numero || (K === "facture" ? "(brouillon)" : ""), date: v.date, echeance: v.echeance, validite_jours: dd.validite_jours, statut: dd.statut, notes: v.notes,
    client: { nom: c.nom, adresse: c.adresse, ville: c.ville, email: c.email, telephone: c.telephone }, chantier: ch ? { nom: ch.nom, ville: ch.ville } : null,
    lignes: ls, ht, tva, ttc: dd.montant_ttc, taux_tva: ls[0]?.taux_tva, paye: 0, qr: null, fx: null, empreinte: "", mentions, aides: [],
    intro: v.description || "", travaux: { debut: v.debut_travaux, duree: v.duree_estimee, fin: v.fin_chantier },
  };
  const pctx = await pdfContext(K);
  if (typeof cxPdfImages === "function") pctx.images = await cxPdfImages(ls);
  return PilotPdf.build(data, pctx);
}
function shPreview(m, K, d) {
  const btn = $("#shprev", m), pv = $("#shpv", m), fr = $("#shpvf", m), st = $("#shpvst", m);
  if (!btn) return;
  let on = false, timer = 0, seq = 0, url = "";
  const build = async () => {
    const my = ++seq; st.textContent = "Mise à jour…";
    try {
      const bytes = await shLiveBytes(m, K, d);
      if (my !== seq || !document.body.contains(m)) return;
      const u = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      fr.src = u + "#toolbar=0&navpanes=0";
      if (url) { const o = url; setTimeout(() => URL.revokeObjectURL(o), 4000); }
      url = u; st.textContent = "À jour";
    } catch (e) { st.textContent = "Aperçu indisponible"; console.warn(e); }
  };
  const sched = () => { if (!on) return; st.textContent = "Mise à jour…"; clearTimeout(timer); timer = setTimeout(build, 700); };
  btn.onclick = () => { on = !on; pv.hidden = !on; m.classList.toggle("prev", on); btn.setAttribute("aria-pressed", String(on)); btn.textContent = on ? "Masquer l'aperçu" : "Aperçu PDF en direct"; if (on) build(); };
  ["input", "change", "sheet-changed"].forEach((ev) => m.addEventListener(ev, sched));
}

function edSheet(m, K, d, o = {}) {
  const hasContent = (tr) => $('[data-f="des"]', tr)?.value.trim() || parseNum($('[data-f="pu"]', tr)?.value || "");
  // description : se déplie à la demande
  const db_ = $("#shdescb", m), dt = $("#f_description", m);
  if (db_) db_.onclick = () => { db_.hidden = true; dt.hidden = false; shGrow(dt); dt.focus(); };
  // validité : date de fin affichée en clair
  const until = () => { const el = $("#shuntil", m), dte = $("#f_date", m), n = $("#f_validite_jours", m); if (el && dte?.value) el.textContent = D(addDays(dte.value, parseInt(n?.value) || 30)); };
  m.addEventListener("input", (e) => { if (e.target.matches("#f_date,#f_validite_jours")) until(); if (e.target.matches("textarea")) shGrow(e.target); });
  until();
  $$("textarea[data-f=desc], .inl-ta", m).forEach((t) => { if (t.value) shGrow(t); });
  // Entrée dans un champ de l'en-tête : jamais d'envoi involontaire du formulaire
  m.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && e.target.matches(".sheet input") && !e.target.closest(".cat") && e.target.id !== "qaq") e.preventDefault(); });

  // la description d'une ligne reste ouverte un court instant après la perte du focus (évite un saut de mise en page au clic sur un bouton)
  m.addEventListener("focusin", (e) => { const tr = e.target.closest?.("tr.lr"); if (tr) { clearTimeout(tr._dt); tr.classList.add("dopen"); } });
  m.addEventListener("focusout", (e) => { const tr = e.target.closest?.("tr.lr"); if (tr) { clearTimeout(tr._dt); tr._dt = setTimeout(() => { if (!tr.contains(document.activeElement)) tr.classList.remove("dopen"); }, 350); } });

  // boutons d'ajout
  m.addEventListener("click", (e) => {
    const t = e.target, id = t.closest("button,summary")?.id;
    const close = () => { const dt2 = t.closest("details.more"); if (dt2) dt2.open = false; };
    if (id === "addfour") return shAddRow(m, { unite: "u" });
    if (id === "addmo") { const tx = Number(db.ent.taux_horaire_vente) || 0; return shAddRow(m, { designation: "Main d'œuvre", unite: "h", prix_unitaire_ht: tx > 0 ? tx : undefined }, tx > 0 ? "qte" : "pu"); }
    if (id === "addov") return ovPicker((x) => ovInsertLine(m, x));
    if (id === "addlibre") { close(); return shAddRow(m, { nature: "libre", unite: "", prix_unitaire_ht: "" }); }
    if (id === "addtxt") return shAddRow(m, { nature: "libre", unite: "", prix_unitaire_ht: "" });
    if (id === "addpb") { shAddRow(m, { nature: "saut" }, "none"); return; }
    if (id === "addc") { $("#cats", m).insertAdjacentHTML("beforeend", catBlock({ cat: "", lignes: [] })); recalcLignes(m); const ti = $$('[data-f="cat"]', m).pop(); ti.focus(); return ti.scrollIntoView({ block: "center", behavior: "smooth" }); }
    const al = t.closest("[data-addl]");
    if (al) { const lb = $(".lb", al.closest(".cat")); lb.insertAdjacentHTML("beforeend", ligneRow({ taux_tva: Number($('[data-f="tva"]', lb.lastElementChild)?.value) || undefined })); $$('[data-f="des"]', lb).pop().focus(); return recalcLignes(m); }
    const rc = t.closest("[data-rmcat]");
    if (rc) { const sec = rc.closest(".cat"); if ($$(".lr", sec).some(hasContent) && !confirm("Supprimer cette section et toutes ses lignes ?")) return; sec.remove(); return recalcLignes(m); }
    const uc = t.closest("[data-upcat]"); if (uc) { const s = uc.closest(".cat"), p = s.previousElementSibling; if (p?.classList.contains("cat")) { p.before(s); recalcLignes(m); } return; }
    const dc = t.closest("[data-downcat]"); if (dc) { const s = dc.closest(".cat"), n = s.nextElementSibling; if (n?.classList.contains("cat")) { n.after(s); recalcLignes(m); } return; }
    const rm = t.closest("[data-rm]");
    if (rm) { rm.closest("tr").remove(); return recalcLignes(m); }
  });

  // glisser-déposer des lignes et des sections
  let drag = null;
  m.addEventListener("mousedown", (e) => {
    const h = e.target.closest("[data-drag]"), hc = e.target.closest("[data-dragcat]");
    if (h) h.closest("tr").draggable = true; if (hc) hc.closest(".cat").draggable = true;
  });
  m.addEventListener("mouseup", () => $$("[draggable=true]", m).forEach((x) => (x.draggable = false)));
  m.addEventListener("dragstart", (e) => {
    const tr = e.target.closest?.("tr.lr"), cat = e.target.closest?.(".cat");
    const el = tr?.draggable ? tr : cat?.draggable ? cat : null;
    if (!el) return;
    drag = el; el.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", "pilot"); } catch (er) { /* ignoré */ }
  });
  m.addEventListener("dragover", (e) => {
    if (!drag) return;
    const isRow = drag.matches("tr.lr");
    const over = isRow ? e.target.closest("tr.lr") : e.target.closest(".cat");
    if (over === drag) return e.preventDefault();
    if (isRow) {
      if (over) { e.preventDefault(); const r = over.getBoundingClientRect(); (e.clientY < r.top + r.height / 2) ? over.before(drag) : over.after(drag); return; }
      const sec = e.target.closest(".cat"); if (sec) { e.preventDefault(); $(".lb", sec).appendChild(drag); }
    } else if (over) { e.preventDefault(); const r = over.getBoundingClientRect(); (e.clientY < r.top + r.height / 2) ? over.before(drag) : over.after(drag); }
  });
  m.addEventListener("drop", (e) => { if (drag) e.preventDefault(); });
  m.addEventListener("dragend", () => { if (!drag) return; drag.classList.remove("dragging"); drag.draggable = false; drag = null; recalcLignes(m); });

  shPreview(m, K, d);
}
