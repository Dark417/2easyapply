# Greenhouse ("gh") Apply Flow — Task 3

Eve's from-scratch fill flow for the Greenhouse application template. Anchor domain:
`job-boards.greenhouse.io`. Other domains render the same template and are added as one-line hosts
(`GH_HOSTS` in `eve/greenhouse.js`, `GH_ARTIFACT_HOSTS` in `eve/background.js`, plus a
`content_scripts`/`host_permissions` entry in `eve/manifest.json`). `my.greenhouse.io` (the
authenticated MyGreenhouse candidate portal, `TEMPLATE = 'gh-account'`) is a related but distinct
surface — same fill engine, different DOM wrapper classes — documented in its own section below.

Implemented in **`eve/greenhouse.js`**, shipped v1.1.211. Isolated from LinkedIn and Workday: gh runtime memory lives in the
**`ghSavedAnswers`** chrome.storage key only.

**Extension namespace:** Eve uses the single `eve:*` message namespace, `#eve-floating-ui` panel
id, and `eveTheme` storage key. The canonical unpacked extension directory is `eve\`.

**Conditionally revealed questions (v1.1.189 fix)**: answering one question can insert another
control (6sense: answering "Are you Hispanic/Latino?" inserts the "Please identify your race"
react-select). The Apply fill runs in ROUNDS (cap 5): each round re-scans file blocks, text
inputs, `.select-shell`s, native selects and radios, processes only elements not seen before
(identity Set), and stops when a round discovers nothing new; the unanswered report is computed
after the final re-scan.

**Diagnostic probe**: `chrome.tabs.sendMessage(tabId, { type: '<ns>:gh-artifact-probe',
artifactId: 'resume'|'coverLetter' })` → the content script fetches the packaged PDF through the
real background path and responds `{ ok, name, size, type }`.

## Zipline embedded Greenhouse profile (confirmed 2026-07-27)

- Match the top-level wrapper at `https://www.zipline.com/open-roles/<job-token>`.
- Keep the Eve panel in the top document; Zipline is an explicitly registered adapter domain.
- The actual application is in `iframe#grnhse_iframe`. Its initial `boards.greenhouse.io` source
  redirects to `job-boards.greenhouse.io/embed/job_app`; inject the Greenhouse engine there with
  `all_frames: true`.
- Relay Apply, form signatures, and engine status through the background service worker because
  the top page cannot access the cross-origin form DOM.
- `eve:gh-embed-probe` exercises top document → background → Greenhouse frame and returns a form
  signature without filling, attaching files, or submitting.
- Live inventory for job `7808704003`: identity, phone/country, location, resume, cover letter,
  LinkedIn, website, gender, Hispanic/Latino, veteran, disability, Submit, and reCAPTCHA.
- **v1.1.211 live result:** after reloading the unpacked `eve/` extension and hard-refreshing the
  exact Zipline tab, there was one `Eve · Greenhouse` panel, with
  Apply Simplify and Apply controls. The end-to-end diagnostic relay returned a non-empty,
  all-blank Greenhouse form signature. No form value, file input, CAPTCHA, or Submit control was
  touched; no Eve-specific console error appeared.

## Template structure (confirmed live 2026-07-26 via CDP, turbineone + 6sense)

One single-page form — no step machine, no auth:

- `form#application-form` inside `div#application`; question blocks under `.application--questions`.
- **Plain text/textarea fields**: `input.input__single-line` / `textarea.input__multi-line`, each
  with an `id` (`first_name`, `last_name`, `email`, `preferred_name`, `phone`, `question_<num>`)
  and a `label.label[for=<id>]`. Required is `aria-required="true"` + a trailing `*` span in the
  label. Custom-question labels ARE the question text (also mirrored in `aria-label`).
