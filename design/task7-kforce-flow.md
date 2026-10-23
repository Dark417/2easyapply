# Kforce ("kf") Apply Online Flow — Task 7

Eve's apply adapter for `www.kforce.com` (extensible `KFORCE_HOSTS` list in `eve/kforce.js`, plus
a `content_scripts`/`host_permissions` entry in `eve/manifest.json` and `KFORCE_ARTIFACT_HOSTS` in
`background.js`). Implemented in **`eve/kforce.js`**, first shipped v1.1.292 and live-verified
end-to-end the same round (2026-08-24, "Java Software Engineer (Remote)", job
`1696~WQG~2186048T1~99`). Isolated from the other engines: runtime memory is the
**`kforceSavedAnswers`** key (seen-log only — the form has no employer screening questions, so
there is no regex question bank); in-flight state is `sessionStorage['eve_kforce_session']`.

## Pages (confirmed live 2026-08-24)

1. **Search / detail SPA** — `/find-work/search-jobs/#/…`; a job opens at
   `#/detail/<base64 id>/`. The detail view renders `button#TK_WIDGET_INITIATOR` ("Apply Today").
   Clicking it reveals `div#TK_WIDGET_CONTAINER` holding `form#ApplyWithForm` (POST to
   `/Jobs/<jobId>/ApplyOnline/`) with two entries: `.indeedDiv a` ("Apply With Indeed", never
   used) and `.TK_WIDGET[rel="form"] a` ("Apply Now" — an `<img>` link, `TK.redirectToLinkRequest`).
   Job title = the visible H1/H2 that is not "Search Jobs"; company is always Kforce.
2. **Apply Online form** — `/Jobs/<jobId>/ApplyOnline/`, classic ASP.NET single POST form
   (`#firstName` is the presence anchor). Controls, all light DOM:
   - text: `#firstName*`, `#lastName*`, `#emailAddress*`, `#emailAddressVerify*`,
     `#phoneNumberAll` (page splits it into hidden `phoneAreaCode/phoneExchange/phoneNumber`;
     Eve mirrors the 10 digits into those too), `#postalCode*`
   - selects: `#state*` (values are 2-letter codes, first option "Select State:" is empty),
     `#countryID*` (1 = USA, 2 = Canada, 10 = Other; defaults to 1)
   - resume: radios `resumeUploadType_0/1/2` (From this computer / cloud / paste) +
     `input[type=file]#uploadFileSystemResume`; the packaged resume attaches through a plain
     `DataTransfer` + `change` and the server accepted it (no CDP-trusted event needed here)
   - employment eligibility: radios `name="eligibility"` — `eligibility0` any employer,
     **`eligibility1` "solely for my present employer" (the user's standing answer)**,
     `eligibility2` requires sponsorship
   - `input#SubmitButton` (type=submit)
3. **Confirmation** — the POST redirects to
   `/tech-professionals-thank-you-for-applying/?jobid=…`. Leaving the ApplyOnline path (or a
   "thank you for applying" body text) while the session is `submitted` is the definitive success
   signal; Eve then writes the unified Applied Jobs record (`platform: 'kforce'`) and clears the
   session.

## Behaviour

- Panel (`Eve · Kforce`, gh/Indeed skeleton with the Auto Apply toggle) shows on every
  `www.kforce.com` page.
- **Auto ON + click**: detail → Apply Today → Apply Now (session `running`, job meta saved) → the
  form page resumes on load only because `activatedByUser` is set → fill → resume → eligibility →
  verify every `[required]` + file + eligibility → click Submit once → wait for the navigation →
  record. Any missing required field pauses with a list; a rejected submit surfaces the page's
  validation text. Submit is never clicked twice.
- **Auto OFF (Apply)**: one step per click — detail click opens the form; the first form click
  fills; a second click on a complete form submits.
- Nothing starts on page load without a user-activated session; toggling Auto only arms it.
- Values come from `eveProfile` (gitignored `eve/profile.local.json`): first/last name, email,
  phone, `state` (2-letter), `zip`, `country`.

## Root "Apply All" orchestration (v1.1.293–1.1.297, live-verified 2026-08-24)

Second, independent toggle on the search/list page (`#/?t=…`): **Auto Apply All (this search)**
(`eveKforceRootAuto`) + **Apply All** button. The per-page single-job toggle stays as it is.

- List anatomy: `ul.data-jobs li.row h2 a.linkForJob[href="#/detail/<id>/"]`; pagination is a
  `.data-job-pagination` "Load more" span (`Displaying 1 - 25 of N`), clicked until it disappears.
- Eve inserts a round mark (`.eve-kf-mark`) before every title: green ✓ = applied (from
  `eveApplicationRecords` platform `kforce`, matched by the `#/detail/<id>` in the record URL, plus
  this run's results), amber dashed = working in a background tab, red `!` = the run could not
  finish (reason in the tooltip). A `setInterval` re-decorates after the React list re-renders.
- Flow: root → `eve:kforce-reset` (closes stale child tabs) → for every not-applied card, up to
  **3 concurrent**, `eve:kforce-open-job` (background.js `chrome.tabs.create({active:false})`,
  tab id recorded in `kforceOrchestration.tabs`) → the child's `kforce.js` asks
  `eve:kforce-tab-role` at boot (retries 3× 500 ms on detail routes — the map write can race the
  content script), sees `orchestrated:true`, forces Auto on and runs the single-job flow →
  `eve:kforce-tab-done {ok, jobId, message}` → background stores `results[jobId]` and closes the
  tab → root's `storage.onChanged` marks the card and opens the next. 150 s per-job timeout.
- **Background-tab gotchas (both confirmed live):** (1) page detection must be *route*-based
  (`location.hash` contains `#/detail/`) — the SPA renders "Apply Today" after `document_end`, so a
  DOM check made child tabs boot as the root page; (2) the Apply Today dropdown's reveal animation
  never runs in a hidden tab, so never wait for the "Apply Now" link to be *visible* — it is in the
  DOM immediately and its click handler works while hidden; (3) the Apply Now POST focuses its tab
  — background.js `tabs.onActivated` hands focus straight back to `rootTabId`; (4) child tabs are
  created with the root tab's `windowId` — `tabs.create` defaults to the *focused* window and
  then rejects `openerTabId` ("Tab opener must be in the same window").
- **Resume upload is asynchronous:** on `change` the page (`Scripts/apply/resumeUpload.js`) uploads
  the file to a SignalR-backed service; only the `documentCompleted` callback fills hidden
  `#resumeGuid`/`#resumeData`/`#resumeFilename` and the parsed text into `#resume` (server needs
  ≥200 chars). Submitting earlier fails with "Resume is required (minimum 200 characters)" (seen
  under 3-way concurrency). `resumeUploadComplete()` gates Submit (60 s cap), and the post-submit
  confirmation wait is 25 s.
- Rules (user, 2026-08-24): 1.5 s settle before every Submit; only titles containing
  "engineer" are opened — others get a hard-red ✕ mark (`.eve-kf-mark.skipped`) and are never
  touched; a failed/timed-out child run is retried in a fresh tab up to 3 attempts before the
  card goes red `!`, so a finished run should leave every eligible job green.
- Buttons: while a run is on, the root button (and the single-job button) is an orange **Pause**
  (`.ea-btn-pause`) that stays until the user clicks it, the run ends, or an error stops it.
- Status dot: `.ea-status-running` (yellow) from the click until the run ends — including pauses
  and every later page of the same session (`flowInProgress()` reads the saved session) — red on
  error, green idle. Settings → Applied Jobs has a platform filter for the per-domain view.
