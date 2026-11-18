/* Bons de livraison (v21) : préparation, livraison sur chantier, quantités réellement livrées,
   signature du réceptionnaire, livraisons partielles (reliquat), transformation en facture. */

const BL_STATUTS = ["En préparation", "Prête", "Livrée", "Livrée partiellement", "Facturée", "Annulée"];
Object.assign(CHIP, { "En préparation": "n", Prête: "ac", Livrée: "ok", "Livrée partiellement": "wn", Facturée: "ok", Annulée: "n" });
const blLignes = (id) => (db.blLignes || []).filter((l) => l.livraison_id === id).sort((a, b) => a.position - b.position);
const blClient = (b) => byId(db.clients, b.client_id)?.nom || "-";
function blNumero() {
  const y = new Date().getFullYear(), n = Math.max(0, ...(db.livr || []).map((c) => (String(c.numero || "").startsWith(`BL-${y}-`) ? parseInt(c.numero.slice(-3)) || 0 : 0)));
  return `BL-${y}-${String(n + 1).padStart(3, "0")}`;
}
const blTotal = (b, livre = true) => sum(blLignes(b.id), (l) => Number(livre ? l.qte_livree : l.qte_prevue) * Number(l.prix_unitaire_ht || 0));
const blComplet = (b) => blLignes(b.id).every((l) => Number(l.qte_livree) >= Number(l.qte_prevue));

V.livraisons = (r) => {
  if (!db.v21) return page("Bons de livraison", "", "", v21Setup());
  if (r.arg) return blDetail(r.arg);
  const l = db.livr || [], cur = ST.tab.livraisons || "afaire";
  const f = cur === "toutes" ? l : cur === "livrees" ? l.filter((b) => ["Livrée", "Livrée partiellement", "Facturée"].includes(b.statut)) : l.filter((b) => ["En préparation", "Prête"].includes(b.statut));
  const t = today();
  const rows = f.map((b) => { const late = ["En préparation", "Prête"].includes(b.statut) && b.date_prevue < t, ch = byId(db.chantiers, b.chantier_id);
    return { go: `livraisons/${b.id}`, t: `${b.numero} ${blClient(b)} ${ch?.nom || ""}`,
      c: [`<strong>${esc(b.numero || "")}</strong>${b.parent_id ? "<small>reliquat</small>" : ""}`, esc(blClient(b)) + (ch ? `<small>${esc(ch.nom)}</small>` : ""), `<span class="${late ? "dn" : ""}">${D(b.date_livraison || b.date_prevue)}</span>${late ? "<small>en retard</small>" : ""}`, `${blLignes(b.id).length} ligne${blLignes(b.id).length > 1 ? "s" : ""}`, chip(b.statut)] }; });
  const tb = tabs("livraisons", [["afaire", `À livrer (${l.filter((b) => ["En préparation", "Prête"].includes(b.statut)).length})`], ["livrees", "Livrées"], ["toutes", "Toutes"]], cur);
  return page("Bons de livraison", "Préparez le matériel, livrez sur chantier et faites signer la réception.", btn("Nouveau bon de livraison", "blNew"),
    tb + searchBar("Rechercher un bon, un client, un chantier…", `${rows.length} bon${rows.length > 1 ? "s" : ""}`) + tbl(["Bon", "Client", "Date", "Lignes", "État"], rows, "Aucun bon de livraison."));
};