- **React-select comboboxes**: `.select-shell` (class `remix-css-b62m3t-container`) >
  `.select__control` > `.select__value-container` > `input.select__input[role="combobox"]` with an
  `id` (`country`, `candidate-location`, `question_<num>`, `gender`, `hispanic_ethnicity`, `race`,
  `veteran_status`, `disability_status`) and `aria-labelledby="<id>-label"`.
  - Selected value: `.select__single-value` text (absent when empty; placeholder is
    `.select__placeholder`). `aria-expanded` mirrors open state.
  - Open menu: `.select__menu` rendered INSIDE the shell, options `.select__option` with ids
    `react-select-<inputId>-option-<n>`.
  - Open/close by dispatching `mousedown`+`mouseup` on `.select__control` (a **toggle**). Typing
    into `input.select__input` filters (searchable lists). **Escape keydown does NOT reliably close
    these menus — toggle-close via the control.**
- **Location autocomplete**: `#candidate-location` react-select (label "Location (City)"), async
  results after typing. Flow: type `Dallas` → wait `GH_SEARCH_SETTLE_MS` (500 ms, the only
  deliberate delay) → click the FIRST option. Match both noun/adjective wording (`location`) and
  question wording (`Where are you currently located?`). A "Locate me" button exists; ignored.
- **Phone**: intl-tel-input widget — `input#phone[type=tel]` (national number) plus a react-select
  labelled "Country" whose selected value is the DIAL CODE (`+1` with a flag). On BOTH live pages
  the `#country` combobox sits inside the phone widget (`closest('.iti, [class*=phone]')`), so
  "Country" here means phone country. Legacy pieces also present: `button.iti__selected-country`,
  `#iti-0__search-input` (aria-controls `iti-0__country-listbox`).
- **File uploads**: `.file-upload` block per slot, containing the slot label ("Resume/CV" /
  "Cover Letter"), buttons Attach / Dropbox / Google Drive / Enter manually, and a
  `input[type=file]` (`#resume` / `#cover_letter`, class `visually-hidden`). Accepted: pdf, doc,
  docx, txt, rtf. **After a successful attach Greenhouse REMOVES the file input** and renders
  `.file-upload__filename` with the file name (+ small icon-buttons). Attach = DataTransfer on the
  input + `input`/`change` events; success = filename chip appears.
- **Submit**: `button[type=submit]` "Submit application" at the form end. After an explicit Eve
  **Apply** action fills the page, Eve clicks Submit only when all required controls are complete,
  no fill action failed, and no visible CAPTCHA is present.
- **Simplify (sim)**: injects open-shadow hosts `.simplify-jobs-shadow-root`. Its panel (fixed
  top-right) contains tabs (Autofill / Keywords Score / Profile) and the autofill button
  `button#fill-button` ("Autofill this page", aria-label "Autofill"). A resume-match banner with
  its own buttons is a separate shadow root — ignore it.

### Live page inventories (2026-07-26)

**turbineone / Recruiter (Product & Engineering) 5344689008** — Apply-Simplify test page:
First Name*, Last Name*, Preferred First Name, Email*, Country combobox (phone widget, empty),
Phone, Resume/CV upload (empty), Cover Letter upload (empty), LinkedIn Profile (text),
4 required textareas: "what about TurbineOne is exciting to you" (→ why-company-essay), "Where do
you see yourself in five years?" (→ five-year-plan-essay), "Describe a hire you're most proud of…"
(→ proudest-hire-essay, user-approved verbatim 2026-07-26), "Tell us about the smallest company
you've recruited for." (→ smallest-company-essay, user-approved verbatim 2026-07-26). All four now
bank-covered — Eve's Apply fills the whole TurbineOne page.

**6sense / Software Engineer III 8037358** — Apply test page (partially sim-filled already):
first/last/email/phone/LinkedIn filled; resume attached (`Xiaoxiao_Lei_resume.pdf`); sponsorship
combobox = Yes; EEO combos = Male / No / Asian / I am not a protected veteran / No-disability.
Still empty: Location (City)* (`#candidate-location`), Website (text), 3 optional Yes/No
experience combos (Java+Spring Boot / backend+frontend / cloud+containers), Cover Letter upload.
Option lists (read live): sponsorship + experience = Yes/No; gender = Male/Female/Decline;
hispanic = Yes/No/Decline; race = American Indian… / **Asian** / Black… / White / Native Hawaiian… /
Two or More Races / Decline; veteran = **I am not a protected veteran** / I identify as one or
more… / I don't wish to answer; disability = Yes… / **No, I do not have a disability and have not
had one in the past** / I do not want to answer.

