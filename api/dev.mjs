// Local stand-in for the Vercel function: node api/dev.mjs serves POST /api/referee on http://localhost:5174.
// Reads REFEREE_KEY (and optional HAM_CONTRACT_<CHAIN>) from .env.local.
import http from 'node:http';
import fs from 'node:fs';
import { referee } from './referee.js';

try {
  for (const line of fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}

http.createServer(async (req, res) => {
  const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' }); res.end(body ? JSON.stringify(body) : ''); };
  if (req.method === 'OPTIONS') return send(204);
  if (req.method !== 'POST' || !req.url.startsWith('/api/referee')) return send(404, { error: 'Not found' });
  let raw = '';
  for await (const chunk of req) raw += chunk;
  try { const out = await referee(JSON.parse(raw || '{}')); send(out.status, out.body); }
  catch (e) { send(500, { error: e.shortMessage || e.message }); }
}).listen(5174, () => console.log('referee on http://localhost:5174/api/referee'));
