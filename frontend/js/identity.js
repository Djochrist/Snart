/* Pseudonyme local : sert à dédupliquer les votes du prototype, pas à identifier une personne. */
const STORAGE_KEY = 'snart-anonymous-id';
let sessionId = null;

function generateId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return `anon-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function reporterId(storage = globalThis.localStorage) {
  try {
    let id = storage.getItem(STORAGE_KEY);
    if (!id) {
      id = generateId();
      storage.setItem(STORAGE_KEY, id);
    }
    return id;
  } catch {
    // Stockage bloqué : le pseudonyme ne vit que le temps de la page.
    sessionId ??= generateId();
    return sessionId;
  }
}
