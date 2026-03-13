# Abby Auto Flow

## Purpose

Define the end-to-end LinkedIn Easy Apply operating flow before implementation details spread across the extension and Python automation.

## Draft Product Flow

1. The user stores a search phrase and automation parameters in repo-root `params`.
2. Abby opens a LinkedIn jobs search in a background tab, fills role and location, then enables `Easy Apply` from the visible top filter bar when available; if LinkedIn only exposes it inside `All filters`, Abby opens `All filters`, toggles `Easy Apply` on, and clicks `Show results`.
3. Automation iterates job cards one by one and waits for the right-side detail pane to load.
4. On each new job, automation scrolls the details pane for 1 to 3 seconds before deciding whether to apply.
5. Automation extracts a stable job identity and checks the application log to ensure the job has not already been submitted.
6. If the job passes dedupe and keyword ignore rules, Abby opens Easy Apply and fills the modal step by step using persisted Abby answers.
7. If the user manually clicks LinkedIn's `Easy Apply` button, Abby should detect that click, show the current company and role in Abby, and continue the same auto-apply loop from the opened modal.
8. Between UI actions, Abby uses randomized delays of 300 to 1200 milliseconds.
9. Abby enforces rate limits of 5 applies per minute, 30 per hour, and 200 per day.
10. After every 5 Easy Apply attempts, Abby rests for 5 to 10 seconds before continuing.
11. After a successful submit, automation extracts key job values and appends them to `app-log.xlsx`.
12. Persist all new data used during the flow unless the user explicitly asks to delete it.

## Required Persisted Data

- Search phrases
- Ignore keywords and case-sensitivity mode
- LinkedIn click timing
- Automation pacing and rate-limit settings
- Saved Abby answers
- Submitted-job identities and extracted job metadata in `app-log.xlsx`

## Job Log Requirements

- Log one row per submitted application.
- Capture enough fields to identify the job and reconstruct what was submitted.
- Store a stable unique job identifier so the same job is never re-applied.
- Prefer LinkedIn job ID from the URL or page data. Fall back to normalized company, title, and location only if no stronger identifier exists.

## Refined Task Sequence

1. Analyze the requested workflow or UI change and update `AGENTS.md`, relevant skills, and this flow doc first when the change introduces a reusable process rule.
2. Keep `params` as the single source of truth for search and automation config.
3. Keep Abby search controls compact and persistent, with searchable history, removable ignore-keyword items, and a rolling apply queue that can pause and resume.
4. When Abby launches a fresh LinkedIn search tab, explicitly drive the LinkedIn search UI through role, location, and `Easy Apply`, preferring the visible top filter bar before falling back to `All filters` and `Show results`.
5. Keep extension-level preferences like theme in the extension popup menu rather than the floating LinkedIn panel when the user requests extension-bar control.
6. Expose the automation config in Abby settings and keep it persisted through the same `/params` bridge.
7. Keep the Step tab synced to the live Easy Apply step by default, while still allowing backward review of prior visited steps.
8. Treat manual LinkedIn `Easy Apply` clicks as a valid auto-start signal for Abby's apply loop.
9. When Abby fills a text field from a saved answer and LinkedIn opens an autocomplete or combobox list, Abby should choose the matching option before moving on.
10. The manual `Easy Apply` detector should inspect the composed click path, not just the immediate event target, so nested LinkedIn button markup still triggers Abby.
11. If Abby stops on missing required answers, a manual `Next` click after the user fills those fields should re-enter the auto loop automatically.
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
