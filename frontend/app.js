/* Point d'entrée de la PWA Snart : relie les écrans, le réseau et la file hors ligne. */
import {
  createReport, fetchHealth, fetchReports, isRetryable,
} from './js/api.js';
import { button, notify } from './js/dom.js';
import { plural } from './js/format.js';
import {
  createSyncRunner, indexedDbQueue, SYNC_STATES, syncPending,
} from './js/queue.js';
import { onRouteChange } from './js/router.js';
import { createReportStore } from './js/store.js';
import { createDetailView } from './js/views/detail.js';
import { createHomeView } from './js/views/home.js';
import { createPendingView } from './js/views/pending.js';
import { createReportFormView } from './js/views/report-form.js';
import { createListView, createMapView } from './js/views/reports.js';

const SYNC_RETRY_MS = 60000;
const VIEW_TITLES = {
  home: 'Snart — Signalements citoyens',
  map: 'Carte — Snart',
  list: 'Signalements — Snart',
  report: 'Signaler — Snart',
  detail: 'Fiche — Snart',
  pending: 'En attente — Snart',
  notfound: 'Page introuvable — Snart',
};

const reports = createReportStore(fetchReports);
const networkState = document.querySelector('#networkState');
const queueBanner = document.querySelector('#queueBanner');
const queueBannerText = document.querySelector('#queueBannerText');
let apiReachable = true;
let syncing = false;
let retryTimer = null;
let currentView = null;

function renderNetworkState() {
  const online = navigator.onLine;
  let label = 'En ligne';
  if (!online) label = 'Hors ligne';
  else if (!apiReachable) label = 'Serveur injoignable';
  networkState.textContent = label;
  networkState.classList.toggle('is-offline', !online || !apiReachable);
}

async function checkApi() {
  if (navigator.onLine) {
    try {
      await fetchHealth();
      apiReachable = true;
    } catch {
      apiReachable = false;
    }
  }
  renderNetworkState();
}

function queueBannerMessage(waiting, rejected) {
  if (syncing) return 'Envoi des signalements en attente…';
  if (rejected > 0) {
    return `${plural(rejected, 'signalement refusé', 'signalements refusés')} à corriger, ${waiting} en attente.`;
  }
  return `${plural(waiting, 'signalement')} en attente, pas encore ${waiting === 1 ? 'publié' : 'publiés'}.`;
}

async function refreshQueueState() {
  let items = [];
  try {
    items = await indexedDbQueue.list();
  } catch {
    // Sans IndexedDB, l'application reste utilisable en ligne.
  }
  const waiting = items.filter((item) => item.sync_state !== SYNC_STATES.rejected).length;
  queueBanner.hidden = items.length === 0;
  queueBannerText.textContent = queueBannerMessage(waiting, items.length - waiting);
  clearTimeout(retryTimer);
  retryTimer = waiting > 0 ? setTimeout(requestSync, SYNC_RETRY_MS) : null;
  await pendingView.render();
}

const runSync = createSyncRunner(async () => {
  syncing = true;
  await refreshQueueState();
  let result = null;
  try {
    result = await syncPending({ queue: indexedDbQueue, send: createReport, isRetryable });
  } catch {
    // Base locale indisponible : le prochain essai recommencera.
  }
  syncing = false;
  await refreshQueueState();
  if (result?.sent.length) {
    reports.invalidate();
    reports.load('all', { force: true });
    if (reports.filter !== 'all') reports.load(reports.filter, { force: true });
    notify(`${plural(result.sent.length, 'signalement en attente publié', 'signalements en attente publiés')}.`);
  }
  if (result?.rejected.length) {
    notify('Un signalement en attente a été refusé. Ouvre la file pour le corriger.', { error: true });
  }
});

function requestSync() {
  if (navigator.onLine) runSync();
}

const pendingView = createPendingView({
  onSyncRequested: requestSync,
  onQueueChanged: refreshQueueState,
  onEdit(item) {
    formView.edit(item);
    location.hash = '#/signaler';
  },
});

const formView = createReportFormView({ reports, onQueueChanged: refreshQueueState });

const views = {
  home: createHomeView({ reports }),
  map: createMapView({ reports }),
  list: createListView({ reports }),
  report: formView,
  detail: createDetailView({ reports }),
  pending: pendingView,
};

function focusHeading() {
  document.querySelector(`[data-view="${currentView}"] h1`)?.focus({ preventScroll: true });
}

function showRoute(route) {
  document.querySelectorAll('[data-view]').forEach((section) => {
    section.hidden = section.dataset.view !== route.name;
  });
  document.querySelectorAll('[data-nav]').forEach((item) => {
    if (item.dataset.nav === route.name) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
  document.body.dataset.route = route.name;
  document.title = VIEW_TITLES[route.name];
  const isFirstView = currentView === null;
  if (currentView !== route.name) {
    views[currentView]?.leave?.();
    window.scrollTo(0, 0);
  }
  currentView = route.name;
  views[route.name]?.enter?.(route);
  // Au premier affichage, le clavier doit commencer au lien d'évitement.
  if (!isFirstView) focusHeading();
}

function showUpdateBanner(worker) {
  const banner = document.querySelector('#updateBanner');
  banner.replaceChildren(
    document.createTextNode('Une nouvelle version de Snart est prête. '),
    button('Recharger', 'text-button', () => worker.postMessage('SKIP_WAITING')),
  );
  banner.hidden = false;
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) location.reload();
  });
  navigator.serviceWorker.register('service-worker.js').then((registration) => {
    if (registration.waiting && hadController) showUpdateBanner(registration.waiting);
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && hadController) showUpdateBanner(worker);
      });
    });
  }).catch(() => {
    // L'interface en ligne reste utilisable si le navigateur bloque le service worker.
  });
}

window.addEventListener('online', () => {
  checkApi();
  requestSync();
  reports.load(reports.filter, { force: true });
});
window.addEventListener('offline', renderNetworkState);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') requestSync();
});
document.querySelector('#skipLink').addEventListener('click', (event) => {
  event.preventDefault();
  focusHeading();
});

renderNetworkState();
onRouteChange(showRoute);
checkApi();
refreshQueueState().then(requestSync);
registerServiceWorker();
