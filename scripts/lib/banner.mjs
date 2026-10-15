// UVU Banner 9 public class search: a tiny cookie-session client + pure row compaction.
// Source: https://userve.uvu.edu/StudentRegistrationSsb/ssb/ (no login; cookie session; no CORS).
// Compact row keys are documented in scripts/fetch-sections.mjs.

export const BANNER = 'https://userve.uvu.edu/StudentRegistrationSsb/ssb';
const UA = 'SmartAdvisor/1.0 (student project; github.com/TimothyHadfield/smart-advisor)';

const DAY_KEYS = [['monday', 'M'], ['tuesday', 'T'], ['wednesday', 'W'], ['thursday', 'R'], ['friday', 'F'], ['saturday', 'S'], ['sunday', 'U']];

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
/** Banner HTML-escapes some strings ("O&#39;Flynn", "&euml;", "&ndash;"). */
export function decode(s) {
  if (s == null) return s;
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1));
    if (ENT[e]) return ENT[e];
    const acc = /^([a-z])(uml|acute|grave|circ|tilde|cedil|ring)$/i.exec(e);
    if (acc) return (acc[1] + { uml: '̈', acute: '́', grave: '̀', circ: '̂', tilde: '̃', cedil: '̧', ring: '̊' }[acc[2]]).normalize('NFC');
    return m;
  }).trim();
}

/** Banner meetingTime → "MWF" style day letters (R = Thursday, U = Sunday). */
export function dayLetters(mt) {
  return DAY_KEYS.filter(([k]) => mt && mt[k]).map(([, l]) => l).join('');
}

/** "08/19/2026" → "2026-08-19" (null stays null). */
export function isoDate(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s || '');
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
}

/**
 * Delivery mode from Banner's schedule type. Seen at UVU (202720): "Face to Face", "Face to Face Lab", "Online",
 * "Face to Face and Online", "Live Interactive", "Livestream", "Livestream and Online", "Face to Face and Livestream".
 * Any "X and Y" mix → hybrid; live video at a fixed time → livestream.
 */
export function modeOf(row) {
  const t = (row.scheduleTypeDescription || '').toLowerCase();
  if (/hybrid|blended| and /.test(t)) return 'hybrid';
  if (/live ?stream|live interactive|broadcast|ivc/.test(t)) return 'livestream';
  if (/online|internet|web/.test(t)) return 'online';
  return 'in person';
}

/** The section's primary instructor as Banner shows it ("Last, First M."), or null. */
export function primaryInstructor(row) {
  const f = row.faculty || [];
  const p = f.find((x) => x.primaryIndicator) || f[0];
  return p && p.displayName ? decode(p.displayName) : null;
}

function compactMeeting(mt) {
  const m = {
    days: dayLetters(mt),
    start: mt.beginTime || null,
    end: mt.endTime || null,
    bldg: mt.building || null,
    room: mt.room || null,
  };
  if (mt.meetingTypeDescription && mt.meetingTypeDescription !== 'Class') m.type = mt.meetingTypeDescription;
  m.sd = isoDate(mt.startDate);
  m.ed = isoDate(mt.endDate);
  return m;
}

/**
 * One Banner searchResults row → one compact section row.
 * Never keeps instructor emails, Banner IDs or anything about students.
 */
export function compactSection(row) {
  const meetings = (row.meetingsFaculty || []).map((x) => x.meetingTime).filter(Boolean).map(compactMeeting);
  const first = meetings[0] || { days: '', start: null, end: null, bldg: null, room: null, sd: null, ed: null };
  const prim = primaryInstructor(row);
  const others = (row.faculty || []).map((x) => decode(x.displayName)).filter((n) => n && n !== prim);
  const s = {
    crn: row.courseReferenceNumber,
    subj: row.subject,
    num: row.courseNumber,
    sec: row.sequenceNumber,
    title: decode(row.courseTitle),
    cr: row.creditHourLow ?? row.creditHours ?? null,
  };
  if (row.creditHourHigh != null && row.creditHourHigh !== s.cr) s.crMax = row.creditHourHigh;
  s.days = first.days;
  s.start = first.start;
  s.end = first.end;
  s.bldg = first.bldg;
  s.room = first.room;
  if (meetings.length > 1) s.meetings = meetings.map(({ days, start, end, bldg, room, type, sd, ed }) => ({ days, start, end, bldg, room, ...(type ? { type } : {}), sd, ed }));
  s.campus = row.campusDescription || null;
  s.mode = modeOf(row);
  s.kind = row.instructionalMethodDescription || null;
  s.instr = prim;
  if (others.length) s.instr2 = others;
  s.seats = row.seatsAvailable ?? null;
  s.cap = row.maximumEnrollment ?? null;
  s.wait = row.waitCount ?? null;
  s.sd = first.sd;
  s.ed = first.ed;
  if (row.partOfTerm && row.partOfTerm !== '1') s.pt = row.partOfTerm;
  if (row.linkIdentifier) s.link = row.linkIdentifier;
  return s;
}

/** Terms worth fetching: regular (not Non-Credit) terms whose code is >= the current term. */
export function upcomingTerms(terms, today = new Date()) {
  const y = today.getFullYear(), mo = today.getMonth() + 1;
  // UVU suffixes: 20 Spring (Jan–Apr), 30 Summer (May–Aug), 40 Fall (Aug–Dec).
  const cur = mo <= 4 ? `${y}20` : mo <= 7 ? `${y}30` : `${y}40`;
  return terms
    .filter((t) => /^\d{4}[234]0$/.test(t.code) && !/non-credit/i.test(t.description) && t.code >= cur)
    .map((t) => ({ code: t.code, name: t.description.replace(/\s*\(View Only\)\s*/i, '').trim() }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

/** Minimal cookie-jar session for the public Banner class search. */
export class BannerSession {
  constructor({ base = BANNER, fetchImpl = fetch } = {}) {
    this.base = base;
    this.fetch = fetchImpl;
    this.jar = new Map();
    this.sid = 'sa' + Date.now();
  }
  async req(path, opt = {}) {
    const headers = { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', ...(opt.headers || {}) };
    if (this.jar.size) headers.Cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const r = await this.fetch(this.base + path, { ...opt, headers, redirect: 'manual' });
    for (const c of r.headers.getSetCookie?.() || []) {
      const kv = c.split(';')[0];
      const i = kv.indexOf('=');
      if (i > 0) this.jar.set(kv.slice(0, i).trim(), kv.slice(i + 1));
    }
    if (r.status >= 400) throw new Error(`Banner ${path} → HTTP ${r.status}`);
    return r;
  }
  async open() { await this.req('/term/termSelection?mode=search'); }
  async terms() { return (await this.req('/classSearch/getTerms?searchTerm=&offset=1&max=30')).json(); }
  async bindTerm(term) {
    await this.req('/classSearch/resetDataForm', { method: 'POST' }).catch(() => {});
    await this.req('/term/search?mode=search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `term=${encodeURIComponent(term)}&uniqueSessionId=${this.sid}`,
    });
  }
  async page(term, offset, size = 500) {
    const q = `txt_term=${term}&uniqueSessionId=${this.sid}&pageOffset=${offset}&pageMaxSize=${size}&sortColumn=subjectDescription&sortDirection=asc`;
    const j = await (await this.req(`/searchResults/searchResults?${q}`)).json();
    if (!j.success) throw new Error(`Banner search failed for ${term} at ${offset}`);
    return j;
  }
}
