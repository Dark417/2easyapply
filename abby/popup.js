function openSettings(pane = 'info') {
    const url = chrome.runtime.getURL(`settings.html#${pane}`);
    window.open(url);
}

function updateThemeIcon(isDark) {
    const icon = document.getElementById('themeIcon');
    if (!icon) return;
    icon.textContent = isDark ? '🌙' : '☀';
}

function gatherPopupParams(existingParams) {
    const params = Object.assign({}, existingParams || {});
    const typed = document.getElementById('searchText').value.trim();
    const searches = Array.from(new Set([typed, ...((params.searches || []).filter(Boolean))].filter(Boolean)));
    return Object.assign({}, params, {
        searches,
        selectedSearch: typed || params.selectedSearch || searches[0] || '',
        ignore: Object.assign({ caseSensitive: false, keywords: [] }, params.ignore || {}, { caseSensitive: false })
    });
}

function renderSavedSearchList(searches, selected) {
    const list = document.getElementById('savedSearchList');
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
                chrome.storage.local.get(['abbyParams'], (res) => {
                    const nextParams = gatherPopupParams(res.abbyParams || {});
                    nextParams.searches = nextParams.searches.filter(x => x !== val);
                    if (nextParams.selectedSearch === val) nextParams.selectedSearch = nextParams.searches[0] || '';
                    chrome.runtime.sendMessage({ type: 'abby:save-params', params: nextParams }, (response) => {
                        const params = response?.params || nextParams;
                        document.getElementById('searchText').value = params.selectedSearch || '';
                        document.getElementById('selected-search').textContent = params.selectedSearch || params.searches[0] || 'No saved location';
                        document.getElementById('search-count').textContent = params.searches.length;
                        renderSavedSearchList(params.searches || [], params.selectedSearch || '');
                    });
                });
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
                
                const newOrder = Array.from(parent.children).map(node => node.dataset.val);
                chrome.storage.local.get(['abbyParams'], (res) => {
                    const nextParams = gatherPopupParams(res.abbyParams || {});
                    nextParams.searches = newOrder;
                    chrome.runtime.sendMessage({ type: 'abby:save-params', params: nextParams }, () => {
                        renderSavedSearchList(newOrder, nextParams.selectedSearch);
                    });
                });
            }
            return false;
        });
        handle.addEventListener('dragend', () => { if (dragSrc) dragSrc.style.opacity = '1'; dragSrc = null; });
    });
}

document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.local.get(['settings', 'savedAnswers', 'abbyParams', 'abbyTheme', 'abbyApplyMode', 'abbyApplyStats'], (res) => {
        if (res.abbyTheme === 'light') document.body.classList.add('light-theme');
        const enabled = res.settings ? res.settings.autopilotEnabled !== false : true;
        document.getElementById('autopilotToggle').checked = enabled;
        const isDark = res.abbyTheme !== 'light';
        document.getElementById('themeToggle').checked = isDark;
        updateThemeIcon(isDark);

        document.getElementById('answers-count').textContent = Object.keys(res.savedAnswers || {}).length;

        const params = res.abbyParams || {};
        const searches = params.searches || [];
        const ignored = (params.ignore && params.ignore.keywords) || [];
        document.getElementById('search-count').textContent = searches.length;
        document.getElementById('ignore-count').textContent = ignored.length;
        document.getElementById('selected-search').textContent = params.selectedSearch || searches[0] || 'No saved location';
        document.getElementById('searchText').value = params.selectedSearch || '';
        renderSavedSearchList(searches, params.selectedSearch || '');
        const applyMode = res.abbyApplyMode === 'manual' ? 'manual' : 'auto';
        document.getElementById('applyModeToggle').checked = applyMode === 'auto';
        const applyStats = Object.assign({ auto: 0, manual: 0 }, res.abbyApplyStats || {});
        document.getElementById('auto-count').textContent = applyStats.auto;
        document.getElementById('manual-count').textContent = applyStats.manual;
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local') return;
        if (changes.abbyTheme) {
            const isDark = changes.abbyTheme.newValue === 'dark';
            document.getElementById('themeToggle').checked = isDark;
            document.body.classList.toggle('light-theme', !isDark);
            updateThemeIcon(isDark);
        }
        if (changes.abbyApplyMode) {
            const applyMode = changes.abbyApplyMode.newValue === 'manual' ? 'manual' : 'auto';
            document.getElementById('applyModeToggle').checked = applyMode === 'auto';
        }
        if (changes.abbyApplyStats) {
            const applyStats = Object.assign({ auto: 0, manual: 0 }, changes.abbyApplyStats.newValue || {});
            document.getElementById('auto-count').textContent = applyStats.auto;
            document.getElementById('manual-count').textContent = applyStats.manual;
        }
        if (changes.settings) {
            const enabled = changes.settings.newValue ? changes.settings.newValue.autopilotEnabled !== false : true;
            document.getElementById('autopilotToggle').checked = enabled;
        }
    });

    document.getElementById('autopilotToggle').addEventListener('change', function () {
        chrome.storage.local.get(['settings'], (res) => {
            chrome.storage.local.set({ settings: Object.assign({}, res.settings || {}, { autopilotEnabled: this.checked }) });
        });
    });


    document.getElementById('applyModeToggle').addEventListener('change', function () {
        const mode = this.checked ? 'auto' : 'manual';
        chrome.storage.local.set({ abbyApplyMode: mode });
    });

    document.getElementById('themeToggle').addEventListener('change', function () {
        const nextTheme = this.checked ? 'dark' : 'light';
        chrome.runtime.sendMessage({ type: 'abby:set-theme', theme: nextTheme });
    });

    document.getElementById('saveSearchBtn').addEventListener('click', () => {
        chrome.storage.local.get(['abbyParams'], (res) => {
            const nextParams = gatherPopupParams(res.abbyParams || {});
            chrome.runtime.sendMessage({ type: 'abby:save-params', params: nextParams }, (response) => {
                const params = response?.params || nextParams;
                const searches = params.searches || [];
                document.getElementById('selected-search').textContent = params.selectedSearch || searches[0] || 'No saved location';
                renderSavedSearchList(searches, params.selectedSearch || '');
                document.getElementById('search-count').textContent = searches.length;
            });
        });
    });
    document.getElementById('runSearchBtn').addEventListener('click', () => {
        chrome.storage.local.get(['abbyParams'], (res) => {
            chrome.runtime.sendMessage({ type: 'abby:open-search', params: gatherPopupParams(res.abbyParams || {}) });
        });
    });
    document.getElementById('infoBtn').addEventListener('click', () => openSettings('info'));
    document.getElementById('searchBtn').addEventListener('click', () => openSettings('search'));
});
