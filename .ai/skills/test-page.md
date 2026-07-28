---
name: test-page
description: Drive a real webpage with the chrome-devtools MCP to run a described test (given input/workflow), then report the resulting page state and results — including where it got stuck.
---
# Test Page Skill

Exercise a live page in the user's own Chrome (the instance on the `chrome-devtools` MCP, `http://127.0.0.1:9222`) and report back what actually happened. This is the "xc" test used to verify a change or reproduce a stuck flow. It is read/drive-and-observe — it does NOT edit extension code (that is [[work-on-page]]).

## Inputs the caller gives you
- **Target**: a URL, OR a reference to an already-open tab in the running Chrome (title/URL fragment).
- **Task**: what to test, e.g. "test that the How-did-you-hear picker fills", plus any **input/workflow** to drive (values to type, buttons to click, the order of steps).

## Non-negotiable: the current job's Chrome instance
Always test in **the browser already running for the current job** — the instance on the `chrome-devtools`
MCP (`127.0.0.1:9222`) holding the authenticated session and the working tab. Never launch a fresh
Chrome, a new profile, or a separate Playwright browser: a clean instance has no session, so it lands
on the logged-out entry page and you end up testing the wrong state. If the connection is down,
restore it (`tools/cdp/tcp-bridge.js` for the `[::1]:9222` bind, `tools/cdp/wake-sw.js` for a dormant
MV3 service worker) instead of starting a second instance.

## Procedure
1. **Attach, don't disturb.** `list_pages` and find the target tab. If it isn't open, open it with `new_page({ background: true })` so the user's foreground tab is not stolen; `close_page` any tab you opened once done. Never force-navigate a tab the user is actively using without saying so.
2. **Snapshot first.** `take_snapshot` (prefer over screenshot) to get the a11y tree + uids. Use `evaluate_script` for precise DOM/state reads (values, selected tokens, which controls exist, console errors via `list_console_messages`).
3. **Drive the workflow.** Perform the described actions with `click` / `fill` / `fill_form` / `press_key`, using uids from the latest snapshot. Re-snapshot after each step that changes the DOM. Feed in the caller's inputs verbatim.
4. **Bound the run.** Actions can hang (SPA never advances, a modal blocks, a required field is unrecognized). Cap waits (`wait_for` with a timeout, or a short poll) and DO NOT loop forever. If it stalls, stop and capture the state — a stuck result is a valid, useful result.
5. **Report to the caller** (this is the whole point — the caller can't see the page):
   - **Outcome**: reached goal / partially / stuck.
   - **Where**: current URL + step/heading; if Workday, the mapped step name.
   - **State**: what got filled correctly, what's still blank/wrong, selected values, any console errors or pause/"missing field" messages the extension surfaced.
   - **If stuck**: the exact blocker (unrecognized question text, disabled Continue, validation error) and the offending element (label + selector/automation-id) so a fix can target it.
   - Keep secrets out of the report (no passwords/tokens/cookies/private URLs).

## Notes
- The Eve panel exposes state on `document.documentElement.dataset` (`eveWorkdayState`, `eveWorkdayMessage`) and the Workday flow shows status in `#ea-apply-status` — read these to know why it paused.
- After the extension is reloaded, already-open tabs run an orphaned content script until they reload; reload the target tab before testing a code change (see the reload rule).
- Pair with [[work-on-page]]: work-on-page makes the code change, then calls test-page to verify, iterating until the page automates through.
