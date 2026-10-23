// End-to-end: Hypothetical is a sandbox (Tim, 2026-10-22: "in the hypothetical if you select a class you're
// currently taking it says IP instead of just regularly selecting it in green. if it's hypothetical, none of
// your personal info should be shown, because the user is just testing things out."). Guest, Firebase
// blocked, headless WebKit as an iPhone 15 via Playwright from ~/.claude/tools. Made-up audit only.
//   1. serve the repo:   python -m http.server 8137 --bind 127.0.0.1
//   2. run:              node --test tests/hypo.e2e.mjs        (APP_URL=... for another address)
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
const CS = 'computer-science-bs';
// a made-up student with an imported audit: graded classes with terms, one class in progress (lecture + lab)
const SEED = {
  plan: { programs: [EE], catalogYear: null },
  done: { [EE]: ['ENGL 1010', 'MATH 1210', 'MATH 1220', 'CHEM 1210', 'CHEM 1215', 'ECE 1000', 'PHYS 2210', 'PHYS 2215', 'PHYS 2220', 'PHYS 2225', 'ECE 2250', 'ECE 2255', 'ph:7', 'ph:7=DANC 1010', 'DANC 1010'] },
  grades: { [EE]: { 'ENGL 1010': 'TCR', 'MATH 1210': 'A', 'MATH 1220': 'B+', 'CHEM 1210': 'B', 'CHEM 1215': 'A-', 'ECE 1000': 'A', 'PHYS 2210': 'B', 'PHYS 2215': 'A', 'PHYS 2220': 'B-', 'PHYS 2225': 'A', 'ECE 2250': 'IP', 'ECE 2255': 'IP', 'DANC 1010': 'B' } },
  settings: {
    max: 16, summers: false, start: null, grades: true,
    when: { 'MATH 1210': 'Fall 2025', 'MATH 1220': 'Spring 2026', 'ECE 1000': 'Fall 2025' },
    src: { [EE]: Object.fromEntries(['ENGL 1010', 'MATH 1210', 'MATH 1220', 'CHEM 1210', 'CHEM 1215', 'ECE 1000', 'PHYS 2210', 'PHYS 2215', 'PHYS 2220', 'PHYS 2225', 'ECE 2250', 'ECE 2255', 'ph:7', 'ph:7=DANC 1010', 'DANC 1010'].map((k) => [k, 'audit'])) },
  },
};
async function page(saved) {
  const ctx = await browser.newContext({ ...devices['iPhone 15'], serviceWorkers: 'block' });
  await ctx.route(/gstatic\.com\/firebasejs/, (r) => r.abort());
  await ctx.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, [KEY, JSON.stringify(saved)]);
  const p = await ctx.newPage();
  // the app opens on Home (2026-10-22); these checks start on the flowchart, as they did before Home
  { const go = p.goto.bind(p); p.goto = async (...a) => { const r = await go(...a); await p.evaluate(() => { if (document.querySelector('#main')?.dataset.tab === 'home') document.querySelector('#tabs button[data-tab="flow"]')?.click(); }); return r; }; }
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  return p;
}
const stored = (p) => p.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}'), KEY);
const sel = (id) => `.box[data-id="${id}"]`;
const pressed = async (p, id) => (await p.getAttribute(sel(id), 'aria-pressed')) === 'true';
const isIP = async (p, id) => /\bip\b/.test(await p.getAttribute(sel(id), 'class'));
const grade = (p, id) => p.textContent(`${sel(id)} .gr`);
// the hover label's text (shown while the box is hovered / held; tests/hover.e2e.mjs checks the showing)
const hintOf = (p, id) => p.getAttribute(sel(id), 'data-hint');

