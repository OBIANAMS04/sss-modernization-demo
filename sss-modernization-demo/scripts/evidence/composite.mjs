// Combines several screenshots into one labelled JPEG under a size budget, so a Basecamp post can carry
// many screens in its one attachment (Colaberry accepts about 700 KB per file).
//   node scripts/evidence/composite.mjs <spec.json>
// spec.json: { "out": "path.jpg", "maxKb": 650, "title": "…", "columns": 2, "tileWidth": 960,
//              "tiles": [{ "file": "path.png", "label": "…", "top": 0, "height": 900, "natural": false }] }
// Paths are relative to the spec file. top/height crop each screenshot before it is scaled to tileWidth.
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { launch } from './browser.mjs';

const specPath = resolve(process.argv[2]);
const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const base = dirname(specPath);

// Ali, 2026-10-12: the image attached to a post must carry every screen in the evidence pack, or the thread
// and the pack disagree. Next to an evidence.json, refuse to build while any of its screens is left out.
const evidence = resolve(base, 'evidence.json');
if (existsSync(evidence)) {
  const missing = JSON.parse(readFileSync(evidence, 'utf8')).shots.map((s) => s.file).filter((f) => !spec.tiles.some((t) => t.file === f));
  if (missing.length) {
    console.error(`The composite leaves out evidence screens: ${missing.join(', ')}. Add a tile for each.`);
    process.exit(1);
  }
}
const tiles = spec.tiles.map((t) => ({ ...t, data: readFileSync(resolve(base, t.file)).toString('base64') }));

const page = await launch();
try {
  const draw = `(async () => {
    const spec = ${JSON.stringify({ title: spec.title, columns: spec.columns || 2, tileWidth: spec.tileWidth || 960 })};
    const tiles = ${JSON.stringify(tiles)};
    const gap = 24, label = 44, head = spec.title ? 72 : 0;
    const images = await Promise.all(tiles.map(async (t) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + t.data; await img.decode();
      const top = t.top || 0, height = Math.min(t.height || img.height, img.height - top);
      // natural: a narrow capture (e.g. a 320 px phone view) keeps its own size, centred, instead of being enlarged
      const width = t.natural ? Math.min(img.width, spec.tileWidth) : spec.tileWidth;
      return { img, top, height, width, scaled: Math.round(height * width / img.width), label: t.label };
    }));
    const rows = [];
    for (let i = 0; i < images.length; i += spec.columns) rows.push(images.slice(i, i + spec.columns));
    const rowHeights = rows.map((r) => Math.max(...r.map((t) => t.scaled)) + label);
    const c = document.createElement('canvas');
    c.width = spec.columns * spec.tileWidth + (spec.columns + 1) * gap;
    c.height = head + rowHeights.reduce((a, b) => a + b + gap, gap);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#e9eef5'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#15202f';
    if (spec.title) { ctx.font = 'bold 34px Segoe UI, Arial, sans-serif'; ctx.fillText(spec.title, gap, 50); }
    let y = head + gap;
    rows.forEach((row, ri) => {
      row.forEach((t, ci) => {
        const x = gap + ci * (spec.tileWidth + gap);
        ctx.fillStyle = '#15202f'; ctx.font = 'bold 26px Segoe UI, Arial, sans-serif';
        ctx.fillText(t.label, x, y + 30);
        ctx.imageSmoothingQuality = 'high';
        const left = x + Math.round((spec.tileWidth - t.width) / 2);
        ctx.drawImage(t.img, 0, t.top, t.img.width, t.height, left, y + label, t.width, t.scaled);
        ctx.strokeStyle = '#b8c4d4'; ctx.lineWidth = 2; ctx.strokeRect(left, y + label, t.width, t.scaled);
      });
      y += rowHeights[ri] + gap;
    });
    window.__canvas = c;
    return [c.width, c.height];
  })()`;
  const [width, height] = await page.evaluate(draw);
  const out = resolve(base, spec.out);
  for (const quality of [0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6]) {
    const url = await page.evaluate(`window.__canvas.toDataURL('image/jpeg', ${quality})`);
    writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
    const kb = Math.round(statSync(out).size / 1024);
    if (kb <= (spec.maxKb || 650) || quality === 0.6) {
      console.log(`wrote ${out}: ${width}x${height}, ${kb} KB at quality ${quality}`);
      if (kb > (spec.maxKb || 650)) console.log('WARNING: still over the size budget; use fewer or shorter tiles');
      break;
    }
  }
} finally {
  await page.close();
}
