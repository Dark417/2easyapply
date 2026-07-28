// Verifies the legacy-backup import shim in eve/settings.js survives the abby -> eve rename.
//
// The functions are extracted from source (same discipline as tools/bank-test.js) rather than
// retyped, so the test can never pass against a version of the logic that is not the shipped one.
//
// Usage: node tools/backup-compat-test.js
const fs = require('fs');
const path = require('path');

const SETTINGS = path.join(__dirname, '..', 'eve', 'settings.js');
const src = fs.readFileSync(SETTINGS, 'utf8');

function extract(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error('not found: ' + name);
  let depth = 0, i = src.indexOf('{', start), end = -1;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) { end = j; break; } }
  }
  return src.slice(start, end + 1);
}

const EXPORT_KEYS = eval(src.slice(src.indexOf('const EXPORT_KEYS = ['), src.indexOf('];', src.indexOf('const EXPORT_KEYS = [')) + 2).replace('const EXPORT_KEYS =', '')); // eslint-disable-line
const LEGACY_BACKUP_MARKER = '_abbyBackup';
const BACKUP_MARKER = '_eveBackup';
eval(extract('mapLegacyBackupKey'));
eval(extract('isRawStorageDump'));
eval(extract('isBackupFile'));
eval(extract('normalizeBackup'));

let pass = 0, fail = 0;
const assert = (ok, label) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };

console.log('=== EXPORT_KEYS are all post-rename names ===');
assert(EXPORT_KEYS.length > 0, `EXPORT_KEYS extracted (${EXPORT_KEYS.length} keys)`);
assert(!EXPORT_KEYS.some(k => /^abby/i.test(k)), 'no abby* key names remain in EXPORT_KEYS');
for (const k of ['eveParams', 'eveApplyMode', 'eveApplyStats', 'eveAppLogs', 'eveTheme']) {
  assert(EXPORT_KEYS.includes(k), `EXPORT_KEYS includes ${k}`);
}

console.log('\n=== marker acceptance ===');
assert(isBackupFile({ _eveBackup: true }), 'accepts a new _eveBackup file');
assert(isBackupFile({ _abbyBackup: true }), 'accepts a legacy _abbyBackup file');
assert(isBackupFile({ savedAnswers: { a: 1 }, abbyParams: { p: 1 } }), 'accepts a raw legacy chrome.storage dump');
assert(!isBackupFile({ somethingElse: true }), 'rejects a file with no backup marker');
assert(!isBackupFile({}), 'rejects an empty object');
assert(!isBackupFile(null), 'rejects null');

console.log('\n=== legacy key mapping ===');
assert(mapLegacyBackupKey('abbyParams') === 'eveParams', 'abbyParams -> eveParams');
assert(mapLegacyBackupKey('abbyAppLogs') === 'eveAppLogs', 'abbyAppLogs -> eveAppLogs');
assert(mapLegacyBackupKey('abbyApplyMode') === 'eveApplyMode', 'abbyApplyMode -> eveApplyMode');
assert(mapLegacyBackupKey('abbyApplyStats') === 'eveApplyStats', 'abbyApplyStats -> eveApplyStats');
assert(mapLegacyBackupKey('abbyTheme') === 'eveTheme', 'abbyTheme -> eveTheme');
assert(mapLegacyBackupKey('savedAnswers') === 'savedAnswers', 'un-prefixed keys pass through unchanged');
assert(mapLegacyBackupKey('appliedJobsLog') === 'appliedJobsLog', 'appliedJobsLog passes through unchanged');
// Must not maul a word that merely starts with the letters.
assert(mapLegacyBackupKey('abbytest') === 'abbytest', 'does not rewrite abbytest (no capital after prefix)');
assert(mapLegacyBackupKey('abbreviation') === 'abbreviation', 'does not rewrite unrelated words');

console.log('\n=== a real legacy backup round-trips ===');
const legacyFile = {
  _abbyBackup: true, _version: 1, _date: '2026-01-01T00:00:00.000Z',
  savedAnswers: { a: 1 }, savedAnswerGroups: [1, 2], savedRegexAnswers: [], workdaySavedAnswers: { w: 1 },
  abbyParams: { p: 1 }, abbyApplyMode: 'auto', abbyApplyStats: { auto: 3 }, abbyAppLogs: [{ l: 1 }],
  appliedJobsLog: [{ jobId: '1' }], settings: { s: 1 }, profiles: [{ id: 'default' }],
  activeProfileId: 'default', profileData: { n: 'x' }, abbyTheme: 'dark'
};
const legacy = normalizeBackup(legacyFile);
assert(legacy.legacy === true, 'legacy file flagged as legacy');
assert(legacy.restore.eveParams && legacy.restore.eveParams.p === 1, 'abbyParams value restored under eveParams');
assert(legacy.restore.eveTheme === 'dark', 'abbyTheme value restored under eveTheme');
assert(legacy.restore.eveApplyMode === 'auto', 'abbyApplyMode value restored under eveApplyMode');
assert(legacy.restore.appliedJobsLog.length === 1, 'appliedJobsLog carried across');
assert(legacy.restore.savedAnswers.a === 1, 'savedAnswers carried across');
assert(!('abbyParams' in legacy.restore), 'no abby* key written into storage');
assert(!Object.keys(legacy.restore).some(k => k.startsWith('_')), 'metadata markers not restored as data');
assert(legacy.mapped.length === 5, `reports the 5 renamed keys (got ${legacy.mapped.length}: ${legacy.mapped.join(', ')})`);
assert(Object.keys(legacy.restore).length === 14, `all 14 legacy keys restored (got ${Object.keys(legacy.restore).length})`);

console.log('\n=== raw chrome.storage dump round-trips ===');
const rawDump = { savedAnswers: { raw: 1 }, abbyParams: { p: 9 }, abbyTheme: 'dark', unrelatedRuntimeKey: 7 };
const raw = normalizeBackup(rawDump);
assert(raw.legacy === true, 'raw old-prefix dump is flagged as legacy');
assert(raw.restore.eveParams.p === 9, 'raw dump maps abbyParams to eveParams');
assert(raw.restore.eveTheme === 'dark', 'raw dump maps abbyTheme to eveTheme');
assert(raw.restore.savedAnswers.raw === 1, 'raw dump preserves recognised unprefixed data');
assert(raw.restore.unrelatedRuntimeKey === 7, 'raw dump preserves future/unlisted runtime keys');

console.log('\n=== a new-format backup round-trips ===');
const newFile = { _eveBackup: true, _version: 2, eveParams: { p: 2 }, eveTheme: 'light', savedAnswers: { b: 2 } };
const fresh = normalizeBackup(newFile);
assert(fresh.legacy === false, 'new file not flagged as legacy');
assert(fresh.restore.eveParams.p === 2, 'eveParams restored');
assert(fresh.restore.eveTheme === 'light', 'eveTheme restored');
assert(fresh.mapped.length === 0, 'nothing renamed for a new-format file');

console.log('\n=== export writes the new format ===');
assert(/\[BACKUP_MARKER\]: true/.test(src), 'export stamps _eveBackup via BACKUP_MARKER');
assert(!/_abbyBackup: true/.test(src), 'export no longer stamps _abbyBackup');
assert(/eve-backup-/.test(src), 'export filename is eve-backup-*');
assert(/chrome\.storage\.local\.get\(null/.test(src), 'export captures every storage key');

console.log(`\nTOTAL ${pass}/${pass + fail} assertions passed${fail ? ` — ${fail} FAILURES` : ''}`);
process.exit(fail ? 1 : 0);
