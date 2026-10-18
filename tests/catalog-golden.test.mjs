// Golden tests on REAL frozen catalog pages (tests/fixtures/catalog/<id>.json.gz, made by
// scripts/freeze-page.mjs from the 2026-2027 catalog cache of 2026-10-15). Each expectation was checked by
// hand against the catalog page (docs/audit-2026-10-17/). Run against another parser copy with PARSER_DIR.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DIR = process.env.PARSER_DIR ? pathToFileURL(resolve(process.env.PARSER_DIR)).href + '/' : new URL('../scripts/', import.meta.url).href;
const F = await import(DIR + 'fetch-program.mjs');

const cache = new Map();
async function prog(id) {
  if (cache.has(id)) return cache.get(id);
  const fx = JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/catalog/${id}.json.gz`, import.meta.url))).toString('utf8'));
  const store = {};
  const getCourse = async (code) => {
    if (code in store) return store[code];
    return (store[code] = fx.courses[code] ? F.parseCourseXml(fx.courses[code], code) : null);
  };
  const { prog: p } = await F.buildProgram(fx.html, { id, name: id, url: fx.url, catalogYear: fx.catalogYear, getCourse });
  cache.set(id, p);
  return p;
}
const req = (p, code) => p.requirements.find((r) => r.type === 'course' && r.code === code);
const choices = (p) => p.requirements.filter((r) => r.type === 'choice');
const trackGroup = (p) => choices(p).find((g) => g.tracks);
const allCodes = (p) => new Set(p.requirements.flatMap((r) => [r.code, ...(r.alts || []), ...(r.recommended || []), ...(r.options || []).flatMap((o) => [...o.codes, ...(o.alts || [])])]).filter(Boolean));
// credits a track asks for: its required courses + its sub-lists + "additional N credits" (trackElectives)
function trackNeed(g, t, max = false) {
  const opts = g.options.filter((o) => o.section === t && !o.shared);
  const required = opts.filter((o) => o.sub == null && !o.recommended).reduce((s, o) => s + ((max && o.crMax) || o.credits || 0), 0);
  const subs = (g.subs || []).filter((s) => s.section === t).reduce((s, x) => s + (x.credits || 0), 0);
  return required + subs + (g.trackElectives?.[t] || 0);
}

// ---------- options made from catalog notes ----------
test('nursing-bs: the note "STAT 1040 and STAT 1045 can be used only if not used for GE" is not an option', async () => {
  const p = await prog('nursing-bs');
  const stats = choices(p).find((g) => g.options.some((o) => o.codes.includes('PSY 3110')));
  assert.deepEqual(stats.options.map((o) => o.codes), [['MGMT 2340'], ['PSY 3110'], ['STAT 1040']]);
  assert.ok((stats.notes || []).some((n) => /only if not used for GE/.test(n)), 'the note is kept as a note');
});

test('theatre-arts-as: advisory sentences ("are advised to take ...") are not options', async () => {
  const p = await prog('theatre-arts-as');
  const opts = choices(p).flatMap((g) => g.options);
  // the catalog's own "HIST 2700 & HIST 2710" row is a real pair; bundles built from sentences are not
  assert.deepEqual(opts.filter((o) => o.codes.length > 1).map((o) => o.codes.join(' & ')), ['HIST 2700 & HIST 2710'], 'no made-up "A & B & C" bundles');
  assert.ok(!opts.some((o) => o.codes.includes('THEA 2211')));
});

// ---------- lists inside tracks are choices ----------
test('computer-science-bs: track sub-lists ("Complete 12 credits from the following") are choices, not required', async () => {
  const g = trackGroup(await prog('computer-science-bs'));
  const secure = g.options.filter((o) => o.section === 'Secure Computing Track');
  const cybr = secure.filter((o) => /^CYBR/.test(o.codes[0]));
  assert.equal(cybr.length, 6);
  assert.ok(cybr.every((o) => o.sub != null), 'CYBR list options belong to a sub-choice');
  assert.equal(g.subs[cybr[0].sub].pick.credits, 12);
  assert.ok(secure.filter((o) => o.sub == null).every((o) => !/^CYBR/.test(o.codes[0])));
  // the AI track's two "Complete 9 hours from the following:" lists
  const ai = (g.subs || []).filter((s) => s.section === 'Artificial Intelligence Track' && s.pick.credits === 9);
  assert.equal(ai.length, 2);
  for (const t of g.tracks) assert.equal(trackNeed(g, t), g.credits, `${t} adds up to the group's ${g.credits} credits`);
});

