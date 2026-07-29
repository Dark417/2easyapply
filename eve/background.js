const DEFAULT_PARAMS = {
    searches: ['California, United States'],
    selectedSearch: 'California, United States',
    ignore: {
        caseSensitive: false,
        keywords: ['founding', 'machine learning']
    },
    linkedin: {
        filters: ['Easy Apply'],
        clickCount: 2,
        minClickDelaySeconds: 0.8,
        // Keywords are a SEPARATE field from the location. `searches`/`selectedSearch` are locations
        // only; gluing them together made LinkedIn fuzzy-match the location words as keywords
        // instead of applying a real geo filter.
        keywords: 'software engineer',
        // Filters applied AFTER the location is committed, as URL params on the geoId-bearing URL.
        // These defaults reproduce what the old hardcoded filter-modal walk selected.
        experience: ['2', '3', '4'],   // f_E: Entry level, Associate, Mid-Senior level
        jobType: ['F'],                // f_JT: Full-time
        remote: [],                    // f_WT: 1 On-site, 2 Remote, 3 Hybrid (off by default)
        easyApply: true,               // f_AL
        timeFilter: { unit: 'hours', hours: 24, days: 1, seconds: 86400 }
    },
    auto: {
        delaysSec: {
            nextJobItem: { min: 0.4, max: 1.1 },
            clickEasyApply: { min: 0.4, max: 1.2 },
            easyApplyScroll: { min: 0.6, max: 1.6 },
            inputFields: { min: 0.2, max: 0.7 },
            nextStep: { min: 0.5, max: 1.3 },
            submitPageScroll: { min: 1.0, max: 2.0 },
            closeSubmitPage: { min: 0.6, max: 1.4 }
        },
        rateLimits: { perMinute: 5, perHour: 30, perDay: 200 },
        burstRest: { every: 5, minSeconds: 5, maxSeconds: 10 }
    },
    customRegex: ['in office']
};

// Filled from profile.local.json at startup (see loadLocalProfile) — whatever PDFs this
// installation points at. Falls back to the packaged defaults below when absent.
let CONFIGURED_ARTIFACTS = null;
// Fallback names only — real installations point at their own PDFs from profile.local.json,
// and a size of 0 means "accept whatever is packaged" (the PDF magic bytes are still checked).
const WORKDAY_ARTIFACTS = Object.freeze({
    resume: Object.freeze({
        path: 'artifacts/resume.pdf',
        name: 'resume.pdf',
        type: 'application/pdf',
        size: 0
    }),
    coverLetter: Object.freeze({
        path: 'artifacts/cover-letter.pdf',
        name: 'cover-letter.pdf',
        type: 'application/pdf',
        size: 0
    })
});

function bytesToBase64(bytes) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
}

// Hosts allowed to request the packaged application artifacts (resume / cover letter): the
// Workday tenants plus the Greenhouse application template hosts. Mirrors GH_HOSTS in
// eve/greenhouse.js — adding a new Greenhouse-template domain is a one-line addition here.
const ARTIFACT_SENDER_HOSTS_RE = /(?:myworkdayjobs|myworkdaysite)\.com$/i;
// Greenhouse-template hosts plus the Ashby template: cape.co embeds the form in a
// jobs.ashbyhq.com iframe, so the artifact request arrives with sender.tab.url = cape.co
// and sender.url = jobs.ashbyhq.com — both hostnames are checked below.
const GH_ARTIFACT_HOSTS = ['job-boards.greenhouse.io', 'my.greenhouse.io', 'ashbyhq.com', 'cape.co', 'www.cape.co'];
// Indeed Smart Apply (Task 5, eve/indeed.js): allowed to fetch the packaged resume/cover letter.
const INDEED_ARTIFACT_HOSTS = ['smartapply.indeed.com'];
// SmartRecruiters Easy Apply (Task 6, eve/smartrecruiters.js): allowed to fetch the packaged resume.
const SR_ARTIFACT_HOSTS = ['jobs.smartrecruiters.com'];
function isArtifactTabSender(sender) {
    try {
        if (!sender?.tab?.id) return false;
        return [sender.url, sender.tab.url].filter(Boolean).some(url => {
            const hostname = new URL(url).hostname;
            if (ARTIFACT_SENDER_HOSTS_RE.test(hostname)) return true;
            return [...GH_ARTIFACT_HOSTS, ...INDEED_ARTIFACT_HOSTS, ...SR_ARTIFACT_HOSTS]
                .some(host => hostname === host || hostname.endsWith(`.${host}`));
        });
    } catch {
        return false;
    }
}

