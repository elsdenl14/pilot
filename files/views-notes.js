/* Prises de notes : notes libres ou rattachées à un client, un chantier ou un fournisseur, avec rappel, épingle et dictée vocale. */

const ntLink = (n) => n.chantier_id ? { l: "Chantier : " + (byId(db.chantiers, n.chantier_id)?.nom || "?"), go: `chantiers/${n.chantier_id}` }
  : n.client_id ? { l: "Client : " + (byId(db.clients, n.client_id)?.nom || "?"), go: `clients/${n.client_id}` }
  : n.fournisseur_id ? { l: "Fournisseur : " + (byId(db.fournisseurs, n.fournisseur_id)?.nom || "?"), go: `fournisseurs/${n.fournisseur_id}` } : null;
const ntSort = (a, b) => (b.epingle - a.epingle) || (a.fait - b.fait) || String(b.created_at).localeCompare(String(a.created_at));

function ntItem(n, withLink = true) {
  const lk = withLink ? ntLink(n) : null, late = n.rappel_le && !n.fait && n.rappel_le < today(), due = n.rappel_le && !n.fait && n.rappel_le === today();
  return `<div class="row" style="align-items:flex-start;gap:10px;padding:12px 18px;${n.fait ? "opacity:.55" : ""}">
    <div style="flex:1;min-width:0"><div>${n.epingle ? "📌 " : ""}<b${n.fait ? ' style="text-decoration:line-through"' : ""}>${esc(n.titre || (n.contenu || "").split("\n")[0].slice(0, 60) || "Note")}</b>
      ${n.rappel_le ? `<span class="chip ${late ? "dn" : due ? "wn" : "n"}" style="margin-left:6px">Rappel ${D(n.rappel_le)}</span>` : ""}</div>
      ${n.titre && n.contenu ? `<div class="mut" style="white-space:pre-wrap;margin-top:3px">${esc(n.contenu)}</div>` : !n.titre && n.contenu.includes("\n") ? `<div class="mut" style="white-space:pre-wrap;margin-top:3px">${esc(n.contenu.split("\n").slice(1).join("\n"))}</div>` : ""}
      <small class="mut">${ago(n.created_at)}${lk ? ` · <a href="#/${lk.go}">${esc(lk.l)}</a>` : ""}</small></div>
    <div style="display:flex;gap:6px;flex-shrink:0">${btn(n.fait ? "Rouvrir" : "Fait", "ntDone", n.id, "", "o sm w")}${btn(n.epingle ? "Détacher" : "Épingler", "ntPin", n.id, "", "o sm w")}${btn("Modifier", "ntEdit", n.id, "", "o sm w")}</div></div>`;
}

V.notes = () => {
  if (!db.v10) return page("Notes", "", "", card("Migration requise", `<p class="note" style="margin:0">Exécutez migration_v10.sql dans Supabase pour activer les notes.</p>`));
  const f = ST.tab.notes || "toutes", all = [...db.nt].sort(ntSort);
  const l = all.filter((n) => f === "toutes" ? !n.fait : f === "rappels" ? n.rappel_le && !n.fait : f === "epinglees" ? n.epingle : n.fait);
  const items = l.map((n) => ntItem(n)).join("");
  return page("Notes", "Vos mémos, appels et idées, rattachés si vous voulez à un client, un chantier ou un fournisseur.", btn("Nouvelle note", "ntNew", "", "", "w"),
    tabs("notes", [["toutes", "En cours"], ["rappels", "Rappels"], ["epinglees", "Épinglées"], ["faites", "Faites"]], f) +
    card("", items || `<p class="mut" style="margin:0;padding:18px">Aucune note ici.</p>`));
};

// Carte pour les fiches client / chantier / fournisseur
function ntCard(kind, id) {
  if (!db.v10) return "";
  const k = kind + "_id", l = db.nt.filter((n) => n[k] === id).sort(ntSort);
  return card("Notes", l.length ? l.map((n) => ntItem(n, false)).join("") : `<p class="mut" style="margin:0;padding:16px 18px">Aucune note.</p>`, btn("Ajouter", "ntNew", "", `${kind}:${id}`, "o sm w"));
}

