#!/usr/bin/env node
// Prerequisite check over every program in every catalog year, with the data the site actually loads
// (js/curprereqs.js forCatalogYear: an older catalog year takes each course's prereqs from the current
// catalog). Usage: node scripts/check-prereqs.mjs [--list]
// Reports:
//   (a) older-year course entries whose prereq fields still differ from the current catalog (must be 0;
//       "before" = the same count on the raw old-year files, i.e. what the fix changed)
//   (b) courses whose prereq text names another course (outside "recommended" advice) but nothing was
//       parsed into prereqs / precoreqs / coreqs
//   (c) chart boxes with no incoming line whose prereq text names a class of the same chart
//       (the "looks like a beginner class" symptom)
// --raw: the old-year files as they are, without the fix (to see what it changes). Exit 1 when (a) > 0.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildModel, flowNodes, flowEdges, codesOf } from '../js/planner.js';
import { forCatalogYear, prereqSig } from '../js/curprereqs.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const readJSON = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

// "recommended" advice removed (same rules as tests/prereq-recommended.test.mjs)
export function adviceFree(t) {
  return String(t || '')
    .replace(/\([^()]*recommend[^()]*\)/gi, ' ').replace(/\[[^[\]]*recommend[^[\]]*\]/gi, ' ')
    .split(/(?<=\.)\s+/).filter((s) => !/^\s*(?:also,?\s*)?(?:it is\s+)?(?:also\s+)?(?:strongly\s+|highly\s+)?recommended\b/i.test(s))
    .map((s) => s.split(/[,;]/).filter((p) => !/recommend/i.test(p)).join(' , '))
    .join(' ');
}
export const codesInText = (t) => [...new Set([...String(t).replace(/\b([A-Z]{2,5})(\d{4}[A-Z]{0,2})\b/g, '$1 $2')
  .matchAll(/\b([A-Z]{2,5}) (\d{4}[A-Z]{0,2})\b/g)].map((m) => `${m[1]} ${m[2]}`))];

function programFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('_') && f !== 'index.json').map((f) => join(dir, f));
}

export function checkAll({ raw = false } = {}) {
  const current = readJSON(join(ROOT, 'courses.json'));
  const currentPC = readJSON(join(ROOT, 'prereq-courses.json'));
  const seasons = readJSON(join(ROOT, 'seasons.json'));
  const years = [null, ...readdirSync(ROOT).filter((d) => /^\d{4}-\d{4}$/.test(d))];
  const out = { programs: 0, a: [], aBefore: 0, changed: new Map(), b: new Map(), c: [] };
  for (const y of years) {
    const base = y ? join(ROOT, y) : ROOT;
    const yearPC = y ? readJSON(join(base, 'prereq-courses.json')) : null;
    const gened = readJSON(join(base, 'gened.json')) || readJSON(join(ROOT, 'gened.json'));
    for (const f of programFiles(join(base, 'programs'))) {
      const file = readJSON(f);
      if (!file?.courses) continue;
      out.programs++;
      const id = `${y || 'current'}/${f.replace(/^.*[\\/]/, '').replace('.json', '')}`;
      const { program, extraCourses } = y && !raw ? forCatalogYear(file, { current, currentPC, yearPC }) : { program: file, extraCourses: yearPC || currentPC };
      // (a) older years: every course still in the current catalog carries the current prereqs
      if (y) {
        for (const [k, c] of Object.entries(file.courses)) {
          if (!current[k]) continue;
          if (prereqSig(c) !== prereqSig(current[k])) {
            out.aBefore++;
            const e = out.changed.get(k) || { code: k, programs: 0, before: c.prereqText || '', now: current[k].prereqText || '' };
            e.programs++; out.changed.set(k, e);
          }
          if (prereqSig(program.courses[k]) !== prereqSig(current[k])) out.a.push(`${id}: ${k}`);
        }
      }
      // (b) prereq text names a course, nothing parsed
      for (const [k, c] of Object.entries(program.courses)) {
        const named = codesInText(adviceFree(c.prereqText)).filter((x) => x !== k);
        const parsed = [...codesOf(c.prereqs), ...codesOf(c.precoreqs)];
        if (named.length && !parsed.length && !out.b.has(k)) out.b.set(k, `${k}: ${c.prereqText}`);
      }
      // (c) a box with no line into it whose prereq text names a class of the same chart
      const model = buildModel(program, { extraCourses, gened, seasons });
      const nodes = flowNodes(model);
      const into = new Set(flowEdges(model).map((e) => e.to));
      const courses = model.program.courses || {};
      for (const n of nodes) {
        if (into.has(n.id) || !(n.kind === 'course' || n.kind === 'option')) continue;
        const own = n.codes || [n.code];
        const namedBy = (k) => codesInText(adviceFree((current[k] || courses[k])?.prereqText))
          .filter((x) => !own.includes(x) && model.byCode[x] && model.byCode[x].id !== n.id);
        // a course box is "A or B": it needs nothing when one alternative needs nothing (IT 2600 or
        // CS 2600); an option box's classes are all taken, so one class naming a chart class is enough
        const named = n.kind === 'course' ? (own.every((k) => namedBy(k).length) ? own.flatMap(namedBy) : []) : own.flatMap(namedBy);
        if (named.length) out.c.push(`${id}: ${n.code} names ${[...new Set(named)].join(', ')} <- ${own.map((k) => courses[k]?.prereqText).filter(Boolean).join(' | ')}`);
      }
    }
  }
  return { programs: out.programs, a: out.a, aBefore: out.aBefore, changed: [...out.changed.values()].sort((x, y) => y.programs - x.programs), b: [...out.b.values()].sort(), c: out.c };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = checkAll({ raw: process.argv.includes('--raw') });
  const list = process.argv.includes('--list');
  console.log(`programs checked: ${r.programs}`);
  console.log(`(a) older-year prereq mismatches: ${r.a.length} (raw old-year files: ${r.aBefore} entries, ${r.changed.length} courses)`);
  for (const x of r.a.slice(0, 20)) console.log('    ' + x);
  if (list) for (const e of r.changed) console.log(`    ${e.code} (${e.programs} programs): "${e.before}" -> "${e.now}"`);
  console.log(`(b) prereq text names a course, nothing parsed: ${r.b.length}`);
  for (const x of r.b) console.log('    ' + x);
  console.log(`(c) no line in, but prereq text names a class of the chart: ${r.c.length}`);
  for (const x of list ? r.c : r.c.slice(0, 40)) console.log('    ' + x);
  process.exit(r.a.length ? 1 : 0);
}
