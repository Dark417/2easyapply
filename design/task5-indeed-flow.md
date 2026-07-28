# Indeed Smart Apply Flow — Task 5

Eve's per-step state machine for Indeed's Smart Apply wizard. Anchor domain:
`smartapply.indeed.com` (extensible `INDEED_HOSTS` list in `eve/indeed.js`, plus
`INDEED_ARTIFACT_HOSTS` in `eve/background.js` and a `content_scripts`/`host_permissions` entry in
`eve/manifest.json` — one line each per new host).

Implemented in **`eve/indeed.js`**, first shipped v1.1.220, flow-complete
v1.1.225 (live-verified end-to-end on Infosys "Graph DB Developer", Plano TX, 2026-07-27).
Cover-letter file-upload handling + the stepSignature advance-timing fix shipped v1.1.244
(Hudson Manpower "QA Automation Engineer IV", 2026-07-27) — see "Cover-letter file upload" below.
The "What is location" multi-select combobox handler shipped v1.1.246 (same job) — see
"'What is location' multi-select combobox fix" below.
Isolated from LinkedIn/Workday/gh: Indeed runtime memory lives in the **`indeedSavedAnswers`**
chrome.storage key only; the per-tab Auto session lives in sessionStorage (`eveIndeedSession`).

**Question bank**: `DEFAULT_INDEED_QUESTIONS` is spliced VERBATIM from greenhouse.js's
`DEFAULT_GH_QUESTIONS` by **`tools/sync-indeed-bank.js`** — regexes are never retyped (bank
control-character lesson). greenhouse.js is the single source of truth for shared screening
topics; after editing it, run the sync tool to update `eve/indeed.js`. The splice
references the `SALARY_EXPECTATION` constant, which indeed.js defines locally. User extensions
merge via `indeedSavedAnswers.questions` (`{topic, patterns(glob), choose|text|optionMatch}`).

**Age/contract wording (user correction, 2026-07-27):** the combined question asking whether the
applicant is at least the age of majority and has the right to contract in their own name maps to
the existing `age-minimum` topic → **Yes**.

## Hard automation gate

Same contract as Workday/gh: nothing starts on page load; the explicit **Auto Apply** / **Apply**
click is the only trigger; a pause resumes only via another explicit click. Auto loops through
steps (`MAX_AUTO_STEPS` 30); Manual (Auto off) fills the current step and advances exactly one
step. A user-activated running Auto session survives the wizard's own in-tab navigation via the
sessionStorage session (state `running` + `activatedByUser`); every pause writes `waiting`, which
never auto-resumes.

