// Flowchart hover (js/app.js), the pure parts: which lines light up when a box is hovered (or pressed on
// a phone), the tiny label's text, and where the label sits. Tests: tests/hover.test.mjs.

// UVU terms start in January (Spring), May (Summer) and August (Fall)
const MONTH = { Spring: 'Jan', Summer: 'May', Fall: 'Aug' };
/** "Fall 2025" -> "Aug 2025" ('' when it isn't a UVU term). */
export function termMonth(label) {
  const [season, year] = String(label || '').split(' ');
  return MONTH[season] && /^\d{4}$/.test(year || '') ? `${MONTH[season]} ${year}` : '';
}

/**
 * The lines of one box, direct connections only: pre = lines into it (its prerequisites),
 * post = lines out of it (the classes that need it). Indexes into `edges` ({from, to}).
 */
export function edgeRoles(edges, id) {
  const pre = [], post = [];
  edges.forEach((e, i) => { if (e.to === id) pre.push(i); else if (e.from === id) post.push(i); });
  return { pre, post };
}

/**
 * The label's text: when the class was taken (+ its grade), when it is in progress, or when the plan has it.
 *   done: taken or in progress · grade: its grade ('IP' = in progress) · term: the semester it was taken in
 *   ("Fall 2025", from the audit) · planned: the plan's semester for it · now: the semester in session
 * '' = no label.
 */
export function hintText({ done, grade = '', term = '', planned = '', now = '' }) {
  if (!done) return planned && termMonth(planned) ? `Planned ${termMonth(planned)}` : '';
  if (String(grade).toUpperCase() === 'IP') {
    if (term && now && term !== now) return termMonth(term);
    const m = termMonth(term || now);
    return m ? `Now · ${m}` : 'Now';
  }
  return [termMonth(term), grade].filter(Boolean).join(' · ');
}

/**
 * Where the label goes: exactly as wide as the box and lined up with it (never left or right of it),
 * just above it, or just below when there's no room above `top` (the chart's visible top edge).
 * box = {x, y, w, h} · h = the label's height · gap = space between label and box.
 */
export function placeHint(box, { h, gap = 2, top = 0 }) {
  const above = box.y - gap - h;
  return above >= top
    ? { left: box.x, width: box.w, top: above, side: 'above' }
    : { left: box.x, width: box.w, top: box.y + box.h + gap, side: 'below' };
}