async function getWorkdayArtifact(artifactId, sender) {
    if (!isArtifactTabSender(sender)) throw new Error('Packaged artifact access denied.');
    // A profile-configured artifact wins over the built-in default, so a new installation serves
    // ITS OWN resume/cover letter without touching the code.
    const artifact = (CONFIGURED_ARTIFACTS && CONFIGURED_ARTIFACTS[artifactId]) || WORKDAY_ARTIFACTS[artifactId];
    if (!artifact) throw new Error('Unknown Workday artifact.');
    const response = await fetch(chrome.runtime.getURL(artifact.path));
    if (!response.ok) throw new Error('Packaged Workday artifact is unavailable — check the artifacts entry in profile.local.json.');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (artifact.size && bytes.byteLength !== artifact.size) throw new Error('Packaged Workday artifact size mismatch.');
    if (bytes.length < 5 || String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') {
        throw new Error('Packaged Workday artifact is not a valid PDF.');
    }
    return {
        name: artifact.name,
        type: artifact.type,
        size: artifact.size,
        dataBase64: bytesToBase64(bytes)
    };
}

function mergeDeep(base, patch) {
    const merged = Object.assign({}, base || {});
    Object.entries(patch || {}).forEach(([key, value]) => {
        if (value && typeof value === 'object' && !Array.isArray(value) && merged[key] && typeof merged[key] === 'object' && !Array.isArray(merged[key])) {
            merged[key] = mergeDeep(merged[key], value);
        } else {
            merged[key] = value;
        }
    });
    return merged;
}

