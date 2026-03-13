# Abby — Design Product Document

> **Abby** is a Chrome extension that acts as a personal co-pilot when applying for jobs on LinkedIn. It lives as a floating popup on the screen, watches the user's Easy Apply flow, reads the form data step by step, and displays it in a clean table inside its panel.

---

## Vision

Abby is the ultimate LinkedIn Easy Apply assistant. It:
- Activates automatically when on LinkedIn job search pages.
- Detects the Easy Apply modal and stands by as the user applies.
- Reads and displays all fields / values of each application step.
- (Future) Auto-fills fields based on saved user profile data.
- (Future) Navigates multi-step applications autonomously.

---

## Requirements Log

Requirements are listed in descending timestamp order. Each requirement ID is prefixed with its session timestamp.

### Session 260308

| # | Requirement | Status |
|---|-------------|--------|
| 260313-R67 | Improve dark theme readability in Abby UI, simplify popup controls, add sun/moon dark-theme icon in popup header, remove popup version text, compact location/search fields, and always grey applied jobs on the current page in both manual and auto modes | ✅ Done |
| 260313-R66 | Popup menu moves dark theme toggle into the top-right header, stacks `Enable Abby` and `Apply Mode` toggles vertically in one row, and Abby floating panel must always restore on LinkedIn job pages even if a prior minimized flag was persisted | ✅ Done |
| 260308-R65 | Add canonical regex mappings for `*work*startup*` = `Yes`, `*Are you located in*` = `No`, and fully reset Abby Apply state when the modal closes so the next `Apply` click restarts cleanly | ✅ Done |
| 260308-R64 | Add canonical regex mappings for `Have you worked with*` = `Yes` and `*U.S. Citizen*` = `No`, and preserve the last seen step snapshot while resetting Abby Apply state after a mid-flow Easy Apply exit | ✅ Done |
| 260308-R63 | Add a canonical regex mapping for `Are you comfortable*` and seed the shared answer as `Yes` | ✅ Done |
| 260308-R62 | If Abby pauses on missing required fields, then after the user fills them manually and clicks `Next`, Abby should automatically resume the apply loop | ✅ Done |
| 260308-R61 | Clicking LinkedIn's visible `Easy Apply` button should reliably trigger Abby auto-apply even when LinkedIn wraps the click target in nested elements or composed/shadow event paths | ✅ Done |
| 260308-R60 | Add canonical regex mappings for `Have you ever worked for*`, `*relocate*`, and `*message*hiring manager*`, with shared stored values reused across steps including Voluntary Self-Identification | ✅ Done |
| 260308-R59 | Abby popup/menu should be taller and avoid internal scrolling so all controls stay visible at once | ✅ Done |
| 260308-R58 | The settings navigation should remove the redundant `Settings` entry and keep only `Info` and `Search`, with profile/contact info folded into `Info` | ✅ Done |
| 260308-R57 | When Abby auto-fills a text field and LinkedIn opens an autocomplete or dropdown, Abby must pick the matching option before continuing | ✅ Done |
| 260308-R56 | Canonical regex mappings must work across all steps, while non-canonical labels like location stay step-specific via composite keys | ✅ Done |
| 260308-R55 | Abby UI must show the current extension version in the floating panel too, and the manifest version must increment after each batch edit | ✅ Done |
| 260308-R54 | LinkedIn search setup must activate `Easy Apply` from the top filter bar when present, otherwise fall back to `All filters` and `Show results` | ✅ Done |
| 260308-R53 | Clicking LinkedIn's own `Easy Apply` button should also trigger Abby auto-apply, show company and role in Abby, and continue the same automation loop | ✅ Done |
| 260308-R52 | Abby search setup on a fresh LinkedIn tab must fill role and location, open `All filters`, toggle `Easy Apply` on, and click `Show results` | ✅ Done |
| 260308-R51 | `regex: *keyword*` means map any question containing that keyword to a shared canonical Abby label and always reuse the same stored value | ✅ Done |
| 260308-R50 | The Step tab must stay synced to the live next Easy Apply step while still allowing backward review of visited steps | ✅ Done |
| 260308-R49 | Step tab adds `<-` and `->` controls to move backward and forward through visited steps, with forward limited to the latest visited step | ✅ Done |
| 260308-R48 | Abby does not show or add the `Mark job as a top choice` step to its visible Step history | ✅ Done |
| 260308-R47 | Final auto-apply step scrolls for 1-2 seconds, submits, closes the modal, then scrolls the left job list for 1-2 seconds before moving to the next job | ✅ Done |
| 260308-R46 | Add canonical regex support for `green card` Yes/No questions | ✅ Done |
| 260308-R45 | Show popup version, disable Apply until search results are ready, auto-switch new search tabs into Apply, use an image-only minimized icon, and keep Easy Apply scoped to one job until manual submit | 🔄 In Progress |
| 260308-R44 | Default LinkedIn search should use `/jobs/search/`, always search `software engineer`, store only saved locations, default to `California, United States`, apply Easy Apply filter, and advance to the next visible job after discard | 🔄 In Progress |
| 260308-R43 | Normalize dynamic Easy Apply headings like `Apply to ***` into a shared section and hide the top-choice step entirely | 🔄 In Progress |
| 260308-R42 | Remove manual case-sensitivity toggles for ignore keywords and default to case-insensitive matching | 🔄 In Progress |
| 260308-R41 | Treat "menu" as the extension toolbar popup, move theme control there, and allow search initiation from that popup | 🔄 In Progress |
| 260308-R40 | Show `company - role` in the Apply status and keep the discard test rolling across the next eligible jobs until stopped | ✅ Done |
| 260308-R39 | Compact the floating Search tab, remove the placeholder saved-search option, and manage ignore keywords as removable persisted list items | ✅ Done |
| 260308-R38 | Make minimized Abby smaller, still movable, and show a compact `A` icon | ✅ Done |
| 260308-R37 | Move theme switching from the floating Abby panel into the extension popup menu | ✅ Done |
| 260308-R36 | Process changes must update instructions and design flow first, then code, then hand testing to the user unless live testing is explicitly requested | ✅ Done |

