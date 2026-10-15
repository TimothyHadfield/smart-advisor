// Catalog parser tests: small anonymized CourseLeaf fixtures, one per parser bug (markup copied from the
// cached catalog pages; program names and most codes made generic).
// Run against another copy of the parser with PARSER_DIR=<dir with fetch-program.mjs + fetch-all.mjs>.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DIR = process.env.PARSER_DIR ? pathToFileURL(resolve(process.env.PARSER_DIR)).href + '/' : new URL('../scripts/', import.meta.url).href;
const F = await import(DIR + 'fetch-program.mjs');
const A = await import(DIR + 'fetch-all.mjs');

// ---------- fixture builders (real CourseLeaf markup) ----------
const a = (code) => `<a href="/search/?P=${code.replace(' ', '%20')}" title="${code}" class="bubblelink code" onclick="return showCourse(this, '${code}');">${code}</a>`;
const amp = (code) => `<br/><span style="margin-left:20px;" class="blockindent">&amp; ${a(code)}</span>`;
const ind = (html) => `<div style="margin-left:20px;" class="blockindent">${html}</div>`;
const R = {
  total: (n) => `<tr class="pdf-border-after listsum"><td colspan="2">Total Credit Hours</td><td class="hourscol">${n}</td></tr>`,
  area: (name, cr, indent = false) => `<tr class="even areaheader"><td colspan="2">${indent ? `<span class="courselistcomment commentindent areaheader">` : `<span class="courselistcomment areaheader ">`}${name}</span></td><td class="hourscol">${cr}</td></tr>`,
  comment: (t, hrs = '', indent = false) => `<tr class="even"><td colspan="2"><span class="courselistcomment${indent ? ' commentindent' : ''}">${t}</span></td><td class="hourscol">${hrs}</td></tr>`,
  // course row: code cell html (use a()/amp()/ind()), title, hours
  course: (cell, title, hrs = '') => `<tr class="odd"><td class="codecol">${cell}</td><td>${title}</td><td class="hourscol">${hrs}</td></tr>`,
  or: (code, indent = false) => `<tr class="orclass odd"><td class="codecol orclass">${indent ? ind('or ' + a(code)) : 'or ' + a(code)}</td><td colspan="2"> Title</td></tr>`,
};
const P = {
  term: (name, rows) => `<tr class="plangridterm"><th colspan="2">${name}</th><th class="hourscol">Credit Hours</th></tr>${rows.join('')}<tr class="plangridsum even"><td> </td><td class="titlecol">Credit Hours</td><td class="hourscol">15</td></tr>`,
  course: (cell, hrs = '') => `<tr class="even"><td class="codecol">${cell}</td> <td class="titlecol">Title</td> <td class="hourscol">${hrs}</td> </tr>`,
  label: (t, hrs = '', indent = false) => `<tr class="odd"><td colspan="2" class="codecol">${indent ? ind(`<span class="comment">${t}</span>`) : `<span class="comment">${t}</span>`}</td> <td class="hourscol">${hrs}</td> </tr>`,
};
const page = (rows, terms = [], mainText = '') => `<html><body><main><p>${mainText}</p>
<div id="requirementstextcontainer" class="page_content tab_content"><table class="sc_courselist"><tbody>${rows.join(' ')}</tbody></table></div>
<div id="graduationplantextcontainer" class="page_content tab_content"><table pdfnorepeatheader="true" class="sc_plangrid">${terms.join('')}</table></div>
</main></body></html>`;
const C = (credits, extra = {}) => ({ title: 'Course', credits, ...extra });

async function build(html, courses = {}) {
  if (F.buildProgram) return (await F.buildProgram(html, { id: 't', name: 'T', url: '', getCourse: async (c) => courses[c] ?? null })).prog;
  // the old pipeline (before buildProgram existed)
  const req = F.parseRequirements(html);
  const gradPlan = F.parseGradPlan(html);
  A.fillCredits?.(req.items, courses);
  F.nameChoices?.(req.items, gradPlan, courses);
  return { totalCredits: req.total, requirements: req.items, gradPlan, courses, ...(req.entry ? { entryRequirements: req.entry } : {}) };
}
const choices = (p) => p.requirements.filter((r) => r.type === 'choice');
const reqCodes = (p) => p.requirements.filter((r) => r.type === 'course').map((r) => r.code);

