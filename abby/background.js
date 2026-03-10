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
        minClickDelaySeconds: 0.8
    },
    auto: {
        delaysMs: { min: 300, max: 1200 },
        rateLimits: { perMinute: 5, perHour: 30, perDay: 200 },
        burstRest: { every: 5, minSeconds: 5, maxSeconds: 10 },
        detailScrollSeconds: { min: 1, max: 3 }
    }
};

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
    params.linkedin.minClickDelaySeconds = Math.max(0, Number(params.linkedin.minClickDelaySeconds) || DEFAULT_PARAMS.linkedin.minClickDelaySeconds);
    params.auto = mergeDeep(DEFAULT_PARAMS.auto, params.auto || {});
    params.auto.delaysMs = mergeDeep(DEFAULT_PARAMS.auto.delaysMs, params.auto.delaysMs || {});
    params.auto.delaysMs.min = Math.max(0, parseInt(params.auto.delaysMs.min, 10) || DEFAULT_PARAMS.auto.delaysMs.min);
    params.auto.delaysMs.max = Math.max(params.auto.delaysMs.min, parseInt(params.auto.delaysMs.max, 10) || DEFAULT_PARAMS.auto.delaysMs.max);
    params.auto.rateLimits = mergeDeep(DEFAULT_PARAMS.auto.rateLimits, params.auto.rateLimits || {});
    params.auto.rateLimits.perMinute = Math.max(1, parseInt(params.auto.rateLimits.perMinute, 10) || DEFAULT_PARAMS.auto.rateLimits.perMinute);
    params.auto.rateLimits.perHour = Math.max(params.auto.rateLimits.perMinute, parseInt(params.auto.rateLimits.perHour, 10) || DEFAULT_PARAMS.auto.rateLimits.perHour);
    params.auto.rateLimits.perDay = Math.max(params.auto.rateLimits.perHour, parseInt(params.auto.rateLimits.perDay, 10) || DEFAULT_PARAMS.auto.rateLimits.perDay);
    params.auto.burstRest = mergeDeep(DEFAULT_PARAMS.auto.burstRest, params.auto.burstRest || {});
    params.auto.burstRest.every = Math.max(1, parseInt(params.auto.burstRest.every, 10) || DEFAULT_PARAMS.auto.burstRest.every);
    params.auto.burstRest.minSeconds = Math.max(0, Number(params.auto.burstRest.minSeconds) || DEFAULT_PARAMS.auto.burstRest.minSeconds);
    params.auto.burstRest.maxSeconds = Math.max(params.auto.burstRest.minSeconds, Number(params.auto.burstRest.maxSeconds) || DEFAULT_PARAMS.auto.burstRest.maxSeconds);
    params.auto.detailScrollSeconds = mergeDeep(DEFAULT_PARAMS.auto.detailScrollSeconds, params.auto.detailScrollSeconds || {});
    params.auto.detailScrollSeconds.min = Math.max(0, Number(params.auto.detailScrollSeconds.min) || DEFAULT_PARAMS.auto.detailScrollSeconds.min);
    params.auto.detailScrollSeconds.max = Math.max(params.auto.detailScrollSeconds.min, Number(params.auto.detailScrollSeconds.max) || DEFAULT_PARAMS.auto.detailScrollSeconds.max);
    return params;
}

