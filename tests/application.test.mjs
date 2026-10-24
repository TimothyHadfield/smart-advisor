// "Fill my application" (Tim, 2026-10-23: "what if the Cite automatically filled in your applicatoin based on the
// wolverine track that the student uploaded and then gave them links to where to submit it and whatnot?")
// js/application.js builds the answer sheet from an audit; scripts/build-applications.mjs reads each program's
// application page into data/applications.json.
// Run: node --test tests/application.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseAudit } from '../js/audit.js';
import { matricFacts } from '../js/matric.js';
import { auditExtras, answerSheet, sheetText, courseStatus, nextDeadline, byLetter, splitName } from '../js/application.js';
import { classify, lettersOf, nameOfEmail, FORMS, TYPICAL_FIELDS } from '../scripts/build-applications.mjs';

const read = (f) => JSON.parse(readFileSync(fileURLToPath(new URL(`../${f}`, import.meta.url)), 'utf8'));
const APPS = read('data/applications.json');

// Made-up student (same line shapes as a real Wolverine Track "Save as PDF" audit, 2026-10): AP credit
// (MATH 1210), a transfer class (MATH 1220 from another college), a class below C (PHYS 2220 C-), classes in
// progress (PHYS 2225, ECE 2250, ECE 2255, MATH 2210), classes not taken (ECE 2700, ECE 2705).
const AUDIT = readFileSync(fileURLToPath(new URL('./fixtures/apply-audit.txt', import.meta.url)), 'utf8');

// what the site keeps after an import (js/app.js wireImport): taken set, grades ('IP' in progress), terms
function imported(text) {
  const p = parseAudit(text);
  const done = new Set(), grades = {}, when = {};
  for (const r of p.taken) { done.add(r.code); grades[r.code] = r.grade; if (r.term) when[r.code] = r.term; }
  for (const r of p.inProgress) { done.add(r.code); grades[r.code] = 'IP'; if (r.term) when[r.code] = r.term; }
  return { done, grades, when, catalogYear: p.catalogYear };
}
const TODAY = new Date(2026, 9, 23);
const TERMS = { 202640: '2026-08-19', 202720: '2027-01-11' };

test('audit extras: name, UVID, overall GPA, AP and transfer sources', () => {
  const x = auditExtras(AUDIT);
  assert.equal(x.last, 'Doe');
  assert.equal(x.first, 'Jane');
  assert.equal(x.uvid, '10000001');
  assert.equal(x.gpa, '3.21');
  assert.deepEqual(x.sources['MATH 1210'], { course: 'AP Calculus BC', inst: 'College Board' });
  assert.deepEqual(x.sources['ENGL 1010'], { course: 'AP English Language & Composition', inst: 'College Board' });
  assert.deepEqual(x.sources['MATH 1220'], { course: 'MATH 1220 Calculus II', inst: 'Salt Lake Community College' });
  assert.equal(x.sources['PHYS 2210'], undefined);
  // no ID in the audit: blank (the student types it), never made up
  assert.equal(auditExtras(AUDIT.replace(/Student ID \d+\r?\n/, '').replace(/ - 10000001/g, '')).uvid, undefined);
});

test('EE answer sheet: the real form order, values from the audit, AP / transfer / in-progress / missing / below-C rows', () => {
  const s = imported(AUDIT);
  const app = APPS.programs['electrical-engineering-bs'];
  const sheet = answerSheet({ app, typical: APPS.fields, student: auditExtras(AUDIT), ...s, terms: TERMS, today: TODAY });
  assert.equal(sheet.known, true);
  assert.deepEqual(sheet.fields.map((f) => f.label), FORMS['electrical-engineering-bs'].fields);
  const v = Object.fromEntries(sheet.fields.map((f) => [f.label, f.value]));
  assert.equal(v['Last Name'], 'Doe');
  assert.equal(v['First Name'], 'Jane');
  assert.equal(v.Date, '10/23/2026');
  assert.equal(v.UVID, '10000001');
  assert.equal(v.Email, '10000001@uvu.edu');
  assert.equal(v['Cumulative GPA'], '3.21');
  assert.equal(v['Catalog Year'], '2025-2026');
  assert.equal(v['Advisor Name'], 'Emmery Leach', 'last name D: advisor A–H');
  // phone and address are never guessed
  for (const k of ['Phone', 'Address']) { assert.equal(v[k], ''); assert.equal(sheet.fields.find((f) => f.label === k).own, true); }
  assert.deepEqual(sheet.rows.map((r) => r.code), ['MATH 1210', 'MATH 1220', 'PHYS 2210', 'PHYS 2215', 'PHYS 2220', 'PHYS 2225', 'ECE 1000', 'CS 1400', 'ECE 2250', 'ECE 2255', 'ECE 2700', 'ECE 2705']);
  const row = Object.fromEntries(sheet.rows.map((r) => [r.code, r]));
  assert.deepEqual(row['MATH 1210'], { code: 'MATH 1210', status: 'ok', term: 'Summer 2025', grade: 'TCR', course: 'AP Calculus BC', inst: 'College Board' });
  assert.deepEqual(row['MATH 1220'], { code: 'MATH 1220', status: 'ok', term: 'Fall 2025', grade: 'TB+', course: 'MATH 1220 Calculus II', inst: 'Salt Lake Community College' });
  assert.deepEqual(row['PHYS 2210'], { code: 'PHYS 2210', status: 'ok', term: 'Spring 2026', grade: 'B', course: '', inst: '' });
  assert.deepEqual(row['PHYS 2225'], { code: 'PHYS 2225', status: 'ip', term: 'Fall 2026', grade: 'IP', course: '', inst: '' }, 'in progress: this semester + IP');
  assert.equal(row['PHYS 2220'].status, 'low');
  assert.equal(row['PHYS 2220'].grade, 'C-');
  assert.deepEqual(row['ECE 2700'], { code: 'ECE 2700', status: 'missing', term: '', grade: '', course: '', inst: '' });
  assert.match(sheet.rowNote, /Enter IP/);
  // the program page also lists MATH 2210 (the form has no row for it)
  assert.deepEqual(sheet.also, [{ code: 'MATH 2210', status: 'ip' }]);
});

