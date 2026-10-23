// Eve — isolated Oracle Careers adapter (Task 8, "orc").
// Owns careers.oracle.com: the Oracle Recruiting Cloud "Candidate Experience" SPA
// (/en/sites/jobsearch/jobs?…, preview dialog at /jobs/preview/<id>/, job page /job/<id>/,
// profile at /my-profile). The tenant's REST API lives on another host (the page's
// <base data-apibaseurl>, e.g. eeho.fa.us2.oraclecloud.com) and answers anonymous CORS reads.
//
// OCI filter (user, 2026-09-26): the applicant is in a 6-month cooldown for the OCI line, so every
// job card gets a top-left bordered box: brown-yellow = mentions OCI, green = scanned clean, grey
// dashed = not scanned yet. A ✓ inside (same colour) = already applied. "Scan" loads every result
// and checks each job's full description. Status is keyed by the numeric job id, so it survives
// filter changes. Applied ids are harvested from /my-profile and from Oracle's own "applied" tag.
//
// Apply (user, 2026-09-26): ONE job at a time, synchronously. The root search tab opens the job in
// its own tab (in front); that tab clicks APPLY NOW → enters the account e-mail → fetches the
// one-time code from Gmail through background's verification-code service → VERIFY → walks the
// three application sections (everything Oracle prefilled from the profile is KEPT and logged;
// empty required fields are answered from the shared bank / profile; unmatched required fields
// pause the job) → SUBMIT → the tab closes and the root tab moves to the next job.
// Two mutually exclusive batch modes on the root: Auto ON = every clean, not-applied job in the
// list (scanned first); Auto OFF = exactly the jobs ticked in the top-RIGHT box of each card.
// There is no single-job apply.
//
// DUPLICATION NOTE: panel primitives are adapted copies from eve/kforce.js — deliberately copied,
// each content script stays self-contained per platform.
(function () {
    'use strict';

    // ── Host detection ────────────────────────────────────────────────────────────────────────
    const ORACLE_HOSTS = ['careers.oracle.com'];
    const hostIn = list => list.some(host => location.hostname === host || location.hostname.endsWith(`.${host}`));
    if (!hostIn(ORACLE_HOSTS)) return;
    if (window !== window.top) return;

    // ── Extension namespace ───────────────────────────────────────────────────────────────────
    const NS = 'eve';
    const MSG = type => `${NS}:${type}`;
    const PANEL_ID = `${NS}-floating-ui`;
    const THEME_KEY = `${NS}Theme`;

    // ── Constants ─────────────────────────────────────────────────────────────────────────────
    const SCAN_KEY = 'oracleJobScan';         // { [jobId]: { oci, source: 'card'|'detail', match, title, scannedAt } }
    const APPLIED_KEY = 'oracleAppliedJobs';  // { [jobId]: { title, source, appliedAt, seenAt } }
    const ANSWERS_KEY = 'oracleSavedAnswers'; // { seen: { [question]: { answer, source, jobId, at } } }
    const ORCH_KEY = 'oracleOrchestration';  // background.js: { tabs, results, rootTabId }
    const SELECT_KEY = 'eve_oracle_selected'; // sessionStorage (per tab): ticked job ids
    const FIELD_SETTLE_MS = 300;
    const CODE_TIMEOUT_MS = 120000;
    // User (2026-09-26): wait 6 s (4 s + 2 s) after a code is requested (NEXT on the e-mail step,
    // landing on the code step, or "Send New Code") before the first Gmail feed read.
    const CODE_REQUEST_LAG_MS = 6000;
    const JOB_TIMEOUT_MS = 300000;
    const MAX_FLOW_STEPS = 40;
    const POSITION_KEY = 'eve_oracle_panel_pos';
    const WIDTH_KEY = 'eve_oracle_panel_width';
    // "oci" as a word (OCI, OCI's) or spelled out. Word boundaries keep "social"/"associate" out.
    const OCI_RE = /\bOCI\b|\bOracle\s+Cloud\s+Infrastructure\b/i;
    const SCAN_CONCURRENCY = 4;
    const MAX_SHOW_MORE_CLICKS = 40;
    // Fields never searched: the Oracle-wide "About us" boilerplate (identical on every posting)
    // and the dedicated qualifications / skills fields (user, 2026-09-26: every Oracle job lists
    // OCI as a skill, so a skills mention is not evidence of the OCI line).
    const IGNORED_DETAIL_FIELDS = new Set(['CorporateDescriptionStr', 'ExternalQualificationsStr', 'InternalQualificationsStr', 'skills']);
    // Searched first, in reading order; every other string field follows.
    const DETAIL_FIELD_ORDER = ['Title', 'ShortDescriptionStr', 'ExternalDescriptionStr', 'ExternalResponsibilitiesStr', 'InternalResponsibilitiesStr', 'OrganizationDescriptionStr'];
    // A sub-heading that opens a skills / qualifications block inside a description. Everything
    // under it is ignored until the next non-skills heading.
    const SKILL_HEADING_RE = /skill|qualification|requirement|required|must[-\s]have|nice[-\s]to[-\s]have|what you(?:'|’)?(?:ll)? (?:need|bring|have)|who you are|what we(?:'|’)?re looking for|experience (?:needed|required)|technical expertise|\bcompetenc/i;
    // Scan results made under an older matching rule are re-scanned (shown grey until then).
    const SCAN_RULE = 2;
    // Level gate (user, 2026-09-26): only SENIOR-level titles are eligible. Principal and above
    // (and anything without "Senior"/"Sr" in the title) get a solid grey box and are never
    // scanned, opened, selected or applied to.
    const LEVEL_SENIOR_RE = /\bsenior\b|\bsr\.?\b/i;
    const LEVEL_ABOVE_RE = /\b(principal|staff|distinguished|director|vice president|vp|fellow|head|chief|architect|manager|lead|executive)\b/i;
    const levelEligible = title => LEVEL_SENIOR_RE.test(String(title || '')) && !LEVEL_ABOVE_RE.test(String(title || ''));
    const cardTitles = {}; // jobId -> title, refreshed by decorateCards
    // Global keyword filter (Settings → Filters; user 2026-09-26). On Oracle it applies to the
    // card TITLE: a matching card is treated exactly like a level-skipped one (hidden, never
    // scanned / selected / applied). Plain entries match anywhere, case-insensitive; `/re/` = regex.
    const KEYWORD_FILTER_KEY = 'eveKeywordFilter';
    let keywordFilter = { enabled: false, keywords: [] };
    function compileKeyword(raw) {
        const text = String(raw || '').trim();
        if (!text) return null;
        const m = text.match(/^\/(.+)\/([a-z]*)$/i);
        try { return m ? new RegExp(m[1], m[2].includes('i') ? m[2] : `${m[2]}i`) : new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); } catch { return null; }
    }
    function keywordHit(title) {
        if (!keywordFilter.enabled) return '';
        for (const raw of keywordFilter.keywords || []) {
            const re = compileKeyword(raw);
            if (re && re.test(String(title || ''))) return String(raw);
        }
        return '';
    }
    // Panel block: edits the same global list; saves on every change (debounced). Other editors
    // (popup, Settings) update it through storage.onChanged; the textarea is refreshed only while
    // it is not focused so typing is never interrupted.
    function renderKeywordFilterPanel() {
        const toggle = document.getElementById('ea-oracle-kw-toggle');
        const list = document.getElementById('ea-oracle-kw-list');
        const count = document.getElementById('ea-oracle-kw-count');
        if (!toggle || !list) return;
        if (document.activeElement !== toggle) toggle.checked = keywordFilter.enabled;
        if (document.activeElement !== list) list.value = (keywordFilter.keywords || []).join(', ');
        if (count) count.textContent = `(${(keywordFilter.keywords || []).length}${keywordFilter.enabled ? '' : ', off'})`;
    }
    let keywordSaveTimer = null;
    function wireKeywordFilterPanel() {
        const toggle = document.getElementById('ea-oracle-kw-toggle');
        const list = document.getElementById('ea-oracle-kw-list');
        if (!toggle || !list) return;
        renderKeywordFilterPanel();
        const save = () => {
            clearTimeout(keywordSaveTimer);
            keywordSaveTimer = setTimeout(() => {
                const keywords = String(list.value || '').split(/[,\r\n]+/).map(line => line.trim()).filter(Boolean);
                keywordFilter = { enabled: toggle.checked, keywords };
                void storageSet({ [KEYWORD_FILTER_KEY]: keywordFilter });
                renderKeywordFilterPanel();
                decorateCards();
            }, 250);
        };
        toggle.addEventListener('change', save);
        list.addEventListener('input', save);
        // The panel is draggable by its header only; keep typing/selection inside the box.
        ['mousedown', 'pointerdown', 'keydown'].forEach(type => list.addEventListener(type, event => event.stopPropagation()));
    }
    async function loadKeywordFilter() {
        const stored = await storageGet([KEYWORD_FILTER_KEY]);
        const config = stored[KEYWORD_FILTER_KEY];
        keywordFilter = config && typeof config === 'object' ? { enabled: config.enabled !== false, keywords: Array.isArray(config.keywords) ? config.keywords : [] } : { enabled: false, keywords: [] };
    }

    // ── Tiny shared helpers ───────────────────────────────────────────────────────────────────
    const WAIT = ms => new Promise(resolve => setTimeout(resolve, ms));
    const clean = value => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const stripHtml = value => clean(String(value || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&'));
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
    function isOurUi(node) { return Boolean(node?.closest?.(`#${PANEL_ID}, .eve-orc-box, .eve-orc-select`)); }
    async function waitFor(predicate, timeoutMs = 4000, stepMs = 150) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const value = predicate();
            if (value) return value;
            await WAIT(stepMs);
        }
        return null;
    }
    function sendRuntimeMessage(message) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(message, response => {
                const error = chrome.runtime.lastError;
                if (error) reject(new Error(error.message));
                else if (!response?.ok) reject(new Error(response?.error || 'Background request failed.'));
                else resolve(response);
            });
        });
    }
    function extensionContextAlive() {
        try { return Boolean(chrome.runtime && chrome.runtime.id); } catch { return false; }
    }

    // ── Page detection (SPA: re-evaluated on every tick, never cached) ────────────────────────
    const isSearchPage = () => /\/sites\/[^/]+\/jobs(\/preview\/\d+)?\/?$/i.test(location.pathname);
    const isProfilePage = () => /\/my-profile(\/|$)/i.test(location.pathname) && !/\/sign-in/i.test(location.pathname);
    const jobIdFromHref = href => (String(href || '').match(/\/(?:job|preview)\/(\d+)(?:[/?#]|$)/) || [])[1] || null;
    // Apply-flow routes (confirmed live 2026-09-26): /job/<id>/ (APPLY NOW) → /job/<id>/apply/email
    // (e-mail, then the 6-digit code on the same route) → /job/<id>/apply/section/1..3 → submitted.
    const isJobPage = () => /\/job\/\d+\/?$/i.test(location.pathname);
    const isApplyRoute = () => /\/job\/\d+\/apply(\/|$)/i.test(location.pathname);
    const currentSection = () => Number((location.pathname.match(/\/apply\/section\/(\d+)/i) || [])[1] || 0);
    const isEmailStep = () => Boolean(document.getElementById('primary-email-1')) && !document.getElementById('pin-code-1');
    const isCodeStep = () => Boolean(document.getElementById('pin-code-1'));
    const jobIdFromLocation = () => jobIdFromHref(location.pathname);
    function pageSubmittedText() {
        const text = clean(document.querySelector('main')?.innerText || document.body?.innerText || '');
        return /you(?:'|’)re all set|application (?:has been|was) (?:submitted|received)|thank you for (?:applying|your application)|successfully submitted/i.test(text) && !document.getElementById('pin-code-1');
    }
    const jobUrl = id => `${location.origin}/en/sites/${siteSlug()}/job/${id}/`;
    function siteSlug() { return (location.pathname.match(/\/sites\/([^/]+)/) || [])[1] || 'jobsearch'; }
    function tenant() {
        const base = document.querySelector('base[data-sitenumber]');
        return {
            apiBase: String(base?.dataset.apibaseurl || '').replace(/\/+$/, ''),
            siteNumber: base?.dataset.sitenumber || ''
        };
    }

    // ── Persistent state ──────────────────────────────────────────────────────────────────────
    let scanState = {};
    let appliedState = {};
    async function loadState() {
        const stored = await storageGet([SCAN_KEY, APPLIED_KEY]);
        scanState = stored[SCAN_KEY] && typeof stored[SCAN_KEY] === 'object' ? stored[SCAN_KEY] : {};
        appliedState = stored[APPLIED_KEY] && typeof stored[APPLIED_KEY] === 'object' ? stored[APPLIED_KEY] : {};
    }
    // Serialised read-modify-write so concurrent scan workers never drop each other's results.
    let writeQueue = Promise.resolve();
    function saveScan(jobId, record) {
        scanState[jobId] = { ...(scanState[jobId] || {}), ...record, scannedAt: Date.now() };
        writeQueue = writeQueue.then(async () => {
            const stored = await storageGet([SCAN_KEY]);
            const next = { ...(stored[SCAN_KEY] || {}), [jobId]: scanState[jobId] };
            await storageSet({ [SCAN_KEY]: next });
        }).catch(() => { });
        return writeQueue;
    }
    // New applied ids also go to the unified Applied Jobs log (platform 'oracle'), once per id.
    function markApplied(entries) {
        writeQueue = writeQueue.then(async () => {
            const stored = await storageGet([APPLIED_KEY]);
            const current = { ...(stored[APPLIED_KEY] || {}) };
            const fresh = [];
            for (const entry of entries) {
                if (!entry.jobId) continue;
                if (current[entry.jobId]) {
                    if (!current[entry.jobId].title && entry.title) current[entry.jobId].title = entry.title;
                    continue;
                }
                current[entry.jobId] = { title: entry.title || '', location: entry.location || '', source: entry.source, appliedAt: entry.appliedAt || '', seenAt: Date.now() };
                fresh.push(entry);
            }
            appliedState = current;
            if (!fresh.length) return;
            await storageSet({ [APPLIED_KEY]: current });
            for (const entry of fresh) {
                const parsed = entry.appliedAt ? Date.parse(entry.appliedAt) : NaN;
                await sendRuntimeMessage({
                    type: MSG('record-applied-job'),
                    record: {
                        platform: 'oracle', jobId: entry.jobId, title: entry.title || '', company: 'Oracle',
                        location: entry.location || '', url: jobUrl(entry.jobId), mode: 'manual',
                        ...(Number.isFinite(parsed) ? { appliedAt: new Date(parsed).toISOString(), timestamp: parsed } : {})
                    }
                }).catch(() => { });
            }
        }).catch(() => { });
        return writeQueue;
    }

    // ── Job cards ─────────────────────────────────────────────────────────────────────────────
    // Tile view: div.job-tile > a.job-grid-item__link[href*="/job/<id>/"]. List view falls back to
    // the nearest list item. The header "My job selections" dropdown and the preview dialog's
    // "similar jobs" also carry /job/ links — never cards.
    function jobCards() {
        const seen = new Set();
        const cards = [];
        for (const link of document.querySelectorAll('a[href*="/job/"]')) {
            if (isOurUi(link) || link.closest('.favourite-jobs__list, header, .job-details, .job-details-modal-container, .cs-applications')) continue;
            const jobId = jobIdFromHref(link.getAttribute('href'));
            const root = link.closest('.job-tile, .job-grid-item, .job-list-item, li');
            if (!jobId || !root || seen.has(jobId)) continue;
            seen.add(jobId);
            const title = clean(root.querySelector('.job-tile__title, [class*="__title"]')?.innerText || link.innerText);
            cards.push({ root, link, jobId, title });
        }
        return cards;
    }
    function cardText(card) {
        const clone = card.root.cloneNode(true);
        clone.querySelectorAll('.eve-orc-box').forEach(node => node.remove());
        return clean(clone.innerText || clone.textContent);
    }
    // Oracle's own "already applied" tag renders in the tile header once the candidate is signed
    // in; the title is excluded so a title like "Applied Scientist" never counts.
    function cardShowsApplied(card) {
        const header = card.root.querySelector('.job-tile__header-container, [class*="header-container"]');
        if (!header) return false;
        const clone = header.cloneNode(true);
        clone.querySelectorAll('.job-tile__title, [class*="__title"]').forEach(node => node.remove());
        return /\b(already applied|applied)\b/i.test(clean(clone.textContent));
    }
    // A record counts only if it was made by the current matching rule (card hits never go stale).
    function currentRecord(jobId) {
        const record = scanState[jobId];
        if (!record) return null;
        if (record.source === 'card') return record.oci ? record : null;
        return record.rule === SCAN_RULE ? record : null;
    }
    const needsScan = jobId => !currentRecord(jobId);
    const isSkippedLevel = jobId => { const title = cardTitles[jobId] || scanState[jobId]?.title || ''; return !levelEligible(title) || Boolean(keywordHit(title)); };
    function cardStatus(jobId) {
        const record = currentRecord(jobId);
        const applied = Boolean(appliedState[jobId]);
        if (isSkippedLevel(jobId)) return { tone: 'skipped', applied, record, jobId };
        if (record?.oci) return { tone: 'oci', applied, record };
        if (record?.source === 'detail') return { tone: 'clean', applied, record };
        return { tone: 'pending', applied, record };
    }
    function boxTitle(status) {
        const parts = [];
        if (status.tone === 'skipped') { const kw = keywordHit(cardTitles[status.jobId] || ''); parts.push(kw ? `Skipped: keyword filter "${kw}"` : LEVEL_ABOVE_RE.test(cardTitles[status.jobId] || '') ? 'Skipped: Principal level or above' : 'Skipped: not a Senior-level title'); }
        else if (status.tone === 'oci') parts.push(`OCI — ${status.record?.source === 'detail' ? 'found in the job description' : 'found on the card'}${status.record?.context ? `: "${status.record.context}"` : status.record?.match ? `: "${status.record.match}"` : ''}`);
        else if (status.tone === 'clean') parts.push('No OCI outside the skills/qualifications sections (full description scanned)');
        else parts.push(scanErrors[status.jobId] ? `Scan failed: ${scanErrors[status.jobId]}` : 'Card text has no OCI mention — click Scan to check the full description');
        parts.push(status.applied ? 'Applied' : 'Not applied');
        return parts.join(' · ');
    }
    function decorateCards() {
        const cards = jobCards();
        const appliedFromCards = [];
        for (const card of cards) {
            cardTitles[card.jobId] = card.title;
            // In-page keyword pass: the card's own text (title, location, short description).
            const text = cardText(card);
            const hit = text.match(OCI_RE);
            if (hit && !currentRecord(card.jobId)?.oci && levelEligible(card.title)) void saveScan(card.jobId, { oci: true, source: 'card', match: hit[0], context: '', title: card.title });
            if (!appliedState[card.jobId] && cardShowsApplied(card)) appliedFromCards.push({ jobId: card.jobId, title: card.title, source: 'card-tag' });

            if (getComputedStyle(card.root).position === 'static') card.root.style.position = 'relative';
            let box = card.root.querySelector(':scope > .eve-orc-box');
            if (!box) {
                box = document.createElement('span');
                box.className = 'eve-orc-box';
                // The whole tile opens the preview on click — keep clicks on the box to ourselves.
                ['click', 'mousedown', 'pointerdown'].forEach(type => box.addEventListener(type, event => { event.stopPropagation(); event.preventDefault(); }));
                card.root.prepend(box);
            }
            const status = cardStatus(card.jobId);
            // Principal and above (and any non-Senior title) are removed from view entirely.
            // Hide the grid's <li> wrapper too (one tile per li), so no empty slot is left behind.
            const wrapper = card.root.parentElement?.tagName === 'LI' && card.root.parentElement.children.length === 1 ? card.root.parentElement : null;
            card.root.classList.toggle('eve-orc-hidden', status.tone === 'skipped');
            if (wrapper) wrapper.classList.toggle('eve-orc-hidden', status.tone === 'skipped');
            const scanning = scanInFlight.has(card.jobId);
            const working = applyCurrent === card.jobId;
            const failed = !status.applied && applyFailures[card.jobId];
            const cls = `eve-orc-box ${status.tone}${status.applied ? ' applied' : ''}${scanning || working ? ' scanning' : ''}${failed ? ' failed' : ''}`;
            if (box.className !== cls) box.className = cls;
            const mark = !status.applied && failed ? '!' : status.tone === 'skipped' && !status.applied ? '–' : '';
            if (box.textContent !== mark) box.textContent = mark;
            const title = failed ? `Apply failed: ${failed}` : working ? `Applying now… · ${boxTitle(status)}` : boxTitle(status);
            if (box.title !== title) box.title = title;

            // Top-RIGHT tick box: selects the card for "Apply selected" (Auto OFF).
            let pick = card.root.querySelector(':scope > .eve-orc-select');
            if (!pick) {
                pick = document.createElement('span');
                pick.className = 'eve-orc-select';
                pick.title = 'Select this job for "Apply selected"';
                ['mousedown', 'pointerdown'].forEach(type => pick.addEventListener(type, event => { event.stopPropagation(); event.preventDefault(); }));
                pick.addEventListener('click', event => { event.stopPropagation(); event.preventDefault(); toggleSelected(card.jobId); });
                card.root.prepend(pick);
            }
            const on = selectedIds.has(card.jobId) && status.tone !== 'skipped';
            pick.classList.toggle('on', on);
            pick.classList.toggle('applied', status.applied);
            pick.classList.toggle('off', status.tone === 'skipped'); // level-skipped cards cannot be selected
        }
        updateActionButton();
        if (appliedFromCards.length) void markApplied(appliedFromCards);
        return cards;
    }

    // ── Scan: load every result, then check each job's full description ───────────────────────
    let scanRunning = false;
    const scanInFlight = new Set();
    function showMoreButton() {
        return [...document.querySelectorAll('button')].find(button => !isOurUi(button) && visible(button) && /show more results|load more/i.test(button.innerText || ''));
    }
    // One "SHOW MORE RESULTS" click = one more batch of cards. Scan and Auto Apply work batch by
    // batch (user, 2026-09-26): finish the loaded cards, load the next batch, repeat until the
    // button is gone.
    async function loadMoreOnce() {
        const button = showMoreButton();
        if (!button) return false;
        const before = jobCards().length;
        setStatus(`Loading more results… (${before} loaded so far)`, 'running');
        button.click();
        const grew = await waitFor(() => jobCards().length > before, 10000, 300);
        return Boolean(grew);
    }
    // Primary: the tenant REST API (same data the preview dialog renders). Each field starts with
    // a reset marker so a skills heading in one field never leaks into the next.
    async function fetchDetailHit(jobId) {
        const { apiBase, siteNumber } = tenant();
        if (!apiBase || !siteNumber) throw new Error('Tenant API not found on the page.');
        const url = `${apiBase}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById;Id=%22${encodeURIComponent(jobId)}%22,siteNumber=${encodeURIComponent(siteNumber)}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const item = (await response.json())?.items?.[0];
        if (!item) throw new Error('Job not found.');
        const keys = [...DETAIL_FIELD_ORDER.filter(key => key in item), ...Object.keys(item).filter(key => !DETAIL_FIELD_ORDER.includes(key))];
        const parts = [];
        const walk = (value, key) => {
            if (IGNORED_DETAIL_FIELDS.has(key)) return;
            if (typeof value === 'string') {
                if (!value.trim()) return;
                parts.push('<div data-eve-reset></div>');
                parts.push(/<[a-z][^>]*>/i.test(value) ? value : `<p>${esc(value)}</p>`);
            } else if (Array.isArray(value)) value.forEach(entry => walk(entry, key));
            else if (value && typeof value === 'object') Object.entries(value).forEach(([k, v]) => walk(v, k));
        };
        keys.forEach(key => walk(item[key], key));
        return findOciOutsideSkills(parseHtml(parts.join('')));
    }
    // Fallback (user's described path): open the card's preview dialog (/jobs/preview/<id>/),
    // read it (similar-jobs list excluded), close it.
    async function previewDetailHit(card) {
        const link = card.root.querySelector('a.job-grid-item__link') || card.link;
        link.click();
        const details = await waitFor(() => {
            const node = document.querySelector('.job-details-modal-container .job-details');
            return node && visible(node) && location.pathname.includes(`/preview/${card.jobId}`) && clean(node.innerText).length > 200 ? node : null;
        }, 10000, 250);
        let hit = null;
        if (details) {
            const clone = details.cloneNode(true);
            clone.querySelectorAll('[class*="similar"]').forEach(node => node.remove());
            hit = findOciOutsideSkills(clone);
        }
        document.querySelector('.job-details-modal-container button.app-dialog__close, button.app-dialog__close')?.click();
        await waitFor(() => !document.querySelector('.job-details-modal-container') || !visible(document.querySelector('.job-details-modal-container')), 5000, 200);
        if (!details) throw new Error('Preview did not open.');
        return hit;
    }
    async function scanCard(card, allowPreview) {
        scanInFlight.add(card.jobId);
        decorateCards();
        try {
            let hit;
            try { hit = await fetchDetailHit(card.jobId); }
            catch (error) {
                if (!allowPreview) throw error;
                hit = await previewDetailHit(card);
            }
            await saveScan(card.jobId, { oci: Boolean(hit), source: 'detail', rule: SCAN_RULE, match: hit ? hit.match : '', context: hit ? hit.context : '', title: card.title });
            return { ok: true, oci: Boolean(hit) };
        } catch (error) {
            scanErrors[card.jobId] = error.message || String(error);
            return { ok: false, error: scanErrors[card.jobId] };
        } finally {
            scanInFlight.delete(card.jobId);
            decorateCards();
        }
    }
    const scanErrors = {}; // jobId -> last scan error (tooltip)
    async function runScan() {
        if (scanRunning) { scanRunning = false; setStatus('Stopping scan…', 'waiting'); updateScanButton(); return; }
        if (!isSearchPage()) { setStatus('Open a job search results list, then click Scan.', 'idle'); return; }
        await scanCore();
    }
    // Scans the pending, level-eligible cards among `cards` (4 concurrent API reads; serial
    // preview fallback). Returns counts; honours scanRunning/applyStopRequested for early stop.
    async function scanCards(cards, label) {
        const queue = cards.filter(card => levelEligible(card.title) && !keywordHit(card.title) && needsScan(card.jobId));
        const total = queue.length;
        let done = 0, failed = 0;
        const report = () => setStatus(`${label}: scanning descriptions ${done} / ${total}${failed ? ` · ${failed} failed` : ''}\n${summaryLine()}`, 'running');
        if (total) report();
        // Probe the API once: when it is unreachable, fall back to one preview dialog at a time.
        let apiOk = true;
        if (queue.length) { try { await fetchDetailHit(queue[0].jobId); } catch { apiOk = false; } }
        const concurrency = apiOk ? SCAN_CONCURRENCY : 1;
        const worker = async index => {
            while (scanRunning && !applyStopRequested && queue.length) {
                const card = queue.shift();
                // Preview fallback is serial (one dialog at a time) — only the first worker may use it.
                const result = await scanCard(card, !apiOk && index === 0);
                if (!result.ok) failed += 1;
                done += 1;
                report();
            }
        };
        await Promise.all(Array.from({ length: concurrency }, (_, index) => worker(index)));
        return { done, total, failed };
    }
    async function scanCore() {
        if (scanRunning) return;
        scanRunning = true;
        updateScanButton();
        try {
            const seen = new Set();
            let batch = 1, done = 0, total = 0, failed = 0;
            while (scanRunning) {
                const cards = decorateCards().filter(card => !seen.has(card.jobId));
                cards.forEach(card => seen.add(card.jobId));
                const counts = await scanCards(cards, `Batch ${batch}`);
                done += counts.done; total += counts.total; failed += counts.failed;
                if (!scanRunning) break;
                if (!(await loadMoreOnce())) break;
                batch += 1;
            }
            setStatus(`${scanRunning ? 'Scan complete' : 'Scan stopped'} (${batch} batch${batch === 1 ? '' : 'es'}): ${done} / ${total} descriptions checked${failed ? ` · ${failed} failed (hover a grey box)` : ''}.\n${summaryLine()}`, failed ? 'waiting' : 'idle');
        } finally {
            scanRunning = false;
            updateScanButton();
            decorateCards();
        }
    }
    function summaryLine() {
        const cards = jobCards();
        const count = tone => cards.filter(card => cardStatus(card.jobId).tone === tone).length;
        const applied = cards.filter(card => appliedState[card.jobId]).length;
        return `${cards.length} listed · ${count('skipped')} skipped (not Senior) · ${count('oci')} OCI (yellow) · ${count('clean')} clean (green) · ${count('pending')} not scanned · ${applied} applied`;
    }

    // ── Applied harvest: /my-profile lists the candidate's applications ───────────────────────
    let harvestDone = false;
    async function harvestProfile() {
        if (!isProfilePage()) { harvestDone = false; return; }
        // The Active list is paginated behind "SHOW MORE" — expand it (one click per tick).
        const showMore = document.querySelector('button.cs-show-more-applications');
        if (showMore && visible(showMore)) showMore.click();
        const entries = [];
        for (const link of document.querySelectorAll('a[href*="/job/"], a[href*="/preview/"]')) {
            if (isOurUi(link) || link.closest('.favourite-jobs__list, header')) continue;
            const jobId = jobIdFromHref(link.getAttribute('href'));
            if (!jobId) continue;
            // Live anatomy (2026-09-26): li.cs-application-tile > a.cs-job-info__title (+ .cs-job-info__location,
            // "Applied on MM/DD/YYYY"), in Active and Inactive lists — both count as applied.
            const item = link.closest('li.cs-application-tile, li, tr, article') || link;
            const dateMatch = clean(item.innerText).match(/\b(?:applied|submitted)\b[^0-9A-Za-z]*(?:on\s+)?([A-Z][a-z]{2,8}\.? \d{1,2},? \d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})/i);
            // A tile without "Applied on <date>" is a draft / in-progress application, not an
            // application (seen live 2026-09-26: an interrupted apply listed the job with no date).
            if (!dateMatch) continue;
            const where = clean(item.querySelector('.cs-job-info__location')?.innerText || '').slice(0, 120);
            entries.push({ jobId, title: clean(link.innerText).slice(0, 160), location: where, source: 'my-profile', appliedAt: dateMatch[1] });
        }
        if (!entries.length) return;
        const before = Object.keys(appliedState).length;
        await markApplied(entries);
        const added = Object.keys(appliedState).length - before;
        if (!harvestDone || added) setStatus(`Applied jobs synced from your profile: ${entries.length} found${added ? `, ${added} new` : ''} (${Object.keys(appliedState).length} total).`, 'idle');
        harvestDone = true;
        // Opened by a batch run to pick up manual applications: report once SHOW MORE is exhausted.
        if (orchestrated && orchJobId === 'profile-sync' && !document.querySelector('button.cs-show-more-applications')) reportOrchestrated(true, `synced ${entries.length}`);
    }

    // ── Gates ─────────────────────────────────────────────────────────────────────────────────
    let eveEnabled = true;
    let autoModeEnabled = true;
    async function refreshGates() {
        const result = await storageGet(['settings', 'eveApplyMode']);
        eveEnabled = result.settings?.autopilotEnabled !== false;
        autoModeEnabled = orchestrated || result.eveApplyMode !== 'manual';
        return eveEnabled;
    }

    // ── Account / profile ─────────────────────────────────────────────────────────────────────
    // The Oracle account e-mail comes from the gitignored secrets file (background stores it as
    // `oracleAccount`); identity fields from `eveProfile` (profile.local.json). Never hardcoded.
    let ORACLE_ACCOUNT = { email: '' };
    let PROFILE = {};
    async function loadAccount() {
        const stored = await storageGet(['oracleAccount', 'eveProfile']);
        PROFILE = stored.eveProfile && typeof stored.eveProfile === 'object' ? stored.eveProfile : {};
        ORACLE_ACCOUNT = stored.oracleAccount && stored.oracleAccount.email ? stored.oracleAccount : { email: PROFILE.email || '' };
    }
    const PROFILE_TEXT = [
        { re: /^(full|legal) name$/i, key: 'fullName' },
        { re: /^first name/i, key: 'firstName' }, { re: /^last name/i, key: 'lastName' },
        { re: /^phone/i, key: 'phone' }, { re: /linkedin/i, key: 'linkedin' }, { re: /github/i, key: 'github' },
        { re: /^city$/i, key: 'city' }, { re: /^(zip|postal)/i, key: 'zip' }
    ];
    function profileText(label) {
        if (!label || label.length > 45 || label.includes('?')) return '';
        if (/^e-?mail/i.test(label)) return ORACLE_ACCOUNT.email || '';
        const hit = PROFILE_TEXT.find(entry => entry.re.test(label));
        return hit && PROFILE[hit.key] != null ? String(PROFILE[hit.key]) : '';
    }

    // ── Shared question bank (question-bank.js is loaded before this script) ──────────────────
    // Same resolution as T1: Greenhouse topics + Workday extras, plus Workday's voluntary
    // disclosures for the EEO block (gender / race / Hispanic / veteran). Always on for Oracle.
    function bankEntries() {
        try {
            const shared = (typeof self !== 'undefined' ? self : window).EVE_SHARED_QUESTION_BANK;
            if (!shared) return [];
            const own = shared.greenhouse?.questions || [];
            const extras = shared.extrasFor ? shared.extrasFor('greenhouse') : [];
            const eeo = shared.workday?.voluntaryDisclosures || [];
            return [...own, ...extras, ...eeo];
        } catch { return []; }
    }
    function optionPicker(entry, options) {
        const opts = (options || []).filter(Boolean);
        if (!opts.length) return '';
        const pick = pred => opts.find(text => { try { return pred(text); } catch { return false; } }) || '';
        if (entry.optionCandidates) {
            for (const rx of entry.optionCandidates) { const hit = pick(t => rx.test(t)); if (hit) return hit; }
            return '';
        }
        if (entry.optionMatch) return pick(t => entry.optionMatch.test(t));
        if (entry.choose === 'yes') return pick(t => /^\s*yes\b/i.test(t) || /^\s*i (can|agree|acknowledge|affirm)\b/i.test(t));
        if (entry.choose === 'no') return pick(t => /^\s*no\b/i.test(t));
        if (entry.text != null) return pick(t => t.trim().toLowerCase() === String(entry.text).trim().toLowerCase());
        if (entry.label != null) return pick(t => t.trim().toLowerCase() === String(entry.label).trim().toLowerCase());
        return '';
    }
    // options: array of option labels (choice controls) or null (free text). Returns the option
    // label to pick / the text to type, or '' when the bank has nothing for this question.
    function resolveBank(label, options) {
        const text = clean(label);
        if (!text) return '';
        const entries = bankEntries();
        for (const entry of entries) {
            if (!entry || !Array.isArray(entry.patterns)) continue;
            if (entry.exclude && entry.exclude.test(text)) continue;
            if (!entry.patterns.some(rx => rx.test(text))) continue;
            if (options) {
                const hit = optionPicker(entry, options);
                if (hit) return hit;
                continue; // a nearby topic that cannot land on these options must not block others
            }
            if (entry.text != null) return String(entry.text);
            if (entry.choose) return entry.choose === 'yes' ? 'Yes' : 'No';
        }
        if (!options) {
            for (const entry of entries) {
                const fu = entry && entry.followUp;
                if (fu && Array.isArray(fu.patterns) && fu.text != null && fu.patterns.some(rx => rx.test(text))) return String(fu.text);
            }
        }
        return '';
    }
    // Every question Eve sees (prefilled or answered) is logged for banking later.
    function recordSeen(question, answer, source) {
        const key = clean(question).slice(0, 300);
        if (!key) return;
        writeQueue = writeQueue.then(async () => {
            const stored = await storageGet([ANSWERS_KEY]);
            const current = stored[ANSWERS_KEY] && typeof stored[ANSWERS_KEY] === 'object' ? stored[ANSWERS_KEY] : {};
            current.seen = current.seen || {};
            current.seen[key] = { answer: String(answer == null ? '' : answer).slice(0, 300), source, jobId: jobIdFromLocation(), at: new Date().toISOString() };
            await storageSet({ [ANSWERS_KEY]: current });
        }).catch(() => { });
    }

    // ── Field primitives (click → act → click away → pause) ───────────────────────────────────
    function realClick(target) {
        const opts = { bubbles: true, cancelable: true, composed: true, view: window, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true };
        try { target.scrollIntoView?.({ block: 'center' }); } catch { }
        target.dispatchEvent(new PointerEvent('pointerdown', opts));
        target.dispatchEvent(new MouseEvent('mousedown', opts));
        target.dispatchEvent(new PointerEvent('pointerup', opts));
        target.dispatchEvent(new MouseEvent('mouseup', opts));
        target.dispatchEvent(new MouseEvent('click', opts));
    }
    function clickAway() {
        try { document.activeElement?.blur?.(); } catch { }
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
    async function fillText(input, value) {
        realClick(input);
        setNativeValue(input, value);
        clickAway();
        await WAIT(FIELD_SETTLE_MS);
    }
    function labelFor(control) {
        const byFor = control.id ? document.querySelector(`label[for="${CSS.escape(control.id)}"]`) : null;
        if (byFor) return clean(byFor.innerText || byFor.textContent);
        const ids = (control.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
        const byIds = ids.map(id => document.getElementById(id)?.innerText).filter(Boolean).join(' ');
        if (byIds) return clean(byIds);
        if (control.getAttribute('aria-label')) return clean(control.getAttribute('aria-label'));
        const row = control.closest('.input-row');
        return clean(row?.querySelector('.input-row__label, label, legend')?.innerText || '');
    }
    const isRequiredControl = control => control.required || control.getAttribute('aria-required') === 'true' || Boolean(control.closest('.input-row')?.querySelector('.input-row__label--required'));
    const inMain = control => Boolean(control.closest('main')) && !isOurUi(control);
    // cx-select (Oracle's combobox): open with the toggle button, options are [role=gridcell] in
    // #<id>-listbox; a real pointer click on the cell commits the value (confirmed live).
    async function cxSelectOptions(input) {
        const toggle = document.getElementById(`${input.id}-toggle-button`);
        if (!toggle) return [];
        if (input.getAttribute('aria-expanded') !== 'true') { realClick(toggle); await WAIT(400); }
        const list = await waitFor(() => document.getElementById(`${input.id}-listbox`), 2500, 100);
        const cells = list ? [...list.querySelectorAll('[role=gridcell]')] : [];
        return cells.map(cell => ({ cell, text: clean(cell.innerText) }));
    }
    async function cxSelectClose(input) {
        if (input.getAttribute('aria-expanded') === 'true') {
            const toggle = document.getElementById(`${input.id}-toggle-button`);
            if (toggle) realClick(toggle); else input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
            await WAIT(200);
        }
    }
    async function cxSelectPick(input, wanted) {
        const options = await cxSelectOptions(input);
        const hit = options.find(o => o.text.toLowerCase() === wanted.toLowerCase()) || options.find(o => o.text.toLowerCase().includes(wanted.toLowerCase()));
        if (!hit) { await cxSelectClose(input); return false; }
        realClick(hit.cell);
        await WAIT(FIELD_SETTLE_MS);
        if (clean(input.value).toLowerCase() !== hit.text.toLowerCase()) { await cxSelectClose(input); return false; }
        return true;
    }

    // ── Section reader / filler ───────────────────────────────────────────────────────────────
    // Reads every visible question of the current section. Prefilled → keep + log. Empty →
    // bank/profile → fill. Empty + required + no answer → reported as missing (the job pauses).
    async function fillSection() {
        const missing = [];
        const seenRows = new Set();
        const note = (question, answer, source) => recordSeen(question, answer, source);

        // 1. Yes/No pill groups (ul[role=radiogroup] > button.cx-select-pill-section).
        for (const group of document.querySelectorAll('main ul[role=radiogroup]')) {
            if (!visible(group) || isOurUi(group)) continue;
            const question = clean(group.getAttribute('aria-label') || labelFor(group));
            const pills = [...group.querySelectorAll('button.cx-select-pill-section, [role=radio]')];
            const options = pills.map(p => clean(p.innerText));
            const chosen = pills.find(p => p.getAttribute('aria-checked') === 'true' || p.classList.contains('cx-select-pill-section--selected'));
            seenRows.add(group.closest('.input-row'));
            if (chosen) { note(question, clean(chosen.innerText), 'prefilled'); continue; }
            const answer = resolveBank(question, options) || (options.length === 1 ? options[0] : '');
            const required = isRequiredControl(group) || Boolean(group.closest('.input-row')?.querySelector('.input-row__label--required'));
            if (!answer) { note(question, '', 'unmatched'); if (required) missing.push(question); continue; }
            const pill = pills[options.findIndex(o => o.toLowerCase() === answer.toLowerCase())];
            realClick(pill); await WAIT(FIELD_SETTLE_MS);
            const ok = pill.getAttribute('aria-checked') === 'true' || pill.classList.contains('cx-select-pill-section--selected');
            note(question, answer, ok ? 'bank' : 'bank-failed');
            if (!ok && required) missing.push(question);
        }

        // 2. cx-select comboboxes (skip composite date pickers and the disabled country code).
        for (const input of document.querySelectorAll('main input.cx-select-input[role=combobox]')) {
            if (!visible(input) || !inMain(input) || input.disabled || input.classList.contains('cx-select-input--disabled')) continue;
            if (input.closest('.datepicker-row__input, .phone-row__prefix')) continue;
            const question = labelFor(input);
            seenRows.add(input.closest('.input-row'));
            if (clean(input.value)) { note(question, input.value, 'prefilled'); continue; }
            const options = await cxSelectOptions(input);
            const labels = options.map(o => o.text);
            const answer = resolveBank(question, labels) || (labels.length === 1 ? labels[0] : '');
            const required = isRequiredControl(input);
            if (!answer) { await cxSelectClose(input); note(question, '', 'unmatched'); if (required) missing.push(question); continue; }
            const ok = await cxSelectPick(input, answer);
            note(question, answer, ok ? 'bank' : 'bank-failed');
            if (!ok && required) missing.push(question);
        }

        // 3. Hidden checkbox groups (EEO race list, single "I am Hispanic or Latino").
        const boxRows = new Map();
        for (const box of document.querySelectorAll('main input[type=checkbox].input-row__hidden-control, main input[type=checkbox]')) {
            if (!inMain(box) || box.closest('#eve-floating-ui')) continue;
            const row = box.closest('.input-row') || box.parentElement;
            if (!boxRows.has(row)) boxRows.set(row, []);
            boxRows.get(row).push(box);
        }
        for (const [row, boxes] of boxRows) {
            const optionLabels = boxes.map(labelFor);
            const rowLabel = clean(row?.querySelector(':scope > form-element-label, :scope > .input-row__label, :scope > label')?.innerText || '');
            const single = boxes.length === 1;
            const question = single ? optionLabels[0] : (rowLabel || optionLabels.join(' / '));
            const checked = boxes.filter(b => b.checked);
            if (checked.length) { note(question, checked.map(labelFor).join('; '), 'prefilled'); continue; }
            const answer = single ? resolveBank(question, ['Yes', 'No']) : resolveBank(question, optionLabels);
            if (!answer) { note(question, '', 'unmatched'); continue; } // voluntary blocks are never required
            if (single && !/^yes$/i.test(answer)) { note(question, 'No', 'bank'); continue; }
            const target = single ? boxes[0] : boxes[optionLabels.findIndex(o => o.toLowerCase() === answer.toLowerCase())];
            if (!target) { note(question, answer, 'bank-failed'); continue; }
            const lab = document.querySelector(`label[for="${CSS.escape(target.id)}"]`) || document.getElementById((target.getAttribute('aria-labelledby') || '').split(/\s+/)[0] || '');
            realClick(lab || target); await WAIT(FIELD_SETTLE_MS);
            if (!target.checked) { target.click(); await WAIT(FIELD_SETTLE_MS); }
            note(question, answer, target.checked ? 'bank' : 'bank-failed');
        }

        // 4. Free text (identity from the profile, then the bank).
        for (const input of document.querySelectorAll('main input.input-row__control, main textarea')) {
            if (!visible(input) || !inMain(input)) continue;
            if (!/^(text|email|tel|url|number|textarea|)$/i.test(input.type || '') || input.type === 'checkbox' || input.type === 'radio') continue;
            if (input.classList.contains('cx-select-input') || /honey/i.test(input.name || input.id || '')) continue;
            const question = labelFor(input);
            if (clean(input.value)) { note(question, input.value, 'prefilled'); continue; }
            const answer = profileText(question) || resolveBank(question, null);
            const required = isRequiredControl(input);
            if (!answer) { if (required) { note(question, '', 'unmatched'); missing.push(question); } continue; }
            await fillText(input, answer);
            note(question, answer, clean(input.value) === clean(answer) ? 'bank' : 'bank-failed');
            if (required && !clean(input.value)) missing.push(question);
        }
        return { missing };
    }
    function invalidRows() {
        return [...document.querySelectorAll('main .input-row--invalid')].filter(visible).map(row => clean(row.querySelector('.input-row__label')?.innerText || 'a field'));
    }
    function paginationButton(kind) {
        return [...document.querySelectorAll('main button')].find(b => visible(b) && !isOurUi(b) && (new RegExp(`^${kind}$`, 'i').test(clean(b.innerText)) || new RegExp(`^${kind}$`, 'i').test(b.getAttribute('aria-label') || ''))) || null;
    }

    // ── Child-tab flow ────────────────────────────────────────────────────────────────────────
    let orchestrated = false;
    let orchJobId = null;
    let orchReported = false;
    // Only a code e-mailed AFTER this tab started counts: Oracle remembers a recently verified
    // account and jumps straight to the code step (seen live 2026-09-26), so the previous job's
    // still-unread code must never be picked up. Rejected codes are excluded on the retry, and the
    // `after` bound never moves forward on "Send New Code" (the first genuine e-mail may arrive
    // after a stale attempt was already rejected).
    const TAB_STARTED_AT = new Date(Date.now() - 3000).toISOString();
    const CODE_LOOKBACK_MS = 60 * 60000;
    let codeRequestedAt = null;
    let codeResendTried = false;
    const usedCodes = [];
    // Codes REJECTED in this tab ("The code isn't valid") — the only ones excluded on a retry.
    // Oracle re-sends the same pending code until it is consumed, so a previously seen code is
    // not stale by itself; staleness is judged by the e-mail time (newer than the code step).
    const rejectedCodes = [];
    const CONSUMED_CODES_KEY = 'oracleConsumedCodes'; // codes a successful VERIFY used up (last 20)
    const REJECTED_CODES_KEY = 'oracleRejectedCodes'; // codes Oracle rejected in any tab (last 20)
    async function rememberRejectedCode(code) {
        const stored = await storageGet([REJECTED_CODES_KEY]);
        const list = Array.isArray(stored[REJECTED_CODES_KEY]) ? stored[REJECTED_CODES_KEY] : [];
        await storageSet({ [REJECTED_CODES_KEY]: [...list.filter(c => c !== code), code].slice(-20) });
    }
    async function rememberConsumedCode(code) {
        const stored = await storageGet([CONSUMED_CODES_KEY]);
        const list = Array.isArray(stored[CONSUMED_CODES_KEY]) ? stored[CONSUMED_CODES_KEY] : [];
        await storageSet({ [CONSUMED_CODES_KEY]: [...list.filter(c => c !== code), code].slice(-20) });
    }
    function reportOrchestrated(ok, message) {
        if (!orchestrated || orchReported) return;
        orchReported = true;
        sendRuntimeMessage({ type: MSG('oracle-tab-done'), ok: Boolean(ok), jobId: orchJobId, message: String(message || '') }).catch(() => { });
    }
    function jobTitleOnPage() {
        return clean(document.querySelector('.job-details__title, h1.heading, main h1')?.innerText || document.title.replace(/ - Oracle.*$/i, ''));
    }
    async function stepJobPage() {
        const button = await waitFor(() => { const b = document.querySelector('button.apply-now-button'); return b && visible(b) && !b.disabled ? b : null; }, 15000, 250);
        if (!button) throw new Error('No APPLY NOW button on the job page.');
        setStatus('Clicking APPLY NOW…', 'running');
        realClick(button);
        const moved = await waitFor(() => (isApplyRoute() && (isEmailStep() || isCodeStep() || currentSection())) || pageRateLimitMinutes(), 15000, 250);
        const limited = pageRateLimitMinutes();
        if (limited) throw Object.assign(new Error(`Oracle blocked verification for ${limited} min (too many attempts).`), { rateLimited: limited });
        if (!moved) throw new Error('APPLY NOW did not open the application.');
    }
    async function stepEmail() {
        if (!ORACLE_ACCOUNT.email) throw new Error('No Oracle account e-mail configured (eve/secrets.local.json → oracleAccountEmail).');
        const email = document.getElementById('primary-email-1');
        setStatus('Entering the account e-mail…', 'running');
        await fillText(email, ORACLE_ACCOUNT.email);
        const agree = document.getElementById('legal-disclaimer-checkbox');
        if (agree && !agree.checked) {
            const lab = document.querySelector('label[for="legal-disclaimer-checkbox"]');
            realClick(lab || agree); await WAIT(FIELD_SETTLE_MS);
            if (!agree.checked) { agree.click(); await WAIT(FIELD_SETTLE_MS); }
        }
        if (!codeRequestedAt) codeRequestedAt = TAB_STARTED_AT;
        const next = paginationButton('next');
        if (!next) throw new Error('No NEXT button on the e-mail step.');
        realClick(next);
        const moved = await waitFor(() => isCodeStep() || currentSection() || pageSubmittedText() || pageRateLimitMinutes(), 45000, 250);
        const limited = pageRateLimitMinutes();
        if (limited) throw Object.assign(new Error(`Oracle blocked verification for ${limited} min (too many attempts).`), { rateLimited: limited });
        if (!moved) throw new Error('The e-mail step did not advance within 45 s (is the address accepted?).');
    }
    async function stepCode() {
        setStatus('Code requested — waiting 6 s before reading the inbox…', 'running');
        await WAIT(CODE_REQUEST_LAG_MS);
        setStatus('Waiting for the verification code e-mail…', 'running');
        const storedConsumed = await storageGet([CONSUMED_CODES_KEY, REJECTED_CODES_KEY]);
        const deadCodes = Array.isArray(storedConsumed[REJECTED_CODES_KEY]) ? storedConsumed[REJECTED_CODES_KEY] : [];
        // Is Oracle only offering a code that was already rejected? Then no amount of waiting helps.
        try {
            const probe = await sendRuntimeMessage({ type: MSG('get-verification-code'), request: { account: ORACLE_ACCOUNT.email, from: 'oracle\\.com', subject: 'verification|verify|code', codePattern: '(?:pass\\s?code|verification code|code)[^0-9]{0,24}(\\d{4,8})', after: new Date(Date.now() - CODE_LOOKBACK_MS).toISOString(), exclude: [], timeoutMs: 1500 } });
            if (probe?.code && deadCodes.includes(String(probe.code)) && Date.parse(probe.issued || 0) > Date.now() - 10 * 60000) {
                throw Object.assign(new Error(`Oracle keeps issuing code ${probe.code}, which it already rejected. Verify once by hand (e.g. "communicate by phone instead") or wait for Oracle to reset it — the batch is stopped.`), { deadCode: true });
            }
        } catch (error) { if (error.deadCode) throw error; /* no mail at all yet — carry on */ }
        const request = {
            account: ORACLE_ACCOUNT.email, from: 'oracle\\.com', subject: 'verification|verify|code',
            codePattern: '(?:pass\\s?code|verification code|code)[^0-9]{0,24}(\\d{4,8})',
            after: rejectedCodes.length ? codeRequestedAt : new Date(Date.now() - CODE_LOOKBACK_MS).toISOString(),
            exclude: [...rejectedCodes, ...(Array.isArray(storedConsumed[CONSUMED_CODES_KEY]) ? storedConsumed[CONSUMED_CODES_KEY] : [])],
            timeoutMs: CODE_TIMEOUT_MS
        };
        let found;
        try { found = await sendRuntimeMessage({ type: MSG('get-verification-code'), request }); }
        catch (error) {
            const limited = pageRateLimitMinutes();
            if (limited) throw Object.assign(new Error(`Oracle blocked verification for ${limited} min (too many attempts).`), { rateLimited: limited });
            const resend = [...document.querySelectorAll('main button')].find(b => /send new code/i.test(clean(b.innerText)) && visible(b) && !b.disabled);
            if (!resend || codeResendTried) throw Object.assign(new Error('No verification code e-mail arrived (Oracle may be throttling codes).'), { backoff: 5 });
            codeResendTried = true;
            codeRequestedAt = new Date(Date.now() - 1000).toISOString();
            setStatus('No code e-mail yet — asking Oracle to send a new code (once)…', 'running');
            realClick(resend);
            await WAIT(CODE_REQUEST_LAG_MS);
            try { found = await sendRuntimeMessage({ type: MSG('get-verification-code'), request: { ...request, after: codeRequestedAt } }); }
            catch (again) {
                const limitedNow = pageRateLimitMinutes();
                if (limitedNow) throw Object.assign(new Error(`Oracle blocked verification for ${limitedNow} min (too many attempts).`), { rateLimited: limitedNow });
                throw Object.assign(new Error('No verification code e-mail arrived after a resend (Oracle may be throttling codes).'), { backoff: 5 });
            }
        }
        const code = String(found.code || '');
        usedCodes.push(code);
        setStatus(`Code received (${found.title || 'e-mail'}). Verifying…`, 'running');
        const boxes = [...document.querySelectorAll('input[id^="pin-code-"]')];
        if (boxes.length >= code.length) {
            for (let i = 0; i < code.length; i += 1) { setNativeValue(boxes[i], code[i]); await WAIT(60); }
        } else if (boxes[0]) { setNativeValue(boxes[0], code); }
        await WAIT(FIELD_SETTLE_MS);
        const verify = paginationButton('verify');
        if (!verify) throw new Error('No VERIFY button on the code step.');
        realClick(verify);
        const moved = await waitFor(() => currentSection() || pageSubmittedText(), 20000, 250);
        if (moved) await rememberConsumedCode(code);
        if (!moved) {
            const limited = pageRateLimitMinutes();
            if (limited) throw Object.assign(new Error(`Oracle blocked verification for ${limited} min (too many attempts).`), { rateLimited: limited });
            // Rejected: Oracle says "A new code was sent" by itself — wait for a DIFFERENT code on the
            // next loop pass (the used one is excluded). Never more than one rejection per job.
            rejectedCodes.push(code);
            await rememberRejectedCode(code);
            if (rejectedCodes.length >= 2) throw Object.assign(new Error('Two verification codes were rejected — backing off.'), { backoff: 5 });
            codeRequestedAt = new Date(Date.now() - 2000).toISOString();
            codeResendTried = true; // the auto-sent code counts as the one resend
            setStatus('Code rejected — waiting for the fresh code Oracle just sent…', 'running');
            await WAIT(1500);
            return;
        }
    }
    // Oracle locks identity verification for the account after too many code attempts/resends
    // (seen live 2026-09-26: "Too Many Attempts. Try Again Later. You reached the maximum number of
    // attempts. Try again in 30 minutes."). While locked, re-sent e-mails carry the same dead code
    // and new tabs get no code at all. Returns the minutes to wait, else 0.
    function pageRateLimitMinutes() {
        const text = clean(document.querySelector('main')?.innerText || '');
        if (!/too many attempts|maximum number of attempts/i.test(text)) return 0;
        return Number((text.match(/try again in (\d+) minutes?/i) || [])[1]) || 30;
    }
    function pageAlreadyAppliedText() {
        const text = clean(document.querySelector('main')?.innerText || '');
        return /already (?:applied|submitted)|you(?:'|’)ve applied|application (?:already )?(?:exists|on file)|previously applied/i.test(text);
    }
    async function stepSection() {
        const section = currentSection();
        const ready = await waitFor(() => paginationButton('next') || paginationButton('submit'), 30000, 250);
        if (!ready) {
            if (pageAlreadyAppliedText()) throw Object.assign(new Error('Oracle says this job was already applied to.'), { alreadyApplied: true });
            throw new Error(`Section ${section}: no NEXT or SUBMIT button (page: ${clean(document.querySelector('main')?.innerText || '').slice(0, 140)})`);
        }
        await WAIT(600);
        setStatus(`Filling section ${section}…`, 'running');
        const { missing } = await fillSection();
        if (missing.length) throw new Error(`Section ${section} needs an answer for: ${missing.join(' | ')}`);
        const next = paginationButton('next');
        if (next) {
            realClick(next);
            const moved = await waitFor(() => currentSection() !== section || pageSubmittedText(), 15000, 250);
            if (!moved) { const flagged = invalidRows(); throw new Error(flagged.length ? `Section ${section} rejected: ${flagged.join(' | ')}` : `Section ${section} did not advance.`); }
            return { submitted: false };
        }
        const submit = paginationButton('submit');
        if (!submit) throw new Error(`Section ${section}: no NEXT or SUBMIT button.`);
        setStatus('All required fields verified — submitting…', 'running');
        realClick(submit);
        const done = await waitFor(() => pageSubmittedText() || !isApplyRoute() || (currentSection() === 0 && !isCodeStep()), 30000, 300);
        if (!done) { const flagged = invalidRows(); throw new Error(flagged.length ? `Submit rejected: ${flagged.join(' | ')}` : 'Submit did not confirm.'); }
        // Leaving the section route after SUBMIT is the confirmation signal; the post-submit page's
        // wording is captured into the result so its exact text can be added to pageSubmittedText().
        if (!pageSubmittedText()) await WAIT(2500);
        const confirmation = clean(document.querySelector('main')?.innerText || document.body?.innerText || '').slice(0, 200);
        if (!pageSubmittedText() && (currentSection() || isCodeStep() || isEmailStep())) {
            const flagged = invalidRows();
            throw new Error(flagged.length ? `Submit rejected: ${flagged.join(' | ')}` : `Submit did not confirm (page says: ${confirmation.slice(0, 120)})`);
        }
        return { submitted: true, confirmation };
    }
    async function runChildFlow() {
        const jobId = orchJobId || jobIdFromLocation();
        const title = jobTitleOnPage();
        try {
            let submitted = null;
            for (let step = 0; step < MAX_FLOW_STEPS; step += 1) {
                const limited = pageRateLimitMinutes();
                if (limited) throw Object.assign(new Error(`Oracle blocked verification for ${limited} min (too many attempts).`), { rateLimited: limited });
                if (pageSubmittedText()) { submitted = submitted || { confirmation: clean(document.querySelector('main')?.innerText || '').slice(0, 200) }; break; }
                if (isCodeStep()) { if (!codeRequestedAt) codeRequestedAt = TAB_STARTED_AT; await stepCode(); }
                else if (isEmailStep()) await stepEmail();
                else if (currentSection()) { const r = await stepSection(); if (r.submitted) { submitted = r; break; } }
                else if (isJobPage()) await stepJobPage();
                else {
                    const rendered = await waitFor(() => isCodeStep() || isEmailStep() || currentSection() || document.querySelector('button.apply-now-button') || pageSubmittedText() || pageRateLimitMinutes(), 15000, 300);
                    if (!rendered) throw new Error('The application page did not render.');
                }
            }
            if (!submitted) throw new Error('Flow ended without a confirmation.');
            await markApplied([{ jobId, title, source: 'eve-submit', appliedAt: new Date().toISOString().slice(0, 10) }]);
            setStatus(`Submitted: ${title}`, 'idle');
            reportOrchestrated(true, `Submitted: ${title} · page: ${submitted.confirmation || ''}`);
        } catch (error) {
            const message = error.message || String(error);
            if (error.alreadyApplied || pageAlreadyAppliedText()) {
                await markApplied([{ jobId, title, source: 'already-applied', appliedAt: '' }]);
                setStatus(`Already applied: ${title}`, 'idle');
                reportOrchestrated(true, `Already applied: ${title}`);
                return;
            }
            if (error.deadCode) { setStatus(`Stopped: ${message}`, 'error'); reportOrchestrated(false, `DEAD_CODE:0:${message}`); return; }
            if (error.rateLimited) { setStatus(`Waiting: ${message}`, 'waiting'); reportOrchestrated(false, `RATE_LIMITED:${error.rateLimited}:${message}`); return; }
            if (error.backoff) { setStatus(`Waiting: ${message}`, 'waiting'); reportOrchestrated(false, `BACKOFF:${error.backoff}:${message}`); return; }
            setStatus(`Paused: ${message}`, 'error');
            reportOrchestrated(false, message);
        }
    }

    // ── Root batch (Auto = all clean jobs; Auto OFF = the ticked jobs) ────────────────────────
    let applyRunning = false;
    let applyStopRequested = false;
    let deadCodeStop = '';
    let applyCurrent = null;
    const applyFailures = {};
    let selectedIds = new Set();
    function loadSelected() {
        try { selectedIds = new Set(JSON.parse(sessionStorage.getItem(SELECT_KEY) || '[]').map(String)); } catch { selectedIds = new Set(); }
    }
    function toggleSelected(jobId) {
        if (isSkippedLevel(jobId)) return;
        if (selectedIds.has(jobId)) selectedIds.delete(jobId); else selectedIds.add(jobId);
        try { sessionStorage.setItem(SELECT_KEY, JSON.stringify([...selectedIds])); } catch { }
        decorateCards();
    }
    async function waitForJobResult(jobId, tabId) {
        const deadline = Date.now() + JOB_TIMEOUT_MS;
        while (Date.now() < deadline) {
            const stored = await storageGet([ORCH_KEY]);
            const result = stored[ORCH_KEY]?.results?.[jobId];
            if (result) return result;
            await WAIT(1000);
        }
        await sendRuntimeMessage({ type: MSG('oracle-close-tab'), tabId, jobId, message: 'Timed out.' }).catch(() => { });
        return { ok: false, message: 'Timed out after 5 minutes.' };
    }
    // Wait out an Oracle verification block (or a soft backoff) with a live countdown; Pause works.
    const BLOCKED_UNTIL_KEY = 'oracleBlockedUntil';
    async function waitMinutes(minutes, why) {
        const until = Date.now() + minutes * 60000 + 15000;
        await storageSet({ [BLOCKED_UNTIL_KEY]: until });
        await waitUntil(until, why);
    }
    async function waitForStoredBlock() {
        const stored = await storageGet([BLOCKED_UNTIL_KEY]);
        const until = Number(stored[BLOCKED_UNTIL_KEY] || 0);
        if (until > Date.now()) await waitUntil(until, 'Oracle verification is still blocked from an earlier run');
    }
    async function waitUntil(until, why) {
        while (Date.now() < until && !applyStopRequested) {
            const left = Math.max(0, Math.ceil((until - Date.now()) / 1000));
            setStatus(`${why}\nResuming in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} (at ${new Date(until).toLocaleTimeString()}). Click Pause to stop.`, 'waiting');
            await WAIT(1000);
        }
    }
    async function applyOne(card, position) {
        applyCurrent = card.jobId; decorateCards();
        setStatus(`${position}: ${card.title}`, 'running');
        let result;
        for (let attempt = 0; attempt < 3; attempt += 1) {
            try {
                await sendRuntimeMessage({ type: MSG('oracle-reset-results'), jobId: card.jobId }).catch(() => { });
                const response = await sendRuntimeMessage({ type: MSG('oracle-open-job'), url: jobUrl(card.jobId), jobId: card.jobId });
                result = await waitForJobResult(card.jobId, response.tabId);
            } catch (error) { result = { ok: false, message: error.message || String(error) }; }
            const dead = String(result.message || '').match(/^DEAD_CODE:\d+:(.*)$/);
            if (dead) { result.message = dead[1]; applyStopRequested = true; deadCodeStop = dead[1]; break; }
            const wait = String(result.message || '').match(/^(RATE_LIMITED|BACKOFF):(\d+):(.*)$/);
            if (result.ok || !wait || applyStopRequested) break;
            result.message = wait[3];
            await waitMinutes(Number(wait[2]), `${wait[1] === 'RATE_LIMITED' ? 'Oracle blocked verification' : 'Backing off'}: ${wait[3]}`);
            if (applyStopRequested) break;
            setStatus(`${position}: ${card.title} (retry ${attempt + 1})`, 'running');
        }
        if (result.ok) { selectedIds.delete(card.jobId); try { sessionStorage.setItem(SELECT_KEY, JSON.stringify([...selectedIds])); } catch { } }
        else applyFailures[card.jobId] = result.message || 'failed';
        applyCurrent = null; decorateCards();
        return result;
    }
    // Before a batch: open /my-profile in a BACKGROUND tab so applications made by hand are known
    // and skipped (user, 2026-09-26). Signed out → the page redirects home, nothing is harvested,
    // the tab is closed after the timeout.
    async function syncAppliedFromProfile() {
        setStatus('Syncing applied jobs from your profile…', 'running');
        let tabId = null;
        try {
            const response = await sendRuntimeMessage({ type: MSG('oracle-open-job'), url: `${location.origin}/en/sites/${siteSlug()}/my-profile`, jobId: 'profile-sync', background: true });
            tabId = response.tabId;
            const deadline = Date.now() + 12000;
            while (Date.now() < deadline) {
                const stored = await storageGet([ORCH_KEY]);
                if (stored[ORCH_KEY]?.results?.['profile-sync']) return;
                await WAIT(1000);
            }
            await sendRuntimeMessage({ type: MSG('oracle-close-tab'), tabId, jobId: 'profile-sync', message: 'Profile sync timed out (signed out?).' }).catch(() => { });
        } catch { /* sync is best-effort */ }
    }
    const RUN_LOCK_KEY = 'oracleRunLock';
    const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let runLockTimer = null;
    async function acquireRunLock() {
        const stored = await storageGet([RUN_LOCK_KEY]);
        const lock = stored[RUN_LOCK_KEY];
        if (lock && lock.id !== RUN_ID && Date.now() - Number(lock.at || 0) < 20000) return false;
        await storageSet({ [RUN_LOCK_KEY]: { id: RUN_ID, at: Date.now() } });
        runLockTimer = setInterval(() => { if (applyRunning) void storageSet({ [RUN_LOCK_KEY]: { id: RUN_ID, at: Date.now() } }); }, 5000);
        return true;
    }
    async function releaseRunLock() {
        clearInterval(runLockTimer); runLockTimer = null;
        const stored = await storageGet([RUN_LOCK_KEY]);
        if (stored[RUN_LOCK_KEY]?.id === RUN_ID) await storageSet({ [RUN_LOCK_KEY]: null });
    }
    async function runApplyBatch(mode) {
        if (applyRunning) return;
        if (!isSearchPage()) { setStatus('Open a job search results list first.', 'idle'); return; }
        if (!(await acquireRunLock())) { setStatus('Another Oracle tab is already running Auto Apply / Apply selected — one run at a time. Pause it there first.', 'waiting'); return; }
        applyRunning = true; applyStopRequested = false;
        updateActionButton();
        let done = 0, ok = 0;
        try {
            await loadAccount();
            if (!ORACLE_ACCOUNT.email) throw new Error('No Oracle account e-mail configured (eve/secrets.local.json → oracleAccountEmail).');
            await sendRuntimeMessage({ type: MSG('oracle-reset') }).catch(() => { });
            await waitForStoredBlock();
            if (applyStopRequested) return;
            await syncAppliedFromProfile();
            if (mode === 'auto') {
                // Batch by batch (user, 2026-09-26): scan the loaded cards, apply to every clean
                // not-yet-applied Senior job among them, then "SHOW MORE RESULTS" and repeat.
                const processed = new Set();
                let batch = 1;
                while (!applyStopRequested) {
                    scanRunning = true;
                    try { await scanCards(decorateCards().filter(card => !processed.has(card.jobId)), `Batch ${batch}`); }
                    finally { scanRunning = false; updateScanButton(); }
                    // Green first, then yellow (user, 2026-09-26): OCI cards are applied to after
                    // the clean ones in the same batch; only applied / failed / non-Senior are skipped.
                    const eligible = jobCards().filter(card => !processed.has(card.jobId) && !appliedState[card.jobId] && !applyFailures[card.jobId] && ['clean', 'oci'].includes(cardStatus(card.jobId).tone));
                    const queue = [...eligible.filter(card => cardStatus(card.jobId).tone === 'clean'), ...eligible.filter(card => cardStatus(card.jobId).tone === 'oci')];
                    jobCards().forEach(card => processed.add(card.jobId));
                    for (const card of queue) {
                        if (applyStopRequested) break;
                        const result = await applyOne(card, `Batch ${batch} · applying ${done + 1} (${ok} submitted so far)`);
                        done += 1; if (result.ok) ok += 1;
                    }
                    if (applyStopRequested) break;
                    if (!(await loadMoreOnce())) break;
                    batch += 1;
                }
            } else {
                const queue = jobCards().filter(card => selectedIds.has(card.jobId) && !isSkippedLevel(card.jobId) && !appliedState[card.jobId]);
                if (!queue.length) { setStatus('Tick the top-right box on the jobs you want, then click Apply selected.', 'idle'); return; }
                for (const card of queue) {
                    if (applyStopRequested) break;
                    const result = await applyOne(card, `Applying ${done + 1} / ${queue.length} (${ok} submitted so far)`);
                    done += 1; if (result.ok) ok += 1;
                }
            }
            const failed = done - ok;
            if (deadCodeStop) setStatus(`Stopped — ${deadCodeStop}\n${ok} submitted this run.`, 'error');
            else setStatus(`${applyStopRequested ? 'Paused' : 'Finished'}: ${ok} submitted, ${failed} need attention (hover a red "!" box).\n${summaryLine()}`, failed ? 'waiting' : 'idle');
        } catch (error) {
            setStatus(`Apply stopped: ${error.message || error}`, 'error');
        } finally {
            applyRunning = false; applyStopRequested = false; applyCurrent = null; deadCodeStop = '';
            await releaseRunLock();
            updateActionButton(); decorateCards();
        }
    }
    async function handleApplyButtonClick() {
        if (!extensionContextAlive()) { setStatus('Eve was updated. Refresh this page (Ctrl+Shift+R) to continue.', 'waiting'); return; }
        if (applyRunning) { applyStopRequested = true; setStatus('Finishing the current job, then pausing…', 'waiting'); updateActionButton(); return; }
        const toggle = document.getElementById('ea-oracle-auto-toggle');
        autoModeEnabled = toggle ? toggle.checked : autoModeEnabled;
        await storageSet({ eveApplyMode: autoModeEnabled ? 'auto' : 'manual' });
        await runApplyBatch(autoModeEnabled ? 'auto' : 'selected');
    }

    // ── Floating panel (kforce/gh skeleton) ───────────────────────────────────────────────────
    let statusMessage = 'Ready. Click Scan to check every listed job for OCI.';
    function setStatus(message, state = 'idle') {
        statusMessage = message;
        document.documentElement.dataset.eveOracleState = state;
        document.documentElement.dataset.eveOracleMessage = message;
        const status = document.getElementById('ea-apply-status');
        if (status) status.textContent = bulletize(message);
        paintIndicator(state);
    }
    function paintIndicator(state) {
        const dot = document.getElementById('ea-status-indicator');
        if (!dot) return;
        const busy = state === 'running' || scanRunning || applyRunning;
        dot.classList.toggle('ea-status-error', state === 'error');
        dot.classList.toggle('ea-status-running', state !== 'error' && busy);
        dot.classList.toggle('ea-status-active', state !== 'error' && !busy);
    }
    function updateActionButton() {
        const button = document.getElementById('ea-oracle-apply-btn');
        if (!button) return;
        const label = applyRunning ? 'Pause' : autoModeEnabled ? 'Auto Apply' : `Apply selected (${selectedIds.size})`;
        if (button.textContent !== label) button.textContent = label;
        button.classList.toggle('ea-btn-pause', applyRunning);
        const toggle = document.getElementById('ea-oracle-auto-toggle');
        if (toggle && toggle.disabled !== applyRunning) toggle.disabled = applyRunning; // one mode per run
    }
    function updateScanButton() {
        const button = document.getElementById('ea-oracle-scan-btn');
        if (!button) return;
        button.textContent = scanRunning ? 'Stop scan' : 'Scan';
        button.classList.toggle('ea-btn-pause', scanRunning);
        paintIndicator(document.documentElement.dataset.eveOracleState || 'idle');
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
            resizing = true; startX = event.clientX; startWidth = panel.getBoundingClientRect().width;
            handle.classList.add('resizing'); event.preventDefault(); event.stopPropagation();
        });
        document.addEventListener('mousemove', event => {
            if (!resizing) return;
            const { min, max } = widthBounds();
            panel.style.width = `${Math.max(min, Math.min(max, startWidth + event.clientX - startX))}px`;
        });
        document.addEventListener('mouseup', () => {
            if (!resizing) return;
            resizing = false; handle.classList.remove('resizing');
            try { localStorage.setItem(WIDTH_KEY, String(panel.getBoundingClientRect().width)); } catch { }
        });
    }
    function injectUI() {
        if (document.getElementById(PANEL_ID) || !eveEnabled || !document.body) return;
        const version = (() => { try { return chrome.runtime.getManifest().version; } catch { return ''; } })();
        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.classList.add('eve-gh-panel');
        panel.innerHTML = `
          <div class="ea-header">
            <button id="ea-toggle-minimize" class="ea-min-btn" title="Hide Eve">−</button>
            <span class="ea-title">Eve · Oracle${version ? ` <span class="ea-version" style="font-size:11px;font-weight:400;opacity:0.65;" title="Extension version">v${esc(version)}</span>` : ''}</span>
            <span id="ea-status-indicator" class="ea-status-active"></span>
          </div>
          <div id="ea-body-apply" class="ea-body">
            <p id="ea-apply-status">${esc(bulletize(statusMessage))}</p>
            <div class="ea-auto-toggle-row">
              <div>
                <label class="ea-mini-label">Auto Apply</label>
                <div class="ea-dim">ON: Auto Apply scans the loaded batch, then applies to its not-yet-applied jobs — green (clean) first, then yellow (OCI) — loads more and repeats. OFF: Apply selected applies only to the jobs ticked in the top-right box. Each job opens in its own tab (e-mail → code from Gmail → 3 sections → submit) and closes when done.</div>
              </div>
              <label class="ea-toggle-switch" title="Enable Auto Apply mode"><input type="checkbox" id="ea-oracle-auto-toggle"><span class="ea-toggle-slider"></span></label>
            </div>
            <div class="ea-btn-row"><button id="ea-oracle-apply-btn" class="ea-btn-save">Auto Apply</button></div>
            <div class="ea-auto-toggle-row" style="border-top:1px solid rgba(128,128,128,0.25);padding-top:8px;margin-top:4px;">
              <div>
                <label class="ea-mini-label">OCI filter</label>
                <div class="ea-dim">Box on each card: brown-yellow = mentions OCI, green = full description clean, grey dashed = not scanned. Only Senior-level titles are shown — Principal and above, non-Senior titles, and titles hit by the Settings → Filters keyword list are hidden and never opened. ✓ = applied. Scan loads every result and checks each description; OCI under a skills/qualifications heading is ignored.</div>
              </div>
            </div>
            <div class="ea-btn-row"><button id="ea-oracle-scan-btn" class="ea-btn-save">Scan</button></div>
            <div class="ea-auto-toggle-row" style="border-top:1px solid rgba(128,128,128,0.25);padding-top:8px;margin-top:4px;">
              <div>
                <label class="ea-mini-label">Keyword filter <span id="ea-oracle-kw-count" class="ea-dim"></span></label>
                <div class="ea-dim">Global list (same as the popup / Settings). On Oracle a card whose TITLE matches is hidden. Separate with commas; /regex/ allowed.</div>
              </div>
              <label class="ea-toggle-switch" title="Enable/disable the keyword filter"><input type="checkbox" id="ea-oracle-kw-toggle"><span class="ea-toggle-slider"></span></label>
            </div>
            <textarea id="ea-oracle-kw-list" class="eve-val-input" rows="3" placeholder="keywords separated by commas" style="width:100%;box-sizing:border-box;margin:4px 0 6px;resize:vertical;"></textarea>
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
        document.getElementById('ea-oracle-apply-btn').addEventListener('click', () => void handleApplyButtonClick());
        document.getElementById('ea-oracle-scan-btn').addEventListener('click', () => void runScan());
        wireKeywordFilterPanel();
        const toggle = document.getElementById('ea-oracle-auto-toggle');
        toggle.checked = autoModeEnabled;
        toggle.addEventListener('change', () => {
            autoModeEnabled = toggle.checked;
            chrome.storage.local.set({ eveApplyMode: autoModeEnabled ? 'auto' : 'manual' });
            updateActionButton();
        });
        chrome.storage.local.get([THEME_KEY], result => {
            panel.classList.add(result[THEME_KEY] === 'light' ? 'eve-theme-light' : 'eve-theme-dark');
        });
        updateActionButton();
        updateScanButton();
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
        return false;
    });
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local') return;
        if (changes.eveApplyMode) {
            autoModeEnabled = changes.eveApplyMode.newValue !== 'manual';
            const toggle = document.getElementById('ea-oracle-auto-toggle');
            if (toggle) toggle.checked = autoModeEnabled;
            updateActionButton();
        }
        // Another Oracle tab (or the profile page) scanned / harvested — repaint from the source.
        if (changes[SCAN_KEY]) scanState = mergeNewer(changes[SCAN_KEY].newValue || {}, scanState);
        if (changes[APPLIED_KEY]) appliedState = changes[APPLIED_KEY].newValue || {};
        if (changes[KEYWORD_FILTER_KEY]) { void loadKeywordFilter().then(() => { renderKeywordFilterPanel(); decorateCards(); }); }
        if (changes[SCAN_KEY] || changes[APPLIED_KEY] || changes[ORCH_KEY]) decorateCards();
        if (changes.settings) {
            eveEnabled = changes.settings.newValue?.autopilotEnabled !== false;
            if (!eveEnabled) {
                scanRunning = false; applyStopRequested = true;
                document.getElementById(PANEL_ID)?.remove();
                document.querySelectorAll('.eve-orc-box, .eve-orc-select').forEach(node => node.remove());
                document.querySelectorAll('.eve-orc-hidden').forEach(node => node.classList.remove('eve-orc-hidden'));
            } else injectUI();
        }
    });
    // Local results not yet flushed by the write queue must not be clobbered by an older snapshot.
    function mergeNewer(stored, local) {
        const out = { ...stored };
        for (const [id, record] of Object.entries(local)) {
            if (!out[id] || (record?.scannedAt || 0) > (out[id].scannedAt || 0)) out[id] = record;
        }
        return out;
    }

    async function boot() {
        await refreshGates();
        if (!eveEnabled) return;
        await loadState();
        await loadKeywordFilter();
        loadSelected();
        // Am I the job tab the root search page opened? (background answers from its tab map; a
        // normal tab gets orchestrated:false.) Retry briefly on job/apply routes — the map write
        // can race the content script.
        if (isJobPage() || isApplyRoute() || isProfilePage()) {
            for (let attempt = 0; attempt < 4; attempt += 1) {
                try {
                    const role = await sendRuntimeMessage({ type: MSG('oracle-tab-role') });
                    if (role.orchestrated) { orchestrated = true; orchJobId = role.jobId || null; break; }
                } catch { /* worker asleep — treat as a normal tab */ }
                await WAIT(500);
            }
        }
        injectUI();
        decorateCards();
        if (orchestrated && orchJobId !== 'profile-sync') {
            await loadAccount();
            setStatus('Applying (opened by the search tab)…', 'running');
            await runChildFlow();
            return;
        }
        // Knockout/React re-render tiles on filter changes and "Show more results"; the SPA also
        // changes routes without reloading — re-decorate and re-harvest on a light tick.
        setInterval(() => {
            if (!eveEnabled || !extensionContextAlive()) return;
            injectUI();
            decorateCards();
            void harvestProfile();
        }, 1200);
    }
    void boot();
})();
