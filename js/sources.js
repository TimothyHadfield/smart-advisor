// Where every outside fact on the site comes from, as links. Pure: used by js/app.js, js/mineui.js and Node tests.
// Tim, 2026-10-22: "could you also have automatic links to everything you are reffering to or getting your
// informatoin from? This includes anything UVU, as well as Rate my professor, and anything we develope later in the cite."
// Rule for new features: build every outside link with sourceLink() and register every new data file in
// DATA_SOURCES (tests/sources.test.mjs fails otherwise, and fails on a UVU / RMP address typed anywhere else).

export const CATALOG = 'https://catalog.uvu.edu';
// UVU's public Banner 9 class search (where data/sections + data/seasons come from). It has no deep link to a
// term or course (every search starts from this term page in a cookie session; checked 2026-10-22).
export const CLASS_SEARCH = 'https://userve.uvu.edu/StudentRegistrationSsb/ssb/term/termSelection?mode=search';
export const RMP_PROF = 'https://www.ratemyprofessors.com/professor/';
export const RMP_SCHOOL = 'https://www.ratemyprofessors.com/school/18458';
export const ADVISING = 'https://www.uvu.edu/advising/advisors/';
// a student's UVU e-mail (UVID@uvu.edu: the address UVU's matriculation forms send to); '' without a UVID
export const uvuEmail = (uvid) => (/^\d{8}$/.test(String(uvid || '')) ? `${uvid}@uvu.edu` : '');
// CourseLeaf program page tabs
const TAB = { requirements: '#requirementstextcontainer', plan: '#graduationplantextcontainer' };

// "2026-2027" -> "2026-27"
const shortYear = (y) => (/^\d{4}-\d{4}$/.test(y || '') ? `${y.slice(0, 5)}${y.slice(7)}` : y || '');
// the catalog a year lives in: the current one at the root, older ones under /archives/<year>/
export const catalogRoot = (year, current) => (year && current && year !== current ? `${CATALOG}/archives/${year}` : CATALOG);

// kind + data -> { url, label, date? } or null when the data has no source to link
//   program  { program, tab?: 'requirements' | 'plan' }   (program = a data/programs file)
//   course   { code, year?, current? }                     (catalog course entry, with prereqs)
//   sections { term }                                      (data/sections/index.json terms[i])
//   rmp      { prof }                                      (data/rmp.json profs[instr])
//   gened    { gened }  · advisors { advisors }  · seasons { seasons }
//   url      { url, label, date? }                         (anything else a feature shows, e.g. a PDF)
export function sourceLink(kind, d = {}) {
  switch (kind) {
    case 'program': {
      const p = d.program;
      if (!p?.url) return null;
      return { url: p.url + (TAB[d.tab] || ''), label: `Catalog ${shortYear(p.catalogYear)}`.trim(), date: p.fetched || null };
    }
    case 'course':
      return d.code ? { url: `${catalogRoot(d.year, d.current)}/search/?P=${encodeURIComponent(d.code)}`, label: 'Catalog' } : null;
    case 'sections': {
      const t = d.term;
      return t ? { url: CLASS_SEARCH, label: `UVU class search${t.termName ? ` · ${t.termName}` : ''}`, date: t.fetched || null } : null;
    }
    case 'rmp':
      return Number.isInteger(d.prof?.id) || /^\d+$/.test(d.prof?.id || '') ? { url: RMP_PROF + encodeURIComponent(d.prof.id), label: 'Rate My Professors' } : null;
    case 'ratings': // all of UVU's professors on RMP (data/rmp.json) · school id 18458 (scripts/fetch-rmp.mjs)
      return { url: RMP_SCHOOL, label: 'Rate My Professors', date: d.rmp?.fetched || null };
    case 'gened':
      return d.gened?.url ? { url: d.gened.url, label: `Catalog ${shortYear(d.gened.catalogYear)}`.trim(), date: d.gened.fetched || null } : null;
    case 'advisors':
      return { url: d.advisors?.source || ADVISING, label: 'UVU advisors', date: d.advisors?.generated || null };
    case 'seasons':
      return { url: CLASS_SEARCH, label: 'UVU class search', date: d.seasons?.built || null };
    case 'url':
      return d.url ? { url: d.url, label: d.label || 'Source', date: d.date || null } : null;
    default:
      return null;
  }
}

// "2026-10-19T16:29:57Z" / "2026-10-19" -> "checked Oct 19" ('' when unknown)
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function checked(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date || '');
  return m ? `checked ${MON[+m[2] - 1]} ${+m[3]}` : '';
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// a small new-tab link: "Catalog 2026-27 ↗" (text = the label unless given; '' when there is no link)
// text '' = the arrow alone (inside a line of facts), named by its label for screen readers
export function linkHTML(link, text, cls = 'src') {
  if (!link?.url) return '';
  const t = text ?? link.label;
  const name = t ? '' : ` aria-label="${esc(link.label || 'Source')}" title="${esc(link.label || 'Source')}"`;
  return `<a class="${cls}" href="${esc(link.url)}" target="_blank" rel="noopener"${name}>${t ? `${esc(t)} ` : ''}↗</a>`;
}
// links joined with " · ", then the newest "checked" date among them
export function sourceLine(links) {
  const ok = links.filter((l) => l?.url);
  if (!ok.length) return '';
  const date = ok.map((l) => l.date).filter(Boolean).sort().pop();
  return ok.map((l) => linkHTML(l, l.text)).join(' · ') + (date ? ` · <span class="src-d">${checked(date)}</span>` : '');
}

