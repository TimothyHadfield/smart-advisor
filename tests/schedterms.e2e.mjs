// The Schedule section (Tim, 2026-10-23), end to end in headless WebKit (guest, Firebase blocked):
//   short titles on the week grid (Labels Code / Title / Both), the full time range in bright numbers,
//   class blocks in the list, the Past | Current | Future term bar from a synthetic audit, past and future
//   terms as lists, a plan semester heading that opens the Schedule on that term, a list a third wide.
//   1. serve the repo:   python -m http.server 8137 --bind 127.0.0.1
//   2. run:              node --test tests/schedterms.e2e.mjs        (APP_URL=... for another address)
// Real data/sections (Fall 2026 + Spring 2027); the page's clock is pinned to 2026-10-23. Never Tim's audit.
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
const AUDIT = ['ENGL 1010', 'MATH 1210', 'MATH 1220', 'CHEM 1210', 'ECE 1000', 'PHYS 2210', 'MATH 2210', 'ECE 2250'];
// a made-up audit import: two past terms with grades, two classes in progress this term
const SAVED = {
  plan: { programs: [EE], catalogYear: null },
  done: { [EE]: AUDIT },
  grades: { [EE]: { 'ENGL 1010': 'A', 'MATH 1210': 'B+', 'MATH 1220': 'A-', 'CHEM 1210': 'C+', 'ECE 1000': 'A', 'PHYS 2210': 'B', 'MATH 2210': 'IP', 'ECE 2250': 'IP' } },
  settings: {
    max: 16, summers: false, start: null, grades: true, lastTerm: 'Fall 2026',
    src: { [EE]: Object.fromEntries(AUDIT.map((c) => [c, 'audit'])) },
    when: { 'ENGL 1010': 'Fall 2025', 'MATH 1210': 'Fall 2025', 'CHEM 1210': 'Fall 2025', 'ECE 1000': 'Fall 2025', 'MATH 1220': 'Spring 2026', 'PHYS 2210': 'Spring 2026', 'MATH 2210': 'Fall 2026', 'ECE 2250': 'Fall 2026' },
  },
};
const NO_AUDIT = { plan: { programs: [EE], catalogYear: null }, done: {}, grades: {}, settings: { max: 16, summers: false, start: null, grades: true } };

