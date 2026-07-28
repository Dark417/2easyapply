let allProfiles = [];
let activeProfileId = null;
let globalSettings = { autopilotEnabled: false };
let eveParams = {
    searches: ['California, United States'],
    selectedSearch: 'California, United States',
    ignore: { enabled: true, caseSensitive: false, keywords: ['founding', 'machine learning'] },
    linkedin: { filters: ['Easy Apply'], clickCount: 2, minClickDelaySeconds: 0.8 },
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
const STEP_ORDER = [
    'Contact Info',
    'Resume',
    'Voluntary Self Identification',
    'Additional Questions',
    'Work Experience',
    'Education',
    'Review',
    'General',
    'Other'
];
const IGNORED_FIELD_PATTERNS = [
    /mark (this )?job as (a )?top choice/i,
    /^resume$/i
];

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function confirm(msg, callback) {
    const overlay = document.getElementById('confirm-overlay');
    document.getElementById('confirm-msg').textContent = msg;
    overlay.classList.add('show');
    const ok = document.getElementById('confirm-ok');
    const cancel = document.getElementById('confirm-cancel');
    const close = (confirmed) => {
        overlay.classList.remove('show');
        ok.replaceWith(ok.cloneNode(true));
        cancel.replaceWith(cancel.cloneNode(true));
        if (confirmed) callback();
    };
    document.getElementById('confirm-ok').addEventListener('click', () => close(true), { once: true });
    document.getElementById('confirm-cancel').addEventListener('click', () => close(false), { once: true });
}

function parseLines(text) {
    return Array.from(new Set(String(text || '')
        .split(/\r?\n|,/)
        .map(v => v.trim())
        .filter(Boolean)));
}

function loadSearchConfig() {
    chrome.runtime.sendMessage({ type: 'eve:get-params' }, (res) => {
        if (res && res.ok && res.params) {
            eveParams = res.params;
        }
        renderSearchConfig();
    });
}

function initSettings() {
    chrome.storage.local.get(['profiles', 'activeProfileId', 'settings', 'savedAnswerGroups', 'savedAnswers', 'eveParams', 'eveTheme', 'eveApplicationRecords'], (res) => {
        if (res.eveTheme === 'light') document.body.classList.add('light-theme');
        globalSettings = res.settings || { autopilotEnabled: false };
        eveParams = res.eveParams || eveParams;

        if (res.profiles && res.profiles.length > 0) {
            allProfiles = res.profiles;
            activeProfileId = res.activeProfileId || allProfiles[0].id;
        } else {
            const p = { id: uid(), name: 'Default' };
            allProfiles = [p];
            activeProfileId = p.id;
        }

        renderProfileList();
        loadActiveProfile();
        const cleaned = cleanupStoredAnswerData(res.savedAnswerGroups || {}, res.savedAnswers || {});
        chrome.storage.local.set({
            savedAnswerGroups: cleaned.groups,
            savedAnswers: cleaned.answers
        });
        renderGroups(cleaned.groups, cleaned.answers);
        renderSearchConfig();
        loadSearchConfig();
        renderAppliedJobs(res.eveApplicationRecords || []);
    });

    const themeToggle = document.getElementById('themeToggle');
    chrome.storage.local.get(['eveTheme'], (res) => {
        themeToggle.checked = (res.eveTheme || 'dark') === 'dark';
    });
    themeToggle.addEventListener('change', function () {
        const nextTheme = this.checked ? 'dark' : 'light';
        document.body.classList.toggle('light-theme', nextTheme === 'light');
        chrome.storage.local.set({ eveTheme: nextTheme });
        chrome.runtime.sendMessage({ type: 'eve:set-theme', theme: nextTheme });
    });

    const ignoreFeatureToggle = document.getElementById('ignoreFeatureToggle');
    if (ignoreFeatureToggle) {
        ignoreFeatureToggle.addEventListener('change', function () {
            if (eveParams.ignore) eveParams.ignore.enabled = this.checked;
            chrome.runtime.sendMessage({ type: 'eve:update-params', params: eveParams });
        });
    }

    document.querySelectorAll('.content-tab').forEach(button => {
        button.addEventListener('click', () => setContentPane(button.dataset.pane));
    });
    const requestedPane = String(location.hash || '').replace(/^#/, '').trim();
    if (requestedPane === 'search' || requestedPane === 'info' || requestedPane === 'applied') setContentPane(requestedPane);
    wireSectionControls(document);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSettings);
} else {
    initSettings();
}

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes.eveTheme) {
        document.body.classList.toggle('light-theme', changes.eveTheme.newValue === 'light');
        const themeToggle = document.getElementById('themeToggle');
        if (themeToggle) themeToggle.checked = changes.eveTheme.newValue === 'dark';
    }
    if (changes.eveApplicationRecords) {
        renderAppliedJobs(changes.eveApplicationRecords.newValue || []);
    }
});

