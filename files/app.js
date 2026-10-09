/* Pilot : point d'entrée. Barre latérale, événements, actions, démarrage. */

/* ---------- Thème ---------- */
let th = "light";
try { th = localStorage.getItem("pilot-th") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"); } catch (e) {}
const setTh = (t) => {
  th = t;
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem("pilot-th", t); } catch (e) {}
};

/* ---------- Barre latérale (redimensionnable) ---------- */
const SW = { min: 76, max: 360, def: 248, compact: 150 };
function setSide(px, save = true) {
  px = Math.max(SW.min, Math.min(SW.max, Math.round(px)));
  document.documentElement.style.setProperty("--sw", px + "px");
  $("#app").classList.toggle("compact", px < SW.compact);
  if (save) try { localStorage.setItem("pilot-sw", px); } catch (e) {}
  return px;
}
function buildSide() {
  const side = $("#side");
  const item = ([k, l]) => `<button class="nav" data-go="${k}" aria-current="false" title="${esc(l)}">${svg(ic[k])}<span class="t">${esc(l)}</span></button>`;
  side.innerHTML = `<div class="logo"><i>P</i><b>Pilot</b></div>` +
    NAV.map((n) => (n[2] ? `<div class="ng">${esc(n[2])}</div>` : "") + item(n)).join("") +
    `<div class="sp"></div>` + item(["params", "Paramètres"]) +
    `<div class="rz" role="separator" aria-orientation="vertical" aria-label="Redimensionner le menu" tabindex="0"></div>`;
  let w = SW.def;
  try { w = parseInt(localStorage.getItem("pilot-sw")) || SW.def; } catch (e) {}
  setSide(w, false);
  const rz = $(".rz", side);
  rz.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    rz.setPointerCapture(e.pointerId);
    rz.classList.add("on");
    document.body.style.userSelect = "none";
    const mv = (ev) => setSide(ev.clientX, false);
    const up = () => {
      rz.classList.remove("on");
      document.body.style.userSelect = "";
      rz.removeEventListener("pointermove", mv);
      rz.removeEventListener("pointerup", up);
      setSide(parseInt(getComputedStyle(document.documentElement).getPropertyValue("--sw")) || SW.def);
    };
    rz.addEventListener("pointermove", mv);
    rz.addEventListener("pointerup", up);
  });
  rz.addEventListener("dblclick", () => setSide(SW.def));
  rz.addEventListener("keydown", (e) => {
    const cur = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--sw")) || SW.def;
    if (e.key === "ArrowLeft") { e.preventDefault(); setSide(cur - 16); }
    if (e.key === "ArrowRight") { e.preventDefault(); setSide(cur + 16); }
  });
}

/* ---------- Pop-overs ---------- */
function closePops(except) {
  [["#notifpop", "#bell"], ["#usermenu", "#av"]].forEach(([p, b]) => {
    if (p === except) return;
    $(p).hidden = true;
    $(b).setAttribute("aria-expanded", "false");
  });
}
function togglePop(pop, btnSel, html) {
  closePops(pop);
  const el = $(pop);
  el.hidden = !el.hidden;
  $(btnSel).setAttribute("aria-expanded", String(!el.hidden));
  if (!el.hidden) el.innerHTML = html();
}
const userMenu = () => `<div class="mi who">${esc(email)}</div><button class="mi" data-go="params">${svg(ic.params)}Paramètres</button><button class="mi" data-act="logout">${svg(ic.out)}Se déconnecter</button>`;