function normalizeParams(raw) {
    const params = mergeDeep(DEFAULT_PARAMS, raw || {});
    params.searches = Array.from(new Set((params.searches || []).map(v => String(v || '').trim()).filter(Boolean)));
    if (!params.searches.length) params.searches = [...DEFAULT_PARAMS.searches];
    params.selectedSearch = String(params.selectedSearch || '').trim() || params.searches[0];
    params.ignore = mergeDeep(DEFAULT_PARAMS.ignore, params.ignore || {});
    params.ignore.keywords = Array.from(new Set((params.ignore.keywords || []).map(v => String(v || '').trim()).filter(Boolean)));
    params.linkedin = mergeDeep(DEFAULT_PARAMS.linkedin, params.linkedin || {});
    params.linkedin.filters = Array.from(new Set((params.linkedin.filters || []).map(v => String(v || '').trim()).filter(Boolean)));
    params.linkedin.clickCount = Math.max(1, parseInt(params.linkedin.clickCount, 10) || DEFAULT_PARAMS.linkedin.clickCount);
    // Keywords/location split. A legacy saved value may still have the location glued onto the end
    // of the keywords ("software engineer California, United States"); strip the selected location
    // suffix so the keywords box gets keywords only. Locations themselves are never rewritten.
    const normalizeList = (value, fallback) => {
        const list = Array.from(new Set((Array.isArray(value) ? value : [])
            .map(v => String(v == null ? '' : v).trim()).filter(Boolean)));
        return list.length || Array.isArray(value) ? list : [...fallback];
    };
    let keywordText = String(params.linkedin.keywords ?? DEFAULT_PARAMS.linkedin.keywords).replace(/\s+/g, ' ').trim();
    const selectedLocation = String(params.selectedSearch || '').trim();
    if (selectedLocation && keywordText.toLowerCase().endsWith(selectedLocation.toLowerCase())) {
        keywordText = keywordText.slice(0, keywordText.length - selectedLocation.length).replace(/[\s,]+$/, '').trim();
    }
    params.linkedin.keywords = keywordText;
    params.linkedin.experience = normalizeList(params.linkedin.experience, DEFAULT_PARAMS.linkedin.experience);
    params.linkedin.jobType = normalizeList(params.linkedin.jobType, DEFAULT_PARAMS.linkedin.jobType);
    params.linkedin.remote = normalizeList(params.linkedin.remote, DEFAULT_PARAMS.linkedin.remote);
    params.linkedin.easyApply = params.linkedin.easyApply !== false;
    params.linkedin.minClickDelaySeconds = Math.max(0, Number(params.linkedin.minClickDelaySeconds) || DEFAULT_PARAMS.linkedin.minClickDelaySeconds);
    const timeUnit = params.linkedin.timeFilter?.unit === 'days' ? 'days' : 'hours';
    const hours = Math.min(24, Math.max(0, Number(params.linkedin.timeFilter?.hours ?? 24)));
    const days = Math.min(30, Math.max(0, Number(params.linkedin.timeFilter?.days ?? 1)));
    const seconds = Math.round((timeUnit === 'days' ? days * 24 : hours) * 3600);
    params.linkedin.timeFilter = { unit: timeUnit, hours, days, seconds };
    params.auto = mergeDeep(DEFAULT_PARAMS.auto, params.auto || {});
    const legacyMinSec = Math.max(0, (parseInt(params.auto?.delaysMs?.min, 10) || 300) / 1000);
    const legacyMaxSec = Math.max(legacyMinSec, (parseInt(params.auto?.delaysMs?.max, 10) || 1200) / 1000);
    const normalizeRange = (range, fallback) => {
        const min = Math.max(0, Number(range?.min ?? fallback.min));
        const max = Math.max(min, Number(range?.max ?? fallback.max));
        return { min: Number(min.toFixed(2)), max: Number(max.toFixed(2)) };
    };
    params.auto.delaysSec = {
        nextJobItem: normalizeRange(params.auto.delaysSec?.nextJobItem, { min: legacyMinSec || DEFAULT_PARAMS.auto.delaysSec.nextJobItem.min, max: legacyMaxSec || DEFAULT_PARAMS.auto.delaysSec.nextJobItem.max }),
        clickEasyApply: normalizeRange(params.auto.delaysSec?.clickEasyApply, { min: legacyMinSec || DEFAULT_PARAMS.auto.delaysSec.clickEasyApply.min, max: legacyMaxSec || DEFAULT_PARAMS.auto.delaysSec.clickEasyApply.max }),
        easyApplyScroll: normalizeRange(params.auto.delaysSec?.easyApplyScroll, DEFAULT_PARAMS.auto.delaysSec.easyApplyScroll),
        inputFields: normalizeRange(params.auto.delaysSec?.inputFields, DEFAULT_PARAMS.auto.delaysSec.inputFields),
        nextStep: normalizeRange(params.auto.delaysSec?.nextStep, { min: legacyMinSec || DEFAULT_PARAMS.auto.delaysSec.nextStep.min, max: legacyMaxSec || DEFAULT_PARAMS.auto.delaysSec.nextStep.max }),
        submitPageScroll: normalizeRange(params.auto.delaysSec?.submitPageScroll, DEFAULT_PARAMS.auto.delaysSec.submitPageScroll),
        closeSubmitPage: normalizeRange(params.auto.delaysSec?.closeSubmitPage, DEFAULT_PARAMS.auto.delaysSec.closeSubmitPage)
    };
    params.auto.rateLimits = mergeDeep(DEFAULT_PARAMS.auto.rateLimits, params.auto.rateLimits || {});
    params.auto.rateLimits.perMinute = Math.max(1, parseInt(params.auto.rateLimits.perMinute, 10) || DEFAULT_PARAMS.auto.rateLimits.perMinute);
    params.auto.rateLimits.perHour = Math.max(params.auto.rateLimits.perMinute, parseInt(params.auto.rateLimits.perHour, 10) || DEFAULT_PARAMS.auto.rateLimits.perHour);
    params.auto.rateLimits.perDay = Math.max(params.auto.rateLimits.perHour, parseInt(params.auto.rateLimits.perDay, 10) || DEFAULT_PARAMS.auto.rateLimits.perDay);
    params.auto.burstRest = mergeDeep(DEFAULT_PARAMS.auto.burstRest, params.auto.burstRest || {});
    params.auto.burstRest.every = Math.max(1, parseInt(params.auto.burstRest.every, 10) || DEFAULT_PARAMS.auto.burstRest.every);
    params.auto.burstRest.minSeconds = Math.max(0, Number(params.auto.burstRest.minSeconds) || DEFAULT_PARAMS.auto.burstRest.minSeconds);
    params.auto.burstRest.maxSeconds = Math.max(params.auto.burstRest.minSeconds, Number(params.auto.burstRest.maxSeconds) || DEFAULT_PARAMS.auto.burstRest.maxSeconds);
    params.customRegex = Array.from(new Set((params.customRegex || []).map(v => String(v || '').trim()).filter(Boolean)));
    return params;
}

