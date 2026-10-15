// Run: node tests/audit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseAudit, matchAudit, codesIn, gradeInfo } from '../js/audit.js';
import { buildModel } from '../js/planner.js';

const ee = JSON.parse(readFileSync(fileURLToPath(new URL('../data/programs/ee-bs.json', import.meta.url)), 'utf8'));
const model = buildModel(ee);
const codes = (list) => list.map((r) => r.code).sort();

// Anonymized Degree Works audit: same line shapes as a real Wolverine Track "Save as PDF" audit
// (2026-10), with the name, ID, advisor and some courses changed. Not a real student.
const DEGREE_WORKS = `Utah Valley University Doe, Jane Q - 00000000
Utah Valley University
Student name Doe, Jane Q
Student ID 00000000
Degree Bachelor of Science
Audit date 10/07/2026  4:05 AM
Degree progress
48%
Level Undergraduate    Classification Junior    Major Electrical Engineering    Program Electrical
Engineering-BS    College College of Engineering & Tech.    Catalog Year 2025-2026 (BS-EE1)    Degree Effective Term 2025 Fall (BS-EE1)    Degree
Priority 1 (BS-EE1)    Academic Standing Good Standing    Transfer Credits 22    Overall GPA 3.50
Bachelor of Science INCOMPLETE
Credits required: 125 Credits applied:  81 Catalog year:  2025-2026 GPA: 3.50
40 Hours of Upper Division Still needed: A minimum of 40 credits in Upper Division are required. You have taken 3
but need 37 more credits.
No Incomplete ('I') Grades
Major Core Still needed: See Electrical Engineering Core-BS section

New General Education COMPLETE
Credits required: 32 Credits applied:  33 Catalog year:  2025-2026 GPA: 3.64
Course Title Grade Credits Term
ACADEMIC WRITING I ENGL 1010 Intro to Acad Writing CC TCR 3 2025 SUMMER
Satisfied by: AP ELGC0000 - English Language & Composition - Adv Pl - English Lang/Comp (3)
Utah Valley University Doe, Jane Q - 00000000
ACADEMIC WRITING II ENGL 2010 Intermed Academic Writing B+ 3 2025 FALL
QUANTITATIVE LITERACY MATH 1210 Calculus I QL TCR 4 2025 SUMMER
Satisfied by: AP MCBC0000 - Calculus BC - Adv Pl - Calculus BC (4)
AMERICAN INSTITUTIONS
Option 1 POLS 1100 American National Govt AS TCR 3 2025 SUMMER
Satisfied by: AP GVPU0000 - US Government & Politics - Adv Pl - US Govt & Pol (4)
PERSONAL, PROFESSIONAL AND CIVIC
GROWTH
PHIL 2050G Ethics and Values A- 3 2025 FALL
HUMANITIES DISTRIBUTION COMM 1020 Public Speaking A 3 2025 FALL
FINE ARTS THEA 1023 Introduction to Film A 3 2025 FALL
BIOLOGY DISTRIBUTION BIOL 1610 College Biology I BB TCR 4 2025 SUMMER
Satisfied by: AP BIOL0000 - Biology - Adv Pl - Biology (4)
PHYSICAL SCIENCE DISTRIBUTION CHEM 1210 Principles of Chem I B 4 2026 SPRING

Electrical Engineering Core-BS INCOMPLETE
Credits required: 93 Credits applied:  42 Catalog year:  2025-2026 GPA: 3.71
Course Title Grade Credits Term
Matriculation Not Complete Still needed: Students must be formally matriculated to this program before they can
graduate. Please see your advisor for more information.
 Matriculation Courses: MATH 1210, MATH 1220, PHYS 2210, PHYS 2215,  PHYS 2220, PHYS
2215, PHYS 2220, PHYS 2225, CS 1400,  ECE 1000, with a minimum grade of C. All courses must
be completed with a grade of C or higher
Physics Sci Engr I PHYS 2210 Physics Sci Engr I A- 4 2026 SPRING
Intro to ECE ECE 1000 Intro to ECE B 3 2026 SPRING
Fundamentals of Programming CS 1400 Fundamentals of Programming A 3 2026 SPRING
Circuit Theory ECE 2250 Circuit Theory IP (3) 2026 FALL
Circuit Theory Lab ECE 2255 Circuit Theory Lab IP (1) 2026 FALL
Digital Design I ECE 2700 Digital Design I IP (3) 2026 FALL
Energy Conversion Still needed: 1 Class in ECE 3250
Utah Valley University Doe, Jane Q - 00000000
Control Systems Still needed: 1 Class in ECE 3350
Applied Prob/Stats Engineer ECE 3710 Applied Prob/Stats Engineer A- 3 2026 SUMMER
Embedded Systems I Still needed: 1 Class in ECE 3730
ECE Capstone II Still needed: 1 Class in ECE 4950
Phys Sci Engr I Lab PHYS 2215 Phys Sci Engr I Lab A 1 2026 SPRING
Phys Sci Engr II PHYS 2220 Phys Sci Engr II A- 4 2026 SUMMER
Phys Sci Engr II Lab PHYS 2225 Phys Sci Engr II Lab A 1 2026 SUMMER
Principles of Chemistry I Lab CHEM 1215 Principles of Chemistry I Lab A- 1 2026 SPRING
Calculus II MATH 1220 Calculus II TCR 4 2025 SUMMER
Satisfied by: AP MCBC0000 - Calculus BC - Adv Pl - Calculus BC (4)
Calculus III MATH 2210 Calculus III IP (4) 2026 FALL
Electrical Engineering Electives Still needed: 6 Credits in ECE 4250 or 4260 or 4780 or 4810R or 4850
Complete any 1000-level or higher courses SLSS 101R StudSuccessTop Coll Readiness A 3 2024 SPRING

MINOR: Environmental Science and Management INCOMPLETE
Course Title Grade Credits Term
Intro to Envt Sci Mgmt ENVT 1110 Intro to Environmental Mgmt A 3 2026 SUMMER
Environmental Health Still needed: 1 Class in ENVT 2560
Electives--11 Credits
GEO 1010 Introduction to Geology A 3 2026 SUMMER
Still needed: 8 Credits in ENVT 1200 or 1510 or 2300 or 2730 or 3010 or 3210 or 3270 or 3280
or 3290 or 3320 or 3330 or 3530 or 3550 or 3750 or 3790 or 3800 or 4820R or
4950R or GEOG 2000 or 3400 or 3440 or 3600 or 3650 or 3700 or 3705 or 4100
or GEO 1030 or 1040 or 1050 or 1015 or 1080 or 1085 or 3000 or 3100 or 3105
CHEM 3020 or 3025 or ENST 2000 additionally you need a minimum of  6 Credits
from ENVT 1200 or 3210 or 3270 or 2300 or GEO 4790
or ENVT 4820R

Global Intercultural Requirement COMPLETE
Course Title Grade Credits Term
Global Intercultural Requirement PHIL 2050G Ethics and Values A- 3 2025 FALL

Writing Enriched Requirement Still needed: 2 Classes in @ @ with attribute = WE

Not Applied Credits applied: 4 Classes applied: 2
Course Title Grade Credits Term
MATH 1900 Math Elective TCR 1 2025 SUMMER
Satisfied by: AP MCAB0000 - Calculus AB - Adv Pl - Calculus AB (5)
STAT 1040 Introduction to Statistics QL TCR 3 2025 SUMMER
Satisfied by: AP STAT0000 - Statistics - Adv Pl - Statistics (4)

In-progress Credits applied: 11 Classes applied: 4
Course Title Grade Credits Term
ECE 2250 Circuit Theory IP (3) 2026 FALL
ECE 2255 Circuit Theory Lab IP (1) 2026 FALL
ECE 2700 Digital Design I IP (3) 2026 FALL
MATH 2210 Calculus III IP (4) 2026 FALL

Legend
Complete Not complete
Prerequisite @ Any course number
Ellucian Degree Works - © Copyright 1995-2026 Ellucian Company L.P. and its affiliates`;

