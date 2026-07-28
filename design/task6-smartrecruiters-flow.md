# SmartRecruiters ("sr") Easy Apply Flow — Task 6

Eve's autofill-only adapter for the SmartRecruiters "oneclick-ui" Easy Apply template. Anchor
domain: `jobs.smartrecruiters.com` (extensible `SR_HOSTS` list in `eve/smartrecruiters.js`, plus a
`content_scripts`/`host_permissions` entry in `eve/manifest.json` and the artifact allowlist in
`background.js` — one line each per new host).

Implemented in **`eve/smartrecruiters.js`**, first shipped
v1.1.235, live-verified end-to-end v1.1.237 on Kohr Consulting "Software Engineer" (Seattle, WA),
job `e8aaac64-395c-46f0-9202-3c5a948e7a8d`, 2026-07-27. Isolated from LinkedIn/Workday/gh/Indeed:
runtime memory lives in the **`srSavedAnswers`** chrome.storage key only (a lightweight seen-log —
this template has no arbitrary employer screening questions, so there is no regex question bank).

## Scope: autofill only, never submit (user, 2026-07-27)

The user's request was explicitly "autofill", not "apply" — unlike gh/Indeed, T6 does **not**
click Submit under any condition. Eve fills every field it can from the answer bank and leaves the
page in a submit-ready state for the user to review (especially the parser-derived Experience/
Education entries and the optional Message to the Hiring Team) and submit themselves.

## Template structure (confirmed live 2026-07-27, Kohr Consulting)

A **single-page form**, no step machine, no auth. Built from SmartRecruiters' "SPL" design-system
web components (Angular), most of which render their real `<input>`/`<textarea>`/`<button>`
**inside a shadow root**, using the SAME `id` as the light-DOM host element — e.g.
`<spl-input id="first-name-input">` wraps `<input id="first-name-input">` in its own shadow root.
**Every DOM lookup must be shadow-piercing** (`deepQueryAll`/`deepGetControl` in
`smartrecruiters.js`): a plain `document.getElementById()` only reaches the light-DOM wrapper, and
calling the native value setter on that wrapper throws `Illegal invocation`.

Sections top to bottom:
1. **Easy Apply** — a resume dropzone that triggers SmartRecruiters' own resume PARSER
   (`POST .../resume/parse`), which prefills Personal Information, Experience, and Education. Also
   an "Apply With Indeed" external-auth button (never touched — out of scope, a different provider
   entirely). Confirmed live: uploading here reliably populates first/last name, email, phone, and
   full Experience/Education entries (with all bullet text) from the packaged resume — Eve does not
   need its own Experience/Education "Add entry" logic for the common case.
2. **Personal information** — `first-name-input`, `last-name-input`, `email-input`,
   `confirm-email-input` (required, plain inputs); `spl-form-element_10` (City, `spl-autocomplete`,
   optional — no red-asterisk marker in this or subsequent live checks); `spl-form-element_13`
   (phone country code, `spl-select` button, left at its page default — already United States
   (+1) on the live US-based job); `spl-form-element_5` (phone number, plain input).
3. **Experience** / **Education** — parser-populated list entries with Edit/Delete controls, no
   "required" marker. Eve does not click "Add" in v1 (the resume parser already covers the
   documented history); revisit only if a future job shows these empty after resume parse.
4. **Your Profiles** — `linkedin-input`, `facebook-input`, `twitter-input`, `website-input` (all
   optional plain inputs). Eve fills LinkedIn (WITHOUT the `https://` prefix — the project-wide
   rule) and Website (GitHub); Facebook/X are left blank (no bank value).
5. **Resume** — a second dropzone, separate DOM node from the Easy Apply one but with the same
   `accept` list and the same `id="file-input"` (scoped to its own shadow root — duplicate ids
   across independent shadow roots are legal). Eve attaches the packaged resume to **every**
   file input whose `accept` list matches `.pdf` (currently both dropzones), so both the Easy Apply
   parser slot and the formal Resume slot end up filled from one artifact fetch.
6. **Message to the Hiring Team** — optional free-text `hiring-manager-message-input`. Left blank;
   no safe generic bank value exists for this and it is not required.
7. **Consent checkbox** (`id="noPolicy"`) — SmartRecruiters' standard data-processing notice,
   required to submit. Eve checks it as part of autofill.
8. **Submit** — never clicked by Eve (see Scope above).

## Field-fill sequencing and the resume-parser race

`runSrAutofill()`: attach resume to both dropzones → **wait 2.5s** for the parser to finish
prefilling Personal Information/Experience/Education → fill remaining text fields (skips any field
the parser already filled — parser output always wins, Eve never overwrites a non-empty value) →
City → Phone number → consent checkbox. This ordering matters: everything that can be answered by
the parser is left to it, and Eve only fills the gaps.

## City autocomplete: known live flakiness (open item)

`spl-form-element_10` (City) is a real, working autocomplete — typing "Dallas" hits
`GET /oneclick-ui/api/location/autocomplete?q=Dallas` and the results render as
`<spl-select-option>` items inside a light-DOM `<div slot="menu" id="menu-<inputId>">` (this menu
container is NOT inside a shadow root, so a plain `document.getElementById` reaches it once
rendered). **Confirmed live 2026-07-27**: on a cold/fresh page with nothing else running, the menu
renders in under 1s. When City fill runs (as designed) right after the resume-parser's big
DOM re-render of the new Experience/Education lists, rendering the suggestion menu has been
observed to take several seconds longer — and in two consecutive live full-flow runs (v1.1.236,
v1.1.237, with a 10s poll budget) it did not render inside that budget at all, even though the
network request itself returned successfully (`304`, cached) within ~1s both times. Root cause is
still open — most likely Angular change-detection contention from the simultaneous
Experience/Education list mutation, possibly compounded by this site's DataDome bot-detection
layer adding request latency under rapid programmatic interaction. Eve **never guesses** a city
outside the real suggestion list, so the field is simply left blank and reported as
"needs manual attention" when this happens — safe, since City carries no required-field marker in
either live check and does not block submission. Future iteration: try triggering the fetch
earlier (in parallel with the resume-parser wait, before the DOM churns) instead of after it.

## Packaged artifact

Reuses the same allowlisted background message as Workday/gh/Indeed
(`eve:get-workday-artifact`, `artifactId: 'resume'`), gated by `SR_ARTIFACT_HOSTS =
['jobs.smartrecruiters.com']` in `background.js`'s `isArtifactTabSender()`. No cover-letter slot
exists on this template.

## Live verification (Kohr Consulting "Software Engineer", 2026-07-27)

Two consecutive fresh-page full-flow runs (v1.1.236 pre-fix, v1.1.237 post City-timeout-fix) both
confirmed: resume attached to both dropzones; parser-populated Experience (J.P. Morgan Chase & Co.,
Associate Software Engineer, full bullet history) and Education (SUNY Buffalo MS, Beijing
International Studies University BA) exactly matching `info/myworkdayjobs`; identity fields
(name/email/phone) parser-filled and correctly left untouched by Eve; `confirm-email-input`,
`linkedin-input`, `website-input`, and the consent checkbox filled by Eve; Submit never clicked; no
console errors. City is the one open gap (see above).
