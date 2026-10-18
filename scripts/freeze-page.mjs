#!/usr/bin/env node
// Freeze catalog program pages (and the course entries they name) into gzipped test fixtures, so the parser
// tests run on real CourseLeaf markup without the network.
// Usage: node scripts/freeze-page.mjs --cache <cache>/<year> [--year 2026-2027] id [id...]
// Output: tests/fixtures/catalog/<id>.json.gz = { id, url, catalogYear, html, courses: { code: rawXml } }
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const cache = opt('--cache');
const year = opt('--year', '2026-2027');
if (!cache || !args.length) { console.error('Usage: node scripts/freeze-page.mjs --cache <cache>/<year> id [id...]'); process.exit(1); }
const manifestDir = year === '2026-2027' ? join(ROOT, 'data', 'programs') : join(ROOT, 'data', year, 'programs');
const manifest = JSON.parse(await readFile(join(manifestDir, '_year.json'), 'utf8'));
const files = new Set(await readdir(cache));
const out = join(ROOT, 'tests', 'fixtures', 'catalog');
await mkdir(out, { recursive: true });
for (const id of args) {
  const html = await readFile(join(cache, `program-${id}.html`), 'utf8');
  const url = manifest.programs.find((p) => p.id === id)?.url ?? '';
  // every code the page text names (a superset of what the parser asks for), plus the lab/alias forms
  const codes = new Set();
  for (const m of html.replace(/&#160;|&nbsp;/g, ' ').matchAll(/\b([A-Z]{2,5}) ?(\d{4}[A-Z]{0,2})\b/g)) codes.add(`${m[1]} ${m[2]}`);
  const courses = {};
  for (const c of [...codes].sort()) {
    const f = `course-${c.replace(/\s/g, '_')}.xml`;
    if (files.has(f)) courses[c] = await readFile(join(cache, f), 'utf8');
  }
  const body = gzipSync(JSON.stringify({ id, url, catalogYear: year, html, courses }));
  await writeFile(join(out, `${id}.json.gz`), body);
  console.log(`${id}: ${Object.keys(courses).length} courses, ${(body.length / 1024).toFixed(1)} KB`);
}
