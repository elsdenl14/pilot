/* Documents : un espace central, par client et par chantier.
   Réunit les devis, factures, factures fournisseurs (justificatifs) et les fichiers déposés (contrats, photos, plans, attestations…). */

const DC_CATS = ["Devis", "Factures", "Factures fournisseurs", "Contrats", "Photos", "Plans", "Attestations", "Autres"];
const DC_MAX = 25 * 1024 * 1024; // 25 Mo par fichier
const dcState = () => (ST.dc ||= { cat: "tous", client: "", chantier: "", group: "liste" });
const setupV6 = () =>
  `<p class="emp" style="padding:18px;margin:0;color:var(--mut)">Pour activer l'envoi de fichiers, exécutez <b>migration_v6.sql</b> dans Supabase (SQL Editor), puis rechargez la page.${db.v6err ? `<br><br>Erreur renvoyée par Supabase : <code>${esc(db.v6err)}</code>` : ""}</p>`;

/* ---------- Données : tout ce qui est « document », sous une même forme ---------- */
function dcAll() {
  const chById = Object.fromEntries(db.chantiers.map((c) => [c.id, c]));
  const out = [];
  const push = (o) => {
    const ch = o.chantier_id ? chById[o.chantier_id] : null;
    const cid = o.client_id || ch?.client_id || null;
    out.push({ ...o, client_id: cid, client_nom: cid ? clientOf(cid)?.nom || "" : "", chantier_nom: ch?.nom || "" });
  };
  for (const d of db.devis)
    push({ key: "devis:" + d.id, cat: "Devis", nom: d.numero || "Devis", detail: `${d.statut} · ${E(d.montant_ttc)} TTC`, date: d.date_devis, client_id: d.client_id, chantier_id: d.chantier_id, src: "devis", go: `devis/${d.id}` });
  for (const f of db.factures)
    push({ key: "facture:" + f.id, cat: "Factures", nom: f.numero || "Facture", detail: `${f.statut_affiche || f.statut} · ${E(f.montant_ttc)} TTC`, date: f.date_emission || String(f.created_at || "").slice(0, 10), client_id: f.client_id, chantier_id: f.chantier_id, src: "facture", go: `factures/${f.id}` });
  for (const x of db.depenses.filter((d) => d.justificatif))
    push({ key: "dep:" + x.id, cat: "Factures fournisseurs", nom: `${x.fournisseur}${x.reference ? " · " + x.reference : ""}`, detail: `${x.statut} · ${E(x.montant_ttc)} TTC`, date: x.date_depense, chantier_id: x.chantier_id, src: "dep", path: x.justificatif, edit: `depenses/${x.id}` });
  for (const x of db.docsCompta || [])
    push({ key: "compta:" + x.id, cat: /attest/i.test(x.type || "") ? "Attestations" : "Autres", nom: x.libelle, detail: "Pièce comptable" + (x.type ? " · " + x.type : ""), date: String(x.created_at || "").slice(0, 10), src: "compta", path: x.chemin });
  for (const x of db.documents || [])
    push({ key: "f:" + x.id, cat: DC_CATS.includes(x.categorie) ? x.categorie : "Autres", nom: x.nom, detail: x.notes || "", date: String(x.created_at || "").slice(0, 10), client_id: x.client_id, chantier_id: x.chantier_id, src: "file", path: x.chemin, mime: x.mime, taille: x.taille, id: x.id });
  return out.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || a.nom.localeCompare(b.nom));
}
const dcOfChantier = (id) => dcAll().filter((x) => x.chantier_id === id);
const dcOfClient = (id) => dcAll().filter((x) => x.client_id === id);

