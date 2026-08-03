---
name: add-question
description: The single canonical skill for growing the shared answer bank. Triggered by "add/save <question>", a bare "question: answer" line, pasted form text, or screenshots — answered or not. Extracts a PATTERN for the question and a PATTERN for the answer, reasons the best-fit answer from the user's real info, and lands both in info/myworkdayjobs and the code banks (all platforms).
---

# add-question

Grow the answer bank from whatever the user hands over. **Never store a literal question string** —
a literal only matches the one page it was copied from. (This skill absorbed the former
`add-regex` skill; there is no separate skill for "just the regex".)

## Triggers (terse input is enough)

- `add <anything>` / `save <anything>` — one question, with or without an answer
- a bare `question: answer` line — bank it AND apply it to the fixed working tab
- a pasted paragraph/block of an application form (many questions at once)
- one or more screenshots of a form — **no verb needed**; a screenshot of questions is an
  implicit add
- `work-on-page` hitting an unrecognized question

Answer authority: if the user supplied/selected an answer (text, or visible in the screenshot),
it is authoritative — bank it, don't second-guess. Otherwise reason one out (below).

## Pipeline (do all of it, every time)

**1. Understand the question.** What is it *actually* asking? Separate the semantic invariant
from incidental detail. Company names, locations, specific numbers, punctuation, and legal
boilerplate do not become match tokens unless they change the answer.

**2. Find or create the topic.** Search the existing banks first (`info/myworkdayjobs`
`[QUESTION BANK]`; `DEFAULT_APPLICATION_QUESTIONS` in `eve/workday.js`; `DEFAULT_GH_QUESTIONS` in
`eve/greenhouse.js`). Same question, different words → **add patterns to the existing topic**.
A new topic is right only when the *answer* genuinely differs.
one topic = one question = many question patterns; usually 1–2 answer patterns.

**3. Extract the question pattern** (2–4 variants):

| Strip | Replace with |
|---|---|
| hiring company's name | `[\s\S]{0,40}` or drop the clause |
| specific number (18, 5 years) | `\d{1,2}` |
| specific location/role/product | bounded wildcard `[\s\S]{0,60}` |
| trailing `?`, `*`, `(required)` | nothing — never anchor on them |

Cover synonyms (`authorized`/`eligible`/`permitted`), optional clauses (`now or in the future`),
reordered wording, and the long explanation-paragraph form. Prefer bounded `[\s\S]{0,N}` gaps over
`.*` so a pattern can't span two questions. A slightly-broad pattern guarded by a good `exclude`
beats a narrow one that misses.

**4. Extract the answer pattern** — tenants word options differently:

| Answer shape | Encoding |
|---|---|
| plain Yes/No | `choose: 'yes' \| 'no'` (matches `Yes` and `Yes, I affirm…`) |
| one option among several | `optionMatch` regex, e.g. `/never worked/i` |
| granular option list | ordered `optionCandidates`, most specific first — first one the tenant offers wins |
| free text | `text: '…'` (sanitized: no `< > [ ] " { } \`) |
| dropdown reveals a details box | add `followUp: { patterns, text }` |
| could render as textarea OR dropdown | give the entry **both** `choose` and `text` |

**5. Prevent stealing.** Order matters — the most specific topic sits ABOVE the broader one
(first match wins). Every broadened pattern gets an `exclude` when a neighboring topic shares its
vocabulary. Classic collisions: age vs years-of-experience; salary-expectation vs current salary;
relocation vs relocation-where; sponsorship vs unrestricted-right-to-work; located-in-X question
vs location field. Add a contrasting regression case for each risky neighbor.

**6. Write it — all places, every time:**

1. `info/myworkdayjobs` `[QUESTION BANK]`, under the right `SECTION:` header, in the group format
   (topic, Answer + WHY it fits this applicant, Patterns, Exclude, Source). Append the raw
   observed wording to `[SEEN QUESTIONS LOG]`.
2. The code bank: `DEFAULT_APPLICATION_QUESTIONS` (or `DEFAULT_VOLUNTARY_DISCLOSURES` for
   EEO/self-identify) in `eve/workday.js`, AND `DEFAULT_GH_QUESTIONS` in `eve/greenhouse.js` when
   not Workday-specific, then `node tools/sync-indeed-bank.js` (Indeed splices from greenhouse).
   Use the Edit tool for regex edits — never shell heredocs (they once shipped literal 0x08).
   User-specific phrasings not worth shipping globally can go to
   `workdaySavedAnswers.applicationQuestions` instead.
3. Regenerate the beta shared bank: `node tools/build-shared-bank.js` (keeps
   `eve/question-bank.js` in sync even while the `eveUnifiedBank` flag is off).

**7. Verify and ship:**

1. `node tools/bank-test.js` and `node tools/gh-bank-test.js` — add a `routes()` assertion for
   EVERY question added this round plus one for the chosen answer; guard `indexOf` against `-1`.
   Must stay 100%.
2. Bump `eve/manifest.json` → `node tools/sync-abby.js` (until the abby migration completes) →
   reload (`tools/cdp/wake-sw.js` + `reload-ext.js`) → verify the SERVED file contains a new
   symbol.
3. Report tersely: topics added/updated, anything left open. No root-cause essays.

## Choosing the answer (when the user didn't give one)

Reason from `info/myworkdayjobs` — the option that best fits the applicant's **real information**,
not the closest text. Precedence only breaks ties. Standing answers:

- work authorization / unrestricted right to work → **Yes**; sponsorship → **Yes (H-1B transfer)**
- relocation, hybrid/office attendance → **always affirmative**, no confirmation needed
- prior employment with the hiring company/affiliates → **No**
- age / legal working age → **Yes**; generic "do you have experience with X" → **Yes**
- restrictive covenant, non-compete, debarment, government official → **No**
- any prompt containing `acknowledge` → affirmative; a single-option dropdown → select it
- EEO/demographics → per the `[DEMOGRAPHICS]` group; disability → "I do not want to answer"
  unless overridden

If an answer can't be safely inferred and being wrong would matter (salary, visa specifics, legal
attestation), **ask the user** (in-app question UI) and log it under `[OPEN QUESTIONS]` — never
silently omit or guess.

## Anti-patterns

- storing the exact question string, or anchoring on a company name
- a second topic for a question that already has one
- broadening a pattern without its `exclude`
- adding to `info/` but not the code bank, or vice versa — the bank is only real when both agree
  and the tests pass
- retyping regexes into tests instead of extracting them from source
