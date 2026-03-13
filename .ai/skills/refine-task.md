---
name: refine-task
description: Turn rough workflows into explicit product steps, implementation tasks, and guardrails with targeted references when needed.
---
# Refine Task Skill

Use this skill when the user provides a rough workflow, operating procedure, or product idea that needs to become an explicit sequence.

## Workflow
1. Read the current intent and inspect `design/auto-flow.md` if it exists.
2. Capture the flow in product terms first: entry conditions, major steps, exits, data written, safety limits, and failure handling.
3. Convert that flow into an ordered task sequence that implementation can follow without reinterpreting the intent.
4. If outside examples or constraints are needed, gather only targeted references from web or git and summarize them briefly in the document or response.
5. Reflect reusable routing/process changes back into `AGENTS.md` or the relevant agent/skill file when appropriate.

## Output Rules
- Prefer updating `design/auto-flow.md` instead of scattering workflow notes across random files.
- Keep the task sequence concrete, ordered, and implementation-facing.
- Preserve user constraints exactly when they specify timing, rate limits, persistence, or data retention rules.
