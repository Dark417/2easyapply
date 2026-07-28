---
name: add-regex
description: Teach Eve to recognize a Workday question by adding regex phrasing patterns (and its answer) to the question/answer banks, then reload.
---
# Add Regex Skill

Add one or more **regex phrasings** so a Workday question is recognized and answered automatically. Used by [[work-on-page]] when a step is stuck because the question text doesn't match any existing pattern. Save patterns as several phrasings (regex variants), not the one literal wording seen on the page — different tenants word it differently.

## Where patterns live
- **Screening / yes-no / single-choice questions** → `DEFAULT_APPLICATION_QUESTIONS` in `eve/workday.js` (durable, ships to everyone). Shape:
  ```js
  {
    topic: 'short-kebab-id',
    patterns: [/phrasing one/i, /phrasing two[\s\S]{0,120}variant/i],
    exclude: /optional — stop a broader entry stealing this/i,
    choose: 'yes' | 'no',
    followUp: { patterns: [/provide details/i], text: 'answer for a revealed text box' } // optional
  }
  ```
  Order matters: put the **most specific** question first so it wins over generic entries (e.g. a specific "unrestricted right to work" must beat generic "right to work").
- **User-specific phrasings** (not worth shipping globally) → `workdaySavedAnswers.applicationQuestions` (array of `{ topic, patterns:[glob…], choose, followUp }`); same-topic patterns merge into the defaults.
- **Voluntary Disclosures / Self-Identify options** → `DEFAULT_VOLUNTARY_DISCLOSURES` (predicate matches the desired option text).
- **Free-text field answers** → `regexAnswers` / the `info/myworkdayjobs` bank, resolved by `resolveAnswer(label, …)`.

## Procedure
1. Get the exact question text from the live page (via [[test-page]] / snapshot). Note whether the answer is Yes/No, a pick-one option, or free text.
2. Find the user's answer in `info/myworkdayjobs`. If none exists and it isn't safely derivable, add to `[OPEN QUESTIONS]` and ask — do not invent one (never for work auth, visa, sponsorship, salary, employment history).
3. Write **2–4 regex variants** covering realistic rewordings (synonyms, optional clauses via `[\s\S]{0,N}`), case-insensitive. Reuse an existing `topic` to extend it rather than duplicating.
4. Add `exclude` if a broader existing entry would otherwise match this question.
5. Also record the human-readable Q→A in `info/myworkdayjobs` `[QUESTION BANK]` and append the raw wording to `[SEEN QUESTIONS LOG]` so it's not re-discovered.
6. Bump the version and reload the extension **behind the scenes** (background tab, closed after), reload the target tab, then re-run [[test-page]] to confirm the question now auto-answers.

## Guardrails
- Prefer regex that generalizes; avoid pinning to one tenant's exact string.
- Keep `choose` consistent with the info bank; if the correct answer is genuinely ambiguous, ask rather than guess.
