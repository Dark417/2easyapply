---
name: auto-extension-update
description: Reload the loaded Eve extension after every extension code edit, behind the scenes, and verify the served code.
---
# Auto Extension Update Skill

Run after any code edit under `eve/`. Never leave edits unshipped.

## Procedure

1. **Bump** the `eve/manifest.json` patch version.
2. **Mirror** `node tools/sync-abby.js` — Chrome currently loads the unpacked extension from
   `abby/`; this step goes away after `design/abby-migration.md` completes.
3. **Reload** (preferred, no user-visible tabs):
   - `node tools/cdp/wake-sw.js fmabdkmenomdhjmoopeilekopofmmhbm settings.html` — a dormant MV3
     service worker has no CDP target; opening `settings.html` wakes it.
   - `node tools/cdp/reload-ext.js fmabdkmenomdhjmoopeilekopofmmhbm` — attaches and runs
     `chrome.runtime.reload()`.
   - Fallback (last resort): open `chrome://extensions` in a NEW background tab, click Eve's
     reload button through the shadow DOM, confirm the version, close the tab, restore the
     previously active tab.
4. **Hard-refresh the target tab** — reloading orphans existing content scripts;
   `Extension context invalidated` is never a product result.
5. **Verify the SERVED code, not the version**:
   `node tools/cdp/eval-sw.js "fetch(chrome.runtime.getURL('<file>')).then(r=>r.text()).then(t=>({ver:chrome.runtime.getManifest().version, ok:/<new symbol>/.test(t)}))"`

## Troubleshooting

- MCP browser calls failing with `Failed to fetch browser webSocket URL`: Chrome bound
  `[::1]:9222` only — run `node tools/cdp/tcp-bridge.js` and leave it running.
- `Could not locate the ws module`: `npm i -g ws`.
- The debug Chrome runs with `--remote-debugging-port=9222 --user-data-dir=D:\2au\mcp\chrome-mcp-profile`.
