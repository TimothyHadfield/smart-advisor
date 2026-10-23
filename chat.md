# Smart Advisor — chat log (for Claude)

_One entry per session, newest at the bottom, capped at 60 KB. Older entries are in `docs/archive/chat-archive.md`. The current state is in `progress.md`._

## 2026-10-15 · Kickoff
- **Asked:** smart advisor for UVU: flowcharts for any major, auto grad plans with prereqs, upcoming sections with times/professors and a preferred-schedule builder, RMP ratings. Then: "create necessary md files as well as a repository on my github for this cite." Shared his EE Lucidchart (login-walled).
- **Decided (Tim):** public + Google sign-in; keep hunting for schedule data, fallback paste; EE first then all majors; build phase 1 now; UVU green compact look; tap classes to mark complete.
- **Decided (Claude):** plain static site on GitHub Pages, data pre-fetched to JSON by Node scripts, Firebase only in phase 3.
- **Built:** direction.md, progress.md, chat.md, docs/research.md, README.md; repo TimothyHadfield/smart-advisor with Pages.
- **Verified how:** curl against catalog.uvu.edu (programs list, ribbit course endpoint, FOSE search API) on 2026-10-15.
- **Phase 1 built (builder):** EE flowchart + tap-to-mark-taken + auto plan; merged cdfcd9f. Verified: 10 tests pass (5 failed vs a broken planner), 6 prereqs spot-checked vs catalog, phone-view tap test 122→109 credits, 393px + desktop screenshots, no console errors. Dark mode and real iPhone not checked.
- **Asked (2):** flowchart arranged like his so lines "overlap as little as possible"; "connector to wolverine track ... so that some things are automaticaly selected". Gave PNG + his audit PDF.
- **Built (builder, bd1827b):** layered layout (crossings 62→8), elbows, labs folded; audit import (paste + PDF, local only). Verified: 24 tests pass (new ones failed vs broken code first), real audit → 19 taken / 6 IP, WebKit PDF upload, phone + desktop screenshots, no private data in repo (git grep).
- **Open (old):** Tim to export his Lucid flowchart as PNG/PDF; current-semester section source.
- **Later same day:** flowchart v3, grades + switch, Google accounts, sections (Banner 9) + RMP data, all 541 programs + picker, 6 per-college verifiers, then a parallel wave: planner-fix (866/866 plans pass), parser-fix (+ my fix for "A & B (Take twice)"), schedule tab (ranked conflict-free schedules, RMP badges, Copy CRNs). Verified: suite 1016 pass; headless 393px schedule + flowchart, no overflow/errors. Open: real iPhone, Google popup, dark mode, choice `rules` enforcement, 2024-2025 archive.

## 2026-10-15 · Field fixes + Gen Ed lists
- **Asked:** nursing chart "two lines that fan out super long ... fix this and also anywhere else"; semesters display "spread apart in a really funky way"; first planned semester must be future when audit fills current classes; "grades aren't showing"; "american institutions is impossible to click off"; "show a list of the available classes for the gen ed classes taht are flexable".
- **Built:** layout breaks prereq loops + pulls no-prereq sources right (20 charts fixed, nursing 63→8 cols); plan grid minmax(0,1fr); `earliestStart` + audit `lastTerm`; re-import writes grades for already-taken rows; pick-one untake clears option codes; Gen Ed lists (builder, ed8767a).
- **Verified how:** cmpcols/cmpstats over all programs (EE unchanged 8 crossings); headless desktop + 393px screenshots; Playwright repro with fake audit (old code fails, new passes); suite 1032 pass; rules 5/5.
- **Open:** see progress.md NOT verified.

