/* Réglages de déploiement. Ce fichier est public : n'y mets jamais de clé ni de secret. */
export const CONFIG = {
  // Vide : l'API est servie par la même origine que la PWA.
  // Sinon, adresse HTTPS de l'API sans barre finale, par exemple 'https://api.exemple.org'.
  apiBaseUrl: '',
  requestTimeoutMs: 20000,
  uploadTimeoutMs: 60000,
  mapCenter: [-11.66, 27.48],
  mapZoom: 13,
};
