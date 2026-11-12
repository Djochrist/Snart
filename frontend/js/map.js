/* Carte Leaflet chargée à la demande : les écrans sans carte ne paient ni le script ni les tuiles. */
import { CONFIG } from '../config.js';
import { el, icon } from './dom.js';
import {
  categoryInfo, formatRelative, indexLabel, plural, reportTime, statusLabel,
} from './format.js';

const LEAFLET_URL = 'https://unpkg.com/leaflet@1.9.4/dist';
const LEAFLET_JS_HASH = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
const LEAFLET_CSS_HASH = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
const LOAD_TIMEOUT_MS = 15000;
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

let leafletPromise = null;

function appendAsset(tag, attributes) {
  return new Promise((resolve, reject) => {
    const node = document.createElement(tag);
    Object.assign(node, attributes);
    node.crossOrigin = '';
    node.addEventListener('load', resolve, { once: true });
    node.addEventListener('error', reject, { once: true });
    document.head.append(node);
  });
}

export function loadLeaflet() {
  if (globalThis.L) return Promise.resolve(globalThis.L);
  leafletPromise ??= Promise.race([
    Promise.all([
      appendAsset('link', { rel: 'stylesheet', href: `${LEAFLET_URL}/leaflet.css`, integrity: LEAFLET_CSS_HASH }),
      appendAsset('script', { src: `${LEAFLET_URL}/leaflet.js`, integrity: LEAFLET_JS_HASH }),
    ]),
    new Promise((resolve, reject) => {
      setTimeout(() => reject(new Error('Leaflet trop long à charger')), LOAD_TIMEOUT_MS);
    }),
  ]).then(() => globalThis.L).catch((error) => {
    leafletPromise = null;
    throw error;
  });
  return leafletPromise;
}

function createBaseMap(container, options = {}) {
  const map = L.map(container, { scrollWheelZoom: false, ...options }).setView(CONFIG.mapCenter, CONFIG.mapZoom);
  L.tileLayer(TILE_URL, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map);
  return map;
}

/* Une grille d'environ 10 m : au-delà, deux marqueurs restent accessibles séparément. */
export function groupByLocation(reports) {
  const groups = new Map();
  for (const report of reports) {
    if (!Number.isFinite(report.latitude) || !Number.isFinite(report.longitude)) continue;
    const key = `${report.latitude.toFixed(4)},${report.longitude.toFixed(4)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(report);
  }
  return [...groups.values()];
}

function markerElement(group) {
  const [first] = group;
  const info = categoryInfo(first.category);
  const dot = el('span', `marker-dot ${info.css} is-${first.status}`);
  dot.append(icon(info.icon, 'bubble'));
  if (group.length > 1) dot.append(el('span', 'marker-badge', String(group.length)));
  else if (first.status === 'resolved') dot.append(el('span', 'marker-badge', '✓'));
  else if (first.status === 'stale') dot.append(el('span', 'marker-badge', '!'));
  return dot;
}

function markerLabel(group) {
  if (group.length > 1) return `${plural(group.length, 'signalement')} à cet endroit`;
  const [report] = group;
  return `${categoryInfo(report.category).label}, ${statusLabel(report.status)}, indice ${report.confidence_percent} sur 100`;
}

function popupEntry(report) {
  const entry = el('div', 'map-popup-entry');
  const detail = el('a', 'map-popup-link', 'Voir la fiche');
  detail.href = `#/signalement/${report.id}`;
  entry.append(
    el('strong', '', `${categoryInfo(report.category).label} · ${statusLabel(report.status)}`),
    el('span', '', report.summary || report.description),
    el('span', 'map-popup-meta', formatRelative(reportTime(report))),
    el('span', 'map-popup-meta', indexLabel(report)),
    detail,
  );
  return entry;
}

function popupContent(group) {
  const popup = el('div', 'map-popup');
  if (group.length > 1) popup.append(el('p', 'map-popup-title', `${plural(group.length, 'signalement')} à cet endroit`));
  popup.append(...group.map(popupEntry));
  return popup;
}

export function createReportsMap(container, { onTilesFailed }) {
  const map = createBaseMap(container);
  const layer = L.layerGroup().addTo(map);
  const markers = new Map();
  let tileErrors = 0;

  map.on('tileerror', () => {
    tileErrors += 1;
    if (tileErrors === 6) onTilesFailed();
  });

  return {
    render(reports) {
      layer.clearLayers();
      markers.clear();
      for (const group of groupByLocation(reports)) {
        const [first] = group;
        const label = markerLabel(group);
        const marker = L.marker([first.latitude, first.longitude], {
          title: label,
          riseOnHover: true,
          icon: L.divIcon({
            className: 'report-marker',
            html: markerElement(group),
            iconSize: [38, 38],
            // La pointe de la bulle, en bas à droite, tombe sur le lieu exact.
            iconAnchor: [38, 38],
            popupAnchor: [-19, -38],
          }),
        });
        marker.bindPopup(popupContent(group), { maxWidth: 280, maxHeight: 300 });
        marker.addTo(layer);
        marker.getElement()?.setAttribute('aria-label', label);
        group.forEach((report) => markers.set(report.id, marker));
      }
    },
    focus(id) {
      const marker = markers.get(id);
      if (!marker) return false;
      map.setView(marker.getLatLng(), Math.max(map.getZoom(), 16));
      marker.openPopup();
      return true;
    },
    resize() {
      map.invalidateSize();
    },
  };
}

function pinIcon() {
  const dot = el('span', 'marker-pin');
  dot.append(icon('i-pin'));
  return L.divIcon({ className: 'report-marker', html: dot, iconSize: [42, 42], iconAnchor: [39, 39] });
}

/* Épingle du formulaire : elle situe le problème, pas la personne. */
export function createPinPicker(container, { onChange }) {
  const map = createBaseMap(container);
  let pin = null;

  function place(latlng, { silent = false } = {}) {
    if (pin) {
      pin.setLatLng(latlng);
    } else {
      pin = L.marker(latlng, { draggable: true, title: 'Emplacement du problème', icon: pinIcon() }).addTo(map);
      pin.getElement()?.setAttribute('aria-label', 'Emplacement du problème');
      pin.on('dragend', () => onChange(pin.getLatLng()));
    }
    if (!silent) onChange(L.latLng(latlng));
  }

  map.on('click', (event) => place(event.latlng));

  return {
    placeAtCenter() {
      place(map.getCenter());
    },
    show(latitude, longitude) {
      place([latitude, longitude], { silent: true });
      map.setView([latitude, longitude], Math.max(map.getZoom(), 16));
    },
    clear() {
      pin?.remove();
      pin = null;
    },
    resize() {
      map.invalidateSize();
    },
  };
}
