// Splice DEFAULT_GH_QUESTIONS out of greenhouse.js VERBATIM into indeed.js as
// DEFAULT_INDEED_QUESTIONS. Regexes are never retyped (see the bank control-character lesson in
// AGENTS.md). Idempotent: replaces the initial marker or a previous spliced region.
// Usage: node tools/sync-indeed-bank.js   (run from the repo root; patches eve/)
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const BEGIN = '    // BEGIN spliced bank (from greenhouse.js DEFAULT_GH_QUESTIONS — do not edit here; run tools/sync-indeed-bank.js)';
const END = '    // END spliced bank';
const MARKER = '/*__DEFAULT_INDEED_QUESTIONS__*/';

function extractGhBank(source) {
    const start = source.indexOf('const DEFAULT_GH_QUESTIONS = [');
    if (start < 0) throw new Error('DEFAULT_GH_QUESTIONS not found in greenhouse.js');
    // Walk to the matching "];" at the same bracket depth.
    let depth = 0;
    let index = source.indexOf('[', start);
    for (; index < source.length; index += 1) {
        const ch = source[index];
        if (ch === '[') depth += 1;
        else if (ch === ']') {
            depth -= 1;
            if (depth === 0) break;
        }
    }
    const end = source.indexOf(';', index) + 1;
    return source.slice(start, end).replace('DEFAULT_GH_QUESTIONS', 'DEFAULT_INDEED_QUESTIONS');
}

function splice(target, bankText) {
    const file = path.join(root, target);
    let source = fs.readFileSync(file, 'utf8');
    const block = `${BEGIN}\n    ${bankText}\n${END}`;
    if (source.includes(MARKER)) {
        source = source.replace(MARKER, block);
    } else {
        const begin = source.indexOf(BEGIN);
        const endIdx = source.indexOf(END);
        if (begin < 0 || endIdx < 0) throw new Error(`No splice marker or region in ${target}`);
        source = source.slice(0, begin) + block + source.slice(endIdx + END.length);
    }
    fs.writeFileSync(file, source, 'utf8');
    // Control-character guard (the 0x08 lesson): fail loudly if any slipped in.
    const bad = fs.readFileSync(file, 'utf8').match(/[\x00-\x08\x0b\x0c\x0e-\x1f]/);
    if (bad) throw new Error(`Control character found in ${target} after splice.`);
    console.log(`spliced bank into ${target}`);
}

const gh = fs.readFileSync(path.join(root, 'eve', 'greenhouse.js'), 'utf8');
const bank = extractGhBank(gh);
for (const target of ['eve/indeed.js'].filter(t => fs.existsSync(path.join(root, t)))) {
    splice(target, bank);
}
