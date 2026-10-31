import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  categoryInfo, factorLines, formatRelative, indexLabel, isDemo, plural, statusLabel, structuringNote,
} from '../../frontend/js/format.js';
import { requestPosition } from '../../frontend/js/geo.js';
import { reporterId } from '../../frontend/js/identity.js';
import { parseRoute } from '../../frontend/js/router.js';
import { createReportStore } from '../../frontend/js/store.js';
import { validateDraft, validatePhoto } from '../../frontend/js/validation.js';

const validDraft = { description: 'Un tas de déchets au marché', category_override: 'auto' };

test('une description de moins de 8 caractères est refusée, espaces retirés', () => {
  assert.ok(validateDraft({ ...validDraft, description: '   court   ' }).description);
  assert.deepEqual(validateDraft(validDraft), {});
});

test('une description de plus de 2 000 caractères est refusée', () => {
  assert.ok(validateDraft({ ...validDraft, description: 'x'.repeat(2001) }).description);
  assert.deepEqual(validateDraft({ ...validDraft, description: 'x'.repeat(2000) }), {});
});

test('latitude et longitude vont ensemble', () => {
  assert.ok(validateDraft({ ...validDraft, latitude: -11.66 }).location);
  assert.deepEqual(validateDraft({ ...validDraft, latitude: -11.66, longitude: 27.48 }), {});
});

test('seules les catégories autorisées en création passent', () => {
  assert.ok(validateDraft({ ...validDraft, category_override: 'Déchets' }).category);
  assert.ok(validateDraft({ ...validDraft, category_override: 'indetermine' }).category);
});

test('l’heure d’observation doit être valide et passée', () => {
  const now = Date.parse('2026-10-31T12:00:00Z');
  assert.ok(validateDraft({ ...validDraft, observed_at: 'demain' }, now).observed_at);
  assert.ok(validateDraft({ ...validDraft, observed_at: '2026-11-01T12:00:00Z' }, now).observed_at);
  assert.deepEqual(validateDraft({ ...validDraft, observed_at: '2026-10-31T09:00:00Z' }, now), {});
});

test('la photo respecte les limites du backend', () => {
  assert.equal(validatePhoto({ size: 1000, type: 'image/webp' }), null);
  assert.equal(validatePhoto({ size: 1000, type: '' }), null);
  assert.ok(validatePhoto({ size: 1000, type: 'image/heic' }));
  assert.ok(validatePhoto({ size: 1000, type: 'application/pdf' }));
  assert.ok(validatePhoto({ size: 9 * 1024 * 1024, type: 'image/png' }));
  assert.ok(validatePhoto({ size: 0, type: 'image/png' }));
});

test('les routes sont reconnues', () => {
  assert.deepEqual(parseRoute(''), { name: 'home' });
  assert.deepEqual(parseRoute('#/'), { name: 'home' });
  assert.deepEqual(parseRoute('#/carte'), { name: 'map' });
  assert.deepEqual(parseRoute('#/carte/4'), { name: 'map', id: 4 });
  assert.deepEqual(parseRoute('#/liste'), { name: 'list' });
  assert.deepEqual(parseRoute('#/signaler'), { name: 'report' });
  assert.deepEqual(parseRoute('#/attente'), { name: 'pending' });
  assert.deepEqual(parseRoute('#/signalement/42'), { name: 'detail', id: 42 });
});

test('un identifiant qui n’est pas un nombre mène à la page introuvable', () => {
  assert.deepEqual(parseRoute('#/signalement/abc'), { name: 'notfound' });
  assert.deepEqual(parseRoute('#/inconnu'), { name: 'notfound' });
});

test('une catégorie inconnue tombe sur « À préciser »', () => {
  assert.equal(categoryInfo('autre').label, 'À préciser');
});

test('chaque statut a un texte visible', () => {
  assert.equal(statusLabel('active'), 'Actuel');
  assert.equal(statusLabel('stale'), 'À actualiser');
  assert.equal(statusLabel('resolved'), 'Résolu');
  assert.equal(statusLabel('needs_refresh'), 'À vérifier');
});

test('les facteurs sont en langage clair, singulier et pluriel', () => {
  const lines = factorLines({
    has_photo: true,
    confidence_factors: {
      nearby_confirmations: 1, remote_confirmations: 2, resolution_confirmations: 0, freshness: 'récent',
    },
  });
  assert.deepEqual(lines, ['1 personne proche a confirmé', '2 personnes à distance ont confirmé', 'Photo jointe', 'Ancienneté : récent']);
});

test('l’indice n’est pas présenté comme une probabilité', () => {
  assert.equal(indexLabel({ confidence_percent: 74 }), 'Fiabilité estimée : 74/100');
});

test('le mode demo_rules ne prétend pas à de l’IA', () => {
  assert.match(structuringNote({ structuring_mode: 'demo_rules' }), /sans modèle d’IA/);
});

