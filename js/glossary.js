// Hover glossary: UVU words explained in place (data/glossary.json, each definition from a UVU page).
// Tim, 2026-10-23: "Create previews of descriptions of what something means when the user hovers over it
// accross the cite. For example, if I hover over the phrase "University Advanced Standing" in a sentence, it
// should pop up something that says what it means."
// A term in the site's text gets a dotted underline; hover (mouse), tap or Enter shows a small card with the
// meaning and its source; it closes on Esc, a tap elsewhere, or scrolling. Never inside flowchart boxes.
// The top half is pure (Node tests); initGlossary is the page part.

// data -> { entries: Map(id -> entry), re, exact: Map(text -> id) }
//   entry: { id, term, def, url, label, phrases: [...] (any case), words: [...] (exact case, whole word),
//            exact: [...] (the whole text of an element, e.g. a grade "W"), pattern: "regex" }
export function compileGlossary(data) {
  const entries = new Map();
  const alts = [];
  const exact = new Map();
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const t of data?.terms || []) {
    entries.set(t.id, t);
    for (const p of t.phrases || []) alts.push({ src: reEsc(p).replace(/\s+/g, '\\s+'), id: t.id, len: p.length, ci: true });
    for (const w of t.words || []) alts.push({ src: reEsc(w), id: t.id, len: w.length, ci: false });
    if (t.pattern) alts.push({ src: t.pattern, id: t.id, len: 50, ci: true });
    for (const x of t.exact || []) exact.set(x, t.id);
  }
  alts.sort((a, b) => b.len - a.len);
  // one regex per case rule; a match must not sit inside a longer word ("Electives" ok, "Selectives" no)
  const build = (list, flags) => (list.length ? new RegExp(`(^|[^\\w-])(${list.map((a) => `(${a.src})`).join('|')})(?![\\w-])`, flags) : null);
  const ci = alts.filter((a) => a.ci), cs = alts.filter((a) => !a.ci);
  return { entries, exact, parts: [[build(ci, 'gi'), ci], [build(cs, 'g'), cs]] };
}

