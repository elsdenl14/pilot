/* v16 · Sécurité, ergonomie et pilotage :
   chargement des tables v16, profils et permissions, accueil personnalisable, onglets internes, suivi des liens partagés, protection contre la fraude au RIB. */

async function loadV16() {
  db.v16 = false; db.v16err = "";
  Object.assign(db, { stPieces: [], stSits: [], moe: [], offres: [], cands: [], prefs: [], ribj: [], pvues: [] });
  const [pi, si, mo, of, ca, pr, rj] = await Promise.all([
    q(sb.from("st_pieces").select("*").order("created_at", { ascending: false })), q(sb.from("st_situations").select("*").order("date_situation", { ascending: false })),
    q(sb.from("moe_partages").select("*").order("created_at", { ascending: false })), q(sb.from("st_offres").select("*").order("created_at", { ascending: false })),
    q(sb.from("st_candidatures").select("*").order("created_at", { ascending: false })), q(sb.from("prefs").select("*")),
    q(sb.from("rib_journal").select("*").order("created_at", { ascending: false }).limit(200)),
  ]);
  si.forEach((x) => nz(x, ["cumul_ht", "precedent_ht", "montant_ht", "tva_taux", "tva_montant", "montant_ttc", "retenue_pct", "retenue_eur", "net_a_payer"]));
  mo.forEach((x) => nz(x, ["total_ht"])); of.forEach((x) => { if (x.budget_ht != null) x.budget_ht = Number(x.budget_ht); });
  ca.forEach((x) => { if (x.prix_ht != null) x.prix_ht = Number(x.prix_ht); });
  Object.assign(db, { stPieces: pi, stSits: si, moe: mo, offres: of, cands: ca, prefs: pr, ribj: rj });
  // consultations : colonnes ajoutées par la v16 sur les liens partagés
  db.partages = await q(sb.from("partages").select("token,type,doc_id,vu_at,accepte_at,accepte_par,refuse_at,created_at,expire_at,revoque_at,nb_vues,derniere_vue_at,pdf_path").order("created_at", { ascending: false }));
  db.v16 = true;
}
const prefGet = (cle, def) => (db.prefs || []).find((p) => p.cle === cle)?.valeur ?? def;
async function prefSet(cle, valeur) {
  const row = await q(sb.from("prefs").upsert({ user_id: uid, cle, valeur, updated_at: new Date().toISOString() }, { onConflict: "user_id,cle" }).select("*").single());
  const i = db.prefs.findIndex((p) => p.cle === cle);
  if (i >= 0) db.prefs[i] = row; else db.prefs.push(row);
}
const secHash = async (s) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s))))].map((b) => b.toString(16).padStart(2, "0")).join("");

/* ---------- Profils et permissions ---------- */
const PERMS = [["marges", "Marges et rentabilité"], ["banque", "Banque, paiements et trésorerie"], ["compta", "Comptabilité et facture électronique"], ["ventes", "Devis, factures, clients"],
  ["achats", "Achats, fournisseurs, sous-traitants"], ["rh", "Salaires, équipes et pointages"], ["params", "Paramètres, rôles et sécurité"], ["ecriture", "Créer et modifier des données"]];
const PROFILS = { dirigeant: "Dirigeant", conducteur: "Conducteur de travaux", administratif: "Administratif", comptable: "Comptable", compagnon: "Compagnon" };
const PROFIL_DEF = {
  dirigeant: PERMS.map((p) => p[0]),
  conducteur: ["ventes", "achats", "rh", "ecriture"],
  administratif: ["ventes", "achats", "ecriture"],
  comptable: ["banque", "compta", "ventes", "achats"],
  compagnon: [],
};
const PAGE_PERM = { rentabilite: "marges", analyses: "marges", objectifs: "marges", marches: "marges", paiements: "banque", tresorerie: "banque", compta: "compta", efacture: "compta",
  pointages: "rh", equipes: "rh", params: "params", roles: "params", devis: "ventes", factures: "ventes", clients: "ventes", moe: "ventes", liens: "ventes", mails: "ventes", ouvrages: "ventes",
  achats: "achats", fournisseurs: "achats", bc: "achats", rapprochement: "achats", depenses: "achats", soustraitants: "achats", stdossiers: "achats", stsituations: "achats", stoffres: "achats" };
