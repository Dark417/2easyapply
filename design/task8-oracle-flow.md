# Oracle Careers ("orc") — Task 8

Eve adapter for `careers.oracle.com` (Oracle Recruiting Cloud "Candidate Experience" SPA).
Implemented in **`eve/oracle.js`**, first shipped v1.1.302 (2026-09-26); the apply flow shipped
v1.1.308–1.1.315 the same day and was live-verified: 5 applications submitted end-to-end (Oracle
"We received your application" receipts), ~20 s per job. Isolated from the other engines.

## Why the OCI filter exists

The applicant is in Oracle's 6-month per-line cooldown for the OCI (Oracle Cloud Infrastructure)
organization. Every job card is marked so OCI roles are visible; Auto Apply applies to them last (green first, then yellow).

## Pages (confirmed live 2026-09-26)

- **Search list** — `/en/sites/jobsearch/jobs?…` (filters live in the query string; the user edits
  them by hand). Cards: `div.job-tile` → `a.job-grid-item__link[href*="/job/<id>/"]`, title
  `.job-tile__title`. 24 per page; `button` "SHOW MORE RESULTS" appends more.
- **Preview dialog** — clicking a card navigates (pushState) to `/jobs/preview/<id>/` and opens
  `oj-dialog.job-details-modal-container` → `.job-details` (includes a "similar jobs" list —
  `[class*="similar"]`, excluded from any keyword search). Close: `button.app-dialog__close`.
- **Job page** — `/job/<id>/` with `button.apply-now-button` (APPLY NOW).
- **Tenant API** — `<base data-apibaseurl="https://eeho.fa.us2.oraclecloud.com:443"
  data-sitenumber="CX_45001">`. Anonymous CORS read (no credentials):
  `/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById;Id="<id>",siteNumber=<site>`
  → the same fields the preview renders (`ExternalDescriptionStr`, `ShortDescriptionStr`,
  `External/InternalResponsibilitiesStr`, qualifications, …). `CorporateDescriptionStr` is the
  Oracle-wide boilerplate and is ignored.
- **My profile** — `/my-profile` (redirects home when signed out; sign-in is an e-mailed code).
  Applications: `li.cs-application-tile` → `a.cs-job-info__title` (`/job/<id>`),
  `.cs-job-info__location`, "Applied on MM/DD/YYYY"; Active and Inactive lists, Active paginated
  behind `button.cs-show-more-applications`. A tile WITHOUT "Applied on" is a draft (an interrupted
  apply left one) and is not an application.
- The tile's own `isAlreadyAppliedVisible` tag is not rendered by this tenant even when signed in;
  Eve still honours it if it appears.

## Apply flow (per job, all in the job's own tab)

Routes: `/job/<id>/` → APPLY NOW → `/job/<id>/apply/email` → `/job/<id>/apply/section/1..3` →
post-submit page (the candidate's "My Applications" view renders in place; the section route is
gone). Oracle remembers a recently verified account and can jump straight to the code step.

1. **E-mail step** — `#primary-email-1` (the configured Oracle account e-mail — from
   `eve/secrets.local.json` `oracleAccountEmail`, stored by background as `oracleAccount`; it is a
   different address from the profile e-mail), hidden `#legal-disclaimer-checkbox` (click its
   label), `#honey-pot-0` stays empty, NEXT.
2. **Code step** — "Confirm Your Identity", six inputs `#pin-code-1..6`, VERIFY, "Send New Code".
   Eve waits `CODE_REQUEST_LAG_MS` (6 s, user rule) then asks background
   `eve:get-verification-code` (see below) for a code e-mailed **after this tab started**
   (`TAB_STARTED_AT` / `codeRequestedAt`; never advanced on resend), excluding codes already
   rejected in this tab; types the digits, VERIFY, waits for `/section/`. A rejected code
   ("The code isn't valid") triggers one "Send New Code" and a retry (max 3 codes).
