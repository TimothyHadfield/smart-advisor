// "Recommended" advice in a prerequisite line must not erase the real prerequisites next to it.
// Tim: "For my EE major the flowchart says ECE 4900 doesn't have any prerequisits but it does."
// Course entries are REAL catalog XML frozen in tests/fixtures/catalog/_prereq-courses.json.gz
// (2026-2027 and 2025-2026 caches). The last test sweeps every course in both shipped data years.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DIR = process.env.PARSER_DIR ? pathToFileURL(resolve(process.env.PARSER_DIR)).href + '/' : new URL('../scripts/', import.meta.url).href;
const F = await import(DIR + 'fetch-program.mjs');
const FX = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/catalog/_prereq-courses.json.gz', import.meta.url))).toString('utf8'));
const course = (code, year = '2026-2027') => F.parseCourseXml(FX[year][code], code);
const flat = (e) => (e == null ? [] : typeof e === 'string' ? [e] : (e.and || e.or).flatMap(flat));

test('MKTG 4150: "...; Senior Standing is recommended." keeps the five MKTG prerequisites', () => {
  const c = course('MKTG 4150');
  assert.deepEqual(flat(c.prereqs).sort(), ['MKTG 3170', 'MKTG 3600', 'MKTG 3660', 'MKTG 3680', 'MKTG 3690']);
  assert.equal(c.gate, 'advanced-standing');
});
test('CS 4380: "CS 3060 , ( CS 3370 Recommended), and University Advanced Standing" requires CS 3060 only', () => {
  assert.deepEqual(flat(course('CS 4380').prereqs), ['CS 3060']);
});
test('MICR 3455: "BIOL 1610 or BIOL 1610H and University Advanced Standing; BIOL 3600 recommended"', () => {
  const c = course('MICR 3455');
  assert.deepEqual(flat(c.prereqs).sort(), ['BIOL 1610', 'BIOL 1610H']);
  assert.ok(!flat(c.prereqs).includes('BIOL 3600'));
});
test('ARTH 3015: "ARTH 2710 ( ARTH 2720G recommended), ( ENGL 1010 or ENGL 1005 ), ..." keeps ARTH 2710 and ENGL', () => {
  const c = course('ARTH 3015');
  assert.deepEqual(flat(c.prereqs).sort(), ['ARTH 2710', 'ENGL 1005', 'ENGL 1010']);
});
test('CS 4770, ENGL 3050, CJ 1340, CYBR 2700: the required course survives a recommended clause', () => {
  assert.deepEqual(flat(course('CS 4770').prereqs), ['CS 3370']);
  assert.deepEqual(flat(course('ENGL 3050').prereqs), ['ENGL 2010']);
  assert.deepEqual(flat(course('CJ 1340').prereqs), ['CJ 1010']);
  assert.deepEqual(flat(course('CYBR 2700').prereqs).sort(), ['CS 2600', 'IT 2600']);
});
test('ECE 4900: ECE 4730 (2026-27); 2025-26 "Advanced Standing, Formal Acceptance ..., and Senior Standing recommended" is gated', () => {
  assert.deepEqual(flat(course('ECE 4900').prereqs), ['ECE 4730']);
  const old = course('ECE 4900', '2025-2026');
  assert.equal(old.gate, 'admission');
  assert.match(old.gateText, /Acceptance into the Electrical or Computer Engineering/);
  assert.ok(!(old.prereqWords || []).some((w) => /recommend/i.test(w)), 'advice is not a worded prerequisite');
  assert.ok((old.prereqWords || []).some((w) => /Advanced Standing/.test(w)));
});
test('DANC 4240R: a line that is only advice plus an audition stays without course prerequisites', () => {
  assert.equal(course('DANC 4240R').prereqs, null);
});

// ---------- guard: the whole shipped data ----------
// Every course code in a prerequisite line, outside a recommended clause, must appear in `prereqs`.
// The advice is removed here with simple rules of the test's own (not the parser's function).
function adviceFree(t) {
  return t
    .replace(/\([^()]*recommend[^()]*\)/gi, ' ').replace(/\[[^[\]]*recommend[^[\]]*\]/gi, ' ')
    .split(/(?<=\.)\s+/).filter((s) => !/^\s*(?:also,?\s*)?(?:it is\s+)?(?:also\s+)?(?:strongly\s+|highly\s+)?recommended\b/i.test(s))
    // ("A and B recommended" may mean both are advice, so a part is only cut at , and ;)
    .map((s) => s.split(/[,;]/).filter((p) => !/recommend/i.test(p)).join(' , '))
    .join(' ');
}
const codesOf = (t) => [...t.replace(/\b([A-Z]{2,5})(\d{4}[A-Z]{0,2})\b/g, '$1 $2').matchAll(/\b([A-Z]{2,5}) (\d{4}[A-Z]{0,2})\b/g)].map((m) => `${m[1]} ${m[2]}`);
for (const [year, file] of [['2026-2027', '../data/courses.json'], ['2025-2026', '../data/2025-2026/courses.json']]) {
  test(`${year}: no prerequisite course next to a "recommended" clause is lost`, () => {
    const url = new URL(file, import.meta.url);
    if (!existsSync(url)) return;
    const all = JSON.parse(readFileSync(url, 'utf8'));
    const lost = [];
    for (const [code, c] of Object.entries(all)) {
      if (!c?.prereqText || !/recommend/i.test(c.prereqText)) continue;
      const have = new Set(flat(c.prereqs).map((x) => x.replace(/\s+/g, ' ')));
      const want = codesOf(adviceFree(c.prereqText)).filter((x) => x !== code);
      const miss = want.filter((x) => !have.has(x) && !have.has(F.fixCode ? F.fixCode(x) : x));
      if (miss.length) lost.push(`${code}: ${miss.join(', ')}  <- ${c.prereqText}`);
    }
    assert.deepEqual(lost, []);
  });
}
