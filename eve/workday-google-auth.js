// Eve — narrowly scoped Workday Google account chooser.
// This script does nothing unless the OAuth request is returning to myworkday.com
// and only requests basic OpenID identity scopes.
(function () {
    const WORKDAY_GOOGLE_ACCOUNT = 'xiaoxiaoleijobapp@gmail.com';
    const SESSION_KEY = 'eveWorkdayAutoApplySession';
    const ACTION_DELAY_MS = 2000;
    const ALLOWED_SCOPES = new Set(['openid', 'email', 'profile']);
    let actionPending = false;
    let checking = false;

    function isWorkdayHost(host) {
        // Workday candidate SSO returns either to a myworkday.com endpoint or directly to the
        // tenant application host (e.g. blackrock.wd1.myworkdayjobs.com). Accept both, and only
        // these Workday-owned domains.
        return host === 'myworkday.com' || host.endsWith('.myworkday.com')
            || host === 'myworkdayjobs.com' || host.endsWith('.myworkdayjobs.com')
            || host === 'myworkdaysite.com' || host.endsWith('.myworkdaysite.com');
    }

    function isWorkdayOAuth() {
        const params = new URLSearchParams(location.search);
        const redirectUri = params.get('redirect_uri');
        const appDomain = params.get('app_domain');
        let workdayTarget = false;
        for (const raw of [redirectUri, appDomain]) {
            if (!raw) continue;
            try {
                if (isWorkdayHost(new URL(raw).hostname.toLowerCase())) workdayTarget = true;
            } catch { }
        }
        if (!workdayTarget) return false;
        const scopes = String(params.get('scope') || 'openid email').split(/\s+/).filter(Boolean);
        return scopes.every(scope => ALLOWED_SCOPES.has(scope));
    }

    function clean(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function storageGet(keys) {
        return new Promise(resolve => chrome.storage.local.get(keys, resolve));
    }

    const LOGIN_PENDING_KEY = 'eveWorkdayLoginPendingAt';

    async function automatedActionsAllowed() {
        const result = await storageGet(null); // all keys — sessions are stored per-application now
        if (result.settings?.autopilotEnabled === false) return false;
        // Auto: ANY running user-activated session drives the chooser. Sessions are keyed per
        // application (`${SESSION_KEY}:${applicationKey}`), so scan every matching slot instead of a
        // single fixed key — this keeps Google sign-in working while tabs run independently.
        const autoActive = result.eveApplyMode !== 'manual'
            && Object.entries(result).some(([key, session]) =>
                key.startsWith(SESSION_KEY) && session && typeof session === 'object'
                && session.activatedByUser === true
                && session.state === 'running'
                && Date.now() - Number(session.updatedAt || 0) < 30 * 60 * 1000);
        // Manual (or Auto): a login the user just initiated via Eve selects the account too.
        const loginPending = Date.now() - Number(result[LOGIN_PENDING_KEY] || 0) < 5 * 60 * 1000;
        return autoActive || loginPending;
    }

    async function scheduleClick(target) {
        if (!target || actionPending) return false;
        if (!await automatedActionsAllowed()) return false;
        actionPending = true;
        setTimeout(async () => {
            if (await automatedActionsAllowed()) target.click();
        }, ACTION_DELAY_MS);
        return true;
    }

    async function clickTargetAccount() {
        const candidates = [...document.querySelectorAll('a, [role="link"], [role="button"]')];
        const account = candidates.find(node => clean(node.textContent).toLowerCase().includes(WORKDAY_GOOGLE_ACCOUNT));
        if (!account) return false;
        return scheduleClick(account);
    }

    async function clickBasicConsent() {
        if (!/consent|oauth/i.test(location.href)) return false;
        const buttons = [...document.querySelectorAll('button, [role="button"]')];
        const button = buttons.find(node => /^(continue|allow)$/i.test(clean(node.textContent)));
        if (!button) return false;
        return scheduleClick(button);
    }

    if (!isWorkdayOAuth()) return;
    let attempts = 0;
    const timer = setInterval(async () => {
        if (checking) return;
        checking = true;
        attempts += 1;
        try {
            if (!await automatedActionsAllowed() || await clickTargetAccount() || await clickBasicConsent() || attempts >= 30) clearInterval(timer);
        } finally {
            checking = false;
        }
    }, 300);
})();