3. **Sections** (`fillSection()`): everything Oracle prefilled from the profile is KEPT and
   logged (`oracleSavedAnswers.seen[question] = { answer, source: 'prefilled', jobId, at }`);
   empty fields are answered from the profile / shared bank (`source: 'bank'`); an empty
   REQUIRED field with no answer pauses the job with the question named (`missing`).
   Control shapes, all light DOM:
   - Yes/No pills: `ul[role=radiogroup][aria-label=<question>] > button.cx-select-pill-section`
     (`aria-checked` / `--selected`). Live: ex-Oracle employee → No, government employee → No,
     legally authorized → Yes (all prefilled by Oracle from the previous application).
   - `cx-select` combobox: `input.cx-select-input[role=combobox]` + `#<id>-toggle-button`;
     options `#<id>-listbox [role=gridcell]`; a real pointer click on the cell commits. Composite
     date pickers (`.datepicker-row__input`, "Earliest Available Date", prefilled) and the
     disabled country-code prefix are skipped. Live: Gender (required, empty) → Male; Veteran
     Status → "I AM NOT A PROTECTED VETERAN".
   - Hidden checkbox groups: `input[type=checkbox].input-row__hidden-control` grouped by
     `.input-row`; single box = Yes/No question ("I am Hispanic or Latino." → No, left
     unchecked); group = option list ("Select the races you identify with." → Asian; the bank's
     race topic gained `/\braces?\b/`).
   - Free text `input.input-row__control` / `textarea`: profile first (`PROFILE_TEXT`: Full Name
     → e-signature, names, phone, links; e-mail → the Oracle account), then the bank. Live: Full
     Name (required, empty) → filled.
   Section 1 (contact/address) and 2 (education/experience/skills/resume/links) were entirely
   prefilled; section 3 needed Gender + Full Name.
4. **Submit** — NEXT per section; on the last section SUBMIT (only after `missing` is empty and
   no `.input-row--invalid` is visible). Confirmation = leaving the section route (the page
   re-renders the "My Applications" view; there is no dedicated thank-you route); the first 200
   chars of the page are kept in the result message. Then `markApplied()` (also the unified
   `eveApplicationRecords`, `platform: 'oracle'`), `eve:oracle-tab-done` → background closes the
   tab and refocuses the root.

## Root batch (search page)

- **Two mutually exclusive modes**, one per run (the Auto toggle is locked while running):
  Auto ON → **Auto Apply** = scan first, then every green (clean) not-yet-applied Senior job in
  the list; Auto OFF → **Apply selected (N)** = exactly the jobs ticked in the top-RIGHT box
  (`.eve-orc-select`, `sessionStorage['eve_oracle_selected']` per tab). There is no single-job
  apply. Click again → Pause (finishes the current job).
- **Batch by batch** (user, 2026-09-26): Auto Apply scans the loaded cards, applies to the
  not-yet-applied ones — **green first, then yellow (OCI)**; only applied / failed / non-Senior
  are skipped (user, 2026-09-26: OCI is an ordering, not a skip) — then clicks "SHOW MORE RESULTS" (`loadMoreOnce()`), scans/applies the new batch, and
  repeats until the button is gone. Scan alone iterates the same way (`scanCore()` → `scanCards()`
  per batch). Apply selected only uses the ticked (already loaded) cards.