test('re-selecting an in-progress class in Hypothetical is plain green (no IP), and nothing personal shows', async () => {
  const p = await page(SEED);
  await p.goto(APP);
  await p.waitForSelector(sel('ECE 2250'), { state: 'attached' });
  // no taps yet: the student's own classes, as before
  assert.equal(await isIP(p, 'ECE 2250'), true);
  assert.equal(await grade(p, 'ECE 2250'), 'IP');
  assert.equal(await grade(p, 'MATH 1210'), 'A');
  // Tim's case: tap the class he is taking (off), then select it again
  await p.click(sel('ECE 2250'));
  assert.equal(await pressed(p, 'ECE 2250'), false);
  await p.click(sel('ECE 2250'));
  assert.equal(await pressed(p, 'ECE 2250'), true);
  assert.equal(await isIP(p, 'ECE 2250'), false, 'no in-progress look');
  assert.equal(await grade(p, 'ECE 2250'), '', 'no IP tag');
  assert.equal(await p.isVisible('#hyp'), true, 'still in Hypothetical');
  assert.equal(await p.getAttribute('#hypSeg button[data-v="hypo"]', 'class'), 'on');
  // no grades, no in-progress anywhere, no audit dates in hover labels, no Current legend
  assert.equal(await p.$$eval('#boxes .box.ip', (x) => x.length), 0);
  assert.deepEqual(await p.$$eval('#boxes .box .gr', (x) => x.map((e) => e.textContent).filter(Boolean)), []);
  assert.doesNotMatch(await p.textContent('#legendItems'), /Current/);
  assert.equal(await hintOf(p, 'MATH 1210'), 'Taken');
  assert.equal(await hintOf(p, 'ECE 2250'), 'Taken');
  // Classes: no GPA, no Current group, no grade badges
  await p.click('#tabs button[data-tab="plan"]');
  await p.click('#planSeg button[data-v="classes"]');
  await p.waitForSelector('#clList .cl-row');
  assert.equal(await p.isVisible('#clGpa'), false, 'no GPA line');
  const groups = await p.$$eval('#clList .cl-h', (els) => els.map((e) => e.firstChild.textContent));
  assert.ok(!groups.includes('Current') && !groups.includes('AP/CE'), `groups: ${groups}`);
  assert.deepEqual(await p.$$eval('#clList .gb', (x) => x.map((e) => e.textContent).filter(Boolean)), []);
  // class sheet from a Taken row: no grade pickers
  await p.click('#clList .cl-row:has(b:text-is("MATH 1210"))');
  await p.waitForSelector('#clsDlg[open]');
  assert.equal(await p.$$eval('#clsGrades select', (x) => x.length), 0, 'no grade picker');
  assert.equal(await p.isVisible('#editDlg[open]'), false, 'not the grade editor');
  await p.click('#clsDlg button.ok');
  // Actual: everything personal is back
  await p.click('#hypSeg button[data-v="actual"]');
  assert.equal(await p.isVisible('#clGpa'), true);
  assert.match(await p.textContent('#clGpa'), /GPA \d\.\d\d/);
  await p.click('#tabs button[data-tab="flow"]');
  assert.equal(await isIP(p, 'ECE 2250'), true);
  assert.equal(await grade(p, 'ECE 2250'), 'IP');
  assert.equal(await grade(p, 'MATH 1210'), 'A');
  assert.equal(await hintOf(p, 'MATH 1210'), 'Aug 2025 · A');
  assert.match(await p.textContent('#legendItems'), /Current/);
  // nothing saved changed
  const s = await stored(p);
  assert.deepEqual(s.grades[EE], SEED.grades[EE]);
  assert.deepEqual([...s.done[EE]].sort(), [...SEED.done[EE]].sort());
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('Hypothetical: the plan treats selected classes as passed (no low-grade retake); Actual keeps the retake', async () => {
  const p = await page({
    plan: { programs: [CS], catalogYear: null },
    done: { [CS]: ['CS 3450'] }, grades: { [CS]: { 'CS 3450': 'D' } },
    settings: { max: 16, summers: false, start: null, grades: true, when: {}, src: { [CS]: { 'CS 3450': 'audit' } } },
  });
  await p.goto(APP);
  await p.waitForSelector(sel('ENGL 1010'), { state: 'attached' });
  await p.click('#tabs button[data-tab="plan"]');
  assert.match(await p.textContent('#sems'), /CS 3450: a D is below/);
  await p.click('#tabs button[data-tab="flow"]');
  await p.click(sel('ENGL 1010'));
  await p.click('#tabs button[data-tab="plan"]');
  assert.doesNotMatch(await p.textContent('#sems'), /is below the/);
  await p.click('#hypSeg button[data-v="actual"]');
  assert.match(await p.textContent('#sems'), /CS 3450: a D is below/);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});
