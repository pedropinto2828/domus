/* DOMUS+ — service worker: abre o site mesmo sem ligação (rede primeiro, cópia local como alternativa).
   Os pedidos à API da ESP32 nunca são guardados em cache. */
const CACHE = "domus-v4";
const SHELL = ["./", "index.html", "style.css", "interativo.css", "app.js", "interativo.js?v=4", "aovivo.js?v=4", "icon.svg", "manifest.webmanifest"];

self.addEventListener("install", (event) => {
    event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
    event.waitUntil(caches.keys()
        .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
        .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);
    if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
    event.respondWith(
        fetch(event.request)
            .then((response) => {
                const copy = response.clone();
                caches.open(CACHE).then((cache) => cache.put(event.request, copy));
                return response;
            })
            .catch(() => caches.match(event.request))
    );
});
