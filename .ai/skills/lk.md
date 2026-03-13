---
name: lk
description: Run Abby's LinkedIn Easy Apply automation using persisted /params search settings and the local Python automation script.
---
# LK Skill

Use this skill when the user says `lk` or asks to run Abby's LinkedIn Easy Apply automation.

## Instructions
1. Read the repo-root `params` file first. Treat it as the source of truth for search keywords, ignored keywords, case-sensitivity flags, and LinkedIn click timing.
2. If Abby UI edits are part of the request, update the extension code so the Search and Apply tabs read from and persist back to `/params`.
3. Use the local Python automation script for LinkedIn search/open/apply orchestration instead of re-implementing the flow ad hoc.
4. Respect the persisted `auto` settings for randomized delays, rate limits, post-burst rest windows, and job-detail scrolling.
5. Log confirmed submissions to `app-log.xlsx` and use the logged unique job ID to prevent re-applying to the same job.
6. When the user asks to refine the overall apply process, coordinate with `lead-product` and `refine-task` and update `design/auto-flow.md`.
4. Keep all Abby-used data persisted by default. Only delete persisted data when the user explicitly requests deletion or a merge.
5. After editing extension files under `abby/`, run the `auto-extension-update` skill.