- **One run at a time across all Oracle tabs** (`oracleRunLock` heartbeat, 5 s; a second tab
  refuses to start while another run is alive — two search tabs once ran batches concurrently,
  opened the same job twice and fought over the single pending code, re-arming Oracle's lock).
- **Sequential**: `eve:oracle-open-job` (background `orchOpenJob('oracle', …, {active:true})`
  — the tab opens IN FRONT so the user sees each tab open and close; the root stays put and is
  refocused after each job) → root polls `oracleOrchestration.results[jobId]` (5 min timeout →
  `eve:oracle-close-tab`) → next. Failures: red box with "!" and the reason as tooltip.
- **Keyword filter** (panel block on the page + popup block + Settings → Filters, global;
  comma-separated `eveKeywordFilter { enabled, keywords }`, user
  2026-09-26): on Oracle it applies to the card TITLE — a hit is treated like a level skip
  (hidden, never scanned / selected / applied; tooltip names the keyword). Plain entries match
  anywhere case-insensitively, `/re/` entries are regexes. Repaints on storage change.
- **Level gate** (user, 2026-09-26): only titles with "Senior"/"Sr" and none of
  `LEVEL_ABOVE_RE` (principal, staff, distinguished, director, VP, fellow, head, chief, architect,
  manager, lead, executive) are eligible. Everything else is HIDDEN from the list
  (`.eve-orc-hidden`), never scanned, opened or selectable.
- Orchestration bookkeeping is shared with Kforce (background `ORCH_KEYS`, `orchUpdate` …);
  Kforce keeps its background-tab behaviour, Oracle uses foreground tabs.

## Oracle's verification lock (found live 2026-09-26)

Oracle allows only a few identity-code attempts/resends per account; past that the flow shows
"Too Many Attempts. Try Again Later. You reached the maximum number of attempts. Try again in 30
minutes." (after NEXT on the e-mail step, or on VERIFY). While locked, every VERIFY fails and
re-arms the lock, "Send New Code" re-sends the pending code (Gmail threads them) or nothing at all.
Testing against Oracle during a lock only extends it — wait it out. The burst that
triggered it: a stale code typed once (previous job's still-unread e-mail inside the tab-start
window) + resends. Rules now:
- Oracle keeps ONE pending code per account: it is re-sent unchanged on every request (throttled
  to roughly one e-mail per few minutes; the same code was mailed 21:17 → 22:22) and only rotates
  after a successful VERIFY consumes it. Candidate = the newest Oracle code e-mail of the last hour
  (`CODE_LOOKBACK_MS`) that is neither consumed (`oracleConsumedCodes`, persisted on success) nor
  rejected in this tab; after a rejection only a code mailed after the rejection counts (Oracle
  auto-sends a fresh one then). Never filter by tab/landing time — the mail is often stamped
  before the step renders, and a landing frequently triggers no new mail at all.
- Never hammer: one resend per job at most; a rejected code waits for the fresh one Oracle sends
  by itself; a second rejection / no e-mail → `BACKOFF:5`.
- `pageRateLimitMinutes()` is checked on every flow pass and inside the e-mail / job-page waits →
  `RATE_LIMITED:<min>`; the root then waits with a live countdown (`waitMinutes`, Pause works)
  and retries the SAME job (3 attempts). The deadline is persisted (`oracleBlockedUntil`) so a
  run started during the block waits first without touching Oracle (each attempt can extend it).
- A pre-existing `.input-row--invalid` (e.g. Phone Number) no longer blocks NEXT; only a NEXT that
  does not advance reports the flagged rows.
- "Already applied" wording on the apply page → the job is marked applied (source
  `already-applied`) and skipped; before a batch, `/my-profile` is opened in a background tab
  (`profile-sync` pseudo-job, 12 s) to pick up manual applications — works only while signed in.

## Dead pending code (open issue, 2026-09-26 evening)

After the lock incident the account's pending code (494374) was re-issued unchanged for over two
hours on every path — apply NEXT, "Send New Code", the My Profile sign-in — and rejected by every
VERIFY (same tab or not, in and out of the lock). Nothing on Eve's side can mint a fresh one; only a
successful verification elsewhere (e.g. the "communicate by phone instead" SMS path, done by hand)
or Oracle's own expiry resets it. Guard: codes Oracle rejects are persisted (`oracleRejectedCodes`);
when the newest code on offer is one of them the child reports `DEAD_CODE` and the root STOPS the
batch with that guidance instead of looping (each rejection re-arms the 30-min lock).

## Verification-code service (generic, background.js)

`eve:get-verification-code { account, from, subject, codePattern, after, exclude, timeoutMs, pollMs }`
→ `{ code, title, issued, from }`. Reads Gmail's Atom feed
`https://mail.google.com/mail/u/<n>/feed/atom` (unread Inbox messages) on the Chrome profile's own
Gmail session — no API key, no app password, no setup; host permission `https://mail.google.com/*`
(fetch only, no content script). `/u/<n>/` is probed for the account and cached
(`gmailFeedIndex`). Second source: any open Gmail tab (`eve/gmail-reader.js`, read-only content
script on `mail.google.com`) answers `eve:gmail-scan` with the visible conversation rows — read
mail included, the list snippet carries the code — but Gmail renders only the displayed category,
and Oracle's mails land in "Updates", so this source helps only while that category (or a search)
is on screen. Polls every 3 s until a matching entry newer than `after` carries a code
(`codePattern`, else any 4–8 digit number); `exclude` skips rejected codes. Oracle's e-mail:
from `noreply@oracle.com`, "Your Oracle identity verification", summary "…one-time pass code:
NNNNNN…", arriving ~1 s after the request. **Constraint**: the feed only lists UNREAD mail — a
code e-mail opened in Gmail before Eve polls it is invisible to the service (the one 120 s
timeout seen live coincided with the inbox being read). Reusable by any future platform.

## OCI boxes and Scan

- **Key**: the numeric job id from `/job/<id>/` (= the requisition `Id`) — stable across filter
  changes, so marks persist when the result set grows or shrinks.
- Both boxes sit above the tile's link overlay and star button (`z-index: 2147483000`; hit-tested
  live — a click at the box's centre toggles it and never opens the preview).
- **Box** (`.eve-orc-box`, top-left of each tile, 3px border never filled): brown-yellow
  (`#B8860B`) = OCI, green = full description scanned clean, grey dashed = not scanned yet. A
  heavy ✓ (SVG mask, stroke 5) in the border colour = applied; red "!" = the apply run failed.
- **In-page pass** (every 1.2 s tick): the card's own text is matched against
  `/\bOCI\b|\bOracle\s+Cloud\s+Infrastructure\b/i`; a hit is saved as `{oci:true, source:'card'}`.
- **Scan** button: clicks "SHOW MORE RESULTS" until the list is complete, then checks every
  eligible card not already yellow or detail-scanned via the tenant API (4 concurrent; ~3 s for
  25 jobs). If the API is unreachable it falls back to opening the preview dialog, reading it,
  closing it — one at a time. Results `{oci, source:'detail', rule, match, context}`.
- **Skills sections are ignored** (user: every Oracle job lists OCI as a skill). The dedicated
  `External/InternalQualificationsStr` and `skills` fields are never searched, and inside a
  description `findOciOutsideSkills()` walks leaf blocks in reading order: a heading-like block
  (h1–h6, a short line ending in `:`, or a line that is entirely bold/underlined) matching
  `SKILL_HEADING_RE` switches skills mode on; the next non-skills heading switches it off; each
  API field starts fresh. Same walker on the preview fallback.
- `SCAN_RULE` (now 2) versions the matcher: detail results from an older rule show grey and are
  re-scanned by the next Scan. Card-text hits never go stale.
- **Applied harvest**: on `/my-profile`, every tick expands SHOW MORE and records each dated
  application into `oracleAppliedJobs` and — once per job id — into `eveApplicationRecords`.

## Storage

- `oracleJobScan` — `{ [jobId]: { oci, source, rule, match, context, title, scannedAt } }`
- `oracleAppliedJobs` — `{ [jobId]: { title, location, source, appliedAt, seenAt } }`
- `oracleSavedAnswers` — `{ seen: { [question]: { answer, source, jobId, at } } }` (bank later)
- `oracleOrchestration` — background tab map / results (transient); `oracleAccount` — secrets;
  `gmailFeedIndex` — account → `/u/<n>/`.
- `oracleJobScan` and `oracleAppliedJobs` are in Settings Export/Import.