### Session 260307

| # | Requirement | Status |
|---|-------------|--------|
| 260307-R35 | Log confirmed submissions into `app-log.xlsx` with a stable unique job ID to prevent reapplying | ✅ Done |
| 260307-R34 | Create `design/auto-flow.md` and add `lead-product` / `refine-task` workflow refinement instructions | ✅ Done |
| 260307-R33 | Add persisted automation pacing config for randomized delays, rate limits, burst rest, and detail-pane scroll time | ✅ Done |
| 260307-R32 | Move Abby theme switching into a header menu instead of a dedicated visible toggle | ✅ Done |
| 260307-R31 | Abby floating panel supports a persistent light theme and a higher-contrast dark theme via a header toggle | ✅ Done |
| 260307-R30 | Add local Python `lk` automation script to bridge `/params` and trigger Abby auto-apply across LinkedIn job tabs | ✅ Done |
| 260307-R29 | Settings page exposes `/params` search config and orders saved answers by actual step order with Contact info first | ✅ Done |
| 260307-R28 | Remove mock default contact values from extension bootstrap/popup | ✅ Done |
| 260307-R27 | Add Abby `Apply` tab with page-side auto apply trigger | ✅ Done |
| 260307-R26 | Add Abby `Search` tab before `Step` with saved search text, dropdown, ignore keywords, and background-tab LinkedIn search trigger | ✅ Done |
| 260307-R25 | Add Abby floating panel minimize button that collapses to a single lightning icon and restores on click | ✅ Done |
| 260307-R24 | Persist LinkedIn search/apply config in repo-root `/params` with ignore keywords and LinkedIn click timing | ✅ Done |

### Session 260228

