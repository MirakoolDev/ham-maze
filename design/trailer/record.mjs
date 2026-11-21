// Record the trailer to an MP4 with headless Chrome: node design/trailer/record.mjs [outDir] [--swiftshader] [--light]
// --light: the website's copy, 1280x720 at 3 Mbps (ham-trailer-720.mp4), plus its poster frame (ham-trailer-poster.jpg)
// Needs the repo served on http://localhost:5180 and the bundle built (node design/trailer/build.mjs).
// The page renders every frame itself (?record=1) and downloads ham-trailer.mp4 into outDir.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, existsSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import WebSocket from 'ws';

const args = process.argv.slice(2);
const outDir = resolve(args.find((a) => !a.startsWith('--')) || 'design/trailer/out');
const soft = args.includes('--swiftshader'), light = args.includes('--light');
const NAME = light ? 'ham-trailer-720.mp4' : 'ham-trailer.mp4';
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9333, URL = 'http://localhost:5180/design/trailer/index.html?record=1' + (light ? `&w=1280&br=3000000&abr=128000&poster=37.6&name=${NAME}` : '');
mkdirSync(outDir, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'hamrec-'))}`,
  '--mute-audio', '--hide-scrollbars', '--window-size=1920,1080', '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  ...(soft ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist']),
  'about:blank'], { stdio: 'ignore' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let ver;
for (let i = 0; i < 50 && !ver; i++) { await wait(200); ver = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json()).catch(() => null); }
if (!ver) { chrome.kill(); throw new Error('chrome did not start'); }
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => ws.once('open', r));
let id = 0; const pending = new Map();
ws.on('message', (m) => { const d = JSON.parse(m); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } });
const send = (method, params = {}, sessionId) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params, sessionId })); });

await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: outDir });
const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank' });
const { result: { sessionId } } = await send('Target.attachToTarget', { targetId, flatten: true });

const file = join(outDir, NAME);
// clear the last take first: Chrome won't overwrite it, and the old file would pass for the new one
for (const f of [file, join(outDir, 'ham-trailer-poster.jpg')]) if (existsSync(f) && (f === file || light)) unlinkSync(f);
await send('Page.navigate', { url: URL }, sessionId);
const t0 = Date.now(); let last = '';
for (;;) {
  await wait(2000);
  const r = await send('Runtime.evaluate', { expression: 'document.title' }, sessionId);
  const title = r.result?.result?.value || '';
  if (title !== last) { console.log(`${((Date.now() - t0) / 1000).toFixed(0)}s  ${title}`); last = title; }
  if (/error/.test(title)) break;
  if (title.startsWith('done')) {
    for (let i = 0; i < 60 && !(existsSync(file) && statSync(file).size > 0); i++) await wait(500);
    await wait(1500);
    break;
  }
  if (Date.now() - t0 > 40 * 60e3) { console.log('timed out'); break; }
}
if (light) {
  const r = await send('Runtime.evaluate', { expression: 'window.__poster || ""' }, sessionId);
  const d = r.result?.result?.value || '';
  if (d) { writeFileSync(join(outDir, 'ham-trailer-poster.jpg'), Buffer.from(d.split(',')[1], 'base64')); console.log('saved poster'); }
}
console.log(existsSync(file) ? `saved ${file} (${(statSync(file).size / 1e6).toFixed(1)} MB)` : 'no file');
ws.close(); chrome.kill();