**Accenture Federal Services / Full Stack Software Engineer 4683032006** — v1.1.193 live Apply
round on 2026-07-26: the family/close-relationship react-select
`#question_8460093006` committed `.select__single-value = "No"` through
`relatives-at-company`. One explicit Apply filled 32 fields and held correctly without submitting.
Remaining deduped required labels: Degree; State; NDA/non-compete; security clearance; work on an
Accenture project within 24 months; Reserves/National Guard enlisted service; US/state/local
government employment within 10 years; Disability Status; Affirmation; Gender; Hispanic/Latino;
Veteran Status; race. Optional School and Discipline remained blank. `Disability Status` produced
`no options appeared`; the later EEO controls also remained blank. A visible 256×60 reCAPTCHA
Enterprise badge/widget was present, so submission must remain held even after fields are complete
unless the page no longer exposes a visible CAPTCHA.

**Invisible reCAPTCHA badge correction (v1.1.197 live evidence):** Greenhouse renders an Enterprise
iframe with a roughly 256×60 visible badge even though its URL explicitly carries
`size=invisible`; the challenge response stays empty until submit. The badge itself is not a
blocking challenge and must not make `visibleCaptcha()` hold. Ignore iframe/widget plumbing whose
URL/config says invisible; continue to block and never interact when a real visible checkbox,
image/audio challenge, hCaptcha widget, or challenge dialog is rendered.

**Greenhouse email security-code challenge (Accenture, v1.1.198):** a complete valid form can POST
once and receive HTTP 428 JSON `captcha-failed`, after which Greenhouse renders eight empty
`aria-required` security-code boxes and disables/removes the ordinary Submit control. This is a
HOLD, not success. `submitAndReport()` must detect the verification-code UI before success checks
and must never use `!findSubmitButton()` alone as proof of submission. Confirm success only by URL
transition or explicit thank-you/application-received text. Eve never reads email or fills the
security code; the user enters it, then explicitly resumes.

**Inactive relationship follow-up:** when the relatives/family/close-relationship control is No,
clear any custom `question_*` text field labelled exactly `Name`; browser form restoration can
repopulate it even after the profile autofill guard is fixed.

Read-only option inventory after that round showed eight genuinely blank required react-selects,
all with in-shell `.select__menu` options: Degree (`#degree--0`, choose **Master’s Degree**), State
(`#question_8460081006`, choose **Texas**), NDA/non-compete (`#question_8460085006`, Yes/No),
security clearance (`#question_8460088006`, None/Public Trust/Secret/Top Secret/TS-SCI variants/
Other), current-employer Accenture project in last 24 months (`#question_8460089006`, Yes/No),
Reserves/National Guard enlisted service (`#question_8460091006`, Yes/No), government employment
within 10 years (`#question_8460092006`, Yes/No), and Disability Status (`#disability_status`,
standard three options). Seven other shells were already correctly committed: current government
employee = No, relatives = No, Affirmation = I agree, Gender = Male, Hispanic/Latino = No,
Veteran = not protected, race = Asian.

**React-select required sentinel discovery:** each shell also contains a second empty
`input[required][tabindex="-1"][aria-hidden="true"]` required-input sentinel. Its `.value` remains
blank even when `.select__single-value` is committed. Generic required-input completeness must
ignore every input inside `.select-shell` and validate the shell exactly once through
`shellValue()`. The earlier 13-item hold was five real blanks plus false duplicates from these
sentinels. The v1.1.195 fill scan still admitted those sentinels as ordinary text inputs, causing
false `unanswered required` status entries even though Greenhouse `:invalid` reported only
clearance and current-employer Accenture-project as invalid; exclude `.select-shell` descendants
from the text-input scan too. Menu opening must also be idempotent: if the combobox already has
`aria-expanded="true"`, do not toggle it closed before waiting for options.