// Synthetic: an older Degree Works layout pasted from the web page (tab-separated cells, failing and
// withdrawn grades, an Insufficient block, a Planned row) — fixture until a real paste of that layout exists.
const DEGREE_WORKS_WEB = `Major Requirements
Circuits\tECE 2250\tCircuit Theory I\tB+\t3\tFall 2025
Still needed:\t1 Class in ECE 2260 or 2270
Digital Design\tECE 2700\tDigital Design I\tIP\t(3)\tSpring 2026
Calculus\tMATH 1220\tCalculus II\tTB\t4\tFall 2023
Satisfied by MATH 1220 - Calculus II - Salt Lake Community College
Signals\tECE 3770\tSignals and Systems\tPLAN\t3\tFall 2026
Needs: 1 Class in ECE 3710
Insufficient
ECE 1000\tIntro to ECE\tW\t3\tSpring 2024
ECE 2750\tEngineering Analysis\tD\t3\tSpring 2024
In-progress
ECE2705\tDigital Design I Lab\t\t1\tSpring 2026
Fallthrough
ECE 4810R\tECE Seminar\tP\t1\tFall 2025
CS 1400\tFundamentals of Programming\tF\t3\tFall 2024`;

// Synthetic: Banner-style unofficial transcript.
const TRANSCRIPT = `UNOFFICIAL TRANSCRIPT
TRANSFER CREDIT ACCEPTED BY INSTITUTION
Fall 2023: Salt Lake Community College
MATH 1050 College Algebra T 4.000
CHEM 1210 Principles of Chemistry I TA 4.000
INSTITUTION CREDIT
Term: Fall 2024
Subject Course Level Title Grade Credit Hours Quality Points
MATH 1210 UG Calculus I A 4.000 16.00
ENGL 1010 UG Intro to Writing A- 3.000 11.10
PHYS 2210 UG Physics for Scientists I C+ 4.000 9.20
HIST 1700 UG American Civilization W 0.000 0.00
COURSES IN PROGRESS
Term: Spring 2026
ECE 2250 UG Circuit Theory I 3.000
MATH 1220 UG Calculus II 4.000`;

