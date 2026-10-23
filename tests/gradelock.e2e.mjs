// Grades from the imported audit are locked; grades the student set stay editable and can be cleared
// (guest, Firebase blocked, headless WebKit as an iPhone 15 via Playwright from ~/.claude/tools). Made-up data only.
//   1. serve the repo:   python -m http.server 8137 --bind 127.0.0.1
//   2. run:              node --test tests/gradelock.e2e.mjs
// Tim, 2026-10-23: "right now the user can change their grade to any class that they've taken and not have any way
// to move it back. If their transcript says they got a grade in a class they've taken, make sure it keeps that grade
// locked for that class so the user can't change it at all."
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
// MATH 1210 + MATH 1220 came from an audit (graded); ECE 1000 was marked taken by hand with a grade
const SEED = {
  plan: { programs: [EE], catalogYear: null },
  done: { [EE]: ['ENGL 1010', 'MATH 1210', 'MATH 1220', 'ECE 1000'] },
  grades: { [EE]: { 'ENGL 1010': 'A', 'MATH 1210': 'A', 'MATH 1220': 'B+', 'ECE 1000': 'B' } },
  settings: { max: 16, summers: false, start: null, grades: true, src: { [EE]: { 'ENGL 1010': 'audit', 'MATH 1210': 'audit', 'MATH 1220': 'audit', 'ECE 1000': 'added' } } },
};
async function page(saved) {
  const ctx = await browser.newContext({ ...devices['iPhone 15'], serviceWorkers: 'block' });
  await ctx.route(/gstatic\.com\/firebasejs/, (r) => r.abort());
  await ctx.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, [KEY, JSON.stringify(saved)]);
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  await p.goto(APP);
  await p.waitForSelector('#main[data-tab]');
  await p.evaluate(() => { if (document.querySelector('#main').dataset.tab === 'home') document.querySelector('#hmGo [data-go="flow"]').click(); });
  await p.waitForSelector('.box[data-id="MATH 1210"]');
  return p;
}
const grade = (p, code) => p.evaluate(([k, e, c]) => JSON.parse(localStorage.getItem(k)).grades[e][c], [KEY, EE, code]);
async function classesView(p) {
  await p.waitForFunction(() => !document.querySelector('dialog[open]'));
  await p.click('#back');
  await p.waitForSelector('#main[data-tab="home"]');
  await p.click('#hmGo [data-go="flow"]');
  await p.click('#fpSeg [data-v="plan"]');
  await p.click('#planSeg button[data-v="classes"]');
  await p.waitForSelector('#clList .cl-row');
}

test('an audit grade is locked: no picker on the class sheet or in Classes, shown as text "from audit", survives clicks', async () => {
  const p = await page(SEED);
  // class sheet
  await p.click('.box[data-id="MATH 1210"]');
  await p.waitForSelector('#clsDlg[open]');
  assert.equal(await p.$$eval('#clsGrades select, #clsGrades input', (x) => x.length), 0, 'no grade control');
  assert.match(await p.textContent('#clsGrades'), /\bA\b[\s\S]*from audit/);
  await p.click('#clsGrades');
  await p.keyboard.press('ArrowDown');
  assert.equal(await grade(p, 'MATH 1210'), 'A');
  await p.click('#clsDlg button.ok');
  // Classes: the edit sheet shows the grade as text; Taken | Current can't change it either
  await classesView(p);
  await p.click('#clList .cl-row:has(b:text-is("MATH 1220"))');
  await p.waitForSelector('#editDlg[open]');
  assert.equal(await p.isVisible('#edGrade'), false, 'no grade picker');
  assert.match(await p.textContent('#edGradeRow'), /B\+[\s\S]*from audit/);
  await p.click('#edSeg button[data-s="ip"]', { force: true }).catch(() => {});
  await p.click('#edGradeRow');
  await p.click('#edSave');
  assert.equal(await grade(p, 'MATH 1220'), 'B+');
  // the GPA still counts it
  assert.match(await p.textContent('#clGpa'), /GPA \d\.\d\d/);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('a grade the student set stays editable and can be cleared back to no grade', async () => {
  const p = await page(SEED);
  await p.click('.box[data-id="ECE 1000"]');
  await p.waitForSelector('#clsDlg[open]');
  const opts = await p.$$eval('#clsGrades select[data-code="ECE 1000"] option', (os) => os.map((o) => [o.value, o.textContent]));
  assert.deepEqual(opts[0], ['', 'No grade'], 'a clear way back to no grade');
  await p.selectOption('#clsGrades select[data-code="ECE 1000"]', 'A-');
  assert.equal(await grade(p, 'ECE 1000'), 'A-');
  await p.selectOption('#clsGrades select[data-code="ECE 1000"]', '');
  assert.equal(await grade(p, 'ECE 1000'), '');
  await p.click('#clsDlg button.ok');
  assert.equal(await p.$eval('.box[data-id="ECE 1000"]', (b) => b.querySelector('.gr')?.textContent || ''), '', 'no grade on the box');
  // and in Classes
  await classesView(p);
  await p.click('#clList .cl-row:has(b:text-is("ECE 1000"))');
  await p.waitForSelector('#editDlg[open]');
  assert.ok(await p.isVisible('#edGrade'));
  await p.selectOption('#edGrade', 'C');
  assert.equal(await grade(p, 'ECE 1000'), 'C');
  await p.selectOption('#edGrade', '');
  assert.equal(await grade(p, 'ECE 1000'), '');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});
