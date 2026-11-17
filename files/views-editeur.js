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
  const lb = $$(".lb", m).pop();
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
