// Match Banner instructor names ("Last, First M.") to Rate My Professors teachers.
// Pure functions; used by scripts/fetch-rmp.mjs and tests/rmp-match.test.mjs.
//
// Rule (from the 2026-10-15 research, upgraded for full Banner names):
//  1. Candidates = RMP teachers whose normalized last name equals the Banner last name
//     (also tried: last/first word of a multi-word last name, both sides).
//  2. First-name tiers, strongest first (see firstNameTier): exact → nickname/prefix/typo → same 4 letters →
//     initial (only when one side is just an initial). The first tier with any candidate decides.
//  3. Unrated RMP profiles (0 ratings) are dropped; nothing to show.
//  4. Several left: keep those whose department fits the subjects taught (Banner subject name words, plus
//     RMP departments learned from 2+ confident exact-name matches per subject); duplicates of one person merge.
//  5. Exact full name: trusted, except a common surname (6+ rated UVU teachers) in an unrelated department.
//     Nickname: department must not clash. 4-letter / initial: department must fit. Otherwise no rating.

export const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');

const NICK_GROUPS = [
  'william bill will billy liam', 'robert bob rob robbie bobby', 'richard rick rich dick ricky', 'james jim jimmy jamie',
  'john jack johnny jon', 'jonathan jon john', 'michael mike mikey mick', 'christopher chris kris', 'kristopher kris chris',
  'christine chris christy tina', 'christina chris tina', 'matthew matt', 'daniel dan danny', 'david dave davey',
  'joseph joe joey', 'thomas tom tommy', 'anthony tony', 'steven steve', 'stephen steve steven', 'kenneth ken kenny',
  'ronald ron ronnie', 'donald don donnie', 'edward ed eddie ted ned', 'benjamin ben benji', 'samuel sam sammy',
  'samantha sam', 'nicholas nick nicky', 'timothy tim timmy', 'andrew andy drew', 'alexander alex xander',
  'alexandra alex lexi', 'gregory greg', 'jeffrey jeff', 'jeffery jeff', 'geoffrey jeff geoff', 'katherine kathy kate katie kat',
  'kathryn kathy kate katie', 'catherine cathy kate katie cat', 'elizabeth liz beth betsy lizzy eliza libby',
  'jennifer jen jenny', 'rebecca becky becca', 'susan sue suzy', 'suzanne sue suzy', 'deborah debbie deb', 'debra debbie deb',
  'patricia pat patty trish', 'patrick pat', 'margaret maggie meg peggy', 'cynthia cindy', 'pamela pam', 'kimberly kim',
  'jessica jess jessie', 'victoria vicki vicky tori', 'abigail abby', 'zachary zach zack', 'nathan nate', 'nathaniel nate nathan',
  'joshua josh', 'jacob jake', 'douglas doug', 'gerald jerry', 'lawrence larry', 'raymond ray', 'leonard len leo',
  'frederick fred freddy', 'charles chuck charlie chas', 'philip phil', 'phillip phil', 'russell russ', 'stanley stan',
  'terrence terry', 'terry terrence', 'theodore ted teddy theo', 'vincent vince', 'walter walt', 'mitchell mitch',
  'bradley brad', 'cameron cam', 'kristen kris kristy', 'kristin kris kristy', 'jacqueline jackie', 'judith judy',
  'janet jan', 'janice jan', 'barbara barb', 'carolyn carol', 'dorothy dot dottie', 'eugene gene', 'harold hal harry',
  'henry hank harry', 'jerome jerry', 'kevin kev', 'leslie les', 'louis lou', 'melissa missy mel', 'melanie mel',
  'michelle shelly', 'nancy nan', 'peter pete', 'randall randy', 'randolph randy', 'ronald ron', 'sandra sandy',
  'scott scotty', 'shannon shan', 'stephanie steph', 'sydney syd', 'tamara tammy', 'teresa terri tess', 'theresa terri tess',
  'valerie val', 'virginia ginny', 'wesley wes', 'zachariah zach', 'benedict ben', 'allison allie ali', 'alison allie ali',
  'mohammad mohammed muhammad mohamed md', 'muhammad mohammad mohammed mohamed md', 'mohammed mohammad muhammad md',
];
const NICK = new Map();
for (const g of NICK_GROUPS) {
  const w = g.split(' ');
  for (const a of w) {
    if (!NICK.has(a)) NICK.set(a, new Set());
    for (const b of w) if (a !== b) NICK.get(a).add(b);
  }
}

