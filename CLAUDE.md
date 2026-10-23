# Smart Advisor — notes for Claude

Public UVU degree helper for any UVU student (Tim builds it; he directs and never reads code). Pick a
major/minor/cert → prerequisite flowchart, tap classes taken (or import a Wolverine Track audit) →
automatic semester plan, a schedule builder for next term's real sections, Rate My Professors ratings,
Gen Ed class lists. Optional Google sign-in syncs one doc per student. iPhone first, laptop too.

- Live: https://timothyhadfield.github.io/smart-advisor/ (`?p=<program-id>` opens a program)
- Repo: github.com/TimothyHadfield/smart-advisor (public) · GitHub Pages from `main` (push = deploy)
- Read first: `progress.md` (state, traps, decisions), then `direction.md` (Tim's intent, overrules all).

## Files
- `index.html`, `css/app.css`, `js/app.js` — the page, all DOM/state (localStorage `smart-advisor:v1`)
- `js/planner.js` — model, prereq checks, `makePlan`, terms/start (`earliestStart`, `planStart`); pure
- `js/layout.js` — flowchart layout + arrow routing (pure) · `js/programs.js` — picker, catalog years, major+minor merge
- `js/audit.js` — audit text parser · `js/pdftext.js` — PDF → text (pdf.js from cdnjs, lazy, on device only)
- `js/gened.js` — Gen Ed lists · `js/schedule.js` — sections → ranked schedules
- `js/sources.js` — every outside link (catalog program/course, class search, RMP, Gen Ed, advisors) + `DATA_SOURCES` registry of every data file's source
- `js/account.js` (Firebase SDK from gstatic, Google popup sign-in) + `js/sync.js` (pure merge/doc logic)
- `firestore.rules`, `firebase.json`, `.firebaserc` — Firebase project `smart-advisor-th` (Spark, $0)
- `data/` — prebuilt JSON: `programs/` (current catalog), `<year>/programs/`, `gened.json`, `sections/<term>.json`, `rmp.json`
- `scripts/` — Node fetchers that build `data/` (catalog, Gen Ed, Banner sections, RMP); `.github/workflows/refresh-data.yml` refreshes sections + RMP every Monday and commits to `main`
- `tests/*.test.mjs` — plain suite · `tests/*.e2e.mjs`, `tests/rules.emulator.mjs` — browser / emulator checks

## Run and test
- Local: `python -m http.server <port>` in the repo root (background), open `http://localhost:<port>/`.
  `?emu` on localhost connects to the Firebase emulators; `?data=tests/fixtures` reads other data.
- Suite: `node --test tests/*.test.mjs` (~1 min, ~1035 tests; one real-audit test runs only where `.claude/test/audit.txt` exists).
- Import e2e (no emulators): serve on 8137, then `node --test tests/import.e2e.mjs`.
- Accounts e2e + rules: see the headers of `tests/accounts.e2e.mjs` and `tests/rules.emulator.mjs` (need Java 21 + `firebase emulators:exec`).
- Phone check: `node ~/.claude/tools/phone-view.mjs <url> [--desktop] --out shot.png`.

## Traps
- `.claude/test/` holds Tim's REAL degree audit (PDF + text): gitignored. Never commit, copy, quote or screenshot it; fixtures use made-up audits.
- Never write to the live Firestore. There is no `claude-test` login; sign-in is a Google popup that can't be scripted — use the emulators.
- The repo is public: no emails, ids or credentials in code or notes.
- Never call `identityPlatform:initializeAuth` (needs billing). `firebase deploy --only firestore:rules` is the only deploy the app needs besides pushing.
- `scripts/fetch-all.mjs` rewrites every data file with LF endings: commit only files whose `git diff -w` changed.
- Catalog, Banner and RMP have no CORS: data is fetched at build time by Node, never from the browser.
- Prereq rules: a course outside the program counts as met; "A or B" where B is in the program waits for B.
- Settings keys sync through `js/sync.js` `SETTINGS`; a cleared value must be `null` (a deleted key never reaches other devices).

## Standing instructions (Tim's words)
- "Public site for any UVU student, with accounts (Google sign-in)." Money: $0, free tiers only.
- Look: "UVU green, clean and compact". Completed classes: "Tap classes on the flowchart".
- "don't allow the user to select a class that still needs prerequisites filled."
- "if the program fills in classes that the user is currently taking, the first semester ... is a future semester, not a current one."
- Flowchart: "minimize how much the lines turn ... make the lines seperated from each other enough where you'll never be confused which line goes where".
- Every fact from an outside source links to it (Tim, 2026-10-22: "could you also have automatic links to everything you are reffering to or getting your informatoin from? This includes anything UVU, as well as Rate my professor, and anything we develope later in the cite."). Build each link with `sourceLink()` in `js/sources.js` (small "↗", new tab, "checked <date>"), register every new `data/` file in its `DATA_SOURCES`; `tests/sources.test.mjs` fails on an unregistered data file or a UVU/RMP address typed outside `js/sources.js`.
- More in `progress.md` → Standing instructions. Tim decides visuals, wording, names and money.
