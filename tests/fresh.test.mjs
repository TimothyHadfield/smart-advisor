// js/fresh.js: the stale-or-not decision, the version text, and the startup file list it refetches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shouldReload, versionText, STARTUP } from '../js/fresh.js';

const ROOT = new URL('../', import.meta.url);
const DEPLOY1 = 'Fri, 16 Oct 2026 18:00:00 GMT';
const DEPLOY2 = 'Sat, 17 Oct 2026 00:52:10 GMT';
// document.lastModified is local time "MM/DD/YYYY HH:MM:SS"
const local = (http) => { const d = new Date(http), p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}/${p(d.getDate())}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };

test('same deploy: no reload (page in local-time format, files in HTTP format)', () => {
  assert.equal(shouldReload({ live: DEPLOY1, running: [local(DEPLOY1), DEPLOY1, DEPLOY1] }), false);
});
test('a newer deploy than the page: reload', () => {
  assert.equal(shouldReload({ live: DEPLOY2, running: [local(DEPLOY1), DEPLOY1] }), true);
});
test('page fresh but one cached code file is older: reload (oldest wins)', () => {
  assert.equal(shouldReload({ live: DEPLOY2, running: [local(DEPLOY2), DEPLOY2, DEPLOY1] }), true);
});
test('live older than what runs (CDN lag): no reload', () => {
  assert.equal(shouldReload({ live: DEPLOY1, running: [local(DEPLOY2), DEPLOY2] }), false);
});
test('loop guard: already reloaded for this live value', () => {
  assert.equal(shouldReload({ live: DEPLOY2, running: [DEPLOY1], reloadedFor: DEPLOY2 }), false);
  assert.equal(shouldReload({ live: DEPLOY2, running: [DEPLOY1], reloadedFor: DEPLOY1 }), true);
});
test('missing or unparseable headers: do nothing', () => {
  assert.equal(shouldReload({ live: null, running: [DEPLOY1] }), false);
  assert.equal(shouldReload({ live: 'garbage', running: [DEPLOY1] }), false);
  assert.equal(shouldReload({ live: DEPLOY2, running: [] }), false);
  assert.equal(shouldReload({ live: DEPLOY2, running: [DEPLOY1, null] }), false);
  assert.equal(shouldReload({ live: DEPLOY2, running: [DEPLOY1, 'nope'] }), false);
});

test('version text: "Version Oct 17, 2026, 6:52 PM"', () => {
  assert.equal(versionText(new Date(2026, 9, 17, 18, 52, 30)), 'Version Oct 17, 2026, 6:52 PM');
  assert.equal(versionText('10/17/2026 06:05:00'), 'Version Oct 17, 2026, 6:05 AM');
  assert.equal(versionText('nope'), '');
});

test('STARTUP = index.html stylesheets + every module statically imported at startup', () => {
  const html = readFileSync(new URL('index.html', ROOT), 'utf8');
  const want = new Set([...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]));
  const queue = [...html.matchAll(/<script type="module" src="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(queue.includes('js/fresh.js') && queue.includes('js/app.js'), 'both scripts in index.html');
  while (queue.length) {
    const f = queue.shift();
    if (want.has(f)) continue;
    want.add(f);
    const src = readFileSync(new URL(f, ROOT), 'utf8');
    for (const m of src.matchAll(/^import\s[^'"]*['"](\.\/[^'"]+)['"]/gm)) queue.push(new URL(m[1], new URL(f, ROOT)).href.slice(ROOT.href.length));
  }
  assert.deepEqual([...STARTUP].sort(), [...want].sort());
});
