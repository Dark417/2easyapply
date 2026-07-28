# 2easyapply — Eve

Chrome extension that fills and submits job applications across the major application platforms,
using a shared, regex-driven answer bank.

> "A ship in harbor is safe, but that is not what ships are built for." — John A. Shedd, *Salt from My Attic* (1928)

## Branch Rule
- Always use the `main` branch.
- Do not use `master`.

## Download And Install
1. Clone the repo:
   - `git clone git@github.com:Dark417/2easyapply.git`
2. Go into the project:
   - `cd 2easyapply`
3. Make sure you are on `main`:
   - `git checkout main`
4. Open the Chrome extensions page:
   - `chrome://extensions/`
5. Enable **Developer mode** (top-right).
6. Click **Load unpacked**.
7. Select the extension folder:
   - `<your-cloned-repo>/eve`
8. Pin Eve from the Chrome toolbar to manage, enable, and configure it.

## Supported platforms

Each platform is an independent content script — one engine per template, no shared runtime — so a
change to one can never break another. They all read the same answer bank.

| Platform | Injected on | Engine |
|---|---|---|
| LinkedIn Easy Apply | `*.linkedin.com` | `eve/content.js` |
| Workday | `*.myworkdayjobs.com`, `*.myworkdaysite.com` | `eve/workday.js` |
| Greenhouse | `job-boards.greenhouse.io`, `my.greenhouse.io`, embedding hosts | `eve/greenhouse.js` |
| Ashby | `*.ashbyhq.com` (also as a cross-origin embed) | `eve/greenhouse.js` |
| Indeed Smart Apply | `smartapply.indeed.com` | `eve/indeed.js` |
| SmartRecruiters | `jobs.smartrecruiters.com` | `eve/smartrecruiters.js` |

On a supported page a floating Eve panel appears with **Apply** (fill the whole application) and an
**Info** tab showing what the engine can see. LinkedIn additionally has the search-and-loop flow
driven from the toolbar popup.

## How it fills a form

1. **Resume and cover letter** are attached from the packaged artifacts where the form has a slot.
2. **Text fields** are filled one at a time — click the field, type, click away onto empty space,
   pause — because several platforms only commit and validate a value on blur.
3. **Typeahead fields** (Location, country, work-authorization status) are never just typed into:
   Eve types the search term, waits for the suggestion list, and **clicks** a suggestion. Typing
   alone leaves the widget uncommitted and the field submits empty.
4. **Choice controls** (dropdowns, radios, segmented Yes/No buttons, checkboxes) are answered from
   the question bank, one selection at a time with a deliberate pause and a click away between
   them. A dropdown with a single real option, or a lone unmatched checkbox, is treated as an
   acknowledgement and selected.
5. **Completeness gate** — Eve submits only when every required control is verifiably filled and no
   CAPTCHA is present. Otherwise it holds and reports exactly what is missing. CAPTCHAs are never
   touched.

## The answer bank

`DEFAULT_GH_QUESTIONS` (`eve/greenhouse.js`) and `DEFAULT_APPLICATION_QUESTIONS` /
`DEFAULT_VOLUNTARY_DISCLOSURES` (`eve/workday.js`) hold the shared bank; `eve/indeed.js` receives a
verbatim splice of the Greenhouse bank via `node tools/sync-indeed-bank.js`.

Each entry is a topic:

```js
{
    topic: 'sponsorship',
    patterns: [/(require|need)[\s\S]{0,30}sponsorship/i, /sponsor an immigration case/i],
    exclude: /please explain/i,          // stops a broad entry stealing a specific question
    optionCandidates: [/^\s*h-?1b\b/i, /^\s*yes\b/i],   // ORDERED precedence, first hit wins
    choose: 'yes',                       // affirmative/negative for plain Yes/No controls
    text: 'Yes, H1b transfer.'           // answer for a free-text control
}
```

Rules that keep it maintainable:

- **Patterns match the shape, never the sentence.** Company names, city names and example lists in
  a question are incidental and must not appear in a pattern.
- **First match wins**, so specific topics are ordered before broad ones; `exclude` resolves the
  rest.
- **`optionCandidates` is ordered precedence** — each candidate is a full pass over the option
  list, and the first candidate with any hit selects. This is how one topic answers correctly
  whether the control offers `Yes/No`, `C2: Proficient`, or `Native or Bilingual`.
- **Answers are reasoned for the applicant**, not string-matched to the option text.

Users can add their own entries at runtime from the Settings page; those are merged over the
shipped bank at fill time.

## Settings

The full Settings page holds profile values, saved answers, pacing, ignore keywords, and an
**Applied Jobs** log — every submission across platforms in reverse-chronological order.

## Development

- Extension source lives under `eve/`. It is a standalone extension; there is no local server.
- Every change round: bump `eve/manifest.json`, reload the extension, and verify the browser is
  serving the new code (a version bump alone proves nothing).
- Bank changes must keep both suites green:
  - `node tools/gh-bank-test.js` — Greenhouse/Ashby bank
  - `node tools/bank-test.js` — Workday bank
  Both **extract the real arrays from source** and replay the matching rule; never retype a regex
  into a test, and never write regexes through a shell heredoc (`\b` becomes a 0x08 backspace).
- Per-platform behaviour, DOM notes and live-confirmed selectors are documented in `design/`.

## Notes
- UI state, saved answers and the applied-jobs log are persisted in Chrome local extension storage.
- Local-only secrets (`eve/secrets.local.json`) are gitignored and never shipped.
