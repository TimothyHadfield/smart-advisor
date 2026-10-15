// End-to-end account checks in headless WebKit (Playwright from ~/.claude/tools), against the emulators.
//   1. serve the repo:   python -m http.server 8137 --bind 127.0.0.1
//   2. run:              firebase emulators:exec --only auth,firestore --project smart-advisor-th "node tests/accounts.e2e.mjs"
// Never touches the real project: the page connects to the emulators (?emu on localhost) and signs in
// with an emulator-only Google credential (the real Google popup can't be scripted).
// Also checks the app works as a guest with Firebase blocked. Not part of the plain suite.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';

const { webkit, devices } = createRequire(join(homedir(), '.claude/tools/'))('playwright');
const APP = process.env.APP_URL || 'http://localhost:8137/';
const FS = 'http://127.0.0.1:8086/v1/projects/smart-advisor-th/databases/(default)/documents';
const browser = await webkit.launch({ headless: true });
after(() => browser.close());

async function page({ blockFirebase = false } = {}) {
  const ctx = await browser.newContext({ ...devices['iPhone 15'], serviceWorkers: 'block' });
  if (blockFirebase) await ctx.route(/gstatic\.com\/firebasejs/, (r) => r.abort());
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') p.errors.push(m.text()); });
  return p;
}
const taken = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('smart-advisor:v1') || '{}').done?.['ee-bs'] || []);
const tap = (p, id) => p.click(`.box[data-id="${id}"]`);
async function remote(uid) {
  const r = await fetch(`${FS}/users/${uid}`, { headers: { authorization: 'Bearer owner' } });
  if (r.status === 404) return null;
  const f = (await r.json()).fields;
  return { taken: (f.taken.arrayValue.values || []).map((v) => v.stringValue), max: +f.settings.mapValue.fields.max.integerValue };
}
async function until(fn, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await new Promise((r) => setTimeout(r, 150)); }
}

test('Firebase blocked: guest works, saves locally, sheet says sign-in unavailable, no errors', async () => {
  const p = await page({ blockFirebase: true });
  await p.goto(APP);
  await p.waitForSelector('.box[data-id="MATH 1210"]');
  await tap(p, 'MATH 1210');
  assert.deepEqual(await taken(p), ['MATH 1210']);
  await p.waitForTimeout(2000);
  await p.click('#profile');
  assert.equal(await p.textContent('#acctGoogle'), 'Sign-in unavailable offline');
  assert.ok(await p.isDisabled('#acctGoogle'));
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('first sign-in merges guest classes into the account; a second device sees it and updates live', async () => {
  // the account already has a class from another device
  const a = await page();
  await a.goto(APP + '?emu');
  await a.waitForFunction(() => window.__saEmuSignIn);
  await a.evaluate(() => window.__saEmuSignIn('claude-test-1', 'claude-test@example.com', 'Claude Test'));
  await a.waitForFunction(() => document.getElementById('profile').classList.contains('in'));
  await tap(a, 'ECE 1000');
  const uid = await until(() => a.evaluate(() => JSON.parse(localStorage.getItem('smart-advisor:owner'))?.uid));
  assert.deepEqual((await until(async () => { const d = await remote(uid); return d?.taken.length && d; })).taken, ['ECE 1000']);

  // device B: a guest taps MATH 1210, then signs in -> union
  const b = await page();
  await b.goto(APP + '?emu');
  await b.waitForSelector('.box[data-id="MATH 1210"]');
  await tap(b, 'MATH 1210');
  await b.waitForFunction(() => window.__saEmuSignIn);
  await b.evaluate(() => window.__saEmuSignIn('claude-test-1', 'claude-test@example.com', 'Claude Test'));
  const merged = await until(async () => { const d = await remote(uid); return d?.taken.length === 2 && d; });
  assert.deepEqual(merged.taken.sort(), ['ECE 1000', 'MATH 1210']);
  assert.deepEqual((await taken(b)).sort(), ['ECE 1000', 'MATH 1210']);
  // ...and device A got MATH 1210 live, without a reload
  assert.ok(await until(async () => (await taken(a)).includes('MATH 1210')));
  assert.ok(await a.evaluate(() => document.querySelector('.box[data-id="MATH 1210"]').classList.contains('done')));

  // a settings change on A reaches B
  await a.click('#gear');
  await a.selectOption('#setMax', '12');
  await a.keyboard.press('Escape');
  assert.ok(await until(async () => (await remote(uid))?.max === 12));
  assert.ok(await until(() => b.evaluate(() => JSON.parse(localStorage.getItem('smart-advisor:v1')).settings.max === 12)));

  // the sheet shows who and "Saved"
  await b.click('#profile');
  assert.equal(await b.textContent('#acctEmail'), 'claude-test@example.com');
  assert.equal(await until(() => b.textContent('#acctSyncText').then((t) => t === 'Saved' && t)), 'Saved');

  // sign out on B: this device forgets the classes, the account keeps them
  await b.click('#acctSignOut');
  await b.waitForFunction(() => !document.getElementById('profile').classList.contains('in'));
  assert.deepEqual(await taken(b), []);
  assert.equal(await b.evaluate(() => localStorage.getItem('smart-advisor:owner')), null);
  assert.equal(await b.evaluate(() => document.querySelectorAll('.box.done').length), 0);
  assert.equal((await remote(uid)).taken.length, 2);

  // reload B signed out: still empty. Sign in again: the classes come back
  await b.reload();
  await b.waitForFunction(() => window.__saEmuSignIn);
  assert.deepEqual(await taken(b), []);
  await b.evaluate(() => window.__saEmuSignIn('claude-test-1', 'claude-test@example.com', 'Claude Test'));
  assert.ok(await until(async () => (await taken(b)).length === 2));

  // reload A while signed in: the session resumes and keeps syncing
  await a.reload();
  await a.waitForFunction(() => document.getElementById('profile').classList.contains('in'));
  await tap(a, 'CS 1400');
  assert.ok(await until(async () => (await remote(uid))?.taken.includes('CS 1400')));
  assert.ok(await until(async () => (await taken(b)).includes('CS 1400')));

  // delete the account from B (signed in just now, so no re-auth popup): doc gone, B empty
  await b.click('#profile');
  await b.click('#acctMore');
  await b.click('#acctDelete');
  assert.equal(await b.textContent('#acctDelete'), 'Delete forever');
  await b.click('#acctDelete');
  assert.ok(await until(async () => (await remote(uid)) === null));
  await b.waitForFunction(() => !document.getElementById('profile').classList.contains('in'));
  assert.deepEqual(await taken(b), []);
  // A was signed in to the deleted account: it gets signed out and forgets too (next token refresh;
  // not waited for here)

  // WebKit logs the Firestore channel that a reload cuts off as "access control checks"; harmless
  assert.deepEqual(a.errors.filter((e) => !/auth\/user-token-expired|user-not-found|permission|Firestore\/(Listen|Write)\/channel.*access control/i.test(e)), []);
  assert.deepEqual(b.errors, []);
  await a.context().close();
  await b.context().close();
});
