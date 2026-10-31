/* Accueil : uniquement des chiffres reçus de l'API, jamais de compteur inventé. */
import { el, icon } from '../dom.js';
import { CATEGORIES, plural } from '../format.js';
import { reportCard, retryBlock } from './report-card.js';

const RECENT_COUNT = 3;

function categoryCounts(items) {
  const list = el('ul', 'category-counts');
  for (const [code, info] of Object.entries(CATEGORIES)) {
    const total = items.filter((report) => report.category === code).length;
    if (code === 'indetermine' && total === 0) continue;
    const row = el('li', `category-count ${info.css}`);
    row.append(icon(info.icon, 'bubble'), el('span', 'category-count-label', info.label), el('strong', '', String(total)));
    list.append(row);
  }
  return list;
}

export function createHomeView({ reports }) {
  const live = document.querySelector('#homeLive');
  const recent = document.querySelector('#homeRecent');

  function render() {
    const { items, status, error } = reports.get('all');
    if (status === 'error') {
      recent.hidden = true;
      live.replaceChildren(retryBlock(error.message, () => reports.load('all', { force: true })));
      return;
    }
    if (status !== 'ready' && items.length === 0) {
      recent.hidden = true;
      live.replaceChildren(el('p', 'state-block', 'Chargement des signalements…'));
      return;
    }
    if (items.length === 0) {
      recent.hidden = true;
      live.replaceChildren(el('p', 'state-block', 'Aucun signalement pour le moment. Le tien peut être le premier.'));
      return;
    }
    live.replaceChildren(
      el('p', 'home-total', `${plural(items.length, 'signalement chargé', 'signalements chargés')} depuis le serveur`),
      categoryCounts(items),
    );
    recent.hidden = false;
    recent.querySelector('.reports-list').replaceChildren(...items.slice(0, RECENT_COUNT).map((report) => reportCard(report)));
  }

  reports.subscribe(render);
  return {
    enter() {
      render();
      reports.load('all');
    },
  };
}
