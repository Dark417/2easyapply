// Eve — isolated Workday application adapter.
// Reuses the floating UI styling and saved answer store without invoking LinkedIn logic.
(function () {
    // Workday application hosts: myworkdayjobs.com and myworkdaysite.com (some tenants use the latter).
    const WORKDAY_HOST_RE = /(?:myworkdayjobs|myworkdaysite)\.com$/i;
    if (!WORKDAY_HOST_RE.test(location.hostname)) return;

    const SESSION_KEY = 'eveWorkdayAutoApplySession';
    const WORKDAY_INFO_KEY = 'workdaySavedAnswers';
    const LEGACY_WORKDAY_RESUME_KEY = 'workdayResumeFile';
    const POSITION_KEY = 'eve_workday_panel_pos';
    const TARGET_GOOGLE_ACCOUNT = '';   // set `email` in eve/profile.local.json
    // No general delay in the Workday job flow (user, 2026-07-18): act immediately; the picker code
    // already polls/waits for options to render before selecting. The ONLY deliberate wait is for the
    // long search-result pickers (Field of Study / a searchable School list), which need ~0.5s for
    // the filtered results to come back before we pick — see PICKER_SEARCH_SETTLE_MS.
    const ACTION_DELAY_MS = 0;
    // Per-field pacing (user, 2026-07-27): after a text field is typed and clicked away from, wait
    // before clicking into the next one — filling back-to-back too quickly left required fields
    // still flagged as empty. The general ACTION_DELAY_MS stays 0.
    const FIELD_SETTLE_MS = 500;
    const PICKER_SEARCH_SETTLE_MS = 500; // Field of Study / School search: wait for results, then select
    const DROPDOWN_SETTLE_MS = 500; // Degree / any multi-option dropdown: 0.5s after opening AND after clicking the choice (user rule 2026-07-26)
    // Base salary expectation, per year, in USD. SINGLE SOURCE OF TRUTH — the salary-expectation
    // question entry below reads this constant, so changing the figure is a one-line edit here.
    // Mirrored in info/myworkdayjobs [Salary/Compensation expectations]; keep the two in step.
    const SALARY_EXPECTATION = '160000';
    const MAX_RESUME_BYTES = 5 * 1024 * 1024;
    // Which packaged documents this engine may request. Their real filenames and sizes live in
    // eve/profile.local.json (see eve/profile.example.json) and are resolved by background.js.
    const ARTIFACT_IDS = ['resume', 'coverLetter'];
    // The identity below is a PLACEHOLDER. Real values come from the gitignored
    // eve/profile.local.json (copy eve/profile.example.json), which background.js loads into
    // storage as `eveProfile`; applyRuntimeProfile() merges it over these defaults so a fresh
    // clone applies as ITS OWN user.
    const DEFAULT_MY_INFORMATION = Object.freeze({
        sourceDetail: '', // no default source: How Did You Hear About Us is first-option-always
        country: 'United States of America',
        firstName: 'Jane',
        lastName: 'Doe',
        preferredName: false,
        addressLine1: '1 Example St',
        city: 'Dallas',
        state: 'Texas',
        postalCode: '75001',
        phoneType: 'Mobile',
        countryPhoneCode: 'United States of America (+1)',
        phoneNumber: '(555) 555-0100',
        phoneExtension: ''
    });
    // My Experience (step after My Information): work experience, education, required language,
    // and cover letter.
    // Skills are intentionally SKIPPED per user request (too many). Data-driven from the
    // [EXPERIENCE]/[EDUCATION] answer bank; workdaySavedAnswers.myExperience overrides these defaults.
    let RUNTIME_PROFILE = {};
    let GOOGLE_ACCOUNT = TARGET_GOOGLE_ACCOUNT;
    async function applyRuntimeProfile() {
        try {
            const stored = await new Promise(resolve => chrome.storage.local.get(['eveProfile'], resolve));
            const identity = stored && stored.eveProfile;
            if (!identity || typeof identity !== 'object') return RUNTIME_PROFILE;
            RUNTIME_PROFILE = identity;
            if (identity.email) GOOGLE_ACCOUNT = identity.email;
        } catch { /* no stored profile — placeholders stand */ }
        return RUNTIME_PROFILE;
    }
    // My Information values, profile first and packaged default second.
    function profileMyInformation() {
        const p = RUNTIME_PROFILE || {};
        return Object.assign({}, DEFAULT_MY_INFORMATION, {
            firstName: p.firstName || DEFAULT_MY_INFORMATION.firstName,
            lastName: p.lastName || DEFAULT_MY_INFORMATION.lastName,
            addressLine1: p.addressLine1 || DEFAULT_MY_INFORMATION.addressLine1,
            city: p.addressCity || p.city || DEFAULT_MY_INFORMATION.city,
            state: p.state || DEFAULT_MY_INFORMATION.state,
            postalCode: p.zip || DEFAULT_MY_INFORMATION.postalCode,
            phoneNumber: p.phone || DEFAULT_MY_INFORMATION.phoneNumber
        });
    }
    const FILL_SKILLS = false; // user opted out of filling the Skills section on My Experience
    const DEFAULT_MY_EXPERIENCE = Object.freeze({
        workExperiences: Object.freeze([
            Object.freeze({
                jobTitle: 'Associate Software Engineer',
                company: 'J.P. Morgan Chase & Co.',
                location: 'Dallas, TX, United States',
                currentlyWorkHere: true,
                startDate: '04/2022',
                endDate: '',
                description: 'Backend software engineer on a financial-instrument platform: built end-to-end AWS data pipelines (PySpark on Glue, Aurora PostgreSQL, SNS), Spring Boot services exposing GraphQL/REST, and Google ADK/Bedrock generative-AI agent systems. Owned delivery from implementation through deployment, release validation, and production support (Datadog, CloudWatch, Terraform, ECS, CI/CD).'
            }),
            Object.freeze({
                jobTitle: 'Software Engineer Intern',
                company: 'Graphen Inc.',
                location: 'New York, NY, United States',
                currentlyWorkHere: false,
                startDate: '05/2021',
                endDate: '09/2021',
                description: 'Developed a data-processing service and UI that integrated a multimodal video-understanding model and visualized outputs using Python, Flask, and React. Co-authored the paper MultiModal Language Modelling on Knowledge Graphs (doi.org/10.1145/3474085.3479220).'
            })
        ]),
        educations: Object.freeze([
            Object.freeze({
                school: 'State University of New York at Buffalo',
                // Tenants that render School as a searchable picker (Bank of America / GHR) list this
                // school under several names; precedence order, '*' = wildcard.
                schoolCandidates: Object.freeze(['State University of New York at Buffalo', 'University at Buffalo*', '*SUNY*Buffalo*', '*Buffalo*']),
                schoolNotListed: false,
                degree: 'Master of Science',
                // Select-with-precedence major (chain, '*' = wildcard): exact "Computer Science" first,
                // then the "Computer (and) Information Science" family many tenants use instead, then
                // broader computer*science / computer*engineer* globs. The chain is AUTHORITATIVE — the
                // picker never falls back to "first option in the list" for Field of Study.
                fieldOfStudy: Object.freeze(['Computer Science', 'Computer and Information Science', 'Computer*Information*Science', 'Computer*Science', 'Computer*Engineer*']),
                startYear: '2020',
                endYear: '2022'
            }),
            Object.freeze({
                school: 'Beijing International Studies University',
                schoolCandidates: Object.freeze(['Beijing International Studies University', 'Beijing International*', '*Beijing*Studies*']),
                schoolNotListed: true, // undergrad not in Workday's list -> select "Other", then type the name
                degree: 'Bachelor of Arts',
                // "Select with precedence": for a Field of Study picker, try these in order (a trailing
                // '*' means starts-with). Undergrad major is English Literature.
                fieldOfStudy: Object.freeze(['English Literature', 'English', 'English*']),
                startYear: '2010',
                endYear: '2014'
            })
        ]),
        // Languages: filled ONLY when the tenant renders a Languages section AND marks it required
        // (user, 2026-07-27). Two entries - English and Chinese (Mandarin) - and "native" is ticked
        // on BOTH when the tenant offers a native checkbox. `optionCandidates` / `levelCandidates`
        // are ordered globs, most specific first: the first rung the tenant actually offers wins,
        // so no tenant's literal wording is ever hard-coded.
        languages: Object.freeze([
            Object.freeze({
                name: 'English',
                optionCandidates: Object.freeze(['English', 'English*', '*English*']),
                fluent: true,
                native: true,
                level: 'C2 (Proficient/Native Speaker)'
            }),
            Object.freeze({
                name: 'Chinese (Mandarin)',
                optionCandidates: Object.freeze([
                    'Chinese*Mandarin*', 'Mandarin*', 'Chinese*Simplified*', 'Chinese',
                    'Chinese*', '*Mandarin*', '*Chinese*'
                ]),
                fluent: true,
                native: true,
                level: 'C2 (Proficient/Native Speaker)'
            })
        ]),
        // Level/proficiency scales differ per tenant (CEFR "C2 - Proficient", LinkedIn-style "Native
        // or Bilingual Proficiency", plain "Fluent", numeric "5 - Native"). Ordered preference.
        levelCandidates: Object.freeze([
            'C2*', '*Native Speaker*', 'Native or Bilingual*', 'Native*', 'Fluent*', 'Proficient*',
            'Advanced*', 'Expert*', 'Full Professional*', '5*'
        ]),
        skills: Object.freeze([
            'Java', 'Python', 'SQL', 'JavaScript', 'TypeScript', 'Spring Boot', 'React', 'FastAPI',
            'GraphQL', 'REST APIs', 'Kafka', 'PostgreSQL', 'MongoDB', 'AWS', 'Terraform', 'Docker',
            'Kubernetes', 'Jenkins'
        ])
    });
    // Application Questions step: repetitive screening questions asked in many phrasings.
    // Each entry matches a whole question block's text (question + explanation) via regex.
    // `choose` selects the Yes/No control option: 'yes' picks the affirmative option even when
    // it is worded long ("Yes, I affirm…"); 'no' picks No. `exclude` stops a broader entry from
    // stealing a more specific question. `followUp` fills a revealed "Please provide details" text
    // field. Order matters: the most specific question is listed first. Users accumulate new
    // phrasings by adding `{ topic, patterns:[glob…], choose, followUp }` to
    // `workdaySavedAnswers.applicationQuestions`; same-topic patterns merge into the defaults.
    const DEFAULT_APPLICATION_QUESTIONS = [
        {
            // "Are you presently a US Person? A 'U.S. Person' is defined as a: Lawful Permanent
            // Resident: U.S. Citizen OR Legal Immigrant with a 'Green Card', Protected Individual
            // granted asylum or refugee status" (user, 2026-07-27, mirrored from greenhouse.js) ->
            // No. This is an export-control/ITAR-style US-Person status disclosure, NOT a work-
            // authorization question — the applicant is on an H-1B (not a citizen, green-card
            // holder, or asylee/refugee), so the answer is No even though work-authorization
            // questions elsewhere answer Yes. Distinct patterns (the "US Person"/green-card/asylum
            // definition) keep it from ever colliding with work-authorization or unrestricted-
            // right-to-work, which stay Yes. Placed first so it never falls through to those.
            topic: 'us-person-status',
            patterns: [
                /are you (presently|currently)? ?a u\.?s\.? person/i,
                /\bu\.?s\.? person\b[\s\S]{0,250}(lawful permanent resident|green card|asylum|refugee)/i,
                /lawful permanent resident[\s\S]{0,120}(green card|u\.?s\.? citizen)/i,
                /legal immigrant with a[\s\S]{0,20}green card/i
            ],
            choose: 'no'
        },
        // ── Salesforce-style screening questions, taught from a live page (2026-07-20). Placed FIRST
        // so these specific phrasings win over the generic work-authorization entry below. ──
        {
            // User override 2026-07-26: every unrestricted-right/work-authorization phrasing -> Yes,
            // including the option that describes citizens/greencard holders/Mexico/Canada.
            // Keep this specific topic before the generic work-authorization entry.
            topic: 'unrestricted-right-to-work',
            patterns: [
                /unrestricted right to work/i,
                /do you have the unrestricted right to work/i,
                /right to work[\s\S]{0,160}(on any visa|any visa or possess|expiration date|daca or tps)/i,
                // Equinix variant: "unrestricted legal authorization to work in the country".
                /unrestricted[\s\S]{0,25}(legal )?(right|authorization) to work/i,
                // "without THE NEED FOR sponsorship" (Ashby screenshot 2026-07-27), mirrored from
                // greenhouse.js.
                /authorized to work[\s\S]{0,50}(u\.?s\.?|united states)[\s\S]{0,60}without (the )?(need (for|of) |needing |requiring |company |employer |visa )?sponsorship/i,
                /work in (the )?(u\.?s\.?|united states)[\s\S]{0,60}without (the )?(need (for|of) |needing |requiring |company |employer |visa )?sponsorship/i
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
            // "I understand … proof of legal right to work … completion of an I-9 form will be
            // required." Acknowledgement -> Yes.
            topic: 'i9-acknowledgment',
            patterns: [
                /completion of an i-?9 form will be required/i,
                /proof of (legal )?right to work[\s\S]{0,80}(i-?9|will be required)/i
            ],
            choose: 'yes'
        },
        {
            // Citi: "Can you, within the time period prescribed by law, submit verification of both
            // your identity and authorization to work in the country or jurisdiction where the
            // position … is located? (Proof will be required)" — the I-9 / right-to-work document
            // question in question form. The applicant holds valid US work documents (H-1B) and can
            // complete I-9 verification on hire -> Yes. Placed before `work-authorization` so a
            // generic "authorization to work" pattern can never steal it.
            topic: 'work-eligibility-verification',
            patterns: [
                /within the time period prescribed by law/i,
                /submit verification of[\s\S]{0,60}identity and[\s\S]{0,60}authorization to work/i,
                /(submit|provide|produce)[\s\S]{0,60}(verification|proof|documentation|evidence)[\s\S]{0,80}(identity|employment eligibility)/i,
                // Visa words it "provide verification of your identify upon hire" — note their typo
                // ("identify"), so match the `identi` stem rather than the whole word.
                /verification of[\s\S]{0,25}identi/i,
                /(verification|proof|documentation|evidence) of[\s\S]{0,40}(identity|employment eligibility)[\s\S]{0,80}(work|employment)/i
            ],
            choose: 'yes'
        },
        // ── Finance-tenant Government Official / regulator screening block (taught from Morgan
        // Stanley wording 2026-07-25; the same questions appear at Citi, BofA, Goldman, JPMC, so the
        // patterns say <company>-agnostic things and never name a tenant). All answer No.
        // ORDER MATTERS: these sit BEFORE `government-employment`, whose phrasings also mention a
        // Government Official, so the specific question wins and each routes to its own topic.
        {
            // "Are you an Immediate Family Member or Close Associate of any Government Official who
            // has the ability to directly or indirectly influence the award of business …?" -> No.
            // MUST come before `gov-influence-business`: the two strings are near-identical and this
            // one is distinguished only by the family-member wording.
            topic: 'gov-family-associate',
            patterns: [
                /immediate family member or close associate/i,
                /(family member|close associate) of (any |a )?government official/i
            ],
            choose: 'no'
        },
        {
            // "In a capacity as a Government Official or employee of a financial regulator, have you
            // had the ability to directly or indirectly influence the award of business …?" -> No.
            topic: 'gov-influence-business',
            patterns: [
                /influence the award of business/i,
                /exercise decision making authority/i
            ],
            // Never steal the Immediate Family Member / Close Associate variant above.
            exclude: /immediate family member|close associate/i,
            choose: 'no'
        },
        {
            // "…are you subject to any post-employment restrictions (cooling off period,
            // non-disclosure, recusal …)?" -> No. OPPOSITE POLARITY to `post-government-restrictions`
            // (-> Yes), which is the ATTESTATION form "I attest I have NO post-government employment
            // restrictions". Note this one says "post-employment", not "post-government employment",
            // so the two patterns do not overlap — the exclude below is belt-and-braces.
            topic: 'post-employment-restrictions-subject',
            patterns: [
                /subject to any post-?employment restrictions/i,
                /post-?employment restrictions[\s\S]{0,120}(cooling off|non-?disclosure|recusal)/i,
                /cooling off period/i
            ],
            exclude: /i attest|confirm that i have no/i,
            choose: 'no'
        },
        {
            // "Were you referred or recommended for this position by a Government Official?" -> No.
            // Distinct from `referral-status` (a plain "were you referred?" question, also No).
            topic: 'gov-referral',
            patterns: [
                /referred or recommended[\s\S]{0,60}by a government official/i,
                /referred[\s\S]{0,40}by a government official/i
            ],
            choose: 'no'
        },
        {
            // "Are you currently, were you previously, or have you ever attempted to become,
            // registered in the securities industry?" -> No. Recurs across finance tenants.
            topic: 'securities-registration',
            patterns: [
                /registered in the securities industry/i,
                /(currently|previously|ever attempted)[\s\S]{0,90}registered[\s\S]{0,40}securities/i,
                /securities industry registration/i
            ],
            choose: 'no'
        },
        {
            // US federal/state/local government employee (incl. "special Government employee",
            // 18 U.S.C. §202) or member of the Armed Services in the last 5 years, AND the Morgan
            // Stanley phrasing "Are you currently, or have you been in the past three years, a
            // Government Official …, or employed by a financial regulator?". Folded in here rather
            // than given its own topic: same subject, same answer, so the bank grows by
            // generalization. Applicant's only employers are J.P. Morgan and Graphen (private) -> No.
            topic: 'government-employment',
            patterns: [
                /been an employee of a[\s\S]{0,40}government/i,
                /government employment[\s\S]{0,160}(employee|armed services|armed forces)/i,
                /special government employee|18 u\.?s\.?c\.?\s*§?\s*202/i,
                // Morgan Stanley phrasing:
                /(are you|have you been)[\s\S]{0,80}a government official/i,
                /employed by a financial regulator/i,
                // Equinix (2026-07-26): "Are you a current or former U.S. government employee who has or
                // had oversight … related to a U.S. government contract with Equinix …?" -> No.
                /(current or former\s+)?(u\.?s\.?\s+)?government employee/i
            ],
            // Never steal the sibling Government-Official questions that have their own topics above
            // (influence-the-award, family member / close associate, post-employment restrictions,
            // referred by a Government Official), nor the post-government attestation.
            exclude: /attest|post-government|no[\s\S]{0,20}restrictions|influence the award of business|decision making authority|immediate family member|close associate|post-?employment restrictions|referred or recommended/i,
            choose: 'no'
        },
        {
            // "I attest/confirm that I have no post-government employment restrictions … OR that if
            // aware I will disclose them." Never a government employee -> attest Yes.
            topic: 'post-government-restrictions',
            patterns: [
                /post-government employment restrictions/i,
                /i attest\/?\s*confirm that i have no[\s\S]{0,60}restrictions/i
            ],
            choose: 'yes'
        },
        {
            // Debarred / suspended / proposed for debarment / declared ineligible for a federal
            // contract -> No.
            topic: 'debarment',
            patterns: [
                /\bdebarred\b|debarment/i,
                /suspended[\s\S]{0,60}(debarment|ineligible)/i,
                /declared ineligible for award of a contract/i
            ],
            choose: 'no'
        },
        {
            // Explicit user override (2026-07-26): a restricted-country citizenship list is a
            // specific screening topic, distinct from nationality and additional citizenship.
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
            // US export-control screen: "Are you a citizen, national or permanent resident of Iran,
            // Cuba, North Korea or Syria?" Applicant is a Chinese national (not listed) -> No.
            topic: 'export-control-restricted-country',
            patterns: [
                /citizen,?\s*national or permanent resident of[\s\S]{0,40}(iran|cuba|north korea|syria)/i,
                /(iran|cuba|north korea|syria)[\s\S]{0,40}(citizen|national|permanent resident)/i,
                /export control[\s\S]{0,160}(iran|cuba|north korea|syria)/i
            ],
            choose: 'no'
        },
        {
            // Final "I acknowledge that I have read, reviewed and answered the above questions
            // truthfully …; select 'yes' if you acknowledge." -> Yes.
            topic: 'acknowledge-answers-truthful',
            patterns: [
                /i acknowledge that i have read,?\s*reviewed and answered/i,
                /answered the above questions truthfully/i,
                /select .?yes.? if you acknowledge/i,
                /confirm[\s\S]{0,80}answers[\s\S]{0,80}complete and accurate/i,
                /permission is granted[\s\S]{0,80}verify[\s\S]{0,80}statements/i,
                /certify[\s\S]{0,80}application[\s\S]{0,40}(true|complete|accurate)/i
            ],
            choose: 'yes'
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
            topic: 'country-of-residence',
            patterns: [
                /what is your country of residence/i,
                /current country of residence/i,
                /country (where|in which) you (currently )?reside/i,
                // "In which country do you reside?" (screenshot 2026-07-27, mirrored from
                // greenhouse.js) - question word order the pattern above cannot reach.
                /(in )?which country do you (currently )?(reside|live)/i,
                /country (of|in which)[\s\S]{0,20}(reside|residence|live)/i,
                /what country do you (currently )?(reside|live) in/i
            ],
            // Searchable version of this list (typeahead): typing "uni" surfaces "United States".
            search: 'uni',
            optionMatch: /^\s*(u\.?s\.?|united states(?: of america)?)\s*$/i,
            optionLabel: 'U.S.'
        },
        {
            // "What's your english level?" CEFR list (screenshot 2026-07-27, mirrored from
            // greenhouse.js). Same answer as the My Experience Languages section: C2 / Proficient /
            // Native, as an ordered precedence chain over whatever levels the tenant offers.
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
            topic: 'based-in-ny-or-sf',
            patterns: [
                /are you (currently )?based in new york or san francisco/i,
                /(currently )?(based|located|residing) in (new york|nyc)[\s\S]{0,40}(or|and)[\s\S]{0,30}san francisco/i,
                /(currently )?(based|located|residing) in san francisco[\s\S]{0,40}(or|and)[\s\S]{0,30}(new york|nyc)/i
            ],
            // A CONDITIONAL question ("IF you are based in SF, SLC or NYC, are you able to commute
            // to the office three days per week?", user 2026-07-27) is about ABILITY, not
            // residency - it belongs to the office-attendance affirmative, never No here.
            exclude: /\bif you are (based|located)|are you able to|can you (commute|work)|commute to the office/i,
            choose: 'no'
        },
        {
            // "Do you currently live in the San Francisco Bay Area?" (user, 2026-07-27, mirrored
            // from greenhouse.js) — a plain single-region residency question, distinct from
            // `based-in-ny-or-sf` (which requires BOTH New York and San Francisco named together).
            // The region name is incidental; match the shape, not the literal sentence.
            topic: 'bay-area-residency',
            patterns: [
                /(live|living|reside|residing|resident|based|located)[\s\S]{0,40}\b(san francisco )?bay area\b/i,
                /\b(san francisco )?bay area\b[\s\S]{0,40}(do you|are you|currently)?[\s\S]{0,10}(live|reside|resident|based|located)/i
            ],
            // A question pairing the location with an ONSITE SCHEDULE is answered from an option list
            // whose choices include "not currently in the Bay Area but open to relocation" (user,
            // 2026-07-28) - office-attendance-requirement owns it and puts relocation first.
            exclude: /\bonsite\b|\bin[- ]office\b|days? (per|a) week|open to (this|the) schedule|willing to relocat|open to relocat/i,
            choose: 'yes'
        },
        {
            // Shared "where do you live?" topic (mirrored from greenhouse.js — the answer bank is
            // shared across every task except T1/LinkedIn). Plain input → this text; typeahead or
            // dropdown → type the term, wait 0.5s, click the first suggestion.
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
            // Free-text: "What is your preferred geographic location?" Applicant's stated preference
            // (user, 2026-07-20). `text` fills the textarea/input directly (see runRegexChoiceStep).
            topic: 'preferred-geographic-location',
            patterns: [
                /preferred geographic location/i,
                /(preferred|desired)[\s\S]{0,20}(geographic )?location/i,
                /what (is|are) your (preferred|desired) (work )?location/i
            ],
            text: 'CA, WA, UT, TX'
        },
        {
            topic: 'visa-or-work-permit-future',
            patterns: [
                /will you need to (obtain|renew|extend|transfer)/i,
                /(obtain|renew|extend or transfer)[\s\S]{0,40}(visa|work permit)/i,
                /(visa|work permit)[\s\S]{0,80}(now or in the future|in the future)/i
            ],
            choose: 'yes',
            followUp: {
                patterns: [/please provide details/i, /provide[\s\S]{0,24}details/i, /please explain/i, /if yes[,]? please/i],
                text: 'H1b transfer and greencard.'
            }
        },
        {
            topic: 'work-authorization',
            patterns: [
                /do you have legal authorization to work/i,
                /have[\s\S]{0,20}legal authorization to work/i,
                /are you (currently )?(legally )?authoriz(ed|ation) to work/i,
                /legally permitted to work/i,
                /(fully )?authorized to work[\s\S]{0,40}for any employer/i,
                /authorized to work for any employer[\s\S]{0,20}(u\.?s\.?|united states)/i,
                /work for any (u\.?s\.? )?employer[\s\S]{0,30}without restriction/i,
                /(legal )?right to work/i,
                // Visa: "Are you legally eligible to work in the job's location?"
                /(legally )?eligible to work/i,
                /eligible to work in (the )?(job|position|role|country)/i
            ],
            // Never steal the unrestricted-right-to-work question or the I-9 acknowledgement —
            // both are handled by their more specific affirmative topics above.
            exclude: /obtain|renew|extend or transfer|work permit|unrestricted|any visa or possess|completion of an i-?9/i,
            choose: 'yes'
        },
        {
            topic: 'sponsorship-combined-explanation',
            patterns: [
                /sponsorship for employment[\s\S]{0,100}if so[\s\S]{0,30}(explain|describe)/i,
                /(require|need)[\s\S]{0,40}sponsorship[\s\S]{0,100}please explain/i
            ],
            text: 'Yes, H1b transfer.'
        },
        {
            // Citi renders the sponsorship follow-up as its OWN required question block ("In the text
            // box below please provide additional details on your required sponsorship."), not as a
            // field inside the sponsorship block, so it needs a free-text entry of its own. Listed
            // before `sponsorship` so the Yes/No entry can never claim this text-only block.
            topic: 'sponsorship-details',
            patterns: [
                /(provide|share|give|enter)[\s\S]{0,30}details[\s\S]{0,60}sponsorship/i,
                /additional details[\s\S]{0,40}sponsorship/i,
                /text box below[\s\S]{0,80}sponsorship/i,
                /sponsorship[\s\S]{0,60}(please\s+)?(explain|describe|provide (additional )?details)/i
            ],
            text: 'On H-1B, authorized to work only for my current employer; I require visa sponsorship (H-1B transfer) for future employment.'
        },
        {
            // SPONSORSHIP SPLIT (user, 2026-07-25). "Do you CURRENTLY require <company> to sponsor a
            // work visa on your behalf TO COMMENCE EMPLOYMENT?" -> **No**. The applicant already
            // holds valid US work authorization (H-1B), so nothing is needed to *start*; sponsorship
            // is needed later (transfer/renewal), which is the generic `sponsorship` -> Yes below.
            // This MUST be ordered before the generic entry and MUST exclude the combined
            // "now or in the future" phrasings — answering Yes here would be a factual misstatement
            // on a visa question, and answering No to the combined question equally so.
            topic: 'sponsorship-current-commence',
            patterns: [
                /do you currently require[\s\S]{0,60}sponsor[\s\S]{0,40}(work visa|visa)/i,
                /currently require[\s\S]{0,80}to commence employment/i,
                /require[\s\S]{0,60}sponsor a work visa[\s\S]{0,60}commence/i
            ],
            // Any "now or in the future" / "in the future" wording belongs to the generic Yes entry.
            exclude: /now or in the future|in the future|future(ly)?\b[\s\S]{0,40}sponsor/i,
            choose: 'no'
        },
        {
            // Multi-option immigration-status picker, mirrored from greenhouse.js (screenshot
            // 2026-07-27): pick the option naming an existing temporary work visa / H-1B transfer;
            // never the citizen/greencard option. Ordered BEFORE the Yes/No sponsorship topic.
            topic: 'work-auth-status-select',
            patterns: [
                /which best describes your (current )?work authorization/i,
                /which[\s\S]{0,60}(describes|applies to)[\s\S]{0,40}work authorization/i,
                /(select|choose)[\s\S]{0,30}(work authorization|immigration|visa) status/i,
                /what is your (current )?[\s\S]{0,20}(work authorization|visa|immigration) status/i,
                /(current )?(u\.?s\.? )?work authorization status/i
            ],
            exclude: /unrestricted/i,
            search: 'h1',
            optionCandidates: [
                // "Can work for any employer / Can work for current employer / Seeking work
                // authorization" (user, 2026-07-27): an H-1B holder can work for their CURRENT
                // employer only - never "any employer", never "seeking".
                /can work for (my )?current employer/i,
                /(temporary work visa|h-?1b)[\s\S]{0,80}(transfer|sponsor)/i,
                /\bh-?1b\b/i,
                /authorized[\s\S]{0,80}sponsor[\s\S]{0,40}(later|future)/i
            ],
            optionLabel: 'On a temporary work visa (H-1B) - employer sponsors a transfer'
        },
        {
            topic: 'sponsorship',
            patterns: [
                /require sponsorship/i,
                // Morgan Stanley: "Will you IN THE FUTURE require sponsorship for employment visa
                // status?" -> Yes (same answer as the generic; stated explicitly for clarity).
                /will you in the future require sponsorship/i,
                /in the future[\s\S]{0,40}require sponsorship/i,
                /need[\s\S]{0,20}sponsorship/i,
                /will you[\s\S]{0,60}require sponsorship/i,
                /do you[\s\S]{0,40}(require|need)[\s\S]{0,20}sponsorship/i,
                // Topgolf inserts the full company name between "require" and "sponsorship".
                /(require|need)[\s\S]{0,60}sponsorship/i,
                // Guidewire (2026-07-25): "Will you now or in the future require visa sponsorship to
                // maintain work authorization?" — "require VISA sponsorship" (a word between), which the
                // bare /require sponsorship/ missed. Generalize to require|need + up to 20 chars.
                /(require|need)[\s\S]{0,20}sponsorship/i,
                // Ashby/Notion phrasing (screenshot 2026-07-27), mirrored from greenhouse.js: the
                // company name sits between "require" and "to sponsor", and the object is an
                // "immigration case" rather than the word "sponsorship".
                /(require|need)[\s\S]{0,40}to sponsor[\s\S]{0,40}(immigration case|visa|petition)/i,
                /sponsor an immigration case/i
            ],
            // The free-text "provide details on your required sponsorship" block is a separate
            // question handled by `sponsorship-details`, not a Yes/No.
            exclude: /text box below|provide[\s\S]{0,24}details/i,
            // Some boards answer this with a VISA-TYPE list instead of Yes/No (OPT | H1B | TN |
            // None | Other — Ashby screenshot 2026-07-27, mirrored from greenhouse.js): take the
            // H-1B option first, then the plain affirmative — never "None".
            optionCandidates: [
                /^\s*h-?1b\b/i,
                /^\s*yes\b/i,
                /^\s*i (can|agree|acknowledge|affirm)\b/i
            ],
            choose: 'yes',
            followUp: {
                // "provide details", "provide additional details", "please explain", …
                patterns: [/please provide details/i, /provide[\s\S]{0,24}details/i, /please explain/i, /if yes[,]? please/i],
                text: 'On H-1B, authorized to work only for my current employer; I require visa sponsorship (H-1B transfer) for future employment.'
            }
        },
        {
            topic: 'personal-relationship',
            patterns: [
                /do you have a personal relationship/i,
                /personal relationship[\s\S]{0,60}(current|blackrock|employee|contingent|worker)/i,
                // Capital One (2026-07-25): "Do you have any close or intimate personal relationships,
                // shared financial interests, or other …?" -> No.
                /(close or intimate|intimate) personal relationship/i,
                /personal relationships?[\s\S]{0,40}(shared financial|financial interest)/i
            ],
            choose: 'no'
        },
        // ── Citi compliance screening (taught from a live Application Questions page, 2026-07-25).
        // The applicant has no relatives/covered relationships in Citi senior management, never worked
        // at KPMG, and is not a referral/relative of any SGO/SCP -> all No. ──
        {
            // "Do you have any relatives … or persons in any other Covered Relationships that are part
            // of Citi's Senior Management?" -> No.
            topic: 'citi-relatives-senior-management',
            patterns: [
                /relatives[\s\S]{0,120}covered relationships/i,
                /(relatives|covered relationships)[\s\S]{0,160}senior management/i,
                /part of citi[\s\S]{0,60}senior management/i
            ],
            choose: 'no'
        },
        {
            // Topgolf (2026-07-27): "Are you currently, or have you ever been, a partner,
            // principal, shareholder or employee of Deloitte & Touche LLP or any of its
            // subsidiaries or affiliates?" -> No.
            topic: 'audit-firm-affiliation',
            patterns: [
                /(currently|ever)[\s\S]{0,80}(partner|principal|shareholder|employee)[\s\S]{0,100}(deloitte|touche|kpmg|pwc|pricewaterhousecoopers)/i,
                /(partner|principal|shareholder|employee)[\s\S]{0,100}(deloitte|touche)[\s\S]{0,100}(subsidiar|affiliate)/i,
                /(partner|principal|shareholder|employee) of[\s\S]{0,100}(audit|accounting|professional services) firm/i
            ],
            choose: 'no'
        },
        {
            // "Were you a partner and/or have you ever been employed by KPMG LLP … in the last 3 years?"
            // -> No. (Also broadly caught by prior-employment, but keep an explicit entry.)
            topic: 'kpmg-employment',
            patterns: [
                /employed by kpmg/i,
                /partner[\s\S]{0,80}kpmg/i,
                /kpmg( llp)?[\s\S]{0,100}(members|affiliates|last three|3\)? years)/i
            ],
            choose: 'no'
        },
        {
            // "Are you a referral or relative of a current Senior Government Official (SGO) … or have
            // you held a SGO position within the last 5 years?" -> No.
            topic: 'sgo-referral',
            patterns: [
                /senior government official/i,
                /\bsgo\b[\s\S]{0,60}(position|official)/i,
                /referral or relative of[\s\S]{0,80}government official/i
            ],
            choose: 'no'
        },
        {
            // "Are you a referral of a current Senior Commercial Person (SCP)?" -> No.
            topic: 'scp-referral',
            patterns: [
                /senior commercial person/i,
                /\bscp\b[\s\S]{0,60}(referral|person)/i,
                /referral of[\s\S]{0,80}commercial person/i
            ],
            choose: 'no'
        },
        // Minimum-age attestation (T-Mobile: "at least 18 years of age … proof of age … meet this
        // requirement?"). Applicant is an established professional -> Yes.
        {
            topic: 'age',
            patterns: [
                // Any minimum (16/18/19/21...), any phrasing - "Are you at least 18 years old?" ->
                // "Yes, I am at least 18 years old" (user example, 2026-07-27). Pattern, not literal.
                /at least\s*\d{1,2}\s*(\+\s*)?years?\s*(old|of age)?/i,
                /\b\d{1,2}\s*years?\s*(of age|or older|or above|old)\b/i,
                /\b(over|above|older than)\s*(the age of\s*)?\d{1,2}\b/i,
                /\bof legal (working|employment) age\b/i,
                /proof of age[\s\S]{0,80}meet this requirement/i,
                /age of majority[\s\S]{0,180}right to contract[\s\S]{0,60}(own|your) name/i,
                /(age 18|age 19|18 or 19)[\s\S]{0,140}(right|capacity|ability) to contract/i,
                /(legal age|legally old enough)[\s\S]{0,100}contract in (your|my) own name/i,
                // Equinix (2026-07-26): "Do you meet the minimum age requirement for unrestricted
                // employment in the country for which you are applying?" -> Yes.
                /minimum age requirement/i,
                /(meet|satisfy)[\s\S]{0,20}minimum age/i
            ],
            // Never steal tenure/experience or notice-period questions that also say "N years".
            exclude: /years? of (experience|work experience|professional|industry|relevant)|how many years|experience (do you have|with)|notice period/i,
            choose: 'yes'
        },
        {
            // Equinix (2026-07-26): "Do you know anyone that currently works for <company>? … evaluate
            // if there will be any conflicts of interest …" The applicant has no known contacts at the
            // company -> No. (Distinct from relatives-at-company / personal-relationship phrasings.)
            topic: 'know-someone-at-company',
            patterns: [
                /do you know anyone (that|who)[\s\S]{0,30}(currently )?works? (for|at)/i,
                /know anyone[\s\S]{0,30}(works?|employed)[\s\S]{0,20}(for|at|with)/i
            ],
            choose: 'no'
        },
        // Prior/current employment or contracting with the TARGET company (or its named
        // affiliates/subsidiaries/dealers). Standing rule from the user: "previously employed" is
        // always No — the only real employers are J.P. Morgan (current) and Graphen (2021 intern).
        // Covers many phrasings: "previously been DIRECTLY employed with <co>", "received a paycheck
        // or W-2 directly from", "employed with an authorized dealer of <co>", "working as a
        // contractor for <co>". Not a visa/work-authorization question (those are handled above).
        {
            // Standard ADA/EEO screening: "Are you able to perform the essential functions of the job
            // for which you are applying, with or without reasonable accommodation?" -> Yes. This is
            // the job-capability question, NOT the CC-305 disability self-identification (which is a
            // separate Self Identify step with its own answer), so exclude that wording.
            topic: 'essential-functions',
            patterns: [
                /able to perform the essential functions/i,
                /perform the essential (job )?functions/i,
                /essential functions of the (job|position|role)/i,
                /with or without (a )?reasonable accommodation/i
            ],
            // Also never capture a VEVRAA veteran self-identification block: AVEVA's version ends
            // "…accommodations we could make that would enable you to perform the essential
            // functions of the job", which otherwise matches this entry and answers Yes to a
            // veteran-category dropdown that has no Yes option.
            exclude: /self-?identif|cc-?305|disability status|do you (have|consider yourself)[\s\S]{0,40}disabilit|vevraa|protected veteran/i,
            choose: 'yes'
        },
        {
            // CURRENT employment with the hiring company or its group ("Are you currently an employee
            // of a Hitachi Group company?"). Distinct from `prior-employment`, which covers the
            // "have you ever / previously" phrasings. The only current employer is J.P. Morgan
            // Chase, so this is always No.
            topic: 'current-employee-of-company',
            patterns: [
                /are you currently an employee of/i,
                /are you (currently )?employed (by|with|at)[\s\S]{0,60}group company/i,
                /current employee of (a|an|the)\b/i,
                /currently[\s\S]{0,30}employee of[\s\S]{0,40}(group|company|its (subsidiaries|affiliates))/i
            ],
            choose: 'no'
        },
        {
            // "Have you worked at a startup before?" (user, 2026-07-27, mirrored from
            // greenhouse.js) -> Yes. Ordered BEFORE prior-employment: that topic's broad "have you
            // (ever|previously) worked (at|for)" patterns would otherwise steal this question and
            // wrongly answer No (it is not asking about the TARGET company, just startups in
            // general).
            topic: 'startup-experience',
            patterns: [
                /worked (at|for) a startup/i,
                /startup experience/i,
                /have you (ever )?worked (at|for) a startup/i
            ],
            choose: 'yes'
        },
        {
            topic: 'prior-employment',
            patterns: [
                /previously been (directly )?employed/i,
                // Workday (2026-07-27): "Have you been previously employed with us?" swaps the
                // adverb order used by the older "previously been employed" pattern.
                /have you been[\s\S]{0,20}(previously|formerly) employed (with|by|at)\b/i,
                /were you (previously|formerly) employed (with|by|at)\b/i,
                /have you (ever |previously )?(been (directly )?employed|worked)\b/i,
                /received a paycheck or w-?2/i,
                /employed[\s\S]{0,40}authorized dealer/i,
                /authorized dealer of/i,
                /(previously|currently) (working|work) as a contractor/i,
                /working as a contractor for/i,
                // Fidelity (2026-07-25): "Have you ever accepted an offer to work at Fidelity in any
                // capacity (regular, intern, temp, consultant, third party contractor, etc.)?" -> No
                // (only real employers: J.P. Morgan, Graphen). Also "Do you currently, or have you
                // ever, worked for either PricewaterhouseCoopers (PwC) or Deloitte, or any of their
                // affiliates?" -> No.
                /accepted an offer to work (at|for|with)/i,
                /(do you currently|have you ever)[\s\S]{0,40}worked for/i,
                /worked for (either|both|any of)\b/i,
                // Bank of America (2026-07-25): "Are you currently an active contractor working at
                // Bank of America?" Applicant is not a BofA contractor -> No.
                /(currently )?an active contractor/i,
                /active contractor working (at|for)/i,
                // Hitachi (2026-07-25): "Are you a prior employee of a Hitachi Group company?" asked on
                // the My Information step. Applicant never worked at Hitachi -> No. (My Information's
                // answerOnPageChoiceQuestions applies this and corrects a wrong prefill.)
                /are you a (prior|former|current) employee/i,
                /(prior|former) employee of/i,
                // Capital One (2026-07-25): "Do you currently, or have you previously, worked at Capital
                // One or a company acquired by Capital One?" and "Do you currently work for, or have you
                // in the past two years worked for, Capital One's independent [auditor]?" -> No. The
                // comma after "previously" and "worked AT" (not "for") slipped past the earlier patterns.
                /have you (ever|previously)[\s\S]{0,20}worked (at|for)/i,
                /(do you currently|have you)[\s\S]{0,40}worked (at|for)[\s\S]{0,60}(capital one|independent)/i,
                /worked (at|for)[\s\S]{0,50}independent[\s\S]{0,25}(auditor|accounting)/i
            ],
            exclude: /authoriz(ed|ation) to work|right to work|how many years|years of professional experience/i,
            // Long-form options ("I have not previously been employed at <Company>") never start with
            // the word No (user, 2026-07-28); the never-worked option still wins first.
            optionCandidates: [
                /never (worked|been employed)/i,
                /^i have not (previously )?been employed/i,
                /have not (previously )?(been )?(employed|worked)/i,
                /^\s*no\b/i
            ],
            choose: 'no'
        },
        {
            topic: 'veteran-active-member',
            patterns: [
                /veteran or active member[\s\S]{0,60}(armed forces|military)/i,
                /active member of the united states armed forces/i
            ],
            optionMatch: /^\s*no,\s*i am not a veteran or active member\b/i,
            optionLabel: 'No, I am not a veteran or active member'
        },
        // Own U.S. military service (Section 4212 / Veterans self-ID phrased on the Questions step).
        // The "No" option is long ("No, I have never served in the U.S. Armed Forces…") — choose:'no'
        // matches it via /^no\b/. Exclude the spouse/partner variant, which is a separate question.
        {
            // "Have you SERVED in the military?" Yes/No question (Application Questions). Do NOT match
            // the Voluntary Disclosures "Please select your Veteran status" DROPDOWN — that is the
            // `veteran` disclosure entry (option like "I AM NOT A VETERAN"), not a Yes/No. The old
            // /veterans? status/ pattern stole that dropdown and failed to find a "No" option, leaving
            // it blank. `exclude` also guards against the dropdown phrasings.
            topic: 'military-service',
            patterns: [
                /do you currently or have you ever served/i,
                /served in the (u\.?s\.?|united states) (armed forces|military)/i,
                // Citi: "Are you serving, or have you ever served in the Armed Forces of the United
                // States of America (to include active duty, Reserves, or National Guard)?"
                /(are you (currently )?serving|have you ever served)[\s\S]{0,80}(armed forces|military|reserves|national guard)/i,
                /armed forces of the united states/i,
                /served[\s\S]{0,40}(armed forces|national guard|reserves)/i,
                // Visa asks about CURRENT membership rather than past service:
                // "Are you currently a member of the U.S. National Guard or Reserves?"
                /member of the[\s\S]{0,30}(national guard|reserves|armed forces)/i,
                /(currently|active)[\s\S]{0,40}(national guard|reserves)\b/i
            ],
            // Exclude only the SPOUSE question itself ("are you a … military spouse/domestic partner")
            // and the Voluntary Disclosures veteran DROPDOWN — NOT a preamble that merely mentions
            // "military spouses/domestic partners" (Bank of America's own-service question does exactly
            // that, and the old bare /spouse|domestic partner/ exclude wrongly blocked it).
            exclude: /veteran or active member|your spouse|are you a[\s\S]{0,40}(current or former )?(military )?(spouse|domestic partner)|(spouse|domestic partner)[\s\S]{0,40}(serv|military|armed forces)|select your veteran status|classify as a (protected )?veteran/i,
            choose: 'no'
        },
        // Spouse/domestic partner military service -> No.
        {
            topic: 'spouse-military-service',
            patterns: [
                /(spouse|domestic partner)[\s\S]{0,40}(served|military|armed forces)/i,
                /has your spouse[\s\S]{0,60}served/i,
                // Visa reverses the wording: "Are you a military spouse?"
                /\bmilitary spouse\b/i,
                /(spouse|partner) of a (service ?member|veteran)/i,
                // Bank of America (2026-07-25): "Are you a current or former military spouse or domestic
                // partner?" — here "military" precedes "spouse", so match that order too. -> No.
                /military spouse/i,
                /are you a[\s\S]{0,40}(current or former )?(military )?(spouse|domestic partner)/i
            ],
            choose: 'no'
        },
        // Relatives/family employed by the target company or its subsidiaries/affiliates -> No.
        {
            topic: 'relatives-at-company',
            patterns: [
                /do you have any relatives employed/i,
                /relatives employed by[\s\S]{0,40}(subsidiar|affiliate|company)/i,
                /(relative|family member)[\s\S]{0,30}employ/i,
                // Fidelity (2026-07-25): "Do you have family member(s) (defined as parents, children,
                // spouse, domestic partner, siblings, grandparents … stepfamilies) currently employed
                // at Fidelity?" — the parenthetical definition pushes "employed" ~150 chars out, so a
                // wider gap is needed. -> No.
                /(relative|family member)\(?s?\)?[\s\S]{0,240}(currently )?employ(ed)? (at|by|with)/i
            ],
            choose: 'no'
        },
        // Consent to use/share personal info for FUTURE job & career opportunities (marketing/talent
        // network). User rule: "...consent..." and "...future...job..." -> Yes.
        {
            topic: 'prior-application',
            patterns: [
                /have you (applied|submitted an application) (with|to)[\s\S]{0,50}previously/i,
                /have you previously applied (with|to|for)/i,
                /prior application (with|to)/i
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
            text: 'Sep 7, 2026',
            date: '2026-09-07'
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
            topic: 'salary-range-expectation',
            patterns: [
                /realistic base gross annual salary expectation/i,
                /salary expectation[\s\S]{0,40}(range|next role)/i
            ],
            optionMatch: /^\s*\$?160,?000\s*-\s*\$?180,?000\s*$/i,
            optionLabel: '$160,000 - $180,000'
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
            // Base salary expectation (user, 2026-07-25): auto-fill on EVERY tenant, required or
            // optional. This narrows the standing never-guess rule for salary only — work auth,
            // visa, sponsorship and employment history are still never guessed. The figure lives in
            // the SALARY_EXPECTATION constant (single source of truth), not inline here.
            // `exclude` keeps this off two look-alike questions that must NOT get an annual figure:
            // CURRENT/previous salary (a different question entirely) and HOURLY rate fields.
            topic: 'salary-expectation',
            patterns: [
                /base salary expectation/i,
                /salary expectations?\b/i,
                /(expected|desired|target|requested) (base )?(salary|compensation)/i,
                /salary requirements?\b/i,
                /compensation expectations?\b/i,
                /what (salary|compensation) (do|are) you (expect|seeking|looking for)/i
            ],
            exclude: /current (salary|compensation|pay|rate|wage)|present (salary|compensation)|(last|previous) (salary|compensation|pay)|salary history|\bhourly\b|per hour|per month|\bmonthly\b|hour(ly)? rate|\/\s*hr\b|\brate per\b/i,
            text: SALARY_EXPECTATION
        },
        {
            topic: 'privacy-notice-acknowledgement',
            patterns: [
                /privacy (notice|policy|statement|act)[\s\S]{0,40}acknowledge?(ment)?/i,
                /(acknowledge|agree to|accept|consent to)[\s\S]{0,60}privacy (notice|policy|statement)/i,
                /(have you )?(read|reviewed|understood)[\s\S]{0,60}privacy (policy|notice|statement)/i
            ],
            optionMatch: /^\s*(acknowledge|i acknowledge|yes|i agree|agree|i accept|accept|i consent)\b/i,
            optionLabel: 'Yes / Acknowledge'
        },
        {
            topic: 'acknowledgement-generic',
            patterns: [/\backnowledg(e|es|ed|ing|ement|ment)\b/i],
            optionMatch: /^\s*(yes|acknowledge|i acknowledge|i agree|agree|i accept|accept)\b/i,
            optionLabel: 'Yes / Acknowledge'
        },
        {
            // Visa: "I agree that Visa may reach out to me via SMS regarding my application and
            // candidate experience..." The control is NOT Yes/No — the options are Opt-In / Opt-Out —
            // so this needs an optionMatch. User decision (2026-07-25): SMS/text contact is
            // **Opt-Out**. This is an explicit exception to the general "...consent... -> yes" rule,
            // which still applies to the other consent topics.
            topic: 'consent-sms-contact',
            patterns: [
                /reach out to me via sms/i,
                /via (sms|text messages?)\b/i,
                /message and data rates may apply/i,
                /consent[\s\S]{0,60}(sms|text message)/i,
                /text message updates[\s\S]{0,80}job application/i,
                /consent to receiving text messages/i,
                // Morgan Stanley: "Do you consent to receive follow up communication via SMS
                // WhatsApp from Talent Acquisition regarding job opportunities at <company>?" -> No.
                /\bsms\b[\s\S]{0,20}whatsapp/i,
                /follow up communication via/i,
                /\bwhatsapp\b/i
            ],
            // ONE topic, two control vocabularies: Visa renders Opt-In/Opt-Out, Morgan Stanley
            // renders plain Yes/No. The user's preference is the same either way — no SMS contact —
            // so the matcher accepts whichever "decline" option the tenant offers. Anchored at the
            // option start so "No" cannot hit "None of the above" or "Not interested".
            optionMatch: /^\s*(opt[\s-]?out|no)\b/i,
            optionLabel: 'No / Opt-Out'
        },
        {
            // Visa: "Visa may use automated tools such as AI to support review of your application
            // ... you can opt-out. Opting out will not impact your eligibility." Options are
            // Opt-In / Opt-Out. Opting IN keeps the application eligible for role matching and the
            // tenant states neither choice affects eligibility, so Opt-In per the consent rule.
            topic: 'consent-ai-screening',
            patterns: [
                /automated tools such as ai/i,
                /(\bai\b|automated tools?)[\s\S]{0,90}(review|process)[\s\S]{0,50}your application/i,
                /prefer not to have your application processed/i
            ],
            optionMatch: /^\s*opt[\s-]?in\b/i,
            optionLabel: 'Opt-In'
        },
        {
            // "Do you agree to allow Column to contact you about job opportunities for up to 2
            // years? (Recruiting Privacy Policy)" (user, 2026-07-27, mirrored from greenhouse.js) —
            // the company name and duration are incidental; match the shape: agree/consent to being
            // contacted about future job opportunities. Some tenants render this as "I agree" rather
            // than plain "Yes", so `optionMatch` names both.
            topic: 'consent-future-opportunities',
            patterns: [
                /do you consent to the use of your personal information/i,
                /consent[\s\S]{0,120}(future|other)[\s\S]{0,20}(job|career|employment)[\s\S]{0,20}opportunit/i,
                /(future|other)[\s\S]{0,20}(job|career)[\s\S]{0,20}opportunit[\s\S]{0,160}(consent|sharing|receive)/i,
                /sharing of your personal information[\s\S]{0,80}(compan|affiliat)/i,
                // "Regarding future positions at <company>, please select one of the following" — the
                // Yes option reads "Yes, I would like to receive communications … future openings".
                /regarding future positions[\s\S]{0,80}(select|choose) one/i,
                /future (positions|openings)[\s\S]{0,80}(communications|contact|receive)/i,
                /receive communications about[\s\S]{0,60}(future|openings)/i,
                /(agree|consent)[\s\S]{0,100}(contact|reach out to) (you|me)[\s\S]{0,100}(job|career)[\s\S]{0,20}opportunit/i,
                /(contact|reach out to) (you|me)[\s\S]{0,100}(job|career)[\s\S]{0,20}opportunit[\s\S]{0,80}(agree|consent)/i,
                /recruiting privacy policy/i
            ],
            choose: 'yes',
            optionMatch: /^\s*(i agree|yes)\b/i,
            optionLabel: 'I agree'
        },
        // ── Fidelity (myworkdaysite.com) Application Questions, taught from a live page (2026-07-25). ──
        {
            // "Are you interested in and able to work at the location(s) listed on this opening?" The
            // applicant is open to relocation (nationwide) -> Yes.
            topic: 'location-interest',
            patterns: [
                /interested in and able to work at the location/i,
                /able to work at the location\(s\)/i,
                /work at the location\(s\) listed/i,
                /(interested|able|willing)[\s\S]{0,40}work at the location/i
            ],
            choose: 'yes'
        },
        {
            // "Do you have any agreements with current or former employers that could restrict you in
            // any way from working at Fidelity …?" (non-compete / restrictive covenant). The applicant
            // has no such restrictions -> No.
            topic: 'restrictive-agreements',
            patterns: [
                /agreements with[\s\S]{0,40}(current or former|any)[\s\S]{0,20}employers?/i,
                /agreement[\s\S]{0,100}restrict you/i,
                /(restrict|prevent)[\s\S]{0,80}working (at|for)/i,
                /non-?compete|non-?competition|restrictive covenant/i,
                // Relativity/kcura (2026-07-27) renders this as a REQUIRED FREE-TEXT box:
                // "Are you subject to any restrictive covenant or non-competition agreement that may
                // affect your ability to work for Relativity?"
                /subject to any[\s\S]{0,60}(restrictive covenant|non-?compet)/i,
                /(non-?solicit|garden leave|notice restriction)[\s\S]{0,60}agreement/i,
                // "…subject to any agreement with a former employer/third party (such as a
                // non-solicitation or non-compete agreement)…" (user, 2026-07-28).
                /non-?solicitation/i,
                /subject to any agreement/i,
                /agreement with a (former employer|third party)/i
                        ],
            choose: 'no',
            // Same answer either way: a dropdown gets "No", a textarea gets "No." (user, 2026-07-27).
            text: 'No.'
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
                /which ai (tools|assistants)[\s\S]{0,40}(do you )?use/i
            ],
            text: "I use Claude, Codex, and GitHub Copilot extensively in both my professional and personal work. At work, I use Copilot's agent mode in VS Code to refine business requirements, turn them into stories and specifications, and generate implementation code. One especially helpful use is having AI agents operate integration tests as if I were testing the workflows myself, which saves me substantial time while still letting me review the results. Outside work, I use Claude Code and Codex to build and enhance personal projects, automate my own workflows, study topics in depth, and develop career, exercise, and nutrition plans that I keep feeding updates into so the model can analyse my progress and propose the next actions."
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
            // "Tell us about, or post links to some cool things you've built!" (user, 2026-07-27,
            // mirrored from greenhouse.js) — distinct from recent-build-essay (a single recent
            // project, the AI financial-validation system) and ordered AFTER it so a "...built
            // recently"-qualified question still lands there; this broader "cool things you've
            // built" prompt gets the Chrome-extension pitch. User-supplied content, lightly polished
            // for grammar; no facts invented.
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
            // Fidelity App Questions 2/2 (2026-07-25): five required FREE-TEXT questions of the form
            // "Do you possess [expertise/degree+experience] … If yes, please describe (in detail) your
            // specific experience in this domain*". No existing bank answer covers "describe your
            // experience", so this is a NEW question. The applicant DOES possess the experience, so the
            // answer starts "Yes"; `text` fills the textarea with "Yes" as a starter (user's standing
            // choice: "Answer Yes, I'll write text") and the user expands each with job-specific detail.
            topic: 'possess-qualification-describe',
            patterns: [
                /do you possess (a bachelor|a master|demonstrated expertise|experience)/i,
                /please describe \(in detail\) your specific experience/i,
                /describe[\s\S]{0,20}your specific experience in this domain/i
            ],
            text: 'Yes'
        },
        {
            // Guidewire (2026-07-25): "Explain why you believe you are the ideal candidate for this
            // position*" — a recurring free-text pitch / mini cover letter. Register once with a
            // truthful, reusable summary grounded in the applicant's real experience (J.P. Morgan
            // full-stack SWE, MS CS). No illegal chars (< > [ ] " { } \ are rejected by Workday).
            // The user can edit the wording per posting before Save and Continue.
            topic: 'ideal-candidate-pitch',
            patterns: [
                /why are you a (good|strong|great|right) fit for/i,
                /what makes you a (good|strong|great|right) fit/i,
                /why[\s\S]{0,40}(ideal|best|strong|right|good) candidate/i,
                /ideal candidate for this (position|role|job)/i,
                /why (do|should)[\s\S]{0,40}(we hire you|you are the|you're the|consider you)/i,
                /(explain|describe|tell us)[\s\S]{0,50}(ideal candidate|why you are|best fit for)/i,
                /why are you interested in working (for|at|with)/i,
                /why (do you want|would you like) to (work|join)/i
            ],
            text: "I’m a strong fit for a Software Engineer role because over 5+ years I’ve moved beyond pure implementation into end-to-end ownership. In my current role, I design and build backend services, make system design and data modeling decisions, and deliver production systems that need to be reliable, scalable, and maintainable. I’ve worked across APIs, data pipelines, cloud infrastructure, observability, and release operations, which means I understand not just how to code a feature, but how to ship and operate it well. I also enjoy leading through execution: driving technical decisions, improving engineering quality, and taking responsibility for outcomes in fast-moving environments."
        },
        {
            // Omnibus conflict-of-interest disclosure (user, 2026-07-27; Robinhood shape, mirrored
            // from greenhouse.js): personal/familial relationships + outside business activities +
            // investments (public or private company) + intellectual-property ownership the
            // applicant wishes to retain/develop. The company name is incidental; match the SHAPE
            // (co-occurrence of these disclosure categories), not the exact wording, so this stays
            // distinct from the narrower single-topic questions (relatives-at-company,
            // restrictive-agreements, outside-employment) that only ask one thing.
            topic: 'conflict-of-interest',
            patterns: [
                /^conflict of interest/i,
                /conflict of interest[\s\S]{0,100}(indicate|yes\s*\/\s*no|involved in any activity)/i,
                /if you are involved in any activity related to/i,
                /(personal|familial)[\s\S]{0,40}relationships?[\s\S]{0,400}outside business activit/i,
                /outside business activit(y|ies)[\s\S]{0,400}(intellectual property|investment)/i,
                /(personal|familial)[\s\S]{0,40}relationships?[\s\S]{0,400}intellectual property/i,
                /intellectual property (ownership|rights)[\s\S]{0,100}(patents?|trademarks?|copyrights?)/i
            ],
            choose: 'no'
        },
        {
            topic: 'acknowledgment-participate',
            patterns: [
                /i acknowledge that i will personally participate/i,
                /participate in all interviews[\s\S]{0,80}without assistance from/i,
                /^acknowledgment\b/i
            ],
            choose: 'yes'
        },
        {
            topic: 'accommodation-request',
            patterns: [
                /do you need a reasonable accommodation/i,
                /(need|require)[\s\S]{0,20}reasonable accommodation (due to|for|because|to (apply|interview))/i
            ],
            choose: 'no'
        },
        // ── Bank of America (GHR tenant) Application Questions, taught from a live page (2026-07-25). ──
        {
            // "Were you referred to Bank of America for employment opportunities?" Applicant applied
            // directly (no referral) -> No. The follow-up "provide the name of the referrer" is an
            // optional TEXT field left blank (excluded so this Yes/No entry never targets it).
            topic: 'referral-status',
            patterns: [
                /were you referred to[\s\S]{0,40}for employment/i,
                /were you referred (to|by)/i,
                /have you been referred/i
            ],
            exclude: /provide the name of the referrer/i,
            choose: 'no'
        },
        {
            // "Do you reside in one of the five boroughs of New York City …?" Applicant resides in
            // Plano, TX -> No.
            topic: 'nyc-residence',
            patterns: [
                /reside in one of the five boroughs/i,
                /five boroughs of new york/i
            ],
            choose: 'no'
        },
        {
            // "Have you ever attended a community college or taken classes/certifications at a community
            // college?" Applicant's education is SUNY Buffalo (MS) and a Beijing university (BA) — not a
            // community college -> No.
            topic: 'community-college',
            patterns: [
                /attended a community college/i,
                /(classes|certifications) at a community college/i,
                /community college/i
            ],
            choose: 'no'
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
            // Bank of America / GHR free text: "List the top 3 programming languages / platforms that
            // you are most proficient in as well as your length of experience with each". Derived
            // from [SKILLS] plus 4+ years of professional experience since Apr 2022.
            topic: 'top-programming-languages',
            patterns: [
                /top\s*\d+\s*programming languages/i,
                /programming languages?\s*\/?\s*platforms/i,
                /(languages|technologies|platforms)[\s\S]{0,80}most proficient/i,
                /most proficient in[\s\S]{0,80}length of experience/i
            ],
            text: 'Java - 4 years; Python - 4 years; SQL - 4 years'
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
            topic: 'llm-experience',
            patterns: [
                /experience (with|using)[\s\S]{0,20}(llms?|large language models?)/i,
                /(built|created|worked on)[\s\S]{0,40}(personal )?project[\s\S]{0,30}(using|with)[\s\S]{0,20}(llms?|large language models?|generative ai)/i,
                /have you (used|worked with)[\s\S]{0,30}(llms?|large language models?|generative ai)/i
            ],
            choose: 'yes'
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
            // "What interested you about this role?" / "Why do you want to work here?" — user's
            // supplied wording (2026-07-27), mirrored from greenhouse.js so every shared task
            // (T2/T3/T5/T6) answers it the same way. Role/company/team wording is interchangeable.
            topic: 'why-company-essay',
            patterns: [
                /what interest(ed|s) you (about|in)/i,
                /what interest(ed|s) you\b/i,
                /(what|why)[\s\S]{0,30}interested in (this|the|our)\s*(role|position|job|opportunity|team|company)/i,
                /what about[\s\S]{0,60}(is )?(exciting|excites)( to)? you/i,
                /why (are you interested|do you want to (work|join))/i,
                /why (this|our) company/i,
                /what (draws|attracts) you to/i,
                /what (made|makes) you (want to )?apply/i
            ],
            text: 'I am interested in your company because I thrive in new environments where engineers can independently turn ideas into working products—from design and implementation through deployment and customer delivery. My experience across full-stack development, backend services, cloud infrastructure, data platforms, and AI agents allows me to contribute across the product rather than within a limited scope.'
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
            topic: 'minimum-three-years-experience',
            patterns: [
                /minimum of 3 years of experience[\s\S]{0,30}not including internships/i,
                /at least 3 years of (professional )?experience[\s\S]{0,30}(excluding|not including) internships/i
            ],
            choose: 'yes'
        },
        {
            // STANDING RULE (user, 2026-07-27, mirrored from greenhouse.js): "do you have N (or
            // more) years of ... experience ...?" is ALWAYS Yes, whatever stack the question
            // lists. Ordered after the specific years-band pickers; `exclude` keeps it away from
            // "how many years" questions, which need a number or a band rather than Yes.
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
            // "What is your highest completed level of education?" asked as an application
            // QUESTION (user, 2026-07-27, mirrored from greenhouse.js) - distinct from the
            // education step's own Degree picker, which fillEducationEntry() handles.
            topic: 'highest-education-level',
            patterns: [
                /highest (completed )?level of education/i,
                /highest education( level)?/i,
                /level of education (you have )?(completed|obtained)/i,
                /highest (level of )?degree/i
            ],
            optionCandidates: [/^master['’]?s( degree)?$/i, /^master/i],
            optionLabel: 'Master’s Degree',
            text: "Master's Degree"
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
            // "How many years of relevant work experience do you have?" — a BANDED dropdown whose
            // band wording differs per tenant. User's answer (2026-07-25): the band that STARTS AT 5
            // ("5 to 7 Years of Experience" on Bank of America / GHR). Factual note: professional
            // experience began Apr 2022; the user selected this band knowingly.
            //
            // `optionMatch` encodes "the band starts at 5" rather than any one tenant's wording:
            // `\D*5\b` anchored at the start means 5 must be the FIRST number in the option, so
            // "5 to 7", "5-7", "5+ years", "5 to 10" and "More than 5" all match, while bands that
            // merely END at 5 ("1 to 5", "0-5") are rejected because their first number isn't 5, and
            // the negative lookahead additionally rejects "Up to 5" / "Less than 5" style ceilings.
            // Bands below (No Experience, Up to 2, 2 to 4) and above (More than 8, 10+) never match.
            topic: 'years-of-relevant-experience',
            patterns: [
                /how many years of[\s\S]{0,40}experience/i,
                /(total\s+)?years of (relevant|professional|industry|work|overall)[\s\S]{0,30}experience/i,
                /years of experience do you have/i,
                /how much (relevant\s+)?(work\s+)?experience do you have/i
            ],
            // Never steal the "top 3 programming languages … length of experience with each" free
            // text, or a per-technology "years of experience with X" question.
            exclude: /programming languages|platforms|most proficient|with each|for this position/i,
            // 5 years of experience, so the answer is the band that CONTAINS 5 (user, 2026-07-27):
                        // an explicit 5/5+ band first, then a band whose low <= 5 and high >= 6 ("4 to 7
                        // years"), then an open-ended 4+/5+, and only as a last resort a band ending at 5.
                        optionCandidates: [
                            /^(?!.*\b(?:up\s+to|under|less\s+than|fewer\s+than|below|at\s+most)\b)\D*5\b/i,
                            /\b[1-5]\s*(?:to|-|–|—)\s*(?:[6-9]|1\d)\b/i,
                            /\b[4-5]\s*\+/i,
                            /\b[1-4]\s*(?:to|-|–|—)\s*5\b/i
                        ],
                        optionLabel: 'the band containing 5 years',            optionLabel: '5 to 7 Years of Experience',
            // Free-text/number version of the same question (user, 2026-07-27).
            text: '5'
        },
        {
            // "Which level best reflects your experience and the role you are looking to step
            // into?" (user, 2026-07-27, mirrored from greenhouse.js) — options: Mid-Level / Senior /
            // Lead. The user did not state a choice; Senior is the reasoned best fit for the
            // applicant's real background (5+ years, end-to-end ownership per the ideal-candidate-
            // pitch essay) — solidly beyond Mid-Level's "foundational experience... looking to
            // grow" framing, but short of Lead's "drive strategy, mentor others" framing, which the
            // applicant's experience does not yet support. Ordered precedence: an option that
            // STARTS WITH "senior" first, then any option merely containing "senior", then
            // Mid-Level as a fallback if Senior is not offered at all — NEVER Lead.
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
            // "…reside within 50 miles of the hub advertised on the job posting… will you be
            // located within 50 miles of one of our hubs?" with a city list plus two N/A options
            // (user, 2026-07-27, mirrored from greenhouse.js). Naming a hub city would be false —
            // take the "not in a hub location BUT able to relocate" option. Ordered BEFORE the
            // office/relocation topics, whose broader patterns would otherwise steal it. Note the
            // rejected option contains the substring "able to relocate", hence the anchors.
            topic: 'hub-location-radius',
            patterns: [
                /within \d+ miles of (one of )?(our|the) hub/i,
                /reside within \d+ miles/i,
                /(at the time of hire|will you be) located within \d+ miles/i,
                /within \d+ miles of the (hub|office) (advertised|listed)/i,
                // "Please select which <Company> hub you are currently based out of:" (user,
                // 2026-07-27) - a hub list with relocate / won't-relocate options at the end.
                /which[\s\S]{0,30}hub[\s\S]{0,40}(are you )?(currently )?based (out )?of/i,
                /which hub[\s\S]{0,40}(you|are you)/i
                        ],
            optionCandidates: [
                /not in (one of )?(the )?hub locations?[\s\S]{0,30}\bbut\b[\s\S]{0,20}\bam able to relocate\b/i,
                /\bbut\b[\s\S]{0,20}\bam able to relocate\b/i,
                /(?<!un)able to relocate/i,
                // Both the WILLING and the NOT-WILLING option contain "willing to relocate", so
                // the affirmative candidates are anchored at the start of the option text.
                /^\s*willing to relocate/i,
                /^\s*(yes|i am|i'm)[\s\S]{0,20}willing to relocate/i
                        ],
            optionLabel: 'N/A - I am not in one of the hub locations but I AM able to relocate',
            text: 'I am not currently in one of the hub locations, but I am able to relocate.'
        },
        {
            // "In one sentence, what are you most proud of professionally?" (user, 2026-07-27,
            // mirrored from greenhouse.js) — the AI-agent project, in one sentence as asked.
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
            // Harvey screenshots (user, 2026-07-27, mirrored from greenhouse.js): three related
            // office/hybrid shapes share ONE ordered optionCandidates chain, governed by a standing
            // rule — Eve must NEVER claim the applicant already lives in/is based in the posted
            // office location (the applicant is in Dallas, TX and is willing to relocate anywhere).
            // So among any office/hybrid option list: (1) an option that says willing/open to
            // RELOCATE always wins first; (2) an affirmative that only claims ABILITY to attend,
            // with NO residency claim, wins next; (3) a plain "Yes"/"I can/agree" is the last-resort
            // fallback for ordinary Yes/No controls. NEVER an option asserting the applicant is
            // already based in/lives in the posted location, a remote-only option, "I may need
            // flexibility", or "Other".
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
                // "Do you live within commuting distance to one of our hubs …?" (user, 2026-07-27,
                // mirrored from greenhouse.js) — the hub list is incidental; match the shape.
                /within commuting distance/i,
                /commuting distance (to|of|from)/i,
                /(live|located|based)[\s\S]{0,40}(near|close to|within)[\s\S]{0,40}(hub|office|location)/i,
                /do you live[\s\S]{0,60}(hub|office)s?\b/i,
                // Ashby/Notion "Anchor Days" phrasing (screenshot 2026-07-27), mirrored from
                // greenhouse.js — an office-attendance commitment gets the standing affirmative.
                /(commit to |able to )?work(ing)? from one of our offices/i,
                /anchor days/i,
                /able to work from our [\s\S]{0,30}office/i,
                // "Which of Harvey's offices would you be able to work from?" (#11) — the company
                // name is incidental; match the shape (which office(s) + able to work from).
                /which[\s\S]{0,40}offices?[\s\S]{0,40}(would|will) you[\s\S]{0,30}work from/i,
                // "...tied to the office location listed in the job posting...hybrid work model...
                // office 3 days per week...currently based in the listed location..." (#12).
                /tied to the office location/i,
                /hybrid work model[\s\S]{0,100}office[\s\S]{0,30}\d+[\s-]?days?/i,
                /currently based in the listed location[\s\S]{0,60}(able to )?work in person/i,
                // "…join us in the office every Tuesday and Wednesday…" (user, 2026-07-27):
                // named weekdays instead of a day count.
                /join (us )?in the office/i,
                /in-?office (time|days?)/i,
                /in the office every [a-z]+day/i,
                // "Are you willing to work from the required location?" (user, 2026-07-27) -
                // the posting's own location, whatever it is; the standing affirmative applies.
                /willing to work (from|at|in) the (required|specified|posted|listed|advertised) location/i,
                /work from the (required|specified|posted|listed) location/i,
                // "Are you able to meet the location requirements of the position as stated in
                // the job description?" and the conditional "IF you are based in <cities>, are
                // you able to commute to the office N days per week?" (user, 2026-07-27) - both
                // are ability questions, so the standing affirmative applies.
                /meet the location requirements/i,
                /location requirements? of the (position|role|job)/i,
                /if you are (based|located) in[\s\S]{0,80}(able to|can you)[\s\S]{0,40}(commute|work|come)/i,
                /able to commute to the office/i,
                // Combined location+schedule question (user, 2026-07-28), mirrored from greenhouse.js.
                /based onsite at[sS]{0,80}office/i,
                /d+s*[-–]s*d+ days per week/i,
                /open to (this|the) schedule/i,
                // STANDING RULE (user, 2026-07-28): any "N days a week" question is an attendance
                // commitment and is always answered YES, mirrored from greenhouse.js.
                /\d+\s*(\+|or more)?\s*days?\s*(a|per)\s*week/i,
                /\d+\s*x'?s?\s*(a|per)\s*week/i,
                // "2-3x a week", "3 times a week", "twice a week" (user, 2026-07-28).
                /\d+\s*[-–]\s*\d+\s*x'?s?\s*(a|per)\s*week/i,
                /\d+\s*times?\s*(a|per)\s*week/i,
                /(once|twice|thrice)\s*(a|per)\s*week/i
                        ],
            // A "which office do you PREFER / preferred work location" question is a location CHOICE,
            // not an ability question (user, 2026-07-28) - relocation-locations-all owns it.
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
            // "Would you consider relocating, either now or in the future?" Applicant is open to
            // relocation (nationwide) -> Yes.
            //
            // Bank of America / GHR (2026-07-25) offers three CHECKBOX options rather than Yes/No:
            // "No, I would not consider relocating" / "Yes, at the company's expense" / "Yes, at my
            // own expense under the right circumstances". User's answer is the company's-expense
            // one. Two options start with "Yes", so a bare /^yes\b/ would pick whichever renders
            // first — `optionMatch` names the intended option instead. The `^yes$` alternative keeps
            // plain Yes/No tenants working, and matching "own expense" is impossible either way.
            topic: 'relocation-consider',
            patterns: [
                /would you consider relocating/i,
                /(willing|able|open) to relocat/i,
                /consider relocating/i,
                /consider relocat(ing|ion)[\s\S]{0,40}(now or in the future|in the future)/i,
                /relocat(e|ion)[\s\S]{0,40}(company'?s? expense|own expense)/i,
                // "Are you willing to move to SF and work in person with us?" (user, 2026-07-27,
                // mirrored from greenhouse.js) — the city and company wording are incidental; match
                // the shape: willing/able/open to MOVE (not just "relocate"), and/or working in
                // person with a team.
                /(willing|able|open) to move to/i,
                /move to[\s\S]{0,60}work in person/i,
                /work in person with (us\b|our\b|the team)/i,
                // "Are you able to work in-person in San Francisco? (Presidio)" (user, 2026-07-27,
                // mirrored from greenhouse.js) — the office/city name is incidental; match the shape
                // without requiring the "with us/our team" qualifier above.
                /(able|willing|open|available)\b[\s\S]{0,30}work in-?person\b/i,
                // "Will you require relocation?" (user, 2026-07-27, mirrored from greenhouse.js) —
                // the direct phrasing, distinct from "willing/able/open to relocate" above.
                /(will you|do you)[\s\S]{0,20}require relocation/i,
                /(need|require)[\s\S]{0,20}relocation\b/i,
                // "This hybrid role involves being in San Carlos, CA, 3 days per week. Please mark
                // Yes that you read, understand, and are able to do this." (user, 2026-07-27,
                // mirrored from greenhouse.js) — the city is incidental; match the shape: a hybrid
                // ROLE (not "setting"/"office") named with a weekly cadence, with no "office" word
                // required (see office-attendance-requirement for the office-worded variants).
                /hybrid role[\s\S]{0,200}\d+\s*days?\s*(a|per)\s*week/i
            ],
            choose: 'yes',
            // Apostrophe class covers the typographic ’ Workday often renders — a plain '?' here
            // would silently fail to match "company’s expense" and the pick would be skipped.
            optionMatch: /(company|employer)['‘’ʼ`´]?s?\s+expense|^\s*yes\s*$/i,
            optionLabel: "Yes, at the company's expense"
        },
        // ── Capital One (wd12) Application Questions, taught from a live page (2026-07-25). ──
        {
            // "Do you meet all of the Basic Qualifications for this role as specified in the job
            // description?" The applicant applied and meets them -> Yes.
            topic: 'basic-qualifications',
            patterns: [
                /meet all of the basic qualifications/i,
                /do you meet[\s\S]{0,30}(basic |minimum )?qualifications/i,
                /meet the (basic|minimum) (qualifications|requirements)/i
            ],
            choose: 'yes'
        },
        {
            // "Do you have a second job, outside business, or other employment that you will continue
            // or that …?" (outside/secondary employment conflict). The applicant has none -> No.
            topic: 'outside-employment',
            patterns: [
                /second job, outside business/i,
                /(second job|outside business|outside employment)/i,
                /other employment that you (will|would) continue/i
            ],
            choose: 'no'
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
        }
    ];
    // Voluntary Disclosures / Self Identify (EEO demographic dropdowns). `patterns` match the
    // question; `optionMatch` matches the desired option as a SUBSTRING so the stored answer can be
    // part of a longer option string ("Asian" -> "Asian (United States of America)", "not a veteran"
    // -> "I am not a veteran"). Users add phrasings via workdaySavedAnswers.voluntaryDisclosures.
    const DEFAULT_VOLUNTARY_DISCLOSURES = [
        // "What is your gender identity?" (user, 2026-07-27, mirrored from greenhouse.js) widened the
        // pattern beyond the "how would you describe…"/"mark all that apply" checklist phrasing.
        // optionCandidates prefers "Cisgender man" when offered, else the original "Man" match.
        { topic: 'gender-identity', patterns: [/how would you describe your gender identity/i, /gender identity[\s\S]{0,40}mark all that apply/i, /what is your gender identity/i, /\bgender identity\b/i], optionCandidates: [/cisgender man/i, /^\s*man\s*$/i, /^\s*male\s*$/i, /^\s*cisgender\s*$/i], optionMatch: /^\s*man\s*$/i, label: 'Cisgender man' },
        { topic: 'racial-ethnic-background', patterns: [/how would you describe your racial\/?ethnic background/i, /racial or ethnic background[\s\S]{0,40}mark all that apply/i], optionMatch: /^\s*east[\s-]?asian\s*$/i, label: 'East Asian' },
        { topic: 'sexual-orientation', patterns: [/how would you describe your sexual orientation/i, /\bsexual orientation\b/i], optionMatch: /^\s*heterosexual\s*$/i, label: 'Heterosexual' },
        { topic: 'transgender', patterns: [/do you identify as transgender/i, /\btransgender\b/i], optionMatch: /^\s*no\b/i, label: 'No' },
        // "Do you identify as part of the LGBTQ+ community?" (user, 2026-07-27, mirrored from
        // greenhouse.js) — a separate question from transgender/sexual-orientation (broader
        // community-membership scope, not a specific identity/orientation picker).
        { topic: 'lgbtq-identity', patterns: [/lgbtq/i, /identify as (part of )?(the )?lgbtq/i, /part of the lgbtq\+? community/i], optionMatch: /^\s*no\b/i, label: 'No' },
        { topic: 'disability-major-life', patterns: [/disability or chronic condition[\s\S]{0,180}substantially limits/i, /substantially limits[\s\S]{0,100}major life activities/i], optionMatch: /^\s*no\b/i, label: 'No' },
        { topic: 'veteran-active-member', patterns: [/veteran or active member[\s\S]{0,60}(armed forces|military)/i, /active member of the united states armed forces/i], optionMatch: /^\s*no,\s*i am not a veteran or active member\b/i, label: 'No, I am not a veteran or active member' },
        { topic: 'gender', patterns: [/what is your gender/i, /select your gender/i, /\bgender\b/i, /^i identify (my gender )?as\b/i, /identify my gender/i], optionCandidates: [/cisgender man/i, /(^|[^a-z])(male|man)([^a-z]|$)/i, /^\s*cisgender\s*$/i], optionMatch: /(^|[^a-z])(male|man)([^a-z]|$)/i, label: 'Male' },
        // Race/ethnicity. Flat lists just offer "Asian" / "Asian (United States of America)", but
        // granular ones (Visa) split Asian into subgroups plus an "Asian - Not Listed" catch-all.
        // The applicant is a Chinese national, so prefer the specific subgroup where offered and use
        // "Not Listed" only as a last resort — `optionCandidates` is tried in order, each as its own
        // pass over the options (same precedence idea as degreeSpec / Field of Study).
        // Guards: the Chinese pattern requires a word boundary so it cannot hit "Chinese Taipei",
        // and every candidate requires the option to be an Asian/Chinese race option, so a stray
        // "Not Latinx or Hispanic" qualifier inside a label can never cause a mis-pick.
        {
            topic: 'race-ethnicity',
            // AVEVA renders race as a "Please Select All That Apply" CHECKBOX group whose block text
            // contains neither "race" nor "ethnicity" — only the category labels, which are full of
            // "Hispanic or Latino", so `hispanic-latino` was stealing it. Match the unmistakable
            // category names too. race-ethnicity is ordered BEFORE hispanic-latino, so the standalone
            // "Hispanic or Latino" question still reaches its own entry.
            patterns: [
                /race\s*\/?\s*ethnicity/i, /\brace\b/i, /ethnicity/i,
                /american indian or alaska native/i,
                /native hawaiian or other pacific islander/i,
                /two or more races/i,
                /black or african american/i,
            ],
            exclude: /nationality|citizen/i,
            optionMatch: /\basian\b/i,
            optionCandidates: [
                /(^|[^a-z])chinese(?!\s+taipei)\b/i,
                /\beast[\s-]?asian\b/i,
                /\basian\b(?![\s\S]*not listed)/i,
                /\basian\b/i
            ],
            label: 'Asian'
        },
        { topic: 'hispanic-latino', patterns: [/hispanic/i, /latino/i], optionMatch: /^\s*no\b/i, label: 'No' },
        // "I am not a veteran" anywhere is safe. Some tenants (Disney) instead offer "I am not a
        // PROTECTED veteran" as the not-a-veteran choice — match that too, but ONLY anchored at the
        // start, so we never hit the trap option "I am a Veteran, just not a protected veteran" (which
        // starts "I am a veteran…") or "I identify as … veteran" — selecting those wrongly declares
        // veteran status.
        // Anchored at the START of the option so it can only ever pick a "not a veteran" choice.
        // Covers "I AM NOT A VETERAN" (T-Mobile), "I am not a protected veteran" (Disney) and the
        // bare "Not A Veteran" (Bank of America / GHR). The anchor is what keeps it away from the
        // trap options that DECLARE veteran status — "Non-Protected Veteran", "Disabled Veteran",
        // "Recently Separated Veteran", "I am a Veteran, just not a protected veteran" — and away
        // from "I Do Not Wish To Self-Identify".
        // Some tenants label this only as "Military Status" and put "veteran" in the options.
        // "What is your military status?" (user, 2026-07-27) already reaches this topic via the
        // existing /military status/i pattern. optionCandidates upgrades the pick to prefer "never
        // served" wording, falling back to the original "not a veteran" match.
        {
            topic: 'veteran',
            patterns: [/veteran/i, /military status/i, /(please\s+)?select your military status/i],
            optionCandidates: [
                /never served/i,
                /have not served/i,
                /no military service/i,
                /^\s*(i\s+am\s+)?not\s+a\s+(protected\s+)?veteran\b/i
            ],
            optionMatch: /^\s*(i\s+am\s+)?not\s+a\s+(protected\s+)?veteran\b/i,
            label: 'I have never served in the military'
        },
        // International / UK demographic pickers. `search` is typed to filter the list; `optionMatch`
        // then selects the right result. Applicant is a Chinese national.
        // Citizenship is a multiselect: type "China" -> results "Citizen (China)" AND "Non-citizen
        // (China)"; the anchored ^citizen match takes "Citizen (China)" and never "Non-citizen…".
        { topic: 'citizenship-status', patterns: [/citizen of another country/i, /hold permanent residency/i, /are you a citizen/i], search: 'China', optionMatch: /^\s*citizen\b[\s\S]*china/i, label: 'Citizen (China)' },
        { topic: 'primary-nationality', patterns: [/primary nationality/i, /confirm your[\s\S]*nationality/i, /\bnationality\b/i], search: 'China', optionMatch: /(^|\W)china\b/i, label: 'China' },
        // "What is your disability status?" (user, 2026-07-27) added as its own pattern — the
        // original wording only reached "do you have/consider... a disability" phrasing.
        // optionCandidates prefers the exact "No, I don't have a disability" wording, falling back
        // to the original guarded "no" match — never a decline-to-answer option.
        {
            topic: 'disability-selfid',
            patterns: [/consider yourself to have a disability/i, /do you (have|consider)[\s\S]*disabilit/i, /disability status/i, /what is your disability status/i, /^i have a disability/i],
            exclude: /section 4212|veteran|protected/i,
            search: 'No',
            // Typographic apostrophes are as common as ASCII ones (user, 2026-07-28), and a plain
            // "I have a disability: Yes / No" list needs the bare negative as a last resort.
            optionCandidates: [/no,?\s*i\s*don['’]?t\s*have\s*a\s*disability/i, /^\s*no\s*$/i, /(^|\W)no\b/i],
            optionMatch: /(^|\W)no\b/i,
            label: "No, I don't have a disability"
        }
    ];
    const WAIT = ms => new Promise(resolve => setTimeout(resolve, ms));
    let running = false;
    let loopActive = false;
    let pausedStepSignature = ''; // step signature captured when an Auto session paused; the watcher
    // resumes the loop if the user manually advances (clicks Continue) past it.
    let statusMessage = 'Ready.';
    let lastStepSignature = '';
    let repeatedStepCount = 0;
    let lastAutomatedActionAt = 0;
    let eveEnabled = true;
    let autoModeEnabled = false;
    let userPaused = false; // set when the user clicks Pause on a live Auto loop; cleared on Resume
    let manualPassId = 0;

    function autoActionContext() {
        return { mode: 'auto' };
    }

    function manualActionContext(passId) {
        return { mode: 'manual', passId };
    }

    function actionsAllowed(context = autoActionContext()) {
        if (!eveEnabled) return false;
        if (context.mode === 'manual') {
            return !autoModeEnabled && context.passId === manualPassId;
        }
        return autoModeEnabled && running;
    }

    function isStepChangingAction(element) {
        if (!element) return false;
        const automationId = clean(element.getAttribute?.('data-automation-id'));
        const label = clean(element.innerText || element.textContent || element.getAttribute?.('aria-label'));
        return automationId === 'pageFooterNextButton'
            || /^(continue|next|save and continue|review|submit|autofill with resume|sign in with google|sign in with email|create account|create one|sign up)$/i.test(label);
    }

    function clean(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function visible(element) {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    }

    function esc(value) {
        return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function storageGet(keys) {
        return new Promise(resolve => chrome.storage.local.get(keys, resolve));
    }

    function storageSet(value) {
        return new Promise(resolve => chrome.storage.local.set(value, resolve));
    }

    function storageRemove(key) {
        return new Promise(resolve => chrome.storage.local.remove(key, resolve));
    }

    function isApplicationPage() {
        return /\/apply(?:\/|$|\?)/i.test(location.pathname + location.search);
    }

    // The floating panel shows on ANY Workday page (myworkdayjobs.com / myworkdaysite.com).
    // The IIFE already returns early for non-Workday hosts, so this is host-gated by construction.
    function isWorkdayPage() {
        return WORKDAY_HOST_RE.test(location.hostname);
    }

    function isLoginPage() {
        return /\/login(?:\/|$|\?)/i.test(location.pathname + location.search);
    }

    function applicationKey() {
        const applyIndex = location.pathname.toLowerCase().indexOf('/apply');
        const jobPath = applyIndex >= 0 ? location.pathname.slice(0, applyIndex) : location.pathname;
        return `${location.hostname.toLowerCase()}${jobPath.replace(/^\/en-[^/]+/i, '')}`;
    }

    // Per-application session storage key so every job tab runs INDEPENDENTLY. A single shared
    // `SESSION_KEY` made tabs clobber each other's session (last writer wins): starting Auto Apply in
    // one tab overwrote another tab's session, whose applicationKey then no longer matched, so that
    // tab stopped resuming and looked "paused". Keying by applicationKey() gives each tab its own slot.
    function sessionKey() {
        return `${SESSION_KEY}:${applicationKey()}`;
    }

    function getMain() {
        return document.querySelector('main') || document.body;
    }

    // Other job-application extensions inject their own UI into the same page (Simplify's "Resume
    // Match" overlay was live on the Guidewire posting), and so do we. Their buttons must never be
    // matched by our text-based lookups — the same cross-talk class as Eve's own panel having
    // two "Search" buttons on LinkedIn. Anything inside our floating panel or a recognised foreign
    // overlay is off-limits.
    const FOREIGN_UI_RE = /(^|[\s#._-])(simplify|jobscan|huntr|lazyapply|jobright|careerflow)/i;
    function isInjectedOverlay(node) {
        for (let el = node; el; el = el.parentElement) {
            if (el.id === 'eve-floating-ui') return true;
            const id = el.id || '';
            const cls = typeof el.className === 'string' ? el.className : '';
            if (FOREIGN_UI_RE.test(id) || FOREIGN_UI_RE.test(cls)) return true;
            if (el.hasAttribute?.('data-simplify') || el.hasAttribute?.('data-simplify-app')) return true;
        }
        return false;
    }

    function allButtons() {
        return [...document.querySelectorAll('button, [role="button"], a')]
            .filter(node => visible(node) && !isInjectedOverlay(node));
    }

    // ── "Start Your Application" entry modal ────────────────────────────────────────────────────
    // Preference order (user, 2026-07-25): Autofill with Resume when the tenant offers it, otherwise
    // Apply Manually. NEVER "Use My Last Application" — it copies a previous application's answers,
    // which may be stale or belong to a different role; our own fill path is authoritative.
    // Guidewire's modal offers only Apply Manually / Use My Last Application (no autofill option).
    // Matched on button TEXT (tenants reword the manual option), not on DOM order or one selector.
    const ENTRY_AUTOFILL_RE = /^autofill with resume$/i;
    const ENTRY_MANUAL_RE = /^(apply manually|apply with manual entry|apply using manual entry|manual entry|start manually|enter manually)$/i;
    // Recorded only so it is unmistakably excluded; never clicked.
    const ENTRY_LAST_APPLICATION_RE = /^use my last application$/i;

    // When a draft already exists the tenant offers "Continue Application" on the posting page —
    // resuming the saved draft is always better than starting over, so it outranks both entry
    // choices. Anchored so it can never be confused with the footer "Continue" advance button.
    const ENTRY_CONTINUE_RE = /^(continue application|resume application|continue my application)$/i;

    function findEntryChoice() {
        const resume = findButton(ENTRY_CONTINUE_RE);
        if (resume) return { node: resume, label: 'Continue Application' };
        const autofill = findButton(ENTRY_AUTOFILL_RE);
        if (autofill) return { node: autofill, label: 'Autofill with Resume' };
        const manual = findButton(ENTRY_MANUAL_RE);
        if (manual) return { node: manual, label: 'Apply Manually' };
        return null;
    }

    function deepElements(selector, root = document, results = []) {
        if (!root?.querySelectorAll) return results;
        for (const element of root.querySelectorAll(selector)) results.push(element);
        for (const element of root.querySelectorAll('*')) {
            if (element.shadowRoot) deepElements(selector, element.shadowRoot, results);
        }
        return results;
    }

    function findButton(pattern, automationId) {
        if (automationId) {
            const exact = document.querySelector(`[data-automation-id="${automationId}"]`);
            if (visible(exact) && !exact.disabled) return exact;
        }
        return allButtons().find(button => pattern.test(clean(button.innerText || button.textContent || button.getAttribute('aria-label'))) && !button.disabled);
    }

    // On a Workday JOB POSTING page (job detail, no /apply yet) the big "Apply" button opens the
    // "Start Your Application" modal (Autofill with Resume / Apply Manually / Use My Last Application).
    // Detect it so the flow can open the modal before choosing Autofill with Resume. Never our own
    // popup's Apply button, and only when the modal isn't already open.
    function findPostingApplyButton() {
        if (findEntryChoice()) return null; // entry modal already open
        const byId = document.querySelector('[data-automation-id="adventureButton"], [data-automation-id="apply"], [data-automation-id="applyButton"]');
        if (byId && visible(byId) && !byId.disabled) return byId;
        return allButtons().find(button => {
            if (button.closest('#eve-floating-ui')) return false;
            return /^apply$/i.test(clean(button.innerText || button.textContent || button.getAttribute('aria-label'))) && !button.disabled;
        }) || null;
    }

    function findSupportedPageAction() {
        return findEntryChoice()?.node
            || findPostingApplyButton()
            || findButton(/^sign in with google$/i)
            || findButton(/^(create account|create one|sign up)$/i)
            || findButton(/^sign in with email$/i)
            || document.querySelector('input[type="file"][data-automation-id="file-upload-input-ref"], main input[type="file"]')
            || findButton(/^(continue|next|save and continue|review|submit)$/i, 'pageFooterNextButton')
            || getFields()[0]
            || null;
    }

    function waitForPageMatch(findMatch, timeoutMs, waitingMessage) {
        const existing = findMatch();
        if (existing) return Promise.resolve(existing);
        setStatus(waitingMessage, 'running');
        return new Promise(resolve => {
            let settled = false;
            const finish = value => {
                if (settled) return;
                settled = true;
                observer.disconnect();
                clearInterval(poller);
                clearTimeout(timeout);
                resolve(value || null);
            };
            const check = () => {
                const action = findMatch();
                if (action) finish(action);
            };
            const observer = new MutationObserver(check);
            observer.observe(document.documentElement, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['disabled', 'aria-disabled', 'style', 'class']
            });
            const poller = setInterval(check, 200);
            const timeout = setTimeout(() => finish(null), timeoutMs);
            check();
        });
    }

    function waitForSupportedPageAction(timeoutMs = 15000) {
        return waitForPageMatch(findSupportedPageAction, timeoutMs, 'Waiting for Workday step controls…');
    }

    function waitForButton(pattern, automationId, timeoutMs = 15000, waitingMessage = 'Waiting for Workday action…') {
        return waitForPageMatch(() => findButton(pattern, automationId), timeoutMs, waitingMessage);
    }

    function isAuthenticationScreen() {
        const text = clean(getMain().innerText || document.body.innerText);
        // Detect a real account-entry screen only. Do NOT key on "privacy notice": the Voluntary
        // Disclosures Terms & Conditions also says "Privacy Notice", and matching it here misrouted
        // that whole step into the login flow ("Sign in with Google is not available on this page").
        if (/create account\s*\/\s*sign in|sign in with (apple|google|email)/i.test(text)) return true;
        if (findButton(/^sign in with (apple|google|email)$/i)) return true;
        return [...getMain().querySelectorAll('input[type="password"]')].some(visible);
    }

    async function performDelayedAction(action, message, context = autoActionContext()) {
        if (!actionsAllowed(context)) return false;
        const elapsed = Date.now() - lastAutomatedActionAt;
        const waitMs = lastAutomatedActionAt ? Math.max(0, ACTION_DELAY_MS - elapsed) : ACTION_DELAY_MS;
        if (message) setStatus(`${message}…`, 'running');
        if (waitMs) await WAIT(waitMs);
        if (!actionsAllowed(context)) return false;
        const result = action();
        lastAutomatedActionAt = Date.now();
        return result;
    }

    async function clickButton(button, message = 'Selecting Workday action', context = autoActionContext()) {
        if (!button || button.disabled) return false;
        if (context.mode === 'manual' && isStepChangingAction(button)) {
            setStatus('Manual Apply blocked a step-changing Workday action.', 'waiting');
            return false;
        }
        button.scrollIntoView({ block: 'center', behavior: 'instant' });
        return performDelayedAction(() => {
            button.click();
            return true;
        }, message, context);
    }

    // Explicit auth click that bypasses the Manual step-changing block. Used only for a
    // user-initiated Apply click on a /login or auth screen, to start Sign in with Google.
    async function clickAuthButton(button, message, context) {
        if (!button || button.disabled) return false;
        button.scrollIntoView({ block: 'center', behavior: 'instant' });
        return performDelayedAction(() => {
            button.click();
            return true;
        }, message, context);
    }

    // Mark that Eve is driving a Google sign-in. The account-chooser helper on
    // accounts.google.com reads this so it selects the configured account in Manual mode too
    // (not only during an Auto session), but only for a login the user just initiated here.
    function markLoginPending() {
        return storageSet({ eveWorkdayLoginPendingAt: Date.now() });
    }

    async function handleWorkdayLogin(context = autoActionContext()) {
        let google = findButton(/^sign in with google$/i);
        if (!google) {
            google = await waitForButton(/^sign in with google$/i, null, 15000, 'Waiting for Sign in with Google…');
        }
        if (!google) {
            const message = 'Sign in with Google is not available on this page yet.';
            return context.mode === 'manual' ? manualFillResult(message, false) : pause(message);
        }
        await markLoginPending();
        if (!await clickAuthButton(google, `Signing in with Google as ${GOOGLE_ACCOUNT}`, context)) {
            return { ok: false, state: 'stopped' };
        }
        setStatus(`Signing in with Google as ${GOOGLE_ACCOUNT}…`, 'running');
        return { ok: true, state: 'authenticating' };
    }

    function currentStep() {
        const main = getMain();
        // Some tenants (e.g. Citi) split a step into numbered parts — "Application Questions 1 of 2",
        // "… 2 of 2". Match those too and strip the " N of M" suffix so downstream detectors, which
        // compare against the canonical step name, still route correctly.
        const knownHeading = [...main.querySelectorAll('h1, h2, h3')]
            .filter(visible)
            .map(node => clean(node.textContent))
            .find(text => /^(start your application|autofill with resume|my information|my experience|application questions|voluntary disclosures|self identify|review)(\s+\d+\s+of\s+\d+)?$/i.test(text));
        if (knownHeading) return knownHeading.replace(/\s+\d+\s+of\s+\d+$/i, '').trim();
        if (isMyInformationStep()) return 'My Information';
        const active = main.querySelector('[aria-current="step"], [data-automation-id="progressBarActiveStep"]');
        const fallbackHeading = [...main.querySelectorAll('h3, h2, h1')]
            .filter(visible)
            .map(node => clean(node.textContent))
            .find(text => text && !/^follow us$/i.test(text) && !/associate|engineer|developer|analyst/i.test(text));
        return clean(active?.textContent || fallbackHeading || document.title || 'Workday Application');
    }

    // Panel-safe wrapper: injectUI() builds the panel HTML with this, so if step detection ever
    // throws (a bad selector, an unexpected DOM, a future recursion regression), the popup must
    // still appear rather than being blocked by the error. Never let step detection nuke the UI.
    function safeCurrentStep() {
        try { return currentStep(); } catch { return 'Workday Application'; }
    }

    function isMyInformationStep() {
        const main = getMain();
        const stableControls = main.querySelector('#source--source')
            && main.querySelector('#name--legalName--firstName')
            && main.querySelector('#phoneNumber--phoneNumber');
        if (stableControls) return true;
        // Heading fallback — but NOT on the Review summary, which also renders a "My Information"
        // section heading with no editable fields. Require an editable identity control to be present.
        if (isReviewStep()) return false;
        const hasHeading = [...main.querySelectorAll('h1, h2, h3')]
            .filter(visible)
            .some(node => /^my information$/i.test(clean(node.textContent)));
        return hasHeading && Boolean(main.querySelector('#source--source, #name--legalName--firstName, input[id*="legalName"], input[id*="address--"]'));
    }

    function getLabel(input) {
        const id = input.id;
        const byFor = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
        const wrapping = input.closest('label');
        const group = input.closest('[data-automation-id*="formField"], [role="group"], fieldset, div');
        const groupLabel = group?.querySelector('legend, label, [data-automation-id="formLabel"], [data-automation-id="promptOption"]');
        return clean(byFor?.textContent || wrapping?.textContent || input.getAttribute('aria-label') || groupLabel?.textContent || input.name || input.placeholder || 'Field').replace(/^\*\s*/, '');
    }

    function getFields() {
        const main = getMain();
        const inputs = [...main.querySelectorAll('input, textarea, select')].filter(input => {
            if (!visible(input)) return false;
            if (['hidden', 'submit', 'button', 'reset', 'file'].includes(input.type)) return false;
            return !input.disabled;
        });
        const handledRadioNames = new Set();
        return inputs.flatMap(input => {
            if (input.type === 'radio') {
                if (handledRadioNames.has(input.name)) return [];
                handledRadioNames.add(input.name);
                const radios = inputs.filter(item => item.type === 'radio' && item.name === input.name);
                const checked = radios.find(item => item.checked);
                return [{ input, radios, label: getLabel(input), value: checked ? getLabel(checked) : '', required: radios.some(item => item.required) }];
            }
            if (input.type === 'checkbox') {
                return [{ input, label: getLabel(input), value: input.checked ? 'Yes' : 'No', required: input.required }];
            }
            const customPickerValue = /items? selected/i.test(clean(input.getAttribute('aria-description')))
                ? selectedItemText(input)
                : '';
            return [{ input, label: getLabel(input), value: clean(input.value) || customPickerValue, required: input.required || input.getAttribute('aria-required') === 'true' }];
        });
    }

    function normalizeKey(value) {
        return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    }

    function canonicalAliases(label) {
        const text = clean(label);
        const aliases = [text];
        const rules = [
            [/first name/i, 'First Name'], [/last name/i, 'Last Name'], [/email/i, 'Email'],
            [/phone/i, 'Phone Number'], [/linkedin/i, 'LinkedIn Profile'], [/github/i, 'GitHub Profile'],
            [/city/i, 'City'], [/authorized.*work|work authorization/i, 'Work Authorization'],
            [/sponsor/i, 'Require Sponsorship?'], [/gender/i, 'Gender'], [/veteran/i, 'Veteran'],
            [/disabil/i, 'Disability'], [/race|ethnicity/i, 'Race/Ethnicity'],
            [/how did you (hear|learn)/i, 'How did you learn about this role?']
        ];
        for (const [pattern, key] of rules) if (pattern.test(text)) aliases.unshift(key);
        return aliases;
    }

    function resolveAnswer(label, savedAnswers, regexAnswers) {
        const aliases = canonicalAliases(label);
        for (const alias of aliases) {
            if (savedAnswers[alias] !== undefined) return clean(savedAnswers[alias]);
            const aliasKey = normalizeKey(alias);
            const matched = Object.entries(savedAnswers).find(([key]) => normalizeKey(key.replace(/^\[[^\]]+\]\s*/, '')) === aliasKey);
            if (matched) return clean(matched[1]);
        }
        for (const entry of regexAnswers || []) {
            if (!entry?.pattern || entry.answer === undefined || entry.answer === '') continue;
            const source = String(entry.pattern).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
            try { if (new RegExp(`^${source}$`, 'i').test(label)) return clean(entry.answer); } catch { }
        }
        return '';
    }

    // Click away onto empty page space (user, 2026-07-27, shared across T2–T6): after typing, blur
    // the field and click neutral space so the page's own validation registers the value. Events
    // are dispatched directly on <body>, so no other control can be hit.
    // Synchronous sibling of clickAwayToCommit() below (which is async because it goes through
    // performDelayedAction) — same neutral target, callable from inside setNativeValue.
    function clickAway() {
        try { document.activeElement?.blur?.(); } catch { }
        const away = document.querySelector('[data-automation-id="pageHeader"]')
            || document.querySelector('main h2, main h3, h2, h3')
            || document.body;
        const rect = away.getBoundingClientRect();
        const opts = {
            bubbles: true, cancelable: true, composed: true, view: window, button: 0, buttons: 0,
            clientX: Math.max(4, Math.floor(rect.left + 4)), clientY: Math.max(4, Math.floor(rect.top + 4))
        };
        away.dispatchEvent(new PointerEvent('pointerdown', opts));
        away.dispatchEvent(new MouseEvent('mousedown', opts));
        away.dispatchEvent(new PointerEvent('pointerup', opts));
        away.dispatchEvent(new MouseEvent('mouseup', opts));
        away.dispatchEvent(new MouseEvent('click', opts));
    }

    // Text fields follow the user-shaped sequence: CLICK the field → type → CLICK AWAY. Workday
    // marks a required field filled only once it commits on blur/outside-click; going straight
    // from one field to the next was fast enough to leave filled fields flagged as empty.
    function setNativeValue(input, value) {
        const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
        try { input.scrollIntoView?.({ block: 'center' }); } catch { }
        const clickOpts = { bubbles: true, cancelable: true, composed: true, view: window, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true };
        input.dispatchEvent(new PointerEvent('pointerdown', clickOpts));
        input.dispatchEvent(new MouseEvent('mousedown', clickOpts));
        input.dispatchEvent(new PointerEvent('pointerup', clickOpts));
        input.dispatchEvent(new MouseEvent('mouseup', clickOpts));
        input.dispatchEvent(new MouseEvent('click', clickOpts));
        try { input.focus(); } catch { }
        if (setter) setter.call(input, value); else input.value = value;
        // React/Workday listen for a real InputEvent; a keyup helps date spinbuttons re-parse.
        input.dispatchEvent(new InputEvent('input', { bubbles: true, data: String(value), inputType: 'insertText' }));
        input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Unidentified' }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        // Real commit: Workday validates required fields on focusout/blur. A dispatched 'blur' Event
        // never actually blurs the field, so the value showed but stayed "required" (red). Fire a
        // bubbling focusout AND a real .blur() so the just-filled field commits and clears its error.
        input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
        try { input.blur(); } catch { }
        clickAway();
    }

    function setComboboxSearchValue(input, value) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        input.focus();
        if (setter) setter.call(input, value); else input.value = value;
        input.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            data: value,
            inputType: value ? 'insertText' : 'deleteContentBackward'
        }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    async function fillField(field, answer, context = autoActionContext()) {
        if (!answer) return false;
        const input = field.input;
        if (field.radios) {
            const match = field.radios.find(radio => normalizeKey(getLabel(radio)).includes(normalizeKey(answer)) || normalizeKey(radio.value) === normalizeKey(answer));
            if (!match) return false;
            await performDelayedAction(() => {
                match.click();
                match.dispatchEvent(new Event('change', { bubbles: true }));
            }, `Selecting ${field.label}`, context);
            return true;
        }
        if (input.type === 'checkbox') {
            const shouldCheck = /^(yes|true|agree|checked|1)$/i.test(answer);
            if (input.checked !== shouldCheck) await clickButton(input, `Selecting ${field.label}`, context);
            return true;
        }
        if (input.tagName === 'SELECT') {
            const option = [...input.options].find(item => normalizeKey(item.textContent).includes(normalizeKey(answer)) || normalizeKey(item.value) === normalizeKey(answer));
            if (!option) return false;
            await performDelayedAction(() => {
                input.value = option.value;
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }, `Selecting ${field.label}`, context);
            return true;
        }
        setNativeValue(input, answer);
        if (input.getAttribute('role') === 'combobox' || input.getAttribute('aria-autocomplete')) {
            await WAIT(500);
            const options = [...document.querySelectorAll('[role="option"]')].filter(visible);
            const option = options.find(item => normalizeKey(item.textContent).includes(normalizeKey(answer))) || options[0];
            if (option) await clickButton(option, `Selecting ${field.label}`, context);
        }
        return true;
    }

    // Render a status message in bullet style: each non-empty line gets a leading "• ".
    // The raw message is kept in `statusMessage`/dataset; bullets are added only at display time.
    function bulletize(message) {
        return String(message == null ? '' : message)
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean)
            .map(line => `• ${line}`)
            .join('\n');
    }

    function setStatus(message, state = 'idle') {
        statusMessage = message;
        document.documentElement.dataset.eveWorkdayState = state;
        document.documentElement.dataset.eveWorkdayMessage = message;
        const status = document.getElementById('ea-apply-status');
        const action = document.getElementById('ea-current-action');
        if (status) status.textContent = bulletize(message);
        if (action) action.textContent = bulletize(`${currentStep()} — ${message}`);
        updateAutoApplyButton(); // keep the Apply/Auto Apply/Pause/Resume label in sync with run state
    }

    async function loadSession() {
        const key = sessionKey();
        const result = await storageGet([key]);
        return result[key] || null;
    }

    async function saveSession(state, patch = {}) {
        const active = state !== 'complete' && state !== 'stopped';
        const key = sessionKey();
        const existing = await loadSession();
        const base = existing?.applicationKey === applicationKey() ? existing : {};
        // Write/clear ONLY this application's slot — never a shared key — so concurrent tabs don't
        // stomp each other. Remove (not null) when the session ends so slots don't accumulate.
        if (active) {
            await storageSet({ [key]: { ...base, ...patch, state, applicationKey: applicationKey(), updatedAt: Date.now() } });
        } else {
            await storageRemove(key);
        }
    }

    async function refreshAutomationGate() {
        const result = await storageGet(['settings', 'eveApplyMode']);
        eveEnabled = result.settings?.autopilotEnabled !== false;
        autoModeEnabled = result.eveApplyMode !== 'manual';
        updateAutoApplyButton();
        return eveEnabled && autoModeEnabled;
    }

    async function stopAllAutomatedActions(message = 'Auto mode is off. Automated actions stopped.') {
        running = false;
        userPaused = false;
        await saveSession('stopped');
        setStatus(message, 'stopped');
        switchView('apply');
        updateAutoApplyButton();
        return { ok: false, state: 'stopped', message };
    }

    async function pause(message) {
        if (!eveEnabled || !autoModeEnabled) return stopAllAutomatedActions(message);
        running = false;
        pausedStepSignature = stepSignature(); // if the user manually advances, the watcher resumes
        await saveSession('waiting');
        setStatus(message, 'waiting');
        // Stay on the 'apply' tab for the Workday template; never auto-switch to Step/Info.
        renderStep();
        return { ok: false, state: 'waiting', message };
    }

    function stepSignature() {
        const main = getMain();
        const progress = clean(main.querySelector('[aria-current="step"], [data-automation-id="progressBarActiveStep"]')?.textContent);
        const headings = [...main.querySelectorAll('h1, h2, h3')]
            .filter(visible)
            .map(node => normalizeKey(node.textContent))
            .filter(Boolean)
            .slice(0, 8);
        const controls = [...main.querySelectorAll('input, textarea, select, [data-automation-id*="Page"]')]
            .filter(element => visible(element))
            .map(element => [
                element.tagName,
                element.type,
                element.id,
                element.name,
                element.getAttribute('data-automation-id')
            ].map(normalizeKey).filter(Boolean).join(':'))
            .filter(Boolean)
            .slice(0, 40);
        return `${location.pathname}${location.search}|${normalizeKey(currentStep())}|${normalizeKey(progress)}|${headings.join(',')}|${controls.join(',')}`;
    }

    async function waitForStepChange(previous, timeoutMs = 10000) {
        const end = Date.now() + timeoutMs;
        while (Date.now() < end) {
            await WAIT(250);
            if (stepSignature() !== previous) return true;
        }
        return false;
    }

    // Wait for the page/step to be FULLY loaded and settled before executing the next step: the
    // document must be 'complete' and the step signature must stop changing for a short window
    // (Workday keeps rendering after a step transition). Prevents acting on a half-rendered page.
    async function waitForStablePage(timeoutMs = 8000) {
        const end = Date.now() + timeoutMs;
        if (document.readyState !== 'complete') {
            await new Promise(resolve => {
                const done = () => resolve();
                window.addEventListener('load', done, { once: true });
                setTimeout(done, Math.min(timeoutMs, 5000));
            });
        }
        let previous = stepSignature();
        let stable = 0;
        while (Date.now() < end) {
            await WAIT(300);
            const signature = stepSignature();
            if (signature === previous) { if (++stable >= 2) return; } else { stable = 0; previous = signature; }
        }
    }

    function resolveWorkdayAdvanceAction() {
        const supported = /^(continue|next|save and continue|review)$/i;
        const submit = /^submit$/i;
        const footer = document.querySelector('[data-automation-id="pageFooterNextButton"]');
        const candidates = [footer, ...allButtons()].filter((button, index, list) => button && list.indexOf(button) === index);
        for (const button of candidates) {
            if (!visible(button) || button.disabled || button.getAttribute('aria-disabled') === 'true') continue;
            const label = clean(button.innerText || button.textContent || button.getAttribute('aria-label'));
            // Submit is now a real advance action: on the final Review page Eve clicks Submit
            // directly (per user instruction) instead of pausing for manual approval.
            if (submit.test(label) || supported.test(label)) return { button, label, state: 'ready' };
        }
        return { button: null, label: '', state: 'unavailable' };
    }

    async function advanceWorkdayStep(context = autoActionContext(), options = {}) {
        const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 12000;
        const message = clean(options.message) || 'Continuing to the next Workday step';
        // Both Auto and Manual advance one supported step under the shared automation gate
        // (extension enabled, matching mode, active pass/session). Submit is always blocked.
        if (!actionsAllowed(context)) {
            return { ok: false, state: 'stopped', actionLabel: '', clicked: false, stepChanged: false };
        }

        const available = await waitForPageMatch(
            () => {
                const action = resolveWorkdayAdvanceAction();
                return action.state === 'unavailable' ? null : action;
            },
            Math.min(timeoutMs, 15000),
            'Waiting for Workday Continue/Next action…'
        );
        if (!available) {
            return { ok: false, state: 'unavailable', actionLabel: '', clicked: false, stepChanged: false };
        }
        if (available.state === 'submit-blocked') {
            return { ok: false, state: 'submit-blocked', actionLabel: available.label || 'Submit', clicked: false, stepChanged: false };
        }

        // User rule (2026-07-26): before EVERY Continue / Save and Continue / Next / Review click, click
        // a neutral empty place first so any just-filled control (a picker chip, a date, a typed value)
        // blurs and commits — otherwise Workday can reject the advance as "required field empty".
        await clickAwayToCommit(context);

        let beforeSignature = '';
        let actionLabel = '';
        let automationId = '';
        let liveState = 'unavailable';
        const clicked = await performDelayedAction(() => {
            const liveAction = resolveWorkdayAdvanceAction();
            liveState = liveAction.state;
            actionLabel = liveAction.label;
            const liveButton = liveAction.button;
            if (liveState !== 'ready' || !liveButton) return false;
            beforeSignature = stepSignature();
            automationId = clean(liveButton.getAttribute('data-automation-id'));
            liveButton.scrollIntoView({ block: 'center', behavior: 'instant' });
            liveButton.click();
            return true;
        }, message, context);

        if (!clicked) {
            const state = !actionsAllowed(context) ? 'stopped' : liveState;
            return { ok: false, state, actionLabel, automationId, clicked: false, stepChanged: false, beforeSignature };
        }
        let stepChanged = await waitForStepChange(beforeSignature, timeoutMs);
        // Some steps (e.g. Self Identify) don't advance on the first click — the fill's blur/validation
        // is still settling. Retry the click ONCE if the step hasn't changed and we're demonstrably
        // still on the same step (guards against double-advance when the first click actually worked).
        if (!stepChanged && actionsAllowed(context) && stepSignature() === beforeSignature) {
            await WAIT(800);
            const retry = resolveWorkdayAdvanceAction();
            if (retry.state === 'ready' && retry.button && stepSignature() === beforeSignature) {
                setStatus(`${actionLabel || 'Save and Continue'} (retry)…`, 'running');
                retry.button.scrollIntoView({ block: 'center', behavior: 'instant' });
                retry.button.click();
                lastAutomatedActionAt = Date.now();
                stepChanged = await waitForStepChange(beforeSignature, timeoutMs);
            }
        }
        return {
            ok: stepChanged,
            state: stepChanged ? 'advanced' : 'unchanged',
            actionLabel,
            automationId,
            clicked: true,
            stepChanged,
            beforeSignature,
            afterSignature: stepSignature()
        };
    }

    function selectedItemText(control) {
        if (!control) return '';
        const field = control.closest('[data-automation-id="multiSelectContainer"], [data-automation-id*="formField"], fieldset');
        const tokenCandidates = [...(field || control.parentElement || document).querySelectorAll(
            '[data-automation-id="selectedItem"], [role="option"], [data-automation-label]'
        )];
        const selected = tokenCandidates.find(node => {
            const text = clean(node.getAttribute('data-automation-label') || node.textContent);
            return node.getAttribute('data-automation-id') === 'selectedItem'
                || node.getAttribute('aria-selected') === 'true'
                || /press delete to clear value/i.test(text);
        });
        const selectedText = clean(selected?.getAttribute('data-automation-label') || selected?.textContent)
            .replace(/,?\s*press delete to clear value\.?$/i, '');
        if (selectedText) return selectedText;
        const describedControl = [control, ...(field ? field.querySelectorAll('[aria-description]') : [])]
            .find(node => /\d+\s+items?\s+selected/i.test(clean(node.getAttribute('aria-description'))));
        const description = clean(describedControl?.getAttribute('aria-description'));
        const describedSelection = description.match(/^\d+\s+items?\s+selected[,;:]?\s*(.+)$/i);
        if (describedSelection) {
            return clean(describedSelection[1]).replace(/,?\s*press delete to clear value\.?$/i, '');
        }
        const ariaValue = clean(control.getAttribute('aria-valuetext') || control.getAttribute('data-automation-label'));
        if (ariaValue) return ariaValue;
        const directText = clean(control.textContent);
        if (directText) return directText;
        const isSearchInput = control instanceof HTMLInputElement
            && (control.getAttribute('role') === 'combobox'
                || control.hasAttribute('aria-autocomplete')
                || control.getAttribute('data-uxi-widget-type') === 'selectinput'
                || control.hasAttribute('data-uxi-multiselect-id')
                || Boolean(control.closest('[data-automation-id="multiSelectContainer"]')));
        return isSearchInput ? '' : clean(control.value);
    }

    function exactVisibleChoice(text) {
        const expected = normalizeKey(text);
        const directMenuItem = [...document.querySelectorAll('[data-automation-id="menuItem"]')]
            .find(node => normalizeKey(node.getAttribute('aria-label')).startsWith(expected));
        if (directMenuItem) return directMenuItem;
        const selectors = '[role="option"], [role="menuitem"], [role="menuitemradio"], [data-automation-id="menuItem"], [data-automation-id="promptOption"], li, button';
        const candidates = deepElements(selectors).filter(node => visible(node) && !node.closest('#eve-floating-ui'));
        return candidates.find(node => normalizeKey(node.textContent) === expected && node.matches('[role="option"], [role="menuitem"], [role="menuitemradio"]'))
            || candidates.find(node => normalizeKey(node.getAttribute('data-automation-label')) === expected)
            || candidates.find(node => normalizeKey(node.textContent) === expected)
            || candidates.find(node => normalizeKey(node.getAttribute('aria-label')).startsWith(expected))
            || null;
    }

    async function waitForChoice(text, timeoutMs = 12000, context = autoActionContext()) {
        const end = Date.now() + timeoutMs;
        while (Date.now() < end) {
            if (!actionsAllowed(context)) return null;
            const choice = exactVisibleChoice(text);
            if (choice) return choice;
            const list = [...document.querySelectorAll('[data-automation-id="activeListContainer"], [role="listbox"]')]
                .find(node => node.scrollHeight > node.clientHeight && visible(node));
            if (list && list.scrollTop + list.clientHeight < list.scrollHeight) {
                list.scrollTop = Math.min(list.scrollHeight, list.scrollTop + Math.max(240, Math.floor(list.clientHeight * 0.75)));
                list.dispatchEvent(new Event('scroll', { bubbles: true }));
            }
            await WAIT(200);
        }
        return null;
    }

    // Open a Workday listbox-style picker. Some tenants' opener buttons (AVEVA's Phone Device Type)
    // ignore a bare DOM `.click()` and only respond to a real pointer sequence — the same hazard
    // long known for prompt LEAF nodes, now seen on the OPENER. Try the cheap click first and only
    // escalate to pointer events if the control did not actually expand, so controls that do respond
    // to `.click()` are never double-fired (which would open then immediately close them).
    // Search-style inputs (School / Field of Study) keep the plain path: they have no aria-expanded
    // to test, so escalating would be a blind second interaction.
    async function clickPickerOpener(control, message, context = autoActionContext()) {
        if (!control || control.disabled) return false;
        const isListboxOpener = control.getAttribute('aria-haspopup') === 'listbox'
            || (control.tagName === 'BUTTON' && !control.matches('input'));
        if (!isListboxOpener) return clickButton(control, message, context);
        const opened = () => control.getAttribute('aria-expanded') === 'true' || Boolean(ownedOptionList(control));
        if (opened()) return true;
        if (!await clickButton(control, message, context)) return false;
        await WAIT(250);
        if (opened()) return true;
        return clickPickerChoice(control, message, context);
    }

    async function clickPickerChoice(choice, message, context = autoActionContext()) {
        if (!choice) return false;
        choice.scrollIntoView({ block: 'nearest', behavior: 'instant' });
        return performDelayedAction(() => {
            const target = choice.querySelector?.('[data-automation-id="promptLeafNode"]') || choice;
            const eventOptions = {
                bubbles: true,
                cancelable: true,
                composed: true,
                view: window,
                button: 0,
                buttons: 1,
                pointerId: 1,
                pointerType: 'mouse',
                isPrimary: true
            };
            target.dispatchEvent(new PointerEvent('pointerdown', eventOptions));
            target.dispatchEvent(new MouseEvent('mousedown', eventOptions));
            target.dispatchEvent(new PointerEvent('pointerup', eventOptions));
            target.dispatchEvent(new MouseEvent('mouseup', eventOptions));
            target.dispatchEvent(new MouseEvent('click', eventOptions));
            return true;
        }, message, context);
    }

    // After committing a picker selection (Field of Study) or a date, Workday keeps the results list /
    // calendar overlay OPEN until an OUTSIDE click. Blur the active control and click a neutral empty
    // spot (the step heading) so the selection commits and the overlay closes — the "× <value>" chip
    // stays, the menu goes away, and the NEXT field can be reached (user rule 2026-07-25: after
    // selecting the target, "click otherwise, at the empty place"; same for the date gadget).
    async function clickAwayToCommit(context) {
        try { document.activeElement?.blur?.(); } catch { }
        const away = document.querySelector('[data-automation-id="pageHeader"]')
            || document.querySelector('main h2, main h3, h2, h3')
            || getMain() || document.body;
        await performDelayedAction(() => {
            const r = away.getBoundingClientRect();
            const o = {
                bubbles: true, cancelable: true, composed: true, view: window, button: 0, buttons: 0,
                clientX: Math.max(4, Math.floor(r.left + 4)), clientY: Math.max(4, Math.floor(r.top + 4))
            };
            away.dispatchEvent(new PointerEvent('pointerdown', o));
            away.dispatchEvent(new MouseEvent('mousedown', o));
            away.dispatchEvent(new PointerEvent('pointerup', o));
            away.dispatchEvent(new MouseEvent('mouseup', o));
            away.dispatchEvent(new MouseEvent('click', o));
            return true;
        }, 'Committing selection', context);
        await WAIT(300);
    }

    // ONE definition of "this picker is still empty", shared by blockAnswered() and every
    // My Information search-and-pick field. Workday's placeholder is "Select One" and some tenants
    // decorate it (Citi's button aria-label is " Select One Required"), so anchor-match the
    // placeholder and treat it as EMPTY — a placeholder must never read as a filled value.
    const PICKER_PLACEHOLDER = /^select one\b/i;

    // The value a picker/prompt currently holds, or '' when it holds nothing but a placeholder.
    function pickerSelectedValue(control) {
        const text = clean(selectedItemText(control));
        return !text || PICKER_PLACEHOLDER.test(text) ? '' : text;
    }

    // The "How did you hear about us?" source control. Some tenants render it as a free-text <input>
    // instead of a picker — in that case we skip it entirely (per user: never fill a free-text source,
    // and never treat it as a required/missing field).
    function sourceControl() {
        return document.querySelector('#source--source');
    }
    // A Workday "search and pick" control. Recognising these by `role="combobox"` alone is NOT
    // enough: Bank of America / GHR renders School, Field of Study AND How Did You Hear About Us as
    // a plain `<input type="text" placeholder="Search">` with no role and no aria-haspopup, marked
    // only by the uxi selectinput/multiselect attributes. Missing that made the source look like a
    // free-text field, so it was skipped entirely — and it is aria-required, so Save and Continue
    // then failed with "The field How Did You Hear About Us? is required".
    function isSearchPickerControl(control) {
        if (!control) return false;
        return control.getAttribute('role') === 'combobox'
            || control.hasAttribute('aria-autocomplete')
            || control.hasAttribute('aria-haspopup')
            || control.getAttribute('data-uxi-widget-type') === 'selectinput'
            || control.hasAttribute('data-uxi-multiselect-id')
            || Boolean(control.closest('[data-automation-id="multiSelectContainer"]'));
    }

    function sourceIsFreeText() {
        const s = sourceControl();
        if (!s || !s.matches('input')) return false;
        const type = (s.getAttribute('type') || 'text').toLowerCase();
        if (type === 'button') return false;
        return !isSearchPickerControl(s);
    }

    // How Did You Hear About Us? (user, 2026-07-25): NO targeting any more — just open the picker and
    // take the FIRST option; if that drills into another list, take the first option there too, and
    // keep going until a leaf is selected. The previous LinkedIn / Job Board -> LinkedIn walk and the
    // later "prefer Referral" precedence are both gone on purpose: the user accepts whatever the
    // tenant lists first and does not want a preference reintroduced (it would defeat the
    // simplification). A value already selected is kept as-is and never reopened.
    // `MAX_SOURCE_DEPTH` caps the drill-in so a malformed/looping picker can't spin forever.
    const MAX_SOURCE_DEPTH = 4;
    async function ensureSourceSelected(context = autoActionContext()) {
        const source = sourceControl();
        // No picker present, or a free-text variant: skip — nothing to select, never pause.
        if (!source || sourceIsFreeText()) return true;
        // Already filled -> done, move on. (Shared skip-if-filled rule for search-and-pick fields.)
        if (pickerSelectedValue(source)) return true;

        const optionSelector = '[role="option"], [data-automation-id="promptOption"], [data-automation-id="promptLeafNode"], [data-automation-id="menuItem"]';
        // Prefer the list this control owns (aria-controls). GHR's source exposes no such link, so we
        // fall back to a document scan — but a bare document scan is dangerous here: an ALREADY
        // SELECTED chip of another multiselect (the Country Phone Code token) also matches
        // [role="option"] and is permanently visible, so it was being clicked as "the first option".
        // Guard twice: drop selected-item tokens, and only ever consider nodes that appeared since
        // the previous interaction (`seen`), which also stops a still-open parent list from being
        // re-picked as its own child.
        const visibleOptionNodes = () => {
            const scope = ownedOptionList(source);
            return [...(scope || document).querySelectorAll(optionSelector)].filter(node =>
                visible(node)
                && !node.closest('#eve-floating-ui')
                && node.getAttribute('data-automation-id') !== 'selectedItem'
                && !node.closest('[data-automation-id="selectedItem"]')
                && !node.closest('[data-automation-id="multiSelectContainer"]')
                // Skip the disabled "Select One" placeholder <li> (aria-disabled, empty data-value):
                // clicking it is a no-op, so taking it as "the first option" left the source unset and
                // paused with "Pick a How Did You Hear About Us source" (Guidewire, 2026-07-25).
                && node.getAttribute('aria-disabled') !== 'true'
                && node.getAttribute('data-value') !== ''
                && !/^select one$/i.test(clean(node.textContent))
                && clean(node.textContent));
        };
        const waitForFreshOption = async (seen, timeoutMs) => {
            const end = Date.now() + timeoutMs;
            while (Date.now() < end) {
                if (!actionsAllowed(context)) return null;
                const fresh = visibleOptionNodes().find(node => !seen.has(node));
                if (fresh) return fresh;
                await WAIT(150);
            }
            return null;
        };

        let seen = new Set(visibleOptionNodes()); // background tokens present before the prompt opens
        if (!await clickButton(source, 'Opening How Did You Hear About Us', context)) return false;

        const chosen = [];
        for (let depth = 0; depth < MAX_SOURCE_DEPTH; depth += 1) {
            if (!actionsAllowed(context)) return false;
            // A leaf was chosen on the previous pass -> the control now reports a value; done.
            if (pickerSelectedValue(source)) break;
            const first = await waitForFreshOption(seen, 2500);
            if (!first) break;
            const label = clean(first.textContent) || 'source';
            // Snapshot BEFORE clicking so this level's nodes count as old and only a genuinely new
            // sub-list can satisfy the next iteration.
            seen = new Set(visibleOptionNodes());
            if (!await clickPickerChoice(first, `Selecting ${label}`, context)) break;
            chosen.push(label);
            await WAIT(400); // let the sub-list render (or the selection commit)
        }
        const value = pickerSelectedValue(source);
        if (value) setStatus(`How Did You Hear About Us: ${chosen.join(' > ') || value}`, 'running');
        return Boolean(value);
    }

    function pickStoredValue(records, aliases) {
        const expected = new Set(aliases.map(normalizeKey));
        for (const record of records) {
            for (const [key, value] of Object.entries(record || {})) {
                const cleaned = clean(value);
                if (cleaned && expected.has(normalizeKey(key))) return cleaned;
            }
        }
        return '';
    }

    async function loadMyInformationAnswers() {
        const result = await storageGet([WORKDAY_INFO_KEY, 'savedAnswers', 'profileData']);
        const stored = result[WORKDAY_INFO_KEY] || {};
        const fallbackRecords = [result.profileData || {}, result.savedAnswers || {}];
        // This installation's own identity (eve/profile.local.json) sits under the saved answers
        // and over the packaged placeholders.
        await applyRuntimeProfile();
        const DEFAULTS = profileMyInformation();
        const fallbacks = {
            sourceDetail: pickStoredValue(fallbackRecords, ['How Did You Hear About Us?', 'How did you learn about this role?']) || DEFAULTS.sourceDetail,
            country: pickStoredValue(fallbackRecords, ['Country']) || DEFAULTS.country,
            firstName: pickStoredValue(fallbackRecords, ['First Name', 'firstName']) || DEFAULTS.firstName,
            lastName: pickStoredValue(fallbackRecords, ['Last Name', 'lastName']) || DEFAULTS.lastName,
            preferredName: DEFAULTS.preferredName,
            addressLine1: pickStoredValue(fallbackRecords, ['Address Line 1', 'addressLine1', 'Street Address']) || DEFAULTS.addressLine1,
            city: pickStoredValue(fallbackRecords, ['City']) || DEFAULTS.city,
            state: pickStoredValue(fallbackRecords, ['State', 'Region']) || DEFAULTS.state,
            postalCode: pickStoredValue(fallbackRecords, ['Postal Code', 'postalCode', 'Zip Code']) || DEFAULTS.postalCode,
            phoneType: pickStoredValue(fallbackRecords, ['Phone Device Type', 'phoneType']) || DEFAULTS.phoneType,
            countryPhoneCode: pickStoredValue(fallbackRecords, ['Country Phone Code', 'countryPhoneCode']) || DEFAULTS.countryPhoneCode,
            phoneNumber: pickStoredValue(fallbackRecords, ['Phone Number', 'phoneNumber']) || DEFAULTS.phoneNumber,
            phoneExtension: pickStoredValue(fallbackRecords, ['Phone Extension', 'phoneExtension']) || DEFAULTS.phoneExtension
        };
        const merged = { ...fallbacks };
        for (const [key, value] of Object.entries(stored)) {
            if (typeof value === 'boolean' || clean(value)) merged[key] = value;
        }
        return merged;
    }

    async function setRememberedText(selector, value, label, context = autoActionContext()) {
        const input = document.querySelector(selector);
        if (!input || !value || clean(input.value) === clean(value)) return;
        await performDelayedAction(() => setNativeValue(input, value), `Filling ${label}`, context);
        await WAIT(FIELD_SETTLE_MS);   // let the field commit before the next one is clicked
    }

    async function setRememberedPicker(selector, value, label, context = autoActionContext()) {
        const control = document.querySelector(selector);
        if (!control) return true;
        // Skip-if-already-filled (user, 2026-07-25): a My Information search-and-pick field that
        // already holds a real value is DONE — don't reopen it, don't re-search, don't clear and
        // refill, even when it differs from the stored profile value. These values come from the
        // user's own Workday candidate profile, so keeping them is the safer direction, and
        // churning slow pickers is exactly what the user asked us to stop doing. Placeholders
        // ("Select One") are not values — see pickerSelectedValue.
        // Deliberately NOT applied to screening questions / Voluntary Disclosures / Self Identify,
        // which must still CORRECT a wrong prefill (selectOption + runRegexChoiceStep).
        if (pickerSelectedValue(control)) return true;
        if (!value) return true;
        // NOTE: opens via clickPickerOpener — AVEVA's Phone Device Type button ignores a bare click.
        await clickPickerOpener(control, `Opening ${label}`, context);
        const choice = await waitForChoice(value, 12000, context);
        if (!choice) return false;
        await clickPickerChoice(choice, `Selecting ${label}`, context);
        return true;
    }

    async function captureWorkdayInfo() {
        const existing = (await storageGet([WORKDAY_INFO_KEY]))[WORKDAY_INFO_KEY] || {};
        const source = document.querySelector('#source--source');
        const phoneCode = document.querySelector('#phoneNumber--countryPhoneCode');
        const keepKnown = (value, key) => clean(value) || existing[key] || '';
        const info = {
            ...existing,
            // Record whatever the tenant actually has selected. The old hardcoded
            // 'Job Board' / 'LinkedIn' fallbacks persisted a FALSE attribution into
            // workdaySavedAnswers once the source became first-option-always, so they are gone;
            // a placeholder reads as empty via pickerSelectedValue.
            sourceDetail: keepKnown(pickerSelectedValue(source), 'sourceDetail'),
            country: keepKnown(selectedItemText(document.querySelector('#country--country')), 'country'),
            firstName: keepKnown(document.querySelector('#name--legalName--firstName')?.value, 'firstName'),
            lastName: keepKnown(document.querySelector('#name--legalName--lastName')?.value, 'lastName'),
            preferredName: Boolean(document.querySelector('#name--preferredCheck')?.checked),
            addressLine1: keepKnown(document.querySelector('#address--addressLine1')?.value, 'addressLine1'),
            city: keepKnown(document.querySelector('#address--city')?.value, 'city'),
            state: keepKnown(selectedItemText(document.querySelector('#address--countryRegion')), 'state'),
            postalCode: keepKnown(document.querySelector('#address--postalCode')?.value, 'postalCode'),
            email: keepKnown(document.querySelector('[data-automation-id="email"]')?.textContent, 'email'),
            phoneType: keepKnown(selectedItemText(document.querySelector('#phoneNumber--phoneType')), 'phoneType'),
            countryPhoneCode: keepKnown(selectedItemText(phoneCode), 'countryPhoneCode'),
            phoneNumber: keepKnown(document.querySelector('#phoneNumber--phoneNumber')?.value, 'phoneNumber'),
            phoneExtension: keepKnown(document.querySelector('#phoneNumber--extension')?.value, 'phoneExtension')
        };
        await storageSet({ [WORKDAY_INFO_KEY]: info });
        return info;
    }

    function manualFillResult(message, ok = true) {
        setStatus(message, ok ? 'complete' : 'waiting');
        // Stay on the 'apply' tab for the Workday template; never auto-switch to Step/Info.
        renderStep();
        return { ok, state: ok ? 'filled' : 'waiting', message };
    }

    // Manual stops on the current step and reports; Auto pauses the loop.
    function pauseOrManual(context, message) {
        return context.mode === 'manual' ? manualFillResult(message, false) : pause(message);
    }

    // After a successful advance, Manual stops on the newly rendered step; Auto returns the
    // raw advance result so its loop continues to the next step.
    function advancedResult(context, advanceResult) {
        return context.mode === 'manual'
            ? manualFillResult(`Filled and continued to ${currentStep()}. Auto is off, so Eve stopped here.`, true)
            : advanceResult;
    }

    // Answer Yes/No bank questions embedded in a non-Application-Questions step (single pass, no
    // advance, no pause). Fills matched blocks — selectOption no-ops a correct one and corrects a
    // wrong/empty one (skip-if-correct) — plus the "select all that apply" checkbox fallback (first 3
    // when >= 3, else 1st). Unmatched blocks are left untouched for that step's own handler.
    async function answerOnPageChoiceQuestions(context) {
        let entries;
        try { entries = await combinedChoiceEntries(); } catch { return; }
        for (const block of questionBlocks()) {
            if (!actionsAllowed(context)) return;
            const qText = questionBlockText(block);
            if (!qText) continue;
            const consent = consentCheckbox(block, qText);
            if (consent) { if (!consent.checked) await clickButton(consent, 'Accepting terms and conditions', context); continue; }
            const entry = entries.find(candidate =>
                !(candidate.exclude && candidate.exclude.test(qText)) && candidate.patterns.some(re => re.test(qText)));
            if (!entry) {
                const boxes = [...block.querySelectorAll('input[type="checkbox"]')].filter(cb => visible(cb) && !cb.disabled);
                if (boxes.length >= 2 && !boxes.some(cb => cb.checked)) {
                    const pick = boxes.length >= 3 ? boxes.slice(0, 3) : boxes.slice(0, 1);
                    for (const cb of pick) await clickButton(cb, 'Selecting an option', context);
                }
                continue;
            }
            await selectEntryOption(block, entry, context);
        }
    }

    async function handleMyInformation(context = autoActionContext(), { advance: shouldAdvance = true } = {}) {
        const stored = await loadMyInformationAnswers();
        if (!await ensureSourceSelected(context)) {
            const message = 'Pick a How Did You Hear About Us source, then click Apply again.';
            return context.mode === 'manual' ? manualFillResult(message, false) : pause(message.replace('Apply', 'Auto Apply'));
        }
        if (!actionsAllowed(context)) return { ok: false, state: 'stopped' };
        await setRememberedText('#name--legalName--firstName', stored.firstName, 'First Name', context);
        await setRememberedText('#name--legalName--lastName', stored.lastName, 'Last Name', context);
        await setRememberedText('#address--addressLine1', stored.addressLine1, 'Address Line 1', context);
        await setRememberedText('#address--city', stored.city, 'City', context);
        await setRememberedText('#address--postalCode', stored.postalCode, 'Postal Code', context);
        await setRememberedText('#phoneNumber--phoneNumber', stored.phoneNumber, 'Phone Number', context);
        await setRememberedText('#phoneNumber--extension', stored.phoneExtension, 'Phone Extension', context);
        await setRememberedPicker('#country--country', stored.country, 'Country', context);
        await setRememberedPicker('#address--countryRegion', stored.state, 'State', context);
        await setRememberedPicker('#phoneNumber--phoneType', stored.phoneType, 'Phone Device Type', context);
        await setRememberedPicker('#phoneNumber--countryPhoneCode', stored.countryPhoneCode, 'Country Phone Code', context);
        const preferred = document.querySelector('#name--preferredCheck');
        if (preferred && typeof stored.preferredName === 'boolean' && preferred.checked !== stored.preferredName) {
            await clickButton(preferred, 'Selecting preferred-name setting', context);
        }
        // Some tenants embed Yes/No bank questions on My Information too (e.g. Disney's "Have you ever
        // been employed by The Walt Disney Company?" -> prior-employment No). Answer them here.
        await answerOnPageChoiceQuestions(context);
        if (!actionsAllowed(context)) return { ok: false, state: 'stopped' };
        const info = await captureWorkdayInfo();
        const missing = [];
        // Source is satisfied by ANY selected value (whatever ensureSource picked or the user already
        // chose) — read the selected token, not the empty inner input. A free-text source input is
        // skipped by design, so it is never "missing". Only a genuinely empty *picker* is missing.
        const srcCtl = sourceControl();
        if (srcCtl && !sourceIsFreeText() && !pickerSelectedValue(srcCtl)) missing.push('How Did You Hear About Us');
        if (!info.country) missing.push('Country');
        if (!info.firstName) missing.push('First Name');
        if (!info.lastName) missing.push('Last Name');
        if (!info.phoneType) missing.push('Phone Device Type');
        if (!info.countryPhoneCode) missing.push('Country Phone Code');
        if (!info.phoneNumber) missing.push('Phone Number');
        if (missing.length) {
            // One item per line (user, 2026-07-27) — setStatus/bulletize renders each as a bullet.
            const message = [`Fill ${missing.length} required My Information field(s):`, ...missing].join('\n');
            return context.mode === 'manual' ? manualFillResult(message, false) : pause(message);
        }

        renderInfo();
        if (!shouldAdvance) return manualFillResult('Current Workday step filled. Review it, then continue manually.', true);
        const advanceResult = await advanceWorkdayStep(context, { message: 'Saving My Information' });
        if (advanceResult.ok) return advancedResult(context, advanceResult);
        if (advanceResult.state === 'submit-blocked') return pauseOrManual(context, 'Review is ready. Final submission requires explicit user approval.');
        if (advanceResult.state === 'unchanged') return pauseOrManual(context, `${advanceResult.actionLabel || 'Save and Continue'} was clicked, but Workday did not load a new step.`);
        if (advanceResult.state === 'stopped') return advanceResult;
        return pauseOrManual(context, 'My Information is saved, but Save and Continue is not available.');
    }

    // --- My Experience step (work experience, education, skills, cover letter) ---
    // Uses Workday's standard section/field automation-ids with label fallbacks. Selector
    // details are pending live XC confirmation; the handler fills what it can find and never
    // touches the Websites section. Resume is uploaded here if this step carries the Resume/CV
    // section and it isn't already uploaded (some tenants take it on a prior step instead).
    function isMyExperienceStep() {
        const main = getMain();
        if ([...main.querySelectorAll('h1, h2, h3')].filter(visible).some(node => /^my experience$/i.test(clean(node.textContent)))) return true;
        return Boolean(main.querySelector([
            '[data-automation-id="formField-jobTitle"]',
            '[data-automation-id="formField-companyName"]',
            '[data-automation-id="formField-schoolName"]',
            '[data-automation-id="formField-skills"]',
            'input[id^="workExperience-"][id$="--jobTitle"]',
            '[data-automation-id="formField-school"]',
            'input[id^="education-"][id$="--schoolName"]',
            'input[id^="education-"][id$="--school"]'
        ].join(', ')));
    }

    async function loadMyExperienceAnswers() {
        const stored = (await storageGet([WORKDAY_INFO_KEY]))[WORKDAY_INFO_KEY] || {};
        const override = stored.myExperience || {};
        const useArray = (value, fallback) => Array.isArray(value) && value.length ? value : fallback;
        return {
            workExperiences: useArray(override.workExperiences, DEFAULT_MY_EXPERIENCE.workExperiences),
            educations: useArray(override.educations, DEFAULT_MY_EXPERIENCE.educations),
            // `languages` is the current shape; a legacy single `language` override still works.
            languages: useArray(
                override.languages || (override.language ? [override.language] : null),
                DEFAULT_MY_EXPERIENCE.languages
            ),
            levelCandidates: useArray(override.levelCandidates, DEFAULT_MY_EXPERIENCE.levelCandidates),
            skills: useArray(override.skills, DEFAULT_MY_EXPERIENCE.skills)
        };
    }

    function sectionByHeading(headingRe) {
        const heading = [...getMain().querySelectorAll('h2, h3, h4, legend, [role="heading"]')]
            .filter(visible)
            .find(node => headingRe.test(clean(node.textContent)));
        if (!heading) return null;
        let node = heading;
        for (let i = 0; i < 6 && node.parentElement; i += 1) {
            node = node.parentElement;
            if (node.querySelector('input, textarea, select, button, [role="button"]')) return node;
        }
        return heading.parentElement;
    }

    // Names of the real My Experience sections. Used to bound a section in document order — Workday
    // date sub-fields render their own "From"/"To" legends, so we must ignore those and key only on
    // real section headings, or the boundary before the Add button collapses.
    const SECTION_HEADING = /^(work experience|education|languages|skills|certifications?|licenses?|resume|cv|websites?|social network urls?|references?|follow us)\b/i;

    // Scope the section's Add / Add Another button by document order: it sits after this section's
    // heading and before the next real section heading, so sections' Add buttons don't collide.
    function sectionAddButton(headingRe) {
        const heads = [...getMain().querySelectorAll('h2, h3, h4, legend, [role="heading"]')]
            .filter(node => visible(node) && SECTION_HEADING.test(clean(node.textContent)));
        const heading = heads.find(node => headingRe.test(clean(node.textContent)));
        if (!heading) return null;
        const nextHead = heads[heads.indexOf(heading) + 1] || null;
        const buttons = [...getMain().querySelectorAll('button, [role="button"]')]
            .filter(button => visible(button) && !button.disabled)
            .filter(button => /^add( another)?$/i.test(clean(button.innerText || button.textContent || button.getAttribute('aria-label'))));
        const after = node => Boolean(heading.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING);
        const before = node => !nextHead || Boolean(nextHead.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING);
        return buttons.find(button => after(button) && before(button)) || null;
    }

    function entryContainer(anchor) {
        let node = anchor;
        for (let i = 0; i < 8 && node.parentElement; i += 1) {
            node = node.parentElement;
            if (node.matches('[data-automation-id*="panelSet"], [data-automation-id*="anel"], [data-automation-id*="workExperience"], [data-automation-id*="education"], fieldset, li')) return node;
        }
        return anchor.closest('fieldset, li, section') || anchor.parentElement;
    }

    function scopedControl(container, automationIds, labelRe) {
        const scope = container || getMain();
        for (const id of automationIds) {
            const found = [...scope.querySelectorAll(`[data-automation-id="${id}"]`)].filter(visible)[0];
            if (found) return found.matches('input, textarea, select') ? found : (found.querySelector('input, textarea, select') || found);
        }
        if (labelRe) {
            const field = getFields().find(entry => labelRe.test(clean(entry.label)) && (!container || container.contains(entry.input)));
            if (field) return field.input;
        }
        return null;
    }

    async function setScopedText(container, automationIds, labelRe, value, label, context) {
        if (!value) return true;
        const input = scopedControl(container, automationIds, labelRe);
        if (!input || !input.matches('input, textarea')) return false;
        if (clean(input.value) === clean(value)) return true;
        await performDelayedAction(() => setNativeValue(input, value), `Filling ${label}`, context);
        await WAIT(FIELD_SETTLE_MS);   // let the field commit before the next one is clicked
        return true;
    }

    async function setScopedPicker(container, automationIds, labelRe, value, label, context, options = {}) {
        const control = scopedControl(container, automationIds, labelRe);
        if (!control || !value) return false;
        if (normalizeKey(selectedItemText(control)).includes(normalizeKey(value))) return true;
        if (control.tagName === 'SELECT') {
            const target = value;
            const option = [...control.options].find(item => normalizeKey(item.textContent).includes(normalizeKey(target)))
                || (options.otherOnMissing ? [...control.options].find(item => /other/i.test(item.textContent)) : null);
            if (!option) return false;
            await performDelayedAction(() => { control.value = option.value; control.dispatchEvent(new Event('change', { bubbles: true })); }, `Selecting ${label}`, context);
            return true;
        }
        await clickPickerOpener(control, `Opening ${label}`, context);
        if (control.matches('input')) {
            await performDelayedAction(() => { setComboboxSearchValue(control, value); return true; }, `Searching ${label}`, context);
        }
        let choice = await waitForChoice(value, 8000, context);
        if (!choice && options.otherOnMissing) choice = await waitForChoice('Other', 6000, context);
        if (!choice) return false;
        await clickPickerChoice(choice, `Selecting ${label}`, context);
        return true;
    }

    // Live Workday My Experience DOM (confirmed via CDP on BlackRock 2026-07-16): entry inputs are
    // id-prefixed — `workExperience-<n>--jobTitle`, `education-<n>--schoolName`, etc. The automation-id
    // lives on the `formField-*` wrapper, not the input. School is a free-text field; Degree is a
    // listbox <button> (`<prefix>--degree`, "Select One"); dates use month/year spin inputs.
    function experienceAnchors(kind, anchorSuffix) {
        return [...document.querySelectorAll(`input[id^="${kind}-"][id$="--${anchorSuffix}"]`)].filter(visible);
    }

    // Count the real entries in a repeatable section by their id prefix (`education-1`,
    // `workExperience-2`, …), keying on ANY visible field of the entry — not a single suffix like
    // `schoolName`, which only exists on some tenants (e.g. a "School not listed" text box). Keying on
    // one suffix under-counts entries whose school/company is a picker, which made the add-loop keep
    // adding duplicates. Returns [{ prefix, anchor }] sorted by entry index.
    function experienceEntries(kind) {
        const re = new RegExp(`^(${kind}-\\d+)--`);
        const map = new Map();
        for (const el of document.querySelectorAll(`[id^="${kind}-"]`)) {
            const match = el.id.match(re);
            if (!match || !visible(el)) continue;
            if (!map.has(match[1])) map.set(match[1], el); // first visible field is the entry's anchor
        }
        return [...map.entries()]
            .sort((a, b) => Number(a[0].split('-')[1] || 0) - Number(b[0].split('-')[1] || 0))
            .map(([prefix, anchor]) => ({ prefix, anchor }));
    }

    function entryPrefix(anchor, anchorSuffix) {
        return anchor ? anchor.id.slice(0, anchor.id.length - `--${anchorSuffix}`.length) : null;
    }

    // Workday rejects these characters in free-text fields (e.g. Role Description reports
    // "Contains illegal characters < > [ ] " { } \"). Strip them so no stored value fails validation.
    function sanitizeWorkdayText(value) {
        return clean(String(value == null ? '' : value).replace(/[<>[\]"{}\\]/g, ''));
    }

    async function setEntryText(prefix, suffix, value, label, context) {
        const cleaned = sanitizeWorkdayText(value);
        if (!cleaned) return;
        const input = document.getElementById(`${prefix}--${suffix}`);
        if (!input || !input.matches('input, textarea') || clean(input.value) === cleaned) return;
        await performDelayedAction(() => setNativeValue(input, cleaned), `Filling ${label}`, context);
    }

    // Set one segment of a Workday date spinner WITHOUT blurring. Blurring an incomplete date
    // (e.g. month typed but year still empty) makes the widget invalidate and clear the segment —
    // that's what left "MM/2021". We fill every segment first, then commit the whole date once.
    function setDateSection(input, value) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        input.focus();
        if (setter) setter.call(input, value); else input.value = value;
        input.dispatchEvent(new InputEvent('input', { bubbles: true, data: String(value), inputType: 'insertText' }));
        input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Unidentified' }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    async function setEntryDate(prefix, which, value, label, context) {
        if (!value) return;
        const [monthRaw, yearRaw] = String(value).split('/');
        const month = monthRaw ? String(Number(monthRaw)) : '';
        const year = yearRaw || '';
        const monthInput = document.getElementById(`${prefix}--${which}-dateSectionMonth-input`);
        const yearInput = document.getElementById(`${prefix}--${which}-dateSectionYear-input`);
        if (!monthInput && !yearInput) return;
        const monthOk = () => !month || !monthInput || Number(clean(monthInput.value)) === Number(month);
        const yearOk = () => !year || !yearInput || clean(yearInput.value) === year;
        // Fill month + year together, then blur once to commit a complete valid date. Verify and
        // retry (the segmented spinner occasionally drops a section when filled quickly); only the
        // still-missing segment is re-typed.
        for (let attempt = 0; attempt < 3 && (!monthOk() || !yearOk()); attempt += 1) {
            if (!actionsAllowed(context)) return;
            await performDelayedAction(() => {
                if (monthInput && month && !monthOk()) setDateSection(monthInput, month);
                if (yearInput && year && !yearOk()) setDateSection(yearInput, year);
                const commitTarget = yearInput || monthInput;
                commitTarget.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
                try { commitTarget.blur(); } catch { }
                return true;
            }, `Filling ${label}`, context);
            await WAIT(200);
        }
        // Click a neutral empty place once so the date gadget closes and the value commits (user rule
        // 2026-07-25: "for the date picker, do the same — click the gadget, choose item, then click away").
        if (monthOk() && yearOk()) await clickAwayToCommit(context);
    }

    async function setEntryYear(prefix, which, value, label, context) {
        if (!value) return;
        const yearInput = document.getElementById(`${prefix}--${which}-dateSectionYear-input`);
        if (yearInput) await performDelayedAction(() => setNativeValue(yearInput, value), `Filling ${label}`, context);
    }

    // Degree precedence (glob '*' allowed) + options to exclude. "Master" alone would wrongly match
    // "Master of Business Administration (MBA)", so a master's target excludes MBA/business
    // administration and prefers "Post Graduate Degree"; an MBA target maps to Post Graduate too.
    function degreeSpec(value) {
        const v = String(value).toLowerCase();
        if (/\bmba\b/.test(v) || v.includes('business administration')) {
            return { candidates: ['Master of Business Administration*', 'MBA', 'Post Graduate Degree', 'Post*Graduate'], exclude: null };
        }
        if (v.includes('master') || (v.includes('graduate') && !v.includes('under'))) {
            // Leading '*' candidates match options that prefix the label with a code, e.g. Disney's
            // "M. - Masters degree" (normalizes to "m masters degree"). "*Masters Degree*" uniquely
            // hits the generic master's and never MBA ("…business administration") or MFA ("…fine arts").
            // User rule (2026-07-20): a master's is "MS" — prefer the MS / M.S. / MSc abbreviation
            // FIRST (Salesforce-style dropdowns list codes like MS, MAS, MBA, JD, MD, PhD, not full
            // names), then fall back to the full "Master of Science" wording on tenants that spell it out.
            return { candidates: ['MS', 'M.S.', 'M S', 'MSc', 'M.Sc.', 'Master of Science', 'Master of Arts', '*Master of Science*', '*Master of Arts*', '*Masters Degree*', '*Master s Degree*', 'Post Graduate Degree', '*Post Graduate*', 'Post*Graduate', 'Graduate Degree', "Master's Degree", 'Master*'], exclude: /mba|business administration|fine arts|\bmas\b|master of advanced/i };
        }
        if (v.includes('bachelor') || v.includes('undergrad')) {
            // Bachelor of Arts first; else a "B.S." / "Bachelor of Science" option (e.g. Disney's
            // "B.S. - Bachelor of Science" -> "b s bachelor of science"); never Fine Arts (B.F.A.).
            // Bachelor of Arts first (the applicant's actual degree), then the bare ABBREVIATION —
            // Guidewire's degree list is abbreviations only ("HS, GED, A.A., B.Eng., B.B.A., B.S.,
            // B.A., MBA, M.S., M.A., PhD, JD"), the same shape that made the master's need "M.S.".
            // B.S. is the fallback for tenants with no arts option; never Fine Arts (B.F.A.),
            // Business Administration (B.B.A.) or Engineering (B.Eng.) — the exclude covers the bare
            // abbreviations too, since "B.B.A." does not contain the words "business administration".
            return { candidates: ['Bachelor of Arts', 'B.A.', 'BA', 'B A', '*Bachelor of Arts*', 'Bachelor of Science', 'B.S.', 'BS', 'B S', '*Bachelor of Science*', 'Undergraduate Degree', '*Undergraduate*', 'Undergraduate', "Bachelor's Degree", 'Bachelor*'], exclude: /fine arts|business administration|^\s*b\.?b\.?a\.?\b|^\s*b\.?f\.?a\.?\b|^\s*b\.?eng\b/i };
        }
        if (v.includes('phd') || v.includes('doctor')) {
            return { candidates: ['Doctorate', 'Doctor of Philosophy', 'PhD', 'Post Graduate Degree'], exclude: null };
        }
        return { candidates: [value], exclude: null };
    }

    // Degree is a Workday listbox button ("select one"): open it, then pick by precedence, scrolling
    // a virtualized list until the winning option renders. MBA is excluded for a plain master's.
    async function setEntryDegree(prefix, value, context) {
        if (!value) return;
        const control = document.getElementById(`${prefix}--degree`);
        if (!control) return;
        const { candidates, exclude } = degreeSpec(value);
        // Native <select> (e.g. Salesforce's MS/MAS/MBA/JD/MD/PhD list): pick by precedence and set
        // the value directly — instant, no popup or virtualized-list scrolling ("go fast").
        if (control.tagName === 'SELECT') {
            const opts = [...control.options]
                .map(option => ({ option, text: clean(option.getAttribute('data-automation-label') || option.textContent) }))
                .filter(entry => entry.text && !(exclude && exclude.test(entry.text)));
            for (const candidate of candidates) {
                const hit = opts.find(entry => candidateMatch(entry.text, candidate));
                if (hit) {
                    if (control.value !== hit.option.value) {
                        await performDelayedAction(() => {
                            control.value = hit.option.value;
                            control.dispatchEvent(new Event('input', { bubbles: true }));
                            control.dispatchEvent(new Event('change', { bubbles: true }));
                            return true;
                        }, `Selecting Degree ${value}`, context);
                    }
                    return;
                }
            }
            return;
        }
        const button = control;
        const current = clean(button.textContent);
        if (current && !(exclude && exclude.test(current)) && candidates.some(candidate => candidateMatch(current, candidate))) return;
        if (!await clickButton(button, 'Opening Degree', context)) return;
        // User rule (2026-07-26): for Degree / any multi-option dropdown — open, WAIT 0.5s for the
        // options to render, click the target, then WAIT another 0.5s for the selection to commit
        // before moving to the next field.
        await WAIT(DROPDOWN_SETTLE_MS);
        const end = Date.now() + 8000;
        while (Date.now() < end) {
            if (!actionsAllowed(context)) return;
            const options = deepElements('[role="option"], [data-automation-id="promptOption"], [data-automation-id="menuItem"], [data-automation-id="promptLeafNode"], li[role="option"]')
                .filter(node => visible(node) && !node.closest('#eve-floating-ui'));
            const hit = pickByPrecedence(options, candidates, { excludeRe: exclude, fallbackFirst: false });
            if (hit) { await clickPickerChoice(hit, `Selecting Degree ${value}`, context); await WAIT(DROPDOWN_SETTLE_MS); return; }
            const list = [...document.querySelectorAll('[role="listbox"], [data-automation-id="activeListContainer"]')].find(node => node.scrollHeight > node.clientHeight && visible(node));
            if (list && list.scrollTop + list.clientHeight < list.scrollHeight) {
                list.scrollTop += Math.max(240, Math.floor(list.clientHeight * 0.75));
                list.dispatchEvent(new Event('scroll', { bubbles: true }));
            }
            await WAIT(200);
        }
    }

    // "Select with precedence": a candidate is a glob where '*' matches any run of characters
    // ANYWHERE (e.g. 'computer*science', 'computer*engineer*'). No '*' means an exact normalized
    // match. Matching is anchored at the start, so 'computer*science' matches "Computer Science and
    // Engineering" and 'english*' matches "English Language and Literature".
    function candidateMatch(optionText, candidate) {
        const opt = normalizeKey(optionText);
        if (String(candidate).includes('*')) {
            const src = String(candidate).split('*')
                .map(part => normalizeKey(part).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
                .join('.*');
            try { return new RegExp('^' + src).test(opt); } catch { return false; }
        }
        return opt === normalizeKey(candidate);
    }

    // Pick an option by precedence: the first candidate (in order) that matches any option wins;
    // among options the first in document order is returned. Excluded options are ignored. When no
    // candidate matches and fallbackFirst is set, return the first non-excluded option.
    function pickByPrecedence(optionEls, candidates, { excludeRe = null, fallbackFirst = false } = {}) {
        const opts = optionEls
            .map(el => ({ el, text: clean(el.getAttribute('data-automation-label') || el.textContent) }))
            .filter(option => option.text && !(excludeRe && excludeRe.test(option.text)));
        for (const candidate of candidates) {
            const hit = opts.find(option => candidateMatch(option.text, candidate));
            if (hit) return hit.el;
        }
        return fallbackFirst && opts.length ? opts[0].el : null;
    }

    async function waitForPrecedenceOption(candidates, timeoutMs, context, { excludeRe = null, fallbackFirst = false } = {}) {
        const end = Date.now() + timeoutMs;
        const selectors = '[role="option"], [data-automation-id="promptOption"], [data-automation-id="menuItem"]';
        let sawOptions = false;
        while (Date.now() < end) {
            if (!actionsAllowed(context)) return null;
            const optionEls = deepElements(selectors).filter(node => visible(node) && !node.closest('#eve-floating-ui'));
            if (optionEls.length) {
                sawOptions = true;
                const hit = pickByPrecedence(optionEls, candidates, { excludeRe });
                if (hit) return hit;
            }
            await WAIT(200);
        }
        // Rule exhausted: options were present but none matched -> first in the list, if allowed.
        if (fallbackFirst && sawOptions) {
            const optionEls = deepElements(selectors).filter(node => visible(node) && !node.closest('#eve-floating-ui'));
            return pickByPrecedence(optionEls, candidates, { excludeRe, fallbackFirst: true });
        }
        return null;
    }

    // Field of Study is a "select with precedence" picker on some tenants and free text on others.
    // Accepts a string or an ordered candidate array. Types the broadest concrete term to surface
    // options, then picks the highest-precedence match; falls back to typing the primary value.
    async function setEntryFieldOfStudy(prefix, fieldOfStudy, context) {
        const candidates = (Array.isArray(fieldOfStudy) ? fieldOfStudy : [fieldOfStudy]).filter(Boolean);
        if (!candidates.length) return;
        const input = document.getElementById(`${prefix}--fieldOfStudy`);
        if (!input || !input.matches('input, textarea')) return;
        const current = clean(selectedItemText(input)) || clean(input.value);
        if (current && candidates.some(candidate => candidateMatch(current, candidate))) return; // already acceptable
        // Search term = shortest literal stem (text before the first '*') to surface the widest set
        // of options; precedence then decides which one to click.
        const stems = candidates.map(candidate => String(candidate).split('*')[0].trim()).filter(Boolean);
        const primary = String(candidates[0]).replace(/\*/g, ' ').replace(/\s+/g, ' ').trim();
        const searchTerm = [...stems].sort((a, b) => a.length - b.length)[0] || primary;
        const isPicker = isSearchPickerControl(input);
        if (isPicker) {
            await clickButton(input, 'Opening Field of Study', context);
            if (await performDelayedAction(() => {
                setComboboxSearchValue(input, searchTerm);
                // Long-list pickers ("Partial List (First 500 Entries)" / "All") need Enter to run
                // the search and return matching results; typing alone only shows category headers.
                const key = { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 };
                input.dispatchEvent(new KeyboardEvent('keydown', key));
                input.dispatchEvent(new KeyboardEvent('keypress', key));
                input.dispatchEvent(new KeyboardEvent('keyup', key));
                return true;
            }, `Searching field of study ${searchTerm}`, context)) {
                await WAIT(PICKER_SEARCH_SETTLE_MS); // 0.5s for the filtered results to render, then select as soon as a match appears (waitForPrecedenceOption polls)
                // Precedence CHAIN only. User rule (2026-07-25): for Field of Study do NOT fall back to
                // "first option in the list" — that grabbed an unrelated first entry. Use the chain; if
                // nothing in the chain matches, leave it for the typed-primary fallback below (which the
                // chain's broad globs make rare). Still exclude "Partial List (First N Entries)" / "All".
                const headers = /partial list|first\s*\d+\s*entries|^all$|^recent$|^suggested/i;
                const option = await waitForPrecedenceOption(candidates, 4000, context, { fallbackFirst: false, excludeRe: headers });
                if (option) {
                    await clickPickerChoice(option, 'Selecting Field of Study', context);
                    await clickAwayToCommit(context); // click an empty place so the results list closes and the chip commits
                    return;
                }
            }
        }
        if (clean(input.value) !== primary) await performDelayedAction(() => setNativeValue(input, primary), 'Filling Field of Study', context);
    }

    async function fillWorkEntry(prefix, experience, context) {
        // setEntry* skip fields that already equal the target, so matching existing entries are untouched.
        await setEntryText(prefix, 'jobTitle', experience.jobTitle, 'Job Title', context);
        await setEntryText(prefix, 'companyName', experience.company, 'Company', context);
        await setEntryText(prefix, 'location', experience.location, 'Location', context);
        const check = document.getElementById(`${prefix}--currentlyWorkHere`);
        if (check && check.type === 'checkbox' && check.checked !== Boolean(experience.currentlyWorkHere)) {
            await clickButton(check, 'Setting currently work here', context);
        }
        await setEntryDate(prefix, 'startDate', experience.startDate, 'From', context);
        if (!experience.currentlyWorkHere) await setEntryDate(prefix, 'endDate', experience.endDate, 'To', context);
        await setEntryText(prefix, 'roleDescription', experience.description, 'Role Description', context);
    }

    // School or University is tenant-dependent: BlackRock renders a FREE-TEXT `--schoolName`, while
    // Bank of America / GHR renders a searchable multiselect picker at `--school`
    // (data-uxi-widget-type="selectinput", "0 items selected"). Handle both, and never invent a
    // school: if the search returns nothing our candidates match, leave it blank so the step pauses
    // and names the field rather than attaching a fabricated institution.
    async function setEntrySchool(prefix, education, context) {
        const name = sanitizeWorkdayText(education.school);
        if (!name) return;
        const input = document.getElementById(`${prefix}--school`) || document.getElementById(`${prefix}--schoolName`);
        if (!input || !input.matches('input, textarea')) return;
        const candidates = (Array.isArray(education.schoolCandidates) && education.schoolCandidates.length)
            ? [...education.schoolCandidates]
            : [name];
        const current = clean(selectedItemText(input)) || clean(input.value);
        if (current && candidates.some(candidate => candidateMatch(current, candidate))) return; // already acceptable
        const isPicker = isSearchPickerControl(input);
        if (!isPicker) {
            if (clean(input.value) !== name) {
                await performDelayedAction(() => setNativeValue(input, name), 'Filling School or University', context);
            }
            return;
        }
        const headers = /partial list|first\s*\d+\s*entries|^all$|^recent$|^suggested/i;
        // schoolNotListed -> try the tenant's own "Other" option BEFORE searching the real name
        // (user, 2026-07-27): for the undergrad entry the picker offers unrelated near-matches for
        // the real name, and "Other" is both the honest answer and the one the user picks by hand.
        if (education.schoolNotListed && await selectSchoolOther(input, name, context)) return;
        // Try the full name first, then progressively shorter stems — a long exact string often
        // returns nothing while a distinctive stem ("Buffalo") surfaces the real entry.
        const stems = [];
        for (const candidate of candidates) {
            const stem = String(candidate).split('*').filter(Boolean).map(part => part.trim()).filter(Boolean)[0];
            if (stem && !stems.includes(stem)) stems.push(stem);
        }
        for (const term of stems) {
            if (!actionsAllowed(context)) return;
            await clickButton(input, 'Opening School or University', context);
            const typed = await performDelayedAction(() => {
                setComboboxSearchValue(input, term);
                const key = { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 };
                input.dispatchEvent(new KeyboardEvent('keydown', key));
                input.dispatchEvent(new KeyboardEvent('keypress', key));
                input.dispatchEvent(new KeyboardEvent('keyup', key));
                return true;
            }, `Searching school ${term}`, context);
            if (!typed) continue;
            await WAIT(PICKER_SEARCH_SETTLE_MS);
            // Precedence only — no fallbackFirst, so we never attach an unrelated school.
            const option = await waitForPrecedenceOption(candidates, 4000, context, { excludeRe: headers });
            if (option) {
                await clickPickerChoice(option, 'Selecting School or University', context);
                await WAIT(200);
                if (clean(selectedItemText(input))) return;
            }
        }
        // Not in this tenant's list (Beijing International Studies University usually isn't).
        // Fall back to the tenant's own "Other" option — an honest answer the tenant provides, NOT a
        // fabrication, and NOT the first option (that would attach a real school never attended).
        // If picking Other reveals a free-text school-name box, put the real name in it.
        if (await selectSchoolOther(input, name, context)) return;
        // No match and no "Other" -> leave blank so the step pauses and names the field.
    }

    const SCHOOL_OTHER_RE = /^(other|other \(not listed\)|other\b.*not listed|school not listed|not listed|my school is not listed)$/i;

    async function selectSchoolOther(input, schoolName, context) {
        if (!actionsAllowed(context)) return false;
        await clickButton(input, 'Opening School or University', context);
        // TYPE "other" rather than clearing the box: some tenants only reveal options as you
        // type, and the exact-match regex below still guarantees the real "Other" entry is the
        // one picked, never a school whose name happens to contain the word.
        await performDelayedAction(() => {
            setComboboxSearchValue(input, 'other');
            const key = { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 };
            input.dispatchEvent(new KeyboardEvent('keydown', key));
            input.dispatchEvent(new KeyboardEvent('keyup', key));
            return true;
        }, 'Looking for an Other school option', context);
        await WAIT(PICKER_SEARCH_SETTLE_MS);
        const other = await waitForOptionMatching(text => SCHOOL_OTHER_RE.test(clean(text)), 3000, context);
        if (!other) return false;
        if (!await clickPickerChoice(other, 'Selecting Other school', context)) return false;
        await WAIT(400);
        // Some tenants reveal a free-text "School Name" box once Other is chosen — fill the real name.
        const freeText = [...document.querySelectorAll('input[type="text"], textarea')].find(node =>
            visible(node) && !node.disabled && !node.closest('#eve-floating-ui')
            && /school|university|institution/i.test(getLabel(node))
            && !isSearchPickerControl(node));
        if (freeText && clean(freeText.value) !== schoolName) {
            await performDelayedAction(() => setNativeValue(freeText, schoolName), 'Filling school name', context);
        }
        return Boolean(clean(selectedItemText(input)) || (freeText && clean(freeText.value)));
    }

    async function fillEducationEntry(prefix, education, context) {
        await setEntrySchool(prefix, education, context);
        await setEntryDegree(prefix, education.degree, context);
        await setEntryFieldOfStudy(prefix, education.fieldOfStudy, context);
        await setEntryYear(prefix, 'firstYearAttended', education.startYear, 'From', context);
        await setEntryYear(prefix, 'lastYearAttended', education.endYear, 'To', context);
    }

    // The panel that holds exactly one entry: climb from the anchor until the parent would also
    // contain a sibling entry's anchor. Works despite Workday panel wrappers lacking a per-entry id.
    function entryPanel(anchor, siblingAnchors) {
        let node = anchor;
        while (node.parentElement && node.parentElement !== getMain() && node.parentElement !== document.body) {
            if (siblingAnchors.some(other => other !== anchor && node.parentElement.contains(other))) break;
            node = node.parentElement;
        }
        return node;
    }

    // The Delete/trash button inside one entry's own panel (selector-name agnostic — matches by
    // automation-id or visible/aria label so it finds whatever delete control the tenant renders).
    function entryDeleteButton(anchor, siblingAnchors) {
        const panel = entryPanel(anchor, siblingAnchors);
        const buttons = [...panel.querySelectorAll('button, [role="button"]')].filter(button => visible(button) && !button.disabled);
        const isDelete = button => /delete|remove|trash/i.test(button.getAttribute('data-automation-id') || '')
            || /delete|remove/i.test(clean(button.getAttribute('aria-label') || button.textContent));
        return buttons.find(isDelete) || null;
    }

    // Some tenants confirm a panel-set deletion in a modal; click its confirm if one appears.
    async function confirmDeletionIfPrompted(context) {
        const confirm = document.querySelector('[data-automation-id="confirmationModalConfirmButton"], [data-automation-id="modalConfirmButton"]')
            || [...document.querySelectorAll('[role="dialog"] button, [data-automation-id*="odal"] button')]
                .find(button => visible(button) && /^(ok|delete|yes|confirm|remove)$/i.test(clean(button.textContent)));
        if (confirm) { await clickButton(confirm, 'Confirming deletion', context); await WAIT(500); }
    }

    // Reconcile a repeatable section to EXACTLY items.length entries, aligned to the info/profile:
    // delete extras from the tail (trash button), add any missing, then recheck/fill each entry in
    // order. Fields that already match are left untouched, so no duplicates and no needless rewrites.
    async function reconcileSection(kind, anchorSuffix, sectionRe, items, fillEntry, noun, context) {
        const want = items.length;
        let entries = experienceEntries(kind);
        const anchorsOf = list => list.map(entry => entry.anchor);
        // Too many entries on the page → delete extras from the tail (newest first) down to `want`.
        let guard = 0;
        while (entries.length > want && entries.length > 0 && guard++ < 12) {
            if (!actionsAllowed(context)) return;
            const tail = entries[entries.length - 1];
            const del = entryDeleteButton(tail.anchor, anchorsOf(entries));
            if (!del) break;
            const before = entries.length;
            if (!await clickButton(del, `Removing extra ${noun}`, context)) break;
            await WAIT(700);
            await confirmDeletionIfPrompted(context);
            entries = experienceEntries(kind);
            if (entries.length >= before) break; // deletion didn't register — stop rather than loop
        }
        // Too few → add until we reach `want`. Verify each Add actually created an entry; if the count
        // doesn't grow, stop immediately so we never runaway-add duplicate blank entries.
        guard = 0;
        while (entries.length < want && guard++ < 12) {
            if (!actionsAllowed(context)) return;
            const add = sectionAddButton(sectionRe);
            if (!add) break;
            const before = entries.length;
            if (!await clickButton(add, `Adding a ${noun}`, context)) break;
            await WAIT(700);
            entries = experienceEntries(kind);
            if (entries.length <= before) break; // Add didn't register a new entry — stop adding
        }
        // Recheck/fill each entry in order (fillEntry no-ops fields that already match).
        for (let index = 0; index < want && index < entries.length; index += 1) {
            if (!actionsAllowed(context)) return;
            const prefix = entries[index].prefix;
            if (prefix) await fillEntry(prefix, items[index], context);
        }
    }

    async function fillSkills(skills, context) {
        const input = document.getElementById('skills--skills')
            || document.querySelector('[data-automation-id="formField-skills"] input, input[aria-label*="Skill" i]');
        if (!input || !input.matches('input')) return false;
        for (const skill of skills) {
            if (!actionsAllowed(context)) return false;
            await clickButton(input, 'Opening Skills', context);
            if (!await performDelayedAction(() => { setComboboxSearchValue(input, skill); return true; }, `Searching skill ${skill}`, context)) return false;
            const choice = await waitForChoice(skill, 5000, context);
            if (choice) await clickPickerChoice(choice, `Adding skill ${skill}`, context);
        }
        return true;
    }

    // Return the smallest Workday form-field wrapper owned by a visible label. Language and Level
    // may be native selects or Workday listbox buttons, while their visible labels remain stable.
    function myExperienceFieldBlocks(scope, labelRe) {
        if (!scope) return [];
        const blocks = [];
        for (const label of [...scope.querySelectorAll('label, legend')].filter(visible)) {
            if (!labelRe.test(clean(label.textContent).replace(/\s*\*+\s*$/, ''))) continue;
            const block = label.closest('[data-automation-id*="formField"], fieldset') || label.parentElement;
            if (block && !blocks.includes(block)) blocks.push(block);
        }
        return blocks;
    }

    function myExperienceFieldBlock(scope, labelRe) {
        return myExperienceFieldBlocks(scope, labelRe)[0] || null;
    }

    function languageEntryPrefix(block) {
        const ids = block ? [...block.querySelectorAll('[id]')].map(node => node.id) : [];
        const match = ids.map(id => id.match(/^(language-\d+)--/i)).find(Boolean);
        return match ? match[1] : '';
    }

    // The repeatable Language entries on this step, in document order (Workday ids them
    // `language-0--...`, `language-1--...`). Falls back to one pseudo-entry scoped to the whole
    // section for tenants that render a single un-prefixed Language block.
    function languageEntryPanels(section) {
        const byPrefix = new Map();
        for (const node of [...section.querySelectorAll('[id]')].filter(visible)) {
            const match = node.id.match(/^(language-\d+)--/i);
            if (match && !byPrefix.has(match[1])) byPrefix.set(match[1], node);
        }
        if (!byPrefix.size) return [{ prefix: '', panel: section }];
        const list = [...byPrefix.entries()]
            .sort((a, b) => Number(a[0].split('-')[1] || 0) - Number(b[0].split('-')[1] || 0));
        const anchors = list.map(([, anchor]) => anchor);
        return list.map(([prefix, anchor]) => ({ prefix, panel: entryPanel(anchor, anchors) || section }));
    }

    // Fill ONE Language entry: the language, the fluent/native checkboxes, and every Level control.
    // Matched by ordered candidate patterns, never by a tenant's literal option text.
    async function fillLanguageEntry(section, panel, language, levelCandidates, context) {
        let languageBlock = myExperienceFieldBlock(panel, /^language$/i) || myExperienceFieldBlock(section, /^language$/i);
        if (!languageBlock) return { ok: false, message: 'Languages is required, but the Language control is unavailable.' };

        const languageName = clean(language?.name) || 'English';
        const candidates = language?.optionCandidates?.length ? [...language.optionCandidates] : [languageName];
        const languageOk = await selectOption(
            languageBlock,
            text => candidates.some(candidate => candidateMatch(text, candidate)),
            languageName,
            context
        );
        if (!languageOk) return { ok: false, message: `Languages is required, but ${languageName} could not be selected.` };

        // Selecting Language can reveal/re-render Fluent and Level, so resolve the live controls
        // again before touching them.
        await WAIT(300);
        languageBlock = myExperienceFieldBlock(panel, /^language$/i) || languageBlock;
        const prefix = languageEntryPrefix(languageBlock);
        const prefixScope = prefix ? [...section.querySelectorAll(`[id^="${prefix}--"]`)] : [];
        const boxes = [...panel.querySelectorAll('input[type="checkbox"]')].filter(box => visible(box) && !box.disabled);
        const fluent = boxes.find(box => /\bfluent\b/i.test(clean(getLabel(box))))
            || prefixScope.find(node => node.matches?.('input[type="checkbox"]'))
            || [...section.querySelectorAll('input[type="checkbox"]')]
                .find(box => /fluent in this language/i.test(clean(getLabel(box))));
        if (language?.fluent !== false) {
            if (!fluent) return { ok: false, message: 'Languages is required, but the fluent checkbox is unavailable.' };
            if (!fluent.checked) await clickButton(fluent, `Confirming fluent in ${languageName}`, context);
        }
        // Separate "native language" box where the tenant offers one. User (2026-07-27): ticked on
        // BOTH English and Chinese.
        const nativeBox = boxes.find(box => box !== fluent && /\bnative\b/i.test(clean(getLabel(box))));
        if (nativeBox && Boolean(language?.native) !== nativeBox.checked) {
            await clickButton(nativeBox, `Setting native language (${languageName})`, context);
        }

        // Level / Proficiency: one control on most tenants, one per skill row on some.
        const levelBlocks = myExperienceFieldBlocks(panel, /^(level|.*proficiency|language ability|skill level)$/i);
        if (!levelBlocks.length) return { ok: false, message: 'Languages is required, but the Level control is unavailable.' };
        const levelName = clean(language?.level) || 'C2 (Proficient/Native Speaker)';
        for (const block of levelBlocks) {
            if (!actionsAllowed(context)) return { ok: false, message: 'Stopped.' };
            const levelOk = await selectOption(
                block,
                text => levelCandidates.some(candidate => candidateMatch(text, candidate)),
                levelName,
                context
            );
            if (!levelOk) return { ok: false, message: `Languages is required, but ${levelName} could not be selected.` };
        }
        return { ok: true };
    }

    async function fillRequiredLanguages(languages, levelCandidates, context) {
        const section = sectionByHeading(/^languages?$/i);
        if (!section) return { ok: true, filled: false };

        const languageBlock = myExperienceFieldBlock(section, /^language$/i);
        const levelBlock = myExperienceFieldBlock(section, /^level$/i);
        // An optional blank Languages section has no entry/required controls. Leave it untouched.
        if (!languageBlock && !levelBlock) return { ok: true, filled: false };
        const required = (languageBlock && blockRequired(languageBlock))
            || (levelBlock && blockRequired(levelBlock));
        if (!required) return { ok: true, filled: false };

        const wanted = (languages || []).filter(Boolean);
        if (!wanted.length) return { ok: true, filled: false };
        const levels = levelCandidates?.length ? [...levelCandidates] : ['C2*', 'Native*', 'Fluent*'];
        // Add entries until there is one per wanted language. Stop the moment an Add stops producing
        // a new entry, so a tenant that accepts only one language never runaway-adds.
        let panels = languageEntryPanels(section);
        let guard = 0;
        while (panels.length < wanted.length && guard++ < 6) {
            const add = sectionAddButton(/^languages?$/i);
            if (!add) break;
            const before = panels.length;
            if (!await clickButton(add, 'Adding a language', context)) break;
            await WAIT(700);
            panels = languageEntryPanels(sectionByHeading(/^languages?$/i) || section);
            if (panels.length <= before) break;
        }
        for (let index = 0; index < panels.length && index < wanted.length; index += 1) {
            if (!actionsAllowed(context)) return { ok: false, message: 'Stopped.' };
            const live = sectionByHeading(/^languages?$/i) || section;
            const panel = languageEntryPanels(live)[index]?.panel || panels[index].panel;
            const result = await fillLanguageEntry(live, panel, wanted[index], levels, context);
            // Only the first entry is the required one; a tenant that will not take a second
            // language must not fail the step.
            if (!result.ok && index === 0) return result;
        }
        return { ok: true, filled: true };
    }

    async function handleMyExperience(context = autoActionContext(), { advance: shouldAdvance = true } = {}) {
        // If this step carries the Resume/CV upload and it's not uploaded yet, upload it first —
        // then fill the rest and continue. Tenants that already took the resume on a prior step
        // have no Resume section here, so this is a no-op there.
        const resumeResult = await ensureStepResumeUploaded(context);
        if (!resumeResult.ok) {
            return context.mode === 'manual' ? manualFillResult(resumeResult.message, false) : pause(resumeResult.message);
        }
        if (!actionsAllowed(context)) return { ok: false, state: 'stopped' };
        // Cover letter (and any other supported doc input on this step) attaches silently.
        const artifactResult = await attachKnownArtifacts(context);
        if (!artifactResult.ok) {
            return context.mode === 'manual' ? manualFillResult(artifactResult.message, false) : pause(artifactResult.message);
        }
        const data = await loadMyExperienceAnswers();
        // Align each section to exactly the info/profile count: recheck existing entries field-by-field
        // (untouched when they already match), add any missing, and delete extras from the tail.
        await reconcileSection('workExperience', 'jobTitle', /work experience/i, data.workExperiences, fillWorkEntry, 'work experience', context);
        if (!actionsAllowed(context)) return { ok: false, state: 'stopped' };
        await reconcileSection('education', 'schoolName', /education/i, data.educations, fillEducationEntry, 'education', context);
        if (!actionsAllowed(context)) return { ok: false, state: 'stopped' };
        const languageResult = await fillRequiredLanguages(data.languages, data.levelCandidates, context);
        if (!languageResult.ok) {
            return context.mode === 'manual'
                ? manualFillResult(languageResult.message, false)
                : pause(languageResult.message);
        }
        if (!actionsAllowed(context)) return { ok: false, state: 'stopped' };
        // Skills section is intentionally skipped per user request (too many). Websites are also left untouched.
        if (FILL_SKILLS) {
            await fillSkills(data.skills, context);
        }

        if (!shouldAdvance) {
            return manualFillResult('My Experience reconciled to your profile: work experience and education aligned (extras removed, matches untouched), cover letter attached. Skills and Websites left untouched — review, then continue manually.', true);
        }
        const advanceResult = await advanceWorkdayStep(context, { message: 'Saving My Experience' });
        if (advanceResult.ok) return advancedResult(context, advanceResult);
        if (advanceResult.state === 'submit-blocked') return pauseOrManual(context, 'Review is ready. Final submission requires explicit user approval.');
        if (advanceResult.state === 'unchanged') return pauseOrManual(context, `${advanceResult.actionLabel || 'Save and Continue'} was clicked, but Workday did not load a new step.`);
        if (advanceResult.state === 'stopped') return advanceResult;
        return pauseOrManual(context, 'My Experience is filled, but Save and Continue is unavailable.');
    }

    function isApplicationQuestionsStep() {
        return /^application questions$/i.test(currentStep());
    }

    function globToRegExp(glob) {
        try {
            if (glob instanceof RegExp) return glob;
            const source = String(glob).replace(/[.+^${}()|[\]\\?]/g, '\\$&').replace(/\*/g, '[\\s\\S]*');
            return new RegExp(source, 'i');
        } catch { return null; }
    }

    // Default question bank merged with user-accumulated phrasings in workdaySavedAnswers.
    async function applicationQuestionBank() {
        const stored = (await storageGet([WORKDAY_INFO_KEY]))[WORKDAY_INFO_KEY] || {};
        const custom = Array.isArray(stored.applicationQuestions) ? stored.applicationQuestions : [];
        const bank = DEFAULT_APPLICATION_QUESTIONS.map(entry => ({ ...entry, patterns: [...entry.patterns] }));
        for (const raw of custom) {
            const patterns = (raw.patterns || []).map(globToRegExp).filter(Boolean);
            const followUp = raw.followUp?.text
                ? { patterns: (raw.followUp.patterns || ['*provide details*']).map(globToRegExp).filter(Boolean), text: raw.followUp.text }
                : null;
            const choose = /^no/i.test(String(raw.choose ?? raw.answer ?? 'yes')) ? 'no' : 'yes';
            // Users can pin a specific option (not just Yes/No) the same way voluntaryDisclosures do.
            const optionMatch = raw.optionMatch ? globToRegExp(raw.optionMatch) : null;
            const existing = raw.topic && bank.find(entry => entry.topic === raw.topic);
            if (existing) {
                existing.patterns.push(...patterns);
                if (followUp) existing.followUp = followUp;
                if (optionMatch) { existing.optionMatch = optionMatch; existing.optionLabel = raw.optionLabel || raw.answer || existing.optionLabel; }
            } else if (patterns.length) {
                bank.push({ topic: raw.topic || 'custom', patterns, exclude: raw.exclude ? globToRegExp(raw.exclude) : null, choose, optionMatch, optionLabel: raw.optionLabel || (optionMatch ? raw.answer : null), followUp });
            }
        }
        return bank;
    }

    // Voluntary Disclosures bank (defaults + user-accumulated phrasings), returned as generic
    // runRegexChoiceStep entries whose predicate matches the desired option as a substring.
    async function voluntaryDisclosureEntries() {
        const stored = (await storageGet([WORKDAY_INFO_KEY]))[WORKDAY_INFO_KEY] || {};
        const custom = Array.isArray(stored.voluntaryDisclosures) ? stored.voluntaryDisclosures : [];
        const bank = DEFAULT_VOLUNTARY_DISCLOSURES.map(entry => ({ ...entry, patterns: [...entry.patterns] }));
        for (const raw of custom) {
            const patterns = (raw.patterns || []).map(globToRegExp).filter(Boolean);
            const optionMatch = raw.optionMatch
                ? globToRegExp(raw.optionMatch)
                : (raw.answer ? globToRegExp(`*${raw.answer}*`) : null);
            const existing = raw.topic && bank.find(entry => entry.topic === raw.topic);
            if (existing) {
                existing.patterns.push(...patterns);
                if (optionMatch) existing.optionMatch = optionMatch;
                if (raw.label || raw.answer) existing.label = raw.label || raw.answer;
            } else if (patterns.length && optionMatch) {
                bank.push({ topic: raw.topic || 'custom', patterns, exclude: raw.exclude ? globToRegExp(raw.exclude) : null, optionMatch, label: raw.label || raw.answer || 'answer', search: raw.search });
            } else if (existing && raw.search) {
                existing.search = raw.search;
            }
        }
        return bank.map(entry => ({
            topic: entry.topic,
            patterns: entry.patterns,
            exclude: entry.exclude || null,
            predicate: text => entry.optionMatch.test(text),
            // Ordered fallbacks for granular option lists (see `optionCandidates` on the race entry):
            // each is tried as its own full pass over the options, most specific first, so a tenant
            // that offers "Chinese" is preferred over a generic "Asian" and over "Asian - Not Listed".
            optionCandidates: Array.isArray(entry.optionCandidates) ? entry.optionCandidates : null,
            label: entry.label,
            search: entry.search || null
        }));
    }

    // Outermost Workday question blocks on the step (a block contained by another is dropped),
    // so each block is one question with its explanation and control.
    function questionBlocks() {
        const main = getMain();
        const all = [...main.querySelectorAll('[data-automation-id*="formField"], fieldset')]
            .filter(node => visible(node) && !node.closest('#eve-floating-ui'));
        return all.filter(node => !all.some(other => other !== node && other.contains(node)));
    }

    // Question + explanation text with the interactive controls and option lists removed.
    function questionBlockText(container) {
        if (!container) return '';
        const clone = container.cloneNode(true);
        clone.querySelectorAll('input, textarea, select, button, [role="option"], [role="listbox"], [role="menu"], [data-automation-id="selectedItem"], [data-automation-id="promptOption"]')
            .forEach(node => node.remove());
        return clean(clone.innerText || clone.textContent);
    }

    function blockChoiceOpener(container) {
        return container.querySelector('select')
            || container.querySelector('button[aria-haspopup], [aria-haspopup="listbox"], [data-automation-id="selectShowAll"]')
            || container.querySelector('[data-automation-id="multiSelectContainer"] input')
            || container.querySelector('[data-automation-id="multiSelectContainer"]')
            || [...container.querySelectorAll('button, [role="button"], [role="combobox"]')].find(node => visible(node) && !node.closest('#eve-floating-ui'))
            || null;
    }

    function blockTextInput(container) {
        return [...container.querySelectorAll('textarea, input[type="text"], input:not([type])')]
            .find(node => visible(node) && !node.disabled) || null;
    }

    function blockAnswered(container) {
        const select = container.querySelector('select');
        if (select && clean(select.value)) return true;
        if ([...container.querySelectorAll('input[type="radio"]')].some(radio => radio.checked)) return true;
        if ([...container.querySelectorAll('input[type="checkbox"]')].some(box => box.checked)) return true;
        const opener = blockChoiceOpener(container);
        if (opener && opener.tagName !== 'SELECT') {
            const selected = clean(selectedItemText(opener));
            // Shared placeholder definition (Citi labels it " Select One Required").
            if (selected && !PICKER_PLACEHOLDER.test(selected)) return true;
        }
        const textInput = blockTextInput(container);
        return Boolean(textInput && clean(textInput.value));
    }

    // A lone acknowledgement/consent checkbox on a Voluntary Disclosures / Application Questions
    // block (e.g. "Terms and Conditions … By clicking 'Yes'" with a single "Yes *" box). These are
    // always required and always affirmative, so we always check them. Matched by the block's text,
    // a consent-flavored label, a bare "Yes" label, or the box being required.
    const CONSENT_BLOCK_TEXT = /terms and conditions|acknowledge|i consent|i agree|i certify|privacy (notice|policy|statement)|by clicking\s*"?\s*yes/i;
    function consentCheckbox(block, blockText) {
        const boxes = [...block.querySelectorAll('input[type="checkbox"]')].filter(box => visible(box) && !box.disabled);
        if (boxes.length !== 1) return null;
        const box = boxes[0];
        // Never treat a disability self-ID option as a consent box — it's a real single-select
        // answer owned by handleSelfIdentify, not an acknowledgement to auto-check.
        if (/disabilitystatus/i.test(box.id || '') || /have a disability|do not want to answer/i.test(blockText)) return null;
        const label = normalizeKey(getLabel(box));
        const looksLikeConsent = CONSENT_BLOCK_TEXT.test(blockText)
            || /\b(agree|consent|acknowledge|certify|accept|confirm)\b/.test(label)
            || label === 'yes'
            || box.required
            || box.getAttribute('aria-required') === 'true';
        return looksLikeConsent ? box : null;
    }

    function yesNoPredicate(choose) {
        return choose === 'no'
            ? text => /^no\b/i.test(text) || normalizeKey(text) === 'no'
            : text => /^yes\b/i.test(text) || normalizeKey(text) === 'yes';
    }

    async function waitForOptionMatching(pred, timeoutMs, context) {
        const end = Date.now() + timeoutMs;
        const selectors = '[role="option"], [data-automation-id="promptOption"], [data-automation-id="menuItem"], li[role="option"], [role="menuitemradio"]';
        while (Date.now() < end) {
            if (!actionsAllowed(context)) return null;
            const option = deepElements(selectors)
                .filter(node => visible(node) && !node.closest('#eve-floating-ui'))
                .find(node => pred(clean(node.getAttribute('data-automation-label') || node.textContent)));
            if (option) return option;
            await WAIT(200);
        }
        return null;
    }

    async function selectCustomDropdownOption(container, opener, pred, label, context, searchText) {
        if (pred(clean(selectedItemText(opener)))) return true;
        const isMulti = Boolean(container.querySelector('[data-automation-id="multiSelectContainer"]'));
        await closeStrayPrompts(opener, context);
        if (!await clickPickerOpener(opener, `Opening ${label}`, context)) return false;
        await WAIT(DROPDOWN_SETTLE_MS);
        const ownedList = await waitForOwnedOptionList(opener, 2000, context);
        const optText = node => clean(node.getAttribute('data-automation-label') || node.textContent);
        const parentTerm = clean(searchText);
        const parentMatch = node => {
            if (!parentTerm) return false;
            const key = normalizeKey(optText(node));
            const wanted = normalizeKey(parentTerm);
            return key === wanted || key.startsWith(`${wanted} `);
        };
        const option = await scrollScanOption(node => pred(optText(node)) || parentMatch(node), 9000, context, ownedList);
        if (!option) { await closeStrayPrompts(null, context); return false; }
        let leaf = option;
        if (!pred(optText(option))) {
            if (!await clickPickerChoice(option, `Opening ${label} options`, context)) return false;
            await WAIT(400);
            leaf = await scrollScanOption(node => pred(optText(node)), 6000, context, ownedList);
            if (!leaf) { await closeStrayPrompts(null, context); return false; }
        }
        const picked = await clickPickerChoice(leaf, `Selecting ${label}`, context);
        if (picked) await WAIT(DROPDOWN_SETTLE_MS);
        if (picked && isMulti) {
            const outside = getMain();
            outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            outside.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            return true;
        }
        if (!picked) { await closeStrayPrompts(null, context); return false; }
        if (await waitForChosenOption(opener, pred, 3000, context)) return true;
        await closeStrayPrompts(null, context);
        return false;
    }

    // Select the option matching `pred(optionText)` for one question block across a native select,
    // a Workday custom dropdown, radios, or checkboxes — in that precedence order. `pred` may
    // match a substring so the stored answer can be part of a longer option.
    async function selectOption(container, pred, label, context, searchText) {
        const select = container.querySelector('select');
        if (select) {
            const option = [...select.options].find(item => pred(clean(item.textContent)));
            if (option) {
                if (clean(select.value) === option.value) return true;
                return performDelayedAction(() => {
                    select.value = option.value;
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                }, `Selecting ${label}`, context);
            }
        }
        // User rule 2026-07-27: prefer dropdown/combobox answers. If the dropdown has no matching
        // option, continue and try the checkbox/multi-checkbox rendering of the same question.
        const opener = blockChoiceOpener(container);
        if (opener && opener.tagName !== 'SELECT'
            && await selectCustomDropdownOption(container, opener, pred, label, context, searchText)) return true;
        const radios = [...container.querySelectorAll('input[type="radio"]')].filter(radio => visible(radio) && !radio.disabled);
        if (radios.length) {
            const match = radios.find(radio => pred(clean(getLabel(radio))) || pred(clean(radio.value)));
            if (!match) return false;
            if (match.checked) return true;
            return performDelayedAction(() => {
                match.click();
                match.dispatchEvent(new Event('change', { bubbles: true }));
            }, `Selecting ${label}`, context);
        }
        // Checkbox-rendered choices. Some tenants (Bank of America / GHR) render a single-answer
        // question — e.g. "Would you consider relocating…" with three mutually exclusive options —
        // as checkboxes instead of radios. A bank entry means the question has ONE right answer, so
        // tick the match and clear every other box: a wrong prefill must not survive alongside it.
        // Genuine "select all that apply" questions have no entry and never reach here — they take
        // the first-N checkbox fallback in runRegexChoiceStep.
        const boxes = [...container.querySelectorAll('input[type="checkbox"]')].filter(box => visible(box) && !box.disabled);
        if (boxes.length) {
            const match = boxes.find(box => pred(clean(getLabel(box))) || pred(clean(box.value)));
            if (!match) return false;
            for (const box of boxes) {
                if (box !== match && box.checked) await clickButton(box, `Clearing ${label}`, context);
            }
            if (match.checked) return true;
            return performDelayedAction(() => {
                match.click();
                match.dispatchEvent(new Event('change', { bubbles: true }));
            }, `Selecting ${label}`, context);
        }
        return false;
    }

    // Workday renders a custom dropdown's options in a PORTAL at <body> level (not inside the
    // question block) and links it to its opener with `aria-controls`. Resolving that link lets an
    // option scan stay inside the list this control actually owns.
    function ownedOptionList(opener) {
        const id = clean(opener?.getAttribute?.('aria-controls') || opener?.getAttribute?.('aria-owns'));
        if (!id) return null;
        const node = document.getElementById(id);
        return node && visible(node) ? node : null;
    }

    async function waitForOwnedOptionList(opener, timeoutMs, context) {
        const end = Date.now() + timeoutMs;
        while (Date.now() < end) {
            if (!actionsAllowed(context)) return null;
            const list = ownedOptionList(opener);
            if (list) return list;
            await WAIT(100);
        }
        return null;
    }

    // Close every open Workday prompt except `except` (pass null to close all). A prompt left open
    // overlaps the next question and leaks its options into the shared portal.
    async function closeStrayPrompts(except, context = autoActionContext()) {
        const open = [...document.querySelectorAll('[aria-haspopup="listbox"][aria-expanded="true"]')]
            .filter(node => node !== except && !node.closest('#eve-floating-ui'));
        if (!open.length) return;
        if (!actionsAllowed(context)) return;
        for (const node of open) {
            node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
        }
        await WAIT(150);
        // Some tenants only dismiss on an outside pointer interaction.
        if ([...document.querySelectorAll('[aria-haspopup="listbox"][aria-expanded="true"]')].some(node => node !== except)) {
            const outside = getMain();
            outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            outside.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await WAIT(150);
        }
    }

    // Poll until the control reports a value the predicate accepts (the pick really landed).
    async function waitForChosenOption(opener, pred, timeoutMs, context) {
        const end = Date.now() + timeoutMs;
        while (Date.now() < end) {
            if (!actionsAllowed(context)) return false;
            if (pred(clean(selectedItemText(opener)))) return true;
            await WAIT(100);
        }
        return false;
    }

    // Scan the open prompt for an option `match` accepts, scrolling the virtualized listbox until it
    // renders (or the list stops moving). Returns the matching option node, or null on timeout.
    async function scrollScanOption(match, timeoutMs, context = autoActionContext(), root = null) {
        const selectors = '[role="option"], [data-automation-id="promptOption"], [data-automation-id="menuItem"], li[role="option"], [role="menuitemradio"]';
        const end = Date.now() + timeoutMs;
        let lastTop = -1;
        let stalls = 0;
        // When the owning list is known, never look outside it — options from another question's
        // still-open prompt live in the same body-level portal and would match just as well.
        const scoped = () => (root && root.isConnected ? [...root.querySelectorAll(selectors)] : deepElements(selectors));
        while (Date.now() < end) {
            if (!actionsAllowed(context)) return null;
            const hit = scoped()
                .filter(node => visible(node) && !node.closest('#eve-floating-ui'))
                .find(node => match(node));
            if (hit) return hit;
            const scrollRoots = root && root.isConnected
                ? [root, ...root.querySelectorAll('[role="listbox"], [data-automation-id="activeListContainer"]')]
                : [...document.querySelectorAll('[role="listbox"], [data-automation-id="activeListContainer"]')];
            const list = scrollRoots
                .filter(node => visible(node) && node.scrollHeight > node.clientHeight)
                .sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
            if (list) {
                if (list.scrollTop === lastTop) { if (++stalls > 2) return null; } else stalls = 0;
                lastTop = list.scrollTop;
                list.scrollTop = Math.min(list.scrollHeight, list.scrollTop + Math.max(240, Math.floor(list.clientHeight * 0.8)));
                list.dispatchEvent(new Event('scroll', { bubbles: true }));
            }
            await WAIT(150);
        }
        return null;
    }

    // Select a bank entry's answer in one question block. When the entry supplies ordered
    // `optionCandidates` (granular lists, e.g. race subgroups), try them most-specific-first, each
    // as its own full pass over the options, and stop at the first that lands. Entries without
    // candidates keep the single-predicate behaviour exactly as before.
    async function selectEntryOption(container, entry, context) {
        const candidates = entry.optionCandidates;
        if (!candidates || !candidates.length) {
            return selectOption(container, entry.predicate, entry.label, context, entry.search);
        }
        for (const candidate of candidates) {
            if (!actionsAllowed(context)) return false;
            if (await selectOption(container, text => candidate.test(text), entry.label, context, entry.search)) return true;
        }
        return false;
    }

    async function answerChoice(container, choose, context) {
        return selectOption(container, yesNoPredicate(choose), choose === 'no' ? 'No' : 'Yes', context);
    }

    async function answerTextInput(input, value, message, context) {
        const cleaned = sanitizeWorkdayText(value);
        if (!input || !cleaned) return false;
        if (clean(input.value) === cleaned) return true; // already the intended value — leave it
        // Refill when empty OR when the current text differs (user cleared or changed it).
        return performDelayedAction(() => setNativeValue(input, cleaned), message, context);
    }

    // A conditional text field revealed after a Yes answer, at or after the answered block.
    async function waitForFollowUpField(afterBlock, patterns, timeoutMs, context) {
        const end = Date.now() + timeoutMs;
        while (Date.now() < end) {
            if (!actionsAllowed(context)) return null;
            const candidates = questionBlocks().filter(block =>
                block === afterBlock || (afterBlock.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING));
            for (const block of candidates) {
                const input = blockTextInput(block);
                if (!input) continue; // find the details field regardless of its current content
                const text = questionBlockText(block);
                if (patterns.some(re => re.test(text)) || /provide details|please explain/i.test(text)) {
                    return { block, input };
                }
            }
            await WAIT(200);
        }
        return null;
    }

    async function persistSeenQuestions(seen) {
        if (!seen.length) return;
        try {
            const stored = (await storageGet([WORKDAY_INFO_KEY]))[WORKDAY_INFO_KEY] || {};
            const prev = Array.isArray(stored.applicationQuestionsSeen) ? stored.applicationQuestionsSeen : [];
            const merged = [...prev];
            for (const question of seen) {
                const short = question.slice(0, 220);
                if (short && !merged.includes(short)) merged.push(short);
            }
            if (merged.length !== prev.length) {
                await storageSet({ [WORKDAY_INFO_KEY]: { ...stored, applicationQuestionsSeen: merged } });
            }
        } catch { }
    }

    function blockRequired(block) {
        return /\*/.test(clean(block.innerText)) || Boolean(block.querySelector('[aria-required="true"], [required]'));
    }

    // Shared engine for regex-matched single-choice steps (Application Questions, Voluntary
    // Disclosures, Self Identify): each `entry` has { topic, patterns, exclude?, predicate, label,
    // followUp? }. It matches each question block's text, selects the option `predicate` accepts,
    // fills any revealed follow-up text field, records unmatched required questions, and advances.
    async function runRegexChoiceStep(context, { advance: shouldAdvance = true } = {}, entries, stepLabel, advanceMessage) {
        const answeredBlocks = new WeakSet();
        const seen = [];
        let unmatched = [];
        for (let pass = 0; pass < 5; pass += 1) {
            if (!actionsAllowed(context)) return { ok: false, state: 'stopped' };
            let actedThisPass = false;
            unmatched = [];
            for (const block of questionBlocks()) {
                if (!actionsAllowed(context)) return { ok: false, state: 'stopped' };
                if (answeredBlocks.has(block)) continue;
                const qText = questionBlockText(block);
                if (!qText) continue;
                if (!seen.includes(qText)) seen.push(qText);
                // Terms/consent acknowledgement checkbox (e.g. "By clicking Yes"): always check it.
                const consent = consentCheckbox(block, qText);
                if (consent) {
                    if (!consent.checked && await clickButton(consent, 'Accepting terms and conditions', context)) actedThisPass = true;
                    answeredBlocks.add(block);
                    continue;
                }
                const entry = entries.find(candidate =>
                    !(candidate.exclude && candidate.exclude.test(qText)) && candidate.patterns.some(re => re.test(qText)));
                if (entry && entry.textAnswer) {
                    // Free-text question (e.g. "preferred geographic location"): fill the textarea/
                    // input directly, only when empty (don't clobber a user edit), then mark done.
                    const textInput = [...block.querySelectorAll('textarea, input[type="text"]')].filter(visible)[0];
                    if (textInput) {
                        if (!clean(textInput.value)) {
                            await answerTextInput(textInput, entry.textAnswer, `Answering ${entry.topic}`, context);
                            if (clean(textInput.value)) actedThisPass = true;
                        }
                        answeredBlocks.add(block);
                        continue;
                    }
                    // No text control found in this block — fall through to the no-entry handling.
                }
                // A text-answer entry whose block has no text control falls back to the generic
                // handling — unless it also declares a Yes/No choice, in which case that choice is
                // the real answer and we let the normal option path below run.
                if (!entry || (entry.textAnswer && !entry.hasChoice)) {
                    // Required "select all that apply" multi-checkbox with no specific bank answer
                    // (e.g. Disney "reasons you applied", or a relocation grid): user rule — tick the
                    // first 3 when there are >= 3 options, else just the 1st. Never re-touch if any
                    // box is already checked (skip-if-correct).
                    const boxes = [...block.querySelectorAll('input[type="checkbox"]')].filter(cb => visible(cb) && !cb.disabled);
                    if (boxes.length >= 2) {
                        if (!boxes.some(cb => cb.checked)) {
                            const pick = boxes.length >= 3 ? boxes.slice(0, 3) : boxes.slice(0, 1);
                            for (const cb of pick) { if (await clickButton(cb, 'Selecting an option', context)) actedThisPass = true; }
                        }
                        answeredBlocks.add(block);
                        continue;
                    }
                    if (blockRequired(block) && !blockAnswered(block)) unmatched.push(qText.slice(0, 90));
                    continue;
                }
                // Always re-select the mapped answer (corrects a wrong or empty prefill; a correct
                // one returns true without a redundant click).
                const filled = await selectEntryOption(block, entry, context);
                const answered = filled || blockAnswered(block);
                // A conditionally revealed "Please provide details" field can render up to ~1s after
                // the Yes. Wait for it to appear, let it settle, then (re)fill it — even when the
                // choice was already correct, since the user may have cleared or changed the text.
                let followUpDone = !entry.followUp;
                if (entry.followUp && answered) {
                    // Switching a prefilled No -> Yes re-renders (replaces) this question's DOM node,
                    // so `block` can be stale/detached — searching from it finds nothing. Wait for the
                    // revealed field, then re-find this question's block fresh before locating it.
                    await WAIT(800);
                    const key = qText.slice(0, 40);
                    const freshBlock = questionBlocks().find(candidate => questionBlockText(candidate).includes(key)) || block;
                    const details = await waitForFollowUpField(freshBlock, entry.followUp.patterns, 5000, context);
                    if (!details?.input) {
                        followUpDone = true; // no details field revealed — nothing to fill
                    } else {
                        await WAIT(500); // brief settle so the revealed field's value sticks
                        const before = clean(details.input.value);
                        await answerTextInput(details.input, entry.followUp.text, `Providing details for ${entry.topic}`, context);
                        if (clean(details.input.value) !== before) actedThisPass = true;
                        followUpDone = Boolean(clean(details.input.value));
                    }
                }
                if (answered && followUpDone) {
                    answeredBlocks.add(block); // fully done — don't revisit
                    if (filled) actedThisPass = true;
                } else if (!answered && blockRequired(block)) {
                    unmatched.push(qText.slice(0, 90));
                } else if (answered && !followUpDone) {
                    actedThisPass = true; // retry next pass so a slow details field still gets filled
                }
            }
            if (!actedThisPass) break;
        }

        await persistSeenQuestions(seen);

        if (unmatched.length) {
            // One item per line (user, 2026-07-27) — each unanswered question gets its own bullet.
            const message = [`Answer these ${unmatched.length} ${stepLabel} manually (no bank match):`, ...unmatched].join('\n');
            return context.mode === 'manual' ? manualFillResult(message, false) : pause(message);
        }
        if (!shouldAdvance) return manualFillResult(`${stepLabel} filled from the answer bank. Review, then continue manually.`, true);
        const advanceResult = await advanceWorkdayStep(context, { message: advanceMessage });
        if (advanceResult.ok) return advancedResult(context, advanceResult);
        if (advanceResult.state === 'submit-blocked') return pauseOrManual(context, 'Review is ready. Final submission requires explicit user approval.');
        if (advanceResult.state === 'unchanged') return pauseOrManual(context, `${advanceResult.actionLabel || 'Save and Continue'} was clicked, but Workday did not load a new step.`);
        if (advanceResult.state === 'stopped') return advanceResult;
        return pauseOrManual(context, `${stepLabel} filled, but Save and Continue is unavailable.`);
    }

    // Application Questions and Voluntary Disclosures can blur together: a step transition briefly
    // keeps the previous step label while the new DOM is already rendered, and some tenants render
    // both on one page. Both handlers therefore try the COMBINED bank. The two pattern sets don't
    // overlap (screening questions vs. demographic disclosures), so every block matches regardless
    // of which step label won the race — the demographic questions no longer fall through as
    // "no bank match" just because currentStep() momentarily still said "Application Questions".
    async function combinedChoiceEntries() {
        const bank = await applicationQuestionBank();
        const appEntries = bank.map(entry => ({
            topic: entry.topic,
            patterns: entry.patterns,
            exclude: entry.exclude,
            // Most screening questions are Yes/No. Some are pick-one-of-several where more than one
            // option starts with "Yes" ("Yes, at the company's expense" vs "Yes, at my own expense"),
            // so `optionMatch` lets an entry name the exact option instead of gambling on the order
            // a bare /^yes\b/ happens to hit.
            predicate: entry.optionMatch ? (text => entry.optionMatch.test(text)) : yesNoPredicate(entry.choose),
            label: entry.optionLabel || (entry.choose === 'no' ? 'No' : 'Yes'),
            followUp: entry.followUp,
            textAnswer: entry.text, // free-text answer (fills a textarea/input instead of a Yes/No choice)
            // An entry may carry BOTH a text answer and a Yes/No choice: tenants render the same
            // question as a textarea on one site and a dropdown on another. `hasChoice` says the
            // Yes/No path is a real answer, not the generic fallback.
            hasChoice: Boolean(entry.optionMatch || entry.choose)
        }));
        const disclosureEntries = await voluntaryDisclosureEntries();
        return [...appEntries, ...disclosureEntries];
    }

    async function handleApplicationQuestions(context = autoActionContext(), options = {}) {
        return runRegexChoiceStep(context, options, await combinedChoiceEntries(), 'Application Questions', 'Saving Application Questions');
    }

    function isVoluntaryDisclosuresStep() {
        return /^voluntary disclosures$/i.test(currentStep());
    }

    async function handleVoluntaryDisclosures(context = autoActionContext(), options = {}) {
        return runRegexChoiceStep(context, options, await combinedChoiceEntries(), 'Voluntary Disclosures', 'Saving Voluntary Disclosures');
    }

    // Self Identify = the "Voluntary Self-Identification of Disability" (CC-305) form: a required
    // Name, an optional date-signed, and a required single-select disability status rendered as
    // three checkboxes. This needs its own handler — the generic filler can't resolve Name, and the
    // consent-checkbox rule must never touch the required disability boxes. Default status is
    // "I do not want to answer" (override via workdaySavedAnswers.disabilityStatus).
    function isSelfIdentifyStep() {
        return /^self identify$/i.test(currentStep())
            || Boolean(document.getElementById('selfIdentifiedDisabilityData--name'))
            || /voluntary self-?identification of disability/i.test(clean(getMain().innerText));
    }

    async function handleSelfIdentify(context = autoActionContext(), { advance: shouldAdvance = true } = {}) {
        const stored = (await storageGet([WORKDAY_INFO_KEY]))[WORKDAY_INFO_KEY] || {};
        const info = await loadMyInformationAnswers();
        // Language = English (dropdown/select near a "Language" label), only when not already English.
        const langBlock = [...getMain().querySelectorAll('[data-automation-id*="formField"], fieldset')].filter(visible)
            .find(block => /^language\b/i.test(clean(block.querySelector('label, legend')?.textContent || '')));
        if (langBlock) {
            const opener = blockChoiceOpener(langBlock) || langBlock.querySelector('select');
            if (!/english/i.test(clean(selectedItemText(opener || langBlock)))) {
                await selectOption(langBlock, text => /english/i.test(text), 'English (Language)', context);
            }
        }
        const fullName = clean(stored.selfIdentifyName) || clean(`${info.firstName || ''} ${info.lastName || ''}`);
        const nameInput = document.getElementById('selfIdentifiedDisabilityData--name');
        if (nameInput && !clean(nameInput.value) && fullName) {
            await performDelayedAction(() => setNativeValue(nameInput, fullName), 'Filling Name', context);
        }
        // Date signed = today (MM/DD/YYYY). Set it whenever it isn't already today — even if the
        // field is prefilled with some other value (previously it was skipped when non-blank).
        const monthInput = document.getElementById('selfIdentifiedDisabilityData--dateSignedOn-dateSectionMonth-input');
        const dayInput = document.getElementById('selfIdentifiedDisabilityData--dateSignedOn-dateSectionDay-input');
        const yearInput = document.getElementById('selfIdentifiedDisabilityData--dateSignedOn-dateSectionYear-input');
        if (monthInput && dayInput && yearInput) {
            const now = new Date();
            const isToday = Number(clean(monthInput.value)) === now.getMonth() + 1
                && Number(clean(dayInput.value)) === now.getDate()
                && Number(clean(yearInput.value)) === now.getFullYear();
            if (!isToday) {
                await performDelayedAction(() => {
                    setDateSection(monthInput, String(now.getMonth() + 1));
                    setDateSection(dayInput, String(now.getDate()));
                    setDateSection(yearInput, String(now.getFullYear()));
                    yearInput.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
                    try { yearInput.blur(); } catch { }
                    return true;
                }, 'Filling date signed (today)', context);
            }
        }
        // Disability status: single-select checkboxes. Select the desired one whenever it is not
        // already checked — even if a different (prefilled) box is checked (Workday clears the others).
        const desired = clean(stored.disabilityStatus) || 'No, I do not have a disability';
        const boxes = [...getMain().querySelectorAll('input[type="checkbox"][id*="disabilityStatus"]')].filter(visible);
        if (boxes.length) {
            const pick = boxes.find(box => normalizeKey(getLabel(box)).includes(normalizeKey(desired)))
                || boxes.find(box => /\bno\b.*do not have a disability|do not have a disability/i.test(getLabel(box)));
            if (pick && !pick.checked) await clickButton(pick, 'Selecting disability self-identification', context);
        }

        if (!shouldAdvance) return manualFillResult('Self Identify filled. Review, then continue manually.', true);
        // Self Identify is prone to swallowing an early Continue click: the date-signed blur and the
        // single-select disability validation settle a beat AFTER the fields are filled, so a click
        // fired too quickly is ignored and the step never advances (the exact symptom the user hit).
        // Deterministic sequence: once everything required is filled, wait 1s, click Continue; if we
        // are still on the same step 2s later, click Continue once more.
        const beforeSelfIdentify = stepSignature();
        await WAIT(1000);
        let advanceResult = await advanceWorkdayStep(context, { message: 'Saving Self Identify' });
        if (!advanceResult.ok
            && (advanceResult.state === 'unchanged' || advanceResult.state === 'unavailable')
            && actionsAllowed(context)
            && stepSignature() === beforeSelfIdentify) {
            await WAIT(2000);
            if (stepSignature() === beforeSelfIdentify) {
                advanceResult = await advanceWorkdayStep(context, { message: 'Saving Self Identify (retry)' });
            }
        }
        if (advanceResult.ok) return advancedResult(context, advanceResult);
        if (advanceResult.state === 'submit-blocked') return pauseOrManual(context, 'Review is ready. Final submission requires explicit user approval.');
        if (advanceResult.state === 'unchanged') return pauseOrManual(context, `${advanceResult.actionLabel || 'Save and Continue'} was clicked, but Workday did not load a new step.`);
        if (advanceResult.state === 'stopped') return advanceResult;
        return pauseOrManual(context, 'Self Identify filled, but Save and Continue is unavailable.');
    }

    // Recognize the final Review page by ANCHOR ELEMENTS, not the URL/step label (which can go stale
    // on an SPA that never changes the URL): the footer action is "Submit", or the active progress
    // step reads "Review", or a centered "Review" heading sits above the read-only summary sections.
    function isReviewStep() {
        // Do NOT call currentStep() here. currentStep() → isMyInformationStep() → isReviewStep()
        // forms an infinite mutual recursion (RangeError: Maximum call stack size exceeded) whenever
        // currentStep() finds no known heading to return early on — e.g. the autofillWithResume
        // screen before React mounts its heading. That overflow propagates out of injectUI() (which
        // calls currentStep() while building the panel), so the floating panel never gets appended
        // and the popup silently fails to appear. The DOM signals below already detect Review
        // without needing currentStep(): footer Submit button, active-step text, and a "Review"
        // heading scan.
        const footer = document.querySelector('[data-automation-id="pageFooterNextButton"]');
        if (footer && visible(footer) && /^submit$/i.test(clean(footer.innerText || footer.textContent || footer.getAttribute('aria-label')))) return true;
        const active = clean(document.querySelector('[aria-current="step"], [data-automation-id="progressBarActiveStep"]')?.textContent);
        if (/\breview\b/i.test(active)) return true;
        return [...getMain().querySelectorAll('h1, h2, h3')].filter(visible).some(node => /^review$/i.test(clean(node.textContent)));
    }

    // Best-effort title/company for the unified Applied Jobs record. Workday rarely exposes a
    // clean title/company DOM node mid-flow, so document.title (commonly "Apply for <Job Title> -
    // Workday") and the tenant subdomain are an acceptable fallback — `url` is the reliable column
    // regardless. See AGENTS.md "Applied Jobs Log".
    function bestEffortWorkdayJobMeta() {
        const rawTitle = clean(document.title || '');
        const title = rawTitle.replace(/\s*[-|]\s*workday\s*$/i, '').replace(/^apply for\s+/i, '').trim() || rawTitle;
        const host = location.hostname || '';
        const company = clean(host.split('.')[0] || '') || host;
        return { title, company };
    }

    // Fire-and-forget: writes the unified cross-platform Applied Jobs record (Settings → Applied
    // Jobs tab) through the background handler. Never touches workdaySavedAnswers or blocks the
    // submit flow — any failure here is swallowed.
    function recordWorkdayApplication(context) {
        try {
            const meta = bestEffortWorkdayJobMeta();
            sendRuntimeMessage({
                type: 'eve:record-applied-job',
                record: {
                    platform: 'workday',
                    title: meta.title,
                    company: meta.company,
                    location: '',
                    url: location.href,
                    mode: context && context.mode === 'manual' ? 'manual' : 'auto',
                    appliedAt: new Date().toISOString(),
                    timestamp: Date.now()
                }
            }).catch(() => {});
        } catch { /* non-fatal */ }
    }

    // Final Review step. Per explicit user instruction the flow submits here (clicks the footer
    // Submit). Bypasses the Manual step-changing block via a direct delayed click so both an Auto
    // run and a user's Apply click on Review can submit.
    async function handleReviewSubmit(context = autoActionContext()) {
        if (!actionsAllowed(context)) return { ok: false, state: 'stopped' };
        const submit = document.querySelector('[data-automation-id="pageFooterNextButton"]');
        if (!submit || !/^submit$/i.test(clean(submit.innerText || submit.textContent || submit.getAttribute('aria-label')))) {
            return pauseOrManual(context, 'Review is ready, but the Submit button was not found.');
        }
        setStatus('Submitting the application…', 'running');
        const before = stepSignature();
        submit.scrollIntoView({ block: 'center', behavior: 'instant' });
        const clicked = await performDelayedAction(() => { submit.click(); return true; }, 'Submitting application', context);
        if (!clicked) return { ok: false, state: 'stopped' };
        await waitForStepChange(before, 12000);
        setStatus('Application submitted.', 'complete');
        recordWorkdayApplication(context);
        return { ok: true, state: 'submitted' };
    }

    function isAutofillWithResumeStep() {
        return /^autofill with resume$/i.test(currentStep())
            || Boolean(document.querySelector('[data-automation-id="applyFlowAutoFillPage"]'));
    }

    // A button/link labeled `pattern` inside the application <main> (not the page banner). Used to
    // tell an in-form action (e.g. the Sign In submit) from the same word in the global header.
    function mainButton(pattern) {
        return [...getMain().querySelectorAll('button, [role="button"], a')]
            .filter(visible)
            .find(node => pattern.test(clean(node.innerText || node.textContent || node.getAttribute('aria-label'))) && !node.disabled);
    }

    function isCreateAccountForm() {
        // Create Account collects a password AND a "Verify New Password", so it always renders TWO
        // password fields. A Sign In page renders exactly one — yet it still contains a "Create
        // Account" link, so keying on the words "create account" alone would mismatch Sign In.
        // Require both password fields (the verify field) to disambiguate the two auth screens.
        const passwordFields = [...getMain().querySelectorAll('input[type="password"]')].filter(visible);
        if (passwordFields.length < 2) return false;
        const hasCreateHeading = [...getMain().querySelectorAll('h1, h2, h3, h4')]
            .filter(visible)
            .some(node => /^create account\b/i.test(clean(node.textContent)));
        return hasCreateHeading || /create account/i.test(clean(getMain().innerText));
    }

    // A plain email + password Sign In form for a returning applicant. Some tenants (e.g. T-Mobile)
    // have no Google sign-in at all, so an existing account lands here instead of Create Account.
    // Eve never types credentials (content scripts can't read local .env); the user fills email
    // + password locally and the extension only submits the ready form — mirroring Create Account.
    function isSignInForm() {
        if (isCreateAccountForm()) return false;
        const passwordFields = [...getMain().querySelectorAll('input[type="password"]')].filter(visible);
        if (passwordFields.length !== 1) return false;
        return Boolean(mainButton(/^sign in$/i));
    }

    // The visible email + password credential inputs the user must fill for auth. Excludes the
    // "Enter website … for robots only" honeypot by requiring an email-ish label or a password type.
    function authCredentialInputs() {
        return [...getMain().querySelectorAll('input')].filter(input => {
            if (!visible(input) || input.disabled) return false;
            if (input.type === 'password' || input.type === 'email') return true;
            if (input.type !== 'text') return false;
            return /email/i.test(getLabel(input)) || /email/i.test(input.getAttribute('data-automation-id') || '');
        });
    }

    function signInFormReady() {
        if (!isSignInForm()) return false;
        const creds = authCredentialInputs();
        return creds.length >= 2 && creds.every(input => clean(input.value));
    }

    function createAccountFormReady() {
        if (!isCreateAccountForm()) return false;
        const requiredTextFields = [...getMain().querySelectorAll('input')].filter(input => {
            if (!visible(input) || input.disabled) return false;
            return ['email', 'password'].includes(input.type) && (input.required || input.getAttribute('aria-required') === 'true');
        });
        const requiredChecks = [...getMain().querySelectorAll('input[type="checkbox"]')].filter(input => {
            if (!visible(input) || input.disabled) return false;
            const label = normalizeKey(getLabel(input));
            return input.required || input.getAttribute('aria-required') === 'true' || /read|agree|privacy|terms/.test(label);
        });
        return requiredTextFields.length > 0
            && requiredTextFields.every(input => clean(input.value))
            && requiredChecks.every(input => input.checked);
    }

    // Fill the known account email on a Create Account / Sign In form.
    async function fillKnownAuthEmail(context) {
        const emailInput = authCredentialInputs().find(input =>
            input.type === 'email'
            || /email/i.test(getLabel(input))
            || /email/i.test(input.getAttribute('data-automation-id') || ''));
        if (emailInput && !clean(emailInput.value)) {
            await performDelayedAction(() => setNativeValue(emailInput, GOOGLE_ACCOUNT), 'Filling account email', context);
        }
    }

    // The account password is NEVER hardcoded in this (git-tracked) source. It lives only in the
    // browser's extension-local storage under `workdayAccountPassword` (set once via Eve
    // Settings / the storage key). Returns null when unset, so auth falls back to "user types it".
    async function getStoredAuthPassword() {
        try {
            const stored = await storageGet(['workdayAccountPassword']);
            const value = typeof stored.workdayAccountPassword === 'string' ? stored.workdayAccountPassword : '';
            return value || null;
        } catch { return null; }
    }

    // Fill every visible password field (Password + Verify New Password) with the stored password,
    // only where empty. No-op when no password is stored.
    async function fillAuthPassword(context) {
        const password = await getStoredAuthPassword();
        if (!password) return false;
        const pwFields = [...getMain().querySelectorAll('input[type="password"]')].filter(visible);
        let filled = false;
        for (const pw of pwFields) {
            if (!clean(pw.value)) { await performDelayedAction(() => setNativeValue(pw, password), 'Filling password', context); filled = true; }
        }
        return filled;
    }

    // Check the required consent/agreement checkbox(es) on a Create Account form (user rule: fill all
    // and continue). Only ticks required or clearly-consent-labeled boxes; skips the robot honeypot.
    async function checkAccountConsent(context) {
        const boxes = [...getMain().querySelectorAll('input[type="checkbox"]')].filter(cb => {
            if (!visible(cb) || cb.disabled || cb.checked) return false;
            const label = normalizeKey(getLabel(cb));
            return cb.required || cb.getAttribute('aria-required') === 'true' || /agree|consent|privacy|terms|confirm/.test(label);
        });
        for (const cb of boxes) await clickButton(cb, 'Accepting account consent', context);
    }

    // Create Account on an email/password tenant with no Google sign-in (e.g. T-Mobile, Disney).
    // Per user rule (2026-07-18): fill ALL of it — email, password, verify password, consent box —
    // then submit (Create Account), in either mode. Uses the stored password; if none is stored it
    // fills what it can and pauses for the user to type the password. clickAuthButton bypasses the
    // Manual step-changing block so Manual can complete account creation too.
    async function handleCreateAccount(context) {
        await fillKnownAuthEmail(context);
        await fillAuthPassword(context);
        await checkAccountConsent(context);
        if (!createAccountFormReady()) {
            const message = 'Create Account: store your password in Eve (workdayAccountPassword) or type it, then Apply/Auto Apply submits it.';
            return context.mode === 'manual' ? manualFillResult(message, false) : pause(message);
        }
        const submit = findButton(/^create account$/i);
        if (!submit) return pauseOrManual(context, 'Create Account is filled, but its submit action is unavailable.');
        if (!await clickAuthButton(submit, 'Creating your Workday account', context)) return { ok: false, state: 'stopped' };
        return { ok: true, state: 'authenticating' };
    }

    // Returning-applicant Sign In (existing account). Fill email + stored password, then click Sign
    // In (both modes). Falls back to "user types password" when none is stored.
    async function handleSignIn(context) {
        // After Create Account the SPA routes to this Sign In page; the email + password inputs take a
        // moment to render/settle. Wait for both credential inputs to appear (up to 8s), then settle
        // ~2s, BEFORE filling — otherwise we'd fill nothing on a half-rendered form and wrongly pause.
        // (User rule 2026-07-25: land on Sign In → wait 2-3s → fill credentials → Sign In, don't pause.)
        await waitForPageMatch(
            () => (isSignInForm() && authCredentialInputs().length >= 2) ? true : null,
            8000,
            'Sign In page loading — filling credentials shortly…'
        );
        await WAIT(2000);
        await fillKnownAuthEmail(context);
        await fillAuthPassword(context);
        // Give React a beat to register the filled values, and retry the fill once if the form still
        // reads as not-ready (a late-mounting input can miss the first pass).
        if (!signInFormReady()) {
            await WAIT(700);
            await fillKnownAuthEmail(context);
            await fillAuthPassword(context);
            await WAIT(300);
        }
        if (!signInFormReady()) {
            const message = 'Sign In: store your password in Eve (workdayAccountPassword) or type it, then Apply/Auto Apply signs in.';
            return context.mode === 'manual' ? manualFillResult(message, false) : pause(message);
        }
        const submit = mainButton(/^sign in$/i);
        if (!submit) return pauseOrManual(context, 'Sign In is filled, but its submit action is unavailable.');
        if (!await clickAuthButton(submit, 'Signing in to Workday', context)) return { ok: false, state: 'stopped' };
        return { ok: true, state: 'authenticating' };
    }

    function resumeUploadComplete() {
        const text = clean(getMain().innerText);
        // Upload acceptance and footer readiness are independent Workday states.
        // The generic advance primitive owns waiting for the live footer action.
        return /successfully uploaded|upload complete/i.test(text);
    }

    function getResumeFileInput() {
        return document.querySelector('input[type="file"][data-automation-id="file-upload-input-ref"], [data-automation-id="resumeUpload"] input[type="file"], main input[type="file"]');
    }

    function base64ToBytes(value) {
        const binary = atob(value);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        return bytes;
    }

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

    async function packagedArtifactFile(artifactId) {
        // The name/size of the packaged PDFs comes from whatever this installation configured
        // (eve/profile.local.json -> background.js), so only the artifact ID is validated here;
        // the bytes themselves are checked below.
        if (!ARTIFACT_IDS.includes(artifactId)) throw new Error('Unsupported packaged document.');
        const response = await sendRuntimeMessage({ type: 'eve:get-workday-artifact', artifactId });
        const artifact = response.artifact || {};
        // No hard-coded name/size to compare against any more (see the comment above): the install
        // supplies both. Validate only what must be true for the upload to work — a filename and a
        // PDF content type — then let the byte checks below do the real verification.
        if (!clean(artifact.name) || artifact.type !== 'application/pdf') {
            throw new Error(`The packaged ${artifactId === 'coverLetter' ? 'cover letter' : 'resume'} metadata is invalid.`);
        }
        if (!artifact.dataBase64 || artifact.size <= 0 || artifact.size > MAX_RESUME_BYTES) {
            throw new Error('The packaged PDF is empty, oversized, or unreadable.');
        }
        const bytes = base64ToBytes(artifact.dataBase64);
        if (bytes.byteLength !== Number(artifact.size) || String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') {
            throw new Error('The packaged PDF contents failed validation.');
        }
        return new File([bytes], artifact.name, { type: 'application/pdf', lastModified: 0 });
    }

    function waitForResumeUpload(timeoutMs = 45000) {
        return waitForPageMatch(
            () => {
                const step = currentStep();
                if (!getResumeFileInput()
                    && !isAutofillWithResumeStep()
                    && /^(my information|my experience|application questions|voluntary disclosures|self identify|review)$/i.test(step)) {
                    return { state: 'site-advanced', step };
                }
                if (resumeUploadComplete()) return { state: 'uploaded' };
                return null;
            },
            timeoutMs,
            'Waiting for Workday to finish uploading the resume…'
        );
    }

    function fileInputContext(input) {
        const container = input.closest('[data-automation-id*="formField"], [data-automation-id="resumeUpload"], fieldset, [role="group"]');
        return normalizeKey([
            getLabel(input),
            input.name,
            input.id,
            input.getAttribute('data-automation-id'),
            input.getAttribute('aria-label'),
            container?.getAttribute('data-automation-id'),
            container?.innerText
        ].filter(Boolean).join(' '));
    }

    function artifactIdForFileInput(input, resumeStep = false) {
        if (!input || input.type !== 'file') return '';
        if (resumeStep && input === getResumeFileInput()) return 'resume';
        const context = fileInputContext(input);
        if (/cover letter/.test(context)) return 'coverLetter';
        if (/\b(resume|curriculum vitae|cv)\b/.test(context)) return 'resume';
        return '';
    }

    function artifactInputComplete(input) {
        if (input?.files?.length) return true;
        const container = input?.closest('[data-automation-id*="formField"], [data-automation-id="resumeUpload"], fieldset, [role="group"]');
        return /successfully uploaded|upload complete/i.test(clean(container?.innerText));
    }

    async function waitForArtifactUpload(input, beforeStep, timeoutMs = 45000) {
        return waitForPageMatch(() => {
            if (artifactInputComplete(input)) return { state: 'uploaded' };
            const step = currentStep();
            if (!document.contains(input) && stepSignature() !== beforeStep) return { state: 'site-advanced', step };
            const container = input?.closest?.('[data-automation-id*="formField"], [data-automation-id="resumeUpload"], fieldset, [role="group"]');
            if (/file.*(error|invalid|too large)|upload failed/i.test(clean(container?.innerText))) return { state: 'error' };
            return null;
        }, timeoutMs, 'Waiting for Workday to finish uploading the document…');
    }

    async function attachPackagedArtifact(input, artifactId, context) {
        if (!input) return { ok: false, message: 'Workday\'s file control is not available yet.' };
        if (artifactInputComplete(input)) return { ok: true, uploaded: true, artifactId };
        let file;
        try {
            file = await packagedArtifactFile(artifactId);
        } catch (error) {
            return { ok: false, message: error.message || String(error) };
        }
        if (!actionsAllowed(context)) return { ok: false, message: 'Document attachment was cancelled.' };
        const beforeStep = stepSignature();
        const attached = await performDelayedAction(() => {
            const transfer = new DataTransfer();
            transfer.items.add(file);
            input.files = transfer.files;
            input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
            input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
            return true;
        }, `Attaching packaged ${artifactId === 'coverLetter' ? 'cover letter' : 'resume'}`, context);
        if (!attached) return { ok: false, message: 'Document attachment was cancelled.' };
        const uploadResult = artifactId === 'resume' && isAutofillWithResumeStep()
            ? await waitForResumeUpload()
            : await waitForArtifactUpload(input, beforeStep);
        if (!uploadResult || uploadResult.state === 'error') {
            return { ok: false, message: `Workday did not accept the packaged ${artifactId === 'coverLetter' ? 'cover letter' : 'resume'}. Review the file error, then click Apply again.` };
        }
        return {
            ok: true,
            artifactId,
            uploaded: uploadResult.state === 'uploaded',
            siteAdvanced: uploadResult.state === 'site-advanced',
            step: uploadResult.step
        };
    }

    async function attachKnownArtifacts(context) {
        const inputs = [...getMain().querySelectorAll('input[type="file"]')].filter(input => !input.disabled);
        const results = [];
        for (const input of inputs) {
            const artifactId = artifactIdForFileInput(input, isAutofillWithResumeStep());
            if (!artifactId || artifactInputComplete(input)) continue;
            const result = await attachPackagedArtifact(input, artifactId, context);
            if (!result.ok || result.siteAdvanced) return result;
            results.push(result);
        }
        return { ok: true, results };
    }

    // The Resume/CV upload control on the current step, found by section heading. Some Workday
    // tenants (e.g. Disney) put the resume upload on the My Experience step instead of a dedicated
    // resume step, and the fuzzy container-text match in artifactIdForFileInput() can miss it, so
    // key on the real "Resume/CV" section heading and fall back to the standard file-upload input.
    function stepResumeFileInput() {
        const section = sectionByHeading(/(resume|curriculum vitae|\bcv\b)/i);
        if (!section) return null;
        const scoped = [...section.querySelectorAll('input[type="file"]')].filter(input => !input.disabled)[0];
        if (scoped) return scoped;
        const ref = getResumeFileInput();
        return ref && !ref.disabled ? ref : null;
    }

    // Upload the packaged resume into this step's Resume/CV section when the user hasn't already.
    // No-op (skipped) when the step has no resume section, so it's safe to call on any step.
    async function ensureStepResumeUploaded(context) {
        const input = stepResumeFileInput();
        if (!input) return { ok: true, skipped: true };
        if (artifactInputComplete(input)) return { ok: true, uploaded: true, alreadyPresent: true };
        return attachPackagedArtifact(input, 'resume', context);
    }

    async function handleResumeUploadStep(context = autoActionContext(), { advance: shouldAdvance = true } = {}) {
        if (!resumeUploadComplete()) {
            // The upload control can render a few seconds after the step loads (esp. right after a
            // navigation). Wait for the real file input before attaching, instead of failing early.
            const fileInput = await waitForPageMatch(() => getResumeFileInput() || null, 15000, 'Waiting for the resume upload control…');
            if (!actionsAllowed(context)) return { ok: false, state: 'stopped' };
            const attachment = await attachPackagedArtifact(fileInput || getResumeFileInput(), 'resume', context);
            if (!attachment.ok) {
                return context.mode === 'manual'
                    ? manualFillResult(attachment.message, false)
                    : pause(attachment.message);
            }
            if (attachment.siteAdvanced) {
                return context.mode === 'manual'
                    ? manualFillResult(`Workday accepted the resume and moved to ${attachment.step} without a Continue click. Click Apply again to fill this new step.`, true)
                    : { ok: true, state: 'advanced' };
            }
        }
        if (!shouldAdvance) return manualFillResult('Packaged resume uploaded. Review it, then continue manually.', true);
        if (!actionsAllowed(context)) {
            return { ok: false, state: 'stopped', message: 'Resume navigation was blocked because Eve is not active.' };
        }
        // "Successfully Uploaded" can show BEFORE Workday finishes parsing the resume and enables
        // Continue; an early click is then swallowed and the step never advances (worse now that there
        // is no general action delay). Listen (MutationObserver-backed) for the Continue action to be
        // truly READY, add a short settle, then advance — retrying a couple times because Workday can
        // re-disable Continue mid-parse or ignore the first click.
        await waitForResumeContinueReady(25000, context);
        await WAIT(1500);
        let advanceResult = await advanceWorkdayStep(context, { message: 'Continuing after resume upload', timeoutMs: 25000 });
        for (let attempt = 0; attempt < 2
            && !advanceResult.ok
            && (advanceResult.state === 'unchanged' || advanceResult.state === 'unavailable')
            && actionsAllowed(context); attempt += 1) {
            await WAIT(2000);
            await waitForResumeContinueReady(15000, context);
            advanceResult = await advanceWorkdayStep(context, { message: 'Continuing after resume upload (retry)', timeoutMs: 20000 });
        }
        if (advanceResult.ok) return advancedResult(context, advanceResult);
        if (advanceResult.state === 'submit-blocked') return pauseOrManual(context, 'Review is ready. Final submission requires explicit user approval.');
        if (advanceResult.state === 'unchanged') return pauseOrManual(context, `${advanceResult.actionLabel || 'Continue'} was clicked, but Workday did not load a new step.`);
        if (advanceResult.state === 'stopped') return advanceResult;
        return pauseOrManual(context, 'Resume is uploaded, but Workday Continue is unavailable.');
    }

    // Wait for the post-upload Continue/Next footer action to become enabled ("ready"), using the
    // shared MutationObserver+poll matcher, so the resume step advances only after Workday finishes
    // processing the file. Resolves early (true) if automation is cancelled, so it never hangs.
    async function waitForResumeContinueReady(timeoutMs, context) {
        return waitForPageMatch(() => {
            if (!actionsAllowed(context)) return true;
            return resolveWorkdayAdvanceAction().state === 'ready' ? true : null;
        }, timeoutMs, 'Waiting for Workday to finish processing the resume…');
    }

    async function fillFirstPartyStep(context = autoActionContext(), { advance: shouldAdvance = true } = {}) {
        const artifactResult = await attachKnownArtifacts(context);
        if (!artifactResult.ok) {
            return context.mode === 'manual'
                ? manualFillResult(artifactResult.message, false)
                : pause(artifactResult.message);
        }
        if (artifactResult.siteAdvanced) {
            return context.mode === 'manual'
                ? manualFillResult(`Workday accepted the document and moved to ${artifactResult.step} without a Continue click. Click Apply again to fill this new step.`, true)
                : { ok: true, state: 'advanced' };
        }
        const stored = (await storageGet([WORKDAY_INFO_KEY]))[WORKDAY_INFO_KEY] || {};
        const regexAnswers = Array.isArray(stored.regexAnswers) ? stored.regexAnswers : [];
        const fields = getFields();
        for (const field of fields) {
            if (!actionsAllowed(context)) return { ok: false, state: 'stopped' };
            if (field.value && field.value !== 'No') continue;
            const answer = resolveAnswer(field.label, stored, regexAnswers);
            if (answer) await fillField(field, answer, context);
        }
        const unresolved = getFields().filter(field => field.required && (!field.value || field.value === 'No'));
        if (unresolved.length) {
            // One item per line (user, 2026-07-27) — each missing answer gets its own bullet.
            const message = [`${unresolved.length} required Workday answer(s) missing:`, ...unresolved.map(field => field.label)].join('\n');
            return context.mode === 'manual' ? manualFillResult(message, false) : pause(message);
        }
        if (!shouldAdvance) return manualFillResult('Current Workday step filled. Review it, then continue manually.', true);
        const advanceResult = await advanceWorkdayStep(context);
        if (advanceResult.ok) return advancedResult(context, advanceResult);
        if (advanceResult.state === 'submit-blocked') return pauseOrManual(context, 'Review is ready. Final submission requires explicit user approval.');
        if (advanceResult.state === 'unchanged') return pauseOrManual(context, `${advanceResult.actionLabel || 'Continue'} was clicked, but Workday did not load a new step.`);
        if (advanceResult.state === 'stopped') return advanceResult;
        return pauseOrManual(context, 'No supported Workday Continue/Next action is available.');
    }

    async function runWorkdayManualApply({ userInitiated = false, modeLockedByClick = false } = {}) {
        if (modeLockedByClick) {
            const result = await storageGet(['settings']);
            eveEnabled = result.settings?.autopilotEnabled !== false;
            autoModeEnabled = false;
            updateAutoApplyButton();
        } else {
            await refreshAutomationGate();
        }
        if (!userInitiated) return { ok: false, state: 'idle', message: 'Click Apply to fill the current Workday step.' };
        if (!eveEnabled) {
            setStatus('Eve is disabled.', 'stopped');
            return { ok: false, state: 'stopped', message: 'Eve is disabled.' };
        }
        if (autoModeEnabled) return runWorkdayAutoApply({ userInitiated: true });

        running = false;
        await saveSession('stopped');
        const context = manualActionContext(++manualPassId);
        lastAutomatedActionAt = 0;
        setStatus('Filling the current Workday step, then continuing once…', 'running');
        try {
            // Email/password tenants (no Google, e.g. T-Mobile) render a Create Account or a
            // returning-applicant Sign In form on the auth screen. Handle these BEFORE the Google
            // login flow — otherwise isAuthenticationScreen() routes a create-account page into
            // handleWorkdayLogin, which wrongly reports "Sign in with Google is not available."
            if (isCreateAccountForm()) {
                return await handleCreateAccount(context);
            }
            if (isSignInForm()) {
                return await handleSignIn(context);
            }
            // Logged-out entry (both modes): an Apply click on a /login or auth screen triggers
            // Google sign-in. The account chooser on accounts.google.com is auto-selected via the
            // login-pending flag set by handleWorkdayLogin.
            if (isLoginPage() || isAuthenticationScreen() || findButton(/^sign in with google$/i)) {
                return await handleWorkdayLogin(context);
            }
            // Start Your Application entry (both modes), by preference: Autofill with Resume, else
            // Apply Manually — never Use My Last Application. These buttons only exist on this
            // pre-flow modal; the authenticated resume step has a file input instead, and later
            // progress bars omit the label.
            const entryChoice = !isAutofillWithResumeStep() && findEntryChoice();
            if (entryChoice) {
                await markLoginPending();
                if (!await clickAuthButton(entryChoice.node, `Choosing ${entryChoice.label}`, context)) return { ok: false, state: 'stopped' };
                return manualFillResult(`Selected ${entryChoice.label} — click Apply again to continue.`, true);
            }
            // Job posting page: open the "Start Your Application" modal via the page's Apply button.
            const postingApply = !isAutofillWithResumeStep() && findPostingApplyButton();
            if (postingApply) {
                if (!await clickButton(postingApply, 'Opening Start Your Application', context)) return { ok: false, state: 'stopped' };
                return manualFillResult('Opened Start Your Application — click Apply again to choose the entry option.', true);
            }
            // A tenant that hides email auth behind an opener button (not a rendered form yet).
            if (findButton(/^sign in with email$/i)) {
                return manualFillResult('This tenant uses email sign-in. Turn on Auto Apply to open and submit it.', false);
            }
            // Review is the final page — recognized by anchor (Submit button). Check it FIRST so the
            // read-only summary's section headings (e.g. "My Information") never route elsewhere.
            if (isReviewStep()) {
                return await handleReviewSubmit(context);
            }
            // Manual fills the current step and clicks its one advance action (Continue / Save and
            // Continue / Next / Review), then stops on the newly rendered step. Submit stays blocked.
            if (isAutofillWithResumeStep()) {
                return await handleResumeUploadStep(context);
            }
            if (isMyInformationStep()) {
                return await handleMyInformation(context);
            }
            if (isMyExperienceStep()) {
                return await handleMyExperience(context);
            }
            if (isApplicationQuestionsStep()) {
                return await handleApplicationQuestions(context);
            }
            if (isVoluntaryDisclosuresStep()) {
                return await handleVoluntaryDisclosures(context);
            }
            if (isSelfIdentifyStep()) {
                return await handleSelfIdentify(context);
            }
            if (isReviewStep()) {
                return await handleReviewSubmit(context);
            }
            return await fillFirstPartyStep(context);
        } catch (error) {
            return manualFillResult(`Manual Apply stopped: ${error.message || error}`, false);
        } finally {
            if (context.passId === manualPassId) manualPassId += 1;
        }
    }

    async function runWorkdayApplyAction({ userInitiated = false } = {}) {
        const result = await storageGet(['settings', 'eveApplyMode']);
        eveEnabled = result.settings?.autopilotEnabled !== false;
        autoModeEnabled = result.eveApplyMode !== 'manual';
        updateAutoApplyButton();
        return autoModeEnabled
            ? runWorkdayAutoApply({ userInitiated })
            : runWorkdayManualApply({ userInitiated });
    }

    // After the extension is reloaded/updated, an already-open tab keeps the old orphaned content
    // script: its panel still shows, but every chrome.* call throws "Extension context invalidated".
    // chrome.runtime.id becomes undefined in that state, so this is a reliable liveness check.
    function extensionContextAlive() {
        try { return Boolean(chrome.runtime && chrome.runtime.id); } catch { return false; }
    }

    async function handleApplyButtonClick() {
        if (!extensionContextAlive()) {
            setStatus('Eve was updated. Refresh this page (Ctrl+Shift+R) to continue.', 'waiting');
            return;
        }
        const toggle = document.getElementById('ea-workday-auto-toggle');
        const requestedAutoMode = toggle ? toggle.checked : autoModeEnabled;
        autoModeEnabled = requestedAutoMode;
        await storageSet({ eveApplyMode: requestedAutoMode ? 'auto' : 'manual' });
        // Auto mode: the button is a Pause/Resume toggle while a loop is live. Clicking it during a
        // run pauses (stops acting immediately, leaves everything already filled on the page as-is);
        // clicking again resumes from where it left off.
        if (autoModeEnabled && (running || loopActive)) {
            userPaused = true;
            running = false; // the loop exits at its next guard check; nothing gets cleared
            await saveSession('waiting');
            setStatus('Paused. Click Resume to continue — nothing on this page was changed.', 'waiting');
            return;
        }
        userPaused = false;
        updateAutoApplyButton();
        return runWorkdayApplyAction({ userInitiated: true });
    }

    function authenticatedWorkdayPage() {
        return Boolean(document.querySelector('[data-automation-id="utilityMenuButton"], [data-automation-id="header"]')) && !isAuthenticationScreen();
    }

    async function runWorkdayAutoApply({ userInitiated = false } = {}) {
        if (loopActive) return { ok: true, state: running ? 'running' : 'waiting' };
        if (!await refreshAutomationGate()) {
            return stopAllAutomatedActions(eveEnabled ? 'Auto mode is off. Enable Auto mode, then click Auto Apply.' : 'Eve is disabled.');
        }
        const session = await loadSession();
        if (!userInitiated && (!session?.activatedByUser || session.state !== 'running' || session.applicationKey !== applicationKey())) {
            return { ok: false, state: 'idle', message: 'Click Auto Apply to start.' };
        }
        loopActive = true;
        running = true;
        userPaused = false; // the loop is live now; the button reflects Pause
        pausedStepSignature = ''; // starting/resuming the loop clears any pending resume-watch
        await saveSession('running', { activatedByUser: true });
        setStatus('Starting or resuming Workday Auto Apply…', 'running');
        try {
            for (let actionCount = 0; actionCount < 40 && running; actionCount += 1) {
                await waitForSupportedPageAction();
                await waitForStablePage(); // wait for the new page/step to fully load before acting
                if (!actionsAllowed(autoActionContext())) return { ok: false, state: 'stopped', message: 'Automated actions stopped.' };

                // On a Sign In / Create Account screen the progress bar may render a future
                // "Autofill with Resume" step label as a clickable element. Never treat it as
                // the entry button while authentication is required; route to the login flow.
                const onAuthScreen = isAuthenticationScreen();
                const entry = !onAuthScreen && findEntryChoice();
                if (entry) {
                    const beforeEntry = stepSignature();
                    if (!await clickButton(entry.node, `Choosing ${entry.label}`)) return { ok: false, state: 'stopped' };
                    // Selecting Autofill with Resume is usually an IN-PLACE SPA route to the resume-upload
                    // step (or, when logged out, the Sign In screen) — no full reload, so boot() won't
                    // re-run. Wait for the new step and CONTINUE the loop instead of returning; if it does
                    // fully navigate (e.g. to Google), this context is torn down and boot() resumes anyway.
                    await waitForStepChange(beforeEntry, 12000);
                    continue;
                }

                // Job posting page: click the page's big "Apply" button to open the "Start Your
                // Application" modal, then loop again to choose Autofill with Resume (opens in place).
                if (!onAuthScreen) {
                    const postingApply = findPostingApplyButton();
                    if (postingApply) {
                        if (!await clickButton(postingApply, 'Opening Start Your Application')) return { ok: false, state: 'stopped' };
                        continue;
                    }
                }

                // Only wait for a late-rendering Google button on tenants that actually offer it.
                // When an email/password Create Account or Sign In form is already showing, this
                // tenant has no Google option — skip the 15s wait and route to the email path below.
                let google = findButton(/^sign in with google$/i);
                if (!google && onAuthScreen && !isSignInForm() && !isCreateAccountForm()) {
                    google = await waitForButton(
                        /^sign in with google$/i,
                        null,
                        15000,
                        'Waiting for Sign in with Google…'
                    );
                }
                if (google) {
                    if (!await clickButton(google, `Signing in with Google as ${GOOGLE_ACCOUNT}`)) return { ok: false, state: 'stopped' };
                    return { ok: true, state: 'authenticating' };
                }

                // Returning applicant on an email/password Sign In page (tenants without Google
                // sign-in). Submit only once the user has filled the credentials locally; never type
                // them here. Checked before Create Account so an existing account is not re-created.
                if (isSignInForm()) {
                    return await handleSignIn(autoActionContext());
                }

                if (isCreateAccountForm()) {
                    return await handleCreateAccount(autoActionContext());
                }

                const createAccount = findButton(/^(create account|create one|sign up)$/i);
                const emailSignIn = findButton(/^sign in with email$/i);
                if (createAccount) {
                    setStatus('Opening Create Account. Credentials remain local and are never embedded in the extension.', 'running');
                    if (!await clickButton(createAccount, 'Opening Create Account')) return { ok: false, state: 'stopped' };
                    continue;
                }
                if (emailSignIn) {
                    setStatus('Google sign-in is unavailable; opening the email account path.', 'running');
                    if (!await clickButton(emailSignIn, 'Opening Sign in with email')) return { ok: false, state: 'stopped' };
                    continue;
                }

                const step = currentStep();
                // Review (final page) is recognized by anchor (Submit button); check it FIRST so the
                // read-only summary's "My Information" section heading never routes to My Information.
                if (isReviewStep()) {
                    const result = await handleReviewSubmit();
                    if (result.state === 'submitted') return result;
                    if (!result.ok) return result;
                    continue;
                }
                if (isMyInformationStep()) {
                    const result = await handleMyInformation();
                    if (!result.ok) return result;
                    continue;
                }

                if (isAutofillWithResumeStep()) {
                    const result = await handleResumeUploadStep();
                    if (!result.ok) return result;
                    continue;
                }

                if (isMyExperienceStep()) {
                    const result = await handleMyExperience();
                    if (!result.ok) return result;
                    continue;
                }

                if (isApplicationQuestionsStep()) {
                    const result = await handleApplicationQuestions();
                    if (!result.ok) return result;
                    continue;
                }

                if (isVoluntaryDisclosuresStep()) {
                    const result = await handleVoluntaryDisclosures();
                    if (!result.ok) return result;
                    continue;
                }

                if (isSelfIdentifyStep()) {
                    const result = await handleSelfIdentify();
                    if (!result.ok) return result;
                    continue;
                }

                if (isReviewStep()) {
                    const result = await handleReviewSubmit();
                    if (result.state === 'submitted') return result;
                    if (!result.ok) return result;
                    continue;
                }

                const result = await fillFirstPartyStep();
                if (!result.ok) return result;
            }
            return await pause('Paused after the Workday action limit. Click Auto Apply to resume.');
        } catch (error) {
            return await pause(`Workday Auto Apply stopped: ${error.message || error}`);
        } finally {
            loopActive = false;
            updateAutoApplyButton(); // settle the button label (e.g. Pause → Resume) once the loop ends
        }
    }

    function switchView(view) {
        for (const name of ['apply', 'step', 'info']) {
            document.getElementById(`ea-body-${name}`)?.classList.toggle('ea-hidden', view !== name);
            document.getElementById(`ea-tab-${name}`)?.classList.toggle('ea-tab-active', view === name);
        }
        if (view === 'step') renderStep();
        if (view === 'info') renderInfo();
    }

    function renderStep() {
        const wrap = document.getElementById('ea-fields-wrap');
        const action = document.getElementById('ea-current-action');
        if (!wrap || !action) return;
        action.textContent = bulletize(`${currentStep()} — ${statusMessage}`);
        const fields = getFields();
        wrap.innerHTML = fields.length ? fields.map(field => `
            <div class="ea-field-row">
              <div class="ea-field-label">${esc(field.label)}${field.required ? ' *' : ''}</div>
              <input class="eve-val-input" value="${esc(field.value)}" disabled>
            </div>`).join('') : '<p class="ea-dim">No editable fields detected on this Workday step.</p>';
    }

    async function renderInfo() {
        const wrap = document.getElementById('ea-info-wrap');
        if (!wrap) return;
        const result = await storageGet([WORKDAY_INFO_KEY]);
        const workdaySavedAnswers = result[WORKDAY_INFO_KEY] || {};
        const entries = Object.entries(workdaySavedAnswers).sort(([a], [b]) => a.localeCompare(b));
        wrap.innerHTML = entries.length ? entries.map(([key, value]) => `
            <div class="ea-info-row">
              <label>${esc(key)}</label>
              <input class="eve-val-input ea-workday-info-value" data-key="${esc(key)}" value="${esc(value)}">
            </div>`).join('') : '<p class="ea-dim">No Workday information saved yet.</p>';
    }

    async function saveInfo() {
        const result = await storageGet([WORKDAY_INFO_KEY]);
        const workdaySavedAnswers = result[WORKDAY_INFO_KEY] || {};
        document.querySelectorAll('.ea-workday-info-value').forEach(input => { workdaySavedAnswers[input.dataset.key] = input.value; });
        await storageSet({ [WORKDAY_INFO_KEY]: workdaySavedAnswers });
        const message = document.getElementById('ea-info-msg');
        if (message) message.textContent = 'Saved.';
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

    function updateAutoApplyButton() {
        const button = document.getElementById('ea-apply-btn');
        if (!button) return;
        button.disabled = !eveEnabled;
        // In Auto mode the single button doubles as the run/pause control: while a loop is live it
        // reads "Pause" (click to pause without changing anything already filled), after a user pause
        // it reads "Resume", and otherwise "Auto Apply". Manual mode always reads "Apply".
        const running_ = running || loopActive;
        let label, title;
        if (!autoModeEnabled) {
            label = 'Apply';
            title = 'Fill the current Workday step, then continue one step';
        } else if (running_) {
            label = 'Pause';
            title = 'Pause Auto Apply — keeps everything already filled on this page';
        } else if (userPaused) {
            label = 'Resume';
            title = 'Resume Auto Apply from where it paused';
        } else {
            label = 'Auto Apply';
            title = 'Start or resume Workday Auto Apply';
        }
        button.textContent = label;
        button.classList.toggle('ea-btn-pause', label === 'Pause');
        button.classList.toggle('ea-btn-resume', label === 'Resume');
        button.title = !eveEnabled ? 'Enable Eve first' : title;
        const toggle = document.getElementById('ea-workday-auto-toggle');
        const status = document.getElementById('ea-workday-auto-toggle-status');
        if (toggle) toggle.checked = autoModeEnabled;
        if (status) status.textContent = autoModeEnabled
            ? (running_ ? 'On · running — click Pause to hold' : userPaused ? 'On · paused — click Resume to continue' : 'On · click Auto Apply to start or resume')
            : 'Off · click Apply to fill this step and continue once';
    }

    function injectUI() {
        if (document.getElementById('eve-floating-ui') || !isWorkdayPage()) return;
        const version = (() => { try { return chrome.runtime.getManifest().version; } catch { return ''; } })();
        const panel = document.createElement('div');
        panel.id = 'eve-floating-ui';
        panel.innerHTML = `
          <div class="ea-header">
            <button id="ea-toggle-minimize" class="ea-min-btn" title="Hide Eve">−</button>
            <span class="ea-title">Eve · Workday${version ? ` <span class="ea-version" style="font-size:11px;font-weight:400;opacity:0.65;" title="Extension version">v${esc(version)}</span>` : ''}</span>
            <div class="ea-tabs">
              <button id="ea-tab-apply" class="ea-tab ea-tab-active">Apply</button>
              <button id="ea-tab-step" class="ea-tab">Step</button>
              <button id="ea-tab-info" class="ea-tab">Info</button>
            </div>
            <span id="ea-status-indicator" class="ea-status-active"></span>
          </div>
          <div id="ea-body-apply" class="ea-body">
            <p id="ea-apply-status">${esc(bulletize(statusMessage))}</p>
            <p class="ea-dim">Isolated Workday flow. Account: ${esc(GOOGLE_ACCOUNT)} (Google or email/password per tenant)</p>
            <div class="ea-auto-toggle-row">
              <div>
                <label class="ea-mini-label" for="ea-workday-auto-toggle">Auto Apply</label>
                <div id="ea-workday-auto-toggle-status" class="ea-dim">Off · enable, then click Auto Apply</div>
              </div>
              <label class="ea-toggle-switch" title="Enable Auto Apply mode">
                <input id="ea-workday-auto-toggle" type="checkbox">
                <span class="ea-toggle-slider"></span>
              </label>
            </div>
            <div class="ea-btn-row"><button id="ea-apply-btn" class="ea-btn-save">Auto Apply</button></div>
          </div>
          <div id="ea-body-step" class="ea-body ea-hidden">
            <p id="ea-current-action">${esc(bulletize(safeCurrentStep()))}</p>
            <div id="ea-fields-wrap"></div>
          </div>
          <div id="ea-body-info" class="ea-body ea-hidden">
            <div id="ea-info-wrap"><p class="ea-dim">Loading saved answers…</p></div>
            <div class="ea-info-actions"><button id="ea-info-save-btn" class="ea-btn-primary">Save Changes</button></div>
            <p id="ea-info-msg"></p>
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
        document.getElementById('ea-tab-step').addEventListener('click', () => switchView('step'));
        document.getElementById('ea-tab-info').addEventListener('click', () => switchView('info'));
        document.getElementById('ea-apply-btn').addEventListener('click', () => { void handleApplyButtonClick(); });
        document.getElementById('ea-workday-auto-toggle').addEventListener('change', event => {
            if (!extensionContextAlive()) {
                setStatus('Eve was updated. Refresh this page (Ctrl+Shift+R) to continue.', 'waiting');
                return;
            }
            autoModeEnabled = event.target.checked;
            chrome.storage.local.set({ eveApplyMode: autoModeEnabled ? 'auto' : 'manual' });
            if (!autoModeEnabled) {
                manualPassId += 1;
                stopAllAutomatedActions('Auto mode is off. Click Apply to fill the current step without continuing.');
            }
            updateAutoApplyButton();
        });
        document.getElementById('ea-info-save-btn').addEventListener('click', saveInfo);

        chrome.storage.local.get(['eveTheme'], result => {
            panel.classList.add(result.eveTheme === 'light' ? 'eve-theme-light' : 'eve-theme-dark');
        });
        switchView('apply');
        updateAutoApplyButton();
        renderStep();
    }

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message?.type === 'eve:start-auto-apply') {
            runWorkdayApplyAction({ userInitiated: true }).then(sendResponse);
            return true;
        }
        if (message?.type === 'eve:set-theme') {
            const panel = document.getElementById('eve-floating-ui');
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
        if (areaName !== 'local') return;
        if (changes.eveApplyMode) {
            autoModeEnabled = changes.eveApplyMode.newValue !== 'manual';
            if (!autoModeEnabled) {
                manualPassId += 1;
                stopAllAutomatedActions('Auto mode is off. Click Apply to fill the current step without continuing.');
            }
            updateAutoApplyButton();
        }
        if (changes.settings) {
            eveEnabled = changes.settings.newValue?.autopilotEnabled !== false;
            if (!eveEnabled) {
                manualPassId += 1;
                stopAllAutomatedActions('Eve is disabled. Automated actions stopped.');
                document.getElementById('eve-floating-ui')?.remove();
            } else if (isWorkdayPage()) {
                injectUI();
            }
            updateAutoApplyButton();
        }
    });

    async function boot() {
        const {
            settings = {},
            eveApplyMode = 'auto'
        } = await storageGet(['settings', 'eveApplyMode']);
        eveEnabled = settings.autopilotEnabled !== false;
        autoModeEnabled = eveApplyMode !== 'manual';
        await storageRemove(LEGACY_WORKDAY_RESUME_KEY);
        // Drop any legacy single-slot session key (pre per-tab keying) so it can't drive this tab.
        await storageRemove(SESSION_KEY);
        if (!eveEnabled || !isWorkdayPage()) return;
        // This tab's own session (keyed by applicationKey) — never a slot another tab could overwrite.
        const session = await loadSession();
        injectUI();
        // Re-injection watchdog. Workday is a SPA: clicking Apply on a job details page transitions
        // client-side (e.g. into /apply/autofillWithResume) and re-renders its app root, which wipes
        // our panel out of document.body. The content script runs at document_end (once per full
        // load) and never re-runs on those in-app route changes, so without this the popup silently
        // disappears and never comes back. injectUI() no-ops when the panel already exists, so it's
        // safe to call on both a poll and on SPA history events.
        const ensurePanel = () => { if (eveEnabled && isWorkdayPage()) injectUI(); };
        setInterval(ensurePanel, 1000);
        ['pushState', 'replaceState'].forEach(method => {
            const original = history[method];
            history[method] = function (...historyArgs) {
                const result = original.apply(this, historyArgs);
                setTimeout(ensurePanel, 0);
                return result;
            };
        });
        window.addEventListener('popstate', () => setTimeout(ensurePanel, 0));
        setInterval(renderStep, 1000);
        // Auto-resume watcher: while an Auto session is paused (waiting) on a step, if the user
        // manually fixes the field and clicks Continue so the page advances, resume the loop.
        setInterval(() => {
            if (!autoModeEnabled || !eveEnabled || loopActive || running) return;
            if (!pausedStepSignature || stepSignature() === pausedStepSignature) return;
            const advanced = pausedStepSignature;
            pausedStepSignature = '';
            setStatus('Detected the page advanced — resuming Auto Apply…', 'running');
            if (advanced) runWorkdayAutoApply();
        }, 1200);
        // SPA-landing resume watchdog. After login some tenants (e.g. T-Mobile email/password Create
        // Account) transition IN-PLACE to the next step (the resume-upload page) with no full reload,
        // so boot() never re-runs and the running session is left idle — the panel reads "Ready." but
        // nothing uploads or continues. The paused-step watcher above only covers 'waiting' sessions,
        // and `running` can be left stuck true after an auth return, so this keys on loopActive (the
        // real "loop is iterating" flag), NOT `running`. When a running session for THIS application
        // exists but the loop isn't iterating, re-engage it. A manual Stop nulls the session and a
        // pause sets it to 'waiting', so neither is restarted here.
        let resumeWatchdogBusy = false;
        setInterval(async () => {
            if (resumeWatchdogBusy || loopActive) return;
            if (!eveEnabled || !autoModeEnabled) return;
            const sess = await loadSession();
            if (!sess || sess.state !== 'running' || !sess.activatedByUser) return;
            if (sess.applicationKey !== applicationKey()) return;
            if (Date.now() - sess.updatedAt > 30 * 60 * 1000) return;
            resumeWatchdogBusy = true;
            try {
                await waitForStablePage(15000);
                if (!loopActive && eveEnabled && autoModeEnabled) {
                    setStatus('Resuming Auto Apply on this step…', 'running');
                    await runWorkdayAutoApply();
                }
            } finally {
                resumeWatchdogBusy = false;
            }
        }, 2000);
        if (autoModeEnabled && session?.activatedByUser && session.state === 'running' && session.applicationKey === applicationKey() && Date.now() - session.updatedAt < 30 * 60 * 1000) {
            // Resume the running session after a full navigation (Google-auth return, or a tenant
            // that reloads after resume upload). The next page can take a few seconds to render, so
            // wait for the load event + a settled step signature instead of a fixed short timer —
            // otherwise the resume fires on a half-loaded page and the flow isn't continuous.
            const resume = async () => { await waitForStablePage(20000); runWorkdayAutoApply(); };
            if (document.readyState === 'complete') {
                setTimeout(resume, 300);
            } else {
                window.addEventListener('load', () => setTimeout(resume, 300), { once: true });
            }
        }
    }

    boot();
})();
