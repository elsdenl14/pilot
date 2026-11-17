/* Mode hors connexion : met en cache la page terrain. Les données (chantiers, tâches, heures) sont gardées par la page elle-même. */
const CACHE = "pilot-terrain-v1";
const SHELL = ["terrain.html", "terrain.js", "terrain.css", "config.js", "terrain.webmanifest"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  const name = u.pathname.split("/").pop();
  if (!SHELL.includes(name)) return;
  e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(CACHE).then((x) => x.put(name === "terrain.html" ? "terrain.html" : e.request, c)); return r; }).catch(() => caches.match(name === "terrain.html" ? "terrain.html" : e.request, { ignoreSearch: true })));
});
