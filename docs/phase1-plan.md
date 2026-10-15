# Phase 1 plan — EE BS flowchart + auto plan (2026-10-15)

Tim: "any majors have flowcharts on the classes they need to take as well as automatic plans on which classes to take for future semesters in order to graduate on time and the prerequisites line up." First slice: "EE flowchart + plan, then all majors". Authorized: "Yes, build phase 1".

## What gets built
1. **`scripts/fetch-program.mjs <catalog-url> <id>`** (Node, no deps): reads a catalog program page, parses `#requirementstextcontainer` (required courses, "or" alternatives, "Complete one of / a minimum of N credits from" choice groups, placeholder rows like "Fine Arts Distribution") and `#graduationplantextcontainer` (UVU's sample semester order). For each course code, fetches `https://catalog.uvu.edu/ribbit/?page=getcourse.rjs&code=<CODE>` and parses title, credits, prerequisite and corequisite codes (keep the raw prereq text too; "and/or" logic best-effort). Writes `data/programs/<id>.json`. Built for any program, run on EE BS now.
2. **`js/planner.js`** (pure, browser + Node): given program JSON, set of completed codes, start term, max credits per semester (default 16) → semester-by-semester plan. Rules: a course only after all prereqs are in earlier semesters (coreqs same semester or earlier); prefer UVU's grad-plan order as a priority hint; longest-prereq-chain courses first so graduation isn't delayed; placeholders (Gen Ed distribution, electives) fill leftover credits. Skip summers by default.
3. **`index.html` + `css/app.css` + `js/app.js`**: two tabs — **Flowchart** and **Plan**.
   - Flowchart: course boxes in columns by prereq depth, SVG arrows prereq → course. Tap a box to mark complete (green) / untake. Locked (prereqs unmet) vs available look different. Fits iPhone (pinch/scroll inside the chart area only) and laptop.
   - Plan: semesters as compact panels with codes + credits, total credits, projected graduation term. Recomputes when you tap classes.
   - Saved to localStorage for now (Firebase/Google sign-in is phase 3).
4. **`tests/planner.test.mjs`** (`node tests/planner.test.mjs`): prereqs always precede, credit cap respected, all required credits placed, completed courses removed; run on the real EE JSON.

## Verification
- Tests pass, and seen failing against a broken planner first.
- phone-view at 393px and `--desktop`; flowchart and plan visible without page scroll.
- Spot-check 5 EE prereqs against the catalog (e.g. ECE 2250 ← MATH 1210, PHYS 2220, ECE 1000).

## Out of scope (later phases)
All majors picker (phase 2), Google sign-in (3), section schedules (4), RMP (5).
