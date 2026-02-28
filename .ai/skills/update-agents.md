---
name: update-agents
description: Decide and apply AI workflow instruction updates after each chat when user intent introduces reusable process/routing/pattern changes.
---
# Update Agents Skill

For every chat/user input, use this skill FIRST before anything else.

## Instructions
1. Analyze the context of the user intent to identify if there are instructions or routing rules that require updates.
2. If the user interaction introduced reusable process, routing, or pattern changes, apply these updates to the correct location.
3. Updates should primarily live in `agents.md` if overarching, or in specific agent and skill files inside the `.ai/` directory.
