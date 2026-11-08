/**
 * Local harness for the Vercel bridge: serves the same dispatcher over plain
 * HTTP so the route table, connect-style mount stripping and the same-site gate
 * can be exercised without spending a deployment.
 *
 * Usage: node vercel-bridge/local-test.mjs [port]
 */
import http from 'node:http';
import { installOpenSkyEgressShim } from './opensky-egress.js';

// Mirror the Vercel entry point so the harness exercises the same code path.
installOpenSkyEgressShim();

const { handleApiRequest } = await import('./dispatcher.js');

const port = Number(process.argv[2] || 4999);

const server = http.createServer((req, res) => {
  handleApiRequest(req, res).catch((err) => {
    console.error('fatal', err);
    if (!res.writableEnded) res.end('fatal');
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`gev-bridge listening on http://127.0.0.1:${port}`);
});