**Submit-on-complete (user-approved 2026-07-27, `INDEED_SUBMIT_ENABLED = true`, v1.1.226 — like
the gh rule):** when the review step is reached and every required field is verified filled (no
failed items, no unanswered required questions), Eve clicks the real
`[data-testid="submit-application-button"]` ONCE and waits up to 25 s for Indeed's confirmation.
**Definitive confirmation evidence** = URL transition `review-module` → `/form/post-apply` and/or
the "Your application was submitted to <company>" heading, with the Submit control gone. If
anything required is missing, Eve names the items and HOLDS instead; if no confirmation appears
after the click, it reports "verify manually" and never clicks Submit twice. Eve never interacts
with any CAPTCHA (Indeed carries invisible reCAPTCHA Enterprise plumbing that must not gate).
Historical note: v1.1.220–1.1.225 held always; the first live submission (Infosys "Graph DB
Developer", 2026-07-27) was user-triggered on the held Review state and confirmed at
`/form/post-apply` with an email-confirmation notice to the application account. The post-apply
page offers Indeed's own optional demographic survey ("Take survey") — never part of the
application, never touched.

## State machine (URLs + steps, confirmed live 2026-07-27)

Base: `https://smartapply.indeed.com/beta/indeedapply/form/<module>/<step>`. Hard reloads bounce
through the transient re-entry URL `/beta/indeedapply/applybyapplyablejobid?indeedApplyableJobId=…`
and land back on the current wizard step (a `beforeunload` prompt guards leaving).

| Order | URL path (after /form/) | Heading | Handler |
| --- | --- | --- | --- |
| 1 | `resume-selection-module/resume-selection` | "Add a resume" | `handleResumeSelection` |
| 2..n | `questions-module/questions/N` (N sequential) | "Answer these questions from the employer" | generic fill |
| n+1 | `demographic-questions-module/demographic-questions/1` | "Voluntary self identification questions from the employer" | generic fill (EEO topics) |
| final | `review-module` | "Review your application" (100%) | review hold |

Step detection is generic: `stepPath()` from the pathname + heading; `isReviewStep()` = path
contains `review` OR heading "Review your application" OR a visible submit-text button.
`stepSignature()` (path + heading + control count) gates every advance wait.

## Selectors (confirmed live)

| Thing | Selector | Notes |
| --- | --- | --- |
| Resume card group | `[data-testid="resume-selection-radio-card-group"]` | radio `name="resume-selection"`, value `file` = the resume already uploaded to Indeed (preselected) |
| Resume file input | `[data-testid="resume-selection-file-resume-radio-card-file-input"]` | fallback upload path (packaged artifact via `eve:get-workday-artifact`) |
| Continue (resume step) | `[data-testid="continue-button"]` | stable testid on this step only |
| Continue (questions steps) | visible button text `Continue`, hashed opaque testid | **must be found by TEXT**; testid is a long hash. React re-renders the footer right after programmatic fills, so the lookup POLLS up to 8s (`waitForContinueButton`) — a one-shot query falsely reports "no Continue" |
| Question fieldset | `fieldset[data-testid="input-q_<hash>"][role=radiogroup][aria-required]` | question text in `<legend>` ("… *"); each radio's own label is the OPTION text ("Yes"/"No"). The radio INPUT also carries data-testid — container lookup must be `closest('fieldset, [role=radiogroup]')`, never bare `[data-testid]` (self-match bug) |
| Text inputs | `[data-testid="input-q_<hash>-input"]`, `label[for]` | identity/profile labels: LinkedIn profile URL, State, City, Address 1/2, Zipcode, Most recent school, Graduation year, Today's Date (filled with MM/DD/YYYY runtime date) |
| Custom single-select | `div[role="combobox"][data-testid="single-select-question-select-list-select-list"]` | `aria-required`, placeholder text "Select an option", label via `aria-labelledby`, options `[role=option]` in popup `[role=listbox]` (`aria-controls`). Click toggles `aria-expanded`; **Escape does NOT close — toggle-click does** (react-select-like). Country list renders all 250 options (not virtualized) |
| Custom MULTI-select | `div[role="combobox"]` whose `aria-labelledby` id contains `multi-select-question-label` | Same "select-list" widget family as the single-select above, rendered as a chip multi-select (e.g. "What is location"). Required lives on the **legend**, not the combobox's own `aria-required`. Already-selected values render as PERSISTENT chip `<button aria-label="Remove <value>">` elements OUTSIDE the popup — read/write selection state through those chips, not `aria-selected`/`aria-checked` inside the popup. Popup options render as `[role="option"], [role="menuitemcheckbox"]` (no virtualization, ~50 city options observed) and the popup **stays open across multiple picks** — no toggle-close needed between selections |
| Unanswered-required signal | text "Choose an option to continue." inside the fieldset | reliable; used to NAME blockers when Continue refuses to advance. Required comboboxes showing their placeholder carry NO inline text — reported separately by label |
| Advance from demographic page | button "Review your application" (type=submit) | navigates to review; NOT a submit control |
| True submit | `[data-testid="submit-application-button"]` "Submit your application" | on `review-module`; clicked ONCE only when the completeness gate passes (submit-on-complete rule above) |
| Submission confirmation | URL `/form/post-apply` + heading "Your application was submitted to <company>" | Submit control removed; email-confirmation notice shown |
| Exit control | `[data-testid="ExitLinkWithModalComponent-exitButton"]` "Save and close" | never clicked |
| Cover letter question | `legend` text "Cover letter" → radio group (`file`/`text`) | a SEPARATE sibling `.ia-Questions-item` (own legend "Upload a file") holds the real widget — the radio group itself has no file input, so the generic already-checked-group skip never touches it |
| Cover letter file input | `input[type="file"][data-testid*="upload-button-file-input"]` | hidden (`display:none`); the visible "-list" div (`[data-testid$="-list"]`, `aria-live=polite`) is the only reliable "attached" signal — the input's own `.files` is cleared by Indeed after a successful read either way |

## Fill engine notes

- **Radio groups one-at-a-time with live-DOM verification**: Indeed re-renders the question list
  after an answer, so nodes captured in one snapshot go stale and clicks on them silently no-op
  (v1.1.222 symptom: 6 of 8 groups "skipped"). Each pass re-scans `input[type=radio]` fresh,
  answers the first unanswered group, then verifies `input[name=…]:checked` against the live DOM
  (retry once via a freshly-queried input) before moving on. Cap 25 iterations.
- **Singleton-required radio rule** (extends the gh single-option dropdown rule): a required group
  with exactly one real option is selected outright — "How did you hear about us → Indeed",
  Infosys' EEO "Accept" acknowledgement.
- Indeed **pre-fills remembered answers** (identity fields from the Indeed profile, and some
  employer screeners answered in past applications). Filled controls are never touched.
- EEO defaults land through the shared bank: gender → Male, Hispanic/Latino → No (exclude refined
  so the question's own "…regardless of race" parenthetical doesn't reroute it to the race topic),
  veteran → "No, I am not a veteran under one of the classifications listed above" (optionMatch
  allows the leading "No,"), disability → No, Country → United States (profile), Race category →
  Asian.
- Pauses NAME their blockers (unanswered required questions, verbatim) both from the fill scan and
  from the post-advance "Choose an option to continue." scan; unmatched questions are appended to
  `indeedSavedAnswers.seenQuestions` for registration.
- **stepSignature() must be snapshotted AFTER filling, not before** (fixed v1.1.241): the generic
  step branch of `runCurrentStep()` used to pass the PRE-fill signature into `advanceStep()`. Any
  fill action that mounts a new DOM element as a side effect (e.g. selecting the cover-letter
  "Upload a file" radio, which conditionally renders the upload widget) changes `stepSignature()`'s
  input-count term on its own — `advanceStep()`'s poll loop then saw a signature diff on its very
  first check and reported `ok:true` ("Advanced.") without ever confirming Continue's click did
  anything, silently skipping past an unresolved required field. Fix: `runCurrentStep()` now takes
  a fresh `stepSignature()` snapshot right after `fillCurrentStepFields()` completes (fill
  side-effects already baked in) and passes THAT into `advanceStep()`, so only a POST-click change
  counts as real navigation.

### "What is location" multi-select combobox fix (v1.1.246)

The employer-questions step can include a **multi-select** variant of the combobox widget (e.g.
"What is location", Hudson Manpower "QA Automation Engineer IV") that the original single-select
combobox handler (`fillCurrentStepFields()` section "2a") did not recognize as a distinct control
shape: since a populated multi-select combobox's inner text never matches the single-select's
"Select an option" placeholder test, the old code silently treated ANY non-empty value as "already
answered" and skipped it — fine while Indeed's own remembered prefill happened to already hold
values, but a hard reload (or a fresh applicant) can render it genuinely empty, and the old code had
no path to fill it (a required-but-unmatched combobox falls through to `unansweredRequired`, which
is exactly the observed pause: "Paused — 1 required question(s) blocked Continue: What is location").

Fix — a dedicated multi-select branch ("2a-multi", added before "2a" so its combos are excluded from
the single-select loop via `comboIsMultiSelect()`):
- **Detection**: the field's `aria-labelledby` id contains `multi-select-question-label` (the
  single-select variant's id starts `single-select-question-label`); falls back to "fieldset has any
  chip Remove-button" for robustness.
- **Bank**: a new Indeed-only array `DEFAULT_INDEED_MULTISELECT_QUESTIONS` (topic
  `preferred-work-locations`, `optionMatch: /california|washington|texas/i`) — deliberately kept
  OUTSIDE the `BEGIN/END spliced bank` markers because greenhouse.js has no equivalent multi-select
  widget, so `tools/sync-indeed-bank.js` must never touch it. This reproduces
  `info/myworkdayjobs` [CONTACT] "Remote US states able to work in: CA, WA, TX": every popup option
  naming one of those three states gets selected, and nothing outside that list ever does. User
  extensions merge via `indeedSavedAnswers.multiSelectQuestions`.
- **Reconciliation**: reads/writes selection state through the chip `Remove <value>` buttons (not
  `aria-selected`/`aria-checked` inside the popup — more robust across widget internals and stable
  whether the popup is open or not). Opens the popup once, adds every unchecked matched option
  (fresh live re-scan per click — the widget can re-render after each pick, same lesson as the radio
  groups), then removes any checked chip that is NOT in the matched set (this is what clears a wrong
  prior selection, e.g. a stray "Remote (New York, New York, United States)" chip observed live from
  an earlier manual test round), then closes the popup only if this pass opened it.
- **No-bank-match fallback**: if the field is required, empty, and no bank entry matches its label,
  ticks the first 3 real options (else the first) — parity with the existing Workday/gh
  "MultiSelect-Default" rule for an unrecognized required "select all that apply" field.
- **Verification (2026-07-27)**: the live Hudson Manpower tab could not be re-driven end-to-end this
  round — the shared Chrome instance (127.0.0.1:9222) restarted several times mid-session from
  unrelated heavy concurrent multi-agent load, which wiped the tab's `sessionStorage` and orphaned
  Indeed's own short-URL redirect bootstrap for that specific in-progress application (a client-side
  `sessionStorage.getItem('shortUrl/form')` redirect that only Indeed's own "Apply" entry click can
  regenerate); the job's search-result "Apply with Indeed" button was also disabled (consistent with
  Indeed tracking an application already in progress server-side), so a clean re-entry wasn't
  available without risking a duplicate/garbled session. Instead the exact extracted handler code
  (`comboIsMultiSelect`/`multiSelectLabel`/`multiSelectRequired`/`multiSelectChipTexts`/
  `multiSelectRemoveButton`/`multiSelectOptionElements` + the reconciliation loop, unmodified) was
  run against a synthetic DOM replicating the exact live-confirmed structure (same ids/attributes,
  seeded with the real broken 4-chip state including the wrong New York chip and the three missing
  CA/WA cities). Result: it correctly removed the wrong New York chip, added every missing
  California/Washington/Texas option, left non-matching states (Georgia/Massachusetts/Ohio/North
  Carolina) untouched, and the final chip set exactly equaled the matched set with nothing missing.
  This confirms the detection/matching/add/remove logic is correct; a live end-to-end confirmation
  (Continue past questions/1, and whatever step follows) is still pending a future round once a
  fresh Indeed application reaches this same field or the shared browser is stable enough to re-walk
  Hudson Manpower to this step (Indeed remembers already-committed answers, so a fresh entry should
  redrive quickly to the same point per the existing "Testing gotchas" note below).

