/* v16 · Portail de validation architecte / maître d'œuvre :
   une situation (ou un proforma) est figée en instantané et partagée par lien ; le maître d'œuvre valide ou commente ligne par ligne, sans compte. */

const MOE_ST = { "En attente": "wn", "Commentée": "wn", "Validée": "ok", "Validée avec réserves": "wn", "Refusée": "dn", "Révoquée": "mu" };
const moeLink = (t) => new URL("p.html?m=" + t, location.href).href;
const moeChip = (s) => `<span class="chip ${MOE_ST[s] || "n"}">${esc(s)}</span>`;

async function moeSnapshot(type, id) {
  if (type === "proforma") {
    const p = byId(db.pfs, id), d = byId(db.devis, p.devis_id);
    const lignes = (p.lignes || []).map((l) => { const ht = r2(Number(l.quantite) * Number(l.prix_unitaire_ht)); return { label: l.designation, marche: ht, prev: 0, cum: 100, montant: ht }; });
    return { titre: `Proforma ${p.numero}`, chantier_id: d?.chantier_id || null, lignes, total: r2(sum(lignes, (l) => l.montant)) };
  }
  const f = byId(db.factures, id), fd = fdOf(id);
  let lignes;
  if (fd?.avancement?.length) lignes = fd.avancement.map((a) => ({ label: a.label, marche: r2(a.marche), prev: Number(a.prev) || 0, cum: Number(a.cum) || 0, montant: r2((a.marche * ((Number(a.cum) || 0) - (Number(a.prev) || 0))) / 100) }));
  else lignes = (await lignesOf("facture", id)).map((l) => { const ht = r2(Number(l.quantite) * Number(l.prix_unitaire_ht)); return { label: l.designation, marche: ht, prev: 0, cum: 100, montant: ht }; });
  return { titre: `${fxLabel(f)} · ${f.client_nom}`, chantier_id: f.chantier_id || null, lignes, total: r2(sum(lignes, (l) => l.montant)) };
}
function moeSources() {
  const fs = db.factures.filter((f) => ["Situation", "Situation détaillée"].includes(fxNat(f))).map((f) => ({ v: "facture:" + f.id, l: `${f.statut === "Brouillon" ? "Brouillon" : f.numero} · ${fxLabel(f)} · ${f.client_nom}` }));
  const ps = (db.pfs || []).map((p) => ({ v: "proforma:" + p.id, l: `${p.numero} · proforma` }));
  return [...fs, ...ps];
}
function moeForm(pre) {
  if (!guard()) return;
  const src = moeSources();
  if (!src.length) return toast("Aucune situation ni proforma à partager. Créez d'abord une situation (Factures) ou un proforma (Devis).", "dn");
  modal("Envoyer au maître d'œuvre pour validation", `<div class="frm">
    ${fld({ k: "src", l: "Situation ou proforma à faire valider", t: "select", o: src, v: pre || src[0].v, cls: "full" })}
    ${fld({ k: "dest_nom", l: "Maître d'œuvre / architecte", v: "", r: 0 })}${fld({ k: "dest_email", l: "Email", t: "email", v: "", r: 0 })}
    ${fld({ k: "jours", l: "Lien valable (jours)", t: "number", v: "30" })}
    ${fld({ k: "message", l: "Message", t: "textarea", v: "Bonjour, merci de valider ou commenter les lignes de cette situation avant son émission définitive.", r: 0, cls: "full" })}</div>
    <p class="note" style="margin:10px 0 0">Le maître d'œuvre voit un instantané des lignes (avancements, montants HT) sans aucun accès à votre compte. Vous êtes notifié de sa réponse.</p>`, {
    submit: "Créer le lien",
    onSubmit: async (v, api) => {
      const [type, id] = v.src.split(":"), snap = await moeSnapshot(type, id), jours = Math.min(180, Math.max(1, Math.round(parseNum(v.jours)) || 30));
      const row = await q(sb.from("moe_partages").insert({ source_type: type, source_id: id, chantier_id: snap.chantier_id, titre: snap.titre, lignes: snap.lignes, total_ht: snap.total, dest_nom: v.dest_nom || null, dest_email: v.dest_email || null, message: v.message || null,
        expire_at: new Date(Date.now() + jours * 864e5).toISOString() }).select("*").single());
      api.close(); await refresh(); moeShow(row.id);
    },
  });
}
function moeShow(id) {
  const m = byId(db.moe, id), link = moeLink(m.token);
  const api = modal("Lien de validation", `<div class="sharebox"><p class="mut" style="margin:0">Envoyez ce lien au maître d'œuvre. Il peut valider, commenter chaque ligne ou refuser, sans créer de compte.</p>
    <div class="lnk-in"><input type="text" readonly value="${esc(link)}" id="moelk"><button type="button" class="btn o" id="moecp">Copier le lien</button></div></div>`, {
    cancel: "Fermer", submit: m.dest_email ? "Écrire l'email" : false,
    onSubmit: async (v, a) => { window.open(`mailto:${encodeURIComponent(m.dest_email)}?subject=${encodeURIComponent("Validation : " + m.titre)}&body=${encodeURIComponent((m.message || "") + "\n\n" + link + "\n\nCordialement,\n" + (db.ent.nom || ""))}`, "_blank"); a.close(); go("moe/" + id); },
  });
  $("#moecp", api.el).onclick = async () => { try { await navigator.clipboard.writeText(link); toast("Lien copié.", "ok"); } catch (e) { $("#moelk", api.el).select(); } };
}
function moeDetail(id) {
  const m = byId(db.moe, id);
  if (!m) return `<div class="empty"><h2>Demande introuvable</h2><button class="btn" data-go="moe">Retour</button></div>`;
  const av = {}; (m.avis || []).forEach((a) => (av[a.i] = a));
  const rows = (m.lignes || []).map((l, i) => { const a = av[i]; return { t: l.label, c: [esc(l.label), `<span class="num">${fmtNum(l.cum, 0)} %</span>`, `<span class="num">${E2(l.montant)}</span>`, a?.ok === true ? `<span class="chip ok">OK</span>` : a?.ok === false ? `<span class="chip dn">À revoir</span>` : "-", esc(a?.c || "")] }; });
  const expired = new Date(m.expire_at) < new Date();
  return page(`${esc(m.titre)} ${moeChip(m.statut)}`, `${m.dest_nom ? esc(m.dest_nom) + " · " : ""}version ${m.version} · ${expired ? "lien expiré" : "lien valable jusqu'au " + D(m.expire_at)}`,
    (m.statut !== "Révoquée" ? btn("Voir le lien", "moeLink", id, "", "o w") : "") + btn("Nouvelle version", "moeVersion", id, "", "o w") + (m.statut !== "Révoquée" ? btn("Révoquer", "moeRevoke", id, "", "o w") : "") + btn("Supprimer", "moeDel", id, "", "o w"),
    strip([["Total de la période", E(m.total_ht), "HT"], ["Consultations", m.nb_vues || 0, m.vu_at ? "première le " + D(m.vu_at) : "pas encore ouvert"], ["Décision", m.decide_at ? D(m.decide_at) : "-", m.decide_par ? esc(m.decide_par) : ""]])
    + card("Lignes et avis", tbl(["Ligne", { h: "Avancement cumulé", r: 1 }, { h: "Montant HT", r: 1 }, "Avis", "Commentaire"], rows, "Aucune ligne."))
    + (m.commentaire ? card("Commentaire général", `<p style="margin:0;padding:12px 18px;white-space:pre-wrap">${esc(m.commentaire)}</p>`) : "")
    + ((m.historique || []).length ? card("Historique", (m.historique || []).map((h) => `<div class="row"><div><b>${esc(h.decision)}</b><small>${esc(h.par)} · version ${h.version}</small></div><span class="mut">${D(h.at)}</span></div>`).join("")) : ""),
    crumbs(["Validations maître d'œuvre", "moe"], [m.titre]));
}
V.moe = (r) => {
  if (!db.v16) return page("Validations maître d'œuvre", "", "", card("", stoSetup()));
  if (r.arg) return moeDetail(r.arg);
  const l = [...(db.moe || [])].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return page("Validations maître d'œuvre", "Faites valider vos situations par l'architecte ou le maître d'œuvre avant de les émettre.", btn("Envoyer pour validation", "moeNew", "", "", "w"),
    strip([["En attente de réponse", l.filter((x) => ["En attente", "Commentée"].includes(x.statut)).length, "demandes ouvertes"], ["Validées", l.filter((x) => x.statut.startsWith("Validée")).length, ""], ["Refusées", l.filter((x) => x.statut === "Refusée").length, "", l.some((x) => x.statut === "Refusée") ? "dn" : ""]])
    + searchBar("Rechercher…", `${l.length}`) + card("", tbl(["Document", "Destinataire", { h: "HT", r: 1 }, "Version", "Statut", "Réponse"], l.map((x) => ({ go: `moe/${x.id}`, t: x.titre, c: [`<strong>${esc(x.titre)}</strong>`, esc(x.dest_nom || "-"), `<span class="num">${E2(x.total_ht)}</span>`, `v${x.version}`, moeChip(x.statut), x.decide_at ? D(x.decide_at) : "-"] })), "Aucune demande de validation.")));
};
function moeChantierCard(cid) {
  const l = (db.moe || []).filter((x) => x.chantier_id === cid);
  if (!db.v16 || !l.length) return "";
  return card("Validations maître d'œuvre", l.map((x) => `<div class="row lnk" data-go="moe/${x.id}" style="cursor:pointer"><div><b>${esc(x.titre)}</b><small>v${x.version}${x.decide_par ? " · " + esc(x.decide_par) : ""}</small></div>${moeChip(x.statut)}</div>`).join(""));
}
const moeActions = {
  moeNew: () => moeForm(), moeLink: (id) => moeShow(id),
  moeFrom: (id, arg) => moeForm(`${arg}:${id}`),
  moeRevoke: async (id) => { if (!guard() || !confirm("Révoquer ce lien ? Le maître d'œuvre ne pourra plus y accéder.")) return; await q(sb.from("moe_partages").update({ statut: "Révoquée" }).eq("id", id)); await refresh(); },
  moeDel: (id) => del("moe_partages", id, "Supprimer cette demande de validation ?", "moe"),
  moeVersion: async (id) => {
    if (!guard()) return;
    const m = byId(db.moe, id);
    if (!m.source_id) return toast("Source introuvable.", "dn");
    if (!confirm("Recréer l'instantané à partir de la situation actuelle ? Le lien reste le même, les avis sont remis à zéro et l'historique est conservé.")) return;
    const snap = await moeSnapshot(m.source_type, m.source_id);
    await q(sb.from("moe_partages").update({ lignes: snap.lignes, total_ht: snap.total, titre: snap.titre, version: m.version + 1, statut: "En attente", avis: [], commentaire: null, decide_at: null, decide_par: null,
      expire_at: new Date(Date.now() + 30 * 864e5).toISOString() }).eq("id", id));
    toast("Nouvelle version prête : le même lien affiche la version " + (m.version + 1) + ".", "ok"); await refresh();
  },
};
function moePriorites(add) {
  if (!db.v16) return;
  for (const m of db.moe || []) {
    if (m.statut === "Refusée" || m.statut === "Validée avec réserves" || (m.statut === "Commentée" && m.avis?.length)) add("i", 140, `Maître d'œuvre : ${m.titre}`, `${m.statut} par ${m.decide_par || "le destinataire"}`, 0, null, `moe/${m.id}`);
  }
}
