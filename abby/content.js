// Abby — content.js
// Floating UI on LinkedIn Easy Apply: field table, live edit, save/fill, Info tab.
console.log("Abby: Content script loaded.");
const ABBY_VERSION = chrome.runtime?.getManifest?.().version || 'dev';
// ──────────────────────────────────────────────────────────
// STATE
// ──────────────────────────────────────────────────────────
let modalPoller = null;
let urlChecker = null;
let activeView = 'step';               // 'search' | 'apply' | 'step' | 'info'
let currentHeading = '';
const sessionFields = new Map();
const hookedBtns = new WeakSet();
const syncedInputs = new WeakMap();
let currentModal = null;
let abbyParams = {
    searches: ['California, United States'],
    selectedSearch: 'California, United States',
    ignore: { caseSensitive: false, keywords: ['founding', 'machine learning'] },
    linkedin: { filters: ['Easy Apply'], clickCount: 2, minClickDelaySeconds: 0.8 },
    auto: {
        delaysMs: { min: 300, max: 1200 },
        rateLimits: { perMinute: 5, perHour: 30, perDay: 200 },
        burstRest: { every: 5, minSeconds: 5, maxSeconds: 10 },
        detailScrollSeconds: { min: 1, max: 3 },
        delayRangesMs: [{ min: 300, max: 1200 }]
    },
    customRegex: []
};
let autoApplyRunning = false;
let autoApplyStopRequested = false;
let lastAutoActionAt = 0;
let autoLoopSignature = '';
let autoLoopRepeats = 0;
let applyTabReady = false;
let pendingManualEasyApplyAutoStartUntil = 0;
let pendingResumeAutoApplyUntil = 0;
let abbyApplyMode = 'auto';
let outsideModalBlockerActive = false;
let stepHistory = [];
let stepHistoryIndex = -1;

// ──────────────────────────────────────────────────────────
// LOCAL STORAGE HELPERS  (position + active tab persist)
// ──────────────────────────────────────────────────────────
const LS_POS = 'abby_panel_pos';       // { left, top }
const LS_TAB = 'abby_panel_tab';       // 'search' | 'apply' | 'step' | 'info'
const LS_MIN = 'abby_panel_minimized';
const LS_THEME = 'abby_panel_theme';   // 'light' | 'dark'
const LS_AUTO_OPEN_APPLY = 'abby_auto_open_apply_once';

function lsGet(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function lsSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch { }
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
    const params = mergeDeep(abbyParams, raw || {});
    params.searches = Array.from(new Set((params.searches || []).map(v => String(v || '').trim()).filter(Boolean)));
    if (!params.searches.length) params.searches = ['California, United States'];
    params.selectedSearch = String(params.selectedSearch || '').trim() || params.searches[0];
    params.ignore = mergeDeep({ caseSensitive: false, keywords: [] }, params.ignore || {});
    params.ignore.keywords = Array.from(new Set((params.ignore.keywords || []).map(v => String(v || '').trim()).filter(Boolean)));
    params.linkedin = mergeDeep({ filters: ['Easy Apply'], clickCount: 2, minClickDelaySeconds: 0.8 }, params.linkedin || {});
    params.linkedin.filters = Array.from(new Set((params.linkedin.filters || []).map(v => String(v || '').trim()).filter(Boolean)));
    params.linkedin.clickCount = Math.max(1, parseInt(params.linkedin.clickCount, 10) || 2);
    params.linkedin.minClickDelaySeconds = Math.max(0, Number(params.linkedin.minClickDelaySeconds) || 0.8);
    params.auto = mergeDeep({
        delaysMs: { min: 300, max: 1200 },
        rateLimits: { perMinute: 5, perHour: 30, perDay: 200 },
        burstRest: { every: 5, minSeconds: 5, maxSeconds: 10 },
        detailScrollSeconds: { min: 1, max: 3 }
    }, params.auto || {});
    params.auto.delaysMs = mergeDeep({ min: 300, max: 1200 }, params.auto.delaysMs || {});
    params.auto.delaysMs.min = Math.max(0, parseInt(params.auto.delaysMs.min, 10) || 300);
    params.auto.delaysMs.max = Math.max(params.auto.delaysMs.min, parseInt(params.auto.delaysMs.max, 10) || 1200);
    params.auto.rateLimits = mergeDeep({ perMinute: 5, perHour: 30, perDay: 200 }, params.auto.rateLimits || {});
    params.auto.rateLimits.perMinute = Math.max(1, parseInt(params.auto.rateLimits.perMinute, 10) || 5);
    params.auto.rateLimits.perHour = Math.max(params.auto.rateLimits.perMinute, parseInt(params.auto.rateLimits.perHour, 10) || 30);
    params.auto.rateLimits.perDay = Math.max(params.auto.rateLimits.perHour, parseInt(params.auto.rateLimits.perDay, 10) || 200);
    params.auto.burstRest = mergeDeep({ every: 5, minSeconds: 5, maxSeconds: 10 }, params.auto.burstRest || {});
    params.auto.burstRest.every = Math.max(1, parseInt(params.auto.burstRest.every, 10) || 5);
    params.auto.burstRest.minSeconds = Math.max(0, Number(params.auto.burstRest.minSeconds) || 5);
    params.auto.burstRest.maxSeconds = Math.max(params.auto.burstRest.minSeconds, Number(params.auto.burstRest.maxSeconds) || 10);
    params.auto.detailScrollSeconds = mergeDeep({ min: 1, max: 3 }, params.auto.detailScrollSeconds || {});
    params.auto.detailScrollSeconds.min = Math.max(0, Number(params.auto.detailScrollSeconds.min) || 1);
    params.auto.detailScrollSeconds.max = Math.max(params.auto.detailScrollSeconds.min, Number(params.auto.detailScrollSeconds.max) || 3);
    const legacyMin = Math.max(0, parseInt(params.auto?.delaysMs?.min, 10) || 300);
    const legacyMax = Math.max(legacyMin, parseInt(params.auto?.delaysMs?.max, 10) || 1200);
    const rawRanges = Array.isArray(params.auto.delayRangesMs) && params.auto.delayRangesMs.length ? params.auto.delayRangesMs : [{ min: legacyMin, max: legacyMax }];
    params.auto.delayRangesMs = rawRanges.map(r => ({
        min: Math.max(0, parseInt(r?.min, 10) || legacyMin),
        max: Math.max(Math.max(0, parseInt(r?.min, 10) || legacyMin), parseInt(r?.max, 10) || legacyMax)
    }));
    params.customRegex = Array.from(new Set((params.customRegex || []).map(v => String(v || '').trim()).filter(Boolean)));
    return params;
}

function sendMessageAsync(message) {
    return new Promise(resolve => {
        chrome.runtime.sendMessage(message, res => resolve(res || { ok: false, error: chrome.runtime.lastError?.message || 'Unknown error' }));
    });
}

async function refreshParams(preferBridge = true) {
    if (!chrome.runtime?.id) return abbyParams;
    const response = await sendMessageAsync({ type: 'abby:get-params', preferBridge });
    if (response.ok && response.params) {
        abbyParams = normalizeParams(response.params);
        chrome.storage.local.set({ abbyParams });
    }
    renderSearchView();
    return abbyParams;
}

function setAutoApplyDataset(state, message, step) {
    document.documentElement.dataset.abbyAutoApplyState = state || 'idle';
    document.documentElement.dataset.abbyAutoApplyMessage = message || '';
    document.documentElement.dataset.abbyAutoApplyStep = step || '';
    const status = document.getElementById('ea-apply-status');
    if (status) status.textContent = message || 'Ready.';
    updateApplyButton();
}

function updateApplyButton() {
    const button = document.getElementById('ea-apply-btn');
    const tab = document.getElementById('ea-tab-apply');
    const ready = applyTabReady || autoApplyRunning || !!findEasyApplyModal();
    if (tab) {
        tab.disabled = !ready && !autoApplyRunning;
        tab.classList.toggle('ea-tab-disabled', tab.disabled);
    }
    if (!button) return;
    button.disabled = !ready && !autoApplyRunning;
    button.classList.toggle('ea-btn-disabled', button.disabled);
    if (autoApplyRunning) {
        button.textContent = 'Stop';
        button.classList.add('ea-btn-stop');
        return;
    }
    button.textContent = 'Apply';
    button.classList.remove('ea-btn-stop');
}

function applyTheme(theme) {
    const ui = document.getElementById('abby-floating-ui');
    if (!ui) return;
    const nextTheme = theme === 'light' ? 'light' : 'dark';
    ui.classList.remove('abby-theme-light', 'abby-theme-dark');
    ui.classList.add(`abby-theme-${nextTheme}`);
    lsSet(LS_THEME, nextTheme);
    if (chrome.runtime?.id) chrome.storage.local.set({ abbyTheme: nextTheme });
}

function applyMinimizedState(minimized) {
    const ui = document.getElementById('abby-floating-ui');
    if (!ui) return;
    ui.classList.toggle('abby-minimized', !!minimized);
    lsSet(LS_MIN, !!minimized);
}

function syncApplyAvailability() {
    const hasCurrentJob = !!new URL(window.location.href).searchParams.get('currentJobId');
    applyTabReady = hasCurrentJob || getVisibleJobCards().length > 0 || !!findEasyApplyModal();
    updateApplyButton();
    if (applyTabReady && lsGet(LS_AUTO_OPEN_APPLY)) {
        localStorage.removeItem(LS_AUTO_OPEN_APPLY);
        switchView('apply');
    }
}

function getIgnoreKeywordsFromView() {
    return Array.from(document.querySelectorAll('#ea-ignore-list .ea-token')).map(node => node.dataset.keyword || '').filter(Boolean);
}

function renderIgnoreKeywordList() {
    const wrap = document.getElementById('ea-ignore-list');
    if (!wrap) return;
    const keywords = (abbyParams.ignore && abbyParams.ignore.keywords) || [];
    wrap.innerHTML = keywords.length ? keywords.map(keyword => `
        <div class="ea-token" data-keyword="${escHtml(keyword)}">
          <span class="ea-token-text">${escHtml(keyword)}</span>
          <button class="ea-token-remove" type="button" data-keyword="${escHtml(keyword)}">x</button>
        </div>
    `).join('') : '<p class="ea-empty-inline">No ignored keywords yet.</p>';
    wrap.querySelectorAll('.ea-token-remove').forEach(button => {
        button.addEventListener('click', () => {
            abbyParams.ignore.keywords = (abbyParams.ignore?.keywords || []).filter(keyword => keyword !== button.dataset.keyword);
            renderIgnoreKeywordList();
            persistSearchDraft();
        });
    });
}

function addIgnoreKeyword() {
    const input = document.getElementById('ea-ignore-input');
    if (!input) return;
    const keyword = input.value.trim();
    if (!keyword) return;
    const next = Array.from(new Set([...(abbyParams.ignore?.keywords || []), keyword]));
    abbyParams.ignore = Object.assign({}, abbyParams.ignore || {}, { keywords: next });
    input.value = '';
    renderIgnoreKeywordList();
    saveSearchParams(false);
    markBlockedJobs();
}

function persistSearchDraft() {
    const searchInput = document.getElementById('ea-search-input');
    const clickCountInput = document.getElementById('ea-click-count');
    const minDelayInput = document.getElementById('ea-min-delay');
    const delayMinInput = document.getElementById('ea-auto-delay-min');
    const delayMaxInput = document.getElementById('ea-auto-delay-max');
    const perMinuteInput = document.getElementById('ea-limit-minute');
    const perHourInput = document.getElementById('ea-limit-hour');
    const perDayInput = document.getElementById('ea-limit-day');
    const restEveryInput = document.getElementById('ea-rest-every');
    const restMinInput = document.getElementById('ea-rest-min');
    const restMaxInput = document.getElementById('ea-rest-max');
    const scrollMinInput = document.getElementById('ea-scroll-min');
    const scrollMaxInput = document.getElementById('ea-scroll-max');
    const delayRangesInput = document.getElementById('ea-delay-ranges');
    const regexInput = document.getElementById('ea-regex-list');
    if (!searchInput || !clickCountInput || !minDelayInput || !delayMinInput || !delayMaxInput) return;
    const typed = searchInput.value.trim();
    const searches = Array.from(new Set([typed, ...(abbyParams.searches || [])].filter(Boolean)));
    chrome.storage.local.set({
        abbyParamsDraft: {
            searches,
            selectedSearch: typed || abbyParams.selectedSearch,
            ignore: {
                caseSensitive: false,
                keywords: getIgnoreKeywordsFromView()
            },
            linkedin: {
                filters: ['Easy Apply'],
                clickCount: Math.max(1, parseInt(clickCountInput.value, 10) || 2),
                minClickDelaySeconds: Math.max(0, Number(minDelayInput.value) || 0.8)
            },
            auto: {
                delaysMs: {
                    min: Math.max(0, parseInt(delayMinInput.value, 10) || 300),
                    max: Math.max(parseInt(delayMinInput.value, 10) || 300, parseInt(delayMaxInput.value, 10) || 1200)
                },
                rateLimits: {
                    perMinute: Math.max(1, parseInt(perMinuteInput?.value, 10) || 5),
                    perHour: Math.max(parseInt(perMinuteInput?.value, 10) || 5, parseInt(perHourInput?.value, 10) || 30),
                    perDay: Math.max(parseInt(perHourInput?.value, 10) || 30, parseInt(perDayInput?.value, 10) || 200)
                },
                burstRest: {
                    every: Math.max(1, parseInt(restEveryInput?.value, 10) || 5),
                    minSeconds: Math.max(0, Number(restMinInput?.value) || 5),
                    maxSeconds: Math.max(Number(restMinInput?.value) || 5, Number(restMaxInput?.value) || 10)
                },
                detailScrollSeconds: {
                    min: Math.max(0, Number(scrollMinInput?.value) || 1),
                    max: Math.max(Number(scrollMinInput?.value) || 1, Number(scrollMaxInput?.value) || 3)
                },
                delayRangesMs: String(delayRangesInput?.value || '').split(/[\n,]+/).map(v => v.trim()).filter(Boolean).map(v => { const m=v.split('-').map(n=>parseInt(n.trim(),10)); return { min: Math.max(0,m[0]||300), max: Math.max(Math.max(0,m[0]||300), m[1]||m[0]||1200) }; })
            },
            customRegex: String(regexInput?.value || '').split(/\n+/).map(v => v.trim()).filter(Boolean)
        }
    });
}