| # | Requirement | Status |
|---|-------------|--------|
| 260228-R23 | Both `linkedin.com/jobs/search` and `linkedin.com/jobs/search/` URLs activate Abby (substring match covers both) | ✅ Done |
| 260228-R22 | Content.js tracks `currentHeading`; `saveCurrentFields` writes to both `savedAnswers` (flat) and `savedAnswerGroups` (grouped by heading) | ✅ Done |
| 260228-R21 | Settings page: profile edit + saved answers grouped by step heading, editable, with row delete and Save All | ✅ Done |
| 260228-R20 | Gear icon and Settings footer button open `settings.html` in a new tab via `chrome.runtime.openOptionsPage()` | ✅ Done |
| 260228-R19 | Toggle auto-saves immediately; shows active/disabled sub-label | ✅ Done |
| 260228-R18 | Popup icon redesign: prominent toggle switch + gear icon + saved answers count stat | ✅ Done |
| 260228-R17 | Popup "Info" tab: editable table of all saved answers — edit, delete per row, save all, clear all | ✅ Done |
| 260228-R16 | `← Fill` button: if question matches saved answer, show Fill; click auto-fills the modal input | ✅ Done |
| 260228-R15 | Save button: persist answered fields by label key to `chrome.storage.local['savedAnswers']` | ✅ Done |
| 260228-R14 | Live sync: when user types in Easy Apply empty field, Abby table updates in real time | ✅ Done |
| 260228-R13 | Empty fields highlighted; required fields get `*` prefix | ✅ Done |
| 260228-R12 | Each field value: click-to-copy full text | ✅ Done |
| 260228-R11 | Wider Abby panel (440px), scrollable body, 50/50 two-column table with per-cell overflow scroll | ✅ Done |
| 260228-R10 | In each Easy Apply step, show all form field labels + values as a table inside Abby | ✅ Done |
| 260228-R9 | Shadow DOM piercing: modal lives inside `#preact-border-shadow-host` shadow root | ✅ Done |
| 260228-R8 | Extension popup dir renamed from `abby201` → `abby` | ✅ Done |
| 260228-R7 | Clear "Applying" text when modal is canceled or submitted | ✅ Done |
| 260228-R6 | Show "Applying: [step heading]" in Abby when Easy Apply modal is open | ✅ Done |
| 260228-R5 | Detect when user clicks Easy Apply and the modal appears | ✅ Done |
| 260228-R4 | Only activate on `linkedin.com/jobs/search` URLs | ✅ Done |
| 260228-R3 | Show a floating dark glassmorphism popup (Abby UI) on LinkedIn | ✅ Done |
| 260228-R2 | Use `logo.png` as the extension icon | ✅ Done |
| 260228-R1 | Extension is called "Abby" (nickname for easyapply plugin) | ✅ Done |

---

## Architecture

```
easyapply/
├── abby/               ← Chrome extension source
│   ├── manifest.json
│   ├── content.js      ← Core logic: shadow DOM, polling, field extraction
│   ├── background.js
│   ├── popup.html / popup.js
│   ├── ui.css          ← Abby's floating UI styles
│   └── logo.png
├── design/
│   ├── abby.md         ← This file. Design product doc.
│   └── simplify/       ← Research on Simplify Chrome extension
├── util/               ← Developer utility scripts
│   ├── ui-update.py    ← Auto-click "Update" in chrome://extensions via CDP
│   ├── read-errors.py  ← Read extension logs from debug port
│   ├── analyze-dom.py  ← Inspect live LinkedIn DOM via CDP
│   └── lk.py           ← `/params` bridge server + LinkedIn Easy Apply runner
├── agents.md           ← AI agent instructions & global rules
└── msg-log.md          ← Chat log history
```

---

## LinkedIn Easy Apply — Steps & Structure

LinkedIn Easy Apply is a multi-step modal. Each step has:
- A **heading** (e.g. "Contact info", "Work experience", "Additional questions")
- **Input fields** — text, dropdowns, radios, checkboxes
- **Navigation buttons**: Back, Next, Submit

The modal is rendered inside a **Shadow DOM** on `#preact-border-shadow-host`.

---

## Abby UI Spec

### Floating Panel
- Position: top-right, fixed, `z-index: 999999`
- Style: dark glassmorphism, gradient title
- Sections:
  - **Header**: `⚡ Abby` + green pulse indicator
  - **Step**: Current step name (e.g. "Contact info")
  - **Fields Table**: Label → Value for each visible form field

### Field Table
| Field Label | Current Value |
|-------------|---------------|
| Email address | xiaoxiaolei417@gmail.com |
| Phone country code | United States (+1) |
| Mobile phone number | 5713761882 |