function storageGet(keys) {
    return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

function storageSet(values) {
    return new Promise(resolve => chrome.storage.local.set(values, resolve));
}

async function loadParams() {
    const stored = await storageGet(['eveParams']);
    return normalizeParams(stored.eveParams || {});
}

async function saveParams(patch) {
    const current = await loadParams();
    const next = normalizeParams(mergeDeep(current, patch || {}));
    await storageSet({ eveParams: next });
    return next;
}

// ── Unified Applied Jobs record (all platforms) ───────────────────────────────────────────
// Single append-only log written through this one background handler (read-modify-write) so
// concurrent tabs/platforms never race each other. Does NOT touch the LinkedIn-only `eveAppLogs`
// (rich description snippets) or `appliedJobsLog` (LinkedIn card-checkmark dedup tracker) — both
// keep their existing meaning untouched. See AGENTS.md "Applied Jobs Log".
async function recordAppliedJob(record) {
    const stored = await storageGet(['eveApplicationRecords']);
    const records = Array.isArray(stored.eveApplicationRecords) ? stored.eveApplicationRecords : [];
    const now = Date.now();
    const entry = {
        id: record.id || `${record.platform || 'unknown'}-${record.jobId || record.url || now}-${now}`,
        platform: record.platform || 'unknown',
        title: (record.title || '').toString().trim(),
        company: (record.company || '').toString().trim(),
        location: (record.location || '').toString().trim(),
        url: record.url || '',
        mode: record.mode === 'manual' ? 'manual' : 'auto',
        appliedAt: record.appliedAt || new Date(now).toISOString(),
        timestamp: typeof record.timestamp === 'number' && Number.isFinite(record.timestamp) ? record.timestamp : now
    };
    records.push(entry);
    await storageSet({ eveApplicationRecords: records });
    return entry;
}

// Land on a BARE jobs search page. Filters are deliberately NOT put on this URL: the location is
// committed first through the typeahead (which re-searches and would drop them), and
// `applyFilterParams` re-applies them afterwards on top of the geoId-bearing URL.
function buildSearchUrl() {
    return 'https://www.linkedin.com/jobs/search/';
}

// Filters, applied LAST, on top of whatever URL LinkedIn produced after the location was committed
// (so geoId and keywords are preserved).
function applyFilterParams(baseUrl, params) {
    const url = new URL(baseUrl);
    const linkedin = params.linkedin || {};
    const seconds = Math.max(0, Math.round(Number(linkedin.timeFilter?.seconds) || 0));
    if (seconds) url.searchParams.set('f_TPR', `r${seconds}`);
    else url.searchParams.delete('f_TPR');
    const setMulti = (key, values) => {
        const list = (Array.isArray(values) ? values : []).map(v => String(v).trim()).filter(Boolean);
        if (list.length) url.searchParams.set(key, list.join(','));
        else url.searchParams.delete(key);
    };
    setMulti('f_E', linkedin.experience);
    setMulti('f_JT', linkedin.jobType);
    setMulti('f_WT', linkedin.remote);
    if (linkedin.easyApply) url.searchParams.set('f_AL', 'true');
    else url.searchParams.delete('f_AL');
    const keywords = String(linkedin.keywords || '').trim();
    if (keywords) url.searchParams.set('keywords', keywords);
    url.searchParams.set('origin', 'JOB_SEARCH_PAGE_JOB_FILTER');
    url.searchParams.set('refresh', 'true');
    return url.toString();
}

function waitForTabComplete(tabId, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
        const startedAt = Date.now();
        const onUpdated = (updatedTabId, info) => {
            if (updatedTabId !== tabId) return;
            if (info.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(onUpdated);
                resolve();
            }
        };
        chrome.tabs.onUpdated.addListener(onUpdated);
        chrome.tabs.get(tabId, (tab) => {
            if (chrome.runtime.lastError) {
                chrome.tabs.onUpdated.removeListener(onUpdated);
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            if (tab?.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(onUpdated);
                resolve();
                return;
            }
            const timer = setInterval(() => {
                if (Date.now() - startedAt > timeoutMs) {
                    clearInterval(timer);
                    chrome.tabs.onUpdated.removeListener(onUpdated);
                    reject(new Error('Timed out waiting for LinkedIn search tab to load.'));
                }
            }, 250);
        });
    });
}

