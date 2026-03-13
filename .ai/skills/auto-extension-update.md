---
name: auto-extension-update
description: Auto-reload/update the Abby Chrome extension through UI operations immediately after every extension code edit.
---
# Auto Extension Update Skill

Run this skill after any code edit under the extension project (especially files in `abby/`).

## Instructions
1. Detect extension-impacting edits (for example: `manifest.json`, `content.js`, popup/floating UI files, styles, or scripts in `abby/`).
2. Ensure the debug Chrome instance is open using the project-standard command:
   - `"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\temp\chrome_debug_profile" --no-first-run --load-extension="d:\2Alfred\easyapply\abby"`
3. Use UI operations against the debug browser session to reload/update the loaded Abby extension.
4. Validate the reload completed (no obvious extension load error) and continue task execution.
5. If reload/update fails, keep retrying with a fix loop until extension update is successful.