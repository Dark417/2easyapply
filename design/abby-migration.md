# Migrating the loaded extension from `abby/` to `eve/`

State (2026-08-03): Chrome (profiles `Default` and `Profile 2` in `D:\2au\mcp\chrome-mcp-profile`)
loads the unpacked extension from `D:\2Alfred\easyapply\abby` (id
`fmabdkmenomdhjmoopeilekopofmmhbm`). The unpacked-extension ID derives from the load path, so
re-pointing to `eve/` creates a NEW id and orphans all `chrome.storage.local` data under the old
one. Full storage was dumped to `tmp/abby-storage-backup-20260803.json` (761 KB — includes the
account password key; the file is gitignored, keep it local).

Until this migration completes, every shipped round mirrors `eve/ → abby/` via
`node tools/sync-abby.js` (bump → sync → reload → verify).

## Steps

1. **User (manual, ~2 min)** — in the debug Chrome (`:9222` profile):
   - `chrome://extensions` → remove the "Abby (easyapply)" entry (or leave it disabled).
   - Load unpacked → select `D:\2Alfred\easyapply\eve`.
   - Repeat for the second profile if it is used.
   - Tell the agent: `migrate abby`.
2. **Agent** — on `migrate abby`:
   - Find the NEW extension id (`chrome://extensions` page via CDP, or
     `/json` targets containing `chrome-extension://`).
   - Restore storage into the new extension: wake its service worker
     (`node tools/cdp/wake-sw.js <newId> settings.html`) and evaluate
     `chrome.storage.local.set(<backup JSON>)` in chunks
     (`node tools/cdp/eval-sw.js`), using the freshest backup in `tmp/` (re-dump from the old
     extension first if it is still loaded).
   - Verify: spot-check `workdaySavedAnswers`, `savedAnswers`, `eveApplicationRecords`,
     `eveParams` exist; open Settings and confirm the Applied Jobs tab renders.
   - Update the extension id constant in `tools/cdp/*.js` (`EXT_ID`) to the new id.
   - Delete `abby/` and `tools/sync-abby.js`; remove the sync step and the abby paragraph from
     `AGENTS.md` (Extension directories & deploy); update the memory fact about the served
     directory.
   - Bump, reload, verify served code from `eve/`.

## Rollback

If anything fails, the old `abby/` copy and the storage backup still exist — re-add abby via Load
unpacked and nothing is lost.
