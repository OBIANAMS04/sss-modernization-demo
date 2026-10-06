// Prints an artifact page (an HTML fragment without <html>/<body>, as published to claude.ai) to PDF,
// for sources such as NotebookLM. Images resolve relative to the page. Optionally saves a preview PNG.
//   node scripts/evidence/print-pdf.mjs <page.html> <out.pdf> [preview.png]
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch } from './browser.mjs';

const [src, out, preview] = process.argv.slice(2).map((p) => p && resolve(p));
if (!src || !out) throw new Error('usage: print-pdf.mjs <page.html> <out.pdf> [preview.png]');

// The publish step wraps pages in a standards-mode skeleton; do the same so print matches the artifact.
const wrapped = join(dirname(src), '_print.html');
writeFileSync(wrapped, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${readFileSync(src, 'utf8')}</body></html>`);
const page = await launch({ width: 1100 });
try {
  await page.goto(pathToFileURL(wrapped).href);
  await page.evaluate(`Promise.all([document.fonts.ready, ...[...document.images].map((i) => { i.loading = 'eager'; return i.decode().catch(() => {}); })])`);
  if (preview) await page.screenshot(preview);
  await page.pdf(out);
} finally {
  await page.close();
  rmSync(wrapped, { force: true });
}
console.log(`wrote ${out}${preview ? ` and ${preview}` : ''}`);