test('la fiche nomme Gemma 4 quand l’API l’indique', () => {
  assert.match(structuringNote({ structuring_mode: 'gemini', model_id: 'gemma-4-26b-a4b-it' }), /IA Gemma 4/);
  assert.match(structuringNote({ structuring_mode: 'gemini', model_id: 'autre' }), /IA Gemini/);
});

test('les données de démonstration sont repérées', () => {
  assert.equal(isDemo({ description: '[DÉMO] Tas de déchets' }), true);
  assert.equal(isDemo({ description: 'Tas de déchets' }), false);
});

test('les durées relatives sont lisibles', () => {
  const now = Date.parse('2026-10-31T12:00:00Z');
  assert.equal(formatRelative('2026-10-31T11:59:50Z', now), 'à l’instant');
  assert.equal(formatRelative('2026-10-31T11:54:00Z', now), 'il y a 6 min');
  assert.equal(formatRelative('2026-10-31T09:00:00Z', now), 'il y a 3 h');
  assert.equal(formatRelative('2026-10-30T12:00:00Z', now), 'il y a 1 jour');
  assert.equal(plural(2, 'cheval', 'chevaux'), '2 chevaux');
});

test('le pseudonyme est stable et stocké sous la clé documentée', () => {
  const data = new Map();
  const storage = { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const first = reporterId(storage);
  assert.equal(reporterId(storage), first);
  assert.equal(data.get('snart-anonymous-id'), first);
  assert.ok(first.length >= 8);
});

test('un stockage bloqué ne casse pas le pseudonyme', () => {
  const blocked = { getItem() { throw new Error('bloqué'); } };
  assert.equal(reporterId(blocked), reporterId(blocked));
});

test('la position distingue refus, délai et absence', async () => {
  const failing = (code) => ({ getCurrentPosition: (ok, ko) => ko({ code }) });
  assert.deepEqual(await requestPosition(failing(1)), { ok: false, reason: 'denied' });
  assert.deepEqual(await requestPosition(failing(2)), { ok: false, reason: 'unavailable' });
  assert.deepEqual(await requestPosition(failing(3)), { ok: false, reason: 'timeout' });
  assert.equal((await requestPosition(null)).reason, 'unsupported');
});

test('les options GPS sont explicites', async () => {
  let options;
  const position = await requestPosition({
    getCurrentPosition(ok, ko, received) {
      options = received;
      ok({ coords: { latitude: 1, longitude: 2, accuracy: 3 } });
    },
  });
  assert.deepEqual(position, { ok: true, latitude: 1, longitude: 2, accuracy_m: 3 });
  assert.equal(options.enableHighAccuracy, true);
  assert.equal(typeof options.timeout, 'number');
  assert.equal(typeof options.maximumAge, 'number');
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((ok, ko) => { resolve = ok; reject = ko; });
  return { promise, resolve, reject };
}

test('une réponse ancienne n’écrase pas le filtre le plus récent', async () => {
  const slow = deferred();
  const fast = deferred();
  const store = createReportStore((category) => (category === 'dechets' ? slow.promise : fast.promise));
  store.setFilter('dechets');
  store.setFilter('embouteillage');
  fast.resolve([{ id: 2 }]);
  await fast.promise;
  slow.resolve([{ id: 1 }]);
  await new Promise((done) => setTimeout(done));
  assert.equal(store.filter, 'embouteillage');
  assert.deepEqual(store.get('embouteillage').items, [{ id: 2 }]);
  assert.deepEqual(store.get('dechets').items, []);
});

test('deux actualisations forcées ne gardent que la dernière réponse', async () => {
  const first = deferred();
  const second = deferred();
  const replies = [first, second];
  const store = createReportStore(() => replies.shift().promise);
  store.load('all');
  store.load('all', { force: true });
  second.resolve([{ id: 2 }]);
  first.resolve([{ id: 1 }]);
  await new Promise((done) => setTimeout(done));
  assert.deepEqual(store.get('all').items, [{ id: 2 }]);
});

test('les signalements frais ne sont pas rechargés à chaque visite', async () => {
  let calls = 0;
  let time = 0;
  const store = createReportStore(async () => { calls += 1; return []; }, { ttlMs: 100, now: () => time });
  await store.load('all');
  await store.load('all');
  assert.equal(calls, 1);
  time = 200;
  await store.load('all');
  assert.equal(calls, 2);
  store.invalidate();
  time = 201;
  await store.load('all');
  assert.equal(calls, 3);
});

test('une erreur conserve les résultats déjà affichés', async () => {
  let fail = false;
  const store = createReportStore(async () => {
    if (fail) throw new Error('panne');
    return [{ id: 1 }];
  });
  await store.load('all');
  fail = true;
  await store.load('all', { force: true });
  assert.equal(store.get('all').status, 'error');
  assert.deepEqual(store.get('all').items, [{ id: 1 }]);
});
