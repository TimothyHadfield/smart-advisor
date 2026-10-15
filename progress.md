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
| Wolverine Track import | live (bd1827b) | gear → Import audit: paste or PDF (pdf.js 3.11.174 lazy); `js/audit.js`; real audit → 19 taken, 6 IP |
| All majors | not started | phase 2 (+ catalog-year archives) |
| Google sign-in (Firebase) | not started | phase 3; create project `smart-advisor-th` via firebase CLI (logged in as timhadfield7@gmail.com) |
| Section schedules + builder | blocked on data | public class search stops at Spring 2025; keep hunting, fallback = paste from myUVU |
| Rate My Professors | not started | unofficial GraphQL; needs a CORS-free path (fetch at build time via script) |

## Authorized next steps
- 2026-10-15 · Build phase 1 (EE first), then all majors. Tim: "Yes, build phase 1".
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

## Decisions
- 2026-10-15 · Phase 1 UI (Claude's choices, unconfirmed by Tim): laptop = flowchart + plan side by side, no tabs; phone = Flowchart/Plan bottom tabs; gear → Start, Max credits (16), Summers switch, Clear taken; legend Taken/Ready/Locked; dashed boxes for Gen Ed/electives.
- 2026-10-15 · Plain HTML/CSS/JS, no build step, GitHub Pages. Course data pre-fetched by Node scripts into `data/*.json` (catalog has no CORS for browser fetches; assumed).
- 2026-10-15 · Firebase (free Spark) only for accounts/saved plans, added in phase 3; phase 1 saves to localStorage.

- 2026-10-15 · Layout/import UI choices (unconfirmed): Gen Ed row below chart (Tim's is left), "+Lab" marker, Tim's box colors not copied, buttons "Import audit / Choose PDF / Read / Apply / Count in progress"; folded box Taken only when lecture + lab both taken.

## NOT verified
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
