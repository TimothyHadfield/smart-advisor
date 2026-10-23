// "My schedule" on the Schedule tab: the term a student is already in (or registered for) shows their
// real classes instead of generated schedules. Filled from the audit's in-progress classes, or from a
// pasted / uploaded save of their myUVU registration page ("Add my schedule"). Pure logic in
// js/mysched.js; this file is the screen. Saved per term in settings.sched.terms[term].mine (synced).
import { parseRegistration, entriesFrom, prefillFromAudit, termOfText, htmlToText, normDays, normTime, mineRows, choose, labelToCode } from './mysched.js';
import { termInfo, currentTermCode, whenOf, optionsConflict } from './schedule.js';

/**
 * ctx: { $, esc, openDlg, save, toast, termState, termGroups, sched (app's schedule state), render (renderSched),
 *        drawWeek, ratingBadge, lastName, schedSrc (term) -> source <li>, secSrc (code) -> source line, lastTerm () -> "Fall 2026" | null, planHas (code) -> bool,
 *        ipCodes () -> in-progress course codes from the imported audit, subjects () -> promise of {SUBJ: name} }
 */
export function initMine(ctx) {
  const { $, esc } = ctx;
  let stage = null;      // the "Add my schedule" result being reviewed: { term, entries, unmatched }
  let handFor = null;    // the hand dialog: { to: 'stage' | 'mine', i (entry index or -1) }

  // a term shows "my schedule" when classes are saved for it, or when it's the current term / the audit's
  // latest term and the plan has nothing in it (the plan always starts after those)
  function isMine(code) {
    const t = ctx.termState(code);
    if (Array.isArray(t.mine) && t.mine.length) return true;
    if (ctx.planHas(code)) return false;
    const last = [currentTermCode(), labelToCode(ctx.lastTerm())].filter(Boolean).sort().pop();
    return code <= last;
  }
  // saved entries, or (nothing saved yet, current term) the audit's in-progress classes
  function entriesOf(code, groups) {
    const t = ctx.termState(code);
    if (Array.isArray(t.mine)) return t.mine;
    if (code !== currentTermCode()) return [];
    return prefillFromAudit(t.ip?.length ? t.ip : ctx.ipCodes(), groups).entries;
  }
  function setEntries(code, entries) {
    ctx.termState(code).mine = entries;
    ctx.save();
  }

  let rows = [], cur = null;
  function render(code, groups) {
    cur = { code, groups };
    rows = mineRows(entriesOf(code, groups), groups);
    const picks = rows.map((r) => (r.sec && !r.pick ? { secs: [r.sec] } : null));
    const crns = rows.filter((r) => r.sec?.crn && !r.pick).map((r) => r.sec.crn);
    ctx.sched.courses = rows.map((r) => ({ code: r.code, sections: groups.get(r.code) || [] }));
    ctx.sched.list = [{ picks, crns, cost: 0, unplaced: [] }];
    ctx.sched.idx = 0;
    $('scCopy').disabled = !crns.length;
    ctx.drawWeek({ picks });
    const room = (s) => [s.bldg, s.room].filter((x) => x && !/^(ONLINE|LIVE|STREAM|TBA)$/i.test(x)).join(' ');
    $('scList').innerHTML = (rows.length ? rows.map((r, i) => {
      const sw = `<span class="sw s${i % 10}"></span>`;
      if (r.pick) return `<li><button type="button" class="sc-row" data-mi="${i}">${sw}<b>${esc(r.code)}</b><span class="why pick-sec">Pick your section</span></button></li>`;
      const s = r.sec;
      return `<li><button type="button" class="sc-row" data-mi="${i}">${sw}<b>${esc(r.code)}</b><span class="when">${esc(whenOf(s))}</span>`
        + `<span class="who">${esc(s.hand ? '' : ctx.lastName(s.instr))}</span>${s.hand ? '' : ctx.ratingBadge(s.instr)}<span class="seat">${esc(room(s))}</span>`
        + `<span class="crn">${esc(s.crn || '')}</span></button></li>`;
    }).join('') : '<li class="none">No classes yet</li>')
      + '<li class="sc-adds"><button type="button" class="sc-add" id="scAdd">+ Add class</button><button type="button" class="sc-add" data-hand>By hand</button></li>' + (ctx.schedSrc?.(code) || '');
  }

  // ---------- tap a row: pick / change its section, or edit a hand-added class ----------
  function click(e) {
    if (e.target.closest('#scAdd')) return false; // the app's "+ Add class" search
    if (e.target.closest('[data-hand]')) { openHand({ to: 'mine', i: -1 }); return true; }
    const b = e.target.closest('button[data-mi]');
    if (!b) return true;
    const r = rows[+b.dataset.mi];
    if (r.entry.hand) openHand({ to: 'mine', i: +b.dataset.mi }, r.entry);
    else openSections(+b.dataset.mi);
    return true;
  }
  function openSections(i) {
    const r = rows[i];
    const secs = (cur.groups.get(r.code) || []).slice().sort((a, b) => (a.start || '9999').localeCompare(b.start || '9999') || a.days.localeCompare(b.days) || a.sec.localeCompare(b.sec));
    const others = rows.filter((x, k) => k !== i && x.sec && !x.pick).map((x) => ({ secs: [x.sec] }));
    $('mySecCode').textContent = r.code;
    $('mySecTitle').textContent = secs[0]?.title || '';
    $('mySecSrc').innerHTML = ctx.secSrc?.(r.code) || ''; // its catalog entry + the class search (js/sources.js)
    $('mySecDlg').dataset.i = i;
    $('mySecList').innerHTML = secs.length ? secs.map((x) => {
      const clash = others.some((o) => optionsConflict(o, { secs: [x] }));
      return `<li class="${clash ? 'clash' : ''}"><button type="button" data-crn="${esc(x.crn)}"${r.sec?.crn === x.crn ? ' class="on"' : ''}>`
        + `<span class="sn">${esc(x.sec)}</span><span class="when">${esc(whenOf(x))}</span>`
        + `<span class="who">${esc(ctx.lastName(x.instr))}</span><span class="seat">${esc(x.crn)}</span></button>${ctx.ratingBadge(x.instr, true)}</li>`;
    }).join('') : '<li class="none">Not offered this term</li>';
    ctx.openDlg($('mySecDlg'));
    $('mySecList').scrollTop = 0;
  }
  $('mySecList').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-crn]');
    if (!b) return;
    const r = rows[+$('mySecDlg').dataset.i];
    setEntries(cur.code, choose(rows.map((x) => x.entry), r.code, b.dataset.crn));
    $('mySecDlg').close();
    ctx.render();
  });
  $('mySecRemove').addEventListener('click', () => {
    const i = +$('mySecDlg').dataset.i;
    setEntries(cur.code, rows.map((x) => x.entry).filter((_, k) => k !== i));
    $('mySecDlg').close();
    ctx.render();
  });
  $('mySecDlg').addEventListener('click', (e) => { if (e.target === $('mySecDlg')) $('mySecDlg').close(); });

  // "+ Add class" in my schedule: the course is added to pick a section
  function addCode(code) {
    const list = rows.map((x) => x.entry);
    if (!list.some((x) => x.code === code)) setEntries(cur.code, [...list, { code, crn: (cur.groups.get(code) || []).length === 1 ? cur.groups.get(code)[0].crn : '' }]);
    ctx.render();
  }

  // ---------- add by hand: course, days, start, end ----------
  function openHand(target, e = {}) {
    handFor = target;
    $('handCode').value = e.code || '';
    $('handDays').value = e.days || '';
    const t = (x) => (x ? `${x.slice(0, 2)}:${x.slice(2)}` : '');
    $('handStart').value = t(e.start);
    $('handEnd').value = t(e.end);
    $('handRemove').hidden = target.i < 0;
    $('handSave').textContent = target.i < 0 ? 'Add' : 'Save';
    $('handMsg').textContent = '';
    ctx.openDlg($('handDlg'));
  }
  $('handSave').addEventListener('click', () => {
    const code = $('handCode').value.trim().replace(/\s+/g, ' ').toUpperCase();
    const days = normDays($('handDays').value), start = normTime($('handStart').value), end = normTime($('handEnd').value);
    if (!code) { $('handMsg').textContent = 'Add a course'; return; }
    if ((days || start || end) && !(days && start && end && start < end)) { $('handMsg').textContent = 'Check days and times'; return; }
    const entry = { code, days, start, end, hand: 1 };
    if (handFor.to === 'stage') {
      if (handFor.i >= 0) stage.unmatched.splice(handFor.i, 1);
      stage.entries.push(entry);
      drawStage();
    } else {
      const list = rows.map((x) => x.entry);
      if (handFor.i >= 0) list[handFor.i] = entry; else list.push(entry);
      setEntries(cur.code, list);
      ctx.render();
    }
    $('handDlg').close();
  });
  $('handRemove').addEventListener('click', () => {
    if (handFor.to === 'mine' && handFor.i >= 0) {
      setEntries(cur.code, rows.map((x) => x.entry).filter((_, k) => k !== handFor.i));
      ctx.render();
    }
    $('handDlg').close();
  });
  $('handDlg').addEventListener('click', (e) => { if (e.target === $('handDlg')) $('handDlg').close(); });

  // ---------- "Add my schedule": paste or upload the registration page, review, apply ----------
  const dlg = $('myDlg');
  const step = (n) => {
    $('myStep1').hidden = n !== 1; $('myStep2').hidden = n !== 2;
    $('myBack').textContent = n === 1 ? 'Cancel' : 'Back';
    $('myGo').textContent = n === 1 ? 'Read' : 'Apply';
    $('myGo').disabled = false;
    dlg.dataset.step = n;
  };
  function open() {
    $('myText').value = ''; $('myFile').value = '';
    $('myText').placeholder = 'Paste your myUVU schedule';
    step(1);
    ctx.openDlg(dlg);
  }
  async function read(text) {
    if (/<(html|body|table|div|td)\b/i.test(text)) text = htmlToText(text);
    const term = termOfText(text, ctx.sched.terms) || ctx.sched.term;
    const groups = await ctx.termGroups(term);
    const found = parseRegistration(text, groups, await ctx.subjects());
    stage = { term, groups, entries: entriesFrom(found, groups), unmatched: found.unmatched };
    drawStage();
    step(2);
  }
  function drawStage() {
    const rs = mineRows(stage.entries, stage.groups);
    $('mySum').innerHTML = `<b>${esc(termInfo(stage.term).label)} · ${rs.length} ${rs.length === 1 ? 'class' : 'classes'}</b>`;
    $('myList').innerHTML = rs.map((r) => `<li><span>${esc(r.code)}</span><i>${esc(r.pick ? 'Pick your section' : `${whenOf(r.sec)}${r.sec.crn ? ` · ${r.sec.crn}` : ''}`)}</i></li>`).join('')
      + stage.unmatched.map((u, i) => `<li class="miss"><span>${esc(u.code || `CRN ${u.crn}`)}</span><i>Not found</i><button type="button" class="ghost" data-u="${i}">Add</button></li>`).join('')
      + (rs.length || stage.unmatched.length ? '' : '<li class="none">No classes found</li>');
    $('myGo').disabled = !rs.length;
  }
  $('myList').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-u]');
    if (!b) return;
    const u = stage.unmatched[+b.dataset.u];
    openHand({ to: 'stage', i: +b.dataset.u }, { code: u.code });
  });
  $('myGo').addEventListener('click', () => {
    if (dlg.dataset.step === '1') { if ($('myText').value.trim()) read($('myText').value); return; }
    const t = ctx.termState(stage.term);
    const prev = t.mine, term = stage.term;
    setEntries(term, stage.entries.map((e) => ({ ...e })));
    dlg.close();
    ctx.sched.term = term;
    ctx.render();
    ctx.toast('Schedule replaced', () => { ctx.termState(term).mine = prev ?? null; ctx.save(); ctx.render(); });
  });
  $('myBack').addEventListener('click', () => (dlg.dataset.step === '2' ? step(1) : dlg.close()));
  $('myFile').addEventListener('change', async () => {
    const f = $('myFile').files[0];
    if (!f) return;
    $('myGo').disabled = true; $('myGo').textContent = 'Reading…';
    try {
      let text;
      if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') {
        const { pdfToText } = await import('./pdftext.js');
        text = await pdfToText(await f.arrayBuffer());
      } else {
        text = await f.text();
        if (/\.html?$/i.test(f.name) || /^\s*</.test(text)) text = htmlToText(text);
      }
      $('myText').value = text;
      await read(text);
    } catch {
      $('myGo').disabled = false; $('myGo').textContent = 'Read';
      $('myText').value = '';
      $('myText').placeholder = 'Could not read that file. Paste the text instead.';
    }
  });
  $('myTip').addEventListener('click', () => { $('myTipText').hidden = !$('myTipText').hidden; });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  $('scMine').addEventListener('click', open);

  return { isMine, render, click, addCode, open };
}