## 2026-10-22 · Seasons as a rule (builder `seasons`)
- **Asked (Tim, via manager):** "a bunch of the classes in certain majors ... are sometimes only offered specific semesters (fall or spring)"; "could you also fix the cite so it only allows classes that are offered those semesters to be taken in the stated semesters?"
- **Built:** `docs/seasons-plan.md`; `scripts/build-seasons.mjs` rewritten (per-subject Banner fetch, 3 newest terms per season, section counts, reuses finished terms, 25-row fallback); `data/seasons.json` 9 terms / 4,214 courses; `js/planner.js` hard season rule ("A or B" season-aware, coreqs with no common season split, forced Summer for Summer-only classes); plan row hover title shows "Usually … only"; weekly `refresh-data.yml` rebuilds seasons; `docs/research.md` "login-only" claim corrected.
- **Verified how (2026-10-22):** `tests/seasons.test.mjs` 22/22 on new code, 3 fail on old code with the same data (Summer-only, "A or B", all-programs sweep: 445 off-season placements in 144 plans → 0); EE flowchart vs Banner 23/24 on Fall/Spring; full suite 1175 pass / 0 fail / 1 skipped; phone-view 393 px + desktop of EE plan, ECE 3780 class sheet, Schedule "+ Add class" search "ECE 3780" in Fall 2026 = No match.
- **Open:** see progress.md NOT verified (posted-term gap, ECE 4900 disagreement, forced Summer has no note, Action not yet run on GitHub).