/* ---------- Notifications ---------- */
async function notifOpen(id) {
  const n = db.notifs.find((x) => x.id === id);
  if (!n) return;
  if (!n.lu && !ro) { n.lu = true; renderBell(); try { await q(sb.from("notifications").update({ lu: true }).eq("id", id)); } catch (e) {} }
  closePops();
  if (n.lien) go(n.lien.replace(/^#?\/?/, ""));
}
async function notifAll() {
  if (ro) return;
  await q(sb.from("notifications").update({ lu: true }).eq("lu", false));
  db.notifs.forEach((n) => (n.lu = true));
  renderBell();
}

/* ---------- Suppressions ---------- */
async function del(table, id, msg, after, done = "Supprimé.") {
  if (!guard() || !confirm(msg)) return;
  await q(sb.from(table).delete().eq("id", id));
  toast(done);
  await refresh();
  if (after) go(after);
}

/* ---------- Actions (data-act) ---------- */
const ACT = {
  ...docActions,
  ...achatActions,
  tab: (id, arg) => { ST.tab[id] = arg; return render(true); },
  period: (id, arg) => { ST.period = arg; return render(true); },
  gran: (id, arg) => { ST.gran = arg; return render(true); },
  yearPrev: () => { ST.year--; return render(true); },
  yearNext: () => { ST.year++; return render(true); },
  go: (id) => go(id),
  notif: (id) => notifOpen(id),
  notifAll: () => notifAll(),
  logout: async () => { closePops(); await sb.auth.signOut(); },

  clientNew: () => guard() && clientForm(),
  clientEdit: (id) => guard() && clientForm(byId(db.clients, id)),
  clientDel: async (id) => {
    if (!guard()) return;
    const c = byId(db.clients, id), fa = db.factures.filter((f) => f.client_id === id), dv = db.devis.filter((d) => d.client_id === id), ch = db.chantiers.filter((x) => x.client_id === id);
    const em = fa.filter((f) => f.statut !== "Brouillon");
    if (em.length) return toast(`Suppression impossible : ${esc(c.nom)} a ${em.length} facture${em.length > 1 ? "s" : ""} émise${em.length > 1 ? "s" : ""}, à conserver pour la comptabilité. Vous pouvez modifier la fiche.`, "dn");
    const l = [dv.length && `${dv.length} devis`, fa.length && `${fa.length} brouillon${fa.length > 1 ? "s" : ""} de facture`, ch.length && `${ch.length} chantier${ch.length > 1 ? "s" : ""}`].filter(Boolean);
    if (!confirm(`Supprimer « ${c.nom} » ?${l.length ? `\n\nSeront aussi supprimés : ${l.join(", ")}.` : ""}\n\nCette action est définitive.`)) return;
    for (const f of fa) await q(sb.from("factures").delete().eq("id", f.id));
    for (const d of dv) await q(sb.from("devis").delete().eq("id", d.id));
    for (const x of ch) { await q(sb.from("depenses").update({ chantier_id: null }).eq("chantier_id", x.id)); await q(sb.from("chantiers").delete().eq("id", x.id)); }
    await q(sb.from("clients").delete().eq("id", id));
    toast("Client supprimé.");
    await refresh();
    go("clients");
  },
  chantierNew: (id, arg) => guard() && chantierForm(null, arg?.startsWith("client:") ? arg.slice(7) : ""),
  chantierEdit: (id) => guard() && chantierForm(byId(db.chantiers, id)),
  chantierDel: async (id) => {
    if (!guard()) return;
    const c = byId(db.chantiers, id), fa = db.factures.filter((f) => f.chantier_id === id), dv = db.devis.filter((d) => d.chantier_id === id), dp = db.depenses.filter((d) => d.chantier_id === id);
    const em = fa.filter((f) => f.statut !== "Brouillon");
    if (em.length) return toast(`Suppression impossible : ce chantier a ${em.length} facture${em.length > 1 ? "s" : ""} émise${em.length > 1 ? "s" : ""}, à conserver pour la comptabilité. Passez-le plutôt en « Terminé ».`, "dn");
    const n = fa.length + dv.length + dp.length;
    if (!confirm(`Supprimer le chantier « ${c.nom} » ?${n ? `\n\nLes ${n} document${n > 1 ? "s" : ""} et dépense${n > 1 ? "s" : ""} rattaché${n > 1 ? "s" : ""} sont conservés, mais ne seront plus liés à un chantier.` : ""}`)) return;
    for (const t of ["devis", "factures", "depenses"]) await q(sb.from(t).update({ chantier_id: null }).eq("chantier_id", id));
    await q(sb.from("chantiers").delete().eq("id", id));
    toast("Chantier supprimé.");
    await refresh();
    go("chantiers");
  },

  payNew: (id, arg) => payForm(id || "", arg),
  payDel: (id) => del("paiements", id, "Supprimer ce paiement ?"),
  depNew: (id, arg) => depForm(null, { chantier: arg?.startsWith("chantier:") ? arg.slice(9) : "" }),
  depImport: () => depImport(),
  depEdit: (id) => depForm(byId(db.depenses, id)),
  depDel: (id) => del("depenses", id, "Supprimer cette dépense ?"),
  depPay: async (id) => {
    if (!guard()) return;
    await q(sb.from("depenses").update({ statut: "Payée", date_paiement: today() }).eq("id", id));
    toast("Dépense marquée comme payée.", "ok");
    await refresh();
  },

  exportCsv: (id, arg) => exportCsv(arg || id),
  exportZip: () => exportZip(),
  docNew: () => docComptaForm(),
  docOpen: (id) => { const x = byId(db.docsCompta, id); if (x) openFile(x.chemin); },
  docDel: (id) => del("documents_compta", id, "Supprimer ce document ?"),
  accesDel: (id) => del("acces_comptable", id, "Retirer l'accès de ce comptable ?", null, "Accès retiré."),

  modelePick: (id, arg) => modelePick(arg),
  modeleDel: (id, arg) => modeleDel(arg),
  modelePreview: (id, arg) => modelePreview(arg),
  logoPick: () => {
    if (!guard()) return;
    pickFile("image/png,image/jpeg", async (f) => {
      const old = db.ent.logo_path;
      const path = await uploadDoc(f, "logo");
      await entPatch({ logo_path: path });
      if (old) { _assets.delete(old); sb.storage.from("documents").remove([old]); }
      toast("Logo enregistré.", "ok");
      await refresh();
    });
  },
  logoDel: async () => {
    if (!guard()) return;
    const old = db.ent.logo_path;
    await entPatch({ logo_path: null });
    if (old) { _assets.delete(old); sb.storage.from("documents").remove([old]); }
    await refresh();
  },
};

const run = async (fn) => {
  try { await fn(); } catch (e) { console.error(e); toast(esc(friendly(e)), "dn"); }
};

/* ---------- Événements ---------- */
document.addEventListener("click", (e) => {
  const t = e.target;
  if (t.closest("#bell")) return togglePop("#notifpop", "#bell", notifPanel);
  if (t.closest("#av")) return togglePop("#usermenu", "#av", userMenu);
  if (t.closest("#th")) return setTh(th === "dark" ? "light" : "dark");
  const a = t.closest("[data-act]");
  if (a && !a.disabled) {
    e.preventDefault();
    const f = ACT[a.dataset.act];
    if (!f) return console.warn("Action inconnue", a.dataset.act);
    if (!t.closest(".pop")) closePops();
    return run(() => f(a.dataset.id || "", a.dataset.arg || "", a));
  }
  const g = t.closest("[data-go]");
  if (g && !(t.closest("a, button, input, select, textarea, label") && t.closest("a, button, input, select, textarea, label") !== g)) {
    closePops();
    return go(g.dataset.go);
  }
  if (!t.closest(".pw")) closePops();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closePops();
  if ((e.key === "Enter" || e.key === " ") && e.target.matches?.("tr.lnk[data-go]")) { e.preventDefault(); go(e.target.dataset.go); }
});
document.addEventListener("submit", (e) => {
  const f = e.target.closest("form[data-form]");
  if (!f) return;
  e.preventDefault();
  const kind = f.dataset.form;
  run(async () => {
    if (kind === "ent") return saveEntForm(f);
    if (kind === "acces") {
      if (!guard()) return;
      const mail = f.email.value.trim().toLowerCase();
      if (!mail) return;
      await q(sb.from("acces_comptable").insert({ email: mail }));
      toast("Accès donné. Votre comptable doit créer un compte Pilot avec cette adresse email, puis se connecter.", "ok");
      await refresh();
    }
  });
});
document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.id === "couleur") return run(async () => { if (!guard()) return; await saveRegl((r) => { r.couleur = t.value; }); toast("Couleur enregistrée.", "ok"); });
  if (t.dataset?.marge) {
    const [K, side] = t.dataset.marge.split(":");
    const mm = parseNum(t.value);
    return run(async () => {
      if (!guard()) return;
      await saveRegl((r) => { r[K] ||= {}; r[K][side] = Math.max(0, Math.round(mm * MM)); });
      toast("Marge enregistrée.", "ok");
    });
  }
});
window.addEventListener("hashchange", () => { closePops(); render(); });

/* ---------- Démarrage ---------- */
setTh(th);
$("#bell").innerHTML = svg(ic.bell) + `<span class="bdg" id="bdg" hidden></span>`;
$("#th").innerHTML = svg(ic.moon);
buildSide();

if (!sb) showSetup();
else {
  let first = true;
  sb.auth.onAuthStateChange((ev, session) => {
    // setTimeout : évite un blocage connu quand on appelle Supabase dans le callback
    setTimeout(() => {
      if (session) {
        if (uid === session.user.id && !first) return;
        first = false;
        start(session);
      } else {
        uid = null; channel = null; db = emptyDb(); first = true;
        $("#v").innerHTML = "";
        showLogin();
      }
    }, 0);
  });
}
