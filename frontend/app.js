/* Snart mobile-first PWA client; all user-generated text is rendered as text. */
const CATEGORY_INFO = {
  dechets: { label: 'Déchets', glyph: 'D', css: 'waste' },
  caniveau_bouche: { label: 'Caniveau bouché', glyph: 'C', css: 'drain' },
  embouteillage: { label: 'Embouteillage', glyph: 'E', css: 'traffic' },
  indetermine: { label: 'À préciser', glyph: '?', css: 'unknown' },
};

const state = {
  reports: [],
  filter: 'all',
  map: null,
  markerLayer: null,
  location: null,
  photoUrl: null,
  queueDb: null,
  flushing: false,
};

const elements = {
  form: document.querySelector('#reportForm'),
  description: document.querySelector('#description'),
  category: document.querySelector('#category'),
  photo: document.querySelector('#photo'),
  photoPreview: document.querySelector('#photoPreview'),
  formMessage: document.querySelector('#formMessage'),
  locationLabel: document.querySelector('#locationLabel'),
  locateButton: document.querySelector('#locateButton'),
  submitButton: document.querySelector('#submitButton'),
  networkState: document.querySelector('#networkState'),
  reportsList: document.querySelector('#reportsList'),
  emptyState: document.querySelector('#emptyState'),
  reportCount: document.querySelector('#reportCount'),
  refreshButton: document.querySelector('#refreshButton'),
};

