/* Éléments partagés par l'accueil, la liste, la carte et la fiche. */
import { el, icon } from '../dom.js';
import {
  CATEGORIES, categoryInfo, formatRelative, indexLevel, isDemo, reportTime, statusLabel,
} from '../format.js';

export function categoryTag(category) {
  const info = categoryInfo(category);
  const tag = el('span', `category-tag ${info.css}`);
  tag.append(icon(info.icon, 'bubble'), el('span', '', info.label));
  return tag;
}

export function statusPill(status) {
  return el('span', `status-pill is-${status}`, statusLabel(status));
}

/* Le score reste écrit en toutes lettres : les bulles n'en sont que le dessin. */
export function indexBubbles(report) {
  return icon(`indice-${indexLevel(report.confidence_percent)}`, 'indice');
}

export function demoPill() {
  return el('span', 'status-pill is-demo', 'Donnée de démonstration');
}

export function reportCard(report, headingTag = 'h3') {
  const card = el('article', 'report-card');
  const heading = el('div', 'report-card-top');
  heading.append(categoryTag(report.category), statusPill(report.status));

  const title = el(headingTag, 'report-summary');
  const target = el('a', '', report.summary || report.description || 'Description indisponible.');
  target.href = `#/signalement/${report.id}`;
  title.append(target);

  const meta = el('p', 'report-meta');
  const time = el('time', '', formatRelative(reportTime(report)));
  time.dateTime = reportTime(report);
  meta.append(el('span', '', `Fiabilité estimée ${report.confidence_percent}/100`), time);
  if (report.has_photo) {
    const photo = el('span', 'report-photo-flag');
    photo.append(icon('i-image'), el('span', '', 'Photo'));
    meta.append(photo);
  }

  const footer = el('div', 'report-footer');
  footer.append(meta, indexBubbles(report));

  card.append(heading, title, footer);
  if (report.needs_review) card.append(el('p', 'report-note', 'Catégorie à vérifier'));
  if (isDemo(report)) card.append(demoPill());
  return card;
}

const FILTERS = [
  ['all', 'Toutes les catégories', null],
  ...Object.entries(CATEGORIES).map(([code, info]) => [code, info.label, info.icon]),
];

/* Filtres de catégorie, identiques sur la carte et la liste. */
export function filterBar(reports) {
  const bar = el('div', 'filters');
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Filtrer par catégorie');
  const buttons = FILTERS.map(([code, label, iconId]) => {
    const chip = el('button', 'filter-chip');
    chip.type = 'button';
    chip.dataset.filter = code;
    if (iconId) {
      chip.classList.add(categoryInfo(code).css);
      chip.append(icon(iconId, 'bubble'));
    }
    chip.append(el('span', '', label));
    chip.addEventListener('click', () => reports.setFilter(code));
    return chip;
  });
  bar.append(...buttons);

  const sync = () => buttons.forEach((chip) => {
    chip.setAttribute('aria-pressed', String(chip.dataset.filter === reports.filter));
  });
  reports.subscribe(sync);
  sync();
  return bar;
}

export function retryBlock(message, onRetry) {
  const block = el('div', 'state-block is-error');
  block.setAttribute('role', 'alert');
  block.append(el('p', '', message));
  const retry = el('button', 'secondary-button', 'Réessayer');
  retry.type = 'button';
  retry.addEventListener('click', onRetry);
  block.append(retry);
  return block;
}