function gatherSearchParamsFromView() {
    const searchInput = document.getElementById('ea-search-input');
    const clickCountInput = document.getElementById('ea-click-count');
    const minDelayInput = document.getElementById('ea-min-delay');
    const delayMinInput = document.getElementById('ea-auto-delay-min');
    const delayMaxInput = document.getElementById('ea-auto-delay-max');
    const perMinuteInput = document.getElementById('ea-limit-minute');
    const perHourInput = document.getElementById('ea-limit-hour');
    const perDayInput = document.getElementById('ea-limit-day');
    const restEveryInput = document.getElementById('ea-rest-every');
    const restMinInput = document.getElementById('ea-rest-min');
    const restMaxInput = document.getElementById('ea-rest-max');
    const scrollMinInput = document.getElementById('ea-scroll-min');
    const scrollMaxInput = document.getElementById('ea-scroll-max');
    const delayRangesInput = document.getElementById('ea-delay-ranges');
    const regexInput = document.getElementById('ea-regex-list');
    const typed = (searchInput?.value || '').trim();
    const searches = Array.from(new Set([typed, ...(abbyParams.searches || [])].filter(Boolean)));
    return {
        searches,
        selectedSearch: typed || abbyParams.selectedSearch || searches[0] || '',
        ignore: {
            caseSensitive: false,
            keywords: getIgnoreKeywordsFromView()
        },
        linkedin: {
            filters: ['Easy Apply'],
            clickCount: Math.max(1, parseInt(clickCountInput?.value, 10) || 2),
            minClickDelaySeconds: Math.max(0, Number(minDelayInput?.value) || 0.8)
        },
        auto: {
            delaysMs: {
                min: Math.max(0, parseInt(delayMinInput?.value, 10) || 300),
                max: Math.max(parseInt(delayMinInput?.value, 10) || 300, parseInt(delayMaxInput?.value, 10) || 1200)
            },
            rateLimits: {
                perMinute: Math.max(1, parseInt(perMinuteInput?.value, 10) || 5),
                perHour: Math.max(parseInt(perMinuteInput?.value, 10) || 5, parseInt(perHourInput?.value, 10) || 30),
                perDay: Math.max(parseInt(perHourInput?.value, 10) || 30, parseInt(perDayInput?.value, 10) || 200)
            },
            burstRest: {
                every: Math.max(1, parseInt(restEveryInput?.value, 10) || 5),
                minSeconds: Math.max(0, Number(restMinInput?.value) || 5),
                maxSeconds: Math.max(Number(restMinInput?.value) || 5, Number(restMaxInput?.value) || 10)
            },
            detailScrollSeconds: {
                min: Math.max(0, Number(scrollMinInput?.value) || 1),
                max: Math.max(Number(scrollMinInput?.value) || 1, Number(scrollMaxInput?.value) || 3)
            }
        }
    };
}

function renderSearchView() {
    const searchInput = document.getElementById('ea-search-input');
    if (!searchInput) return;
    const selectList = document.getElementById('ea-search-list');
    const searches = abbyParams.searches || [];
    if (selectList) {
        selectList.innerHTML = searches.map(search => `
            <div class="ea-search-item ${search === abbyParams.selectedSearch ? 'active' : ''}" data-val="${escHtml(search)}">
                <span class="ea-search-text">${escHtml(search)}</span>
                <button class="ea-search-del" data-val="${escHtml(search)}" title="Remove location">✕</button>
            </div>
        `).join('');
        
        selectList.querySelectorAll('.ea-search-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.classList.contains('ea-search-del')) {
                    const val = e.target.dataset.val;
                    abbyParams.searches = abbyParams.searches.filter(x => x !== val);
                    if (abbyParams.selectedSearch === val) {
                        abbyParams.selectedSearch = abbyParams.searches[0] || '';
                    }
                    persistSearchDraft();
                    saveSearchParams(false);
                    return;
                }
                abbyParams.selectedSearch = item.dataset.val;
                document.getElementById('ea-search-input').value = abbyParams.selectedSearch;
                persistSearchDraft();
                renderSearchView();
            });
        });
    }
    document.getElementById('ea-ignore-input').value = '';
    renderIgnoreKeywordList();
    document.getElementById('ea-click-count').value = abbyParams.linkedin?.clickCount || 2;
    document.getElementById('ea-min-delay').value = abbyParams.linkedin?.minClickDelaySeconds || 0.8;
    document.getElementById('ea-auto-delay-min').value = abbyParams.auto?.delaysMs?.min || 300;
    document.getElementById('ea-auto-delay-max').value = abbyParams.auto?.delaysMs?.max || 1200;
    document.getElementById('ea-limit-minute').value = abbyParams.auto?.rateLimits?.perMinute || 5;
    document.getElementById('ea-limit-hour').value = abbyParams.auto?.rateLimits?.perHour || 30;
    document.getElementById('ea-limit-day').value = abbyParams.auto?.rateLimits?.perDay || 200;
    document.getElementById('ea-rest-every').value = abbyParams.auto?.burstRest?.every || 5;
    document.getElementById('ea-rest-min').value = abbyParams.auto?.burstRest?.minSeconds || 5;
    document.getElementById('ea-rest-max').value = abbyParams.auto?.burstRest?.maxSeconds || 10;
    document.getElementById('ea-scroll-min').value = abbyParams.auto?.detailScrollSeconds?.min || 1;
    document.getElementById('ea-scroll-max').value = abbyParams.auto?.detailScrollSeconds?.max || 3;
    const rangeField = document.getElementById('ea-delay-ranges');
    if (rangeField) rangeField.value = (abbyParams.auto?.delayRangesMs || []).map(r => `${r.min}-${r.max}`).join('\n');
    const regexField = document.getElementById('ea-regex-list');
    if (regexField) regexField.value = (abbyParams.customRegex || []).join('\n');
}

async function saveSearchParams(showMessage = true) {
    const response = await sendMessageAsync({ type: 'abby:save-params', params: gatherSearchParamsFromView() });
    if (response.ok && response.params) {
        abbyParams = normalizeParams(response.params);
        renderSearchView();
        if (showMessage) document.getElementById('ea-search-msg').textContent = 'Saved to /params';
    } else if (showMessage) {
        document.getElementById('ea-search-msg').textContent = 'Saved to Abby cache';
    }
    if (showMessage) setTimeout(() => {
        const msg = document.getElementById('ea-search-msg');
        if (msg) msg.textContent = '';
    }, 1800);
}

async function handleSearchOpen() {
    const response = await sendMessageAsync({ type: 'abby:open-search', params: gatherSearchParamsFromView() });
    if (response.ok && response.params) {
        abbyParams = normalizeParams(response.params);
        renderSearchView();
        document.getElementById('ea-search-msg').textContent = 'Opened LinkedIn search in background';
    } else {
        document.getElementById('ea-search-msg').textContent = response.error || 'Search open failed';
    }
}

// ──────────────────────────────────────────────────────────
// 1. FLOATING UI INJECTION
// ──────────────────────────────────────────────────────────
function injectFloatingUI() {
    if (document.getElementById('abby-floating-ui')) return;
    const ui = document.createElement('div');
    ui.id = 'abby-floating-ui';
    ui.innerHTML = `
      <div class="ea-header">
        <button id="ea-toggle-minimize" class="ea-min-btn" title="Hide Abby">−</button>
        <span class="ea-title">Abby <span class="ea-version">v${ABBY_VERSION}</span></span>
        <div class="ea-tabs">
          <button id="ea-tab-search" class="ea-tab">Search</button>
          <button id="ea-tab-apply" class="ea-tab">Apply</button>
          <button id="ea-tab-step" class="ea-tab ea-tab-active">Step</button>
          <button id="ea-tab-info" class="ea-tab">Info</button>
        </div>
        <span id="ea-status-indicator" class="ea-status-active"></span>
      </div>
      <div id="ea-body-search" class="ea-body ea-hidden">
        <div class="ea-stack">
          <label class="ea-mini-label" for="ea-search-input">Location</label>
          <div class="ea-inline-row">
            <input type="text" id="ea-search-input" class="abby-val-input" placeholder="California, United States">
            <button id="ea-search-save-btn" class="ea-btn-fill ea-btn-fill-active ea-btn-inline">Save</button>
          </div>
        </div>
        <div class="ea-stack">
          <label class="ea-mini-label">Saved locations</label>
          <div id="ea-search-list"></div>
        </div>
        <div class="ea-stack">
          <label class="ea-mini-label" for="ea-ignore-input">Ignore keywords</label>
          <div class="ea-inline-row">
            <input type="text" id="ea-ignore-input" class="abby-val-input" placeholder="founding">
            <button id="ea-ignore-add-btn" class="ea-btn-fill ea-btn-fill-active ea-btn-inline">Save</button>
          </div>
          <div id="ea-ignore-list" class="ea-token-list"></div>
        </div>
        <div class="ea-grid-4">
          <div class="ea-stack">
            <label class="ea-mini-label" for="ea-click-count">Click count</label>
            <input type="number" id="ea-click-count" class="abby-val-input" min="1" step="1">
          </div>
          <div class="ea-stack">
            <label class="ea-mini-label" for="ea-min-delay">Min click delay</label>
            <input type="number" id="ea-min-delay" class="abby-val-input" min="0" step="0.1">
          </div>
          <div class="ea-stack">
            <label class="ea-mini-label" for="ea-auto-delay-min">Random delay min (ms)</label>
            <input type="number" id="ea-auto-delay-min" class="abby-val-input" min="0" step="50">
          </div>
          <div class="ea-stack">
            <label class="ea-mini-label" for="ea-auto-delay-max">Random delay max (ms)</label>
            <input type="number" id="ea-auto-delay-max" class="abby-val-input" min="0" step="50">
          </div>
        </div>
        <div class="ea-grid-4">
          <div class="ea-stack">
            <label class="ea-mini-label" for="ea-limit-minute">Per min</label>
            <input type="number" id="ea-limit-minute" class="abby-val-input" min="1" step="1">
          </div>
          <div class="ea-stack">
            <label class="ea-mini-label" for="ea-limit-hour">Per hour</label>
            <input type="number" id="ea-limit-hour" class="abby-val-input" min="1" step="1">
          </div>
          <div class="ea-stack">
            <label class="ea-mini-label" for="ea-limit-day">Per day</label>
            <input type="number" id="ea-limit-day" class="abby-val-input" min="1" step="1">
          </div>
          <div class="ea-stack">
            <label class="ea-mini-label" for="ea-rest-every">Rest every</label>
            <input type="number" id="ea-rest-every" class="abby-val-input" min="1" step="1">
          </div>
        </div>
        <div class="ea-grid-4">
          <div class="ea-stack">
            <label class="ea-mini-label" for="ea-rest-min">Rest min (s)</label>
            <input type="number" id="ea-rest-min" class="abby-val-input" min="0" step="0.5">
          </div>
          <div class="ea-stack">
            <label class="ea-mini-label" for="ea-rest-max">Rest max (s)</label>
            <input type="number" id="ea-rest-max" class="abby-val-input" min="0" step="0.5">
          </div>
        </div>
        <div class="ea-grid-2">
          <div class="ea-stack">
            <label class="ea-mini-label" for="ea-scroll-min">Detail scroll min (s)</label>
            <input type="number" id="ea-scroll-min" class="abby-val-input" min="0" step="0.5">
          </div>
          <div class="ea-stack">
            <label class="ea-mini-label" for="ea-scroll-max">Detail scroll max (s)</label>
            <input type="number" id="ea-scroll-max" class="abby-val-input" min="0" step="0.5">
          </div>
        </div>
        <div class="ea-grid-2">
          <div class="ea-stack">
            <label class="ea-mini-label" for="ea-delay-ranges">Delay ranges list (min-max ms, one per line)</label>
            <textarea id="ea-delay-ranges" class="abby-val-input" rows="3" placeholder="300-1200\n800-2000"></textarea>
          </div>
          <div class="ea-stack">
            <label class="ea-mini-label" for="ea-regex-list">Custom regex (one pattern per line)</label>
            <textarea id="ea-regex-list" class="abby-val-input" rows="3" placeholder="\bpython\b"></textarea>
          </div>
        </div>
        <div class="ea-btn-row">
          <button id="ea-search-open-btn" class="ea-btn-save">Search</button>
        </div>
        <p id="ea-search-msg" class="ea-inline-msg"></p>
      </div>
      <div id="ea-body-apply" class="ea-body ea-hidden">
        <div class="ea-metrics-row" style="display:flex; justify-content:space-between; margin-bottom: 8px; font-size: 11px; background: rgba(0,0,0,0.15); padding: 6px; border-radius: 6px;">
          <div class="ea-metric"><strong>Total:</strong> <span id="ea-metric-total">0</span></div>
          <div class="ea-metric"><strong>Today:</strong> <span id="ea-metric-today">0</span></div>
          <div class="ea-metric"><strong>Hour:</strong> <span id="ea-metric-hour">0/150</span></div>
        </div>
        <div id="ea-apply-countdown" style="display:none; color: #ff9800; font-size: 12px; font-weight: 600; margin-bottom: 5px; text-align: center;">Cooldown: 5:00</div>
        <p id="ea-apply-status">Ready.</p>
        <div class="ea-stack">
          <label class="ea-mini-label">Apply Mode</label>
          <select id="ea-apply-mode" class="abby-val-input">
            <option value="auto">Auto mode</option>
            <option value="manual">Manual mode</option>
          </select>
        </div>
        <div class="ea-btn-row">
          <button id="ea-apply-btn" class="ea-btn-save">Apply</button>
        </div>
      </div>
      <div id="ea-body-step" class="ea-body">
        <div class="ea-step-nav">
          <button id="ea-step-prev" class="ea-step-nav-btn" type="button" title="Previous visited step"><-</button>
          <div id="ea-step-position" class="ea-step-position">Live</div>
          <button id="ea-step-next" class="ea-step-nav-btn" type="button" title="Next visited step">-></button>
        </div>
        <p id="ea-current-action">Standing by for Easy Apply...</p>
        <div id="ea-fields-wrap"></div>
        <div class="ea-btn-row">
          <button id="ea-fill-all-btn" class="ea-btn-fill" disabled>Fill</button>
          <button id="ea-save-btn" class="ea-btn-save">Save</button>
        </div>
      </div>
      <div id="ea-body-info" class="ea-body ea-hidden">
        <div id="ea-info-wrap"><p class="ea-dim">No saved answers yet.</p></div>
        <div class="ea-info-actions">
          <button id="ea-info-save-btn" class="ea-btn-primary">Save Changes</button>
        </div>
        <p id="ea-info-msg"></p>
      </div>`;
    document.body.appendChild(ui);

    const savedPos = lsGet(LS_POS);
    if (savedPos && typeof savedPos.left === 'number' && typeof savedPos.top === 'number') {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const W = ui.offsetWidth || 460;
        const clampedLeft = Math.max(0, Math.min(savedPos.left, vw - W - 10));
        const clampedTop = Math.max(0, Math.min(savedPos.top, vh - 80));
        ui.style.left = clampedLeft + 'px';
        ui.style.top = clampedTop + 'px';
    }

    const savedTab = lsGet(LS_TAB);
    if (['search', 'apply', 'info', 'step'].includes(savedTab)) {
        switchView(savedTab);
        if (savedTab === 'info') renderInfoView();
    }

    makeDraggable(ui, ui.querySelector('.ea-header'));
    applyMinimizedState(lsGet(LS_MIN));
    chrome.storage.local.get(['abbyTheme'], (res) => {
        applyTheme(res.abbyTheme || lsGet(LS_THEME) || 'dark');
    });

    document.getElementById('ea-toggle-minimize').addEventListener('click', () => {
        const lastDragAt = Number(document.getElementById('abby-floating-ui')?.dataset.abbyLastDragAt || 0);
        if (Date.now() - lastDragAt < 250) return;
        const isMin = document.getElementById('abby-floating-ui').classList.contains('abby-minimized');
        applyMinimizedState(!isMin);
    });
    document.getElementById('ea-tab-search').addEventListener('click', () => { switchView('search'); renderSearchView(); });
    document.getElementById('ea-tab-apply').addEventListener('click', () => {
        if (!applyTabReady && !autoApplyRunning && !findEasyApplyModal()) return;
        switchView('apply');
    });
    document.getElementById('ea-tab-step').addEventListener('click', () => switchView('step'));
    document.getElementById('ea-tab-info').addEventListener('click', () => { switchView('info'); renderInfoView(); });
    document.getElementById('ea-save-btn').addEventListener('click', saveCurrentFields);
    document.getElementById('ea-fill-all-btn').addEventListener('click', fillAllMatchedFields);
    document.getElementById('ea-info-save-btn').addEventListener('click', saveInfoEdits);
    document.getElementById('ea-search-save-btn').addEventListener('click', () => saveSearchParams(true));
    document.getElementById('ea-ignore-add-btn').addEventListener('click', addIgnoreKeyword);
    document.getElementById('ea-search-open-btn').addEventListener('click', handleSearchOpen);
    chrome.storage.local.get(['abbyApplyMode'], (res) => {
        abbyApplyMode = res.abbyApplyMode === 'manual' ? 'manual' : 'auto';
        const modeSel = document.getElementById('ea-apply-mode');
        if (modeSel) modeSel.value = abbyApplyMode;
    });
    document.getElementById('ea-apply-mode').addEventListener('change', (event) => {
        abbyApplyMode = event.target.value === 'manual' ? 'manual' : 'auto';
        chrome.storage.local.set({ abbyApplyMode });
    });
    document.getElementById('ea-apply-btn').addEventListener('click', () => handleApplyAction());
    document.getElementById('ea-step-prev').addEventListener('click', showPreviousStepSnapshot);
    document.getElementById('ea-ignore-input').addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            addIgnoreKeyword();
        }
    });
    ['ea-search-input', 'ea-click-count', 'ea-min-delay', 'ea-auto-delay-min', 'ea-auto-delay-max', 'ea-limit-minute', 'ea-limit-hour', 'ea-limit-day', 'ea-rest-every', 'ea-rest-min', 'ea-rest-max', 'ea-scroll-min', 'ea-scroll-max', 'ea-delay-ranges', 'ea-regex-list'].forEach(id => {
        document.getElementById(id).addEventListener('input', persistSearchDraft);
    });
    renderSearchView();
    refreshParams(true);
    syncApplyAvailability();
    updateApplyButton();
}

