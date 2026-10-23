// Run: node --test tests/short-titles.test.mjs
// Short class names on the flowchart boxes (data/short-titles.json, scripts/build-short-titles.mjs).
// Tim, 2026-10-22: "Calculus 3 -> Calc 3" "Physics for Scientists and Engineers II --> Phys 2"
// "introduction to Electrical Engineering --> Intro to EE" ... "the full name fits in the label".
//   - Tim's three examples
//   - every class title any box of any program can show (both catalog years) has a short name that fits
//     the box's 2 name lines at the box's real CSS size (estimate errs wide; tests/short-titles.e2e.mjs
//     measures in WebKit)
//   - no two different classes in one program get the same short name
//   - data/short-titles.json is up to date with the program data and the hand names
//   - requirement rows (Gen Ed / elective / "Complete one of the following:") get short labels that fit
//     their box and their one-line plan row
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { boxTitles, buildShortTitles, reqLabels, buildReqLabels } from '../scripts/build-short-titles.mjs';
import { fitsBox, BOX, ruleShort, fitsReq, PLAN } from '../scripts/lib/short-titles.mjs';
import { shortTitle, boxName, shortJoin, reqName, NO_NAME, shortCodes, optionCode } from '../js/shortnames.js';
import { buildModel, flowNodes, flowEdges } from '../js/planner.js';
import { foldLabs } from '../js/layout.js';
import { groupNodes } from '../js/groups.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => JSON.parse(readFileSync(ROOT + p, 'utf8'));
const DATA = read('data/short-titles.json');
const MAP = DATA.titles;
const PER = boxTitles();

test("Tim's examples", () => {
  assert.equal(shortTitle(MAP, 'Calculus III'), 'Calc 3');
  assert.equal(shortTitle(MAP, 'Physics for Scientists and Engineers II'), 'Phys 2');
  // UVU's intro course is ECE 1000 "Introduction to Electrical and Computer Engineering"
  const ece = read('data/programs/electrical-engineering-bs.json').courses['ECE 1000'].title;
  assert.equal(ece, 'Introduction to Electrical and Computer Engineering');
  assert.equal(shortTitle(MAP, ece), 'Intro to ECE');
  // a few more of the same kind
  assert.equal(shortTitle(MAP, 'Calculus I'), 'Calc 1');
  assert.equal(shortTitle(MAP, 'Principles of Chemistry I'), 'Chem 1');
  assert.equal(shortTitle(MAP, 'Circuit Theory'), 'Circuits');
  assert.equal(ruleShort('Introduction to Electrical Engineering').short, 'Intro to EE');
  // a title it doesn't list is shown as it is
  assert.equal(shortTitle(MAP, 'Genetics'), 'Genetics');
  assert.equal(shortTitle(MAP, ''), '');
});

