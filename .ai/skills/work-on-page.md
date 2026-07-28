---
name: work-on-page
description: Fix a stuck myworkdayjobs application step — read the open tab via chrome MCP, map it to the workflow, add the missing question/regex/answer or code, then test until the page automates through.
---
# Work On Page Skill

Use when Eve's Workday auto-flow **gets stuck on a specific step** — most often a multiple-choice / screening question the current info + patterns don't recognize, or a field/selection the handler doesn't fill. The user gives a `myworkdayjobs` URL (a certain step in the Workday template; different companies word the same step slightly differently). The tab is already open in the running Chrome.

Goal: make that page **automate through** end-to-end. This skill edits extension code/data; it uses [[test-page]] to verify.

## Procedure
1. **Read the live page.** Use the `chrome-devtools` MCP (`:9222`). `list_pages` → find the tab (open in background if needed, close after). `take_snapshot` + `evaluate_script` to read: the current step heading, every question/label, the blanks/options/selections (radios, checkboxes, dropdowns, prompts, text inputs), and which are required/empty. Read the extension's pause reason from `#ea-apply-status` / `document.documentElement.dataset.eveWorkdayMessage`.
2. **Map to the workflow.** Identify which step this is in our state machine (see `design/task2-workday-flow.md` and the `isXxxStep()`/`handleXxx()` handlers in `eve/workday.js`: My Information, My Experience, Application Questions, Voluntary Disclosures, Self Identify, Review). That tells you which handler and which answer source is responsible.
3. **Read the user's info.** Check `info/myworkdayjobs` (the human answer bank) for an existing answer to each unrecognized question. Cross-check `[QUESTION BANK]`, `[WORK AUTH]`, `[EXPERIENCE]`, `[EDUCATION]`, etc.
   - If an answer **exists** → the problem is recognition. Add phrasing patterns so the existing answer matches (see [[add-regex]]).
   - If the answer is **new but derivable** from known info → add both the answer and its patterns.
   - If **no answer exists and it's not derivable** (salary, visa specifics, anything risky) → add it to `[OPEN QUESTIONS]` in `info/myworkdayjobs` and ask the user; never guess.
4. **Make the change** in the narrowest place:
   - Screening / yes-no / choice questions → a `DEFAULT_APPLICATION_QUESTIONS` entry in `eve/workday.js` (durable, shared) or, for user-specific phrasings, `workdaySavedAnswers.applicationQuestions`. Voluntary/self-id options → `DEFAULT_VOLUNTARY_DISCLOSURES`. Free-text field answers → `regexAnswers` / the info bank. See [[add-regex]].
   - A field/selection the handler doesn't fill (wrong selector, collapsed entry, picker vs input) → fix the relevant `handleXxx` / helper in `eve/workday.js`.
   - Keep the most specific question first, and set `exclude` so a broad entry doesn't steal a specific one.
5. **Ship + test.** Bump the version and reload the extension **behind the scenes** (background tab, closed after — see the bump/reload rule), reload the target Workday tab, then call [[test-page]] with task "drive this step to completion". 
6. **Iterate** steps 1–5 until the page automates through (the step advances with no manual input and no pause). Then record durable discoveries (new selectors/phrasings/step quirks) per `update-instructions` into `design/task2-workday-flow.md` and `info/myworkdayjobs`.

## Guardrails
- **Test in the current job's Chrome instance** — the running browser on the `chrome-devtools` MCP
  (`127.0.0.1:9222`) with the authenticated session and the working tab. Never launch a fresh Chrome,
  a new profile, or a separate Playwright browser; a clean instance has no session and tests the
  logged-out entry page instead of the step you're fixing. Restore a dead connection
  (`tools/cdp/tcp-bridge.js`, `tools/cdp/wake-sw.js`) rather than starting a second instance. Applies
  equally whether you drive the page yourself, via the XC role, or through [[test-page]].
- One page can differ per tenant; prefer robust matching (label/regex, automation-id OR aria-label) over a single brittle selector.
- Never fill guessed answers for work auth, visa, sponsorship, salary, or employment history — route to `[OPEN QUESTIONS]`.
- Never copy secrets into code, the answer bank, logs, or reports.