async function runLinkedInSearchSetup(tabId, params) {
    const location = String(params.selectedSearch || params.searches?.[0] || '').trim();
    const keywords = String(params.linkedin?.keywords || '').trim();
    if (!location) throw new Error('No saved location to search with.');

    // PHASE 1 — commit the LOCATION through LinkedIn's own typeahead.
    // Guessing a geoId in the URL (or letting the location text land in the keywords box) makes
    // LinkedIn fuzzy-match the location words as keywords instead of applying a real geo filter.
    // Only picking a typeahead suggestion makes LinkedIn attach the correct geoId.
    const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: async (typedLocation, typedKeywords) => {
            const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
            const clean = (value) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
            const visible = (node) => Boolean(node && node.offsetParent !== null);
            // LinkedIn A/B-tests this DOM constantly, so match on the role/aria-label/placeholder
            // family rather than any single class.
            const describe = (node) => `${node.getAttribute('aria-label') || ''} ${node.placeholder || ''} ${node.id || ''} ${node.name || ''}`;
            // Eve's own floating panel lives in this document and has inputs and buttons
            // labelled "Search" too — never let a query reach into it.
            const ours = (node) => Boolean(node.closest('#eve-floating-ui'));
            const textInputs = () => Array.from(document.querySelectorAll('input[role="combobox"], input[type="text"], input:not([type])'))
                .filter(node => visible(node) && !ours(node));
            // LinkedIn renders a real combobox AND a hidden "ghost" twin per field; always prefer
            // the one that is a real combobox.
            const pickInput = (test) => {
                const matches = textInputs().filter(node => test(describe(node)));
                return matches.find(node => node.getAttribute('role') === 'combobox') || matches[0] || null;
            };
            const findLocationInput = () => pickInput(text => /city,\s*state,\s*or\s*zip|location/i.test(text));
            const findKeywordInput = () => pickInput(text => /title,\s*skill,\s*or\s*company|keyword/i.test(text));

            const setNativeValue = (input, value) => {
                const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value');
                if (descriptor && descriptor.set) descriptor.set.call(input, value);
                else input.value = value;
            };
            // A bare `input.value = x` does not wake LinkedIn's typeahead; drive the native setter
            // plus the events its listeners actually bind to.
            const typeInto = async (input, value) => {
                input.focus();
                input.click();
                setNativeValue(input, '');
                input.dispatchEvent(new Event('input', { bubbles: true }));
                await wait(120);
                setNativeValue(input, value);
                input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: value.slice(-1) || 'a' }));
            };

            // Read ONLY the listbox this combobox owns. The keywords typeahead renders its own
            // [role="listbox"], and a document-wide query would happily return that one instead —
            // the same cross-talk class of bug as the Workday portal listbox.
            const ownedListbox = (input) => {
                const id = clean(input.getAttribute('aria-controls') || input.getAttribute('aria-owns'));
                if (id) {
                    const byId = document.getElementById(id);
                    if (byId && visible(byId)) return byId;
                }
                // LinkedIn does not set aria-controls here, so fall back to the typeahead container
                // that belongs to THIS field's wrapper (never a document-wide listbox query).
                // Widen from the narrowest wrapper outwards. The first level that yields a list wins,
                // and when a level yields several (the keywords typeahead can be open too, and both
                // fields share an ancestor) take the one rendered under THIS input horizontally.
                let scope = input.closest('.jobs-search-box__input, .basic-typeahead, .jobs-search-box__input-container') || input.parentElement;
                const anchor = input.getBoundingClientRect();
                for (let hop = 0; hop < 4 && scope; hop += 1) {
                    const local = Array.from(scope.querySelectorAll('[role="listbox"], .basic-typeahead__triggered-content'))
                        .filter(node => visible(node) && !ours(node));
                    if (local.length === 1) return local[0];
                    if (local.length > 1) {
                        return local
                            .map(node => ({ node, delta: Math.abs(node.getBoundingClientRect().left - anchor.left) }))
                            .sort((a, b) => a.delta - b.delta)[0].node;
                    }
                    scope = scope.parentElement;
                }
                return null;
            };
            const optionsOf = (box) => Array.from(box.querySelectorAll('[role="option"], .basic-typeahead__selectable'))
                .filter(node => visible(node) && clean(node.innerText || node.textContent));

            const locationInput = findLocationInput();
            if (!locationInput) return { ok: false, error: 'Location input (City, state, or zip code) not found on this page.' };

            // Keywords first, then dismiss its typeahead so it cannot be mistaken for the location list.
            if (typedKeywords) {
                const keywordInput = findKeywordInput();
                if (keywordInput) {
                    await typeInto(keywordInput, typedKeywords);
                    await wait(250);
                    keywordInput.blur?.();
                }
            }
            document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            await wait(200);

            await typeInto(locationInput, typedLocation);

            // The typeahead is async AND it renders a STALE list for the previous query state before
            // refining (typing "California, United States" briefly shows plain "United States").
            // Grabbing the first option as soon as anything renders picks that stale entry, so wait
            // for the option list to stop changing before choosing.
            const readOptions = () => {
                const box = ownedListbox(locationInput);
                return box ? optionsOf(box) : [];
            };
            let options = [];
            let signature = '';
            let stableCount = 0;
            const listDeadline = Date.now() + 9000;
            while (Date.now() < listDeadline) {
                const current = readOptions();
                const currentSignature = current.map(node => clean(node.innerText || node.textContent)).join('|');
                if (current.length && currentSignature === signature) {
                    stableCount += 1;
                    if (stableCount >= 2) { options = current; break; }
                } else {
                    stableCount = 0;
                }
                signature = currentSignature;
                options = current;
                await wait(250);
            }
            if (!options.length) return { ok: false, error: 'Location typeahead produced no suggestions.' };

            // Normally the settled first suggestion IS the typed location. Keep "first" as the rule,
            // but never take it when the list also holds an exact match for what was typed.
            const wanted = clean(typedLocation).toLowerCase();
            const textOf = (node) => clean(node.innerText || node.textContent);
            const first = options.find(node => textOf(node).toLowerCase() === wanted)
                || options.find(node => textOf(node).toLowerCase().startsWith(wanted))
                || options[0];
            const suggestion = textOf(first);
            const allSuggestions = options.map(textOf);

            const target = first.querySelector('[role="option"]') || first;
            const eventOptions = { bubbles: true, cancelable: true, composed: true, view: window, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true };
            target.scrollIntoView?.({ block: 'nearest' });
            target.dispatchEvent(new PointerEvent('pointerdown', eventOptions));
            target.dispatchEvent(new MouseEvent('mousedown', eventOptions));
            target.dispatchEvent(new PointerEvent('pointerup', eventOptions));
            target.dispatchEvent(new MouseEvent('mouseup', eventOptions));
            target.dispatchEvent(new MouseEvent('click', eventOptions));

            // Dispatching a click is not proof the pick landed — confirm the input took the value.
            let committed = '';
            const verifyDeadline = Date.now() + 5000;
            while (Date.now() < verifyDeadline) {
                committed = clean(locationInput.value);
                const low = committed.toLowerCase();
                const sug = suggestion.toLowerCase();
                if (committed && (low === sug || sug.startsWith(low) || low.startsWith(sug))) break;
                await wait(150);
            }
            if (!committed) return { ok: false, error: 'Location suggestion click did not populate the location input.' };

            await wait(300);
            const searchButton = Array.from(document.querySelectorAll('button')).find(button =>
                visible(button)
                && !ours(button)
                && /^search$/i.test(clean(button.innerText || button.textContent || button.getAttribute('aria-label')))
                && !button.closest('[role="dialog"]'));
            if (searchButton) {
                searchButton.click();
            } else {
                locationInput.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 }));
                locationInput.form?.requestSubmit?.();
            }
            return { ok: true, suggestion, committed, allSuggestions };
        },
        args: [location, keywords]
    });
    if (!result?.ok) throw new Error(result?.error || 'LinkedIn location typeahead failed.');

    // Selecting the suggestion submits the search; wait for the URL that carries the real geoId.
    const geo = await waitForGeoId(tabId, 20000);

    // PHASE 2 — filters LAST. Applying them by mutating the committed URL keeps geoId + keywords,
    // whereas driving the filter modal before the location let the typeahead re-search drop them.
    const filteredUrl = applyFilterParams(geo.url, params);
    await chrome.tabs.update(tabId, { url: filteredUrl });
    await waitForTabComplete(tabId);
    const finalTab = await chrome.tabs.get(tabId);
    // The committed location must actually be the one asked for — picking a stale/broader
    // suggestion (e.g. "United States" instead of "California, United States") silently searches
    // the wrong geography, so surface it rather than reporting a clean success.
    const askedFor = location.toLowerCase();
    const got = String(result.committed || '').toLowerCase();
    const locationMatched = Boolean(got) && (got === askedFor || got.startsWith(askedFor) || askedFor.startsWith(got));
    return {
        ok: true,
        keywords,
        location,
        suggestion: result.suggestion,
        suggestions: result.allSuggestions,
        committedLocation: result.committed,
        locationMatched,
        geoId: geo.geoId,
        url: finalTab?.url || filteredUrl
    };
}

