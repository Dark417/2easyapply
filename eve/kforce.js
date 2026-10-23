// Eve — isolated Kforce application adapter (Task 7).
// Owns www.kforce.com: the React job-search SPA (/find-work/search-jobs/#/detail/<id>/) whose
// "Apply Today" button opens a dropdown (Apply With Indeed / Apply Now), and the classic ASP.NET
// "Apply Online" form (/Jobs/<jobId>/ApplyOnline/) that "Apply Now" POSTs to in the SAME tab.
//
// Flow (user, 2026-08-24): Apply Today → Apply Now → fill identity/address → attach the packaged
// resume ("From this computer") → Employment Eligibility = the SECOND option ("authorized to work
// ... solely for my present employer") → Submit. The flow spans a full-page navigation, so the
// in-progress state lives in sessionStorage (same tab, same origin) and the form page resumes on
// load only when the user activated Auto on the detail page.
//
// DUPLICATION NOTE: small primitives are adapted copies from eve/smartrecruiters.js /
// eve/indeed.js — deliberately copied, each content script stays self-contained per platform.
(function () {
    'use strict';

    // ── Host detection ────────────────────────────────────────────────────────────────────────
    const KFORCE_HOSTS = ['www.kforce.com', 'kforce.com'];
    const hostIn = list => list.some(host => location.hostname === host || location.hostname.endsWith(`.${host}`));
    if (!hostIn(KFORCE_HOSTS)) return;
    if (window !== window.top) return;

    // ── Extension namespace ───────────────────────────────────────────────────────────────────
    const NS = 'eve';
    const MSG = type => `${NS}:${type}`;
    const PANEL_ID = `${NS}-floating-ui`;
    const THEME_KEY = `${NS}Theme`;

    // ── Constants ─────────────────────────────────────────────────────────────────────────────
    const KF_INFO_KEY = 'kforceSavedAnswers';   // kforce-only runtime memory (seen-log)
    const SESSION_KEY = 'eve_kforce_session';
    const POSITION_KEY = 'eve_kforce_panel_pos';
    const WIDTH_KEY = 'eve_kforce_panel_width';
    const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024;
    const FIELD_SETTLE_MS = 300;
    const MAX_AUTO_STEPS = 8;

    // PLACEHOLDER identity — real values come from the gitignored eve/profile.local.json, loaded
    // by background.js into storage as `eveProfile` and merged at fill time.
    const KF_PROFILE_DEFAULTS = Object.freeze({
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'you@example.com',
        phone: '(555) 555-0100',
        state: 'TX',
        zip: '75201',
        country: 'United States'
    });
    let KF_PROFILE = { ...KF_PROFILE_DEFAULTS };
    async function loadRuntimeProfile() {
        try {
            const stored = await storageGet(['eveProfile']);
            const identity = stored && stored.eveProfile;
            if (identity && typeof identity === 'object') KF_PROFILE = { ...KF_PROFILE_DEFAULTS, ...identity };
        } catch { /* placeholders stand */ }
        return KF_PROFILE;
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
    function isOurUi(node) { return Boolean(node?.closest?.(`#${PANEL_ID}`)); }
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
        const opts = { bubbles: true, cancelable: true, composed: true, view: window, button: 0 };
        document.body.dispatchEvent(new PointerEvent('pointerdown', opts));
        document.body.dispatchEvent(new MouseEvent('mousedown', opts));
        document.body.dispatchEvent(new PointerEvent('pointerup', opts));
        document.body.dispatchEvent(new MouseEvent('mouseup', opts));
        document.body.dispatchEvent(new MouseEvent('click', opts));
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
    // Click the field → type → click away → pause (standing T2–T6 rule).
    async function fillTextField(input, value) {
        realClick(input);
        try { input.focus(); } catch { }
        setNativeValue(input, value);
        clickAway();
        await WAIT(FIELD_SETTLE_MS);
    }
    async function selectOptionByValue(select, wanted) {
        const options = [...select.options];
        const match = options.find(o => o.value === wanted)
            || options.find(o => clean(o.text).toLowerCase() === clean(wanted).toLowerCase());
        if (!match) return false;
        realClick(select);
        select.value = match.value;
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
        clickAway();
        await WAIT(FIELD_SETTLE_MS);
        return true;
    }
    async function checkRadio(radio) {
        realClick(radio);
        if (!radio.checked) { radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true })); }
        await WAIT(FIELD_SETTLE_MS);
    }
    async function waitFor(predicate, timeoutMs = 4000, stepMs = 150) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const value = predicate();
            if (value) return value;
            await WAIT(stepMs);
        }
        return null;
    }

    // ── Session (spans the Apply Now POST navigation) ─────────────────────────────────────────
    function loadSession() {
        try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
    }
    function saveSession(state, extra = {}) {
        const previous = loadSession() || {};
        const next = { ...previous, ...extra, state, updatedAt: Date.now() };
        try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(next)); } catch { }
        return next;
    }
    function clearSession() { try { sessionStorage.removeItem(SESSION_KEY); } catch { } }

    // ── Page detection ────────────────────────────────────────────────────────────────────────
    // Route-based, not DOM-based: the SPA renders "Apply Today" asynchronously, so a detail tab
    // looked like the search page at document_end (confirmed live 2026-08-24 — orchestrated tabs
    // booted as root pages and never applied).
    const isDetailRoute = () => /#\/detail\//i.test(location.hash);
    const isDetailPage = () => Boolean(document.getElementById('TK_WIDGET_INITIATOR'));
    const isFormPage = () => /\/ApplyOnline\/?/i.test(location.pathname) && Boolean(document.getElementById('firstName'));
    const isSearchPage = () => /\/find-work\/search-jobs/i.test(location.pathname) && !isDetailRoute();
    function pageThanksText() {
        const text = clean(document.body?.innerText || '').toLowerCase();
        return /thank you for (applying|submitting|your (application|interest|submission))|application (has been|was) (received|submitted)|successfully submitted|resume (has been|was) (received|submitted)/.test(text);
    }

    // Job meta from the detail page (title = the visible H1/H2 that is not the "Search Jobs" header).
    function detailJobMeta() {
        const headings = [...document.querySelectorAll('h1, h2')].filter(h => visible(h) && !isOurUi(h)).map(h => clean(h.innerText)).filter(Boolean);
        const title = headings.find(h => !/^search jobs$/i.test(h)) || clean(document.title);
        const locationEl = document.querySelector('[class*="location" i], [class*="Location"]');
        return { title, company: 'Kforce', location: clean(locationEl?.innerText || '').slice(0, 80) };
    }

    // ── Step 1: detail page → Apply Today → Apply Now ─────────────────────────────────────────
    async function runDetailStep() {
        const initiator = document.getElementById('TK_WIDGET_INITIATOR');
        if (!initiator) return { ok: false, message: 'No "Apply Today" button on this page.' };
        const meta = detailJobMeta();
        saveSession('running', { jobUrl: location.href, meta });
        realClick(initiator);
        // Do NOT wait for the dropdown to become visible: in a background tab (root "Apply All")
        // the reveal animation never runs (rAF/animations are paused while hidden — confirmed live
        // 2026-08-24), yet the "Apply Now" link is already in the DOM and its click handler works
        // regardless of display. Only wait for the link to exist.
        const applyNow = await waitFor(() => {
            const container = document.getElementById('TK_WIDGET_CONTAINER');
            return container?.querySelector('.TK_WIDGET[rel="form"] a, .TK_WIDGET a') || null;
        }, 5000);
        if (!applyNow) { saveSession('waiting'); return { ok: false, message: 'No "Apply Now" link found under Apply Today.' }; }
        await waitFor(() => visible(applyNow), document.hidden ? 300 : 1500);
        await WAIT(FIELD_SETTLE_MS);
        setStatus('Clicking "Apply Now"…', 'running');
        // Apply Now POSTs #ApplyWithForm to /Jobs/<id>/ApplyOnline/ in this tab; the form page
        // resumes from the saved session after the navigation.
        realClick(applyNow);
        const navigated = await waitFor(() => isFormPage(), 8000, 250);
        if (!navigated) {
            // Some layouts require the native onclick handler; fall back to the form submit.
            const form = document.getElementById('ApplyWithForm');
            if (form) { try { form.submit(); } catch { } }
            await WAIT(1500);
        }
        return { ok: true, message: 'Opened the Apply Online form.', navigating: true };
    }

    // ── Step 2: Apply Online form ─────────────────────────────────────────────────────────────
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
    async function packagedResumeFile() {
        const response = await sendRuntimeMessage({ type: MSG('get-workday-artifact'), artifactId: 'resume' });
        const artifact = response.artifact || {};
        if (artifact.type !== 'application/pdf' || !artifact.name) throw new Error('The packaged resume metadata is invalid.');
        if (!artifact.dataBase64 || artifact.size <= 0 || artifact.size > MAX_ARTIFACT_BYTES) throw new Error('The packaged resume is empty, oversized, or unreadable.');
        const bytes = base64ToBytes(artifact.dataBase64);
        if (bytes.byteLength !== Number(artifact.size) || String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') throw new Error('The packaged resume contents failed validation.');
        return new File([bytes], artifact.name, { type: 'application/pdf', lastModified: 0 });
    }

    const phoneDigits = () => String(KF_PROFILE.phone || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
    const KF_TEXT_FIELDS = [
        { id: 'firstName', value: () => KF_PROFILE.firstName },
        { id: 'lastName', value: () => KF_PROFILE.lastName },
        { id: 'emailAddress', value: () => KF_PROFILE.email },
        { id: 'emailAddressVerify', value: () => KF_PROFILE.email },
        { id: 'phoneNumberAll', value: () => phoneDigits() },
        { id: 'postalCode', value: () => KF_PROFILE.zip }
    ];

    async function fillTextFields(report) {
        for (const field of KF_TEXT_FIELDS) {
            const input = document.getElementById(field.id);
            if (!input || !visible(input)) continue;
            const value = clean(field.value());
            if (!value) { report.failed.push(`${field.id} (no profile value)`); continue; }
            if (clean(input.value) === value) { report.skipped.push(field.id); continue; }
            await fillTextField(input, value);
            report.filled.push(field.id);
        }
        // The page splits the phone into hidden area/exchange/number parts on its own; mirror
        // them defensively so the POST carries the number even if that script never ran.
        const digits = phoneDigits();
        if (digits.length === 10) {
            const parts = { phoneAreaCode: digits.slice(0, 3), phoneExchange: digits.slice(3, 6), phoneNumber: digits.slice(6) };
            for (const [id, part] of Object.entries(parts)) {
                const hidden = document.getElementById(id);
                if (hidden && !clean(hidden.value)) hidden.value = part;
            }
        }
    }

    async function fillSelects(report) {
        const state = document.getElementById('state');
        if (state) {
            const wanted = clean(KF_PROFILE.state || '');
            if (state.value && state.value === wanted) report.skipped.push('state');
            else if (await selectOptionByValue(state, wanted)) report.filled.push('state');
            else report.failed.push(`state (no option for "${wanted}")`);
        }
        const country = document.getElementById('countryID');
        if (country) {
            const wantedCountry = /canada/i.test(KF_PROFILE.country || '') ? '2' : '1';
            if (country.value === wantedCountry) report.skipped.push('country');
            else if (await selectOptionByValue(country, wantedCountry)) report.filled.push('country');
        }
    }

    // Resume: "From this computer" radio + the file input. Sets the file through a DataTransfer
    // and dispatches change; success is verified by input.files (and the page's own filename echo).
    async function attachResume(report) {
        const fromComputer = document.getElementById('resumeUploadType_0');
        if (fromComputer && !fromComputer.checked) await checkRadio(fromComputer);
        const input = document.getElementById('uploadFileSystemResume');
        if (!input) { report.failed.push('resume (no file input found)'); return; }
        if (input.files && input.files.length) { report.skipped.push('resume'); return; }
        let file;
        try { file = await packagedResumeFile(); }
        catch (error) { report.failed.push(`resume (${error.message || error})`); return; }
        const transfer = new DataTransfer();
        transfer.items.add(file);
        input.files = transfer.files;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        if (!(input.files && input.files.length)) { report.failed.push('resume (file did not attach)'); return; }
        // The page uploads the file to Kforce's resume service on change and, on the SignalR
        // "documentCompleted" callback, fills hidden #resumeGuid/#resumeData/#resumeFilename and
        // the parsed text into #resume (server requires ≥200 chars). Submitting before that
        // callback fails with "Resume is required (minimum 200 characters)" — confirmed live under
        // 3-tab concurrency 2026-08-24. Wait for the upload to complete.
        const uploaded = await waitFor(resumeUploadComplete, RESUME_UPLOAD_TIMEOUT_MS, 400);
        if (uploaded) report.filled.push(`resume (${file.name}, uploaded)`);
        else report.failed.push('resume (upload did not complete — the page never confirmed the file)');
    }
    const RESUME_UPLOAD_TIMEOUT_MS = 60000;
    const SUBMIT_SETTLE_MS = 1500;
    function resumeUploadComplete() {
        const guid = clean(document.getElementById('resumeGuid')?.value);
        const text = String(document.getElementById('resume')?.value || '');
        return Boolean(guid) && text.trim().length >= 200;
    }

    // Employment Eligibility: the SECOND option — "authorized to work in the United States solely
    // for my present employer" (user, 2026-08-24). Never the sponsorship option.
    async function selectEligibility(report) {
        const radios = [...document.querySelectorAll('input[type="radio"][name="eligibility"]')];
        if (!radios.length) { report.failed.push('employment eligibility (no options found)'); return; }
        const target = radios.find(r => /solely for my present employer/i.test(labelText(r))) || radios[1] || radios[0];
        if (target.checked) { report.skipped.push('employment eligibility'); return; }
        await checkRadio(target);
        report.filled.push('employment eligibility (present employer)');
    }
    function labelText(control) {
        const explicit = control.id ? document.querySelector(`label[for="${CSS.escape(control.id)}"]`) : null;
        return clean((explicit || control.closest('label'))?.innerText || control.parentElement?.innerText || '');
    }

    function missingRequired() {
        const missing = [];
        document.querySelectorAll('form input[required], form select[required], form textarea[required]').forEach(el => {
            if (!visible(el) || isOurUi(el)) return;
            if (!clean(el.value)) missing.push(el.placeholder?.replace(/\s*\*$/, '') || el.name || el.id);
        });
        const file = document.getElementById('uploadFileSystemResume');
        if (file && !(file.files && file.files.length)) missing.push('Resume');
        else if (file && !resumeUploadComplete()) missing.push('Resume (upload not confirmed)');
        if (!document.querySelector('input[name="eligibility"]:checked')) missing.push('Employment Eligibility');
        return missing;
    }

    async function runFormStep({ submit }) {
        const report = { filled: [], skipped: [], failed: [] };
        await loadRuntimeProfile();
        setStatus('Filling your information…', 'running');
        await fillTextFields(report);
        await fillSelects(report);
        setStatus('Attaching resume…', 'running');
        await attachResume(report);
        await selectEligibility(report);
        const missing = missingRequired();
        const parts = [];
        if (report.filled.length) parts.push(`Filled: ${report.filled.join(', ')}.`);
        if (report.skipped.length) parts.push(`Already filled: ${report.skipped.join(', ')}.`);
        if (report.failed.length) { parts.push(`Needs manual attention (${report.failed.length}):`); report.failed.forEach(item => parts.push(item)); }
        if (missing.length) {
            parts.push(`Still required: ${missing.join(', ')}. Fix them, then click Apply again.`);
            saveSession('waiting');
            return { ok: false, message: parts.join('\n') };
        }
        if (!submit) {
            parts.push('Form complete. Auto is off — click Apply to submit.');
            saveSession('waiting');
            return { ok: true, message: parts.join('\n'), done: true };
        }
        const button = document.getElementById('SubmitButton');
        if (!button || button.disabled) { saveSession('waiting'); return { ok: false, message: 'Submit button not available.' }; }
        const session = loadSession() || {};
        saveSession('submitted', { formUrl: location.href, meta: session.meta || { title: clean(document.title), company: 'Kforce', location: '' } });
        setStatus('Submitting…', 'running');
        await WAIT(SUBMIT_SETTLE_MS);   // user, 2026-08-24: 1.5 s pause before Submit
        realClick(button);
        // Never click Submit twice: wait for the navigation / confirmation, then report.
        const confirmed = await waitFor(() => !isFormPage() || pageThanksText(), 25000, 300);
        if (confirmed) return finishSubmitted();
        // Still on the form: the site's validation rejected something — surface its messages
        // (the kforceAlert dialog / validation summary; never generic "[class*=error]" noise).
        const errors = [...document.querySelectorAll('.field-validation-error, .validation-summary-errors, [role="alert"], .ui-dialog, .kforce-alert, .modal:not([style*="display: none"])')]
            .filter(visible).map(el => clean(el.innerText)).filter(text => text && /error|required|invalid|failed/i.test(text)).slice(0, 4);
        saveSession('waiting');
        return { ok: false, message: `Submit did not go through.${errors.length ? `\n${errors.join('\n')}` : ' Check the page for validation messages.'}` };
    }

    function finishSubmitted() {
        const session = loadSession() || {};
        const meta = session.meta || {};
        try {
            sendRuntimeMessage({
                type: 'eve:record-applied-job',
                record: {
                    platform: 'kforce',
                    title: meta.title || clean(document.title),
                    company: meta.company || 'Kforce',
                    location: meta.location || '',
                    url: session.jobUrl || session.formUrl || location.href,
                    mode: autoModeEnabled ? 'auto' : 'manual',
                    appliedAt: new Date().toISOString(),
                    timestamp: Date.now()
                }
            }).catch(() => { });
        } catch { /* non-fatal */ }
        (async () => {
            try {
                const stored = await storageGet([KF_INFO_KEY]);
                const info = stored[KF_INFO_KEY] || {};
                const seenLog = Array.isArray(info.seenApplications) ? info.seenApplications : [];
                seenLog.push({ url: session.jobUrl || location.href, at: new Date().toISOString(), title: meta.title || '' });
                info.seenApplications = seenLog.slice(-50);
                await storageSet({ [KF_INFO_KEY]: info });
            } catch { }
        })();
        clearSession();
        return { ok: true, done: true, submitted: true, message: `Application submitted${meta.title ? ` — ${meta.title}` : ''}. Logged to Applied Jobs.` };
    }

    // ── Step router ───────────────────────────────────────────────────────────────────────────
    async function runCurrentStep({ submit }) {
        const session = loadSession();
        if (session?.state === 'submitted' && (!isFormPage() || pageThanksText())) return finishSubmitted();
        if (isFormPage()) return runFormStep({ submit });
        if (isDetailPage()) return runDetailStep();
        if (isSearchPage()) return { ok: false, done: true, message: 'Open a job (the detail view with "Apply Today"), then click Apply.' };
        return { ok: false, done: true, message: 'No Kforce job or application form on this page.' };
    }

    // ── Gates / Auto & Manual (same contract as Indeed) ───────────────────────────────────────
    let eveEnabled = true;
    let autoModeEnabled = true;
    let loopActive = false;
    let running = false;
    // Orchestrated child tab: opened in the background by the root search page's "Apply All".
    // Root Auto ON implies single-job Auto ON for that tab (user, 2026-08-24), independent of the
    // user's own per-page toggle. Its outcome is reported back and the tab is closed by background.
    let orchestrated = false;
    let orchJobId = null;
    let orchReported = false;
    function reportOrchestrated(ok, message) {
        if (!orchestrated || orchReported) return;
        orchReported = true;
        sendRuntimeMessage({ type: MSG('kforce-tab-done'), ok: Boolean(ok), jobId: orchJobId, message: String(message || '') }).catch(() => { });
    }

    async function refreshGates() {
        const result = await storageGet(['settings', 'eveApplyMode']);
        eveEnabled = result.settings?.autopilotEnabled !== false;
        autoModeEnabled = orchestrated || result.eveApplyMode !== 'manual';
        return eveEnabled;
    }

    async function runKforceAutoApply({ userInitiated = false } = {}) {
        if (loopActive) return;
        if (!await refreshGates() || !autoModeEnabled) {
            setStatus(eveEnabled ? 'Auto mode is off. Enable Auto, then click Auto Apply.' : 'Eve is disabled.', 'idle');
            return;
        }
        const session = loadSession();
        if (!userInitiated && !(session?.activatedByUser && ['running', 'submitted'].includes(session.state))) return;
        loopActive = true;
        running = true;
        saveSession(session?.state === 'submitted' ? 'submitted' : 'running', { activatedByUser: true });
        setStatus('Starting or resuming Kforce Auto Apply…', 'running');
        updateActionButton();
        try {
            for (let count = 0; count < MAX_AUTO_STEPS && running; count += 1) {
                await refreshGates();
                if (!eveEnabled || !autoModeEnabled || !running) { saveSession('waiting'); setStatus('Stopped.', 'idle'); reportOrchestrated(false, 'Stopped.'); return; }
                const result = await runCurrentStep({ submit: true });
                if (result.navigating) { setStatus(result.message, 'running'); return; } // page is unloading; resumes on load
                if (result.done) { setStatus(result.message, result.ok ? 'idle' : 'waiting'); reportOrchestrated(result.ok && result.submitted, result.message); return; }
                if (!result.ok) { saveSession('waiting'); setStatus(result.message, 'waiting'); reportOrchestrated(false, result.message); return; }
                setStatus(result.message, 'running');
                await WAIT(300);
            }
            saveSession('waiting');
            setStatus('Paused after the step limit. Click Auto Apply to resume.', 'waiting');
            reportOrchestrated(false, 'Step limit reached.');
        } catch (error) {
            saveSession('waiting');
            setStatus(`Kforce Auto Apply stopped: ${error.message || error}`, 'error');
            reportOrchestrated(false, `Error: ${error.message || error}`);
        } finally {
            loopActive = false;
            running = false;
            updateActionButton();
        }
    }

    async function runKforceManualApply() {
        if (loopActive) return;
        loopActive = true;
        try {
            // Manual: fill this page; a second click on a complete form submits it.
            const submitNow = isFormPage() && missingRequired().length === 0;
            const result = await runCurrentStep({ submit: submitNow });
            if (result.done || !result.ok) setStatus(result.message, result.ok ? 'idle' : 'waiting');
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
        if (!extensionContextAlive()) { setStatus('Eve was updated. Refresh this page (Ctrl+Shift+R) to continue.', 'waiting'); return; }
        const toggle = document.getElementById('ea-kforce-auto-toggle');
        const requestedAutoMode = toggle ? toggle.checked : autoModeEnabled;
        autoModeEnabled = requestedAutoMode;
        await storageSet({ eveApplyMode: requestedAutoMode ? 'auto' : 'manual' });
        if (autoModeEnabled && (running || loopActive)) {
            running = false;
            saveSession('waiting');
            setStatus('Paused. Click Auto Apply to resume.', 'waiting');
            updateActionButton();
            return;
        }
        if (autoModeEnabled) await runKforceAutoApply({ userInitiated: true });
        else await runKforceManualApply();
    }

    // ── Floating panel (Indeed/gh skeleton) ───────────────────────────────────────────────────
    let statusMessage = 'Ready.';
    function setStatus(message, state = 'idle') {
        statusMessage = message;
        document.documentElement.dataset.eveKforceState = state;
        document.documentElement.dataset.eveKforceMessage = message;
        const status = document.getElementById('ea-apply-status');
        if (status) status.textContent = bulletize(message);
        paintIndicator(state);
    }
    // Status dot colour (user, 2026-08-24): yellow from the moment an apply run is kicked off
    // until it finishes — including a pause and every later page/step of the same run — red on
    // error, green when idle. The colour also survives navigation via the saved session.
    function flowInProgress() {
        const session = loadSession();
        return Boolean(session?.activatedByUser && ['running', 'submitted', 'waiting'].includes(session.state));
    }
    function paintIndicator(state) {
        const dot = document.getElementById('ea-status-indicator');
        if (!dot) return;
        // On the list page only the orchestrator counts — a per-tab session there is stale.
        const busy = state === 'running' || state === 'waiting' || running || loopActive || rootRunning || inFlight.size > 0 || (!isSearchPage() && flowInProgress());
        dot.classList.toggle('ea-status-error', state === 'error');
        dot.classList.toggle('ea-status-running', state !== 'error' && busy);
        dot.classList.toggle('ea-status-active', state !== 'error' && !busy);
    }
    function updateActionButton() {
        const button = document.getElementById('ea-kforce-apply-btn');
        if (!button) return;
        const busy = running || loopActive;
        button.textContent = autoModeEnabled ? (busy ? 'Pause' : 'Auto Apply') : 'Apply';
        button.classList.toggle('ea-btn-pause', autoModeEnabled && busy);
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
            <span class="ea-title">Eve · Kforce${version ? ` <span class="ea-version" style="font-size:11px;font-weight:400;opacity:0.65;" title="Extension version">v${esc(version)}</span>` : ''}</span>
            <span id="ea-status-indicator" class="ea-status-active"></span>
          </div>
          <div id="ea-body-apply" class="ea-body">
            <p id="ea-apply-status">${esc(bulletize(statusMessage))}</p>
            <div class="ea-auto-toggle-row">
              <div>
                <label class="ea-mini-label">Auto Apply</label>
                <div class="ea-dim">Auto runs Apply Today → Apply Now → fills the form, attaches your resume, selects eligibility and submits. Apply (Auto off) advances one step per click.</div>
              </div>
              <label class="ea-toggle-switch" title="Enable Auto Apply mode"><input type="checkbox" id="ea-kforce-auto-toggle"><span class="ea-toggle-slider"></span></label>
            </div>
            <div class="ea-btn-row"><button id="ea-kforce-apply-btn" class="ea-btn-save">Auto Apply</button></div>
            ${isSearchPage() ? `
            <div class="ea-auto-toggle-row" style="border-top:1px solid rgba(128,128,128,0.25);padding-top:8px;margin-top:4px;">
              <div>
                <label class="ea-mini-label">Auto Apply All (this search)</label>
                <div class="ea-dim">Opens every not-yet-applied job below in a background tab (${ROOT_CONCURRENCY} at a time), runs the single-job Auto Apply there, closes the tab and marks the job with a green check. Clicks "Load more" until the list ends.</div>
              </div>
              <label class="ea-toggle-switch" title="Enable root Auto Apply All"><input type="checkbox" id="ea-kforce-root-toggle"><span class="ea-toggle-slider"></span></label>
            </div>
            <div class="ea-btn-row"><button id="ea-kforce-root-btn" class="ea-btn-save">Apply All</button></div>` : ''}
          </div>
          <div class="ea-resize-handle"></div>`;
        document.body.appendChild(panel);
        if (isSearchPage()) {
            document.getElementById('ea-kforce-root-btn').addEventListener('click', () => void handleRootButtonClick());
            const rootToggle = document.getElementById('ea-kforce-root-toggle');
            rootToggle.checked = rootAutoEnabled;
            rootToggle.addEventListener('change', () => {
                rootAutoEnabled = rootToggle.checked;
                chrome.storage.local.set({ [ROOT_AUTO_KEY]: rootAutoEnabled });
                if (!rootAutoEnabled) rootRunning = false; // arming/disarming only; never starts automation
            });
            updateRootButton();
        }
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
        document.getElementById('ea-kforce-apply-btn').addEventListener('click', () => void handleApplyButtonClick());
        const toggle = document.getElementById('ea-kforce-auto-toggle');
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
        if (message?.type === MSG('kforce-artifact-probe')) {
            packagedResumeFile()
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
            const toggle = document.getElementById('ea-kforce-auto-toggle');
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
        // Am I a background tab opened by the root page's "Apply All"? (Answered by background
        // from its tab map; a normal tab gets orchestrated:false.)
        await refreshGates();
        if (!eveEnabled) return;
        injectUI();
        setInterval(() => { if (eveEnabled) injectUI(); }, 1500);
        // The SPA switches list ↔ detail by hash without a reload: rebuild the panel so the root
        // controls appear only on the list, and boot the root orchestrator when the list shows.
        window.addEventListener('hashchange', () => {
            document.getElementById(PANEL_ID)?.remove();
            injectUI();
            if (isSearchPage()) void bootRoot();
        });
        // Background tabs opened by "Apply All" may query before background finished recording
        // the tab id — retry briefly on detail routes only (normal tabs answer false at once).
        for (let attempt = 0; attempt < 6; attempt += 1) {
            try {
                const role = await sendRuntimeMessage({ type: MSG('kforce-tab-role') });
                if (role.orchestrated) { orchestrated = true; orchJobId = role.jobId || null; break; }
            } catch { /* worker asleep or not an extension tab — treat as a normal tab */ }
            if (!isDetailRoute() || attempt >= 2) break;
            await WAIT(500);
        }
        await refreshGates();
        if (isSearchPage()) { await bootRoot(); return; }
        // Resume only a session the user explicitly activated (Auto), after the Apply Now POST
        // navigation or the post-submit confirmation page. Nothing auto-starts otherwise —
        // except an orchestrated tab, whose activation IS the user's root "Apply All" click.
        const session = loadSession();
        if (session?.activatedByUser && session.state === 'submitted') {
            await WAIT(800);
            if (!isFormPage() || pageThanksText()) { const result = finishSubmitted(); setStatus(result.message, 'idle'); reportOrchestrated(true, result.message); }
            else { saveSession('waiting'); reportOrchestrated(false, 'Submit did not confirm.'); }
            return;
        }
        if (session?.activatedByUser && session.state === 'running' && autoModeEnabled && isFormPage()) {
            await WAIT(800);
            await runKforceAutoApply();
            return;
        }
        if (orchestrated && !session) {
            // Fresh orchestrated tab on the job detail page: the SPA renders "Apply Today" async.
            const ready = await waitFor(() => isDetailPage(), 15000, 300);
            if (!ready) { reportOrchestrated(false, 'Job detail did not render.'); return; }
            await WAIT(500);
            await runKforceAutoApply({ userInitiated: true });
        }
        paintIndicator(document.documentElement.dataset.eveKforceState || 'idle');
    }

    // ── Root page orchestrator ("Apply All", user 2026-08-24) ─────────────────────────────────
    // The search list (ul.data-jobs li.row h2 a.linkForJob[href="#/detail/<id>/"]) is walked in
    // order; every not-yet-applied job is opened in a BACKGROUND tab (never focused) through
    // background.js, at most ROOT_CONCURRENCY at a time. The child tab runs the single-job flow
    // above, reports, and is closed by background; the root marks the card green. When the visible
    // list is exhausted, "Load more" is clicked until it disappears. Root Auto is its own toggle
    // (`eveKforceRootAuto`), independent of the per-page single-job toggle.
    const ROOT_AUTO_KEY = 'eveKforceRootAuto';
    const ORCH_KEY = 'kforceOrchestration';
    const ROOT_CONCURRENCY = 3;
    const ROOT_JOB_TIMEOUT_MS = 150000;
    // Every job the root opens must end applied (user, 2026-08-24): a failed child run is retried
    // in a fresh tab up to this many attempts before the card goes red "!".
    const ROOT_MAX_ATTEMPTS = 3;
    const attempts = {}; // jobId -> attempts so far
    // Only titles that literally contain "engineer" are applied to; anything else is skipped and
    // marked hard red (user, 2026-08-24).
    const titleEligible = title => /engineer/i.test(String(title || ''));
    let rootAutoEnabled = false;
    let rootRunning = false;
    let appliedIds = new Set();
    let failedResults = {};
    const inFlight = new Map(); // jobId -> { tabId, openedAt }

    const jobIdFromHref = href => (String(href || '').match(/#\/detail\/([^/?#]+)/) || [])[1] || null;
    function jobCards() {
        return [...document.querySelectorAll('ul.data-jobs li.row')].map(li => {
            const link = li.querySelector('a.linkForJob[href*="#/detail/"]');
            const jobId = jobIdFromHref(link?.getAttribute('href'));
            return link && jobId ? { li, link, jobId, title: clean(link.innerText), url: `${location.origin}/find-work/search-jobs/#/detail/${jobId}/` } : null;
        }).filter(Boolean);
    }
    async function refreshAppliedIds() {
        const stored = await storageGet(['eveApplicationRecords', ORCH_KEY]);
        const ids = new Set();
        (stored.eveApplicationRecords || []).forEach(record => {
            if (record.platform !== 'kforce') return;
            const id = jobIdFromHref(record.url);
            if (id) ids.add(id);
        });
        const results = stored[ORCH_KEY]?.results || {};
        Object.entries(results).forEach(([id, result]) => { if (result?.ok) ids.add(id); });
        appliedIds = ids;
        return ids;
    }
    // Round box in front of each job title: green check when applied, amber while its tab works,
    // red "!" (with the reason as tooltip) when the auto run could not finish.
    function decorateCards() {
        for (const card of jobCards()) {
            let mark = card.li.querySelector(':scope > h2 > .eve-kf-mark');
            if (!mark) {
                mark = document.createElement('span');
                mark.className = 'eve-kf-mark';
                card.link.parentElement.insertBefore(mark, card.link);
            }
            const applied = appliedIds.has(card.jobId);
            const skipped = !applied && !titleEligible(card.title);
            const working = inFlight.has(card.jobId);
            const failed = !applied && !skipped && failedResults[card.jobId];
            mark.classList.toggle('applied', applied);
            mark.classList.toggle('skipped', skipped);
            mark.classList.toggle('working', !applied && !skipped && working);
            mark.classList.toggle('failed', Boolean(failed));
            mark.textContent = applied ? '✓' : skipped ? '✕' : failed ? '!' : '';
            mark.title = applied ? 'Applied' : skipped ? 'Skipped: title does not contain "engineer"' : working ? 'Applying in a background tab…' : failed ? `Not applied after ${ROOT_MAX_ATTEMPTS} attempts: ${failed.message || 'failed'}` : 'Not applied yet';
        }
    }
    function rootStatus(extra) {
        const total = jobCards().length;
        const done = jobCards().filter(c => appliedIds.has(c.jobId)).length;
        const skipped = jobCards().filter(c => !appliedIds.has(c.jobId) && !titleEligible(c.title)).length;
        const failed = jobCards().filter(c => !appliedIds.has(c.jobId) && titleEligible(c.title) && failedResults[c.jobId]).length;
        setStatus(`${extra ? `${extra}\n` : ''}Applied ${done} / ${total} listed · ${skipped} skipped (no "engineer") · ${inFlight.size} in progress · ${failed} need attention.`, rootRunning ? 'running' : 'idle');
    }
    async function openJobTab(card) {
        const response = await sendRuntimeMessage({ type: MSG('kforce-open-job'), url: card.url, jobId: card.jobId });
        inFlight.set(card.jobId, { tabId: response.tabId, openedAt: Date.now(), title: card.title });
    }
    async function clickLoadMore() {
        const button = [...document.querySelectorAll('.data-job-pagination span, .data-job-pagination a, .data-job-pagination button')]
            .find(el => /load more/i.test(el.innerText || '') && visible(el));
        if (!button) return false;
        const before = jobCards().length;
        realClick(button);
        const grew = await waitFor(() => jobCards().length > before, 10000, 300);
        return Boolean(grew);
    }
    async function runRootApplyAll() {
        if (rootRunning) return;
        rootRunning = true;
        updateRootButton();
        try {
            await sendRuntimeMessage({ type: MSG('kforce-reset') }).catch(() => { });
            inFlight.clear();
            failedResults = {};
            for (const key of Object.keys(attempts)) delete attempts[key];
            await refreshAppliedIds();
            decorateCards();
            rootStatus('Apply All started.');
            while (rootRunning) {
                await refreshGates();
                if (!eveEnabled) break;
                const pending = jobCards().filter(c => titleEligible(c.title) && !appliedIds.has(c.jobId) && !inFlight.has(c.jobId) && !failedResults[c.jobId]);
                while (rootRunning && pending.length && inFlight.size < ROOT_CONCURRENCY) {
                    const card = pending.shift();
                    try { await openJobTab(card); }
                    catch (error) {
                        attempts[card.jobId] = (attempts[card.jobId] || 0) + 1;
                        if (attempts[card.jobId] >= ROOT_MAX_ATTEMPTS) failedResults[card.jobId] = { message: error.message || String(error) };
                        await WAIT(1000);
                    }
                    decorateCards();
                    await WAIT(400);
                }
                if (!pending.length && !inFlight.size) {
                    rootStatus('Loading more jobs…');
                    if (!await clickLoadMore()) { rootStatus('All listed jobs processed.'); break; }
                    decorateCards();
                    continue;
                }
                // Timeouts: a child that never reports gets closed and marked.
                for (const [jobId, entry] of [...inFlight]) {
                    if (Date.now() - entry.openedAt > ROOT_JOB_TIMEOUT_MS) {
                        inFlight.delete(jobId);
                        attempts[jobId] = (attempts[jobId] || 0) + 1;
                        if (attempts[jobId] >= ROOT_MAX_ATTEMPTS) failedResults[jobId] = { message: 'Timed out.' };
                        sendRuntimeMessage({ type: MSG('kforce-close-tab'), tabId: entry.tabId, jobId, message: 'Timed out.' }).catch(() => { });
                    }
                }
                decorateCards();
                rootStatus();
                await WAIT(1500);
            }
        } catch (error) {
            setStatus(`Apply All stopped: ${error.message || error}`, 'error');
        } finally {
            rootRunning = false;
            updateRootButton();
            decorateCards();
            paintIndicator(document.documentElement.dataset.eveKforceState || 'idle');
        }
    }
    function onOrchestrationChange(newValue) {
        const results = newValue?.results || {};
        let changed = false;
        for (const [jobId, entry] of [...inFlight]) {
            const result = results[jobId];
            if (!result) continue;
            inFlight.delete(jobId);
            if (result.ok) appliedIds.add(jobId);
            else {
                attempts[jobId] = (attempts[jobId] || 0) + 1;
                // Retry in a fresh tab (it re-enters `pending` on the next loop pass) until the
                // attempt cap; only then is the card marked red "!".
                if (attempts[jobId] >= ROOT_MAX_ATTEMPTS) failedResults[jobId] = result;
                else setStatus(`Retrying (${attempts[jobId] + 1}/${ROOT_MAX_ATTEMPTS}): ${entry.title || jobId} — ${String(result.message || '').split('\n')[0]}`, 'running');
            }
            changed = true;
        }
        if (changed) { decorateCards(); rootStatus(); }
    }
    // While Apply All is on the button is an orange "Pause" and stays that way — through
    // Load more, waits and retries — until the user clicks it, the run ends, or an error stops
    // it (user, 2026-08-24).
    function updateRootButton() {
        const button = document.getElementById('ea-kforce-root-btn');
        if (!button) return;
        button.textContent = rootRunning ? 'Pause' : 'Apply All';
        button.classList.toggle('ea-btn-pause', rootRunning);
    }
    async function handleRootButtonClick() {
        if (!extensionContextAlive()) { setStatus('Eve was updated. Refresh this page (Ctrl+Shift+R) to continue.', 'waiting'); return; }
        const toggle = document.getElementById('ea-kforce-root-toggle');
        rootAutoEnabled = toggle ? toggle.checked : rootAutoEnabled;
        await storageSet({ [ROOT_AUTO_KEY]: rootAutoEnabled });
        if (rootRunning) { rootRunning = false; setStatus('Paused — finishing the tabs already in progress, no new jobs will open.', 'waiting'); updateRootButton(); return; }
        if (!rootAutoEnabled) { setStatus('Root Auto is off. Turn on "Auto Apply All", then click Apply All.', 'idle'); return; }
        await runRootApplyAll();
    }
    let rootBooted = false;
    async function bootRoot() {
        if (rootBooted) { decorateCards(); rootStatus(); return; }
        rootBooted = true;
        clearSession();   // a single-job session never belongs to the list page
        const stored = await storageGet([ROOT_AUTO_KEY]);
        rootAutoEnabled = stored[ROOT_AUTO_KEY] === true;
        const toggle = document.getElementById('ea-kforce-root-toggle');
        if (toggle) toggle.checked = rootAutoEnabled;
        await refreshAppliedIds();
        // The React list renders after our script; wait for cards before the first count.
        await waitFor(() => jobCards().length > 0, 15000, 300);
        decorateCards();
        rootStatus();
        // The React list re-renders on filter/sort/load-more; keep the marks in place.
        setInterval(decorateCards, 1500);
        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName !== 'local') return;
            if (changes[ORCH_KEY]) onOrchestrationChange(changes[ORCH_KEY].newValue);
            if (changes.eveApplicationRecords) refreshAppliedIds().then(decorateCards);
            if (changes[ROOT_AUTO_KEY]) {
                rootAutoEnabled = changes[ROOT_AUTO_KEY].newValue === true;
                const box = document.getElementById('ea-kforce-root-toggle');
                if (box) box.checked = rootAutoEnabled;
                if (!rootAutoEnabled) rootRunning = false; // mode-off stop
            }
        });
    }
    boot();
})();
