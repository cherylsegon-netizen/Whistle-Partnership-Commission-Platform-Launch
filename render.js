// Renders index.html frame-by-frame to an MP4 for LinkedIn.
// Usage: node render.js [out.mp4] [--stills 1000,5000,...] [--fps 30]
// Needs playwright (Chromium) + ffmpeg on PATH. Serves the project over a local HTTP
// server because the page uses ES modules (three.js) which browsers block on file://.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const FPS = +flag('--fps', 30), SIZE = 1080;
const out = args[0] && !args[0].startsWith('--') ? args[0] : 'out/whistle-partner-launch-1080.mp4';
const stills = flag('--stills', null);
const ROOT = __dirname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream' });
    res.end(d);
  });
});

server.listen(0, async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.error('page error:', e.message));
  await page.goto(`http://localhost:${server.address().port}/index.html?render`);
  await page.waitForFunction('window.READY === true', null, { timeout: 120000 });
  const duration = await page.evaluate(() => window.DURATION);
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });

  if (stills) {
    for (const ms of stills.split(',').map(Number)) {
      await page.evaluate(t => window.seek(t), ms);
      await page.screenshot({ path: `out/still-${String(ms).padStart(5, '0')}.png` });
    }
  } else {
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out],
      { stdio: ['pipe', 'inherit', 'inherit'] });
    const frames = Math.round(duration / 1000 * FPS);
    for (let f = 0; f < frames; f++) {
      await page.evaluate(t => window.seek(t), (f * 1000) / FPS);
      const buf = await page.screenshot({ type: 'png' });
      if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
      if (f % 150 === 0) console.log(`frame ${f}/${frames}`);
    }
    ff.stdin.end();
    await new Promise(r => ff.on('close', r));
    console.log(`wrote ${out} (${frames} frames @ ${FPS}fps)`);
  }
  await browser.close();
  server.close();
});