function roleActive() { let p = "dirigeant"; try { p = localStorage.getItem("pilot-profil") || "dirigeant"; } catch (e) {} return PROFILS[p] ? p : "dirigeant"; }
const roleCfg = () => prefGet("roles", {}) || {};
function permOk(k) {
  if (ro) return true; // l'accès comptable (lecture seule) reste géré côté serveur
  const p = roleActive();
  if (p === "dirigeant") return true;
  return (roleCfg().matrix?.[p] || PROFIL_DEF[p] || []).includes(k);
}
const permBlocked = (page) => !!PAGE_PERM[page] && !permOk(PAGE_PERM[page]);
const permNav = (page) => !permBlocked(page);
const permWriteBlocked = () => !permOk("ecriture");
const permDenied = () => `<div class="empty"><h2>Accès non autorisé</h2><p>Le profil « ${esc(PROFILS[roleActive()])} » n'a pas accès à cette page. Le dirigeant peut modifier les permissions dans Paramètres > Sécurité et rôles.</p><button class="btn" data-go="home">Retour à l'accueil</button></div>`;
function applyRole() {
  document.body.classList.toggle("ro", ro || permWriteBlocked());
  document.body.classList.toggle("nomarge", !permOk("marges"));
}
async function roleSwitch(target) {
  const cur = roleActive(), cfg = roleCfg();
  const apply = () => { try { localStorage.setItem("pilot-profil", target); } catch (e) {} applyRole(); buildSide(); go("home"); render(true); tabsDraw(); toast(`Profil actif : ${PROFILS[target]}.`, "ok"); };
  if (target === cur) return;
  if (cur === "dirigeant" && !cfg.pin) return toast("Définissez d'abord un code de déverrouillage (Sécurité et rôles) : sans lui, personne ne pourrait revenir au profil dirigeant.", "dn");
  if (cur !== "dirigeant" && cfg.pin) {
    modal("Déverrouillage", `<p class="mut" style="margin:0 0 10px">Le code du dirigeant est demandé pour changer de profil.</p><div class="frm">${fld({ k: "pin", l: "Code de déverrouillage", t: "password", v: "", cls: "full" })}</div>`, {
      submit: "Déverrouiller",
      onSubmit: async (v, api) => { if ((await secHash(uid + ":" + v.pin)) !== cfg.pin) throw new Error("Code incorrect."); api.close(); apply(); },
    });
    return;
  }
  apply();
}
function pinForm() {
  if (!guard()) return;
  const cfg = roleCfg();
  modal(cfg.pin ? "Changer le code de déverrouillage" : "Définir le code de déverrouillage", `<div class="frm">${cfg.pin ? fld({ k: "old", l: "Code actuel", t: "password", v: "", cls: "full" }) : ""}
    ${fld({ k: "pin", l: "Nouveau code (4 chiffres ou plus)", t: "password", v: "", cls: "full" })}</div><p class="note" style="margin:10px 0 0">Ce code protège le retour au profil dirigeant sur un poste partagé (tablette de chantier, ordinateur du bureau). Il ne remplace pas la séparation des comptes : voir les limites dans le guide.</p>`, {
    onSubmit: async (v, api) => {
      if (cfg.pin && (await secHash(uid + ":" + v.old)) !== cfg.pin) throw new Error("Le code actuel est incorrect.");
      if (String(v.pin).length < 4) throw new Error("Le code doit comporter au moins 4 caractères.");
      await prefSet("roles", { ...cfg, pin: await secHash(uid + ":" + v.pin) });
      api.close(); toast("Code enregistré.", "ok"); await refresh();
    },
  });
}
async function permToggle(profil, perm) {
  if (!guard() || profil === "dirigeant") return;
  const cfg = roleCfg(), cur = new Set(cfg.matrix?.[profil] || PROFIL_DEF[profil]);
  cur.has(perm) ? cur.delete(perm) : cur.add(perm);
  await prefSet("roles", { ...cfg, matrix: { ...(cfg.matrix || {}), [profil]: [...cur] } });
  await refresh();
}

