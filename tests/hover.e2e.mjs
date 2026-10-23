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
async function page(opts, saved = SAVED) {
  const ctx = await browser.newContext({ ...opts, serviceWorkers: 'block' });
  await ctx.route(/gstatic\.com\/firebasejs/, (r) => r.abort());
  await ctx.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, [KEY, JSON.stringify(saved)]);
  const p = await ctx.newPage();
  // the app opens on Home (2026-10-22); these checks start on the flowchart, as they did before Home
  { const go = p.goto.bind(p); p.goto = async (...a) => { const r = await go(...a); await p.evaluate(() => { if (document.querySelector('#main')?.dataset.tab === 'home') document.querySelector('#tabs button[data-tab="flow"]')?.click(); }); return r; }; }
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

// a made-up audit in Wolverine Track's real row shape (Degree Works "Save as PDF" text), not a real student
const AUDIT = `Utah Valley University Doe, Jane Q - 00000000
Level Undergraduate    Classification Junior    Major Electrical Engineering    Program Electrical
Engineering-BS    College College of Engineering & Tech.    Catalog Year 2026-2027 (BS-EE1)
Bachelor of Science INCOMPLETE
New General Education COMPLETE
Course Title Grade Credits Term
ACADEMIC WRITING I ENGL 1010 Intro to Acad Writing CC TCR 3 2025 SUMMER
Satisfied by: AP ELGC0000 - English Language & Composition - Adv Pl - English Lang/Comp (3)
Electrical Engineering Core-BS INCOMPLETE
Course Title Grade Credits Term
Calculus I MATH 1210 Calculus I A 4 2025 FALL
Calculus II MATH 1220 Calculus II B+ 4 2026 SPRING
Intro to ECE ECE 1000 Intro to ECE IP (3) 2026 FALL`;
async function importAudit(p) {
  await p.click('#gear');
  await p.click('#importBtn');
  await p.fill('#impText', AUDIT);
  await p.click('#impGo');
  await p.waitForSelector('#impStep2:not([hidden])');
  await p.click('#impGo');
  await p.waitForTimeout(500);
}
const hintOf = async (p, id) => { await p.hover(box(id)); await p.waitForTimeout(100); return p.textContent('#hint'); };

test('fresh import: every taken class shows its month and year (transfer / AP rows too)', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  await ctx.route(/gstatic\.com\/firebasejs/, (r) => r.abort());
  const p = await ctx.newPage();
  // the app opens on Home (2026-10-22); these checks start on the flowchart, as they did before Home
  { const go = p.goto.bind(p); p.goto = async (...a) => { const r = await go(...a); await p.evaluate(() => { if (document.querySelector('#main')?.dataset.tab === 'home') document.querySelector('#tabs button[data-tab="flow"]')?.click(); }); return r; }; }
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(APP + '?p=' + EE);
  await p.waitForSelector(box('MATH 1210'));
  await importAudit(p);
  assert.equal(await hintOf(p, 'MATH 1210'), 'Aug 2025 · A');
  assert.equal(await hintOf(p, 'MATH 1220'), 'Jan 2026 · B+');
  assert.equal(await hintOf(p, 'ENGL 1010'), 'May 2025 · TCR');
  assert.equal(await p.$eval('#noDates', (e) => e.hidden), true);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('imported before terms were kept: "Taken · A" + a re-upload line that goes away after re-uploading', async () => {
  const OLD = { // what the old import saved: no settings.when
    plan: { programs: [EE], catalogYear: null },
    done: { [EE]: ['MATH 1210', 'MATH 1220', 'ENGL 1010', 'ECE 1000'] },
    grades: { [EE]: { 'MATH 1210': 'A', 'MATH 1220': 'B+', 'ENGL 1010': 'TCR', 'ECE 1000': 'IP' } },
    settings: { grades: true, src: { [EE]: { 'MATH 1210': 'audit', 'MATH 1220': 'audit', 'ENGL 1010': 'audit', 'ECE 1000': 'audit' } } },
    audit: { [EE]: { catalogYear: '2026-2027' } },
  };
  const p = await page({ viewport: { width: 1280, height: 800 } }, OLD);
  assert.equal(await hintOf(p, 'MATH 1210'), 'Taken · A');
  assert.equal(await p.$eval('#noDates', (e) => e.hidden), false);
  await p.click('#noDates [data-upload]');
  assert.ok(await p.$eval('#importDlg', (d) => d.open), 'the line opens Import');
  await p.click('#impBack');
  await importAudit(p);
  assert.equal(await hintOf(p, 'MATH 1210'), 'Aug 2025 · A');
  assert.equal(await p.$eval('#noDates', (e) => e.hidden), true);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});
