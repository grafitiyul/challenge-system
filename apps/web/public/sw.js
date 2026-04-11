// Minimal service worker — satisfies PWA installability requirement.
// No caching. All requests pass through to the network.
// This avoids stale UI/data risks while enabling home-screen installation.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => e.respondWith(fetch(e.request)));
