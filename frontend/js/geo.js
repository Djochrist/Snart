/* Position ponctuelle, demandée seulement après un geste de la personne. Jamais de suivi continu. */
const GEO_OPTIONS = { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 };

const MESSAGES = {
  denied: 'Tu as refusé l’accès à la position.',
  unavailable: 'Ton téléphone n’a pas trouvé ta position.',
  timeout: 'La recherche de position a pris trop de temps.',
  unsupported: 'Ce navigateur ne donne pas accès à la position.',
};

export function requestPosition(geolocation = globalThis.navigator?.geolocation) {
  if (!geolocation) return Promise.resolve({ ok: false, reason: 'unsupported' });
  return new Promise((resolve) => {
    geolocation.getCurrentPosition(
      (position) => resolve({
        ok: true,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy_m: position.coords.accuracy,
      }),
      (error) => {
        const reasons = { 1: 'denied', 2: 'unavailable', 3: 'timeout' };
        resolve({ ok: false, reason: reasons[error?.code] || 'unavailable' });
      },
      GEO_OPTIONS,
    );
  });
}

export function positionFailureMessage(reason) {
  return MESSAGES[reason] || MESSAGES.unavailable;
}
