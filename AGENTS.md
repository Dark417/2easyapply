# Agents

This `AGENTS.md` is the root instruction file for every AI agent working in this project. All
agents and skills share it alongside the `.ai/` directory.

- **Agent neutrality**: the AI agent may be Claude Code, Codex, Gemini, or any other CLI/agent.
  All of them follow the same rules, routing, skills, and safety boundaries defined here and in
  `.ai/`. "X", "XC", "lead-architect", and every skill are role definitions, not tool-specific.
- **Load order**: read this file first, then the specific `.ai/agents/*` / `.ai/skills/*` file for
  the role or skill in play. `CLAUDE.md` at the repo root simply imports this file.

## Minimal-language contract (terse commands)

The user deliberately writes short commands. **A terse message never waives the standing rules** —
every rule in this file, `.ai/`, and the answer bank applies in full without being restated.
Interpret input by this map; when input matches none of it, treat it as a normal request.

| User says | Means | Route |
|---|---|---|
| `work on <url>` | Run the full test→fix→reload→retest loop on that tab | agent X; task by URL (T1–T6) |
| `<question>: <answer>` | Bank this Q&A (pattern, not literal) and apply it to the fixed working tab | `add-question` |
| `add <q>` / `save <q>` / pasted form text / screenshots | Bank the question(s): pattern for question AND answer | `add-question` |
| `+<text>` / `++<text>` | Append `<text>` as a durable rule in `AGENTS.md` (and memory) | `update-agents` |
| `+info <fact>` | Append the fact/answer to `info/myworkdayjobs` and usually the code bank | `update-info` |
| `test <url or step>` | Drive the live page, report state, change no code | `test-page` |
| `lk` | Run LinkedIn Easy Apply automation from `params` | `lk` |
| `lk search` | Open the LinkedIn search tabs | `linkedin-job-search` |
| `gh` | Greenhouse (T3) context: `job-boards.greenhouse.io`, `my.greenhouse.io` | T3 |
| `ash` | Ashby context — same T3 adapter and steps as gh | T3 |
| `kf` | Kforce (T7) context: `www.kforce.com` detail page → Apply Online form | T7 |
| `orc` / `oracle` | Oracle Careers (T8) context: `careers.oracle.com` search list, OCI scan, applied sync | T8 |
| `unified bank on` / `off` | Flip the beta shared-bank flag `eveUnifiedBank` in extension storage | see Unified question base |
| `migrate abby` | Execute `design/abby-migration.md` (re-point done by user first) | see Extension directories |

Standing interpretation rules:

- **One chat = one fixed working tab.** A bare `question: answer` or "the page" refers to that tab.
- Pasted application text or a screenshot of questions is an **implicit `add`** — no verb needed.
- Screenshot with an answer already selected → that answer is authoritative. Without one → reason
  the best-fit answer from the user's info (see Best-fit reasoning).
- Every "save/add" stores a **pattern family**, never the literal string (see `add-question`).
- Plain-text bank additions may be delegated to a Sonnet subagent; screenshots and engine code
  changes stay with the main model.

## Roles

- **`lead-architect`** — oversees architecture, coordinates agents, validates progress.
- **`lead-product`** — turns rough intent into explicit workflows (`refine-task`), maintains
  `design/task1-auto-flow.md`.
- **`staff-engineer-x` (X)** — autonomous implementation orchestrator for extension/browser work.
  Owns decomposition, code, small decisive test plans, delegation to XC, fixes, and progression
  only after the current flow slice passes.
- **`chrome-tester-agent` (XC)** — live browser tester delegated by X. Runs as a **separate spawned
  agent on the Sonnet model**. Must first verify a browser MCP is actually connected; if not, the
  verdict is **BLOCKED (Chrome MCP off)** — never a fabricated run. Tests only the requested
  scenarios on the user-designated tab, returns evidence, edits no production code.

## Standing skills (every chat)

Run in this order at the start of every chat, then as events require:

