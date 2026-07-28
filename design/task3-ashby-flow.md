# Ashby ("cape") Apply Flow — Task 3 extension

Eve support for the Ashby application template, shipped v1.1.192 inside the same content script as
Greenhouse (`eve/greenhouse.js`, template adapters keyed by host/DOM).

## Architecture

- **Hosts** (extensible one-liners): `ASHBY_EMBED_HOSTS = ['www.cape.co', 'cape.co']` (top-level
  pages that embed the form) and `ASHBY_FORM_HOSTS = ['ashbyhq.com']` (the base domain and every
  subdomain, including `jobs.ashbyhq.com`, where the form currently lives).
  Manifest: `https://www.cape.co/*` (top frame, panel) and `https://*.ashbyhq.com/*` with
  **`all_frames: true`** (engine).
- **TEMPLATE modes** in greenhouse.js: `gh` (panel + engine, one document), `ashby-host` (cape
  top-level: panel only), `ashby-frame` (`*.ashbyhq.com`: engine; panel too when it is the top
  window — direct Ashby pages get both locally).
- **Cross-origin coordination** via the Eve background SW (`eve:`-prefixed): panel →
  `eve:ashby-run-apply` → background relays `eve:ashby-frame-apply` to all
  frames of the sender tab → the Ashby frame runs the fill and responds with the final status.
  Progress: frame `setStatus` also emits `<ns>:ashby-status` → background broadcasts
  `<ns>:ashby-status-update` → panel renders it. Diagnostic signatures use
  `<ns>:ashby-signature` → `<ns>:ashby-frame-signature` (the form is unreadable cross-origin from
  the panel).
- **Artifacts**: same `<ns>:get-workday-artifact` message; the allowlist now checks BOTH
  `sender.url` (jobs.ashbyhq.com frame) and `sender.tab.url` (cape.co page).

## Ashby template structure (confirmed live 2026-07-26, Cape FDE iframe via CDP)

- No wrapping `<form>`; fields sit in `._fieldEntry_* / .ashby-application-form-field-entry`
  containers (engine scopes to `document.body` when entries exist).
- System fields: `input#_systemfield_name` ("Name", required — takes the FULL name),
  `input#_systemfield_email` ("Email", required), `input[type=file]#_systemfield_resume`
  ("Resume", required).
- **"Autofill from resume" trap**: the FIRST file input (no id) belongs to Ashby's own resume
  parser and would overwrite fields — matched by container text /autofill from resume/i and NEVER
  touched.
- **Resume acceptance (live Commonware 2026-07-27)**: setting `#_systemfield_resume.files`
  immediately creates a browser-only `C:\fakepath\...` value, but that does not mean Ashby
  accepted the upload. Only visible filename UI in the field entry (the state that also exposes
  Replace/Delete) is confirmation. `attachArtifact()` waits for that UI before returning success;
  completeness uses the same visible confirmation and never trusts `input.files`.