function ntForm(n, pre = {}) {
  if (!guard()) return;
  const x = n || {}, opt = (list, label = "nom") => [{ v: "", l: "Aucun" }, ...list.map((e) => ({ v: e.id, l: e[label] }))];
  const SR = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
  modal(n ? "Modifier la note" : "Nouvelle note", `<div class="frm">
    ${fld({ k: "titre", l: "Titre", v: x.titre || "", r: 0, cls: "full" })}
    <div class="full">${fld({ k: "contenu", l: "Note", t: "textarea", v: x.contenu || "", rows: 7 })}${SR ? `<button type="button" class="btn o sm" id="nt_mic" style="margin-top:6px">🎤 Dicter</button> <small class="mut" id="nt_st"></small>` : ""}</div>
    ${fld({ k: "client_id", l: "Client", t: "select", o: opt(db.clients), v: x.client_id ?? pre.client_id ?? "", r: 0 })}
    ${fld({ k: "chantier_id", l: "Chantier", t: "select", o: opt(db.chantiers), v: x.chantier_id ?? pre.chantier_id ?? "", r: 0 })}
    ${fld({ k: "fournisseur_id", l: "Fournisseur", t: "select", o: opt(db.fournisseurs), v: x.fournisseur_id ?? pre.fournisseur_id ?? "", r: 0 })}
    ${fld({ k: "rappel_le", l: "Me le rappeler le", t: "date", v: x.rappel_le || "", r: 0 })}
    <label class="chk full" style="display:flex;gap:8px"><input type="checkbox" name="epingle" ${x.epingle ? "checked" : ""}> <span>Épingler en haut de la liste</span></label></div>`, {
    onMount: (m) => {
      const b = $("#nt_mic", m); if (!b || !SR) return;
      let rec = null;
      b.onclick = () => {
        const st = $("#nt_st", m);
        if (rec) { rec.stop(); return; }
        rec = new SR(); rec.lang = "fr-FR"; rec.continuous = true; rec.interimResults = false;
        rec.onresult = (e) => { const ta = $("#f_contenu", m); let t = ""; for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) t += e.results[i][0].transcript + " "; ta.value = (ta.value ? ta.value.replace(/\s*$/, " ") : "") + t.trim(); };
        rec.onend = () => { rec = null; b.textContent = "🎤 Dicter"; st.textContent = ""; };
        rec.onerror = (e) => { st.textContent = e.error === "not-allowed" ? "Micro refusé par le navigateur." : "Dictée interrompue."; };
        rec.start(); b.textContent = "⏹ Arrêter"; st.textContent = "Je vous écoute…";
      };
    },
    onSubmit: async (v, api) => {
      if (!(v.titre || "").trim() && !(v.contenu || "").trim()) throw new Error("Écrivez au moins un titre ou une note.");
      const row = { titre: v.titre?.trim() || null, contenu: v.contenu || "", client_id: v.client_id || null, chantier_id: v.chantier_id || null, fournisseur_id: v.fournisseur_id || null, rappel_le: v.rappel_le || null, epingle: "epingle" in v, updated_at: new Date().toISOString() };
      if (n) await q(sb.from("notes").update(row).eq("id", n.id)); else await q(sb.from("notes").insert(row));
      api.close(); toast("Note enregistrée.", "ok"); await refresh();
    },
  });
}

// Rappels du jour et en retard dans les priorités de l'accueil
function ntPriorites(add, t) {
  if (!db.v10) return;
  for (const n of db.nt) {
    if (n.fait || !n.rappel_le || n.rappel_le > t) continue;
    const late = n.rappel_le < t;
    add(late ? "i" : "s", 150 - (late ? 0 : 20), `Rappel : ${n.titre || (n.contenu || "").split("\n")[0].slice(0, 50) || "note"}`, `${late ? "Prévu le " + D(n.rappel_le) : "Aujourd'hui"}${ntLink(n) ? " · " + ntLink(n).l : ""}`, null, { label: "Marquer fait", act: "ntDone", id: n.id }, "notes");
  }
}

const noteActions = {
  ntNew: (id, arg) => { const [k, v] = (arg || "").split(":"); ntForm(null, v ? { [k + "_id"]: v } : {}); },
  ntEdit: (id) => ntForm(byId(db.nt, id)),
  ntDone: async (id) => { if (!guard()) return; const n = byId(db.nt, id); await q(sb.from("notes").update({ fait: !n.fait }).eq("id", id)); await refresh(); },
  ntPin: async (id) => { if (!guard()) return; const n = byId(db.nt, id); await q(sb.from("notes").update({ epingle: !n.epingle }).eq("id", id)); await refresh(); },
};