function storageGet(keys) {
    return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

function storageSet(values) {
    return new Promise(resolve => chrome.storage.local.set(values, resolve));
}

async function loadParams() {
    const stored = await storageGet(['abbyParams']);
    return normalizeParams(stored.abbyParams || {});
}

async function saveParams(patch) {
    const current = await loadParams();
    const next = normalizeParams(mergeDeep(current, patch || {}));
    await storageSet({ abbyParams: next });
    return next;
}

function buildSearchUrl(params) {
    return 'https://www.linkedin.com/jobs/search/';
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
    const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: async (runtimeParams) => {
            const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
            const keyword = 'software engineer';
            const location = String(runtimeParams.selectedSearch || runtimeParams.searches?.[0] || 'California, United States').trim();
            const wantsEasyApply = (runtimeParams.linkedin?.filters || []).some(value => String(value || '').toLowerCase() === 'easy apply');
            const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
            const fillInput = (input, value) => {
                if (!input) return false;
                input.focus();
                input.value = '';
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.value = value;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            };
            const getSearchInputs = () => {
                const inputs = Array.from(document.querySelectorAll('input[role="combobox"], input[type="text"], input'));
                const keywordInput = inputs.find(node => /title, skill, or company/i.test(node.getAttribute('aria-label') || node.placeholder || ''));
                const locationInput = inputs.find(node => /city, state, or zip code/i.test(node.getAttribute('aria-label') || node.placeholder || ''));
                return { keywordInput, locationInput };
            };
            const findSearchButton = () => Array.from(document.querySelectorAll('button')).find(button => {
                const text = clean(button.innerText || button.textContent || button.getAttribute('aria-label') || '');
                return /^search$/i.test(text) && !button.closest('[role="dialog"]');
            }) || null;
            const findAllFiltersButton = () => Array.from(document.querySelectorAll('button, [role="button"]')).find(node => {
                const text = clean(node.innerText || node.textContent || node.getAttribute('aria-label') || '');
                return /show all filters|^all filters$/i.test(text);
            }) || null;
            const findEasyApplyToggle = (scope = document, allowDialog = true) => {
                const root = scope || document;
                const nodes = Array.from(root.querySelectorAll('button, label, input, span, div'));
                return nodes.find(node => {
                    if (!allowDialog && node.closest('[role="dialog"]')) return false;
                    const text = clean(node.innerText || node.textContent || node.getAttribute('aria-label') || '');
                    return /easy apply/i.test(text);
                }) || null;
            };
            const findShowResultsButton = () => Array.from(document.querySelectorAll('button, [role="button"]')).find(node => {
                const text = clean(node.innerText || node.textContent || node.getAttribute('aria-label') || '');
                return /^show results$/i.test(text) || /show results/i.test(text);
            }) || null;
            const isToggleOn = (node) => {
                if (!node) return false;
                return node.getAttribute('aria-pressed') === 'true'
                    || node.getAttribute('aria-checked') === 'true'
                    || node.checked === true
                    || node.querySelector?.('input:checked')
                    || /selected|checked|active|on/i.test(node.className || '');
            };
            const clickToggle = (node) => {
                if (!node) return false;
                if (node.tagName === 'INPUT') {
                    node.checked = true;
                    ['click', 'input', 'change'].forEach(eventName => node.dispatchEvent(new Event(eventName, { bubbles: true })));
                    return true;
                }
                node.click();
                return true;
            };
            const enableTopBarEasyApply = async () => {
                const startedAt = Date.now();
                while (Date.now() - startedAt < 5000) {
                    const toggle = findEasyApplyToggle(document, false);
                    if (toggle) {
                        if (!isToggleOn(toggle)) {
                            clickToggle(toggle);
                            await wait(500);
                        }
                        if (isToggleOn(toggle)) return true;
                    }
                    await wait(200);
                }
                return false;
            };
            const openAllFilters = async () => {
                const allFiltersButton = findAllFiltersButton();
                if (!allFiltersButton) return false;
                allFiltersButton.click();
                const startedAt = Date.now();
                while (Date.now() - startedAt < 5000) {
                    if (findShowResultsButton()) return true;
                    await wait(200);
                }
                return false;
            };
            const enableEasyApplyInFilters = async () => {
                const modal = document.querySelector('[role="dialog"]');
                const scroller = modal ? (modal.querySelector('.artdeco-modal__content') || modal) : null;
                
                if (scroller) {
                    // Scroll to half of the scroller as requested
                    scroller.scrollTop = scroller.scrollHeight / 2;
                    await wait(500);
                }

                const startedAt = Date.now();
                while (Date.now() - startedAt < 5000) {
                    const easyApplyToggle = findEasyApplyToggle(modal);
                    if (easyApplyToggle) {
                        if (!isToggleOn(easyApplyToggle)) {
                            // Ensure it's in view before clicking
                            easyApplyToggle.scrollIntoView({ block: 'center' });
                            await wait(200);
                            clickToggle(easyApplyToggle);
                            await wait(500);
                        }
                        
                        // Scroll to bottom after selecting Easy Apply
                        if (scroller) {
                            scroller.scrollTop = scroller.scrollHeight;
                            await wait(500);
                        }
                        return true;
                    }
                    await wait(200);
                }
                return false;
            };
            const pickLocationSuggestion = async () => {
                const startedAt = Date.now();
                while (Date.now() - startedAt < 5000) {
                    const options = Array.from(document.querySelectorAll('[role="option"], li, div')).filter(node => {
                        const text = clean(node.innerText || node.textContent || '');
                        return text && !/title|skill|company|city|state|zip/i.test(text); // Filter out labels
                    });
                    const exact = options.find(node => clean(node.innerText || node.textContent || '').toLowerCase().includes(location.toLowerCase()));
                    const first = exact || options[0];
                    if (first) {
                        first.click();
                        return clean(first.innerText || first.textContent || '');
                    }
                    await wait(200);
                }
                return '';
            };

            const startedAt = Date.now();
            while (Date.now() - startedAt < 15000) {
                const { keywordInput, locationInput } = getSearchInputs();
                if (keywordInput && locationInput) {
                    fillInput(keywordInput, keyword);
                    await wait(200);
                    fillInput(locationInput, location);
                    await wait(500);
                    await pickLocationSuggestion();
                    await wait(500); // Wait 0.5s as requested
                    
                    if (wantsEasyApply) {
                        const allFiltersButton = findAllFiltersButton();
                        if (allFiltersButton) {
                            allFiltersButton.click();
                            // Wait for modal and scroll
                            await wait(1000);
                            const modal = document.querySelector('[role="dialog"]');
                            const scroller = modal ? (modal.querySelector('.artdeco-modal__content') || modal) : null;
                            if (scroller) {
                                scroller.scrollTop = scroller.scrollHeight / 2;
                                await wait(500);
                            }
                            
                            const easyApplyToggle = findEasyApplyToggle(modal);
                            if (easyApplyToggle) {
                                if (!isToggleOn(easyApplyToggle)) {
                                    clickToggle(easyApplyToggle);
                                    await wait(500);
                                }
                                
                                if (scroller) {
                                    scroller.scrollTop = scroller.scrollHeight;
                                    await wait(500);
                                }
                                
                                const showResultsButton = findShowResultsButton();
                                if (showResultsButton) {
                                    localStorage.setItem('abby_auto_open_apply_once', '1');
                                    showResultsButton.click();
                                    return { ok: true, keyword, location, filtered: true, filterMode: 'all-filters' };
                                }
                            }
                        }
                    }
                    
                    const searchButton = findSearchButton();
                    if (searchButton) {
                        localStorage.setItem('abby_auto_open_apply_once', '1');
                        searchButton.click();
                        return { ok: true, keyword, location };
                    }
                }
                await wait(250);
            }
            return { ok: false, error: 'Could not find LinkedIn search inputs.' };
        },
        args: [params]
    });
    if (!result?.ok) throw new Error(result?.error || 'LinkedIn search setup failed.');
    return result;
}

chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.get(['profiles', 'activeProfileId', 'profileData', 'settings', 'abbyParams'], (result) => {
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

        if (!result.abbyParams) {
            next.abbyParams = DEFAULT_PARAMS;
        }

        chrome.storage.local.set(next);
    });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
        switch (message?.type) {
            case 'abby:get-params': {
                const params = await loadParams();
                sendResponse({ ok: true, params });
                return;
            }
            case 'abby:save-params': {
                const params = await saveParams(message.params || {});
                sendResponse({ ok: true, params });
                return;
            }
            case 'abby:open-search': {
                const params = await saveParams(message.params || {});
                const store = await chrome.storage.local.get(['settings']);
                await chrome.storage.local.set({
                    settings: Object.assign({}, store.settings || {}, { autopilotEnabled: true })
                });
                const tab = await chrome.tabs.create({
                    url: buildSearchUrl(params),
                    active: false
                });
                await waitForTabComplete(tab.id);
                await runLinkedInSearchSetup(tab.id, params);
                sendResponse({ ok: true, tabId: tab.id, params });
                return;
            }
            case 'abby:start-apply': {
                const targetTabId = message.tabId || sender.tab?.id;
                if (!targetTabId) throw new Error('No target tab for apply.');
                await chrome.tabs.get(targetTabId);
                const res = await chrome.tabs.sendMessage(targetTabId, { type: 'abby:start-auto-apply' });
                sendResponse(Object.assign({ ok: true }, res || {}));
                return;
            }
            case 'abby:set-theme': {
                const theme = message.theme === 'light' ? 'light' : 'dark';
                await chrome.storage.local.set({ abbyTheme: theme });
                const tabs = await chrome.tabs.query({ url: ['https://www.linkedin.com/jobs/*'] });
                await Promise.all(tabs.map(async tab => {
                    try {
                        await chrome.tabs.sendMessage(tab.id, { type: 'abby:set-theme', theme });
                    } catch { }
                }));
                sendResponse({ ok: true, theme });
                return;
            }
            case 'abby:update-dev-tasks': {
                const tabs = await chrome.tabs.query({ url: ['https://www.linkedin.com/jobs/*'] });
                await Promise.all(tabs.map(async tab => {
                    try {
                        await chrome.tabs.sendMessage(tab.id, { type: 'abby:update-dev-tasks', tasks: message.tasks });
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
