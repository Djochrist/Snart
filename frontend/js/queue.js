/* File hors ligne : un signalement n'y est retiré qu'après la réponse positive du serveur. */
const DB_NAME = 'snart-offline-queue';
const STORE_NAME = 'reports';

export const SYNC_STATES = { pending: 'pending', rejected: 'rejected' };

function openDatabase() {
  if (!('indexedDB' in globalThis)) return Promise.reject(new Error('IndexedDB indisponible'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'client_id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('File hors ligne indisponible'));
  });
}

async function withStore(mode, operation) {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const result = operation(transaction.objectStore(STORE_NAME));
      transaction.oncomplete = () => resolve(result?.result);
      transaction.onerror = () => reject(transaction.error || new Error('Échec de la file hors ligne'));
      transaction.onabort = () => reject(transaction.error || new Error('Échec de la file hors ligne'));
    });
  } finally {
    database.close();
  }
}

export const indexedDbQueue = {
  async list() {
    const items = (await withStore('readonly', (store) => store.getAll())) || [];
    return items.sort((a, b) => String(a.queued_at).localeCompare(String(b.queued_at)));
  },
  get(clientId) {
    return withStore('readonly', (store) => store.get(clientId));
  },
  put(item) {
    return withStore('readwrite', (store) => store.put(item));
  },
  remove(clientId) {
    return withStore('readwrite', (store) => store.delete(clientId));
  },
};

export function newClientId() {
  return globalThis.crypto?.randomUUID?.() || `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/*
 * Envoie les éléments un par un.
 * Erreur passagère : on garde l'élément et on s'arrête, le prochain essai reprendra là.
 * Refus du serveur : on marque l'élément, il attend une correction, et on passe au suivant.
 */
export async function syncPending({ queue, send, isRetryable }) {
  const result = { sent: [], rejected: [], interrupted: false };
  for (const item of await queue.list()) {
    if (item.sync_state === SYNC_STATES.rejected) continue;
    try {
      const report = await send(item);
      await queue.remove(item.client_id);
      result.sent.push(report);
    } catch (error) {
      if (isRetryable(error)) {
        result.interrupted = true;
        break;
      }
      const rejected = { ...item, sync_state: SYNC_STATES.rejected, last_error: error.message };
      await queue.put(rejected);
      result.rejected.push(rejected);
    }
  }
  return result;
}

/* Une seule synchronisation à la fois, dans cet onglet et, si possible, entre onglets. */
export function createSyncRunner(run) {
  let running = null;

  async function exclusive() {
    if (!globalThis.navigator?.locks) return run();
    return navigator.locks.request('snart-sync', { ifAvailable: true }, (lock) => (lock ? run() : null));
  }

  return function sync() {
    if (running) return running;
    running = exclusive().finally(() => {
      running = null;
    });
    return running;
  };
}