test('dance-bs: "Strongly Recommended" courses are not required; an "Electives" sub-heading is not a new track', async () => {
  const g = trackGroup(await prog('dance-bs'));
  assert.deepEqual(g.tracks, ['Ballroom Dance Track', 'Commercial Dance Track', 'Pre-Dance Therapy Track']);
  const rec = g.options.filter((o) => o.section === 'Ballroom Dance Track' && o.codes.includes('HLSC 1057'));
  assert.ok(rec.length && rec.every((o) => o.recommended), 'HLSC 1057 is only recommended');
  assert.ok(!g.options.some((o) => o.shared), 'no track list is mistaken for a shared elective list');
  for (const t of g.tracks) assert.equal(trackNeed(g, t), g.credits, `${t} adds up to ${g.credits}`);
});

test('information-technology-bs: "Select 12 Credit Hours from the following" inside a domain is a choice', async () => {
  const g = trackGroup(await prog('information-technology-bs'));
  const ent = g.options.filter((o) => o.section === 'Enterprise IT Domain');
  assert.ok(ent.length >= 6 && ent.every((o) => o.sub != null));
  // the Database domain's IT 4810R is a 1-3 credit course, so its total is a range that must contain 12
  for (const t of g.tracks) {
    const lo = trackNeed(g, t), hi = trackNeed(g, t, true);
    assert.ok(lo <= g.credits && g.credits <= hi, `${t} adds up to ${lo}-${hi}, needs ${g.credits}`);
  }
});

test('animation-game-development-bs: "Includes 36 credits of upper-division" is a note, not a track', async () => {
  const g = trackGroup(await prog('animation-game-development-bs'));
  assert.ok(!g.tracks.some((t) => /^includes\b/i.test(t)), g.tracks.join(' | '));
  assert.equal(g.tracks.length, 3);
});

// ---------- single-program parser bugs ----------
test('geology-bs: "GEO 3200 & 3205 or GEO 3500 & 3505" is one choice of two pairs; GEO 3200 is not required', async () => {
  const p = await prog('geology-bs');
  assert.equal(req(p, 'GEO 3200'), undefined);
  assert.equal(req(p, 'GEO 3205'), undefined);
  const g = choices(p).find((x) => x.options.some((o) => o.codes.join() === 'GEO 3200,GEO 3205') && x.options.some((o) => o.codes.join() === 'GEO 3500,GEO 3505') && x.options.length === 2);
  assert.ok(g, 'pair-or choice exists');
  assert.equal(g.pick.count, 1);
  assert.equal(g.credits, 4);
});

test('professional-advancement-bap: "Complete the following (… Certificate): 16" keeps its courses required', async () => {
  const p = await prog('professional-advancement-bap');
  for (const c of ['SLSS 2500', 'SLSS 3200', 'SLSS 4050G', 'SLSS 4800']) assert.ok(req(p, c), `${c} is required`);
});

test('commercial-music-bm: MUSC 1236 (an "or" under a recommended Fine Arts course) is kept', async () => {
  assert.ok(allCodes(await prog('commercial-music-bm')).has('MUSC 1236'));
});

// ---------- pick-N labels ----------
test('a borrowed plan label never states a different number than the list asks for', async () => {
  for (const id of ['dance-bs', 'gerontology-minor']) {
    const p = await prog(id);
    for (const g of choices(p)) {
      const m = g.label.match(/\b(?:complete|choose|select|take)\s+(?:any\s+|a minimum of\s+|at least\s+)?(\d+)\s+(?:credits?|credit hours?|hours?)\b/i);
      if (m && g.pick.credits) assert.equal(+m[1], g.pick.credits, `${id}: "${g.label}" asks for ${g.pick.credits}`);
    }
  }
});

// ---------- admission gates ----------
test('NURS 2300 ("Acceptance into ASN/BS Nursing program") is gated by admission; NURS 4230 by Advanced Standing', async () => {
  const p = await prog('nursing-bs');
  assert.equal(p.courses['NURS 2300'].gate, 'admission');
  assert.equal(p.courses['NURS 4230'].gate, 'advanced-standing');
  assert.equal(p.courses['BIOL 1610'].gate, undefined);
});

test('nursing-bs: admissionInfo lists the matriculation prerequisites as "before you apply"', async () => {
  const p = await prog('nursing-bs');
  assert.equal(p.admission, true);
  const a = p.admissionInfo;
  for (const c of ['ENGL 1010', 'PSY 1100', 'CHEM 1110', 'NUTR 1020', 'ZOOL 2320', 'MICR 2060', 'ZOOL 2420']) assert.ok(a.before.includes(c), c);
  assert.ok(!a.before.some((c) => /^NURS/.test(c)));
  assert.ok(a.gated.includes('NURS 2300'));
  assert.match(a.text, /All prerequisite courses must be completed prior to application/);
});