// ── Export / Import ────────────────────────────────────────
const EXPORT_KEYS = [
    'savedAnswers', 'savedAnswerGroups', 'savedRegexAnswers', 'workdaySavedAnswers',
    'eveParams', 'eveApplyMode', 'eveApplyStats', 'eveAppLogs',
    'appliedJobsLog', 'eveApplicationRecords', 'settings', 'profiles', 'activeProfileId', 'profileData',
    'eveTheme'
];

// ── Legacy backup compatibility (abby -> eve rename, 2026-07-26) ───────────────
// Backups written before the rename are marked `_abbyBackup` and use `abbyXxx` key names. The
// importer must keep accepting them forever, mapping the old names forward — otherwise the rename
// silently orphans every backup the user already has. Exports are always written in the new format.
const LEGACY_BACKUP_MARKER = '_abbyBackup';
const BACKUP_MARKER = '_eveBackup';

// Old key -> new key. Only the keys that were ever exported need mapping.
function mapLegacyBackupKey(key) {
    return /^abby[A-Z_]/.test(key) ? 'eve' + key.slice(4) : key;
}

function isRawStorageDump(data) {
    if (!data || Array.isArray(data) || typeof data !== 'object') return false;
    const recognised = Object.keys(data)
        .map(mapLegacyBackupKey)
        .filter(key => EXPORT_KEYS.includes(key));
    return recognised.length >= 2;
}

function isBackupFile(data) {
    return Boolean(data && (data[BACKUP_MARKER] || data[LEGACY_BACKUP_MARKER] || isRawStorageDump(data)));
}

// Returns { restore, legacy, mapped }. Backups and raw storage dumps intentionally preserve every
// non-metadata storage key so runtime answers and future settings are not lost to a stale allowlist.
function normalizeBackup(data) {
    const legacy = Boolean(!data[BACKUP_MARKER]
        && (data[LEGACY_BACKUP_MARKER] || Object.keys(data).some(key => mapLegacyBackupKey(key) !== key)));
    const restore = {};
    const mapped = [];
    Object.keys(data).forEach((rawKey) => {
        if (rawKey.startsWith('_')) return; // metadata markers
        const key = mapLegacyBackupKey(rawKey);
        restore[key] = data[rawKey];
        if (key !== rawKey) mapped.push(`${rawKey}->${key}`);
    });
    return { restore, legacy, mapped };
}