function userId() {
  let id = localStorage.getItem('snart-anonymous-id');
  if (!id) {
    id = globalThis.crypto?.randomUUID?.() || `anon-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem('snart-anonymous-id', id);
  }
  return id;
}

function setMessage(message, isError = false) {
  elements.formMessage.textContent = message;
  elements.formMessage.classList.toggle('is-error', isError);
}

function setNetworkState() {
  const online = navigator.onLine;
  elements.networkState.textContent = online ? 'En ligne' : 'Hors ligne';
  elements.networkState.classList.toggle('is-offline', !online);
}

function initMap() {
  const mapElement = document.querySelector('#map');
  if (!globalThis.L || !mapElement) {
    mapElement.textContent = 'La carte nécessite une connexion réseau. Les signalements restent consultables dans la liste.';
    mapElement.classList.add('map-unavailable');
    return;
  }
  state.map = L.map(mapElement, { scrollWheelZoom: false }).setView([-11.66, 27.48], 12);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(state.map);
  state.markerLayer = L.layerGroup().addTo(state.map);
  state.map.on('click', (event) => {
    state.location = {
      latitude: event.latlng.lat,
      longitude: event.latlng.lng,
      accuracy_m: 150,
      source: 'manual',
    };
    elements.locationLabel.textContent = `Épingle placée : ${event.latlng.lat.toFixed(5)}, ${event.latlng.lng.toFixed(5)}.`;
    setMessage('Position choisie sur la carte.');
  });
}

function requestPosition() {
  if (!navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy_m: position.coords.accuracy,
        source: 'gps',
      }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  });
}

function openQueueDatabase() {
  if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB indisponible'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('snart-offline-queue', 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('reports')) {
        database.createObjectStore('reports', { keyPath: 'client_id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Impossible d’ouvrir la file hors ligne'));
  });
}

function queueOperation(mode, operation) {
  return openQueueDatabase().then((database) => new Promise((resolve, reject) => {
    const transaction = database.transaction('reports', mode);
    const store = transaction.objectStore('reports');
    const result = operation(store);
    transaction.oncomplete = () => resolve(result?.result);
    transaction.onerror = () => reject(transaction.error || new Error('Échec de la file hors ligne'));
  }));
}

function saveQueuedReport(item) {
  return queueOperation('readwrite', (store) => store.put(item));
}

function listQueuedReports() {
  return queueOperation('readonly', (store) => store.getAll()).then((items) => items || []);
}

function deleteQueuedReport(clientId) {
  return queueOperation('readwrite', (store) => store.delete(clientId));
}

function createFormData(item) {
  const form = new FormData();
  form.append('description', item.description);
  form.append('reporter_id', item.reporter_id);
  form.append('category_override', item.category_override || 'auto');
  form.append('observed_at', item.observed_at);
  if (Number.isFinite(item.latitude) && Number.isFinite(item.longitude)) {
    form.append('latitude', String(item.latitude));
    form.append('longitude', String(item.longitude));
    form.append('location_accuracy_m', String(item.location_accuracy_m ?? 150));
  }
  if (item.photo) form.append('photo', item.photo, item.photo.name || 'snart-image');
  return form;
}

async function sendReport(item) {
  const response = await fetch('/api/reports', { method: 'POST', body: createFormData(item) });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(body.detail || `Erreur serveur (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function showPendingQueue(count) {
  const pending = document.querySelector('#pendingQueue');
  if (!pending) return;
  pending.hidden = count === 0;
  pending.textContent = count === 1
    ? '1 signalement attend une connexion pour être transmis.'
    : `${count} signalements attendent une connexion pour être transmis.`;
}

async function refreshQueueCount() {
  try {
    showPendingQueue((await listQueuedReports()).length);
  } catch {
    showPendingQueue(0);
  }
}

async function flushQueue() {
  if (!navigator.onLine || state.flushing) return;
  state.flushing = true;
  try {
    const pending = await listQueuedReports();
    for (const item of pending) {
      try {
        await sendReport(item);
        await deleteQueuedReport(item.client_id);
      } catch (error) {
        if (error instanceof TypeError || !navigator.onLine) break;
        // Keep server-rejected items visible in the queue for review.
        item.last_error = error.message;
        await saveQueuedReport(item);
        break;
      }
    }
    const remaining = await listQueuedReports();
    showPendingQueue(remaining.length);
    if (pending.length > remaining.length) {
      setMessage('Les signalements en attente ont été transmis.');
      await loadReports();
    }
  } catch {
    showPendingQueue(0);
  } finally {
    state.flushing = false;
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Heure indisponible';
  return new Intl.DateTimeFormat('fr-CD', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function categoryInfo(category) {
  return CATEGORY_INFO[category] || CATEGORY_INFO.indetermine;
}

function statusText(status) {
  return ({ active: 'Actuel', stale: 'À actualiser', resolved: 'Résolu' })[status] || 'À vérifier';
}

function makeReportCard(report) {
  const info = categoryInfo(report.category);
  const card = el('article', 'report-card');
  const accent = el('span', `report-accent ${info.css}`);
  const content = el('div', 'report-content');
  const topline = el('div', 'report-topline');
  topline.append(el('span', 'report-category', info.label));
  topline.append(el('time', 'report-time', formatDate(report.observed_at || report.created_at)));
  const summary = el('p', 'report-summary', report.summary || report.description || 'Description indisponible.');
  const meta = el('div', 'report-meta');
  meta.append(el('span', 'score-pill', `Fiabilité ${report.confidence_percent}/100`));
  const status = el('span', `status-pill ${report.status}`, statusText(report.status));
  meta.append(status);
  const nearby = report.confidence_factors?.nearby_confirmations ?? 0;
  const remote = report.confidence_factors?.remote_confirmations ?? 0;
  meta.append(el('span', '', `${nearby} proche${nearby === 1 ? '' : 's'} · ${remote} distante${remote === 1 ? '' : 's'}`));
  if (report.structuring_mode) {
    const modeLabel = report.structuring_mode === 'demo_rules' ? 'Structuration démo' : report.structuring_mode;
    meta.append(el('span', 'mode-pill', modeLabel));
  }
  if (report.needs_review) meta.append(el('span', 'status-pill stale', 'Catégorie à vérifier'));
  if (report.last_confirmed_at) {
    meta.append(el('span', '', `Confirmé le ${formatDate(report.last_confirmed_at)}`));
  }
  content.append(topline, summary, meta);
  if (report.has_photo) {
    const image = document.createElement('img');
    image.className = 'report-photo';
    image.src = `/api/reports/${report.id}/photo`;
    image.alt = 'Image jointe au signalement';
    image.loading = 'lazy';
    content.append(image);
  }

  const actions = el('div', 'report-actions');
  const confirmButton = el('button', 'small-action', 'Je confirme, toujours présent');
  confirmButton.type = 'button';
  confirmButton.addEventListener('click', () => submitConfirmation(report.id, 'still_present'));
  const resolvedButton = el('button', 'small-action', 'Je confirme, résolu');
  resolvedButton.type = 'button';
  resolvedButton.addEventListener('click', () => submitConfirmation(report.id, 'resolved'));
  actions.append(confirmButton, resolvedButton);
  content.append(actions);
  card.append(accent, content);
  return card;
}

function visibleReports() {
  return state.filter === 'all'
    ? state.reports
    : state.reports.filter((report) => report.category === state.filter);
}

function renderMap(reports) {
  if (!state.map || !state.markerLayer) return;
  state.markerLayer.clearLayers();
  for (const report of reports) {
    if (!Number.isFinite(report.latitude) || !Number.isFinite(report.longitude)) continue;
    const info = categoryInfo(report.category);
    const marker = L.marker([report.latitude, report.longitude], {
      icon: L.divIcon({
        className: 'report-marker',
        html: `<span class="marker-dot ${info.css}">${info.glyph}</span>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      }),
    });
    const popup = el('div', 'map-popup');
    popup.append(
      el('strong', '', info.label),
      el('span', '', report.summary || report.description),
      el('span', '', `Fiabilité estimée : ${report.confidence_percent}/100`),
      el('span', '', formatDate(report.observed_at || report.created_at)),
    );
    marker.bindPopup(popup).addTo(state.markerLayer);
  }
}

function renderReports() {
  const reports = visibleReports();
  elements.reportsList.replaceChildren(...reports.map(makeReportCard));
  elements.emptyState.hidden = reports.length !== 0;
  elements.reportCount.textContent = `${reports.length} signalement${reports.length === 1 ? '' : 's'}`;
  renderMap(reports);
}

async function loadReports() {
  if (!navigator.onLine) {
    setMessage('Mode hors ligne : les signalements affichés peuvent être incomplets.');
    return;
  }
  try {
    const response = await fetch('/api/reports', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Impossible de charger les signalements (${response.status})`);
    state.reports = await response.json();
    renderReports();
  } catch (error) {
    setMessage(error.message, true);
  }
}

async function submitConfirmation(reportId, vote) {
  const position = await requestPosition();
  const payload = { user_id: userId(), vote };
  if (position) Object.assign(payload, position);
  const route = vote === 'resolved' ? `/api/reports/${reportId}/resolve` : `/api/reports/${reportId}/confirm`;
  try {
    const response = await fetch(route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.detail || 'Confirmation non enregistrée.');
    setMessage(position ? 'Confirmation enregistrée ; la proximité a été évaluée.' : 'Confirmation distante enregistrée.');
    await loadReports();
  } catch (error) {
    setMessage(error.message, true);
  }
}

elements.locateButton.addEventListener('click', async () => {
  elements.locationLabel.textContent = 'Recherche de la position…';
  const position = await requestPosition();
  if (!position) {
    elements.locationLabel.textContent = 'Position indisponible. Une épingle peut être placée sur la carte.';
    setMessage('Autorisez la géolocalisation ou placez une épingle sur la carte.', true);
    return;
  }
  state.location = position;
  elements.locationLabel.textContent = `Position capturée · précision ±${Math.round(position.accuracy_m)} m.`;
  setMessage('Position prête pour le signalement.');
  if (state.map) state.map.setView([position.latitude, position.longitude], 15);
});

elements.photo.addEventListener('change', () => {
  const file = elements.photo.files?.[0];
  if (state.photoUrl) URL.revokeObjectURL(state.photoUrl);
  state.photoUrl = null;
  elements.photoPreview.replaceChildren();
  elements.photoPreview.hidden = !file;
  if (!file) return;
  state.photoUrl = URL.createObjectURL(file);
  const image = document.createElement('img');
  image.src = state.photoUrl;
  image.alt = 'Aperçu de la pièce jointe';
  elements.photoPreview.append(image, el('span', '', file.name));
});

elements.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!elements.form.reportValidity()) return;
  const item = {
    client_id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
    description: elements.description.value.trim(),
    category_override: elements.category.value,
    reporter_id: userId(),
    observed_at: new Date().toISOString(),
    latitude: state.location?.latitude,
    longitude: state.location?.longitude,
    location_accuracy_m: state.location?.accuracy_m,
    photo: elements.photo.files?.[0] || null,
  };
  elements.submitButton.disabled = true;
  elements.submitButton.firstChild.textContent = 'Envoi en cours… ';
  try {
    if (!navigator.onLine) throw new TypeError('Connexion indisponible');
    const report = await sendReport(item);
    setMessage(`Signalement publié · ${categoryInfo(report.category).label} · fiabilité ${report.confidence_percent}/100.`);
    elements.form.reset();
    state.location = null;
    elements.locationLabel.textContent = 'Utiliser le GPS ou placer une épingle sur la carte.';
    elements.photoPreview.hidden = true;
    elements.photoPreview.replaceChildren();
    renderSingleUpdate(report);
    await loadReports();
  } catch (error) {
    if (error instanceof TypeError || !navigator.onLine) {
      try {
        await saveQueuedReport(item);
        setMessage('Connexion indisponible : le signalement est conservé sur cet appareil et attendra la synchronisation.');
        elements.form.reset();
        state.location = null;
        elements.locationLabel.textContent = 'Utiliser le GPS ou placer une épingle sur la carte.';
        elements.photoPreview.hidden = true;
        elements.photoPreview.replaceChildren();
        await refreshQueueCount();
      } catch (queueError) {
        setMessage(`Envoi impossible et conservation hors ligne indisponible : ${queueError.message}`, true);
      }
    } else {
      setMessage(error.message, true);
    }
  } finally {
    elements.submitButton.disabled = false;
    elements.submitButton.firstChild.textContent = 'Envoyer le signalement ';
  }
});

function renderSingleUpdate(report) {
  const info = categoryInfo(report.category);
  setMessage(`Signalement créé : ${info.label}. ${report.summary}`);
}

document.querySelectorAll('.filter-chip').forEach((button) => {
  button.addEventListener('click', () => {
    state.filter = button.dataset.filter;
    document.querySelectorAll('.filter-chip').forEach((chip) => chip.classList.toggle('is-active', chip === button));
    renderReports();
  });
});

elements.refreshButton.addEventListener('click', loadReports);
window.addEventListener('online', () => { setNetworkState(); flushQueue(); loadReports(); });
window.addEventListener('offline', setNetworkState);

setNetworkState();
initMap();
loadReports();
refreshQueueCount();
flushQueue();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {
      // The online interface remains usable if the browser blocks service workers.
    });
  });
}
