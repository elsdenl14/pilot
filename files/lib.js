/* Utilitaires communs (chargés avant pdf.js et app.js) */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const NB = " ";
const fmtNum = (n, d = 2) =>
  Number(n || 0).toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d }).replace(/ /g, NB);
const E = (n) =>
  Number(n || 0).toLocaleString("fr-FR", { maximumFractionDigits: 2 }).replace(/ /g, NB) + NB + "€";
const E2 = (n) => fmtNum(n, 2) + NB + "€";
const D = (d) => (d ? String(d).slice(0, 10).split("-").reverse().join("/") : "");
const pad2 = (n) => String(n).padStart(2, "0");
const localDay = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const today = () => localDay();
const addDays = (iso, n) => {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return localDay(d);
};
const daysBetween = (a, b) => Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 864e5);
const sum = (a, f = (x) => x) => a.reduce((t, x) => t + (Number(f(x)) || 0), 0);
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const MN = ["Janv", "Fév", "Mars", "Avr", "Mai", "Juin", "Juil", "Août", "Sept", "Oct", "Nov", "Déc"];
const MNL = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

const _scripts = {};
const loadScript = (url) =>
  (_scripts[url] ||= new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = url;
    s.onload = res;
    s.onerror = () => rej(new Error("Impossible de charger " + url));
    document.head.appendChild(s);
  }));

const LIBS = {
  pdflib: "vendor/pdf-lib.min.js",
  jszip: "vendor/jszip.min.js",
  pdfjs: new URL("vendor/pdf.min.mjs", document.baseURI).href,
  pdfjsWorker: new URL("vendor/pdf.worker.min.mjs", document.baseURI).href,
};

const csvCell = (v) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
// CSV à la française : séparateur ; , décimale virgule, BOM UTF-8 pour Excel
const toCsv = (headers, rows) =>
  "﻿" +
  [headers, ...rows]
    .map((r) => r.map((v) => csvCell(typeof v === "number" ? String(v).replace(".", ",") : v)).join(";"))
    .join("\r\n");
const downloadBlob = (name, blob) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 4000);
};
// Détecte le vrai type d'un fichier d'après ses premiers octets
const sniff = (b) =>
  b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46
    ? "pdf"
    : b[0] === 0x89 && b[1] === 0x50
      ? "png"
      : b[0] === 0xff && b[1] === 0xd8
        ? "jpg"
        : null;
const slug = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w.-]+/g, "_")
    .slice(0, 80);