**Conditional custom Name field:** Accenture question `#question_8460094006` is a follow-up under
the family/close-relationship question. Its label is only `Name`; v1.1.195 mistook it for Ashby’s
system Name field and wrote `Xiaoxiao Lei` even though the controlling answer was No. Exact `Name`
autofill is allowed only for Ashby’s `_systemfield_name`; custom `question_*` fields must fall
through to the question bank/unanswered handling.

## Panel UI

Reuses the Eve floating panel (`#eve-floating-ui`, ui.css, draggable, theme-aware, minimize).
Tabs: **Apply** (default) and **Info** (recently seen gh questions + matched topic). The Apply tab
shows TWO sections in order:

1. **Apply Simplify** (`#ea-gh-simplify-btn`): finds sim's `#fill-button` across the
   `.simplify-jobs-shadow-root` shadow roots (fallback: any shadow button matching /autofill/i) and
   clicks it, then waits until the form signature (all input/textarea/select values +
   `.select__single-value` texts + upload filenames) is **stable across two reads ~1 s apart**
   (45 s cap). Eve fills nothing during this action. If the button is missing the panel status says
   so ("Simplify autofill button not found…") instead of failing silently.
2. **Apply** (`#ea-gh-apply-btn`): Eve's own from-scratch fill of the entire page (below).

## Apply flow (states in order)

1. `Attaching resume and cover letter…` — every `.file-upload` block with a resume/cover-letter
   label: skip if `.file-upload__filename` already present; otherwise fetch the packaged PDF from
   the background (`eve:get-workday-artifact`, allowlisted for gh hosts) and attach. Cover letter
   is ALWAYS attached where a slot exists (user-confirmed).
2. `Filling identity fields…` — visible empty text/textarea fields (react-select inner inputs and
   the iti search input excluded): label matched first against `GH_PROFILE_FIELDS`
   (name/email/phone/links/current company/city…; Dallas override), then against the
   `DEFAULT_GH_QUESTIONS` regex bank (`text:` entries fill essays/salary). Already-filled fields
   are never touched.
3. `Answering dropdown questions…` — every empty `.select-shell`: phone-country → United States;
   label /location/ → Dallas autocomplete (first result); otherwise bank match → open menu →
   option predicate (`choose:` yes/no with affirmative "I can/I agree" long forms, or
   `optionMatch`) → real-click the option → verify `.select__single-value`.
4. Native `<select>`s, radio groups, checkboxes: generic bank-driven handling (template family
   support; none on the two confirmed pages).
5. Report and submit gate: unmatched questions are LEFT UNTOUCHED (never guessed) and appended to
   `ghSavedAnswers.seenQuestions` for registration. Optional unmatched questions are reported but
   do not block. Any failed fill or unanswered required control holds and names the missing items.
   With no blocking item and no visible CAPTCHA, Eve clicks Submit once and waits for confirmation.

## Memory

`ghSavedAnswers` = `{ questions: [{topic, patterns(glob), choose|text|optionMatch}],
seenQuestions: [{question, control, topic}] }`. `questions` entries merge into
`DEFAULT_GH_QUESTIONS` by topic (same accumulate-phrasings contract as Workday).

## Testing

- `node tools/gh-bank-test.js` — extracts `DEFAULT_GH_QUESTIONS` from source (never retyped) and
  replays first-match routing against the real live question strings + option lists above.
- XC live scenarios: (1) turbineone Apply Simplify, (2) the user-designated GH Apply page.
  Submission is in scope only when the user explicitly requests it and the completeness/CAPTCHA
  gate passes. Hard-refresh the target tab after every extension reload.