function blDetail(id) {
  const b = byId(db.livr || [], id);
  if (!b) return page("Bon introuvable", "", "", card("", `<p class="emp">Ce bon n'existe plus. <a href="#/livraisons">Retour aux livraisons</a></p>`));
  const ls = blLignes(id), livre = ["Livrée", "Livrée partiellement", "Facturée"].includes(b.statut), ch = byId(db.chantiers, b.chantier_id), parent = byId(db.livr, b.parent_id);
  const reliq = (db.livr || []).filter((x) => x.parent_id === id);
  const acts = [
    b.statut === "En préparation" ? btn("Marquer comme prête", "blStatut", id, "Prête") : "",
    ["En préparation", "Prête"].includes(b.statut) ? btn("Enregistrer la livraison", "blRecevoir", id) : "",
    ["Livrée", "Livrée partiellement"].includes(b.statut) && !b.facture_id ? btn("Transformer en facture", "blFacturer", id) : "",
    b.facture_id ? `<a class="btn o" href="#/factures/${b.facture_id}">Voir la facture</a>` : "",
    btn("Bon en PDF", "blPdf", id, "", "o"),
    `<details class="more"><summary class="btn o">Plus d'actions</summary><div class="mm"><button type="button" class="mi" data-act="blEdit" data-id="${id}">Modifier le bon</button>
      ${livre && !b.facture_id ? `<button type="button" class="mi" data-act="blStatut" data-id="${id}" data-arg="Prête">Rouvrir la livraison</button>` : ""}
      ${["En préparation", "Prête"].includes(b.statut) ? `<button type="button" class="mi" data-act="blStatut" data-id="${id}" data-arg="Annulée">Annuler le bon</button>` : ""}
      <button type="button" class="mi dng" data-act="blDel" data-id="${id}">Supprimer</button></div></details>`,
  ].join("");
  const tl = tbl(livre ? ["Désignation", "Prévu", "Livré", "Reste"] : ["Désignation", "Quantité prévue", "Prix unit. HT"],
    ls.map((l) => ({ t: "", c: livre
      ? [esc(l.designation), `${fmtNum(l.qte_prevue, 2)} ${esc(l.unite)}`, `<strong>${fmtNum(l.qte_livree, 2)}</strong>`, Number(l.qte_livree) < Number(l.qte_prevue) ? `<span class="dn">${fmtNum(l.qte_prevue - l.qte_livree, 2)}</span>` : `<span class="ok">complet</span>`]
      : [esc(l.designation), `${fmtNum(l.qte_prevue, 2)} ${esc(l.unite)}`, Number(l.prix_unitaire_ht) ? `<span class="num">${E2(l.prix_unitaire_ht)}</span>` : "-"] })), "Aucune ligne.");
  const info = `<dl class="kv"><dt>Client</dt><dd><a href="#/clients/${b.client_id}">${esc(blClient(b))}</a></dd>${ch ? `<dt>Chantier</dt><dd><a href="#/chantiers/${ch.id}">${esc(ch.nom)}</a></dd>` : ""}
    <dt>Livraison prévue</dt><dd>${D(b.date_prevue)}</dd>${b.date_livraison ? `<dt>Livré le</dt><dd>${D(b.date_livraison)}</dd>` : ""}<dt>Adresse</dt><dd>${esc(b.adresse || ch?.adresse || "-")}</dd><dt>Transporteur</dt><dd>${esc(b.transporteur || "-")}</dd>
    ${parent ? `<dt>Reliquat de</dt><dd><a href="#/livraisons/${parent.id}">${esc(parent.numero)}</a></dd>` : ""}${reliq.map((x) => `<dt>Reliquat</dt><dd><a href="#/livraisons/${x.id}">${esc(x.numero)}</a> ${chip(x.statut)}</dd>`).join("")}${b.notes ? `<dt>Notes</dt><dd>${esc(b.notes)}</dd>` : ""}</dl>`;
  const sig = b.signature_data ? `<div class="pad"><img class="iv-sig" src="${b.signature_data}" alt="Signature du réceptionnaire"><p class="mut">Reçu par ${esc(b.receptionnaire || "le réceptionnaire")} le ${D(b.signe_at)}</p></div>` : `<div class="pad"><p class="mut">${livre ? "Aucune signature enregistrée." : "La signature se fait à l'enregistrement de la livraison."}</p></div>`;
  return page(`${esc(b.numero)} ${chip(b.statut)}`, esc(blClient(b)) + (ch ? " · " + esc(ch.nom) : ""), acts,
    `<div class="g2"><div>${card("Matériel", tl)}</div><div>${card("Informations", info)}${card("Réception", sig)}</div></div>`, crumbs(["Bons de livraison", "livraisons"], [b.numero]));
}

