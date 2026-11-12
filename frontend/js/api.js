/* Unique point d'accès HTTP : base d'URL, délai, JSON, multipart et traduction des erreurs. */
import { CONFIG } from '../config.js';

export class ApiError extends Error {
  constructor(kind, message, status = null) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
  }
}

const NETWORK_MESSAGE = 'Pas de réseau. Réessaie dès qu’il revient.';
const TIMEOUT_MESSAGE = 'Le serveur met trop de temps à répondre. Réessaie dans un instant.';

const STATUS_ERRORS = {
  404: ['not_found', 'Ce signalement est introuvable.'],
  409: ['conflict', 'Tu as créé ce signalement : une autre personne doit le confirmer.'],
  413: ['too_large', 'La photo est trop volumineuse (8 Mo maximum).'],
  415: ['unsupported', 'Ce format d’image n’est pas accepté. Choisis une photo JPEG, PNG ou WebP.'],
};

/* FastAPI renvoie `detail` en texte pour nos règles et en tableau pour sa propre validation. */
function validationMessage(detail) {
  if (typeof detail === 'string' && detail.trim()) return detail;
  return 'Certaines informations ne sont pas valides. Vérifie le formulaire.';
}

export function errorFromResponse(status, body) {
  if (status === 400 || status === 422) {
    return new ApiError('validation', validationMessage(body?.detail), status);
  }
  if (STATUS_ERRORS[status]) {
    const [kind, message] = STATUS_ERRORS[status];
    return new ApiError(kind, message, status);
  }
  if (status >= 500) {
    return new ApiError('server', 'Le serveur rencontre un problème. Réessaie plus tard.', status);
  }
  return new ApiError('unknown', 'La demande n’a pas abouti. Réessaie.', status);
}

/* Erreurs passagères : l'action peut être rejouée telle quelle plus tard. */
export function isRetryable(error) {
  return error instanceof ApiError && ['network', 'timeout', 'server'].includes(error.kind);
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function request(path, { method = 'GET', json, formData, timeoutMs, signal } = {}) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs ?? CONFIG.requestTimeoutMs);
  const relayAbort = () => controller.abort();
  signal?.addEventListener('abort', relayAbort, { once: true });

  const options = { method, signal: controller.signal, headers: { Accept: 'application/json' } };
  if (json !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(json);
  } else if (formData) {
    options.body = formData;
  }

  try {
    const response = await fetch(`${CONFIG.apiBaseUrl}${path}`, options);
    if (!response.ok) throw errorFromResponse(response.status, await readJson(response));
    const body = await readJson(response);
    if (body === null) throw new ApiError('server', 'Réponse du serveur illisible. Réessaie.', response.status);
    return body;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (timedOut) throw new ApiError('timeout', TIMEOUT_MESSAGE);
    if (signal?.aborted) throw new ApiError('aborted', 'Demande annulée.');
    throw new ApiError('network', NETWORK_MESSAGE);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', relayAbort);
  }
}

export function fetchHealth() {
  return request('/api/health', { timeoutMs: 8000 });
}

export function fetchReports(category, signal) {
  const query = category ? `?category=${encodeURIComponent(category)}` : '';
  return request(`/api/reports${query}`, { signal });
}

export function fetchReport(id, signal) {
  return request(`/api/reports/${encodeURIComponent(id)}`, { signal });
}

export function photoUrl(id) {
  return `${CONFIG.apiBaseUrl}/api/reports/${encodeURIComponent(id)}/photo`;
}

/* `item` vient du formulaire ou de la file hors ligne. `client_id` évite un doublon si une réponse se perd. */
export function reportFormData(item) {
  const form = new FormData();
  form.append('description', item.description);
  form.append('reporter_id', item.reporter_id);
  form.append('category_override', item.category_override || 'auto');
  if (item.client_id) form.append('client_id', item.client_id);
  if (item.observed_at) form.append('observed_at', item.observed_at);
  if (Number.isFinite(item.latitude) && Number.isFinite(item.longitude)) {
    form.append('latitude', String(item.latitude));
    form.append('longitude', String(item.longitude));
    if (Number.isFinite(item.location_accuracy_m)) {
      form.append('location_accuracy_m', String(item.location_accuracy_m));
    }
  }
  if (item.photo) form.append('photo', item.photo, item.photo_name || item.photo.name || 'snart-image');
  return form;
}

export function createReport(item) {
  return request('/api/reports', {
    method: 'POST',
    formData: reportFormData(item),
    timeoutMs: CONFIG.uploadTimeoutMs,
  });
}

export function sendVote(id, vote, payload) {
  const route = vote === 'resolved' ? 'resolve' : 'confirm';
  return request(`/api/reports/${encodeURIComponent(id)}/${route}`, {
    method: 'POST',
    json: { ...payload, vote },
  });
}
