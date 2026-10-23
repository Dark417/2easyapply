// Eve — Gmail inbox reader (verification-code service, second source; 2026-09-26).
// The Atom feed only lists UNREAD mail, so a code e-mail the user already opened is invisible to it.
// When a Gmail tab is open, background asks it (eve:gmail-scan) for the visible conversation rows:
// from / subject / snippet (the list snippet carries "one-time pass code: NNNNNN") / full date.
// Read-only: nothing is clicked, opened or marked. No UI on Gmail.
(function () {
    'use strict';
    if (!/^mail\.google\.com$/i.test(location.hostname)) return;
    const clean = value => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    function rows() {
        return [...document.querySelectorAll('tr.zA')].slice(0, 60).map(row => {
            const fromEl = row.querySelector('.yX [email], .yX .yP, .yX .zF');
            const timeEl = row.querySelector('.xW span[title], .xW [title]');
            const account = (document.title.match(/([^\s()-]+@[^\s()-]+)/) || [])[1] || '';
            return {
                unread: row.classList.contains('zE'),
                from: clean(fromEl?.getAttribute('email') || fromEl?.getAttribute('name') || fromEl?.innerText || row.querySelector('.yX')?.innerText),
                title: clean(row.querySelector('.bog')?.innerText),
                summary: clean(row.querySelector('.y2')?.innerText).replace(/^-\s*/, ''),
                issued: (() => { const t = timeEl?.getAttribute('title') || ''; const ms = Date.parse(t); return Number.isFinite(ms) ? new Date(ms).toISOString() : ''; })(),
                account
            };
        }).filter(r => r.title || r.summary);
    }
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message?.type !== 'eve:gmail-scan') return false;
        try { sendResponse({ ok: true, account: (document.title.match(/([^\s()-]+@[^\s()-]+)/) || [])[1] || '', entries: rows() }); }
        catch (error) { sendResponse({ ok: false, error: error.message || String(error) }); }
        return true;
    });
})();
