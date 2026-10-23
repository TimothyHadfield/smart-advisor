// Source links on the rendered page (headless WebKit, iPhone 15): program source line, class sheet, section
// list (RMP + class search), Gen Ed list. Tim, 2026-10-22: "automatic links to everything you are reffering to".
//   1. serve the repo:   python -m http.server 8137 --bind 127.0.0.1
//   2. run:              node --test tests/sources.e2e.mjs        (APP_URL=... for another address)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

const { webkit, devices } = createRequire(join(homedir(), '.claude/tools/'))('playwright');
const APP = process.env.APP_URL || 'http://localhost:8137/';
const browser = await webkit.launch({ headless: true });
after(() => browser.close());

const EE_URL = JSON.parse(readFileSync(new URL('../data/programs/electrical-engineering-bs.json', import.meta.url))).url;
const KEY = 'smart-advisor:v1';
async function page(saved) {
  const ctx = await browser.newContext({ ...devices['iPhone 15'], serviceWorkers: 'block' });
  await ctx.route(/gstatic\.com\/firebasejs/, (r) => r.abort());
  await ctx.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, [KEY, JSON.stringify(saved)]);
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  return p;
}
const EE = { plan: { programs: ['electrical-engineering-bs'], catalogYear: null }, done: { 'electrical-engineering-bs': ['ENGL 1010'] } };
const links = (p, sel) => p.$$eval(sel, (as) => as.map((a) => ({ text: a.textContent, href: a.getAttribute('href'), target: a.target })));

test('plan: catalog requirements + sample plan links with the checked date', async () => {
  const p = await page(EE);
  await p.goto(APP + '?p=electrical-engineering-bs');
  await p.waitForSelector('#sum .src a', { state: 'attached' });
  const ls = await links(p, '#sum .src a');
  assert.ok(ls.some((l) => l.href === EE_URL + '#requirementstextcontainer' && /Catalog 2026-27/.test(l.text) && l.target === '_blank'), JSON.stringify(ls));
  assert.ok(ls.some((l) => l.href === EE_URL + '#graduationplantextcontainer' && /Sample plan/.test(l.text)), JSON.stringify(ls));
  assert.match(await p.textContent('#sum .src'), /checked Oct \d+/);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('class sheet: catalog course entry on Before, requirement links on Why, a dated source line', async () => {
  const p = await page(EE);
  await p.goto(APP + '?p=electrical-engineering-bs');
  await p.waitForSelector('.box[data-id="ECE 2250"]');
  await p.click('.box[data-id="ECE 2250"]', { button: 'right' });
  await p.waitForSelector('#clsDlg[open]');
  const COURSE = 'https://catalog.uvu.edu/search/?P=ECE%202250';
  assert.equal(await p.getAttribute('#clsCat', 'href'), COURSE);
  const rows = await p.$$eval('#clsFacts dt', (ds) => ds.map((d) => [d.textContent, d.nextElementSibling.querySelector('a.src')?.getAttribute('href') || null]));
  assert.ok(rows.some(([k, h]) => k === 'Before' && h === COURSE), JSON.stringify(rows));
  assert.ok(rows.some(([k, h]) => k === 'Why' && h === EE_URL + '#requirementstextcontainer'), JSON.stringify(rows));
  const src = await links(p, '#clsSrc a');
  assert.ok(src.some((l) => l.href === EE_URL + '#requirementstextcontainer' && l.target === '_blank'), JSON.stringify(src));
  assert.match(await p.textContent('#clsSrc'), /checked Oct \d+/);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('schedule: section list links each rating to Rate My Professors and names the class search + date', async () => {
  const p = await page(EE);
  await p.goto(APP + '?p=electrical-engineering-bs');
  await p.waitForSelector('.box[data-id="MATH 1210"]');
  await p.click('#tabs button[data-tab="sched"]');
  await p.waitForSelector('#scList .sc-row[data-i]');
  assert.match(await p.textContent('#scList .src'), /UVU class search .*checked Oct \d+/);
  // open the classes until one has a rated professor
  const n = await p.$$eval('#scList .sc-row[data-i]', (b) => b.length);
  let rated = [];
  for (let i = 0; i < n && !rated.length; i++) {
    await p.click(`#scList .sc-row[data-i="${i}"]`);
    await p.waitForSelector('#secDlg[open]');
    rated = await links(p, '#secList a.rt');
    const src = await links(p, '#secSrc a');
    assert.ok(src.some((l) => l.href === 'https://userve.uvu.edu/StudentRegistrationSsb/ssb/term/termSelection?mode=search' && l.target === '_blank'), JSON.stringify(src));
    assert.ok(src.some((l) => /^https:\/\/catalog\.uvu\.edu\/search\/\?P=/.test(l.href)), JSON.stringify(src));
    if (!rated.length) { await p.click('#secDlg button[value="ok"]'); await p.waitForSelector('#secDlg:not([open])', { state: 'attached' }); }
  }
  assert.ok(rated.length, 'a rated professor');
  assert.ok(rated.every((l) => /^https:\/\/www\.ratemyprofessors\.com\/professor\/\d+$/.test(l.href) && l.target === '_blank'), JSON.stringify(rated));
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('matriculation sheet: catalog facts link to the catalog, dated source line', async () => {
  const p = await page(EE);
  await p.goto(APP + '?p=electrical-engineering-bs');
  await p.waitForSelector('#matricBtn', { state: 'attached' });
  await p.evaluate(() => document.getElementById('matricBtn').click());
  await p.waitForSelector('#matDlg[open]');
  const rows = await p.$$eval('#matFacts dt', (ds) => ds.map((d) => [d.textContent, d.nextElementSibling.querySelector('a.src')?.getAttribute('href') || null]));
  assert.ok(rows.some(([k, h]) => k === 'Catalog' && h?.startsWith(EE_URL)), JSON.stringify(rows));
  const src = await links(p, '#matSrc a');
  assert.ok(src.some((l) => l.href === EE_URL + '#requirementstextcontainer' && l.target === '_blank'), JSON.stringify(src));
  assert.match(await p.textContent('#matSrc'), /checked Oct \d+/);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('Gen Ed list: links to the catalog Gen Ed page', async () => {
  const p = await page(EE);
  await p.goto(APP + '?p=electrical-engineering-bs');
  await p.waitForSelector('.box .gl');
  await p.click('.box .gl');
  await p.waitForSelector('#geDlg[open]');
  const src = await links(p, '#geSrc a');
  assert.ok(src.some((l) => l.href === 'https://catalog.uvu.edu/general-education/' && l.target === '_blank'), JSON.stringify(src));
  assert.match(await p.textContent('#geSrc'), /checked Oct \d+/);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});