function dcGuess(name, mime) {
  const n = String(name || "").toLowerCase();
  if (/^image\//.test(mime || "") || /\.(jpe?g|png|webp|heic|gif)$/.test(n)) return "Photos";
  if (/contrat|marche|march[eé]|cctp|ccap|avenant/.test(n)) return "Contrats";
  if (/attestation|assurance|decennale|d[eé]cennale|kbis|urssaf|vigilance|rc.?pro/.test(n)) return "Attestations";
  if (/plan|coupe|facade|fa[cç]ade|\.dwg$|\.dxf$/.test(n)) return "Plans";
  if (/devis/.test(n)) return "Devis";
  if (/factur/.test(n)) return "Factures fournisseurs";
  return "Autres";
}
const dcExt = (e) => {
  const m = String(e.src === "file" ? e.nom : e.path || "").match(/\.([a-z0-9]{2,4})$/i);
  if (m) return m[1].toUpperCase().replace("JPEG", "JPG");
  return e.src === "devis" || e.src === "facture" ? "PDF" : "FILE";
};
const dcSize = (n) => (!n ? "" : n < 1024 * 1024 ? Math.max(1, Math.round(n / 1024)) + " Ko" : (n / 1024 / 1024).toFixed(1).replace(".", ",") + " Mo");
const dcPlural = (n, w) => `${n} ${w}${n > 1 ? "s" : ""}`;
const dcFichiers = (n) => dcPlural(n, "fichier");

function dcNameCell(e) {
  const where = [e.client_nom, e.chantier_nom].filter(Boolean).map(esc).join(" · ");
  return `<div class="dcn"><span class="fx ${e.cat === "Photos" ? "ph" : ""}" data-thumb="${e.cat === "Photos" && e.src === "file" ? esc(e.path) : ""}">${dcExt(e)}</span><div><strong>${esc(e.nom)}</strong><small>${esc(e.detail || "")}${e.detail && where ? " · " : ""}${where}</small></div></div>`;
}
function dcRow(e, withWhere = true) {
  const acts = [];
  if (e.src === "file") acts.push(`<button class="lk w" data-act="dcEdit" data-id="${esc(e.id)}">Modifier</button>`, `<button class="lk w" data-act="dcDel" data-id="${esc(e.id)}" style="margin-left:10px">Supprimer</button>`);
  const open = e.go ? { go: e.go } : { act: "dcOpen", id: e.key };
  return {
    ...open, t: `${e.nom} ${e.cat} ${e.client_nom} ${e.chantier_nom} ${e.detail}`,
    c: [dcNameCell(withWhere ? e : { ...e, client_nom: "", chantier_nom: "" }), `<span class="chip n">${esc(e.cat)}</span>`, D(e.date), e.taille ? dcSize(e.taille) : "-", `<span class="r">${acts.join("")}</span>`],
  };
}
const DC_COLS = ["Document", "Catégorie", "Date", "Taille", ""];

/* ---------- Page Documents ---------- */
V.documents = (r) => {
  const s = dcState();
  // liens profonds : #/documents?chantier=ID ou ?client=ID
  if (r?.qs && (r.qs.get("chantier") || r.qs.get("client") || r.qs.get("cat"))) {
    s.chantier = r.qs.get("chantier") || "";
    s.client = r.qs.get("client") || "";
    s.cat = r.qs.get("cat") || "tous";
    history.replaceState(null, "", "#/documents");
  }
  const all = dcAll();
  const scoped = all.filter((e) => (!s.chantier || e.chantier_id === s.chantier) && (!s.client || e.client_id === s.client));
  const count = (c) => scoped.filter((e) => e.cat === c).length;
  const cur = s.cat === "tous" || DC_CATS.includes(s.cat) ? s.cat : "tous";
  const list = scoped.filter((e) => cur === "tous" || e.cat === cur);
  const tabsHtml = `<div class="tabs" role="tablist">${[["tous", `Tous (${scoped.length})`], ...DC_CATS.map((c) => [c, `${c} (${count(c)})`])]
    .map(([k, l]) => `<button role="tab" aria-selected="${cur === k}" data-act="dcCat" data-arg="${esc(k)}">${esc(l)}</button>`).join("")}</div>`;
  const chOpts = [{ v: "", l: "Tous les chantiers" }, ...db.chantiers.filter((c) => !s.client || c.client_id === s.client).map((c) => ({ v: c.id, l: c.nom }))];
  const clOpts = [{ v: "", l: "Tous les clients" }, ...db.clients.map((c) => ({ v: c.id, l: c.nom }))];
  const sel = (k, opts, v) => `<select class="dcf" data-dcf="${k}" aria-label="${k === "client" ? "Client" : "Chantier"}">${opts.map((o) => `<option value="${esc(o.v)}"${o.v === v ? " selected" : ""}>${esc(o.l)}</option>`).join("")}</select>`;
  const grp = `<div class="seg">${[["liste", "Liste"], ["chantier", "Par chantier"], ["client", "Par client"]].map(([k, l]) => `<button data-act="dcGroup" data-arg="${k}" aria-pressed="${s.group === k}">${l}</button>`).join("")}</div>`;
  const filters = `<div class="sr dcbar"><input id="q" type="search" placeholder="Rechercher un document, un client, un chantier…" aria-label="Rechercher"><div class="pa">${sel("client", clOpts, s.client)}${sel("chantier", chOpts, s.chantier)}${grp}</div></div>`;

  let body;
  if (s.group === "liste" || !list.length) {
    body = card("", tbl(DC_COLS, list.map((e) => dcRow(e)), all.length ? "Aucun document ne correspond à ces filtres." : "Aucun document pour le moment. Les devis et factures apparaissent ici automatiquement ; ajoutez vos contrats, photos, plans et attestations avec « Ajouter des documents »."));
  } else {
    const key = s.group === "chantier" ? (e) => e.chantier_id || "" : (e) => e.client_id || "";
    const names = s.group === "chantier" ? (id) => byId(db.chantiers, id)?.nom : (id) => clientOf(id)?.nom;
    const groups = new Map();
    for (const e of list) { const k = key(e); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
    const arr = [...groups.entries()].sort((a, b) => (a[0] === "" ? 1 : b[0] === "" ? -1 : (names(a[0]) || "").localeCompare(names(b[0]) || "")));
    body = arr.map(([k, es]) => card(`${esc(k ? names(k) || "-" : s.group === "chantier" ? "Sans chantier" : "Sans client")} <span class="mut" style="font-weight:400">· ${dcFichiers(es.length)}</span>`,
      tbl(DC_COLS, es.map((e) => dcRow(e))), k ? btn("Ajouter", "dcNew", "", (s.group === "chantier" ? "chantier:" : "client:") + k, "o sm w") : "")).join("");
  }
  const mine = (db.documents || []).length;
  return {
    html: page("Documents", "Tous les documents au même endroit, rangés par client et par chantier.",
      btn("Ajouter des documents", "dcNew", "", s.chantier ? "chantier:" + s.chantier : s.client ? "client:" + s.client : "", "w"),
      (db.v6 ? "" : card("", setupV6(), "", "mb")) + strip([
        ["Documents", scoped.length, `${mine} fichier${mine > 1 ? "s" : ""} déposé${mine > 1 ? "s" : ""}`],
        ["Devis et factures", count("Devis") + count("Factures"), "générés dans Pilot"],
        ["Factures fournisseurs", count("Factures fournisseurs"), "justificatifs de dépenses"],
        ["Photos et plans", count("Photos") + count("Plans"), "chantier"],
      ]) + tabsHtml + filters + body),
    after: dcThumbs,
  };
};

// Miniatures des photos (liens signés valables 10 min)
async function dcThumbs() {
  const els = $$("[data-thumb]").filter((e) => e.dataset.thumb).slice(0, 40);
  if (!els.length || !sb) return;
  try {
    const paths = [...new Set(els.map((e) => e.dataset.thumb))];
    const { data } = await sb.storage.from("documents").createSignedUrls(paths, 600);
    const m = Object.fromEntries((data || []).filter((x) => x.signedUrl).map((x) => [x.path, x.signedUrl]));
    els.forEach((e) => { if (m[e.dataset.thumb]) { e.textContent = ""; e.style.backgroundImage = `url("${m[e.dataset.thumb]}")`; e.classList.add("img"); } });
  } catch (e) { /* miniatures facultatives */ }
}

// Les filtres (menus déroulants) n'utilisent pas data-act : écoute dédiée
document.addEventListener("change", (e) => {
  const t = e.target;
  if (!t.dataset?.dcf) return;
  const s = dcState();
  s[t.dataset.dcf] = t.value;
  if (t.dataset.dcf === "client" && s.chantier && byId(db.chantiers, s.chantier)?.client_id !== t.value && t.value) s.chantier = "";
  if (t.dataset.dcf === "chantier" && t.value) s.client = "";
  render(true);
});

/* ---------- Cartes sur les fiches chantier et client ---------- */
function dcCard(kind, id) {
  const es = kind === "chantier" ? dcOfChantier(id) : dcOfClient(id);
  const by = DC_CATS.map((c) => [c, es.filter((e) => e.cat === c).length]).filter((x) => x[1]);
  const more = es.length > 6 ? `<div class="cb" style="border-top:1px solid var(--line2);padding:10px 18px"><button class="lk" data-go="documents?${kind}=${id}">Voir les ${es.length} fichiers ${svg(ic.ar)}</button></div>` : "";
  const body = es.length
    ? `<div class="dcsum">${by.map(([c, n]) => `<span class="chip n">${esc(c)} · ${n}</span>`).join("")}</div>${tbl(["Document", "Date", ""], es.slice(0, 6).map((e) => {
        const r = dcRow(e, false);
        return { ...r, c: [r.c[0], r.c[2], r.c[4]] };
      }))}${more}`
    : `<p class="emp" style="padding:18px;margin:0;color:var(--mut)">Aucun document. Les devis et factures de ${kind === "chantier" ? "ce chantier" : "ce client"} apparaîtront ici, avec les contrats, photos et plans que vous ajoutez.</p>`;
  return card(`${svg(ic.documents, "ci")}Documents du ${kind} <span class="mut" style="font-weight:400">· ${dcFichiers(es.length)}</span>`, body, btn("Ajouter", "dcNew", "", `${kind}:${id}`, "o sm w"));
}

/* ---------- Ajout / modification / suppression ---------- */
const dcWhereFields = (chantier, client) => {
  const chs = db.chantiers.map((c) => ({ v: c.id, l: `${c.nom}${c.client_nom ? " · " + c.client_nom : ""}` }));
  return `${fld({ k: "chantier_id", l: "Chantier", t: "select", o: [{ v: "", l: "Aucun chantier" }, ...chs], v: chantier || "", r: 0 })}
    ${fld({ k: "client_id", l: "Client", t: "select", o: [{ v: "", l: "Aucun client" }, ...db.clients.map((c) => ({ v: c.id, l: c.nom }))], v: client || "", r: 0, hint: "Rempli automatiquement avec le client du chantier." })}`;
};
const dcBindWhere = (m) => {
  const ch = $("#f_chantier_id", m), cl = $("#f_client_id", m);
  if (!ch || !cl) return;
  ch.onchange = () => { const c = byId(db.chantiers, ch.value); if (c) cl.value = c.client_id; };
};

function dcNew(arg) {
  if (!guard()) return;
  if (!db.v6) return toast("Exécutez d'abord migration_v6.sql dans Supabase pour activer l'envoi de fichiers.", "dn");
  let chantier = "", client = "";
  if (String(arg).startsWith("chantier:")) { chantier = arg.slice(9); client = byId(db.chantiers, chantier)?.client_id || ""; }
  else if (String(arg).startsWith("client:")) client = arg.slice(7);
  let files = [];
  const body = `<div class="frm">
    <div class="full"><div class="drop" id="dcdrop"><div><b>Fichiers à ajouter</b><small style="display:block" class="mut">PDF, photos, plans, Word, Excel… 25 Mo maximum par fichier. Vous pouvez en choisir plusieurs.</small></div>
      <input type="file" id="dcfile" multiple hidden><button type="button" class="btn o" id="dcpick">Choisir des fichiers</button></div><div id="dclist" class="dclist"></div></div>
    ${fld({ k: "categorie", l: "Catégorie", t: "select", o: [{ v: "auto", l: "Détection automatique" }, ...DC_CATS], v: "auto", hint: "Choisie d'après le type et le nom du fichier si vous laissez « automatique »." })}
    <span></span>
    ${dcWhereFields(chantier, client)}
    ${fld({ k: "notes", l: "Note (facultatif)", t: "textarea", rows: 2, r: 0, cls: "full" })}</div>`;
  const render_ = (m) => {
    $("#dclist", m).innerHTML = files.map((f, i) => `<div class="dcf1"><span>${esc(f.name)}</span><small>${dcSize(f.size) || "vide"}${f.size > DC_MAX ? " · trop volumineux" : ""}</small><button type="button" class="ib" data-rm="${i}" aria-label="Retirer">${svg(ic.x)}</button></div>`).join("");
    $$("[data-rm]", m).forEach((b) => (b.onclick = () => { files.splice(Number(b.dataset.rm), 1); render_(m); }));
  };
  modal("Ajouter des documents", body, {
    wide: true, submit: "Envoyer", noFocus: true,
    onMount: (m) => {
      const inp = $("#dcfile", m), drop = $("#dcdrop", m);
      const add = (list) => { for (const f of list) if (!files.some((x) => x.name === f.name && x.size === f.size)) files.push(f); render_(m); };
      $("#dcpick", m).onclick = () => inp.click();
      inp.onchange = () => { add([...inp.files]); inp.value = ""; };
      drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
      drop.ondragleave = () => drop.classList.remove("over");
      drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); add([...(e.dataTransfer?.files || [])]); };
      dcBindWhere(m);
    },
    onSubmit: async (v, api) => {
      if (!files.length) throw new Error("Choisissez au moins un fichier.");
      const big = files.find((f) => f.size > DC_MAX);
      if (big) throw new Error(`« ${big.name} » dépasse 25 Mo. Retirez-le ou réduisez sa taille.`);
      const ch = v.chantier_id ? byId(db.chantiers, v.chantier_id) : null;
      const cid = ch?.client_id || v.client_id || null;
      let ok = 0;
      const failed = [];
      for (const f of files.slice()) {
        api.error(`Envoi ${ok + failed.length + 1} / ${files.length} : ${f.name}…`);
        let path = null;
        try {
          path = await uploadDoc(f, "documents");
          await q(sb.from("documents").insert({ nom: f.name, categorie: v.categorie === "auto" ? dcGuess(f.name, f.type) : v.categorie, client_id: cid, chantier_id: ch?.id || null,
            chemin: path, mime: f.type || null, taille: f.size, notes: v.notes || null }));
          ok++;
        } catch (e) {
          if (path) sb.storage.from("documents").remove([path]);
          failed.push(`${f.name} (${friendly(e)})`);
        }
      }
      if (failed.length) {
        files = files.filter((f) => failed.some((m) => m.startsWith(f.name + " (")));
        api.error(`${dcPlural(ok, "fichier")} envoyé${ok > 1 ? "s" : ""}. Échec : ${failed.join(" ; ")}`);
        render_(api.el);
        if (ok) await refresh();
        return;
      }
      api.close();
      toast(`${dcPlural(ok, "document")} ajouté${ok > 1 ? "s" : ""}.`, "ok");
      await refresh();
    },
  });
}

