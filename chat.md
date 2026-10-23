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