// ──────────────────────────────────────────────────────────
// DRAG TO REPOSITION
// ──────────────────────────────────────────────────────────
function makeDraggable(panel, handle) {
    let startX, startY, startLeft, startTop, dragging = false;
    let moved = false;
    let lastDragAt = 0;

    handle.addEventListener('mousedown', (e) => {
        // Don't drag when clicking buttons/inputs inside header
        if (e.target.closest('button, input, select') && !panel.classList.contains('abby-minimized')) return;
        dragging = true;
        moved = false;
        startX = e.clientX;
        startY = e.clientY;
        const rect = panel.getBoundingClientRect();
        startLeft = rect.left;
        startTop = rect.top;
        // Temporarily remove the slide-in animation so it doesn't re-trigger
        panel.style.animation = 'none';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
        const newLeft = startLeft + dx;
        const newTop = startTop + dy;
        // Clamp to viewport
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const W = panel.offsetWidth;
        const clampedLeft = Math.max(0, Math.min(newLeft, vw - W - 10));
        const clampedTop = Math.max(0, Math.min(newTop, vh - 80));
        panel.style.left = clampedLeft + 'px';
        panel.style.top = clampedTop + 'px';
    });

    document.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        if (moved) {
            lastDragAt = Date.now();
            panel.dataset.abbyLastDragAt = String(lastDragAt);
        }
        // Persist final position
        const rect = panel.getBoundingClientRect();
        lsSet(LS_POS, { left: rect.left, top: rect.top });
    });
    panel.dataset.abbyLastDragAt = String(lastDragAt || 0);
}

function switchView(view) {
    if (view === 'apply' && !applyTabReady && !autoApplyRunning && !findEasyApplyModal()) return;
    activeView = view;
    document.getElementById('ea-body-search').classList.toggle('ea-hidden', view !== 'search');
    document.getElementById('ea-body-apply').classList.toggle('ea-hidden', view !== 'apply');
    document.getElementById('ea-body-step').classList.toggle('ea-hidden', view !== 'step');
    document.getElementById('ea-body-info').classList.toggle('ea-hidden', view !== 'info');
    document.getElementById('ea-tab-search').classList.toggle('ea-tab-active', view === 'search');
    document.getElementById('ea-tab-apply').classList.toggle('ea-tab-active', view === 'apply');
    document.getElementById('ea-tab-step').classList.toggle('ea-tab-active', view === 'step');
    document.getElementById('ea-tab-info').classList.toggle('ea-tab-active', view === 'info');
    lsSet(LS_TAB, view);
    if (view === 'step') renderCurrentStepPanel();
}

// ──────────────────────────────────────────────────────────
// 2. SHADOW DOM HELPERS
// ──────────────────────────────────────────────────────────
function findInShadow(root, sel) {
    const r = root.querySelector(sel);
    if (r) return r;
    for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) {
            const f = findInShadow(el.shadowRoot, sel);
            if (f) return f;
        }
    }
    return null;
}

function collectFromShadow(root, sel) {
    const list = [];
    root.querySelectorAll(sel).forEach(e => list.push(e));
    root.querySelectorAll('*').forEach(el => {
        if (el.shadowRoot) collectFromShadow(el.shadowRoot, sel).forEach(e => list.push(e));
    });
    return list;
}


function compileCustomRegexList() {
    return (abbyParams.customRegex || []).map(pattern => {
        try { return new RegExp(pattern, 'i'); } catch { return null; }
    }).filter(Boolean);
}

function injectCustomRegexExpression(pattern) {
    const text = String(pattern || '').trim();
    if (!text) return { ok: false, error: 'Empty regex pattern.' };
    try {
        new RegExp(text, 'i');
    } catch (err) {
        return { ok: false, error: `Invalid regex: ${err.message}` };
    }
    const next = Array.from(new Set([...(abbyParams.customRegex || []), text]));
    abbyParams.customRegex = next;
    persistSearchDraft();
    saveSearchParams(false);
    markBlockedJobs();
    return { ok: true };
}

function findEasyApplyModal() {
    // 1. Check for specific Easy Apply modal class
    const eaModal = document.querySelector('.jobs-easy-apply-modal') ||
        document.querySelector('[data-test-modal-id="easy-apply-modal"]');
    if (eaModal) return eaModal;

    // 2. Check for generic artdeco-modal but ensure it's NOT the "All filters" one
    const modals = document.querySelectorAll('.artdeco-modal');
    for (const modal of modals) {
        // LinkedIn "All filters" modal usually has a header with "All filters"
        const header = modal.querySelector('.artdeco-modal__header, h2');
        const headerText = header ? header.innerText.toLowerCase() : '';
        if (headerText.includes('all filters')) continue;
        
        // Easy Apply modals usually have "Apply to" or "Review your application"
        // or contain elements with jobs-easy-apply classes
        if (headerText.includes('apply to') || 
            headerText.includes('review your application') ||
            modal.querySelector('.jobs-easy-apply-content') ||
            modal.querySelector('[data-job-id]')) {
            return modal;
        }
    }

    // 3. Last resort shadow DOM check, but still avoid filters
    const shadowModal = findInShadow(document, '[role="dialog"]');
    if (shadowModal) {
        const text = shadowModal.innerText.toLowerCase();
        if (text.includes('all filters') && !text.includes('easy apply')) return null;
        if (text.includes('easy apply') || text.includes('apply to')) return shadowModal;
    }

    return null;
}

// ──────────────────────────────────────────────────────────
// 3. FIELD EXTRACTION
// ──────────────────────────────────────────────────────────
const SKIP_TYPES = new Set(['file', 'hidden', 'submit', 'button', 'reset', 'image', 'search']);
const SKIP_LABELS = ['deselect', 'upload', 'remove', 'delete', 'choose file', 'browse'];
const IGNORED_FIELD_PATTERNS = [
    /mark (this )?job as (a )?top choice/i,
    /^resume$/i
];

// Headings where we hide the field table entirely (show nothing — user just clicks Next)
const SKIP_HEADINGS = [
    /mark (this )?job as (a )?top choice/i,
    /top choice/i,
    /^sort by$/i
];

