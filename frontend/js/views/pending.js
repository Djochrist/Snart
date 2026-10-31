/* Signalements gardés sur l'appareil : jamais présentés comme publiés. */
import { button, el, notify } from '../dom.js';
import { categoryInfo, formatDate, plural } from '../format.js';
import { indexedDbQueue, SYNC_STATES } from '../queue.js';

export function createPendingView({ onSyncRequested, onEdit, onQueueChanged }) {
  const root = document.querySelector('#pendingContent');
  let active = false;

  function itemCard(item) {
    const rejected = item.sync_state === SYNC_STATES.rejected;
    const card = el('article', `pending-card${rejected ? ' is-rejected' : ''}`);
    const category = item.category_override && item.category_override !== 'auto'
      ? categoryInfo(item.category_override).label
      : 'Catégorie proposée à l’envoi';
    card.append(
      el('p', 'pending-state', rejected ? 'Refusé par le serveur, à corriger' : 'En attente d’envoi, pas encore publié'),
      el('p', 'pending-description', item.description),
      el('p', 'detail-hint', `${category} · gardé le ${formatDate(item.queued_at)}${item.photo ? ' · photo jointe' : ''}`),
    );
    if (rejected && item.last_error) card.append(el('p', 'field-error', item.last_error));
    if (item.category_override === 'embouteillage') {
      card.append(el('p', 'detail-hint', 'Un embouteillage vieillit vite : s’il part en retard, il devra être reconfirmé avant d’être considéré comme actuel.'));
    }
    const actions = el('div', 'result-actions');
    if (rejected) actions.append(button('Corriger', 'secondary-button', () => onEdit(item)));
    actions.append(button('Supprimer', 'text-button', async () => {
      if (!globalThis.confirm('Supprimer ce signalement de ce téléphone ? Il ne sera pas envoyé.')) return;
      await indexedDbQueue.remove(item.client_id);
      await onQueueChanged();
      notify('Signalement supprimé de ce téléphone.');
    }));
    card.append(actions);
    return card;
  }

  async function render() {
    if (!active) return;
    let items;
    try {
      items = await indexedDbQueue.list();
    } catch {
      root.replaceChildren(el('p', 'state-block', 'Ce navigateur ne permet pas de garder des signalements hors ligne.'));
      return;
    }
    if (items.length === 0) {
      root.replaceChildren(el('p', 'state-block', 'Rien en attente : tous tes signalements sont partis.'));
      return;
    }
    const waiting = items.filter((item) => item.sync_state !== SYNC_STATES.rejected).length;
    const blocks = [el('p', 'pending-intro', `${plural(items.length, 'signalement')} sur ce téléphone, envoyés dès que le serveur est joignable.`)];
    if (waiting > 0) blocks.push(button('Envoyer maintenant', 'primary-button', onSyncRequested, 'i-refresh'));
    blocks.push(...items.map(itemCard));
    root.replaceChildren(...blocks);
  }

  return {
    render,
    enter() {
      active = true;
      return render();
    },
    leave() {
      active = false;
    },
  };
}
