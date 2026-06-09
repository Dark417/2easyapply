# Agents
This `agents.md` is the central root file for AI agent instructions in this project. All agents and skills share and use this file alongside `.ai/` directory.

## Role of Agents.md
This file acts as the primary orchestrator that defines who calls which agents or skills, and delegates the tasks effectively.

## Architecture
- Root definition: `agents.md` (this file)
- Subagents, AI agents, and skills exist within the `.ai/` directory.

## Agents
- **`lead-architect`**: Oversees everything in the project, coordinates other AI agents, delegates workflows, and validates project progress.

## Skills
- **`update-agents`**: Triggered first on every chat/user input to check whether any instructions, patterns, or routing behaviors need to be updated in `agents.md`, or inside individual agent/skill files.
- **`chat-log`**: Used on every chat/user input to prepend log entries containing timestamps, user intents, and responses to the `msg-log.md` table.

## Global Jargon
- **menu**: Means the EZ Apply extension menu from Chrome top toolbar (extension popup panel).
- **popup**: Means the EZ Apply floating popup shown on LinkedIn pages when EZ Apply is enabled.
- Words written like **`'search'`**, **`'apply'`**, **`'step'`**, **`'info'`** refer to popup tabs.

## Auto Mode Flow
- **Trigger**: User sets mode to "Auto" then clicks Apply in the popup → `handleApplyAction()` → `startAutoApply()`.
- **Loop**: `runAutoApplyLoop()` fills fields from saved answers, clicks Next/Review/Submit automatically each step.
- **Missing fields**: Auto pauses (`autoApplyRunning = false`), sets `pendingResumeAutoApplyUntil` (120s window), shows "Fill required fields then click Next to continue". User fills manually and clicks Next; `hookNextButton` detects the click and resumes via `startAutoApply()`.
- **Post-submit**: After clicking Submit, `autoApplyPostSubmit = true` is set as a guard. `closeSubmittedModalIfPresent()` waits **2 seconds** then closes the confirmation window (Done → X dismiss → backdrop fallback). `autoApplyRunning` is re-asserted to `true` before calling `advanceToNextEligibleJob()` because `pollForModalLogic` may have reset it while the confirmation was open.
- **Next job**: `advanceToNextEligibleJob()` scrolls the left job list, finds the next eligible card, clicks it, opens Easy Apply, and restarts the loop. The `autoApplyPostSubmit` flag prevents `pollForModalLogic` from calling `resetAutoApplySession()` during this transition.
- **Known race**: `pollForModalLogic` runs every 1s. Without `autoApplyPostSubmit` guard, it would detect the missing modal after submit and reset `autoApplyRunning = false`, breaking the next-job advance.
- **Step advance timing**: After programmatic fill, LinkedIn's React validation runs async — Next button stays `disabled` briefly. Use `waitForAdvanceButtonEnabled(modal, 3500)` (polls every 200ms up to 3.5s) before concluding no button exists. After clicking Next, use `waitForStepChange()` (polls heading+field signature) so `runAutoApplyLoop` only re-runs once the new step is loaded.

## Data Persistence
- All user data is stored in `chrome.storage.local` (keyed by extension ID). Data is lost if the extension is removed/reinstalled or the ID changes.
- **Export/Import** buttons in the Settings page (`#export-data-btn` / `#import-data-btn`) let the user backup and restore all data as a JSON file.
- **IMPORTANT**: Plugin code and user data are kept separate. User data in `chrome.storage.local` is NOT shipped with the plugin code. When packing the plugin to share, only plugin code files are included, not user data.
- Keys backed up: `savedAnswers`, `savedAnswerGroups`, `savedRegexAnswers`, `abbyParams`, `abbyApplyMode`, `abbyApplyStats`, `abbyAppLogs`, `appliedJobsLog`, `settings`, `profiles`, `activeProfileId`, `profileData`, `abbyTheme`.
- **appliedJobsLog**: Persistent record of all jobs applied to (by job ID and URL). Used to detect already-applied jobs even after page reloads. Not part of plugin code.

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

## Global Rules
- **Style Compatibility:** Every code update must keep UI styles readable and aligned in both light mode and dark mode.
- **Plugin Update After Edits:** After every batch of code edits or AI-generated code changes, run the plugin update using the `update` skill to reload/rebuild EZ Apply.
- **Version Update:** After every code edit batch, increment the version in `abby/manifest.json` (patch version by default). Version increment automatically triggers Chrome's extension auto-reload in development mode (via manifest version change detection). Extension management page will show the updated version; no manual update needed.
- **Page Refresh After Update:** After the extension updates, users should refresh the LinkedIn page to load the latest content script. The popup and settings page auto-reload from the service worker.
- **`++` Prefix Convention:** When the user writes `++<text>`, it means: append `<text>` as a new instruction or note into `AGENTS.md` immediately.
- **All params must persist:** `abbyParams` (search, ignore keywords, regex, delays), `savedAnswers`, and `savedRegexAnswers` must always survive extension updates. The `onInstalled` handler merges new defaults without wiping existing data. `persistSearchDraft()` now debounces to `saveSearchParams()` so every popup input change is auto-saved to `chrome.storage.local`.
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
**EZ Apply version:** x.y.z
```
Use the current value from `abby/manifest.json`.
