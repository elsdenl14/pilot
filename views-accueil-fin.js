/* Accueil : vue financière (12 derniers mois) — encaissements, dépenses payées, solde cumulé. */

function finMonths(n = 12) {
  const out = []; let y = new Date().getFullYear(), m = new Date().getMonth();
  for (let i = 0; i < n; i++) { out.unshift({ y, m, k: `${y}-${pad2(m + 1)}` }); if (--m < 0) { m = 11; y--; } }
  return out;
}
function finSeries(n = 12) {
  const ms = finMonths(n), first = ms[0].k + "-01";
  const pays = db.paiements || [], deps = (db.depenses || []).filter((d) => d.statut === "Payée");
  const dDate = (d) => String(d.date_paiement || d.date_depense || "").slice(0, 10);
  const lastDay = (x) => `${x.k}-${pad2(new Date(x.y, x.m + 1, 0).getDate())}`;
  const adj = (to) => (typeof rgCashAdj === "function" ? rgCashAdj(to) : 0);
  const before = (db.ent?.tresorerie_initiale || 0) + sum(pays.filter((p) => String(p.date_paiement).slice(0, 10) < first), (p) => p.montant) - sum(deps.filter((d) => dDate(d) < first), (d) => d.montant_ttc);
  let cum = before;
  return ms.map((x) => {
    const inn = sum(pays.filter((p) => monthKey(p.date_paiement) === x.k), (p) => p.montant);
    const out = sum(deps.filter((d) => monthKey(dDate(d)) === x.k), (d) => d.montant_ttc);
    const ca = sum(emises().filter((f) => monthKey(f.date_emission) === x.k), (f) => f.montant_ht);
    cum += inn - out;
    const l = new Date(x.y, x.m, 1).toLocaleDateString("fr-FR", { month: "short" }).replace(".", "");
    return { ...x, inn, out, ca, cum: cum + adj(lastDay(x)), l: x.m === 0 ? `${l} ${String(x.y).slice(2)}` : l, full: new Date(x.y, x.m, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" }) };
  });
}
const finK = (v) => { const a = Math.abs(v); return (v < 0 ? "-" : "") + (a >= 1e6 ? (a / 1e6).toFixed(1).replace(".", ",") + " M" : a >= 1e3 ? Math.round(a / 1e3) + " k" : Math.round(a)); };
function finNice(lo, hi) {
  const span = Math.max(hi - lo, 1), raw = span / 4, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  return { lo: Math.floor(lo / step) * step, hi: Math.ceil(hi / step) * step, step };
}
function finChart(s) {
  const W = 920, H = 320, L = 56, R = 16, T = 16, B = 34, iw = W - L - R, ih = H - T - B;
  const hi0 = Math.max(0, ...s.map((x) => Math.max(x.inn, x.out, x.cum))), lo0 = Math.min(0, ...s.map((x) => x.cum));
  const { lo, hi, step } = finNice(lo0, hi0 || 1000);
  const Y = (v) => T + ih - ((v - lo) / (hi - lo)) * ih, cw = iw / s.length, X = (i) => L + cw * i + cw / 2;
  let grid = "";
  for (let v = lo; v <= hi + 1e-9; v += step) grid += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)" ${v === 0 ? 'stroke-width="1.4"' : 'stroke-dasharray="3 4"'}/><text x="${L - 8}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="var(--faint)">${finK(v)}</text>`;
  const bw = Math.min(16, cw * 0.28), z = Y(0);
  const bars = s.map((x, i) => {
    const h1 = Math.max(0, z - Y(x.inn)), h2 = Math.max(0, z - Y(x.out));
    return `<g class="fcol"><rect class="fhl" x="${L + cw * i + 3}" y="${T}" width="${cw - 6}" height="${ih}" rx="6"/>
      <rect x="${X(i) - bw - 1.5}" y="${z - h1}" width="${bw}" height="${h1}" rx="3" fill="url(#fgIn)"/><rect x="${X(i) + 1.5}" y="${z - h2}" width="${bw}" height="${h2}" rx="3" fill="url(#fgOut)"/>
      <text x="${X(i)}" y="${H - 12}" text-anchor="middle" font-size="11.5" fill="var(--mut)">${esc(x.l)}</text>
      <rect x="${L + cw * i}" y="${T}" width="${cw}" height="${ih + B}" fill="transparent"><title>${esc(x.full)}
Encaissements : ${E(x.inn)}
Dépenses payées : ${E(x.out)}
Solde de trésorerie : ${E(x.cum)}</title></rect></g>`;
  }).join("");
  const pts = s.map((x, i) => [X(i), Y(x.cum)]);
  const path = pts.map((p, i) => {
    if (!i) return `M${p[0]},${p[1]}`;
    const q = pts[i - 1], cx = (q[0] + p[0]) / 2;
    return `C${cx},${q[1]} ${cx},${p[1]} ${p[0]},${p[1]}`;
  }).join(" ");
  const area = `${path} L${pts[pts.length - 1][0]},${z} L${pts[0][0]},${z} Z`;
  const last = pts[pts.length - 1];
  return `<svg viewBox="0 0 ${W} ${H}" class="fchart" role="img" aria-label="Encaissements, dépenses payées et solde de trésorerie sur 12 mois">
    <defs><linearGradient id="fgIn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--ok)"/><stop offset="1" style="stop-color:var(--ok);stop-opacity:.55"/></linearGradient>
    <linearGradient id="fgOut" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--dn)"/><stop offset="1" style="stop-color:var(--dn);stop-opacity:.5"/></linearGradient>
    <linearGradient id="fgCum" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--acc);stop-opacity:.28"/><stop offset="1" style="stop-color:var(--acc);stop-opacity:0"/></linearGradient></defs>
    ${grid}<path d="${area}" fill="url(#fgCum)"/>${bars}
    <path d="${path}" fill="none" stroke="var(--acc)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" pointer-events="none"/>
    ${pts.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="3" fill="var(--panel)" stroke="var(--acc)" stroke-width="2" pointer-events="none"/>`).join("")}
    <circle cx="${last[0]}" cy="${last[1]}" r="5.5" fill="var(--acc)" stroke="var(--panel)" stroke-width="2.5" pointer-events="none"/></svg>`;
}
function homeFinance() {
  const s = finSeries(12);
  const inn = sum(s, (x) => x.inn), out = sum(s, (x) => x.out), ca = sum(s, (x) => x.ca), net = inn - out;
  const cur = s[s.length - 1], prev = s[s.length - 2];
  const dl = prev && prev.cum ? Math.round(((cur.cum - prev.cum) / Math.abs(prev.cum)) * 100) : null;
  const kp = (l, v, sub, c = "") => `<div class="fk"><small>${l}</small><b class="${c}">${v}</b><span>${sub}</span></div>`;
  const body = `<div class="fkp">${kp("Chiffre d'affaires facturé (HT)", E(ca), "12 derniers mois")}${kp("Encaissé", E(inn), "paiements reçus", "up")}${kp("Dépenses payées", E(out), "achats, frais, sous-traitance", "dn")}
      ${kp("Résultat de trésorerie", (net >= 0 ? "+ " : "- ") + E(Math.abs(net)), net >= 0 ? "encaissé moins dépensé" : "dépenses supérieures aux encaissements", net >= 0 ? "up" : "dn")}</div>
    <div class="fwrap">${finChart(s)}</div>
    <div class="fleg"><span><i style="background:var(--ok)"></i>Encaissements</span><span><i style="background:var(--dn)"></i>Dépenses payées</span><span><i class="ln"></i>Solde de trésorerie${dl !== null ? ` · ${E(cur.cum)} (${dl >= 0 ? "+" : ""}${dl} % sur le mois)` : ` · ${E(cur.cum)}`}</span></div>`;
  return card("Vue financière", body, `<button class="lk" data-go="tresorerie">Prévisions de trésorerie ${svg(ic.ar)}</button>`, "fin");
}