/** "Sherkat Masoum, Mohammad A." → { last: "Sherkat Masoum", firsts: ["mohammad"], initial: "m" } */
export function parseBannerName(name) {
  if (!name) return null;
  const i = name.indexOf(',');
  if (i < 0) return null;
  const last = name.slice(0, i).trim();
  const rest = name.slice(i + 1).trim();
  if (!last || !rest || /^(staff|tba)$/i.test(last)) return null;
  // First-name words, minus middle initials ("A.", "J") but keeping 2-letter names like "KC" or "Md".
  const words = rest.split(/\s+/).filter((w) => !/^[A-Za-z]\.?$/.test(w)).map(norm).filter(Boolean);
  const initial = norm(rest)[0] || '';
  return { last, firsts: words.length ? words : [], initial };
}

/** Edit distance ≤ 1 with a swap counted as one edit ("Eric"/"Erik", "Olga"/"Ogla"). */
function near(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    const d = [...a].map((c, i) => (c !== b[i] ? i : -1)).filter((i) => i >= 0);
    return d.length === 1 || (d.length === 2 && d[1] === d[0] + 1 && a[d[0]] === b[d[1]] && a[d[1]] === b[d[0]]);
  }
  const [s, l] = a.length < b.length ? [a, b] : [b, a];
  for (let i = 0; i < l.length; i++) if (l.slice(0, i) + l.slice(i + 1) === s) return true;
  return false;
}

/** Is `y` a plausible form of first name `x`? (nickname table, "Chris"→"Christopher" prefix, one-letter typo) */
function firstCompat(x, y) {
  if (NICK.get(x)?.has(y)) return true;
  const [s, l] = x.length < y.length ? [x, y] : [y, x];
  if (s.length >= 3 && l.startsWith(s)) return true;
  return s.length >= 4 && near(x, y);
}

/**
 * 3 = same first name, 2 = nickname / prefix / typo, 1.5 = same first 4 letters ("Dusty"/"Dustin"),
 * 1 = same initial where one side IS just an initial ("N Peterson", "Lee, KC"), 0 = no.
 * Two different full first names with the same initial ("Anna"/"Amy") are 0: different people.
 */
export function firstNameTier(banner, rmpFirst) {
  const r = (rmpFirst || '').split(/[\s.\-]+/).map(norm).filter(Boolean);
  if (!r.length) return 0;
  const b = banner.firsts;
  if (b.some((x) => r.includes(x)) || norm(rmpFirst) === b.join('')) return 3;
  for (const x of b) for (const y of r) if (firstCompat(x, y)) return 2;
  for (const x of b) for (const y of r) if (x.length >= 4 && y.length >= 4 && x.slice(0, 4) === y.slice(0, 4)) return 1.5;
  const bi = b.length ? b[0][0] : banner.initial;
  if (r[0][0] === bi && (!b.length || b[0].length <= 2 || r[0].length <= 2)) return 1;
  return 0;
}

/** Index RMP teachers by normalized last name (+ first/last word of multi-word last names). */
export function buildIndex(teachers) {
  const by = new Map();
  const add = (k, t) => { if (!k) return; if (!by.has(k)) by.set(k, new Set()); by.get(k).add(t); };
  for (const t of teachers) {
    add(norm(t.lastName), t);
    const parts = (t.lastName || '').trim().split(/[\s-]+/);
    if (parts.length > 1) { add(norm(parts.at(-1)), t); add(norm(parts[0]), t); }
  }
  return by;
}

function lastNameCandidates(index, last) {
  const keys = [norm(last)];
  const parts = last.split(/[\s-]+/);
  if (parts.length > 1) keys.push(norm(parts.at(-1)), norm(parts[0]));
  for (const k of keys) { const c = index.get(k); if (c && c.size) return [...c]; }
  return [];
}

const stems = (s) => (s || '').toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 4 && !/^(with|studies|science|sciences|general|services|education)$/.test(w));
// Two words share a stem when one starts with the other's first 4–5 letters ("fire" ~ "firefighter", "engin" ~ "engineering").
const stemHit = (a, b) => a.some((x) => b.some((y) => x.startsWith(y.slice(0, 5)) || y.startsWith(x.slice(0, 5))));

/**
 * Department plausibility.
 * deptHints: { SUBJ: { name: "Electrical Comp Engineering", depts: Set(["Engineering", ...]) } }
 * Returns true / false, or null when nothing is known about these subjects.
 */
export function deptFits(dept, subjects, deptHints = {}) {
  let known = false;
  const d = stems(dept);
  for (const s of subjects) {
    const h = deptHints[s];
    if (!h) continue;
    if (h.depts && h.depts.size) { known = true; if (h.depts.has(dept)) return true; }
    if (h.name) { known = true; if (stemHit(d, stems(h.name))) return true; }
  }
  return known ? false : null;
}

