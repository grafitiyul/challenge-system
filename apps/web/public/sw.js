// Self-retiring service worker.
//
// Prior versions of this app registered a service worker for PWA installability.
// Pass-through SWs are harmless, but any browser still running an older
// caching SW can serve stale UI. To permanently remove the SW as a source of
// staleness — without asking users to clear caches manually — this worker:
//   1. Takes control on install/activate so it supersedes any previous SW.
//   2. Deletes every Cache Storage entry it can see.
//   3. Unregisters itself, and navigates all controlled clients to drop control.
// After this runs once per client, the browser has no SW and will always
// fetch fresh HTML + chunks from the network. Future visitors never register
// a SW again (see layout.tsx).

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
    } catch { /* no-op */ }
    try { await self.registration.unregister(); } catch { /* no-op */ }
    // Force every controlled client to reload once so they drop SW control
    // and fetch the latest HTML (with up-to-date chunk hashes) directly.
    try {
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const client of clients) {
        client.navigate(client.url).catch(() => { /* no-op */ });
      }
    } catch { /* no-op */ }
  })());
});

// Always pass through. Never cache. (Safety net during the brief window
// between activate and unregister completing.)
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