test('nursing-asn: with no matriculation list, "before you apply" comes from the plan terms before the first gated course', async () => {
  const a = (await prog('nursing-asn')).admissionInfo;
  for (const c of ['ENGL 1010', 'BIOL 1610', 'CHEM 1110', 'ZOOL 2320', 'ZOOL 2420']) assert.ok(a.before.includes(c), c);
  assert.ok(!a.before.some((c) => /^NURS/.test(c)));
  assert.equal(a.beforeFrom, 'graduation plan');
});

test('respiratory-therapy-aas: "Must be accepted into Program to take these Courses" gates the rows under it', async () => {
  const p = await prog('respiratory-therapy-aas');
  assert.equal(req(p, 'RESP 2145').gate, 'admission');
  assert.equal(req(p, 'RESP 2725').gate, 'admission');
  assert.equal(req(p, 'RESP 1540').gate, undefined);
});

test('social-work-bsw: a footnote "must be formally admitted into the BSW program" gates its course', async () => {
  const p = await prog('social-work-bsw');
  assert.equal(req(p, 'SW 3000').gate, 'admission');
  assert.equal(req(p, 'SW 1010').gate, undefined);
});

// ---------- grade minimums ----------
test('minimum grades: "Complete the following with a minimum C or higher" and B- footnotes', async () => {
  const bs = await prog('nursing-bs');
  assert.equal(req(bs, 'NURS 2300').minGrade, 'C');
  assert.equal(req(bs, 'ENGL 2010').minGrade, undefined);
  const asn = await prog('nursing-asn');
  assert.equal(req(asn, 'ZOOL 2320').minGrade, 'B-');
  const acc = await prog('accounting-bs');
  assert.ok(acc.requirements.some((r) => r.minGrade === 'B-'), 'a B- footnote reaches its requirement');
  const cs = trackGroup(await prog('computer-science-bs'));
  assert.equal(cs.minGrade, 'C-');
});

// ---------- source text ----------
test('every requirement carries its catalog source text (src)', async () => {
  for (const id of ['nursing-bs', 'electrical-engineering-bs', 'computer-science-bs']) {
    const p = await prog(id);
    for (const r of p.requirements) assert.ok(typeof r.src === 'string' && r.src.length > 3, `${id}: ${r.code || r.label} has src`);
  }
  const bs = await prog('nursing-bs');
  assert.match(req(bs, 'NURS 2300').src, /Discipline Core Requirements/);
  assert.match(req(bs, 'NURS 2300').src, /minimum C or higher/);
  assert.match(req(bs, 'NURS 2300').src, /NURS 2300/);
  assert.match(bs.url, /^https:\/\/catalog\.uvu\.edu\//);
});

// ---------- prerequisites in words ----------
test('NURS 4540: the worded prerequisites are kept as prereqWords', async () => {
  const c = (await prog('nursing-bs')).courses['NURS 4540'];
  assert.ok(c.prereqWords.some((w) => /university-level statistics course/i.test(w)), JSON.stringify(c.prereqWords));
  assert.ok(c.prereqWords.some((w) => /University Advanced Standing/.test(w)));
  assert.equal(c.prereqMinGrade, 'C');
});

// ---------- credits of alternatives ----------
test('ZOOL 4400 (4 cr) or ZOOL 2600 (3 cr): each alternative keeps its own credits; the plan\'s choice is preferred', async () => {
  const r = req(await prog('nursing-bs'), 'ZOOL 4400');
  assert.equal(r.credits, 3, 'the requirement row still counts 3 toward the 120');
  assert.deepEqual(r.creditsBy, { 'ZOOL 4400': 4, 'ZOOL 2600': 3 });
  assert.equal(r.prefer, 'ZOOL 2600');
});

// ---------- unchanged facts (regression net) ----------
test('EE BS: codes and credit total unchanged', async () => {
  const p = await prog('electrical-engineering-bs');
  assert.equal(p.totalCredits, 122);
  assert.equal(p.requirements.reduce((s, r) => s + (r.credits || 0), 0), 122);
  for (const c of ['ECE 2250', 'ECE 3710', 'ECE 3740', 'ECE 2700']) assert.ok(allCodes(p).has(c), c);
  // same rows, codes and credits as the shipped data file
  const shape = (x) => x.requirements.map((r) => [r.type, r.code || r.label, r.credits, (r.options || []).map((o) => o.codes.join('&')).join('|')].join(' '));
  const shipped = JSON.parse(readFileSync(new URL('../data/programs/electrical-engineering-bs.json', import.meta.url), 'utf8'));
  assert.deepEqual(shape(p), shape(shipped));
});
