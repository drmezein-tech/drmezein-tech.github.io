// Offline cache for the app shell. Bump VERSION whenever any file changes.
const VERSION = 'ward-v3';
const FILES = [
  './', 'index.html', 'styles.css', 'db.js', 'app.js', 'manifest.json',
  'vendor/sql-wasm.js', 'vendor/sql-wasm.wasm', 'vendor/jspdf.umd.min.js', 'vendor/jspdf.plugin.autotable.min.js',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request)));
});