test('readiness: course colors, GPA against 2.5, deadline two weeks before the next semester', () => {
  const s = imported(AUDIT);
  const sheet = answerSheet({ app: APPS.programs['electrical-engineering-bs'], student: auditExtras(AUDIT), ...s, terms: TERMS, today: TODAY });
  const by = Object.fromEntries(sheet.ready.courses.map((c) => [c.code, c.status]));
  assert.equal(by['MATH 1210'], 'ok');
  assert.equal(by['ECE 2250'], 'ip');
  assert.equal(by['PHYS 2220'], 'low');
  assert.equal(by['ECE 2705'], 'missing');
  assert.equal(by['MATH 2210'], 'ip');
  assert.equal(sheet.ready.minGpa, '2.5');
  assert.equal(sheet.ready.gpaOk, true);
  assert.deepEqual(sheet.ready.deadline, { date: '2026-12-28', start: '2027-01-11', term: 'Spring 2027' });
  // a low GPA fails the check; no term dates -> no date (the sheet states the rule instead)
  const low = answerSheet({ app: APPS.programs['electrical-engineering-bs'], student: { gpa: '2.31' }, today: TODAY });
  assert.equal(low.ready.gpaOk, false);
  assert.equal(low.ready.deadline, null);
  assert.match(low.ready.deadlineText, /two weeks prior to the start/);
  // after Spring's deadline: the next term with a date (none here)
  assert.equal(nextDeadline(TERMS, 2, new Date(2026, 11, 29)), null);
  assert.equal(nextDeadline(TERMS, 2, new Date(2026, 7, 1)).term, 'Fall 2026');
});

test('course status: C or better, transfer and pass credit count; below C, F, W do not', () => {
  const done = new Set(['A', 'B', 'C', 'D', 'E', 'F']);
  const grades = { A: 'C', B: 'TCR', C: 'C-', D: 'P', E: 'W', F: '' };
  assert.deepEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((c) => courseStatus(c, { done, grades })), ['ok', 'ok', 'low', 'ok', 'low', 'ok', 'missing']);
});

test('generic fallback: another gated program gets the typical fields and its catalog matriculation list', () => {
  const prog = read('data/programs/civil-engineering-bs.json');
  const app = APPS.programs['civil-engineering-bs'];
  const s = imported(AUDIT);
  const sheet = answerSheet({ app, typical: APPS.fields, before: matricFacts(prog).before, student: auditExtras(AUDIT), ...s, gpa: 3.4, today: TODAY });
  assert.equal(sheet.known, false);
  assert.deepEqual(sheet.fields.map((f) => f.label), TYPICAL_FIELDS);
  assert.deepEqual(sheet.rows.map((r) => r.code), matricFacts(prog).before);
  assert.equal(sheet.rows.find((r) => r.code === 'MATH 1210').course, 'AP Calculus BC');
  assert.deepEqual(sheet.also, []);
  assert.equal(sheet.fields.find((f) => f.label === 'Cumulative GPA').value, '3.21', "the audit's overall GPA wins over the computed one");
  // no audit facts: computed GPA, blank name/UVID/email for the student to type
  const bare = answerSheet({ app, typical: APPS.fields, before: ['MATH 1210'], gpa: 3.4, today: TODAY });
  assert.equal(bare.fields.find((f) => f.label === 'Cumulative GPA').value, '3.40');
  assert.deepEqual(bare.fields.filter((f) => f.own).map((f) => f.label), ['Last Name', 'First Name', 'UVID', 'Email', 'Phone', 'Catalog Year']);
  assert.match(sheetText(bare, 'Civil'), /^Civil\n\nLast Name: \nFirst Name: [\s\S]*MATH 1210 \| {2}\| {2}\| {2}\| $/);
});

