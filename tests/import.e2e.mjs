// End-to-end: importing an audit sets where the plan starts, and that survives a reload (guest, Firebase
// blocked, headless WebKit via Playwright from ~/.claude/tools). Not part of the plain suite.
//   1. serve the repo:   python -m http.server 8137 --bind 127.0.0.1
//   2. run:              node --test tests/import.e2e.mjs        (APP_URL=... for another address)
// Uses a made-up audit (never the real one in .claude/test/).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';

const { webkit, devices } = createRequire(join(homedir(), '.claude/tools/'))('playwright');
const APP = process.env.APP_URL || 'http://localhost:8137/';
const browser = await webkit.launch({ headless: true });
after(() => browser.close());

// registered for next Spring already -> the plan starts the Fall after
const NEXT = new Date().getFullYear() + 1;
const AUDIT = [
  'Catalog Year: 2025-2026',
  '',
  'ENGL 1010 Introduction to Academic Writing A 3 Fall 2025',
  `CS 1400 Fundamentals of Programming IP (3) Spring ${NEXT}`,
].join('\n');

const saved = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('smart-advisor:v1') || '{}').settings || {});
// the plan's first semester, once it reads `want` (Apply may reload the program for the audit's catalog year)
const firstSem = (p, want) => p.waitForFunction((w) => document.querySelector('#sems .sem h3')?.firstChild.textContent === w, want, { timeout: 8000 })
  .then(() => want, () => p.$eval('#sems .sem h3', (h) => h.firstChild.textContent));

test('audit import: the later start is saved and still there after a reload; Clear taken resets it for the account too', async () => {
  const ctx = await browser.newContext({ ...devices['iPhone 15'], serviceWorkers: 'block' });
  await ctx.route(/gstatic\.com\/firebasejs/, (r) => r.abort());
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(APP + '?p=electrical-engineering-bs');
  await p.waitForSelector('.box[data-id="MATH 1210"]');
  await p.click('#gear');
  // Settings opens without a focus ring on Start, like the other sheets
  assert.equal(await p.evaluate(() => document.activeElement?.id || document.activeElement?.tagName), 'BODY');
  await p.click('#importBtn');
  await p.fill('#impText', AUDIT);
  await p.click('#impGo');
  await p.waitForSelector('#impStep2:not([hidden])');
  await p.click('#impGo');
  await p.waitForTimeout(300);
  assert.equal((await saved(p)).lastTerm, `Spring ${NEXT}`);
  assert.equal(await firstSem(p, `Fall ${NEXT}`), `Fall ${NEXT}`);
  await p.goto(APP);
  await p.waitForSelector('.box[data-id="MATH 1210"]');
  await p.waitForTimeout(300);
  assert.equal((await saved(p)).lastTerm, `Spring ${NEXT}`, 'kept after a reload');
  assert.equal(await firstSem(p, `Fall ${NEXT}`), `Fall ${NEXT}`);
  // Clear taken: lastTerm is null (not missing), so the account doc carries the reset to other devices
  await p.click('#gear');
  await p.click('#clearDone');
  await p.click('#clearDone'); // the first tap asks, the second clears
  const s = await saved(p);
  assert.ok('lastTerm' in s && s.lastTerm === null);
  assert.deepEqual(errors, []);
  await ctx.close();
});
