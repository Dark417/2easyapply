// Chrome bound its DevTools port to [::1]:9222 only; chrome-devtools-mcp is configured for
// http://127.0.0.1:9222. Bridge IPv4 loopback -> IPv6 loopback, transparently.
const net = require('net');

const LISTEN_HOST = '127.0.0.1';
const LISTEN_PORT = 9222;
const UPSTREAM_HOST = '::1';
const UPSTREAM_PORT = 9222;

const server = net.createServer(client => {
  const upstream = net.connect({ host: UPSTREAM_HOST, port: UPSTREAM_PORT }, () => {
    client.pipe(upstream);
    upstream.pipe(client);
  });
  const bail = () => { client.destroy(); upstream.destroy(); };
  upstream.on('error', bail);
  client.on('error', bail);
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.log(`tcp-bridge ${LISTEN_HOST}:${LISTEN_PORT} -> [${UPSTREAM_HOST}]:${UPSTREAM_PORT}`);
});