function blForm(b, pre = {}) {
  const v0 = { ...pre, ...(b || {}) }, ls = b ? blLignes(b.id) : pre.lignes || [{}];
  const row = (l = {}) => `<tr class="bll" data-lid="${l.id || ""}"><td><input data-p="designation" value="${esc(l.designation || "")}" placeholder="Matériel" aria-label="Désignation"></td><td><input data-p="qte_prevue" value="${esc(l.qte_prevue ?? 1)}" inputmode="decimal" aria-label="Quantité"></td><td><input data-p="unite" value="${esc(l.unite || "u")}" aria-label="Unité"></td><td><input data-p="prix_unitaire_ht" value="${esc(l.prix_unitaire_ht ?? "")}" inputmode="decimal" placeholder="0,00" aria-label="Prix unitaire HT"></td><td><button type="button" class="rm" data-blrm aria-label="Supprimer la ligne">${svg(ic.x)}</button></td></tr>`;
  const devisOpts = [{ v: "", l: "Ne pas importer" }, ...(db.devis || []).filter((d) => d.statut !== "Refusé").map((d) => ({ v: d.id, l: `${d.numero || "Devis"} - ${byId(db.clients, d.client_id)?.nom || ""}` }))];
  modal(b ? "Modifier le bon de livraison" : "Nouveau bon de livraison", `<div class="frm">
    ${fld({ k: "client_id", l: "Client", t: "select", o: [{ v: "", l: "Choisir un client…" }, ...db.clients.map((x) => ({ v: x.id, l: x.nom }))], v: v0.client_id || "" })}
    ${fld({ k: "chantier_id", l: "Chantier", t: "select", o: [{ v: "", l: "Aucun" }, ...db.chantiers.map((x) => ({ v: x.id, l: x.nom }))], v: v0.chantier_id || "", r: 0 })}
    ${fld({ k: "date_prevue", l: "Livraison prévue le", t: "date", v: v0.date_prevue || today() })}${fld({ k: "transporteur", l: "Transporteur ou livreur", v: v0.transporteur || "", r: 0 })}
    ${fld({ k: "adresse", l: "Adresse de livraison", v: v0.adresse || "", r: 0, cls: "full", hint: "Laissez vide pour reprendre l'adresse du chantier." })}
    ${b ? "" : fld({ k: "devis_id", l: "Importer le matériel d'un devis", t: "select", o: devisOpts, v: "", r: 0, cls: "full" })}</div>
    <h3 class="sect">Matériel à livrer</h3><div class="tw"><table class="ivt"><thead><tr><th>Désignation</th><th>Qté</th><th>Unité</th><th>Prix HT</th><th></th></tr></thead><tbody id="blb">${ls.map(row).join("")}</tbody></table></div>
    <button type="button" class="btn o sm" id="bladd">+ Ajouter une ligne</button>
    <p class="mut">Le prix sert uniquement à transformer le bon en facture. Laissez vide pour un simple bon de livraison.</p>
    <div class="frm">${fld({ k: "notes", l: "Notes", t: "textarea", v: v0.notes || "", r: 0, cls: "full" })}</div>`, {
    wide: true, submit: b ? "Enregistrer" : "Créer le bon",
    onMount: (m) => {
      $("#bladd", m).onclick = () => { $("#blb", m).insertAdjacentHTML("beforeend", row()); $$('.bll [data-p="designation"]', m).pop().focus(); };
      m.addEventListener("click", (e) => { const x = e.target.closest("[data-blrm]"); if (x) { const tr = x.closest("tr"); if ($$(".bll", m).length > 1) tr.remove(); else $$("input", tr).forEach((i) => (i.value = "")); } });
      const sel = $("#f_devis_id", m);
      if (sel) sel.onchange = async () => {
        if (!sel.value) return;
        try {
          const dl = await q(sb.from("devis_lignes").select("designation,quantite,unite,prix_unitaire_ht,position").eq("devis_id", sel.value).order("position"));
          const d = byId(db.devis, sel.value); if (d && !$("#f_client_id", m).value) $("#f_client_id", m).value = d.client_id || ""; if (d?.chantier_id && !$("#f_chantier_id", m).value) $("#f_chantier_id", m).value = d.chantier_id;
          const keep = $$(".bll", m).filter((tr) => $('[data-p="designation"]', tr).value.trim()); $("#blb", m).innerHTML = keep.map((tr) => tr.outerHTML).join("") + dl.filter((x) => x.designation && Number(x.quantite) > 0).map((x) => row({ designation: x.designation, qte_prevue: x.quantite, unite: x.unite || "u", prix_unitaire_ht: x.prix_unitaire_ht })).join("");
          toast("Lignes du devis importées : supprimez celles qui ne sont pas à livrer.", "ok");
        } catch (er) { toast(esc(friendly(er)), "dn"); }
      };
    },
    onSubmit: async (v, api) => {
      const lignes = $$(".bll", api.el).map((tr) => ({ id: tr.dataset.lid || null, ...Object.fromEntries($$("[data-p]", tr).map((x) => [x.dataset.p, x.value])) })).filter((l) => l.designation.trim());
      if (!lignes.length) throw new Error("Ajoutez au moins une ligne de matériel.");
      const row0 = { client_id: v.client_id, chantier_id: v.chantier_id || null, date_prevue: v.date_prevue, transporteur: v.transporteur || null, adresse: v.adresse || null, notes: v.notes || null };
      const id = b ? b.id : (await q(sb.from("livraisons").insert({ ...row0, numero: blNumero() }).select("id").single())).id;
      if (b) await q(sb.from("livraisons").update(row0).eq("id", id));
      const keep = new Set(lignes.filter((l) => l.id).map((l) => l.id));
      for (const old of b ? blLignes(id).filter((l) => !keep.has(l.id)) : []) await q(sb.from("livraison_lignes").delete().eq("id", old.id));
      for (const [i, l] of lignes.entries()) {
        const r = { designation: l.designation.trim(), unite: l.unite.trim() || "u", qte_prevue: parseNum(l.qte_prevue) || 0, prix_unitaire_ht: parseNum(l.prix_unitaire_ht) || 0, position: i };
        if (l.id) await q(sb.from("livraison_lignes").update(r).eq("id", l.id)); else await q(sb.from("livraison_lignes").insert({ ...r, livraison_id: id }));
      }
      api.close(); await refresh(); if (!b) go("livraisons/" + id);
    },
  });
}