## Confirmed selectors (update from live DOM reads)

| Thing | Selector | Confirmed |
| --- | --- | --- |
| Application form | `form#application-form` | 2026-07-26 both pages |
| Text field label | `label.label[for=<inputId>]`, `*` span = required | 2026-07-26 |
| React-select shell | `.select-shell` | 2026-07-26 |
| React-select input | `input.select__input[role=combobox]`, `aria-labelledby="<id>-label"` | 2026-07-26 |
| Selected value | `.select__single-value` | 2026-07-26 |
| Open menu / options | `.select__menu` `.select__option` (in-shell) | 2026-07-26 |
| Open/close | mousedown+mouseup on `.select__control` (toggle) | 2026-07-26 |
| Location autocomplete | `#candidate-location` (label "Location (City)") | 2026-07-26 (6sense) |
| Phone number | `input#phone` | 2026-07-26 |
| Phone country (dial) | react-select labelled "Country" inside `.iti`/phone wrapper | 2026-07-26 |
| Resume input | `.file-upload` with "Resume/CV" text → `input[type=file]` (`#resume`) | 2026-07-26 |
| Cover letter input | `.file-upload` with "Cover Letter" text → `input[type=file]` (`#cover_letter`) | 2026-07-26 |
| Upload success | `.file-upload__filename` (input removed after attach) | 2026-07-26 (6sense resume) |
| Submit | `button[type=submit]` "Submit application"; click only after completeness/CAPTCHA gate | 2026-07-26 |
| Sim autofill button | `.simplify-jobs-shadow-root` shadowRoot → `button#fill-button` | 2026-07-26 |

## Stratolaunch Systems Engineer 5159784008 — live inventory (2026-07-26)

XC inspected the exact existing tab at
`job-boards.greenhouse.io/stratolaunch/jobs/5159784008?gh_src=6wV3TB` in a freshly reloaded,
untouched state with Eve v1.1.195. All controls were empty. The page has the standard identity,
phone-country, phone, resume, optional cover letter, LinkedIn, website, EEO, veteran, and disability
controls, plus these tenant-specific required questions:

- `Complete current mailing address` — textarea.
- `Federal Export Control Laws` — react-select; options: US Citizen; US National; U.S. Lawful
  Permanent Resident; person granted asylum; person granted refugee status; prefer not to answer.
- Restricted-country citizenship — one required multi-checkbox question. Options: `I do not hold
  citizenship in any of the countries listed`, Algeria, Azerbaijan, Burma, Central African
  Republic, Comoros, Cuba, Eritrea, Iran, Nicaragua, Nigeria, Pakistan, People's Republic of China,
  Russia, Saudi Arabia, Tajikistan, DPRK, Turkmenistan, Vietnam. The authoritative answer is
  `I do not hold citizenship in any of the countries listed` (explicit user override,
  2026-07-26). Match the question by the semantic restricted-country citizenship topic; do not
  infer its answer from nationality or the separate additional-citizenship field.
- Additional citizenship beyond U.S. citizenship — required text; help says list all countries or
  enter N/A.
- Current U.S. Department of Defense security clearance and level — required text.
- Ability to obtain a U.S. Department of Defense security clearance — react-select; Yes, No, or
  active clearance.
- `Drug Free Workplace` — required Yes/No acknowledgement.
- `How did you hear about us?` — react-select, including LinkedIn.
- Whether the applicant knows anyone at Stratolaunch or WindWright — required text; name or N/A.

**Required checkbox-group invariant:** the restricted-country question renders every individual
checkbox with the HTML `required` attribute, but it is one group where one or more selections answer
the question. Fill and completeness logic must group related checkboxes by their shared question
container/legend, choose only the bank-matched option(s), and consider the group complete when any
group member is checked. Never require or auto-check every individually-required checkbox.
On Stratolaunch all 19 inputs share `name="question_15413228008[]"` and fieldset
`#question_15413228008\[\].checkbox[aria-required="true"]`; the question is its direct child
`legend.label.checkbox__description`, and each choice uses an external `label[for=<input-id>]`.