### Cover-letter file upload — hard platform limit (confirmed live 2026-07-27, v1.1.244)

Indeed's cover-letter upload widget **silently rejects a script-dispatched file selection**:
setting `input.files` via `DataTransfer` + dispatching synthetic `input`/`change` events sets
`.files` for an instant, then Indeed's own handler clears it and the "-list" div never populates —
no error, no console signal beyond a generic "Uncaught (in promise)". A **CDP-level trusted file
injection** (chrome-devtools MCP `upload_file`, the same primitive Playwright/Puppeteer/Selenium
use) on the identical `<input>` attaches it instantly, confirmed by the "-list" div showing
`"Xiaoxiao Lei Cover Letter.pdf · Uploaded just now · Remove"`. `Event.isTrusted` cannot be spoofed
from page/content-script JS — this means **indeed.js, running unsupervised with no CDP session of
its own, can never complete this specific attach by itself.** (The packaged-artifact resume
fallback in `handleResumeSelection` uses the identical dispatch technique and has never actually
been exercised live — every live run so far had an existing resume already on file, so it may
carry the same latent limitation; untested.)

**Design (user-approved 2026-07-27) — two-party handoff**: `handleCoverLetterUpload()` selects
"Upload a file" if not already chosen, waits ~500 ms for the widget to mount, and checks the
"-list" div. If a file is already attached, it reports `skipped` and moves on. Otherwise it returns
`needs-trusted-upload` with a message naming the exact selector and the packaged file's repo path
(`cv/Xiaoxiao Lei Cover Letter.pdf`) — `fillCurrentStepFields()` routes this into the normal
`failures` pause path, so Eve stops cleanly with an actionable message instead of guessing or
silently leaving the question half-answered. Whoever is driving Chrome over CDP (a Claude Code
session with chrome-devtools MCP attached, in current practice) performs the actual
`upload_file` call against that selector, then clicks Apply to resume — the next pass detects the
populated "-list" and proceeds. This is not fully unsupervised end-to-end for jobs with a
cover-letter file question; it is the best available design given the trust constraint.