// Regex patterns that canonicalize repeated questions across different jobs.
// Only the canonical KEY is shown in Abby’s table — company-specific text is stripped.
// Multiple rx entries can map to the same key (all aliases share one saved answer).
const CANONICAL_QUESTIONS = [
    { rx: /do you agree to the additional job application terms/i, key: 'Job Application Agreement' },
    // Work authorization — multiple phrasings across companies
    { rx: /authorized to work/i, key: 'Work Authorization' },
    { rx: /legally authorized to work/i, key: 'Work Authorization' },
    // Sponsorship — catches "require", "require...visa sponsor", "transfer"
    { rx: /require.{0,25}(visa\s+)?sponsor/i, key: 'Require Sponsorship?' },
    { rx: /sponsorship.{0,20}(work|employ)/i, key: 'Require Sponsorship?' },
    // Client relationship
    { rx: /are you currently an? .{1,40} client/i, key: 'Are you a current client?' },
    // Interest / motivation
    { rx: /why are you interested in/i, key: 'Why are you interested?' },
    { rx: /\bwebsite\b/i, key: 'Website' },
    // Education — catches "highest level", "highest academic level", etc.
    { rx: /highest (level of |academic )?education|highest academic level/i, key: 'Highest Education' },
    { rx: /\bfield of study\b|\bmajor\b/i, key: 'Major / Field of Study' },
    // Social / profile links
    { rx: /linkedin/i, key: 'LinkedIn Profile' },
    { rx: /\bgithub\b/i, key: 'GitHub Profile' },
    // EEO demographics (long paragraph prompts -> short canonical key)
    { rx: /\brace\s*\/?\s*ethnicity\b/i, key: 'Race/Ethnicity' },
    { rx: /\brace categories are defined as follows\b/i, key: 'Race/Ethnicity' },
    { rx: /\bhispanic or latino\b.*\bwhite\s*\(not hispanic or latino\)\b/i, key: 'Race/Ethnicity' },
    // Veteran status (long VEVRAA/USERRA legal text -> short canonical key)
    { rx: /\bveteran status\b/i, key: 'Veteran' },
    { rx: /\bvevraa\b|\bvietnam era veterans'? readjustment assistance act\b/i, key: 'Veteran' },
    { rx: /\bprotected veterans?\b.*\buserr?a\b|\buniformed services employment and reemployment rights act\b/i, key: 'Veteran' },
    // Disability status (long self-ID legal text -> short canonical key)
    { rx: /\bdo you have a disability\b/i, key: 'Disability' },
    { rx: /\bhow do i know if i have a disability\b/i, key: 'Disability' },
    { rx: /\bmajor life activities\b.*\bperson with a disability\b/i, key: 'Disability' },
    { rx: /\bdisabilities include, but are not limited to\b/i, key: 'Disability' },
    // Signature/date fields
    { rx: /\btoday'?s date\b|\bsignature date\b/i, key: "Today's Date" },
    // On-site requirements
    { rx: /days (a|per) week/i, key: 'Work Schedule' },
    // Work authorization detail
    { rx: /authorized for employment in the united states/i, key: 'Work Authorization' },
    { rx: /green card/i, key: 'Green Card/Citizen' },
    { rx: /u\.?s\.?\s*citizen/i, key: 'Green Card/Citizen' },
    { rx: /permanent\s+resident/i, key: 'Green Card/Citizen' },
    { rx: /\bsalary\b|\bcompensation\b/i, key: 'Salary' },
    { rx: /year.*experience.*develop/i, key: 'Years of Development Experience' },
    { rx: /develop.*experience.*year/i, key: 'Years of Development Experience' },
    { rx: /how did you learn about/i, key: 'How did you learn about this role?' },
    { rx: /have you ever worked for/i, key: 'Worked Here Before?' },
    { rx: /have you worked with/i, key: 'Have you worked with?' },
    { rx: /work.*startup/i, key: 'Work Startup Experience' },
    { rx: /relocate/i, key: 'Willing to Relocate' },
    { rx: /are you comfortable/i, key: 'Are you comfortable?' },
    { rx: /message.*hiring manager/i, key: 'Message Hiring Manager' },
    { rx: /hiring manager.*message/i, key: 'Message Hiring Manager' },
    { rx: /\bgender\b/i, key: 'Gender' },
];
const CANONICAL_KEYS = new Set(CANONICAL_QUESTIONS.map(item => String(item.key || '').toLowerCase()));

// Default answers seeded into chrome.storage on first run (user editable)
const CANONICAL_DEFAULTS = {
    'Are you a current client?': 'No',
    'Why are you interested?': 'I am excited about this opportunity because it aligns with my background in software engineering and my passion for building impactful products. I believe my skills would contribute meaningfully to the team.',
    'Require Sponsorship?': 'Yes',
    'Highest Education': "Master's",
    'Major / Field of Study': 'Computer Science',
    'Website': 'https://',
    'LinkedIn Profile': 'https://linkedin.com/in/',
    'GitHub Profile': 'https://github.com/',
    'Work Schedule': 'Yes',
    'How did you learn about this role?': 'Linkedin',
    'Worked Here Before?': 'No',
    'Have you worked with?': 'Yes',
    'Work Startup Experience': 'Yes',
    'Willing to Relocate': 'Yes',
    'Are you comfortable?': 'Yes',
    'Green Card/Citizen': 'No',
    'Follow Company?': 'No',
    'Gender': 'Male'
};

function normalizeLabel(label, stepHeading) {
    const cleaned = clean(String(label || ''));
    if (!cleaned) return '';
    const step = normalizeStepHeading(stepHeading || currentHeading || '');
    if (/^review$/i.test(step) && /^follow\b/i.test(cleaned)) return 'Follow Company?';
    const locatedCity = extractLocatedCity(cleaned);
    if (locatedCity) return `Located in ${locatedCity}`;
    for (const { rx, key } of CANONICAL_QUESTIONS) {
        if (rx.test(cleaned)) return key;
    }
    const doubled = cleaned.match(/^(.+?)\s+\1$/i);
    return doubled && doubled[1] ? doubled[1].trim() : cleaned;
}

function extractLocatedCity(label) {
    const text = clean(String(label || ''));
    if (!/\blocated\b/i.test(text) || !/\bin\b/i.test(text)) return '';
    const m = text.match(/\blocated\b[\s\S]{0,40}\bin\s+([A-Za-z][A-Za-z .,'-]{1,60})/i);
    if (!m || !m[1]) return '';
    let city = m[1]
        .replace(/\b(the|usa|us|u\.s\.a\.?|united states)\b/gi, '')
        .replace(/[?.,;:!]+$/g, '')
        .trim();
    city = city.split(/\s{2,}| and |\/|\\|\|/)[0].trim();
    if (!city) return '';
    return city
        .split(/\s+/)
        .map(part => part ? (part[0].toUpperCase() + part.slice(1).toLowerCase()) : part)
        .join(' ');
}

function normalizeStepHeading(label) {
    const text = clean(label || '');
    if (!text) return 'General';
    if (/^sort by$/i.test(text)) return 'Sort by';
    if (/^contact info$/i.test(text)) return 'Contact Info';
    if (/^resume$/i.test(text)) return 'Resume';
    if (/^home address$/i.test(text)) return 'Home Address';
    if (/^work experience$/i.test(text)) return 'Work Experience';
    if (/^education$/i.test(text)) return 'Education';
    if (/^additional questions?$/i.test(text)) return 'Additional Questions';
    if (/^screening questions?$/i.test(text)) return 'Screening Questions';
    if (/^voluntary self identification$/i.test(text)) return 'Voluntary Self Identification';
    if (/^review$/i.test(text)) return 'Review';
    if (/^apply to\b/i.test(text)) return 'Apply';
    if (/mark (this )?job as (a )?top choice/i.test(text) || /top choice/i.test(text)) return 'Top Choice';
    return text;
}

function normalizeGroupHeading(label) {
    const heading = normalizeStepHeading(label);
    if (/^top choice$/i.test(heading) || /^sort by$/i.test(heading)) return '';
    return heading || 'General';
}

function isHiddenStepHeading(label) {
    return SKIP_HEADINGS.some(rx => rx.test(label || ''));
}

function isCanonicalKey(label) {
    if (/^located in /i.test(String(label || '').trim())) return true;
    return CANONICAL_KEYS.has(String(label || '').toLowerCase());
}

function shouldIgnoreFieldLabel(label, stepHeading) {
    const normalizedLabel = clean(String(label || ''));
    if (!normalizedLabel) return true;
    if (IGNORED_FIELD_PATTERNS.some(rx => rx.test(normalizedLabel))) return true;
    const step = normalizeStepHeading(stepHeading || currentHeading || '');
    if (/^resume$/i.test(step) && /^resume$/i.test(normalizedLabel)) return true;
    return false;
}

function buildScopedSaveKey(stepHeading, label) {
    const heading = clean(stepHeading || '');
    return heading ? `[${heading}] ${label}` : label;
}

function parseScopedSaveKey(saveKey) {
    const match = String(saveKey || '').match(/^\[([^\]]+)\]\s+(.+)$/);
    if (!match) return null;
    return {
        heading: normalizeGroupHeading(match[1]),
        label: clean(match[2])
    };
}

function isDynamicTodayDateField(field) {
    if (!field) return false;
    return field.label === "Today's Date" || field.saveKey === "Today's Date";
}

function formatTodayForInput(input) {
    const now = new Date();
    const y = String(now.getFullYear());
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    // Native date inputs require yyyy-mm-dd; text inputs are easier to read as mm/dd/yyyy.
    if (input && input.type === 'date') return `${y}-${m}-${d}`;
    return `${m}/${d}/${y}`;
}

function resolveSavedValue(savedAnswers, field) {
    if (!field) return '';
    if (isDynamicTodayDateField(field)) return formatTodayForInput(field.input);
    if (!savedAnswers) return '';
    const scoped = savedAnswers[field.saveKey];
    if (scoped) return scoped;
    // Backward compatibility: old data used the raw label as key.
    return savedAnswers[field.label] || '';
}

function getLabelInfo(input, container) {
    // 1. aria-labelledby
    const lblby = input.getAttribute('aria-labelledby');
    if (lblby) {
        const el = container.querySelector(`#${lblby}`) || findInShadow(container, `#${lblby}`);
        if (el) return clean(el.innerText);
    }
    // 2. aria-label
    if (input.getAttribute('aria-label')) return clean(input.getAttribute('aria-label'));

    // 3. associated <label for="id">
    if (input.id) {
        const lbl = container.querySelector(`label[for="${CSS.escape(input.id)}"]`) ||
            findInShadow(container, `label[for="${CSS.escape(input.id)}"]`);
        if (lbl) return clean(lbl.innerText);
    }

    // 4. walk up to find the nearest label-like ancestor text
    let p = input.parentElement;
    for (let i = 0; i < 7 && p; i++) {
        const labels = Array.from(p.querySelectorAll('label'));
        if (labels.length) {
            // Prefer label closest to input (last one works for most LinkedIn layouts)
            return clean(labels[labels.length - 1].innerText);
        }
        // span/div siblings above that look like labels
        let sib = p.previousElementSibling;
        while (sib) {
            const t = (sib.innerText || '').trim();
            if (t && t.length < 150 && !/^</.test(t)) return clean(t);
            sib = sib.previousElementSibling;
        }
        p = p.parentElement;
    }

    return input.placeholder ? clean(input.placeholder) : 'Field';
}

// Special label resolver for radio groups: looks for a fieldset legend or
// a heading element that precedes the radio group, NOT the individual option label.
function getRadioGroupLabel(radioInput, container) {
    // 1. Walk up and look for <fieldset><legend>
    let el = radioInput.parentElement;
    while (el && el !== container) {
        if (el.tagName === 'FIELDSET') {
            const legend = el.querySelector('legend');
            if (legend) return clean(legend.innerText);
        }
        el = el.parentElement;
    }
    // 2. Look for a label/span/div that sits just before the radio list container
    let parent = radioInput.parentElement;
    for (let i = 0; i < 9 && parent && parent !== container; i++) {
        let sib = parent.previousElementSibling;
        while (sib) {
            // Skip siblings that are just other radio wrappers
            if (!sib.querySelector('input[type="radio"]')) {
                const labelEl = sib.querySelector('label, legend, span, div') || sib;
                const t = (labelEl.innerText || '').trim();
                // Must be a short non-option string
                if (t && t.length < 140 && !/^yes$|^no$/i.test(t)) return clean(t);
            }
            sib = sib.previousElementSibling;
        }
        parent = parent.parentElement;
    }
    // 3. Fall back to standard label detection
    return getLabelInfo(radioInput, container);
}

// Resolve the human-readable label for a single radio OPTION (not the group question).
// LinkedIn stores internal IDs in the `value` attribute; the visible text is in a <label>.
function getRadioOptionLabel(radio, container) {
    // 1. aria-label on the input itself (if it’s a real word, not an internal ID)
    const al = radio.getAttribute('aria-label');
    if (al && !/^[\d_]+$/.test(al)) return al.trim();
    // 2. <label for="id"> sibling
    if (radio.id) {
        const lbl = container.querySelector(`label[for="${CSS.escape(radio.id)}"]`) ||
            findInShadow(container, `label[for="${CSS.escape(radio.id)}"]`);
        if (lbl) {
            const t = (lbl.textContent || '').replace(/\s+/g, ' ').trim();
            if (t && !/^[\d_]+$/.test(t)) return t;
        }
    }
    // 3. Immediate parent <label>
    if (radio.parentElement?.tagName === 'LABEL') {
        const t = (radio.parentElement.textContent || '').replace(/\s+/g, ' ').trim();
        if (t && !/^[\d_]+$/.test(t)) return t;
    }
    // 4. Nearest label text in up to 3 ancestors
    let p = radio.parentElement;
    for (let i = 0; i < 3 && p; i++) {
        const lbl = p.querySelector('label, span[class*="label"], [role="radio"]');
        if (lbl && lbl !== radio) {
            const t = (lbl.textContent || '').replace(/\s+/g, ' ').trim();
            if (t && !/^[\d_]+$/.test(t)) return t;
        }
        p = p.parentElement;
    }
    // 5. Last resort: raw value (may be an ID, but better than nothing)
    return radio.value;
}

function clean(str) {
    str = str.replace(/\*+/g, '').replace(/\s+/g, ' ').trim();
    // Strip trailing screen-reader suffixes LinkedIn appends
    str = str.replace(/\s+(Required|Optional)\s*$/i, '').trim();
    // LinkedIn often duplicates label text: "Question? Question?" or "Q Q"
    // Strategy: find the first sentence-end boundary after which the text repeats
    const sentenceEndRx = /[.?!]\s+/g;
    let m;
    while ((m = sentenceEndRx.exec(str)) !== null) {
        const cutPos = m.index + 1;                       // include the punctuation
        const firstPart = str.slice(0, cutPos).trim();
        const rest = str.slice(m.index + m[0].length).trim();
        if (firstPart.length >= 10 && rest.startsWith(firstPart.slice(0, Math.min(15, firstPart.length)))) {
            return firstPart;
        }
    }
    // Fallback: simple half-split check (handles "A A" without punctuation)
    const half = Math.ceil(str.length / 2);
    const first = str.slice(0, half).trimEnd();
    const second = str.slice(half).trimStart();
    if (second && first.length > 10 && second.startsWith(first.slice(0, Math.min(20, first.length)))) {
        return first;
    }
    return str;
}

function isRequired(input, container) {
    if (input.required || input.getAttribute('aria-required') === 'true') return true;
    const id = input.id;
    if (id) {
        const lbl = container.querySelector(`label[for="${CSS.escape(id)}"]`) ||
            findInShadow(container, `label[for="${CSS.escape(id)}"]`);
        if (lbl && lbl.innerText.includes('*')) return true;
    }
    return false;
}

function getInputValue(input) {
    if (input.tagName === 'SELECT') {
        const opt = input.options[input.selectedIndex];
        const text = opt ? opt.text.trim() : '';
        // Treat placeholder option (no value, or "Select an option") as empty
        if (!text || /^select an? option/i.test(text) || opt.value === '') return '';
        return text;
    }
    if (input.type === 'checkbox') return input.checked ? 'Yes' : 'No';
    if (input.type === 'radio') return input.checked ? (input.getAttribute('aria-label') || input.value || 'Selected') : null;
    return (input.value || '').trim();
}

function matchesComparableText(candidate, value) {
    const a = clean(String(candidate || '')).toLowerCase();
    const b = clean(String(value || '')).toLowerCase();
    if (!a || !b) return false;
    return a === b || a.includes(b) || b.includes(a);
}

function setInputValue(input, value) {
    if (input.tagName === 'SELECT') {
        // Match option by text or value (case-insensitive)
        const opts = Array.from(input.options);
        const target = opts.find(o =>
            o.text.trim().toLowerCase() === value.toLowerCase() ||
            o.value.toLowerCase() === value.toLowerCase()
        );
        if (target) {
            input.selectedIndex = target.index;
            ['change', 'input'].forEach(e => input.dispatchEvent(new Event(e, { bubbles: true })));
        }
        return;
    }
    // React-controlled text/textarea inputs
    const proto = input.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (nativeSetter) nativeSetter.call(input, value);
    else input.value = value;
    ['input', 'change'].forEach(e => input.dispatchEvent(new Event(e, { bubbles: true })));
}

function ensureConfirmCheckboxesChecked(scope) {
    const root = scope || document;
    const checkboxes = collectFromShadow(root, 'input[type="checkbox"]');
    checkboxes.forEach(box => {
        if (box.checked || box.disabled) return;
        const labelText = clean([
            box.getAttribute('aria-label') || '',
            box.closest('label')?.innerText || '',
            box.parentElement?.innerText || ''
        ].join(' ')).toLowerCase();
        if (!/(confirm|agree|acknowledge|certify|consent|attest|terms|i understand)/i.test(labelText)) return;
        box.click();
        ['input', 'change'].forEach(eventName => box.dispatchEvent(new Event(eventName, { bubbles: true })));
    });
}

function findVisibleAutocompleteOptions() {
    const candidates = collectFromShadow(document, '[role="option"], [role="listbox"] [role="radio"], [role="listbox"] [role="button"], li');
    return candidates.filter(node => {
        if (!node || node === document.body) return false;
        const text = clean(node.innerText || node.textContent || node.getAttribute('aria-label') || '');
        if (!text) return false;
        const rect = node.getBoundingClientRect?.();
        return !!rect && rect.width > 0 && rect.height > 0;
    });
}

async function chooseAutocompleteOption(input, value) {
    if (!input || input.tagName === 'SELECT' || input.type === 'radio') return false;
    const isCombo = input.getAttribute('role') === 'combobox' || input.getAttribute('aria-autocomplete') || input.getAttribute('aria-expanded') !== null;
    if (!isCombo) return false;

    const deadline = Date.now() + 1800;
    while (Date.now() < deadline) {
        const options = findVisibleAutocompleteOptions();
        const match = options.find(node => matchesComparableText(node.innerText || node.textContent || node.getAttribute('aria-label') || '', value));
        if (match) {
            match.click();
            ['mousedown', 'mouseup', 'click'].forEach(eventName => match.dispatchEvent(new MouseEvent(eventName, { bubbles: true })));
            return true;
        }
        await wait(120);
    }
    return false;
}

function extractFormFields(modal) {
    const all = collectFromShadow(modal, 'input, select, textarea');
    const seen = new Set();
    const fields = [];

    // Group radios by name
    const radioGroups = {};
    all.filter(i => i.type === 'radio').forEach(r => {
        if (!radioGroups[r.name]) radioGroups[r.name] = [];
        radioGroups[r.name].push(r);
    });
    const handledRadioNames = new Set();

    all.forEach(input => {
        if (SKIP_TYPES.has(input.type)) return;

        // Handle radio groups
        if (input.type === 'radio') {
            if (handledRadioNames.has(input.name)) return;
            handledRadioNames.add(input.name);
            const group = radioGroups[input.name] || [];
            const checked = group.find(r => r.checked);
            const rawLabel = getRadioGroupLabel(group[0], modal);
            const label = normalizeLabel(rawLabel, currentHeading);
            if (SKIP_LABELS.some(s => label.toLowerCase().includes(s))) return;
            if (shouldIgnoreFieldLabel(label, currentHeading)) return;
            if (seen.has(label)) return;
            seen.add(label);
            const value = checked ? getRadioOptionLabel(checked, modal) : '';
            // Collect all radio option labels (not internal ID values)
            const options = group.map(r => getRadioOptionLabel(r, modal)).filter(Boolean);
            fields.push({ label, value, required: isRequired(group[0], modal), empty: !value, input: checked || group[0], options, radioGroup: radioGroups[group[0].name] });
            return;
        }

        const val = getInputValue(input);
        if (val === null) return; // unchecked radio

        const rawLabel = getLabelInfo(input, modal);
        const label = normalizeLabel(rawLabel, currentHeading);
        if (SKIP_LABELS.some(s => label.toLowerCase().includes(s))) return;
        if (shouldIgnoreFieldLabel(label, currentHeading)) return;
        if (label === 'Field' && !input.value) return;
        if (seen.has(label)) return;
        seen.add(label);

        // For select: also capture the options list for editing
        const options = input.tagName === 'SELECT'
            ? Array.from(input.options).map(o => o.text.trim()).filter(Boolean)
            : null;

        fields.push({ label, value: val, required: isRequired(input, modal), empty: val === '', input, options });
    });

    // Composite key for non-canonical fields: [Step Heading] + Label.
    // This keeps repeated labels (e.g. "City") distinct per step/page.
    fields.forEach(f => {
        f.saveKey = isCanonicalKey(f.label) ? f.label : buildScopedSaveKey(currentHeading, f.label);
    });

    return fields;
}

// ──────────────────────────────────────────────────────────
// 4. RENDER FIELD TABLE (editable, live-synced)
// ──────────────────────────────────────────────────────────
let currentFields = []; // reference to last rendered fields

function cloneFieldSnapshot(field) {
    return {
        label: field.label,
        value: field.value,
        required: !!field.required,
        empty: !!field.empty,
        saveKey: field.saveKey,
        options: Array.isArray(field.options) ? [...field.options] : null
    };
}

function isStepHistoryPreview() {
    return stepHistoryIndex >= 0 && stepHistoryIndex < stepHistory.length - 1;
}

function resetStepHistory() {
    stepHistory = [];
    stepHistoryIndex = -1;
    updateStepNavState();
}

function updateStepNavState() {
    const prevButton = document.getElementById('ea-step-prev');
    const nextButton = document.getElementById('ea-step-next');
    const position = document.getElementById('ea-step-position');
    const fillButton = document.getElementById('ea-fill-all-btn');
    const saveButton = document.getElementById('ea-save-btn');
    const hasHistory = stepHistory.length > 0;
    if (prevButton) prevButton.disabled = !hasHistory || stepHistoryIndex <= 0;
    if (nextButton) nextButton.disabled = !hasHistory || stepHistoryIndex >= stepHistory.length - 1;
    if (position) {
        position.textContent = hasHistory
            ? `Step ${stepHistoryIndex + 1}/${stepHistory.length}${stepHistoryIndex === stepHistory.length - 1 ? ' Live' : ''}`
            : 'Live';
    }
    const previewing = isStepHistoryPreview();
    if (fillButton) fillButton.disabled = previewing || !currentFields.length;
    if (saveButton) saveButton.disabled = previewing;
}

function recordStepSnapshot(heading, fields, savedAnswers) {
    if (!fields || !fields.length) return;
    if (isHiddenStepHeading(heading || '')) return;
    const normalizedHeading = normalizeStepHeading(heading || 'General');
    const signature = `${normalizedHeading}|${fields.map(field => field.saveKey || field.label).join('|')}`;
    const snapshot = {
        heading: normalizedHeading,
        signature,
        fields: fields.map(cloneFieldSnapshot),
        savedAnswers: Object.assign({}, savedAnswers || {})
    };
    const latest = stepHistory[stepHistory.length - 1];
    if (latest && latest.signature === signature) {
        stepHistory[stepHistory.length - 1] = snapshot;
    } else {
        if (stepHistoryIndex < stepHistory.length - 1) {
            stepHistory = stepHistory.slice(0, stepHistoryIndex + 1);
        }
        stepHistory.push(snapshot);
    }
    stepHistoryIndex = stepHistory.length - 1;
    updateStepNavState();
}

function renderHistoricalFieldsTable(snapshot) {
    currentFields = snapshot?.fields || [];
    const wrap = document.getElementById('ea-fields-wrap');
    if (!wrap) return;
    if (!snapshot || !snapshot.fields?.length) {
        wrap.innerHTML = '<p class="ea-dim">No step fields recorded yet.</p>';
        updateFillAllBtn([], {});
        updateStepNavState();
        return;
    }
    const savedAnswers = snapshot.savedAnswers || {};
    let html = `<table id="ea-fields-table">
      <thead><tr><th>Field</th><th>Value</th></tr></thead><tbody>`;
    snapshot.fields.forEach(field => {
        const star = field.required ? '<span class="req-star">*</span>' : '';
        const savedVal = resolveSavedValue(savedAnswers, field);
        const displayVal = field.value || (field.empty && savedVal ? savedVal : '');
        const emptyClass = field.empty && !savedVal ? ' row-empty' : '';
        const placeholder = (field.empty && savedVal) ? savedVal : '—';
        const isYesNo = field.options && field.options.filter(o => !/select an? option/i.test(o)).length === 2 &&
            field.options.some(o => /^yes$/i.test(o)) && field.options.some(o => /^no$/i.test(o));
        const valueCell = isYesNo
            ? `<select class="abby-val-select" disabled><option>${escHtml(displayVal || placeholder)}</option></select>`
            : `<input class="abby-val-input" value="${escHtml(displayVal)}" placeholder="${escHtml(placeholder)}" readonly>`;
        html += `<tr class="field-row${emptyClass}">
          <td class="field-key">${star}${escHtml(field.label)}</td>
          <td class="field-val">${valueCell}</td>
        </tr>`;
    });
    html += '</tbody></table>';
    wrap.innerHTML = html;
    updateFillAllBtn([], {});
    updateStepNavState();
}

function renderCurrentStepPanel(savedAnswers) {
    const statusText = document.getElementById('ea-current-action');
    if (isStepHistoryPreview()) {
        const snapshot = stepHistory[stepHistoryIndex];
        if (statusText) statusText.textContent = snapshot?.heading || 'Standing by for Easy Apply...';
        renderHistoricalFieldsTable(snapshot);
        return;
    }
    if (currentModal) {
        const fields = extractFormFields(currentModal);
        recordStepSnapshot(currentHeading, fields, savedAnswers || {});
        if (statusText) statusText.textContent = currentHeading || 'Standing by for Easy Apply...';
        renderFieldsTable(fields, savedAnswers || {});
        updateStepNavState();
        return;
    }
    if (stepHistory.length) {
        const snapshot = stepHistory[stepHistory.length - 1];
        if (statusText) statusText.textContent = `Last step: ${snapshot?.heading || 'Standing by for Easy Apply...'}`;
        renderHistoricalFieldsTable(snapshot);
        return;
    }
    const wrap = document.getElementById('ea-fields-wrap');
    if (statusText) statusText.textContent = 'Standing by for Easy Apply...';
    if (wrap) wrap.innerHTML = '';
    currentFields = [];
    updateFillAllBtn([], {});
    updateStepNavState();
}

function showPreviousStepSnapshot() {
    if (stepHistoryIndex <= 0) return;
    stepHistoryIndex -= 1;
    renderCurrentStepPanel();
}

function showNextStepSnapshot() {
    if (stepHistoryIndex >= stepHistory.length - 1) return;
    stepHistoryIndex += 1;
    if (stepHistoryIndex === stepHistory.length - 1 && currentModal && chrome.runtime?.id) {
        chrome.storage.local.get(['savedAnswers'], res => renderCurrentStepPanel(res.savedAnswers || {}));
        return;
    }
    renderCurrentStepPanel();
}

function renderFieldsTable(fields, savedAnswers) {
    currentFields = fields;
    const wrap = document.getElementById('ea-fields-wrap');
    if (!wrap) return;

    // Skip rebuild if user is actively editing an Abby input — don't interrupt typing
    if (wrap.contains(document.activeElement)) {
        fields.forEach(({ saveKey, value }) => { if (value) sessionFields.set(saveKey, value); });
        return;
    }

    // Accumulate into session map
    fields.forEach(({ saveKey, value }) => { if (value) sessionFields.set(saveKey, value); });

    let html = `<table id="ea-fields-table">
      <thead><tr><th>Field</th><th>Value</th></tr></thead><tbody>`;

    fields.forEach((field, i) => {
        const { label, value, required, empty, options } = field;
        const star = required ? '<span class="req-star">*</span>' : '';
        // Ground-truth value: modal value if filled, else saved answer as hint
        const savedVal = resolveSavedValue(savedAnswers, field);
        const displayVal = value || (empty && savedVal ? savedVal : '');
        const emptyClass = empty && !savedVal ? ' row-empty' : '';
        const placeholder = (empty && savedVal) ? savedVal : '—';

        // For Yes/No selects: show a mini dropdown in Abby to allow editing
        const isYesNo = options && options.filter(o => !/select an? option/i.test(o)).length === 2 &&
            options.some(o => /^yes$/i.test(o)) && options.some(o => /^no$/i.test(o));

        let valueCell;
        if (isYesNo) {
            const opts = options.filter(o => !/select an? option/i.test(o));
            const selOpts = opts.map(o =>
                `<option value="${escHtml(o)}"${displayVal.toLowerCase() === o.toLowerCase() ? ' selected' : ''}>${escHtml(o)}</option>`
            ).join('');
            valueCell = `<select class="abby-val-select" data-i="${i}"><option value="">—</option>${selOpts}</select>`;
        } else {
            valueCell = `<input class="abby-val-input" data-i="${i}" value="${escHtml(displayVal)}" placeholder="${escHtml(placeholder)}" title="${escHtml(displayVal)}">`;
        }

        html += `<tr class="field-row${emptyClass}" data-i="${i}">
          <td class="field-key">${star}${escHtml(label)}</td>
          <td class="field-val">${valueCell}</td>
        </tr>`;
    });

    html += `</tbody></table>`;
    wrap.innerHTML = html;

    // Wire Abby-input → Modal (text inputs)
    wrap.querySelectorAll('.abby-val-input').forEach(abbyInput => {
        const idx = parseInt(abbyInput.getAttribute('data-i'));
        const { input: modalInput, saveKey } = fields[idx] || {};
        abbyInput.addEventListener('input', () => {
            const v = abbyInput.value;
            sessionFields.set(saveKey, v);
            if (modalInput && modalInput.tagName !== 'SELECT') setInputValue(modalInput, v);
            abbyInput.closest('tr').classList.toggle('row-empty', !v);
        });
    });

    // Wire Abby-select → Modal (Yes/No dropdowns)
    wrap.querySelectorAll('.abby-val-select').forEach(abbySelect => {
        const idx = parseInt(abbySelect.getAttribute('data-i'));
        const { input: modalInput, saveKey } = fields[idx] || {};
        abbySelect.addEventListener('change', () => {
            const v = abbySelect.value;
            sessionFields.set(saveKey, v);
            if (modalInput) setInputValue(modalInput, v);
            abbySelect.closest('tr').classList.toggle('row-empty', !v);
        });
    });

    // Fill buttons
    wrap.querySelectorAll('.fill-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.getAttribute('data-i'));
            const field = fields[idx];
            const { input: modalInput } = field || {};
            const val = resolveSavedValue(savedAnswers, field);
            if (!val || !modalInput) return;
            setInputValue(modalInput, val);
            const abbyInput = wrap.querySelector(`.abby-val-input[data-i="${idx}"]`);
            if (abbyInput) { abbyInput.value = val; }
            btn.closest('tr').classList.remove('row-empty');
        });
    });

    // Modal → Abby live sync (for text/textarea inputs)
    fields.forEach(({ input: modalInput, saveKey }, i) => {
        if (!modalInput || syncedInputs.has(modalInput)) return;
        syncedInputs.set(modalInput, true);
        modalInput.addEventListener('input', () => {
            const v = getInputValue(modalInput) || '';
            sessionFields.set(saveKey, v);
            const abbyInput = wrap.querySelector(`.abby-val-input[data-i="${i}"]`);
            if (abbyInput && document.activeElement !== abbyInput) abbyInput.value = v;
            if (abbyInput) abbyInput.closest('tr').classList.toggle('row-empty', !v);
            // Also update select if it's a modal select → abby select
            const abbySelect = wrap.querySelector(`.abby-val-select[data-i="${i}"]`);
            if (abbySelect && document.activeElement !== abbySelect) abbySelect.value = v;
        });
    });

    // Update Fill button state
    updateFillAllBtn(fields, savedAnswers);
}

// ──────────────────────────────────────────────────────────
// 5. SAVE LOGIC
// ──────────────────────────────────────────────────────────
function gatherCurrentValues() {
    const wrap = document.getElementById('ea-fields-wrap');
    if (!wrap) return {};
    const out = {};
    wrap.querySelectorAll('.abby-val-input').forEach(inp => {
        const idx = parseInt(inp.getAttribute('data-i'));
        const field = currentFields[idx];
        if (field && inp.value.trim()) out[field.saveKey] = inp.value.trim();
    });
    wrap.querySelectorAll('.abby-val-select').forEach(sel => {
        const idx = parseInt(sel.getAttribute('data-i'));
        const field = currentFields[idx];
        if (field && sel.value.trim()) out[field.saveKey] = sel.value.trim();
    });
    return out;
}

function saveCurrentFields(andCallback) {
    if (!chrome.runtime?.id) return;
    if (!findEasyApplyModal()) {
        if (typeof andCallback === 'function') andCallback();
        return;
    }
    chrome.storage.local.get(['savedAnswers', 'savedAnswerGroups'], (res) => {
        const current = gatherCurrentValues();
        const saved = Object.assign({}, res.savedAnswers || {}, current);
        const groups = Object.assign({}, res.savedAnswerGroups || {});
        // Flush sessionFields
        sessionFields.forEach((v, k) => { if (v) saved[k] = v; });
        // Merge current fields into the heading group
        const grpKey = normalizeGroupHeading(currentHeading);
        if (grpKey) {
            const nextGroup = Object.assign({}, groups[grpKey] || {});
            Object.entries(nextGroup).forEach(([key]) => {
                const scoped = parseScopedSaveKey(key);
                if (scoped && scoped.heading && scoped.heading !== grpKey) delete nextGroup[key];
            });
            Object.assign(nextGroup, current);
            groups[grpKey] = nextGroup;
        }

        chrome.storage.local.set({ savedAnswers: saved, savedAnswerGroups: groups }, () => {
            const btn = document.getElementById('ea-save-btn');
            if (btn) { btn.textContent = 'Saved!'; setTimeout(() => { btn.textContent = 'Save'; }, 1500); }
            if (typeof andCallback === 'function') andCallback();
        });
    });
}

function hookNextButton(modal) {
    // Find advancement buttons: Next / Continue / Review / Submit
    const btns = collectFromShadow(modal, 'button');
    btns.forEach(btn => {
        if (hookedBtns.has(btn)) return;
        const label = (btn.getAttribute('aria-label') || btn.innerText || '').toLowerCase();
        if (/next|continue|review|submit/.test(label)) {
            hookedBtns.add(btn);
            btn.addEventListener('click', () => {
                saveCurrentFields();
                if (!autoApplyRunning && pendingResumeAutoApplyUntil && Date.now() <= pendingResumeAutoApplyUntil) {
                    setTimeout(() => {
                        if (autoApplyRunning) return;
                        if (!findEasyApplyModal()) return;
                        pendingResumeAutoApplyUntil = 0;
                        startAutoApply();
                    }, 700);
                }
            }, { capture: true });
        }
    });
}

function updateFillAllBtn(fields, savedAnswers) {
    const btn = document.getElementById('ea-fill-all-btn');
    if (!btn) return;
    // Always enabled when there are fields (button fills from saved answers)
    const hasFields = fields.length > 0;
    btn.disabled = !hasFields;
    btn.classList.toggle('ea-btn-fill-active', hasFields);
}

function fillAllMatchedFields() {
    if (isStepHistoryPreview()) return;
    if (!chrome.runtime?.id) return;
    chrome.storage.local.get(['savedAnswers'], async (res) => {
        const saved = res.savedAnswers || {};
        const wrap = document.getElementById('ea-fields-wrap');
        if (!wrap) return;

        let filled = 0;
        for (let i = 0; i < currentFields.length; i++) {
            const field = currentFields[i];
            const { saveKey, input: modalInput, radioGroup } = field;
            const val = resolveSavedValue(saved, field);
            if (!val) continue;

            if (radioGroup && currentModal) {
                // Find the radio button whose visible label matches the saved value
                const target = radioGroup.find(r =>
                    getRadioOptionLabel(r, currentModal).toLowerCase() === val.toLowerCase()
                );
                if (target) {
                    target.click();
                    ['change', 'input'].forEach(e => target.dispatchEvent(new Event(e, { bubbles: true })));
                    // Update Abby’s display
                    const abbyInput = wrap.querySelector(`.abby-val-input[data-i="${i}"]`);
                    if (abbyInput) { abbyInput.value = val; abbyInput.closest('tr').classList.remove('row-empty'); }
                    filled++;
                }
                continue;
            }

            if (!modalInput) continue;
            setInputValue(modalInput, val);
            await chooseAutocompleteOption(modalInput, val);
            sessionFields.set(saveKey, val);
            const abbyInput = wrap.querySelector(`.abby-val-input[data-i="${i}"]`);
            const abbySelect = wrap.querySelector(`.abby-val-select[data-i="${i}"]`);
            if (abbyInput) { abbyInput.value = val; abbyInput.closest('tr').classList.remove('row-empty'); }
            if (abbySelect) { abbySelect.value = val; abbySelect.closest('tr').classList.remove('row-empty'); }
            filled++;
        }

        const btn = document.getElementById('ea-fill-all-btn');
        if (btn) {
            btn.textContent = filled ? `Filled ${filled}` : 'Fill';
            setTimeout(() => { btn.textContent = 'Fill'; }, 1800);
        }
    });
}

// ──────────────────────────────────────────────────────────
// 6. INFO VIEW (inside floating panel)
// ──────────────────────────────────────────────────────────
function renderInfoView() {
    if (!chrome.runtime?.id) return;
    chrome.storage.local.get(['savedAnswers'], (res) => {
        const saved = res.savedAnswers || {};
        const wrap = document.getElementById('ea-info-wrap');
        if (!wrap) return;
        const keys = Object.keys(saved);
        if (keys.length === 0) {
            wrap.innerHTML = '<p class="ea-dim">No saved answers yet.<br>Use "Save Answers" in the Step view.</p>';
            return;
        }

        let html = `<table id="ea-info-table"><tbody>`;
        keys.forEach((k, i) => {
            html += `<tr>
              <td class="info-q">${escHtml(k)}</td>
              <td><input class="info-val-input" data-key="${escHtml(k)}" value="${escHtml(saved[k])}"></td>
              <td><button class="del-btn" data-key="${escHtml(k)}">✕</button></td>
            </tr>`;
        });
        html += `</tbody></table>`;
        wrap.innerHTML = html;

        wrap.querySelectorAll('.del-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const k = btn.getAttribute('data-key');
                btn.closest('tr').remove();
                chrome.storage.local.get(['savedAnswers'], r => {
                    const sa = Object.assign({}, r.savedAnswers || {});
                    delete sa[k];
                    chrome.storage.local.set({ savedAnswers: sa });
                });
            });
        });
    });
}

