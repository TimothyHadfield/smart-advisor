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
