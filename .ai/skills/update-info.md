---
name: update-info
description: Capture reusable user personal/application info into the info answer bank at the beginning of every chat.
---
# Update Info Skill

Run at the **beginning of every chat**, right after `update-agents` and before `update-instructions` and any implementation.

## Purpose

Keep `info/myworkdayjobs` (the human-readable application answer bank for the user) complete and current. Whenever a user message, screenshot, attachment, or CV file contains **user info that can be added to the bank, add it** — so future form-filling reuses it instead of re-asking.

## What counts as user info (capture it)

- Contact/identity: name, preferred name, email, phone, address, location.
- Work authorization / visa / sponsorship facts.
- Experience: employers, titles, locations, dates, responsibilities.
- Education: schools, degrees, fields, dates, and school-not-in-list handling (e.g. "select Other").
- Skills (the canonical list under `[SKILLS]`).
- Certifications, links (LinkedIn, GitHub, portfolio, resume/cover-letter paths).
- Reusable answers to application questions and per-form preferences.

## Procedure

1. Scan the current user input (text + any screenshot/attachment) and referenced CV files for user info.
   Pasted paragraphs that look like application questions/answers and screenshots containing
   application questions are implicit instructions to analyze every visible question and add it
   to the shared question bank; the user does not need to explicitly say "add" or "save".
2. Place each fact in the correct section of `info/myworkdayjobs`: `[CONTACT]`, `[WORK AUTH]`, `[EXPERIENCE]`, `[EDUCATION]`, `[SKILLS]`, `[CERTS]`, `[LINKS]`, `[QUESTION BANK]`, `[ESSAYS]`, `[SEEN QUESTIONS LOG]`.
3. Update the existing entry instead of duplicating; keep facts concrete and non-conflicting.
4. Organize reusable application questions by canonical **topic/question**, with one authoritative
   answer followed by generalized regex/pattern families and exact observed ways the question was
   asked. Do not treat a single screenshot string as the reusable rule; extract the stable semantic
   pattern and keep the literal wording only as evidence under `[SEEN QUESTIONS LOG]`.
   Before writing patterns, reason about the semantic question being asked, discard incidental
   company/location/number details that do not change the answer, and use the smallest durable
   regex family that covers equivalent phrasings without stealing a neighboring topic.
5. If a form needs a field with **no known answer**, add it to `[OPEN QUESTIONS]` and never guess (especially work auth, visa, salary, employment history).
6. Never copy secrets (`.env`, passwords, tokens, cookies, private URLs) into the bank.

## Boundary vs. `update-instructions`

- `update-info` captures **user data** (who the applicant is, their answers) → `info/myworkdayjobs`.
- `update-instructions` captures **process/routing/selectors/flow** discoveries → `AGENTS.md`, `.ai/*`, `design/task2-workday-flow.md`.