/** Merge duplicate RMP profiles of one person: ratings-weighted averages, summed counts, id of the biggest. */
export function mergeProfiles(list) {
  const n = list.reduce((a, t) => a + t.numRatings, 0);
  const avg = (k) => Math.round((list.reduce((a, t) => a + t[k] * t.numRatings, 0) / n) * 10) / 10;
  const w = list.filter((t) => t.wouldTakeAgainPercent >= 0);
  const wn = w.reduce((a, t) => a + t.numRatings, 0);
  const top = [...list].sort((a, b) => b.numRatings - a.numRatings)[0];
  return {
    r: avg('avgRating'),
    d: avg('avgDifficulty'),
    n,
    wta: wn ? Math.round(w.reduce((a, t) => a + t.wouldTakeAgainPercent * t.numRatings, 0) / wn) : null,
    id: top.legacyId,
  };
}

/**
 * Match one Banner instructor.
 * → { status: 'hit' | 'ambiguous' | 'none' | 'unrated' | 'skip', prof?, how?, cands? }
 */
export function matchInstructor(name, subjects, index, deptHints = {}) {
  const b = parseBannerName(name);
  if (!b) return { status: 'skip' };
  const all = lastNameCandidates(index, b.last);
  if (!all.length) return { status: 'none' };
  let tier = 0, cands = [];
  for (const t of [3, 2, 1.5, 1]) {
    cands = all.filter((x) => firstNameTier(b, x.firstName) === t);
    if (cands.length) { tier = t; break; }
  }
  if (!cands.length) return { status: 'none' };
  const rated = cands.filter((x) => x.numRatings > 0);
  if (!rated.length) return { status: 'unrated' };
  cands = rated;
  const fitOf = (x) => deptFits(x.department, subjects, deptHints);
  if (cands.length > 1) {
    const good = cands.filter((x) => fitOf(x) === true);
    if (good.length) cands = good;
  }
  const hit = (how) => ({ status: 'hit', how: cands.length > 1 ? `${how}, merged ${cands.length}` : how, prof: mergeProfiles(cands), cands });
  const fit = cands.some((x) => fitOf(x) === true) ? true : cands.every((x) => fitOf(x) === null) ? null : false;
  // Several left: duplicates of one person only when every first name is compatible with every other.
  const onePerson = cands.every((x) => cands.every((y) => x === y || firstNameTier({ firsts: x.firstName.split(/[\s.\-]+/).map(norm).filter(Boolean), initial: '' }, y.firstName) >= 2));
  // Common surname at UVU (6+ rated teachers): a same-name profile in an unrelated department may be someone else.
  const commonLast = all.filter((x) => x.numRatings > 0).length >= 6;
  if (tier === 3) {
    if (fit === false && commonLast) return { status: 'ambiguous', how: 'common surname, dept differs', cands };
    // Same full name: one profile, or several in fitting/identical departments = duplicate profiles of one person.
    if (cands.length === 1 || fit === true || cands.every((x) => x.department === cands[0].department)) return hit(fit === false ? 'name (dept differs)' : 'name');
    return { status: 'ambiguous', cands };
  }
  if (cands.length > 1 && !onePerson) return { status: 'ambiguous', cands };
  if (tier === 2 && fit !== false) return hit(fit === true ? 'nickname+dept' : 'nickname');
  if (tier === 1.5 && fit === true) return hit('same 4 letters+dept');
  if (tier === 1 && fit === true) return hit('initial+dept');
  return { status: 'ambiguous', cands };
}

/**
 * Match every instructor. instructors: Map(name → Set(subjects)). subjectNames: { SUBJ: "description" }.
 * Two passes: pass 1 learns which RMP departments go with each subject from confident exact-name hits,
 * pass 2 uses that to judge the weaker matches.
 */
export function matchAll(instructors, teachers, subjectNames = {}) {
  const index = buildIndex(teachers);
  const hints = {};
  for (const [s, n] of Object.entries(subjectNames)) hints[s] = { name: n, depts: new Set() };
  const seen = new Map(); // "SUBJ|Dept" → count; a department counts for a subject after 2 separate people
  for (const [name, subs] of instructors) {
    const b = parseBannerName(name);
    if (!b) continue;
    const c = lastNameCandidates(index, b.last).filter((x) => x.numRatings > 0 && firstNameTier(b, x.firstName) === 3);
    if (c.length === 1 && subs.size === 1) {
      const k = [...subs][0] + '|' + c[0].department;
      seen.set(k, (seen.get(k) || 0) + 1);
    }
  }
  for (const [k, n] of seen) {
    if (n < 2) continue;
    const [s, d] = k.split('|');
    (hints[s] ||= { name: '', depts: new Set() }).depts.add(d);
  }
  const profs = {};
  const stats = { hit: 0, ambiguous: 0, none: 0, unrated: 0, skip: 0 };
  const detail = [];
  for (const [name, subs] of instructors) {
    const r = matchInstructor(name, [...subs], index, hints);
    stats[r.status]++;
    if (r.status === 'hit') profs[name] = r.prof;
    detail.push({ name, subjects: [...subs], ...r });
  }
  return { profs, stats, detail };
}
