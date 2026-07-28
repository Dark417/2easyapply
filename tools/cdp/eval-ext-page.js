// Evaluate an expression inside an EXTENSION PAGE (settings.html) instead of the service worker.
// Useful when the MV3 worker refuses to register a CDP target: an extension page still has full
// chrome.* access and can fetch the extension's own files, which is all the verification needs.
const WebSocket = (() => {
  const { execSync } = require('child_process');
  const path = require('path');
  const roots = [];
  try { roots.push(execSync('npm root -g', { encoding: 'utf8' }).trim()); } catch { }
  if (process.env.APPDATA) roots.push(path.join(process.env.APPDATA, 'npm', 'node_modules'));
  const candidates = [];
  for (const root of roots) {
    if (!root) continue;
    candidates.push(path.join(root, 'ws'));
    for (const pkg of ['happy-coder', '@vibe-kit/grok-cli']) candidates.push(path.join(root, pkg, 'node_modules', 'ws'));
  }
  candidates.push('ws');
  for (const c of candidates) { try { return require(c); } catch { } }
  throw new Error('Could not locate the `ws` module.');
})();
const http = require('http');

const EXT_ID = process.argv[2];
const EXPR = process.argv[3];
const CDP_HOSTS = ['::1', '127.0.0.1'];

function getJsonFrom(host, p) {
  return new Promise((resolve, reject) => {
    http.get({ host, port: 9222, path: p, family: host === '::1' ? 6 : 4 }, res => {
      let b = ''; res.on('data', d => (b += d)); res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
async function getJson(p) {
  let lastErr;
  for (const host of CDP_HOSTS) { try { return await getJsonFrom(host, p); } catch (e) { lastErr = e; } }
  throw lastErr;
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

  const created = await send('Target.createTarget', { url: `chrome-extension://${EXT_ID}/settings.html`, background: true });
  const targetId = created.result?.targetId;
  if (!targetId) { console.log('PAGE_NOT_CREATED', JSON.stringify(created)); process.exit(1); }
  await new Promise(r => setTimeout(r, 1500));
  const attached = await send('Target.attachToTarget', { targetId, flatten: true });
  const sessionId = attached.result?.sessionId;
  const res = await send('Runtime.evaluate', { expression: EXPR, awaitPromise: true, returnByValue: true, timeout: 30000 }, sessionId);
  if (res.result?.exceptionDetails) {
    console.log('EXCEPTION:', JSON.stringify(res.result.exceptionDetails.exception?.description || res.result.exceptionDetails));
  } else {
    console.log(JSON.stringify(res.result?.result?.value, null, 2));
  }
  await send('Target.closeTarget', { targetId });
  ws.close();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
