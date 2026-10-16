// Gen Ed lists: the catalog page parser (fixtures cut from the real 2026-2027 and 2025-2026 pages) and the
// box-label matcher (every Gen Ed box label in every program file).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parseGenEd } from '../scripts/fetch-gened.mjs';
import { areasFor, genEdList, filterList, pickedOf, withPick, pickKeysOf } from '../js/gened.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const cur = parseGenEd(read('./fixtures/gened-2026-2027.html'));
const old = parseGenEd(read('./fixtures/gened-2025-2026.html'));
const area = (g, key, aas = false) => g.areas.find((a) => a.key === key && !!a.aas === aas);

test('parser: every BA/BS area, with real course counts', () => {
  const counts = Object.fromEntries(cur.areas.filter((a) => !a.aas).map((a) => [a.key, a.courses.length]));
  assert.deepEqual(Object.keys(counts), ['wc', 'ql', 'ai', 'pg', 'arts', 'hum', 'life', 'phys', 'soc']);
  for (const [k, n] of Object.entries(counts)) assert.ok(n >= 3, `${k}: ${n}`);
  assert.equal(area(cur, 'life').courses.length, 11);
  assert.equal(area(cur, 'pg').name, 'Personal, Professional, and Civic Growth');
  assert.equal(area(cur, 'soc').name, 'Social and Behavioral Sciences');
  assert.equal(area(old, 'soc').name, 'Social Sciences');
  assert.equal(area(cur, 'arts').credits, 3);
});

test('parser: titles, credits, "or" rows and 1040/1040H codes become alts', () => {
  const life = area(cur, 'life').courses;
  assert.deepEqual(life[0], { code: 'BIOL 1010', alts: ['BIOL 1010H'], title: 'General Biology', credits: 3 });
  assert.deepEqual(life.find((c) => c.code === 'BIOL 1610'), { code: 'BIOL 1610', title: 'College Biology I', credits: 4 });
  const pg = area(cur, 'pg').courses;
  assert.deepEqual(pg.find((c) => c.code === 'PHIL 2050').alts, ['PHIL 2050G', 'PHIL 2050H']);
  assert.ok(!pg.some((c) => c.code === 'PHIL 2050G'), 'an "or" row is not its own class');
  // "Introduction to Academic Writing (3)" -> title without the credits, credits 3
  const wc = area(cur, 'wc').courses.find((c) => c.code === 'ENGL 1010');
  assert.equal(wc.title, 'Introduction to Academic Writing');
  assert.equal(wc.credits, 3);
  // "HIST 2700 & HIST 2710" in one row; footnote marks (<sup>1</sup>) and "(Complete 3 credits:)" dropped
  assert.deepEqual(area(cur, 'ai').courses.find((c) => c.code === 'HIST 2700'),
    { code: 'HIST 2700', and: ['HIST 2710'], title: 'US History to 1877 and US History since 1877', credits: 6 });
  assert.equal(area(cur, 'soc').courses.find((c) => c.code === 'HIST 1740').title, 'US Economic History');
  assert.equal(area(cur, 'wc', true).courses[0].title, 'Introduction to Academic Writing');
  for (const a of cur.areas) for (const c of a.courses) {
    assert.match(c.code, /^[A-Z]{2,5} \d{4}[A-Z]?$/, c.code);
    assert.ok(c.title, `${c.code} has a title`);
  }
});

test('parser: Applied Science lists are separate (aas)', () => {
  assert.ok(area(cur, 'ql', true), 'AAS math list');
  assert.ok(area(cur, 'ql', true).courses.length < area(cur, 'ql').courses.length + 10);
  assert.ok(!cur.areas.some((a) => a.aas && !['wc', 'ql'].includes(a.key)));
});

test('parser: a missing credit value comes from courses.json', () => {
  const html = '<h2>General Education Requirements</h2><h3>Breadth Area Requirements</h3><h4>Arts</h4><table class="sc_courselist"><tbody>'
    + `<tr class="odd"><td class="codecol"><a href="/search/?P=DANC%201010" title="DANC 1010" class="bubblelink code" onclick="return showCourse(this, 'DANC 1010');">DANC 1010</a></td><td></td><td class="hourscol"></td></tr>`
    + '</tbody></table>';
  const g = parseGenEd(html, { courses: { 'DANC 1010': { title: 'Dance Appreciation', credits: 3 } } });
  assert.deepEqual(g.areas[0].courses[0], { code: 'DANC 1010', title: 'Dance Appreciation', credits: 3 });
});

test('matcher: box labels -> areas', () => {
  const cases = {
    'Fine Arts Distribution': ['arts'],
    'Fine Arts Distirbution': ['arts'],
    'Humanities Distribution': ['hum'],
    'Humanties Distribution': ['hum'],
    'Humantities Distribution': ['hum'],
    'Humanities Distribution (2020G/2020 foreign language course)': ['hum'],
    'Biology Distribution': ['life'],
    'Life Sciences': ['life'],
    'Physical Science Distribution': ['phys'],
    'Social/Behavioral Science Distribution': ['soc'],
    'Social/Behavorial Science (Recommend COMM 1050 Introduction to Speech Communication)': ['soc'],
    'American Institutions': ['ai'],
    'US Institutions': ['ai'],
    'History/PoliSci/American Institutions': ['ai'],
    'Quantitative Literacy': ['ql'],
    'Math QL': ['ql'],
    'Mathematics GE': ['ql'],
    'English GE': ['wc'],
    'Personal, Professional, and Civic Growth Distribution': ['pg'],
    'Personal, Professional, & Civic Growth': ['pg'],
    'Biology or Physical Science': ['life', 'phys'],
    'Humanities/Art (COMM 1020 Recommended)': ['arts', 'hum'],
    'Humanities (Recommend ENGL 2030 Writing for Social Change)': ['hum'],
    'Fine Arts (Choose from list: https://www.uvu.edu/catalog/current/policies-requirements/general-education.html)': ['arts'],
    'Any approved Behavioral Science, Social, or Political Science Distribution Course': ['soc'],
    'Choose nine credits from the following areas:': [],
    'Complete one of the following:': [],
    'Elective': [],
  };
  for (const [label, want] of Object.entries(cases)) assert.deepEqual(areasFor(label), want, label);
});

