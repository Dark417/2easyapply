# Agents

This `agents.md` is the central root file for AI agent instructions in this project. All agents and skills share and use this file alongside `.ai/` directory.

## AI Agent Neutrality

- The **AI agent** running this project can be **Claude Code, Codex, Gemini, or any other** CLI/agent. They are interchangeable: every AI agent follows the **same** rules, routing, skills, and safety boundaries defined in `agents.md` and `.ai/`, regardless of which underlying model or tool is executing.
- "X", "XC", "lead-architect", skills, and every instruction in this file are role definitions, not tool-specific. Whichever AI agent is active adopts the relevant role and obeys the same contract.

## Role of Agents.md

This file acts as the primary orchestrator that defines who calls which agents or skills, and delegates the tasks effectively.

## Architecture

- Root definition: `agents.md` (this file)
- Subagents, AI agents, and skills exist within the `.ai/` directory.

## Agents

- **`lead-architect`**: Oversees everything in the project, coordinates other AI agents, delegates workflows, and validates project progress.
- **`staff-engineer-x`**: Autonomous senior implementation orchestrator for large, convergent engineering tasks, especially Chrome extensions and browser workflow automation. X owns decomposition, code, small decisive test plans, delegation to XC, feedback analysis, fixes, and progression only after the current flow slice passes.
- **`chrome-tester-agent` / `xc`**: Browser integration tester delegated by X. **XC must first detect whether Chrome DevTools MCP (or Playwright MCP) is actually available/on. If no browser MCP is connected, XC cannot test: it reports the live test as BLOCKED (Chrome MCP off) and X surfaces that instead of claiming a passed/failed run.** When a browser MCP is on, XC uses the user-designated Chrome tab via Chrome DevTools MCP (Playwright only when useful), executes only the requested scenarios, returns evidence and state transitions, and does not edit production code. **XC runs as a separate spawned agent on the Sonnet 5 model** (user, 2026-07-26): whenever live testing is needed, launch XC (model `sonnet`) with the chrome-tester role rather than having X drive the tests inline.

## Skills

- **`update-agents`**: Triggered first on every chat/user input to check whether any instructions, patterns, or routing behaviors need to be updated in `agents.md`, or inside individual agent/skill files.
- **`update-info`**: Runs at the **beginning of every chat** (right after `update-agents`). Whenever the user message, screenshot, or attachment contains any reusable **user info** — contact details, work authorization, CV facts (experience/education/skills), application answers, preferences, links — it captures that info into `info/myworkdayjobs` (the answer bank) before implementation. Personal/application data only; workflow/selector/process discoveries still go through `update-instructions`.
- **`update-instructions`**: Runs immediately after `update-agents`/`update-info` on every chat and after every XC test round. It promotes reusable process/routing/selector discoveries into `AGENTS.md`, agent/skill files, `design/task2-workday-flow.md`, and the Workday answer bank before implementation continues.
- **`chat-log`**: Used on every chat/user input to prepend log entries containing timestamps, user intents, and responses to the `msg-log.md` table.
- **`work-on-page`** / **`add-regex`** / **`test-page`**: Task 2 (Workday) loop — read the stuck step, add the missing question/regex/answer or handler code, bump + reload, retest.

## Tasks (five orthogonal workflows)

The project runs **five tasks in parallel. They are orthogonal and non-blocking**: none waits on
another, and work in one never gates the others. Each `work on <url>` is scoped to whichever task
the URL belongs to.

**Retired (user, 2026-07-27): T3 "Apply with sim"** (the AI agent driving a page after Simplify's
own autofill) is fully removed — `.ai/skills/apply-w-simplify.md` deleted, no code ever existed for
it. **Greenhouse now occupies the T3 slot** (previously T4); T5 (Indeed) and T6 (SmartRecruiters)
keep their numbers as-is — there is a deliberate gap at T4.

- **T1 — LinkedIn Easy Apply** (`eve/` content script, `linkedin-job-search`, `lk`): search,
  card controls, Easy Apply modal loop, checkmark tracking, `savedAnswers` / `savedRegexAnswers`.
- **T2 — Workday (`*.myworkdayjobs.com`)** (`eve/workday.js`, `design/task2-workday-flow.md`,
  `work-on-page` → `add-regex` → `test-page`): the extension owns the step machine; fixes are code +
  regex bank, and every round bumps the manifest and reloads the extension.
- **T3 — Greenhouse ("gh", `job-boards.greenhouse.io`, `my.greenhouse.io`)** (`eve/` extension
  code, see the **Greenhouse (gh) Apply Flow** section): Eve is enabled on gh pages and owns a
  from-scratch template flow like Workday's. Extension task: code + regex bank, manifest bump +
  reload each round. Other (non-gh) domains reuse the same page template; keep detection
  template-driven and the host list extensible.
- **T5 — Indeed Smart Apply (`smartapply.indeed.com`)** (`eve/indeed.js`,
  `design/task5-indeed-flow.md`): Eve owns a per-step state machine over the Smart Apply wizard
  (resume selection → employer questions pages → demographic/EEO page → review). Explicit Apply /
  Auto Apply click is the only trigger; Auto loops through steps, Manual advances one step per
  click. **Submit-on-complete (user-approved 2026-07-27)**: at Review, when every required field
  is verified filled, Eve clicks Submit once and confirms via the `/form/post-apply` URL +
  "Your application was submitted" heading; anything missing → name the items and hold, and never
  click Submit twice or touch a CAPTCHA. Runtime memory is `indeedSavedAnswers` only.
  `DEFAULT_INDEED_QUESTIONS` is spliced verbatim from greenhouse.js's `DEFAULT_GH_QUESTIONS` by
  `tools/sync-indeed-bank.js` — edit shared screening topics in greenhouse.js, run the sync tool,
  and mirror both directories; extension task: code + regex bank, manifest bump + reload each
  round.
- **T6 — SmartRecruiters Easy Apply (`jobs.smartrecruiters.com`)** (`eve/smartrecruiters.js`,
  `design/task6-smartrecruiters-flow.md`): a single-page "oneclick-ui" form built from
  SmartRecruiters' shadow-DOM SPL web components — every field lookup must be shadow-piercing
  (`deepQueryAll`/`deepGetControl`; a plain `document.getElementById` only reaches the light-DOM
  wrapper). **Autofill-only, never submit (user, 2026-07-27)** — the user's request was explicitly
  "autofill", not "apply"; Eve fills identity/resume/links/consent and leaves Submit for the user.
  Attaching the packaged resume triggers SmartRecruiters' own parser, which prefills Personal
  Information and the full Experience/Education entries — Eve fills only the gaps the parser
  leaves (confirm-email, City, phone number, LinkedIn/Website, the consent checkbox) and never
  overwrites a parser-filled value. Runtime memory is `srSavedAnswers` (a seen-log only — this
  template has no arbitrary employer questions). Known open item: the City autocomplete
  occasionally doesn't render suggestions within Eve's poll budget when it runs right after the
  parser's big DOM update; City has no required-field marker so this never blocks submission, but
  it is left unfilled and reported rather than guessed.