test('the box size the fit check assumes matches the real CSS (narrowest box, name font)', () => {
  const css = readFileSync(ROOT + 'css/app.css', 'utf8');
  const app = readFileSync(ROOT + 'js/app.js', 'utf8');
  const rule = (sel) => css.match(new RegExp(`^${sel.replace(/[.*]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm'))?.[1] || '';
  const fontPx = parseFloat(rule('.box i').match(/font-size:\s*([\d.]+)px/)[1]);
  const lines = parseInt(rule('.box i').match(/-webkit-line-clamp:\s*(\d+)/)[1], 10);
  const box = [...css.matchAll(/^\.box \{([^}]*)\}/gm)].map((m) => m[1]).find((b) => /padding:/.test(b));
  const padX = parseFloat(box.match(/padding:\s*[\d.]+(?:px)?\s+([\d.]+)px/)[1]);
  const border = parseFloat(box.match(/border:\s*([\d.]+)px/)[1]);
  const minW = Math.min(...[...app.match(/const FITS = \[([^\]]*)\]/)[1].matchAll(/boxW:\s*(\d+)/g)].map((m) => +m[1]));
  assert.ok(BOX.fontPx >= fontPx, `box name font is ${fontPx}px; scripts/lib/short-titles.mjs BOX.fontPx is ${BOX.fontPx}`);
  assert.ok(BOX.lines <= lines, `box shows ${lines} name lines`);
  assert.ok(BOX.width <= minW - 2 * padX - 2 * border, `narrowest box text width ${minW - 2 * padX - 2 * border}px < BOX.width ${BOX.width}`);
});

test('every class name a box shows fits the box (all programs, both catalog years)', () => {
  const bad = new Set();
  let n = 0;
  for (const list of PER.values()) for (const { title, joined } of list) { if (joined) continue; n++; const s = shortTitle(MAP, title); if (!fitsBox(s)) bad.add(`${title} -> ${s}`); }
  assert.ok(n > 10000, `only ${n} box titles found`);
  assert.deepEqual([...bad], [], 'write hand names in scripts/short-titles-hand.json, then node scripts/build-short-titles.mjs');
});

test('option boxes with several classes ("A + B") fit too', () => {
  const seasons = read('data/seasons.json');
  const bad = new Set();
  let n = 0;
  for (const [dir, y] of [['data/programs', 'data/'], ['data/2025-2026/programs', 'data/2025-2026/']]) {
    const extra = { extraCourses: read(y + 'prereq-courses.json'), gened: read(y + 'gened.json'), seasons };
    for (const f of readdirSync(ROOT + dir)) {
      if (!f.endsWith('.json') || f.startsWith('_') || f === 'index.json') continue;
      const program = read(`${dir}/${f}`);
      const model = buildModel(program, extra);
      const fo = foldLabs(flowNodes(model), flowEdges(model));
      const nodes = groupNodes(model, fo.nodes, fo.edges, []).boxes;
      for (const node of nodes) {
        if (node.kind !== 'option' || (node.codes || []).length < 2) continue;
        n++;
        const s = boxName(MAP, node, { ...(extra.extraCourses || {}), ...program.courses });
        if (!fitsBox(s)) bad.add(`${f} ${node.codes.join(' + ')}: ${s}`);
      }
    }
  }
  assert.ok(n > 50, `only ${n} multi-class options`);
  assert.deepEqual([...bad], []);
});

test('an option box drops a repeated subject from its code line', () => {
  assert.equal(shortCodes('ACC 1110 + ACC 1120'), 'ACC 1110 + 1120');
  assert.equal(shortCodes('PHYS 2210 + PHYS 2015'), 'PHYS 2210 + 2015');
  assert.equal(shortCodes('GEO 1030 + GEO 1015 + GEO 1040'), 'GEO 1030 + 1015 + 1040');
  assert.equal(shortCodes('CHEM 1210 + MATH 1050'), 'CHEM 1210 + MATH 1050');
  assert.equal(shortCodes('ECE 2250'), 'ECE 2250');
  const C = { 'BIOL 1610': { title: 'College Biology I' }, 'BIOL 1615': { title: 'College Biology I Laboratory' }, 'ACC 1110': { title: 'Financial Accounting I' }, 'ACC 1120': { title: 'Financial Accounting II' } };
  assert.deepEqual(optionCode({ codes: ['BIOL 1610', 'BIOL 1615'], label: 'BIOL 1610 + BIOL 1615' }, C), { code: 'BIOL 1610', more: '+Lab' });
  assert.deepEqual(optionCode({ codes: ['ACC 1110', 'ACC 1120'], label: 'ACC 1110 + ACC 1120' }, C), { code: 'ACC 1110', more: '+1120' });
  assert.deepEqual(optionCode({ codes: ['MATH 1050', 'STAT 1040'], label: 'MATH 1050 + STAT 1040' }, C), { code: 'MATH 1050', more: '+1' });
  assert.deepEqual(optionCode({ codes: ['GEO 1010', 'GEO 1015', 'GEO 2020R'], label: 'GEO 1010 + GEO 1015 + GEO 2020R' }, C), { code: 'GEO 1010', more: '+2' });
});

test('lecture + lab option reads "Chem 1 + Lab"', () => {
  assert.equal(shortJoin(['Chem 1', 'Chem 1 Lab']), 'Chem 1 + Lab');
  assert.equal(shortJoin(['US History', 'Am. Government']), 'US History + Am. Government');
});

test('no two different classes in one program share a short name', () => {
  const clash = [];
  for (const [prog, list] of PER) {
    const seen = new Map(); // short -> full title
    for (const { title, joined } of list) {
      if (joined) continue;
      const s = shortTitle(MAP, title).toLowerCase();
      const had = seen.get(s);
      if (had !== undefined && had !== title) clash.push(`${prog}: "${had}" and "${title}" -> ${shortTitle(MAP, title)}`);
      else seen.set(s, title);
    }
  }
  assert.deepEqual(clash, []);
});

test('data/short-titles.json is up to date (rerun node scripts/build-short-titles.mjs after a data refresh)', () => {
  const { titles, counts } = buildShortTitles(PER);
  assert.deepEqual(DATA.titles, titles);
  assert.equal(DATA.hand, counts.hand);
  assert.ok(counts.hand >= 600, `${counts.hand} hand names`);
  const req = buildReqLabels(REQ);
  assert.deepEqual(DATA.labels, req.labels);
  assert.deepEqual(DATA.names, req.names);
});

// ---------- requirement rows (manager, 2026-10-22: the plan list still cut "Complete 24 credits from any
// ART/ARTH…", "Complete 12 Credits of Upper…", "Complete one of the following:" with "…") ----------
const REQ = reqLabels();
const artRow = (label) => {
  const x = REQ.get('current/art-design-bs').find((r) => r.label === label);
  assert.ok(x, `Art and Design BS has "${label}"`);
  return reqName(DATA, x.label, x.name);
};

test('requirement rows get short clear labels (Art and Design BS examples)', () => {
  assert.equal(artRow('Complete 24 credits from any ART/ARTH courses not already taken (see Graduation Requirement 1).'), 'ART/ARTH elective');
  assert.equal(artRow('Complete 12 Credits of Upper Division ARTH'), 'Upper-div ARTH');
  assert.equal(artRow('ART Upper Division'), 'Upper-div ART');
  assert.equal(artRow('Personal, Professional, and Civic Growth'), 'Personal & Civic Growth');
  assert.equal(artRow('Social/Behavioral Science'), 'Social Science');
  // a generic "Complete one of the following:" shows its requirement group's name, never the generic words
  assert.notEqual(artRow('Complete one of the following:'), 'Complete one of the following:');
  assert.equal(reqName(DATA, 'Complete one of the following:', ''), NO_NAME);
  assert.equal(reqName(DATA, 'Choose 6 credits', 'Event Management Core'), 'Event Mgmt Core');
  // wording it doesn't list shows as it is
  assert.equal(reqName(DATA, 'Elective', ''), 'Elective');
});

test('every requirement row label fits its box (2 lines) and its plan row (1 line), all programs, both years', () => {
  const bad = new Set();
  let n = 0;
  for (const [prog, list] of REQ) for (const { label, name } of list) {
    n++;
    const s = reqName(DATA, label, name);
    if (!fitsReq(s)) bad.add(`${prog}: ${label.slice(0, 60)} -> ${s}`);
  }
  assert.ok(n > 5000, `only ${n} requirement rows found`);
  assert.deepEqual([...bad], [], 'add hand labels in scripts/short-titles-hand.json (labels / names), then node scripts/build-short-titles.mjs');
});

test('the plan-row width the label check assumes matches the CSS (12px, one line)', () => {
  const css = readFileSync(ROOT + 'css/app.css', 'utf8');
  assert.match(css, /^\.sem li \{[^}]*font-size:\s*12px/m);
  assert.match(css, /^\.box\.ph b \{[^}]*-webkit-line-clamp:\s*2[^}]*font-size:\s*12\.5px/m);
  assert.equal(PLAN.fontPx, 12);
  assert.ok(PLAN.width <= 154, 'the narrowest plan column (393px phone, 2 columns) has about 154px of label');
});