function saveInfoEdits() {
    const rows = document.querySelectorAll('#ea-info-table .info-val-input');
    const updated = {};
    rows.forEach(inp => {
        const k = inp.getAttribute('data-key');
        if (k && inp.value.trim()) updated[k] = inp.value.trim();
    });
    chrome.storage.local.set({ savedAnswers: updated }, () => {
        const msg = document.getElementById('ea-info-msg');
        if (msg) { msg.textContent = '✅ Saved!'; setTimeout(() => { msg.textContent = ''; }, 1500); }
    });
}

function clearAllSaved() {
    if (!confirm('Clear all saved answers?')) return;
    chrome.storage.local.set({ savedAnswers: {} }, () => renderInfoView());
}

// ──────────────────────────────────────────────────────────
// 6.5 AUTO APPLY
// ──────────────────────────────────────────────────────────
function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getConfiguredDelayMs() {
    const ranges = abbyParams.auto?.delayRangesMs || [{ min: 300, max: 1200 }];
    const selected = ranges[Math.floor(Math.random() * ranges.length)] || { min: 300, max: 1200 };
    const minMs = Math.max(0, parseInt(selected.min, 10) || 300);
    const maxMs = Math.max(minMs, parseInt(selected.max, 10) || 1200);
    return Math.round(minMs + (Math.random() * (maxMs - minMs)));
}