**T2, T3, T5 and T6 share the answer bank** `info/myworkdayjobs` — same `[QUESTION BANK]`
topics, `[ESSAYS]`, `[SEEN QUESTIONS LOG]`, `[OPEN QUESTIONS]`, read *and* write. A question learned
on a Workday step is available on an Ashby, Greenhouse, Indeed, or SmartRecruiters page and vice
versa. T2/T3/T5 encode matched topics into extension code; T6 has no question bank yet (the
template has none to match against).
The bank is **topic-first**: each canonical question topic owns one authoritative answer and a
family of generalized phrasing patterns. Exact screenshot/live strings belong under that topic as
specific ways to ask it and in `[SEEN QUESTIONS LOG]`; never encode only a one-off literal when the
stable semantic pattern can be extracted.
- **New-question reasoning rule (user, 2026-07-27)**: before adding a question, identify what it is
  actually asking, separate semantic invariants from incidental details, and encode the simplest
  generalized patterns that cover the question family. Locations, company names, punctuation, and
  exact numeric schedules should not become required match tokens unless they change the answer.
  Keep the exact observed wording only as evidence and add contrasting regression cases when a
  nearby topic could be confused.

## Global Jargon

- **menu**: Means the Eve extension menu from Chrome top toolbar (extension popup panel).
- **popup**: Means the Eve floating popup shown on LinkedIn pages when Eve is enabled.
- **sim**: Means the Simplify browser extension and its page-level autofill UI.
- Words written like **`'search'`**, **`'apply'`**, **`'step'`**, **`'info'`** refer to popup tabs.

## Auto Mode Flow

- **Hard automation gate**: Multi-step looping is allowed only while Eve is enabled, `eveApplyMode` is `auto`, and the user explicitly clicked **Auto Apply**. Workday Manual **Apply** (Auto off) fills the current step and then clicks its one advance action (**Continue** / **Save and Continue** / **Next** / **Review**), advancing exactly one step and stopping on the newly rendered step. It never auto-submits (Submit requires explicit user approval), never authenticates, and never enters the pre-flow application. Auto and Manual fill and advance the current step identically; the only difference is that Auto keeps looping to subsequent steps while Manual stops after one.
- **Trigger**: User enables Eve, sets mode to "Auto", then clicks Apply in the popup → `handleApplyAction()` → `startAutoApply({ userInitiated: true })`. Clicking LinkedIn's native Easy Apply button, loading a page, opening a modal, or restoring a legacy bootstrap flag must never start or resume automation.
- **Mode-off stop**: Switching Apply Mode away from Auto immediately stops the active loop and cancels pending resumes. On Workday, the button becomes **Apply**, and each explicit click fills the current step and advances exactly one step. Disabling Eve prevents both Auto Apply and Manual Apply actions.
- **Popup Auto toggle**: The floating popup exposes an Auto Apply toggle backed by `eveApplyMode`. Changing it only arms or disarms Auto mode; toggling it on never starts automation. The user must still click **Apply** / **Auto Apply**.
- **Loop**: `runAutoApplyLoop()` fills fields from saved answers, clicks Next/Review/Submit automatically each step.
- **Missing fields**: Auto pauses (`autoApplyRunning = false`) and shows the missing-field guidance. Manual Next/Continue clicks may save current values but never resume automation; the user explicitly clicks Apply to resume.
- **Post-submit**: After clicking Submit, `autoApplyPostSubmit = true` is set as a guard. `closeSubmittedModalIfPresent()` waits **2 seconds** then closes the confirmation window (Done → X dismiss → backdrop fallback). The hard automation gate is checked before closing and advancing; mode-off state must never be overridden by re-asserting `autoApplyRunning`.
- **Next job**: `advanceToNextEligibleJob()` scrolls the left job list, finds the next eligible card, clicks it, opens Easy Apply, and restarts the loop. The `autoApplyPostSubmit` flag prevents `pollForModalLogic` from calling `resetAutoApplySession()` during this transition.
- **Known race**: `pollForModalLogic` runs every 1s. Without `autoApplyPostSubmit` guard, it would detect the missing modal after submit and reset `autoApplyRunning = false`, breaking the next-job advance.
- **Step advance timing**: After programmatic fill, LinkedIn's React validation runs async — Next button stays `disabled` briefly. Use `waitForAdvanceButtonEnabled(modal, 3500)` (polls every 200ms up to 3.5s) before concluding no button exists. After clicking Next, use `waitForStepChange()` (polls heading+field signature) so `runAutoApplyLoop` only re-runs once the new step is loaded.

## Workday Apply Flow