- Custom text questions: `input#<uuid>` with `label[for=<uuid>]` (e.g. "If you have a LinkedIn
  profile, please add it here." → scheme-less LinkedIn value).
- **Radio groups**: `input[type=radio]` with `name = "<sectionUuid>_<questionUuid>"`, ids
  `..._<questionUuid>-labeled-radio-<n>`, value="on". The QUESTION label is
  `label[for=<questionUuid>]` (the bare uuid = last `_`-segment of the radio name); each radio's
  own `label[for=<radioId>]` is the option text. `radioGroupLabel()` implements this.
  No required markers on radios → on Ashby ANY unanswered radio group counts as missing for the
  completeness check (errs toward holding).
- **Segmented Yes/No groups** (live Ramp 2026-07-27): the field entry contains two exact-text
  buttons, `Yes` and `No`, plus an invisible backing `input[type=checkbox]`. The selected button
  gains an `_active_*` class and the hidden checkbox becomes checked. These are enumerated as
  button groups, matched against the question bank, clicked by visible option text, and considered
  complete only when a button is active. Post-fix screenshot confirmation: both Ramp questions
  ("based in NYC or SF or willing to relocate" and future employment-visa sponsorship) visibly
  selected **Yes**.
- **Multi-checkbox groups** (pronouns screenshot 2026-07-27): use the enclosing Ashby field entry
  as the group boundary before input `name`, because sibling options can have distinct names.
  Read the question from that entry and choose the bank-matched label; "What are your pronouns?"
  selects **He / Him / His**.
- **Buttons: ALL are `type="submit"`** ("All Jobs", "Upload File", …) — the submit control is
  matched by TEXT: /^submit( application)?$/i ("Submit Application").
- **reCAPTCHA**: invisible v2 (0×0 `recaptcha.net/api2/anchor` iframe + hidden
  `textarea[name=g-recaptcha-response]`). Excluded from filling and from completeness. A captcha
  only blocks submission when it renders a VISIBLE widget (>50×50); if one appears (including
  post-submit challenge), status = "blocked by captcha" and Eve stops.
- A direct Ashby job can open on the selected **Overview** tab while **Application** is unselected
  (`a[role=tab]`, exact text `Application`, stable `/application` href). Eve Apply clicks that tab,
  waits for the form, and continues the same pass. Embedded description views use the exact
  **Apply for this Job** control as fallback.

## Cape question routing (banked, verified in tools/gh-bank-test.js)

- 6-option work-authorization status picker → `work-auth-status-select` (ordered
  `optionCandidates`: H-1B/temporary-visa transfer > bare H-1B > authorized-now-sponsor-later;
  never citizen, never "require new sponsorship to begin").
- "Do you have unrestricted work authorization…" (2 radios) → `unrestricted-right-to-work` → the
  No option.
- Hybrid 2- or 3-option office radios → `relocation-hybrid` → first "I can …" option (New York
  default per bank).
- Ramp direct Ashby (live 2026-07-27): "Where do you plan to work from?" with options NYC /
  Remote / Open to relocating to NYC → `planned-work-location-nyc` → **Open to relocating to
  NYC**, consistent with the user's existing Dallas + NYC-relocation preference.

## Location typeahead + human pacing (user rules, 2026-07-27 — gh and ash share these steps)

**Location field (`ash`, confirmed live on the OpenAI board 2026-07-27).** Field entry
`[data-field-path="_systemfield_location"]`, label "Where are you currently located?" / "Location",
control `input[role="combobox"][aria-autocomplete="list"]` with a chevron toggle button. The
control has **no id, no name and no aria-label** — the enclosing field entry is the only label
source (`labelForInput` now looks there), and its required marker is the `_required_*` class on
that label, not a `required` attribute.

The suggestion list renders in a **portal at `document.body` level**, never inside the field entry:
`._floatingContainer_* > ._resultContainer_* > ._result_*` (the first result carries `_active_*`).

Flow — `fillTypeaheadCombo()`, the only correct one: **click the input → type `Dallas` → wait
0.5 s → CLICK the first suggestion → verify the input now holds the picked text → click away.**
Typing alone leaves the widget uncommitted and the field submits EMPTY, which is why an empty
required typeahead is also counted by `missingRequiredControls()`. Live result: 5 suggestions,
first `Dallas, Texas, United States`, committed.

**Ordering and pacing (user, 2026-07-27).**
1. Files → **all plain text fields** → typeahead comboboxes → dropdowns → radios → segmented
   Yes/No → checkboxes. Texts are filled before any click-selection.
2. Every TEXT field goes through `fillTextField()`: **click the field → type → click away onto
   empty space → 0.5 s**, then the next field. Without the click-away, a filled required field was
   still counted as empty by the page's own validation.
3. Every SINGLE selection goes through `afterSelection()`: **0.5 s → click away → 0.5 s**, so
   choices are never clicked back-to-back. `GH_SELECTION_SETTLE_MS = 500`.
4. `clickAway()` dispatches the pointer/mouse sequence directly on `<body>`, so no other control
   can be hit. Mirrored into `eve/indeed.js`, `eve/smartrecruiters.js` and `eve/workday.js`
   (T2–T6 share this behaviour; T1/LinkedIn is untouched).

## Submit-when-complete (both templates, user 2026-07-26 — supersedes hold-always)

After the fill rounds: `missingRequiredControls()` (required/aria-required + gh label asterisk;
file slots need a visibly confirmed filename; Ashby radio and segmented groups must be answered). If anything is missing or
unmatched/failed → **"Filled, held: N missing required: …"**. Else if a visible captcha →
**"Filled, blocked by captcha"**. Else blur through a safe blank-area click, click Submit, and if
the form plus an enabled Submit control remain with no confirmation/security-code/CAPTCHA gate,
repeat the blank-area click and Submit once. Poll up to 20 s for URL/thank-you confirmation or
report visible form errors.

## Singleton-required rule (both templates)

A REQUIRED dropdown (react-select or native) whose option list holds exactly ONE real option
(placeholders excluded via `OPTION_PLACEHOLDER`) is selected outright with no bank match — counted
as filled ("(only option)"). Runs before a question is declared unmatched.

## XC notes

- Panel on `www.cape.co/job-listing?...` shows "Eve · Ashby vX". Apply relays into the iframe;
  status streams back. There is no Simplify action or dependency in the Task 3 adapter.
- The panel height follows the active tab's content up to the viewport cap. Its right-edge handle
  resizes width horizontally and persists the selected width.
- Live Ramp Ashby pages can impose `line-height: 0` on inherited panel typography. Eve explicitly
  sets the header/title/version line heights; v1.1.227 verification measured the title at 19px high
  instead of the broken ~1px box, with **Eve · Ashby** fully visible.
- The designated clean Cape tab: FDE (`ashby_jid=cc18572e…`, `utm_source=Simplify`).
- WARNING: with submit-when-complete live, an Apply run on any fully-completable form WILL submit
  (Cape may still stop at the captcha; gh pages use invisible captcha and will go through).
