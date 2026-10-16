# Smart Advisor — progress (handoff for Claude)

## START HERE
_Last updated 2026-10-15. For Claude only; Tim doesn't read this. Catch-up authorizes nothing: only "Authorized next steps" below is approved work._
1. Read this file (it's short on purpose).
2. Read `direction.md` (it overrules everything).
3. Skim the last 3 entries of `chat.md`. Data-source details: `docs/research.md`. Phase plan: `docs/phase1-plan.md`.

## Goal right now
Phase 1: Electrical Engineering BS flowchart + tap-to-complete + automatic semester plan, live on GitHub Pages.

## Status
| Area | State | Notes |
|---|---|---|
| Repo + Pages + md files | done | github.com/TimothyHadfield/smart-advisor |
| EE flowchart + auto plan | live (cdfcd9f) | 50 courses, 122 cr; 10 planner tests pass; phone + desktop checked headless |
| Flowchart layout like Tim's | live (bd1827b) | `js/layout.js` layered + crossing reduction; EE crossings 62→8 drawn (Tim's hand chart: 10); elbows, labs folded, Gen Ed row below |
| Flowchart v3 | live (e76dc76) | names in boxes, bends 104→46, 17/39 straight, 0 overlapping segments, semester colors, tap locks + cascade, Gen Ed section, grades red→green + Grades switch |
| Wolverine Track import | live (bd1827b) | gear → Import audit: paste or PDF (pdf.js 3.11.174 lazy); `js/audit.js`; real audit → 19 taken, 6 IP |
| All majors | DATA MERGED (3e4a3c0): 541 programs (413 current 2026-2027 + 2025-2026 archive), `scripts/fetch-all.mjs`, per-year `courses.json`, `_report.json` (82 warnings), `_by-college.json`. 2024-2025 archive not fetched (`--year 2024-2025`). Raw page cache in session scratchpad `cache/`. Picker LIVE (7a603c8; `js/programs.js`; header name ▾ → search, Majors/Minors/Certificates, catalog year, major + minors combined; audit auto-picks programs + year; rules allow `programs`). Verifiers done: HSS, Health, Arts+Ed, Business (findings in their agent reports; scripts in scratchpad verify-*). Top bugs: Gen Ed choice groups misnamed by `nameChoices` (credits-only match), placeholders not split (planner), flattened grad-plan sub-lists, alts ignored, recommended-course → required, self-prereq MUSC 1110, mutual pre-or-co deadlock, My Educator +3 cr, R repeats. EngTech verifier done (88: 36 ok/10 minor/42 wrong, 26 only from nameChoices; also lab shorthand "& 1010L" dropped, sets/domains not tracks, missing parent core). Science verifier done (44: 6 ok/23 minor/15 wrong; forwarded to parser-fix). Planner-fix MERGED (327e58f): 866/866 program files pass `tests/planner-all.test.mjs` (no semester > cap, prereq order, all units placed; allowlist: military-science-minor, collaborative-piano cert); nursing 12→8, music-ba 14→8; Tim's EE 2025-26 + ESM minor unchanged (10 sem, Sp 2031, 146 cr from empty start). Parser-fix MERGED (99a99ca + b577b80): all 18 verifier bugs + 15 science findings; regenerate offline with `node scripts/fetch-all.mjs --year current|2025-2026 --cache <scratchpad>/cache --offline` (cache root, not the year dir); credit totals match page for 413/413 current, 450/452 2025-26; unplaceable plan units 2694→1332; new optional fields tracks/shared/trackElectives/rules/open/recommended/preco/admission/admissionNote/entryRequirements/coreFrom/fromPlan/typos, repeat+creditsEach, crMax, exam (credits 0). Still wrong: 2025-26 bioinformatics-bs (118/120), collision-repair-technology-aas (67/64, "(optional)" counted); ~28 small programs lost a plan link (no credits-only naming). `rules` not enforced by planner yet. Suite 1016 pass |
| Google sign-in (Firebase) | live (8a3bcfb) | `js/account.js` (Firebase 10.14.1) + `js/sync.js` merge; profile icon → Continue with Google (popup); users/{uid} field-checked rules deployed; sign-out clears device; delete account two-tap. e2e: `python -m http.server 8137` + `node tests/accounts.e2e.mjs` (emulators, Playwright from ~/.claude/tools); rules: `tests/rules.emulator.mjs` via `firebase emulators:exec --only firestore --project smart-advisor-th "node tests/rules.emulator.mjs"` (5/5). Real Google popup untested |
| Section schedules + builder | DATA LIVE (e6baba0): data/sections/{202640,202720}.json (8,192 / 7,296 sections), weekly Action `refresh-data.yml` verified run 38800499895 success → commit 5781782. Schedule UI MERGED (330f28d): `js/schedule.js` (pure) + Schedule tab (phone) / Flowchart|Schedule switch (laptop); term Fa 26/Sp 27, ranked non-conflicting schedules ‹ 1/20 ›, week grid, rows code/time/instructor/RMP badge (2.5–4.5 red→green)/seats/CRN, Copy CRNs, + Add class; prefs in Settings › Schedule (days, hours, In person default, avoid gaps, top rated, main campus, waitlist); saved in `settings.sched` (no rules change). NOT verified: linked lecture/lab (none in live data), Copy CRNs on real iPhone | SOURCE FOUND: public Banner 9 `https://userve.uvu.edu/StudentRegistrationSsb/ssb/` (no login, cookie session, no CORS → Node prefetch; ~7,300 sections/term; 202640, 202720, 202730). Weekly GitHub Action refresh. UI next |
| Rate My Professors | DATA LIVE: data/rmp.json keyed by section `instr` ("Last, First M."), {r,d,n,wta,id}; 1,146 matched (87.6% of instructors with an RMP profile; 57% Fall / 70% Spring staffed sections show a rating) | GraphQL from Node works (school U2Nob29sLTE4NDU4 / 18458, Basic dGVzdDp0ZXN0), no CORS; 4,128 teachers; ~92% name match; store overall rating + link only, no reviews |

