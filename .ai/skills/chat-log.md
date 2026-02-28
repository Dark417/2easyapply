---
name: chat-log
description: Prepend a log entry into msg-log.md for every chat/user input.
---
# Chat Log Skill

For every chat/user input, you MUST run this skill to document it.

## Instructions
1. Prepend a log entry into the `msg-log.md` file (right underneath the table header).
2. The format is a Markdown table.
3. The table has three columns:
   - **Time**: Format is `yymmdd-hh:mm` (e.g., `260228-14:50`).
   - **User Input**: A short summary of what the user wanted.
   - **Response**: A short summary of the response, including what the AI actually did (but not too short).