// ---------- bugs ----------
test('pair: "A & B (Take twice) | 6" repeats both courses (2x2 + 2x1), not one 4-credit lab', async () => {
  const p = await build(page([R.total(6), R.course(a('ABC 4210R') + amp('ABC 4220R'), 'Writing III and Writing III Lab (Take twice)', 6)]),
    { 'ABC 4210R': C(2), 'ABC 4220R': C(1) });
  const [x, y] = p.requirements.filter((r) => r.type === 'course');
  assert.deepEqual([x.code, x.credits, x.repeat, y.code, y.credits, y.repeat], ['ABC 4210R', 4, 2, 'ABC 4220R', 2, 2]);
});

test('1: a list is never named by credits alone; required count-picks keep a plain name', async () => {
  const p = await build(page([
    R.total(9), R.area('Discipline Core Requirements', '9 Credits'),
    R.comment('Complete one of the following:', 3), R.course(ind(a('ABC 3100')), 'Alpha (3)'), R.course(ind(a('ABC 3200')), 'Beta (3)'),
    R.course(a('ABC 4000'), 'Gamma', 3), R.course(a('ABC 4100'), 'Delta', 3),
  ], [P.term('Semester 1', [P.label('Humanities Distribution', 3), P.course(a('ABC 4000'), 3), P.course(a('ABC 4100'), 3)])]), { 'ABC 3100': C(3), 'ABC 3200': C(3), 'ABC 4000': C(3), 'ABC 4100': C(3) });
  assert.notEqual(choices(p)[0].label, 'Humanities Distribution');
});

test('2: indented "pick one" rows in the grad plan are alternatives of the row above', async () => {
  const p = await build(page([R.total(3), R.comment('Complete one of the following:', 3), R.course(ind(a('ABC 1100')), 'A (3)'), R.course(ind(a('ABC 1200')), 'B (3)')],
    [P.term('Semester 1', [P.label('Complete one of the following:', 3), P.course(ind(a('ABC 1100'))), P.course(ind(a('ABC 1200')))])]), { 'ABC 1100': C(3), 'ABC 1200': C(3) });
  const items = p.gradPlan[0].items;
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].alts, ['ABC 1100', 'ABC 1200']);
});

test('3: a "recommended" code or <sup> in a plan label keeps it a label; "A & B" in the plan means both', async () => {
  const p = await build(page([R.total(7), R.comment('Biology Distribution', 3), R.course(a('ABC 1000') + amp('ABC 1005'), 'Lec and Lab', 4)],
    [P.term('Semester 1', [P.label(`Biology Distribution (${a('BIO 1010')} recommended)`, 3), P.label(`Social Science<sup>${a('SOC 1010')}</sup>`, 3), P.course(a('ABC 1000') + amp('ABC 1005'), 4)])]),
  { 'BIO 1010': C(3), 'SOC 1010': C(3), 'ABC 1000': C(3), 'ABC 1005': C(1) });
  const items = p.gradPlan[0].items;
  assert.equal(items[0].code, undefined);
  assert.ok(items[0].label.startsWith('Biology Distribution'));
  assert.equal(items[1].code, undefined);
  const planCodes = items.map((x) => x.code).filter(Boolean);
  assert.ok(planCodes.includes('ABC 1000') && planCodes.includes('ABC 1005'));
  assert.ok(!(items.find((x) => x.code === 'ABC 1000').alts || []).includes('ABC 1005'), '& is not an or');
});

