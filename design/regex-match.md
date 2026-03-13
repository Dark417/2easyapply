# Abby — Regex Question Mapping Reference

This document lists all canonical question mappings implemented in `abby/content.js` → `CANONICAL_QUESTIONS[]`.

**How to read this table:**
- **Step** — which step in the LinkedIn Easy Apply window this question appears under
- **Target** — the short canonical label Abby displays (what you see in Abby's panel)
- **Variants** — example phrasings that appear in the original Easy Apply form
- **Regex** — the actual pattern used in `content.js` to match and normalize
- **Answer Type** — the kind of value expected: `Y/N`, `Text`, `Date`, `URL`, `Select`

---

## Step: Contact Info

| No. | Step | Target | Variants (original Easy Apply phrasing) | Regex | Answer Type |
|-----|------|--------|------------------------------------------|-------|-------------|
| 1 | Contact Info | `LinkedIn Profile` | "LinkedIn URL", "LinkedIn profile link", "Please share your LinkedIn" | `/linkedin/i` | URL |
| 2 | Contact Info | `GitHub Profile` | "GitHub", "GitHub URL", "Link to your GitHub", "github.com profile" | `/\bgithub\b/i` | URL |
| 3 | Contact Info | `Website` | Any prompt containing "website", such as "Personal website" | `/\bwebsite\b/i` | URL |

---

## Step: Additional Questions

| No. | Step | Target | Variants (original Easy Apply phrasing) | Regex | Answer Type |
|-----|------|--------|------------------------------------------|-------|-------------|
| 3 | Additional Questions | `Work Authorization` | "Are you authorized to work in the United States?", "Are you legally authorized to work in the US?", "Do you have authorization to work in the US?", "Do you have the legal right to work in this country?", "Are you legally authorized for employment in the United States?" | `/authorized to work/i` · `/legally authorized to work/i` · `/authorized for employment in the united states/i` | Y/N |
| 4 | Additional Questions | `Require Sponsorship?` | "Do you now or in the future require sponsorship for employment visa status?", "Will you require visa sponsorship?", "Will you require H-1B transfer or sponsorship?", "Do you require sponsorship to work in the US?" | `/require.{0,25}(visa\s+)?sponsor/i` · `/sponsorship.{0,20}(work\|employ)/i` | Y/N |
| 5 | Additional Questions | `Are you a current client?` | "Are you currently a [CompanyName] client?", "Are you an existing client of ours?" | `/are you currently an? .{1,40} client/i` | Y/N |
| 6 | Additional Questions | `Why are you interested?` | "Why are you interested in this role?", "Why are you interested in [Company]?", "What excites you about this position?" | `/why are you interested in/i` | Text |
| 7 | Additional Questions | `Highest Education` | "What is your highest level of education?", "What is your highest academic level?", "Highest level of education completed" | `/highest (level of \|academic )?education\|highest academic level/i` | Select |
| 8 | Additional Questions | `Major / Field of Study` | "Field of study", "What was your major?", "Major", "Undergraduate major" | `/\bfield of study\b\|\bmajor\b/i` | Text |
| 9 | Additional Questions | `Work Schedule` | "This role requires being in our HQ in SF 2-3 days a week, please confirm that is possible", "You will be required to be on-site 3 days per week", "This position is hybrid 4 days a week" | `/days (a\|per) week/i` | Y/N |
| 10 | Additional Questions | `Job Application Agreement` | "Do you agree to the additional job application terms?", "Do you agree to our terms and conditions?" | `/do you agree to the additional job application terms/i` | Y/N |
| 11 | Additional Questions | `Green Card/Citizen` | "Do you have a green card?", "Are you a U.S. citizen?", "Are you a permanent resident?" | `/green card/i` · `/u\.?s\.?\s*citizen/i` · `/permanent\s+resident/i` | Y/N |
| 12 | Additional Questions | `Salary` | Any question containing "salary" or "compensation", such as "What salary are you targeting?", "Salary expectation", or "Target compensation" | `/\bsalary\b|\bcompensation\b/i` | Text |
| 13 | Additional Questions | `Years of Development Experience` | "How many years cloud development experience do you have?", "How many years of software development experience do you have?" | `/year.*experience.*develop/i` · `/develop.*experience.*year/i` | Text |
| 14 | Additional Questions | `How did you learn about this role?` | "How did you learn about us?", "How did you learn about this job?", any question beginning with "How did you learn about" | `/how did you learn about/i` | Text |
| 15 | Additional Questions | `Worked Here Before?` | "Have you ever worked for [Company]?", any question containing "Have you ever worked for" | `/have you ever worked for/i` | Y/N |
| 16 | Additional Questions | `Willing to Relocate` | Any question containing "relocate", such as "Are you willing to relocate?" | `/relocate/i` | Y/N |
| 17 | Additional Questions | `Message Hiring Manager` | Any question containing both "message" and "hiring manager" | `/message.*hiring manager/i` · `/hiring manager.*message/i` | Text |
| 18 | Additional Questions | `Are you comfortable?` | Any question beginning with "Are you comfortable", such as "Are you comfortable working onsite?" | `/are you comfortable/i` | Y/N |
| 19 | Additional Questions | `Work Startup Experience` | Any question containing "work" followed by "startup", such as "Have you worked with startup tooling?" | `/work.*startup/i` | Y/N |
| 20 | Additional Questions | `Located in {City}` | Questions containing "located ... in {city}", e.g. "Are you located in San Francisco?" | `located + in + city capture` (dynamic city key) | Y/N |
| 19 | Additional Questions | `Have you worked with?` | Any question beginning with "Have you worked with", such as "Have you worked with AWS?" | `/have you worked with/i` | Y/N |

---

## Step: EEO / Voluntary Self-Identification

| No. | Step | Target | Variants (original Easy Apply phrasing) | Regex | Answer Type |
|-----|------|--------|------------------------------------------|-------|-------------|
| 13 | EEO | `Race/Ethnicity` | "Please identify your race/ethnicity", full EEO paragraph beginning with "The following race categories are defined as follows:", multi-sentence paragraph listing "Hispanic or Latino", "White (Not Hispanic or Latino)", etc. | `/\brace\s*\/?\\s*ethnicity\b/i` · `/\brace categories are defined as follows\b/i` · `/\bhispanic or latino\b.*\bwhite\s*\(not hispanic or latino\)\b/i` | Select |
| 14 | EEO | `Veteran` | "What is your veteran status?", full VEVRAA legal paragraph ("Vietnam Era Veterans' Readjustment Assistance Act"), full USERRA paragraph ("Uniformed Services Employment and Reemployment Rights Act") | `/\bveteran status\b/i` · `/\bvevraa\b\|\bvietnam era veterans'? readjustment assistance act\b/i` · `/\bprotected veterans?\b.*\buserr?a\b\|\buniformed services employment and reemployment rights act\b/i` | Select |
| 15 | EEO | `Disability` | "Do you have a disability?", full self-ID paragraph starting with "How do I know if I have a disability?", paragraph mentioning "major life activities" and "person with a disability", paragraph starting with "Disabilities include, but are not limited to" | `/\bdo you have a disability\b/i` · `/\bhow do i know if i have a disability\b/i` · `/\bmajor life activities\b.*\bperson with a disability\b/i` · `/\bdisabilities include, but are not limited to\b/i` | Select |
| 16 | EEO | `Gender` | Any prompt containing "Gender" such as "What is your gender?" | `/\bgender\b/i` | Select (Default: Male) |

---

## Step: Signature / Review

| No. | Step | Target | Variants (original Easy Apply phrasing) | Regex | Answer Type |
|-----|------|--------|------------------------------------------|-------|-------------|
| 17 | Signature / Review | `Today's Date` | "Today's date", "Signature date", "Date of signature" | `/\btoday'?s date\b\|\bsignature date\b/i` | Date |
| 18 | Signature / Review | `Follow Company?` | Any review-step prompt that starts with "Follow ...", such as "Follow CompanyName to stay up to date" | `/^follow\b/i` (applied only on Review step) | Y/N (Default: No) |

---

## Answer Type Legend

| Value | Meaning |
|-------|---------|
| `Y/N` | Yes / No — rendered as a radio or Yes/No dropdown in Easy Apply |
| `Text` | Free-form text input or textarea |
| `Select` | Dropdown with multiple options (not just Yes/No) |
| `URL` | A URL string (LinkedIn, GitHub, portfolio link, etc.) |
| `Date` | A date field — Abby auto-fills with today's date dynamically |

---

## Notes

- **SKIP_HEADINGS**: Steps whose heading matches `/mark this job as a top choice/i` are silently skipped and not shown in Abby step history.
- **SKIP_TYPES**: Input types `file, hidden, submit, button, reset, image, search` are always excluded from the field table.
- **SKIP_LABELS**: Labels containing `deselect, upload, remove, delete, choose file, browse` are excluded.
- **Ignored fields rule**: ignored labels (for now includes `Mark ... top choice` and Resume-step `Resume`) are never shown, never saved, and never rendered in Settings sections.
- For canonical keys (Work Authorization, Sponsorship, Salary, etc.), Abby saves one shared answer reused across ALL companies and ALL steps.
- Canonical regex matching is step-agnostic, so these shared mappings still apply if LinkedIn renders the question under `Voluntary self identification` or another step heading.
- For shorthand like `regex: *salary*`, Abby adds a contains-match regex such as `/salary/i`, displays the question as `Salary`, and always reuses the same stored Abby value for later matches.
- For non-canonical fields (Company, City, etc.), Abby uses a composite key `[Step Heading] Label` to keep them distinct per step.
- Location prompts are dynamic canonical by city so each city gets its own saved key, for example `Located in San Francisco`, `Located in San Jose`.
- If the Easy Apply modal is closed mid-flow, Abby keeps the last recorded Step snapshot visible for review, but resets the Apply tab state so clicking `Apply` starts a fresh run again.