## Live run evidence (Infosys "Graph DB Developer", 2026-07-27, v1.1.225)

One Auto Apply click: resume-selection (kept `Xiaoxiao_Lei_Resume.pdf`, Continue) →
questions/1 (identity: LinkedIn/State/City/Address/Zip/School/Grad year — largely Indeed-prefilled)
→ questions/2 → questions/3 (8 required Yes/No screeners: prior Infosys employment No, restrictive
covenants No, source Indeed (singleton), work auth Yes, Bachelor's minimum Yes, relocate Yes,
sponsorship Yes, minimum experience Yes; Today's Date filled) → questions/4 (travel Yes,
adjustments/accommodations No, EEO Accept singleton) → demographic-questions/1 (all 4 radios +
Country/Race comboboxes) → **review-module, held**: "Review step reached — every required field is
filled. Eve holds before Submit (explicit user approval required)." `submit-application-button`
untouched. Reproduced twice (deterministic). No Eve console errors.

## Testing gotchas

- Hard-refreshing or deep-linking any `/form/<step>` URL triggers `beforeunload` + the
  `applybyapplyablejobid` bounce and can reset the wizard to resume-selection — the wizard
  re-drives quickly since Indeed remembers committed answers. For post-hoc step inspection use SPA
  `history.back()` only, never a hard URL navigation.
- After every extension reload the tab's content script is orphaned ("Eve was updated. Refresh…"
  on the first click) — hard-refresh the tab before testing, per the standard update-then-refresh
  cycle.
- Diagnostic probe: `eve:indeed-artifact-probe` message → validates the packaged-PDF fetch path
  without touching the form.