test('4: "& 1010L" with no subject keeps the subject; an & row after a list is not swallowed into it', async () => {
  const p = await build(page([
    R.total(10), R.comment('Complete one of the following:', 3), R.course(ind(a('ABC 1100')), 'A (3)'), R.course(ind(a('ABC 1200')), 'B (3)'),
    R.course(`${a('DEF 1010')}<br/><span style="margin-left:20px;" class="blockindent">&amp; <a href="/search/?P=DEF%201010L" title="DEF 1010L" class="bubblelink code" onclick="return showCourse(this, 'DEF 1010L');">1010L</a></span>`, 'Lec and Lab', 4),
    R.course(a('DEF 2000'), 'C', 3),
  ]), { 'ABC 1100': C(3), 'ABC 1200': C(3), 'DEF 1010': C(3), 'DEF 1010L': C(1), 'DEF 2000': C(3) });
  assert.deepEqual(reqCodes(p), ['DEF 1010', 'DEF 1010L', 'DEF 2000']);
  assert.equal(choices(p)[0].options.length, 2);
});

test('5: domains / sets / focus areas are tracks; an impossible count becomes a credit pick', async () => {
  const p = await build(page([
    R.total(31), R.comment('Choose one of the following domains:', 12),
    R.comment('Data Domain'), R.course(ind(a('ABC 3100')), 'A (3)'), R.course(ind(a('ABC 3200')), 'B (3)'),
    R.comment('Web Domain'), R.course(ind(a('ABC 3300')), 'C (3)'), R.course(ind(a('ABC 3400')), 'D (3)'),
    R.area('Seminars', '19 Credits'), R.comment('Complete one of the following:', 19), R.course(ind(a('ABC 1900')), 'Seminar (1)'), R.course(ind(a('ABC 1910')), 'Seminar (1)'),
  ]));
  const [tracks, seminars] = choices(p);
  assert.deepEqual(tracks.tracks, ['Data Domain', 'Web Domain']);
  assert.equal(tracks.pick.tracks, 1);
  assert.deepEqual(seminars.pick, { credits: 19 });
});

test('6: "Complete the requirements" with the core not on the page is rebuilt from the grad plan', async () => {
  const p = await build(page([R.total(9), R.comment('Complete the requirements', 6), R.course(a('ABC 3000'), 'Emphasis', 3)],
    [P.term('Semester 1', [P.course(a('XYZ 1000'), 3), P.course(a('XYZ 1100'), 3), P.course(a('ABC 3000'), 3)])]), { 'XYZ 1000': C(3), 'XYZ 1100': C(3), 'ABC 3000': C(3) });
  assert.deepEqual(reqCodes(p).sort(), ['ABC 3000', 'XYZ 1000', 'XYZ 1100']);
  assert.ok(!p.requirements.some((r) => r.type === 'placeholder'));
});

test('7: track names survive their own instructions; a shared elective list is not a track', async () => {
  const p = await build(page([
    R.total(18), R.comment('Complete 18 credits from one of the following tracks:', 18),
    R.comment('Alpha Track'), R.comment('Complete 9 hours from the following:', '', true), R.course(ind(a('ABC 3100')), 'A (3)'),
    R.comment('Beta Track'), R.comment('Complete 9 hours from the following:', '', true), R.course(ind(a('ABC 3200')), 'B (3)'),
    R.comment('Electives'), R.course(ind(a('ABC 3900')), 'E (3)'),
  ]));
  const g = choices(p)[0];
  assert.deepEqual(g.tracks, ['Alpha Track', 'Beta Track']);
  assert.equal(g.options.find((o) => o.codes[0] === 'ABC 3900').shared, true);
});

test('8: free-text rows "(A and B) or C" inside a list become options', async () => {
  const p = await build(page([R.total(8), R.comment('Complete one of the following:', 8), R.course(ind(a('ABC 1000')), 'A (4)'),
    R.comment(`(${a('DEF 1000')} and ${a('DEF 1005')}) or ${a('DEF 2000')}`, '', true)]));
  const opts = choices(p)[0].options.map((o) => o.codes);
  assert.deepEqual(opts, [['ABC 1000'], ['DEF 1000', 'DEF 1005'], ['DEF 2000']]);
});