// Enregistrement de la livraison : quantités réellement livrées + signature du réceptionnaire
function blRecevoirForm(b) {
  const ls = blLignes(b.id); let pad;
  modal("Enregistrer la livraison", `<p class="mut">Indiquez les quantités réellement livrées. Si tout n'est pas livré, un bon de reliquat pourra être créé.</p>
    <div class="tw"><table class="ivt"><thead><tr><th>Désignation</th><th>Prévu</th><th>Livré</th></tr></thead><tbody>${ls.map((l) => `<tr><td>${esc(l.designation)}</td><td>${fmtNum(l.qte_prevue, 2)} ${esc(l.unite)}</td><td><input name="q_${l.id}" value="${esc(Number(l.qte_livree) || l.qte_prevue)}" inputmode="decimal" aria-label="Quantité livrée ${esc(l.designation)}"></td></tr>`).join("")}</tbody></table></div>
    <div class="frm">${fld({ k: "date_livraison", l: "Date de livraison", t: "date", v: b.date_livraison || today() })}${fld({ k: "receptionnaire", l: "Nom du réceptionnaire", v: b.receptionnaire || "", r: 0 })}</div>
    <p class="mut">Signature du réceptionnaire (facultative) :</p><canvas id="sigc" class="sigpad" aria-label="Zone de signature"></canvas><button type="button" class="btn o sm" id="sigclr">Effacer</button>`, {
    wide: true, submit: "Valider la livraison",
    onMount: (m) => { pad = sigPad(m, "sigc"); $("#sigclr", m).onclick = () => pad.clear(); },
    onSubmit: async (v, api) => {
      const qs = ls.map((l) => ({ l, q: parseNum(v["q_" + l.id]) })); if (qs.some((x) => !(x.q >= 0))) throw new Error("Une quantité livrée n'est pas valide.");
      if (qs.every((x) => x.q === 0)) throw new Error("Aucune quantité livrée : saisissez au moins une quantité.");
      for (const x of qs) await q(sb.from("livraison_lignes").update({ qte_livree: x.q }).eq("id", x.l.id));
      const complet = qs.every((x) => x.q >= Number(x.l.qte_prevue)), upd = { statut: complet ? "Livrée" : "Livrée partiellement", date_livraison: v.date_livraison, receptionnaire: v.receptionnaire || null };
      if (pad.strokes) { upd.signature_data = pad.png(); upd.signe_at = new Date().toISOString(); }
      await q(sb.from("livraisons").update(upd).eq("id", b.id)); api.close(); await refresh();
      if (!complet && confirm("Livraison partielle. Créer un bon de reliquat avec les quantités restantes ?")) await blReliquat(b.id, qs);
      toast(complet ? "Livraison enregistrée." : "Livraison partielle enregistrée.", "ok");
    },
  });
}
async function blReliquat(id, qs) {
  const b = byId(db.livr, id), reste = qs.map((x) => ({ l: x.l, r: Number(x.l.qte_prevue) - x.q })).filter((x) => x.r > 0);
  const nid = (await q(sb.from("livraisons").insert({ client_id: b.client_id, chantier_id: b.chantier_id, parent_id: id, numero: blNumero(), date_prevue: addDays(today(), 7), transporteur: b.transporteur, adresse: b.adresse, notes: `Reliquat de ${b.numero}.` }).select("id").single())).id;
  for (const [i, x] of reste.entries()) await q(sb.from("livraison_lignes").insert({ livraison_id: nid, position: i, designation: x.l.designation, unite: x.l.unite, qte_prevue: x.r, prix_unitaire_ht: x.l.prix_unitaire_ht, taux_tva: x.l.taux_tva }));
  await refresh(); go("livraisons/" + nid);
}