function getLinkedInRetryDelayMs() {
    return Math.max(getConfiguredDelayMs(), Math.round((Number(abbyParams.linkedin?.minClickDelaySeconds) || 0.8) * 1000));
}

async function ensureActionDelay() {
    const elapsed = Date.now() - lastAutoActionAt;
    const delay = getConfiguredDelayMs();
    if (elapsed < delay) await wait(delay - elapsed);
}

async function waitForEasyApplyModal(timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const modal = findEasyApplyModal();
        if (modal) return modal;
        await wait(250);
    }
    return null;
}

function findEasyApplyButton() {
    const roots = [
        document.querySelector('.jobs-search__job-details--container'),
        document.querySelector('.jobs-details'),
        document.querySelector('.scaffold-layout__detail'),
        document
    ].filter(Boolean);

    for (const root of roots) {
        const buttons = collectFromShadow(root, 'button');
        const found = buttons.find(btn => {
            const label = (btn.getAttribute('aria-label') || btn.innerText || btn.textContent || '').trim();
            const classes = btn.className || '';
            return !btn.disabled && (/easy apply/i.test(label) || /jobs-apply-button/i.test(classes));
        });
        if (found) return found;
    }
    return null;
}

function findAdvanceButton(modal) {
    const buttons = collectFromShadow(modal, 'button').filter(btn => !btn.disabled);
    const priorities = [/submit/i, /review/i, /next/i, /continue/i];
    for (const rx of priorities) {
        const found = buttons.find(btn => rx.test(btn.getAttribute('aria-label') || btn.innerText || ''));
        if (found) return found;
    }
    return null;
}

function findApplyErrorMessage() {
    const nodes = collectFromShadow(document, '[role="alert"], .artdeco-inline-feedback, .artdeco-toast-item');
    for (const node of nodes) {
        const text = clean(node.innerText || '');
        if (text && /error while trying to submit your application|please try again/i.test(text)) return text;
    }
    return '';
}

function getFieldLiveValue(field) {
    if (!field) return '';
    if (field.radioGroup && currentModal) {
        const checked = field.radioGroup.find(r => r.checked);
        return checked ? getRadioOptionLabel(checked, currentModal) : '';
    }
    return getInputValue(field.input) || '';
}

async function fillFieldFromSaved(field, savedAnswers) {
    const value = resolveSavedValue(savedAnswers, field);
    if (!value) return '';

    if (field.radioGroup && currentModal) {
        const target = field.radioGroup.find(r =>
            getRadioOptionLabel(r, currentModal).toLowerCase() === value.toLowerCase()
        );
        if (target) {
            target.click();
            ['change', 'input'].forEach(e => target.dispatchEvent(new Event(e, { bubbles: true })));
            sessionFields.set(field.saveKey, value);
            return value;
        }
        return '';
    }

    if (field.input) {
        setInputValue(field.input, value);
        await chooseAutocompleteOption(field.input, value);
        sessionFields.set(field.saveKey, value);
        return value;
    }
    return '';
}

async function fillPendingFieldsFromSaved(fields, savedAnswers) {
    for (const field of fields) {
        if (getFieldLiveValue(field)) continue;
        await fillFieldFromSaved(field, savedAnswers);
    }
}

async function clickButton(button, repeatCount = 1) {
    for (let i = 0; i < repeatCount; i++) {
        await ensureActionDelay();
        button.click();
        lastAutoActionAt = Date.now();
        if (i < repeatCount - 1) await wait(getConfiguredDelayMs());
    }
}

async function openEasyApplyModal(button, maxAttempts = 1) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await ensureActionDelay();
        button.click();
        lastAutoActionAt = Date.now();
        const modal = await waitForEasyApplyModal(4500);
        if (modal) return modal;
        if (attempt < maxAttempts - 1) await wait(getLinkedInRetryDelayMs());
    }
    return findEasyApplyModal();
}

function getActiveJobCard() {
    const activeCard = document.querySelector('.jobs-search-results-list__list-item--active, .jobs-search-results__list-item--active, .job-card-list--is-active, .job-card-container--is-active, .jobs-search-results__list-item[aria-current="true"]');
    if (activeCard) return activeCard;
    const activeLink = document.querySelector('.job-card-list__title--link');
    return activeLink ? activeLink.closest('li, .job-card-container') : null;
}

function getJobLabelFromCard(card) {
    if (!card) return '';
    const title = card.querySelector('.job-card-list__title--link, .job-card-list__title, .job-card-container__link, .artdeco-entity-lockup__title');
    const company = card.querySelector('.artdeco-entity-lockup__subtitle, .job-card-container__company-name, .artdeco-entity-lockup__caption');
    const roleText = (title?.textContent || '').trim();
    const companyText = (company?.textContent || '').trim();
    return [companyText, roleText].filter(Boolean).join(' - ') || roleText || companyText || 'Current job';
}

function getCurrentJobLabel() {
    const detailRole = document.querySelector('.job-details-jobs-unified-top-card__job-title, .t-24.job-details-jobs-unified-top-card__job-title, .jobs-unified-top-card__job-title');
    const detailCompany = document.querySelector('.job-details-jobs-unified-top-card__company-name a, .job-details-jobs-unified-top-card__company-name, .jobs-unified-top-card__company-name a, .jobs-unified-top-card__company-name');
    const roleText = (detailRole?.textContent || '').trim();
    const companyText = (detailCompany?.textContent || '').trim();
    if (roleText || companyText) return [companyText, roleText].filter(Boolean).join(' - ');
    return getJobLabelFromCard(getActiveJobCard()) || 'Current job';
}

function getCurrentJobParts() {
    const detailRole = document.querySelector('.job-details-jobs-unified-top-card__job-title, .t-24.job-details-jobs-unified-top-card__job-title, .jobs-unified-top-card__job-title');
    const detailCompany = document.querySelector('.job-details-jobs-unified-top-card__company-name a, .job-details-jobs-unified-top-card__company-name, .jobs-unified-top-card__company-name a, .jobs-unified-top-card__company-name');
    const role = (detailRole?.textContent || '').trim();
    const company = (detailCompany?.textContent || '').trim();
    if (role || company) return { company, role };
    const card = getActiveJobCard();
    const title = card?.querySelector('.job-card-list__title--link, .job-card-list__title, .job-card-container__link, .artdeco-entity-lockup__title');
    const companyNode = card?.querySelector('.artdeco-entity-lockup__subtitle, .job-card-container__company-name, .artdeco-entity-lockup__caption');
    return { company: (companyNode?.textContent || '').trim(), role: (title?.textContent || '').trim() };
}

function formatApplyStatus(detail = '') {
    const parts = getCurrentJobParts();
    const lines = [];
    if (parts.company) lines.push(parts.company);
    if (parts.role) lines.push(`* ${parts.role}`);
    if (detail) lines.push(detail);
    return lines.join('\n').trim() || detail || 'Ready.';
}

function getVisibleJobCards() {
    return Array.from(document.querySelectorAll('li[data-occludable-job-id], .jobs-search-results__list-item, .job-card-container'))
        .filter(card => /Easy Apply/i.test(card.textContent || ''));
}

function findNextEligibleJobCard() {
    const cards = getVisibleJobCards();
    const activeCard = getActiveJobCard();
    const activeIndex = activeCard ? cards.findIndex(card => card === activeCard || card.contains(activeCard) || activeCard.contains(card)) : -1;
    const ordered = activeIndex >= 0 ? [...cards.slice(activeIndex + 1), ...cards.slice(0, activeIndex)] : cards;
    return ordered.find(card =>
        card.getAttribute('data-abby-blocked') !== 'true' &&
        card.getAttribute('data-abby-processed') !== 'true' &&
        card.getAttribute('data-abby-applied') !== 'true' &&
        card.getAttribute('data-abby-submitted') !== 'true'
    ) || null;
}

async function focusJobCard(card) {
    if (!card) return false;
    card.scrollIntoView({ block: 'center', behavior: 'smooth' });
    await wait(250);
    const clickable = card.querySelector('.job-card-list__title--link, a[href*="/jobs/view/"], .job-card-container__link, .job-card-container--clickable') || card;
    await ensureActionDelay();
    clickable.click();
    lastAutoActionAt = Date.now();
    currentHeading = getJobLabelFromCard(card) || currentHeading;
    await wait(250);
    highlightCurrentJobCard();
    setAutoApplyDataset('running', formatApplyStatus('Queued'), currentHeading);
    await wait(getConfiguredDelayMs());
    return true;
}

function markCurrentJobTested() {
    const card = getActiveJobCard();
    if (!card || card.getAttribute('data-abby-processed') === 'true') return;
    card.setAttribute('data-abby-processed', 'true');
    card.style.opacity = '0.72';
    card.style.filter = 'grayscale(0.15)';
    card.style.backgroundColor = 'rgba(212, 218, 228, 0.28)';
    card.style.borderLeft = '3px solid rgba(193, 200, 212, 0.95)';
    card.style.transition = 'opacity 0.2s, filter 0.2s, background-color 0.2s, border-left-color 0.2s';
}

function markCurrentJobApplied() {
    const card = getActiveJobCard();
    if (!card) return;
    if (card.getAttribute('data-abby-focused') === 'true') return;
    if (card.getAttribute('data-abby-submitted') === 'true') return; // Don't grey out successfully submitted

    card.removeAttribute('data-abby-focused');
    card.setAttribute('data-abby-applied', 'true');
    card.style.opacity = '0.62';
    card.style.filter = 'grayscale(0.55)';
    card.style.backgroundColor = 'rgba(172, 178, 188, 0.22)';
    card.style.borderLeft = '3px solid rgba(134, 141, 153, 0.92)';
}

function markCurrentJobApplying() {
    const card = getActiveJobCard();
    if (!card || card.getAttribute('data-abby-applying') === 'true') return;
    card.removeAttribute('data-abby-focused');
    card.setAttribute('data-abby-applying', 'true');
    card.style.opacity = '1';
    card.style.filter = '';
    card.style.backgroundColor = 'rgba(255, 243, 163, 0.45)';
    card.style.borderLeft = '4px solid rgba(255, 193, 7, 0.98)';
    card.style.boxShadow = '0 0 10px rgba(255, 193, 7, 0.3) inset';
}

function clearCurrentJobApplying() {
    document.querySelectorAll('[data-abby-applying="true"]').forEach(card => {
        card.removeAttribute('data-abby-applying');
        if (card.getAttribute('data-abby-submitted') !== 'true' &&
            card.getAttribute('data-abby-applied') !== 'true' &&
            card.getAttribute('data-abby-blocked') !== 'true' &&
            card.getAttribute('data-abby-processed') !== 'true') {
            card.style.backgroundColor = '';
            card.style.borderLeft = '';
            card.style.boxShadow = '';
        }
    });
}

function markCurrentJobSubmitted() {
    const card = getActiveJobCard();
    if (!card) return;
    card.removeAttribute('data-abby-applying');
    card.removeAttribute('data-abby-focused');
    card.setAttribute('data-abby-submitted', 'true');
    card.style.opacity = '1';
    card.style.filter = '';
    card.style.backgroundColor = 'rgba(164, 235, 172, 0.45)';
    card.style.borderLeft = '4px solid rgba(76, 175, 80, 0.98)';
    card.style.boxShadow = '0 0 10px rgba(76, 175, 80, 0.3) inset';
}

function highlightCurrentJobCard() {
    document.querySelectorAll('[data-abby-focused="true"]').forEach(card => {
        card.removeAttribute('data-abby-focused');
        if (card.getAttribute('data-abby-applied') === 'true' || 
            card.getAttribute('data-abby-processed') === 'true' || 
            card.getAttribute('data-abby-blocked') === 'true' ||
            card.getAttribute('data-abby-applying') === 'true' ||
            card.getAttribute('data-abby-submitted') === 'true') return;
        card.style.backgroundColor = '';
        card.style.borderLeft = '';
        card.style.boxShadow = '';
    });
    const card = getActiveJobCard();
    if (!card) return;
    if (card.getAttribute('data-abby-blocked') === 'true' || 
        card.getAttribute('data-abby-processed') === 'true' || 
        card.getAttribute('data-abby-applied') === 'true' ||
        card.getAttribute('data-abby-applying') === 'true' ||
        card.getAttribute('data-abby-submitted') === 'true') {
        return;
    }
    card.setAttribute('data-abby-focused', 'true');
    card.style.opacity = '1';
    card.style.filter = '';
    card.style.backgroundColor = 'rgba(137, 196, 255, 0.24)';
    card.style.borderLeft = '4px solid rgba(42, 124, 211, 0.95)';
    card.style.boxShadow = '0 0 10px rgba(42, 124, 211, 0.25) inset';
}

