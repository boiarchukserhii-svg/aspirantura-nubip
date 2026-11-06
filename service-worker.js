const CACHE = "aspirantura-nubip-app-v4";
const HOME = new URL("./",self.location).href;
self.addEventListener("install",event => {
  event.waitUntil((async () => {
    const response = await fetch(HOME,{cache:"reload"});
    if (!response.ok || response.redirected || !(await response.clone().text()).includes('aspirantura-nubip.registry.v1')) return;
    await (await caches.open(CACHE)).put(HOME,response);
  })());
  self.skipWaiting();
});
self.addEventListener("activate",event => event.waitUntil((async () => {
  for (const key of await caches.keys()) {
    if (key.startsWith("aspirantura-nubip-app-") && key !== CACHE) await caches.delete(key);
  }
  await self.clients.claim();
})()));
self.addEventListener("fetch",event => {
  if (event.request.mode !== "navigate" || event.request.url !== HOME) return;
  event.respondWith(fetch(event.request).catch(async () =>
    (await caches.match(HOME,{cacheName:CACHE})) ?? Response.error()));
});