document.getElementById('export-data-btn').addEventListener('click', () => {
    chrome.storage.local.get(null, (data) => {
        const blob = new Blob([JSON.stringify({ [BACKUP_MARKER]: true, _version: 2, _date: new Date().toISOString(), ...data }, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `eve-backup-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        const el = document.getElementById('save-status');
        el.textContent = 'Exported!';
        setTimeout(() => { el.textContent = ''; }, 2000);
    });
});

document.getElementById('import-data-btn').addEventListener('click', () => {
    document.getElementById('import-file-input').click();
});

document.getElementById('import-file-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        try {
            const data = JSON.parse(ev.target.result);
            if (!isBackupFile(data)) {
                alert('This does not look like an Eve backup file.');
                return;
            }
            const { restore, legacy, mapped } = normalizeBackup(data);
            if (!Object.keys(restore).length) {
                alert('That backup file contained no recognised data to import.');
                return;
            }
            chrome.storage.local.set(restore, () => {
                const el = document.getElementById('save-status');
                el.textContent = legacy
                    ? `Imported legacy pre-Eve backup (${mapped.length} keys renamed). Reloading...`
                    : 'Imported! Reloading...';
                setTimeout(() => location.reload(), 1200);
            });
        } catch (err) {
            alert('Failed to parse backup file: ' + err.message);
        }
    };
    reader.readAsText(file);
    e.target.value = '';
});

function setContentPane(name) {
    if (name !== 'info' && name !== 'search' && name !== 'applied') name = 'info';
    document.querySelectorAll('.content-tab').forEach(button => {
        button.classList.toggle('active', button.dataset.pane === name);
    });
    document.querySelectorAll('.content-pane').forEach(pane => {
        pane.classList.toggle('active', pane.id === `pane-${name}`);
    });
}

// ── Applied Jobs (unified cross-platform record: T1 LinkedIn, T2 Workday, T3 Greenhouse/Ashby,
// T5 Indeed). Populated from `eveApplicationRecords`, written by background.js's
// 'eve:record-applied-job' handler. Reverse-chronological, every column visible. See AGENTS.md
// "Applied Jobs Log". ─────────────────────────────────────────────────────────────────────────
function formatAppliedAt(record) {
    const when = record.appliedAt ? new Date(record.appliedAt) : (record.timestamp ? new Date(record.timestamp) : null);
    if (!when || Number.isNaN(when.getTime())) return record.appliedAt || '';
    return when.toLocaleString();
}

function renderAppliedJobs(records) {
    const container = document.getElementById('applied-jobs-container');
    const badge = document.getElementById('applied-count-badge');
    if (!container) return;
    const list = Array.isArray(records) ? records.slice() : [];
    list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    if (badge) badge.textContent = String(list.length);

    if (!list.length) {
        container.innerHTML = '<div class="empty-state">No applications yet.</div>';
        return;
    }

    const rows = list.map(record => `
        <tr>
            <td>${escHtml(formatAppliedAt(record))}</td>
            <td><span class="platform-pill">${escHtml(record.platform || 'unknown')}</span></td>
            <td>${escHtml(record.company || '')}</td>
            <td>${escHtml(record.title || '')}</td>
            <td>${escHtml(record.location || '')}</td>
            <td>${escHtml(record.mode || 'auto')}</td>
            <td>${record.url ? `<a href="${escHtml(record.url)}" target="_blank" rel="noopener noreferrer">Open</a>` : ''}</td>
        </tr>`).join('');

    container.innerHTML = `
        <div class="applied-table-wrap">
            <table class="applied-table">
                <thead>
                    <tr>
                        <th>Date/Time</th>
                        <th>Platform</th>
                        <th>Company</th>
                        <th>Title</th>
                        <th>Location</th>
                        <th>Mode</th>
                        <th>Link</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
}

function renderProfileList() {
    const ul = document.getElementById('profile-list');
    ul.innerHTML = '';
    allProfiles.forEach(p => {
        const li = document.createElement('li');
        li.className = 'profile-item' + (p.id === activeProfileId ? ' active' : '');
        li.dataset.id = p.id;
        li.innerHTML = `<span class="profile-name-text">${escHtml(p.name || 'Untitled')}</span>
                        <button class="del-profile-btn" data-id="${p.id}" title="Delete">X</button>`;

        li.querySelector('.profile-name-text').addEventListener('click', () => {
            flushActiveProfile();
            activeProfileId = p.id;
            renderProfileList();
            loadActiveProfile();
        });

        li.querySelector('.del-profile-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            if (allProfiles.length <= 1) { alert('You must keep at least one profile.'); return; }
            confirm(`Delete profile "${p.name}"?`, () => {
                allProfiles = allProfiles.filter(x => x.id !== p.id);
                if (activeProfileId === p.id) activeProfileId = allProfiles[0].id;
                renderProfileList();
                loadActiveProfile();
            });
        });

        ul.appendChild(li);
    });

    document.getElementById('add-profile-btn').style.display = allProfiles.length >= 10 ? 'none' : '';
}

document.getElementById('add-profile-btn').addEventListener('click', () => {
    if (allProfiles.length >= 10) return;
    flushActiveProfile();
    const p = { id: uid(), name: `Profile ${allProfiles.length + 1}` };
    allProfiles.push(p);
    activeProfileId = p.id;
    renderProfileList();
    loadActiveProfile();
    document.getElementById('profileName').focus();
});

function flushActiveProfile() {
    const p = allProfiles.find(x => x.id === activeProfileId);
    if (!p) return;
    p.name = document.getElementById('profileName').value.trim() || p.name;
    globalSettings.autopilotEnabled = document.getElementById('autopilot').checked;
}

function loadActiveProfile() {
    const p = allProfiles.find(x => x.id === activeProfileId) || allProfiles[0];
    if (!p) return;
    document.getElementById('profileName').value = p.name || '';
    document.getElementById('autopilot').checked = globalSettings.autopilotEnabled !== false;
}

function renderSearchConfig() {
    document.getElementById('searchText').value = eveParams.selectedSearch || '';
    document.getElementById('ignoreKeywords').value = ((eveParams.ignore && eveParams.ignore.keywords) || []).join(', ');
    document.getElementById('ignoreFeatureToggle').checked = eveParams.ignore?.enabled !== false;
    document.getElementById('clickCount').value = eveParams.linkedin?.clickCount || 2;
    document.getElementById('minClickDelaySeconds').value = eveParams.linkedin?.minClickDelaySeconds || 0.8;
    const d = eveParams.auto?.delaysSec || {};
    const setDelay = (id, val, fallback) => {
        const el = document.getElementById(id);
        if (el) el.value = val ?? fallback;
    };
    setDelay('delayNextJobMin', d.nextJobItem?.min, 0.4);
    setDelay('delayNextJobMax', d.nextJobItem?.max, 1.1);
    setDelay('delayEasyApplyMin', d.clickEasyApply?.min, 0.4);
    setDelay('delayEasyApplyMax', d.clickEasyApply?.max, 1.2);
    setDelay('delayEasyScrollMin', d.easyApplyScroll?.min, 0.6);
    setDelay('delayEasyScrollMax', d.easyApplyScroll?.max, 1.6);
    setDelay('delayInputMin', d.inputFields?.min, 0.2);
    setDelay('delayInputMax', d.inputFields?.max, 0.7);
    setDelay('delayNextStepMin', d.nextStep?.min, 0.5);
    setDelay('delayNextStepMax', d.nextStep?.max, 1.3);
    setDelay('delaySubmitScrollMin', d.submitPageScroll?.min, 1.0);
    setDelay('delaySubmitScrollMax', d.submitPageScroll?.max, 2.0);
    setDelay('delayCloseSubmitMin', d.closeSubmitPage?.min, 0.6);
    setDelay('delayCloseSubmitMax', d.closeSubmitPage?.max, 1.4);
    document.getElementById('limitPerMinute').value = eveParams.auto?.rateLimits?.perMinute || 5;
    document.getElementById('limitPerHour').value = eveParams.auto?.rateLimits?.perHour || 30;
    document.getElementById('limitPerDay').value = eveParams.auto?.rateLimits?.perDay || 200;
    document.getElementById('restEvery').value = eveParams.auto?.burstRest?.every || 5;
    document.getElementById('restMinSeconds').value = eveParams.auto?.burstRest?.minSeconds || 5;
    document.getElementById('restMaxSeconds').value = eveParams.auto?.burstRest?.maxSeconds || 10;
    document.getElementById('customRegex').value = (eveParams.customRegex || []).join('\n');

    renderSettingsSearchList(eveParams.searches || [], eveParams.selectedSearch || '');
}

function renderSettingsSearchList(searches, selected) {
    const list = document.getElementById('settingsSearchList');
    if (!list) return;
    list.innerHTML = searches.map(s => `
        <div class="sl-item ${s === selected ? 'selected' : ''}" data-val="${s.replace(/"/g, '&quot;')}">
            <span class="sl-drag" draggable="true" title="Drag to reorder" style="cursor:grab; padding-right:8px; color:#888;">☰</span>
            <div class="sl-text">${s.replace(/"/g, '&quot;').replace(/</g, '&lt;')}</div>
            <div class="sl-del" title="Remove" data-val="${s.replace(/"/g, '&quot;')}">✕</div>
        </div>
    `).join('');
    
    list.querySelectorAll('.sl-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.classList.contains('sl-del')) {
                const val = e.target.dataset.val;
                eveParams.searches = eveParams.searches.filter(x => x !== val);
                if (eveParams.selectedSearch === val) {
                    eveParams.selectedSearch = eveParams.searches[0] || '';
                    document.getElementById('searchText').value = eveParams.selectedSearch;
                }
                renderSettingsSearchList(eveParams.searches, eveParams.selectedSearch);
                return;
            }
            document.getElementById('searchText').value = item.dataset.val;
            list.querySelectorAll('.sl-item').forEach(i => i.classList.remove('selected'));
            item.classList.add('selected');
        });
    });

    let dragSrc = null;
    list.querySelectorAll('.sl-drag').forEach(handle => {
        const item = handle.closest('.sl-item');
        handle.addEventListener('dragstart', (e) => {
            dragSrc = item;
            e.dataTransfer.effectAllowed = 'move';
            item.style.opacity = '0.5';
        });
        item.addEventListener('dragenter', (e) => {
            if (dragSrc && dragSrc !== item) item.style.borderTop = '2px solid #A18CD1';
        });
        item.addEventListener('dragover', (e) => { e.preventDefault(); return false; });
        item.addEventListener('dragleave', (e) => { item.style.borderTop = ''; });
        item.addEventListener('drop', (e) => {
            e.stopPropagation();
            item.style.borderTop = '';
            if (dragSrc && dragSrc !== item) {
                const parent = item.parentNode;
                const siblings = Array.from(parent.children);
                const tgtIdx = siblings.indexOf(item);
                if (siblings.indexOf(dragSrc) < tgtIdx) parent.insertBefore(dragSrc, item.nextSibling);
                else parent.insertBefore(dragSrc, item);
                
                eveParams.searches = Array.from(parent.children).map(node => node.dataset.val);
            }
            return false;
        });
        handle.addEventListener('dragend', () => { if (dragSrc) dragSrc.style.opacity = '1'; dragSrc = null; });
    });
}

function gatherSearchConfig() {
    const typedSearch = document.getElementById('searchText').value.trim();
    const searchItems = Array.from(document.querySelectorAll('#settingsSearchList .sl-item')).map(item => item.dataset.val);
    const searches = searchItems.length > 0 ? searchItems : (eveParams.searches || []);
    if (typedSearch && !searches.includes(typedSearch)) searches.unshift(typedSearch);
    return {
        searches,
        selectedSearch: typedSearch || searches[0] || '',
        ignore: {
            enabled: document.getElementById('ignoreFeatureToggle').checked,
            caseSensitive: false,
            keywords: parseLines(document.getElementById('ignoreKeywords').value)
        },
        linkedin: {
            filters: ['Easy Apply'],
            clickCount: Math.max(1, parseInt(document.getElementById('clickCount').value, 10) || 2),
            minClickDelaySeconds: Math.max(0, Number(document.getElementById('minClickDelaySeconds').value) || 0.8)
        },
        auto: {
            delaysSec: {
                nextJobItem: readDelayRange('delayNextJobMin', 'delayNextJobMax', 0.4, 1.1),
                clickEasyApply: readDelayRange('delayEasyApplyMin', 'delayEasyApplyMax', 0.4, 1.2),
                easyApplyScroll: readDelayRange('delayEasyScrollMin', 'delayEasyScrollMax', 0.6, 1.6),
                inputFields: readDelayRange('delayInputMin', 'delayInputMax', 0.2, 0.7),
                nextStep: readDelayRange('delayNextStepMin', 'delayNextStepMax', 0.5, 1.3),
                submitPageScroll: readDelayRange('delaySubmitScrollMin', 'delaySubmitScrollMax', 1.0, 2.0),
                closeSubmitPage: readDelayRange('delayCloseSubmitMin', 'delayCloseSubmitMax', 0.6, 1.4)
            },
            rateLimits: {
                perMinute: Math.max(1, parseInt(document.getElementById('limitPerMinute').value, 10) || 5),
                perHour: Math.max(parseInt(document.getElementById('limitPerMinute').value, 10) || 5, parseInt(document.getElementById('limitPerHour').value, 10) || 30),
                perDay: Math.max(parseInt(document.getElementById('limitPerHour').value, 10) || 30, parseInt(document.getElementById('limitPerDay').value, 10) || 200)
            },
            burstRest: {
                every: Math.max(1, parseInt(document.getElementById('restEvery').value, 10) || 5),
                minSeconds: Math.max(0, Number(document.getElementById('restMinSeconds').value) || 5),
                maxSeconds: Math.max(Number(document.getElementById('restMinSeconds').value) || 5, Number(document.getElementById('restMaxSeconds').value) || 10)
            }
        },
        customRegex: Array.from(new Set(String(document.getElementById('customRegex').value || '')
            .split(/\r?\n/).map(v => v.trim()).filter(Boolean)))
    };
}

function readDelayRange(minId, maxId, fallbackMin, fallbackMax) {
    const min = Math.max(0, Number(document.getElementById(minId)?.value) || fallbackMin);
    const max = Math.max(min, Number(document.getElementById(maxId)?.value) || fallbackMax);
    return { min: Number(min.toFixed(2)), max: Number(max.toFixed(2)) };
}

function normalizeGroupKey(name) {
    const value = String(name || '').trim();
    if (!value) return 'General';
    if (/^contact info$/i.test(value)) return 'Contact Info';
    if (/^resume$/i.test(value)) return 'Resume';
    if (/^home address$/i.test(value)) return 'Contact Info';
    if (/^work experience$/i.test(value)) return 'Work Experience';
    if (/^education$/i.test(value)) return 'Education';
    if (/^additional questions?$/i.test(value)) return 'Additional Questions';
    if (/^screening questions?$/i.test(value)) return 'Contact Info';
    if (/^voluntary self identification$/i.test(value)) return 'Voluntary Self Identification';
    if (/^review$/i.test(value)) return 'Review';
    if (/^sort by$/i.test(value)) return '';
    if (/^apply to\b/i.test(value)) return 'Apply';
    if (/mark (this )?job as (a )?top choice/i.test(value) || /^top choice$/i.test(value)) return '';
    return value;
}

function parseScopedKey(rawKey) {
    const match = String(rawKey || '').match(/^\[([^\]]+)\]\s+(.+)$/);
    if (!match) return null;
    return {
        heading: normalizeGroupKey(match[1]),
        label: match[2].trim()
    };
}

