// Wake a dormant MV3 service worker by opening an extension page (browser-level CDP, no SW needed),
// then close it again.
const WebSocket = (() => {
  // `ws` is not a dependency of this repo; find it wherever npm happens to have one.
  const { execSync } = require('child_process');
  const path = require('path');
  const candidates = [];
  const roots = [];
  try { roots.push(execSync('npm root -g', { encoding: 'utf8' }).trim()); } catch { /* npm not on PATH */ }
  // Explicit fallbacks: `npm root -g` can fail or be slow depending on the shell.
  if (process.env.APPDATA) roots.push(path.join(process.env.APPDATA, 'npm', 'node_modules'));
  if (process.env.USERPROFILE) roots.push(path.join(process.env.USERPROFILE, 'AppData', 'Roaming', 'npm', 'node_modules'));
  for (const root of roots) {
    if (!root) continue;
    candidates.push(path.join(root, 'ws'));
    for (const pkg of ['happy-coder', '@vibe-kit/grok-cli']) {
      candidates.push(path.join(root, pkg, 'node_modules', 'ws'));
    }
  }
  candidates.push('ws');
  for (const c of candidates) {
    try { return require(c); } catch { /* keep looking */ }
  }
  throw new Error('Could not locate the `ws` module. Install it: npm i -g ws');
})();
const http = require('http');

const EXT_ID = process.argv[2] || 'fmabdkmenomdhjmoopeilekopofmmhbm';
const PAGE = process.argv[3] || 'popup.html';

// Chrome binds its DevTools port to [::1] on this machine and only sometimes to 127.0.0.1, so try
// the IPv6 loopback FIRST and fall back to IPv4. This makes these tools independent of the
// tcp-bridge (which the MCP server still needs, since its --browser-url is fixed at 127.0.0.1).
const CDP_HOSTS = ['::1', '127.0.0.1'];
function getJsonFrom(host, path) {
  return new Promise((resolve, reject) => {
    http.get({ host, port: 9222, path, family: host === '::1' ? 6 : 4 }, res => {
      let b = ''; res.on('data', d => (b += d)); res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
async function getJson(path) {
  let lastErr;
  for (const host of CDP_HOSTS) {
    try { return await getJsonFrom(host, path); } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('No CDP endpoint reachable on port 9222');
}

(async () => {
  const version = await getJson('/json/version');
  const ws = new WebSocket(version.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0;
  const pending = new Map();
  const send = (method, params) => new Promise(resolve => {
    const msgId = ++id;
    pending.set(msgId, resolve);
    ws.send(JSON.stringify({ id: msgId, method, params: params || {} }));
  });
  ws.on('message', raw => {
    const m = JSON.parse(raw);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  await new Promise(r => ws.on('open', r));

  const created = await send('Target.createTarget', { url: `chrome-extension://${EXT_ID}/${PAGE}`, background: true });
  const targetId = created.result?.targetId;
  console.log('opened extension page target:', targetId, created.error ? JSON.stringify(created.error) : '');
  await new Promise(r => setTimeout(r, 2500));

  const { result } = await send('Target.getTargets');
  const sw = result.targetInfos.find(t => t.type === 'service_worker' && t.url.includes(EXT_ID));
  console.log(sw ? 'SERVICE_WORKER_AWAKE' : 'STILL_ASLEEP');

  if (targetId) await send('Target.closeTarget', { targetId });
  ws.close();
  process.exit(sw ? 0 : 1);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