1. **`update-agents`** — does this input change any instruction/routing? Apply it.
2. **`update-info`** — does this input contain user personal/application info? Bank it.
3. **`update-instructions`** — promote reusable process/selector/flow discoveries into the right
   doc (also after every XC test round).
4. **`chat-log`** — prepend the round to `msg-log.md`.

`work-on-page` → `add-question` → `test-page` is the shared stuck-step loop for the platform tasks.

## Tasks (six orthogonal workflows)

Six parallel, non-blocking tasks; work in one never gates another. `work on <url>` scopes to the
task the URL belongs to. (T3 "Apply with sim" was retired 2026-07-27; Greenhouse moved into the T3
slot; the gap at T4 is deliberate.)

- **T1 — LinkedIn Easy Apply** (`eve/content.js`, `linkedin-job-search`, `lk`): search, card
  controls, Easy Apply modal loop, checkmark tracking, `savedAnswers` / `savedRegexAnswers`.
- **T2 — Workday** (`*.myworkdayjobs.com`; `eve/workday.js`, `design/task2-workday-flow.md`): the
  extension owns the step machine; fixes are code + regex bank; every round bumps + reloads.
- **T3 — Greenhouse/Ashby ("gh"/"ash")** (`eve/greenhouse.js`, `design/task3-gh-flow.md`,
  `design/task3-ashby-flow.md`): from-scratch template flow like Workday's on
  `job-boards.greenhouse.io`, `my.greenhouse.io`, `*.ashbyhq.com`, and registered embed hosts
  (Zipline). Template-driven detection; host list extensible.
- **T5 — Indeed Smart Apply** (`smartapply.indeed.com`; `eve/indeed.js`,
  `design/task5-indeed-flow.md`): per-step state machine over the wizard. Submit-on-complete at
  Review when every required field is verified filled; never click Submit twice; never touch a
  CAPTCHA. Runtime memory `indeedSavedAnswers`. `DEFAULT_INDEED_QUESTIONS` is spliced verbatim
  from greenhouse.js's `DEFAULT_GH_QUESTIONS` by `tools/sync-indeed-bank.js` — edit shared topics
  in greenhouse.js and run the sync tool.
- **T6 — SmartRecruiters** (`jobs.smartrecruiters.com`; `eve/smartrecruiters.js`,
  `design/task6-smartrecruiters-flow.md`): shadow-DOM SPL components — every lookup must be
  shadow-piercing (`deepQueryAll`/`deepGetControl`). **Autofill-only, never submit.** The packaged
  resume triggers SmartRecruiters' own parser; Eve fills only the gaps the parser leaves and never
  overwrites a parser-filled value. Runtime memory `srSavedAnswers` (seen-log only).