/* ---------- Page Sécurité et rôles (profils, coordonnées bancaires) ---------- */
V.roles = () => {
  if (!db.v16) return page("Sécurité et rôles", "", "", card("", stoSetup()));
  const tab = ST.tab.roles || "profils", cfg = roleCfg(), act = roleActive();
  const tb = tabs("roles", [["profils", "Profils et permissions"], ["rib", "Coordonnées bancaires"]], tab);
  let body = "";
  if (tab === "rib") {
    const j = db.ribj || [];
    body = card("Journal des modifications de coordonnées bancaires", tbl(["Date", "Élément", "Opération", "Ancien", "Nouveau", "Auteur", "Contrôle"], j.map((x) => ({ t: x.libelle, c: [D(x.created_at) + " " + String(x.created_at).slice(11, 16), `${x.source === "entreprise" ? "Entreprise" : x.source === "rib" ? "RIB client" : "Fournisseur"}${x.libelle ? " · " + esc(x.libelle) : ""}`, esc(x.operation),
      `<code>${esc(bkMask ? bkMask((x.ancien || "").split(" /")[0]) : x.ancien || "-")}</code>`, `<code>${esc(bkMask ? bkMask((x.nouveau || "").split(" /")[0]) : x.nouveau || "-")}</code>`, esc(x.auteur_email || "-"), x.motif ? `<span class="chip ok">${esc(x.verifie || "Vérifié")}</span><small>${esc(x.motif)}</small>` : `<span class="chip wn">Non justifié</span>`] })), "Aucune modification enregistrée.")
      + `<p class="note" style="margin:0;padding:12px 18px">Le journal est écrit par la base de données elle-même à chaque changement d'IBAN (entreprise, RIB affichés aux clients, fournisseurs). Il ne peut ni être modifié ni supprimé depuis Pilot ; seule la justification peut être complétée.</p>`);
  } else {
    const cols = Object.keys(PROFILS);
    body = card("Profil de ce poste", `<div class="row"><div><b>${esc(PROFILS[act])}</b><small>Le profil actif s'applique à cet appareil uniquement. Il masque les pages et les actions non autorisées.</small></div>
        <span>${cols.filter((p) => p !== act).map((p) => btn(esc(PROFILS[p]), "roleSwitch", p, "", "o sm")).join(" ")}</span></div>
      <div class="row"><div><b>Code de déverrouillage</b><small>${cfg.pin ? "Défini : il est demandé pour revenir au profil dirigeant." : "Non défini : obligatoire avant de passer à un autre profil."}</small></div>${btn(cfg.pin ? "Changer" : "Définir", "rolePin", "", "", "o sm w")}</div>`)
      + card("Permissions par profil", tbl(["Permission", ...cols.map((c) => PROFILS[c])], PERMS.map(([k, l]) => ({ c: [esc(l), ...cols.map((c) => { const on = c === "dirigeant" || (cfg.matrix?.[c] || PROFIL_DEF[c]).includes(k); return c === "dirigeant" ? `<span class="chip ok">Oui</span>` : `<button class="chip ${on ? "ok" : "mu"}" data-act="permToggle" data-id="${c}" data-arg="${k}" style="cursor:pointer;border:0" aria-pressed="${on}">${on ? "Oui" : "Non"}</button>`; })] })))
        + `<p class="note" style="margin:0;padding:12px 18px"><b>Limite à connaître :</b> ces profils sont une protection de l'interface sur un poste partagé. Ils ne créent pas de comptes séparés : un utilisateur qui connaît les identifiants du compte reste le dirigeant. L'accès comptable en lecture seule (Paramètres), lui, est appliqué par la base de données.</p>`);
  }
  return page("Sécurité et rôles", "Profils, permissions et traçabilité des coordonnées bancaires.", "", tb + body);
};

