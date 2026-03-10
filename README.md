# 2easyapply

Chrome extension + automation helpers for LinkedIn Easy Apply workflows.

## Install Extension (Local)
1. Open Chrome and go to `chrome://extensions/`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked**.
4. Select this folder:
   - `D:\2Alfred\easyapply\abby`
5. Pin the extension from Chrome toolbar if needed.

## Update Extension After Code Changes
1. Keep Chrome running with remote debugging on `9222`.
2. Run:
   - `python util/ui-update.py`
3. This triggers **Update** on `chrome://extensions` for Abby.

## How To Use Abby
1. Open LinkedIn Jobs search/results page (`linkedin.com/jobs/...`).
2. Open Abby popup from the toolbar.
3. In popup:
   - Toggle **Enable Abby** on.
   - Set your search location.
   - Click **Search** if you want Abby to open/fill LinkedIn search.
4. Open **Settings** to manage:
   - Profile name
   - Saved answers by section
   - Search/apply timing and limits
5. During Easy Apply:
   - Abby detects fields, maps known regex questions to canonical keys, and reuses saved answers.
   - Click **Save** to persist new answers.

## Notes
- Extension source is under `abby/`.
- Runtime/search params are stored in local extension storage and `params` (when bridge is active).
