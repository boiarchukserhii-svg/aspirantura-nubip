const CACHE = "aspirantura-nubip-app-v77-remove-cancelled-dismissal";
const HOME = new URL("./",self.location).href;
const FONTS = ["Zakon-Regular.otf","Zakon-Bold.otf"].map(name => new URL(name,HOME).href);
async function refreshPage(request) {
  const response = await fetch(request,{cache:"no-cache"});
  if (response.ok && !response.redirected &&
      response.headers.get("content-type")?.includes("text/html") &&
      (await response.clone().text()).includes("aspirantura-nubip.registry.v1")) {
    try { await (await caches.open(CACHE)).put(HOME,response.clone()); } catch {}
  }
  return response;
}
self.addEventListener("install",event => {
  event.waitUntil((async () => {
    await refreshPage(HOME);
    await (await caches.open(CACHE)).addAll(FONTS);
    await self.skipWaiting();
  })());
});
self.addEventListener("activate",event => event.waitUntil((async () => {
  for (const key of await caches.keys()) {
    if (key.startsWith("aspirantura-nubip-app-") && key !== CACHE) await caches.delete(key);
  }
  await self.clients.claim();
})()));
self.addEventListener("fetch",event => {
  if (event.request.method !== "GET") return;
  if (FONTS.includes(event.request.url)) {
    event.respondWith(caches.open(CACHE).then(async cache =>
      (await cache.match(event.request)) ?? fetch(event.request)));
    return;
  }
  if (event.request.mode !== "navigate") return;
  const target = new URL(event.request.url);
  if (new URL("./",target).href !== HOME ||
      ![new URL(HOME).pathname,new URL("index.html",HOME).pathname].includes(target.pathname)) return;
  event.respondWith(refreshPage(event.request).catch(async () =>
    (await caches.match(HOME,{cacheName:CACHE})) ?? Response.error()));
});
