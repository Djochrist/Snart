/* Fiche d'un signalement : tout vient de l'API, y compris le résultat d'un vote. */
import { fetchReport, photoUrl, sendVote } from '../api.js';
import { button, el, link } from '../dom.js';
import {
  categoryInfo, factorLines, formatDate, formatRelative, isDemo, reportTime, structuringNote,
} from '../format.js';
import { positionFailureMessage, requestPosition } from '../geo.js';
import { reporterId } from '../identity.js';
import { categoryTag, demoPill, retryBlock, statusPill } from './report-card.js';

function metaRow(list, term, value) {
  list.append(el('dt', '', term), el('dd', '', value));
}

function photoBlock(report) {
  const block = el('div', 'detail-photo');
  if (!report.has_photo) {
    block.append(el('p', 'detail-hint', 'Pas de photo pour ce signalement.'));
    return block;
  }
  const show = button('Afficher la photo', 'secondary-button', () => {
    show.disabled = true;
    show.lastChild.textContent = 'Chargement de la photo…';
    const image = el('img');
    image.alt = `Photo jointe au signalement : ${categoryInfo(report.category).label}`;
    image.addEventListener('load', () => block.replaceChildren(image));
    image.addEventListener('error', () => {
      show.disabled = false;
      show.lastChild.textContent = 'Réessayer d’afficher la photo';
    }, { once: true });
    image.src = photoUrl(report.id);
  }, 'i-image');
  block.append(show);
  return block;
}

function indexBlock(report) {
  const block = el('section', 'index-block');
  block.setAttribute('aria-labelledby', 'indexTitle');
  const title = el('h2', '', 'Indice de corroboration');
  title.id = 'indexTitle';
  const score = el('p', 'index-score');
  score.append(el('strong', '', String(report.confidence_percent)), el('span', '', '/100'));
  const factors = el('ul', 'factor-list');
  factors.append(...factorLines(report).map((line) => el('li', '', line)));
  block.append(
    title,
    score,
    factors,
    el('p', 'detail-hint', 'Cet indice est une estimation communautaire, pas une certification officielle.'),
  );
  return block;
}

function voteMessage(vote, sentWithPosition) {
  const base = vote === 'resolved' ? 'Ta proposition de résolution est enregistrée.' : 'Ta confirmation est enregistrée.';
  const where = sentWithPosition
    ? 'Le serveur a comparé ta position à celle du problème.'
    : 'Sans position, elle compte comme un avis à distance.';
  return `${base} ${where} Si tu avais déjà voté, ton choix a été mis à jour.`;
}

