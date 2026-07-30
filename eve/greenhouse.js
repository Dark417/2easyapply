// Eve — isolated Greenhouse ("gh") application adapter (Task 3).
// Owns the job-boards.greenhouse.io application template: a single-page form with identity
// fields, react-select comboboxes, file uploads, and custom questions. Reuses the floating-UI
// styling (ui.css / #eve-floating-ui) but shares NO runtime state with the LinkedIn or Workday
// adapters: gh memory lives in its own `ghSavedAnswers` chrome.storage key.
//
// DUPLICATION NOTE: small primitives (clean/visible/esc, setNativeValue, bulletize, glob→regex,
// the packaged-artifact fetch) are adapted copies from eve/workday.js. They are deliberately
// copied, not imported — each content script must stay self-contained per platform, and the
// Workday versions carry Workday-specific behavior we do not want here.
(function () {
    'use strict';

    // ── Host + template detection ─────────────────────────────────────────────────────────────
    // job-boards.greenhouse.io is the anchor domain, but other domains render the SAME Greenhouse
    // application template. Keep detection modular: adding a new host is one line here (plus the
    // matching content_scripts/host_permissions entry in manifest.json and the artifact allowlist
    // in background.js). Template markers confirm the page is really the Greenhouse app form.
    const GH_HOSTS = [
        'job-boards.greenhouse.io'
        // future greenhouse-template hosts go here (one line each)
    ];
    // MyGreenhouse (Task 3 extension, 2026-07-27): an authenticated candidate-account job board.
    // The grid lives at my.greenhouse.io/jobs; clicking a job card opens a [role="dialog"] modal
    // that mounts the SAME react-select/input.input__single-line application engine as
    // job-boards.greenhouse.io (confirmed live: identical .select__control/.select__input class
    // names), just scoped inside the dialog instead of a full page. The account pre-fills
    // identity/resume/degree-level from the saved profile — Eve fills only what's still blank and
    // ALWAYS overwrites the Location field (the account default has been observed wrong, e.g.
    // "San Francisco" instead of Dallas).
    const GH_ACCOUNT_HOSTS = ['my.greenhouse.io'];
    // Zipline hosts the Eve panel in the top page and embeds the Greenhouse form in a
    // cross-origin job-boards.greenhouse.io iframe.
    const GH_EMBED_HOSTS = ['www.zipline.com', 'zipline.com'];
    // Ashby template (Task 3 extension, 2026-07-26): www.cape.co/job-listing embeds the Ashby
    // application form in a CROSS-ORIGIN iframe (jobs.ashbyhq.com/<org>/<jid>[/application]?embed=js).
    // The floating panel lives on the TOP-LEVEL embed page; the fill engine runs INSIDE the
    // ashbyhq frame (all_frames content script); the two coordinate through the background SW.
    // Direct jobs.ashbyhq.com pages (top-level) get panel + local engine in one document.
    const ASHBY_EMBED_HOSTS = ['www.cape.co', 'cape.co'];   // one line per new embed host
    const ASHBY_FORM_HOSTS = ['ashbyhq.com'];
    const hostIn = list => list.some(host => location.hostname === host || location.hostname.endsWith(`.${host}`));
    // TEMPLATE: 'gh' (local engine; panel only when top-level) | 'gh-host' (Zipline panel,
    // Greenhouse engine relayed) | 'ashby-host' (panel only, engine relayed) | 'ashby-frame' |
    // 'gh-account' (MyGreenhouse: local engine, form lives inside an open [role="dialog"] modal).
    const TEMPLATE = hostIn(GH_HOSTS) ? 'gh'
        : hostIn(GH_ACCOUNT_HOSTS) ? 'gh-account'
            : hostIn(GH_EMBED_HOSTS) ? 'gh-host'
                : hostIn(ASHBY_FORM_HOSTS) ? 'ashby-frame'
                    : hostIn(ASHBY_EMBED_HOSTS) ? 'ashby-host'
                        : null;
    if (!TEMPLATE) return;
    const IS_TOP = window === window.top;
    if ((TEMPLATE === 'ashby-host' || TEMPLATE === 'gh-host') && !IS_TOP) return;
    const HAS_PANEL = (TEMPLATE === 'gh' && IS_TOP)
        || TEMPLATE === 'gh-host'
        || TEMPLATE === 'ashby-host'
        || TEMPLATE === 'gh-account'
        || (TEMPLATE === 'ashby-frame' && IS_TOP);
    const HAS_LOCAL_ENGINE = TEMPLATE !== 'ashby-host' && TEMPLATE !== 'gh-host';

    function hasGreenhouseTemplate() {
        // Confirmed live 2026-07-26 on turbineone + 6sense: the application form is
        // form#application-form inside div#application / .application--questions blocks.
        return Boolean(document.querySelector('form#application-form')
            || document.querySelector('#application form')
            || document.querySelector('.application--questions'));
    }
    // MyGreenhouse: true only while a job's apply dialog is actually open and mounted a form —
    // the grid page itself (no dialog open) has no application to fill.
    function hasAccountDialogForm() {
        return Boolean(document.querySelector('[role="dialog"] form'));
    }
    function hasActiveTemplate() {
        if (TEMPLATE === 'gh') return hasGreenhouseTemplate();
        if (TEMPLATE === 'gh-account') return true; // panel stays on the grid; Apply checks the dialog itself
        if (TEMPLATE === 'gh-host') return Boolean(document.querySelector('iframe#grnhse_iframe, iframe[src*="greenhouse.io"]'));
        if (TEMPLATE === 'ashby-host') return Boolean(document.querySelector('iframe#ashby_embed_iframe, iframe[src*="ashbyhq.com"]'));
        return true; // ashby-frame: the form mounts after "Apply for this Job"; stay ready
    }

    // ── Extension namespace ───────────────────────────────────────────────────────────────────
    // Eve is the single canonical extension namespace.
    const NS = 'eve';
    const MSG = type => `${NS}:${type}`;
    const PANEL_ID = `${NS}-floating-ui`;
    const THEME_KEY = `${NS}Theme`;

    // ── Constants ─────────────────────────────────────────────────────────────────────────────
    const GH_INFO_KEY = 'ghSavedAnswers';           // gh-only runtime memory (never savedAnswers / workdaySavedAnswers)
    const POSITION_KEY = 'eve_gh_panel_pos';
    const WIDTH_KEY = 'eve_gh_panel_width';
    // The deliberate search delay: after typing into a searchable react-select or an Ashby
    // typeahead (Location autocomplete, phone Country), wait 0.5s for the filtered results, then
    // select. Same pattern as Workday's PICKER_SEARCH_SETTLE_MS.
    const GH_SEARCH_SETTLE_MS = 500;
    // Per-selection pacing (user, 2026-07-27): every SINGLE selection — a dropdown option, a
    // radio, a segmented Yes/No, a checkbox — is followed by 0.5s so the framework can commit it
    // (and mount any conditionally revealed follow-up) before the next control is touched.
    const GH_SELECTION_SETTLE_MS = 500;
    const SALARY_EXPECTATION = '160000';
    const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024;
    // Which packaged documents this engine may request. Their real filenames and sizes live in
    // eve/profile.local.json (see eve/profile.example.json) and are resolved by background.js.
    const ARTIFACT_IDS = ['resume', 'coverLetter'];

    // Identity / profile values from info/myworkdayjobs [CONTACT]/[LINKS]/[EXPERIENCE].
    // LOCATION OVERRIDE (user, 2026-07-26): Dallas everywhere — the location autocomplete types
    // "Dallas" and takes the FIRST suggestion; plain city/state inputs get Dallas / Texas.
    // PLACEHOLDER identity. The real values live in the gitignored eve/profile.local.json
    // (copy eve/profile.example.json and fill it in); background.js loads that file into
    // extension storage as `eveProfile` and GH_PROFILE is merged from it at fill time, so a
    // fresh clone answers with ITS OWN details rather than the author's.
    const GH_PROFILE_DEFAULTS = Object.freeze({
        firstName: "Jane",
        lastName: "Doe",
        fullName: "Jane Doe",
        preferredName: "Jane",
        email: "you@example.com",
        phone: "(555) 555-0100",
        locationSearch: "Dallas",
        city: "Dallas",
        state: "Texas",
        country: "United States",
        mailingAddress: "1 Example St, Dallas, TX 75001",
        zip: "75001",
        linkedin: "www.linkedin.com/in/your-handle/",
        github: "https://github.com/your-handle",
        currentCompany: "Your Current Employer",
        currentTitle: "Your Current Title",
    });
    function initialsFrom(name) {
        return String(name || '').split(/[s.-]+/).filter(Boolean).map(part => part[0].toUpperCase()).join('');
    }
    let GH_PROFILE = { ...GH_PROFILE_DEFAULTS };
    async function loadRuntimeProfile() {
        try {
            const stored = await storageGet(['eveProfile']);
            const identity = stored && stored.eveProfile;
            if (identity && typeof identity === 'object') GH_PROFILE = { ...GH_PROFILE_DEFAULTS, ...identity };
        } catch { /* no stored profile — placeholders stand */ }
        // Initials for 'by initialing below' certifications, derived from whatever name this
        // installation configured (user, 2026-07-28) — never a literal in source.
        GH_PROFILE.initials = initialsFrom(GH_PROFILE.fullName || `${GH_PROFILE.firstName || ''} ${GH_PROFILE.lastName || ''}`);
        // Label-driven fields capture profile values, so rebuild them from whatever is current.
        GH_PROFILE_FIELDS = buildGH_PROFILE_FIELDS();
        return GH_PROFILE;
    }

    // Education entries in DOM order (most recent/highest first — matches info/myworkdayjobs
    // [EDUCATION] and the Workday DEFAULT_MY_EXPERIENCE order). Used by MyGreenhouse's repeated
    // School*/Discipline* react-select pairs (Task 3, 2026-07-27): the account already prefills
    // Degree correctly per entry (Master's Degree / Bachelor's Degree), but School and Discipline
    // are blank on both, and a flat label-keyed bank match can't tell the two occurrences apart —
    // so these are filled by DOM-order INDEX, not by the generic question bank.
    const GH_EDUCATION = Object.freeze([
        // "Buffalo" alone is ambiguous on Greenhouse's school search (confirmed live 2026-07-27,
        // ISA board: returns ["SUNY Buffalo State", "University at Buffalo - SUNY"] — a DIFFERENT,
        // wrong SUNY campus sorts first). "University at Buffalo" returns exactly the right one.
        Object.freeze({ schoolSearch: 'University at Buffalo', school: 'State University of New York at Buffalo', disciplineSearch: 'Computer', discipline: 'Computer Science' }),
        // Second entry: search "other" and take the tenant's own Other option (user, 2026-07-28).
        // The real undergrad name is not in these school lists and searching it surfaces unrelated
        // near-matches, so `schoolOther` switches this entry to the Other option instead.
        Object.freeze({ schoolSearch: 'other', schoolOther: true, school: 'Beijing International Studies University', disciplineSearch: 'English', discipline: 'English Literature' })
    ]);

    // Label-driven identity fields (plain text inputs). First matching entry wins; a field that
    // already holds a value is skipped (Greenhouse pages are often partially browser-filled).
    function buildGH_PROFILE_FIELDS() {
        return [
        { label: /preferred (first )?name/i, value: GH_PROFILE.preferredName },
        { label: /^first name/i, value: GH_PROFILE.firstName },
        { label: /^last name/i, value: GH_PROFILE.lastName },
        { label: /full (legal )?name/i, value: GH_PROFILE.fullName },
        { label: /^legal name$/i, value: GH_PROFILE.fullName },
        // "Legal First and Last Name" / "First and Last Legal Name" (user, 2026-07-27) — the word
        // order varies by form, so match the shape rather than one anchored spelling. The anchored
        // version missed the second wording and left the field empty on a live application.
        { label: /^(legal\s+)?first (and|&) last (legal\s+)?name$/i, value: GH_PROFILE.fullName },
        // Ashby's single "Name" system field (label is exactly "Name") takes the full name.
        { label: /^(full )?name$/i, value: GH_PROFILE.fullName },
        { label: /^e-?mail/i, value: GH_PROFILE.email },
        // "Preferred phone number" (user, 2026-07-27) is the same phone field — match the noun
        // wherever it sits in the label, not just at the start.
        { label: /^phone|phone number|mobile( number)?$|cell( phone)?$/i, value: GH_PROFILE.phone },
        { label: /linked ?in/i, value: GH_PROFILE.linkedin },
        { label: /github|git hub/i, value: GH_PROFILE.github },
        // ANCHORED + shortLabelOnly (v1.1.191): the old loose /website|portfolio/ matched the word
        // "website" INSIDE essay questions ("Other than what you can find on our website, what
        // about TurbineOne is exciting to you?") and short-circuited the essay bank, filling a
        // GitHub URL into a required essay. Identity labels are short field names — never
        // sentences — so this entry only applies to short, question-mark-free labels.
        { label: /^(personal )?(website|portfolio|site)\b/i, value: GH_PROFILE.github, shortLabelOnly: true },
        // "Current or Most Recent Employer" (user, 2026-07-27) — the same J.P. Morgan Chase & Co.
        // value the user calls "JPMorgan"; generalized so "most recent employer" / "present
        // employer" phrasings match without introducing a second spelling of the employer name.
        { label: /current (company|employer)|(current or )?most recent employer|present employer/i, value: GH_PROFILE.currentCompany },
        { label: /current (job )?title|^title$/i, value: GH_PROFILE.currentTitle },
        // Education identity fields (Ashby screenshot 2026-07-27). The school name is the form the
        // user fills on these boards; the grad date is the Buffalo MS completion (Feb 2022).
        { label: /^school\b|^university\b|^college\b|(most recent|current) (school|university)|education institution/i, value: 'University at Buffalo' },
        { label: /^graduation date|graduation \(date|date of graduation/i, value: '02/01/2022' },
        { label: /^graduation year|year of graduation/i, value: '2022' },
        { label: /location \(city|your location|^city\b/i, value: `${GH_PROFILE.city}, TX` },
        { label: /^address$/i, value: GH_PROFILE.mailingAddress },
        { label: /^state\b|province/i, value: GH_PROFILE.state },
        { label: /^country\b/i, value: GH_PROFILE.country },
        // Zip / postal code (user, 2026-07-27) — the Dallas home zip.
        { label: /^zip\b|^postal\b|zip ?code|postal code/i, value: GH_PROFILE.zip }
        ];
    }
    let GH_PROFILE_FIELDS = buildGH_PROFILE_FIELDS();

    // ── Question bank (regex topics, seeded from info/myworkdayjobs [QUESTION BANK]) ──────────
    // Same first-match-wins contract as Workday's DEFAULT_APPLICATION_QUESTIONS: `patterns` match
    // the question label text; `exclude` stops a broader entry stealing a specific question;
    // `choose: 'yes'|'no'` picks the affirmative/negative option (long-worded options included);
    // `optionMatch` picks by option regex; `text` fills a text input/textarea.
    // Extracted and unit-tested by tools/gh-bank-test.js — extend via ghSavedAnswers.questions.
    const DEFAULT_GH_QUESTIONS = [
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
                /(require|need)[\s\S]{0,30}sponsorship/i,
                /sponsorship[\s\S]{0,40}(employment )?visa/i,
                /(h-?1b|work visa)[\s\S]{0,40}sponsor/i,
                // Ashby/Notion phrasing (screenshot 2026-07-27): the COMPANY NAME sits between
                // "require" and "to sponsor", and the object is an "immigration case", so neither
                // of the patterns above reached it.
                /(require|need)[\s\S]{0,40}to sponsor[\s\S]{0,40}(immigration case|visa|petition)/i,
                /sponsor an immigration case/i
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
                /restrictive covenant/i
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
                /work in person[\s\S]{0,60}office location[\s\S]{0,60}(times|days) per week/i
            ],
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
                /when (can|would) you (start|be available to start)/i
            ],
            text: '09/07/2026'
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
            topic: 'relocation-locations-all',
            patterns: [
                /indicate all of the locations/i,
                /locations?[\s\S]{0,40}interested in relocating to/i,
                /(which|what) locations?[\s\S]{0,40}(would you|are you)[\s\S]{0,30}(interested|willing|open)/i,
                /select all[\s\S]{0,40}(locations|offices|cities)/i
            ],
            checkAll: true
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
                /\bgender identity\b/i
            ],
            optionCandidates: [/cisgender man/i, /^\s*man\s*$/i, /^\s*male\s*$/i],
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
                /no,?\s*i\s*don'?t\s*have\s*a\s*disability/i,
                /^\s*no\b[\s\S]{0,20}(do not have a disability|not have)/i
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
        }
    ];

    // ── Tiny shared helpers (adapted from workday.js) ─────────────────────────────────────────
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
    // react-select's inner filter input must keep focus (blur closes the menu), so no blur here.
    function setComboSearchValue(input, value) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        try { input.focus(); } catch { }
        if (setter) setter.call(input, value); else input.value = value;
        input.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: value ? 'insertText' : 'deleteContentBackward' }));
    }
    // Click away onto empty page space (user, 2026-07-27, Ashby): after every SINGLE selection
    // Eve blurs the control and clicks neutral space before touching the next one — Ashby commits
    // a choice on outside-click/blur, and going straight from one option to the next was too fast
    // for it. Events are dispatched directly on <body>, so no other control can be hit.
    function clickAway() {
        try { document.activeElement?.blur?.(); } catch { }
        const opts = { bubbles: true, cancelable: true, composed: true, view: window, button: 0 };
        document.body.dispatchEvent(new PointerEvent('pointerdown', opts));
        document.body.dispatchEvent(new MouseEvent('mousedown', opts));
        document.body.dispatchEvent(new PointerEvent('pointerup', opts));
        document.body.dispatchEvent(new MouseEvent('mouseup', opts));
        document.body.dispatchEvent(new MouseEvent('click', opts));
    }
    // The one pacing routine every single selection goes through: settle → click away → settle.
    async function afterSelection() {
        await WAIT(GH_SELECTION_SETTLE_MS);
        clickAway();
        await WAIT(GH_SELECTION_SETTLE_MS);
    }
    // Every TEXT field goes through the same user-shaped sequence (user, 2026-07-27): click the
    // field → type → click away onto empty space → pause, then move to the next field. Filling
    // fields back-to-back too quickly left required inputs still marked empty by the page's own
    // validation even though the text was there.
    async function fillTextField(input, value) {
        realClick(input);
        try { input.focus(); } catch { }
        setNativeValue(input, value);
        clickAway();
        await WAIT(GH_SELECTION_SETTLE_MS);
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

    // ── Form access ───────────────────────────────────────────────────────────────────────────
    function ghForm() {
        if (TEMPLATE === 'gh') {
            return document.querySelector('form#application-form') || document.querySelector('#application form') || document.querySelector('form');
        }
        if (TEMPLATE === 'gh-account') {
            // The grid page itself has no form; only an open job dialog does.
            return document.querySelector('[role="dialog"] form');
        }
        // Ashby renders the application without a wrapping <form>; scope to the field-entry
        // container region (confirmed live 2026-07-26: ._fieldEntry_* / .ashby-application-form-field-entry).
        const entry = document.querySelector('[class*="fieldEntry"], .ashby-application-form-container');
        if (entry) return document.querySelector('form') || document.body;
        return document.querySelector('form') || null;
    }
    function ashbyApplicationEntryControl() {
        if (TEMPLATE !== 'ashby-frame') return null;
        const controls = [...document.querySelectorAll('a[role="tab"], button, a[href*="/application"]')]
            .filter(control => visible(control));
        return controls.find(control => control.getAttribute('role') === 'tab'
            && /^application$/i.test(clean(control.innerText)))
            || controls.find(control => /^apply for this job$/i.test(clean(control.innerText)));
    }
    async function ensureApplicationForm() {
        let form = ghForm();
        if (form || TEMPLATE !== 'ashby-frame') return form;
        const entryControl = ashbyApplicationEntryControl();
        if (!entryControl) return null;
        setStatus(/^application$/i.test(clean(entryControl.innerText))
            ? 'Opening the Application tab…'
            : 'Opening the application form…', 'running');
        realClick(entryControl);
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
            await WAIT(250);
            form = ghForm();
            if (form) return form;
        }
        return null;
    }
    function isOurUi(node) { return Boolean(node.closest?.(`#${PANEL_ID}`)); }
    function isSubmitControl(node) {
        // The one control Eve must NEVER activate. Greenhouse renders it as
        // <button type="submit">Submit application</button> at the end of the form.
        return node?.type === 'submit' || /^submit( application)?$/i.test(clean(node?.innerText || node?.value));
    }

    function labelForInput(input) {
        if (input.id) {
            const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
            if (label) return clean(label.textContent).replace(/\*$/, '');
        }
        const labelledBy = input.getAttribute('aria-labelledby');
        if (labelledBy) {
            const label = document.getElementById(labelledBy.split(/\s+/)[0]);
            if (label) return clean(label.textContent).replace(/\*$/, '');
        }
        const aria = clean(input.getAttribute('aria-label'));
        if (aria) return aria;
        // A WRAPPING <label> is the option text for id-less radios/checkboxes — Ashby's
        // texting-consent radios are `<label><input type=radio value=given><span>Yes - I consent
        // …</span></label>` with no id at all (confirmed live 2026-07-27, Crusoe). Without this the
        // lookup fell through to the enclosing field entry and every option came back as the
        // HOST field's label ("Phone Number"), so no option could ever match.
        const wrapping = input.closest('label');
        if (wrapping) {
            const own = clean(wrapping.textContent);
            if (own) return own;
        }
        // Ashby's typeahead control (location) carries NO id/aria-label at all — its label targets
        // the field path instead — so the enclosing field entry is the only label source.
        const wrap = input.closest('.input-wrapper, .field-wrapper, .select__container, fieldset, [class*="fieldEntry"], .ashby-application-form-field-entry');
        const label = wrap?.querySelector('label, legend, .ashby-application-form-question-title, [class*="label"]');
        return label ? clean(label.textContent).replace(/\*$/, '') : '';
    }
    // Question label for a radio group. Ashby (confirmed live 2026-07-26): radio name is
    // `${sectionId}_${questionId}` and the QUESTION's label targets the bare questionId, while
    // each radio's own label[for=radioId] is the option text.
    function radioGroupLabel(radios) {
        const container = radios[0].closest('fieldset, [class*="fieldEntry"], [role="radiogroup"]');
        const legend = container?.querySelector('legend');
        if (legend && clean(legend.textContent)) return clean(legend.textContent);
        const questionId = String(radios[0].name || '').split('_').pop();
        if (questionId) {
            const qLabel = document.querySelector(`label[for="${CSS.escape(questionId)}"]`);
            if (qLabel) return clean(qLabel.textContent);
        }
        const first = container?.querySelector('label');
        if (first && first.htmlFor !== radios[0].id) return clean(first.textContent);
        return labelForInput(radios[0]);
    }
    // The question text for a radio group that is a SECONDARY control inside another field's entry
    // (Ashby puts its texting-consent radios inside the Phone Number entry, confirmed live
    // 2026-07-27 on Crusoe). radioGroupLabel() then returns the HOST field's label ("Phone
    // Number"), which matches nothing in the bank. Climb from the radios to the smallest ancestor
    // whose text says something beyond the option labels themselves, and use that.
    function radioGroupIntroText(radios, optionLabels) {
        const entry = radios[0].closest('[class*="fieldEntry"], .ashby-application-form-field-entry, fieldset, form') || document.body;
        const strip = text => clean(optionLabels.reduce((acc, label) => (label ? acc.split(label).join(' ') : acc), text));
        let node = radios[0].parentElement;
        while (node && node !== entry && !radios.every(radio => node.contains(radio))) node = node.parentElement;
        while (node && node !== entry) {
            const intro = strip(clean(node.innerText));
            if (intro.length > 15) return intro;
            node = node.parentElement;
        }
        return strip(clean(entry.innerText));
    }
    function checkboxGroups(form) {
        const groups = new Map();
        [...form.querySelectorAll('input[type="checkbox"]')]
            .filter(box => !isOurUi(box) && visible(box))
            .forEach(box => {
                // Ashby may give each option a distinct input name while placing all options
                // inside one field-entry question. The enclosing question is the authoritative
                // group boundary; input name is only a fallback when no such wrapper exists.
                const question = box.closest(
                    'fieldset, [role="group"], .ashby-application-form-field-entry, [class*="fieldEntry"]');
                const key = question || box.name || box;
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key).push(box);
            });
        return [...groups.values()];
    }
    function checkboxGroupLabel(boxes) {
        const container = boxes[0]?.closest('fieldset, [role="group"], [class*="fieldEntry"], .field-wrapper');
        const legend = container?.querySelector('legend');
        if (legend && clean(legend.textContent)) return clean(legend.textContent).replace(/\*$/, '');
        if (boxes.length === 1) return labelForInput(boxes[0]);
        const question = container?.querySelector(':scope > label, :scope > [class*="label"]');
        return clean(question?.textContent) || labelForInput(boxes[0]) || 'checkbox group';
    }
    // Ashby Yes/No questions are two visible buttons backed by one invisible checkbox. The
    // selected button gains an `_active_*` class while the backing box becomes checked.
    function segmentedChoiceGroups(form) {
        return [...form.querySelectorAll('.ashby-application-form-field-entry, [class*="fieldEntry"]')]
            .filter(block => visible(block) && !isOurUi(block))
            .map(block => {
                const buttons = [...block.querySelectorAll('button')]
                    .filter(button => visible(button) && /^(yes|no)$/i.test(clean(button.innerText)));
                if (buttons.length !== 2 || !buttons.some(button => /^yes$/i.test(clean(button.innerText)))
                    || !buttons.some(button => /^no$/i.test(clean(button.innerText)))) return null;
                const labelNode = block.querySelector(':scope > label, .ashby-application-form-question-title');
                const label = clean(labelNode?.textContent).replace(/\*$/, '');
                const backing = block.querySelector('input[type="checkbox"]');
                const required = /\brequired\b/i.test(String(labelNode?.className || ''))
                    || /\*\s*$/.test(String(labelNode?.textContent || ''));
                return { block, buttons, backing, label, required };
            })
            .filter(Boolean);
    }
    function segmentedSelectedIndex(group) {
        return group.buttons.findIndex(button =>
            [...button.classList].some(token => /^_active_/.test(token))
            || button.getAttribute('aria-pressed') === 'true'
            || button.getAttribute('aria-checked') === 'true');
    }
    function isRequiredInput(input) {
        if (input.required || input.getAttribute('aria-required') === 'true') return true;
        if (input.id) {
            const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
            if (label && /\*\s*$/.test(label.textContent)) return true;
        }
        // Fallback (MyGreenhouse react-selects, confirmed live 2026-07-27: no label[for=...]
        // association and no aria-required on the filter input at all) — reuse the same ancestor
        // wrap search labelForInput() uses, checking the RAW label text for a trailing "*" before
        // it gets stripped. Without this, every react-select shell on that template reads as
        // optional and the submit-when-complete gate could fire with truly required questions
        // (work auth, security clearance, ITAR) left unanswered.
        const wrap = input.closest('.input-wrapper, .field-wrapper, .select__container, fieldset, [class*="fieldEntry"], .ashby-application-form-field-entry');
        const label = wrap?.querySelector('label, legend, .ashby-application-form-question-title, [class*="label"]');
        return Boolean(label && /\*\s*$/.test(clean(label.textContent)));
    }

    // React-select shells inside the form (confirmed template: .select-shell > .select__control >
    // input.select__input[role=combobox]; selected value in .select__single-value; open menu is
    // .select__menu with .select__option items, rendered INSIDE the shell).
    // job-boards.greenhouse.io wraps each react-select in `.select-shell`; MyGreenhouse (gh-account)
    // has NO element with that class anywhere — confirmed live 2026-07-27 — its equivalent
    // 1:1 wrapper is `.select__container` (`.select-shell > ... > .select__control` there vs.
    // `.select > .select__container > ... > .select__control` here). Without this, selectShells()
    // silently returns zero elements on gh-account and the ENTIRE react-select fill/required-check
    // pass no-ops — confirmed live: Location, Education, work-auth/visa/clearance/ITAR questions
    // all went untouched and unflagged even though the shells were plainly visible on screen.
    const SELECT_SHELL_SELECTOR = TEMPLATE === 'gh-account' ? '.select__container' : '.select-shell';
    function selectShells() {
        const form = ghForm();
        if (!form) return [];
        return [...form.querySelectorAll(SELECT_SHELL_SELECTOR)].filter(shell => !isOurUi(shell) && shell.querySelector('input.select__input'));
    }
    function shellInput(shell) { return shell.querySelector('input.select__input'); }
    function shellValue(shell) { return clean(shell.querySelector('.select__single-value, .select__multi-value')?.textContent); }
    function shellLabel(shell) { return labelForInput(shellInput(shell)); }
    function shellIsPhoneCountry(shell) {
        // Both live pages render the "Country" react-select as part of the intl-tel-input phone
        // widget (its selected value is a dial code like "+1"). Treat +1/United States as done.
        return Boolean(shell.closest('.iti, [class*="phone"]')) || /^\+\d/.test(shellValue(shell));
    }
    function shellToggle(shell) {
        const control = shell.querySelector('.select__control');
        if (!control) return;
        const opts = { bubbles: true, cancelable: true, view: window, button: 0 };
        control.dispatchEvent(new MouseEvent('mousedown', opts));
        control.dispatchEvent(new MouseEvent('mouseup', opts));
    }
    function shellOpen(shell) {
        const input = shellInput(shell);
        if (input?.getAttribute('aria-expanded') !== 'true') shellToggle(shell);
    }
    async function waitForShellMenu(shell, timeoutMs = 5000) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const inShell = [...shell.querySelectorAll('.select__menu .select__option, .select__menu [role="option"]')].filter(visible);
            if (inShell.length) return inShell;
            // MyGreenhouse (gh-account) renders the open menu in a PORTAL appended to <body>, not
            // nested inside the shell — confirmed live 2026-07-27 (`menuInShell: 0, menuAnywhere:
            // 1`), which made every shell selection ("no options appeared") fail. react-select only
            // keeps one menu open at a time, so a document-wide fallback is safe once shell-scoped
            // comes up empty.
            const anywhere = [...document.querySelectorAll('.select__menu .select__option, .select__menu [role="option"]')].filter(visible);
            if (anywhere.length) return anywhere;
            await WAIT(120);
        }
        return [];
    }
    function shellClose(shell) {
        const input = shellInput(shell);
        if (input?.getAttribute('aria-expanded') === 'true') shellToggle(shell);
    }

    // Select an option in a react-select. `picker` maps the option-text list to an index
    // (null = first option); `searchText` is typed into the filter first (Location/Country style
    // searchable lists), followed by the one deliberate GH_SEARCH_SETTLE_MS wait.
    async function selectShellOption(shell, picker, searchText, label) {
        const input = shellInput(shell);
        if (!input) return { ok: false, message: `${label}: combobox input missing.` };
        shellOpen(shell);
        if (searchText) {
            setComboSearchValue(input, searchText);
            await WAIT(GH_SEARCH_SETTLE_MS);
        }
        const options = await waitForShellMenu(shell);
        if (!options.length) {
            shellClose(shell);
            return { ok: false, message: `${label}: no options appeared.` };
        }
        const texts = options.map(option => clean(option.innerText));
        const index = picker ? picker(texts) : 0;
        if (index < 0) {
            shellClose(shell);
            return { ok: false, message: `${label}: no option matched (${texts.slice(0, 6).join(' | ')}).`, options: texts };
        }
        realClick(options[index]);
        await WAIT(GH_SELECTION_SETTLE_MS);
        const committed = shellValue(shell);
        shellClose(shell);
        if (!committed) return { ok: false, message: `${label}: option click did not commit.` };
        return { ok: true, value: committed };
    }

    // ── Ashby typeahead comboboxes (Location) ─────────────────────────────────────────────────
    // Confirmed live 2026-07-27 (OpenAI board, field entry
    // `[data-field-path="_systemfield_location"]`, question "Where are you currently located?"):
    //   <div class="_inputContainer_*">
    //     <input class="_input_*" role="combobox" aria-autocomplete="list" aria-expanded placeholder="Start typing...">
    //     <button class="_toggleButton_*">chevron</button>
    // The suggestion list is rendered in a PORTAL at document.body level — never inside the field
    // entry — as `._floatingContainer_* > ._resultContainer_* > ._result_*` (first result carries
    // `_active_*`). The control has NO id and NO name, so it is invisible to label[for] lookups.
    //
    // USER RULE (2026-07-27): typing alone leaves the widget UNCOMMITTED and the field submits
    // EMPTY. The only correct flow is: click the input → type the search term → wait 0.5s for the
    // results → CLICK the first one → verify the input now holds the picked text.
    function typeaheadCombos(form) {
        if (TEMPLATE === 'gh') return [];   // gh uses react-select shells, handled above
        return [...(form || document).querySelectorAll('input[role="combobox"]')]
            .filter(input => visible(input) && !input.disabled && !input.readOnly
                && !isOurUi(input) && !input.closest('.select-shell') && !input.classList.contains('select__input'))
            .map(input => {
                const block = input.closest('[data-field-path], [class*="fieldEntry"], .ashby-application-form-field-entry');
                return {
                    input,
                    block,
                    path: block?.getAttribute('data-field-path') || '',
                    label: labelForInput(input),
                    required: Boolean(block?.querySelector('[class*="_required_"]')) || isRequiredInput(input)
                };
            });
    }
    function isLocationCombo(item) {
        return /_systemfield_location/.test(item.path) || /(location|located|city|reside|live)/i.test(item.label);
    }
    function typeaheadResults() {
        return [...document.querySelectorAll(
            '[class*="resultContainer"] [class*="_result_"], [class*="floatingContainer"] [role="option"], [role="listbox"] [role="option"]'
        )].filter(visible);
    }
    // `picker` maps the suggestion texts to an index; null = take the FIRST one (Location). A
    // banked picker is how a searchable STATUS list is answered: type the entry's `search` term
    // ("h1"), then click the option the bank actually wants ("H-1B Visa"), never blindly the first.
    async function fillTypeaheadCombo(item, searchText, picker) {
        const { input, label } = item;
        realClick(input);                       // open the widget the way a user does
        setComboSearchValue(input, searchText); // keeps focus (a blur closes the list)
        await WAIT(GH_SEARCH_SETTLE_MS);        // the suggestion API is async — never skip this
        let results = typeaheadResults();
        if (!results.length) {                  // one patient retry for a slow lookup
            await WAIT(GH_SEARCH_SETTLE_MS);
            results = typeaheadResults();
        }
        if (!results.length) {
            setComboSearchValue(input, '');     // never leave uncommitted text behind
            return { ok: false, message: `${label || 'Location'}: no suggestions appeared for "${searchText}".` };
        }
        const texts = results.map(result => clean(result.innerText));
        const index = picker ? picker(texts) : 0;
        if (index < 0) {
            setComboSearchValue(input, '');
            return { ok: false, message: `${label}: no suggestion matched (${texts.slice(0, 6).join(' | ')}).` };
        }
        const picked = texts[index];
        realClick(results[index]);              // THE click that commits the value
        await WAIT(GH_SELECTION_SETTLE_MS);
        const committed = clean(input.value);
        clickAway();                            // leave the widget the way a user does
        await WAIT(GH_SELECTION_SETTLE_MS);
        if (!committed) return { ok: false, message: `${label || 'Location'}: suggestion "${picked}" did not commit.` };
        return { ok: true, value: committed };
    }

    // ── Question bank matching ────────────────────────────────────────────────────────────────
    async function ghQuestionBank() {
        const stored = await storageGet([GH_INFO_KEY]);
        const extra = stored[GH_INFO_KEY]?.questions;
        const entries = DEFAULT_GH_QUESTIONS.map(entry => ({ ...entry, patterns: [...entry.patterns] }));
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
    // Identity-profile lookup. `shortLabelOnly` entries are for field-name labels ("Website"),
    // never sentence/question labels — a long label or one containing "?" is a question, not an
    // identity field, and must fall through to the question bank.
    function matchProfileField(label) {
        return GH_PROFILE_FIELDS.find(entry => {
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
    // Picker over a full option-text list. `optionCandidates` is ORDERED PRECEDENCE (project-wide
    // Screenshot Q&A capture rule, same semantics as workday's candidateMatch/degree picker): each
    // candidate regex is a complete pass over the options; the first candidate with any hit wins.
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
    // Singleton-required rule (user, 2026-07-26): a REQUIRED dropdown with exactly ONE real option
    // (placeholders excluded) is selected outright — no bank match needed (usually "Acknowledge").
    const OPTION_PLACEHOLDER = /^(select|choose|please select|pick one|--|—|\.{3}|…)/i;
    // An option that is an acknowledgement rather than a real choice is always taken, bank match or
    // not (user, 2026-07-27) — same reasoning as the single-option dropdown / lone checkbox rule.
    const ACKNOWLEDGEMENT_OPTION = /\b(acknowledge|acknowledgement|i agree|i have read|i understand|i certify|i confirm|i consent to (the|these) terms)\b/i;
    function pickSingletonIndex(texts) {
        const real = texts.map((text, index) => ({ text, index })).filter(o => o.text && !OPTION_PLACEHOLDER.test(o.text));
        return real.length === 1 ? real[0].index : -1;
    }

    async function persistSeenQuestions(seen) {
        if (!seen.length) return;
        try {
            const stored = await storageGet([GH_INFO_KEY]);
            const info = stored[GH_INFO_KEY] || {};
            const existing = Array.isArray(info.seenQuestions) ? info.seenQuestions : [];
            const merged = [...existing];
            seen.forEach(item => { if (!merged.some(other => other.question === item.question)) merged.push(item); });
            info.seenQuestions = merged.slice(-200);
            await storageSet({ [GH_INFO_KEY]: info });
        } catch { /* non-fatal */ }
    }

    // ── Packaged artifacts (same allowlisted background message as Workday) ───────────────────
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

    // File-upload blocks (gh): .file-upload contains the section label (Resume/CV or Cover
    // Letter), the Attach buttons, a hidden input[type=file], and — once attached —
    // .file-upload__filename (Greenhouse REMOVES the input after attach).
    function fileUploadBlocks() {
        const form = ghForm();
        if (!form) return [];
        return [...form.querySelectorAll('.file-upload')].map(block => {
            const text = clean(block.innerText);
            const input = block.querySelector('input[type="file"]');
            let artifactId = '';
            if (/cover letter/i.test(text)) artifactId = 'coverLetter';
            else if (/resume|curriculum vitae|\bcv\b/i.test(text)) artifactId = 'resume';
            const readFilename = () => clean(block.querySelector('.file-upload__filename')?.textContent);
            return { block, input, artifactId, readFilename, filename: readFilename() };
        }).filter(item => item.artifactId);
    }
    // File blocks (Ashby): plain input[type=file] inside a _fieldEntry container; the required
    // resume input is #_systemfield_resume. The "Autofill from resume" uploader at the top is
    // Ashby's own parser — NEVER touched (it would overwrite fields). Attach success renders the
    // filename in the container (with Replace/Delete controls) and the input keeps its files.
    function ashbyFileBlocks() {
        return [...document.querySelectorAll('input[type="file"]')].map(input => {
            const block = input.closest('[class*="fieldEntry"], [class*="field"], fieldset') || input.parentElement;
            const text = clean(block?.innerText);
            if (/autofill from resume/i.test(text)) return null;
            let artifactId = '';
            if (/cover letter/i.test(text)) artifactId = 'coverLetter';
            else if (/resume|curriculum vitae|\bcv\b/i.test(text) || input.id === '_systemfield_resume') artifactId = 'resume';
            if (!artifactId) return null;
            const readFilename = () => {
                // input.files / C:\fakepath only proves browser assignment, not Ashby acceptance.
                // The visible filename beside Replace/Delete is the committed form state.
                const match = clean(block?.innerText).match(/([\w-]+[\w .()-]*\.(pdf|docx?|txt|rtf))/i);
                return match ? match[1] : '';
            };
            return { block, input, artifactId, readFilename, filename: readFilename() };
        }).filter(Boolean);
    }
    function activeFileBlocks() {
        // MyGreenhouse (gh-account) confirmed live 2026-07-27: its Cover Letter slot renders the
        // EXACT SAME `.file-upload` > `.file-upload__wrapper` > `.file-upload__filename` markup as
        // job-boards.greenhouse.io (down to the class names) — fileUploadBlocks() works unchanged.
        // Resume is supplied by the candidate ACCOUNT and never renders a file input here, so it's
        // simply never found (no separate handling needed).
        if (TEMPLATE === 'gh' || TEMPLATE === 'gh-account') return fileUploadBlocks();
        return ashbyFileBlocks();
    }
    async function attachArtifact(item) {
        if (item.filename) return { ok: true, already: true };
        if (!item.input) return { ok: false, message: `No file input for ${item.artifactId}.` };
        let file;
        try { file = await packagedArtifactFile(item.artifactId); }
        catch (error) { return { ok: false, message: error.message || String(error) }; }
        const transfer = new DataTransfer();
        transfer.items.add(file);
        item.input.files = transfer.files;
        item.input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        item.input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        const deadline = Date.now() + 20000;
        while (Date.now() < deadline) {
            const name = item.readFilename();
            if (name) return { ok: true, filename: name };
            if (/(upload )?(error|failed)|too large|invalid file/i.test(clean(item.block.innerText))) return { ok: false, message: `Upload error for ${item.artifactId}.` };
            await WAIT(300);
        }
        return { ok: false, message: `Upload of ${item.artifactId} did not confirm.` };
    }

    // A compact signature supports non-mutating iframe diagnostics.
    function formSignature() {
        const form = ghForm();
        if (!form) return '';
        const parts = [];
        form.querySelectorAll('input, textarea, select').forEach(el => {
            if (el.type === 'hidden' || isOurUi(el)) return;
            if (el.type === 'checkbox' || el.type === 'radio') parts.push(el.id + '=' + el.checked);
            else parts.push((el.id || el.name) + '=' + clean(el.value).slice(0, 40));
        });
        form.querySelectorAll('.select__single-value').forEach(el => parts.push('sv:' + clean(el.textContent).slice(0, 40)));
        form.querySelectorAll('.file-upload__filename').forEach(el => parts.push('file:' + clean(el.textContent)));
        return parts.join('|');
    }

    // ── Submit-when-complete (user, 2026-07-26 — supersedes hold-always) ─────────────────────
    // Ashby renders EVERY button as type=submit ("Upload File", "All Jobs"…), so the submit
    // control is matched by TEXT, never by type alone.
    function findSubmitButton(form) {
        return [...(form || document).querySelectorAll('button, input[type="submit"]')]
            .filter(button => visible(button) && !isOurUi(button)
                && !button.disabled && button.getAttribute('aria-disabled') !== 'true')
            .find(button => /^submit( application)?$/i.test(clean(button.innerText || button.value))) || null;
    }
    // A captcha GATES submission only when it renders a visible widget. Both gh and Ashby carry
    // INVISIBLE reCAPTCHA plumbing (0x0 anchor iframes, g-recaptcha-response textarea) that must
    // not block. Eve never interacts with any captcha.
    function visibleCaptcha() {
        return [...document.querySelectorAll('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], .g-recaptcha, .h-captcha')]
            .find(el => {
                const src = String(el.getAttribute('src') || '');
                const configuredSize = String(el.getAttribute('data-size') || '');
                if (/(?:[?&]|%26)size(?:=|%3D)invisible/i.test(src) || /^invisible$/i.test(configuredSize)) return false;
                const rect = el.getBoundingClientRect();
                return visible(el) && rect.width > 50 && rect.height > 50;
            }) || null;
    }
    // Completeness: every required control committed. Uses required/aria-required (+ gh's label
    // asterisk via isRequiredInput). Ashby limitation: its radio groups carry no required marker,
    // so on Ashby ANY unanswered radio group counts as missing (err toward holding).
    function missingRequiredControls(form) {
        const missing = [];
        for (const el of form.querySelectorAll('input, textarea, select')) {
            if (isOurUi(el) || el.type === 'hidden' || !visible(el)) continue;
            if (/g-recaptcha/i.test(`${el.name} ${el.className}`)) continue;
            if (el.closest('.select-shell')) continue; // react-select input + empty required sentinel; shell checked below
            if (el.type === 'file') continue;      // file slots handled below via blocks
            if (el.type === 'checkbox' || el.type === 'radio') continue; // groups below
            if (el.classList.contains('select__input')) continue;        // shells below
            if (el.classList.contains('iti__search-input')) continue;
            if (isRequiredInput(el) && !clean(el.value)) missing.push(labelForInput(el) || el.name || el.id || 'text field');
        }
        for (const shell of selectShells()) {
            const input = shellInput(shell);
            if (isRequiredInput(input) && !shellValue(shell)) missing.push(shellLabel(shell) || 'dropdown');
        }
        // Ashby typeaheads have no id/required attribute — their required marker is the `_required_`
        // class on the field-entry label — so without this an empty Location would sail past the
        // completeness gate and submit blank.
        for (const item of typeaheadCombos(form)) {
            if (item.required && !clean(item.input.value)) missing.push(item.label || 'location');
        }
        for (const item of activeFileBlocks()) {
            const required = (item.input && isRequiredInput(item.input)) || item.artifactId === 'resume';
            if (required && !item.readFilename()) missing.push(`${item.artifactId} upload`);
        }
        const groups = new Map();
        [...form.querySelectorAll('input[type="radio"]')].filter(el => !isOurUi(el) && visible(el)).forEach(radio => {
            const key = radio.name || 'radios';
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(radio);
        });
        for (const radios of groups.values()) {
            if (radios.some(radio => radio.checked)) continue;
            const required = TEMPLATE !== 'gh' || radios.some(radio => radio.required || radio.getAttribute('aria-required') === 'true');
            if (required) missing.push(radioGroupLabel(radios) || 'radio group');
        }
        for (const group of segmentedChoiceGroups(form)) {
            if (segmentedSelectedIndex(group) < 0 && group.required) missing.push(group.label || 'Yes/No question');
        }
        for (const boxes of checkboxGroups(form)) {
            if (boxes.some(box => box.checked)) continue;
            const container = boxes[0].closest('fieldset, [role="group"]');
            const required = boxes.some(isRequiredInput) || container?.getAttribute('aria-required') === 'true';
            if (required) missing.push(checkboxGroupLabel(boxes));
        }
        return missing;
    }
    function visibleErrorTexts(form) {
        return [...(form || document).querySelectorAll('[role="alert"], [class*="error"], [aria-live="assertive"]')]
            .filter(el => visible(el) && !isOurUi(el))
            .map(el => clean(el.innerText))
            .filter(text => text && text.length < 220)
            .slice(0, 4);
    }
    function securityCodeChallenge() {
        const boxes = [...document.querySelectorAll('input[aria-required="true"]')]
            .filter(input => visible(input) && !isOurUi(input)
                && (input.maxLength === 1 || /one-time-code|security|verification|code/i.test(
                    `${input.autocomplete || ''} ${input.name || ''} ${input.id || ''} ${input.getAttribute('aria-label') || ''}`)));
        if (boxes.length < 4) return null;
        const context = clean((boxes[0].closest('form, [role="dialog"], main, section') || document.body).innerText);
        return /security code|verification code|code[\s\S]{0,50}(email|sent)|email[\s\S]{0,50}code/i.test(context)
            ? { boxes, context }
            : null;
    }
    function clearInactiveRelationshipFollowUps(form) {
        const relationship = selectShells().find(shell =>
            /(relative|family member|close relationship|personal relationship)/i.test(shellLabel(shell)));
        if (!relationship || !/^\s*no\s*$/i.test(shellValue(relationship))) return 0;
        let cleared = 0;
        form.querySelectorAll('input[id^="question_"], textarea[id^="question_"]').forEach(input => {
            if (/^name$/i.test(labelForInput(input)) && clean(input.value)) {
                setNativeValue(input, '');
                cleared += 1;
            }
        });
        return cleared;
    }
    // Best-effort title/company for the unified Applied Jobs record. Greenhouse/Ashby job pages
    // commonly expose a clean heading; fall back to document.title / tenant host when not found.
    // See AGENTS.md "Applied Jobs Log".
    function bestEffortGhJobMeta() {
        const titleEl = [...document.querySelectorAll('.app-title, #header .app-title, h1')].find(visible);
        const title = clean(titleEl?.textContent || document.title || '');
        const companyEl = [...document.querySelectorAll('.company-name, .header--company-name, [class*="company-name" i]')].find(visible);
        const host = location.hostname || '';
        const company = clean(companyEl?.textContent || '') || clean(host.split('.')[0] || '') || host;
        return { title, company };
    }

    // Fire-and-forget write of the unified cross-platform Applied Jobs record (Settings → Applied
    // Jobs tab). Ashby/Zipline/Cape all route through this same T3 flow and are logged under the
    // 'greenhouse' platform label per the shared schema. Never blocks the submit result.
    function recordGhApplication() {
        try {
            const meta = bestEffortGhJobMeta();
            sendRuntimeMessage({
                type: 'eve:record-applied-job',
                record: {
                    platform: 'greenhouse',
                    title: meta.title,
                    company: meta.company,
                    location: '',
                    url: location.href,
                    mode: 'auto',
                    appliedAt: new Date().toISOString(),
                    timestamp: Date.now()
                }
            }).catch(() => {});
        } catch { /* non-fatal */ }
    }

    async function clickBlankCommitArea(form) {
        try { document.activeElement?.blur?.(); } catch { }
        const target = form?.isConnected ? form : ghForm();
        if (target) realClick(target);
        await WAIT(250);
    }

    function submissionConfirmed(beforeUrl) {
        const bodyText = clean(document.body.innerText).slice(0, 4000);
        return location.href !== beforeUrl
            || /thank you|application (was |has been )?(submitted|received)|we('| ha)ve received your application|successfully submitted/i.test(bodyText)
            // Ashby's own direct (non-embedded) success screen, confirmed live 2026-07-28 (Promise):
            // heading "Application Success" + "Thanks for sending us your application." — neither
            // "thank you" nor "submitted/received" appear verbatim in that exact phrasing.
            || /application success/i.test(bodyText)
            || /thanks for (sending|submitting)[\s\S]{0,20}(your )?application/i.test(bodyText);
    }

    async function submitAndReport(form) {
        if (securityCodeChallenge()) {
            return { state: 'waiting', text: 'Email security code required — enter the code sent by Accenture, then click Apply again.' };
        }
        await clickBlankCommitArea(form);
        const button = findSubmitButton(form);
        if (!button) return { state: 'waiting', text: 'All required fields complete, but no Submit button was found — submit manually.' };
        const beforeUrl = location.href;
        // Each attempt is one complete pointer/mouse/click sequence. A guarded second attempt is
        // allowed only while the form and an enabled Submit control still remain.
        realClick(button);
        const deadline = Date.now() + 20000;
        const retryAt = Date.now() + 1000;
        let retried = false;
        while (Date.now() < deadline) {
            await WAIT(250);
            if (securityCodeChallenge()) {
                return { state: 'waiting', text: 'Email security code required — enter the code sent by Accenture, then click Apply again.' };
            }
            const captcha = visibleCaptcha();
            if (captcha) return { state: 'waiting', text: 'Filled, blocked by captcha — complete the CAPTCHA and submit manually (Eve never touches CAPTCHAs).' };
            if (submissionConfirmed(beforeUrl)) {
                recordGhApplication();
                return { state: 'idle', text: 'Submitted.' };
            }
            if (!retried && Date.now() >= retryAt) {
                retried = true;
                const currentForm = ghForm();
                const retryButton = findSubmitButton(currentForm);
                if (currentForm && retryButton) {
                    await clickBlankCommitArea(currentForm);
                    if (submissionConfirmed(beforeUrl)) {
                        recordGhApplication();
                        return { state: 'idle', text: 'Submitted.' };
                    }
                    if (securityCodeChallenge()) {
                        return { state: 'waiting', text: 'Email security code required — enter the code sent by Accenture, then click Apply again.' };
                    }
                    if (visibleCaptcha()) {
                        return { state: 'waiting', text: 'Filled, blocked by captcha — complete the CAPTCHA and submit manually (Eve never touches CAPTCHAs).' };
                    }
                    const enabledRetryButton = findSubmitButton(currentForm);
                    if (enabledRetryButton) realClick(enabledRetryButton);
                }
            }
            if (retried) {
                const errors = visibleErrorTexts(ghForm() || form);
                if (errors.length) return { state: 'error', text: `Submit retried but the form reported errors: ${errors.join(' ; ')}` };
            }
        }
        return { state: 'waiting', text: 'Submit attempted twice; no confirmation detected within 20s — verify manually.' };
    }

    // ── Apply (Eve's own from-scratch fill) ───────────────────────────────────────────────────
    let applyRunning = false;
    async function runGhApply() {
        if (applyRunning) return;
        applyRunning = true;
        try {
            const form = await ensureApplicationForm();
            if (!form) { setStatus(`No ${TEMPLATE === 'gh' ? 'Greenhouse' : 'Ashby'} application form found on this page.`, 'error'); return; }
            const filled = [];
            const failures = [];
            const unansweredRequired = [];
            const unansweredOptional = [];
            const rememberUnanswered = (label, required) => {
                (required ? unansweredRequired : unansweredOptional).push(label);
            };
            const seen = [];
            await loadRuntimeProfile();   // this installation's identity, not the placeholders
            const bank = await ghQuestionBank();

            // Steps 1–4 run in ROUNDS: answering one question can conditionally reveal another
            // (on 6sense, answering "Are you Hispanic/Latino?" inserts the "Please identify your
            // race" react-select). A single static snapshot missed those, so re-scan the form and
            // process newly-appeared controls until a round discovers nothing new (cap 5 rounds).
            // Every element is processed at most once (identity-tracked in `processed`), and the
            // unmatched/status report is computed only AFTER the final re-scan.
            const processed = new Set();
            const MAX_FILL_ROUNDS = 5;
            for (let round = 1; round <= MAX_FILL_ROUNDS; round += 1) {
                const processedBefore = processed.size;
                setStatus(round === 1 ? 'Attaching resume and cover letter…' : `Re-scanning for revealed questions (round ${round})…`, 'running');

                // 1) Files: resume + cover letter (cover letter ALWAYS attached where a slot exists).
                for (const item of activeFileBlocks()) {
                    if (processed.has(item.block)) continue;
                    processed.add(item.block);
                    const result = await attachArtifact(item);
                    if (result.ok && !result.already) filled.push(`${item.artifactId === 'coverLetter' ? 'Cover letter' : 'Resume'} attached`);
                    else if (!result.ok) failures.push(result.message);
                }

                // 2) Plain text inputs + textareas.
                if (round === 1) setStatus('Filling identity fields…', 'running');
                const textInputs = [...form.querySelectorAll('input, textarea')].filter(el =>
                    !isOurUi(el) && visible(el) && !el.disabled && !el.readOnly
                    && (el.tagName === 'TEXTAREA' || /^(text|email|tel|url|number|search)$/i.test(el.type || 'text'))
                    && !el.closest('.select-shell')
                    && el.getAttribute('role') !== 'combobox'   // typeahead — handled in 2a
                    && !el.classList.contains('select__input')
                    && !el.classList.contains('iti__search-input')
                    && !/g-recaptcha/i.test(`${el.name} ${el.className}`)); // never touch CAPTCHA plumbing
                for (const input of textInputs) {
                    if (processed.has(input)) continue;
                    processed.add(input);
                    const label = labelForInput(input);
                    if (!label) continue;
                    if (clean(input.value)) continue; // already filled (sim or user) — leave it
                    // ORDER (v1.1.191): TEXTAREAS are essay/question controls — on this template
                    // identity fields are never textareas — so the question bank is matched FIRST
                    // for them. The old profile-first order let the loose website regex steal the
                    // "…what you can find on our WEBSITE… exciting to you?" essay and fill a
                    // GitHub URL into it. Plain inputs keep profile-first (short field labels).
                    const isEssayControl = input.tagName === 'TEXTAREA';
                    // Greenhouse custom follow-ups can be labelled only "Name" (Accenture's
                    // family/relationship follow-up). Only Ashby's real system Name field owns the
                    // exact-Name profile mapping; a `question_*` Name must never get the applicant's
                    // full name automatically.
                    const profile = /^name$/i.test(label) && /^question_/i.test(input.id)
                        ? null
                        : matchProfileField(label);
                    if (!isEssayControl && profile) {
                        await fillTextField(input, profile.value);
                        filled.push(label);
                        continue;
                    }
                    const entry = matchBankEntry(bank, label);
                    seen.push({ question: label, control: isEssayControl ? 'textarea' : 'text', topic: entry ? entry.topic : '' });
                    // `requiredOnly` topics (GPA) answer only when the control is actually required —
                    // an optional box is left blank rather than volunteering the number (user,
                    // 2026-07-27).
                    if (entry && entry.requiredOnly && !isRequiredInput(input)) continue;
                    // A `profileKey` answer comes from this installation's own profile, never a
                    // value baked into the source.
                    const bankedText = entry && entry.profileKey ? (GH_PROFILE[entry.profileKey] || '') : (entry ? entry.text : null);
                    if (entry && bankedText) {
                        await fillTextField(input, bankedText);
                        filled.push(`${label} [${entry.topic}]`);
                    } else if (entry && entry.choose) {
                        // A Yes/No topic landing on a free-text control: start with the word.
                        await fillTextField(input, entry.choose === 'yes' ? 'Yes' : 'No');
                        filled.push(`${label} [${entry.topic}]`);
                    } else if (profile) {
                        // Textarea with no bank match but a (guarded) identity label — rare, but
                        // e.g. a "Website" rendered as a textarea would still get the profile URL.
                        await fillTextField(input, profile.value);
                        filled.push(label);
                    } else {
                        rememberUnanswered(label, isRequiredInput(input));
                    }
                }

                // 2a) Ashby typeahead comboboxes (Location). Deliberately AFTER the plain-text pass
                // (user, 2026-07-27: fill the other texts first, then do the click-selections one
                // at a time) and never inside it — the text pass would type into the widget and
                // leave it uncommitted, i.e. an empty field at submit time.
                for (const item of typeaheadCombos(form)) {
                    if (processed.has(item.input)) continue;
                    processed.add(item.input);
                    if (clean(item.input.value)) continue;   // already picked (sim or user)
                    const isLocation = isLocationCombo(item);
                    const entry = isLocation ? null : matchBankEntry(bank, item.label);
                    // A banked CHOICE topic (optionMatch/optionCandidates/choose) drives the pick:
                    // type its `search` term, then click the option it names. A `text` topic and the
                    // location field type their value and take the first suggestion.
                    const picker = entry ? chooserPicker(entry) : null;
                    const searchText = isLocation
                        ? GH_PROFILE.locationSearch
                        : (picker ? (entry.search || '') : (entry?.text != null ? entry.text : (matchProfileField(item.label)?.value || '')));
                    seen.push({ question: item.label, control: 'typeahead', topic: isLocation ? 'location' : (entry?.topic || '') });
                    if (!picker && !searchText) { rememberUnanswered(item.label, item.required); continue; }
                    const result = await fillTypeaheadCombo(item, searchText, picker);
                    if (result.ok) filled.push(`${item.label || 'Location'} → ${result.value}`);
                    else failures.push(result.message);
                }

                // 2b) Education react-select pairs (School*/Discipline*, MyGreenhouse). Runs BEFORE
                // the generic shell loop so it claims these shells by DOM-order index — the generic
                // loop's label-only bank match can't tell a repeated "School*" apart per entry.
                {
                    const eduShells = selectShells().filter(shell => !processed.has(shell));
                    const schoolShells = eduShells.filter(shell => /^school\b/i.test(shellLabel(shell)));
                    const disciplineShells = eduShells.filter(shell => /^discipline\b|field of study/i.test(shellLabel(shell)));
                    for (let index = 0; index < schoolShells.length && index < GH_EDUCATION.length; index += 1) {
                        const shell = schoolShells[index];
                        processed.add(shell);
                        if (shellValue(shell)) continue;
                        const edu = GH_EDUCATION[index];
                        // `schoolOther` entries take the list's own "Other" option, matched exactly so a
                        // school whose name merely contains the word can never win.
                        const schoolPicker = edu.schoolOther
                            ? texts => texts.findIndex(text => /^(other|other \(not listed\)|school not listed|not listed)$/i.test(text.trim()))
                            : null;
                        const result = await selectShellOption(shell, schoolPicker, edu.schoolSearch, 'School');
                        if (result.ok) filled.push(`School → ${result.value}`);
                        else failures.push(result.message);
                    }
                    for (let index = 0; index < disciplineShells.length && index < GH_EDUCATION.length; index += 1) {
                        const shell = disciplineShells[index];
                        processed.add(shell);
                        if (shellValue(shell)) continue;
                        const edu = GH_EDUCATION[index];
                        const searchRe = new RegExp(edu.disciplineSearch, 'i');
                        const result = await selectShellOption(shell, texts => {
                            const match = texts.findIndex(text => searchRe.test(text));
                            return match >= 0 ? match : 0;
                        }, edu.disciplineSearch, 'Discipline');
                        if (result.ok) filled.push(`Discipline → ${result.value}`);
                        else failures.push(result.message);
                    }
                }

                // 3) React-select comboboxes (location autocomplete, phone country, custom
                //    questions, EEO dropdowns).
                if (round === 1) setStatus('Answering dropdown questions…', 'running');
                for (const shell of selectShells()) {
                    if (processed.has(shell)) continue;
                    processed.add(shell);
                    const input = shellInput(shell);
                    const label = shellLabel(shell);
                    if (/(location|located)/i.test(label)) {
                        // Location autocomplete: type "Dallas", wait 0.5s, select the FIRST result
                        // (user override 2026-07-26 — Dallas everywhere). Checked BEFORE the
                        // generic "already selected" skip below: MyGreenhouse (gh-account) prefills
                        // a stale account default here (observed live: "San Francisco, California,
                        // United States") that must be overwritten, not left alone.
                        if (!new RegExp(GH_PROFILE.locationSearch, 'i').test(shellValue(shell))) {
                            const result = await selectShellOption(shell, null, GH_PROFILE.locationSearch, label);
                            if (result.ok) filled.push(`${label} → ${result.value}`);
                            else failures.push(result.message);
                        }
                        continue;
                    }
                    if (shellValue(shell)) continue; // already selected — done
                    if (shellIsPhoneCountry(shell)) {
                        // Phone country/dial-code select: pick United States when empty.
                        const result = await selectShellOption(shell, texts => texts.findIndex(text => /united states/i.test(text)), 'United States', label || 'Country');
                        if (result.ok) filled.push(`${label || 'Country'} → ${result.value}`);
                        else failures.push(result.message);
                        continue;
                    }
                    const entry = matchBankEntry(bank, label);
                    seen.push({ question: label, control: 'select', topic: entry ? entry.topic : '' });
                    if (!entry || (!entry.choose && !entry.optionMatch && !entry.optionCandidates)) {
                        // Singleton rule before declaring unmatched: a dropdown with exactly one
                        // real option is an ACKNOWLEDGEMENT, so it is selected outright — required
                        // or not (user, 2026-07-27; the rule used to apply only when required).
                        const single = await selectShellOption(shell, pickSingletonIndex, '', label);
                        if (single.ok) { filled.push(`${label} → ${single.value} (only option)`); continue; }
                        rememberUnanswered(label, isRequiredInput(input));
                        continue;
                    }
                    const result = await selectShellOption(shell, chooserPicker(entry), '', label);
                    if (result.ok) filled.push(`${label} → ${result.value} [${entry.topic}]`);
                    else failures.push(result.message);
                }

                // 4) Native selects / radio groups / checkboxes (not on the two confirmed pages,
                //    but part of the Greenhouse template family).
                for (const select of [...form.querySelectorAll('select')].filter(el => visible(el) && !isOurUi(el))) {
                    if (processed.has(select)) continue;
                    processed.add(select);
                    if (select.selectedIndex > 0 && clean(select.value)) continue;
                    const label = labelForInput(select);
                    const entry = matchBankEntry(bank, label);
                    seen.push({ question: label, control: 'native-select', topic: entry ? entry.topic : '' });
                    const optionTexts = [...select.options].map(opt => clean(opt.textContent));
                    const picker = entry ? chooserPicker(entry) : null;
                    let index = picker ? picker(optionTexts) : -1;
                    let via = entry ? `[${entry.topic}]` : '';
                    if (index < 0) {
                        // Same acknowledgement rule for native selects — one real option, take it.
                        index = pickSingletonIndex(optionTexts);
                        if (index >= 0) via = '(only option)';
                    }
                    if (index < 0) {
                        if (picker) failures.push(`${label}: no native option matched.`);
                        else rememberUnanswered(label, isRequiredInput(select));
                        continue;
                    }
                    select.value = select.options[index].value;
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                    await afterSelection();   // settle, click away from the control, settle again
                    filled.push(`${label} → ${optionTexts[index]} ${via}`);
                }
                const radioGroups = new Map();
                [...form.querySelectorAll('input[type="radio"]')].filter(el => !isOurUi(el)).forEach(radio => {
                    const key = radio.name || radio.closest('fieldset')?.id || 'radios';
                    if (!radioGroups.has(key)) radioGroups.set(key, []);
                    radioGroups.get(key).push(radio);
                });
                for (const radios of radioGroups.values()) {
                    if (radios.some(radio => processed.has(radio))) continue;
                    radios.forEach(radio => processed.add(radio));
                    if (radios.some(radio => radio.checked)) continue;
                    const optionLabels = radios.map(radio => labelForInput(radio) || clean(radio.value));
                    // Two shots at the question text: the group's own label, and — when that turns
                    // out to be the label of the field the group is nested inside — the text that
                    // actually introduces the radios.
                    const ownLabel = radioGroupLabel(radios);
                    let groupLabel = ownLabel;
                    let entry = matchBankEntry(bank, groupLabel);
                    if (!entry) {
                        const intro = radioGroupIntroText(radios, optionLabels);
                        const introEntry = intro && intro !== ownLabel ? matchBankEntry(bank, intro) : null;
                        if (introEntry) { groupLabel = intro; entry = introEntry; }
                    }
                    seen.push({ question: groupLabel, control: 'radio', topic: entry ? entry.topic : '' });
                    const picker = entry ? chooserPicker(entry) : null;
                    if (!picker) {
                        // Standing rule (user, 2026-07-27): a round check button whose option text
                        // is an acknowledgement is always selected, bank match or not.
                        const ackIndex = optionLabels.findIndex(label => ACKNOWLEDGEMENT_OPTION.test(label));
                        if (ackIndex >= 0) {
                            realClick(radios[ackIndex]);
                            await afterSelection();
                            filled.push(`${groupLabel} → ${optionLabels[ackIndex]} (acknowledgement)`);
                            continue;
                        }
                        const required = TEMPLATE !== 'gh'
                            || radios.some(radio => radio.required || radio.getAttribute('aria-required') === 'true');
                        rememberUnanswered(groupLabel, required);
                        continue;
                    }
                    const index = picker(optionLabels);
                    if (index < 0) { failures.push(`${groupLabel}: no radio matched (${optionLabels.slice(0, 4).join(' | ')}).`); continue; }
                    realClick(radios[index]);
                    await afterSelection();   // settle, click away from the control, settle again
                    filled.push(`${groupLabel} → ${optionLabels[index]} [${entry.topic}]`);
                }
                // 4a) Ashby segmented Yes/No buttons backed by an invisible checkbox.
                for (const group of segmentedChoiceGroups(form)) {
                    if (group.buttons.some(button => processed.has(button))) continue;
                    group.buttons.forEach(button => processed.add(button));
                    if (segmentedSelectedIndex(group) >= 0) continue;
                    const entry = matchBankEntry(bank, group.label);
                    seen.push({ question: group.label, control: 'segmented-buttons', topic: entry ? entry.topic : '' });
                    const picker = entry ? chooserPicker(entry) : null;
                    if (!picker) {
                        rememberUnanswered(group.label, group.required);
                        continue;
                    }
                    const optionLabels = group.buttons.map(button => clean(button.innerText));
                    const index = picker(optionLabels);
                    if (index < 0) {
                        failures.push(`${group.label}: no segmented option matched (${optionLabels.join(' | ')}).`);
                        continue;
                    }
                    realClick(group.buttons[index]);
                    await afterSelection();   // settle, click away from the control, settle again
                    filled.push(`${group.label} → ${optionLabels[index]} [${entry.topic}]`);
                }
                // 4b) Checkboxes are processed by QUESTION GROUP, not per input. Greenhouse can
                // mark every option in one multi-checkbox question as `required` (Stratolaunch);
                // one selected group member satisfies the question. A bank `optionMatch` chooses
                // the exact option; `check: true` handles a single acknowledgement checkbox.
                for (const boxes of checkboxGroups(form)) {
                    if (boxes.some(box => processed.has(box))) continue;
                    boxes.forEach(box => processed.add(box));
                    if (boxes.some(box => box.checked)) continue;
                    const label = checkboxGroupLabel(boxes);
                    const entry = matchBankEntry(bank, label);
                    const container = boxes[0].closest('fieldset, [role="group"]');
                    const required = boxes.some(isRequiredInput) || container?.getAttribute('aria-required') === 'true';
                    if (!entry) {
                        // A LONE checkbox with no bank match is an acknowledgement/consent gate
                        // ("I agree", privacy policy) — tick it (user, 2026-07-27). Groups of two or
                        // more are real choices and still wait for a bank answer.
                        if (boxes.length === 1) {
                            realClick(boxes[0]);
                            await afterSelection();
                            if (boxes[0].checked) {
                                seen.push({ question: label, control: 'checkbox', topic: 'acknowledgement' });
                                filled.push(`${label} → checked (acknowledgement)`);
                                continue;
                            }
                        }
                        rememberUnanswered(label, required);
                        continue;
                    }
                    seen.push({ question: label, control: boxes.length > 1 ? 'checkbox-group' : 'checkbox', topic: entry.topic });
                    const optionLabels = boxes.map(box => labelForInput(box) || clean(box.value));
                    // `checkAll` questions want EVERY option ticked, not one (relocation-locations:
                    // the applicant is open to all of them). Each box is its own single selection,
                    // so each gets the same click → settle → click away pacing.
                    if (entry.checkAll) {
                        const ticked = [];
                        for (let index = 0; index < boxes.length; index += 1) {
                            if (boxes[index].checked) continue;
                            realClick(boxes[index]);
                            await afterSelection();
                            if (boxes[index].checked) ticked.push(optionLabels[index]);
                        }
                        if (ticked.length) filled.push(`${label} → ${ticked.join(' + ')} [${entry.topic}]`);
                        else failures.push(`${label}: no checkbox could be ticked (${optionLabels.slice(0, 6).join(' | ')}).`);
                        continue;
                    }
                    const picker = chooserPicker(entry);
                    const index = entry.check === true && boxes.length === 1 ? 0 : (picker ? picker(optionLabels) : -1);
                    if (index < 0) {
                        failures.push(`${label}: no checkbox option matched (${optionLabels.slice(0, 6).join(' | ')}).`);
                        continue;
                    }
                    realClick(boxes[index]);
                    await afterSelection();   // settle, click away from the control, settle again
                    filled.push(`${label} → ${optionLabels[index]} [${entry.topic}]`);
                }

                if (processed.size === processedBefore) break; // nothing new appeared — stable
                // Give the framework a beat to mount any conditionally revealed controls before
                // the next re-scan.
                await WAIT(300);
            }

            await persistSeenQuestions(seen);
            clearInactiveRelationshipFollowUps(form);

            // 5) Report + SUBMIT WHEN COMPLETE (user, 2026-07-26 — supersedes hold-always).
            // If every required control is committed and no visible captcha gates the form,
            // click Submit ONCE and report the outcome; otherwise hold and list what is missing.
            // Everything Eve could NOT fill is listed ONE ITEM PER LINE (user, 2026-07-27) —
            // setStatus() runs the message through bulletize(), so each line renders as its own
            // bullet. A single semicolon-joined blob was unreadable once a form had more than two
            // or three open items.
            const lines = [];
            const listSection = (heading, items) => {
                if (!items.length) return;
                lines.push(`${heading} (${items.length}):`);
                items.forEach(item => lines.push(item));
            };
            lines.push(filled.length ? `Filled ${filled.length} field(s).` : 'Nothing new to fill.');
            listSection('Failed', failures);
            listSection('Unanswered required', unansweredRequired);
            listSection('Optional unanswered', unansweredOptional);
            const missing = missingRequiredControls(form);
            if (missing.length || failures.length || unansweredRequired.length) {
                const held = [...new Set([...missing, ...unansweredRequired])];
                listSection('Filled, held — missing required', held.length ? held : failures);
                setStatus(lines.join('\n'), 'waiting');
            } else if (visibleCaptcha()) {
                lines.push('Filled, blocked by captcha — complete the CAPTCHA and submit manually.');
                setStatus(lines.join('\n'), 'waiting');
            } else {
                setStatus([...lines, 'All required fields complete — submitting…'].join('\n'), 'running');
                const outcome = await submitAndReport(form);
                lines.push(outcome.text);
                setStatus(lines.join('\n'), outcome.state);
            }
        } catch (error) {
            setStatus(`Apply failed: ${error.message || error}`, 'error');
        } finally {
            applyRunning = false;
        }
    }

    // ── Floating panel ────────────────────────────────────────────────────────────────────────
    let statusMessage = 'Ready.';
    let eveEnabled = true;
    function setStatus(message, state = 'idle') {
        statusMessage = message;
        document.documentElement.dataset.eveGhState = state;
        document.documentElement.dataset.eveGhMessage = message;
        const status = document.getElementById('ea-apply-status');
        if (status) status.textContent = bulletize(message);
        if (!HAS_PANEL) {
            const type = TEMPLATE === 'gh' ? 'gh-embed-status' : 'ashby-status';
            try { chrome.runtime.sendMessage({ type: MSG(type), text: message, state }, () => void chrome.runtime.lastError); } catch { }
        }
    }
    // Diagnostic form signature: local on gh/direct Ashby, relayed from cross-origin frames.
    async function currentFormSignature() {
        if (TEMPLATE !== 'ashby-host' && TEMPLATE !== 'gh-host') return formSignature();
        try {
            const type = TEMPLATE === 'gh-host' ? 'gh-embed-signature' : 'ashby-signature';
            const res = await sendRuntimeMessage({ type: MSG(type) });
            return res.signature || '';
        } catch { return ''; }
    }
    // Panel-side Apply on the cape embed page: ask the background to relay the run into the
    // ashbyhq iframe; progress and the final report arrive via ashby-status relays.
    async function runRemoteAshbyApply() {
        setStatus('Starting the fill inside the Ashby application frame…', 'running');
        try {
            const res = await sendRuntimeMessage({ type: MSG('ashby-run-apply') });
            if (res.status) setStatus(res.status, res.state || 'idle');
        } catch (error) {
            setStatus(`Could not reach the Ashby application frame: ${error.message}. Make sure the job's application form is open in the page.`, 'error');
        }
    }
    async function runRemoteGreenhouseApply() {
        setStatus('Starting the fill inside the Greenhouse application frame…', 'running');
        try {
            const res = await sendRuntimeMessage({ type: MSG('gh-embed-run-apply') });
            if (res.status) setStatus(res.status, res.state || 'idle');
        } catch (error) {
            setStatus(`Could not reach the Greenhouse application frame: ${error.message}. Refresh the page and try again.`, 'error');
        }
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
    function makeHorizontallyResizable(panel, handle) {
        let resizing = false, startX = 0, startWidth = 0;
        const widthBounds = () => {
            const left = Math.max(0, panel.getBoundingClientRect().left);
            const max = Math.max(280, Math.min(960, innerWidth - left - 8));
            return { min: Math.min(360, max), max };
        };
        handle.addEventListener('mousedown', event => {
            if (panel.classList.contains('eve-minimized')) return;
            resizing = true;
            startX = event.clientX;
            startWidth = panel.getBoundingClientRect().width;
            handle.classList.add('resizing');
            event.preventDefault();
            event.stopPropagation();
        });
        document.addEventListener('mousemove', event => {
            if (!resizing) return;
            const { min, max } = widthBounds();
            panel.style.width = `${Math.max(min, Math.min(max, startWidth + event.clientX - startX))}px`;
        });
        document.addEventListener('mouseup', () => {
            if (!resizing) return;
            resizing = false;
            handle.classList.remove('resizing');
            try { localStorage.setItem(WIDTH_KEY, String(panel.getBoundingClientRect().width)); } catch { }
        });
    }
    async function renderInfo() {
        const wrap = document.getElementById('ea-info-wrap');
        if (!wrap) return;
        const stored = await storageGet([GH_INFO_KEY]);
        const seen = stored[GH_INFO_KEY]?.seenQuestions || [];
        wrap.innerHTML = seen.length ? seen.slice(-40).reverse().map(item => `
            <div class="ea-info-row">
              <label>${esc(item.topic || 'unmatched')}</label>
              <input class="eve-val-input" value="${esc(item.question)}" disabled>
            </div>`).join('') : '<p class="ea-dim">No Greenhouse questions recorded yet.</p>';
    }
    function switchView(view) {
        for (const name of ['apply', 'info']) {
            document.getElementById(`ea-body-${name}`)?.classList.toggle('ea-hidden', view !== name);
            document.getElementById(`ea-tab-${name}`)?.classList.toggle('ea-tab-active', view === name);
        }
        if (view === 'info') renderInfo();
    }
    function injectUI() {
        if (!HAS_PANEL || document.getElementById(PANEL_ID) || !eveEnabled || !hasActiveTemplate()) return;
        const version = (() => { try { return chrome.runtime.getManifest().version; } catch { return ''; } })();
        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.classList.add('eve-gh-panel');
        panel.innerHTML = `
          <div class="ea-header">
            <button id="ea-toggle-minimize" class="ea-min-btn" title="Hide Eve">−</button>
            <span class="ea-title">Eve · ${TEMPLATE === 'gh' || TEMPLATE === 'gh-host' || TEMPLATE === 'gh-account' ? 'Greenhouse' : 'Ashby'}${version ? ` <span class="ea-version" style="font-size:11px;font-weight:400;opacity:0.65;" title="Extension version">v${esc(version)}</span>` : ''}</span>
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
                <label class="ea-mini-label">Apply</label>
                <div class="ea-dim">Eve fills the whole application from the answer bank (resume, cover letter, Dallas location, questions), then submits when every required field is complete. CAPTCHAs are never touched.</div>
              </div>
            </div>
            <div class="ea-btn-row"><button id="ea-gh-apply-btn" class="ea-btn-save">Apply</button></div>
          </div>
          <div id="ea-body-info" class="ea-body ea-hidden">
            <div id="ea-info-wrap"><p class="ea-dim">Loading…</p></div>
          </div>
          <div class="ea-resize-handle"></div>`;
        document.body.appendChild(panel);
        makeDraggable(panel, panel.querySelector('.ea-header'));
        makeHorizontallyResizable(panel, panel.querySelector('.ea-resize-handle'));
        try {
            const position = JSON.parse(localStorage.getItem(POSITION_KEY) || 'null');
            if (position) { panel.style.left = `${position.left}px`; panel.style.top = `${position.top}px`; }
            const savedWidth = Number(localStorage.getItem(WIDTH_KEY));
            if (Number.isFinite(savedWidth) && savedWidth >= 280) {
                const maxWidth = Math.max(280, Math.min(960, innerWidth - panel.getBoundingClientRect().left - 8));
                panel.style.width = `${Math.min(savedWidth, maxWidth)}px`;
            }
        } catch { }
        document.getElementById('ea-toggle-minimize').addEventListener('click', () => panel.classList.toggle('eve-minimized'));
        document.getElementById('ea-tab-apply').addEventListener('click', () => switchView('apply'));
        document.getElementById('ea-tab-info').addEventListener('click', () => switchView('info'));
        document.getElementById('ea-gh-apply-btn').addEventListener('click', () => {
            if (TEMPLATE === 'ashby-host') void runRemoteAshbyApply();
            else if (TEMPLATE === 'gh-host') void runRemoteGreenhouseApply();
            else void runGhApply();
        });
        chrome.storage.local.get([THEME_KEY], result => {
            panel.classList.add(result[THEME_KEY] === 'light' ? 'eve-theme-light' : 'eve-theme-dark');
        });
        switchView('apply');
    }

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message?.type === MSG('gh-embed-probe') && TEMPLATE === 'gh-host' && IS_TOP) {
            // Safe end-to-end diagnostic: prove top page -> background -> Greenhouse iframe
            // messaging without filling a field, attaching a file, or submitting.
            currentFormSignature()
                .then(signature => sendResponse({ ok: Boolean(signature), signature }))
                .catch(error => sendResponse({ ok: false, error: error.message || String(error) }));
            return true;
        }
        if (message?.type === MSG('gh-artifact-probe')) {
            // Diagnostic hook (used by X/XC): fetch a packaged artifact through the real
            // background message path and report its validated size — proves the allowlist +
            // message wiring without touching the form.
            packagedArtifactFile(message.artifactId || 'resume')
                .then(file => sendResponse({ ok: true, name: file.name, size: file.size, type: file.type }))
                .catch(error => sendResponse({ ok: false, error: error.message || String(error) }));
            return true;
        }
        if (message?.type === MSG('gh-embed-frame-apply') && TEMPLATE === 'gh' && !IS_TOP) {
            (async () => {
                if (!ghForm()) {
                    setStatus('No Greenhouse application form found in the frame.', 'error');
                    sendResponse({ ok: false, status: statusMessage, state: 'error' });
                    return;
                }
                await runGhApply();
                sendResponse({ ok: true, status: statusMessage, state: document.documentElement.dataset.eveGhState || 'idle' });
            })();
            return true;
        }
        if (message?.type === MSG('gh-embed-frame-signature') && TEMPLATE === 'gh' && !IS_TOP) {
            sendResponse({ ok: true, signature: formSignature() });
            return true;
        }
        if (message?.type === MSG('ashby-frame-apply') && TEMPLATE === 'ashby-frame' && !IS_TOP) {
            // Relayed from the panel on the embed page: run the full fill here in the form frame.
            (async () => {
                await runGhApply();
                sendResponse({ ok: Boolean(ghForm()), status: statusMessage, state: document.documentElement.dataset.eveGhState || 'idle' });
            })();
            return true;
        }
        if (message?.type === MSG('ashby-frame-signature') && TEMPLATE === 'ashby-frame' && !IS_TOP) {
            sendResponse({ ok: true, signature: formSignature() });
            return true;
        }
        if (message?.type === MSG('ashby-status-update') || message?.type === MSG('gh-embed-status-update')) {
            // Progress relayed from the form frame; only the panel document renders it.
            const status = document.getElementById('ea-apply-status');
            if (status && HAS_PANEL) {
                statusMessage = message.text || '';
                document.documentElement.dataset.eveGhState = message.state || 'idle';
                status.textContent = bulletize(statusMessage);
            }
            sendResponse({ ok: true });
            return true;
        }
        if (message?.type === MSG('set-theme')) {
            const panel = document.getElementById(PANEL_ID);
            if (panel) {
                panel.classList.toggle('eve-theme-light', message.theme === 'light');
                panel.classList.toggle('eve-theme-dark', message.theme !== 'light');
            }
            sendResponse({ ok: true });
            return true;
        }
        return false;
    });
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local' || !changes.settings) return;
        eveEnabled = changes.settings.newValue?.autopilotEnabled !== false;
        if (!eveEnabled) document.getElementById(PANEL_ID)?.remove();
        else injectUI();
    });

    async function boot() {
        const { settings = {} } = await storageGet(['settings']);
        eveEnabled = settings.autopilotEnabled !== false;
        if (!eveEnabled) return;
        if (!HAS_PANEL) return; // ashby form frame: message-driven engine only, no UI
        injectUI();
        // Application pages are mostly full loads, but keep the panel alive across any
        // client-side re-render (same watchdog pattern as Workday). On the cape embed page the
        // ashby iframe can mount after us, so this also picks the panel up late.
        setInterval(() => { if (eveEnabled) injectUI(); }, 1500);
    }
    boot();
})();
