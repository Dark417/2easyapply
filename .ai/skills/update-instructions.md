---
name: update-instructions
description: Promote reusable user and live-test discoveries into project instructions, Workday flow documentation, and the answer bank before implementation continues.
---
# Update Instructions Skill

Run after `update-agents` on every user chat, and after every XC test report.

1. Identify durable workflow rules, terminology, safety boundaries, selectors/states, answer variants, and orchestration patterns.
2. Update the narrowest authoritative location first:
   - cross-project rules and routing: `AGENTS.md`;
   - agent behavior: `.ai/agents/*.md`;
   - skill procedure: `.ai/skills/*.md`;
   - Workday state machine and test evidence: `design/task2-workday-flow.md`;
   - CV facts, regex question aliases, answers, seen questions, and unresolved fields: `info/myworkdayjobs`.
3. Never copy secrets from `.env`, browser storage, password fields, tokens, cookies, or private URLs into instructions, logs, source, or test reports.
4. Keep new rules concrete and non-duplicative. Replace superseded behavior instead of preserving conflicting instructions.
5. Complete these updates before code changes or the next XC test iteration.
