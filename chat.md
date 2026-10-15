# Smart Advisor — chat log (for Claude)

_One entry per session, newest at the bottom, capped at 60 KB. Older entries are in `docs/archive/chat-archive.md`. The current state is in `progress.md`._

## 2026-10-15 · Kickoff
- **Asked:** smart advisor for UVU: flowcharts for any major, auto grad plans with prereqs, upcoming sections with times/professors and a preferred-schedule builder, RMP ratings. Then: "create necessary md files as well as a repository on my github for this cite." Shared his EE Lucidchart (login-walled).
- **Decided (Tim):** public + Google sign-in; keep hunting for schedule data, fallback paste; EE first then all majors; build phase 1 now; UVU green compact look; tap classes to mark complete.
- **Decided (Claude):** plain static site on GitHub Pages, data pre-fetched to JSON by Node scripts, Firebase only in phase 3.
- **Built:** direction.md, progress.md, chat.md, docs/research.md, README.md; repo TimothyHadfield/smart-advisor with Pages.
- **Verified how:** curl against catalog.uvu.edu (programs list, ribbit course endpoint, FOSE search API) on 2026-10-15.
- **Open:** Tim to export his Lucid flowchart as PNG/PDF; current-semester section source.
