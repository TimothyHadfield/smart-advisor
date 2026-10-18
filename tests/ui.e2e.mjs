// End-to-end UI checks (guest, Firebase blocked, headless WebKit as an iPhone 15 via Playwright from
// ~/.claude/tools). Not part of the plain suite.
//   1. serve the repo:   python -m http.server 8137 --bind 127.0.0.1
//   2. run:              node --test tests/ui.e2e.mjs        (APP_URL=... for another address)
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
async function page(saved) {
  const ctx = await browser.newContext({ ...devices['iPhone 15'], serviceWorkers: 'block' });
  await ctx.route(/gstatic\.com\/firebasejs/, (r) => r.abort());
  if (saved) await ctx.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, [KEY, JSON.stringify(saved)]);
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  return p;
}
const stored = (p) => p.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}'), KEY);
const COMBO = { plan: { programs: ['electrical-engineering-bs', 'mathematics-minor'], catalogYear: null }, done: { 'electrical-engineering-bs': ['ENGL 1010'] } };

test('?p= of the saved major keeps the saved minor; the URL follows the chosen programs', async () => {
  const p = await page(COMBO);
  await p.goto(APP + '?p=electrical-engineering-bs');
  await p.waitForSelector('.box[data-id="MATH 1210"]');
  await p.waitForTimeout(300);
  assert.match(await p.textContent('#progName'), /Mathematics/, 'minor still shown');
  assert.deepEqual((await stored(p)).plan.programs, COMBO.plan.programs, 'saved plan not overwritten');
  assert.equal(new URL(p.url()).searchParams.get('p'), 'electrical-engineering-bs,mathematics-minor');
  // pick another major: the URL follows
  await p.click('#progName');
  await p.fill('#pickQ', 'Computer Science, B.S.');
  await p.click('#pickList button[data-id="computer-science-bs"]');
  await p.waitForFunction(() => /Computer Science/.test(document.querySelector('#progName').textContent));
  assert.equal(new URL(p.url()).searchParams.get('p'), 'computer-science-bs,mathematics-minor');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('a link to another program opens it like picking it (minor kept)', async () => {
  const p = await page(COMBO);
  await p.goto(APP + '?p=nursing-bs');
  await p.waitForFunction(() => /Nursing/.test(document.querySelector('#progName').textContent));
  await p.waitForTimeout(300);
  assert.deepEqual((await stored(p)).plan.programs, ['nursing-bs', 'mathematics-minor']);
  assert.deepEqual((await stored(p)).done['electrical-engineering-bs'], ['ENGL 1010'], 'old major kept its classes');
  await p.context().close();
});

test('Clear taken asks first, then can be undone', async () => {
  const p = await page(COMBO);
  await p.goto(APP);
  await p.waitForSelector('.box[data-id="MATH 1210"]');
  await p.click('#gear');
  await p.click('#clearDone');
  assert.deepEqual((await stored(p)).done['electrical-engineering-bs'], ['ENGL 1010'], 'one tap does not clear');
  await p.click('#clearDone');
  assert.deepEqual((await stored(p)).done['electrical-engineering-bs'], [], 'second tap clears');
  await p.waitForSelector('#toast.on #toastUndo');
  await p.click('#toastUndo');
  assert.deepEqual((await stored(p)).done['electrical-engineering-bs'], ['ENGL 1010'], 'undo restores');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('first visit: the program picker opens instead of landing on EE', async () => {
  const p = await page(null);
  await p.goto(APP);
  await p.waitForSelector('#pick[open]', { timeout: 8000 });
  assert.doesNotMatch(await p.textContent('#progName'), /Electrical/);
  assert.deepEqual((await stored(p)).plan?.programs || [], [], 'nothing saved for the student');
  await p.click('#pickList button[data-id="nursing-bs"]');
  await p.waitForFunction(() => /Nursing/.test(document.querySelector('#progName').textContent));
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('back goes where you just were: tabs, then an open sheet', async () => {
  const p = await page(COMBO);
  await p.goto(APP);
  await p.waitForSelector('.box[data-id="MATH 1210"]');
  await p.click('#tabs button[data-tab="plan"]');
  await p.click('#tabs button[data-tab="sched"]');
  await p.goBack();
  await p.waitForTimeout(200);
  assert.equal(await p.getAttribute('#main', 'data-tab'), 'plan');
  await p.click('#gear');
  assert.ok(await p.$('#settings[open]'));
  await p.goBack();
  await p.waitForTimeout(200);
  assert.equal(await p.$('#settings[open]'), null, 'back closes the sheet');
  assert.equal(await p.getAttribute('#main', 'data-tab'), 'plan', 'and stays on the tab');
  await p.goBack();
  await p.waitForTimeout(200);
  assert.equal(await p.getAttribute('#main', 'data-tab'), 'flow');
  assert.ok(p.url().startsWith(APP), 'still on the site');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('tap a plan row: the class sheet with credits, catalog link and a report link', async () => {
  const p = await page(COMBO);
  await p.goto(APP);
  await p.waitForSelector('.box[data-id="MATH 1210"]');
  await p.click('#tabs button[data-tab="plan"]');
  await p.click('#sems li[data-unit="MATH 1210"]');
  await p.waitForSelector('#clsDlg[open]');
  assert.match(await p.textContent('#clsDlg'), /Calculus I/);
  assert.match(await p.getAttribute('#clsCat', 'href'), /catalog\.uvu\.edu\/search\/\?P=MATH%201210/);
  assert.match(await p.getAttribute('#clsReport', 'href'), /github\.com\/TimothyHadfield\/smart-advisor\/issues\/new\?/);
  assert.match(await p.textContent('#sum'), /Unofficial plan/);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('hold a box: the class sheet opens and the box is not marked taken; a chosen track is saved', async () => {
  const p = await page(COMBO);
  await p.goto(APP + '?p=computer-science-bs');
  await p.waitForSelector('.box[data-id="MATH 1210"]');
  const b = await p.$('.box[data-id="MATH 1210"]');
  const r = await b.boundingBox();
  await p.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
  await p.mouse.down();
  await p.waitForTimeout(650);
  await p.mouse.up();
  await p.waitForSelector('#clsDlg[open]');
  assert.equal(await b.getAttribute('aria-pressed'), 'false', 'not taken by the hold');
  await p.goBack();
  await p.waitForTimeout(200);
  assert.equal(await p.$('#clsDlg[open]'), null);
  // track chip
  await p.click('#tabs button[data-tab="plan"]');
  assert.match(await p.textContent('#sum .chip'), /Guessed/);
  await p.click('#sum .chip');
  await p.click('#trackList button[data-t="Secure Computing Track"]');
  const s = await stored(p);
  assert.equal(Object.values(s.settings.tracks['computer-science-bs'])[0], 'Secure Computing Track');
  assert.doesNotMatch(await p.textContent('#sum .chip'), /Guessed/);
  assert.match(await p.textContent('#sum .chip'), /Secure Computing/);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('EE 2025-26: Apply + Advanced Standing rows in the plan; ECE 4900\'s class sheet shows both gates', async () => {
  const p = await page({ plan: { programs: ['electrical-engineering-bs'], catalogYear: '2025-2026' }, done: {} });
  await p.goto(APP);
  await p.waitForSelector('.box[data-id="MATH 1210"]');
  await p.click('#tabs button[data-tab="plan"]');
  assert.equal(await p.textContent('#sems .apply[data-gate="admission"]'), 'Apply');
  assert.ok(await p.$('#sems .apply[data-gate="advanced-standing"]'), 'Advanced Standing row');
  // the Apply row comes after ECE 2250's semester and before ECE 3740's
  const order = await p.$$eval('#sems > *', (els) => els.map((e) => (e.classList.contains('apply') ? e.dataset.gate : [...e.querySelectorAll('li')].map((l) => l.dataset.unit).join(','))));
  const at = (re) => order.findIndex((x) => re.test(x));
  assert.ok(at(/ECE 2250/) < at(/^admission$/) && at(/^admission$/) < at(/ECE 3740/), JSON.stringify(order));
  assert.match(await p.textContent('#sum'), /Requires admission/);
  await p.click('#sems li[data-unit="ECE 4900"]');
  await p.waitForSelector('#clsDlg[open]');
  const facts = await p.textContent('#clsFacts');
  assert.match(facts, /Needs.*Formal Acceptance into the Electrical or Computer Engineering Programs/);
  assert.match(facts, /University Advanced Standing/);
  assert.match(facts, /Catalog.*Discipline Core Requirements/);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});