test('names and last-name letter bands', () => {
  assert.deepEqual(splitName('Jane Q Doe'), { first: 'Jane', last: 'Doe' });
  assert.deepEqual(splitName(''), { first: '', last: '' });
  const bands = APPS.programs['electrical-engineering-bs'].advisorByLetter;
  assert.deepEqual(byLetter(bands, 'rogers'), { band: 'P–Z', name: null });
  assert.equal(byLetter(bands, 'Kim').name, 'Brittany Rogers');
  assert.equal(byLetter(bands, ''), null);
  assert.equal(nameOfEmail('Emmery.Leach@example.edu'), 'Emmery Leach');
  assert.equal(nameOfEmail('MMasoum@example.edu'), null);
});

// trimmed copy of the EE page's structure (2026-10-23), addresses replaced
const PAGE = `<html><head><title>Electrical Engineering Application | UVU</title></head><body><h1>Electrical Engineering Application</h1>
<p>A student not meeting all the admission requirements may be admitted with provisional status for one semester. Applications for admission to the electrical engineering program are accepted until two weeks prior to the start of a new semester.</p>
<h3>Foundational Coursework</h3><p>Complete foundational course work. A final grade of C or higher is required.</p><p>MATH 1210 - Calculus I MATH 2210 - Calculus III PHYS 2210/2215 - Physics I &amp; Lab</p>
<p>Maintain at least a 2.5 GPA</p><p>Meet with Academic Advisor</p>
<form data-adobesign-ldid="X" data-adobesign-name="Electrical Engineering Matriculation Form" data-adobesign-cc="a@example.edu">
<label for="studentFirstName">First Name:</label><input id="studentFirstName" name="studentFirstName" type="text" />
<label for="studentLastName">Last Name:</label><input id="studentLastName" name="studentLastName" type="text" />
<label for="suvid">UVID:</label><input id="suvid" name="suvid" type="text" />
<input id="Student_Email" name="Student_Email" type="hidden" data-adobesign-signer-order="1" /><input id="Advisor_Email" name="Advisor_Email" type="hidden" data-adobesign-signer-order="2" />
<input id="FacultyMentor_Email" name="FacultyMentor_Email" type="hidden" data-adobesign-signer-order="3" />
<button class="button-solid" type="submit">Start Application</button></form></body></html>`;
const JS = `if(first_letter.match(/^[A-H]*$/)) {\n\t\tsetAdvisor("Emmery.Leach@example.edu")\n\t}\n\telse if(first_letter.match(/^[P-Z]*$/)) {\n\t\tsetAdvisor("ArleneA@example.edu")`;

test('build script: reads an Adobe Sign start form, its rules and the advisor-by-letter script', () => {
  const r = classify(PAGE, 'https://www.uvu.edu/cet/ece/electrical-engineering/application.html');
  assert.equal(r.kind, 'adobesign');
  assert.deepEqual(r.form, { name: 'Electrical Engineering Matriculation Form', inputs: ['First Name', 'Last Name', 'UVID'], signers: ['Student', 'Advisor', 'Faculty Mentor'], button: 'Start Application' });
  assert.equal(r.minGpa, '2.5');
  assert.equal(r.minGrade, 'C');
  assert.equal(r.weeksBefore, 2);
  assert.equal(r.provisional, true);
  assert.deepEqual(r.pageCourses, ['MATH 1210', 'MATH 2210', 'PHYS 2210', 'PHYS 2215']);
  assert.deepEqual(lettersOf(JS, 'setAdvisor'), [{ from: 'A', to: 'H', name: 'Emmery Leach' }, { from: 'P', to: 'Z', name: null }]);
  const q = classify('<a href="https://uvu.qualtrics.com/jfe/form/SV_1">Apply</a>', 'https://www.uvu.edu/x/');
  assert.equal(q.kind, 'qualtrics');
  assert.equal(classify('<p>Meet your advisor.</p>', 'https://www.uvu.edu/x/').kind, 'none');
});

test('data/applications.json: every gated program with an apply page, EE form known, no e-mail addresses', () => {
  const adv = read('data/advisors.json').programs;
  const want = Object.keys(adv).filter((id) => adv[id].admissionUrl).sort();
  assert.deepEqual(Object.keys(APPS.programs).sort(), want);
  for (const [id, a] of Object.entries(APPS.programs)) {
    assert.equal(a.url, adv[id].admissionUrl, id);
    assert.ok(['adobesign', 'pdf', 'qualtrics', 'other', 'none'].includes(a.kind), id);
    if (a.link) assert.match(a.link, /^https:\/\//, id);
  }
  const ee = APPS.programs['electrical-engineering-bs'];
  assert.equal(ee.kind, 'adobesign');
  assert.equal(ee.known, true);
  assert.equal(ee.advisorByLetter.length, 3);
  assert.ok(Object.keys(APPS.terms).length >= 1);
  assert.doesNotMatch(JSON.stringify(APPS), /[\w.]+@[\w-]+\.\w+/, 'no e-mail addresses in the public data');
});