## 2026-10-17 · Manager batch 1 (sweep leftovers)
- **Asked (via manager, Tim's standing go):** "any fixes or improvements you feel confident about go ahead and do."
- **Built:** 20c1a30 (CLAUDE.md, sweep notes), e2ef6cc (head meta, favicon 404, rules comment only), a010c3b (`js/fresh.js` auto-update + Settings focus ring).
- **Verified how:** suite 1043 pass / 1 skipped; fresh e2e + import e2e (local http.server 8137), 2026-10-17. Rules file changed only in a comment, so no rules deploy was needed.
- **Open:** real iPhone auto-update not checked.

## 2026-10-17 · Accuracy wave 1 (full analysis → 3 builders → integration)
- **Asked (Tim):** "I really care about how accurate the requirements for majors are ... do a full analysis on smart advisor and implement any features, improvements, calculation changes, custumization, and smart layout"; "For my EE major the flowchart says ECE 4900 doesn't have any prerequisits but it does ... make sure this is fixed everywhere else and doesn't happen again"; "don't ask me any questions from now on if you have a recommended answer."
- **Built:** sa-data (parser fields + golden fixtures), sa-plan (phases, gates, sample-plan order, one requirement per class, tracks), sa-ui (class sheet, lines, chip, nav, zoom); integration branch `sa-integrate` wired planner ↔ data names (admissionInfo, gate+text union, track subs) and UI ↔ planner (milestone rows, Needs/Catalog rows). ECE 4900 now shows "Needs: Formal Acceptance ... · University Advanced Standing" (2025-26) and its ECE 4730 arrow (2026-27).
- **Verified how (2026-10-17):** suite 1103 pass / 1 skipped; new `tests/integrate.test.mjs` (5) + uistate (2) + ui e2e (1) seen failing on the pre-wiring code first; ui + import e2e 9/9 on local 8137; all 866 plans: 0 gated classes before Apply, not-required track classes planned 28 → 0, Apply rows 234 → 240; phone-view 393 px + desktop for nursing-bs and electrical-engineering-bs (plan, chart, class sheet), no exceptions, no horizontal overflow.
- **Open:** see progress.md NOT verified (Advanced Standing numbers, regex gates, iPhone long-press/pinch, dark mode).

## 2026-10-22 · UVU's official flowcharts per major (builder `uvucharts`)
- **Asked (Tim):** "I really like the flowchart you found for specific majors at UVU. Could you add those to the cite for that specific major?"
- **Found:** web search found none; a polite crawl of every college/department site found department "Flow Chart PDF" / "Degree Map" links: 33 programs (ECE, MCE, CS, Construction Mgmt, Digital Media, Culinary, Surveying, Dental, Nursing, RT). `scripts/build-uvu-flowcharts.mjs` → `data/uvu-flowcharts.json`; `--check` 40 links, 0 bad.
- **Built:** "UVU's official flowchart (2026-27) ↗" line under the flowchart legend (catalog-year edition, else newest; new tab; hidden when none). `officialChart` in `js/uistate.js`.
- **Verified how:** `tests/uvucharts.test.mjs` (6) + `tests/uvucharts.e2e.mjs` (4) failed on the old code first, pass now; suite 1159 pass / 1 skipped; e2e 28/28; phone-view 393 px + 1440 px, light + dark. `classes.e2e` grade test made race-proof (selector click).
- **Open:** wording/placement are Tim's; course-sequence / advising-sheet PDFs not included.

## 2026-10-22 · Matriculation line + sheet (builder `matric`)
- **Asked (Tim):** "could you also add a dotted line in the flowchart that seperates the classes that need matriculation from the classes that don't? Also allow the matriculation label to be clicked on and have it tell you everything it knows about matriculatoin?"
- **Built:** `js/matric.js` (sides from admission gates + everything downstream; catalog facts), `layoutGraph`/`routeChart` split (line column + label band), "Matriculation" button on the line → `#matDlg` sheet (Catalog, GPA, Grade, Before with done/planned chips, Needs it, After it, Deadline, Advisor, Report a mistake, Catalog ↗). 94 programs get a line.
- **Verified how:** `tests/matric.test.mjs` (6, 4 failed on old code) + `tests/matric.e2e.mjs` (3, all failed on old code) pass; suite 1165 pass / 0 fail after rebase on uvucharts; e2e ui/hover/classes/advisors/import/mysched/fresh all pass (accounts needs emulators, not run). WebKit screenshots 393 px + 1440 px, light + dark, EE + Finance: no console errors, no overflow.
- **Open:** label wording, row names, line colour, "downstream counts as needing it" are Tim's; phone shows the line after scrolling right or Fit.

## 2026-10-22 · Source links on every outside fact (builder `sources`)
- **Asked (Tim):** "could you also have automatic links to everything you are reffering to or getting your informatoin from? This includes anything UVU, as well as Rate my professor, and anything we develope later in the cite."
- **Built:** `js/sources.js` (`sourceLink` for program/tabs, course incl. archive years, class search term, RMP professor + school, Gen Ed, advisors, seasons, any url; `DATA_SOURCES` registry of every data file). Links on: plan source line, class sheet facts + source line, Matriculation sheet facts + source line, both section sheets, schedule list footer, Gen Ed sheet. Standing rule added to CLAUDE.md + progress.md.
- **Verified how:** `tests/sources.test.mjs` (9) failed first (module missing; then the no-hand-typed-URL check flagged app.js ×2 + uistate.js), `tests/sources.e2e.mjs` (5) failed on the old page; suite 1174 pass / 1 skipped after rebase on matric + uvucharts; e2e 36/36; link check 43/43 HTTP 200 with expected page text; WebKit screenshots 393 px + 1366 px (plan line, class sheet, schedule, section sheet with RMP, Gen Ed, Matriculation): no errors, no overflow.
- **Open:** wording/placement Tim's; seasons tags + Home page not merged at build time → no ↗ on them yet.

## 2026-10-22 · Semester colors switch (builder `semcolor`)
- **Asked (Tim):** "could we also add a setting to colorize semesters or not?"
- **Built:** Settings › "Semester colors" switch (under Summers, default on, `settings.semColors`, synced). Off: planned boxes one neutral look (panel + grey border; locked faded), no semester legend chips, plain plan headings; Taken/IP/grades unchanged.
- **Verified how:** `tests/semcolors.e2e.mjs` (on → off → reload → on) failed on the unfixed build (no switch), passes now; `tests/sync.test.mjs` +1 (semColors false round-trips) failed first. Suite 1175 pass / 1 skipped after rebase on sources; e2e 33/33. WebKit screenshots 393 px + 1280 px, on/off, light/dark, EE BS: no console errors, no overflow, switch visible without scrolling.
- **Open:** label, placement and neutral look are Tim's calls.

## 2026-10-22 · Readable text (builder `contrast`)
- **Asked (Tim):** "some of the words and names of the classes are hard to see because the text/background is too similar and the text is too small. Could you improve that?"
- **Built:** `css/app.css` colour tokens (`--muted` darker, new `--brand`/`--warn`/`--bad`, dark-mode values), grade colours darker, no faded box titles / clash rows, 12–13px text everywhere real; `js/app.js` week block "short" threshold 25→30px.
- **Verified how:** headless WebKit audit (scratchpad `sa-contrast/audit.mjs`: every text node's size + WCAG contrast vs its composited background; phone 393 + laptop 1440, light + dark; flowchart, plan, classes, schedule, class sheet, section sheet; EE + Math minor with grades/IP). Contrast failures before → after: flowchart 50→0 light / 43→0 dark, plan 0/7→0, classes 2/10→0, schedule 8/10→1 (disabled ‹), sections sheet 44/48→0; under-12px on phone 110→13 flowchart (box-edge tags), 56→21 schedule (11px week blocks), others → 0. Sweep of 84 programs: no new cut-off codes on laptop (49→48), phone 45→48 (long "MUSC 2500R+Lab"-type codes; the rest are pre-existing "A + B" ellipses). Suite 1175 pass; e2e 38/38 on the merged build.
- **Open:** real iPhone not checked; "+Lab" codes like MUSC 2500R+Lab ellipsize on phone; long title words can break mid-word on 100px laptop boxes ("Electromagnetic/s").

## 2026-10-22 · Requirement groups (builder `groups`)
- **Asked (Tim, via manager):** loose boxes at the bottom "can get pretty messy", "choose __" boxes unclear → "large boxes with a title that says "Pick 3...."", light green when done. Mid-task: "some flowchart lines are dotted and some are solid. what's the difference?"
- **Survey (414 programs):** 2232 loose boxes in main charts in 402 programs; worst special-ed autism BS 24, art-education 21, elementary-ed 21, strategic-foresight 19; top stub labels "Elective" ×69, "Choose N credits" ×43, "Complete one of the following:" ×35.
- **Built:** `js/groups.js` (groupNodes, placeGroups, groupProgress, labels), app.js hooks (frames, "+N more" → list sheet, "+N in chart", progress refresh), css `.gframe` etc. (12px labels per the readable-text rule), legend "┄ Any one". Rebased over matric/sources/semcolors/contrast/seasons; matriculation split computed on all boxes, applied to the chart part.
- **Verified how (10-22):** groups unit 5/5 + e2e 4/4 (fail first: module missing / 0/4 on live old build); suite 1203 tests, 1202 pass, 0 fail, 1 skipped; e2e 43/45 (the 2 accounts tests need the Firebase emulators and also fail on live: app opens on the picker); contrast audit EE no new failures; screenshots before/after 393 + 1440, light + dark, 6 programs (scratchpad `sa-groups/`).
- **Open:** real iPhone; ~100 unnamed "Pick N cr" titles.

## 2026-10-22 · Hypothetical shows nothing personal (builder `hypo`)
- **Asked (Tim, via manager):** "in the hypothetical if you select a class you're currently taking it says IP instead of just regularly selecting it in green. if it's hypothetical, none of your personal info should be shown, because the user is just testing things out."
- **Cause:** untapping then re-selecting an IP class left no taps, so the toggle vanished and the page fell back to the student's own view (IP look). **Built:** `hypoShown`/`sandboxOn` (js/classes.js); app.js `ui.tapped` keeps Hypothetical after any tap this visit, `sandbox()` + `viewGrades()` hide IP, grades, audit dates, Current legend, audit nags, GPA, Classes IP/AP-CE groups, grade pickers, low-grade retakes (list in progress.md D24). Actual unchanged.
- **Verified how (2026-10-22):** `tests/hypo.e2e.mjs` (2) failed on an untouched origin/main worktree (IP look after re-select; retake warning in Hypothetical), pass on the fix; classes.e2e grade test rewritten for the new rule; suite 1198 pass / 0 fail / 1 skipped; UI e2e 40/40 after rebasing on seasons/contrast/semcolor; phone-view 393 px + laptop of Hypothetical vs Actual + Hypothetical Classes with a fake audit, no overflow, no console errors.
- **Open:** real iPhone; see progress.md NOT verified.