function normalizeDisplayLabel(label) {
    let out = String(label || '').trim();
    if (!out) return out;
    // Collapse direct duplicated labels such as "City City" -> "City"
    const doubled = out.match(/^(.+?)\s+\1$/i);
    if (doubled && doubled[1]) out = doubled[1].trim();
    return out;
}

function shouldIgnoreField(label, group) {
    const normalized = String(label || '').trim();
    if (!normalized) return true;
    if (IGNORED_FIELD_PATTERNS.some(rx => rx.test(normalized))) return true;
    if (/^resume$/i.test(normalized) && /^resume$/i.test(String(group || ''))) return true;
    return false;
}

function preferredGroupForLabel(label) {
    const normalized = String(label || '').trim();
    if (!normalized) return '';
    if (/^website$/i.test(normalized)) return 'Contact Info';
    if (/^located in /i.test(normalized)) return 'Contact Info';
    return '';
}

function cleanupStoredAnswerData(groups, answers) {
    const nextGroups = {};
    const nextAnswers = Object.assign({}, answers || {});
    const removeKeys = new Set();

    Object.entries(groups || {}).forEach(([groupName, entries]) => {
        const normalizedGroup = normalizeGroupKey(groupName);
        if (!normalizedGroup) {
            Object.keys(entries || {}).forEach(key => removeKeys.add(key));
            return;
        }
        Object.entries(entries || {}).forEach(([key, value]) => {
            const scoped = parseScopedKey(key);
            const label = normalizeDisplayLabel(scoped?.label || key);
            if (shouldIgnoreField(label, normalizedGroup)) {
                removeKeys.add(key);
                return;
            }
            if (!nextGroups[normalizedGroup]) nextGroups[normalizedGroup] = {};
            nextGroups[normalizedGroup][key] = value;
        });
    });

    Object.keys(nextAnswers).forEach(key => {
        const scoped = parseScopedKey(key);
        const normalizedGroup = normalizeGroupKey(scoped?.heading || '');
        const label = normalizeDisplayLabel(scoped?.label || key);
        if (!normalizedGroup && scoped) removeKeys.add(key);
        if (shouldIgnoreField(label, normalizedGroup || 'Other')) removeKeys.add(key);
    });

    removeKeys.forEach(key => {
        delete nextAnswers[key];
        Object.keys(nextGroups).forEach(groupName => {
            if (nextGroups[groupName]) delete nextGroups[groupName][key];
        });
    });

    return { groups: nextGroups, answers: nextAnswers };
}