function findDiscardButton() {
    return Array.from(document.querySelectorAll('button, [role="button"]')).find(button => {
        const label = (button.innerText || button.textContent || button.getAttribute('aria-label') || '').trim();
        return /discard|exit/i.test(label);
    }) || null;
}

async function dismissEasyApplyForTest(modal) {
    const dismissButton = findDismissButton(modal);
    if (!dismissButton) {
        if (isCurrentJobAlreadyApplied()) return;
        throw new Error('Could not find the Easy Apply close button.');
    }
    await clickButton(dismissButton, 1);
    await wait(getConfiguredDelayMs());
    const discardButton = findDiscardButton();
    if (discardButton) {
        await clickButton(discardButton, 1);
        await wait(getConfiguredDelayMs());
    }
}

async function scrollActiveJobDetail() {
    const detailPane = document.querySelector('.jobs-search__job-details--container, .scaffold-layout__detail, .jobs-details, .jobs-search-two-pane__job-details-pane');
    if (!detailPane) return;
    const durationMs = Math.round((1 + Math.random()) * 1000);
    const startedAt = Date.now();
    let direction = 1;
    while (Date.now() - startedAt < durationMs) {
        const delta = Math.max(60, Math.round(detailPane.clientHeight * 0.22));
        detailPane.scrollTop = Math.max(0, detailPane.scrollTop + (delta * direction));
        if (detailPane.scrollTop <= 0 || detailPane.scrollTop + detailPane.clientHeight >= detailPane.scrollHeight - 2) direction *= -1;
        await wait(220);
    }
}

async function scrollEasyApplyReview(modal) {
    if (!modal) return;
    const scroller = findInShadow(modal, '.jobs-easy-apply-content, .artdeco-modal__content, .pb4') || modal.querySelector('.jobs-easy-apply-content, .artdeco-modal__content, .pb4') || modal;
    const durationMs = Math.round((1 + Math.random()) * 1000);
    const startedAt = Date.now();
    while (Date.now() - startedAt < durationMs) {
        const delta = Math.max(80, Math.round(scroller.clientHeight * 0.32));
        scroller.scrollTop = Math.min(scroller.scrollHeight, scroller.scrollTop + delta);
        await wait(220);
    }
}

function saveCurrentFieldsAsync() {
    return new Promise(resolve => saveCurrentFields(resolve));
}

async function closeSubmittedModalIfPresent() {
    await wait(Math.max(600, getConfiguredDelayMs()));
    let modal = findEasyApplyModal() || document.querySelector('.artdeco-modal');
    if (!modal) return;
    
    await wait(Math.max(900, getConfiguredDelayMs()));
    
    const doneButtons = Array.from(modal.querySelectorAll('button, span')).filter(b => {
        const t = (b.innerText || '').trim();
        return t === 'Done' || t === 'Dismiss';
    });
    if (doneButtons.length > 0) {
        await clickButton(doneButtons[0], 1);
        await wait(Math.max(900, getConfiguredDelayMs()));
        modal = findEasyApplyModal() || document.querySelector('.artdeco-modal');
        if (!modal) return;
    }

    const dismissButton = findDismissButton(modal);
    if (dismissButton) {
        await clickButton(dismissButton, 1);
        await wait(Math.max(900, getConfiguredDelayMs()));
        modal = findEasyApplyModal();
        if (!modal) return;
    }
    const discardButton = findDiscardButton();
    if (discardButton) {
        await clickButton(discardButton, 1);
        await wait(Math.max(900, getConfiguredDelayMs()));
    }
    const stillModal = findEasyApplyModal() || document.querySelector('.artdeco-modal');
    if (stillModal) {
        const backdrop = document.querySelector('.artdeco-modal-overlay') || document.body;
        backdrop.click();
        await wait(Math.max(600, getConfiguredDelayMs()));
    }
}

async function advanceToNextEligibleJob() {
    if (!autoApplyRunning) return;

    await scrollJobResultsList();
    if (!autoApplyRunning) return;

    const nextCard = findNextEligibleJobCard();
    if (!nextCard) {
        autoApplyRunning = false;
        setAutoApplyDataset('completed', formatApplyStatus('No more eligible Easy Apply jobs found.'), currentHeading);
        return;
    }
    await focusJobCard(nextCard);
    currentHeading = getCurrentJobLabel();
    highlightCurrentJobCard();
    if (isCurrentJobAlreadyApplied()) {
        markCurrentJobApplied();
        await advanceToNextEligibleJob();
        return;
    }
    setAutoApplyDataset('running', formatApplyStatus('Opening Easy Apply'), currentHeading);
    await scrollActiveJobDetail();
    let modal = findEasyApplyModal();
    if (!modal) {
        const easyApplyButton = findEasyApplyButton();
        if (!easyApplyButton) {
            if (!autoApplyRunning) return;
            autoApplyRunning = false;
            setAutoApplyDataset('blocked', formatApplyStatus('Could not find Easy Apply button'), currentHeading);
            return;
        }
        if (!autoApplyRunning) return;
        modal = await openEasyApplyModal(easyApplyButton, Math.max(1, abbyParams.linkedin?.clickCount || 1));
    }
    if (!modal) {
        if (!autoApplyRunning) return;
        autoApplyRunning = false;
        setAutoApplyDataset('blocked', formatApplyStatus('Easy Apply did not open'), currentHeading);
        return;
    }
    if (!autoApplyRunning) return;
    runAutoApplyLoop();
}

async function submitCurrentApplication(modal, advanceButton) {
    await saveCurrentFieldsAsync();
    await scrollEasyApplyReview(modal);
    ensureConfirmCheckboxesChecked(modal);

    const followSpan = Array.from(modal.querySelectorAll('label')).find(el => /follow.*company/i.test(el.textContent) || /follow/i.test(el.textContent));
    if (followSpan) {
        const checkbox = followSpan.closest('label')?.querySelector('input') || document.getElementById(followSpan.getAttribute('for') || '');
        if (checkbox && checkbox.checked) {
            followSpan.scrollIntoView({block: 'center', behavior: 'smooth'});
            await wait(400);
            followSpan.click();
            await wait(400);
        }
    }

    await clickButton(advanceButton, 1);
    await closeSubmittedModalIfPresent();
    markCurrentJobSubmitted();
    await logApplicationSuccess();
    await advanceToNextEligibleJob();
}

let applySchedule = {
    running: false,
    mode: 'duty', // 'duty' or 'paused'
    endTime: 0
};

async function logApplicationSuccess() {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const jobId = urlParams.get('currentJobId') || document.querySelector('.job-card-container--active')?.dataset.jobId || 'unknown';
        const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
        
        let company = 'Unknown';
        let role = 'Unknown';
        let loc = 'Unknown';
        
        const activeCard = document.querySelector('.job-card-container--active');
        if (activeCard) {
            role = (activeCard.querySelector('.job-card-list__title') || {}).innerText || role;
            company = (activeCard.querySelector('.job-card-container__primary-description') || {}).innerText || company;
            loc = (activeCard.querySelector('.job-card-container__metadata-item') || {}).innerText || loc;
        } else {
            const detailPane = document.querySelector('.job-view-layout');
            if (detailPane) {
                role = (detailPane.querySelector('h1') || {}).innerText || role;
                company = (detailPane.querySelector('.job-details-jobs-unified-top-card__company-name') || {}).innerText || company;
            }
        }
        
        const descText = document.getElementById('job-details')?.innerText || '';
        function extractSection(text, headers) {
             for(let h of headers) {
                 let idx = text.toLowerCase().indexOf(h.toLowerCase());
                 if (idx !== -1) {
                     let block = text.substring(idx + h.length).trim();
                     let nextHeader = block.search(/\n\n[A-Z]/);
                     if (nextHeader !== -1) block = block.substring(0, nextHeader);
                     return block.replace(/\n/g, ' ').substring(0, 1000).trim();
                 }
             }
             return '';
        }
        
        const logEntry = {
            id: jobId,
            date: dateStr,
            status: 'applied',
            company: company.trim(),
            role: role.trim(),
            location: loc.trim(),
            about: extractSection(descText, ['About Us', 'About the company']),
            whoWeHiring: extractSection(descText, ["Who We're Hiring", "Who We Are Looking For", "About You"]),
            whatYouDo: extractSection(descText, ["What You'll Do", "What You Will Do", "Your Role"]),
            requirements: extractSection(descText, ["What We're Looking For", "Responsibilities", "Required Qualifications", "Requirements", "Qualifications"]),
            whyJoin: extractSection(descText, ["Why Join Us", "Why Join", "Perks", "Benefits"]),
            timestamp: Date.now()
        };
        
        chrome.storage.local.get(['abbyAppLogs'], (res) => {
            const logs = res.abbyAppLogs || [];
            logEntry.index = logs.length + 1;
            logs.push(logEntry);
            chrome.storage.local.set({ abbyAppLogs: logs }, () => {
                updateApplyStatsUI();
                if (chrome.runtime?.id) chrome.runtime.sendMessage({ type: 'abby:export-logs-csv' });
            });
        });
    } catch(e) { console.error('Abby log error:', e); }
}

async function handleApplyAction() {
    if (abbyApplyMode === 'manual') {
        const easyApplyButton = findEasyApplyButton();
        if (!easyApplyButton) {
            setAutoApplyDataset('blocked', formatApplyStatus('Could not find Easy Apply button'), currentHeading);
            return { ok: false, state: 'blocked' };
        }
        await openEasyApplyModal(easyApplyButton, Math.max(1, abbyParams.linkedin?.clickCount || 1));
        setAutoApplyDataset('running', formatApplyStatus('Manual mode: Easy Apply opened.'), currentHeading);
        chrome.storage.local.get(['abbyApplyStats'], (res) => {
            const stats = Object.assign({ auto: 0, manual: 0 }, res.abbyApplyStats || {});
            stats.manual += 1;
            chrome.storage.local.set({ abbyApplyStats: stats });
        });
        return { ok: true, state: 'manual-opened' };
    }
    return startAutoApply();
}

async function startAutoApply() {
    if (autoApplyRunning) {
        autoApplyStopRequested = true;
        autoApplyRunning = false;
        applySchedule.running = false;
        setAutoApplyDataset('paused', formatApplyStatus('Paused'), currentHeading);
        return { ok: true, state: 'paused' };
    }
    pendingManualEasyApplyAutoStartUntil = 0;
    pendingResumeAutoApplyUntil = 0;
    autoApplyRunning = true;
    chrome.storage.local.get(['abbyApplyStats'], (res) => {
        const stats = Object.assign({ auto: 0, manual: 0 }, res.abbyApplyStats || {});
        stats.auto += 1;
        chrome.storage.local.set({ abbyApplyStats: stats });
    });
    autoApplyStopRequested = false;
    applySchedule.running = true;
    applySchedule.mode = 'duty';
    applySchedule.endTime = Date.now() + 10 * 60 * 1000;
    autoLoopSignature = '';
    autoLoopRepeats = 0;
    switchView('apply');
    currentHeading = getCurrentJobLabel();
    highlightCurrentJobCard();
    setAutoApplyDataset('running', formatApplyStatus('Starting'), currentHeading);
    try {
        await refreshParams(false);
        syncApplyAvailability();
        currentHeading = getCurrentJobLabel();
        highlightCurrentJobCard();
        if (isCurrentJobAlreadyApplied()) {
            markCurrentJobApplied();
            await advanceToNextEligibleJob();
            return { ok: true, state: 'running' };
        }
        setAutoApplyDataset('running', formatApplyStatus('Opening Easy Apply'), currentHeading);
        await scrollActiveJobDetail();
        let modal = findEasyApplyModal();
        if (!modal) {
            const easyApplyButton = findEasyApplyButton();
            if (!easyApplyButton) {
                autoApplyRunning = false;
                setAutoApplyDataset('blocked', formatApplyStatus('Could not find Easy Apply button'), currentHeading);
                return { ok: false, state: 'blocked' };
            }
            modal = await openEasyApplyModal(easyApplyButton, Math.max(1, abbyParams.linkedin?.clickCount || 1));
        }
        if (!modal) {
            autoApplyRunning = false;
            setAutoApplyDataset('blocked', formatApplyStatus('Easy Apply did not open'), currentHeading);
            return { ok: false, state: 'blocked' };
        }
        runAutoApplyLoop();
        return { ok: true, state: 'running' };
    } catch (err) {
        autoApplyRunning = false;
        setAutoApplyDataset('error', formatApplyStatus(err.message || String(err)), currentHeading);
        return { ok: false, state: 'error', error: err.message || String(err) };
    }
}

function resetAutoApplySession(options = {}) {
    const { preserveStepHistory = false, message = 'Ready.' } = options;
    autoApplyRunning = false;
    autoApplyStopRequested = false;
    applySchedule.running = false;
    autoLoopSignature = '';
    autoLoopRepeats = 0;
    pendingManualEasyApplyAutoStartUntil = 0;
    pendingResumeAutoApplyUntil = 0;
    currentModal = null;
    if (!preserveStepHistory) resetStepHistory();
    setAutoApplyDataset('idle', formatApplyStatus(message), '');
    updateApplyButton();
}

function requestAutoApplyFromManualEasyApply() {
    pendingManualEasyApplyAutoStartUntil = Date.now() + 20000;
    currentHeading = getCurrentJobLabel();
    highlightCurrentJobCard();
    setAutoApplyDataset('running', formatApplyStatus('Easy Apply clicked'), currentHeading);
}

function maybeAutoStartFromManualEasyApply(modal) {
    if (!modal || autoApplyRunning) return;
    if (!pendingManualEasyApplyAutoStartUntil || Date.now() > pendingManualEasyApplyAutoStartUntil) return;
    pendingManualEasyApplyAutoStartUntil = 0;
    currentHeading = getCurrentJobLabel();
    highlightCurrentJobCard();
    startAutoApply();
}

function isPotentialEasyApplyTrigger(node) {
    if (!(node instanceof Element)) return false;
    const text = clean(node.innerText || node.textContent || node.getAttribute('aria-label') || node.getAttribute('aria-describedby') || '');
    const classes = String(node.className || '');
    const dataTest = String(node.getAttribute('data-test-button') || '');
    return /easy apply/i.test(text)
        || /jobs-apply-button/i.test(classes)
        || /easy-apply/i.test(dataTest);
}

function findEasyApplyTriggerFromEvent(event) {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    for (const entry of path) {
        if (!(entry instanceof Element)) continue;
        const candidate = entry.closest?.('button, [role="button"], a, div');
        if (candidate && isPotentialEasyApplyTrigger(candidate)) return candidate;
        if (isPotentialEasyApplyTrigger(entry)) return entry;
    }
    const target = event.target instanceof Element ? event.target.closest('button, [role="button"], a, div') : null;
    return target && isPotentialEasyApplyTrigger(target) ? target : null;
}

function handlePotentialEasyApplyClick(event) {
    const target = findEasyApplyTriggerFromEvent(event);
    if (!target) return;
    if (autoApplyRunning) return;
    requestAutoApplyFromManualEasyApply();
}


function enforceEasyApplyModalFocus(modal) {
    if (!modal) return;
    modal.setAttribute('tabindex', '-1');
    modal.focus();
    if (outsideModalBlockerActive) return;
    outsideModalBlockerActive = true;
    document.documentElement.dataset.abbyLockModal = 'true';
}

function releaseEasyApplyModalFocus() {
    outsideModalBlockerActive = false;
    delete document.documentElement.dataset.abbyLockModal;
}

