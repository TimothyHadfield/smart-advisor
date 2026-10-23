// Run: node --test tests/box-contrast.test.mjs
// Tim (2026-10-23): "make it so that the words are bright and easy to read, not dim like they are now".
// Flowchart box text against every box fill, light and dark theme, read straight from css/app.css:
// semester fills (planned), the same fills faded (can't be taken yet), not-planned boxes, taken (green),
// taken with a grade (red -> green), in progress, requirement ("pick") boxes. Main text >= 7:1; the faded
// state's text >= 4.5:1 (still readable) and lighter than the main text (still tells apart).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CSS = readFileSync(new URL('../css/app.css', import.meta.url), 'utf8');

// custom properties per theme: light = every top-level :root block; dark = light + :root[data-theme="dark"]
function themeVars(dark) {
  const v = {};
  const take = (body) => { for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) v[m[1]] = m[2].trim(); };
  for (const m of CSS.matchAll(/^:root\s*\{([^}]*)\}/gm)) take(m[1]);
  if (dark) for (const m of CSS.matchAll(/^:root\[data-theme="dark"\]\s*\{([^}]*)\}/gm)) take(m[1]);
  return v;
}
const hex = (s) => { const m = /^#([0-9a-f]{6})$/i.exec(s.trim()); assert.ok(m, `not a hex colour: ${s}`); return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)); };
const hsl = (h, s, l) => { s /= 100; l /= 100; const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l); return [0, 8, 4].map((n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))))); };
const mix = (a, b, p) => a.map((x, i) => Math.round(x * p + b[i] * (1 - p))); // color-mix(in srgb, a p, b)
const lum = (c) => { const [r, g, b] = c.map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [p, q] = [lum(a), lum(b)].sort((x, y) => y - x); return (p + 0.05) / (q + 0.05); };
// every rule for exactly this selector, in file order (later ones win, as in the browser)
const rule = (sel) => [...CSS.matchAll(new RegExp(`^${sel.replace(/[.*()[\]]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'gm'))].map((m) => m[1]).join(';');
const prop = (sel, p) => [...rule(sel).matchAll(new RegExp(`(?:^|;|\\s)${p}\\s*:\\s*([^;]+)`, 'g'))].pop()?.[1].trim();

// every box state as js/app.js sets its classes: [name, fill, text colour, faded?]
function pairs(dark) {
  const v = themeVars(dark);
  const c = (expr) => { const m = /^var\((--[\w-]+)\)$/.exec(expr.trim()); return hex(m ? v[m[1]] : expr); };
  const panel = c('var(--panel)');
  const text = c(prop('.box', 'color'));
  const plannedText = c(prop('.box.planned', 'color'));
  const lockedText = c(prop('.box.locked', 'color'));
  const doneText = c(prop('.box.done', 'color'));
  const out = [['not planned', c(prop('.box', 'background')), text, false]];
  for (let i = 0; i < 10; i++) {
    const sf = c(`var(--s${i}f)`);
    out.push([`planned s${i}`, sf, plannedText, false], [`can't take yet s${i}`, mix(sf, panel, 0.45), lockedText, true]);
  }
  out.push(['can\'t take yet, not planned', c(prop('.box', 'background')), lockedText, true]);
  out.push(['taken', c(prop('.box.done', 'background')), doneText, false]);
  const gb = /hsl\(var\(--gh\)\s+58%\s+([^)]+)\)/.exec(prop('.box.done.graded', 'background'))[1].trim();
  const gl = parseFloat(gb.startsWith('var(') ? v[/--[\w-]+/.exec(gb)[0]] : gb);
  for (let h = 0; h <= 120; h += 10) out.push([`taken, grade hue ${h}`, hsl(h, 58, gl), doneText, false]);
  out.push(['in progress', mix(c('var(--done-bg)'), panel, 0.16), c(prop('.box.done.ip', 'color')), false]);
  return out;
}

test('box text: >= 7:1 on every fill, faded text >= 4.5:1 and lighter, light and dark', () => {
  const bad = [];
  let min = Infinity, minF = Infinity;
  for (const dark of [false, true]) for (const [name, fill, fg, faded] of pairs(dark)) {
    const r = ratio(fill, fg);
    if (faded) minF = Math.min(minF, r); else min = Math.min(min, r);
    if (r < (faded ? 4.5 : 7)) bad.push(`${dark ? 'dark' : 'light'} ${name}: ${r.toFixed(2)}`);
  }
  console.log(`box text contrast: main min ${min.toFixed(2)}:1, faded min ${minF.toFixed(2)}:1`);
  assert.deepEqual(bad, []);
  for (const dark of [false, true]) {
    const v = themeVars(dark), c = (e) => hex(/^var\((--[\w-]+)\)$/.test(e) ? v[/--[\w-]+/.exec(e)[0]] : e);
    assert.notDeepEqual(c(prop('.box.locked', 'color')), c(prop('.box.planned', 'color')), 'faded text tells apart from main text');
  }
});

test('box titles are full strength: no grey secondary colour or opacity, medium weight or more', () => {
  const i = rule('.box i');
  assert.ok(!/(^|;|\s)(color|opacity)\s*:/.test(i), `.box i sets its own colour/opacity: ${i}`);
  assert.ok(+(/font-weight:\s*(\d+)/.exec(i)?.[1] || 400) >= 500, 'title weight');
});
