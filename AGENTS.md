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