export function createDetailView({ reports }) {
  const root = document.querySelector('#detailContent');
  let requestToken = 0;

  function voteBlock(report) {
    const block = el('section', 'vote-block');
    block.setAttribute('aria-labelledby', 'voteTitle');
    const title = el('h2', '', 'Ce problème est-il encore là ?');
    title.id = 'voteTitle';
    const message = el('p', 'form-message');
    message.setAttribute('role', 'status');
    const fallback = el('div', 'vote-fallback');
    fallback.hidden = true;

    const buttons = [];
    let busy = false;
    function setBusy(value) {
      busy = value;
      buttons.forEach((node) => { node.disabled = value; });
    }

    async function submit(vote, position) {
      const payload = { user_id: reporterId() };
      if (position) {
        payload.latitude = position.latitude;
        payload.longitude = position.longitude;
        payload.accuracy_m = position.accuracy_m;
      }
      message.classList.remove('is-error');
      message.textContent = 'Envoi de ton vote…';
      try {
        const updated = await sendVote(report.id, vote, payload);
        reports.invalidate();
        render(updated).querySelector('.vote-block .form-message').textContent = voteMessage(vote, Boolean(position));
      } catch (error) {
        message.textContent = error.message;
        message.classList.add('is-error');
        setBusy(false);
      }
    }

    function offerWithoutPosition(vote, reason) {
      message.textContent = `${positionFailureMessage(reason)} Tu peux envoyer ton vote sans position : il comptera comme un avis à distance.`;
      fallback.replaceChildren(
        button('Envoyer sans position', 'secondary-button', () => {
          if (busy) return;
          setBusy(true);
          fallback.hidden = true;
          submit(vote, null);
        }),
        button('Annuler', 'text-button', () => {
          fallback.hidden = true;
          message.textContent = '';
        }),
      );
      fallback.hidden = false;
    }

    async function start(vote) {
      if (busy) return;
      setBusy(true);
      fallback.hidden = true;
      message.classList.remove('is-error');
      message.textContent = 'Recherche de ta position…';
      const position = await requestPosition();
      if (position.ok) {
        await submit(vote, position);
        return;
      }
      setBusy(false);
      offerWithoutPosition(vote, position.reason);
    }

    const confirm = button('Toujours présent', 'primary-button', () => start('still_present'), 'i-people');
    const resolve = button('Proposer la résolution', 'secondary-button', () => start('resolved'), 'i-check');
    buttons.push(confirm, resolve);
    const actions = el('div', 'vote-actions');
    actions.append(confirm, resolve);

    block.append(
      title,
      el('p', 'detail-hint', 'Ta position est demandée une seule fois pour ce vote. Elle sert à mesurer la distance et n’est pas publiée.'),
      actions,
      fallback,
      message,
      el('p', 'detail-hint', 'Une résolution reste une observation citoyenne, pas une décision officielle : d’autres personnes doivent la corroborer.'),
    );
    return block;
  }

  function placeBlock(report) {
    const place = el('section', 'detail-section');
    place.append(el('h2', '', 'Position du problème'));
    if (!Number.isFinite(report.latitude) || !Number.isFinite(report.longitude)) {
      place.append(el('p', '', 'Ce signalement a été envoyé sans position.'));
      return place;
    }
    const accuracy = Number.isFinite(report.location_accuracy_m)
      ? ` · précision annoncée ±${Math.round(report.location_accuracy_m)} m`
      : '';
    place.append(
      el('p', '', `${report.latitude.toFixed(5)}, ${report.longitude.toFixed(5)}${accuracy}`),
      link('Voir sur la carte', 'secondary-button', `#/carte/${report.id}`, 'i-map'),
    );
    return place;
  }

  function notesFor(report) {
    const notes = [];
    if (report.status === 'stale') {
      notes.push(el('p', 'callout is-warning', 'Cette observation est ancienne : elle ne décrit peut-être plus la situation actuelle. Si le problème est toujours là, confirme-le.'));
    }
    if (report.status === 'resolved') {
      notes.push(el('p', 'callout', 'Des personnes proches du lieu ont indiqué que ce problème est résolu. Ce n’est pas une confirmation officielle.'));
    }
    if (report.needs_review) {
      notes.push(el('p', 'callout is-warning', 'Catégorie à vérifier : la description est ambiguë.'));
    }
    return notes;
  }

  function render(report) {
    const page = el('article', 'detail');

    const tags = el('div', 'detail-tags');
    tags.append(categoryTag(report.category), statusPill(report.status));
    if (isDemo(report)) tags.append(demoPill());

    const heading = el('h1', 'detail-title', report.summary || 'Signalement');
    heading.tabIndex = -1;

    const meta = el('dl', 'detail-meta');
    metaRow(meta, 'Observé', `${formatDate(reportTime(report))} (${formatRelative(reportTime(report))})`);
    metaRow(meta, 'Publié', formatDate(report.created_at));
    metaRow(meta, 'Dernière confirmation', report.last_confirmed_at ? formatDate(report.last_confirmed_at) : 'Aucune pour le moment');

    const description = el('section', 'detail-section');
    description.append(el('h2', '', 'Description d’origine'), el('p', 'detail-description', report.description));

    page.append(
      tags,
      heading,
      ...notesFor(report),
      meta,
      description,
      photoBlock(report),
      placeBlock(report),
      indexBlock(report),
      voteBlock(report),
      el('p', 'detail-hint', structuringNote(report)),
    );
    root.replaceChildren(page);
    return page;
  }

  async function load(id) {
    const token = ++requestToken;
    root.replaceChildren(el('p', 'state-block', 'Chargement du signalement…'));
    try {
      const report = await fetchReport(id);
      if (token === requestToken) render(report).querySelector('h1').focus({ preventScroll: true });
    } catch (error) {
      if (token !== requestToken) return;
      if (error.kind === 'not_found') {
        root.replaceChildren(el('p', 'state-block', error.message), link('Retour à la liste', 'secondary-button', '#/liste'));
      } else {
        root.replaceChildren(retryBlock(error.message, () => load(id)));
      }
    }
  }

  return { enter: (route) => load(route.id) };
}