## Authorized next steps
- 2026-10-15 · Build phase 1 (EE first), then all majors. Tim: "Yes, build phase 1".
- 2026-10-15 · Accounts: "build an account system so every user can have their information and progress saved across devices or after they log out". Plan: guest works locally; profile icon → Continue with Google (signInWithPopup, not redirect — iOS/GitHub Pages trap from Fitness Tracker); users/{uid} doc {taken, grades, settings, program, catalogYear}; local data merges into account on first sign-in; sign-out clears local copy.
- 2026-10-15 · In flowchart builder (flow-v3): titles in boxes, fewest bends, separated lines, semester colors, block taps with unmet prereqs (cascade untake; import exempt), Gen Ed labeled section, grades red→green from audit + on-screen "Grades" switch.
- 2026-10-15 · All majors + minors + catalog-year archives: data builder (all-programs), then a picker.
- 2026-10-15 · Flowchart like his ("lines connecting them don't overlap or overlap as little as possible") + Wolverine Track import ("some things are automaticaly selected"): builder running, paste + PDF upload.

## Standing instructions (Tim's words / interview answers)
- Public site for any UVU student, **with accounts (Google sign-in)**.
- Schedules: "Keep hunting, fall back to paste".
- First slice: "EE flowchart + plan, then all majors".
- Look: "UVU green, clean and compact". Completed classes: "Tap classes on the flowchart".

