/* Signalements chargés, une entrée par filtre : une réponse tardive n'écrit que dans sa propre entrée. */
export function createReportStore(fetchReports, { ttlMs = 30000, now = Date.now } = {}) {
  const entries = new Map();
  const listeners = new Set();
  let filter = 'all';

  function entry(key) {
    if (!entries.has(key)) {
      entries.set(key, { items: [], status: 'idle', error: null, loadedAt: 0, controller: null });
    }
    return entries.get(key);
  }

  function notify() {
    listeners.forEach((listener) => listener());
  }

  async function load(key, { force = false } = {}) {
    const current = entry(key);
    const isFresh = current.status === 'ready' && now() - current.loadedAt < ttlMs;
    if (!force && (isFresh || current.controller)) return;

    current.controller?.abort();
    const controller = new AbortController();
    current.controller = controller;
    current.status = 'loading';
    current.error = null;
    notify();

    try {
      const items = await fetchReports(key === 'all' ? null : key, controller.signal);
      if (current.controller !== controller) return;
      Object.assign(current, { items, status: 'ready', loadedAt: now(), controller: null });
    } catch (error) {
      if (current.controller !== controller) return;
      Object.assign(current, { status: 'error', error, controller: null });
    }
    notify();
  }

  return {
    get filter() {
      return filter;
    },
    get: entry,
    load,
    subscribe(listener) {
      listeners.add(listener);
    },
    setFilter(key) {
      if (key === filter) return;
      if (filter !== 'all') {
        const previous = entry(filter);
        previous.controller?.abort();
        previous.controller = null;
        if (previous.status === 'loading') previous.status = 'idle';
      }
      filter = key;
      notify();
      load(key);
    },
    /* Après une création ou un vote, les listes en mémoire ne sont plus à jour. */
    invalidate() {
      entries.forEach((current) => {
        current.loadedAt = 0;
      });
    },
  };
}
