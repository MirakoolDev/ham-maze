// Renders the post cards in design/posts/posts.html to PNGs (1600x900) with a local headless Chrome or Edge.
// Run: node design/posts/render.mjs [card ...]   (default: every card)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cards = process.argv.slice(2).length ? process.argv.slice(2) : ['audit', 'backers'];
const browsers = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
];
const bin = browsers.find((b) => fs.existsSync(b));
if (!bin) throw new Error('No Chrome or Edge found');
for (const card of cards) {
  const out = path.join(here, `${card}.png`);
  const url = `${pathToFileURL(path.join(here, 'posts.html')).href}?card=${card}`;
  execFileSync(bin, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files', '--force-device-scale-factor=1',
    '--window-size=1600,900', '--virtual-time-budget=6000', `--screenshot=${out}`, url], { stdio: 'inherit' });
  console.log('wrote', out, fs.statSync(out).size, 'bytes');
}
