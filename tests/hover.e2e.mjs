// Flowchart hover, end to end (guest, Firebase blocked, headless WebKit via Playwright from ~/.claude/tools).
// Not part of the plain suite.
//   1. serve the repo:   python -m http.server 8137 --bind 127.0.0.1
//   2. run:              node --test tests/hover.e2e.mjs        (APP_URL=... for another address)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';

const { webkit, devices } = createRequire(join(homedir(), '.claude/tools/'))('playwright');
const APP = process.env.APP_URL || 'http://localhost:8137/';
const browser = await webkit.launch({ headless: true });
after(() => browser.close());

const KEY = 'smart-advisor:v1';
const EE = 'electrical-engineering-bs';
// a made-up student: Calculus I taken Fall 2025 with an A, ECE 1000 in progress
const SAVED = {
  plan: { programs: [EE], catalogYear: null },
  done: { [EE]: ['MATH 1210', 'ECE 1000'] },
  grades: { [EE]: { 'MATH 1210': 'A', 'ECE 1000': 'IP' } },
  settings: { grades: true, when: { 'MATH 1210': 'Fall 2025' } },
};
async function page(opts) {
  const ctx = await browser.newContext({ ...opts, serviceWorkers: 'block' });
  await ctx.route(/gstatic\.com\/firebasejs/, (r) => r.abort());
  await ctx.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, [KEY, JSON.stringify(SAVED)]);
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  await p.goto(APP + '?p=' + EE);
  await p.waitForSelector('.box[data-id="ECE 2250"]');
  await p.waitForTimeout(400);
  return p;
}
const box = (id) => `.box[data-id="${id}"]`;
const rect = (p, sel) => p.$eval(sel, (el) => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; });
const lines = (p) => p.$$eval('#edges .hl path', (ps) => ps.map((x) => x.getAttribute('class')));

test('no hover previews left: no title tooltips on flowchart boxes', async () => {
  const p = await page({ viewport: { width: 1280, height: 800 } });
  assert.equal(await p.$$eval('#boxes .box[title], #boxes .box [title]', (els) => els.length), 0);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('hover: prereq lines + needed-by lines in two colours, others dimmed, label right above the box', async () => {
  const p = await page({ viewport: { width: 1280, height: 800 } });
  const before = await rect(p, box('ECE 2250'));
  await p.hover(box('ECE 2250'));
  await p.waitForTimeout(100);
  const cls = await lines(p);
  assert.ok(cls.some((c) => /\bpre\b/.test(c)), 'prereq lines');
  assert.ok(cls.some((c) => /\bpost\b/.test(c)), 'needed-by lines');
  const [pre, post] = await p.evaluate(() => ['pre', 'post'].map((k) => getComputedStyle(document.querySelector(`#edges .hl path.${k}`)).stroke));
  assert.notEqual(pre, post, 'two different colours');
  assert.ok(await p.$eval('#edges', (s) => s.classList.contains('hov')), 'other lines dimmed');
  const hint = await rect(p, '#hint');
  const text = await p.textContent('#hint');
  assert.match(text, /^Planned (Jan|May|Aug) 20\d\d$/);
  assert.ok(hint.l >= before.l - 0.5 && hint.r <= before.r + 0.5, `label inside the box's left/right (${JSON.stringify(hint)} vs ${JSON.stringify(before)})`);
  assert.ok(hint.b <= before.t + 0.5, 'label above the box');
  assert.deepEqual(await rect(p, box('ECE 2250')), before, 'box did not move or resize');
  // taken: month + grade; in progress: Now
  await p.hover(box('MATH 1210'));
  await p.waitForTimeout(100);
  assert.equal(await p.textContent('#hint'), 'Aug 2025 · A');
  const m = await rect(p, box('MATH 1210')), h = await rect(p, '#hint');
  assert.ok(h.l >= m.l - 0.5 && h.r <= m.r + 0.5, 'label inside the box\'s left/right');
  assert.ok(h.b <= m.t + 0.5 || h.t >= m.b - 0.5, 'label above or below, never beside');
  await p.hover(box('ECE 1000'));
  await p.waitForTimeout(100);
  assert.match(await p.textContent('#hint'), /^Now · (Jan|May|Aug) 20\d\d$/);
  // leave: everything back to normal
  await p.mouse.move(5, 5);
  await p.waitForTimeout(100);
  assert.equal(await p.$eval('#hint', (h) => h.hidden), true);
  assert.deepEqual(await lines(p), []);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('phone: label + lines while the finger is down; a tap still marks the class taken', async () => {
  const p = await page({ ...devices['iPhone 15'] });
  const sel = box('MATH 1220');
  await p.$eval(sel, (el) => el.scrollIntoView({ block: 'center', inline: 'center' }));
  await p.dispatchEvent(sel, 'pointerdown', { pointerType: 'touch', isPrimary: true, button: 0 });
  assert.equal(await p.$eval('#hint', (h) => h.hidden), false);
  assert.ok((await lines(p)).length > 0);
  await p.dispatchEvent(sel, 'pointerup', { pointerType: 'touch', isPrimary: true, button: 0 });
  assert.equal(await p.$eval('#hint', (h) => h.hidden), true);
  await p.tap(sel);
  await p.waitForTimeout(150);
  assert.equal(await p.getAttribute(sel, 'aria-pressed'), 'true', 'tap marks Taken');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});