- **T7 — Kforce ("kf")** (`www.kforce.com`; `eve/kforce.js`, `design/task7-kforce-flow.md`):
  detail page `#TK_WIDGET_INITIATOR` (Apply Today) → `.TK_WIDGET[rel="form"] a` (Apply Now,
  never "Apply With Indeed") → POST navigation to `/Jobs/<id>/ApplyOnline/` → fill identity/
  state/zip from the profile → packaged resume via `#uploadFileSystemResume` ("From this
  computer") → Employment Eligibility = `eligibility1` ("solely for my present employer") →
  Submit once when every required field is verified → `/tech-professionals-thank-you-for-applying/`
  confirms and logs. In-flight state spans the navigation in `sessionStorage`
  (`eve_kforce_session`); resumes on load only for a user-activated Auto session. Runtime memory
  `kforceSavedAnswers` (seen-log only; no question bank). **Root "Apply All"** on the search
  list: its own toggle (`eveKforceRootAuto`), opens not-yet-applied jobs in BACKGROUND tabs (3
  concurrent, never focused; background.js `kforceOrchestration` tab map + `eve:kforce-*`
  messages), root-auto implies single-job auto in those tabs, closes each tab on completion and
  marks the card (green ✓ applied / amber working / red `!`). Child tabs: route-based page
  detection, never wait for hidden-tab animations, 1.5 s settle then Submit only after
  `#resumeGuid` is set (async SignalR upload). Root opens only titles containing "engineer"
  (others: hard-red ✕, never opened) and retries a failed job in a fresh tab up to 3 attempts.
  Status dot is yellow for the whole run, across pages.
- **T8 — Oracle Careers ("orc")** (`careers.oracle.com`; `eve/oracle.js`,
  `design/task8-oracle-flow.md`): **OCI filter** (6-month per-line cooldown): 3px bordered box
  top-left of every job tile — brown-yellow = OCI (`/OCI|Oracle Cloud Infrastructure/i` in card
  text or full description, **ignoring skills/qualifications sections** — every job lists OCI as
  a skill), green = scanned clean, grey dashed = not scanned; heavy ✓ in the same colour =
  applied; red `!` = apply failed. **Scan** loads every result then checks each description via
  the tenant REST API (preview-dialog fallback). **Keyword filter**: on-page panel + popup + Settings → Filters (`eveKeywordFilter`, global) — on Oracle it matches the card title and hides the card like the level gate. **Level gate**: only "Senior"/"Sr" titles
  (never principal/staff/distinguished/director/VP/lead/manager/architect…) — everything else is
  hidden from the list and never opened. **Apply** (2026-09-26, live-verified 5 receipts):
  ONE job at a time in its own foreground tab (root stays put, tab closes, root refocused):
  APPLY NOW → e-mail (`oracleAccountEmail` from secrets) → 6 s lag → one-time code fetched by
  background's **verification-code service** (Gmail Atom feed of the profile's own session,
  `eve:get-verification-code`, reusable by any platform; only UNREAD mail is visible) → VERIFY →
  3 sections: prefilled values KEPT + logged to `oracleSavedAnswers.seen`, empty fields from
  profile/shared bank (pills, `cx-select` gridcell clicks, hidden checkbox groups, text),
  unmatched REQUIRED → pause with the question named → SUBMIT once → leaving the section route
  confirms. Oracle's "Too Many Attempts" lock (30 min) is detected → the batch waits with a
  countdown (`oracleBlockedUntil` persisted) and retries the same job; never more than one code
  resend per job; used codes persisted (`oracleUsedCodes`); "already applied" wording → marked
  applied; `/my-profile` synced in a background tab before a batch (signed-in only) → `oracleAppliedJobs` + `eveApplicationRecords` (`platform: 'oracle'`). Root modes,
  mutually exclusive per run: Auto ON = **Auto Apply** (batch by batch: scan the loaded cards,
  apply to every not-applied Senior job — green first, then yellow/OCI — click "SHOW MORE RESULTS", repeat until gone —
  Scan iterates the same way); Auto OFF = **Apply selected (N)** (top-RIGHT tick box per card,
  above the tile overlay). No single-job apply. Applied ids also harvested from `/my-profile` (dated tiles only).

## The shared answer bank

**T2, T3, and T5 share `info/myworkdayjobs`** (T6/T7 have no screening questions) (gitignored — it is personal data): same
`[QUESTION BANK]` topics, `[ESSAYS]`, `[SEEN QUESTIONS LOG]`, `[OPEN QUESTIONS]`, read and write.
A question learned on one platform is available on all of them.

- The bank is **topic-first**: one canonical topic owns one authoritative answer and a family of
  generalized phrasing patterns. Exact observed strings are evidence under the topic and in
  `[SEEN QUESTIONS LOG]`, never the rule itself.
- **New-question reasoning**: identify what the question actually asks, separate semantic
  invariants from incidental details (company, location, exact numbers, punctuation), and encode
  the simplest generalized patterns that cover the family. Add `exclude`s and contrasting
  regression cases when a nearby topic could be confused.
- The full capture procedure (patterns for question AND answer, grouping, collision control,
  tests) is **`.ai/skills/add-question.md`** — the single canonical skill for adding questions.
- Code banks: `DEFAULT_APPLICATION_QUESTIONS` / `DEFAULT_VOLUNTARY_DISCLOSURES` in `eve/workday.js`;
  `DEFAULT_GH_QUESTIONS` in `eve/greenhouse.js`; Indeed spliced by `tools/sync-indeed-bank.js`.
  A bank change is only real when `info/` and the code bank agree and `node tools/bank-test.js`
  (+ `tools/gh-bank-test.js`) pass.

