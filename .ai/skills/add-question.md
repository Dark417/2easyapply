---
name: add-question
description: Add or update application questions in the answer bank. Triggered by "add <question>", a pasted paragraph of questions, or screenshots — answered or not. Extracts a PATTERN for the question and a PATTERN for the answer, reasons out which answer fits the user, and writes both to info/myworkdayjobs and the code bank in eve/workday.js.
---

# add-question

Grow the answer bank from whatever the user hands over. **Never store a literal question string.**
A literal only ever matches the one page it was copied from — that is a save that does nothing.

## Triggers

Any of these means "run this skill":

- `add <anything>` / `save <anything>` — one question, with or without an answer
- a pasted paragraph or block of an application form (many questions at once)
- one or more screenshots of a form
- a bare `question: answer` line about the current working tab

The user may or may not supply the answer. If they do, that answer is authoritative — bank it and
do not second-guess it. If they don't, **reason one out** (see [Choosing the answer](#choosing-the-answer)).

## The four steps

### 1. Extract the question pattern

Strip everything page-specific, then generalise:

| Strip | Replace with |
|---|---|
| the hiring company's name | `[\s\S]{0,40}` or drop the clause entirely |
| a specific number (18, 5 years, 3 days) | `\d{1,2}` |
| a specific location / role / product | a bounded wildcard `[\s\S]{0,60}` |
| trailing "?", "*", "(required)" | nothing — never anchor on them |

Then write **2–4 variants** covering how the same question gets asked elsewhere: synonyms
(`authorized`/`eligible`/`permitted`), optional clauses (`now or in the future`), reordered wording,
and the long "explanation paragraph" form. Prefer bounded `[\s\S]{0,N}` gaps over `.*` so a pattern
can't span two questions in one block.

Aim for **flexible matching that catches more cases** — a slightly-too-broad pattern guarded by a
good `exclude` beats a narrow one that misses.

### 2. Extract the answer pattern

The answer is a pattern too, because tenants word their options differently:

- plain Yes/No → `choose: 'yes' | 'no'` (matches bare `Yes` *and* `Yes, I am at least 18 years old`)
- a specific option among several → `optionMatch` regex, e.g. `/never worked/i`, `/temporary work visa|h-?1b/i`
- a granular option list → **ordered** `optionCandidates`, most specific first; the first one the
  tenant actually offers wins (`Chinese*Mandarin*` → `Mandarin*` → `Chinese`)
- free text → `text: '...'`

**One question can render as a textarea on one site and a dropdown on another.** When that is
plausible, give the entry **both** `choose` and `text`. The runtime fills the textarea when there is
one and answers the dropdown when there isn't.

### 3. Group, don't append

Before creating a topic, look for one that already exists. If the new question is the same question
asked differently, **add patterns to that topic** — do not create a near-duplicate.

- one topic = one question = many question patterns
- one topic = usually 1–2 answer patterns
- answers within a topic must **not fight each other**: order them by priority, most specific first,
  and make sure a broader answer pattern can never win over a more specific one that also matches

Splitting into a new topic is right only when the *answer* genuinely differs.

### 4. Stop a broad pattern from stealing

Every broadened pattern needs an `exclude` if any neighbouring question shares its vocabulary.
Classic collisions:

- `age` (`\d{1,2} years`) vs. tenure (`years of experience`, `how many years`, `notice period`)
- `salary-expectation` vs. current salary / salary history / hourly rate
- `relocation` vs. `relocation-where` (the multi-select follow-up)
- `sponsorship` vs. `unrestricted-right-to-work`

Order matters: the most specific topic must sit **above** the broader one in
`DEFAULT_APPLICATION_QUESTIONS`, because the first matching entry wins.

## Choosing the answer

When the user didn't give one, reason it out from `info/myworkdayjobs` — pick the option that best
fits the applicant's **real information**, not the one whose text looks closest. Precedence only
breaks ties. Standing answers already established:

- work authorization / unrestricted right to work → **Yes**; sponsorship needed → **Yes (H-1B transfer)**
- relocation, hybrid/office attendance → **always the affirmative option**, no confirmation needed
- prior employment with the hiring company or its affiliates → **No**
- age / legal working age → **Yes**
- restrictive covenant, non-compete, debarment, government official → **No**
- EEO/demographics → per the `[EEO...]` group; disability → "I do not want to answer" unless overridden

If an answer genuinely cannot be inferred and getting it wrong would matter (salary, visa status,
a legal attestation), **ask the user** rather than guess, and log it under `[OPEN QUESTIONS]`.

## Where it gets written

Both places, every time:

1. **`info/myworkdayjobs`** — the human-readable bank, under `[QUESTION BANK]`.
   Questions live in **topical sections**; put the group under the right one:

   ```
   # ==== SECTION: LOCATION ====        current location, country of residence, work states
   # ==== SECTION: RELOCATION ====      willing to relocate, where, office attendance
   # ==== SECTION: WORK AUTHORIZATION ==  authorization, sponsorship, visa, I-9
   # ==== SECTION: WORK EXPERIENCE ====  years of experience, tech-specific experience, prior employment
   # ==== SECTION: SALARY ====          expectations, current comp, notice period
   # ==== SECTION: EDUCATION & SKILLS ==  degree, certifications, languages
   # ==== SECTION: LEGAL & COMPLIANCE ==  non-compete, debarment, government, sanctions, securities
   # ==== SECTION: CONSENT & ACKNOWLEDGEMENT ==  SMS, AI screening, truthfulness, terms
   # ==== SECTION: DEMOGRAPHICS (EEO) ==  race, gender, veteran, disability
   # ==== SECTION: FREE TEXT & ESSAYS ==  proud work, why this company, details boxes
   # ==== SECTION: MISC / TENANT-SPECIFIC ==  anything that fits nowhere above
   ```

   Group format:

   ```
   ## [TopicName] (topic: `topic-id` -> **Answer**)

   Answer: <the answer, and WHY it fits this applicant>
   Patterns:

   - <regex variant 1>
   - <regex variant 2>
   - <regex variant 3>

   Exclude: <regex>   # only when a neighbouring topic shares vocabulary
   Source: <tenant / date>
   ```

2. **the code bank** — `DEFAULT_APPLICATION_QUESTIONS` (or `DEFAULT_VOLUNTARY_DISCLOSURES` for the
   Voluntary Disclosures / Self Identify steps) in `eve/workday.js`. Mirror into
   `greenhouse.js` / `indeed.js` / `smartrecruiters.js` when the question is not Workday-specific.

## Finish the round

1. `node tools/bank-test.js` — add a `routes(<question text>, '<topic>')` assertion for **every**
   question added this round, plus an assertion for the chosen answer. It must stay at 100%.
   Assertions that use `indexOf` must guard against `-1`, or they pass vacuously.
2. Bump `eve/manifest.json` and reload the extension (`node tools/cdp/reload-ext.js`).
3. Report tersely: topics added/updated, and anything left as an open question.

## Anti-patterns

- storing the exact question string, or anchoring a pattern on the company name
- creating a second topic for a question that already has one
- broadening a pattern without adding the `exclude` that keeps it in its lane
- guessing at salary, visa status, or a legal attestation instead of asking
- adding to `info/` but not the code bank (or vice versa) — the bank is only real when both agree