## Traps / rules that bite
- Public class-search API only has srcdb 202430/202440/202520; newer terms → "Cannot open database".
- Tim's Lucid flowchart link needs a Lucid login; ask him to export PNG/PDF into the folder.
- Folder lives at `Code Projects/Smart Advisor` (Tim's choice), not in a category folder.
- Instructor names in UVU data are "F. Lastname" → RMP matching needs last name + department.

- Builder worktrees spawn from the `Code Projects` root repo (Estimator_Quiz), not smart-advisor. Builders must clone smart-advisor inside the worktree; merge with `git fetch <path>/sa <branch>`.
- Catalog prereqs ignore non-course gates (University Advanced Standing, formal acceptance), grade minimums and fall/spring-only offering; out-of-major prereqs (MATH 1050) assumed met by placement. ECE 2255 lacks a coreq on 2250 in catalog.

- Tim's real Degree Works audit: `.claude/test/wolverine-track-audit.pdf` + `audit.txt` (gitignored; has his name/ID/advisor email). Never commit or screenshot it; fixtures must be anonymized copies.
- **Catalog year matters:** Tim is on 2025-2026 (125 cr, requires ECE 4950 Capstone II); current catalog EE = 122 cr, no 4950. Phase 2 should load catalog archives by year (audit header gives it).
- Tim's EE flowchart picture: `docs/reference/ee-flowchart-tim.png` — the layout bar (left→right, code-only boxes, elbow connectors, labs folded into lectures, Gen Ed set apart).

- Enabling Google auth via `firebase deploy --only auth` turned the project into Identity Platform (subtype IDENTITY_PLATFORM, still no billing). Don't call identityPlatform:initializeAuth (needs billing). Admin API calls: token from scratch script exchanging firebase-tools refresh token; serviceusage enable needs a `-d '{}'` body.

## Decisions
- 2026-10-15 · Phase 1 UI (Claude's choices, unconfirmed by Tim): laptop = flowchart + plan side by side, no tabs; phone = Flowchart/Plan bottom tabs; gear → Start, Max credits (16), Summers switch, Clear taken; legend Taken/Ready/Locked; dashed boxes for Gen Ed/electives.
- 2026-10-15 · Plain HTML/CSS/JS, no build step, GitHub Pages. Course data pre-fetched by Node scripts into `data/*.json` (catalog has no CORS for browser fetches; assumed).
- 2026-10-15 · Firebase (free Spark) only for accounts/saved plans, added in phase 3; phase 1 saves to localStorage.

- 2026-10-15 · Layout/import UI choices (unconfirmed): Gen Ed row below chart (Tim's is left), "+Lab" marker, Tim's box colors not copied, buttons "Import audit / Choose PDF / Read / Apply / Count in progress"; folded box Taken only when lecture + lab both taken.

- 2026-10-15 · v3 choices (unconfirmed): 10-hue semester palette (Sp27 orange, Fa27 blue, Sp28 purple, Fa28 teal…), legend "Sp 27", locked = faded semester color, grade badge on box top edge, TR/P/IP tags, Gen Ed below chart, coreqs don't block taps.

- 2026-10-15 · All-majors choices (unconfirmed): unnamed lists → "Choose N" / "Choose N credits" / "Choose 1 track"; graduate programs admission:true; track picked by most progress then fewest credits; track courses shown as dashed "pick from list" rows; schedule Classes default In person.

- 2026-10-15 · Flowchart loops: `layered()` drops loop-closing edges before layering (mutual pre-or-co pairs made nursing 63 columns, theatre 11–29); a no-prereq course whose arrows skip 3+ columns moves next to its first course. 20 charts changed, EE unchanged (8 crossings, 46 bends). Plan list: 2 columns `minmax(0,1fr)` so long elective names ellipsize instead of pushing column 2 off.

- 2026-10-15 · Plan start is always future: `earliestStart` = term after today's semester (Spring Jan–Apr, Summer May–Aug 19, Fall Aug 20+) and after the latest term on any audit course row (`parseAudit().lastTerm` → `settings.lastTerm`, synced; Clear taken resets it). Saved Start in the past moves up; Start list begins at the earliest allowed term. Tim's audit → Fall 2026 → plan starts Spring 2027.

- 2026-10-15 · Re-import fills grades for already-taken (disabled) rows; tapping off a pick-one Gen Ed box also clears its option codes (American Institutions stuck on).
- 2026-10-15 · Gen Ed lists MERGED (ed8767a): `scripts/fetch-gened.mjs` → `data/gened.json` + `data/2025-2026/gened.json` (9 areas + AAS lists); `js/gened.js` matcher (2,718/2,901 boxes; unmatched = generic "Choose one…" labels); ≡ button on box bottom edge opens a searchable sheet; pick saves `ph:7=DANC 1010` in `done` (no rules change), shown as 2nd line on the box. Pick-one boxes list the program's own options.

## NOT verified
- v3: dark mode; phone legend's last label sits under the Grades switch (legend scrolls sideways); ECE 3710→3780 still has two jogs.
- pdf.js import on a real iPhone (tested in headless WebKit only); real transcript/web-page paste formats (synthetic fixtures).
- Whether UVU exposes current-semester sections anywhere without login.
- Whether RMP GraphQL is callable from a script without being blocked.
- Course offering seasons (fall-only / spring-only) — catalog may not say; UVU grad plan order used as a hint.

## Rejected / parked
- ~~Paste Wolverine Track audit~~ · 2026-10-15 · parked; tapping chosen first

## Map
- `direction.md` · Tim's intent · `docs/research.md` · alternatives + data endpoints
- `scripts/fetch-program.mjs <url> <id>` · scrapes a catalog program → `data/programs/<id>.json`
- `js/planner.js` (pure) · `js/app.js` + `css/app.css` + `index.html` · UI, localStorage for taken classes
- Tests: `node tests/planner.test.mjs`, `tests/layout.test.mjs`, `tests/audit.test.mjs` · last run 2026-10-15: 10/8/6 passed, 0 failed
- Live: https://timothyhadfield.github.io/smart-advisor/ · hosting: GitHub Pages
