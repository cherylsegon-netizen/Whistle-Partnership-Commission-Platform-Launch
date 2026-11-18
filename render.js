// Renders index.html frame-by-frame to an MP4 for LinkedIn.
// Usage: node render.js [out.mp4] [--stills]   (needs playwright + ffmpeg on PATH)
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const FPS = 30, SIZE = 1080;
const out = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'out/whistle-partner-launch-1080.mp4';
const stillsOnly = process.argv.includes('--stills');
const STILLS = [1600, 4200, 7300, 9700, 11700, 13500, 15200, 17500];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 });
  await page.goto('file://' + path.resolve(__dirname, 'index.html') + '?render');
  await page.evaluate(() => document.fonts.ready);
  const duration = await page.evaluate(() => window.DURATION);
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });

  if (stillsOnly) {
    for (const ms of STILLS) {
      await page.evaluate(t => window.seek(t), ms);
      await page.screenshot({ path: `out/still-${String(ms).padStart(5, '0')}.png` });
    }
    await browser.close();
    return;
  }

  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out],
    { stdio: ['pipe', 'inherit', 'inherit'] });
  const frames = Math.round(duration / 1000 * FPS);
  for (let f = 0; f < frames; f++) {
    await page.evaluate(t => window.seek(t), (f * 1000) / FPS);
    const buf = await page.screenshot({ type: 'png' });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
  }
  ff.stdin.end();
  await new Promise(r => ff.on('close', r));
  await browser.close();
  console.log(`wrote ${out} (${frames} frames @ ${FPS}fps)`);
})();