// the plan's source line: each program's catalog requirements, the major's sample plan, when it was read
// parts = [{ program }] (major first)
export function programSources(parts = []) {
  const links = parts.flatMap((x, i) => {
    const req = sourceLink('program', { program: x.program, tab: 'requirements' });
    if (!req) return [];
    if (parts.length > 1) req.text = i ? shortName(x.program.name) : req.label;
    const out = [req];
    if (i === 0 && x.program.gradPlan?.length) out.push({ ...sourceLink('program', { program: x.program, tab: 'plan' }), text: 'Sample plan' });
    return out;
  });
  return sourceLine(links);
}
const shortName = (n) => String(n || '').replace(/,?\s*(Minor|Certificate.*|Undergraduate Certificate)$/i, '').trim() || n;

// ---------- every data file and where it came from (tests/sources.test.mjs checks each one) ----------
// match: path under data/ · url(d): the file's source · date(d): when it was read (omitted = built locally
// from other files) · records(d) + link(r, key): per-record links the site shows
const programs = { url: (d) => d.url, date: (d) => d.fetched };
export const DATA_SOURCES = [
  { match: /^catalogs\.json$/, url: () => `${CATALOG}/archives/` },
  { match: /^(\d{4}-\d{4}\/)?programs\/_year\.json$/, url: (d) => d.source, date: (d) => d.fetched,
    records: (d) => (d.programs || []).map((p) => [p.id, p]), link: (p) => sourceLink('program', { program: p }) },
  { match: /^programs\/index\.json$/, url: () => `${CATALOG}/programs/`, date: (d) => d.generated,
    records: (d) => (d.programs || []).map((p) => [p.id, p]), link: (p) => sourceLink('program', { program: p }) },
  { match: /^programs\/_by-college\.json$/, url: () => `${CATALOG}/programs/` },
  { match: /^programs\/_report\.json$/, url: () => `${CATALOG}/programs/`,
    records: (d) => (Array.isArray(d) ? d : []).map((r) => [r.id, r]), link: (r) => (r.url ? { url: r.url } : null) },
  { match: /^(\d{4}-\d{4}\/)?programs\/[^_][^/]*\.json$/, ...programs },
  { match: /^(\d{4}-\d{4}\/)?(courses|prereq-courses)\.json$/, url: () => `${CATALOG}/search/`,
    records: (d) => Object.keys(d).slice(0, 50).map((k) => [k, k]), link: (code) => sourceLink('course', { code }) },
  { match: /^(\d{4}-\d{4}\/)?gened\.json$/, url: (d) => d.url, date: (d) => d.fetched },
  { match: /^sections\/index\.json$/, url: () => CLASS_SEARCH,
    records: (d) => (d.terms || []).map((t) => [t.term, t]), link: (t) => (t.fetched ? sourceLink('sections', { term: t }) : null) },
  { match: /^sections\/\d{6}\.json$/, url: () => CLASS_SEARCH, date: (d) => d.fetched },
  { match: /^rmp\.json$/, url: () => RMP_PROF, date: (d) => d.fetched,
    records: (d) => Object.entries(d.profs || {}), link: (p) => sourceLink('rmp', { prof: p }) },
  { match: /^advisors\.json$/, url: (d) => d.source, date: (d) => d.generated,
    records: (d) => Object.entries(d.programs || {}), link: (a) => (a.advisingUrl ? { url: a.advisingUrl } : null) },
  { match: /^seasons\.json$/, url: () => CLASS_SEARCH, date: (d) => d.built },
  // UVU's own flowchart PDFs (shown as their own link under the legend: the PDF is the source)
  { match: /^uvu-flowcharts\.json$/, url: (d) => Object.values(d.programs || {})[0]?.[0]?.source, date: (d) => d.checked,
    records: (d) => Object.entries(d.programs || {}).flatMap(([id, l]) => l.map((c, i) => [`${id}#${i}`, c])), link: (c) => sourceLink('url', { url: c.url, label: c.title }) },
  // the hover glossary (js/glossary.js): each term's definition links the UVU page it came from
  { match: /^glossary\.json$/, url: (d) => d.source, date: (d) => d.checked,
    records: (d) => (d.terms || []).map((t) => [t.id, t]), link: (t) => sourceLink('url', { url: t.url, label: t.label }) },
  // each program's application page and what kind of form it uses (scripts/build-applications.mjs)
  { match: /^applications\.json$/, url: (d) => d.source, date: (d) => d.checked,
    records: (d) => Object.entries(d.programs || {}), link: (a) => sourceLink('url', { url: a.url, label: a.title || 'Application' }) },
  // short class names / requirement labels (scripts/build-short-titles.mjs), made from the catalog's own titles
  { match: /^short-titles\.json$/, url: () => `${CATALOG}/search/`, date: (d) => d.generated },
];
export const sourceFor = (path) => DATA_SOURCES.find((s) => s.match.test(path)) || null;