function sortGroups(keys) {
    return [...keys].sort((a, b) => {
        const ai = STEP_ORDER.findIndex(step => step.toLowerCase() === a.toLowerCase());
        const bi = STEP_ORDER.findIndex(step => step.toLowerCase() === b.toLowerCase());
        if (ai >= 0 || bi >= 0) return (ai >= 0 ? ai : 999) - (bi >= 0 ? bi : 999);
        return a.localeCompare(b);
    });
}

function mergeNormalizedGroups(groups, flatAnswers) {
    const merged = {};
    const dedupe = new Set();
    const canonicalSeen = new Set();

    function addEntry(groupHint, saveKey, value) {
        const scoped = parseScopedKey(saveKey);
        const inferredGroup = normalizeGroupKey(scoped?.heading || groupHint || 'Other');
        const label = normalizeDisplayLabel(scoped?.label || String(saveKey || '').trim());
        const preferred = preferredGroupForLabel(label);
        const group = preferred || inferredGroup;
        if (!group) return;
        const normalizedValue = String(value || '').trim();
        if (!label || !normalizedValue || shouldIgnoreField(label, group)) return;

        if (!scoped) {
            const canonicalKey = label.toLowerCase();
            if (canonicalSeen.has(canonicalKey)) return;
            canonicalSeen.add(canonicalKey);
        }

        const dedupeKey = `${group.toLowerCase()}::${label.toLowerCase()}`;
        if (dedupe.has(dedupeKey)) return;
        dedupe.add(dedupeKey);

        if (!merged[group]) merged[group] = [];
        merged[group].push({
            saveKey: String(saveKey),
            label,
            value: normalizedValue
        });
    }

    Object.entries(groups || {}).forEach(([groupName, entries]) => {
        Object.entries(entries || {}).forEach(([saveKey, value]) => addEntry(groupName, saveKey, value));
    });
    Object.entries(flatAnswers || {}).forEach(([saveKey, value]) => addEntry('Other', saveKey, value));

    return merged;
}

