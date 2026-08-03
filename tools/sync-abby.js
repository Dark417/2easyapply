#!/usr/bin/env node
// Mirror the canonical extension source (eve/) into the directory Chrome actually loads the
// unpacked extension from (abby/). TEMPORARY: delete this tool once the load-path migration in
// design/abby-migration.md is complete.
//
// Copies code/assets only; local-only files (profile.local.json, secrets.local.json, artifacts/)
// are preserved in abby/ as they are, and never copied over or deleted.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'eve');
const DST = path.join(ROOT, 'abby');

const SKIP = new Set(['profile.local.json', 'secrets.local.json', 'artifacts']);

if (!fs.existsSync(DST)) {
  console.log('abby/ not found — migration already done, nothing to sync.');
  process.exit(0);
}

let copied = 0;
function syncDir(srcDir, dstDir, top) {
  fs.mkdirSync(dstDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (top && SKIP.has(entry.name)) continue;
    const s = path.join(srcDir, entry.name);
    const d = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      syncDir(s, d, false);
    } else {
      const before = fs.existsSync(d) ? fs.readFileSync(d) : null;
      const data = fs.readFileSync(s);
      if (!before || !before.equals(data)) {
        fs.writeFileSync(d, data);
        copied++;
        console.log('sync', path.relative(ROOT, d));
      }
    }
  }
}

syncDir(SRC, DST, true);
const ver = JSON.parse(fs.readFileSync(path.join(DST, 'manifest.json'), 'utf8')).version;
console.log(`done — ${copied} file(s) updated, abby manifest now ${ver}`);
