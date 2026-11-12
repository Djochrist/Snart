/* Navigation par hash : aucun réglage serveur requis, même dans un sous-répertoire cPanel. */
const STATIC_ROUTES = {
  '': 'home',
  carte: 'map',
  liste: 'list',
  signaler: 'report',
  attente: 'pending',
};

export function parseRoute(hash) {
  const path = hash.replace(/^#\/?/, '').replace(/\/$/, '');
  if (path in STATIC_ROUTES) return { name: STATIC_ROUTES[path] };
  const match = path.match(/^(signalement|carte)\/(\d+)$/);
  if (match) return { name: match[1] === 'carte' ? 'map' : 'detail', id: Number(match[2]) };
  return { name: 'notfound' };
}

export function onRouteChange(listener) {
  const run = () => {
    // Les ancres sans « #/ » ne sont pas des routes.
    if (location.hash && !location.hash.startsWith('#/')) return;
    listener(parseRoute(location.hash));
  };
  window.addEventListener('hashchange', run);
  run();
}