/* ---------- Accueil personnalisable ---------- */
const HOME_W = [["kpi", "Indicateurs clés"], ["finance", "Vue financière (graphique 12 mois)"], ["atraiter", "À traiter"], ["echeances", "Échéances des 14 jours"], ["chantiers", "Chantiers en cours"], ["devis", "Devis en attente de réponse"], ["collab", "Collaboration externe"], ["liens", "Liens consultés récemment"], ["rib", "Alerte coordonnées bancaires"]];
const HOME_DEF = { order: HOME_W.map((w) => w[0]), hidden: ["devis", "liens"] };
const homeKey = () => "accueil:" + roleActive();
function homeLayout() {
  const l = prefGet(homeKey(), null) || HOME_DEF, known = HOME_W.map((w) => w[0]);
  const order = [...(l.order || []).filter((x) => known.includes(x)), ...known.filter((x) => !(l.order || []).includes(x))];
  return { order, hidden: (l.hidden || []).filter((x) => known.includes(x)) };
}
function ribRecent(days = 30) {
  const lim = new Date(Date.now() - days * 864e5).toISOString();
  return (db.ribj || []).filter((x) => x.created_at >= lim && x.source !== "fournisseur");
}
function homeWidget(id, c) {
  const t = c.t;
  if (id === "kpi") {
    const it = [];
    if (permOk("banque")) it.push(["Trésorerie estimée", E(tresorerie()), "encaissements - décaissements", tresorerie() < 0 ? "dn" : ""]);
    if (permOk("ventes")) it.push(["À encaisser", E(c.enc), c.encR ? `dont ${E(c.encR)} en retard` : "rien en retard", ""]);
    if (permOk("achats")) it.push(["À payer aux fournisseurs", E(sum(c.aPayer, (d) => d.montant_ttc)), `${c.aPayer.length} facture${c.aPayer.length > 1 ? "s" : ""}`]);
    if (permOk("ventes")) it.push(["CA du mois (HT)", E(c.caM), c.evo === null ? "pas de mois précédent" : `${c.evo >= 0 ? "+" : ""}${c.evo} % par rapport au mois précédent`, c.evo > 0 ? "up" : ""]);
    return it.length ? strip(it) : "";
  }
  if (id === "finance") return permOk("banque") && typeof homeFinance === "function" ? homeFinance() : "";
  if (id === "atraiter") {
    const pr = c.pr, n = { u: pr.filter((p) => p.lv === "u").length, i: pr.filter((p) => p.lv === "i").length, s: pr.filter((p) => p.lv === "s").length };
    return card("À traiter", pr.length ? pr.map(prioRow).join("") : `<div class="allgood"><b>Rien d'urgent.</b>Aucune facture en retard, aucun devis à relancer.</div>`,
      pr.length ? `<div class="sum-lv"><span><b>${n.u}</b> urgent${n.u > 1 ? "s" : ""}</span><span><b>${n.i}</b> important${n.i > 1 ? "s" : ""}</span><span><b>${n.s}</b> à suivre</span></div>` : "");
  }
  if (id === "echeances") {
    const h = addDays(t, 14);
    const ech = [...(permOk("ventes") ? ouvertes().flatMap((f) => {
      const l = echStatut(f).filter((e) => e.reste > 0.005);
      const it = l.length ? l.map((e) => ({ d: e.date_echeance, l: f.client_nom, s: `${f.numero} · ${e.libelle || "échéance"}`, m: e.reste, go: `factures/${f.id}` })) : [{ d: f.echeance, l: f.client_nom, s: f.numero, m: f.reste, go: `factures/${f.id}` }];
      return it.filter((x) => x.d >= t && x.d <= h);
    }) : []), ...(permOk("achats") ? c.aPayer.filter((x) => x.echeance && x.echeance >= t && x.echeance <= h).map((x) => ({ d: x.echeance, l: x.fournisseur, s: "À payer", m: -x.montant_ttc, go: `depenses/${x.id}` })) : [])].sort((a, b) => a.d.localeCompare(b.d));
    return card("Échéances des 14 prochains jours", ech.length ? ech.map((e) => `<div class="ech lnk" data-go="${e.go}" style="cursor:pointer"><time>${D(e.d).slice(0, 5)}</time><div><b>${esc(e.l)}</b><small>${esc(e.s)}</small></div><span class="num ${e.m < 0 ? "dn" : "up"}">${e.m < 0 ? "-" : "+"} ${E(Math.abs(e.m))}</span></div>`).join("") : `<p class="emp" style="padding:18px;margin:0;color:var(--mut)">Aucune échéance dans les 14 prochains jours.</p>`);
  }
  if (id === "chantiers") {
    const l = db.chantiers.filter((x) => x.statut === "En cours" || x.statut === "À surveiller").slice(0, 5);
    return card("Chantiers en cours", l.length ? l.map((x) => `<div class="row lnk" data-go="chantiers/${x.id}" style="cursor:pointer"><div><b>${esc(x.nom)}</b><small>${esc(x.client_nom)}${x.ville ? " · " + esc(x.ville) : ""}</small></div><span>${chip(x.statut)}${permOk("marges") ? finChip(x) : ""}</span></div>`).join("") : `<p class="emp" style="padding:18px;margin:0;color:var(--mut)">Aucun chantier en cours.</p>`,
      `<button class="lk" data-go="chantiers">Tous les chantiers ${svg(ic.ar)}</button>`);
  }
  if (id === "devis") {
    if (!permOk("ventes")) return "";
    const l = db.devis.filter((d) => d.statut === "Envoyé").slice(0, 6);
    return card("Devis en attente de réponse", l.length ? l.map((d) => `<div class="row lnk" data-go="devis/${d.id}" style="cursor:pointer"><div><b>${esc(d.numero)} · ${esc(d.client_nom)}</b><small>envoyé le ${D(d.date_emission)}</small></div><span class="num">${E(d.montant_ht)}</span></div>`).join("") : `<p class="emp" style="padding:18px;margin:0;color:var(--mut)">Aucun devis en attente.</p>`);
  }
  if (id === "collab") {
    if (!db.v16 || !permOk("achats")) return "";
    const a = (db.stSits || []).filter((x) => x.statut === "Reçue").length, b = (db.cands || []).filter((x) => x.statut === "Reçue").length, m = (db.moe || []).filter((x) => ["En attente", "Commentée"].includes(x.statut)).length;
    const d = db.sts.filter((s) => s.actif !== false && !stoDossier(s).ok).length;
    return card("Collaboration externe", [["Situations de sous-traitants à vérifier", a, "stsituations"], ["Candidatures à examiner", b, "stoffres"], ["Validations maître d'œuvre en attente", m, "moe"], ["Dossiers sous-traitants à compléter", d, "stdossiers"]]
      .map(([l, n, g]) => `<div class="row lnk" data-go="${g}" style="cursor:pointer"><div><b>${l}</b></div><span class="chip ${n ? "wn" : "ok"}">${n}</span></div>`).join(""));
  }
  if (id === "liens") {
    if (!db.v16 || !permOk("ventes")) return "";
    const l = db.partages.filter((p) => p.derniere_vue_at || p.vu_at).sort((a, b) => String(b.derniere_vue_at || b.vu_at).localeCompare(String(a.derniere_vue_at || a.vu_at))).slice(0, 6);
    return card("Liens consultés récemment", l.length ? l.map((p) => { const d = linkDoc(p); return `<div class="row"><div><b>${esc(d.label)}</b><small>${esc(d.client)} · vu le ${D(p.derniere_vue_at || p.vu_at)}${p.nb_vues > 1 ? " · " + p.nb_vues + " fois" : ""}</small></div></div>`; }).join("") : `<p class="emp" style="padding:18px;margin:0;color:var(--mut)">Aucun lien consulté pour l'instant.</p>`,
      `<button class="lk" data-go="liens">Tous les liens ${svg(ic.ar)}</button>`);
  }
  if (id === "rib") {
    const r = ribRecent();
    if (!r.length) return "";
    return `<section class="card ribwarn"><div class="ch"><h2>Coordonnées bancaires modifiées récemment</h2></div><p style="margin:0;padding:12px 18px">${r.length} modification${r.length > 1 ? "s" : ""} ces 30 derniers jours (dernière le ${D(r[0].created_at)}). Si vous ne l'avez pas faite vous-même, changez votre mot de passe et vérifiez le journal.</p><div style="padding:0 18px 14px"><button class="lk" data-go="roles">Voir le journal</button></div></section>`;
  }
  return "";
}
V.home = () => {
  const t = today(), mois = curMonth(), pm = prevMonthKey();
  const caM = sum(emises().filter((f) => monthKey(f.date_emission) === mois), (f) => f.montant_ht), caP = sum(emises().filter((f) => monthKey(f.date_emission) === pm), (f) => f.montant_ht);
  const c = { t, caM, evo: caP ? Math.round(((caM - caP) / caP) * 100) : null, enc: sum(ouvertes(), (f) => f.reste), encR: sum(enRetard(), (f) => f.reste), aPayer: depensesAPayer(), pr: priorites() };
  const lay = homeLayout(), ribOn = ribRecent().length > 0;
  const shown = lay.order.filter((id) => !lay.hidden.includes(id) || (id === "rib" && ribOn));
  const html = shown.map((id) => ({ id, h: homeWidget(id, c) })).filter((x) => x.h);
  const full = html.filter((x) => x.id === "kpi" || x.id === "finance").sort((a, b) => (a.id === "kpi" ? -1 : 1) - (b.id === "kpi" ? -1 : 1)), rest = html.filter((x) => x.id !== "kpi" && x.id !== "finance");
  const d = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  return page("Bonjour", `${d.charAt(0).toUpperCase() + d.slice(1)}. Voici ce qui demande une décision.`,
    btn("Personnaliser", "homeCustom", "", "", "o") + (permOk("ventes") ? btn("Nouveau devis", "devisNew", "", "", "w") + btn("Nouvelle facture", "factureNew", "", "", "o w") : ""),
    `${full.map((x) => `<div class="acc-full">${x.h}</div>`).join("")}<div class="acc-grid">${rest.map((x) => `<div class="acc-w" data-w="${x.id}">${x.h}</div>`).join("")}</div>`);
};
function homeCustom() {
  const lay = homeLayout(), st = { order: [...lay.order], hidden: new Set(lay.hidden) };
  const draw = (m) => {
    $("#acclist", m).innerHTML = st.order.map((id, i) => `<div class="acc-it"><label><input type="checkbox" data-w="${id}" ${st.hidden.has(id) ? "" : "checked"}> ${esc(HOME_W.find((w) => w[0] === id)[1])}</label>
      <span><button type="button" class="ib" data-mv="-1" data-i="${i}" aria-label="Monter" ${i === 0 ? "disabled" : ""}>↑</button><button type="button" class="ib" data-mv="1" data-i="${i}" aria-label="Descendre" ${i === st.order.length - 1 ? "disabled" : ""}>↓</button></span></div>`).join("");
  };
  modal("Personnaliser mon accueil", `<p class="mut" style="margin:0 0 10px">Cochez les blocs à afficher et réordonnez-les. Ce réglage est propre au profil « ${esc(PROFILS[roleActive()])} ».</p><div id="acclist"></div>`, {
    submit: "Enregistrer", extra: btn("Réinitialiser", "homeReset", "", "", "lk"),
    onMount: (m) => {
      draw(m);
      m.addEventListener("click", (e) => { const b = e.target.closest("[data-mv]"); if (!b) return; const i = +b.dataset.i, j = i + +b.dataset.mv; [st.order[i], st.order[j]] = [st.order[j], st.order[i]]; draw(m); });
      m.addEventListener("change", (e) => { const c = e.target.closest("[data-w]"); if (!c || c.type !== "checkbox") return; c.checked ? st.hidden.delete(c.dataset.w) : st.hidden.add(c.dataset.w); });
    },
    onSubmit: async (v, api) => { await prefSet(homeKey(), { order: st.order, hidden: [...st.hidden] }); api.close(); toast("Accueil enregistré.", "ok"); await refresh(); },
  });
}

