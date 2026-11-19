// Renders design/og/og.html to assets/og.png (1200x630) with a local headless Chrome or Edge.
// Run: node design/og/render.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../../assets/og.png');
const browsers = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
];
const bin = browsers.find((b) => fs.existsSync(b));
if (!bin) throw new Error('No Chrome or Edge found');
execFileSync(bin, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files', '--force-device-scale-factor=1',
  '--window-size=1200,630', '--virtual-time-budget=3000', `--screenshot=${out}`, pathToFileURL(path.join(here, 'og.html')).href], { stdio: 'inherit' });
console.log('wrote', out, fs.statSync(out).size, 'bytes');
