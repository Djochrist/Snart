import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { groupByLocation } from '../../frontend/js/map.js';

const FRONTEND = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'frontend');
const read = (path) => readFileSync(join(FRONTEND, path), 'utf8');

function allFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? allFiles(path) : [path];
  });
}

function shellList() {
  const source = read('service-worker.js');
  const block = source.slice(source.indexOf('APP_SHELL = ['), source.indexOf('];'));
  return [...block.matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

test('chaque fichier du shell existe', () => {
  for (const path of shellList()) {
    if (path !== './') assert.ok(existsSync(join(FRONTEND, path)), `${path} absent`);
  }
});

test('aucun fichier du frontend n’est oublié dans le cache du shell', () => {
  const shell = new Set(shellList());
  const skipped = new Set(['index.html', 'service-worker.js']);
  for (const file of allFiles(FRONTEND)) {
    const path = relative(FRONTEND, file).split(sep).join('/');
    if (!skipped.has(path)) assert.ok(shell.has(path), `${path} absent de APP_SHELL`);
  }
});

test('le manifest déclare des chemins relatifs et des fichiers réels', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.equal(manifest.short_name, 'Snart');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  for (const icon of manifest.icons) {
    assert.ok(!icon.src.startsWith('/'), icon.src);
    assert.ok(existsSync(join(FRONTEND, icon.src)), `${icon.src} absent`);
  }
  assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable'));
  assert.ok(manifest.icons.some((icon) => icon.sizes === '192x192'));
  assert.ok(manifest.icons.some((icon) => icon.sizes === '512x512'));
});

test('la page n’utilise aucun chemin absolu, pour fonctionner dans un sous-répertoire', () => {
  const html = read('index.html');
  assert.doesNotMatch(html, /(href|src)="\/[^/]/);
});

test('aucune donnée n’est injectée avec innerHTML', () => {
  for (const file of allFiles(FRONTEND).filter((path) => path.endsWith('.js'))) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /innerHTML|insertAdjacentHTML|document\.write/, file);
  }
});

test('aucune adresse locale ni clé dans les fichiers publics', () => {
  for (const file of allFiles(FRONTEND).filter((path) => /\.(js|html|webmanifest)$/.test(path))) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /localhost|127\.0\.0\.1|GEMINI_API_KEY|AIza[0-9A-Za-z_-]{20}/, file);
  }
});

test('les signalements au même endroit sont regroupés, ceux sans position écartés', () => {
  const groups = groupByLocation([
    { id: 1, latitude: -11.66001, longitude: 27.48001 },
    { id: 2, latitude: -11.66002, longitude: 27.48002 },
    { id: 3, latitude: -11.7, longitude: 27.5 },
    { id: 4, latitude: null, longitude: null },
  ]);
  assert.deepEqual(groups.map((group) => group.map((report) => report.id)), [[1, 2], [3]]);
});