// Text -> [{ start, end, id }] (sorted, never overlapping). seen = ids already marked nearby (each term is
// underlined once per block of text, so a paragraph isn't striped); it is updated.
export function findTerms(text, g, seen = new Set()) {
  const s = String(text || '');
  const trimmed = s.trim();
  if (g.exact.has(trimmed)) {
    const id = g.exact.get(trimmed);
    if (seen.has(id)) return [];
    seen.add(id);
    const start = s.indexOf(trimmed);
    return [{ start, end: start + trimmed.length, id }];
  }
  const hits = [];
  for (const [re, list] of g.parts) {
    if (!re) continue;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(s))) {
      const start = m.index + m[1].length;
      if (!m[2]) { re.lastIndex = m.index + 1; continue; }
      hits.push({ start, end: start + m[2].length, id: list[altIndex(m, list)]?.id });
      re.lastIndex = start + m[2].length;
    }
  }
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  const out = [];
  for (const h of hits) {
    if (!h.id || seen.has(h.id)) continue;
    if (out.length && h.start < out[out.length - 1].end) continue;
    seen.add(h.id);
    out.push(h);
  }
  return out;
}
// which alternative matched: the groups after the two outer ones, one per alternative (patterns may hold
// groups of their own, so count them)
function altIndex(m, list) {
  let g = 3;
  for (let i = 0; i < list.length; i++) {
    if (m[g] !== undefined) return i;
    g += 1 + groupCount(list[i].src);
  }
  return -1;
}
const groupCount = (src) => (src.replace(/\\./g, '').match(/\((?!\?)/g) || []).length;

// ---------- the page ----------
// roots: elements whose text gets marked (re-marked whenever their content changes)
// sourceHTML(entry): the small source link
const SKIP = 'a, button, input, select, textarea, summary, option, svg, .gt, .box, .gloss, [data-nogloss], script, style';
export function initGlossary({ data, roots, sourceHTML }) {
  const g = compileGlossary(data);
  if (!g.entries.size) return { mark() {} };
  const card = document.createElement('div');
  card.className = 'gloss';
  card.id = 'gloss';
  card.setAttribute('role', 'dialog');
  card.hidden = true;
  document.body.appendChild(card);
  let cur = null, pinned = false, hideT = 0, showT = 0, quiet = null;

  function mark(root) {
    if (!root) return;
    const seen = new Set([...root.querySelectorAll('.gt')].map((x) => x.dataset.g));
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (!n.nodeValue.trim() || n.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const n of nodes) {
      const hits = findTerms(n.nodeValue, g, seen);
      if (!hits.length) continue;
      const frag = document.createDocumentFragment();
      let at = 0;
      for (const h of hits) {
        if (h.start > at) frag.appendChild(document.createTextNode(n.nodeValue.slice(at, h.start)));
        const sp = document.createElement('span');
        sp.className = 'gt';
        sp.dataset.g = h.id;
        sp.tabIndex = 0;
        sp.setAttribute('role', 'button');
        sp.setAttribute('aria-expanded', 'false');
        sp.setAttribute('aria-controls', 'gloss');
        sp.textContent = n.nodeValue.slice(h.start, h.end);
        frag.appendChild(sp);
        at = h.end;
      }
      if (at < n.nodeValue.length) frag.appendChild(document.createTextNode(n.nodeValue.slice(at)));
      n.parentNode.replaceChild(frag, n);
    }
  }
  // re-mark a root after its content is redrawn (the observer is paused while marking)
  const obs = new MutationObserver((recs) => {
    const touched = new Set();
    for (const r of recs) for (const root of list()) if (root.contains(r.target)) touched.add(root);
    if (!touched.size) return;
    obs.disconnect();
    for (const root of touched) mark(root);
    if (cur && !cur.isConnected) hide();
    watch();
  });
  const list = () => roots().filter(Boolean);
  const watch = () => { for (const r of list()) obs.observe(r, { childList: true, subtree: true, characterData: true }); };
  for (const r of list()) mark(r);
  watch();

  function show(el, pin) {
    clearTimeout(hideT); clearTimeout(showT);
    const e = g.entries.get(el.dataset.g);
    if (!e) return;
    if (cur && cur !== el) cur.setAttribute('aria-expanded', 'false');
    cur = el; pinned = !!pin;
    el.setAttribute('aria-expanded', 'true');
    card.setAttribute('aria-label', e.term);
    card.innerHTML = `<b>${esc(e.term)}</b><p>${esc(e.def)}</p>${sourceHTML(e) ? `<p class="gl-src">${sourceHTML(e)}</p>` : ''}`;
    // inside an open sheet (top layer) the card must live in the sheet, or the sheet would cover it
    const host = el.closest('dialog[open]') || document.body;
    if (card.parentNode !== host) host.appendChild(card);
    card.hidden = false;
    place(el);
  }
  // below the term (never on top of it); above when there's no room below; inside the screen's sides
  function place(el) {
    const r = el.getBoundingClientRect();
    const w = Math.min(280, innerWidth - 16);
    card.style.width = `${w}px`;
    const h = card.offsetHeight;
    const below = r.bottom + 6 + h <= innerHeight - 8 || r.top - 6 - h < 8;
    card.style.left = `${Math.round(Math.max(8, Math.min(r.left, innerWidth - w - 8)))}px`;
    card.style.top = `${Math.round(below ? r.bottom + 6 : r.top - 6 - h)}px`;
    card.dataset.side = below ? 'below' : 'above';
  }
  function hide() {
    clearTimeout(hideT); clearTimeout(showT);
    if (cur) cur.setAttribute('aria-expanded', 'false');
    cur = null; pinned = false;
    card.hidden = true;
  }
  const termOf = (t) => (t instanceof Element ? t.closest('.gt') : null);
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const t = termOf(e.target);
    if (t) { if (t !== cur) { clearTimeout(showT); showT = setTimeout(() => show(t, false), 120); } else clearTimeout(hideT); return; }
    if (card.contains(e.target)) { clearTimeout(hideT); return; }
    clearTimeout(showT);
    if (cur && !pinned) { clearTimeout(hideT); hideT = setTimeout(hide, 200); }
  });
  // a tap (or click) pins it open; a second tap on the same term closes it. Inside a label (Settings) the
  // tap must not flip the label's switch.
  document.addEventListener('click', (e) => {
    const t = termOf(e.target);
    if (!t) return;
    e.preventDefault(); e.stopPropagation();
    if (cur === t && pinned) hide(); else show(t, true);
  }, true);
  document.addEventListener('pointerdown', (e) => {
    if (!cur || termOf(e.target) || card.contains(e.target)) return;
    hide();
  }, true);
  document.addEventListener('keydown', (e) => {
    const t = termOf(e.target);
    if (t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); if (cur === t && pinned) hide(); else show(t, true); return; }
    if (e.key === 'Escape' && cur) { e.preventDefault(); e.stopPropagation(); const back = cur; hide(); quiet = back; back.focus(); quiet = null; }
  }, true);
  document.addEventListener('focusin', (e) => {
    const t = termOf(e.target);
    if (t && t !== cur && t !== quiet && t.matches(':focus-visible')) show(t, false); // (not when Esc hands focus back)
    else if (!t && cur && !card.contains(e.target) && !pinned) hide();
  });
  addEventListener('scroll', () => { if (cur) hide(); }, true);
  addEventListener('resize', () => { if (cur) hide(); });
  return { mark };
}
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