function renderGroups(groups, flatAnswers) {
    const container = document.getElementById('groups-container');
    container.innerHTML = '';

    const allGroups = mergeNormalizedGroups(groups, flatAnswers);

    if (!Object.keys(allGroups).length) {
        container.innerHTML = `<div class="section"><div class="empty-state">
          No saved answers yet. Fill out Easy Apply steps and Eve will persist them here.
        </div></div>`;
        return;
    }

    sortGroups(Object.keys(allGroups)).forEach(grpKey => {
        const entries = allGroups[grpKey] || [];
        const section = document.createElement('div');
        section.className = 'section';
        section.dataset.group = grpKey;
        section.innerHTML = `
          <div class="section-header">
            <h2>${escHtml(grpKey)}</h2>
            <button class="section-delete-btn" type="button" data-group="${escHtml(grpKey)}" title="Delete section">✕</button>
            <button class="section-collapse-btn" type="button" title="Collapse/Expand">
              <span class="badge">${entries.length} field${entries.length !== 1 ? 's' : ''}</span>
              <span class="chevron">▼</span>
            </button>
          </div>
          <div class="section-body">
            ${entries.length > 0 ? `
            <table class="fields-table">
              <tbody>${entries.map(entry => `
                <tr class="sortable-row">
                  <td style="width: 30px;"><div class="drag-handle" draggable="true" title="Drag to reorder">☰</div></td>
                  <td class="question-cell">${escHtml(entry.label)}</td>
                  <td><input class="val-input" data-group="${escHtml(grpKey)}" data-key="${escHtml(entry.saveKey)}" value="${escHtml(entry.value)}"></td>
                  <td style="width: 40px; text-align:right;"><button class="del-row-btn" data-group="${escHtml(grpKey)}" data-key="${escHtml(entry.saveKey)}" title="Remove">✕</button></td>
                </tr>`).join('')}
              </tbody>
            </table>` : '<div class="empty-state">No fields saved in this group.</div>'}
          </div>`;
        container.appendChild(section);

        section.querySelectorAll('.del-row-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const k = btn.dataset.key;
                btn.closest('tr').remove();
                chrome.storage.local.get(['savedAnswers', 'savedAnswerGroups'], (r) => {
                    const sa = Object.assign({}, r.savedAnswers || {});
                    const sg = Object.assign({}, r.savedAnswerGroups || {});
                    delete sa[k];
                    Object.keys(sg).forEach(groupName => {
                        if (sg[groupName]) delete sg[groupName][k];
                    });
                    chrome.storage.local.set({ savedAnswers: sa, savedAnswerGroups: sg });
                });
            });
        });

        section.querySelectorAll('.section-delete-btn').forEach(btn => {
            btn.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                const targetGroup = btn.dataset.group;
                confirm(`Delete section "${targetGroup}"?`, () => {
                    chrome.storage.local.get(['savedAnswers', 'savedAnswerGroups'], (r) => {
                        const sa = Object.assign({}, r.savedAnswers || {});
                        const sg = Object.assign({}, r.savedAnswerGroups || {});
                        const removeKeys = new Set();

                        Object.entries(sg).forEach(([groupName, entries]) => {
                            if (normalizeGroupKey(groupName) !== targetGroup) return;
                            Object.keys(entries || {}).forEach(key => removeKeys.add(key));
                            delete sg[groupName];
                        });

                        // Also remove scoped keys from flat answers by normalized heading.
                        Object.keys(sa).forEach(key => {
                            const scoped = parseScopedKey(key);
                            if (scoped && scoped.heading === targetGroup) removeKeys.add(key);
                        });

                        removeKeys.forEach(key => {
                            delete sa[key];
                            Object.keys(sg).forEach(groupName => {
                                if (sg[groupName]) delete sg[groupName][key];
                            });
                        });

                        chrome.storage.local.set({ savedAnswers: sa, savedAnswerGroups: sg }, () => {
                            renderGroups(sg, sa);
                        });
                    });
                });
            });
        });

        let dragSrcEl = null;

        function handleDragStart(e) {
            dragSrcEl = this.closest('tr');
            e.dataTransfer.effectAllowed = 'move';
            if (dragSrcEl) {
                e.dataTransfer.setData('text/plain', dragSrcEl.dataset.key || '');
                dragSrcEl.classList.add('dragging');
            }
        }

        function handleDragOver(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            return false;
        }

        function handleDragEnter(e) {
            if (this !== dragSrcEl) this.classList.add('drag-over');
        }

        function handleDragLeave(e) {
            this.classList.remove('drag-over');
        }

        function handleDrop(e) {
            e.stopPropagation();
            if (dragSrcEl !== this) {
                const parent = this.parentNode;
                const siblings = Array.from(parent.children);
                const srcIdx = siblings.indexOf(dragSrcEl);
                const tgtIdx = siblings.indexOf(this);
                if (srcIdx < tgtIdx) {
                    parent.insertBefore(dragSrcEl, this.nextSibling);
                } else {
                    parent.insertBefore(dragSrcEl, this);
                }
            }
            return false;
        }

        function handleDragEnd(e) {
            if (dragSrcEl) dragSrcEl.classList.remove('dragging');
            section.querySelectorAll('.sortable-row').forEach(row => {
                row.classList.remove('drag-over');
            });
            dragSrcEl = null;
        }

        section.querySelectorAll('.drag-handle').forEach(handle => {
            handle.addEventListener('dragstart', handleDragStart);
            handle.addEventListener('dragend', handleDragEnd);
        });
        section.querySelectorAll('.sortable-row').forEach(row => {
            row.addEventListener('dragenter', handleDragEnter);
            row.addEventListener('dragover', handleDragOver);
            row.addEventListener('dragleave', handleDragLeave);
            row.addEventListener('drop', handleDrop);
        });
    });
    wireSectionControls(container);
}

