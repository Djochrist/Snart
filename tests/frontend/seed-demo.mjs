/*
 * Données de démonstration synthétiques, publiées par l'API réelle : `node tests/frontend/seed-demo.mjs [url]`.
 * Chaque description commence par [DÉMO] : l'interface l'affiche comme donnée de démonstration.
 * Les scores et statuts sont ceux que le backend calcule, rien n'est écrit en dur.
 * À n'utiliser que sur une base de test.
 */
import { deflateSync } from 'node:zlib';

const API = (process.argv[2] || 'http://127.0.0.1:8000').replace(/\/$/, '');
const HOURS = 3600 * 1000;
const hoursAgo = (hours) => new Date(Date.now() - hours * HOURS).toISOString();
const voter = (name) => `demo-voter-${name}`;

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([size, body, crc]);
}

/* Image unie générée ici : aucune photo réelle n'entre dans les données de démonstration. */
function demoPhoto(width = 320, height = 200) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x += 1) row.set([0x5b + (x % 40), 0x7d, 0x54], 1 + x * 3);
  const rows = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(rows)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

async function post(path, options) {
  const response = await fetch(`${API}${path}`, { method: 'POST', ...options });
  if (!response.ok) throw new Error(`${path} : ${response.status} ${await response.text()}`);
  return response.json();
}

function createReport({ description, category, latitude, longitude, accuracy, observedAt, photo }) {
  const form = new FormData();
  form.append('description', `[DÉMO] ${description}`);
  form.append('reporter_id', 'demo-reporter');
  form.append('category_override', category);
  if (observedAt) form.append('observed_at', observedAt);
  if (latitude !== undefined) {
    form.append('latitude', String(latitude));
    form.append('longitude', String(longitude));
    if (accuracy !== undefined) form.append('location_accuracy_m', String(accuracy));
  }
  if (photo) form.append('photo', new Blob([demoPhoto()], { type: 'image/png' }), 'demo.png');
  return post('/api/reports', { body: form });
}

function vote(report, name, kind, position) {
  const route = kind === 'resolved' ? 'resolve' : 'confirm';
  return post(`/api/reports/${report.id}/${route}`, {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: voter(name), vote: kind, ...position }),
  });
}

const near = (report) => ({ latitude: report.latitude, longitude: report.longitude, accuracy_m: 20 });

const waste = await createReport({
  description: 'Tas de déchets à côté du marché, le passage est gêné.',
  category: 'dechets',
  latitude: -11.6642,
  longitude: 27.4794,
  accuracy: 18,
  observedAt: hoursAgo(1),
  photo: true,
});
const drain = await createReport({
  description: 'Le caniveau est bouché et l’eau déborde sur la route.',
  category: 'caniveau_bouche',
  latitude: -11.6585,
  longitude: 27.4886,
  accuracy: 32,
  observedAt: hoursAgo(5),
});
await createReport({
  description: 'Circulation bloquée au rond-point depuis ce matin.',
  category: 'embouteillage',
  latitude: -11.6702,
  longitude: 27.4689,
  observedAt: hoursAgo(5),
});
await createReport({
  description: 'Circulation ralentie sur l’avenue, deux camions à l’arrêt.',
  category: 'embouteillage',
  latitude: -11.6621,
  longitude: 27.4715,
  accuracy: 25,
});
await createReport({
  description: 'Quelque chose ne va pas dans ce quartier depuis hier.',
  category: 'auto',
});
const resolved = await createReport({
  description: 'Déchets déposés devant l’école, déjà ramassés selon les voisins.',
  category: 'dechets',
  latitude: -11.6519,
  longitude: 27.4832,
  accuracy: 15,
  observedAt: hoursAgo(20),
});

await vote(waste, 'a', 'still_present', near(waste));
await vote(waste, 'b', 'still_present', near(waste));
await vote(waste, 'c', 'still_present', {});
await vote(drain, 'a', 'still_present', {});
await vote(resolved, 'a', 'resolved', near(resolved));
await vote(resolved, 'b', 'resolved', near(resolved));

console.log(`Données de démonstration publiées sur ${API}.`);
