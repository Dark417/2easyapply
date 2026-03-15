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
- **menu**: Means the Abby extension menu from Chrome top toolbar (extension popup panel).
- **popup**: Means the Abby floating popup shown on LinkedIn pages when Abby is enabled.
- Words written like **`'search'`**, **`'apply'`**, **`'step'`**, **`'info'`** refer to popup tabs.

## Global Rules
- **Style Compatibility:** Every code update must keep UI styles readable and aligned in both light mode and dark mode.

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
