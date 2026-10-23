// Hover glossary data + matcher (js/glossary.js, data/glossary.json)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileGlossary, findTerms } from '../js/glossary.js';

const data = JSON.parse(readFileSync(new URL('../data/glossary.json', import.meta.url), 'utf8'));
const g = compileGlossary(data);
const ids = (text, seen) => findTerms(text, g, seen).map((h) => [text.slice(h.start, h.end), h.id]);

test('every term: a short definition (under 15 words), a UVU source page, a source label', () => {
  assert.ok(data.terms.length >= 30, `${data.terms.length} terms`);
  const seen = new Set();
  for (const t of data.terms) {
    assert.ok(!seen.has(t.id), `duplicate ${t.id}`); seen.add(t.id);
    assert.ok(t.term && t.def && t.label, t.id);
    assert.ok(t.def.split(/\s+/).length <= 15, `${t.id}: ${t.def.split(/\s+/).length} words`);
    assert.match(t.url, /^https:\/\/(www\.|catalog\.)?uvu\.edu\//, t.id);
    assert.ok((t.phrases || []).length + (t.words || []).length + (t.exact || []).length + (t.pattern ? 1 : 0) > 0, `${t.id} matches nothing`);
  }
  // every term the brief named
  for (const id of ['advanced-standing', 'acceptance', 'matriculation', 'prerequisite', 'corequisite', 'pre-or-co', 'gened', 'distribution',
    'american-institutions', 'upper-division', 'elective', 'pick-n', 'credit-hours', 'catalog-year', 'waitlist', 'crn', 'ip', 'w', 'au',
    'repeat', 'ap-clep', 'transfer', 'residency', 'wolverine-track']) assert.ok(seen.has(id), id);
});

test('Advanced Standing says UVU\'s real rule (math + ENGL 2010), not a guessed credit/GPA rule', () => {
  const t = data.terms.find((x) => x.id === 'advanced-standing');
  assert.match(t.def, /MAT 1030/);
  assert.match(t.def, /ENGL 2010/);
  assert.doesNotMatch(t.def, /GPA|30\+? credits/);
});

test('finds terms in sentences: longest phrase wins, any case, whole words only', () => {
  assert.deepEqual(ids('ECE 4730 and University Advanced Standing'), [['University Advanced Standing', 'advanced-standing']]);
  assert.deepEqual(ids('Needs advanced standing first'), [['advanced standing', 'advanced-standing']]);
  assert.deepEqual(ids('Any Free elective'), [['Free elective', 'free-elective']]);
  assert.deepEqual(ids('Pick 9 cr · Math electives'), [['Pick 9 cr', 'pick-n'], ['electives', 'elective']]);
  assert.deepEqual(ids('C- or higher'), [['C- or higher', 'grade-min']]);
  assert.deepEqual(ids('Copy CRNs'), [['CRNs', 'crn']]);
  assert.deepEqual(ids('the crn of it'), [], 'abbreviations keep their case');
  assert.deepEqual(ids('Selectives'), [], 'not inside a longer word');
  assert.deepEqual(ids('Requires admission — apply after these classes.'), [['Requires admission', 'acceptance']]);
});

test('exact terms only when they are the whole text (a grade badge "W", Home\'s "Catalog" label)', () => {
  assert.deepEqual(ids('W'), [['W', 'w']]);
  assert.deepEqual(ids(' IP '), [['IP', 'ip']]);
  assert.deepEqual(ids('Catalog'), [['Catalog', 'catalog-year']]);
  assert.deepEqual(ids('W 2nd floor'), []);
  assert.deepEqual(ids('Catalog 2026-27'), []);
});

test('each term is marked once per block (seen set carries over)', () => {
  const seen = new Set();
  assert.equal(ids('Gen Ed and Gen Ed', seen).length, 1);
  assert.equal(ids('more Gen Ed', seen).length, 0);
});