### Unified question base (BETA — flag `eveUnifiedBank`, default OFF)

Goal: one stitched bank consumed by every platform instead of per-engine copies.

- **Generator**: `node tools/build-shared-bank.js` extracts `DEFAULT_APPLICATION_QUESTIONS` +
  `DEFAULT_VOLUNTARY_DISCLOSURES` (workday.js) and `DEFAULT_GH_QUESTIONS` (greenhouse.js), merges
  them by topic (union of patterns; per-platform answer shapes preserved), and writes
  `eve/question-bank.js`, which exposes `self.EVE_SHARED_QUESTION_BANK`.
- **Flag**: engines read `eveUnifiedBank` from `chrome.storage.local` at startup (and on change).
  OFF (default): exactly the current per-engine behavior. ON: an engine consults the shared bank
  first, then its per-engine defaults as fallback — behavior must remain a superset, never a
  replacement, while in beta.
- **Switching**: the user says `unified bank on` / `unified bank off`; flip the key via
  `node tools/cdp/eval-sw.js "chrome.storage.local.set({eveUnifiedBank:true})"` (or `false`) and
  confirm by reading it back. Do not expose a UI toggle while in beta.
- After any bank edit, regenerate (`build-shared-bank`), run the bank tests, bump, reload.

### Matching notation (`..` / `*` = wildcard)

`..a..` / `*a*` = contains `a`; `..a..b..` = `a` then `b` in order with anything between. Literal
segments must appear in order — exactly how `candidateMatch()` treats `*`. Precedence: earlier
patterns win; if none match, take the first option.

### Best-fit reasoning (regex matching is driven by the user's info)

The user's real profile in `info/myworkdayjobs` is the source of truth; a regex only expresses
"select the option that best represents this fact for this user."

- Read the actual on-page options, pick the one most accurately reflecting the user's real answer;
  precedence only breaks ties among genuinely fitting options.
- For a new question, first reason the correct answer for this user, then encode patterns that
  land on it across phrasings.
- No good fit → safest accurate default, and log it under `[OPEN QUESTIONS]`.

Standing answers (never re-confirm): relocation / hybrid-office → always affirmative; prior
employment with the hiring company → No; work authorization → Yes; sponsorship → Yes (H-1B
transfer). Never guess salary, visa specifics, or legal attestations — ask and log instead.

### Choice-control precedence and acknowledgements

- Apply a banked answer through a dropdown/combobox first; fall back to (multi-)checkbox options
  only when no dropdown matches. Same topic/answer must work with either rendering.
- Any prompt containing `acknowledge` is affirmative (Yes / Acknowledge / I Agree) — never No.
- **A lone option is an acknowledgement**: a required dropdown with exactly one real option (or a
  standalone checkbox) is selected/checked, bank match not needed.

### Regex answer syntax (LinkedIn `savedRegexAnswers`)

`regex: *<pattern>*; <type>: <answer>` — glob pattern (`*` wildcard) matched against Easy Apply
field labels; type `Yes` / `No` / `Yes / No` (binary with default) or `text: <value>` (`..` =
user must fill). Stored as `{ pattern, type, answer }`; `resolveSavedValue()` uses them as
fallback after direct label lookup.

## Auto Mode Flow (T1 core, gate shared by all tasks)

- **Hard automation gate**: multi-step looping only while Eve is enabled, `eveApplyMode` is
  `auto`, and the user explicitly clicked **Auto Apply**. Manual Apply fills the current step and
  advances exactly one step. Neither mode auto-starts on load; Submit always needs explicit
  approval (except the documented Indeed/gh submit-on-complete rules).
- **Trigger**: only `handleApplyAction()` → `startAutoApply({ userInitiated: true })`. Loading a
  page, opening a modal, toggling Auto, or a restored flag never starts automation.
