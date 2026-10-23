# Eve Auto Flow

## Purpose

Define the end-to-end LinkedIn Easy Apply operating flow before implementation details spread across the extension and Python automation.

## Draft Product Flow

1. The user stores a search phrase and automation parameters in repo-root `params`.
2. Eve opens a LinkedIn jobs search in a background tab, fills role and location, then enables `Easy Apply` from the visible top filter bar when available; if LinkedIn only exposes it inside `All filters`, Eve opens `All filters`, toggles `Easy Apply` on, and clicks `Show results`.
3. Automation iterates job cards one by one and waits for the right-side detail pane to load.
4. On each new job, automation scrolls the details pane for 1 to 3 seconds before deciding whether to apply.
5. Automation extracts a stable job identity and checks the application log to ensure the job has not already been submitted.
6. If the job passes dedupe and keyword ignore rules, Eve opens Easy Apply and fills the modal step by step using persisted Eve answers.
7. If the user manually clicks LinkedIn's `Easy Apply` button, Eve should detect that click, show the current company and role in Eve, and continue the same auto-apply loop from the opened modal.
8. Between UI actions, Eve uses randomized delays of 300 to 1200 milliseconds.
9. Eve enforces rate limits of 5 applies per minute, 30 per hour, and 200 per day.
10. After every 5 Easy Apply attempts, Eve rests for 5 to 10 seconds before continuing.
11. After a successful submit, automation extracts key job values and appends them to `app-log.xlsx`.
12. Persist all new data used during the flow unless the user explicitly asks to delete it.

## Required Persisted Data

- Search phrases
- Ignore keywords and case-sensitivity mode
- LinkedIn click timing
- Automation pacing and rate-limit settings
- Saved Eve answers
- Submitted-job identities and extracted job metadata in `app-log.xlsx`

## Job Log Requirements

- Log one row per submitted application.
- Capture enough fields to identify the job and reconstruct what was submitted.
- Store a stable unique job identifier so the same job is never re-applied.
- Prefer LinkedIn job ID from the URL or page data. Fall back to normalized company, title, and location only if no stronger identifier exists.

## Refined Task Sequence

1. Analyze the requested workflow or UI change and update `AGENTS.md`, relevant skills, and this flow doc first when the change introduces a reusable process rule.
2. Keep `params` as the single source of truth for search and automation config.
3. Keep Eve search controls compact and persistent, with searchable history, removable ignore-keyword items, and a rolling apply queue that can pause and resume.
4. When Eve launches a fresh LinkedIn search tab, explicitly drive the LinkedIn search UI through role, location, and `Easy Apply`, preferring the visible top filter bar before falling back to `All filters` and `Show results`.
5. Keep extension-level preferences like theme in the extension popup menu rather than the floating LinkedIn panel when the user requests extension-bar control.
6. Expose the automation config in Eve settings and keep it persisted through the same `/params` bridge.
7. Keep the Step tab synced to the live Easy Apply step by default, while still allowing backward review of prior visited steps.
8. Treat manual LinkedIn `Easy Apply` clicks as a valid auto-start signal for Eve's apply loop.
9. When Eve fills a text field from a saved answer and LinkedIn opens an autocomplete or combobox list, Eve should choose the matching option before moving on.
10. The manual `Easy Apply` detector should inspect the composed click path, not just the immediate event target, so nested LinkedIn button markup still triggers Eve.
11. If Eve stops on missing required answers, a manual `Next` click after the user fills those fields should re-enter the auto loop automatically.
12. Extend the Python automation runner to:
   - read the new `auto` config
   - pace actions with randomized delays
   - enforce minute, hour, and day apply caps
   - add a short cooldown after every 5 attempts
   - scroll the job detail pane before Easy Apply
   - dedupe against prior submissions
   - append submitted jobs to `app-log.xlsx`
13. Create and maintain `app-log.xlsx` as the durable submission ledger.
14. After code changes, reload the extension and inform the user what to test next. Do not run live auto-tests unless the user explicitly asks for them.

## Ownership

- `lead-product`: refine workflow and maintain task sequence clarity.
- `lead-architect`: coordinate code changes and runtime verification.


## Round 2026-08-27 — shared-info resolution + live run (12 applies)

- Wired the cross-platform profile (`eveProfile`) and shared question bank (`question-bank.js`) into
  `resolveSavedValue()` as fallbacks after the LinkedIn-only keys. Manifest loads `question-bank.js`
  before `content.js` on LinkedIn.
- Live run on the `software engineer contractor` / Contract / past-week / Easy Apply search: 12
  confirmed submissions (Russell Tobin, Turing x2, CapitexAI, CodeGeniusRecruit, Aquent, Robert
  Half, iTech US, Bayside, Akraya, SPECTRAFORCE, Crossing Hurdles, Insight Global, Ampstek, Pacer,
  Vidorra, Galactic Minds …) until LinkedIn's daily cap.
- Stuck points hit and how each was handled:
  1. SIMARN: "W2 only" select + "JS/HTML/CSS how many years" text → filled Yes / 4; banked as
     `w2-employment-ok`, `years-javascript-html-css`. Resume wiped the values → fixed (no card
     refocus while a modal is open).
  2. Insight Global: "Do you have atleast 5+ years … development?" → Yes; threshold patterns now
     accept development/coding/… tails and "atleast".
  3. Ampstek: "Are you fine for onsite in Concord, CA?" → Yes; `relocation-hybrid` patterns extended.
  4. Paladin: modal went `display:none` mid-step; Eve waited forever → hidden-modal handling.
  5. `findEasyApplyButton` root fallback clicked the header "Easy Apply" filter pill → `f_AL` lost.
     Excluded the filter bar.
  6. Daily cap banner → new terminal state.
- Filling a value from outside the page: set via native setter + input/change + blur/focusout; the
  chrome-devtools `fill` tool cannot interact with LinkedIn's `<select>` (never becomes
  "interactive"); text inputs are fine.