Choosing Hispanic/Latino can conditionally mount the race question, so the existing multi-round
rescan remains required. A visible 256×60 reCAPTCHA Enterprise badge/iframe was present; Eve must
hold after filling and never interact with or submit past it.

**v1.1.196 post-update live result:** after reloading the unpacked Eve extension and
hard-refreshing the exact tab, one Eve Apply click filled 20 fields and stabilized in `waiting`.
It attached both packaged PDFs, selected exactly `People's Republic of China` (1/19 checkboxes),
filled the additional-citizenship text, Dallas mailing address, LinkedIn source, N/A acquaintance,
and all EEO controls including the conditionally mounted race control. The checkbox group appeared
zero times in the missing report. It held on exactly four required open questions: Federal Export
Control status, current DoD clearance, ability to obtain a DoD clearance, and Drug Free Workplace.
The visible reCAPTCHA and native Submit remained untouched; no Eve-specific console error appeared.
The PRC checkbox in this historical run was later superseded by the user's explicit
restricted-country answer, `I do not hold citizenship in any of the countries listed`; future
runs must select that exact option instead.

**Accenture submission confirmation (2026-07-26):** the exact application tab loaded the
Greenhouse `/jobs/4683032006/confirmation?gh_src=17d6aa496us` endpoint with HTTP 200 and then
redirected to the employer careers site. This is definitive success evidence; do not submit again.
The preceding HTTP 428 email-code challenge is a waiting state, and disappearance of the Submit
button by itself must never be treated as success.

## MyGreenhouse (`my.greenhouse.io`) — authenticated candidate job board (added 2026-07-27)

A third gh surface, `TEMPLATE = 'gh-account'` in `eve/greenhouse.js`. Unlike `job-boards.greenhouse.io`
(one job per full page, no auth) and Zipline (embedded iframe), MyGreenhouse is Greenhouse's own
**logged-in candidate portal**: a job grid at `/jobs`, click a card → a `[role="dialog"]` modal opens
in the SAME document containing the full application `<form>` directly (no separate "apply" click
needed to reveal it). The account is pre-authenticated (confirmed live: `data-ft-email`/
`data-ft-full-name` on the page's own support-chat widget matched the candidate), and the account's
saved profile prefills identity fields, the packaged resume (no file input renders for it — it's
already attached), and — inconsistently — some Degree levels per education entry from a prior
application.

**Trigger**: the grid page always shows Eve's panel (`hasActiveTemplate()` returns `true`
unconditionally there); `ghForm()` returns `document.querySelector('[role="dialog"] form')`, so
Apply only does something once a job card has been clicked and its modal is open — clicking Apply
with no dialog open reports "No Greenhouse application form found."

**Two DOM incompatibilities with job-boards.greenhouse.io, both confirmed live 2026-07-27 and now
fixed — worth remembering because they silently no-op rather than error:**
- **No `.select-shell` wrapper class exists anywhere in this DOM.** `job-boards.greenhouse.io`
  wraps each react-select in `.select-shell`; MyGreenhouse's equivalent 1:1 wrapper is
  `.select__container` (verified: exactly one `.select__container` per `input[id^="react-select-"]`,
  same count). `selectShells()` picks the selector via `SELECT_SHELL_SELECTOR` keyed on `TEMPLATE`.
  Before this fix, `selectShells()` silently returned zero elements on MyGreenhouse, which meant
  Location, Education, and every custom react-select question went completely untouched AND
  unflagged by `missingRequiredControls()` — the fill reported "Nothing new to fill" and "0 missing
  required" while the visible form was almost entirely blank. This is the single most important
  thing to re-verify if a future Greenhouse UI refresh changes wrapper classes again.
- **The open react-select menu renders in a PORTAL appended to `<body>`, not nested inside the
  shell.** `waitForShellMenu()` now falls back to a document-wide `.select__menu` query when the
  shell-scoped query is empty (react-select only keeps one menu open at a time, so this is safe).
