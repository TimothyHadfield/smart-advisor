# Smart Advisor — direction

_Tim's intent, from the kickoff interview (2026-10-15). **This overrules every other file.** Rerun the interview (`/kickoff`) if the goal changes. Items marked (assumed) weren't answered yet._

## What it's for
Tim's words: "I want to make a smart advisor for UVU so that any majors have flowcharts on the classes they need to take as well as automatic plans on which classes to take for future semesters in order to graduate on time and the prerequisites line up. the next biggest feature has to do with viewing the current course list for future semesters with their times and professor names, and builds a system of classes that is preferable for the user. Additionally if you can connect to rate my professor, associate the class with the overall rating of that professor aswell."

Done looks like:
1. Pick any UVU major → see a prerequisite **flowchart** of its classes.
2. Tap off classes already taken → get an **automatic semester-by-semester plan** that graduates on time with prereqs in order.
3. See **upcoming semesters' sections** (times, professor names) and get a **preferred schedule** built for you.
4. Each section shows the professor's **Rate My Professors overall rating**.

Tim made his own EE flowchart in Lucidchart ("Major Prerequisites") as the reference for what a flowchart should show.

## Who uses it, and where
- Users: any UVU student (public site) · accounts: **yes, Google sign-in** (Firebase free tier)
- Devices: iPhone first, laptop too (assumed: same as his other apps)

## Hard constraints
- Money: $0, free tiers only, no card on file
- Data: stores only each student's completed classes, saved plan and schedule preferences, in Firestore under their own account. Never delete or migrate user data without Tim's go. Repo is public: no secrets.
- Course data comes from UVU's public catalog (catalog.uvu.edu); no scraping behind anyone's login.

## Scope, in priority order
1. **EE BS first:** flowchart + tap-to-complete + auto plan, so Tim can check it's right.
2. **All majors:** auto-load every program from the catalog.
3. **Google sign-in** so plans follow the student across devices.
4. **Section schedules + preferred-schedule builder.** Source: keep hunting for a logged-out current-semester source; fall back to the student pasting/uploading their myUVU class search results.
5. **Rate My Professors** overall rating on each section.

## Parking lot (explicitly later / out)
- Pasting a Wolverine Track degree audit to fill in completed classes · later, if tapping proves slow

## Taste
UVU green, clean and compact, dark/light, phone-first. Tim decides visuals, wording and names.

## Working agreement
- Act on recommendations; never ask permission. Ask only about visuals, wording, names, privacy, money.
- He said to build phase 1 right after setup (2026-10-15).
