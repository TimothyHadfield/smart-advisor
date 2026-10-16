# Smart Advisor — progress (handoff for Claude)

## START HERE
_Last updated 2026-10-15 (checkpoint after 081f1db). For Claude only; Tim doesn't read this. Catch-up authorizes nothing: only "Authorized next steps" below is approved work._
1. Read this file.
2. Read `direction.md` (Tim's intent; overrules everything).
3. Skim the last entries of `chat.md`. Previous long version of this file: `docs/archive/progress-2026-10-15.md`. Data endpoints: `docs/research.md`. Phase plan: `docs/phase1-plan.md`.

## Goal right now
Public UVU advisor for any student: prereq flowchart + auto semester plan for all 541 majors/minors/certs, Wolverine Track audit import, Google accounts, section schedule builder with RMP ratings, Gen Ed class lists. All live; now polishing from Tim's field reports.

## Status
| Area | State | Notes |
|---|---|---|
| Flowchart | live | `js/layout.js` layered (crossing reduction, elbows, separate tracks, labs folded, Gen Ed row below, semester colors, tap locks + cascade, grades red→green + Grades switch). Loops broken before layering (mutual pre-or-co pairs: nursing 63→8 cols, theatre); no-prereq source sits next to its first course when arrows would skip 3+ cols. EE: 8 crossings, 46 bends (Tim's hand chart: 10 crossings) |
| Auto plan | live | `js/planner.js` `makePlan`; 866/866 program files pass `tests/planner-all.test.mjs` (≤cap, prereq order, all placed). Splits placeholders, bundles pre-or-co pairs, ignores self-prereqs, honors alts/tracks/repeats/crMax. First semester always future: `earliestStart` (after today's term; after audit's latest course-row term) |
| Plan list | live | 2 cols `minmax(0,1fr)`; long names ellipsize (hover title shows full) |
| Audit import | live | gear → Import audit (paste or PDF via pdf.js 3.11.174 lazy). `js/audit.js` parseAudit → taken/IP/grades/header (majors, minors, catalog year)/`lastTerm`; auto-picks programs + year. Re-import fills grades for already-taken rows |
| All programs data | live | 541 programs (413 current 2026-27 + 2025-26 archive) in `data/programs/`, `data/2025-2026/programs/`; parser `scripts/fetch-program.mjs` + `scripts/lib/post.mjs`. Credit totals match page 413/413 and 450/452 |
| Picker | live | header name ▾ → search, Majors/Minors/Certificates, catalog year, major + minors combined (`js/programs.js`) |
| Gen Ed lists | live (ed8767a) | `data/gened.json` (+2025-26) from catalog.uvu.edu/general-education/; `js/gened.js` matcher 2,718/2,901 boxes; ≡ button on box → searchable sheet; pick saved as `ph:7=DANC 1010` in `done` |
| Google sign-in | live | Firebase `smart-advisor-th` (Spark, $0); `js/account.js` + `js/sync.js`; popup sign-in; owner-only field-checked rules |
| Sections + schedule | live | Banner 9 data `data/sections/{202640,202720}.json` (weekly Action `refresh-data.yml`); Schedule tab (`js/schedule.js`): ranked conflict-free schedules, week grid, RMP badge, Copy CRNs, prefs in Settings › Schedule; saved in `settings.sched` |
| RMP | live | `data/rmp.json` keyed by section `instr`; overall rating + link only |

## Authorized next steps
- 2026-10-15 · Phase 1 + all majors + accounts + flowchart/import/grades/Gen Ed labels — all built. No open authorized items beyond fixing what Tim reports.

## Standing instructions (Tim's words / interview answers)
- Public site for any UVU student, **with accounts (Google sign-in)**.
- Schedules: "Keep hunting, fall back to paste".
- First slice: "EE flowchart + plan, then all majors".
- Look: "UVU green, clean and compact". Completed classes: "Tap classes on the flowchart".
- Flowchart: "minimize how much the lines turn cornours and bend ... make the lines seperated from each other enough where you'll never be confused which line goes where".
- "don't allow the user to select a class that still needs prerequisites filled."
- "label gen eds in their own section" · grades red→green + "a switch somewhere in the screen that says turn off grades".
- "remember to deploy many sub-agents to help you with all the work of building the majors/minors".
- "if the program fills in classes that the user is currently taking, the first semester ... is a future semester, not a current one."

## Traps / rules that bite
- Builder worktrees spawn from the `Code Projects` root repo (Estimator_Quiz). Builders must clone smart-advisor into `<worktree>/sa`; merge with `git fetch "<worktree>/sa" <branch>`. `git worktree remove` often "Permission denied" (OneDrive) → weekly sweep handles it.
- Tim's real audit: `.claude/test/wolverine-track-audit.pdf` + `audit.txt` (gitignored; name, student ID, advisor email). Never commit, copy or screenshot it. Fixtures anonymized. Repro scripts use a fake audit (scratchpad `fakeaudit.txt`).
- Catalog year matters: Tim is on 2025-2026 (EE 125 cr, ECE 4950). His audit → lastTerm Fall 2026 → plan starts Spring 2027; 4 semesters left (5 with ESM minor).
- Regenerate program data offline: `node scripts/fetch-all.mjs --year current|2025-2026 --cache <scratchpad>/cache --offline` (cache ROOT, not the year dir). It rewrites every data file with LF line endings → commit only files whose `git diff -w` changed, then `git checkout -- data/`.
- Raw catalog page cache lives in the session scratchpad (`.../99882441-.../scratchpad/cache/`); a new session may not have it → would need a polite re-fetch (fetch-all without --offline, ≥400 ms delay).
- Old CourseLeaf class search only has terms ≤202520; current sections come from public Banner 9 `https://userve.uvu.edu/StudentRegistrationSsb/ssb/` (cookie session, no CORS → Node prefetch).
- RMP GraphQL (Basic dGVzdDp0ZXN0, school U2Nob29sLTE4NDU4) has no CORS → build-time only. Instructor names "Last, First M." need last name + dept matching.
- Firebase: `firebase deploy --only auth` turned the project into Identity Platform (still no billing). Never call identityPlatform:initializeAuth (needs billing). Admin API token: scratch `gtoken.mjs`; serviceusage enable needs `-d '{}'`.
- Rules test is `tests/rules.emulator.mjs` (not in plain suite; needs Java 21 + emulator).
- Catalog prereqs ignore non-course gates, grade minimums, season-only offering; out-of-major prereqs (MATH 1050) assumed met.
- Guard blocks shell writes to .md files → Edit/Write only.
- Pages live-check hook sometimes reports an older commit "NOT live" when a newer build already includes it → ignore.

## Decisions
- D1 · 2026-10-15 · Plain HTML/CSS/JS on GitHub Pages, data pre-fetched to JSON by Node scripts (catalog/Banner/RMP have no CORS).
- D2 · 2026-10-15 · Firebase Spark only for accounts; guest works locally (localStorage `smart-advisor:v1`); signInWithPopup not redirect (iOS/Pages trap).
- D3 · 2026-10-15 · UI (unconfirmed by Tim): laptop = flowchart + plan side by side, Flowchart|Schedule switch in header; phone = Flowchart/Plan/Schedule bottom tabs; gear → Start, Max credits, Summers, Schedule prefs, Import audit, Clear taken.
- D4 · 2026-10-15 · Flowchart look (unconfirmed): 10-hue semester palette (Sp27 orange, Fa27 blue…), locked = faded semester color, grade badge on box top edge, "+Lab" marker, Gen Ed row below chart, coreqs don't block taps.
- D5 · 2026-10-15 · All-majors choices (unconfirmed): unnamed lists → "Choose N"/"Choose N credits"/"Choose 1 track"; graduate programs admission:true; track picked by most progress then fewest credits; track courses = dashed "pick from list" rows.
- D6 · 2026-10-15 · Schedule (unconfirmed): Classes default In person ("Any" ranked online first); concurrent-enrollment sections hidden; Gen Ed/electives added via "+ Add class"; grid colors reuse semester palette.
- D7 · 2026-10-15 · Term boundaries: Spring Jan–Apr, Summer May–Aug 19, Fall Aug 20+. `settings.lastTerm` (synced) from audit; Clear taken resets it.
- D8 · 2026-10-15 · Gen Ed lists (unconfirmed): ≡ on box bottom-right; picked class as 2nd line; pick-one boxes list only the program's own options; two-area boxes show both lists.
- D9 · 2026-10-15 · Untaking a pick-one box also clears its option codes (else an audit class kept it on forever).

## NOT verified
- Real iPhone (all checks headless WebKit), real Google popup sign-in, dark mode.
- Linked lecture/lab sections in schedule (none in live data); Copy CRNs on iPhone.
- Gen Ed pick key sync between devices (code-read only).
- Choice `rules` (e.g. "at least 6 ENVT credits") parsed but not enforced by planner.
- Still-wrong data: 2025-26 bioinformatics-bs 118/120, collision-repair-technology-aas 67/64; ~28 small programs lost a plan-order link; missing catalog entries COMM 2010, ENVT 3300.
- Course offering seasons (fall/spring-only) unknown; grad-plan order used as hint.
- Cohort/admission programs flagged (`admission`) but planner doesn't model cohorts.
- 2024-2025 archive not fetched.

## Rejected / parked
- ~~Paste-only Wolverine Track~~ · 2026-10-15 · tapping first, then built paste + PDF import.
- ~~Store RMP reviews~~ · 2026-10-15 · overall rating + link only.
- ~~Schedule "+ Add class" from Gen Ed lists~~ · 2026-10-15 · parked (needs a new filter in that dialog).

## Map
- Project: `C:\Users\timha\OneDrive\Desktop\my-website\Code Projects\Smart Advisor` · repo github.com/TimothyHadfield/smart-advisor (public) · push → GitHub Pages redeploy.
- Live: https://timothyhadfield.github.io/smart-advisor/ (`?p=<program-id>` opens a program).
- `index.html`, `css/app.css`, `js/app.js` (UI/state) · `js/planner.js` (model, plan, terms) · `js/layout.js` (chart) · `js/audit.js` · `js/pdftext.js` · `js/programs.js` (picker) · `js/schedule.js` · `js/gened.js` · `js/account.js` + `js/sync.js` · `firestore.rules`, `firebase.json`, `.firebaserc`.
- Scripts: `scripts/fetch-program.mjs`, `scripts/lib/post.mjs`, `scripts/fetch-all.mjs`, `scripts/fetch-sections.mjs`, `scripts/fetch-rmp.mjs`, `scripts/fetch-gened.mjs`, `scripts/lib/{banner,names}.mjs`; weekly `.github/workflows/refresh-data.yml`.
- Tests: `node --test tests/*.test.mjs` · 2026-10-15: 1032 pass, 0 fail, 1 skipped. Rules: `firebase emulators:exec --only firestore --project smart-advisor-th "node tests/rules.emulator.mjs"` · 2026-10-15: 5/5. e2e: `python -m http.server 8137` + emulators + `node tests/accounts.e2e.mjs`.
- Headless repro: `node ~/.claude/tools/phone-view.mjs "<url>?p=<id>" [--desktop] --out shot.png`; Playwright scripts in scratchpad (`gradesrepro2.mjs`, `longedges.mjs`, `spans.mjs`, `cmpstats.mjs`).
