#!/usr/bin/env node
// Catalog entries for prerequisites that are NOT part of a program (MATH 1050 before MATH 1210 in EE),
// so the planner can show them as "needed first" boxes instead of assuming they are done.
// Usage: node scripts/build-prereq-courses.mjs      (offline: reads data/ only)
// Writes data/prereq-courses.json (current catalog) and data/<year>/prereq-courses.json (archived years):
//   { code: { title, credits, creditsMax?, prereqs, prereqText? } }  — a small slice of courses.json
// (courses.json is ~1 MB; this file is what the browser loads).

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');

const codesOf = (e) => (!e ? [] : typeof e === 'string' ? [e] : (e.and || e.or || []).flatMap(codesOf));

/** Every prerequisite code of a program's courses that the program file has no entry for. */
export function outsideCodes(program) {
  const own = program.courses || {};
  const out = new Set();
  for (const c of Object.values(own)) for (const k of [...codesOf(c.prereqs), ...codesOf(c.precoreqs)]) if (!own[k]) out.add(k);
  return out;
}

export function slice(catalog, codes) {
  const out = {};
  for (const k of [...codes].sort()) {
    const c = catalog[k];
    if (!c) continue;
    out[k] = { title: c.title || '', credits: c.credits ?? null };
    if (c.creditsMax != null) out[k].creditsMax = c.creditsMax;
    out[k].prereqs = c.prereqs ?? null;
    if (c.prereqText) out[k].prereqText = c.prereqText;
  }
  return out;
}

async function build(dir) {
  const progDir = join(dir, 'programs');
  const catFile = join(dir, 'courses.json');
  if (!existsSync(progDir) || !existsSync(catFile)) return null;
  const catalog = JSON.parse(await readFile(catFile, 'utf8'));
  const codes = new Set();
  for (const f of await readdir(progDir)) {
    if (!f.endsWith('.json') || f.startsWith('_') || f === 'index.json') continue;
    const p = JSON.parse(await readFile(join(progDir, f), 'utf8'));
    for (const k of outsideCodes(p)) codes.add(k);
  }
  const out = slice(catalog, codes);
  await writeFile(join(dir, 'prereq-courses.json'), JSON.stringify(out) + '\n');
  return { dir, codes: codes.size, kept: Object.keys(out).length };
}

async function main() {
  const dirs = [DATA, ...(await readdir(DATA)).filter((d) => /^\d{4}-\d{4}$/.test(d)).map((d) => join(DATA, d))];
  for (const d of dirs) { const r = await build(d); if (r) console.log(`${r.dir}: ${r.kept} of ${r.codes} outside prereqs have catalog entries`); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
