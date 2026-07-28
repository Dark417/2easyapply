// Reload the unpacked Eve extension without opening chrome://extensions:
// attach to its service worker over CDP and call chrome.runtime.reload().
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

// Try Chrome's IPv6 loopback first (that is where it binds here), then IPv4, so this tool does not
// depend on the tcp-bridge.
const CDP_HOSTS = ['::1', '127.0.0.1'];
function getJsonFrom(host, path) {
  return new Promise((resolve, reject) => {
    http.get({ host, port: 9222, path, family: host === '::1' ? 6 : 4 }, res => {
      let b = '';
      res.on('data', d => (b += d));
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
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
  const send = (method, params, sessionId) => new Promise(resolve => {
    const msgId = ++id;
    pending.set(msgId, resolve);
    ws.send(JSON.stringify({ id: msgId, method, params: params || {}, ...(sessionId ? { sessionId } : {}) }));
  });

  ws.on('message', raw => {
    const msg = JSON.parse(raw);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });

  await new Promise(r => ws.on('open', r));

  const { result } = await send('Target.getTargets');
  const sw = result.targetInfos.find(t => t.type === 'service_worker' && t.url.includes(EXT_ID));
  if (!sw) {
    console.log('SERVICE_WORKER_NOT_FOUND for', EXT_ID);
    // Fall back: list extension targets so we can see what is there.
    result.targetInfos.filter(t => t.url.startsWith('chrome-extension://')).forEach(t => console.log(' ', t.type, t.url));
    process.exit(1);
  }
  console.log('Found SW target:', sw.url);

  const attached = await send('Target.attachToTarget', { targetId: sw.targetId, flatten: true });
  const sessionId = attached.result.sessionId;

  const ver = await send('Runtime.evaluate', { expression: 'chrome.runtime.getManifest().version', returnByValue: true }, sessionId);
  console.log('Version BEFORE reload:', JSON.stringify(ver.result?.result?.value));

  // Fire and forget: the worker is torn down by reload(), so no reply is expected.
  ws.send(JSON.stringify({ id: ++id, method: 'Runtime.evaluate', params: { expression: 'chrome.runtime.reload()' }, sessionId }));
  console.log('reload() dispatched');
  setTimeout(() => { ws.close(); process.exit(0); }, 1500);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