function dcEdit(id) {
  if (!guard()) return;
  const x = byId(db.documents, id);
  if (!x) return;
  const body = `<div class="frm">
    ${fld({ k: "nom", l: "Nom du document", v: x.nom, cls: "full" })}
    ${fld({ k: "categorie", l: "Catégorie", t: "select", o: DC_CATS, v: x.categorie })}
    <span></span>
    ${dcWhereFields(x.chantier_id, x.client_id)}
    ${fld({ k: "notes", l: "Note", t: "textarea", rows: 2, v: x.notes, r: 0, cls: "full" })}</div>`;
  modal("Modifier le document", body, {
    onMount: dcBindWhere,
    onSubmit: async (v, api) => {
      const ch = v.chantier_id ? byId(db.chantiers, v.chantier_id) : null;
      await q(sb.from("documents").update({ nom: v.nom.trim(), categorie: v.categorie, chantier_id: ch?.id || null, client_id: ch?.client_id || v.client_id || null, notes: v.notes || null }).eq("id", id));
      api.close(); toast("Document modifié.", "ok"); await refresh();
    },
  });
}

async function dcDel(id) {
  if (!guard()) return;
  const x = byId(db.documents, id);
  if (!x || !confirm(`Supprimer « ${x.nom} » ?\n\nLe fichier sera effacé définitivement.`)) return;
  await q(sb.from("documents").delete().eq("id", id));
  try { await sb.storage.from("documents").remove([x.chemin]); } catch (e) { console.warn("fichier non supprimé", e); }
  toast("Document supprimé.");
  await refresh();
}

const fileActions = {
  dcNew: (id, arg) => dcNew(arg),
  dcEdit: (id) => dcEdit(id),
  dcDel: (id) => dcDel(id),
  dcOpen: (id) => {
    const e = dcAll().find((x) => x.key === id);
    if (!e) return;
    if (e.go) return go(e.go);
    if (e.path) return openFile(e.path);
  },
  dcCat: (id, arg) => { dcState().cat = arg; return render(true); },
  dcGroup: (id, arg) => { dcState().group = arg; return render(true); },
};