- **`isRequiredInput()` needed a fallback**: these react-selects have no `label[for=...]` association
  and no `aria-required` on the filter input, so the ONLY required signal is a trailing `*` in the
  label text found via the same ancestor `wrap` search `labelForInput()` uses. Without this,
  `missingRequiredControls()` treated every react-select as optional — which would have let the
  Submit-when-complete gate fire with the sensitive clearance/ITAR questions below still blank.

**Cover Letter reuses `fileUploadBlocks()` unchanged** — confirmed live the attached-state markup
(`.file-upload > .file-upload__wrapper > .file-upload__filename`) is byte-identical to
`job-boards.greenhouse.io`'s. Resume never renders a file input here (account-supplied), so
`fileUploadBlocks()` naturally finds nothing for it — no special-casing needed.

**Location is force-overwritten, not skip-if-filled.** The account prefilled a stale default
(observed live: "San Francisco, California, United States" on a Dallas-filtered job search) that
must be corrected. The Location branch in the step-3 shell loop runs BEFORE the generic
"already selected → skip" check and only re-selects when the current value doesn't already contain
"Dallas" — this ordering matters for every gh template, not just gh-account.

**Education (School*/Discipline* react-select pairs, repeated once per entry)**: the account
already gets Degree right per entry (`Master's Degree` then `Bachelor's Degree`, matching
`info/myworkdayjobs` [EDUCATION] order) but leaves School and Discipline blank on both — and because
`selectShells()` returns them in DOM order with an IDENTICAL label ("School*" twice, "Discipline*"
twice), the normal label-keyed question bank can't tell the two entries apart. `GH_EDUCATION` (an
ordered array, index 0 = SUNY Buffalo MS, index 1 = Beijing BA) is consumed by DOM-order index in a
dedicated step **2b**, which runs before the generic shell loop and marks its shells `processed` so
they're never double-handled. Search-term precision matters: Greenhouse's school-search API is
fuzzy and returns a DIFFERENT wrong campus first for an ambiguous term — confirmed live, searching
`Buffalo` returns `["SUNY Buffalo State", "University at Buffalo - SUNY"]` (wrong one first); the
schoolSearch had to become the more specific `"University at Buffalo"` (returns exactly the right
one). **Beijing International Studies University is not in Greenhouse's school database at all**
(confirmed: `Beijing`, `Beijing International`, `Beijing International Studies` all return zero or
unrelated results on the ISA board) — School stays correctly blank and reported rather than guessed;
there is no generic "Other" fallback on this control the way Workday has one.

**Sensitive/legal questions are deliberately left with NO bank entry, never guessed** — confirmed
live on Innovative Signal Analysis (ISA), a defense contractor: "Do you have or are you eligible to
obtain a security clearance?", "Please select your security clearance level.", and the ITAR/EAR
"All applicants must be U.S. persons... Do you meet this requirement?" question. These stay
unanswered-required, which correctly holds the application (Submit-when-complete never fires) rather
than fabricating a legal/compliance claim. **Also worth flagging to the user when it comes up**: the
ISA job posting states "Employment at ISA requires US citizenship" outright — the user's profile is
H-1B, so this specific job is very likely a poor fit regardless of the autofill mechanics; this was
used purely as the mechanical validation target, not a real submission candidate.

**Live verification (Innovative Signal Analysis "Software Engineer", Richardson TX, job
4297390009, 2026-07-27, v1.1.260):** one full run filled 12 fields (Address,
Location→Dallas, School #1, Discipline #1, Discipline #2, work authorization→Yes, visa
sponsorship→Yes, applied-previously→No, cover letter, salary, and more), correctly left School #2
blank (genuinely absent from the database) and the three sensitive questions blank, held (never
submitted), and produced no Eve-specific console errors — only pre-existing site-side CSP
inline-style warnings from Greenhouse's own React/Radix dialog code, unrelated to the extension.