function gatherEdits() {
    const groups = {}, flat = {};
    document.querySelectorAll('.val-input').forEach(inp => {
        const grp = inp.dataset.group, key = inp.dataset.key, val = inp.value.trim();
        if (!key) return;
        if (!groups[grp]) groups[grp] = {};
        if (val) { groups[grp][key] = val; flat[key] = val; }
    });
    return { groups, flat };
}

function toggleSection(button) {
    button.closest('.section').classList.toggle('collapsed');
}

function wireSectionControls(root) {
    (root || document).querySelectorAll('.section-collapse-btn').forEach(button => {
        if (button.dataset.bound === '1') return;
        button.dataset.bound = '1';
        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            toggleSection(button);
        });
    });
}

document.getElementById('save-all-btn').addEventListener('click', () => {
    flushActiveProfile();
    const active = allProfiles.find(x => x.id === activeProfileId) || allProfiles[0];
    const profileData = { profileName: active?.name || '' };

    chrome.storage.local.get(['savedAnswers', 'savedAnswerGroups'], (existing) => {
        const { groups: editedGroups, flat: editedFlat } = gatherEdits();
        const mergedGroups = Object.assign({}, existing.savedAnswerGroups || {});
        Object.keys(editedGroups).forEach(g => {
            mergedGroups[g] = Object.assign({}, mergedGroups[g] || {}, editedGroups[g]);
        });
        const mergedFlat = Object.assign({}, existing.savedAnswers || {}, editedFlat);
        const nextParams = gatherSearchConfig();

        chrome.runtime.sendMessage({ type: 'eve:save-params', params: nextParams }, (paramsRes) => {
            if (paramsRes && paramsRes.ok && paramsRes.params) eveParams = paramsRes.params;
            chrome.storage.local.set({
                profiles: allProfiles,
                activeProfileId,
                profileData,
                settings: globalSettings,
                savedAnswerGroups: mergedGroups,
                savedAnswers: mergedFlat,
                eveParams
            }, () => {
                const el = document.getElementById('save-status');
                el.textContent = 'Saved!';
                renderSearchConfig();
                setTimeout(() => { el.textContent = ''; }, 2000);
                renderProfileList();
            });
        });
    });
});
