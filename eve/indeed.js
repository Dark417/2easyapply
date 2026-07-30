// Eve — isolated Indeed Smart Apply adapter (Task 5).
// Owns the smartapply.indeed.com application flow: a PER-STEP state machine (like Workday's),
// where each step is one page of the Smart Apply wizard (resume selection, contact info,
// screener questions, demographics, review). Reuses the floating-UI styling
// (ui.css / #eve-floating-ui) but shares NO runtime state with the LinkedIn, Workday, or
// Greenhouse adapters: Indeed memory lives in its own `indeedSavedAnswers` chrome.storage key.
//
// DUPLICATION NOTE: small primitives (clean/visible/esc, setNativeValue, bulletize, glob→regex,
// the packaged-artifact fetch) are adapted copies from eve/greenhouse.js / eve/workday.js.
// They are deliberately copied, not imported — each content script stays self-contained per
// platform. DEFAULT_INDEED_QUESTIONS is spliced VERBATIM from greenhouse.js's
// DEFAULT_GH_QUESTIONS (tools/sync-indeed-bank.js) so the shared answer bank regexes are never
// retyped (see the bank-test control-character lesson in AGENTS.md).
//
// HARD AUTOMATION GATE (same contract as Workday/gh):
// - Nothing ever starts on page load. The user's explicit Apply / Auto Apply click is the ONLY
//   trigger; a pause is resumed by another explicit Apply click.
// - Auto mode loops through steps until review; Manual fills the current step and advances
//   exactly one step per click.
// - Eve NEVER clicks an Indeed Submit control in this flow slice: the review step reports
//   "ready to submit" and holds (INDEED_SUBMIT_ENABLED = false).
(function () {
    'use strict';

    // ── Host detection (extensible, like GH_HOSTS) ────────────────────────────────────────────
    const INDEED_HOSTS = [
        'smartapply.indeed.com'
        // future Indeed Smart Apply hosts go here (one line each; mirror manifest + background)
    ];
    const hostIn = list => list.some(host => location.hostname === host || location.hostname.endsWith(`.${host}`));
    if (!hostIn(INDEED_HOSTS)) return;
    if (window !== window.top) return; // Smart Apply renders top-level; captcha iframes are not ours

    // ── Extension namespace ───────────────────────────────────────────────────────────────────
    const NS = 'eve';
    const MSG = type => `${NS}:${type}`;
    const PANEL_ID = `${NS}-floating-ui`;
    const THEME_KEY = `${NS}Theme`;

    // ── Constants ─────────────────────────────────────────────────────────────────────────────
    const INDEED_INFO_KEY = 'indeedSavedAnswers';   // Indeed-only runtime memory
    const POSITION_KEY = 'eve_indeed_panel_pos';
    const SESSION_KEY = 'eveIndeedSession';         // per-tab (sessionStorage) auto-loop session
    // Standing rule: no general action delay. The ONLY deliberate delay is a typeahead/search
    // settle (none observed on Indeed yet; constant kept for parity with Workday/gh).
    const ACTION_DELAY_MS = 0;
    const SEARCH_SETTLE_MS = 500;
    // Per-selection pacing (user, 2026-07-27, shared with the gh/Ashby engine): each SINGLE
    // selection (dropdown option, radio, checkbox) gets 0.5s to commit before the next control.
    const SELECTION_SETTLE_MS = 500;
    const MAX_AUTO_STEPS = 30;
    // Submit-on-complete (user-approved 2026-07-27, like the gh rule): when the review step is
    // reached and EVERY required field is verified filled, Eve clicks Submit once and waits for
    // Indeed's confirmation (URL -> /form/post-apply, "Your application was submitted…"). If
    // anything required is missing it names the items and holds instead. First live submission
    // (Infosys "Graph DB Developer") was user-triggered and confirmed on 2026-07-27.
    const INDEED_SUBMIT_ENABLED = true;
    // Referenced by the spliced question bank (same value as greenhouse.js).
    const SALARY_EXPECTATION = '160000';
    const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024;
    // Which packaged documents this engine may request. Their real filenames and sizes live in
    // eve/profile.local.json (see eve/profile.example.json) and are resolved by background.js.
    const ARTIFACT_IDS = ['resume', 'coverLetter'];

    // Identity / profile values from info/myworkdayjobs [CONTACT]/[LINKS]/[EXPERIENCE].
    // Location override (user, 2026-07-26): Dallas everywhere.
    // PLACEHOLDER identity. The real values live in the gitignored eve/profile.local.json
    // (copy eve/profile.example.json and fill it in); background.js loads that file into
    // extension storage as `eveProfile` and INDEED_PROFILE is merged from it at fill time, so a
    // fresh clone answers with ITS OWN details rather than the author's.
    const INDEED_PROFILE_DEFAULTS = Object.freeze({
        firstName: "Jane",
        lastName: "Doe",
        fullName: "Jane Doe",
        email: "you@example.com",
        phone: "(555) 555-0100",
        city: "Dallas",
        state: "Texas",
        country: "United States",
        postalCode: '75023',
        streetAddress: '1 Example St',
        cityStateZip: 'Dallas, TX 75023',
        linkedin: "www.linkedin.com/in/your-handle/",
        github: "https://github.com/your-handle",
        currentCompany: "Your Current Employer",
        currentTitle: "Your Current Title",
    });
    // Initials for 'by initialing below' certifications, derived from the configured name.
    function initialsFrom(name) {
        return String(name || '').split(/[s.-]+/).filter(Boolean).map(part => part[0].toUpperCase()).join('');
    }
    let INDEED_PROFILE = { ...INDEED_PROFILE_DEFAULTS };
    async function loadRuntimeProfile() {
        try {
            const stored = await storageGet(['eveProfile']);
            const identity = stored && stored.eveProfile;
            if (identity && typeof identity === 'object') INDEED_PROFILE = { ...INDEED_PROFILE_DEFAULTS, ...identity };
        } catch { /* no stored profile — placeholders stand */ }
        INDEED_PROFILE.initials = initialsFrom(INDEED_PROFILE.fullName || (INDEED_PROFILE.firstName || '') + ' ' + (INDEED_PROFILE.lastName || ''));
        // Label-driven fields capture profile values, so rebuild them from whatever is current.
        INDEED_PROFILE_FIELDS = buildINDEED_PROFILE_FIELDS();
        return INDEED_PROFILE;
    }
    function buildINDEED_PROFILE_FIELDS() {
        return [
        { label: /^first name/i, value: INDEED_PROFILE.firstName },
        { label: /^last name/i, value: INDEED_PROFILE.lastName },
        { label: /full (legal )?name|^(legal )?name$/i, value: INDEED_PROFILE.fullName },
        // "Legal First and Last Name" (user, 2026-07-27, mirrored from greenhouse.js) — a labeled
        // variant of the same legal-name field.
        { label: /^legal first and last name$/i, value: INDEED_PROFILE.fullName },
        { label: /^e-?mail/i, value: INDEED_PROFILE.email },
        { label: /phone/i, value: INDEED_PROFILE.phone },
        { label: /linked ?in/i, value: INDEED_PROFILE.linkedin },
        { label: /github|git hub/i, value: INDEED_PROFILE.github },
        { label: /^(personal )?(website|portfolio|site)\b/i, value: INDEED_PROFILE.github, shortLabelOnly: true },
        { label: /street address|address line/i, value: INDEED_PROFILE.streetAddress },
        { label: /^city(, state)?( \(optional\))?$/i, value: INDEED_PROFILE.city },
        { label: /city, state\b/i, value: `${INDEED_PROFILE.city}, TX` },
        { label: /^state\b|province/i, value: INDEED_PROFILE.state },
        { label: /postal code|zip code/i, value: INDEED_PROFILE.postalCode },
        { label: /^country\b/i, value: INDEED_PROFILE.country },
        // "Current or Most Recent Employer" (user, 2026-07-27, mirrored from greenhouse.js) — the
        // same J.P. Morgan Chase & Co. value the user calls "JPMorgan"; generalized so "most recent
        // employer" / "present employer" phrasings match without a second spelling of the name.
        { label: /current (company|employer)|(current or )?most recent employer|present employer/i, value: INDEED_PROFILE.currentCompany },
        { label: /current (job )?title|^(job )?title$/i, value: INDEED_PROFILE.currentTitle }
        ];
    }
    let INDEED_PROFILE_FIELDS = buildINDEED_PROFILE_FIELDS();

    // ── Question bank (spliced verbatim from greenhouse.js DEFAULT_GH_QUESTIONS) ─────────────
    // Same first-match-wins contract: `patterns` match the question text; `exclude` protects
    // specific entries; `choose: 'yes'|'no'`, `optionMatch`, `optionCandidates` (ordered
    // precedence), `text` for free-text controls. Never guesses: unmatched required questions
    // pause the flow with a named report. Extend via indeedSavedAnswers.questions.
        // BEGIN spliced bank (from greenhouse.js DEFAULT_GH_QUESTIONS — do not edit here; run tools/sync-indeed-bank.js)
    const DEFAULT_INDEED_QUESTIONS = [
        {
            topic: 'degree',
            // "Degree Type" as a CHECKBOX list (Ashby screenshot 2026-07-27:
            // Undergraduate/Bachelors | Master's | PhD | MBA) is the same question as the dropdown.
            patterns: [
                /^degree$/i,
                /^degree (type|level)$/i,
                /highest (level of )?degree/i,
                // "What is your highest completed level of education?" (user, 2026-07-27) — the same
                // question phrased around education rather than the word "degree".
                /highest (completed )?level of education/i,
                /highest education( level)?/i,
                /level of education (you have )?(completed|obtained)/i
            ],
            optionCandidates: [/^master['’]?s( degree)?$/i, /^master/i],
            optionLabel: 'Master’s Degree'
        },
        {
            // "Do you live in one of the following states? Alabama, Alaska, Delaware, …" (user,
            // 2026-07-28). Companies ask this because they are NOT set up to employ in those
            // states — no payroll/tax registration there — so living in one is disqualifying.
            // The applicant is in Texas, which is not on such lists, so the truthful answer is No.
            //
            // The `exclude` is the safety catch: if the listed states DO include the applicant's
            // own state, this entry steps aside and the question is left for a human, because
            // then the honest answer would be Yes. Update the state name here if the profile
            // moves (it mirrors the profile's `state`).
            topic: 'state-exclusion-list',
            patterns: [
                /do you (live|reside)[\s\S]{0,40}(in )?(one of |any of )?the following states/i,
                /are you (located|based|living)[\s\S]{0,40}(one of |any of )?the following states/i,
                /(live|reside) in any of these states/i
            ],
            exclude: /\btexas\b/i,
            choose: 'no'
        },
        {
            topic: 'state',
            patterns: [
                /^state$/i,
                /^state\/province$/i,
                /what u\.?s\.? state do you currently reside in/i,
                /current state of residence/i,
                // "Which U.S. State or Canadian Province do you reside in?" (user, 2026-07-28).
                /which (u\.?s\.? )?state( or [a-z ]+province)? do you (currently )?reside/i,
                /state (or province )?(of residence|you reside in)/i
            ],
            // A question that names the CITY as well wants the combined "Dallas, TX" text answer
            // (topic current-location-text), so it is excluded here.
            exclude: /\bcity\b/i,
            optionMatch: /^\s*texas\s*$/i,
            optionLabel: 'Texas',
            // Searchable versions of this list filter as you type.
            search: 'texas',
            text: 'Texas'
        },
        {
            // "By initialing below, you hereby agree…" certification/confidentiality blocks (user,
            // 2026-07-28). The initials are DERIVED from this installation's own name (see
            // initialsFrom), so it is correct for whoever installed Eve rather than a literal.
            topic: 'initials',
            patterns: [
                /\binitials\b/i,
                /by initial(ing|ling)? (below|here)/i,
                /(please |type |enter )initial(s)?\b/i
            ],
            profileKey: 'initials'
        },
        {
            // GPA (user, 2026-07-27): 3.65, but "only fill when required" — `requiredOnly` means the
            // answer is used only when the control is actually marked required, so an optional GPA
            // box is left blank rather than volunteering a number nobody asked for.
            topic: 'gpa',
            patterns: [
                /\bgpa\b/i,
                /grade point average/i
            ],
            requiredOnly: true,
            text: '3.65'
        },
        {
            // "Where did you go for college?" (user, 2026-07-28) — a question rather than a short
            // field label, so it needs a bank topic; the answer is this installation's own school.
            topic: 'school-attended',
            patterns: [
                /where did you (go|attend)[\s\S]{0,20}(for )?(college|university|school)/i,
                /(which|what) (college|university|school) did you attend/i,
                /name of (the )?(college|university|school) you attended/i
            ],
            profileKey: 'school'
        },
        {
            topic: 'mailing-address',
            patterns: [/complete current mailing address/i, /^mailing address$/i],
            profileKey: 'mailingAddress'   // resolved from the runtime profile
        },
        {
            topic: 'current-location-north-america',
            patterns: [
                /are you currently located in north america/i,
                /(currently )?(located|based|residing) in north america/i
            ],
            choose: 'yes'
        },
        {
            topic: 'us-canada-location-or-authorization',
            patterns: [
                /currently based in (the )?(u\.?s\.?|united states) or canada[\s\S]{0,100}authorized to work/i,
                /based in (the )?(u\.?s\.?|united states|canada)[\s\S]{0,60}and\/?or[\s\S]{0,60}authorized to work/i
            ],
            choose: 'yes'
        },
        {
            topic: 'country-of-residence',
            patterns: [
                /what is your country of residence/i,
                /current country of residence/i,
                /country (where|in which) you (currently )?reside/i,
                // "In which country do you reside?" (screenshot 2026-07-27) — question word order,
                // which the "country (where|in which) you reside" pattern above cannot reach.
                /(in )?which country do you (currently )?(reside|live)/i,
                /country (of|in which)[\s\S]{0,20}(reside|residence|live)/i,
                /what country do you (currently )?(reside|live) in/i
            ],
            // Searchable version of this list (typeahead): typing "uni" surfaces "United States".
            search: 'uni',
            optionMatch: /^\s*(u\.?s\.?|united states(?: of america)?)\s*$/i,
            optionLabel: 'U.S.',
            text: 'United States'
        },
        {
            topic: 'based-in-ny-or-sf',
            patterns: [
                /are you (currently )?based in new york or san francisco/i,
                /(currently )?(based|located|residing) in (new york|nyc)[\s\S]{0,40}(or|and)[\s\S]{0,30}san francisco/i,
                /(currently )?(based|located|residing) in san francisco[\s\S]{0,40}(or|and)[\s\S]{0,30}(new york|nyc)/i
            ],
            // A CONDITIONAL question ("IF you are based in SF, SLC or NYC, are you able to commute
            // to the office three days per week?", user 2026-07-27) is about ABILITY, not residency
            // — it belongs to the office-attendance affirmative and must never be answered No here.
            exclude: /\bif you are (based|located)|are you able to|can you (commute|work)|commute to the office/i,
            choose: 'no'
        },
        {
            // "If you are not currently based in the SF Bay Area, will you require relocation
            // ASSISTANCE?" -> No (user, 2026-07-27). Distinct from every willing-to-relocate topic:
            // the applicant relocates at their own arrangement and asks the company for nothing.
            // Matched by the loose "relocat… assist…" shape (either word order), which is what gives
            // the widest coverage across wordings; ordered FIRST so no residency or willingness
            // topic can claim it.
            topic: 'relocation-assistance',
            patterns: [
                /relocat\w*[\s\S]{0,40}assist/i,
                /assist\w*[\s\S]{0,40}relocat/i,
                /(require|need|request)[\s\S]{0,30}relocation (support|help|package|benefits?)/i
            ],
            choose: 'no'
        },
        {
            // "Do you currently live in the San Francisco Bay Area?" (user, 2026-07-27) — a plain
            // single-region residency question, distinct from `based-in-ny-or-sf` (which requires
            // BOTH New York and San Francisco named together). The region name is incidental; match
            // the shape (residency verb + "Bay Area"/named region), not the literal sentence.
            topic: 'bay-area-residency',
            patterns: [
                /(live|living|reside|residing|resident|based|located)[\s\S]{0,40}\b(san francisco )?bay area\b/i,
                /\b(san francisco )?bay area\b[\s\S]{0,40}(do you|are you|currently)?[\s\S]{0,10}(live|reside|resident|based|located)/i
            ],
            // A question that pairs the location with an ONSITE SCHEDULE ("…are you currently
            // located in the Bay Area AND open to 4-5 days onsite?") is answered from an option
            // list whose choices include "not currently in the Bay Area but open to relocation" —
            // the honest pick. Answering plain Yes here would take the option that claims the
            // applicant already lives there (user, 2026-07-28), so it is handed to
            // office-attendance-requirement, whose candidates put relocation first.
            exclude: /\bonsite\b|\bin[- ]office\b|days? (per|a) week|open to (this|the) schedule|willing to relocat|open to relocat/i,
            choose: 'yes'
        },
        {
            // "Where do you live?" in all its phrasings. The answer is the same whatever the
            // control shape: a plain input gets the text; a typeahead/dropdown gets the search
            // term typed, then the FIRST suggestion clicked (user rule 2026-07-27) — see
            // `locationSearch` and fillTypeaheadCombo().
            topic: 'current-location-text',
            patterns: [
                /please list your current location[\s\S]{0,30}(city|state|province)/i,
                /current location[\s\S]{0,30}city[\s\S]{0,20}(state|province)/i,
                /current city and state( of residence)?/i,
                /what is your current (city|location|city and state)/i,
                /(city|city and state)[\s\S]{0,25}(of )?residence/i,
                /where (are you|do you) (currently )?(live|reside|located|based)/i,
                /where are you (currently )?(located|based|living|residing)/i,
                /what (city|city and state|location)[\s\S]{0,30}(do you|are you)[\s\S]{0,25}(live|reside|located|based)/i
            ],
            text: 'Dallas, TX'
        },
        {
            topic: 'remote-us-work-states',
            patterns: [
                /remote u\.?s\.? location[\s\S]{0,60}state\(s\)[\s\S]{0,40}able to work/i,
                /what state\(s\)[\s\S]{0,40}able to work in/i
            ],
            text: 'CA, WA, TX'
        },
        {
            // Explicit user override (2026-07-26): for restricted-country citizenship lists,
            // choose only the exact none-listed option. Keep separate nationality/additional-
            // citizenship questions independent from this answer.
            topic: 'restricted-country-citizenship',
            patterns: [
                /citizenship[\s\S]{0,160}(specific|following|listed) countries/i,
                /government contracts[\s\S]{0,160}prohibit employment[\s\S]{0,160}citizenship/i,
                /indicate whether you currently hold citizenship[\s\S]{0,100}(specific|following|listed) countries/i
            ],
            optionMatch: /^\s*i do not hold citizenship in any of the countries listed\s*$/i,
            optionLabel: 'I do not hold citizenship in any of the countries listed'
        },
        {
            topic: 'additional-citizenship',
            patterns: [
                /in addition to u\.?s\.? citizenship[\s\S]{0,100}citizenship in any other country/i,
                /dual or multiple citizenship/i
            ],
            text: 'People’s Republic of China'
        },
        {
            topic: 'know-someone-at-company',
            patterns: [
                /do you currently know anyone who works for/i,
                /know anyone[\s\S]{0,50}(company|stratolaunch|windwright)/i
            ],
            text: 'N/A'
        },
        {
            // "Are you presently a US Person? A 'U.S. Person' is defined as a: Lawful Permanent
            // Resident: U.S. Citizen OR Legal Immigrant with a 'Green Card', Protected Individual
            // granted asylum or refugee status" (user, 2026-07-27) -> No. This is an export-control/
            // ITAR-style US-Person status disclosure, NOT a work-authorization question — the
            // applicant is on an H-1B (not a citizen, green-card holder, or asylee/refugee), so the
            // answer is No even though work-authorization questions elsewhere answer Yes. Distinct
            // patterns (the "US Person"/green-card/asylum definition) keep it from ever colliding
            // with work-authorization or unrestricted-right-to-work, which stay Yes.
            topic: 'us-person-status',
            patterns: [
                /are you (presently|currently)? ?a u\.?s\.? person/i,
                /\bu\.?s\.? person\b[\s\S]{0,250}(lawful permanent resident|green card|asylum|refugee)/i,
                /lawful permanent resident[\s\S]{0,120}(green card|u\.?s\.? citizen)/i,
                /legal immigrant with a[\s\S]{0,20}green card/i
            ],
            choose: 'no'
        },
        {
            // "Are you a U.S. Citizen or Green Card holder?" (Promise/Ashby, 2026-07-28) — a
            // simpler citizenship/green-card question, distinct from the "US Person" ITAR-style
            // definition above (no "lawful permanent resident"/"asylum"/"refugee" wording). Same
            // answer for the same reason: the applicant is on an H-1B, not a citizen or green-card
            // holder. Ordered so it never collides with plain work-authorization (stays Yes) or
            // visa-sponsorship (stays Yes) topics — this one is specifically citizen-or-green-card.
            topic: 'us-citizen-or-green-card',
            patterns: [
                /are you a u\.?s\.? citizen or green card holder/i,
                /\bu\.?s\.? citizen\b[\s\S]{0,20}\bor\b[\s\S]{0,20}green card holder/i
            ],
            choose: 'no'
        },
        {
            // User override 2026-07-26: unrestricted right/work authorization -> Yes.
            // Ordered BEFORE the broader work-authorization topic.
            topic: 'unrestricted-right-to-work',
            patterns: [
                /unrestricted (right|work authorization|legal authorization|authorization) to work/i,
                /unrestricted work authorization/i,
                // "without THE NEED FOR sponsorship" (Ashby screenshot 2026-07-27) is the same
                // question as "without sponsorship" — the old patterns only allowed a
                // company/employer/visa qualifier and fell through to the generic topic.
                /authorized to work[\s\S]{0,50}(u\.?s\.?|united states)[\s\S]{0,60}without (the )?(need (for|of) |needing |requiring |company |employer |visa )?sponsorship/i,
                /work in (the )?(u\.?s\.?|united states)[\s\S]{0,60}without (the )?(need (for|of) |needing |requiring |company |employer |visa )?sponsorship/i
            ],
            choose: 'yes'
        },
        {
            // "Do you currently require sponsorship to COMMENCE employment?" -> No (H-1B holder can
            // start today). Ordered before the generic sponsorship entry; excludes "in the future".
            topic: 'sponsorship-current-commence',
            patterns: [
                /currently require[\s\S]{0,80}(sponsor|to commence)/i,
                /require[\s\S]{0,60}sponsor[\s\S]{0,60}commence/i
            ],
            exclude: /now or in the future|in the future/i,
            choose: 'no'
        },
        {
            // "Will you now or in the future require (visa) sponsorship?" -> Yes.
            // Confirmed live on 6sense 2026-07-26 (react-select, options Yes/No).
            topic: 'sponsorship',
            patterns: [
                // Widened 0,30 -> 0,80 (Plaid/Ashby, 2026-07-28): "require Plaid to provide
                // immigration-related support or sponsorship" puts ~48 chars between the verb and
                // the noun — the company name plus a support/sponsorship object clause.
                /(require|need)[\s\S]{0,80}sponsorship/i,
                /sponsorship[\s\S]{0,40}(employment )?visa/i,
                /(h-?1b|work visa)[\s\S]{0,40}sponsor/i,
                // Ashby/Notion phrasing (screenshot 2026-07-27): the COMPANY NAME sits between
                // "require" and "to sponsor", and the object is an "immigration case", so neither
                // of the patterns above reached it.
                /(require|need)[\s\S]{0,40}to sponsor[\s\S]{0,40}(immigration case|visa|petition)/i,
                /sponsor an immigration case/i,
                /immigration-related support or sponsorship/i
            ],
            exclude: /if so[\s\S]{0,40}(explain|describe)|please explain/i,
            // Some boards answer this question with a VISA-TYPE list instead of Yes/No (Ashby
            // screenshot 2026-07-27: OPT | H1B | TN | None | Other). Ordered precedence: the H-1B
            // option first, then the plain affirmative for ordinary Yes/No controls — never "None".
            optionCandidates: [
                /^\s*h-?1b\b/i,
                /^\s*yes\b/i,
                /^\s*i (can|agree|acknowledge|affirm)\b/i
            ],
            choose: 'yes'
        },
        {
            // Combined free-text sponsorship + explanation question (Relativity screenshot,
            // 2026-07-26). The generic sponsorship entry explicitly excludes explanation wording.
            topic: 'sponsorship-details',
            patterns: [
                /sponsorship for employment[\s\S]{0,100}if so[\s\S]{0,30}(explain|describe)/i,
                /(require|need)[\s\S]{0,40}sponsorship[\s\S]{0,100}please explain/i
            ],
            text: 'Yes, H1b transfer.'
        },
        {
            // Multi-option immigration-status picker (Cape/Ashby 2026-07-26, banked in
            // [WorkAuthStatus-Select]): pick the option naming an existing temporary work visa /
            // H-1B transfer; fall back to "authorized now but needs sponsorship later"; NEVER the
            // citizen/greencard option and never "will require new sponsorship to begin work".
            // `optionCandidates` = ordered precedence, each candidate is a full pass (project-wide
            // Screenshot Q&A capture rule).
            topic: 'work-auth-status-select',
            patterns: [
                /which best describes your (current )?work authorization/i,
                /which[\s\S]{0,60}(describes|applies to)[\s\S]{0,40}work authorization/i,
                /(select|choose)[\s\S]{0,30}(work authorization|immigration|visa) status/i,
                // A country/qualifier can sit between "your current" and the noun ("your current
                // U.S. work authorization status?", Ashby screenshot 2026-07-27).
                /what is your (current )?[\s\S]{0,20}(work authorization|visa|immigration) status/i,
                /(current )?(u\.?s\.? )?work authorization status/i,
                // "Are you currently authorized to work in the country outlined for this job (e.g.
                // H-1B status)?" (user, 2026-07-27) — phrased as a yes/no question but answered with
                // a STATUS list, so it belongs here rather than with the plain work-authorization
                // topic. Ordered before it, which this entry already is.
                /authorized to work in the country outlined/i,
                /(are you )?(currently )?authorized to work in the country[\s\S]{0,80}(h-?1-?b|visa|status)/i
            ],
            // The plainly-worded "are you LEGALLY authorized to work…" question is a Yes/No handled
            // by the work-authorization topic below — never steal it.
            exclude: /unrestricted|legally authorized/i,
            // Searchable version of this picker (Ashby typeahead): typing "h1" is what surfaces the
            // "H-1B Visa" option — see fillTypeaheadCombo().
            search: 'h1',
            // Ordered precedence. NEVER the "authorized to work for ANY employer (citizen,
            // permanent resident)" option — that would be false — and never the "status unknown"
            // option. Note real forms write H-1B as "H1-B" too, hence the flexible hyphens.
            optionCandidates: [
                /(temporary work visa|h-?1-?b)[\s\S]{0,80}(transfer|sponsor)/i,
                /work authorization requires[\s\S]{0,60}(renewal|sponsorship)/i,
                // "U.S. Work Authorization Status: Can work for any employer / Can work for current
                // employer / Seeking work authorization" (user, 2026-07-27) — an H-1B holder can
                // work for their CURRENT employer only. Never "any employer", never "seeking".
                /can work for (my )?current employer/i,
                /\bh-?1-?b\b/i,
                /authoriz(ed|ation)[\s\S]{0,80}sponsor[\s\S]{0,40}(later|future|now or in the future)/i
            ],
            optionLabel: 'On a temporary work visa (H-1B) - employer sponsors a transfer'
        },
        {
            // "Are you legally authorized to work in the US / the country…?" -> Yes.
            topic: 'work-authorization',
            patterns: [
                /(legally )?authorized to work/i,
                /legally permitted to work/i,
                /(fully )?authorized to work[\s\S]{0,40}for any employer/i,
                /authorized to work for any employer[\s\S]{0,20}(u\.?s\.?|united states)/i,
                /work for any (u\.?s\.? )?employer[\s\S]{0,30}without restriction/i,
                /legal authorization to work/i,
                /(legal )?right to work/i,
                /(legally )?eligible to work/i
            ],
            exclude: /unrestricted|sponsor/i,
            choose: 'yes'
        },
        {
            // "Have you worked at a startup before?" (user, 2026-07-27) -> Yes. Ordered BEFORE
            // prior-employment: that topic's broad "(do you currently|have you) work(ed) (at|for)"
            // pattern would otherwise steal this question and wrongly answer No (it is not asking
            // about the TARGET company, just startups in general).
            topic: 'startup-experience',
            patterns: [
                /worked (at|for) a startup/i,
                /startup experience/i,
                /have you (ever )?worked (at|for) a startup/i
            ],
            choose: 'yes'
        },
        {
            // Prior/current employment with the target company (incl. "I have never worked for…"
            // status dropdowns, e.g. xAI's SpaceX/xAI/X/Twitter history picker) -> No / never.
            topic: 'prior-employment',
            patterns: [
                /have you (ever |previously )?(worked|been employed)/i,
                /(prior|former|current) employee of/i,
                /previously (been )?employed/i,
                /employment history/i,
                /(do you currently|have you)[\s\S]{0,40}work(ed)? (at|for)/i
            ],
            exclude: /authoriz|right to work|current (company|employer|title)|how many years|years of professional experience/i,
            // Long-form options ("I have not previously been employed at <Company>") never start
            // with the word No, so the plain negative predicate could not see them (user, 2026-07-28).
            optionCandidates: [
                /never (worked|been employed)/i,
                /^i have not (previously )?been employed/i,
                /have not (previously )?(been )?(employed|worked)/i,
                /^\s*no\b/i
            ],
            choose: 'no',
            optionMatch: /^\s*(no\b|i have never worked)/i,
            optionLabel: 'No / never worked'
        },
        {
            topic: 'restrictive-agreements',
            patterns: [
                /non-?disclosure or non-?compete agreement/i,
                /agreement[\s\S]{0,100}(restrict|prevent)[\s\S]{0,60}working/i,
                /restrictive covenant/i,
                // "…subject to any agreement with a former employer/third party (such as a
                // non-solicitation or non-compete agreement)…" (user, 2026-07-28).
                /non-?solicitation/i,
                /subject to any agreement/i,
                /agreement with a (former employer|third party)/i
            ],
            choose: 'no'
        },
        {
            topic: 'military-service',
            patterns: [
                /(serving|served|service)[\s\S]{0,80}(reserves?|national guard|armed forces|military)/i,
                /(reserves?|national guard)[\s\S]{0,80}(serving|served|service|enlisted)/i
            ],
            choose: 'no'
        },
        {
            topic: 'government-employment',
            patterns: [
                /(current|former|past|previous)[\s\S]{0,40}(employee|employment)[\s\S]{0,50}(u\.?s\.? |united states |state or local )?government/i,
                /(employee|employment) of[\s\S]{0,50}(u\.?s\.? |united states |state or local )?government/i
            ],
            choose: 'no'
        },
        {
            topic: 'security-clearance',
            patterns: [/do you hold a security clearance/i, /^security clearance$/i],
            optionMatch: /^\s*none\s*$/i,
            optionLabel: 'None'
        },
        {
            topic: 'current-employer-accenture-project',
            patterns: [
                /current employer[\s\S]{0,100}(project with|worked on a project with) accenture/i,
                /project with accenture[\s\S]{0,80}(past|last) 24 months/i
            ],
            choose: 'yes'
        },
        { topic: 'referral-status', patterns: [/were you referred/i, /have you been referred/i], exclude: /name of the referrer/i, choose: 'no' },
        {
            topic: 'relatives-at-company',
            patterns: [
                /(relative|family member)[\s\S]{0,80}(employ|work(?:s|ing)? (at|for))/i,
                /(close|personal) relationship[\s\S]{0,80}(employ|work(?:s|ing)? (at|for))/i
            ],
            choose: 'no'
        },
        {
            // Omnibus conflict-of-interest disclosure (user, 2026-07-27; Robinhood shape): personal/
            // familial relationships + outside business activities + investments (public or private
            // company) + intellectual-property ownership the applicant wishes to retain/develop. The
            // company name is incidental; match the SHAPE (co-occurrence of these disclosure
            // categories), not the exact wording, so this stays distinct from the narrower single-
            // topic questions (relatives-at-company, restrictive-agreements) that only ask one thing.
            topic: 'conflict-of-interest',
            patterns: [
                /^conflict of interest/i,
                /conflict of interest[\s\S]{0,100}(indicate|yes\s*\/\s*no|involved in any activity)/i,
                /(personal|familial)[\s\S]{0,40}relationships?[\s\S]{0,400}outside business activit/i,
                /outside business activit(y|ies)[\s\S]{0,400}(intellectual property|investment)/i,
                /(personal|familial)[\s\S]{0,40}relationships?[\s\S]{0,400}intellectual property/i,
                /intellectual property (ownership|rights)[\s\S]{0,100}(patents?|trademarks?|copyrights?)/i
            ],
            choose: 'no'
        },
        {
            topic: 'nyc-office-relocation',
            patterns: [
                /comfortable working in-person[\s\S]{0,50}nyc office[\s\S]{0,40}\d+[\s-]?days/i,
                /relocate to nyc upon offer[\s\S]{0,60}\d+[\s-]?days/i,
                /work in-person[\s\S]{0,60}(nyc|new york)[\s\S]{0,30}(sf|san francisco)[\s\S]{0,50}\d+[\s-]?days/i,
                /work in-person[\s\S]{0,60}(sf|san francisco)[\s\S]{0,30}(nyc|new york)[\s\S]{0,50}\d+[\s-]?days/i
            ],
            optionMatch: /^\s*yes[\s\S]{0,40}able to relocate to (?:sf or nyc|nyc or sf|nyc) upon offer/i,
            optionLabel: 'Yes | Able to relocate to SF or NYC upon offer acceptance'
        },
        {
            topic: 'planned-work-location-nyc',
            patterns: [
                /where do you plan to work from/i,
                /planned work location/i,
                /where will you (be )?working from/i
            ],
            optionMatch: /^open to relocating to nyc$/i,
            optionLabel: 'Open to relocating to NYC'
        },
        {
            // Harvey screenshots (user, 2026-07-27): three related office/hybrid shapes share ONE
            // ordered optionCandidates chain, governed by a standing rule — Eve must NEVER claim the
            // applicant already lives in/is based in the posted office location (the applicant is in
            // Dallas, TX and is willing to relocate anywhere). So among any office/hybrid option
            // list: (1) an option that says willing/open to RELOCATE always wins first; (2) an
            // affirmative that only claims ABILITY to attend, with NO residency claim, wins next;
            // (3) a plain "Yes"/"I can/agree" is the last-resort fallback for ordinary Yes/No
            // controls. NEVER an option asserting the applicant is already based in/lives in the
            // posted location, a remote-only option, "I may need flexibility", or "Other".
            //   #10 "Are you excited and able to join us in person on those days?" — options: "Yes,
            //       I'm able to work from the office 3 days a week" / "I may need flexibility and
            //       would like to discuss" / "No, I'm only able to work remotely" -> option 1 (no
            //       relocate option offered; option 1 makes no residency claim, so precedence 2).
            //   #11 "Which of Harvey's offices would you be able to work from?" — options: "I'm
            //       based in the city this role is posted in and can work from the office" / "I'm
            //       open to relocating to work from the office" -> the relocate option (precedence 1).
            //   #12 "...Are you currently based in the listed location and able to work in person 3
            //       days per week?" — options: "Yes, I'm based in this location and able to work..."
            //       (NEVER — false residency claim) / "No, I'm not based in this location but
            //       willing to relocate" (precedence 1, the user's explicit choice) / "No, I'm only
            //       able to work remotely" / "Other" -> the willing-to-relocate option.
            topic: 'office-attendance-requirement',
            patterns: [
                /(office-centric|office based|on-?site) model[\s\S]{0,100}\d+[\s-]?days per week/i,
                /(work|working) from[\s\S]{0,50}office[\s\S]{0,50}\d+[\s-]?days/i,
                /\b(willing|able|comfortable|prepared|can you)\b[\s\S]{0,160}\b(office|on-?site)\b[\s\S]{0,80}\bdays?\b/i,
                /\b(office|on-?site)\b[\s\S]{0,80}\bdays?\b[\s\S]{0,100}\b(willing|able|comfortable|prepared|can you|agree)\b/i,
                /can you meet[\s\S]{0,30}(office|on-?site|attendance) requirement/i,
                // "Which of Harvey's offices would you be able to work from?" (#11) — the company
                // name is incidental; match the shape (which office(s) + able to work from).
                /which[\s\S]{0,40}offices?[\s\S]{0,40}(would|will) you[\s\S]{0,30}work from/i,
                // "...tied to the office location listed in the job posting...hybrid work model...
                // office 3 days per week...currently based in the listed location..." (#12).
                /tied to the office location/i,
                /hybrid work model[\s\S]{0,100}office[\s\S]{0,30}\d+[\s-]?days?/i,
                /currently based in the listed location[\s\S]{0,60}(able to )?work in person/i,
                // "Are you able to work in person at the <Company> office location listed in the job
                // description at least four times per week?" (Promise/Ashby, 2026-07-28) — same
                // shape as the "days per week" patterns above but worded as "times per week".
                /\b(willing|able|comfortable|prepared|can you)\b[\s\S]{0,160}\b(office|on-?site)\b[\s\S]{0,100}\btimes? per week\b/i,
                /work in person[\s\S]{0,60}office location[\s\S]{0,60}(times|days) per week/i,
                // "This position is based onsite at our <name> office in <city>, 4–5 days per week.
                // Are you currently located in the Bay Area and open to this schedule?" (user,
                // 2026-07-28) — a combined location+schedule question. Its option list offers "not
                // currently in <region> but open to relocation", which is the honest choice; the
                // residency topic is excluded from this wording so it cannot answer a bare Yes.
                /based onsite at[\s\S]{0,80}office/i,
                /\d+\s*[-–]\s*\d+ days per week/i,
                /open to (this|the) schedule/i,
                // "...able to come into the office to work at least 2x's a week..." (Plaid/Ashby,
                // 2026-07-28) — the "Nx's a week" shorthand, not "days"/"times per week".
                /\b(willing|able|comfortable|prepared|can you)\b[\s\S]{0,160}\b(office|on-?site)\b[\s\S]{0,100}\d+x'?s?\s+(a|per)\s+week\b/i,
                // "This role requires you to work from one of our offices 2x per week. Are you able
                // to meet this requirement?" (Plaid/Ashby, 2026-07-28) — "able" sits in a SEPARATE
                // sentence after the office/week clause, not before it like the patterns above.
                // Scoped to "office(s)...week" so it can't collide with an unrelated "meet this
                // requirement" elsewhere (e.g. a minimum-age or degree requirement question).
                /work from one of our offices[\s\S]{0,60}\d+x per week[\s\S]{0,60}meet this requirement/i
            ],
            // A "which office do you PREFER / preferred work location" question is a location CHOICE,
            // not an ability question — it belongs to relocation-locations-all, which picks a city
            // (or ticks them all) instead of answering Yes (user, 2026-07-28).
            exclude: /prefer(red)? (work )?location|location preference|which office[\s\S]{0,40}prefer/i,
            choose: 'yes',
            // The last two fallback candidates carry a negative lookahead for "based in" so a
            // plain-Yes-shaped option can NEVER be picked when it also asserts current residency in
            // the posted location (e.g. "Yes, I'm based in this location and able to work from the
            // office 3 days per week") — that option must go unanswered rather than be falsely
            // affirmed if no relocate/ability-only option is offered.
            optionCandidates: [
                /open to relocat/i,
                /willing to relocat/i,
                /not based in this location but/i,
                /^\s*yes,?\s*i['’]?m able to work/i,
                /^\s*i can\b(?!.*\bbased in\b)/i,
                /^\s*yes\b(?!.*\bbased in\b)/i,
                /^\s*i (agree|acknowledge|affirm)\b(?!.*\bbased in\b)/i
            ],
            optionLabel: 'Willing to relocate / able to attend in person — never a residency claim'
        },
        {
            // Travel willingness (Indeed/Infosys 2026-07-27): same affirmative family as the
            // relocation standing rule — the applicant is open to relocate anywhere, so travel
            // for work is Yes.
            topic: 'travel-willingness',
            patterns: [
                /(open|willing|able) to travel/i,
                /travel (requirement|up to|as (needed|required))/i,
                /comfortable (with )?(business )?travel/i
            ],
            choose: 'yes'
        },
        {
            // Application/selection-process accommodation disclosure (Indeed/Infosys 2026-07-27):
            // "Do you require adjustments to the application and selection process?" -> No
            // (consistent with the user's no-disability EEO defaults). "Prefer not to say" is
            // never needed since the true answer is simply No.
            topic: 'application-accommodations',
            patterns: [
                /(require|need)[\s\S]{0,30}(adjustments?|accommodations?)[\s\S]{0,80}(application|selection|recruit|interview|hiring)/i,
                /(adjustments?|accommodations?) to (the )?(application|selection|interview|recruitment)/i,
                /reasonable accommodations?[\s\S]{0,60}(apply|application|interview)/i
            ],
            choose: 'no'
        },
        {
            topic: 'prior-application',
            patterns: [
                /have you (applied|submitted an application) (with|to|at)[\s\S]{0,50}previously/i,
                /have you previously applied (with|to|for|at)/i,
                /prior application (with|to)/i,
                // "Have you applied at <Company> previously?" (ISA, my.greenhouse.io, 2026-07-27) —
                // company name is a wildcard, not a required match token.
                /have you applied at [\s\S]{1,60}previously/i
            ],
            choose: 'no'
        },
        {
            topic: 'prior-current-interview',
            patterns: [
                /in the past or are you currently interviewing[\s\S]{0,80}(positions?|roles?)/i,
                /(previously|ever) interviewed (with|for a position at)/i,
                /currently interviewing (with|for a position at)/i
            ],
            choose: 'no'
        },
        {
            topic: 'desired-start-date',
            patterns: [
                /what is your desired start date/i,
                /(desired|preferred) (employment )?start date/i,
                /when (can|would) you (start|be available to start)/i,
                /when could you start/i,
                /(earliest|possible) start date/i,
                /availability to start/i
            ],
            // A free-text box gets the human wording; a native date control gets `date` below,
            // because input[type=date] silently rejects anything that is not yyyy-mm-dd.
            text: 'Sep 7, 2026',
            date: '2026-09-07'
        },
        {
            // "What are the main programming languages and technologies you've worked with in your
            // previous roles?" (user, 2026-07-28) — a plain list, no years. Distinct from the
            // top-programming-languages topic, which answers the "with length of experience for
            // each" variant; ordered before it so the list-only wording wins.
            topic: 'languages-technologies-list',
            patterns: [
                /(main |primary )?(programming )?languages and technologies/i,
                /(technologies|tech stack)[\s\S]{0,40}(you|you've|you have)[\s\S]{0,30}worked with/i,
                /what (programming )?languages[\s\S]{0,40}have you (worked with|used)/i
            ],
            exclude: /length of experience|how many years|with each/i,
            text: 'Python, Java, TypeScript, SQL'
        },
        {
            // "What is your Python expertise on a 1-5 scale (5 being expert)?" -> 5 (user,
            // 2026-07-28). Deliberately scoped to a 1-5 scale: the answer is the TOP of that scale,
            // and a 1-10 scale would need a different number, so it stays unanswered rather than
            // being answered wrongly. The technology named is incidental.
            topic: 'skill-self-rating-1-5',
            patterns: [
                /\b1\s*[-–to]{1,3}\s*5\s*scale/i,
                /scale of 1\s*(to|-|–)\s*5/i,
                /on a 1\s*[-–]\s*5/i,
                /\(5 being (an )?expert\)/i
            ],
            optionCandidates: [/^\s*5\b/, /\bexpert\b/i],
            optionLabel: '5',
            text: '5'
        },
        {
            topic: 'banking-bfsi-experience',
            patterns: [
                /banking\s*\/?\s*bfsi[\s\S]{0,30}(domain )?experience/i,
                /experience in (the )?(banking|financial services|bfsi)[\s\S]{0,20}domain/i,
                /worked in (banking|financial services|bfsi)/i
            ],
            choose: 'yes'
        },
        {
            // "…we do require employees to reside within 50 miles of the hub advertised on the job
            // posting. At the time of hire, will you be located within 50 miles of one of our hubs?
            // If so, please select which location." (user, 2026-07-27) with a city list plus two
            // N/A options. The applicant lives in Dallas, so naming a hub city would be false: take
            // the "not in a hub location BUT able to relocate" option. Ordered precedence, and the
            // "unable to relocate" option is explicitly rejected — note it contains the substring
            // "able to relocate", which is why the candidates below anchor on "am able" / "but".
            topic: 'hub-location-radius',
            patterns: [
                /within \d+ miles of (one of )?(our|the) hub/i,
                /reside within \d+ miles/i,
                /(at the time of hire|will you be) located within \d+ miles/i,
                /within \d+ miles of the (hub|office) (advertised|listed)/i,
                // "Please select which <Company> hub you are currently based out of:" (user,
                // 2026-07-27) — a hub list with relocate / won't-relocate options at the end.
                /which[\s\S]{0,30}hub[\s\S]{0,40}(are you )?(currently )?based (out )?of/i,
                /which hub[\s\S]{0,40}(you|are you)/i
            ],
            // Ordered precedence. Both the WILLING and the NOT-WILLING option contain the words
            // "willing to relocate", so the affirmative candidates are anchored at the start of the
            // option text and the negative one can never win.
            optionCandidates: [
                /not in (one of )?(the )?hub locations?[\s\S]{0,30}\bbut\b[\s\S]{0,20}\bam able to relocate\b/i,
                /\bbut\b[\s\S]{0,20}\bam able to relocate\b/i,
                /^\s*willing to relocate/i,
                /^\s*(yes|i am|i'm)[\s\S]{0,20}willing to relocate/i,
                /(?<!not )(?<!un)able to relocate/i
            ],
            optionLabel: 'N/A - I am not in one of the hub locations but I AM able to relocate',
            text: 'I am not currently in one of the hub locations, but I am able to relocate.'
        },
        {
            // Relocation / hybrid office attendance: ALWAYS the affirmative option (user standing
            // rule 2026-07-26). "I can work N days a week in the <city> office" counts as Yes.
            topic: 'relocation-hybrid',
            patterns: [
                /(willing|able|open) to relocat/i,
                /consider relocat/i,
                /hybrid (setting|work environment)/i,
                /\d+ days (a|per) week in( the| our| an)? office/i,
                // "…from our Marina Del Rey, CA office on Mondays and Thursdays (2 days/week)?"
                // (user, 2026-07-27): the city is incidental and the cadence can be written
                // "2 days/week", which the pattern above does not reach.
                /work(ing)? (from|out of|at) (our|the)[\s\S]{0,60}office/i,
                /\d+\s*days?\s*\/\s*week/i,
                /(work|come) (on-?site|in the office)/i,
                // "Are you able to join us in the office every Tuesday and Wednesday as part of our
                // hybrid model?" (user, 2026-07-27) — named weekdays instead of a day count.
                /join (us )?in the office/i,
                /in-?office (time|days?)/i,
                /in the office every [a-z]+day/i,
                // "Are you willing to work from the required location?" (user, 2026-07-27) — the
                // posting's own location, whatever it is; the standing affirmative applies.
                /willing to work (from|at|in) the (required|specified|posted|listed|advertised) location/i,
                /work from the (required|specified|posted|listed) location/i,
                // "Are you able to meet the location requirements of the position as stated in the
                // job description?" and the conditional "IF you are based in <cities>, are you able
                // to commute to the office N days per week?" (user, 2026-07-27) — both are ability
                // questions, so the standing affirmative applies.
                /meet the location requirements/i,
                /location requirements? of the (position|role|job)/i,
                /if you are (based|located) in[\s\S]{0,80}(able to|can you)[\s\S]{0,40}(commute|work|come)/i,
                /able to commute to the office/i,
                /commut(e|ing) to/i,
                // STANDING RULE (user, 2026-07-28): any question mentioning "N days a week" is an
                // attendance commitment and is answered YES, whatever the surrounding wording. This
                // is the catch-all behind the specific office-attendance phrasings; it lives here
                // because this topic also handles "I can work N days a week in the <city> office"
                // option lists.
                /\d+\s*(\+|or more)?\s*days?\s*(a|per)\s*week/i,
                /\d+\s*x'?s?\s*(a|per)\s*week/i,
                // …and the remaining cadence spellings: "2-3x a week", "3 times a week", "twice a
                // week" (user, 2026-07-28: anything saying "… a week" is an attendance commitment).
                /\d+\s*[-–]\s*\d+\s*x'?s?\s*(a|per)\s*week/i,
                /\d+\s*times?\s*(a|per)\s*week/i,
                /(once|twice|thrice)\s*(a|per)\s*week/i,
                // "Do you live within commuting distance to one of our hubs (NY, SF, DC, BOS or
                // London)?" (user, 2026-07-27) — the hub list is incidental, so match the shape:
                // living within commuting distance of a hub/office/location.
                /within commuting distance/i,
                /commuting distance (to|of|from)/i,
                /(live|located|based)[\s\S]{0,40}(near|close to|within)[\s\S]{0,40}(hub|office|location)/i,
                /do you live[\s\S]{0,60}(hub|office)s?\b/i,
                // Ashby/Notion "Anchor Days" phrasing (screenshot 2026-07-27) — an office-attendance
                // commitment like any other, so the standing always-affirmative rule applies.
                /(commit to |able to )?work(ing)? from one of our offices/i,
                /anchor days/i,
                /able to work from our [\s\S]{0,30}office/i,
                // "Are you willing to move to SF and work in person with us?" (user, 2026-07-27) —
                // the city and company wording are incidental; match the shape: willing/able/open
                // to MOVE (not just "relocate") to a place, and/or working in person with a team.
                /(willing|able|open) to move to/i,
                /move to[\s\S]{0,60}work in person/i,
                /work in person with (us\b|our\b|the team)/i,
                // "Are you able to work in-person in San Francisco? (Presidio)" (user, 2026-07-27) —
                // the office/city name is incidental; match the shape: able/willing/open/available to
                // work in-person, without requiring the "with us/our team" qualifier above.
                /(able|willing|open|available)\b[\s\S]{0,30}work in-?person\b/i,
                // "Will you require relocation?" (user, 2026-07-27) — the direct phrasing, distinct
                // from "willing/able/open to relocate" above.
                /(will you|do you)[\s\S]{0,20}require relocation/i,
                /(need|require)[\s\S]{0,20}relocation\b/i,
                // "This hybrid role involves being in San Carlos, CA, 3 days per week. Please mark
                // Yes that you read, understand, and are able to do this." (user, 2026-07-27) — the
                // city is incidental; match the shape: a hybrid ROLE (not "setting"/"office") named
                // with a weekly cadence, with no "office" word required (see office-attendance-
                // requirement for the office-worded variants).
                /hybrid role[\s\S]{0,200}\d+\s*days?\s*(a|per)\s*week/i
            ],
            choose: 'yes',
            optionMatch: /^\s*(yes\b|i can\b)/i,
            optionLabel: 'Yes / I can'
        },
        {
            // "Please indicate ALL of the locations that you would be interested in relocating to"
            // (Ashby screenshot 2026-07-27: New York, NY + San Francisco, CA, both checked). The
            // applicant is open to relocating anywhere (standing rule), so every offered location is
            // checked — `checkAll` ticks the whole group instead of picking one option.
            // Office / work-location choice (user rule, 2026-07-28). ONE topic covers both control
            // shapes, because the answer differs by shape:
            //   • multi-select ("Preferred Work Location — select all that apply", checkboxes)
            //     -> `checkAll` ticks EVERY office. The applicant relocates anywhere, so ruling any
            //     of them out only narrows the funnel.
            //   • single choice -> the ordered precedence below, reasoned from the applicant's real
            //     position: they live in Dallas, are open to relocating anywhere, and target the Bay
            //     Area first, then Seattle, then New York.
            //       1. an option that commits to NOTHING geographic — "open to relocating",
            //          "anywhere", "no preference", "flexible" — it keeps every office in play and
            //          is the honest answer for someone not yet living in any of them;
            //       2. San Francisco / Bay Area / California — the primary target;
            //       3. Seattle; 4. New York; 5. the applicant's OWN metro (Dallas/Texas) if offered,
            //          which is at least true today; 6. Remote — a fallback, not a preference, since
            //          this question is usually gating an in-office role; 7. any remaining real
            //          option, so a required field is never left blank. Never a decline option.
            topic: 'relocation-locations-all',
            patterns: [
                /indicate all of the locations/i,
                /locations?[\s\S]{0,40}interested in relocating to/i,
                /(which|what) locations?[\s\S]{0,40}(would you|are you)[\s\S]{0,30}(interested|willing|open)/i,
                /select all[\s\S]{0,40}(locations|offices|cities)/i,
                /preferred (work )?location/i,
                /(which|what) office[\s\S]{0,40}(would you|do you|are you)/i,
                /location preference/i
            ],
            checkAll: true,
            optionCandidates: [
                /open to relocat|willing to relocat|anywhere|no preference|flexible|any (office|location)/i,
                /san francisco|\bsf\b|bay area|california|\bca\b(?![a-z])/i,
                /seattle|\bwa\b(?![a-z])/i,
                /new york|\bnyc\b|\bny\b(?![a-z])/i,
                /dallas|austin|texas|\btx\b(?![a-z])/i,
                /remote/i,
                /^(?!\s*(select|choose|prefer not|decline|none|n\/a)).+/i
            ],
            optionLabel: 'every office when multi-select; otherwise relocate/anywhere → SF → Seattle → NY'
        },
        {
            // "What's your english level?" as a CEFR list (screenshot 2026-07-27: C2: Proficient. /
            // C1: Advanced. / B2: Upper-Intermediate. / …). Same answer as the Workday Languages
            // section (info/myworkdayjobs: English — fluent, native, C2), written as the project-wide
            // ordered precedence chain so any tenant's wording lands on the highest offered level.
            topic: 'english-level',
            patterns: [
                /what('s| is) your english level/i,
                /(english|language) (level|proficiency)/i,
                /level of english/i,
                /how (well )?(do you )?(speak|write)[\s\S]{0,20}english/i
            ],
            exclude: /programming languages/i,
            optionCandidates: [
                /^\s*c2\b/i,
                /native speaker|native or bilingual|^\s*native\b/i,
                /\bproficient\b/i,
                /^\s*c1\b/i,
                /\b(fluent|advanced|full professional)\b/i
            ],
            optionLabel: 'C2: Proficient',
            text: 'C2 (Proficient / Native Speaker)'
        },
        {
            // LLM experience questions (Ashby screenshot 2026-07-27) — both Yes: the applicant works
            // with LLMs daily and has built personal projects on them (see the AI experience essay).
            topic: 'llm-experience',
            patterns: [
                /experience (with|using)[\s\S]{0,20}(llms?|large language models?)/i,
                /(built|created|worked on)[\s\S]{0,40}(personal )?project[\s\S]{0,30}(using|with)[\s\S]{0,20}(llms?|large language models?|generative ai)/i,
                /have you (used|worked with)[\s\S]{0,30}(llms?|large language models?|generative ai)/i
            ],
            choose: 'yes'
        },
        {
            topic: 'salary-monthly',
            patterns: [
                /desired monthly salary/i,
                /(expected|desired|target) salary per month/i,
                /monthly (salary|compensation) expectation/i
            ],
            text: '12000'
        },
        {
            topic: 'salary-currency',
            patterns: [
                /select the currency/i,
                /salary (currency|denomination)/i,
                /currency for (your )?(salary|compensation)/i
            ],
            optionMatch: /^\s*(usd|u\.?s\.? dollars?|united states dollars?)\s*$/i,
            optionLabel: 'USD'
        },
        {
            topic: 'salary-expectation',
            patterns: [
                /salary (expectation|requirement)/i,
                /(expected|desired|target) (base )?(salary|compensation)/i,
                /compensation expectation/i
            ],
            exclude: /current (salary|compensation)|salary history|\bhourly\b|per month|\bmonthly\b|realistic base gross|salary expectation[\s\S]{0,40}(range|next role)/i,
            text: SALARY_EXPECTATION
        },
        {
            topic: 'salary-range-expectation',
            patterns: [
                /realistic base gross annual salary expectation/i,
                /salary expectation[\s\S]{0,40}(range|next role)/i
            ],
            optionMatch: /^\s*\$?160,?000\s*-\s*\$?180,?000\s*$/i,
            optionLabel: '$160,000 - $180,000'
        },
        {
            topic: 'application-accuracy-confirmation',
            patterns: [
                /confirm[\s\S]{0,80}answers[\s\S]{0,80}complete and accurate/i,
                /permission is granted[\s\S]{0,80}verify[\s\S]{0,80}statements/i,
                /certify[\s\S]{0,80}application[\s\S]{0,40}(true|complete|accurate)/i
            ],
            choose: 'yes'
        },
        {
            topic: 'advisement-read-confirmation',
            patterns: [
                /confirm[\s\S]{0,40}you have read[\s\S]{0,40}(advisement|notice|statement)/i,
                /(read|reviewed)[\s\S]{0,80}advisement[\s\S]{0,40}confirm/i,
                /multiple roles[\s\S]{0,120}(read|advisement|confirm)/i
            ],
            choose: 'yes'
        },
        {
            // "How did you hear about this job?" — free text on Greenhouse (Databricks 2026-07-15)
            // -> LinkedIn; on a dropdown, prefer a LinkedIn option.
            topic: 'how-heard',
            patterns: [
                /how did you (first |initially )?(hear|learn) about/i,
                /where did you (first |initially )?(hear|learn) about/i,
                // "How did you find us?" (user, 2026-07-27) — same question, different verb.
                /how did you (find|discover|come across) (us|this (role|job|position|opening))/i,
                /where did you (find|see) (this|the) (role|job|position|opening)/i
            ],
            text: 'LinkedIn',
            // LinkedIn when the list offers it, otherwise the FIRST real option (user, 2026-07-27)
            // — this question never disqualifies anyone, so an unanswered required dropdown is the
            // only bad outcome. The fallback skips placeholder entries like "Select…".
            optionCandidates: [
                /linked ?in/i,
                /^(?!\s*(select|choose|please select|pick one|--|—|\.{3}|…)).+/i
            ],
            optionLabel: 'LinkedIn'
        },
        {
            // CV-grounded tech screening (6sense 2026-07-26): Java + Spring Boot production apps at
            // J.P. Morgan -> Yes.
            topic: 'experience-java-spring',
            patterns: [/experience[\s\S]{0,80}java[\s\S]{0,40}spring/i, /java and spring boot/i],
            exclude: /how many years|years of professional experience/i,
            choose: 'yes'
        },
        {
            // Backend + frontend (React/TypeScript) in the same role: JPMC backend services + React
            // admin portal -> Yes.
            topic: 'experience-backend-frontend',
            patterns: [
                /both backend[\s\S]{0,40}frontend/i,
                /backend services and frontend applications/i,
                /(full-?stack)[\s\S]{0,60}(react|typescript)/i
            ],
            choose: 'yes'
        },
        {
            // Public cloud (AWS) + containers/Kubernetes in production: ECS/EKS, Docker, Terraform
            // -> Yes.
            topic: 'experience-cloud-containers',
            patterns: [
                /public cloud[\s\S]{0,80}(container|kubernetes)/i,
                /(aws|azure|gcp)[\s\S]{0,60}(container|kubernetes)/i,
                /deployed and supported production applications/i
            ],
            choose: 'yes'
        },
        {
            topic: 'years-java-spring-react',
            patterns: [
                /years of professional experience[\s\S]{0,80}java[\s\S]{0,50}spring(?:\s*boot|bot)[\s\S]{0,50}react(?:js)?/i,
                /how many years[\s\S]{0,80}(developing|developed|building) applications[\s\S]{0,80}java[\s\S]{0,80}react/i,
                /experience with java[\s\S]{0,50}spring[\s\S]{0,50}react(?:js)?/i
            ],
            text: '4'
        },
        {
            topic: 'years-microservices-event-driven',
            patterns: [
                /years of professional experience[\s\S]{0,80}microservices?[\s\S]{0,60}event[- ]driven/i,
                /how many years[\s\S]{0,70}event[- ]driven architecture/i,
                /production[\s\S]{0,60}microservice[- ]styled[\s\S]{0,60}architecture/i
            ],
            text: '4'
        },
        {
            topic: 'years-relational-database',
            patterns: [
                /years of professional experience[\s\S]{0,80}relational databases?/i,
                /how many years[\s\S]{0,60}relational (database|db)/i,
                /relational databases?[\s\S]{0,50}(mysql|years of experience)/i
            ],
            text: '4'
        },
        {
            topic: 'years-nosql-document-database',
            patterns: [
                /years of professional experience[\s\S]{0,80}(nosql|document databases?)/i,
                /how many years[\s\S]{0,60}(nosql|document databases?)/i,
                /(nosql|document databases?)[\s\S]{0,50}(mongodb|years of experience)/i
            ],
            text: '4'
        },
        {
            topic: 'supply-chain-logistics-experience',
            patterns: [
                /experience building software[\s\S]{0,80}(supply[- ]chain|logistics)/i,
                /built software[\s\S]{0,60}(supply[- ]chain|logistics|warehouse management)/i,
                /(wms|tms|wcs)[\s\S]{0,60}(experience|software)/i,
                /(warehouse|transportation|logistics)[\s\S]{0,50}(management|control) system[\s\S]{0,50}experience/i
            ],
            choose: 'no'
        },
        {
            topic: 'minimum-three-years-experience',
            patterns: [
                /minimum of 3 years of experience[\s\S]{0,30}not including internships/i,
                /at least 3 years of (professional )?experience[\s\S]{0,30}(excluding|not including) internships/i
            ],
            choose: 'yes'
        },
        {
            // STANDING RULE (user, 2026-07-27): "do you have N (or more) years of … experience …?"
            // is ALWAYS Yes, whatever technology or stack the question lists — the answer does not
            // depend on the list. Ordered AFTER the specific years-band pickers (which choose a
            // range from a dropdown) and after the technology-specific Yes topics, so it only
            // catches the plain yes/no form. `exclude` keeps it away from "how many years…"
            // questions, which need a number or a band, not Yes.
            topic: 'years-of-experience-threshold',
            patterns: [
                /do you have[\s\S]{0,60}\d+\+?\s*(or more\s*)?years?[\s\S]{0,80}experience/i,
                /do you have[\s\S]{0,40}(three|four|five|six|seven|eight|nine|ten)\s*(\+|or more)?\s*years?[\s\S]{0,80}experience/i,
                /(have|possess)[\s\S]{0,40}(at least|minimum of)\s*\d+\s*years?[\s\S]{0,60}experience/i
            ],
            exclude: /how many years|years of relevant work experience do you have\?|please (specify|indicate|enter)/i,
            choose: 'yes'
        },
        {
            // Yes/No "do you meet the minimum experience in the job description" (Indeed/Infosys
            // 2026-07-27). Ordered BEFORE the banded years-of-experience entries so a Yes/No
            // control never falls into a numeric band optionMatch. CV: 4+ years professional -> Yes.
            topic: 'meets-minimum-experience',
            patterns: [
                /(at least )?the minimum years of (relevant )?(work )?experience/i,
                /minimum years of[\s\S]{0,40}experience[\s\S]{0,60}(job description|described|required)/i,
                /meet the (minimum|required)[\s\S]{0,30}experience/i
            ],
            choose: 'yes'
        },
        {
            // "Minimum of a Bachelor's degree or foreign equivalent (or experience in lieu)"
            // (Indeed/Infosys 2026-07-27). User holds a Master's -> Yes.
            topic: 'minimum-education-bachelor',
            patterns: [
                /minimum of a bachelor['’]?s degree/i,
                /bachelor['’]?s degree or (foreign )?equivalent/i,
                /do you (hold|have|possess)[\s\S]{0,40}bachelor['’]?s degree/i
            ],
            choose: 'yes'
        },
        {
            topic: 'years-experience-field-described',
            patterns: [
                /how many years of experience[\s\S]{0,80}field described[\s\S]{0,100}job description/i,
                /years of experience[\s\S]{0,60}field[\s\S]{0,80}(position|job)[\s\S]{0,40}applying for/i,
                /experience in the field described/i
            ],
            text: '5'
        },
        {
            // Exact-position experience band (user, 2026-07-26). Ordered before the generic
            // band-starting-at-5 fallback below.
            topic: 'years-of-relevant-experience-position',
            patterns: [
                /how many years of relevant work experience do you have for this position/i,
                /relevant work experience[\s\S]{0,30}for this position/i
            ],
            optionMatch: /^\s*4\s*(?:-|–|to)\s*6\s*(?:yoe|years?(?: of experience)?)?\s*$/i,
            optionLabel: '4 - 6 YoE'
        },
        {
            // Banded years-of-experience dropdowns: the band that STARTS at 5 (user, 2026-07-25).
            topic: 'years-of-relevant-experience',
            patterns: [/how many years of[\s\S]{0,40}experience/i, /years of (relevant|professional|work)[\s\S]{0,30}experience/i],
            exclude: /programming languages|most proficient|with each|for this position/i,
            // 5 years of experience, so the answer is the band that CONTAINS 5. Ordered precedence:
            // an explicit 5/5+ band first, then any "<low> to <high>" band whose low ≤ 5 and high ≥ 5
            // ("4 to 7 years", user 2026-07-27 — the old single-digit matcher found no 5 in it and
            // left the required dropdown empty), then an open-ended 4+/5+ band. Never "less than",
            // never "1 to 3", never "8 or more".
            optionCandidates: [
                /^(?!.*\b(?:up\s+to|under|less\s+than|fewer\s+than|below|at\s+most)\b)\D*5\b/i,
                /\b[1-5]\s*(?:to|-|–|—)\s*(?:[6-9]|1\d)\b/i,
                /\b[4-5]\s*\+/i,
                // Last resort: a band that ENDS at 5 ("3-5 years"). True, but it sits at the top edge,
                // so it only wins when no band contains 5 with room above it.
                /\b[1-4]\s*(?:to|-|–|—)\s*5\b/i
            ],
            optionLabel: 'the band containing 5 years',
            // Free-text/number version of the same question ("How many years of experience do you
            // have in software engineering?" -> 5; user, 2026-07-27).
            text: '5'
        },
        {
            // "Which level best reflects your experience and the role you are looking to step
            // into?" (user, 2026-07-27) — options: Mid-Level / Senior / Lead. The user did not state
            // a choice; Senior is the reasoned best fit for the applicant's real background (5+
            // years, end-to-end ownership per the ideal-candidate-pitch essay) — solidly beyond
            // Mid-Level's "foundational experience... looking to grow" framing, but short of Lead's
            // "drive strategy, mentor others" framing, which the applicant's experience does not yet
            // support. Ordered precedence: an option that STARTS WITH "senior" first, then any
            // option merely containing "senior", then Mid-Level as a fallback if Senior is not
            // offered at all — NEVER Lead.
            topic: 'experience-level-select',
            patterns: [
                /which level best reflects your experience/i,
                /level best reflects your experience[\s\S]{0,60}role/i,
                /which level[\s\S]{0,40}(reflects|describes)[\s\S]{0,20}your experience/i
            ],
            optionCandidates: [/^senior/i, /senior/i, /^mid-level|^mid\b/i],
            optionLabel: 'Senior'
        },
        {
            topic: 'exceptional-performance-example',
            patterns: [
                /exceptional performance[\s\S]{0,80}(examples?|highlight)/i,
                /examples? of exceptional performance/i,
                /performance in one area[\s\S]{0,100}performance in other areas/i
            ],
            text: 'I am developing a Chrome extension that automates the job-application process across multiple sites, including this one. It stores user information and preferences, uses rule-based and regex-based matching to recognize common application questions, and allows users to add custom rules for greater flexibility. It also supports configurable delays between actions to respect platform rate limits. Users can start a workflow, step away, and return to find that the extension has completed hundreds of applications.'
        },
        {
            topic: 'ai-tools-usage-essay',
            patterns: [
                /describe how you use[\s\S]{0,80}ai tools/i,
                /how (do|have) you use[\s\S]{0,60}(ai|artificial intelligence)/i,
                /(ai tools|coding agents)[\s\S]{0,100}(helpful|work|workflow)/i,
                /concrete example[\s\S]{0,100}ai[\s\S]{0,50}helpful/i,
                // "What AI tools are you currently using today and how are you using them?" (user,
                // 2026-07-27) — the same question, asked as what + how.
                /what ai tools[\s\S]{0,60}(using|use)/i,
                // "How are you using AI today?" (user, 2026-07-28) — present continuous, which the
                // "how do you use" pattern above does not reach.
                /how are you using (ai|artificial intelligence|ai tools)/i,
                /how (do|are) you (use|using)[\s\S]{0,25}\bai\b/i,
                /which ai (tools|assistants)[\s\S]{0,40}(do you )?use/i
            ],
            text: "I use Claude, Codex, and GitHub Copilot extensively in both my professional and personal work. At work, I use Copilot's agent mode in VS Code to refine business requirements, turn them into stories and specifications, and generate implementation code. One especially helpful use is having AI agents operate integration tests as if I were testing the workflows myself, which saves me substantial time while still letting me review the results. Outside work, I use Claude Code and Codex to build and enhance personal projects, automate my own workflows, study topics in depth, and develop career, exercise, and nutrition plans that I keep feeding updates into so the model can analyse my progress and propose the next actions."
        },
        {
            // "This is an AI systems engineering role — we want someone who builds reliable
            // production systems around modern foundation models, not someone who trains models from
            // scratch. What AI systems have you built?" (user, 2026-07-27). Answered from the
            // applicant's real work: the JPMC agent system and the Eve extension — both are systems
            // BUILT AROUND foundation models, which is exactly what the question asks for. Ordered
            // before ai-experience-essay so this narrower "what have you built" framing wins.
            topic: 'ai-systems-built-essay',
            patterns: [
                /what ai systems have you built/i,
                /(ai|agentic) systems[\s\S]{0,40}(have you )?built/i,
                /(built|shipped)[\s\S]{0,40}(production )?systems? (around|on top of|with)[\s\S]{0,40}(foundation|language) models?/i,
                /ai systems engineering role[\s\S]{0,200}what[\s\S]{0,40}built/i
            ],
            text: 'At J.P. Morgan I built an AI agent system that automates financial-data validation between vendor emails and our internal platform: it classifies incoming emails, routes them by financial instrument type, extracts structured data, normalises it, retrieves the matching internal records, and runs sequential and parallel comparison agents, built on Google ADK and FastAPI with Azure OpenAI and AWS Bedrock. Making it reliable was the real work — schema-constrained outputs, explicit validation rules, traceable comparison results, and a human-review step for uncertain cases — and we evaluated it against manually reviewed examples before trusting it, which moved the team from manual comparison to exception-based review. I also build and run Eve, a Chrome extension that fills and submits job applications end to end across six application platforms, where the engineering problem is the same: deterministic matching and verification around the model, never assuming an action succeeded until the page confirms it. I have not trained foundation models from scratch; my experience is in building dependable production systems around them.'
        },
        {
            // "Please describe your AI experience." (user, 2026-07-27) — the long-form answer, kept
            // AFTER ai-tools-usage-essay so the narrower "how do you use AI tools, with a concrete
            // example" prompt still gets its own shorter response.
            topic: 'ai-experience-essay',
            patterns: [
                /describe your ai experience/i,
                /(describe|tell us about)[\s\S]{0,30}your (experience with |background (with|in) )?(ai|artificial intelligence|machine learning)/i,
                /\bai experience\b/i,
                /what is your experience with (ai|artificial intelligence)/i
            ],
            text: 'I use AI chat and AI coding agents every day, in both work and personal life. At work, I built an AI agent system to automate financial-data validation between vendor emails and our internal platform. Bankers previously had to read each email, extract relevant fields, clean inconsistent formats, and compare the values manually, which was time-consuming and error-prone. The system uses Google ADK, FastAPI, Azure OpenAI, and AWS Bedrock to classify incoming emails, route them by financial instrument type, extract structured data, normalize the results, retrieve matching internal records, and run sequential and parallel comparison agents. I added schema-constrained outputs, validation rules, traceable comparison results, and a human-review step for uncertain cases so the workflow remained explainable and operationally safe. We evaluated it against manually reviewed examples and confirmed that it identified most known discrepancies. The solution changed the process from manual comparison to exception-based review and was projected to save the banker team hundreds of hours per month while improving consistency, productivity, and data quality.'
        },
        {
            topic: 'recent-build-essay',
            patterns: [
                /what['’]?s something you['’]?ve built recently/i,
                /something you (have )?built recently/i,
                /what have you built (recently|lately)/i,
                /describe (a|something) you (recently )?built/i
            ],
            text: 'I built an AI agent system to automate financial-data validation between vendor emails and our internal platform. Bankers previously had to read each email, extract relevant fields, clean inconsistent formats, and compare the values manually, which was time-consuming and error-prone. The system uses Google ADK, FastAPI, Azure OpenAI, and AWS Bedrock to classify incoming emails, route them by financial instrument type, extract structured data, normalize the results, retrieve matching internal records, and run sequential and parallel comparison agents. I added schema-constrained outputs, validation rules, traceable comparison results, and a human-review step for uncertain cases so the workflow remained explainable and operationally safe. We evaluated it against manually reviewed examples and confirmed that it identified most known discrepancies. The solution changed the process from manual comparison to exception-based review and was projected to save the banker team hundreds of hours per month while improving consistency, productivity, and data quality.'
        },
        {
            topic: 'entrepreneurial-ways-essay',
            patterns: [
                /in what ways are you entrepreneurial/i,
                /how (are|would you describe) yourself as entrepreneurial/i,
                /describe your entrepreneurial (mindset|experience|spirit)/i,
                /examples? of (being|your) entrepreneurial/i
            ],
            text: 'I am entrepreneurial in how I turn ambitious goals into self-directed projects and take ownership from idea through execution. Although I did not study computer science, I taught myself programming, moved to the United States, and built a software engineering career at JPMorgan Chase; I bring the same persistence to my work and stay with important problems until they are delivered. I also cofounded a startup in 2017 that built custom chatbot services, and I recently created a Chrome extension that automates job-application form filling, with plans to develop it into a marketable product. Outside work, I choose goals for their long-term value and pursue them with the same discipline, including structured training in Texas for major mountain hikes around the world.'
        },
        {
            // "Tell us about, or post links to some cool things you've built!" (user, 2026-07-27) —
            // distinct from recent-build-essay (a single recent project, the AI financial-validation
            // system) and ordered AFTER it so a "...built recently"-qualified question still lands
            // there; this broader "cool things you've built" prompt gets the Chrome-extension pitch.
            // User-supplied content, lightly polished for grammar; no facts invented.
            topic: 'built-projects-essay',
            patterns: [
                /cool things you(?:'|’)?ve built/i,
                /things you have built/i,
                /tell us about[\s\S]{0,20}(something|projects?)[\s\S]{0,10}you(?:'|’)?ve built/i,
                /share (links to )?(projects|side projects)/i,
                /what have you built/i
            ],
            text: "I'm building an ongoing Chrome extension that automates parts of the LinkedIn and myworkdayjobs job-application process. It stores my information and preferences, then uses rule-based and regex-based matching to recognize common application questions, and users can add their own custom rules. It also includes configurable delays between operations so users don't get suspended for rate limiting. Users can start the workflow, walk away, and come back to hundreds of submitted applications, so that I can apply to jobs 90%+ automatically."
        },
        {
            topic: 'ideal-candidate-pitch',
            patterns: [
                /why are you a (good|strong|great|right) fit for/i,
                /what makes you a (good|strong|great|right) fit/i,
                /why[\s\S]{0,40}(ideal|best|strong|right|good) candidate/i,
                /why (do|should)[\s\S]{0,40}(we hire you|you are the|you're the|consider you)/i,
                /(explain|describe|tell us)[\s\S]{0,50}(ideal candidate|why you are|best fit for)/i
            ],
            text: "I’m a strong fit for a Software Engineer role because over 5+ years I’ve moved beyond pure implementation into end-to-end ownership. In my current role, I design and build backend services, make system design and data modeling decisions, and deliver production systems that need to be reliable, scalable, and maintainable. I’ve worked across APIs, data pipelines, cloud infrastructure, observability, and release operations, which means I understand not just how to code a feature, but how to ship and operate it well. I also enjoy leading through execution: driving technical decisions, improving engineering quality, and taking responsibility for outcomes in fast-moving environments."
        },
        {
            // "What about <company> is exciting to you?" / "Why do you want to work here?" —
            // reusable startup pitch from [ESSAYS] why_startup; the user personalizes per posting.
            topic: 'why-company-essay',
            patterns: [
                /what about[\s\S]{0,60}(is )?(exciting|excites)( to)? you/i,
                // TurbineOne's exact framing (2026-07-26) — the sentence contains the word
                // "website", which must never be mistaken for a Website identity field.
                /other than what you can find on our website[\s\S]{0,80}(exciting|excite)/i,
                /why (are you interested|do you want to (work|join))/i,
                /why (this|our) company/i,
                /what (draws|attracts) you to/i,
                // "What interested you about this role?" (user, 2026-07-27) — the role/company/team
                // wording is interchangeable, so match the shape rather than the noun.
                /what interest(ed|s) you (about|in)/i,
                /what interest(ed|s) you\b/i,
                /(what|why)[\s\S]{0,30}interested in (this|the|our)\s*(role|position|job|opportunity|team|company)/i,
                /what (made|makes) you (want to )?apply/i
            ],
            // "select all that apply" (Plaid/Ashby, 2026-07-28): a "why are you interested" question
            // rendered as a CHECKBOX group is the `employer-interest-reasons` topic below, not this
            // free-text essay — without this exclude, matchBankEntry (first-pattern-wins, order-only)
            // hands the checkbox group to this text-only topic and it fails with "no checkbox option
            // matched" since there is no optionMatch/optionMatchAll here.
            exclude: /select all that apply/i,
            // User-supplied wording, 2026-07-27 (supersedes the earlier phrasing of the same pitch).
            text: 'I am interested in your company because I thrive in new environments where engineers can independently turn ideas into working products—from design and implementation through deployment and customer delivery. My experience across full-stack development, backend services, cloud infrastructure, data platforms, and AI agents allows me to contribute across the product rather than within a limited scope.'
        },
        {
            // "Where do you see yourself in five years?" (TurbineOne 2026-07-26). Reasoned from the
            // user's own [ESSAYS] (long horizons, ownership, growing with the product); flagged for
            // user review in info/myworkdayjobs.
            topic: 'five-year-plan-essay',
            patterns: [/where do you see yourself in (five|5|ten|10) years/i, /(five|5)-year (plan|goal)/i],
            text: 'In five years I see myself as a senior engineer who has grown alongside one product for years - owning reliable systems end to end, keeping them healthy in production, and being accountable for how they behave for the people who depend on them. I want to keep deepening my AI and platform engineering skills, mentor newer engineers, and help shape technical direction as the team and product scale.'
        },
        {
            // "In one sentence, what are you most proud of professionally?" (user, 2026-07-27) —
            // answered with the AI-agent project, in ONE sentence as asked. Ordered BEFORE
            // proud-work-essay so the length-constrained version wins when the form asks for one
            // sentence; the longer pipeline answer still serves the open-ended prompt.
            topic: 'proudest-professional-one-sentence',
            patterns: [
                /in one sentence[\s\S]{0,60}most proud/i,
                /(what are you|what're you) most proud of professionally/i,
                /most proud of professionally/i,
                /one sentence[\s\S]{0,40}proud/i
            ],
            text: 'I am most proud of the AI agent system I built at J.P. Morgan that automates financial-data validation between vendor emails and our internal platform, replacing hours of manual comparison with explainable, exception-based review.'
        },
        {
            // "What exceptional work have you done?" -> [ESSAYS] proud_work_pipeline.
            topic: 'proud-work-essay',
            patterns: [/what exceptional work/i, /(project|piece of work)[\s\S]{0,30}(most )?proud/i],
            text: 'At J.P. Morgan I co-built an end-to-end AWS pipeline for a financial-instrument platform that ingests 30,000+ instruments daily from vendor APIs and normalizes 170+ attributes into validated domain objects. I built the transformation and data-quality layer in PySpark on AWS Glue, persisting canonical records to Aurora PostgreSQL and publishing enriched events through SNS. I am proud of it because it turned messy vendor data into a reliable source of truth that multiple downstream applications depend on daily.'
        },
        {
            // TurbineOne (2026-07-26): "Describe a hire you're most proud of. What made them
            // successful after they joined, and what role did you personally play in that outcome?"
            // User-approved verbatim answer, banked in info/myworkdayjobs [ESSAYS] proudest_hire.
            topic: 'proudest-hire-essay',
            patterns: [
                /(hire|placement)[\s\S]{0,40}(most )?proud/i,
                /proudest[\s\S]{0,20}(hire|placement)/i,
                /describe a hire/i
            ],
            text: 'I\'m a software engineer rather than a professional recruiter, so I\'ll answer from the engineering side of hiring. The hire I\'m proudest of contributing to was a junior engineer who joined my team at J.P. Morgan. I took part in the interview loop and then much of the onboarding - pairing on their first production changes, reviewing designs, and walking them through our AWS data pipeline. Within months they were independently delivering features and supporting production. Seeing someone I helped select and mentor grow into a dependable owner of our systems is what I\'m most proud of.'
        },
        {
            // TurbineOne (2026-07-26): "Tell us about the smallest company you've recruited for."
            // User-approved verbatim answer, banked as [ESSAYS] smallest_company_recruited.
            topic: 'smallest-company-essay',
            patterns: [
                /smallest (company|team|org(anization)?|startup)[\s\S]{0,40}(recruited|hired|worked|built) for/i,
                /smallest (company|team|org(anization)?|startup)[\s\S]{0,60}recruit/i,
                /(recruited|hired) for[\s\S]{0,30}smallest/i
            ],
            text: 'The smallest was my own: in 2017 I cofounded a three-person startup building a WeChat chatbot that let customers make appointments. At that size there was no recruiting team - bringing anyone on board meant personally convincing them to bet on an unproven idea, and every single addition changed what the company could do. That experience left me with real respect for early-stage hiring.'
        },
        {
            // ROOT acknowledgement topic (user screenshots 2026-07-26, banked in
            // [PrivacyNoticeAcknowledgement]): "Privacy Notice Acknowledgement*" dropdowns whose
            // only real option is "Acknowledge", and "Note from <company>" note-acknowledgement
            // dropdowns (Iterable). Ordered precedence: acknowledge > yes/agree > accept/consent;
            // a checkbox control is simply checked (`check: true`).
            topic: 'privacy-notice-acknowledgement',
            patterns: [
                /privacy (notice|policy|statement|act)[\s\S]{0,40}acknowledge?(ment)?/i,
                /(acknowledge|agree to|accept|consent to)[\s\S]{0,60}privacy (notice|policy|statement)/i,
                /(data )?privacy (notice|policy|statement)\b/i,
                /(have read|read and understood)[\s\S]{0,60}privacy/i,
                /have you read[\s\S]{0,30}privacy (policy|notice|statement)/i,
                /^note from [\w .&-]{1,40}$/i,
                /(please )?(read and )?acknowledge[\s\S]{0,40}(note|notice|statement|below|following)/i,
                /committed to[\s\S]{0,80}(acknowledge|below)/i
            ],
            // Never steal the marketing/talent-network consent questions (their own topics). The
            // "contact you about job opportunities" clause also belongs to consent-future-
            // opportunities even when it cites a named "Recruiting Privacy Policy" (user, 2026-07-27,
            // Column) — the policy name is just a parenthetical, not the real question.
            exclude: /future[\s\S]{0,25}(job|career|position|opening)|sms|text message|whatsapp|contact (you|me)[\s\S]{0,100}(job|career)[\s\S]{0,20}opportunit/i,
            optionCandidates: [/acknowledge/i, /^\s*(yes|i agree|agree)\b/i, /^\s*(i )?(accept|consent)\b/i],
            optionLabel: 'Acknowledge',
            check: true
        },
        {
            topic: 'acknowledgement-generic',
            patterns: [/\backnowledg(e|es|ed|ing|ement|ment)\b/i],
            choose: 'yes',
            optionCandidates: [
                /^\s*yes\b/i,
                /^\s*(acknowledge|i acknowledge)\b/i,
                /^\s*(i agree|agree|i accept|accept)\b/i
            ],
            optionLabel: 'Yes / Acknowledge',
            check: true
        },
        {
            // Pronouns picker (explicit user selection confirmed 2026-07-27). Precedence:
            // "He / Him / His" > any option starting with "He" >
            // decline/prefer-not. Never She/They/Other. Ordered BEFORE gender so a combined
            // gender/pronoun label routes here.
            topic: 'pronouns',
            patterns: [
                /\bpronouns?\b/i,
                /(what|which) pronouns? (do you use|should we use|do you go by)/i,
                /(select|share|indicate)( your)? pronouns?/i
            ],
            optionCandidates: [
                /^\s*he\s*\/?\s*him(\s*\/?\s*his)?\b/i,
                /^\s*he\b/i,
                /^\s*(decline|prefer not|i (do not|don'?t) wish)/i
            ],
            optionLabel: 'He / Him / His'
        },
        {
            // STANDING RULE (user, 2026-07-28): "Do you have experience …?" is always YES,
            // whatever technology or practice follows. Deliberately ordered AFTER the specific
            // experience topics above so they keep their own tailored answers, and excluded from
            // the "how many years" / years-band questions, which need a number rather than Yes.
            topic: 'has-experience-generic',
            patterns: [
                /do you have (any |prior |previous |professional |hands[- ]on )?experience/i
            ],
            exclude: /how many years|years of (relevant|professional)|please (describe|explain|list)|which of the following/i,
            choose: 'yes'
        },
        // ── EEO / voluntary self-identification (defaults per info/myworkdayjobs) ──
        // Option lists confirmed live on 6sense 2026-07-26.
        {
            // Pattern widened 2026-07-27 to cover "What is your gender identity?" — the plain
            // question wording, distinct from the "how would you describe…"/"mark all that apply"
            // checklist phrasing already handled. optionCandidates is the project's ordered
            // precedence: prefer "Cisgender man" when offered, else plain "Man"/"Male".
            topic: 'gender-identity',
            patterns: [
                /how would you describe your gender identity/i,
                /gender identity[\s\S]{0,40}mark all that apply/i,
                /what is your gender identity/i,
                /\bgender identity\b/i,
                // "I identify my gender as:" and the bare "I identify as:" (user, 2026-07-28) —
                // the latter offers Cisgender / Transgender rather than man / woman, hence the
                // extra candidate below.
                /^i identify (my gender )?as\b/i,
                /identify my gender/i
            ],
            optionCandidates: [/cisgender man/i, /^\s*man\s*$/i, /^\s*male\s*$/i, /^\s*cisgender\s*$/i],
            optionMatch: /^\s*man\s*$/i,
            optionLabel: 'Cisgender man'
        },
        {
            topic: 'racial-ethnic-background',
            patterns: [/how would you describe your racial\/?ethnic background/i, /racial or ethnic background[\s\S]{0,40}mark all that apply/i],
            optionMatch: /^\s*east[\s-]?asian\s*$/i,
            optionLabel: 'East Asian'
        },
        {
            topic: 'sexual-orientation',
            patterns: [
                /how would you describe your sexual orientation/i,
                // "How do you identify your sexual orientation? Please select all that apply." (Promise/Ashby, 2026-07-28)
                /how do you identify your sexual orientation/i,
                /\bsexual orientation\b/i
            ],
            // Word-boundary, not end-anchored: covers plain "Heterosexual" AND "Heterosexual / straight"
            // (confirmed live 2026-07-28) without matching unrelated options.
            optionMatch: /\bheterosexual\b/i,
            optionLabel: 'Heterosexual / straight'
        },
        {
            topic: 'transgender',
            patterns: [/do you identify as transgender/i, /\btransgender\b/i],
            choose: 'no'
        },
        {
            // "Do you identify as part of the LGBTQ+ community?" (user, 2026-07-27) — a separate
            // question from `transgender`/`sexual-orientation` (broader community-membership scope,
            // not a specific identity/orientation picker). `choose:'no'` already resolves to
            // /^\s*no\b/i via chooserPredicate.
            topic: 'lgbtq-identity',
            patterns: [
                /lgbtq/i,
                /identify as (part of )?(the )?lgbtq/i,
                /part of the lgbtq\+? community/i
            ],
            choose: 'no',
            text: 'No'
        },
        {
            topic: 'disability-major-life',
            patterns: [/disability or chronic condition[\s\S]{0,180}substantially limits/i, /substantially limits[\s\S]{0,100}major life activities/i],
            optionMatch: /^\s*no\b/i,
            optionLabel: 'No'
        },
        {
            topic: 'veteran-active-member',
            patterns: [/veteran or active member[\s\S]{0,60}(armed forces|military)/i, /active member of the united states armed forces/i],
            optionMatch: /^\s*no,\s*i am not a veteran or active member\b/i,
            optionLabel: 'No, I am not a veteran or active member'
        },
        { topic: 'gender', patterns: [/^gender\b/i, /select your gender/i, /what is your gender/i], optionMatch: /^\s*(male|man)\b/i, optionLabel: 'Male' },
        {
            // Exclude refined 2026-07-27 (Indeed/Infosys EEO): the Hispanic/Latino question's own
            // parenthetical can say "…regardless of race", which must NOT push it to the race
            // topic. Only race-question wording (identify/select race, race category, racial,
            // race/ethnicity) routes away.
            topic: 'hispanic-latino',
            patterns: [/hispanic/i, /latino/i],
            exclude: /(identify|select|indicate|describe)[\s\S]{0,30}race|race\/?[\s-]?ethnicity|racial|race category/i,
            optionMatch: /^\s*no\b/i,
            optionLabel: 'No'
        },
        {
            // "What is your race or ethnicity?" (user, 2026-07-27) already reaches this topic via
            // the bare /\brace\b/i pattern. optionCandidates upgrades the pick to prefer "East Asian"
            // when offered (project ordered-precedence convention), keeping the old broad /asian/
            // match as the final fallback so every previously-passing tenant still resolves.
            topic: 'race-ethnicity',
            patterns: [/\brace\b/i, /ethnicity/i],
            optionCandidates: [/east asian/i, /^\s*asian\b/i, /\basian\b/i],
            optionMatch: /\basian\b/i,
            optionLabel: 'East Asian'
        },
        {
            // Anchored at the option start so "I identify as one or more of the classifications of a
            // protected veteran" can never be picked. Optional leading "No," added 2026-07-27
            // (Indeed/Infosys VEVRAA wording: "No, I am not a veteran under one of the
            // classifications listed above"); "Yes, I am…" variants still never match the anchor.
            // "military status" pattern + optionCandidates added 2026-07-27 for "What is your
            // military status?" — prefer "never served" wording, falling back to the original
            // "not a veteran" match for tenants that only offer that phrasing.
            topic: 'veteran',
            patterns: [/veteran/i, /military status/i],
            optionCandidates: [
                /never served/i,
                /have not served/i,
                /no military service/i,
                /^\s*(no,?\s+)?(i\s+am\s+)?not\s+a\s+(protected\s+)?veteran\b/i
            ],
            optionMatch: /^\s*(no,?\s+)?(i\s+am\s+)?not\s+a\s+(protected\s+)?veteran\b/i,
            optionLabel: 'I have never served in the military'
        },
        {
            // "What is your disability status?" (user, 2026-07-27) already reaches this topic via
            // the bare /disability/i pattern. optionCandidates prefers the exact "No, I don't have a
            // disability" wording, falling back to the original guarded "No … not have" match — never
            // a decline-to-answer option (neither candidate can hit "I don't wish to answer").
            topic: 'disability',
            patterns: [/disability/i, /consider yourself to have a disability/i, /disability status/i],
            optionCandidates: [
                // Real forms use a TYPOGRAPHIC apostrophe as often as an ASCII one ("I don’t have a
                // disability"), so every contraction here accepts both (user-reported 2026-07-28).
                /no,?\s*i\s*don['’]?t\s*have\s*a\s*disability/i,
                /^\s*no\b[\s\S]{0,25}(do(es)?n['’]?t|do not) have a disability/i,
                /^\s*no\b[\s\S]{0,20}(do not have a disability|not have)/i,
                // "I have a disability: Yes / No" (user, 2026-07-28) — a plain negative, taken only
                // after the long forms so a decline option can never win.
                /^\s*no\s*$/i
            ],
            optionMatch: /^\s*no\b[\s\S]{0,20}(do not have a disability|not have)/i,
            optionLabel: "No, I don't have a disability",
            text: "No, I don't have a disability"
        },
        {
            // "What is your current age?" (Promise/Ashby, 2026-07-28) — a VOLUNTARY EEO age-bracket
            // disclosure (Under 30 / 30-39 / 40-49 / 50-59 / 60 or older / I prefer not to answer),
            // distinct from the "age-minimum" Yes/No eligibility gate below. No real age fact is
            // established in info/myworkdayjobs, and this class of voluntary self-ID question always
            // has a legitimate decline option — same convention as gender/veteran/disability/hispanic
            // when asked to disclose rather than confirm eligibility: decline rather than guess.
            topic: 'age-bracket-voluntary',
            patterns: [/what is your current age/i, /^current age$/i, /age bracket/i, /select your age range/i],
            optionMatch: /prefer not to answer/i,
            optionLabel: 'I prefer not to answer'
        },
        // US sanctions / export-control screen (xAI/Databricks style) — Chinese national in the US
        // on H-1B: for the Yes/No variant the answer is No.
        { topic: 'export-control-restricted-country', patterns: [/(citizen|national|resident) of (cuba|iran|north korea|syria)/i, /sanctions and export controls/i], choose: 'no' },
        {
            topic: 'age-minimum',
            patterns: [
                /at least 18 years/i,
                /18 years (of age|or older)/i,
                /minimum age/i,
                /age of majority[\s\S]{0,180}right to contract[\s\S]{0,60}(own|your) name/i,
                /(age 18|age 19|18 or 19)[\s\S]{0,140}(right|capacity|ability) to contract/i,
                /(legal age|legally old enough)[\s\S]{0,100}contract in (your|my) own name/i
            ],
            choose: 'yes'
        },
        {
            // "Do you agree to allow Column to contact you about job opportunities for up to 2
            // years? (Recruiting Privacy Policy)" (user, 2026-07-27) — the company name and duration
            // are incidental; match the shape: agree/consent to being contacted about future job
            // opportunities. `choose:'yes'` already tries "I agree" via chooserPredicate before "yes".
            topic: 'consent-future-opportunities',
            patterns: [
                /consent[\s\S]{0,80}(future|other)[\s\S]{0,20}(job|career)/i,
                /talent (network|community)/i,
                /(agree|consent)[\s\S]{0,100}(contact|reach out to) (you|me)[\s\S]{0,100}(job|career)[\s\S]{0,20}opportunit/i,
                /(contact|reach out to) (you|me)[\s\S]{0,100}(job|career)[\s\S]{0,20}opportunit[\s\S]{0,80}(agree|consent)/i,
                /recruiting privacy policy/i
            ],
            choose: 'yes',
            optionLabel: 'I agree'
        },
        {
            topic: 'consent-sms-contact',
            patterns: [
                /via (sms|text message)/i,
                /text message updates[\s\S]{0,80}job application/i,
                /consent to receiving text messages/i,
                /message and data rates may apply/i,
                /\bwhatsapp\b/i
            ],
            optionMatch: /^\s*(opt[\s-]?out|no)\b/i,
            optionLabel: 'No / Opt-Out'
        },
        {
            // "Why are you interested in working at <Company>? Select all that apply." (Plaid/Ashby,
            // 2026-07-28) — company name is a wildcard. Ticks the options that are genuinely true
            // (AI-building interest, industry/fintech passion, product & technical innovation) and
            // leaves generic/unverifiable ones (bare "Mission", "Culture") unticked rather than
            // over-claiming.
            topic: 'employer-interest-reasons',
            patterns: [
                /why are you interested in working (at|for)[\s\S]{0,60}\?/i,
                /what interests you (about|most about) working (at|for)/i
            ],
            optionMatchAll: [
                /\bai\b|artificial intelligence/i,
                /passion for[\s\S]{0,20}(fintech|industry)/i,
                /products?[\s\S]{0,20}(technical )?innovation/i
            ]
        },
        {
            // "Based on your current impression, how would you rate <Company>'s position in AI
            // compared to other tech companies?" (Plaid/Ashby, 2026-07-28) — a subjective opinion
            // survey about a specific company the applicant has no real informed view of. The
            // honest, generalizable answer for ANY company here is the decline/no-information
            // option, never a fabricated rating.
            topic: 'ai-position-opinion-survey',
            patterns: [
                /rate[\s\S]{0,40}position in ai[\s\S]{0,40}compared to other tech companies/i,
                /current impression[\s\S]{0,60}position in ai/i
            ],
            optionMatch: /not enough information/i,
            optionLabel: "N/A - Not enough information"
        },
        {
            // "How much time do you spend on frontend development?" (Plaid/Ashby, 2026-07-28) — a
            // self-assessment bracket. Answered from the actual CV weighting (backend-heavy: AWS
            // data pipelines, Spring Boot services, Document Broker Service, Terraform IaC; the one
            // frontend line item is a single React admin portal) — honestly under 40%, even though
            // the form itself suggests exploring Backend Engineering roles instead at that answer.
            topic: 'frontend-time-percentage',
            patterns: [/how much time do you spend on frontend development/i, /frontend[\s\S]{0,20}%[\s\S]{0,20}time/i],
            optionMatch: /^\s*<\s*40\s*%/,
            optionLabel: '< 40%'
        },
        {
            // "Are you comfortable being evaluated on front-end engineering skills as part of the
            // interview process?" (Plaid/Ashby, 2026-07-28) -> Yes.
            topic: 'frontend-interview-comfort',
            patterns: [/comfortable being evaluated on front-?end engineering skills/i],
            choose: 'yes'
        },
        {
            // "Preferred Work Location — Select all that apply" (office checkboxes: Plaid/Ashby,
            // 2026-07-28) — a location CHOICE among the employer's own offices, not an ability
            // question. Same "always willing to relocate" standing rule as everywhere else: tick
            // every listed office rather than picking one.
            topic: 'preferred-work-location',
            patterns: [/preferred work location/i, /which (office|location)s?[\s\S]{0,40}(would|do) you prefer/i],
            checkAll: true
        }
    ];
    // END spliced bank

    // ── Indeed-only MULTI-select combobox questions (chip-based; deliberately NOT part of the
    // spliced DEFAULT_INDEED_QUESTIONS bank above — greenhouse.js has no equivalent widget, so this
    // array lives outside the BEGIN/END splice markers and tools/sync-indeed-bank.js never touches
    // it). Unlike the single-index chooserPicker entries, `optionMatch` here can match MANY options
    // at once (every option gets independently tested), because the field accepts multiple values.
    // User extensions merge via indeedSavedAnswers.multiSelectQuestions ({ topic, patterns:[glob…],
    // optionMatch }).
    const DEFAULT_INDEED_MULTISELECT_QUESTIONS = [
        {
            // "What is location" — a required multi-select of specific office/remote-city options
            // for this posting (confirmed live 2026-07-27, Hudson Manpower "QA Automation Engineer
            // IV"; popup lists ~50 US cities with no virtualization). Matches info/myworkdayjobs
            // [CONTACT] "Remote US states able to work in: CA, WA, TX": select every offered option
            // naming one of those three states ("Remote (Dallas, Texas...)", "San Jose, CA",
            // "Redmond, WA", etc.), never a state outside that list.
            topic: 'preferred-work-locations',
            patterns: [/what is location/i, /which location/i, /select (all )?locations?/i, /preferred location/i, /location(s)? (would|do) you/i],
            optionMatch: /california|washington|texas/i
        }
    ];
    async function indeedMultiSelectBank() {
        const stored = await storageGet([INDEED_INFO_KEY]);
        const extra = stored[INDEED_INFO_KEY]?.multiSelectQuestions;
        const entries = DEFAULT_INDEED_MULTISELECT_QUESTIONS.map(entry => ({ ...entry, patterns: [...entry.patterns] }));
        (Array.isArray(extra) ? extra : []).forEach(raw => {
            if (!raw || !raw.topic) return;
            const patterns = (Array.isArray(raw.patterns) ? raw.patterns : []).map(globToRegExp).filter(Boolean);
            const existing = entries.find(entry => entry.topic === raw.topic);
            if (existing) {
                existing.patterns.push(...patterns);
                if (raw.optionMatch) { const re = globToRegExp(raw.optionMatch); if (re) existing.optionMatch = re; }
            } else if (patterns.length) {
                entries.push({ topic: raw.topic, patterns, optionMatch: raw.optionMatch ? globToRegExp(raw.optionMatch) : undefined });
            }
        });
        return entries;
    }

    // ── Tiny shared helpers ───────────────────────────────────────────────────────────────────
    const WAIT = ms => new Promise(resolve => setTimeout(resolve, ms));
    const clean = value => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    function visible(element) {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        return (rect.width > 0 && rect.height > 0) || element.offsetParent !== null;
    }
    function bulletize(message) {
        return String(message == null ? '' : message).split('\n').map(line => line.trim()).filter(Boolean).map(line => `• ${line}`).join('\n');
    }
    function storageGet(keys) { return new Promise(resolve => chrome.storage.local.get(keys, resolve)); }
    function storageSet(value) { return new Promise(resolve => chrome.storage.local.set(value, resolve)); }
    function globToRegExp(glob) {
        const source = String(glob == null ? '' : glob).trim();
        if (!source) return null;
        try { return new RegExp(source.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s\\S]*'), 'i'); }
        catch { return null; }
    }
    function setNativeValue(input, value) {
        const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
        try { input.focus(); } catch { }
        if (setter) setter.call(input, value); else input.value = value;
        input.dispatchEvent(new InputEvent('input', { bubbles: true, data: String(value), inputType: 'insertText' }));
        input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Unidentified' }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
        try { input.blur(); } catch { }
    }
    function realClick(target) {
        const opts = { bubbles: true, cancelable: true, composed: true, view: window, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true };
        try { target.scrollIntoView?.({ block: 'center' }); } catch { }
        target.dispatchEvent(new PointerEvent('pointerdown', opts));
        target.dispatchEvent(new MouseEvent('mousedown', opts));
        target.dispatchEvent(new PointerEvent('pointerup', opts));
        target.dispatchEvent(new MouseEvent('mouseup', opts));
        target.dispatchEvent(new MouseEvent('click', opts));
    }
    // Click away onto empty page space (user, 2026-07-27, shared across T2–T6): blur the control
    // and click neutral space so the page's own validation registers the value. Events are
    // dispatched directly on <body>, so no other control can be hit.
    function clickAway() {
        try { document.activeElement?.blur?.(); } catch { }
        const opts = { bubbles: true, cancelable: true, composed: true, view: window, button: 0 };
        document.body.dispatchEvent(new PointerEvent('pointerdown', opts));
        document.body.dispatchEvent(new MouseEvent('mousedown', opts));
        document.body.dispatchEvent(new PointerEvent('pointerup', opts));
        document.body.dispatchEvent(new MouseEvent('mouseup', opts));
        document.body.dispatchEvent(new MouseEvent('click', opts));
    }
    // Every TEXT field: click the field → type → click away → pause, then the next field. Filling
    // back-to-back too quickly left required inputs still counted as empty by the page.
    // Native date/month inputs only accept yyyy-mm-dd (or yyyy-mm); a free-text box takes the
    // human wording. The control decides which representation of a banked answer is used.
    function answerForControl(input, entry, fallback) {
        const type = String(input.type || '').toLowerCase();
        if (entry && entry.date && (type === 'date' || type === 'month')) {
            return type === 'month' ? entry.date.slice(0, 7) : entry.date;
        }
        return fallback;
    }
    async function fillTextField(input, value) {
        realClick(input);
        try { input.focus(); } catch { }
        setNativeValue(input, value);
        clickAway();
        await WAIT(SELECTION_SETTLE_MS);
    }
    function isOurUi(node) { return Boolean(node.closest?.(`#${PANEL_ID}`)); }

    // ── Step detection ────────────────────────────────────────────────────────────────────────
    // Smart Apply URLs: https://smartapply.indeed.com/beta/indeedapply/form/<module>/<step>
    // Confirmed live 2026-07-27: resume-selection-module/resume-selection (H1 "Add a resume",
    // radio-card group data-testid="resume-selection-radio-card-group", footer
    // data-testid="continue-button"). Later steps are detected generically until observed.
    function stepPath() {
        const match = location.pathname.match(/\/form\/(.+)$/);
        return match ? match[1] : location.pathname;
    }
    function stepHeading() {
        const headings = [...document.querySelectorAll('h1, h2')].filter(h => visible(h) && !isOurUi(h));
        // First H1 is the job title; the step heading is the last visible H1/H2.
        return clean(headings[headings.length - 1]?.innerText);
    }

    // Best-effort title for the unified Applied Jobs record, reusing the same heading scan as
    // stepHeading() above — "First H1 is the job title." Company is rarely exposed cleanly on
    // Indeed's Smart Apply wizard; left blank when not derivable — `url` is the reliable column
    // regardless. See AGENTS.md "Applied Jobs Log".
    function bestEffortIndeedJobMeta() {
        const headings = [...document.querySelectorAll('h1, h2')].filter(h => visible(h) && !isOurUi(h));
        const title = clean(headings[0]?.innerText || document.title || '');
        return { title, company: '' };
    }

    // Fire-and-forget write of the unified cross-platform Applied Jobs record (Settings → Applied
    // Jobs tab). Never blocks the submit result.
    function recordIndeedApplication() {
        try {
            const meta = bestEffortIndeedJobMeta();
            sendRuntimeMessage({
                type: 'eve:record-applied-job',
                record: {
                    platform: 'indeed',
                    title: meta.title,
                    company: meta.company,
                    location: '',
                    url: location.href,
                    mode: autoModeEnabled ? 'auto' : 'manual',
                    appliedAt: new Date().toISOString(),
                    timestamp: Date.now()
                }
            }).catch(() => {});
        } catch { /* non-fatal */ }
    }
    function stepSignature() {
        return `${stepPath()}::${stepHeading()}::${document.querySelectorAll('input, textarea, select').length}`;
    }
    function isResumeSelectionStep() {
        return /resume-selection|resume-module/i.test(stepPath())
            || Boolean(document.querySelector('[data-testid="resume-selection-form"], [data-testid="resume-selection-radio-card-group"]'));
    }
    function findSubmitButton() {
        return [...document.querySelectorAll('button, input[type="submit"]')]
            .filter(button => visible(button) && !isOurUi(button))
            .find(button => /submit( your)?( application)?$/i.test(clean(button.innerText || button.value))) || null;
    }
    function isReviewStep() {
        return /review/i.test(stepPath()) || /review your application/i.test(stepHeading()) || Boolean(findSubmitButton());
    }
    function findContinueButton() {
        const byTestId = document.querySelector('[data-testid="continue-button"]');
        if (byTestId && visible(byTestId)) return byTestId;
        return [...document.querySelectorAll('button')]
            .filter(button => visible(button) && !isOurUi(button))
            .find(button => {
                const text = clean(button.innerText);
                if (/submit/i.test(text)) return false; // never the submit control
                return /^(continue|next|save and continue|review your application)$/i.test(text);
            }) || null;
    }

    // ── Labels / required detection (generic, template-tolerant) ──────────────────────────────
    function labelForInput(input) {
        if (input.id) {
            const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
            if (label) return clean(label.textContent).replace(/\s*\*$/, '');
        }
        const labelledBy = input.getAttribute('aria-labelledby');
        if (labelledBy) {
            const label = document.getElementById(labelledBy.split(/\s+/)[0]);
            if (label) return clean(label.textContent).replace(/\s*\*$/, '');
        }
        const aria = clean(input.getAttribute('aria-label'));
        if (aria) return aria;
        const wrapped = input.closest('label');
        if (wrapped) return clean(wrapped.textContent).replace(/\s*\*$/, '');
        // Start at the parent: the input itself carries data-testid on Indeed, and matching self
        // would return an empty container (round-2 lesson).
        const wrap = input.parentElement?.closest('fieldset, [class*="field"], [class*="question"], [data-testid]');
        const label = wrap?.querySelector('label, legend, [class*="label"], [class*="Question"]');
        return label ? clean(label.textContent).replace(/\s*\*$/, '') : '';
    }
    // IMPORTANT (confirmed live 2026-07-27, questions-module/questions/3): the question container
    // is fieldset[data-testid="input-q_<hash>"][role=radiogroup][aria-required] with the question
    // text in its <legend> ("… *"); each radio's own wrapping label is just the OPTION text
    // ("Yes"/"No"). The radio INPUT also carries data-testid, so the container lookup must never
    // include bare [data-testid]/[class*=question] — closest() would match the input itself and
    // lose the question entirely (the round-2 silent-skip bug).
    function radioGroupContainer(radios) {
        return radios[0].closest('fieldset, [role="radiogroup"]');
    }
    function radioGroupLabel(radios) {
        const container = radioGroupContainer(radios);
        const legend = container?.querySelector('legend');
        if (legend && clean(legend.textContent)) return clean(legend.textContent).replace(/\s*\*$/, '');
        const labelledBy = container?.getAttribute('aria-labelledby');
        if (labelledBy) {
            const label = document.getElementById(labelledBy.split(/\s+/)[0]);
            if (label) return clean(label.textContent).replace(/\s*\*$/, '');
        }
        const first = container?.querySelector('label');
        if (first && first.htmlFor !== radios[0].id && !first.contains(radios[0])) return clean(first.textContent).replace(/\s*\*$/, '');
        return labelForInput(radios[0]);
    }
    function radioGroupRequired(radios) {
        const container = radioGroupContainer(radios);
        if (container?.getAttribute('aria-required') === 'true') return true;
        if (/\*\s*$/.test(clean(container?.querySelector('legend')?.textContent || ''))) return true;
        return radios.some(radio => radio.required || radio.getAttribute('aria-required') === 'true');
    }
    function optionLabelFor(input) {
        if (input.id) {
            const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
            if (label) return clean(label.textContent);
        }
        return clean(input.closest('label')?.textContent) || clean(input.value);
    }
    function isRequiredInput(input) {
        if (input.required || input.getAttribute('aria-required') === 'true') return true;
        if (input.id) {
            const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
            if (label && /\*\s*$/.test(label.textContent)) return true;
        }
        const container = input.closest('fieldset, [class*="question"]');
        return container?.getAttribute('aria-required') === 'true'
            || /\(required\)|\*\s*$/i.test(clean(container?.querySelector('legend, label')?.textContent || ''));
    }

    // ── Question bank matching (same engine as gh) ────────────────────────────────────────────
    async function indeedQuestionBank() {
        const stored = await storageGet([INDEED_INFO_KEY]);
        const extra = stored[INDEED_INFO_KEY]?.questions;
        const entries = DEFAULT_INDEED_QUESTIONS.map(entry => ({ ...entry, patterns: [...entry.patterns] }));
        (Array.isArray(extra) ? extra : []).forEach(raw => {
            if (!raw || !raw.topic) return;
            const patterns = (Array.isArray(raw.patterns) ? raw.patterns : []).map(globToRegExp).filter(Boolean);
            const existing = entries.find(entry => entry.topic === raw.topic);
            if (existing) {
                existing.patterns.push(...patterns);
                if (raw.choose) existing.choose = raw.choose;
                if (raw.text != null) existing.text = raw.text;
                if (raw.optionMatch) { const re = globToRegExp(raw.optionMatch); if (re) existing.optionMatch = re; }
            } else if (patterns.length) {
                entries.push({ topic: raw.topic, patterns, choose: raw.choose, text: raw.text, optionMatch: raw.optionMatch ? globToRegExp(raw.optionMatch) : undefined });
            }
        });
        return entries;
    }
    function matchProfileField(label) {
        return INDEED_PROFILE_FIELDS.find(entry => {
            if (entry.shortLabelOnly && (label.length > 40 || label.includes('?'))) return false;
            return entry.label.test(label);
        }) || null;
    }
    function matchBankEntry(entries, questionText) {
        const text = clean(questionText);
        if (!text) return null;
        for (const entry of entries) {
            if (entry.exclude && entry.exclude.test(text)) continue;
            if (entry.patterns.some(re => re.test(text))) return entry;
        }
        return null;
    }
    function chooserPredicate(entry) {
        if (entry.optionMatch) return text => entry.optionMatch.test(text);
        if (entry.choose === 'yes') return text => /^\s*yes\b/i.test(text) || /^\s*i (can|agree|acknowledge|affirm)\b/i.test(text);
        if (entry.choose === 'no') return text => /^\s*no\b/i.test(text);
        return null;
    }
    function chooserPicker(entry) {
        if (entry.optionCandidates) {
            return texts => {
                for (const candidate of entry.optionCandidates) {
                    const index = texts.findIndex(text => candidate.test(text));
                    if (index >= 0) return index;
                }
                return -1;
            };
        }
        const pred = chooserPredicate(entry);
        return pred ? texts => texts.findIndex(pred) : null;
    }
    const OPTION_PLACEHOLDER = /^(select|choose|please select|pick one|--|—|\.{3}|…)/i;
    function pickSingletonIndex(texts) {
        const real = texts.map((text, index) => ({ text, index })).filter(o => o.text && !OPTION_PLACEHOLDER.test(o.text));
        return real.length === 1 ? real[0].index : -1;
    }
    async function persistSeenQuestions(seen) {
        if (!seen.length) return;
        try {
            const stored = await storageGet([INDEED_INFO_KEY]);
            const info = stored[INDEED_INFO_KEY] || {};
            const existing = Array.isArray(info.seenQuestions) ? info.seenQuestions : [];
            const merged = [...existing];
            seen.forEach(item => { if (!merged.some(other => other.question === item.question)) merged.push(item); });
            info.seenQuestions = merged.slice(-200);
            await storageSet({ [INDEED_INFO_KEY]: info });
        } catch { /* non-fatal */ }
    }

    // ── Packaged artifacts (allowlisted background message, same boundary as Workday/gh) ─────
    function sendRuntimeMessage(message) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(message, response => {
                const error = chrome.runtime.lastError;
                if (error) reject(new Error(error.message));
                else if (!response?.ok) reject(new Error(response?.error || 'The packaged document could not be loaded.'));
                else resolve(response);
            });
        });
    }
    function base64ToBytes(value) {
        const binary = atob(value);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        return bytes;
    }
    async function packagedArtifactFile(artifactId) {
        // The name/size of the packaged PDFs comes from whatever this installation configured
        // (eve/profile.local.json -> background.js), so only the artifact ID is validated here;
        // the bytes themselves are checked below.
        if (!ARTIFACT_IDS.includes(artifactId)) throw new Error('Unsupported packaged document.');
        const response = await sendRuntimeMessage({ type: MSG('get-workday-artifact'), artifactId });
        const artifact = response.artifact || {};
        if (artifact.type !== 'application/pdf' || !artifact.name) {
            throw new Error('The packaged document metadata is invalid.');
        }
        if (!artifact.dataBase64 || artifact.size <= 0 || artifact.size > MAX_ARTIFACT_BYTES) {
            throw new Error('The packaged PDF is empty, oversized, or unreadable.');
        }
        const bytes = base64ToBytes(artifact.dataBase64);
        if (bytes.byteLength !== Number(artifact.size) || String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') {
            throw new Error('The packaged PDF contents failed validation.');
        }
        return new File([bytes], artifact.name, { type: 'application/pdf', lastModified: 0 });
    }

    // ── Session (per-tab, explicit-activation only) ───────────────────────────────────────────
    // Stored in sessionStorage so a running Auto loop can survive the wizard's own in-tab
    // navigations, but never leaks to other tabs and never outlives the tab. Only state
    // 'running' + activatedByUser resumes on boot; every pause writes 'waiting'.
    function loadSession() {
        try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
    }
    function saveSession(state, patch = {}) {
        try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ...(loadSession() || {}), state, ...patch })); } catch { }
    }

    // ── Step handlers ─────────────────────────────────────────────────────────────────────────
    // Resume selection (confirmed live 2026-07-27, Infosys "Graph DB Developer"):
    // radio cards under [data-testid="resume-selection-radio-card-group"], radio
    // name="resume-selection"; value "file" = the resume already uploaded to Indeed
    // (the packaged resume, preselected). A hidden file input
    // ([data-testid="resume-selection-file-resume-radio-card-file-input"]) can take a fresh
    // upload — used as fallback when no resume card exists yet.
    async function handleResumeSelection() {
        const radios = [...document.querySelectorAll('input[type="radio"][name*="resume" i]')]
            .filter(radio => !isOurUi(radio));
        if (radios.length) {
            if (!radios.some(radio => radio.checked)) {
                const preferred = radios.find(radio => /file/i.test(radio.value)) || radios[0];
                const card = preferred.closest('[data-testid$="radio-card"], label') || preferred;
                realClick(card);
                await WAIT(200);
                if (!radios.some(radio => radio.checked)) {
                    // Fall back to checking the input directly.
                    preferred.click();
                    await WAIT(100);
                }
            }
            const chosen = radios.find(radio => radio.checked);
            if (!chosen) return { ok: false, message: 'Could not select a resume option.' };
            setStatus(`Resume selected (${optionLabelFor(chosen) || chosen.value}).`, 'running');
            return { ok: true, detail: 'resume selected' };
        }
        // No resume on file: upload the packaged artifact through the real file input.
        const fileInput = document.querySelector('[data-testid*="file-input"], input[type="file"]');
        if (!fileInput) return { ok: false, message: 'No resume option or file input found on the resume step.' };
        try {
            const file = await packagedArtifactFile('resume');
            const transfer = new DataTransfer();
            transfer.items.add(file);
            fileInput.files = transfer.files;
            fileInput.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
            fileInput.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
            const deadline = Date.now() + 20000;
            while (Date.now() < deadline) {
                if (document.body.innerText.includes(file.name)
                    || [...document.querySelectorAll('input[type="radio"]')].some(radio => radio.checked)) break;
                await WAIT(300);
            }
            setStatus('Packaged resume uploaded.', 'running');
            return { ok: true, detail: 'resume uploaded' };
        } catch (error) {
            return { ok: false, message: `Resume upload failed: ${error.message || error}` };
        }
    }

    // Cover-letter file-upload question (confirmed live 2026-07-27, questions-module/questions/1):
    // renders as TWO separate question items — a "Cover letter" radio group ("Upload a file" /
    // "Enter text") followed by a sibling item whose own legend is "Upload a file" holding the
    // real hidden file input (data-testid ends in "upload-button-file-input"). The radio group
    // itself has no file input, so the generic radio-group loop below (which skips already-checked
    // groups) never attaches anything.
    //
    // HARD PLATFORM LIMIT (confirmed live 2026-07-27 via chrome-devtools MCP): Indeed's upload
    // handler ignores a script-dispatched 'change'/'input' event on this input — `files` is set for
    // an instant, then silently cleared, and the upload "list" never populates. A CDP-level trusted
    // file injection (Chrome DevTools MCP `upload_file`, i.e. Puppeteer/Playwright/Selenium's own
    // mechanism) on the SAME input attaches it instantly. `Event.isTrusted` cannot be spoofed from
    // page/content-script JS, so indeed.js — running unsupervised, with no CDP session of its own —
    // can never complete this specific attach by itself. This is a two-party handoff by design
    // (user-approved 2026-07-27): the extension selects "Upload a file" and waits, then — if no
    // file is already attached — PAUSES with an actionable message naming the exact file input
    // selector and the packaged cover letter's repo path, for whichever agent/session is driving
    // Chrome over CDP to attach it (chrome-devtools MCP `upload_file`) and click Apply to resume.
    async function handleCoverLetterUpload() {
        const legend = [...document.querySelectorAll('legend')]
            .find(node => /^cover letter$/i.test(clean(node.textContent)));
        if (!legend) return null; // no cover-letter question on this step
        const fieldset = legend.closest('fieldset');
        const radios = fieldset ? [...fieldset.querySelectorAll('input[type="radio"]')].filter(radio => !isOurUi(radio)) : [];
        const fileChoice = radios.find(radio => /file/i.test(radio.value)) || radios[0];
        if (fileChoice && !fileChoice.checked) {
            realClick(fileChoice.closest('label') || fileChoice);
            await WAIT(500);
        }
        const findFileInput = () => [...document.querySelectorAll('input[type="file"][data-testid*="upload-button-file-input"]')]
            .find(input => !isOurUi(input));
        const findList = () => findFileInput()?.closest('fieldset')?.querySelector('[data-testid$="-list"]');
        // The upload widget can mount asynchronously right after the radio selection commits.
        let fileInput = null;
        const appearDeadline = Date.now() + 5000;
        while (Date.now() < appearDeadline) {
            fileInput = findFileInput();
            if (fileInput) break;
            await WAIT(200);
        }
        if (!fileInput) return { status: 'failed', message: 'Cover letter: "Upload a file" chosen, but no upload widget was found.' };
        if (clean(findList()?.textContent)) return { status: 'skipped', message: 'Cover letter already attached.' };
        return {
            status: 'needs-trusted-upload',
            message: 'Cover letter: "Upload a file" selected, but Indeed requires a browser-trusted '
                + 'file selection that a content script cannot produce. Attach the cover letter '
                + 'Letter.pdf to the visible file input (input[type="file"][data-testid*='
                + '"upload-button-file-input"]) via a CDP-level upload (chrome-devtools MCP '
                + 'upload_file), then click Apply to resume.'
        };
    }

    // Generic fill for question/contact steps: profile fields + bank-matched answers; unmatched
    // REQUIRED questions pause the flow (never guessed — work auth/visa/salary/etc. come only
    // from the bank, which encodes the user's explicit answers).
    async function fillCurrentStepFields() {
        await loadRuntimeProfile();   // this installation's identity, not the placeholders
        const bank = await indeedQuestionBank();
        const filled = [];
        const failures = [];
        const unansweredRequired = [];
        const seen = [];
        const root = document.querySelector('form') || document.body;

        // 0) Cover letter file-upload question (its own special-cased widget — see handler).
        const coverLetterResult = await handleCoverLetterUpload();
        if (coverLetterResult) {
            seen.push({ question: 'Cover letter', control: 'file-upload', topic: 'cover-letter-upload' });
            if (coverLetterResult.status === 'uploaded') filled.push('Cover letter → Upload a file [cover-letter-upload]');
            else if (coverLetterResult.status === 'failed' || coverLetterResult.status === 'needs-trusted-upload') {
                failures.push(coverLetterResult.message);
            }
        }

        // 1) Text inputs + textareas.
        const textInputs = [...root.querySelectorAll('input, textarea')].filter(el =>
            !isOurUi(el) && visible(el) && !el.disabled && !el.readOnly
            && (el.tagName === 'TEXTAREA' || /^(text|email|tel|url|number|search|date|month)$/i.test(el.type || 'text')));
        for (const input of textInputs) {
            if (clean(input.value)) continue; // already filled — leave it
            const label = labelForInput(input);
            if (!label) continue;
            const isEssayControl = input.tagName === 'TEXTAREA';
            // "Today's Date" (optional on Infosys questions/3): runtime value, not a bank entry.
            if (/^today'?s date/i.test(label)) {
                const now = new Date();
                await fillTextField(input, `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}/${now.getFullYear()}`);
                filled.push(label);
                continue;
            }
            const profile = matchProfileField(label);
            if (!isEssayControl && profile) {
                await fillTextField(input, profile.value);
                filled.push(label);
                continue;
            }
            const entry = matchBankEntry(bank, label);
            seen.push({ question: label, control: isEssayControl ? 'textarea' : 'text', topic: entry ? entry.topic : '' });
            // `requiredOnly` answers (GPA) are used only when the control is required.
            if (entry && entry.requiredOnly && !isRequiredInput(input)) continue;
            // A `profileKey` answer comes from this installation's own profile.
            const bankedText = entry && entry.profileKey ? (INDEED_PROFILE[entry.profileKey] || '') : (entry ? entry.text : null);
            if (entry && bankedText) {
                await fillTextField(input, answerForControl(input, entry, bankedText));
                filled.push(`${label} [${entry.topic}]`);
            } else if (entry && entry.choose) {
                await fillTextField(input, entry.choose === 'yes' ? 'Yes' : 'No');
                filled.push(`${label} [${entry.topic}]`);
            } else if (profile) {
                await fillTextField(input, profile.value);
                filled.push(label);
            } else if (isRequiredInput(input)) {
                unansweredRequired.push(label);
            }
        }

        // 2a-multi) Indeed custom MULTI-select comboboxes — the SAME "select-list" widget family
        // as the single-select combobox below, but rendered as a chip multi-select (e.g. "What is
        // location", confirmed live 2026-07-27, Hudson Manpower "QA Automation Engineer IV").
        // Distinguishing marker: the field's aria-labelledby id contains "multi-select-question-
        // label" (the single-select variant's id starts "single-select-question-label"). Already-
        // selected values render as PERSISTENT chips outside the popup, each with its own
        // "Remove <value>" button — reconciliation reads/writes through those chips rather than
        // trusting aria-selected/aria-checked state inside the popup (more robust across widget
        // internals, and the chips are visible/stable whether or not the popup is open). The popup
        // itself lists every option as role=option|menuitemcheckbox (no virtualization observed,
        // ~50 city options) and STAYS OPEN across multiple picks — no toggle-close is needed
        // between selections, unlike the single-select variant below.
        const comboIsMultiSelect = combo => {
            const labelledBy = combo.getAttribute('aria-labelledby') || '';
            if (/multi-select-question-label/i.test(labelledBy)) return true;
            const fieldset = combo.closest('fieldset');
            return Boolean(fieldset && fieldset.querySelector('button[aria-label^="Remove "]'));
        };
        const multiSelectLabel = combo => {
            const id = (combo.getAttribute('aria-labelledby') || '').split(/\s+/)[0];
            const el = id ? document.getElementById(id) : null;
            return clean(el?.textContent).replace(/\s*\*$/, '');
        };
        const multiSelectRequired = combo => {
            const id = (combo.getAttribute('aria-labelledby') || '').split(/\s+/)[0];
            const el = id ? document.getElementById(id) : null;
            return el?.getAttribute('aria-required') === 'true' || /\*\s*$/.test(clean(el?.textContent || ''));
        };
        const multiSelectChipTexts = combo => {
            const fieldset = combo.closest('fieldset');
            if (!fieldset) return [];
            return [...fieldset.querySelectorAll('button[aria-label^="Remove "]')]
                .map(button => clean(button.getAttribute('aria-label')).replace(/^Remove\s+/i, ''));
        };
        const multiSelectRemoveButton = (combo, text) => {
            const fieldset = combo.closest('fieldset');
            if (!fieldset) return null;
            return [...fieldset.querySelectorAll('button[aria-label^="Remove "]')]
                .find(button => clean(button.getAttribute('aria-label')).replace(/^Remove\s+/i, '') === text) || null;
        };
        const multiSelectOptionElements = combo => {
            const controls = combo.getAttribute('aria-controls');
            const popup = controls ? document.getElementById(controls) : null;
            const scope = popup || document;
            return [...scope.querySelectorAll('[role="option"], [role="menuitemcheckbox"]')].filter(visible);
        };
        const multiSelectBank = await indeedMultiSelectBank();
        for (const combo of [...root.querySelectorAll('div[role="combobox"]')].filter(el => !isOurUi(el) && visible(el) && comboIsMultiSelect(el))) {
            const label = multiSelectLabel(combo);
            const required = multiSelectRequired(combo);
            const entry = matchBankEntry(multiSelectBank, label);
            const currentChips = multiSelectChipTexts(combo);
            seen.push({ question: label.slice(0, 200), control: 'multi-select', topic: entry ? entry.topic : '' });
            let matcher = entry?.optionMatch ? (text => entry.optionMatch.test(text)) : null;
            let usingFallback = false;
            if (!matcher && required && currentChips.length === 0) {
                // MultiSelect-Default fallback (same rule as Workday's required "select all that
                // apply" with no specific bank answer): tick the first 3 real options, else the 1st
                // — resolved once the option list is read below.
                usingFallback = true;
            } else if (!matcher) {
                if (required && currentChips.length === 0) unansweredRequired.push(label || 'multi-select');
                continue; // already has values, or nothing safely decidable — leave as-is
            }
            const wasOpen = combo.getAttribute('aria-expanded') === 'true';
            if (!wasOpen) realClick(combo);
            const menuDeadline = Date.now() + 5000;
            let options = [];
            while (Date.now() < menuDeadline) {
                options = multiSelectOptionElements(combo);
                if (options.length) break;
                await WAIT(150);
            }
            if (!options.length) { failures.push(`${label}: option list did not appear.`); continue; }
            let wantTexts;
            if (usingFallback) {
                const realTexts = options.map(option => clean(option.textContent)).filter(text => text && !OPTION_PLACEHOLDER.test(text));
                wantTexts = realTexts.slice(0, realTexts.length >= 3 ? 3 : 1);
            } else {
                wantTexts = options.map(option => clean(option.textContent)).filter(text => text && matcher(text));
            }
            // Add missing selections one at a time with a FRESH live re-scan per click (this widget
            // can re-render slightly after each pick — same stale-node lesson as the radio-group
            // fill loop above).
            for (const text of wantTexts) {
                if (multiSelectChipTexts(combo).includes(text)) continue;
                const live = multiSelectOptionElements(combo).find(option => clean(option.textContent) === text);
                if (!live) continue;
                realClick(live);
                await WAIT(150);
            }
            // Reconcile away wrong prior selections (e.g. a stale/incorrect prefill) through each
            // chip's own Remove button — never touch a chip that IS in the desired set.
            for (const chipText of multiSelectChipTexts(combo)) {
                if (wantTexts.includes(chipText)) continue;
                const removeButton = multiSelectRemoveButton(combo, chipText);
                if (removeButton) { realClick(removeButton); await WAIT(150); }
            }
            if (!wasOpen && combo.getAttribute('aria-expanded') === 'true') realClick(combo); // close only if we opened it
            const finalChips = multiSelectChipTexts(combo);
            const missing = wantTexts.filter(text => !finalChips.includes(text));
            if (missing.length || (required && finalChips.length === 0)) {
                failures.push(`${label}: could not select ${missing.length ? missing.join(', ') : 'any option'}.`);
            } else {
                filled.push(`${label.slice(0, 60)} → ${finalChips.length} location(s) ${entry ? `[${entry.topic}]` : (usingFallback ? '(first-N default)' : '')}`);
            }
        }

        // 2a) Indeed custom single-select comboboxes (confirmed live 2026-07-27, demographic
        // step): div[role=combobox][data-testid="single-select-question-select-list-select-list"]
        // [aria-required], placeholder text "Select an option", question label via
        // aria-labelledby. Click toggles aria-expanded; options render as [role=option] in a
        // popup [role=listbox] (aria-controls). Escape does NOT close — toggle-click does.
        const comboPlaceholder = value => !value || /^select an option/i.test(value);
        const comboLabel = combo => {
            const labelledBy = combo.getAttribute('aria-labelledby');
            const labelEl = labelledBy ? document.getElementById(labelledBy.split(/\s+/)[0]) : null;
            return clean(labelEl?.textContent).replace(/\s*\*$/, '');
        };
        const comboListbox = combo => {
            const controls = combo.getAttribute('aria-controls');
            const popup = controls ? document.getElementById(controls) : null;
            const scope = popup && popup.querySelector('[role="option"]') ? popup : document;
            return [...scope.querySelectorAll('[role="listbox"] [role="option"], [role="option"]')].filter(visible);
        };
        for (const combo of [...root.querySelectorAll('div[role="combobox"]')].filter(el => !isOurUi(el) && visible(el) && !comboIsMultiSelect(el))) {
            if (!comboPlaceholder(clean(combo.innerText))) continue; // already selected
            const label = comboLabel(combo);
            const required = combo.getAttribute('aria-required') === 'true' || combo.getAttribute('required') === 'true';
            const profile = matchProfileField(label);
            const entry = profile ? null : matchBankEntry(bank, label);
            seen.push({ question: label.slice(0, 200), control: 'combobox', topic: entry ? entry.topic : (profile ? 'profile' : '') });
            const picker = profile
                ? (texts => { const want = clean(profile.value).toLowerCase(); return texts.findIndex(text => text.toLowerCase() === want || text.toLowerCase().startsWith(want)); })
                : (entry ? chooserPicker(entry) : null);
            if (!picker) {
                if (required) unansweredRequired.push(label || 'dropdown');
                continue;
            }
            realClick(combo);
            const menuDeadline = Date.now() + 5000;
            let options = [];
            while (Date.now() < menuDeadline) {
                options = comboListbox(combo);
                if (options.length) break;
                await WAIT(150);
            }
            if (!options.length) { failures.push(`${label}: dropdown options did not appear.`); continue; }
            const texts = options.map(option => clean(option.innerText));
            let index = picker(texts);
            if (index < 0 && required) index = pickSingletonIndex(texts);
            if (index < 0) {
                if (combo.getAttribute('aria-expanded') === 'true') realClick(combo); // toggle close
                failures.push(`${label}: no dropdown option matched (${texts.slice(0, 5).join(' | ')}).`);
                continue;
            }
            realClick(options[index]);
            await WAIT(SELECTION_SETTLE_MS);   // one deliberate beat per selection
            if (combo.getAttribute('aria-expanded') === 'true') realClick(combo); // toggle close
            if (comboPlaceholder(clean(combo.innerText))) { failures.push(`${label}: dropdown option click did not commit.`); continue; }
            filled.push(`${label.slice(0, 60)} → ${texts[index].slice(0, 40)} ${entry ? `[${entry.topic}]` : ''}`);
        }

        // 2) Native selects.
        for (const select of [...root.querySelectorAll('select')].filter(el => visible(el) && !isOurUi(el))) {
            if (select.selectedIndex > 0 && clean(select.value)) continue;
            const label = labelForInput(select);
            const entry = matchBankEntry(bank, label);
            seen.push({ question: label, control: 'select', topic: entry ? entry.topic : '' });
            const optionTexts = [...select.options].map(opt => clean(opt.textContent));
            const picker = entry ? chooserPicker(entry) : null;
            let index = picker ? picker(optionTexts) : -1;
            let via = entry ? `[${entry.topic}]` : '';
            if (index < 0 && isRequiredInput(select)) {
                index = pickSingletonIndex(optionTexts);
                via = '(only option)';
            }
            if (index < 0) {
                if (picker) failures.push(`${label}: no option matched (${optionTexts.slice(0, 5).join(' | ')}).`);
                else if (isRequiredInput(select)) unansweredRequired.push(label);
                continue;
            }
            select.value = select.options[index].value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            filled.push(`${label} → ${optionTexts[index]} ${via}`);
        }

        // 3) Radio groups (screener questions render as radio fieldsets on Indeed).
        // ONE GROUP AT A TIME with a FRESH live-DOM scan per answer: Indeed's React re-renders
        // the question list after an answer, so node references captured in one snapshot go stale
        // and clicks on them silently do nothing (round-2 lesson: 6 of 8 groups skipped). Each
        // answer is verified against the live DOM (`input[name=…]:checked`) before moving on.
        const scanRadioGroups = () => {
            const groups = new Map();
            [...(document.querySelector('form') || document.body).querySelectorAll('input[type="radio"]')]
                .filter(el => !isOurUi(el))
                .forEach(radio => {
                    if (/resume/i.test(radio.name)) return; // resume cards owned by handleResumeSelection
                    const key = radio.name || radio.closest('fieldset')?.id || 'radios';
                    if (!groups.has(key)) groups.set(key, []);
                    groups.get(key).push(radio);
                });
            return groups;
        };
        const radioDone = new Set();   // group names answered/decided this pass
        for (let guard = 0; guard < 25; guard += 1) {
            const groups = scanRadioGroups();
            const next = [...groups.entries()].find(([name, radios]) =>
                !radioDone.has(name) && !radios.some(radio => radio.checked));
            if (!next) break;
            const [name, radios] = next;
            radioDone.add(name);
            const groupLabel = radioGroupLabel(radios);
            const required = radioGroupRequired(radios);
            const entry = matchBankEntry(bank, groupLabel);
            seen.push({ question: groupLabel, control: 'radio', topic: entry ? entry.topic : '' });
            const optionLabels = radios.map(optionLabelFor);
            const picker = entry ? chooserPicker(entry) : null;
            let index = picker ? picker(optionLabels) : -1;
            let via = entry ? `[${entry.topic}]` : '';
            if (index < 0 && required) {
                // Singleton-required rule (extends the user's gh dropdown rule to radio groups):
                // a required group with exactly ONE real option ("How did you hear about us →
                // Indeed") is selected outright.
                index = pickSingletonIndex(optionLabels);
                via = '(only option)';
            }
            if (index < 0) {
                if (picker) failures.push(`${groupLabel}: no radio matched (${optionLabels.slice(0, 4).join(' | ')}).`);
                else if (required) unansweredRequired.push(groupLabel || 'radio group');
                continue;
            }
            const target = radios[index];
            realClick(target.closest('label, [data-testid$="radio-card"]') || target);
            await WAIT(150);
            // Verify against the LIVE DOM, not the captured node (it may have been re-rendered).
            const committed = () => Boolean(document.querySelector(`input[type="radio"][name="${CSS.escape(name)}"]:checked`));
            if (!committed()) {
                const fresh = [...document.querySelectorAll(`input[type="radio"][name="${CSS.escape(name)}"]`)]
                    .find(radio => clean(optionLabelFor(radio)) === clean(optionLabels[index]));
                if (fresh) { fresh.click(); await WAIT(150); }
            }
            if (!committed()) { failures.push(`${groupLabel}: option click did not commit.`); continue; }
            await WAIT(SELECTION_SETTLE_MS);   // one deliberate beat per selection
            filled.push(`${groupLabel} → ${optionLabels[index]} ${via}`);
        }

        // 4) Checkbox groups (grouped by name/fieldset; one checked member completes a group).
        const checkboxGroups = new Map();
        [...root.querySelectorAll('input[type="checkbox"]')].filter(el => !isOurUi(el) && visible(el)).forEach(box => {
            const key = box.name || box.closest('fieldset')?.id || box.id || 'boxes';
            if (!checkboxGroups.has(key)) checkboxGroups.set(key, []);
            checkboxGroups.get(key).push(box);
        });
        for (const boxes of checkboxGroups.values()) {
            if (boxes.some(box => box.checked)) continue;
            const container = boxes[0].closest('fieldset, [role="group"]');
            const label = clean(container?.querySelector('legend')?.textContent) || labelForInput(boxes[0]);
            const entry = matchBankEntry(bank, label);
            const required = boxes.some(isRequiredInput) || container?.getAttribute('aria-required') === 'true';
            if (!entry) {
                if (required) unansweredRequired.push(label || 'checkbox group');
                continue;
            }
            seen.push({ question: label, control: boxes.length > 1 ? 'checkbox-group' : 'checkbox', topic: entry.topic });
            const optionLabels = boxes.map(optionLabelFor);
            // `checkAll` questions want EVERY option ticked (relocation locations — the applicant is
            // open to all of them); same per-selection pacing for each box.
            if (entry.checkAll) {
                const ticked = [];
                for (let index = 0; index < boxes.length; index += 1) {
                    if (boxes[index].checked) continue;
                    realClick(boxes[index].closest('label') || boxes[index]);
                    await WAIT(100);
                    if (!boxes[index].checked) boxes[index].click();
                    await WAIT(SELECTION_SETTLE_MS);
                    if (boxes[index].checked) ticked.push(optionLabels[index]);
                }
                if (ticked.length) filled.push(`${label} → ${ticked.join(' + ')} [${entry.topic}]`);
                else failures.push(`${label}: no checkbox could be ticked.`);
                continue;
            }
            const picker = chooserPicker(entry);
            const index = entry.check === true && boxes.length === 1 ? 0 : (picker ? picker(optionLabels) : -1);
            if (index < 0) { failures.push(`${label}: no checkbox matched.`); continue; }
            realClick(boxes[index].closest('label') || boxes[index]);
            await WAIT(100);
            if (!boxes[index].checked) boxes[index].click();
            await WAIT(SELECTION_SETTLE_MS);   // one deliberate beat per selection
            filled.push(`${label} → ${optionLabels[index]} [${entry.topic}]`);
        }

        await persistSeenQuestions(seen);
        return { filled, failures, unansweredRequired: [...new Set(unansweredRequired)] };
    }

    // Advance the current step: click Continue and wait for the step signature to change.
    // The Continue lookup POLLS (confirmed live 2026-07-27 on questions-module/questions/1):
    // Indeed's React footer re-renders right after programmatic fills, so a one-shot lookup can
    // miss a button that exists again milliseconds later ("No Continue button found" false stop).
    async function waitForContinueButton(timeoutMs = 8000) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const button = findContinueButton();
            if (button) return button;
            await WAIT(250);
        }
        return null;
    }
    async function advanceStep(beforeSignature) {
        const button = await waitForContinueButton();
        if (!button) return { ok: false, message: 'No Continue button found on this step.' };
        if (button.disabled || button.getAttribute('aria-disabled') === 'true') {
            // Give async validation a moment, like LinkedIn's React validation.
            const enableDeadline = Date.now() + 3500;
            while (Date.now() < enableDeadline && (button.disabled || button.getAttribute('aria-disabled') === 'true')) await WAIT(200);
            if (button.disabled || button.getAttribute('aria-disabled') === 'true') {
                return { ok: false, message: 'Continue is disabled — a required field is still missing.' };
            }
        }
        if (ACTION_DELAY_MS) await WAIT(ACTION_DELAY_MS);
        realClick(button);
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
            await WAIT(250);
            if (stepSignature() !== beforeSignature) return { ok: true };
            // Inline validation errors mean the step refused to advance.
            const alert = [...document.querySelectorAll('[role="alert"], [aria-live="assertive"], [class*="error" i]')]
                .filter(el => visible(el) && !isOurUi(el) && clean(el.innerText))
                .map(el => clean(el.innerText)).find(Boolean);
            if (alert && Date.now() > deadline - 12000) return { ok: false, message: `Step refused to advance: ${alert.slice(0, 180)}` };
        }
        // Name the blockers instead of a generic timeout: Indeed renders "Choose an option to
        // continue." inside each unanswered required fieldset (confirmed live 2026-07-27).
        const blocked = [...document.querySelectorAll('fieldset, [role="radiogroup"], [role="group"]')]
            .filter(el => visible(el) && !isOurUi(el) && /choose an option to continue|select an option to continue|this field is required/i.test(clean(el.innerText)))
            .map(el => clean(el.querySelector('legend, label')?.textContent || '').replace(/\s*\*$/, ''))
            .filter(Boolean);
        // Required custom comboboxes still showing their placeholder also block Continue but
        // carry no inline validation text (confirmed 2026-07-27) — include them by label.
        [...document.querySelectorAll('div[role="combobox"][aria-required="true"]')]
            .filter(el => visible(el) && !isOurUi(el) && /^select an option/i.test(clean(el.innerText)))
            .forEach(el => {
                const labelledBy = el.getAttribute('aria-labelledby');
                const labelEl = labelledBy ? document.getElementById(labelledBy.split(/\s+/)[0]) : null;
                const label = clean(labelEl?.textContent).replace(/\s*\*$/, '').slice(0, 120);
                if (label) blocked.push(label);
            });
        if (blocked.length) {
            return { ok: false, message: `Paused — ${blocked.length} required question(s) blocked Continue: ${[...new Set(blocked)].join(' ; ')}. Answer them (or add them to the bank), then click Apply to resume.` };
        }
        return { ok: false, message: 'Clicked Continue but the step did not change within 15s.' };
    }

    // One full pass over the CURRENT step: detect → fill → advance (or hold).
    // Returns { ok, done, message } — done=true means review reached (flow parked before Submit).
    async function runCurrentStep() {
        const before = stepSignature();
        if (isReviewStep() && !isResumeSelectionStep()) {
            // Verify completeness first; only a fully-answered review may submit.
            const result = await fillCurrentStepFields();
            if (result.unansweredRequired.length || result.failures.length) {
                const held = [...result.unansweredRequired, ...result.failures];
                // One item per line (user, 2026-07-27) - setStatus/bulletize renders each as its
                // own bullet, which stays readable when several items are open.
                return { ok: false, message: [`Review reached, but ${held.length} unresolved item(s) remain:`, ...held].join('\n') };
            }
            if (!INDEED_SUBMIT_ENABLED) {
                saveSession('waiting');
                return { ok: true, done: true, message: 'Review step reached — every required field is filled. Eve holds before Submit (explicit user approval required).' };
            }
            // Submit-on-complete (user-approved 2026-07-27): click the real Submit ONCE and wait
            // for Indeed's confirmation — URL transition to /form/post-apply and/or the
            // "Your application was submitted" text with the Submit control gone (confirmed live
            // on the Infosys submission). Eve never interacts with any CAPTCHA.
            const submit = findSubmitButton();
            if (!submit) {
                saveSession('waiting');
                return { ok: true, done: true, message: 'Review complete, but no Submit button was found — submit manually.' };
            }
            setStatus('All required fields complete — submitting…', 'running');
            realClick(submit);
            const deadline = Date.now() + 25000;
            while (Date.now() < deadline) {
                await WAIT(500);
                const confirmed = /post-apply/i.test(location.pathname)
                    || /application (was |has been )?(submitted|sent)/i.test(clean(document.body.innerText).slice(0, 2500));
                if (confirmed && !findSubmitButton()) {
                    saveSession('idle');
                    recordIndeedApplication();
                    return { ok: true, done: true, submitted: true, message: 'Application submitted — Indeed confirmed.' };
                }
            }
            saveSession('waiting');
            return { ok: true, done: true, message: 'Submit clicked; no confirmation detected within 25s — verify manually. Do not click Submit again before checking.' };
        }
        if (isResumeSelectionStep()) {
            const resume = await handleResumeSelection();
            if (!resume.ok) return { ok: false, message: resume.message };
            const advanced = await advanceStep(before);
            if (!advanced.ok) return { ok: false, message: advanced.message };
            return { ok: true, message: 'Resume step completed.' };
        }
        setStatus(`Filling step: ${stepHeading() || stepPath()}…`, 'running');
        const result = await fillCurrentStepFields();
        if (result.unansweredRequired.length) {
            return {
                ok: false,
                message: [
                    `Paused — ${result.unansweredRequired.length} unanswered required question(s):`,
                    ...result.unansweredRequired,
                    'Answer them (or add them to the bank), then click Apply to resume.'
                ].join('\n')
            };
        }
        if (result.failures.length) {
            return { ok: false, message: [`Paused — ${result.failures.length} fill failure(s):`, ...result.failures].join('\n') };
        }
        // Snapshot AFTER filling, not the pre-fill `before`: some answers (e.g. the cover-letter
        // upload widget) mount new inputs as a side effect, which changes stepSignature()'s
        // input-count term on its own. Comparing against the pre-fill snapshot would make
        // advanceStep() think Continue's click changed the step when it never actually clicked
        // through — confirmed live 2026-07-27 on questions-module/questions/1.
        const advanced = await advanceStep(stepSignature());
        if (!advanced.ok) return { ok: false, message: advanced.message };
        return { ok: true, message: result.filled.length ? `Filled ${result.filled.length} field(s), advanced.` : 'Advanced.' };
    }

    // ── Auto / Manual orchestration (hard gate: explicit click only) ──────────────────────────
    let eveEnabled = true;
    let autoModeEnabled = true;
    let loopActive = false;
    let running = false;

    async function refreshGates() {
        const result = await storageGet(['settings', 'eveApplyMode']);
        eveEnabled = result.settings?.autopilotEnabled !== false;
        autoModeEnabled = result.eveApplyMode !== 'manual';
        return eveEnabled;
    }

    async function runIndeedAutoApply({ userInitiated = false } = {}) {
        if (loopActive) return;
        if (!await refreshGates() || !autoModeEnabled) {
            setStatus(eveEnabled ? 'Auto mode is off. Enable Auto, then click Auto Apply.' : 'Eve is disabled.', 'idle');
            return;
        }
        const session = loadSession();
        if (!userInitiated && !(session?.activatedByUser && session.state === 'running')) return;
        loopActive = true;
        running = true;
        saveSession('running', { activatedByUser: true });
        setStatus('Starting or resuming Indeed Auto Apply…', 'running');
        updateActionButton();
        try {
            for (let count = 0; count < MAX_AUTO_STEPS && running; count += 1) {
                await refreshGates();
                if (!eveEnabled || !autoModeEnabled || !running) { saveSession('waiting'); setStatus('Stopped.', 'idle'); return; }
                const result = await runCurrentStep();
                if (result.done) { setStatus(result.message, 'waiting'); return; }
                if (!result.ok) { saveSession('waiting'); setStatus(result.message, 'waiting'); return; }
                setStatus(result.message, 'running');
                await WAIT(300); // let the next step render fully before re-detecting
            }
            saveSession('waiting');
            setStatus('Paused after the Indeed step limit. Click Auto Apply to resume.', 'waiting');
        } catch (error) {
            saveSession('waiting');
            setStatus(`Indeed Auto Apply stopped: ${error.message || error}`, 'error');
        } finally {
            loopActive = false;
            running = false;
            updateActionButton();
        }
    }

    async function runIndeedManualApply() {
        if (loopActive) return;
        loopActive = true;
        try {
            const result = await runCurrentStep();
            if (result.done) setStatus(result.message, 'waiting');
            else if (!result.ok) setStatus(result.message, 'waiting');
            else setStatus(`${result.message} Auto is off — click Apply for the next step.`, 'idle');
        } catch (error) {
            setStatus(`Manual Apply stopped: ${error.message || error}`, 'error');
        } finally {
            loopActive = false;
            updateActionButton();
        }
    }

    function extensionContextAlive() {
        try { return Boolean(chrome.runtime && chrome.runtime.id); } catch { return false; }
    }

    async function handleApplyButtonClick() {
        if (!extensionContextAlive()) {
            setStatus('Eve was updated. Refresh this page (Ctrl+Shift+R) to continue.', 'waiting');
            return;
        }
        const toggle = document.getElementById('ea-indeed-auto-toggle');
        const requestedAutoMode = toggle ? toggle.checked : autoModeEnabled;
        autoModeEnabled = requestedAutoMode;
        // Serialize the rendered toggle mode BEFORE reading gates (same race fix as Workday).
        await storageSet({ eveApplyMode: requestedAutoMode ? 'auto' : 'manual' });
        if (autoModeEnabled && (running || loopActive)) {
            running = false; // pause: the loop exits at its next guard check
            saveSession('waiting');
            setStatus('Paused. Click Auto Apply to resume — nothing on this page was changed.', 'waiting');
            updateActionButton();
            return;
        }
        if (autoModeEnabled) await runIndeedAutoApply({ userInitiated: true });
        else await runIndeedManualApply();
    }

    // ── Floating panel (Workday/gh skeleton; no 'search' tab on Indeed) ──────────────────────
    let statusMessage = 'Ready.';
    function setStatus(message, state = 'idle') {
        statusMessage = message;
        document.documentElement.dataset.eveIndeedState = state;
        document.documentElement.dataset.eveIndeedMessage = message;
        const status = document.getElementById('ea-apply-status');
        if (status) status.textContent = bulletize(message);
    }
    function updateActionButton() {
        const button = document.getElementById('ea-indeed-apply-btn');
        if (!button) return;
        if (autoModeEnabled && (running || loopActive)) button.textContent = 'Pause';
        else button.textContent = autoModeEnabled ? 'Auto Apply' : 'Apply';
    }
    function makeDraggable(panel, handle) {
        let dragging = false, startX = 0, startY = 0, left = 0, top = 0;
        handle.addEventListener('mousedown', event => {
            if (event.target.closest('button')) return;
            const rect = panel.getBoundingClientRect();
            dragging = true; startX = event.clientX; startY = event.clientY; left = rect.left; top = rect.top;
            event.preventDefault();
        });
        document.addEventListener('mousemove', event => {
            if (!dragging) return;
            panel.style.left = `${Math.max(0, Math.min(innerWidth - panel.offsetWidth, left + event.clientX - startX))}px`;
            panel.style.top = `${Math.max(0, Math.min(innerHeight - 60, top + event.clientY - startY))}px`;
        });
        document.addEventListener('mouseup', () => {
            if (!dragging) return;
            dragging = false;
            const rect = panel.getBoundingClientRect();
            try { localStorage.setItem(POSITION_KEY, JSON.stringify({ left: rect.left, top: rect.top })); } catch { }
        });
    }
    async function renderInfo() {
        const wrap = document.getElementById('ea-info-wrap');
        if (!wrap) return;
        const stored = await storageGet([INDEED_INFO_KEY]);
        const seen = stored[INDEED_INFO_KEY]?.seenQuestions || [];
        wrap.innerHTML = seen.length ? seen.slice(-40).reverse().map(item => `
            <div class="ea-info-row">
              <label>${esc(item.topic || 'unmatched')}</label>
              <input class="eve-val-input" value="${esc(item.question)}" disabled>
            </div>`).join('') : '<p class="ea-dim">No Indeed questions recorded yet.</p>';
    }
    function switchView(view) {
        for (const name of ['apply', 'info']) {
            document.getElementById(`ea-body-${name}`)?.classList.toggle('ea-hidden', view !== name);
            document.getElementById(`ea-tab-${name}`)?.classList.toggle('ea-tab-active', view === name);
        }
        if (view === 'info') renderInfo();
    }
    function injectUI() {
        if (document.getElementById(PANEL_ID) || !eveEnabled) return;
        const version = (() => { try { return chrome.runtime.getManifest().version; } catch { return ''; } })();
        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.classList.add('eve-gh-panel');
        panel.innerHTML = `
          <div class="ea-header">
            <button id="ea-toggle-minimize" class="ea-min-btn" title="Hide Eve">−</button>
            <span class="ea-title">Eve · Indeed${version ? ` <span class="ea-version" style="font-size:11px;font-weight:400;opacity:0.65;" title="Extension version">v${esc(version)}</span>` : ''}</span>
            <div class="ea-tabs">
              <button id="ea-tab-apply" class="ea-tab ea-tab-active">Apply</button>
              <button id="ea-tab-info" class="ea-tab">Info</button>
            </div>
            <span id="ea-status-indicator" class="ea-status-active"></span>
          </div>
          <div id="ea-body-apply" class="ea-body">
            <p id="ea-apply-status">${esc(bulletize(statusMessage))}</p>
            <div class="ea-auto-toggle-row">
              <div>
                <label class="ea-mini-label">Auto Apply</label>
                <div class="ea-dim">Auto loops through every Smart Apply step; Apply (Auto off) advances one step per click. Eve holds at Review — Submit always needs your explicit approval.</div>
              </div>
              <label class="ea-toggle-switch" title="Enable Auto Apply mode"><input type="checkbox" id="ea-indeed-auto-toggle"><span class="ea-toggle-slider"></span></label>
            </div>
            <div class="ea-btn-row"><button id="ea-indeed-apply-btn" class="ea-btn-save">Auto Apply</button></div>
          </div>
          <div id="ea-body-info" class="ea-body ea-hidden">
            <div id="ea-info-wrap"><p class="ea-dim">Loading…</p></div>
          </div>
          <div class="ea-resize-handle"></div>`;
        document.body.appendChild(panel);
        makeDraggable(panel, panel.querySelector('.ea-header'));
        try {
            const position = JSON.parse(localStorage.getItem(POSITION_KEY) || 'null');
            if (position) { panel.style.left = `${position.left}px`; panel.style.top = `${position.top}px`; }
        } catch { }
        document.getElementById('ea-toggle-minimize').addEventListener('click', () => panel.classList.toggle('eve-minimized'));
        document.getElementById('ea-tab-apply').addEventListener('click', () => switchView('apply'));
        document.getElementById('ea-tab-info').addEventListener('click', () => switchView('info'));
        document.getElementById('ea-indeed-apply-btn').addEventListener('click', () => void handleApplyButtonClick());
        const toggle = document.getElementById('ea-indeed-auto-toggle');
        toggle.checked = autoModeEnabled;
        toggle.addEventListener('change', () => {
            autoModeEnabled = toggle.checked;
            chrome.storage.local.set({ eveApplyMode: autoModeEnabled ? 'auto' : 'manual' });
            if (!autoModeEnabled) running = false; // arming/disarming only; never starts automation
            updateActionButton();
        });
        chrome.storage.local.get([THEME_KEY], result => {
            panel.classList.add(result[THEME_KEY] === 'light' ? 'eve-theme-light' : 'eve-theme-dark');
        });
        switchView('apply');
        updateActionButton();
    }

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message?.type === MSG('set-theme')) {
            const panel = document.getElementById(PANEL_ID);
            if (panel) {
                panel.classList.toggle('eve-theme-light', message.theme === 'light');
                panel.classList.toggle('eve-theme-dark', message.theme !== 'light');
            }
            sendResponse({ ok: true });
            return true;
        }
        if (message?.type === MSG('indeed-artifact-probe')) {
            // Diagnostic hook (X/XC): validate the packaged-artifact path without touching the form.
            packagedArtifactFile(message.artifactId || 'resume')
                .then(file => sendResponse({ ok: true, name: file.name, size: file.size, type: file.type }))
                .catch(error => sendResponse({ ok: false, error: error.message || String(error) }));
            return true;
        }
        return false;
    });
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local') return;
        if (changes.eveApplyMode) {
            autoModeEnabled = changes.eveApplyMode.newValue !== 'manual';
            if (!autoModeEnabled) running = false; // mode-off stop
            const toggle = document.getElementById('ea-indeed-auto-toggle');
            if (toggle) toggle.checked = autoModeEnabled;
            updateActionButton();
        }
        if (changes.settings) {
            eveEnabled = changes.settings.newValue?.autopilotEnabled !== false;
            if (!eveEnabled) { running = false; document.getElementById(PANEL_ID)?.remove(); }
            else injectUI();
        }
    });

    async function boot() {
        await refreshGates();
        if (!eveEnabled) return;
        injectUI();
        // Keep the panel alive across the wizard's client-side re-renders.
        setInterval(() => { if (eveEnabled) injectUI(); }, 1500);
        // Resume ONLY a user-activated running Auto session across the wizard's own in-tab
        // navigation (same contract as Workday). A pause ('waiting') never resumes on load.
        const session = loadSession();
        if (session?.activatedByUser && session.state === 'running' && autoModeEnabled) {
            void runIndeedAutoApply({ userInitiated: false });
        }
    }
    boot();
})();