// Poll the tab until LinkedIn's committed search URL carries a geoId — the proof that the location
// was applied as a geo filter rather than fuzzy-matched as keyword text.
async function waitForGeoId(tabId, timeoutMs = 20000) {
    const startedAt = Date.now();
    let lastUrl = '';
    while (Date.now() - startedAt < timeoutMs) {
        try {
            const tab = await chrome.tabs.get(tabId);
            lastUrl = tab?.url || '';
            const geoId = lastUrl ? new URL(lastUrl).searchParams.get('geoId') : '';
            if (geoId) return { url: lastUrl, geoId };
        } catch { /* tab busy mid-navigation */ }
        await new Promise(resolve => setTimeout(resolve, 300));
    }
    throw new Error(`LinkedIn did not attach a geoId after selecting the location suggestion (url: ${lastUrl || 'unknown'}).`);
}


async function exportLogsCsv() {
    return { ok: true, skipped: true, reason: 'csv_export_disabled' };
}

const DEFAULT_REGEX_ANSWERS = [
    { pattern: '*why do you want to work*', type: 'text', answer: '' },
    { pattern: '*accomplishments*', type: 'text', answer: '' }
];

chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.get(['profiles', 'activeProfileId', 'profileData', 'settings', 'eveParams', 'eveApplyMode', 'eveApplyStats', 'savedRegexAnswers'], (result) => {
        const next = {};

        if (!result.profiles || !result.profiles.length) {
            const profile = { id: 'default', name: 'Default' };
            next.profiles = [profile];
            next.activeProfileId = profile.id;
            next.profileData = { profileName: profile.name };
        }

        if (!result.settings) {
            next.settings = { autopilotEnabled: true };
        }

        if (!result.eveParams) {
            next.eveParams = DEFAULT_PARAMS;
        } else {
            // Merge any new default customRegex entries into existing stored params
            const stored = result.eveParams;
            const existing = Array.isArray(stored.customRegex) ? stored.customRegex : [];
            const merged = Array.from(new Set([...existing, ...DEFAULT_PARAMS.customRegex]));
            if (merged.length !== existing.length) {
                next.eveParams = Object.assign({}, stored, { customRegex: merged });
            }
        }
        if (!result.eveApplyMode) next.eveApplyMode = 'auto';
        if (!result.eveApplyStats) next.eveApplyStats = { auto: 0, manual: 0 };

        // Merge new default regex answer patterns into existing (preserving user's custom answers)
        const existingRegex = Array.isArray(result.savedRegexAnswers) ? result.savedRegexAnswers : [];
        const existingPatterns = new Set(existingRegex.map(e => e.pattern));
        const newEntries = DEFAULT_REGEX_ANSWERS.filter(e => !existingPatterns.has(e.pattern));
        if (newEntries.length) next.savedRegexAnswers = [...existingRegex, ...newEntries];

        chrome.storage.local.set(next, () => chrome.storage.local.remove('workdayResumeFile'));
    });
});