test('course codes: spaces, no space, dash, suffix letters, 3-digit numbers; not ranges or AP ids', () => {
  assert.deepEqual(codesIn('ECE 2250 ECE2250 ECE-2255 ECE 4810R PHIL 2050G SLSS 101R').map((c) => c.code),
    ['ECE 2250', 'ECE 2250', 'ECE 2255', 'ECE 4810R', 'PHIL 2050G', 'SLSS 101R']);
  assert.deepEqual(codesIn('ECE 3000:4999 and ECE 3@').map((c) => c.code), []);
  assert.deepEqual(codesIn('Satisfied by: AP MCBC0000 - Calculus BC').map((c) => c.code), []);
  assert.deepEqual(codesIn('Audit date 10/07/2026 4:05 AM, 2025 FALL').map((c) => c.code), []);
});

test('Degree Works audit: taken, transfer (TCR) and in-progress rows; nothing from Still needed', () => {
  const p = parseAudit(DEGREE_WORKS);
  assert.equal(p.catalogYear, '2025-2026');
  const taken = codes(p.taken), ip = codes(p.inProgress);
  for (const c of ['ENGL 1010', 'ENGL 2010', 'MATH 1210', 'POLS 1100', 'PHIL 2050G', 'COMM 1020', 'THEA 1023', 'BIOL 1610',
    'CHEM 1210', 'PHYS 2210', 'ECE 1000', 'CS 1400', 'ECE 3710', 'PHYS 2215', 'PHYS 2220', 'PHYS 2225', 'CHEM 1215',
    'MATH 1220', 'SLSS 101R', 'ENVT 1110', 'GEO 1010', 'MATH 1900', 'STAT 1040']) assert.ok(taken.includes(c), `${c} taken`);
  assert.deepEqual(ip, ['ECE 2250', 'ECE 2255', 'ECE 2700', 'MATH 2210']);
  for (const c of ['ECE 3250', 'ECE 3350', 'ECE 3730', 'ECE 4950', 'ECE 4250', 'ECE 4810R', 'ENVT 2560', 'ENVT 1200',
    'GEOG 2000', 'GEO 1030', 'CHEM 3020', 'ENST 2000', 'GEO 4790', 'ENVT 4820R'])
    assert.ok(!taken.includes(c) && !ip.includes(c), `${c} must not be marked`);
  assert.equal(taken.length, 23, 'nothing extra (e.g. from the Matriculation Courses list or AP ids)');
});

test('older web-page layout: tab cells, Insufficient block, PLAN and failing grades ignored', () => {
  const p = parseAudit(DEGREE_WORKS_WEB);
  assert.deepEqual(codes(p.taken), ['ECE 2250', 'ECE 4810R', 'MATH 1220']);
  assert.deepEqual(codes(p.inProgress), ['ECE 2700', 'ECE 2705']);
});

test('unofficial transcript: transfer + graded rows taken, W skipped, courses in progress', () => {
  const p = parseAudit(TRANSCRIPT);
  assert.deepEqual(codes(p.taken), ['CHEM 1210', 'ENGL 1010', 'MATH 1050', 'MATH 1210', 'PHYS 2210']);
  assert.deepEqual(codes(p.inProgress), ['ECE 2250', 'MATH 1220']);
});

test('matching to the EE program: courses, choice options and Gen Ed boxes', () => {
  const m = matchAudit(parseAudit(DEGREE_WORKS), model);
  const by = Object.fromEntries(m.rows.map((r) => [r.key, r.status]));
  assert.equal(by['PHYS 2220'], 'taken');
  assert.equal(by['MATH 1220'], 'taken');
  assert.equal(by['ECE 2250'], 'ip');
  assert.equal(by['POLS 1100'], 'taken', 'American Institutions option');
  assert.equal(by['ph:7'], 'taken', 'FINE ARTS THEA 1023 fills Fine Arts Distribution');
  assert.equal(by['ph:8'], 'taken', 'BIOLOGY DISTRIBUTION');
  assert.equal(by['ph:6'], 'taken', 'PERSONAL, PROFESSIONAL AND CIVIC GROWTH (label split over two lines)');
  assert.ok(!('ECE 3250' in by));
  // the PDF version prints the label's last word on the line after the row
  const pdfShape = parseAudit('PERSONAL, PROFESSIONAL AND CIVIC PHIL 2050G Ethics and Values A- 3 2025 FALL\nGROWTH');
  assert.equal(matchAudit(pdfShape, model).rows[0]?.key, 'ph:6');
  const t = m.rows.filter((r) => r.status === 'taken').length, ip = m.rows.length - t;
  console.log(`anonymized audit -> Found ${t} taken, ${ip} in progress (${m.other} outside the major)`);
  assert.equal(ip, 4);
});

