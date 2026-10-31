/*
 * Cache du shell : l'interface s'ouvre sans réseau, y compris sur une connexion instable.
 * À chaque mise en ligne, change CACHE_VERSION : c'est ce qui déclenche la mise à jour.
 */
const CACHE_VERSION = 'v3';
const CACHE_PREFIX = 'snart-shell-';
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;
const APP_SHELL = [
  './',
  'styles.css',
  'app.js',
  'config.js',
  'manifest.webmanifest',
  'icons/snart.svg',
  'icons/snart-mot-blanc.svg',
  'icons/favicon.ico',
  'icons/favicon.svg',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'js/api.js',
  'js/dom.js',
  'js/format.js',
  'js/geo.js',
  'js/identity.js',
  'js/map.js',
  'js/queue.js',
  'js/router.js',
  'js/store.js',
  'js/validation.js',
  'js/views/detail.js',
  'js/views/home.js',
  'js/views/pending.js',
  'js/views/report-card.js',
  'js/views/report-form.js',
  'js/views/reports.js',
];

const shellUrl = (path) => new URL(path, self.location.href).href;
const SHELL_URLS = new Set(APP_SHELL.map(shellUrl));

const OFFLINE_PAGE = `<!doctype html><html lang="fr"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Snart</title>
<body style="font-family:system-ui,sans-serif;padding:24px;color:#152d2e">
<h1>Snart n’est pas disponible</h1>
<p>L’application n’a pas encore été enregistrée sur cet appareil. Reconnecte-toi puis réessaie.</p></body></html>`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(
      APP_SHELL.map((path) => new Request(shellUrl(path), { cache: 'reload' })),
    )),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

async function shellResponse(request) {
  const key = request.mode === 'navigate' ? shellUrl('./') : request.url;
  const cached = await caches.match(key);
  if (cached) return cached;
  try {
    return await fetch(request);
  } catch {
    if (request.mode === 'navigate') {
      return new Response(OFFLINE_PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
    return new Response('', { status: 503, statusText: 'Hors ligne' });
  }
}

/* Seul le shell passe ici : API, POST, photos et ressources externes ne sont jamais mis en cache. */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.includes('/api/')) return;
  if (request.mode === 'navigate' || SHELL_URLS.has(url.origin + url.pathname)) {
    event.respondWith(shellResponse(request));
  }
});
