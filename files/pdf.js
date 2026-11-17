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
    const { PDFDocument, StandardFonts, rgb, degrees } = window.PDFLib;
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
      if (!bg) page.drawRectangle({ x: 0, y: H - 5, width: W, height: 5, color: A });
      if (data.statut === "Brouillon") {
        const ww = bold.widthOfTextAtSize("BROUILLON", 96), a = (35 * Math.PI) / 180;
        page.drawText("BROUILLON", { x: W / 2 - (ww / 2) * Math.cos(a), y: H / 2 - (ww / 2) * Math.sin(a), size: 96, font: bold, color: rgb(0.94, 0.94, 0.95), rotate: degrees(35) });
      }
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
    const fx = kind === "facture" ? data.fx : null, fc = fx?.calc;
    const isAvoir = fx?.nature === "Avoir";
    const title = kind === "devis" ? "DEVIS" : clean((fx?.label || "Facture").toUpperCase());
    const tw0 = bold.widthOfTextAtSize(title, 26), tsz = tw0 > 250 ? (26 * 250) / tw0 : 26;
    const fit = (t, size, maxW, f = font) => { t = clean(t); if (f.widthOfTextAtSize(t, size) <= maxW) return t; while (t.length > 1 && f.widthOfTextAtSize(t + "…", size) > maxW) t = t.slice(0, -1); return t + "…"; };
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
      ].filter(Boolean);
      for (const l of idLines) {
        for (const ll of wrap(l, font, 8.5, 250)) { txt(ll, ML, hy - 4, { size: 8.5, color: GREY }); hy -= 11.5; }
      }
      txt(title, rightX, y - 10, { size: tsz, f: bold, color: A, right: true });
      txt("N° " + (data.numero || "-"), rightX, y - 30, { size: 11, f: bold, right: true });
      y = Math.min(hy, y - 36) - 14;
    } else {
      txt(`${title}  ${data.numero || ""}`, ML, y - 4, { size: 18, f: bold, color: A });
      y -= 26;
    }
    page.drawLine({ start: { x: ML, y }, end: { x: W - ML, y }, thickness: 0.8, color: LINE });
    y -= 16;

    // ---- Client (gauche) et dates (droite) ----
    const c = data.client || {};
    const cl = [c.nom, c.adresse, c.ville, c.telephone, c.email].filter(Boolean);
    const colW = 270, kx = W - ML - 215;
    const clientLines = [];
    cl.forEach((l, i) => wrap(l, i === 0 ? bold : font, i === 0 ? 11 : 9, colW).forEach((ll) => clientLines.push([ll, i === 0])));
    const chant = data.chantier?.nom ? wrap([data.chantier.nom, data.chantier.ville].filter(Boolean).join(" - "), bold, 9.5, colW) : [];
    const kv = [
      [isAvoir ? "Date de l'avoir" : "Date d'émission", D(data.date)],
      kind === "devis" ? ["Valable jusqu'au", D(addDays(data.date, Number(data.validite_jours) || 30))] : isAvoir ? null : ["À payer avant le", D(data.echeance)],
      isAvoir && fx.parentNumero ? ["Sur la facture", fx.parentNumero] : null,
      kind === "facture" && data.devis_numero ? ["Selon devis", data.devis_numero] : null,
      data.statut === "Brouillon" ? ["Statut", "Brouillon"] : null,
    ].filter(Boolean);
    const leftH = 14 + clientLines.length * 13 + (chant.length ? 16 + chant.length * 12.5 + 4 : 0);
    const rightH = 2 + kv.length * 20;
    need(Math.max(leftH, rightH) + 20);
    const by = y;
    txt(kind === "devis" ? "DESTINATAIRE" : "FACTURÉ À", ML, by - 8, { size: 7.5, f: bold, color: A });
    let cy = by - 24;
    for (const [ll, b] of clientLines) { txt(ll, ML, cy, { size: b ? 11 : 9, f: b ? bold : font, color: b ? INK : GREY }); cy -= 13; }
    if (chant.length) {
      cy -= 6;
      txt("CHANTIER", ML, cy, { size: 7.5, f: bold, color: A });
      cy -= 13;
      for (const ll of chant) { txt(ll, ML, cy, { size: 9.5, f: bold }); cy -= 12.5; }
    }
    let ky = by - 8;
    kv.forEach(([k, v], i) => {
      page.drawLine({ start: { x: kx, y: ky - 7 }, end: { x: rightX, y: ky - 7 }, thickness: 0.4, color: LINE });
      txt(k, kx, ky - 3, { size: 8.5, color: GREY });
      txt(v, rightX, ky - 3, { size: 9.5, f: bold, right: true, color: v === "Brouillon" ? rgb(0.7, 0.25, 0.2) : INK });
      ky -= 20;
    });
    y = Math.min(cy, ky + 8) - 16;

    // ---- Tableau ----
    const X = { n: ML, qte: 392, pu: 452, tva: 494, tot: W - ML };
    const designX = ML + 26, designW = 262;
    const WHITE = rgb(1, 1, 1), ZEBRA = rgb(0.975, 0.978, 0.982);
    const lignes = data.lignes?.length ? data.lignes : data.ht > 0 ? [{ designation: "Prestation", quantite: 1, unite: "forfait", prix_unitaire_ht: data.ht, taux_tva: data.taux_tva ?? 20 }] : [];
    const lht = (l) => r2(Number(l.quantite) * Number(l.prix_unitaire_ht));
    const inc = (l) => l.type_ligne !== "image" && (!l.est_option || l.option_choisie) && !(l.tranche_cond && !l.tranche_ok);
    const lotKey = (l) => (typeof mkKey === "function" ? mkKey(l) : String(l.categorie || "").trim());
    const lotLab = (l) => (typeof mkLabel === "function" ? mkLabel(l) : String(l.categorie || "").trim());
    const condOff = lignes.filter((l) => l.tranche_cond && !l.tranche_ok && l.type_ligne !== "image");
    const byRate = {};
    for (const l of lignes.filter(inc)) {
      const ht = lht(l), k = String(Number(l.taux_tva));
      byRate[k] ||= { ht: 0, tva: 0 };
      byRate[k].ht += ht;
      byRate[k].tva += r2((ht * Number(l.taux_tva)) / 100);
    }
    const dedLines = lignes.filter((l) => l.nature === "deduction");
    const optsOff = lignes.filter((l) => l.est_option && !l.option_choisie && l.type_ligne !== "image");
    const emb = {};
    for (const [p, b] of Object.entries(ctx.images || {})) {
      try { const t = sniff(b); emb[p] = t === "png" ? await pdf.embedPng(b) : await pdf.embedJpg(b); } catch (e) { /* image ignorée */ }
    }
    const groups = [];
    for (const l of lignes.filter((l) => l.nature !== "deduction" && (l.type_ligne === "image" ? emb[l.image_path] : inc(l)))) {
      const cat = lotLab(l), k = lotKey(l), g = groups[groups.length - 1];
      if (g && g.k === k) g.items.push(l); else groups.push({ cat, k, items: [l] });
    }
    groups.forEach((g) => (g.sum = r2(sum(g.items.filter((l) => l.type_ligne !== "image"), lht))));
    // Situation : récapitulatif de l'avancement du marché
    if (fx?.avancement?.length) {
      need(60 + fx.avancement.length * 16);
      txt(`AVANCEMENT DES TRAVAUX  -  MARCHÉ ${money(fx.marche_ht)} HT`, ML, y - 8, { size: 8, f: bold, color: A });
      y -= 22;
      fx.avancement.forEach((a) => {
        need(20);
        txt(fit(a.label, 9.5, 270), ML + 6, y - 8, { size: 9.5 });
        txt(money(a.marche), X.pu, y - 8, { size: 9.5, right: true, color: GREY });
        txt(`${fmtNum(a.prev, a.prev % 1 ? 1 : 0)} % > ${fmtNum(a.cum, a.cum % 1 ? 1 : 0)} %`, X.tot, y - 8, { size: 9.5, f: bold, right: true });
        y -= 16;
        page.drawLine({ start: { x: ML, y: y + 3 }, end: { x: W - ML, y: y + 3 }, thickness: 0.4, color: LINE });
      });
      y -= 10;
    }
    // Tableau cadrillé : colonnes Qté | Désignation | TVA | P.U. | Total
    const BORD = rgb(0.68, 0.71, 0.76);
    const G = [ML, ML + 62, ML + 322, ML + 372, ML + 438, W - ML]; // bords des colonnes
    const vlines = (y0, h, inner = true) => {
      (inner ? G : [G[0], G[G.length - 1]]).forEach((x) => page.drawLine({ start: { x, y: y0 }, end: { x, y: y0 - h }, thickness: 0.6, color: BORD }));
    };
    const hline = (yy, thick = 0.5, color = LINE) => page.drawLine({ start: { x: ML, y: yy }, end: { x: W - ML, y: yy }, thickness: thick, color });
    const desX = G[1] + 8, desW = G[2] - G[1] - 16;
    const header = () => {
      need(70);
      const hh = 24;
      page.drawRectangle({ x: ML, y: y - hh, width: W - 2 * ML, height: hh, color: ASoft });
      hline(y, 0.9, BORD); hline(y - hh, 0.9, BORD);
      vlines(y, hh);
      const hs = { size: 8.5, f: bold, color: A }, cx = (i, t) => txt(t, (G[i] + G[i + 1]) / 2 - bold.widthOfTextAtSize(clean(t), 8.5) / 2, y - 15.5, hs);
      cx(0, "Qté"); cx(1, "Désignation"); cx(2, "TVA"); cx(3, "Prix unit. HT"); cx(4, "Total HT");
      y -= hh;
    };
    header();
    const band = (g, gi, cont) => {
      const bh = 22;
      page.drawRectangle({ x: ML, y: y - bh, width: W - 2 * ML, height: bh, color: rgb(0.955, 0.96, 0.968) });
      vlines(y, bh, false); hline(y - bh, 0.5, BORD);
      txt(`${gi + 1}.  ${fit(g.cat, 10, 330, bold)}${cont ? " (suite)" : ""}`, ML + 8, y - 14.5, { size: 10, f: bold, color: A });
      txt("Sous-total " + money(g.sum), W - ML - 8, y - 14.5, { size: 9, f: bold, right: true });
      y -= bh;
    };
    groups.forEach((g, gi) => {
      if (g.cat) { if (y - 90 < botM) { newPage(); header(); } band(g, gi, false); }
      g.items.forEach((l, li) => {
        if (l.type_ligne === "image") {
          const im = emb[l.image_path], cap = l.designation && l.designation !== "Image" ? String(l.designation) : "";
          const sc = Math.min(300 / im.width, 190 / im.height, 1), dw = im.width * sc, dh = im.height * sc, rh = dh + (cap ? 15 : 0) + 14;
          if (y - rh < botM) { newPage(); header(); if (g.cat) band(g, gi, true); }
          vlines(y, rh, false);
          page.drawImage(im, { x: desX, y: y - dh - 6, width: dw, height: dh });
          if (cap) txt(fit(cap, 8.5, W - 2 * ML - 60), desX, y - dh - 17, { size: 8.5, color: GREY });
          y -= rh; hline(y, 0.5);
          return;
        }
        const ht = lht(l), libre = l.nature === "libre";
        const lines = wrap(l.designation + (l.est_option ? " (option retenue)" : ""), font, 9.5, desW);
        const dl = l.description ? String(l.description).split("\n").flatMap((p) => wrap(p, font, 8.5, desW)) : [];
        const rh = lines.length * 12.5 + dl.length * 10.8 + 16;
        if (y - rh < botM) { newPage(); header(); if (g.cat) band(g, gi, true); }
        vlines(y, rh);
        const ty = y - 12;
        lines.forEach((ll, i) => txt(ll, desX, ty - i * 12.5, { size: 9.5 }));
        dl.forEach((ll, i) => txt(ll, desX, ty - lines.length * 12.5 - i * 10.8, { size: 8.5, color: GREY }));
        const q = Number(l.quantite), mid = (a, b) => (G[a] + G[b]) / 2;
        const ctr = (t, i, o = {}) => { t = clean(t); txt(t, mid(i, i + 1) - (o.f || font).widthOfTextAtSize(t, o.size || 9.5) / 2, ty, o); };
        if (!libre) {
          ctr(`${fmtNum(q, Number.isInteger(q) ? 0 : 2)} ${l.unite || ""}`.trim(), 0);
          txt(fmtNum(l.prix_unitaire_ht, 2), G[4] - 7, ty, { right: true });
        }
        if (!libre || ht) {
          ctr(fmtNum(l.taux_tva, Number(l.taux_tva) % 1 ? 1 : 0) + " %", 2, { color: GREY });
          txt(fmtNum(ht, 2), G[5] - 7, ty, { right: true, f: bold });
        }
        y -= rh;
        hline(y, 0.5, g.items.length - 1 === li ? BORD : LINE);
      });
    });
    y -= 16;
    y -= 8;

    // ---- Options proposées, non comprises dans le total ----
    if (optsOff.length) {
      need(40 + optsOff.length * 17);
      txt("OPTIONS PROPOSÉES  -  NON COMPRISES DANS LE TOTAL", ML, y - 8, { size: 8, f: bold, color: A });
      y -= 22;
      optsOff.forEach((l) => {
        need(20);
        txt(fit(l.designation + (l.option_groupe ? "  (" + l.option_groupe + ")" : ""), 9.5, 330), ML + 6, y - 8, { size: 9.5 });
        txt(`${fmtNum(l.quantite, Number.isInteger(Number(l.quantite)) ? 0 : 2)} ${l.unite || ""}`, X.qte, y - 8, { size: 9, color: GREY, right: true });
        txt("+ " + money(lht(l)) + " HT", X.tot, y - 8, { size: 9.5, f: bold, right: true });
        y -= 16;
        page.drawLine({ start: { x: ML, y: y + 3 }, end: { x: W - ML, y: y + 3 }, thickness: 0.4, color: LINE });
      });
      y -= 10;
    }

    // ---- Tranches conditionnelles non affermies ----
    if (condOff.length) {
      const tr = {};
      condOff.forEach((l) => { const k = l.tranche || "Tranche conditionnelle"; tr[k] = r2((tr[k] || 0) + lht(l)); });
      need(40 + Object.keys(tr).length * 17);
      txt("TRANCHES CONDITIONNELLES  -  NON COMPRISES DANS LE TOTAL", ML, y - 8, { size: 8, f: bold, color: A });
      y -= 22;
      Object.entries(tr).forEach(([k, v]) => {
        need(20);
        txt(fit(k, 9.5, 330), ML + 6, y - 8, { size: 9.5 });
        txt(money(v) + " HT", X.tot, y - 8, { size: 9.5, f: bold, right: true });
        y -= 16;
        page.drawLine({ start: { x: ML, y: y + 3 }, end: { x: W - ML, y: y + 3 }, thickness: 0.4, color: LINE });
      });
      y -= 10;
    }

    // ---- Totaux ----
    const rates = Object.keys(byRate).sort((a, b) => b - a);
    const dedHt = r2(sum(dedLines, lht));
    const tot = [];
    if (dedLines.length) {
      tot.push(["Total des travaux HT", money(r2(Number(data.ht) - dedHt))]);
      dedLines.forEach((l) => tot.push([fit("Déjà facturé : " + String(l.designation).replace(/^D[ée]duction\s*:\s*/i, "").replace(/\s*\(.*$/, ""), 8.5, 150), "- " + money(-lht(l))]));
    }
    tot.push([dedLines.length ? "Reste à facturer HT" : "Total HT", money(data.ht)]);
    rates.forEach((k) => tot.push([`TVA ${fmtNum(k, k % 1 ? 1 : 0)} %  (base ${money(byRate[k].ht)})`, money(byRate[k].tva)]));
    if (!rates.length) tot.push(["TVA", money(data.tva)]);
    const paye = Number(data.paye || 0);
    const adj = [];
    if (fc?.retenue) adj.push([`Retenue de garantie ${fmtNum(fc.retenuePct, 1)} %`, "- " + money(fc.retenue)]);
    if (fc?.prime) adj.push([fit(`Prime ${fc.primeLib || "énergétique"}`, 9, 170), "- " + money(fc.prime)]);
    if (fc?.prorata) adj.push([`Compte prorata${fc.prorataPct ? " " + fmtNum(fc.prorataPct, 1) + " %" : ""}`, "- " + money(fc.prorata)]);
    if (fx?.avoirs) adj.push(["Avoirs déduits", "- " + money(fx.avoirs)]);
    const showNet = kind === "facture" && fx?.nature !== "Avoir" && (adj.length > 0 || fc?.escompte > 0);
    const netDu = showNet ? r2(fc.net - (fx.avoirs || 0)) : Number(data.ttc);
    const nrows = tot.length + 2 + (showNet ? adj.length + 2 : 0) + (kind === "facture" && paye > 0 ? 2 : 0) + (fc?.escompte ? 1 : 0);
    const recap = groups.filter((g) => g.cat).length >= 2 ? groups : [];
    need(Math.max(nrows * 17 + 24, recap.length ? recap.length * 15 + 34 : 0));
    const tx = W - ML - 235;
    let recapEnd = y;
    if (recap.length) {
      let ry = y;
      txt("RÉCAPITULATIF PAR POSTE", ML, ry - 8, { size: 7.5, f: bold, color: A });
      ry -= 20;
      recap.forEach((g, i) => {
        txt(`${i + 1}.  ${fit(g.cat || "Divers", 9, 170)}`, ML, ry - 6, { size: 9 });
        txt(money(g.sum), tx - 30, ry - 6, { size: 9, f: bold, right: true });
        ry -= 15;
        page.drawLine({ start: { x: ML, y: ry + 3 }, end: { x: tx - 30, y: ry + 3 }, thickness: 0.4, color: LINE });
      });
      recapEnd = ry;
    }
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
    if (showNet) {
      for (const [k, v] of adj) {
        txt(k, tx, y - 6, { size: 9, color: GREY });
        txt(v, W - ML - 6, y - 6, { size: 9.5, right: true });
        y -= 17;
      }
      page.drawLine({ start: { x: tx - 8, y: y + 4 }, end: { x: W - ML, y: y + 4 }, thickness: 0.6, color: LINE });
      txt("NET À PAYER", tx, y - 10, { size: 10.5, f: bold });
      txt(money(netDu), W - ML - 6, y - 10, { size: 12, f: bold, right: true });
      y -= 26;
      if (fc.escompte) {
        txt(fit(`Si payé avant le ${D(fc.limite)} (-${fmtNum(fc.escomptePct, 1)} %)`, 8.5, 160), tx, y - 4, { size: 8.5, color: GREY });
        txt(money(r2(netDu - fc.escompte)), W - ML - 6, y - 4, { size: 9.5, f: bold, right: true });
        y -= 17;
      }
    }
    if (kind === "facture" && paye > 0) {
      txt("Déjà réglé", tx, y - 6, { size: 9.5, color: GREY });
      txt("- " + money(paye), W - ML - 6, y - 6, { size: 9.5, right: true });
      y -= 17;
      txt("Reste à payer", tx, y - 6, { size: 10.5, f: bold });
      txt(money(fx?.reste ?? Number(data.ttc) - paye), W - ML - 6, y - 6, { size: 10.5, f: bold, right: true });
      y -= 22;
    }
    y = Math.min(y, recapEnd) - 8;

    // ---- Notes, conditions, règlement ----
    const para = (label, text) => {
      const ls = wrap(text, font, 8, W - 2 * ML);
      need(ls.length * 10.5 + 22);
      txt(label.toUpperCase(), ML, y - 8, { size: 7.5, f: bold, color: A });
      y -= 16;
      for (const l of ls) { txt(l, ML, y - 2, { size: 8, color: INK }); y -= 10.5; }
      y -= 6;
    };
    const mentionsBlock = () => {
      const ms = data.mentions || [];
      if (!ms.length) return;
      const ls = ms.flatMap((m) => wrap(m.text, font, 7.5, W - 2 * ML));
      need(ls.length * 10 + 20);
      txt("MENTIONS LÉGALES", ML, y - 8, { size: 7, f: bold, color: A });
      y -= 16;
      for (const m of ms) for (const l of wrap(m.text, font, 7.5, W - 2 * ML)) { txt(l, ML, y - 2, { size: 7.5, color: GREY }); y -= 10; }
      y -= 6;
    };
    if (data.notes) para("Remarques", data.notes);
    if (kind === "facture" && fx?.nature === "Proforma") {
      para("Facture proforma", "Document provisoire sans valeur de facture : il ne constitue pas une demande de paiement ferme et n'ouvre pas droit à déduction de la TVA. La facture définitive sera établie après exécution des prestations.");
    } else if (kind === "facture" && fx?.nature === "Avoir") {
      para("Avoir", "Cet avoir vient en déduction des sommes dues sur la facture d'origine, ou fait l'objet d'un remboursement.");
    } else if (kind === "facture") {
      const delai = ent.delai_paiement_jours ?? 30;
      const esc2 = fc?.escompte ? `Escompte de ${fmtNum(fc.escomptePct, 1)} % pour règlement avant le ${D(fc.limite)}, soit ${money(r2(netDu - fc.escompte))} à payer.` : "Pas d'escompte pour paiement anticipé.";
      para(
        "Conditions de règlement",
        `Paiement à réception, au plus tard le ${D(data.echeance)} (${delai} jours). ${esc2} En cas de retard : pénalités égales à 3 fois le taux d'intérêt légal et indemnité forfaitaire de recouvrement de 40 € (art. L441-10 du Code de commerce).`,
      );
      if (fx?.nature === "Acompte") para("Acompte", "Facture d'acompte : son montant sera déduit de la facture finale.");
      if (fc?.retenue) para("Retenue de garantie", `Retenue de garantie de ${fmtNum(fc.retenuePct, 1)} % du montant TTC (${money(fc.retenue)}), libérable un an après la réception des travaux${fx.retenueDate ? ", soit le " + D(fx.retenueDate) : ""}, sauf réserves non levées (loi n° 71-584 du 16 juillet 1971).`);
      else if (fc?.caution && fc.retenuePct) para("Retenue de garantie", "La retenue de garantie est remplacée par une caution bancaire.");
      if (fc?.prime) para("Prime énergétique", `Prime ${fc.primeLib || "énergétique"} de ${money(fc.prime)} déduite du net à payer par le client : elle est perçue par l'entreprise.`);
      if (fc?.prorata) para("Compte prorata", `Participation au compte prorata de ${money(fc.prorata)} retenue sur cette facture.`);
      if (ent.iban) para("Règlement par virement", `IBAN : ${ent.iban}${ent.bic ? "   -   BIC : " + ent.bic : ""}\nMerci de rappeler le numéro de facture ${data.numero || ""} en référence.`);
      if (data.qr && data.qr.length && ent.iban) {
        const n = data.qr.length, S = 70, mod = S / (n + 8);
        need(S + 4);
        const y0 = y + 4;
        for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (data.qr[r][c] === "1") page.drawRectangle({ x: ML + (c + 4) * mod, y: y0 - (r + 5) * mod, width: mod + 0.15, height: mod + 0.15, color: rgb(0, 0, 0) });
        const tl = wrap("Payer par virement en scannant ce QR code avec l'application de votre banque : le montant, le bénéficiaire et la référence sont préremplis.", font, 8.5, W - 2 * ML - S - 10);
        let ty = y0 - 26;
        for (const l of tl) { txt(l, ML + S + 4, ty, { size: 8.5, color: GREY }); ty -= 11.5; }
        y = y0 - S - 2;
      }
      mentionsBlock();
    } else {
      if (data.aides && data.aides.length) {
        const tot = r2(sum(data.aides, (a) => Number(a.montant)));
        para("Aides et primes prévisionnelles", data.aides.map((a) => `${a.type} : ${money(a.montant)}${a.statut === "Estimée" ? " (estimation)" : ""}`).join("\n") + `\nReste à charge estimé après aides : ${money(r2(Number(data.ttc) - tot))} TTC. Montants indicatifs, sous réserve de l'accord des organismes et de l'éligibilité des travaux.`);
      }
      para("Conditions", `Devis valable ${data.validite_jours || 30} jours à compter de sa date d'émission. Les travaux débuteront après réception du devis daté et signé.`);
      mentionsBlock();
      need(80);
      const sy = y, bw = (W - 2 * ML - 20) / 2;
      [["Le client", "Date et signature, précédées de « Bon pour accord »"], ["L'entreprise", ent.nom || "Cachet et signature"]].forEach(([t, sub], i) => {
        const bx = ML + i * (bw + 20);
        page.drawRectangle({ x: bx, y: sy - 64, width: bw, height: 66, borderColor: LINE, borderWidth: 0.8 });
        txt(t, bx + 10, sy - 16, { size: 9, f: bold, color: A });
        txt(sub, bx + 10, sy - 29, { size: 7.5, color: GREY });
      });
      y = sy - 76;
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
      if (data.empreinte) txt(`Empreinte d'intégrité SHA-256 : ${data.empreinte.slice(0, 32)}`, ML, 24, { size: 6.5, color: GREY });
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