- **Host detection**: Any page whose URL hostname contains `myworkdayjobs.com` is a supported Workday page. **The floating Eve panel shows on every such page** (login, job listing, search, and `/apply/...`), not only application pages — as long as the URL is a `myworkdayjobs.com` host, the plugin is visible.
- **Login page → Google sign-in**: On a `myworkdayjobs.com` URL whose path is `/login` (or any rendered Create Account / Sign In auth screen), clicking **Apply** / **Auto Apply** triggers **Sign in with Google** with the configured job-application account. This is the one explicit-user auth exception for Manual mode: an Apply click on a login/auth page starts Google sign-in; on all other pre-flow entry (e.g. the Start-page **Autofill with Resume** button, email/create-account paths) Manual still does not enter or create accounts.
- **Apply semantics (reinforced)**: With **Auto Apply ON**, one user click runs the whole application **non-stop through every step**. If it pauses (a field it can't answer / a validation block), the user fixes those fields and clicks **Auto Apply** again to **resume from the current step**. With **Auto OFF (Apply)**, one click **finishes the current page only** — including a **Continue / Save and Continue** when that page's own flow appends one (e.g. resume upload → Continue) — then stops on the newly rendered step. Neither mode auto-starts on load, and Submit always needs explicit approval.
- **Logged-out entry flow (Start Your Application) — both modes**: When the tab is logged out and shows **Start Your Application** (Autofill with Resume / Apply Manually / Use My Last Application), an Apply click in **either mode** performs the auth entry — there is nothing to manually fill until authenticated. **Auto** and **Manual** both select **Autofill with Resume** → **Sign in with Google** → the configured account `xiaoxiaoleijobapp@gmail.com` in the Google chooser (or silent if already signed in) → the authenticated resume page. In Manual this advances one page per Apply click (Start→login, login→Google); the Google chooser + consent then complete automatically. **Account-chooser auto-select works in Manual too**: `handleWorkdayLogin`/the Start-page entry set a short-lived `eveWorkdayLoginPendingAt` flag, and `workday-google-auth.js` selects the configured account whenever that flag is fresh (≤5 min) **or** an Auto session is running — scoped to Workday OAuth with basic scopes only. Manual still never uses the email/create-account path. After auth, Auto continues; Manual reverts to its one-page contract. Per-page scenarios/selectors are in `design/task2-workday-flow.md`.
- **UI reuse**: Reuse the Eve floating popup skeleton and the `'apply'`, `'step'`, and `'info'` tabs, but hide `'search'` on Workday pages.
- **Isolation**: Keep Workday page detection, selectors, step handling, and automation in a platform-specific flow; do not mix Workday selectors into the LinkedIn auto-apply loop.
- **Entry choice**: On "Start Your Application", always select **Autofill with Resume**.
- **Account choice**: When account authentication is required, prefer **Sign in with Google** and the configured job-application Google account. If email account creation is required instead, use the local `.env` credentials without placing credentials in source, logs, or documentation.
- **Create Account form**: When a Workday tenant requires account creation, fill the email/password fields from local `.env`, check the required privacy/terms acknowledgement, and click **Create Account** using the Workday action delay. Never persist or display those credentials.
- **Async auth rendering**: After Workday navigation, authentication controls may be rendered asynchronously. Keep the active session alive and wait until **Sign in with Google** becomes clickable instead of failing on the first DOM check.
- **Inactivity re-login**: When Workday logs out a long-idle session, it re-renders the same `/apply/...` URL as **Create Account/Sign In**. While `isAuthenticationScreen()` is true, the Auto Apply loop never treats a future **Autofill with Resume** progress-step label as the entry button; it routes to the login flow (Sign in with Google → configured account → return → resume). Landing on the login page still never auto-starts—the user clicks **Auto Apply** once. The Google chooser helper accepts OAuth requests returning to any Workday-owned host (`*.myworkday.com` or the tenant `*.myworkdayjobs.com` host) with basic scopes only.
- **Mode-aware action button**: The Workday `'apply'` tab shows **Auto Apply** when Auto mode is on and **Apply** when Auto mode is off. **Auto Apply** starts/resumes the isolated end-to-end fill-and-navigation flow. **Apply** fills the current step and clicks its one advance action (Continue/Save and Continue/Next/Review), stopping on the next step; it never auto-submits at Review or triggers authentication.
- **Popup landing tab**: For the Workday template the floating popup **always stays on `'apply'`** — the flow never auto-switches to `'step'` or `'info'` (not on Auto Apply start, pause, or Manual fill). Progress/status is shown on the `'apply'` tab via `setStatus`; `renderStep` still updates the Step tab's contents in the background so it's current when the user opens it manually. The Step/Info tab buttons still work on click; a prior selection is never restored on a fresh landing.
- **Explicit activation only**: Workday Auto Apply never begins from a stale/waiting session on page load. It begins only from the user's **Auto Apply** click while Eve and Auto mode are enabled; once activated, a running session may continue across its own navigation or required refresh only while both gates stay enabled. Manual **Apply** also requires an explicit click and never persists or resumes a loop.
- **Mode/action serialization**: The Workday Auto toggle and its action button are separate controls, but an immediate **Auto Apply** click after arming must not lose to asynchronous `chrome.storage` persistence. The explicit action serializes the currently rendered toggle mode to storage before it reads the automation gates or starts the session. Later mode-off changes still cancel every pending action.
- **Base action delay (snappy)**: Automated micro-actions in the Workday fill flow (open a picker, type a search term, click the result, fill a field, advance) use a short **~250 ms** spacing (`ACTION_DELAY_MS`) so search/select is fast: click the box → type the keyword → click the target result → go to the next. This is a deliberate speed choice; the previous 2-second pacing was too slow. The Google **account chooser / consent** helper (`workday-google-auth.js`) keeps its own longer (~2 s) pacing since auth is more sensitive.
- **Generic advance action**: Workday Continue/Next/Save and Continue/Review navigation uses one repeatable `advanceWorkdayStep()` primitive. Every call re-resolves the live footer action, rejects Submit, applies the base spacing, clicks once, and waits for a changed step signature. Both Auto and Manual advance through it under the shared automation gate (extension enabled, matching mode, active pass/session). Auto loops; Manual advances exactly one step per **Apply** click.
- **No sim dependency**: The Workday flow must not use, inspect, click, or wait for sim. Eve owns resume upload, every fixed step, question matching, navigation, review, and supported submission behavior.
- **CV and answer source**: `info/myworkdayjobs` is the human-readable Workday answer bank. CV-derived facts come from the PDFs under `cv/`; replace stale CV sections when those PDFs change. Never guess an unanswered required field—record it in the bank and pause.
- **Authenticated resume step**: On **Autofill with Resume**, upload the configured resume from `cv/` using the Workday file input, wait for Workday's successful-upload state, then click Workday **Continue** with the base delay.
- **Packaged application artifacts**: The user explicitly authorizes `cv/Xiaoxiao_Lei_RESUME.pdf` and `cv/Xiaoxiao Lei Cover Letter.pdf` to be copied into private packaged extension artifacts. Workday obtains them only through an allowlisted background-extension message; do not expose them as `web_accessible_resources`, log their contents, or open a local file picker.
- **Resume Apply behavior**: On **Autofill with Resume**, both Manual **Apply** and Auto **Auto Apply** attach the packaged resume behind the scene. After an in-place upload confirmation, both modes call the generic Continue action. Manual stops on the next step; Auto continues its loop. No chooser or resume-storage UI is shown.
- **Resume mode status**: Manual **Apply** reports that the packaged resume was accepted, clicks Continue, and then reports that it stopped on the new step because Auto is off. The `'apply'` tab label is not an action and must not be confused with the Manual **Apply** button.
- **Confirmed-upload continuation**: In either mode, after packaged resume upload is visibly confirmed in place, call the generic Workday advance action and wait for the next step. Manual supplies its one-shot resume capability and stops after that transition; Auto continues. If the tenant already moved to a known next step as part of parsing, treat it as advanced and do not click a stale Continue control.
- **Tenant-controlled upload transitions**: Some Workday tenants treat resume upload as a pre-step and move to **My Information** as part of the site's upload/parser response without exposing or requiring a Continue click. Treat this as the resume transition without using the capability; Manual stops without filling the newly rendered step, while Auto may continue.
- **Artifact data boundary**: The packaged resume and cover letter are an explicit exception to the usual plugin-code/user-data separation rule. Keep them under `eve/artifacts/`, validate the expected PDF filename/size before attachment, exclude them from Settings export/import, and serve only the allowlisted artifact bytes through the background service worker. Remove the obsolete `workdayResumeFile` runtime-store/chooser path.
- **My Information ownership**: Eve fills this stable step. **How Did You Hear About Us? is first-option-always (user, 2026-07-25)**: open the picker, click the FIRST option, and if that drills into another list click the first option there too, repeating to a depth cap of 4. There is no LinkedIn/Glassdoor/Indeed precedence and no "prefer Referral" rule any more, and no "prefer LinkedIn if present" fallback — the user accepts whatever the tenant lists first. **Skip-if-already-filled**: any My Information search-and-pick field that already holds a real value is done — never reopened, re-searched, or refilled, even if it differs from the stored profile value. A placeholder ("Select One", Citi's " Select One Required") is not a value; `pickerSelectedValue()`/`PICKER_PLACEHOLDER` is the single shared definition of emptiness, also used by `blockAnswered()`. This skip rule is scoped to My Information pickers and is deliberately NOT applied to Application Questions / Voluntary Disclosures / Self Identify, which must still correct a wrong prefill. For Workday custom pickers such as source and country phone code, read the selected token/listbox state or accessibility description; the nested text input may remain empty despite a valid selection. Stable identity, address, and phone defaults derived from `info/myworkdayjobs` must be available when `workdaySavedAnswers` has not captured the page yet; saved Workday values override those defaults. Ignore optional blank fields, save completed values in `workdaySavedAnswers`, and continue.
- **My Information template invariant**: Treat the second authenticated Workday filling step as **My Information** across all `myworkdayjobs.com` tenants, regardless of company/job text or the number of progress steps. Detect it from active-step/heading plus stable automation IDs, select the source by the first-option-always rule above, inspect the live inputs, fill every known blank from the shared Workday profile, then use the generic Save and Continue action.
- **Field commit (all steps, all field types)**: Setting a value programmatically is not enough — Workday validates required fields on real focus-out, so a value that "shows" but was never committed stays flagged required (red). `setNativeValue` therefore performs a **real commit** on every text/textarea fill: `input.focus()` → native value set → `InputEvent` + `keyup` → `change` → bubbling `focusout` → **real `input.blur()`**. This is the "click the next field to commit" behavior applied globally (a dispatched `blur` Event alone never actually blurred the field). Custom pickers/dropdowns commit through real pointer clicks (`clickPickerChoice`); this covers My Information, My Experience, Application Questions (including "Please provide details"), and every other step. Applies to future added questions/fields automatically.
- **Illegal characters in free text**: Workday rejects the characters `< > [ ] " { } \` in free-text fields (Role Description reported *"Contains illegal characters < > [ ] " { } \"*). `sanitizeWorkdayText()` strips them before every free-text fill (`setEntryText`, Application Questions details), and stored descriptions/answers in `info/myworkdayjobs` and `DEFAULT_MY_EXPERIENCE` must avoid quotes/brackets/braces/backslashes too.
- **My Experience step**: The step after **My Information** (Work Experience, Education, Languages, Skills, Resume/CV, Websites). Eve owns it via `handleMyExperience()` and `isMyExperienceStep()`. Selectors are **CDP-confirmed** against the live BlackRock tenant: entry inputs are id-prefixed (`workExperience-<n>--jobTitle`, `education-<n>--schoolName`, …) with no `data-automation-id` on the input itself. Work Experience and Education are **reconciled to exactly the info/profile count** (`reconcileSection`): existing entries are rechecked field-by-field and left untouched when they already match (no duplicates, no needless rewrites), missing entries are added, and **extras are deleted from the tail** via the entry's own trash button (`entryDeleteButton` finds the delete control inside each entry's panel, selector-name-agnostic; `confirmDeletionIfPrompted` handles a confirm modal). (1) Work Experience = the documented employers (two — J.P. Morgan Chase and Graphen Inc.); never fabricate employment. (2) Education = the two schools; **School is a free-text field** (type the name — no "Other" picker on this tenant); **Degree is a listbox `<button>`** selected by exact/word-boundary/synonym match (`degreeCandidates`: master → master's/graduate/post-graduate; bachelor → bachelor's/undergrad*). (3) **Required Languages only**: if the tenant makes the Languages entry required, fill one entry as **English**, check **I am fluent in this language**, and select **C2 (Proficient/Native Speaker)**; leave an optional blank Languages section untouched. (4) **Skills skipped** (`FILL_SKILLS = false`). (5) Cover letter attaches **only where a cover-letter file input exists** (`attachKnownArtifacts`); BlackRock's My Experience has just one Resume/CV single-file input, so there is **no cover-letter slot on this step** and none is uploaded here. (6) **Never touch Websites**. Add buttons are scoped by real section-name headings (`SECTION_HEADING`), ignoring Workday's date `From`/`To` legends. Data is `DEFAULT_MY_EXPERIENCE`, overridable by `workdaySavedAnswers.myExperience`.
- **Application Questions step**: The repetitive screening step (often after My Experience) has an unknown number of Yes/No questions asked in many phrasings, each rendered as a question-(explanation)-answer block with a Workday **custom** Yes/No dropdown (not a native `<select>`). Eve owns it via `handleApplicationQuestions()` and `isApplicationQuestionsStep()`: it reads each outermost question block's full text (question + explanation, controls stripped), matches it against `DEFAULT_APPLICATION_QUESTIONS` (a regex bank keyed by **topic**), selects the mapped option (`yes` picks the affirmative option even when worded long like "Yes, I affirm…"; `no` picks No), and fills any conditionally revealed **"Please provide details"** text field from the entry's `followUp`. Current defaults: work-authorization → **Yes**; visa/work-permit-now-or-future → **Yes** + details "H1b transfer and greencard."; sponsorship → **Yes** (+details); personal-relationship → **No**. Order matters — the visa entry is matched before work-authorization (which excludes visa/work-permit wording) so the details field is filled. Unmatched **required** questions are not guessed: Eve pauses/stops and names them. Users accumulate new phrasings by adding `{ topic, patterns, choose, followUp }` to `workdaySavedAnswers.applicationQuestions` (same-topic patterns merge into the defaults); every encountered question text is also saved to `workdaySavedAnswers.applicationQuestionsSeen`. Selectors are pending live XC confirmation (Chrome MCP was off when implemented).
- **Voluntary Disclosures / Self Identify step**: EEO demographic dropdowns (gender, race/ethnicity, Hispanic/Latino, veteran) handled by `handleVoluntaryDisclosures()` and `isVoluntaryDisclosuresStep()`, sharing the same `runRegexChoiceStep()` engine as Application Questions. Difference: the answer is matched as a **substring** of the option (`optionMatch`), so a stored answer can be part of a longer option — "Asian" → "Asian (United States of America)", "not a veteran" → "I am not a veteran". Current defaults: gender → **Male**, race → **Asian**, Hispanic/Latino → **No**, veteran → **I am not a veteran**. Long EEO/VEVRAA preamble paragraphs are not form-field blocks and are ignored. Users accumulate phrasings via `workdaySavedAnswers.voluntaryDisclosures` (`{ topic, patterns, optionMatch|answer }`; same-topic patterns merge). Unmatched required questions are named and paused, never guessed. Pending live XC confirmation.
- **Regex single-choice engine**: `runRegexChoiceStep()` + `selectOption(container, predicate, label, context)` are the shared primitives for regex-matched single-choice steps. Bank answers are control-shape agnostic: `selectOption` tries a native `<select>`, radios, label/value-matched checkboxes, and then a Workday custom dropdown, and is idempotent (no-op when the wanted option is already selected). A checkbox-rendered single-choice question selects the matched answer and clears conflicting checked options; it must never infer an answer from checkbox position. Application Questions passes a Yes/No predicate (+followUp); Voluntary Disclosures passes an option-substring predicate.
- **Other Workday steps**: Eve matches stable identity/CV facts and variable questions against the Workday answer bank using normalized direct labels plus regex aliases. New or differently worded questions are added to the bank after each test round.
- **Separate memory**: Workday answers use `workdaySavedAnswers`; do not read or write LinkedIn `savedAnswers` from the Workday adapter.
- **XC scenario baseline**: X defines state 0 per test slice. Pre-flow/auth tests start logged out at the exact user-designated `/apply` URL. Filling-flow tests start from the authenticated Workday step named by the user and must not log out or replay parked authentication scenarios. In either baseline, XC stops/disarms unrelated automation, preserves unrelated browser data, and never submits unless X explicitly scopes submission.
- **Post-update test refresh**: Reloading the extension invalidates existing Workday content-script contexts even though their floating UI may remain visible. Before every post-update XC action round, hard-refresh the exact target step and verify the refreshed panel responds; never treat a stale panel's `Extension context invalidated` failure as a product-flow result.
- **Active resume slice**: When testing the authenticated **Autofill with Resume** step, use the packaged `eve/artifacts/Xiaoxiao_Lei_RESUME.pdf`, attach it through Workday's real file input without a chooser, and wait for visible success or a tenant-controlled next-step transition. Manual consumes only one delayed Continue and stops on the new step; Auto may continue. Do not use sim.
- **Target-tab contract**: When the user points to a URL/tab, X and XC operate on that existing Chrome tab/browser profile. They must not silently substitute a different tenant, job, profile, or browser instance.
- **Per-round learning**: Every XC result updates `design/task2-workday-flow.md` with observed states/selectors/branches and updates `info/myworkdayjobs` with seen questions, normalized regex patterns, answers, and unresolved questions before the next code iteration.

## Extension directory: `eve/`

- **`eve/` is the only canonical extension source directory.** All extension code, artifacts,
  version bumps, tests, packaging, and documentation target `eve/`; never recreate or mirror a
  second extension-source directory.
- A browser profile still loaded from the former directory must be manually re-pointed to
  `D:\2Alfred\easyapply\eve` through Chrome's unpacked-extension control before that obsolete
  directory is removed. Automated browser control cannot access `chrome://extensions`.

## Greenhouse (gh) Apply Flow (Task 3)

- **Host detection**: `job-boards.greenhouse.io` is the anchor domain. Other domains render the
  same Greenhouse application template; keep detection modular (template DOM markers + an
  extensible host allowlist) so a new domain is a one-line addition when the user supplies it.
- **Ashby domain (user, 2026-07-26)**: route `ashbyhq.com` and every `*.ashbyhq.com` host through
  T3's shared Greenhouse/Ashby adapter and answer bank. Ashby keeps its own template branch and
  iframe relay, but it is the same user-facing `gh` workflow.
- **Zipline Greenhouse embed (user, 2026-07-27)**: route `https://www.zipline.com/open-roles/*`
  through T3. Zipline is the top-level panel host and embeds the real application in
  `iframe#grnhse_iframe` on `job-boards.greenhouse.io/embed/job_app`; the Greenhouse engine runs
  inside that cross-origin frame and relays Apply, form signatures, and status through the
  background service worker. Zipline is an explicitly registered adapter domain.
- **Eve panel**: enabled on gh pages. The `'apply'` tab exposes only Eve's **Apply** action.
  Greenhouse/Ashby/Zipline must not render, discover, click, wait for, relay, or otherwise depend
  on Simplify autofill. The panel auto-sizes vertically to its visible content (up to a
  viewport-safe maximum) and exposes a right-edge drag handle for persistent horizontal resizing;
  it must not reserve an empty tall column or overlap/wrap text into unreadable layers.
  Host-page typography must never collapse the panel header: Eve sets explicit nonzero line-height
  and display rules for the title and version so **Eve · Greenhouse/Ashby** stays fully visible at
  both the minimum and resized panel widths.
- **Direct Ashby overview entry**: a top-level `jobs.ashbyhq.com/...` job can initially show the
  **Overview** tab with the **Application** tab unselected and no form mounted. Clicking Eve
  **Apply** first clicks the exact visible Application tab (falling back to the exact
  **Apply for this Job** link/button), waits for the Ashby form to mount, and then continues the
  same fill-and-submit pass without requiring a second Eve click.
- **Apply**: Eve's own from-scratch template flow (like Workday's) that fills the **entire page**:
  - Resume upload + cover-letter upload from the packaged artifacts (`eve/artifacts/`, via the
    allowlisted background message — same boundary rules as Workday). On Ashby, assigning
    `input.files` or seeing the browser-only fake path is **not** success; Eve waits for Ashby's
    visible uploaded-file UI (filename plus Replace/Delete state) before the slot is complete or
    submission is allowed.
  - Personal info from the shared bank (`info/myworkdayjobs` [CONTACT]/[LINKS]).
  - **Location field**: **use Dallas for the address everywhere** (user, 2026-07-26 — overrides the
    earlier "Plano" example): type `Dallas`, wait **0.5 s** for the autocomplete results (reuse the
    `PICKER_SEARCH_SETTLE_MS` pattern — still the only deliberate delay), then **select the first
    result**. Plain street/city/state address inputs likewise come from [CONTACT] (Dallas, TX).
  - Remaining questions: match against the shared question bank regex topics (same best-fit
    reasoning as Workday). **Matched → choose/fill; unmatched → leave as-is** (never guess), and
    log them for registration.
  - **Ashby segmented Yes/No** (live Ramp, 2026-07-27): a field entry can render two exact
    `button` controls, Yes and No, backed by a hidden checkbox rather than radios. Detect the
    field entry by its question label, choose the bank-matched button by visible text, and verify
    selection from Ashby's active-button class/hidden checked state. Do not require the backing
    checkbox itself to be visible.
  - **Ashby multi-checkbox questions** (pronouns confirmed 2026-07-27): group checkbox options by
    their enclosing field-entry question before considering each input's `name`; Ashby may assign
    distinct names to options that belong to one question. Match the enclosing question to the
    bank, then select the exact best-fit option label (pronouns → **He / Him / His**).
  - **Single-option required dropdown → auto-select** (user, 2026-07-26): a required question whose
    dropdown contains exactly **one** real option (placeholders like "Select..." don't count) is
    usually an acknowledgement — select that option and move on, no bank match needed.
  - **Submit when complete** (user, 2026-07-26 — supersedes the earlier hold-always rule): after
    the fill, if **every required field is filled/answered** (no failed items, no unanswered
    required questions), click a safe non-control area to commit/blur the final field, then
    **click Submit**. If the application form and an enabled Submit control remain after the first
    attempt (with no success confirmation, security-code screen, or CAPTCHA), click the safe area
    again and retry Submit exactly once. If anything required is still missing, do NOT submit —
    report the missing items and hold. Never interact with a CAPTCHA; if one blocks submission,
    report it and stop.
  - **Submission confirmation:** treat a successful HTTP 200 Greenhouse
    `/jobs/<id>/confirmation` navigation as definitive submission evidence, including when it
    immediately redirects to the employer careers site. Never click Submit again after that
    confirmation. A missing Submit button alone is not success. An email security-code screen is
    a waiting state until the user completes it.
- **Memory**: gh runtime answers live in their own storage key (do not mix with LinkedIn
  `savedAnswers`; sharing the Workday regex bank source data is fine — the bank file is shared).
- **Testing (XC)**: use the existing Chrome instance tabs. Unanswered questions → register +
  reason from the bank, test, and only ask the user (via the in-app question UI) when genuinely
  unsure.

## LinkedIn Job Search (location typeahead, then filters)

- **Keywords and location are SEPARATE fields.** `searches` / `selectedSearch` in `eveParams` are **locations only** (the panel labels them "Saved locations"); the search keywords live in `eveParams.linkedin.keywords` (default `software engineer`). Never concatenate them — a combined `keywords=software engineer California, United States` makes LinkedIn fuzzy-match the location words as keywords instead of applying a geo filter. `normalizeParams()` migrates a legacy glued value by stripping a trailing copy of the selected location off the keywords; saved locations themselves are never rewritten.
- **Order is mandatory: location first, filters last.** `runLinkedInSearchSetup()` (background.js) (1) lands on a bare `https://www.linkedin.com/jobs/search/`, (2) fills keywords, (3) types the location into the **location combobox** and picks a typeahead suggestion, (4) submits, (5) waits for the resulting URL to carry a **`geoId`**, and only then (6) applies filters by mutating that URL via `applyFilterParams()`. Filters applied *before* the location are destroyed by the re-search that a suggestion click triggers — that was the original bug (the old code drove the All-filters modal first, then typed the location).
- **Only a typeahead selection attaches a real `geoId`.** Do not hand-write or reuse a stale `geoId`.
- **Typeahead renders a STALE list first.** Typing "California, United States" briefly shows plain "United States"; taking the first option immediately picks that and silently searches the whole US. Wait for the option list text to be **stable across two reads** before choosing, then prefer an exact match for the typed location over the raw first entry. Verify the committed value (`locationMatched`) and the `geoId` — never report success on an unverified selection.
- **Scope every query; the panel is in the same document.** Eve's own `#eve-floating-ui` contains inputs and two buttons labelled **Search** — exclude it from all element lookups or the automation clicks its own UI. LinkedIn also renders a hidden "ghost" twin input per field, so prefer the one with `role="combobox"`.
- **Match the fields by role/aria-label family**, never a single class: location = `input[role="combobox"]` with aria-label `City, state, or zip code`; keywords = aria-label `Search by title, skill, or company`; both carry the `jobs-search-box__text-input` family. LinkedIn sets **no `aria-controls`** on these inputs, so the owned typeahead list (`.basic-typeahead__triggered-content` / `[role="listbox"]`) is resolved by widening from the field's wrapper outwards, and when a level yields several lists the one horizontally nearest the input wins (the keywords typeahead can be open at the same time).
- **Filter params**: `f_TPR` (time gauge), `f_E` experience (`linkedin.experience`, default `2,3,4` = Entry/Associate/Mid-Senior), `f_JT` job type (`linkedin.jobType`, default `F` = Full-time), `f_WT` remote (`linkedin.remote`, empty by default), `f_AL` Easy Apply (`linkedin.easyApply`, default on). These replace the old hardcoded filter-modal walk.

## LinkedIn Time Filter

- **Query contract**: LinkedIn's `f_TPR=rN` value uses seconds. The popup presents human-friendly hours/days and converts them to a rounded positive second count before updating the URL.
- **Controls**: Search starts with two horizontal time controls: Hours supports 0–24 plus a decimal numeric input (for example `0.3`); Days supports 0–30. The shared **OK** action applies the most recently edited time unit, sets/removes `f_TPR`, and navigates to the updated URL.
- **Search layout order**: Time filter → Ignore Keywords → Keyword/Search Mode → Location → Saved Locations → click-delay settings.

## Data Persistence

- All user data is stored in `chrome.storage.local` (keyed by extension ID). Data is lost if the extension is removed/reinstalled or the ID changes.
- **Export/Import** buttons in the Settings page (`#export-data-btn` / `#import-data-btn`) let the user backup and restore all data as a JSON file.
- **IMPORTANT**: Plugin code and user data are normally kept separate. The two user-authorized Workday PDFs under `eve/artifacts/` are the only current exception and will be shipped with any package containing that directory; other `chrome.storage.local` data is not shipped.
- Keys backed up: `savedAnswers`, `savedAnswerGroups`, `savedRegexAnswers`, `workdaySavedAnswers`, `eveParams`, `eveApplyMode`, `eveApplyStats`, `eveAppLogs`, `appliedJobsLog`, `eveApplicationRecords`, `settings`, `profiles`, `activeProfileId`, `profileData`, `eveTheme`.
- **appliedJobsLog**: Persistent record of all jobs applied to (by job ID and URL). Used to detect already-applied jobs even after page reloads. Not part of plugin code.

## Applied Jobs Log

A **unified, cross-platform** record of every successful submission across all four applying
tasks (T1 LinkedIn, T2 Workday, T3 Greenhouse/Ashby, T5 Indeed), shown on its own Settings tab.
This is a **third, separate** log — it does not replace or repurpose either existing LinkedIn-only
key: `eveAppLogs` (rich description-snippet log, `logApplicationSuccess()` in content.js) and
`appliedJobsLog` (card-checkmark dedup tracker) both keep their exact prior meaning untouched.

- **Storage key**: `eveApplicationRecords` — a flat, append-only array, unbounded (records are
  small; no pagination/cap). Each entry:
  ```js
  {
    id,          // string, unique — "<platform>-<jobId|url>-<timestamp>"
    platform,    // 'linkedin' | 'workday' | 'greenhouse' | 'indeed' (Ashby/Zipline/Cape log as 'greenhouse' — same T3 flow)
    title,       // best-effort job title
    company,     // best-effort company name
    location,    // best-effort, '' if unknown
    url,         // application URL at time of submission (the one reliable column regardless of scrape quality)
    mode,        // 'auto' | 'manual' — 'auto' where the platform has no manual/auto distinction (gh/Ashby)
    appliedAt,   // ISO 8601 string
    timestamp    // Date.now() ms, used for sorting
  }
  ```
- **Write path**: every hook sends `chrome.runtime.sendMessage({ type: 'eve:record-applied-job', record })`
  (fire-and-forget, errors swallowed — never blocks the submit result). `background.js`'s
  `recordAppliedJob()` (`eve/background.js` ~line 207, case `'eve:record-applied-job'` ~line 635)
  is the **single** read-modify-write point for the array, so concurrent tabs/platforms never race
  each other; content scripts never write this key directly.
- **Hook points** (fire immediately after each platform's own confirmed-success signal — none of
  these touch the Auto Apply/Apply toggle or its button):
  - **T1 LinkedIn** — `content.js` `logApplicationSuccess()`, right after the existing `eveAppLogs`
    write, reusing the already-extracted `company`/`role`/`loc`/`jobId`/`timestamp` (~line 3034).
    Always `mode: 'auto'` (this function only runs inside the auto-apply submit path).
  - **T2 Workday** — `workday.js` `handleReviewSubmit()`, called right after `waitForStepChange`
    confirms the post-Submit step change (~line 3682). Title/company are best-effort
    (`bestEffortWorkdayJobMeta()`, ~line 3630s): `document.title` (commonly "Apply for `<title>` -
    Workday") stripped of the suffix/prefix, and the tenant subdomain as company fallback — `url`
    is the reliable column. `mode` follows `context.mode` from `autoActionContext()`.
  - **T3 Greenhouse/Ashby** — `greenhouse.js` `submitAndReport()`, called at each confirmed-success
    return branch (`recordGhApplication()`, ~lines 1379/1433/1443 — the function is defined once and
    called from both the primary and retry confirmation paths). Title/company are best-effort
    (`bestEffortGhJobMeta()`): `.app-title`/`h1` heading and a `company-name`-ish element, falling
    back to `document.title` / tenant host. Always `mode: 'auto'` (T3 has no manual/auto distinction
    — the `'apply'` tab exposes only Eve's single Apply action).
  - **T5 Indeed** — `indeed.js` `runCurrentStep()`'s Submit-on-complete success branch, right after
    Indeed's `/form/post-apply` confirmation is detected (`recordIndeedApplication()`, ~line 1443).
    Title reuses the same heading-scan convention as `stepHeading()` ("first H1 is the job title");
    company is left blank (Indeed's Smart Apply wizard rarely exposes it cleanly — `url` is
    reliable regardless). `mode` follows `autoModeEnabled`.
- **Settings tab**: `settings.html`/`settings.js` add a third `content-tab` (`data-pane="applied"`,
  label "Applied Jobs") next to Info/Search, following the exact same tab/pane pattern
  (`setContentPane()`, hash routing, `.content-tab`/`.content-pane` wiring). The pane renders a
  plain HTML table (`renderAppliedJobs()`) with every column — Date/Time, Platform, Company, Title,
  Location, Mode, Link (clickable, opens in a new tab) — sorted **reverse-chronological** by
  `timestamp`, with a "No applications yet." placeholder when empty. Populated on settings load
  (added to the same `chrome.storage.local.get` call as the other panes) and **live-updated** via
  the existing `chrome.storage.onChanged` listener pattern (same idiom as `popup.js`'s
  `eveApplyStats` listener), so the table refreshes without a reload when any platform appends a
  new record. `eveApplicationRecords` is included in Settings Export/Import's `EXPORT_KEYS`.

## Matching Notation (`..` / `*` = wildcard)

When the user writes a match pattern with dots (or `*`) as wildcards, interpret them as a glob/regex:

- **`..a..`** (or `...a...`, or `*a*`) means "matches any option/label that **contains `a`**" — unknown strings may appear before and after `a`.
- **`..a..b..`** (or `*a*b*`) means "matches text containing **`a` then `b` in that order**, with unknown strings allowed at the beginning, between them, and at the tail."
- General rule: each `..`/`*` is a wildcard (any run of characters); the literal segments must appear in the given order. This is exactly how `candidateMatch()` in `workday.js` treats `*` (a wildcard anywhere), used by the degree and field-of-study "select with precedence" pickers. Precedence still applies: earlier patterns win; if none match, take the first option in the list.

### Best-fit reasoning (regex matching is driven by the user's info)

When choosing which option a regex/precedence pattern should target, **reason about the best fit for the user based on `info/myworkdayjobs`** — do not match literal wording blindly. The user's profile (work authorization, education, experience, degree, field of study, citizenship, etc.) is the source of truth; the regex is just how we express "select the option that best represents *this* fact for *this* user." Concretely:
- Read the actual on-page options, then pick the one that most accurately reflects the user's real answer from the info bank, using precedence only to break ties among genuinely-fitting options.
- When adding new regex variants for a newly-seen question, first reason out the correct answer *for this user* from their info, then encode patterns that land on that answer across phrasings — never encode an option just because its text superficially resembles the pattern.
- If no option is a good fit for the user, prefer the safest/most-accurate default over a superficial text match, and log the question as unresolved in `info/myworkdayjobs`.

### Choice-control precedence and acknowledgements

- Across T2/T3/T5 question fillers, try to apply a banked answer through a dropdown/combobox first.
  Only when no matching dropdown answer is available, fall back to the matching checkbox or
  multi-checkbox option. The same topic/answer must work with either rendering.
- Any application question whose prompt contains `acknowledge` is affirmative: select Yes,
  Acknowledge, I Agree, or the equivalent affirmative option. Specific acknowledgement topics may
  provide option precedence, but must never resolve to No.

### Pasted/screenshot Q&A capture rule (whole project)

When the user pastes paragraphs that look like application questions/answers or sends a
**screenshot of a question + its answer control** (dropdown, multi-select, radio group, field
input, segmented buttons…), treat it as an implicit request to **analyze the questions and add
them to the shared question bank**. The user does not need to say "add", "save", or "bank":

- **If the user has already input/selected an answer in the screenshot → remember it**: that value
  is the user's answer, capture it as-is.
- **If no answer is present → reason it** from the user's real info (best-fit, per the rule above).
- If an answer cannot be derived safely from the screenshot, adjacent pasted answer, or existing
  bank, record it under `[OPEN QUESTIONS]` and ask; never silently omit the question.
- Then **merge, don't multiply**: if an existing root topic already covers the question, fold this
  phrasing into that topic as new regex variants; otherwise **register a new topic**.
- **Reason at register time**: a registered question has many phrasings AND its answer has many
  wordings across tenants. Extract generalized regex patterns (synonyms, optional clauses), and
  store the answer as an **ordered precedence list** — if the first candidate isn't in the on-page
  option list, try the next, and so on (same `candidateMatch`/precedence semantics as the degree
  picker). Never pin to the one literal string in the screenshot.
- Land the result in `info/myworkdayjobs` (topic + patterns + precedence + seen-log) and, for
  extension tasks (T2/T3), in the corresponding code bank with tests.

### "Work on <url>" = learn the step's questions into the bank

**"work on <url>" means: hand that URL to agent X**, scoped to whichever task the URL
belongs to (T2 → `work-on-page`; T3 → the Greenhouse flow; T5 → the
Indeed Smart Apply flow; T6 → the SmartRecruiters flow). X owns the
whole loop and reports back; open questions X can't answer are surfaced to the user.

The page is usually one step with questions. The core loop: **catch each question → extract a pattern/regex from its phrasing → check the existing info + question bank.**
- If an existing abstract/high-level topic already answers it → **add the extracted pattern to that topic** (generalize; don't duplicate). E.g. "Are you a prior employee of a Hitachi Group company?" is just another phrasing of `prior-employment` (→ No).
- If nothing covers it → **register a NEW topic** with the best-fit answer. Free-text "describe your specific experience" fields register with `text:'Yes'` (the user writes the detail).
- Verify each extracted regex matches the real question string and collides with nothing (extract `DEFAULT_APPLICATION_QUESTIONS`/`DEFAULT_VOLUNTARY_DISCLOSURES` and test in Node), log it in `info/myworkdayjobs`, then bump + reload.

## Regex Answer Syntax

When the user says `regex: *<pattern>*; <type>: <answer>`, it means:

- **Pattern**: glob-style (`*` = wildcard). Stored under `savedRegexAnswers` in storage. Matches against form field labels in Easy Apply.
- **Type + Answer** (after `;`):
  - `Yes` = binary field, default answer is "Yes"
  - `No` = binary field, default answer is "No"
  - `Yes / No` = binary field, answer is the given default
  - `text: <value>` = text field, default answer is `<value>` (`..` means empty/user must fill)
- Entries are stored as `{ pattern, type, answer }` in `savedRegexAnswers` chrome.storage.local key.
- `resolveSavedValue()` checks regex patterns as a fallback after direct key/label lookup.

## Checkmark Feature (Non-Easy Apply Jobs)

- **Location**: Checkmark button appears in the top-right corner of LinkedIn job cards that **DO NOT have an Easy Apply button**.
- **Manual Tracking**: For non-Easy Apply jobs, users can manually check the checkbox to mark jobs as applied.
- **Visual Feedback**: When checked (✓), the job card background turns light green (`rgba(76, 175, 80, 0.15)`), and the checkmark becomes green with a solid border.
- **Unchecked State**: Shows a hollow square (☐) with light gray background and dashed border.
- **Storage**: Marked jobs are stored in `appliedJobsLog` with jobId, URL, timestamp, and appliedAt date.
- **Applied checkmark dismisses the native card**: When the user changes Eve's checkmark from unchecked to applied, persist the canonical job ID first, then click LinkedIn's native **Dismiss \<job title\> job** action on that same card so LinkedIn removes it from the search results. Never click native Dismiss when the user is unmarking an applied job. If the native action is absent, keep the applied record and report/log the missing control rather than undoing the saved state.
- **Cross-session identity invariant**: Checkmark state has no day/session expiry. Persist and restore it exclusively by the canonical numeric LinkedIn job ID, extracted from `data-occludable-job-id`, `data-job-id`, `/jobs/view/<id>`, or `currentJobId`. Never store tracking/query text as part of `jobId`. Normalize and deduplicate legacy `appliedJobsLog` entries on read so previously saved query-suffixed IDs remain recoverable.
- **One control set per card**: LinkedIn commonly renders an outer result `<li>` and a nested `.job-card-container` for the same job. Resolve one canonical card root per job ID and inject exactly one Eve control set; remove stale nested duplicates. Re-run restoration after SPA mutations, URL changes, storage changes, and full reloads.

## Global Rules

- **Registered-domain availability only (user, 2026-07-27)**: Eve requests site access and injects
  UI/code only on explicitly registered platform/template domains in the manifest. Do not use
  `<all_urls>` and do not show any shell, popup, or status UI on unregistered sites. Adding a new
  site requires registering its narrow URL pattern and a real adapter; Zipline is registered.
- **Style Compatibility:** Every code update must keep UI styles readable and aligned in both light mode and dark mode.
- **Chrome DevTools MCP must be on:** Whenever working in this project, first **check that Chrome DevTools MCP is on; if it is not, turn it on** (or ask the user to enable it) before relying on any browser action. XC testing and the extension-update step both require it. If it genuinely cannot be enabled, say so and mark browser-dependent steps BLOCKED (Chrome MCP off) rather than skipping or faking them.
- **Update the extension via Chrome DevTools MCP:** After every edit and at the end of every chat, use Chrome DevTools MCP to reload/update the loaded Eve extension (per `auto-extension-update`), then verify the new version loaded. The manifest version bump is the auto-reload trigger; the MCP-driven reload + verification is how we confirm it took.
- **XC reload routine (every edit) — new tab, reload, close, restore:** After each edit, XC updates the extension via Chrome DevTools MCP without disturbing the user's tab. Exact steps, every time: (1) note the currently selected page (the tab to return to); (2) **open a NEW tab** to `chrome://extensions`; (3) reload Eve by clicking its reload button, piercing the shadow DOM (`extensions-manager` → `extensions-item-list` → `extensions-item#<id>` → `#dev-reload-button`), and confirm the new version; (4) **close that new tab**; (5) **re-select the previously active page** (bring to front). Never strand the user on `chrome://extensions`, and do not refresh a tab that is mid-OAuth/mid-flow without saying so.
- **Reloading the extension when its service worker is dormant (MV3):** The preferred reload is CDP-driven and never touches a user tab — attach to the Eve **service worker** target and evaluate `chrome.runtime.reload()`. But an MV3 service worker **terminates when idle** (and reliably ends up dormant after a Chrome restart), and a dormant worker has **no CDP target**, so `Target.getTargets` omits it and the reload fails with `SERVICE_WORKER_NOT_FOUND`. Confirmed 2026-07-25:
  - A content script's `chrome.storage` call does **NOT** wake it — those are served by the browser process, not the worker.
  - Opening `chrome-extension://<id>/popup.html` did **NOT** wake it.
  - Opening **`chrome-extension://<id>/settings.html`** via CDP `Target.createTarget` **DOES** wake it (that page messages the worker on load). Then run the `chrome.runtime.reload()` attach, then `Target.closeTarget` the page.
  So the working procedure is: **wake via `settings.html` → attach to the service worker → `chrome.runtime.reload()` → close the page → hard-refresh the target tab.** Ready-made helpers live in **`tools/cdp/`**:
  ```bash
  node tools/cdp/wake-sw.js    <extId> settings.html   # wake a dormant worker (no-op if awake)
  node tools/cdp/reload-ext.js <extId>                 # attach + chrome.runtime.reload()
  node tools/cdp/eval-sw.js    "<js expression>"       # evaluate anything inside the worker
  ```
  Falling back to `chrome://extensions` is a last resort — a `new_page("chrome://extensions")` call once coincided with the whole browser restarting.
  - Related: this Chrome runs with `--remote-debugging-port=9222 --user-data-dir=D:\2au\mcp\chrome-mcp-profile`, and after a restart it may bind the port to **`[::1]:9222` only**, which `chrome-devtools-mcp`'s `--browser-url=http://127.0.0.1:9222` cannot reach. Symptom: every MCP browser call fails with `Failed to fetch browser webSocket URL from http://127.0.0.1:9222`. Remedy: run **`node tools/cdp/tcp-bridge.js`** (IPv4→IPv6 loopback bridge on port 9222) and leave it running. If MCP browser access dies mid-session, check this first.
  - These helpers need the `ws` module; they search the global npm root and fall back to a plain `require('ws')`, so `npm i -g ws` fixes a "Could not locate the `ws` module" error.
- **Verify bank regexes by EXTRACTING them from `workday.js` — never by retyping them into a test.** Run **`node tools/bank-test.js`** after any change to `DEFAULT_APPLICATION_QUESTIONS` / `DEFAULT_VOLUNTARY_DISCLOSURES`. It reads the arrays out of the source, replays `runRegexChoiceStep`'s first-match rule against real question text, and asserts which topic wins. Why this matters: on 2026-07-25 a heredoc escaping slip (`\b` written as a single escape) wrote **literal backspace characters (0x08)** into nine places in the bank; one had already **shipped in 1.1.163** and was silently dead. Hand-typed tests passed because they were testing the retyped regex, not the file — so every assertion count produced that way was worthless. The test now also fails on any stray control character in `workday.js`. When editing regexes prefer the Edit tool over shell heredocs, which are what corrupted the escapes.
- **Update-then-refresh cycle (mandatory after every chat/code edit):** After every chat that changes code — and after every batch of code edits — the AI agent must run this cycle in order, every time, with no step skipped:
  1. **Bump version:** increment `eve/manifest.json` (patch by default). The version change is what triggers Chrome's extension auto-reload in development mode; never leave edits without a bump.
  2. **Update the extension:** use **Chrome DevTools MCP** to reload Eve (or the version-bump auto-reload / `chrome://extensions` reload as fallback). The updated version must show on the extension management page.
  3. **Refresh the target tab/page:** hard-refresh the exact page being worked on (LinkedIn or the Workday `/apply/...` tab) so the latest content script loads. Reloading the extension invalidates existing content-script contexts even if the floating UI still appears; a stale context fails with `Extension context invalidated` and must never be treated as a real result. The popup and settings page auto-reload from the service worker, but content-script pages do not.
- **Plugin Update After Edits:** Covered by the update-then-refresh cycle above — run it after every batch of code edits or AI-generated code changes.
- **`++` Prefix Convention:** When the user writes `++<text>`, it means: append `<text>` as a new instruction or note into `AGENTS.md` immediately.
- **All params must persist:** `eveParams` (search, ignore keywords, regex, delays), `savedAnswers`, and `savedRegexAnswers` must always survive extension updates. The `onInstalled` handler merges new defaults without wiping existing data. `persistSearchDraft()` now debounces to `saveSearchParams()` so every popup input change is auto-saved to `chrome.storage.local`.
- **Sharing config:** Users can share their full setup via Settings → Export Data (JSON download). Recipients use Import Data to restore.
- **Follow Company Field:** The "Follow {companyname}" field is not processed or saved. It is excluded from auto-fill and from saved answers. Always unchecked on form submission via `ensureConfirmCheckboxesChecked()`.

## Standard Response Format

For every response, at the final, describe the following required elements in this exact layout:

```markdown
### Summary

**What you wanted:**

1. [Goal 1]
2. [Goal 2]
   etc.

**What I have done:**

1. [Action 1]
2. [Action 2]
   etc.

**What failed:**

- [List any failures or write "None"]

**Recommended actions:**

- [List any recommended next steps]
```

At the end of every final response, append one extra line in this exact format:

```markdown
**Eve version:** x.y.z
```

Use the current value from `eve/manifest.json`.