const xml = (code, extra) => `<?xml version="1.0"?><courseinfo><course code="${code}"><![CDATA[<div class="courseblock"><div class="cols noindent"><span class="text detail-code"><strong>${code}.</strong></span>&#160;&#160;<span class="text detail-title"><strong>Title.</strong></span>&#160;&#160;<span class="text detail-hours_html"><strong>(3 Credits)</strong></span></div><div class="noindent"><div class="courseblockextra noindent">${extra}<br/>
Description.</div></div></div>]]></course></courseinfo>`;
test('9: pre-or-co requisites are marked (preco); a course never requires itself', () => {
  const c = F.parseCourseXml(xml('THEA 1513', `Pre- or Corequisite(s): ${a('THEA 1514')}`), 'THEA 1513');
  assert.deepEqual(c.preco, ['THEA 1514']);
  const m = F.parseCourseXml(xml('MUSC 1110', `Prerequisite(s): ${a('MUSC 1105')} or ${a('MUSC 1110')}`), 'MUSC 1110');
  assert.ok(!JSON.stringify(m.prereqs ?? null).includes('MUSC 1110'));
});

test('10: "ENGL1010" with no space is a course in prerequisites', () => {
  assert.deepEqual(F.parseReqExpr('ENGL 1005 or ENGL1010').expr, { or: ['ENGL 1005', 'ENGL 1010'] });
});

test('11: repeatable R courses carry repeat: n', async () => {
  const p = await build(page([R.total(6), R.course(a('GEO 4800R'), 'Seminar (taken twice)', 1), R.comment('Complete 4 credits of the following:', 4), R.course(ind(a('MUS 2500R')), 'Lessons (1)')]),
    { 'GEO 4800R': C(1), 'MUS 2500R': C(1) });
  assert.equal(p.requirements.find((r) => r.code === 'GEO 4800R').repeat, 2);
  assert.equal(choices(p)[0].options[0].repeat, 4);
});

test('12: the MyEducator exam is a 0-credit way through', async () => {
  const p = await build(page([R.total(3), R.comment('Complete one of the following:'), R.comment('MyEducator', '', true), R.course(ind(a('IM 2010')), 'Proficiency (3)'), R.course(a('ABC 1000'), 'A', 3)]),
    { 'IM 2010': C(3), 'ABC 1000': C(3) });
  assert.equal(choices(p)[0].credits, 0);
});

test('13: a "Prerequisites:" block is not counted as requirements', async () => {
  const p = await build(page([R.total(3), R.comment('Prerequisites:'), R.course(ind(a('ENGL 1010')), 'Writing (3)'), R.comment('Complete the following:'), R.course(a('ABC 2000'), 'A', 3)]),
    { 'ENGL 1010': C(3), 'ABC 2000': C(3) });
  assert.deepEqual(reqCodes(p), ['ABC 2000']);
  assert.ok(!choices(p).length);
});

test('14: "Complete the following:" after a list starts required rows, not more options', async () => {
  const p = await build(page([R.total(9), R.comment('Complete one of the following:', 3), R.course(ind(a('ABC 1100')), 'A (3)'), R.course(ind(a('ABC 1200')), 'B (3)'),
    R.comment('Complete the following:'), R.course(ind(a('RES 1000')), 'R1 (3)'), R.course(ind(a('RES 1100')), 'R2 (3)')]),
  { 'ABC 1100': C(3), 'ABC 1200': C(3), 'RES 1000': C(3), 'RES 1100': C(3) });
  assert.deepEqual(reqCodes(p), ['RES 1000', 'RES 1100']);
  assert.equal(choices(p)[0].options.length, 2);
});

test('15: "Total Credit Hours" as an area header is the total, not an area', async () => {
  const p = await build(page([R.area('Total Credit Hours', '18 Credits'), R.area('Discipline Core Requirements', '9'), R.course(a('ABC 1000'), 'A', 9), R.area('Elective Requirements', '9 Credits'), R.course(a('ABC 2000'), 'B', 9)]));
  assert.equal(p.totalCredits, 18);
});

test('16: open lists ("Any ABC 3000+ course") are marked open', async () => {
  const p = await build(page([R.total(6), R.comment('Complete 6 credits from the following:', 6), R.course(ind(a('ABC 3100')), 'A (3)'), R.comment('Any ABC 3000+ course not already required', '', true)]));
  assert.equal(choices(p)[0].open, true);
});