/* ---------- Onglets internes ---------- */
const TABS = { list: [], cur: null, restore: null };
const tabSave = () => { try { sessionStorage.setItem("pilot-tabs", JSON.stringify({ list: TABS.list, cur: TABS.cur })); } catch (e) {} };
const tabId = () => "t" + Math.random().toString(36).slice(2, 8);
function tabsInit() {
  if (TABS.ready) return; TABS.ready = true;
  try { const s = JSON.parse(sessionStorage.getItem("pilot-tabs") || "null"); if (s?.list?.length) { TABS.list = s.list.slice(0, 8); TABS.cur = s.list.some((x) => x.id === s.cur) ? s.cur : s.list[0].id; } } catch (e) {}
  if (!$("#itabs")) { const bar = document.createElement("div"); bar.id = "itabs"; bar.className = "itabs"; $("#v").before(bar); bar.addEventListener("click", tabClick); }
  document.addEventListener("click", tabModClick, true);
  document.addEventListener("auxclick", tabModClick, true);
}
function tabHashOf(el) { const g = el.closest("[data-go],a[href^='#/']"); if (!g) return null; return g.dataset.go ? "#/" + String(g.dataset.go).replace(/^#?\/?/, "") : g.getAttribute("href"); }
function tabModClick(e) {
  if (e.type === "click" ? !(e.ctrlKey || e.metaKey) : e.button !== 1) return;
  const h = tabHashOf(e.target); if (!h) return;
  e.preventDefault(); e.stopPropagation();
  tabOpen(h);
}
function tabOpen(hash) {
  tabsInit();
  if (TABS.list.length >= 8) return toast("8 onglets au maximum : fermez-en un.", "dn");
  const cur = TABS.list.find((x) => x.id === TABS.cur); if (cur) cur.scroll = window.scrollY;
  const t = { id: tabId(), hash, label: "…", scroll: 0 };
  TABS.list.push(t); TABS.cur = t.id; TABS.restore = 0; tabSave();
  if (location.hash === hash) render(); else location.hash = hash;
}
function tabClick(e) {
  const x = e.target.closest("[data-tclose]"), s = e.target.closest("[data-tsel]"), n = e.target.closest("[data-tnew]"), r = e.target.closest("[data-trole]");
  if (r) return roleActive() !== "dirigeant" ? roleSwitch("dirigeant") : go("roles");
  if (n) return tabOpen(location.hash || "#/");
  if (x) {
    const i = TABS.list.findIndex((t) => t.id === x.dataset.tclose); if (i < 0 || TABS.list.length <= 1) return;
    const was = TABS.cur === TABS.list[i].id; TABS.list.splice(i, 1);
    if (was) return tabSwitch(TABS.list[Math.max(0, i - 1)].id, true);
    tabSave(); return tabsDraw();
  }
  if (s) tabSwitch(s.dataset.tsel);
}
function tabSwitch(id, skipSave) {
  const cur = TABS.list.find((t) => t.id === TABS.cur); if (cur && !skipSave) cur.scroll = window.scrollY;
  const t = TABS.list.find((x) => x.id === id); if (!t || id === TABS.cur && !skipSave) return;
  TABS.cur = id; TABS.restore = t.scroll || 0; tabSave();
  if (location.hash === t.hash) render(); else location.hash = t.hash;
}
function tabsAfterRender() {
  tabsInit();
  const hash = location.hash || "#/", title = ($("#v h1")?.textContent || "").trim().replace(/\s+/g, " ").slice(0, 26) || "Accueil";
  let cur = TABS.list.find((t) => t.id === TABS.cur);
  if (!cur) { cur = { id: tabId(), hash, label: title, scroll: 0 }; TABS.list.push(cur); TABS.cur = cur.id; }
  cur.hash = hash; cur.label = title;
  if (TABS.restore != null) { window.scrollTo(0, TABS.restore); TABS.restore = null; }
  tabSave(); tabsDraw();
}
function tabsDraw() {
  const bar = $("#itabs"); if (!bar) return;
  const p = roleActive();
  bar.innerHTML = `<div class="it-l">${TABS.list.map((t) => `<span class="it ${t.id === TABS.cur ? "on" : ""}"><button type="button" data-tsel="${t.id}" title="${esc(t.label)}">${esc(t.label)}</button>${TABS.list.length > 1 ? `<button type="button" class="x" data-tclose="${t.id}" aria-label="Fermer l'onglet">×</button>` : ""}</span>`).join("")}
    <button type="button" class="it-n" data-tnew="1" title="Ouvrir la page actuelle dans un nouvel onglet (ou Ctrl+clic sur un lien)" aria-label="Nouvel onglet">+</button></div>
    ${db.v16 ? `<button type="button" class="it-r ${p === "dirigeant" ? "" : "on"}" data-trole="1">Profil : ${esc(PROFILS[p])}</button>` : ""}`;
}

/* ---------- Liens partagés : suivi de consultation ---------- */
function linkDoc(p) {
  const d = p.type === "devis" ? byId(db.devis, p.doc_id) : byId(db.factures, p.doc_id);
  return { label: d ? `${p.type === "devis" ? "Devis" : "Facture"} ${d.numero || "brouillon"}` : "Document supprimé", client: d?.client_nom || "", montant: d?.montant_ttc || 0 };
}
const linkEtat = (p) => p.revoque_at ? ["Révoqué", "mu"] : p.expire_at && new Date(p.expire_at) < new Date() ? ["Expiré", "dn"] : p.accepte_at ? ["Accepté", "ok"] : p.refuse_at ? ["Refusé", "dn"] : p.vu_at || p.nb_vues ? ["Consulté", "ok"] : ["Pas encore ouvert", "wn"];
V.liens = () => {
  if (!db.v16) return page("Liens partagés", "", "", card("", stoSetup()));
  const l = db.partages.filter((p) => ["devis", "facture"].includes(p.type));
  const rows = l.map((p) => { const d = linkDoc(p), [e, k] = linkEtat(p); return { act: "lienOpen", id: p.token, t: `${d.label} ${d.client}`, c: [`<strong>${esc(d.label)}</strong><small>${esc(d.client)}</small>`, D(p.created_at), p.vu_at ? D(p.vu_at) : "-", p.derniere_vue_at ? D(p.derniere_vue_at) : "-", `${p.nb_vues || 0}`, p.expire_at ? D(p.expire_at) : "Sans limite", `<span class="chip ${k}">${e}</span>`] }; });
  return page("Liens partagés", "Devis et factures envoyés par lien sécurisé, avec le suivi de leur consultation.", "",
    strip([["Liens actifs", l.filter((p) => !p.revoque_at).length, `${l.length} au total`], ["Jamais ouverts", l.filter((p) => !p.revoque_at && !p.vu_at && !p.nb_vues).length, "à relancer", ""], ["Consultés cette semaine", l.filter((p) => (p.derniere_vue_at || p.vu_at || "") >= new Date(Date.now() - 7 * 864e5).toISOString()).length, ""]])
    + searchBar("Rechercher un document, un client…", `${rows.length}`) + card("", tbl(["Document", "Envoyé le", "1re consultation", "Dernière", { h: "Vues", r: 1 }, "Expiration", "Statut"], rows, "Aucun lien partagé. Utilisez « Envoyer au client » depuis un devis ou une facture.")));
};
async function lienOpen(token) {
  const p = db.partages.find((x) => x.token === token), d = linkDoc(p), [e, k] = linkEtat(p);
  let vues = [];
  try { vues = await q(sb.from("partage_vues").select("*").eq("token", token).order("vu_at", { ascending: false }).limit(30)); } catch (x) {}
  const link = shareLink(token);
  modal(`${esc(d.label)} : suivi du lien`, `<dl class="kv"><dt>Client</dt><dd>${esc(d.client || "-")}</dd><dt>Statut</dt><dd><span class="chip ${k}">${e}</span></dd><dt>Expiration</dt><dd>${p.expire_at ? D(p.expire_at) : "Sans limite"}</dd><dt>Consultations</dt><dd>${p.nb_vues || 0}</dd></dl>
    <div class="sect-t" style="margin-top:12px">Historique des ouvertures</div>${vues.length ? vues.map((v) => `<div class="row"><div><b>${D(v.vu_at)} ${String(v.vu_at).slice(11, 16)}</b><small>${esc(/Mobile|iPhone|Android/i.test(v.ua || "") ? "Téléphone" : v.ua ? "Ordinateur" : "Appareil inconnu")}</small></div></div>`).join("") : `<p class="mut">Aucune ouverture enregistrée.</p>`}`, {
    submit: false, wide: true,
    onMount: (m) => { const f = $(".mc", m); f.insertAdjacentHTML("beforeend", `<div class="fa">${btn("Copier le lien", "lienCopy", token, "", "o")}${btn("+30 jours", "lienProlonge", token, "", "o w")}${p.revoque_at ? btn("Réactiver", "lienReactive", token, "", "o w") : btn("Révoquer", "lienRevoque", token, "", "o w dn")}</div>`); },
  });
}
const lienActions = {
  lienOpen: (id) => lienOpen(id),
  lienCopy: async (id) => { try { await navigator.clipboard.writeText(shareLink(id)); toast("Lien copié.", "ok"); } catch (e) { toast(shareLink(id)); } },
  lienProlonge: async (id) => { if (!guard()) return; const p = db.partages.find((x) => x.token === id), base = Math.max(Date.now(), p.expire_at ? new Date(p.expire_at).getTime() : 0); await q(sb.from("partages").update({ expire_at: new Date(base + 30 * 864e5).toISOString() }).eq("token", id)); document.querySelectorAll(".md").forEach((m) => m.remove()); toast("Lien prolongé de 30 jours.", "ok"); await refresh(); },
  lienRevoque: async (id) => {
    if (!guard() || !confirm("Révoquer ce lien ? Votre client ne pourra plus ouvrir le document ni le PDF.")) return;
    const p = db.partages.find((x) => x.token === id);
    await q(sb.from("partages").update({ revoque_at: new Date().toISOString() }).eq("token", id));
    if (p.pdf_path) { try { await sb.storage.from("partages").remove([p.pdf_path]); } catch (e) { console.warn(e); } }
    document.querySelectorAll(".md").forEach((m) => m.remove()); toast("Lien révoqué.", "ok"); await refresh();
  },
  lienReactive: async (id) => { if (!guard()) return; await q(sb.from("partages").update({ revoque_at: null }).eq("token", id)); document.querySelectorAll(".md").forEach((m) => m.remove()); toast("Lien réactivé : renvoyez le document depuis sa fiche pour régénérer le PDF.", "ok"); await refresh(); },
};

/* ---------- Protection contre la fraude au changement de RIB ---------- */
const ribNorm = (s) => String(s || "").replace(/\s/g, "").toUpperCase();
function ribConfirm(source, label, ancien, nouveau) {
  return new Promise((resolve) => {
    let done = false;
    const api = modal("Vérification avant de modifier des coordonnées bancaires", `<div class="ribwarn" style="padding:12px 14px;border-radius:8px;margin-bottom:12px"><b>Attention, fraude au changement de RIB.</b> Les escrocs se font passer pour un fournisseur, un client ou un collaborateur pour faire modifier un IBAN. Ne modifiez jamais des coordonnées sur la seule foi d'un email ou d'un SMS.</div>
      <dl class="kv"><dt>Concerné</dt><dd>${esc(label)}</dd><dt>Ancien IBAN</dt><dd><code>${esc(ancien ? bkMask(ancien) : "aucun")}</code></dd><dt>Nouvel IBAN</dt><dd><code>${esc(nouveau ? bkMask(nouveau) : "aucun")}</code></dd></dl>
      <div class="frm" style="margin-top:12px">${fld({ k: "verifie", l: "Comment avez-vous vérifié ce changement ?", t: "select", o: ["Appel au numéro connu (pas celui du message)", "Rendez-vous en personne", "Courrier ou document officiel", "Changement de mon propre compte bancaire", "Autre"], v: "Changement de mon propre compte bancaire", cls: "full" })}
      ${fld({ k: "motif", l: "Motif du changement", cls: "full", ph: "Ex. changement de banque au 1er décembre" })}
      <label class="chk full" style="display:flex;gap:8px"><input type="checkbox" name="ok" required> <span>Je confirme avoir vérifié ce changement par un canal fiable.</span></label></div>`, {
      submit: "Confirmer la modification", wide: true,
      onSubmit: async (v, a) => { if (v.motif.trim().length < 3) throw new Error("Indiquez le motif du changement."); done = true; a.close(); resolve({ motif: v.motif.trim(), verifie: v.verifie }); },
    });
    const obs = new MutationObserver(() => { if (!document.body.contains(api.el)) { obs.disconnect(); if (!done) resolve(null); } });
    obs.observe(document.body, { childList: true });
  });
}
async function ribAnnotate(source, info) {
  if (!info || !db.v16) return;
  try {
    const rows = await q(sb.from("rib_journal").select("id,motif,source,created_at").eq("source", source).order("created_at", { ascending: false }).limit(3));
    for (const r of rows) if (!r.motif && Date.now() - new Date(r.created_at).getTime() < 10 * 60e3) await q(sb.from("rib_journal").update({ motif: info.motif, verifie: info.verifie }).eq("id", r.id));
    db.ribj = await q(sb.from("rib_journal").select("*").order("created_at", { ascending: false }).limit(200));
  } catch (e) { console.warn("journal RIB", e); }
}
// Retourne null si l'utilisateur renonce, {} si aucune confirmation n'est nécessaire, sinon { motif, verifie }
async function ribGuard(source, label, ancien, nouveau, bicChanged = false) {
  if (!db.v16) return {};
  const a = ribNorm(ancien), n = ribNorm(nouveau);
  if (!a || (a === n && !bicChanged)) return {};
  return await ribConfirm(source, label, a, n);
}

const securiteActions = {
  roleSwitch: (id) => roleSwitch(id), rolePin: () => pinForm(), permToggle: (id, arg) => permToggle(id, arg),
  homeCustom: () => { if (guard()) homeCustom(); },
  homeReset: async () => { if (!guard()) return; await prefSet(homeKey(), { order: HOME_DEF.order, hidden: HOME_DEF.hidden }); document.querySelectorAll(".md").forEach((m) => m.remove()); toast("Accueil réinitialisé.", "ok"); await refresh(); },
  ...lienActions,
};