- **Mode-off stop**: switching mode away from Auto immediately stops the loop and cancels pending
  resumes. Disabling Eve prevents both actions.
- **Missing fields**: Auto pauses and shows guidance; only an explicit Apply click resumes.
- **Post-submit**: `autoApplyPostSubmit` guards the 1s `pollForModalLogic` race;
  `closeSubmittedModalIfPresent()` waits 2s then closes the confirmation;
  `advanceToNextEligibleJob()` moves on.
- **Step advance timing**: `waitForAdvanceButtonEnabled(modal, 3500)` before concluding no button;
  `waitForStepChange()` before re-running the loop.
- **Never touch the Auto Apply toggle/button UI** when adding features — it stays identical across
  tasks unless the user explicitly asks.

## Workday Apply Flow (T2)

Full per-page states/selectors: `design/task2-workday-flow.md`. Rules that must not drift:

- **Host detection**: any `myworkdayjobs.com` hostname is a supported page; the floating panel
  shows on every such page.
- **Auth**: on login/auth screens an Apply click (either mode) routes to **Sign in with Google**
  with the configured job-application account (from the gitignored profile/info bank — never in
  docs or code). "Start Your Application" → **Autofill with Resume** → Google sign-in.
  `eveWorkdayLoginPendingAt` (≤5 min) lets the chooser helper auto-select in Manual too, scoped to
  Workday OAuth with basic scopes. Create-account fills email/password from local gitignored
  secrets (`eve/secrets.local.json` / `.env`), checks required acknowledgements, and clicks Create
  Account; credentials never appear in source, logs, or docs. Auth controls can render async —
  wait for clickable, don't fail the first DOM check. Review→Apply submits (full create-account +
  password + Review flow is in scope).
- **Apply semantics**: Auto ON = one click runs every step non-stop; pause → user fixes → click
  again resumes from the current step. Auto OFF = one click finishes the current page (including a
  flow-appended Continue) then stops. Both fill and advance identically via
  `advanceWorkdayStep()` — re-resolves the live footer action, rejects Submit, clicks once, waits
  for a changed step signature.
- **Pacing**: `ACTION_DELAY_MS = 0` (no general delay); the only deliberate waits are
  `PICKER_SEARCH_SETTLE_MS` (0.5s) after a typeahead Enter and ~2s in the Google auth helper.
  Per-choice settle is 0.3s.
- **Field commit**: `setNativeValue` does a real commit (focus → set → InputEvent/keyup → change →
  focusout → real blur). Pickers commit through real pointer clicks. A value that "shows" but was
  never committed stays flagged required.
- **Search/typeahead pickers**: click the box → type → Enter → wait 0.5s → inspect results →
  click the match → click a neutral area → verify the selected token. Typing alone is not a
  selection.
