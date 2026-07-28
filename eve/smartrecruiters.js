// Eve — isolated SmartRecruiters ("sr") application adapter (Task 6).
// Owns the jobs.smartrecruiters.com "oneclick-ui" Easy Apply template: a single-page form built
// from SmartRecruiters' SPL design-system web components, most of which render their real
// <input>/<textarea>/<button> INSIDE A SHADOW ROOT under a light-DOM custom element that shares
// the same id (e.g. <spl-input id="first-name-input"> wraps <input id="first-name-input"> in its
// shadow root). Every lookup here must be shadow-piercing (deepQueryAll/deepGetControl) — a plain
// document.getElementById() only reaches the light-DOM wrapper, not the fillable control, and
// calling the native value setter on the wrapper throws "Illegal invocation" (confirmed live
// 2026-07-27 on Kohr Consulting / Seattle "Software Engineer").
//
// DUPLICATION NOTE: small primitives (clean/visible/esc, setNativeValue, WAIT, storageGet/Set,
// realClick, the packaged-artifact fetch) are adapted copies from eve/greenhouse.js, itself
// adapted from eve/workday.js. Deliberately copied, not imported — each content script stays
// self-contained per platform.
(function () {
    'use strict';

    // ── Host detection ────────────────────────────────────────────────────────────────────────
    // jobs.smartrecruiters.com is the anchor domain for the "oneclick-ui" Easy Apply template.
    // Other SmartRecruiters-hosted domains rendering the same template are one-line additions.
    const SR_HOSTS = [
        'jobs.smartrecruiters.com'
        // future smartrecruiters-template hosts go here (one line each)
    ];
    const hostIn = list => list.some(host => location.hostname === host || location.hostname.endsWith(`.${host}`));
    if (!hostIn(SR_HOSTS)) return;
    const IS_TOP = window === window.top;
    if (!IS_TOP) return;

    function hasSrTemplate() {
        return Boolean(document.getElementById('first-name-input') || document.querySelector('spl-input, spl-dropzone'));
    }

    // ── Extension namespace ───────────────────────────────────────────────────────────────────
    const NS = 'eve';
    const MSG = type => `${NS}:${type}`;
    const PANEL_ID = `${NS}-floating-ui`;
    const THEME_KEY = `${NS}Theme`;

    // ── Constants ─────────────────────────────────────────────────────────────────────────────
    const SR_INFO_KEY = 'srSavedAnswers';   // sr-only runtime memory (never savedAnswers / workdaySavedAnswers / ghSavedAnswers)
    const POSITION_KEY = 'eve_sr_panel_pos';
    const WIDTH_KEY = 'eve_sr_panel_width';
    const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024;
    const ARTIFACT_METADATA = Object.freeze({
        resume: Object.freeze({ name: 'Xiaoxiao_Lei_RESUME.pdf', size: 106737 })
    });

    // Identity values from info/myworkdayjobs [CONTACT]/[LINKS] — same source as the gh adapter.
    const SR_PROFILE = Object.freeze({
        firstName: 'Xiaoxiao',
        lastName: 'Lei',
        email: 'xiaoxiaoleijobapp@gmail.com',
        phone: '(571) 376-1882',
        city: 'Dallas',
        // Confirmed live 2026-07-27 answer for the City autocomplete on this template — the first
        // suggestion for "Dallas" (kept for reference; the fill still selects the FIRST live
        // suggestion rather than string-matching this, since the option value is opaque).
        cityConfirmed: 'Dallas, TX, US',
        // LinkedIn WITHOUT the https:// scheme (user, 2026-07-26 rule) — applies everywhere.
        linkedin: 'www.linkedin.com/in/xiaoxiaolei/',
        website: 'https://github.com/Dark417'
    });

    // Default "Message to the Hiring Team" — generic across companies (user, 2026-07-27), mirrors
    // info/myworkdayjobs [COVER LETTER]. Fills unconditionally when that optional field is empty.
    const SR_MESSAGE = [
        'Dear Hiring Manager,',
        '',
        'I am applying for the backend software engineer position at your company. At JPMorgan Chase, I have taken end-to-end ownership of backend services, cloud infrastructure, and financial-data pipelines—from implementation and deployment through release validation and production support. My work has improved data and system reliability, reduced debugging time, strengthened operational readiness, and supported dependable delivery across multiple AWS services and downstream applications.',
        '',
        'I actively use AI to improve how I work. In my engineering workflow, I leverage heavily agentic coding tools for implementation, testing, documentation, and investigation, and I have built agent systems to automate business processes. Outside of work, I code with AI almost every day and use it to automate repetitive tasks and improve personal productivity. I am deeply interested in emerging technologies and the practical potential of AI to transform software development and everyday work.',
        '',
        'I am looking for a team where I can continue growing into an excellent software engineer with strong AI capabilities, take meaningful ownership, and contribute to products with real user and business impact.',
        '',
        'I would welcome the opportunity to learn more about your team, product, and engineering challenges, and to discuss how my experience in backend systems, data platforms, reliability, and AI-assisted development could contribute to your company.',
        '',
        'Sincerely,',
        'Xiaoxiao Lei'
    ].join('\n');

    // ── Tiny shared helpers (adapted from greenhouse.js / workday.js) ────────────────────────
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
    const SR_FIELD_SETTLE_MS = 500;
    async function fillTextField(input, value) {
        realClick(input);
        try { input.focus(); } catch { }
        setNativeValue(input, value);
        clickAway();
        await WAIT(SR_FIELD_SETTLE_MS);
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
    // Types one character at a time with real keydown/keypress/input/keyup per character — the
    // City autocomplete's RxJS pipeline (Angular) is confirmed live to sometimes never render
    // suggestions for a single bulk setNativeValue()-style call even with a 10s wait, alongside an
    // "Uncaught (in promise)" page error suggesting its search observable gets cancelled rather
    // than the request just being slow. Per-character typing mirrors a real user more closely.
    async function typeCharacters(input, value) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        try { input.focus(); } catch { }
        setter.call(input, '');
        input.dispatchEvent(new InputEvent('input', { bubbles: true, data: '', inputType: 'deleteContentBackward' }));
        let current = '';
        for (const char of value) {
            current += char;
            input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: char }));
            setter.call(input, current);
            input.dispatchEvent(new InputEvent('input', { bubbles: true, data: char, inputType: 'insertText' }));
            input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: char }));
            await WAIT(80);
        }
    }

    // ── Shadow-piercing DOM access (the load-bearing primitive on this template) ────────────────
    // SmartRecruiters' SPL web components render the real form control inside a shadow root, using
    // the SAME id as the light-DOM host (spl-input#first-name-input wraps input#first-name-input).
    // deepQueryAll walks light DOM + every nested shadow root; deepGetControl picks the actual
    // fillable tag (INPUT/TEXTAREA/SELECT/BUTTON) out of the id's several matches.
    function deepQueryAll(root, selector) {
        const out = [];
        (root || document).querySelectorAll(selector).forEach(el => out.push(el));
        (root || document).querySelectorAll('*').forEach(el => { if (el.shadowRoot) out.push(...deepQueryAll(el.shadowRoot, selector)); });
        return out;
    }
    function deepGetControl(id) {
        const matches = deepQueryAll(document, `#${CSS.escape(id)}`);
        return matches.find(el => ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(el.tagName)) || null;
    }

    // ── Form presence / fields ───────────────────────────────────────────────────────────────
    function srRoot() { return hasSrTemplate() ? document.body : null; }

    // Plain text inputs, id-driven (confirmed live 2026-07-27).
    const SR_TEXT_FIELDS = [
        { id: 'first-name-input', value: () => SR_PROFILE.firstName },
        { id: 'last-name-input', value: () => SR_PROFILE.lastName },
        { id: 'email-input', value: () => SR_PROFILE.email },
        { id: 'confirm-email-input', value: () => SR_PROFILE.email },
        { id: 'linkedin-input', value: () => SR_PROFILE.linkedin },
        { id: 'website-input', value: () => SR_PROFILE.website }
        // facebook-input / twitter-input intentionally left blank — no bank value for them.
    ];

    async function fillTextFields(report) {
        for (const field of SR_TEXT_FIELDS) {
            const input = deepGetControl(field.id);
            if (!input) continue;
            if (clean(input.value)) { report.skipped.push(field.id); continue; }
            await fillTextField(input, field.value());
            report.filled.push(field.id);
        }
    }

    // City autocomplete (spl-autocomplete#spl-form-element_10): type, wait for the suggestion
    // listbox (rendered as a light-DOM <div slot="menu"> sibling — NOT inside a shadow root, so
    // a plain document.getElementById reaches it), then click the first <spl-select-option>.
    // Never guess a city outside the list; leave blank and report if no suggestion ever appears.
    const SR_SEARCH_SETTLE_MS = 600;
    async function fillCity(report) {
        const input = deepGetControl('spl-form-element_10');
        if (!input || clean(input.value)) { if (input) report.skipped.push('city'); return; }
        await typeCharacters(input, SR_PROFILE.city);
        // The suggestion API is debounced; poll patiently rather than giving up early — a premature
        // return here lets the NEXT field's focus() blur this input and silently wipe the in-flight
        // typed text (confirmed live: City has no required-field marker, so a timeout is safe —
        // never guess a city outside the real suggestion list).
        let menu = null;
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline) {
            await WAIT(SR_SEARCH_SETTLE_MS);
            menu = document.getElementById(`menu-${input.id}`);
            if (menu && menu.querySelector('spl-select-option')) break;
            menu = null;
        }
        if (!menu) { report.failed.push('city (no suggestions rendered)'); return; }
        const first = menu.querySelector('spl-select-option');
        realClick(first);
        await WAIT(300);
        if (clean(input.value)) report.filled.push('city');
        else report.failed.push('city (selection did not commit)');
    }

    // Phone number (spl-phone-field#spl-form-element_5). Country code
    // (spl-select#spl-form-element_13) is left at its page default — SmartRecruiters pre-selects
    // it from the job/browser locale and the live Kohr Consulting (Seattle) page already defaulted
    // to United States (+1); only the number itself is filled.
    async function fillPhone(report) {
        const input = deepGetControl('spl-form-element_5');
        if (!input) return;
        if (clean(input.value)) { report.skipped.push('phone'); return; }
        await fillTextField(input, SR_PROFILE.phone);
        report.filled.push('phone');
    }

    // Resume upload — packaged artifact attached to EVERY resume dropzone on the page (the top
    // "Easy Apply" parse-and-autofill dropzone AND the "Resume" section dropzone both accept
    // resume file types and both carry id="file-input" scoped to their own shadow root). The top
    // dropzone's own parser is what SmartRecruiters uses to prefill Experience/Education, so
    // attaching there first gives Eve the most coverage for those optional sections.
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
        const expected = ARTIFACT_METADATA.resume;
        const response = await sendRuntimeMessage({ type: MSG('get-workday-artifact'), artifactId: 'resume' });
        const artifact = response.artifact || {};
        if (artifact.name !== expected.name || artifact.type !== 'application/pdf' || Number(artifact.size) !== expected.size) {
            throw new Error('The packaged resume metadata is invalid.');
        }
        if (!artifact.dataBase64 || artifact.size <= 0 || artifact.size > MAX_ARTIFACT_BYTES) {
            throw new Error('The packaged resume is empty, oversized, or unreadable.');
        }
        const bytes = base64ToBytes(artifact.dataBase64);
        if (bytes.byteLength !== expected.size || String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') {
            throw new Error('The packaged resume contents failed validation.');
        }
        return new File([bytes], expected.name, { type: 'application/pdf', lastModified: 0 });
    }
    function resumeDropzoneInputs() {
        return deepQueryAll(document, 'input[type="file"]')
            .filter(input => /\.pdf\b/i.test(input.getAttribute('accept') || ''));
    }
    async function attachResume(report) {
        const inputs = resumeDropzoneInputs();
        if (!inputs.length) { report.failed.push('resume (no dropzone found)'); return; }
        let file;
        try { file = await packagedResumeFile(); }
        catch (error) { report.failed.push(`resume (${error.message || error})`); return; }
        for (const input of inputs) {
            const transfer = new DataTransfer();
            transfer.items.add(file);
            input.files = transfer.files;
            input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
            input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        }
        report.filled.push(`resume (${inputs.length} dropzone${inputs.length > 1 ? 's' : ''})`);
        // Give the top dropzone's parser time to prefill Personal Information / Experience /
        // Education before the identity-field pass runs (fillTextFields skips already-filled
        // fields, so parser-filled values are never overwritten).
        await WAIT(2500);
    }

    // Message to the Hiring Team (optional textarea) — fills the standing generic message from
    // info/myworkdayjobs [COVER LETTER] when empty.
    async function fillMessage(report) {
        const input = deepGetControl('hiring-manager-message-input');
        if (!input) return;
        if (clean(input.value)) { report.skipped.push('message'); return; }
        await fillTextField(input, SR_MESSAGE);
        report.filled.push('message to hiring team');
    }

    // Consent checkbox (SmartRecruiters data-processing notice) — required to submit; Eve checks
    // it as part of autofill but never clicks Submit itself.
    function checkConsent(report) {
        const box = deepGetControl('noPolicy');
        if (!box || box.checked) return;
        realClick(box);
        box.checked = true;
        box.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        report.filled.push('consent checkbox');
    }

    // ── Apply (autofill-only — Eve never clicks Submit on this template) ────────────────────
    let statusMessage = 'Ready.';
    function setStatus(message, state) {
        statusMessage = message;
        document.documentElement.dataset.eveSrState = state;
        document.documentElement.dataset.eveSrMessage = message;
        const status = document.getElementById('ea-apply-status');
        if (status) status.textContent = bulletize(message);
    }
    async function runSrAutofill() {
        if (!hasSrTemplate()) { setStatus('No SmartRecruiters application form found on this page.', 'error'); return; }
        const report = { filled: [], skipped: [], failed: [] };
        // City FIRST and fully awaited, before anything else calls .focus() on another field —
        // any other element gaining focus blurs City mid-debounce and the autocomplete clears its
        // unconfirmed typed text (confirmed live 2026-07-27: this, not the API itself, was why City
        // kept failing when it ran after the resume-parser's big DOM update).
        setStatus('Setting city…', 'running');
        await fillCity(report);
        setStatus('Uploading resume…', 'running');
        await attachResume(report);
        setStatus('Filling personal information…', 'running');
        await fillTextFields(report);
        await fillMessage(report);
        await fillPhone(report);
        checkConsent(report);
        const seen = { url: location.href, at: new Date().toISOString(), report };
        try {
            const stored = await storageGet([SR_INFO_KEY]);
            const info = stored[SR_INFO_KEY] || {};
            const seenLog = Array.isArray(info.seenApplications) ? info.seenApplications : [];
            seenLog.push(seen);
            info.seenApplications = seenLog.slice(-50);
            await storageSet({ [SR_INFO_KEY]: info });
        } catch { /* non-fatal */ }
        const parts = [];
        if (report.filled.length) parts.push(`Filled: ${report.filled.join(', ')}.`);
        if (report.skipped.length) parts.push(`Already filled: ${report.skipped.join(', ')}.`);
        // Anything left unfilled is listed ONE PER LINE (user, 2026-07-27) — setStatus/bulletize
        // turns each line into its own bullet, so a long list stays readable.
        if (report.failed.length) {
            parts.push(`Needs manual attention (${report.failed.length}):`);
            report.failed.forEach(item => parts.push(item));
        }
        parts.push('Review Experience/Education, then click Submit yourself — Eve never submits this form.');
        setStatus(parts.join('\n'), report.failed.length ? 'error' : 'idle');
    }

    // ── Floating panel (reuses the gh panel skeleton/CSS) ────────────────────────────────────
    let eveEnabled = true;
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
    function injectUI() {
        if (document.getElementById(PANEL_ID) || !eveEnabled || !hasSrTemplate()) return;
        const version = (() => { try { return chrome.runtime.getManifest().version; } catch { return ''; } })();
        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.classList.add('eve-gh-panel');
        panel.innerHTML = `
          <div class="ea-header">
            <button id="ea-toggle-minimize" class="ea-min-btn" title="Hide Eve">−</button>
            <span class="ea-title">Eve · SmartRecruiters${version ? ` <span class="ea-version" style="font-size:11px;font-weight:400;opacity:0.65;" title="Extension version">v${esc(version)}</span>` : ''}</span>
            <span id="ea-status-indicator" class="ea-status-active"></span>
          </div>
          <div id="ea-body-apply" class="ea-body">
            <p id="ea-apply-status">${esc(bulletize(statusMessage))}</p>
            <div class="ea-auto-toggle-row">
              <div>
                <label class="ea-mini-label">Autofill</label>
                <div class="ea-dim">Eve fills the whole application from the answer bank (resume, identity, city, phone, LinkedIn/Website, hiring-team message, consent). It never clicks Submit — review Experience/Education, then submit yourself.</div>
              </div>
            </div>
            <div class="ea-btn-row"><button id="ea-sr-apply-btn" class="ea-btn-save">Autofill</button></div>
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
        document.getElementById('ea-sr-apply-btn').addEventListener('click', () => void runSrAutofill());
        chrome.storage.local.get([THEME_KEY], result => {
            panel.classList.add(result[THEME_KEY] === 'light' ? 'eve-theme-light' : 'eve-theme-dark');
        });
    }

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message?.type === MSG('sr-artifact-probe')) {
            // Diagnostic hook (used by X/XC): fetch the packaged resume through the real
            // background message path and report its validated size, without touching the form.
            packagedResumeFile()
                .then(file => sendResponse({ ok: true, name: file.name, size: file.size, type: file.type }))
                .catch(error => sendResponse({ ok: false, error: error.message || String(error) }));
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
        injectUI();
        // The oneclick-ui app can render its form slightly after our content-script's initial
        // pass; keep retrying like the gh/Workday panels do.
        setInterval(() => { if (eveEnabled) injectUI(); }, 1500);
    }
    boot();
})();
