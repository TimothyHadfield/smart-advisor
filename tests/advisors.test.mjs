// data/advisors.json: every program (both catalog years) has an advisor page to book with, and every link
// is a well-formed https UVU link. Plus the pure helpers the page uses to show "Schedule with an advisor".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { advisorLink, gatedNeed } from '../js/uistate.js';

const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const advisors = read('data/advisors.json').programs;
const index = read('data/programs/index.json').programs;
const ids = new Set([...index.map((p) => p.id), ...read('data/programs/_year.json').programs.map((p) => p.id), ...read('data/2025-2026/programs/_year.json').programs.map((p) => p.id)]);

test('every program in both catalog years has an advisor entry', () => {
  assert.ok(ids.size > 500, `${ids.size} programs`);
  const missing = [...ids].filter((id) => !advisors[id]?.advisingUrl);
  assert.deepEqual(missing, []);
});

// UVU's own pages (www.uvu.edu); a booking link may also be UVU's Navigate tenant (uvu.campus.eab.com)
const UVU = /^https:\/\/www\.uvu\.edu\/[\w./#-]*$/;
const BOOK = /^https:\/\/(appointments\.uvu\.edu\/\w+|uvu\.campus\.eab\.com\/pal\/[\w-]+)$/;
test('advisor links are well-formed https UVU links', () => {
  for (const [id, a] of Object.entries(advisors)) {
    assert.ok(a.name && typeof a.name === 'string', `${id} name`);
    assert.match(a.advisingUrl, UVU, `${id} advisingUrl`);
    assert.doesNotThrow(() => new URL(a.advisingUrl));
    if (a.scheduleUrl) assert.match(a.scheduleUrl, BOOK, `${id} scheduleUrl`);
    if (a.admissionUrl) assert.match(a.admissionUrl, UVU, `${id} admissionUrl`);
    assert.match(a.source, UVU, `${id} source`);
    assert.ok(a.level === 'department' || a.level === 'college', `${id} level`);
  }
});

test('the programs Tim checks point at their own department', () => {
  assert.equal(advisors['electrical-engineering-bs'].advisingUrl, 'https://www.uvu.edu/cet/advising/ece/index.html');
  assert.match(advisors['electrical-engineering-bs'].admissionUrl, /electrical-engineering\/application/);
  assert.equal(advisors['nursing-bs'].advisingUrl, 'https://www.uvu.edu/nursing/advising.html');
});

test('advisorLink: booking link first, else the advising page; none for an unknown program', () => {
  const data = { a: { advisingUrl: 'https://www.uvu.edu/x/', scheduleUrl: 'https://appointments.uvu.edu/y' }, b: { advisingUrl: 'https://www.uvu.edu/z/' } };
  assert.equal(advisorLink(data, 'a'), 'https://appointments.uvu.edu/y');
  assert.equal(advisorLink(data, 'b'), 'https://www.uvu.edu/z/');
  assert.equal(advisorLink(data, 'nope'), null);
  assert.equal(advisorLink(null, 'a'), null);
});

test('gatedNeed: program acceptance / matriculation counts, Advanced Standing alone does not', () => {
  assert.equal(gatedNeed({ gate: 'admission' }, []), true);
  assert.equal(gatedNeed({}, ['admission']), true);
  assert.equal(gatedNeed({ prereqWords: ['Formal Acceptance into the Electrical Engineering Program'] }, []), true);
  assert.equal(gatedNeed({ prereqWords: ['Matriculation into Business program'] }, []), true);
  assert.equal(gatedNeed({}, ['advanced-standing']), false);
  assert.equal(gatedNeed({ prereqWords: ['University Advanced Standing'] }, []), false);
  assert.equal(gatedNeed({}, []), false);
});