test('17: cohort programs are marked admission: true with the page sentence', async () => {
  const p = await build(page([R.total(3), R.course(a('NUR 1000'), 'A', 3)], [], 'Students must be formally accepted into the program before taking NUR courses.'));
  assert.equal(p.admission, true);
  assert.match(p.admissionNote, /formally accepted/);
});

test('18: catalog typo ENGH 1005 is read as ENGL 1005', async () => {
  const p = await build(page([R.total(3), R.course(a('ENGL 1010'), 'Writing', 3), R.or('ENGH 1005')]));
  assert.deepEqual(p.requirements[0].alts, ['ENGL 1005']);
});

// ---------- science verifier findings ----------
test('S1: variable credits "(1-4)" keep the top end as crMax', async () => {
  const p = await build(page([R.total(3), R.comment('Complete 3 credits from the following:', 3), R.course(ind(a('ABC 4890R')), 'Research (1-4)')]));
  assert.equal(choices(p)[0].options[0].crMax, 4);
});

test('S3: "At most N credits" sub-headings are rules, not sections', async () => {
  const p = await build(page([R.total(6), R.comment('Complete 6 credits from the following:', 6), R.course(ind(a('ABC 3100')), 'A (3)'),
    R.comment('At most 4 credits of the following may be used towards elective requirements:'), R.course(ind(a('GEO 3000')), 'G (3)')]));
  const g = choices(p)[0];
  assert.ok((g.rules || []).some((r) => /At most 4 credits/.test(r)));
  assert.ok(!g.options.some((o) => /At most/.test(o.section || '')));
});

test('S8: cross-listed "BIOL/CHEM 3620" keeps both codes', async () => {
  const p = await build(page([R.total(3), R.comment('Complete one of the following:', 3),
    R.course(ind(`<a href="/search/?P=BIOL%203620" title="BIOL/CHEM 3620" class="bubblelink code" onclick="return showCourse(this, 'BIOL 3620');">BIOL/CHEM 3620</a>`), 'Biochem (3)'), R.course(ind(a('ABC 3000')), 'A (3)')]));
  const o = choices(p)[0].options[0];
  assert.deepEqual([o.codes[0], ...(o.alts || [])], ['BIOL 3620', 'CHEM 3620']);
});

test('S9: a lone "(recommended)" option leaves a free-choice slot', async () => {
  const p = await build(page([R.total(3), R.comment('Physical Science Distribution', 3), R.course(ind(a('GEOG 1000')), 'Physical Geography (3) (Recommended)')]));
  assert.equal(p.requirements[0].type, 'placeholder');
  assert.deepEqual(p.requirements[0].recommended, ['GEOG 1000']);
});

test('S10: a top-level "A & B | 4" row splits its hours (not catalog sum 5)', async () => {
  const p = await build(page([R.total(4), R.course(a('GEOG 3500') + amp('GEOG 3505'), 'Lec and Lab', 4)]), { 'GEOG 3500': C(4), 'GEOG 3505': C(1) });
  assert.equal(p.requirements.reduce((s, r) => s + r.credits, 0), 4);
});

test('S12: indented area headers inside a list are tracks', async () => {
  const p = await build(page([R.total(12), R.comment('Select one of the following tracks:', 12),
    R.area('Management Track', '12 Credits', true), R.course(ind(a('ABC 3100')), 'A (3)'),
    R.area('Science Track', '12 Credits', true), R.course(ind(a('ABC 3200')), 'B (3)')]));
  const g = choices(p)[0];
  assert.deepEqual(g.tracks, ['Management Track', 'Science Track']);
  assert.equal(p.requirements.length, 1);
});

test('S13: a loose plan label ("HUMANITIES") links to its requirement ("Humanities Distribution")', async () => {
  const p = await build(page([R.total(3), R.comment('Humanities Distribution', 3)], [P.term('Semester 1', [P.label('HUMANITIES', 3)])]));
  assert.equal(p.gradPlan[0].items[0].label, 'Humanities Distribution');
});