- **Illegal characters**: `sanitizeWorkdayText()` strips `< > [ ] " { } \` before every free-text
  fill; stored descriptions must avoid them too.
- **My Information**: skip-if-already-filled for pickers (placeholder ≠ value;
  `pickerSelectedValue()`/`PICKER_PLACEHOLDER` define emptiness). How-did-you-hear =
  first-option-always (drill-in depth cap 4). Skip rule scoped to My Information only.
- **My Experience**: `reconcileSection` reconciles Work Experience and Education to exactly the
  documented profile counts (no fabrication, extras deleted from the tail via the entry trash
  button). School is free text; Degree is a listbox matched by `degreeCandidates` synonyms.
  Required Languages → English, fluent, C2. Skills skipped. Cover letter only where a slot
  exists. Never touch Websites. Data: `DEFAULT_MY_EXPERIENCE` overridden by
  `workdaySavedAnswers.myExperience`.
- **Application Questions / Voluntary Disclosures**: `runRegexChoiceStep()` +
  `selectOption()` are the shared primitives (control-shape agnostic, idempotent). Application
  Questions matches topic regexes and picks yes/no (+`followUp` details); Voluntary Disclosures
  matches the answer as an option substring. Unmatched required questions are named and paused,
  never guessed. Seen questions are logged to `workdaySavedAnswers.applicationQuestionsSeen`.
- **Date controls**: human wording in text inputs, ISO in a native date input.
- **Resume step**: attach the packaged resume (`eve/artifacts/`, background-message boundary),
  wait for visible success or a tenant-controlled transition, then the generic advance. Some
  tenants jump straight to My Information — treat as advanced.
- **Separate memory**: `workdaySavedAnswers` only; never LinkedIn `savedAnswers`.
- **Per-round learning**: every XC round updates `design/task2-workday-flow.md` and
  `info/myworkdayjobs` before the next code iteration.

## Greenhouse / Ashby Apply Flow (T3)

Full details: `design/task3-gh-flow.md`, `design/task3-ashby-flow.md`. Anchors:

- Hosts: `job-boards.greenhouse.io`, `my.greenhouse.io`, `*.ashbyhq.com`, registered embeds
  (Zipline `www.zipline.com/open-roles/*` via `iframe#grnhse_iframe` + background relay). No sim
  dependency anywhere.
- Panel: `'apply'` tab exposes only Eve's Apply. Auto-sizes vertically, right-edge drag resize,
  header must stay readable at all widths.
- Fill: resume + cover letter from packaged artifacts (visible uploaded-file UI required on Ashby
  — `input.files` alone is not success); personal info from the bank `[CONTACT]`/`[LINKS]`;
  **location fields: type `Dallas`, wait 0.5s, click the FIRST suggestion** (typing alone submits
  an empty location; gh and ash share the steps); remaining questions match the shared bank —
  matched → fill, unmatched → leave and log, never guess.
- A label opening with are/is/do/does/can/will/have is a QUESTION, never a location field.
- Ashby: segmented Yes/No button pairs (hidden checkbox backing), multi-checkbox grouped by field
  entry (names may differ per option), direct overview entry clicks the Application tab first.
- Submit when complete; retry Submit exactly once; CAPTCHA → report and stop. Confirmation:
  Greenhouse `/jobs/<id>/confirmation` navigation is definitive; Ashby success wording includes
  "Application Success" / "Thanks for sending". MyGreenhouse has no `.select-shell` and portals
  its menu to `body` (silent zero-match, not an error).
- Memory: `ghSavedAnswers` (own key; the source bank file is shared).

## LinkedIn Easy Apply answer resolution (T1)

- **T1 consumes the shared info (2026-08-27)**: `question-bank.js` is loaded before `content.js`
  on LinkedIn. `resolveSavedValue()` precedence: `savedAnswers` (scoped/raw key) →
  `savedRegexAnswers` globs → identity profile `eveProfile` (short field-name labels only,
  `PROFILE_LABEL_MAP`) → shared bank (`resolveSharedBankValue`: greenhouse topics + workday
  extras, always on for T1; `optionCandidates`/`optionMatch`/`choose` over the field's options,
  `text` for free text — numeric inputs only accept numeric `text`; `followUp` for detail boxes).
  New LinkedIn questions are banked in `greenhouse.js` + `info/myworkdayjobs` like every platform.
- **Resume never refocuses the card**: when an Easy Apply modal is already open, `startAutoApply`
  must not click the job card — LinkedIn re-renders the form and drops user-typed values.
- **`findEasyApplyButton` never matches the search bar's "Easy Apply" FILTER pill** (aria-label
  "Easy Apply filter.", `#searchFilter_applyWithLinkedin`) — clicking it toggles `f_AL` off and
  rewrites the search. Root-level fallback must exclude the filter bar and Eve's panel.
- **A hidden modal is no modal**: LinkedIn leaves the closed Easy Apply modal in the DOM with
  `display:none`; `findEasyApplyModal()`/`isModalVisible()` treat it as closed, and a modal that
  vanishes while waiting for Next marks the job processed and advances instead of blocking.
- **LinkedIn daily cap**: disabled Easy Apply + "We limit daily submissions … apply tomorrow" →
  `isLinkedInDailyLimitReached()` stops the run with a terminal message that the 1 s modal poller
  must not overwrite (`linkedInDailyLimitHit`).

## LinkedIn Search (T1)

- Keywords and location are SEPARATE (`eveParams.linkedin.keywords` vs `searches`/
  `selectedSearch` = saved locations). Never concatenate.
- Order mandatory: bare `/jobs/search/` → keywords → location via the typeahead combobox
  (stale-list guard: option text stable across two reads, prefer exact match) → submit → wait for
  a real `geoId` → only then apply filter params (`f_TPR` seconds, `f_E`, `f_JT`, `f_WT`,
  `f_AL`). Only a typeahead selection attaches a real `geoId`.
- **Per-tab filter toggle**: the "Ignore keywords" block has a Filters switch stored in
  `sessionStorage` (`eve_filters_off`) — per page/tab, never global. OFF → `markBlockedJobs()`
  blocks nothing (keywords, custom regex, company ✕ bans); the keyword list itself is untouched
  and ✕ still saves the company. Default ON per tab.
- Exclude Eve's own `#eve-floating-ui` from all lookups; prefer `role="combobox"` inputs; resolve
  the typeahead list by widening from the field wrapper (no `aria-controls`).
- Time filter: popup converts hours/days to `f_TPR=r<seconds>`; layout order Time → Ignore
  Keywords → Keyword/Search Mode → Location → Saved Locations → click delays.

## Checkmark feature (non-Easy-Apply cards)

Checkmark on cards without Easy Apply; checked = applied (green), stored in `appliedJobsLog` by
canonical numeric job ID only (no query text; normalize legacy IDs on read; no expiry). Checking
also clicks LinkedIn's native Dismiss for that card (never on uncheck; if absent, keep the record
and log). One control set per card — resolve one canonical root, remove nested duplicates, re-run
restoration after SPA mutations.

## Data persistence

- All user data lives in `chrome.storage.local` (keyed by extension ID — lost if the ID changes;
  see the migration section). Settings Export/Import backs up all keys.
- Exported keys: `savedAnswers`, `savedAnswerGroups`, `savedRegexAnswers`, `workdaySavedAnswers`,
  `eveParams`, `eveApplyMode`, `eveApplyStats`, `eveAppLogs`, `appliedJobsLog`,
  `eveApplicationRecords`, `settings`, `profiles`, `activeProfileId`, `profileData`, `eveTheme`,
  `oracleJobScan`, `oracleAppliedJobs`, `eveKeywordFilter`.
- Plugin code and user data stay separate; the packaged artifacts under `eve/artifacts/`
  (gitignored) are the one authorized exception, served only through the allowlisted background
  message, never `web_accessible_resources`.
- All params persist across updates: `onInstalled` merges new defaults without wiping data;
  popup inputs auto-save (`persistSearchDraft()` → `saveSearchParams()`).
- The "Follow {company}" field is never processed, saved, or left checked.

## Applied Jobs Log

`eveApplicationRecords` — flat append-only array, one entry per confirmed submission across
T1/T2/T3/T5 (+ T7 kforce, T8 oracle harvested from /my-profile): `{ id, platform, title, company, location, url, mode, appliedAt, timestamp }`
(Ashby/Zipline log as `greenhouse`). Single write point `recordAppliedJob()` in
`eve/background.js` via `eve:record-applied-job` (fire-and-forget). Hooks: T1
`logApplicationSuccess()`, T2 `handleReviewSubmit()` (best-effort meta from `document.title` +
tenant subdomain), T3 `submitAndReport()` confirmed branches, T5 the `/form/post-apply` branch.
Settings shows the "Applied Jobs" tab: all columns, reverse-chronological, live-updated via
`storage.onChanged`, included in Export/Import. This is a third log — `eveAppLogs` and
`appliedJobsLog` keep their prior meanings untouched.

## Extension directories & deploy

- **`eve/` is the only canonical source directory.** All code, artifacts, bumps, tests, and docs
  target `eve/`.
- **`abby/` is the directory Chrome currently LOADS the unpacked extension from** (both profiles
  in `D:\2au\mcp\chrome-mcp-profile`; extension id `fmabdkmenomdhjmoopeilekopofmmhbm`). Until the
  migration completes, every shipped round must **mirror eve → abby**: run
  `node tools/sync-abby.js` after the version bump and before the reload. abby/ is gitignored and
  must never be edited directly.
- **Migration (pending)**: the user re-points Chrome to `eve/` (Load unpacked — cannot be
  automated), then storage is restored and abby/ deleted. Checklist: `design/abby-migration.md`.
  Storage backup: `tmp/abby-storage-backup-20260803.json`. After migration, remove the sync step,
  `tools/sync-abby.js`, and this paragraph.
- After every reload, **verify the SERVED code**, not the version number:
  `node tools/cdp/eval-sw.js "fetch(chrome.runtime.getURL('<file>')).then(r=>r.text()).then(t=>({ver:chrome.runtime.getManifest().version, ok:/<new symbol>/.test(t)}))"`.

## Global rules

- **Registered-domain availability only**: site access and UI only on explicitly registered
  domains in the manifest — never `<all_urls>`. New site = narrow pattern + real adapter.
- **Style compatibility**: every UI change stays readable in light AND dark mode.
- **Chrome DevTools MCP must be on** before any browser action; if it cannot be enabled, mark
  browser steps BLOCKED (Chrome MCP off) — never fake them.
- **Update-then-refresh cycle (mandatory after every code batch)**:
  1. Bump `eve/manifest.json` (patch).
  2. Mirror to abby (`node tools/sync-abby.js`) — until the migration completes.
  3. Reload the extension behind the scenes: preferred CDP path is
     `node tools/cdp/wake-sw.js <extId> settings.html` (a dormant MV3 worker has no CDP target;
     `settings.html` wakes it) then `node tools/cdp/reload-ext.js <extId>`; `chrome://extensions`
     via a background tab (closed after, previous tab restored) is the last resort.
  4. Hard-refresh the target tab (a reloaded extension orphans existing content scripts;
     `Extension context invalidated` is never a product result).
  5. Verify the served file contains the new symbol (see above).
  - If MCP browser calls fail with `Failed to fetch browser webSocket URL`, Chrome bound
    `[::1]:9222` only — run `node tools/cdp/tcp-bridge.js` and leave it running. `ws` module
    missing → `npm i -g ws`.
- **Bank regex verification**: after any change to the question banks run
  `node tools/bank-test.js` (and `tools/gh-bank-test.js`) — they EXTRACT the regexes from source
  (hand-retyped tests are worthless; a heredoc escaping slip once shipped literal 0x08 bytes).
  Prefer the Edit tool over shell heredocs for regex edits. The tests also fail on stray control
  characters.
- **Target-tab contract**: operate on the exact tab/profile the user designated; never substitute
  a different tenant, job, profile, or browser instance. Test in the running Chrome on `:9222`;
  restore a dead connection rather than launching a fresh browser.
- **Secrets**: credentials live in gitignored files (`.env`, `eve/secrets.local.json`,
  `eve/profile.local.json`) and are never copied into source, banks, logs, docs, or reports.
- **PII boundary (2026-08-03)**: the git remote is PUBLIC. Personal data lives only in gitignored
  locations: `info/`, `cv/`, `eve/artifacts/`, `eve/profile.local.json`, `eve/secrets.local.json`,
  `tmp/`, `params`, logs. Tracked files (code, `AGENTS.md`, `.ai/`, `design/`) must reference the
  applicant generically ("the applicant", "the configured account", `resume.pdf`) — never real
  names, emails, phones, or addresses. Note: git history from before 2026-08-03 still contains old
  copies of the bank.
- **Response style**: report outcomes tersely (fixed/broken/blocked); root-cause narration goes to
  design docs, not chat.

## Standard Response Format

Every final response ends with:

```markdown
### Summary

**What you wanted:** 1. …
**What I have done:** 1. …
**What failed:** - … or "None"
**Recommended actions:** - …

**Eve version:** x.y.z
```

using the current `eve/manifest.json` version.