// Load local-only secrets from a gitignored `secrets.local.json` (never committed) into extension
// storage, so the Workday adapter can auto-fill account credentials (password) on Create Account /
// Sign In. Missing file = no-op: auth falls back to the user typing the password. The file lives in
// the extension package but is NOT in web_accessible_resources, so only the extension itself reads it.
async function loadLocalSecrets() {
    try {
        const res = await fetch(chrome.runtime.getURL('secrets.local.json'));
        if (!res.ok) return;
        const secrets = await res.json();
        if (typeof secrets.workdayAccountPassword === 'string' && secrets.workdayAccountPassword) {
            await storageSet({ workdayAccountPassword: secrets.workdayAccountPassword });
        }
    } catch { /* no local secrets file present — fine */ }
}

// Load the applicant's own identity from a gitignored `profile.local.json` (copy
// `profile.example.json` and fill it in) into extension storage as `eveProfile`, so every engine
// answers with THIS installation's details instead of the values checked into the repository.
// Missing file = no-op: the engines fall back to their placeholder defaults and say so.
//
// Artifact metadata (resume / cover letter) is DERIVED here rather than hardcoded: whatever PDFs
// the profile points at are fetched once and their real name/size recorded, so a new user just
// drops their own files into eve/artifacts/ and names them in the profile.
async function loadLocalProfile() {
    try {
        const res = await fetch(chrome.runtime.getURL('profile.local.json'));
        if (!res.ok) return;
        const profile = await res.json();
        if (profile && typeof profile.identity === 'object') {
            await storageSet({ eveProfile: profile.identity });
        }
        const paths = (profile && typeof profile.artifacts === 'object') ? profile.artifacts : {};
        const resolved = {};
        for (const [artifactId, path] of Object.entries(paths)) {
            if (typeof path !== 'string' || !path) continue;
            try {
                const file = await fetch(chrome.runtime.getURL(path));
                if (!file.ok) continue;
                const bytes = new Uint8Array(await file.arrayBuffer());
                if (!bytes.byteLength) continue;
                resolved[artifactId] = {
                    path,
                    name: path.split('/').pop(),
                    type: 'application/pdf',
                    size: bytes.byteLength
                };
            } catch { /* artifact named but not packaged — skip it */ }
        }
        if (Object.keys(resolved).length) {
            CONFIGURED_ARTIFACTS = Object.freeze(resolved);
            await storageSet({ eveArtifacts: resolved });
        }
    } catch { /* no local profile file present — fine */ }
}
chrome.runtime.onInstalled.addListener(() => { loadLocalSecrets(); loadLocalProfile(); });
chrome.runtime.onStartup.addListener(() => { loadLocalSecrets(); loadLocalProfile(); });
loadLocalSecrets();
loadLocalProfile();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
        switch (message?.type) {
            // ── Ashby embed relay (cape.co panel <-> jobs.ashbyhq.com iframe, same tab). ──
            case 'eve:ashby-run-apply': {
                const tabId = sender.tab?.id;
                if (!tabId) throw new Error('No tab for the Ashby apply relay.');
                const res = await chrome.tabs.sendMessage(tabId, { type: 'eve:ashby-frame-apply' });
                sendResponse(Object.assign({ ok: true }, res || {}));
                return;
            }
            case 'eve:ashby-signature': {
                const tabId = sender.tab?.id;
                if (!tabId) throw new Error('No tab for the Ashby signature relay.');
                const res = await chrome.tabs.sendMessage(tabId, { type: 'eve:ashby-frame-signature' });
                sendResponse(Object.assign({ ok: true }, res || {}));
                return;
            }
            case 'eve:ashby-status': {
                const tabId = sender.tab?.id;
                if (tabId) {
                    try { await chrome.tabs.sendMessage(tabId, { type: 'eve:ashby-status-update', text: message.text, state: message.state }); } catch { }
                }
                sendResponse({ ok: true });
                return;
            }
            // ── Greenhouse embed relay (Zipline panel <-> Greenhouse iframe, same tab). ──
            case 'eve:gh-embed-run-apply': {
                const tabId = sender.tab?.id;
                if (!tabId) throw new Error('No tab for the Greenhouse apply relay.');
                const res = await chrome.tabs.sendMessage(tabId, { type: 'eve:gh-embed-frame-apply' });
                sendResponse(Object.assign({ ok: true }, res || {}));
                return;
            }
            case 'eve:gh-embed-signature': {
                const tabId = sender.tab?.id;
                if (!tabId) throw new Error('No tab for the Greenhouse signature relay.');
                const res = await chrome.tabs.sendMessage(tabId, { type: 'eve:gh-embed-frame-signature' });
                sendResponse(Object.assign({ ok: true }, res || {}));
                return;
            }
            case 'eve:gh-embed-status': {
                const tabId = sender.tab?.id;
                if (tabId) {
                    try { await chrome.tabs.sendMessage(tabId, { type: 'eve:gh-embed-status-update', text: message.text, state: message.state }); } catch { }
                }
                sendResponse({ ok: true });
                return;
            }
            case 'eve:get-workday-artifact': {
                const artifact = await getWorkdayArtifact(message.artifactId, sender);
                sendResponse({ ok: true, artifact });
                return;
            }
            case 'eve:record-applied-job': {
                const entry = await recordAppliedJob(message.record || {});
                sendResponse({ ok: true, record: entry });
                return;
            }
            case 'eve:get-params': {
                const params = await loadParams();
                sendResponse({ ok: true, params });
                return;
            }
            case 'eve:save-params': {
                const params = await saveParams(message.params || {});
                sendResponse({ ok: true, params });
                return;
            }
            case 'eve:open-search': {
                const params = await saveParams(message.params || {});
                const store = await chrome.storage.local.get(['settings']);
                await chrome.storage.local.set({
                    settings: Object.assign({}, store.settings || {}, { autopilotEnabled: true })
                });
                const tab = await chrome.tabs.create({
                    url: buildSearchUrl(),
                    active: false
                });
                await waitForTabComplete(tab.id);
                await runLinkedInSearchSetup(tab.id, params);
                sendResponse({ ok: true, tabId: tab.id, params });
                return;
            }
            case 'eve:start-apply': {
                const targetTabId = message.tabId || sender.tab?.id;
                if (!targetTabId) throw new Error('No target tab for apply.');
                const gate = await chrome.storage.local.get(['settings', 'eveApplyMode']);
                const enabled = gate.settings?.autopilotEnabled !== false;
                const autoMode = gate.eveApplyMode !== 'manual';
                if (!enabled || !autoMode) {
                    sendResponse({ ok: false, state: 'disabled', message: enabled ? 'Auto mode is off.' : 'Eve is disabled.' });
                    return;
                }
                await chrome.tabs.get(targetTabId);
                const res = await chrome.tabs.sendMessage(targetTabId, { type: 'eve:start-auto-apply' });
                sendResponse(Object.assign({ ok: true }, res || {}));
                return;
            }
            case 'eve:set-theme': {
                const theme = message.theme === 'light' ? 'light' : 'dark';
                await chrome.storage.local.set({ eveTheme: theme });
                const tabs = await chrome.tabs.query({ url: ['https://www.linkedin.com/jobs/*', '*://*.myworkdayjobs.com/*', '*://*.myworkdaysite.com/*', 'https://job-boards.greenhouse.io/*', 'https://my.greenhouse.io/*', 'https://smartapply.indeed.com/*', 'https://jobs.smartrecruiters.com/*'] });
                await Promise.all(tabs.map(async tab => {
                    try {
                        await chrome.tabs.sendMessage(tab.id, { type: 'eve:set-theme', theme });
                    } catch { }
                }));
                sendResponse({ ok: true, theme });
                return;
            }
            case 'eve:export-logs-csv': {
                const result = await exportLogsCsv();
                sendResponse(result);
                return;
            }
            case 'eve:update-dev-tasks': {
                const tabs = await chrome.tabs.query({ url: ['https://www.linkedin.com/jobs/*', '*://*.myworkdayjobs.com/*', '*://*.myworkdaysite.com/*', 'https://job-boards.greenhouse.io/*', 'https://my.greenhouse.io/*', 'https://smartapply.indeed.com/*', 'https://jobs.smartrecruiters.com/*'] });
                await Promise.all(tabs.map(async tab => {
                    try {
                        await chrome.tabs.sendMessage(tab.id, { type: 'eve:update-dev-tasks', tasks: message.tasks });
                    } catch { }
                }));
                sendResponse({ ok: true });
                return;
            }
            default:
                sendResponse({ ok: false, error: 'unknown_message' });
        }
    })().catch(err => {
        sendResponse({ ok: false, error: err.message || String(err) });
    });
    return true;
});
