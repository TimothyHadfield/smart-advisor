// Every fact from an outside source links to it (Tim, 2026-10-22: "could you also have automatic links to
// everything you are reffering to or getting your informatoin from? This includes anything UVU, as well as
// Rate my professor, and anything we develope later in the cite.")
// 1. js/sources.js builds every outside link (one place, so new features get links for free)
// 2. every data file is registered with its source, and its records carry what the link needs
// 3. no page code hand-types a UVU / RMP address (it must go through js/sources.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceLink, checked, linkHTML, sourceFor, DATA_SOURCES, programSources } from '../js/sources.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => JSON.parse(readFileSync(join(ROOT, f), 'utf8'));
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const DATA_FILES = walk(join(ROOT, 'data')).filter((f) => f.endsWith('.json')).map((f) => relative(join(ROOT, 'data'), f).replace(/\\/g, '/'));
const isURL = (u) => typeof u === 'string' && /^https:\/\/[\w.-]+\.\w+\//.test(u);

test('program: catalog page, requirements and sample-plan tabs, catalog year, checked date', () => {
  const p = read('data/programs/electrical-engineering-bs.json');
  const l = sourceLink('program', { program: p });
  assert.equal(l.url, p.url);
  assert.equal(l.label, 'Catalog 2026-27');
  assert.equal(l.date, p.fetched);
  assert.equal(sourceLink('program', { program: p, tab: 'requirements' }).url, p.url + '#requirementstextcontainer');
  assert.equal(sourceLink('program', { program: p, tab: 'plan' }).url, p.url + '#graduationplantextcontainer');
  assert.equal(sourceLink('program', { program: {} }), null);
});

test('course: catalog course entry, archive catalog for an older year', () => {
  assert.equal(sourceLink('course', { code: 'ECE 2250' }).url, 'https://catalog.uvu.edu/search/?P=ECE%202250');
  assert.equal(sourceLink('course', { code: 'ECE 2250', year: '2026-2027', current: '2026-2027' }).url, 'https://catalog.uvu.edu/search/?P=ECE%202250');
  assert.equal(sourceLink('course', { code: 'ECE 2250', year: '2025-2026', current: '2026-2027' }).url, 'https://catalog.uvu.edu/archives/2025-2026/search/?P=ECE%202250');
  assert.equal(sourceLink('course', { code: '' }), null);
});

test('sections, RMP, Gen Ed, advisors, seasons', () => {
  const idx = read('data/sections/index.json');
  const s = sourceLink('sections', { term: idx.terms[0] });
  assert.equal(s.url, 'https://userve.uvu.edu/StudentRegistrationSsb/ssb/term/termSelection?mode=search');
  assert.equal(s.label, `UVU class search · ${idx.terms[0].termName}`);
  assert.equal(s.date, idx.terms[0].fetched);
  assert.equal(sourceLink('rmp', { prof: { r: 3.6, id: 794065 } }).url, 'https://www.ratemyprofessors.com/professor/794065');
  assert.equal(sourceLink('rmp', { prof: { r: 3.6 } }), null);
  const g = read('data/gened.json');
  assert.deepEqual(sourceLink('gened', { gened: g }), { url: 'https://catalog.uvu.edu/general-education/', label: 'Catalog 2026-27', date: g.fetched });
  assert.equal(sourceLink('advisors', { advisors: read('data/advisors.json') }).url, 'https://www.uvu.edu/advising/advisors/');
  assert.equal(sourceLink('seasons', { seasons: read('data/seasons.json') }).url, s.url);
});

test('checked date and link HTML (new tab, escaped)', () => {
  assert.equal(checked('2026-10-19T16:29:57.371Z'), 'checked Oct 19');
  assert.equal(checked('2026-10-18'), 'checked Oct 18');
  assert.equal(checked(''), '');
  const h = linkHTML({ url: 'https://catalog.uvu.edu/search/?P=A&B', label: 'Catalog <x>' });
  assert.equal(h, '<a class="src" href="https://catalog.uvu.edu/search/?P=A&amp;B" target="_blank" rel="noopener">Catalog &lt;x&gt; ↗</a>');
  assert.equal(linkHTML(null), '');
});

test('program source line: one catalog link per program + sample plan + checked date', () => {
  const ee = read('data/programs/electrical-engineering-bs.json');
  const minor = read('data/programs/mathematics-minor.json');
  const h = programSources([{ program: ee }, { program: minor }]);
  assert.match(h, new RegExp(`href="${ee.url}#requirementstextcontainer"`));
  assert.match(h, new RegExp(`href="${ee.url}#graduationplantextcontainer"`));
  assert.match(h, new RegExp(`href="${minor.url}#requirementstextcontainer"`));
  assert.match(h, /checked Oct 18/);
  assert.equal((h.match(/target="_blank"/g) || []).length, (h.match(/<a /g) || []).length);
});

test('every data file is registered with its source', () => {
  const missing = DATA_FILES.filter((f) => !sourceFor(f));
  assert.deepEqual(missing, [], 'add these data files to DATA_SOURCES in js/sources.js with their source URL');
});

test('every data file names its source URL (and when it was fetched)', () => {
  const bad = [];
  for (const f of DATA_FILES) {
    const src = sourceFor(f);
    if (!src) continue;
    const d = read(`data/${f}`);
    const url = src.url(d);
    if (!isURL(url)) bad.push(`${f}: url ${url}`);
    if (src.date && !src.date(d)) bad.push(`${f}: no fetched date`);
    for (const [k, r] of src.records ? src.records(d) : []) {
      const l = src.link(r, k);
      if (!l || !isURL(l.url)) bad.push(`${f} ${k}: no link`);
    }
  }
  assert.deepEqual(bad, []);
  assert.ok(DATA_SOURCES.length >= 10);
});

test('real data: every program, RMP professor and section term has what its link needs', () => {
  const progs = DATA_FILES.filter((f) => /(^|\/)programs\/[^_][^/]*\.json$/.test(f) && !f.endsWith('index.json'));
  assert.ok(progs.length > 800, `${progs.length} program files`);
  for (const f of progs) {
    const p = read(`data/${f}`);
    assert.ok(sourceLink('program', { program: p })?.date, f);
    assert.ok(p.url.startsWith(f.startsWith('2025-2026/') ? 'https://catalog.uvu.edu/archives/2025-2026/' : 'https://catalog.uvu.edu/'), f);
  }
  const profs = Object.entries(read('data/rmp.json').profs);
  assert.ok(profs.length > 500);
  assert.deepEqual(profs.filter(([, p]) => !Number.isInteger(p.id)).map(([k]) => k), []);
  for (const t of read('data/sections/index.json').terms) assert.ok(sourceLink('sections', { term: t }).date, t.term);
});

test('page code never hand-types a UVU or RMP address (js/sources.js builds them)', () => {
  const js = readdirSync(join(ROOT, 'js')).filter((f) => f.endsWith('.js') && f !== 'sources.js');
  const hits = js.flatMap((f) => readFileSync(join(ROOT, 'js', f), 'utf8').split('\n')
    .map((l, i) => [f, i + 1, l]).filter(([, , l]) => /(uvu\.edu|ratemyprofessors\.com)/i.test(l) && !/^\s*\/\//.test(l)));
  assert.deepEqual(hits.map(([f, n]) => `${f}:${n}`), []);
});