async function page(saved, { desktop = false } = {}) {
  const ctx = await browser.newContext(desktop ? { viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' } : { ...devices['iPhone 15'], viewport: { width: 393, height: 659 }, serviceWorkers: 'block' });
  await ctx.route(/gstatic\.com\/firebasejs/, (r) => r.abort());
  await ctx.addInitScript(() => { const T = new Date('2026-10-23T12:00:00').getTime(), D = Date; globalThis.Date = class extends D { constructor(...a) { super(...(a.length ? a : [T])); } static now() { return T; } }; });
  await ctx.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, [KEY, JSON.stringify(saved)]);
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  await p.goto(APP);
  await p.waitForSelector('#hmGo [data-go="sched"]');
  return p;
}
async function openSched(p) {
  await p.waitForFunction(() => /\d/.test(document.querySelector('#hmGoSched')?.textContent || '')); // the plan is in
  await p.click('#hmGo [data-go="sched"]');
  await p.waitForSelector('#main[data-tab="sched"]');
}
const termsOf = (p, g) => p.$$eval(`#scTerms .tg-${g}:not([hidden]) button`, (els) => els.map((e) => e.dataset.term));
const visibleBlocks = (p) => p.$$eval('#scWeek .wk-b', (els) => els.map((el) => {
  const vis = (q) => { const x = el.querySelector(q); return x && getComputedStyle(x).display !== 'none' ? x.textContent : null; };
  const t = el.querySelector('.wtm'), cs = getComputedStyle(t);
  return { title: vis('.wt'), code: vis('.wc'), time: vis('.wtm'), color: cs.color, fg: getComputedStyle(document.body).color, size: parseFloat(cs.fontSize), weight: +cs.fontWeight,
    clipped: t.offsetTop + t.offsetHeight > el.clientHeight + 1 };
}));

test('week grid: short titles by default, Code / Both in the schedule controls, full time range in bright numbers', async () => {
  const p = await page(SAVED, { desktop: true });
  await openSched(p);
  await p.click('#scTerms button[data-term="202720"]');
  await p.waitForSelector('#scWeek .wk-b');
  let b = await visibleBlocks(p);
  const cs = b.find((x) => x.title === 'Intro to Programming');
  assert.ok(cs, `CS 1400 shows its short title: ${JSON.stringify(b.map((x) => x.title))}`);
  assert.ok(b.every((x) => x.code === null), 'Title: no code on the blocks');
  for (const x of b) {
    assert.match(x.time, /^\d{1,2}(:\d\d)?–\d{1,2}(:\d\d)?$/, 'start–end, e.g. 10–10:50');
    assert.equal(x.color, x.fg, 'the time is full-strength text');
    assert.ok(x.size >= 12 && x.weight >= 700, 'the time is big and bold');
    assert.equal(x.clipped, false, 'the time is never cut off');
  }
  assert.ok(b.some((x) => x.time === '10–10:50'), 'MWF 10-10:50 class');
  // the list: title big first, code small beside it, one fact per line, a line between classes
  const row = await p.$eval('#scList .sc-row', (el) => ({ big: el.querySelector('.sc-name b').textContent, small: el.querySelector('.sc-name small')?.textContent, lines: el.querySelectorAll('.sc-ln').length,
    lnSize: parseFloat(getComputedStyle(el.querySelector('.sc-ln')).fontSize), border: getComputedStyle(el).borderBottomWidth }));
  assert.ok(!/^[A-Z]{2,5} \d{4}$/.test(row.big) && /^[A-Z]{2,5} \d{4}$/.test(row.small), JSON.stringify(row));
  assert.ok(row.lines >= 4 && row.lnSize >= 14 && row.border === '1px', JSON.stringify(row));
  const cl = await p.$eval('#scList', (el) => el.innerText);
  assert.match(cl, /MWF 10–10:50/, 'days + full time');
  assert.match(cl, /CRN \d{5}/);
  assert.match(cl, /\d+ cr/);
  // Code, then Both (the same setting as the flowchart's)
  await p.click('#scLbl button[data-v="code"]');
  b = await visibleBlocks(p);
  assert.ok(b.every((x) => x.title === null && /^[A-Z]{2,5} \d{4}$/.test(x.code)), 'Code: codes on the blocks');
  assert.match(await p.$eval('#scList .sc-name b', (e) => e.textContent), /^[A-Z]{2,5} \d{4}$/, 'Code: the list leads with the code');
  await p.click('#scLbl button[data-v="both"]');
  b = await visibleBlocks(p);
  assert.ok(b.some((x) => x.title && x.code), 'Both: title and code where there is room');
  assert.equal(await p.getAttribute('#lblSeg button[data-v="both"]', 'aria-pressed'), 'true', 'the flowchart control follows');
  // the list is about a third of the section
  const w = await p.evaluate(() => document.querySelector('#scList').getBoundingClientRect().width / document.querySelector('#schedPanel').getBoundingClientRect().width);
  assert.ok(w >= 0.30 && w <= 0.36, `list width ${w.toFixed(3)}`);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('term bar: Past (audit) | Current (now + published next term) | Future (plan); past and future as lists', async () => {
  const p = await page(SAVED);
  await openSched(p);
  await p.waitForSelector('#scTerms .tg-current button');
  assert.deepEqual(await termsOf(p, 'past'), ['202540', '202620'], 'Fall 2025, Spring 2026 from the audit');
  assert.deepEqual(await termsOf(p, 'current'), ['202640', '202720'], 'Spring 2027 sections are out: Current');
  const fut = await termsOf(p, 'future');
  assert.ok(fut.length >= 2 && fut[0] === '202740' && fut.every((c) => c > '202720'), JSON.stringify(fut));
  // left, middle, right order in the strip; the page never scrolls sideways
  assert.deepEqual(await p.$$eval('#scTerms .sc-tl', (e) => e.map((x) => x.textContent)), ['Past', 'Current', 'Future']);
  assert.ok(await p.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth), 'no page sideways scroll');
  // a past term: its audit classes with grades, no week grid
  await p.click('#scTerms button[data-term="202540"]');
  await p.waitForFunction(() => document.querySelector('#schedPanel').classList.contains('list-term'));
  assert.equal(await p.isVisible('#scWeek'), false, 'no week grid');
  const past = await p.$$eval('#scList .sc-row', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
  assert.equal(past.length, 4);
  assert.ok(past.some((r) => /^Calc 1 MATH 1210 Grade B\+ · 4 cr$/.test(r)), JSON.stringify(past));
  assert.ok(past.some((r) => /CHEM 1210 Grade C\+/.test(r)));
  // a future term: the plan's classes with their status
  await p.click(`#scTerms button[data-term="${fut[0]}"]`);
  await p.waitForFunction(() => /Planned/.test(document.querySelector('#scList').innerText));
  const later = await p.$$eval('#scList .sc-row', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
  assert.ok(later.length >= 3 && later.every((r) => /Planned · \d+ cr/.test(r)), JSON.stringify(later));
  // back to a term with sections: the week grid again
  await p.click('#scTerms button[data-term="202720"]');
  await p.waitForSelector('#scWeek .wk-b');
  assert.equal(await p.evaluate(() => document.querySelector('#schedPanel').classList.contains('list-term')), false);
  // phone: every block keeps its time in view
  assert.ok((await visibleBlocks(p)).every((x) => !x.clipped && x.time), 'time never dropped at 393 px');
  assert.ok(await p.evaluate(() => document.scrollingElement.scrollHeight <= innerHeight + 1), 'no page scroll');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('no audit: no Past group', async () => {
  const p = await page(NO_AUDIT);
  await openSched(p);
  await p.waitForSelector('#scTerms .tg-current button');
  assert.deepEqual(await termsOf(p, 'past'), []);
  assert.equal(await p.isVisible('#scTerms .tg-past'), false);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('a plan semester heading opens the Schedule on that term; Back returns to the plan', async () => {
  for (const desktop of [false, true]) {
    const p = await page(SAVED, { desktop });
    const from = desktop ? 'flow' : 'plan';
    await p.waitForFunction(() => /\d/.test(document.querySelector('#hmGoSched')?.textContent || ''));
    await p.click(`#hmGo [data-go="${from}"]`);
    await p.waitForSelector('#sems .sem-go');
    const h = await p.$$eval('#sems .sem-go', (els) => els.map((e) => e.dataset.term));
    const label = h[2]; // a later semester (no sections yet)
    await p.click(`#sems .sem-go[data-term="${label}"]`);
    await p.waitForSelector('#main[data-tab="sched"]');
    const [season, year] = label.split(' ');
    const code = `${year}${{ Spring: 20, Summer: 30, Fall: 40 }[season]}`;
    await p.waitForSelector(`#scTerms button.on[data-term="${code}"]`);
    await p.waitForFunction(() => /Planned/.test(document.querySelector('#scList').innerText));
    await p.click('#back');
    await p.waitForSelector(`#main[data-tab="${from}"]`);
    // and the browser's Back does the same
    await p.click(`#sems .sem-go[data-term="${h[0]}"]`);
    await p.waitForSelector('#main[data-tab="sched"]');
    await p.goBack();
    await p.waitForSelector(`#main[data-tab="${from}"]`);
    // from Home, the arrow still goes Home
    await p.click('#back');
    await p.waitForSelector('#main[data-tab="home"]');
    await openSched(p);
    await p.click('#back');
    await p.waitForSelector('#main[data-tab="home"]');
    assert.deepEqual(p.errors, []);
    await p.context().close();
  }
});