async function blPdfBytes(b) {
  await loadScript(LIBS.pdflib);
  const { PDFDocument, StandardFonts, rgb } = PDFLib, pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89, ML = 42, A = rgb(0.11, 0.3, 0.56), GREY = rgb(0.42, 0.45, 0.5), clean = (s) => String(s ?? "").replace(/[   ]/g, " ").replace(/[^\x20-\xff\n]/g, "");
  let page = pdf.addPage([W, H]), y = H - 50;
  const txt = (t, x, yy, o = {}) => { const f = o.f || font, sz = o.size || 9.5, s = clean(t), w = o.right ? f.widthOfTextAtSize(s, sz) : 0; page.drawText(s, { x: x - w, y: yy, size: sz, font: f, color: o.color || rgb(0.1, 0.1, 0.12) }); };
  const cut = (t, f, sz, mw) => { let s = clean(t); while (s.length > 1 && f.widthOfTextAtSize(s, sz) > mw) s = s.slice(0, -1); return s; };
  const need = (h) => { if (y - h < 60) { page = pdf.addPage([W, H]); y = H - 50; } };
  const e = db.ent || {}, cl = byId(db.clients, b.client_id) || {}, ch = byId(db.chantiers, b.chantier_id), ls = blLignes(b.id), livre = ["Livrée", "Livrée partiellement", "Facturée"].includes(b.statut);
  page.drawRectangle({ x: 0, y: H - 5, width: W, height: 5, color: A });
  txt(e.nom || "Votre entreprise", ML, y, { size: 15, f: bold }); txt("BON DE LIVRAISON", W - ML, y, { size: 18, f: bold, color: A, right: true });
  txt([e.adresse, [e.telephone, e.email].filter(Boolean).join(" - ")].filter(Boolean).join("  |  "), ML, y - 15, { size: 8.5, color: GREY }); txt("N° " + (b.numero || ""), W - ML, y - 18, { size: 11, f: bold, right: true });
  y -= 48;
  page.drawRectangle({ x: ML, y: y - 62, width: W - 2 * ML, height: 66, color: rgb(0.94, 0.95, 0.97) });
  txt("CLIENT", ML + 12, y - 10, { size: 7.5, f: bold, color: A }); txt(cl.nom || "", ML + 12, y - 25, { size: 11, f: bold }); if (ch) txt("Chantier : " + ch.nom, ML + 12, y - 39, { size: 9, color: GREY });
  txt("LIVRAISON", 360, y - 10, { size: 7.5, f: bold, color: A }); txt(D(b.date_livraison || b.date_prevue), 360, y - 25, { size: 11, f: bold }); txt(cut(b.adresse || ch?.adresse || "", font, 9, 190), 360, y - 39, { size: 9, color: GREY });
  y -= 90;
  txt("DÉSIGNATION", ML, y, { size: 8, f: bold, color: A }); txt("PRÉVU", 400, y, { size: 8, f: bold, color: A, right: true }); if (livre) txt("LIVRÉ", W - ML, y, { size: 8, f: bold, color: A, right: true });
  page.drawLine({ start: { x: ML, y: y - 4 }, end: { x: W - ML, y: y - 4 }, thickness: 0.8, color: A }); y -= 20;
  for (const l of ls) { need(18); txt(cut(l.designation, font, 10, 320), ML, y, { size: 10 }); txt(`${fmtNum(l.qte_prevue, 2)} ${l.unite}`, 400, y, { size: 10, right: true }); if (livre) txt(`${fmtNum(l.qte_livree, 2)} ${l.unite}`, W - ML, y, { size: 10, f: bold, right: true }); page.drawLine({ start: { x: ML, y: y - 5 }, end: { x: W - ML, y: y - 5 }, thickness: 0.3, color: rgb(0.85, 0.86, 0.88) }); y -= 18; }
  if (b.notes) { y -= 8; need(30); txt(cut("Notes : " + b.notes, font, 9, W - 2 * ML), ML, y, { size: 9, color: GREY }); y -= 16; }
  need(130); y -= 14;
  txt("SIGNATURE DU RÉCEPTIONNAIRE", ML, y, { size: 8, f: bold, color: A }); page.drawRectangle({ x: ML, y: y - 100, width: 240, height: 92, borderColor: GREY, borderWidth: 0.6 });
  if (b.signature_data) { try { const im = await pdf.embedPng(Uint8Array.from(atob(b.signature_data.split(",")[1]), (c) => c.charCodeAt(0))), sc = Math.min(224 / im.width, 78 / im.height); page.drawImage(im, { x: ML + 8, y: y - 94, width: im.width * sc, height: im.height * sc }); } catch (er) { /* ignorée */ } }
  txt(b.receptionnaire ? `${b.receptionnaire}${b.signe_at ? ", le " + D(b.signe_at) : ""}` : "Nom, date et signature", ML, y - 112, { size: 8.5, color: GREY });
  pdf.setTitle("Bon de livraison " + (b.numero || ""));
  return await pdf.save();
}