// every Gen Ed box in every program file (both catalog years)
function genEdBoxes() {
  const out = [];
  for (const dir of ['../data/programs/', '../data/2025-2026/programs/']) {
    for (const f of readdirSync(new URL(dir, import.meta.url))) {
      if (!f.endsWith('.json') || f.startsWith('_') || f === 'index.json') continue;
      const p = JSON.parse(read(dir + f));
      for (const r of p.requirements || []) {
        if ((r.type === 'placeholder' || r.type === 'choice') && /general\s+education/i.test(r.area || '')) out.push({ ...r, file: dir + f });
      }
    }
  }
  return out;
}
// labels that name no single area (generic "choose one", pick-from-several-areas, any GE course)
const GENERIC = /following|^choose \d+$|any 3-credit|any other ge|^elective$|^choose (nine|six|9|6)|any 2020g\/2020 foreign/i;

test('matcher: every Gen Ed box label in the program files', () => {
  const boxes = genEdBoxes();
  const matched = boxes.filter((b) => areasFor(b.label).length);
  const missed = boxes.filter((b) => !areasFor(b.label).length);
  const labels = [...new Set(missed.map((b) => b.label))];
  console.log(`Gen Ed boxes: ${boxes.length}, matched ${matched.length}, unmatched ${missed.length} (${labels.length} labels)`);
  console.log('unmatched labels:\n  ' + labels.join('\n  '));
  assert.ok(boxes.length > 2500, `${boxes.length} boxes`);
  // only generic labels may miss (a foreign-language box lists Humanities, which is fine either way)
  const real = labels.filter((l) => !GENERIC.test(l));
  assert.deepEqual(real, []);
  // with choice boxes' own options, every unmatched choice box still gets a list
  const listless = missed.filter((b) => b.type === 'placeholder');
  assert.ok(listless.length < 40, `${listless.length} placeholder boxes without a list`);
});

test('genEdList: placeholder -> area list; choice -> its own options; other boxes -> null', () => {
  const ph = { kind: 'placeholder', id: 'ph:8', label: 'Fine Arts Distribution', area: 'General Education Requirements' };
  const l = genEdList(ph, cur);
  assert.equal(l.groups.length, 1);
  assert.equal(l.groups[0].key, 'arts');
  assert.ok(l.groups[0].courses.some((c) => c.code === 'DANC 1010'));
  const both = genEdList({ ...ph, label: 'Biology or Physical Science' }, cur);
  assert.deepEqual(both.groups.map((g) => g.key), ['life', 'phys']);
  const ch = { kind: 'choice', id: 'choice:3', label: 'American Institutions', area: 'General Education Requirements',
    options: [{ codes: ['HIST 2700', 'HIST 2710'], credits: 6 }, { codes: ['POLS 1100'], credits: 3 }] };
  const cl = genEdList(ch, cur, { courses: { 'POLS 1100': { title: 'American National Government' } } });
  assert.deepEqual(cl.groups[0].courses.map((c) => c.code), ['HIST 2700 + HIST 2710', 'POLS 1100']);
  assert.equal(cl.groups[0].courses[1].title, 'American National Government');
  assert.equal(genEdList({ ...ph, area: 'Discipline Core Requirements' }, cur), null);
  assert.equal(genEdList({ ...ph, label: 'Choose nine credits from the following areas:' }, cur), null);
  assert.equal(genEdList({ kind: 'course', code: 'ECE 2250', area: 'General Education Requirements' }, cur), null);
  // an AAS program gets the AAS math list
  const aasQl = genEdList({ ...ph, label: 'Math QL' }, cur, { aas: true });
  assert.deepEqual(aasQl.groups[0].courses, area(cur, 'ql', true).courses);
});

test('filterList: code, code without space, title words', () => {
  const l = genEdList({ kind: 'placeholder', label: 'Fine Arts', area: 'General Education' }, cur);
  assert.ok(filterList(l, 'danc1010')[0].courses.some((c) => c.code === 'DANC 1010'));
  assert.ok(filterList(l, 'DANC 1010')[0].courses.every((c) => c.code.startsWith('DANC 1010')));
  assert.deepEqual(filterList(l, 'zzzz'), []);
  assert.equal(filterList(l, '').length, 1);
});

test('picked class lives in the taken list as "<box id>=<code>"', () => {
  let s = new Set(['ENGL 1010']);
  s = withPick(s, 'ph:8', 'DANC 1010');
  assert.deepEqual([...s], ['ENGL 1010', 'ph:8', 'ph:8=DANC 1010']);
  assert.equal(pickedOf(s, 'ph:8'), 'DANC 1010');
  s = withPick(s, 'ph:8', 'ART 1010');
  assert.equal(pickedOf(s, 'ph:8'), 'ART 1010');
  assert.deepEqual(pickKeysOf(s, 'ph:8'), ['ph:8=ART 1010']);
  assert.equal(pickedOf(s, 'ph:9'), null);
  // a minor's box id has a slash; a choice adds the option's codes too
  s = withPick(s, 'history-minor/choice:2', 'HIST 1700', ['HIST 1700']);
  assert.equal(pickedOf(s, 'history-minor/choice:2'), 'HIST 1700');
  assert.ok(s.has('HIST 1700'));
});
