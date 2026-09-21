// Scanner shell offline support (FR-S4 companion): cache app shell, network-first pages.
// Bump CACHE whenever the shell changes so staff devices pick it up on next load.
const CACHE = "ms-tickets-v2";
const SHELL = [
  "/scan", "/gate", "/manifest.json",
  "/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-maskable-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      Promise.all(SHELL.map((u) => c.add(u).catch((err) => console.warn("sw: skip", u, err))))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // Network-first for navigations (fresh app), cache-first for static assets
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request).then((r) => r || caches.match("/scan")))
    );
  } else {
    e.respondWith(
      caches.match(e.request).then((r) => r || fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      }))
    );
  }
});
