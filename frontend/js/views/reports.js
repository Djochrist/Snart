/* Carte et liste : mêmes données, même filtre, envoyé à l'API. */
import { el } from '../dom.js';
import { plural } from '../format.js';
import { createReportsMap, loadLeaflet } from '../map.js';
import { filterBar, reportCard, retryBlock } from './report-card.js';

function renderInto(container, reports) {
  const current = reports.get(reports.filter);
  const blocks = [];
  if (current.status === 'error') {
    blocks.push(retryBlock(current.error.message, () => reports.load(reports.filter, { force: true })));
  }
  if (current.status === 'loading' || current.status === 'idle') {
    blocks.push(el('p', 'state-block', 'Chargement des signalements…'));
  } else if (current.items.length > 0) {
    const list = el('div', 'reports-list');
    list.append(...current.items.map((report) => reportCard(report, 'h2')));
    blocks.push(list);
  } else if (current.status === 'ready') {
    const empty = el('div', 'state-block');
    const action = el('a', 'secondary-button', 'Créer un signalement');
    action.href = '#/signaler';
    empty.append(el('p', '', 'Aucun signalement ne correspond à ce filtre.'), action);
    blocks.push(empty);
  }
  container.replaceChildren(...blocks);
}

function countLabel(reports) {
  const current = reports.get(reports.filter);
  if (current.status === 'loading' || current.status === 'idle') return 'Chargement…';
  if (current.status === 'error' && current.items.length === 0) return 'Liste indisponible';
  return plural(current.items.length, 'signalement');
}

export function createListView({ reports }) {
  const results = document.querySelector('#listResults');
  const count = document.querySelector('#listCount');
  document.querySelector('#listFilters').append(filterBar(reports));
  document.querySelector('#listRefresh').addEventListener('click', () => {
    reports.load(reports.filter, { force: true });
  });

  let active = false;

  function render() {
    if (!active) return;
    renderInto(results, reports);
    count.textContent = countLabel(reports);
  }

  reports.subscribe(render);

  return {
    enter() {
      active = true;
      render();
      reports.load(reports.filter);
    },
    leave() {
      active = false;
    },
  };
}

function missingPositionText(count) {
  return count === 1
    ? '1 signalement sans position n’apparaît pas sur la carte.'
    : `${count} signalements sans position n’apparaissent pas sur la carte.`;
}

export function createMapView({ reports }) {
  const container = document.querySelector('#map');
  const fallback = document.querySelector('#mapFallback');
  const notice = document.querySelector('#mapNotice');
  const side = document.querySelector('#mapSide');
  document.querySelector('#mapFilters').append(filterBar(reports));

  let map = null;
  let starting = false;
  let active = false;
  let pendingFocus = null;

  function render() {
    if (!active) return;
    const { items } = reports.get(reports.filter);
    renderInto(side, reports);
    const missing = items.filter((report) => !Number.isFinite(report.latitude)).length;
    notice.hidden = missing === 0;
    notice.textContent = missingPositionText(missing);
    if (!map) return;
    map.render(items);
    if (pendingFocus !== null && map.focus(pendingFocus)) pendingFocus = null;
  }

  async function start() {
    if (map || starting) return;
    starting = true;
    container.hidden = false;
    fallback.hidden = true;
    try {
      await loadLeaflet();
      map = createReportsMap(container, {
        onTilesFailed: () => {
          notice.hidden = false;
          notice.textContent = 'Le fond de carte ne se charge pas. La liste reste utilisable.';
        },
      });
      render();
    } catch {
      container.hidden = true;
      fallback.hidden = false;
    } finally {
      starting = false;
    }
  }

  document.querySelector('#mapRetry').addEventListener('click', start);
  reports.subscribe(render);

  return {
    enter(route) {
      active = true;
      pendingFocus = route.id ?? null;
      // Le signalement demandé peut être masqué par le filtre en cours.
      if (pendingFocus !== null) reports.setFilter('all');
      start();
      map?.resize();
      render();
      reports.load(reports.filter);
    },
    leave() {
      active = false;
    },
  };
}