const livraisonsActions = {
  blNew: () => guard() && blForm(null),
  blEdit: (id) => guard() && blForm(byId(db.livr, id)),
  blStatut: async (id, arg) => { if (!guard()) return; await q(sb.from("livraisons").update({ statut: arg }).eq("id", id)); await refresh(); },
  blRecevoir: (id) => guard() && blRecevoirForm(byId(db.livr, id)),
  blDel: async (id) => { if (!guard() || !confirm("Supprimer ce bon de livraison ?")) return; await q(sb.from("livraisons").delete().eq("id", id)); await refresh(); go("livraisons"); },
  blPdf: async (id) => {
    try { const b = byId(db.livr, id), by = await blPdfBytes(b), u = URL.createObjectURL(new Blob([by], { type: "application/pdf" })), a = document.createElement("a"); a.href = u; a.download = `${b.numero}.pdf`; a.click(); setTimeout(() => URL.revokeObjectURL(u), 4000); }
    catch (e) { toast(esc(friendly(e)), "dn"); }
  },
  blFacturer: async (id) => {
    if (!guard()) return;
    const b = byId(db.livr, id); if (b.facture_id) return go("factures/" + b.facture_id);
    const ls = blLignes(id).filter((l) => Number(l.qte_livree) > 0);
    if (!ls.some((l) => Number(l.prix_unitaire_ht) > 0)) return toast("Aucun prix renseigné sur ce bon : ajoutez les prix (Modifier le bon) pour le facturer.", "dn");
    if (!confirm(`Créer la facture (brouillon) de ${E2(blTotal(b))} HT d'après les quantités livrées ?`)) return;
    const lignes = ls.map((l) => ({ categorie: "", nature: "normale", ref_facture_id: null, designation: l.designation, description: `Bon de livraison ${b.numero}`, quantite: Number(l.qte_livree), unite: l.unite || "u", prix_unitaire_ht: Number(l.prix_unitaire_ht), taux_tva: Number(l.taux_tva) || 20 }));
    const fid = await q(sb.rpc("sauver_document", { p_kind: "facture", p: { id: null, client_id: b.client_id, chantier_id: b.chantier_id || null, date: today(), echeance: addDays(today(), Number(db.ent.delai_paiement_jours) || 30), notes: `Livraison ${b.numero} du ${D(b.date_livraison || b.date_prevue)}`, lignes } }));
    await q(sb.from("livraisons").update({ facture_id: fid, statut: "Facturée" }).eq("id", id));
    await refresh(); toast("Facture créée en brouillon. Vérifiez-la puis émettez-la.", "ok"); go("factures/" + fid);
  },
};
