/* Connexion bancaire multi-comptes (PSD2) via la fonction Supabase « banque » (Enable Banking).
   Le client choisit sa banque, s'authentifie chez elle, revient dans Pilot : tous ses comptes sont créés et synchronisés.
   Les identifiants bancaires ne passent jamais par Pilot. Les opérations alimentent le même rapprochement que l'import de relevé. */

const CX_RETOUR = "pilot-cx";
const cxFmt = (iso) => (iso ? new Date(iso).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" }) : "jamais");

async function cxCall(body) {
  const { data, error } = await sb.functions.invoke("banque", { body });
  if (error) {
    let msg = "";
    try { msg = (await error.context.json()).error || ""; } catch (e) { /* pas de corps JSON */ }
    if (!msg) {
      const st = error.context?.status;
      msg = st === 404 || /not found|failed to send/i.test(error.message || "")
        ? "La fonction « banque » n'est pas installée sur votre Supabase. Voir supabase/functions/README.md."
        : error.message || "Connexion bancaire impossible.";
    }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

const cxOf = (id) => (db.connexions || []).find((c) => c.id === id);
const cxLeft = (c) => (c.valide_jusqu_au ? Math.ceil((new Date(c.valide_jusqu_au) - Date.now()) / 864e5) : null);
const cxStatut = (c) => (c.statut === "Active" && cxLeft(c) !== null && cxLeft(c) < 0 ? "Expirée" : c.statut);

function bkConnectCard() {
  if (!db.v7) return "";
  const list = db.connexions || [];
  const rows = list.map((c) => {
    const s = cxStatut(c), left = cxLeft(c), n = db.comptes.filter((a) => a.connexion_id === c.id).length;
    const cls = s === "Active" ? "ok" : s === "En attente" ? "wn" : "dn";
    const sub = s === "Active"
      ? `${n} compte${n > 1 ? "s" : ""} · dernière synchronisation : ${cxFmt(c.derniere_synchro)}${left !== null ? ` · autorisation valable encore ${left} jour${left > 1 ? "s" : ""}` : ""}`
      : s === "Expirée" ? "L'autorisation donnée à la banque a expiré : reconnectez-la pour reprendre la synchronisation."
      : c.erreur ? esc(c.erreur) : "Connexion non terminée.";
    const acts = s === "Active"
      ? btn("Synchroniser", "cxSync", c.id, "", "sm w") + (left !== null && left <= 14 ? `<button class="lk w" data-act="cxNew" data-id="${c.id}">Renouveler</button>` : "")
      : btn(s === "Expirée" ? "Reconnecter" : "Réessayer", "cxNew", c.id, "", "sm w");
    return `<div class="row"><div><b>${esc(c.banque)}</b> <span class="chip ${cls}">${esc(s)}</span><small>${sub}</small></div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">${acts}<button class="lk w" data-act="cxDel" data-id="${c.id}">Déconnecter</button></div></div>`;
  }).join("");
  const head = list.length ? "" : `<p class="mut" style="margin:0;padding:16px 18px">Reliez une ou plusieurs banques : tous leurs comptes arrivent dans Pilot, mis à jour automatiquement. Vous vous identifiez sur le site de votre banque, Pilot ne voit jamais vos codes. Lecture seule : aucune opération n'est possible depuis Pilot.</p>`;
  return card("Connexions bancaires", head + rows + (ro ? "" : `<div class="cb" style="border-top:1px solid var(--line2)">${btn("Connecter une banque", "cxNew", "", "", "w")}</div>`), "");
}

// Choix de la banque, puis redirection vers son site
function cxNew(renewId) {
  if (!guard()) return;
  if (!db.v7) return setupV7("connexions bancaires");
  const old = renewId ? cxOf(renewId) : null;
  const body = `<div class="frm">
    <p class="mut full" style="margin:0">Vous allez être redirigé vers le site de votre banque pour autoriser la lecture de vos comptes. L'accord est valable 90 jours au plus (règle européenne), puis à renouveler en un clic.</p>
    <label class="fl full"><span>Banque</span><select name="bank" id="cxbank" required><option value="">Chargement des banques…</option></select></label>
    <label class="fl"><span>Type de compte</span><select name="psu"><option value="business">Compte professionnel</option><option value="personal">Compte personnel</option></select></label></div>`;
  modal(old ? "Renouveler la connexion" : "Connecter une banque", body, {
    submit: "Continuer vers ma banque",
    onMount: async (m) => {
      const sel = $("#cxbank", m);
      try {
        const { banks } = await cxCall({ action: "banks", country: "FR" });
        banks.sort((a, b) => a.name.localeCompare(b.name, "fr"));
        sel.innerHTML = `<option value="">Choisir…</option>` + banks.map((b) => `<option value="${esc(b.name)}" data-d="${b.days}">${esc(b.name)}</option>`).join("");
        if (old) sel.value = old.banque;
      } catch (e) { sel.innerHTML = `<option value="">Indisponible</option>`; $(".er", m).textContent = friendly(e); }
    },
    onSubmit: async (v, api) => {
      if (!v.bank) throw new Error("Choisissez votre banque.");
      const days = Number($("#cxbank option:checked", api.el)?.dataset.d) || 90;
      let id = old?.id;
      if (id) await q(sb.from("banque_connexions").update({ banque: v.bank, statut: "En attente", erreur: null }).eq("id", id));
      else id = (await q(sb.from("banque_connexions").insert({ banque: v.bank, pays: "FR" }).select("id").single())).id;
      const { url } = await cxCall({ action: "auth", bank: v.bank, country: "FR", psu_type: v.psu, days, connexion_id: id, redirect_url: location.origin + location.pathname });
      try { sessionStorage.setItem(CX_RETOUR, id); } catch (e) { /* facultatif */ }
      location.href = url;
      await new Promise(() => {}); // on quitte la page
    },
  });
}

// Au retour de la banque : ?code=...&state=<id de connexion>
async function cxHandleReturn() {
  const p = new URLSearchParams(location.search);
  const state = p.get("state"), code = p.get("code"), err = p.get("error");
  if (!state || state.startsWith("gm:") || (!code && !err)) return;
  history.replaceState(null, "", location.pathname + "#/compta?tab=banque");
  if (!db.v7) return;
  if (err || !code) {
    const msg = p.get("error_description") || err || "Autorisation refusée.";
    try { await sb.from("banque_connexions").update({ statut: "Erreur", erreur: msg.slice(0, 300) }).eq("id", state); } catch (e) { /* ignoré */ }
    await load();
    toast("La banque n'a pas été connectée : " + msg, "dn");
    return;
  }
  toast("Récupération de vos comptes…");
  try {
    const r = await cxCall({ action: "session", connexion_id: state, code });
    await load();
    toast(`Banque connectée : ${r.accounts} compte${r.accounts > 1 ? "s" : ""}, ${r.added} opération${r.added > 1 ? "s" : ""} importée${r.added > 1 ? "s" : ""}.`, "ok");
  } catch (e) {
    try { await sb.from("banque_connexions").update({ statut: "Erreur", erreur: friendly(e).slice(0, 300) }).eq("id", state); } catch (e2) { /* ignoré */ }
    await load();
    toast(friendly(e), "dn");
  }
}

async function cxSync(id, quiet) {
  const c = cxOf(id);
  if (!c) return;
  try {
    if (!quiet) toast("Synchronisation…");
    const r = await cxCall({ action: "sync", connexion_id: id });
    if (!quiet || r.added) toast(r.added ? `${r.added} nouvelle${r.added > 1 ? "s" : ""} opération${r.added > 1 ? "s" : ""} importée${r.added > 1 ? "s" : ""}.` : "Déjà à jour.", "ok");
    await refresh();
  } catch (e) {
    if (!quiet) toast(friendly(e), "dn");
    await load();
    if (!quiet) await render(true);
  }
}

async function cxDel(id) {
  if (!guard()) return;
  const c = cxOf(id);
  if (!c || !confirm(`Déconnecter ${c.banque} ? Les comptes et opérations déjà importés sont conservés, mais ne seront plus mis à jour.`)) return;
  try { await cxCall({ action: "delete", connexion_id: id }); }
  catch (e) { await q(sb.from("banque_connexions").delete().eq("id", id)); }
  toast("Banque déconnectée.", "ok");
  await refresh();
}

// Synchronisation discrète, une fois par session, si la dernière date de plus de 12 h
let cxAuto = false;
async function cxAutoSync() {
  if (cxAuto || ro || !db.v7) return;
  cxAuto = true;
  for (const c of db.connexions || []) {
    if (cxStatut(c) !== "Active") continue;
    if (c.derniere_synchro && Date.now() - new Date(c.derniere_synchro) < 12 * 36e5) continue;
    await cxSync(c.id, true);
  }
}

// Pour l'accueil : autorisation bancaire expirée ou proche de l'expiration
function cxPriorite() {
  const out = [];
  for (const c of db.connexions || []) {
    const s = cxStatut(c), left = cxLeft(c);
    if (s === "Expirée") out.push({ c, titre: `Banque ${c.banque} : autorisation expirée`, detail: "La synchronisation est arrêtée. Reconnectez la banque pour reprendre.", lv: "i", score: 120 });
    else if (s === "Active" && left !== null && left <= 7) out.push({ c, titre: `Banque ${c.banque} : autorisation à renouveler`, detail: `Elle expire dans ${left} jour${left > 1 ? "s" : ""}.`, lv: "i", score: 90 });
  }
  return out;
}

const connexionActions = {
  cxNew: (id) => cxNew(id || ""),
  cxSync: (id) => cxSync(id),
  cxDel: (id) => cxDel(id),
};