function runAutoApplyLoop() {
    if (!autoApplyRunning || !chrome.runtime?.id) return;
    const applyError = findApplyErrorMessage();
    if (applyError) {
        autoApplyRunning = false;
        switchView('step');
        setAutoApplyDataset('error', applyError, currentHeading);
        return;
    }
    const modal = findEasyApplyModal();
    if (!modal) {
        releaseEasyApplyModalFocus();
        resetAutoApplySession({ preserveStepHistory: true, message: 'Easy Apply flow completed or modal closed.' });
        return;
    }

    currentModal = modal;
    enforceEasyApplyModalFocus(modal);
    const headingEl = findInShadow(modal, 'h3') || findInShadow(modal, 'h2') || modal.querySelector('h3') || modal.querySelector('h2');
    currentHeading = normalizeStepHeading(headingEl ? headingEl.innerText.trim() : currentHeading || 'General');
    setAutoApplyDataset('running', isHiddenStepHeading(currentHeading) ? 'Applying hidden step' : `Applying ${currentHeading}`, currentHeading);

    chrome.storage.local.get(['savedAnswers'], async (res) => {
        const savedAnswers = res.savedAnswers || {};
        const fields = extractFormFields(modal);
        await fillPendingFieldsFromSaved(fields, savedAnswers);
        ensureConfirmCheckboxesChecked(modal);
        if (activeView === 'step') renderCurrentStepPanel(savedAnswers);
        else renderFieldsTable(fields, savedAnswers);

        const missing = [];
        for (const field of fields) {
            const liveValue = getFieldLiveValue(field);
            if (field.required && !liveValue) missing.push(field.label);
        }

        if (missing.length) {
            autoApplyRunning = false;
            pendingResumeAutoApplyUntil = Date.now() + 30000;
            switchView('step');
            setAutoApplyDataset('blocked', formatApplyStatus(`Missing required answers: ${missing.slice(0, 3).join(', ')}`), currentHeading);
            return;
        }

        const advanceButton = findAdvanceButton(modal);
        if (!advanceButton) {
            autoApplyRunning = false;
            switchView('step');
            setAutoApplyDataset('blocked', formatApplyStatus('No Next, Review, or Submit button found.'), currentHeading);
            return;
        }

        const signature = `${currentHeading}|${fields.map(field => field.saveKey || field.label).join('|')}|${(advanceButton.getAttribute('aria-label') || advanceButton.innerText || '').trim()}`;
        if (signature === autoLoopSignature) {
            autoLoopRepeats += 1;
        } else {
            autoLoopSignature = signature;
            autoLoopRepeats = 0;
        }
        if (autoLoopRepeats >= 2) {
            autoApplyRunning = false;
            switchView('step');
            setAutoApplyDataset('blocked', formatApplyStatus('LinkedIn kept the same step open; stopping auto apply.'), currentHeading);
            return;
        }

        const advanceLabel = (advanceButton.getAttribute('aria-label') || advanceButton.innerText || '').trim();
        const isSubmit = /submit/i.test(advanceLabel);

        if (isSubmit) {
            try {
                await submitCurrentApplication(modal, advanceButton);
            } catch (err) {
                autoApplyRunning = false;
                switchView('step');
                setAutoApplyDataset('error', formatApplyStatus(err.message || 'Submit failed'), currentHeading);
            }
            return;
        }

        saveCurrentFields(async () => {
            await clickButton(advanceButton, 1);
            await wait(getConfiguredDelayMs());
            runAutoApplyLoop();
        });
    });
}

// ──────────────────────────────────────────────────────────
// 7. POLLING
// ──────────────────────────────────────────────────────────
let jobFilterPoller = null; // polls specifically for marking bad jobs

function updateApplyStatsUI() {
    chrome.storage.local.get(['abbyAppLogs'], (res) => {
        const logs = res.abbyAppLogs || [];
        const total = logs.length;
        const todayStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
        const todayCount = logs.filter(l => l.date === todayStr).length;
        const oneHourAgo = Date.now() - 3600 * 1000;
        const hourCount = logs.filter(l => l.timestamp && l.timestamp >= oneHourAgo).length;

        const tEl = document.getElementById('ea-metric-total');
        if (tEl) tEl.innerText = total;
        const dEl = document.getElementById('ea-metric-today');
        if (dEl) dEl.innerText = todayCount;
        const hEl = document.getElementById('ea-metric-hour');
        if (hEl) hEl.innerText = `${hourCount}/150`;

        if (hourCount >= 150) {
            if (applySchedule.running) {
                applySchedule.running = false;
                autoApplyRunning = false;
                setAutoApplyDataset('stopped', formatApplyStatus('Hourly limit of 150 reached.'));
            }
        }
    });
}

function checkUrlAndManageUI() {
    if (!chrome.runtime?.id) { clearInterval(modalPoller); clearInterval(urlChecker); clearInterval(jobFilterPoller); return; }
    chrome.storage.local.get(['settings', 'abbyParams'], (res) => {
        if (chrome.runtime.lastError) return;
        const enabled = res.settings && res.settings.autopilotEnabled !== false;
        const targetUrl = /linkedin\.com\/jobs\/(search|view)/.test(window.location.href);
        const ui = document.getElementById('abby-floating-ui');
        if (res.abbyParams) abbyParams = normalizeParams(res.abbyParams);

        if (enabled && targetUrl) {
            injectFloatingUI();
            if (!modalPoller) modalPoller = setInterval(pollForModalLogic, 1000);
            if (!jobFilterPoller) jobFilterPoller = setInterval(markBlockedJobs, 1000);
            syncApplyAvailability();
            updateApplyStatsUI();
            
            if (applySchedule.running) {
                const now = Date.now();
                const remaining = Math.max(0, applySchedule.endTime - now);
                const mins = Math.floor(remaining / 60000);
                const secs = Math.floor((remaining % 60000) / 1000).toString().padStart(2, '0');
                const display = document.getElementById('ea-apply-countdown');
                if (display) {
                    display.style.display = 'block';
                    if (applySchedule.mode === 'duty') {
                        display.style.color = '#4CAF50';
                        display.innerText = `Running (${mins}:${secs})`;
                        if (remaining === 0) {
                            applySchedule.mode = 'paused';
                            applySchedule.endTime = now + 5 * 60 * 1000;
                        }
                    } else {
                        display.style.color = '#ff9800';
                        display.innerText = `Cooldown (${mins}:${secs})`;
                        if (remaining === 0) {
                            applySchedule.mode = 'duty';
                            applySchedule.endTime = now + 10 * 60 * 1000;
                            if (!findEasyApplyModal()) {
                                advanceToNextEligibleJob();
                            }
                        }
                    }
                }
            } else {
                const display = document.getElementById('ea-apply-countdown');
                if (display) display.style.display = 'none';
            }
            
        } else {
            if (ui) ui.remove();
            if (modalPoller) { clearInterval(modalPoller); modalPoller = null; }
            if (jobFilterPoller) { clearInterval(jobFilterPoller); jobFilterPoller = null; }
        }
    });
}

function pollForModalLogic() {
    if (!chrome.runtime?.id) return;
    const modal = findEasyApplyModal();
    const statusText = document.getElementById('ea-current-action');
    const wrap = document.getElementById('ea-fields-wrap');
    const stepTab = document.getElementById('ea-tab-step');
    
    highlightCurrentJobCard();
    syncApplyAvailability();

    if (modal) {
        markCurrentJobApplying();
        if (stepTab) {
            stepTab.disabled = false;
            stepTab.classList.remove('ea-tab-disabled');
        }
        currentModal = modal;
    enforceEasyApplyModalFocus(modal);
        const headingEl = findInShadow(modal, 'h3') || findInShadow(modal, 'h2') ||
            modal.querySelector('h3') || modal.querySelector('h2');
        currentHeading = normalizeStepHeading(headingEl ? headingEl.innerText.trim() : 'General');
        if (statusText) statusText.textContent = currentHeading;
        maybeAutoStartFromManualEasyApply(modal);
        if (autoApplyRunning) return;

        hookNextButton(modal);

        // Skip useless headings — show truly nothing (user just clicks Next)
        if (isHiddenStepHeading(currentHeading)) {
            if (statusText) statusText.textContent = 'Hidden step';
            if (wrap) wrap.innerHTML = '';
            updateFillAllBtn([], {});
            return;
        }

        // Extra manual check: If this is the Resume step and the ONLY inputs are 
        // the native LinkedIn file upload buttons (which we skip anyway), show nothing.
        // If there are actual textareas (like a Cover letter box), keep the table visible.
        const fields = extractFormFields(modal);
        if (/^resume$/i.test(currentHeading) && fields.length === 0) {
            if (wrap) wrap.innerHTML = '';
            updateFillAllBtn([], {});
            return;
        }

        chrome.storage.local.get(['savedAnswers'], (res) => {
            if (chrome.runtime.lastError) return;
            recordStepSnapshot(currentHeading, fields, res.savedAnswers || {});
            if (activeView === 'step') renderCurrentStepPanel(res.savedAnswers || {});
        });
    } else {
        clearCurrentJobApplying();
        const wasInStepView = activeView === 'step';
        const hadModal = !!currentModal;
        const shouldPreserveLastStep = stepHistory.length > 0;
        
        if (stepTab) {
            // 'step' is strictly only available when easy apply window opens (per user request)
            // though we might want to keep it enabled if there is history to review.
            // But the user said "strictly only available when easy apply window opens".
            stepTab.disabled = true;
            stepTab.classList.add('ea-tab-disabled');
        }

        currentModal = null;
        let didUserHalt = false;
        if (autoApplyRunning && autoApplyStopRequested === false && !findApplyErrorMessage()) {
            didUserHalt = true; // The modal disappeared without setting completed/error
        }
        
        resetAutoApplySession({ preserveStepHistory: shouldPreserveLastStep, message: didUserHalt ? 'Auto Apply halted by user.' : 'Ready to re-run Apply.' });
        if (didUserHalt) {
             console.log('[Abby] Admin stopped due to user closing modal manually.');
        }
        
        // If modal was just closed and we were on the step tab, go back to apply tab
        if (hadModal && wasInStepView) {
            switchView('apply');
        }

        if (statusText) statusText.textContent = shouldPreserveLastStep
            ? `Last step: ${stepHistory[stepHistory.length - 1]?.heading || 'Standing by for Easy Apply...'}`
            : 'Standing by for Easy Apply...';
        if (wrap) wrap.innerHTML = '';
        updateFillAllBtn([], {});  // disable Fill when modal is closed
        if (activeView === 'step' && chrome.runtime?.id) {
            chrome.storage.local.get(['savedAnswers'], (res) => {
                if (chrome.runtime.lastError) return;
                renderCurrentStepPanel(res.savedAnswers || {});
            });
        } else {
            updateStepNavState();
        }
    }
}

function markBlockedJobs() {
    chrome.storage.local.get(['abbyParams'], (res) => {
        if (res.abbyParams) abbyParams = normalizeParams(res.abbyParams);
        const keywords = abbyParams.ignore?.keywords || [];
        const customRegex = compileCustomRegexList();
        const caseSensitive = false;

        const jobCards = document.querySelectorAll('.jobs-search-results__list-item, .job-card-container, [data-occludable-job-id]');

        jobCards.forEach(card => {
            const titleEl = card.querySelector('.job-card-list__title, .job-card-container__title, .artdeco-entity-lockup__title');
            if (!titleEl && !card.textContent) return;
            const rawText = titleEl ? titleEl.textContent : card.textContent;
            const fullText = caseSensitive ? rawText : rawText.toLowerCase();
            const isBlocked = keywords.some(k => {
                const needle = caseSensitive ? String(k || '').trim() : String(k || '').trim().toLowerCase();
                return needle && fullText.includes(needle);
            }) || customRegex.some(rx => rx.test(rawText || ''));

            card.querySelectorAll('[data-abby-skip-badge="true"]').forEach(node => node.remove());

            if (isBlocked) {
                card.setAttribute('data-abby-blocked', 'true');
                card.removeAttribute('data-abby-focused');
                card.style.opacity = '0.35';
                card.style.transition = 'opacity 0.2s';
                card.style.backgroundColor = 'rgba(184, 184, 184, 0.18)';
                card.style.borderLeft = '3px solid rgba(214, 98, 98, 0.9)';
                card.style.boxShadow = '';

                const badge = document.createElement('span');
                badge.innerText = ' ❌ SKIP';
                badge.setAttribute('data-abby-skip-badge', 'true');
                badge.style.color = '#ff4d4f';
                badge.style.fontWeight = 'bold';
                badge.style.fontSize = '12px';
                badge.style.marginLeft = '6px';
                badge.style.backgroundColor = 'rgba(255,255,255,0.8)';
                badge.style.padding = '2px 4px';
                badge.style.borderRadius = '4px';

                if (titleEl) titleEl.appendChild(badge);
                else card.prepend(badge);
            } else {
                if (card.getAttribute('data-abby-blocked') === 'true') {
                    card.removeAttribute('data-abby-blocked');
                    card.style.opacity = '';
                    card.style.backgroundColor = '';
                    card.style.borderLeft = '';
                }
            }
        });
    });
}

// ──────────────────────────────────────────────────────────
// 8. UTIL
// ──────────────────────────────────────────────────────────
function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function handleDevTaskUpdate() {}

if (chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message?.type === 'abby:start-auto-apply') {
            startAutoApply().then(sendResponse);
            return true;
        }
        if (message?.type === 'abby:set-theme') {
            applyTheme(message.theme);
            sendResponse({ ok: true });
            return true;
        }
        if (message?.type === 'abby:update-dev-tasks') {
            handleDevTaskUpdate(message.tasks);
            sendResponse({ ok: true });
            return true;
        }
        return false;
    });
}

window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data?.type === 'ABBY_START_AUTO_APPLY') {
        const urlObj = new URL(window.location.href);
        const autoOpt = urlObj.searchParams.get('abby_auto');

        if (autoOpt === '1') {
           // We are coming from a new search page that has abby_auto=1 set in the URL because the user initiated it
           urlObj.searchParams.delete('abby_auto');
           window.history.replaceState({}, '', urlObj.toString());
           console.log("[Abby] New search page loaded, waiting for user click before auto applying.");
           return;
        }

        startAutoApply();
    }
});
document.addEventListener('click', handlePotentialEasyApplyClick, true);
document.addEventListener('pointerup', handlePotentialEasyApplyClick, true);
document.addEventListener('mousedown', (event) => {
    if (!outsideModalBlockerActive) return;
    const modal = findEasyApplyModal();
    if (!modal) return;
    if (!modal.contains(event.target)) {
        event.preventDefault();
        event.stopPropagation();
        modal.focus();
    }
}, true);

// ──────────────────────────────────────────────────────────
// 9. BOOTSTRAP
// ──────────────────────────────────────────────────────────

// Seed canonical default answers into chrome.storage (won’t overwrite existing user answers)
function seedCanonicalDefaults() {
    if (!chrome.runtime?.id) return;
    chrome.storage.local.get(['savedAnswers'], (res) => {
        if (chrome.runtime.lastError) return;
        const saved = Object.assign({}, res.savedAnswers || {});
        let dirty = false;
        Object.entries(CANONICAL_DEFAULTS).forEach(([key, val]) => {
            if (!saved[key]) { saved[key] = val; dirty = true; }
        });
        if (dirty) chrome.storage.local.set({ savedAnswers: saved });
    });
}

urlChecker = setInterval(checkUrlAndManageUI, 1000);
setTimeout(seedCanonicalDefaults, 1500); // run once after extension settles
setAutoApplyDataset('idle', 'Ready.', '');
refreshParams(false);

