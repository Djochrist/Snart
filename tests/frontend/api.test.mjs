import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import {
  ApiError, createReport, errorFromResponse, fetchReports, isRetryable, reportFormData, request, sendVote,
} from '../../frontend/js/api.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function stubFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return handler(url, options);
  };
  return calls;
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

test('une erreur 422 de FastAPI ne produit jamais [object Object]', () => {
  const error = errorFromResponse(422, { detail: [{ msg: 'String should have at least 8 characters' }] });
  assert.equal(error.kind, 'validation');
  assert.doesNotMatch(error.message, /object Object|String should/);
});

test('un détail texte de validation est conservé', () => {
  assert.equal(errorFromResponse(422, { detail: 'Catégorie inconnue' }).message, 'Catégorie inconnue');
});

test('chaque code HTTP du cahier a sa famille d’erreur', () => {
  assert.equal(errorFromResponse(400, {}).kind, 'validation');
  assert.equal(errorFromResponse(404, {}).kind, 'not_found');
  assert.equal(errorFromResponse(409, {}).kind, 'conflict');
  assert.equal(errorFromResponse(413, {}).kind, 'too_large');
  assert.equal(errorFromResponse(415, {}).kind, 'unsupported');
  assert.equal(errorFromResponse(503, {}).kind, 'server');
});

test('une erreur serveur ne montre pas le détail interne', () => {
  assert.doesNotMatch(errorFromResponse(500, { detail: 'Traceback sqlite3' }).message, /Traceback/);
});

test('seules les erreurs passagères se rejouent', () => {
  assert.equal(isRetryable(new ApiError('network', 'x')), true);
  assert.equal(isRetryable(new ApiError('timeout', 'x')), true);
  assert.equal(isRetryable(new ApiError('server', 'x', 500)), true);
  assert.equal(isRetryable(new ApiError('validation', 'x', 422)), false);
  assert.equal(isRetryable(new Error('autre')), false);
});

test('le filtre « toutes » n’envoie aucun paramètre', async () => {
  const calls = stubFetch(() => json([]));
  await fetchReports(null);
  await fetchReports('caniveau_bouche');
  assert.equal(calls[0].url, '/api/reports');
  assert.equal(calls[1].url, '/api/reports?category=caniveau_bouche');
});

test('une panne réseau devient une erreur compréhensible', async () => {
  stubFetch(() => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(request('/api/health'), (error) => error.kind === 'network');
});

test('le délai dépassé est distingué de la panne réseau', async () => {
  globalThis.fetch = (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  });
  await assert.rejects(request('/api/health', { timeoutMs: 5 }), (error) => error.kind === 'timeout');
});

test('une annulation volontaire est signalée comme telle', async () => {
  globalThis.fetch = (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  });
  const controller = new AbortController();
  const pending = request('/api/health', { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, (error) => error.kind === 'aborted');
});

test('le multipart respecte les noms du contrat et n’envoie pas client_id', () => {
  const form = reportFormData({
    client_id: 'local',
    description: 'Tas de déchets au marché',
    reporter_id: 'pseudonyme',
    category_override: 'dechets',
    observed_at: '2026-10-31T10:00:00.000Z',
    latitude: -11.66,
    longitude: 27.48,
    location_accuracy_m: 12,
  });
  assert.deepEqual([...form.keys()].sort(), [
    'category_override', 'description', 'latitude', 'location_accuracy_m', 'longitude', 'observed_at', 'reporter_id',
  ]);
});

test('une épingle manuelle n’invente pas de précision', () => {
  const form = reportFormData({
    description: 'Tas de déchets au marché', reporter_id: 'pseudonyme', latitude: -11.66, longitude: 27.48,
  });
  assert.equal(form.has('location_accuracy_m'), false);
  assert.equal(form.get('category_override'), 'auto');
});

test('sans position, aucune coordonnée ne part', () => {
  const form = reportFormData({ description: 'Tas de déchets au marché', reporter_id: 'pseudonyme' });
  assert.equal(form.has('latitude'), false);
  assert.equal(form.has('longitude'), false);
});

test('la création passe par le multipart', async () => {
  const calls = stubFetch(() => json({ id: 1 }, 201));
  await createReport({ description: 'Tas de déchets au marché', reporter_id: 'pseudonyme' });
  assert.equal(calls[0].options.method, 'POST');
  assert.ok(calls[0].options.body instanceof FormData);
  assert.equal(calls[0].options.headers['Content-Type'], undefined);
});

test('chaque vote part vers sa route avec le bon code', async () => {
  const calls = stubFetch(() => json({ id: 1 }));
  await sendVote(7, 'still_present', { user_id: 'pseudonyme' });
  await sendVote(7, 'resolved', { user_id: 'pseudonyme', latitude: 1, longitude: 2, accuracy_m: 3 });
  assert.equal(calls[0].url, '/api/reports/7/confirm');
  assert.deepEqual(JSON.parse(calls[0].options.body), { user_id: 'pseudonyme', vote: 'still_present' });
  assert.equal(calls[1].url, '/api/reports/7/resolve');
  assert.equal(JSON.parse(calls[1].options.body).vote, 'resolved');
});