test('grades: letter grades, transfer/pass marks and IP come through to the matched rows', () => {
  const p = parseAudit(DEGREE_WORKS);
  const g = Object.fromEntries(p.taken.map((r) => [r.code, r.grade]));
  assert.equal(g['PHYS 2210'], 'A-');
  assert.equal(g['ENGL 2010'], 'B+');
  assert.equal(g['MATH 1220'], 'TCR');
  assert.equal(g['CHEM 1210'], 'B');
  const m = matchAudit(p, model);
  const by = Object.fromEntries(m.rows.map((r) => [r.key, r.grade]));
  assert.equal(by['PHYS 2210'], 'A-');
  assert.equal(by['MATH 1220'], 'TCR');
  assert.equal(by['ECE 2250'], 'IP');
  assert.equal(by['ph:7'], 'A', 'Gen Ed box filled from the audit keeps its grade (THEA 1023 A)');
  const t = matchAudit(parseAudit(TRANSCRIPT), model);
  assert.equal(t.rows.find((r) => r.key === 'PHYS 2210').grade, 'C+');
  const w = matchAudit(parseAudit(DEGREE_WORKS_WEB), model);
  assert.equal(w.rows.find((r) => r.key === 'MATH 1220').grade, 'TB');
});

test('grade scale: A green ... C yellow ... D/E red; non-letter grades get a short tag', () => {
  assert.equal(gradeInfo('A').kind, 'letter');
  assert.ok(gradeInfo('A').hue > gradeInfo('B').hue && gradeInfo('B').hue > gradeInfo('C').hue && gradeInfo('C').hue > gradeInfo('D').hue);
  assert.ok(gradeInfo('A').hue >= 120 && gradeInfo('C').hue >= 40 && gradeInfo('C').hue <= 65 && gradeInfo('D').hue <= 15);
  assert.equal(gradeInfo('E').hue, 0);
  assert.equal(gradeInfo('A-').text, 'A-');
  assert.deepEqual([gradeInfo('TCR').text, gradeInfo('TB').text, gradeInfo('P').text, gradeInfo('IP').text, gradeInfo('').text], ['TR', 'TR', 'P', 'IP', '']);
  assert.equal(gradeInfo('TCR').kind, 'mark');
});

// Tim's real audit text, if it's on this machine (it's private and never committed).
const REAL = fileURLToPath(new URL('../.claude/test/audit.txt', import.meta.url));
const REAL_MAIN = 'C:/Users/timha/OneDrive/Desktop/my-website/Code Projects/Smart Advisor/.claude/test/audit.txt';
const realPath = [REAL, REAL_MAIN].find((p) => existsSync(p));
test('real Wolverine Track audit (local only)', { skip: !realPath && 'no .claude/test/audit.txt here' }, () => {
  const p = parseAudit(readFileSync(realPath, 'utf8'));
  const taken = codes(p.taken), ip = codes(p.inProgress);
  assert.equal(p.catalogYear, '2025-2026');
  assert.ok(ip.includes('ECE 2250'));
  assert.ok(taken.includes('PHYS 2220'));
  assert.ok(taken.includes('MATH 1220'), 'TCR counts as taken');
  for (const c of ['ECE 3250', 'ENVT 1200', 'GEOG 2000', 'ECE 4950']) assert.ok(!taken.includes(c) && !ip.includes(c), c);
  const grade = Object.fromEntries(p.taken.map((r) => [r.code, r.grade]));
  // grades are private: check their kind only, never the real letters, in this public repo
  for (const c of ['PHYS 2210', 'ENGL 2010']) assert.equal(gradeInfo(grade[c]).kind, 'letter', c);
  assert.equal(gradeInfo(grade['MATH 1220']).text, 'TR');
  const m = matchAudit(p, model);
  assert.equal(m.rows.find((r) => r.key === 'ECE 2250').grade, 'IP');
  console.log(`real audit -> ${m.rows.filter((r) => r.status === 'taken').length} taken, ${m.rows.filter((r) => r.status === 'ip').length} in progress in EE`);
});
