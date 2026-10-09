/* Génération des PDF (devis / factures) et lecture des factures fournisseurs.
   Dépend de lib.js. pdf-lib est chargé à la demande depuis le CDN. */
const PilotPdf = (() => {
  const W = 595.28,
    H = 841.89,
    ML = 42;
  const CP1252 = new Set([..."€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ"]);
  // Helvetica (WinAnsi) ne sait écrire que le latin : on nettoie tout ce qui ferait planter pdf-lib
  const clean = (s) =>
    String(s ?? "")
      .replace(/[   ]/g, " ")
      .replace(/[−]/g, "-")
      .replace(/\r/g, "")
      .split("")
      .map((c) => (c === "\n" || c === "\t" ? c : c.charCodeAt(0) < 32 ? "" : c.charCodeAt(0) <= 0xff || CP1252.has(c) ? c : "?"))
      .join("");
  const money = (n) => clean(fmtNum(n, 2)) + " €";
  const hex = (h) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(h || "") || [0, "243b53"];
    const n = parseInt(m[1], 16);
    return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  };

  function wrap(text, font, size, maxW) {
    const out = [];
    for (const para of clean(text).split("\n")) {
      let line = "";
      for (const word of para.split(" ")) {
        const t = line ? line + " " + word : word;
        if (font.widthOfTextAtSize(t, size) <= maxW || !line) {
          if (font.widthOfTextAtSize(t, size) > maxW && !line) {
            // mot plus long que la ligne : on le coupe
            let chunk = "";
            for (const ch of word) {
              if (font.widthOfTextAtSize(chunk + ch, size) > maxW) { out.push(chunk); chunk = ch; } else chunk += ch;
            }
            line = chunk;
          } else line = t;
        } else {
          out.push(line);
          line = word;
        }
      }
      out.push(line);
    }
    return out;
  }

  /**
   * data : { kind, numero, date, echeance?, validite_jours?, statut, notes, client:{nom,adresse,ville,email,telephone},
   *          chantier?:{nom,ville}, lignes:[{designation,quantite,unite,prix_unitaire_ht,taux_tva}],
   *          ht, tva, ttc, paye? }
   * ctx  : { ent, regl:{couleur, devis:{top,bottom}, facture:{top,bottom}}, fond?:{bytes}, logo?:{bytes} }
   */
  async function build(data, ctx) {
    await loadScript(LIBS.pdflib);
    const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const ent = ctx.ent || {};
    const regl = ctx.regl || {};
    const kind = data.kind;
    const accent = hex(regl.couleur);
    const A = rgb(...accent);
    const ASoft = rgb(...accent.map((c) => c * 0.08 + 0.92));
    const INK = rgb(0.1, 0.11, 0.13),
      GREY = rgb(0.4, 0.42, 0.45),
      LINE = rgb(0.84, 0.85, 0.87);

    // Fond importé (PDF, PNG ou JPG) : reproduit sur chaque page
    let bg = null, bgPdf = false;
    if (ctx.fond?.bytes) {
      const t = sniff(ctx.fond.bytes);
      if (t === "pdf") {
        const src = await PDFDocument.load(ctx.fond.bytes, { ignoreEncryption: true });
        [bg] = await pdf.embedPdf(src, [0]);
        bgPdf = true;
      } else if (t === "png") bg = await pdf.embedPng(ctx.fond.bytes);
      else if (t === "jpg") bg = await pdf.embedJpg(ctx.fond.bytes);
    }
    let logo = null;
    if (ctx.logo?.bytes && !bg) {
      const t = sniff(ctx.logo.bytes);
      if (t === "png") logo = await pdf.embedPng(ctx.logo.bytes);
      else if (t === "jpg") logo = await pdf.embedJpg(ctx.logo.bytes);
    }
    const tpl = regl[kind] || {};
    const topM = bg ? Number(tpl.top ?? 150) : 42;
    const botM = bg ? Number(tpl.bottom ?? 90) : 78;

    let page, y;
    const drawBg = (p) => {
      if (!bg) return;
      const bw = bg.width,
        bh = bg.height,
        s = Math.min(W / bw, H / bh);
      const opt = { x: (W - bw * s) / 2, y: (H - bh * s) / 2, width: bw * s, height: bh * s };
      if (bgPdf) p.drawPage(bg, opt);
      else p.drawImage(bg, opt);
    };
    const txt = (s, x, yy, { size = 9.5, f = font, color = INK, right = false } = {}) => {
      s = clean(s);
      const w = f.widthOfTextAtSize(s, size);
      page.drawText(s, { x: right ? x - w : x, y: yy, size, font: f, color });
    };
    const newPage = (first = false) => {
      page = pdf.addPage([W, H]);
      drawBg(page);
      if (!bg) page.drawRectangle({ x: 0, y: H - 8, width: W, height: 8, color: A });
      y = H - topM;
      if (!first) {
        txt(`${kind === "devis" ? "Devis" : "Facture"} ${data.numero || ""} (suite)`, ML, y, { size: 8.5, color: GREY });
        y -= 24;
      }
    };
    const need = (h) => {
      if (y - h < botM) { newPage(); return true; }
      return false;
    };
    newPage(true);

    // ---- En-tête ----
    const title = kind === "devis" ? "DEVIS" : "FACTURE";
    const rightX = W - ML;
    if (!bg) {
      let hy = y;
      if (logo) {
        const s = Math.min(150 / logo.width, 52 / logo.height, 1);
        page.drawImage(logo, { x: ML, y: hy - logo.height * s + 8, width: logo.width * s, height: logo.height * s });
        hy -= logo.height * s + 6;
      } else {
        txt(ent.nom || "Votre entreprise", ML, hy - 6, { size: 15, f: bold });
        hy -= 22;
      }
      const idLines = [
        logo ? ent.nom : null,
        ent.adresse,
        [ent.telephone, ent.email].filter(Boolean).join("  -  "),
        ent.siret ? "SIRET " + ent.siret : null,
        ent.tva_intracom ? "TVA " + ent.tva_intracom : null,
      ].filter(Boolean);
      for (const l of idLines) {
        for (const ll of wrap(l, font, 8.5, 250)) { txt(ll, ML, hy - 4, { size: 8.5, color: GREY }); hy -= 11.5; }
      }
      txt(title, rightX, y - 8, { size: 28, f: bold, color: A, right: true });
      const mx = rightX - 196, my = y - 22, mh = 64;
      page.drawRectangle({ x: mx, y: my - mh, width: 196, height: mh, color: ASoft });
      page.drawRectangle({ x: mx, y: my - mh, width: 3, height: mh, color: A });
      const meta = [
        ["N°", data.numero || "-"],
        ["Date d'émission", D(data.date)],
        kind === "devis" ? ["Valable jusqu'au", D(addDays(data.date, Number(data.validite_jours) || 30))] : ["Échéance", D(data.echeance)],
      ];
      let ry = my - 18;
      for (const [k, v] of meta) {
        txt(k, mx + 14, ry, { size: 8.5, color: GREY });
        txt(v, rightX - 10, ry, { size: 9.5, f: bold, right: true });
        ry -= 16;
      }
      ry = my - mh;
      if (data.statut === "Brouillon") { txt("BROUILLON", rightX, ry - 14, { size: 9, f: bold, color: rgb(0.7, 0.25, 0.2), right: true }); ry -= 16; }
      y = Math.min(hy, ry) - 16;
    } else {
      txt(`${title}  ${data.numero || ""}`, ML, y - 4, { size: 18, f: bold, color: A });
      let ry = y - 24;
      const meta = [
        "Date : " + D(data.date),
        kind === "devis" ? "Valable " + (data.validite_jours || 30) + " jours" : "Échéance : " + D(data.echeance),
      ];
      for (const m of meta) { txt(m, ML, ry, { size: 9.5, color: GREY }); ry -= 13; }
      if (data.statut === "Brouillon") txt("BROUILLON", ML, ry, { size: 9, f: bold, color: rgb(0.7, 0.25, 0.2) });
      y = ry - 20;
    }

    // ---- Bloc client + projet ----
    const c = data.client || {};
    const cl = [c.nom, c.adresse, c.ville, c.telephone, c.email].filter(Boolean);
    const boxW = 250, boxX = W - ML - boxW;
    const clientLines = [];
    cl.forEach((l, i) => wrap(l, i === 0 ? bold : font, i === 0 ? 10.5 : 9, boxW - 28).forEach((ll) => clientLines.push([ll, i === 0])));
    const objet = [];
    if (data.chantier?.nom) objet.push(["Chantier", [data.chantier.nom, data.chantier.ville].filter(Boolean).join(" - ")]);
    if (kind === "facture" && data.devis_numero) objet.push(["Réf. devis", data.devis_numero]);
    const objLines = objet.map(([k, v]) => [k, wrap(v, font, 9.5, boxX - ML - 18)]);
    const leftH = objLines.length ? 24 + sum(objLines, ([, ls]) => 13 + ls.length * 12.5 + 6) : 0;
    const boxH = Math.max(36 + clientLines.length * 13, leftH + 4);
    need(boxH + 20);
    const by = y;
    page.drawRectangle({ x: boxX, y: by - boxH, width: boxW, height: boxH, color: ASoft });
    page.drawRectangle({ x: boxX, y: by - boxH, width: 3, height: boxH, color: A });
    txt(kind === "devis" ? "DESTINATAIRE" : "FACTURÉ À", boxX + 14, by - 16, { size: 7.5, f: bold, color: A });
    let cy = by - 33;
    for (const [ll, b] of clientLines) { txt(ll, boxX + 14, cy, { size: b ? 10.5 : 9, f: b ? bold : font }); cy -= 13; }
    let oy = by - 16;
    if (objLines.length) { txt(kind === "devis" ? "PROJET" : "RÉFÉRENCES", ML, oy, { size: 7.5, f: bold, color: A }); oy -= 17; }
    for (const [k, ls] of objLines) {
      txt(k, ML, oy, { size: 8, color: GREY });
      oy -= 13;
      for (const ll of ls) { txt(ll, ML, oy, { size: 9.5, f: bold }); oy -= 12.5; }
      oy -= 6;
    }
    y = by - boxH - 14;

    // ---- Tableau ----
    const X = { n: ML + 6, qte: 330, unite: 338, pu: 432, tva: 478, tot: W - ML - 6 };
    const designX = ML + 32, designW = X.qte - designX - 40;
    const WHITE = rgb(1, 1, 1), ZEBRA = rgb(0.975, 0.978, 0.982);
    const lignes = data.lignes?.length ? data.lignes : data.ht > 0 ? [{ designation: "Prestation", quantite: 1, unite: "forfait", prix_unitaire_ht: data.ht, taux_tva: data.taux_tva ?? 20 }] : [];
    const lht = (l) => r2(Number(l.quantite) * Number(l.prix_unitaire_ht));
    const groups = [];
    for (const l of lignes) {
      const cat = String(l.categorie || "").trim(), g = groups[groups.length - 1];
      if (g && g.cat === cat) g.items.push(l); else groups.push({ cat, items: [l] });
    }
    groups.forEach((g) => (g.sum = r2(sum(g.items, lht))));
    // Récapitulatif : on voit d'un coup d'oeil le prix de chaque poste
    if (groups.filter((g) => g.cat).length >= 2) {
      need(40 + groups.length * 17);
      txt("RÉCAPITULATIF DES TRAVAUX", ML, y - 8, { size: 8, f: bold, color: A });
      y -= 22;
      groups.forEach((g, i) => {
        need(20);
        txt(`${i + 1}.  ${g.cat || "Divers"}`, ML + 6, y - 8, { size: 9.5 });
        txt(money(g.sum), X.tot, y - 8, { size: 9.5, f: bold, right: true });
        y -= 16;
        page.drawLine({ start: { x: ML, y: y + 3 }, end: { x: W - ML, y: y + 3 }, thickness: 0.4, color: LINE });
      });
      y -= 10;
    }
    const header = () => {
      need(60);
      page.drawRectangle({ x: ML, y: y - 20, width: W - 2 * ML, height: 22, color: A });
      txt("N°", X.n, y - 13, { size: 8.5, f: bold, color: WHITE });
      txt("Désignation", designX, y - 13, { size: 8.5, f: bold, color: WHITE });
      txt("Qté", X.qte, y - 13, { size: 8.5, f: bold, color: WHITE, right: true });
      txt("Unité", X.unite, y - 13, { size: 8.5, f: bold, color: WHITE });
      txt("P.U. HT", X.pu, y - 13, { size: 8.5, f: bold, color: WHITE, right: true });
      txt("TVA", X.tva, y - 13, { size: 8.5, f: bold, color: WHITE, right: true });
      txt("Total HT", X.tot, y - 13, { size: 8.5, f: bold, color: WHITE, right: true });
      y -= 26;
    };
    header();
    const band = (g, gi, cont) => {
      page.drawRectangle({ x: ML, y: y - 21, width: W - 2 * ML, height: 23, color: ASoft });
      page.drawRectangle({ x: ML, y: y - 21, width: 3, height: 23, color: A });
      txt(`${gi + 1}.  ${g.cat}${cont ? " (suite)" : ""}`, ML + 12, y - 14, { size: 10, f: bold, color: A });
      txt("Sous-total " + money(g.sum), X.tot, y - 14, { size: 9, f: bold, color: A, right: true });
      y -= 27;
    };
    const byRate = {};
    groups.forEach((g, gi) => {
      if (g.cat) { if (y - 80 < botM) { newPage(); header(); } band(g, gi, false); }
      g.items.forEach((l, li) => {
        const ht = lht(l), tv = r2((ht * Number(l.taux_tva)) / 100), k = String(Number(l.taux_tva));
        byRate[k] ||= { ht: 0, tva: 0 };
        byRate[k].ht += ht;
        byRate[k].tva += tv;
        const lines = wrap(l.designation, font, 9.5, designW);
        const dl = l.description ? String(l.description).split("\n").flatMap((p) => wrap(p, font, 8.5, designW)) : [];
        const rh = lines.length * 12.5 + dl.length * 11 + 11;
        if (y - rh < botM) { newPage(); header(); if (g.cat) band(g, gi, true); }
        if (li % 2 === 1) page.drawRectangle({ x: ML, y: y - rh + 2, width: W - 2 * ML, height: rh, color: ZEBRA });
        txt(`${gi + 1}.${li + 1}`, X.n, y - 11, { size: 8.5, color: GREY });
        lines.forEach((ll, i) => txt(ll, designX, y - 11 - i * 12.5, { size: 9.5 }));
        dl.forEach((ll, i) => txt(ll, designX, y - 11 - lines.length * 12.5 - i * 11, { size: 8.5, color: GREY }));
        const q = Number(l.quantite);
        txt(fmtNum(q, Number.isInteger(q) ? 0 : 2), X.qte, y - 11, { right: true });
        txt(l.unite || "", X.unite, y - 11, { color: GREY });
        txt(fmtNum(l.prix_unitaire_ht, 2), X.pu, y - 11, { right: true });
        txt(fmtNum(l.taux_tva, Number(l.taux_tva) % 1 ? 1 : 0) + " %", X.tva, y - 11, { right: true, color: GREY });
        txt(fmtNum(ht, 2), X.tot, y - 11, { right: true, f: bold });
        y -= rh;
        page.drawLine({ start: { x: ML, y: y + 2 }, end: { x: W - ML, y: y + 2 }, thickness: 0.4, color: LINE });
      });
      y -= 6;
    });
    y -= 8;

    // ---- Totaux ----
    const rates = Object.keys(byRate).sort((a, b) => b - a);
    const tot = [["Total HT", money(data.ht)], ...rates.map((k) => [`TVA ${fmtNum(k, k % 1 ? 1 : 0)} %  (base ${money(byRate[k].ht)})`, money(byRate[k].tva)])];
    if (!rates.length) tot.push(["TVA", money(data.tva)]);
    const paye = Number(data.paye || 0);
    const nrows = tot.length + 2 + (kind === "facture" && paye > 0 ? 2 : 0);
    need(nrows * 17 + 24);
    const tx = W - ML - 235;
    for (const [k, v] of tot) {
      txt(k, tx, y - 10, { size: 9, color: GREY });
      txt(v, W - ML - 6, y - 10, { size: 9.5, right: true });
      y -= 17;
    }
    y -= 4;
    page.drawRectangle({ x: tx - 8, y: y - 24, width: 243, height: 30, color: A });
    txt("TOTAL TTC", tx, y - 13, { size: 10, f: bold, color: WHITE });
    txt(money(data.ttc), W - ML - 6, y - 14, { size: 13, f: bold, color: WHITE, right: true });
    y -= 40;
    if (kind === "facture" && paye > 0) {
      txt("Déjà réglé", tx, y - 6, { size: 9.5, color: GREY });
      txt("- " + money(paye), W - ML - 6, y - 6, { size: 9.5, right: true });
      y -= 17;
      txt("Reste à payer", tx, y - 6, { size: 10.5, f: bold });
      txt(money(Number(data.ttc) - paye), W - ML - 6, y - 6, { size: 10.5, f: bold, right: true });
      y -= 22;
    }
    y -= 8;

    // ---- Notes, conditions, règlement ----
    const para = (label, text) => {
      const ls = wrap(text, font, 8.5, W - 2 * ML);
      need(ls.length * 11.5 + 24);
      txt(label.toUpperCase(), ML, y - 8, { size: 7.5, f: bold, color: A });
      y -= 18;
      for (const l of ls) { txt(l, ML, y - 2, { size: 8.5 }); y -= 11.5; }
      y -= 8;
    };
    if (data.notes) para("Remarques", data.notes);
    if (kind === "facture") {
      const delai = ent.delai_paiement_jours ?? 30;
      para(
        "Conditions de règlement",
        `Paiement à réception, au plus tard le ${D(data.echeance)} (${delai} jours). Pas d'escompte pour paiement anticipé. En cas de retard : pénalités égales à 3 fois le taux d'intérêt légal et indemnité forfaitaire de recouvrement de 40 € (art. L441-10 du Code de commerce).`,
      );
      if (ent.iban) para("Règlement par virement", `IBAN : ${ent.iban}${ent.bic ? "   -   BIC : " + ent.bic : ""}\nMerci de rappeler le numéro de facture ${data.numero || ""} en référence.`);
    } else {
      para("Conditions", `Devis valable ${data.validite_jours || 30} jours à compter de sa date d'émission. Les travaux débuteront après réception du devis daté et signé.`);
      need(104);
      const sy = y, bw = (W - 2 * ML - 20) / 2;
      [["Le client", "Date et signature, précédées de « Bon pour accord »"], ["L'entreprise", ent.nom || "Cachet et signature"]].forEach(([t, sub], i) => {
        const bx = ML + i * (bw + 20);
        page.drawRectangle({ x: bx, y: sy - 84, width: bw, height: 86, borderColor: LINE, borderWidth: 0.8 });
        txt(t, bx + 10, sy - 16, { size: 9, f: bold, color: A });
        txt(sub, bx + 10, sy - 29, { size: 7.5, color: GREY });
      });
      y = sy - 96;
    }

    // ---- Pieds de page ----
    const pages = pdf.getPages();
    pages.forEach((p, i) => {
      page = p;
      if (!bg) {
        p.drawLine({ start: { x: ML, y: 56 }, end: { x: W - ML, y: 56 }, thickness: 0.5, color: LINE });
        const foot = [
          [ent.nom, ent.forme_juridique, ent.siret ? "SIRET " + ent.siret : null, ent.tva_intracom ? "TVA " + ent.tva_intracom : null, ent.rcs].filter(Boolean).join("  -  "),
          ent.mentions_legales,
        ].filter(Boolean);
        let fy = 44;
        for (const f of foot) for (const l of wrap(f, font, 7, W - 2 * ML).slice(0, 2)) { txt(l, W / 2 - font.widthOfTextAtSize(clean(l), 7) / 2, fy, { size: 7, color: GREY }); fy -= 9; }
      }
      if (pages.length > 1) txt(`Page ${i + 1} / ${pages.length}`, W - ML, bg ? 24 : 24, { size: 7.5, color: GREY, right: true });
    });

    pdf.setTitle(`${title} ${data.numero || ""}`);
    pdf.setProducer("Pilot");
    return await pdf.save();
  }

  const sample = (kind, ent) => ({
    kind,
    numero: kind === "devis" ? "devis-001" : "facture-001",
    date: today(),
    echeance: addDays(today(), ent?.delai_paiement_jours ?? 30),
    validite_jours: 30,
    statut: "Envoyé",
    client: { nom: "Jean Dupont", adresse: "12 rue des Lilas", ville: "37000 Tours", email: "jean.dupont@exemple.fr" },
    chantier: { nom: "Rénovation salle de bain", ville: "Tours" },
    lignes: [
      { designation: "Dépose de l'ancien carrelage et évacuation des gravats", quantite: 12, unite: "m²", prix_unitaire_ht: 28, taux_tva: 10 },
      { designation: "Fourniture et pose de carrelage grès cérame 60x60", quantite: 12, unite: "m²", prix_unitaire_ht: 65, taux_tva: 10 },
      { designation: "Remplacement du meuble vasque (fourniture comprise)", quantite: 1, unite: "forfait", prix_unitaire_ht: 480, taux_tva: 20 },
    ],
    ht: 1596,
    tva: 192.6,
    ttc: 1788.6,
    notes: "Exemple de document : vos données réelles remplaceront ce contenu.",
  });

  /* ---------- Lecture d'une facture fournisseur (PDF avec texte) ---------- */
  const MOIS = { janvier: 1, février: 2, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, août: 8, aout: 8, septembre: 9, octobre: 10, novembre: 11, décembre: 12, decembre: 12 };
  const num = (s) => {
    let t = String(s).replace(/[\s  €]|eur/gi, "");
    if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
    else t = t.replace(/,/g, "");
    const n = parseFloat(t);
    return isFinite(n) ? n : null;
  };
  const AMT = /-?\d{1,3}(?:[   .]\d{3})*[.,]\d{2}(?!\d)|-?\d+[.,]\d{2}(?!\d)/g;
  const amounts = (line) => (line.match(AMT) || []).map(num).filter((x) => x !== null);
  const DATE_RE = /(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4}|\d{2})\b|(\d{4})-(\d{2})-(\d{2})|(\d{1,2})(?:er)?\s+(janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)\s+(\d{4})/gi;
  const datesIn = (line) => {
    const out = [];
    for (const m of line.matchAll(DATE_RE)) {
      let d, mo, y;
      if (m[1]) { d = +m[1]; mo = +m[2]; y = +m[3]; if (y < 100) y += 2000; }
      else if (m[4]) { y = +m[4]; mo = +m[5]; d = +m[6]; }
      else { d = +m[7]; mo = MOIS[m[8].toLowerCase()]; y = +m[9]; }
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y > 2000 && y < 2100) out.push(`${y}-${pad2(mo)}-${pad2(d)}`);
    }
    return out;
  };
  const CATS = [
    ["Matériaux", /point\s*p|leroy|castorama|brico|bigmat|gedimat|tollens|cedeo|materiaux|matériaux|ciment|b[ée]ton|carrelage|peinture|bois\b|plaque|isolant|quincaillerie|sanitaire/i, "Achat"],
    ["Sous-traitance", /sous[-\s]*traitan|prestation de service|main d.?œuvre|int[ée]rim/i, "Achat"],
    ["Main-d'œuvre", /$^/, "Dépense"],
    ["Outillage & matériel", /outillage|hilti|facom|location de mat|loxam|kiloutou|mat[ée]riel/i, "Dépense"],
    ["Carburant & déplacements", /carburant|gazole|diesel|essence|totalenergies|shell|esso|station|p[ée]age|vinci|sanef|parking/i, "Dépense"],
    ["Assurances", /assurance|axa|maif|mma|groupama|allianz|hiscox|d[ée]cennale/i, "Dépense"],
    ["Téléphone & internet", /orange|sfr|bouygues|free\s*mobile|telecom|forfait mobile|internet|fibre/i, "Dépense"],
    ["Loyer & charges", /loyer|bail|charges locatives|[ée]lectricit[ée]|edf|engie|eau\b/i, "Dépense"],
    ["Logiciels & abonnements", /logiciel|abonnement|licence|saas|google|microsoft|adobe/i, "Dépense"],
    ["Honoraires", /honoraires|expert[-\s]*comptable|avocat|notaire|conseil/i, "Dépense"],
  ];
  const CATEGORIES = [...CATS.map((c) => c[0]), "Autre"];

  async function readPdfLines(file) {
    const pdfjs = await import(/* @vite-ignore */ LIBS.pdfjs);
    pdfjs.GlobalWorkerOptions.workerSrc = LIBS.pdfjsWorker;
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const lines = [], segs = [];
    for (let p = 1; p <= Math.min(doc.numPages, 4); p++) {
      const tc = await (await doc.getPage(p)).getTextContent();
      const rows = [];
      for (const it of tc.items) {
        if (!it.str || !it.str.trim()) continue;
        const yy = it.transform[5], xx = it.transform[4];
        let row = rows.find((r) => Math.abs(r.y - yy) < 3);
        if (!row) rows.push((row = { y: yy, items: [] }));
        row.items.push({ x: xx, s: it.str, w: it.width });
      }
      rows.sort((a, b) => b.y - a.y);
      for (const r of rows) {
        const its = r.items.sort((a, b) => a.x - b.x);
        lines.push(its.map((i) => i.s).join(" ").replace(/\s+/g, " ").trim());
        // segments : on coupe la ligne quand l'écart horizontal est grand (colonnes distinctes)
        let cur = "", endX = null;
        for (const i of its) {
          if (endX !== null && i.x - endX > 24) { segs.push(cur.trim()); cur = ""; }
          cur += (cur ? " " : "") + i.s;
          endX = i.x + (i.w || i.s.length * 5);
        }
        if (cur.trim()) segs.push(cur.trim());
      }
    }
    return { lines, segs };
  }

  function parseSupplier(lines, segs = lines) {
    const text = lines.join("\n");
    const out = { fournisseur: "", reference: "", date: "", echeance: "", ht: null, tva: null, ttc: null, categorie: "Autre", type: "Dépense" };
    if (text.replace(/\s/g, "").length < 30) return { ...out, vide: true };

    const onlyAmount = (l) => l && amounts(l).length > 0 && l.replace(AMT, "").replace(/[€\s:]|eur/gi, "").length <= 3;
    const pick = (re) => {
      // 1) montant sur la même ligne que le libellé (dernier montant de la ligne)
      for (const l of lines) if (re.test(l)) { const a = amounts(l); if (a.length) return a[a.length - 1]; }
      // 2) libellé seul, montant sur la ligne suivante (uniquement si cette ligne ne contient que le montant)
      for (let i = 0; i < lines.length; i++) if (re.test(lines[i]) && onlyAmount(lines[i + 1])) return amounts(lines[i + 1]).pop();
      return null;
    };
    out.ttc = pick(/total\s*ttc|montant\s*ttc|total\s*\(?\s*ttc/i) ?? pick(/net\s*[àa]\s*payer|total\s*[àa]\s*payer|total\s*g[ée]n[ée]ral|amount\s*due|total\s*due/i);
    out.ht = pick(/total\s*ht|montant\s*ht|sous[-\s]*total\s*ht|total\s*hors\s*taxe|net\s*ht|total\s*\(?\s*ht/i);
    out.tva = pick(/total\s*tva|montant\s*(de\s*la\s*)?tva|total\s*t\.?v\.?a/i);
    if (out.tva === null) {
      const t = lines.filter((l) => /^\s*tva\b.*\d/i.test(l)).flatMap((l) => amounts(l).slice(-1));
      if (t.length) out.tva = r2(sum(t));
    }
    if (out.tva === null && out.ttc !== null && out.ht !== null) out.tva = r2(out.ttc - out.ht);
    if (out.ht === null && out.ttc !== null && out.tva !== null) out.ht = r2(out.ttc - out.tva);
    if (out.ttc === null && out.ht !== null && out.tva !== null) out.ttc = r2(out.ht + out.tva);
    if (out.ttc !== null && out.tva !== null && out.ht !== null && Math.abs(out.ht + out.tva - out.ttc) >= 0.06) out.ht = r2(out.ttc - out.tva);
    out.coherent = out.ht !== null && out.tva !== null && out.ttc !== null && Math.abs(out.ht + out.tva - out.ttc) < 0.06;

    const allDates = lines.flatMap((l) => datesIn(l).map((d) => ({ d, l })));
    const ech = allDates.find((x) => /[ée]ch[ée]ance|r[èe]glement|payable|avant le|date limite|due date|paiement/i.test(x.l));
    out.echeance = ech?.d || "";
    const dd = allDates.find((x) => x !== ech && /date|facture|[ée]mis|[ée]mission|du\b/i.test(x.l)) || allDates.find((x) => x !== ech);
    out.date = dd?.d || "";
    if (!out.echeance && out.date) {
      const m = /(\d{1,3})\s*jours/i.exec(text);
      if (m) out.echeance = addDays(out.date, +m[1]);
    }

    const ref = /(?:facture|invoice|fact\.?)\s*(?:n[°o]\.?|num[ée]ro|no\.?|#)?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/_.]{2,})/gi;
    for (const m of text.matchAll(ref)) if (/\d/.test(m[1])) { out.reference = m[1].replace(/[.\-]+$/, ""); break; }

    const skip = /^(facture|devis|invoice|date|page|n[°o]\b|t[ée]l|www|http|siret|tva|bon de|r[ée]f|client|adresse|\d)/i;
    const top = segs.slice(0, 16).filter((l) => /[A-Za-zÀ-ÿ]{3,}/.test(l) && !skip.test(l));
    out.fournisseur = (top.find((l) => /\b(SAS|SARL|EURL|SASU|SNC|SA|EI|Ets|Etablissements|Établissements|Soci[ée]t[ée]|Sté)\b/i.test(l)) || top[0] || "").slice(0, 80);

    const hay = out.fournisseur + " " + text;
    for (const [name, re, type] of CATS) if (re.test(hay)) { out.categorie = name; out.type = type; break; }
    return out;
  }

  async function extractSupplier(file) {
    if (sniff(new Uint8Array(await file.slice(0, 8).arrayBuffer())) !== "pdf") return { image: true };
    const { lines, segs } = await readPdfLines(file);
    return parseSupplier(lines, segs);
  }

  return { build, sample, extractSupplier, parseSupplier, CATEGORIES, clean };
})();
