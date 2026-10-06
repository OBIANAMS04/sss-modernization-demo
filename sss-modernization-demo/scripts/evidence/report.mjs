// Builds a story's evidence pack from <dir>/evidence.json and the screenshots next to it:
//   README.md            the summary, checks and every screenshot with its caption (committed; GitHub renders it)
//   <id>-evidence.pdf    the same, one full-size page per screenshot, for attaching to Basecamp (not committed)
//
// Usage (from sss-modernization-demo/): node scripts/evidence/report.mjs docs/evidence/story-008
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch } from './browser.mjs';

const dir = resolve(process.argv[2] || '.');
const ev = JSON.parse(readFileSync(join(dir, 'evidence.json'), 'utf8'));
const WIDTH = 1280;
const CAPTION = 150; // px reserved above each screenshot for its title and caption

const pngSize = (file) => {
  const bytes = readFileSync(join(dir, file));
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
};
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const list = (items) => items.map((i) => `- ${i}`).join('\n');

writeFileSync(
  join(dir, 'README.md'),
  `# ${ev.title}

${ev.summary.join('\n\n')}

## Checks

${list(ev.checks)}

## Screens

${ev.shots.map((s, i) => `### ${i + 1}. ${s.title}\n\n${s.caption}\n\n![${s.title}](${s.file})`).join('\n\n')}

## Notes

${list(ev.notes)}

_Built by \`scripts/evidence/report.mjs\` from \`evidence.json\`. Screenshots by \`${ev.capturedBy}\`._
`
);

const pages = ev.shots.map((s, i) => ({ ...s, n: i + 1, ...pngSize(s.file) }));
const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(ev.title)}</title><style>
  body { margin: 0; font-family: 'Segoe UI', Arial, sans-serif; color: #111827; }
  @page cover { size: ${WIDTH}px 1500px; margin: 0; }
  .cover { page: cover; padding: 56px 72px; }
  .cover h1 { font-size: 34px; margin: 0 0 24px; }
  .cover h2 { font-size: 22px; margin: 28px 0 8px; }
  .cover p, .cover li { font-size: 18px; line-height: 1.5; }
  ${pages.map((p) => `@page s${p.n} { size: ${WIDTH}px ${p.height + CAPTION}px; margin: 0; } .s${p.n} { page: s${p.n}; }`).join('\n  ')}
  .shot { break-before: page; }
  .cap { height: ${CAPTION}px; box-sizing: border-box; padding: 22px 36px; background: #eef2ff; border-bottom: 2px solid #c7d2fe; overflow: hidden; }
  .cap h2 { margin: 0 0 8px; font-size: 24px; }
  .cap p { margin: 0; font-size: 17px; line-height: 1.45; }
  .shot img { display: block; width: ${WIDTH}px; }
</style></head><body>
<section class="cover">
  <h1>${esc(ev.title)}</h1>
  ${ev.summary.map((p) => `<p>${esc(p)}</p>`).join('\n  ')}
  <h2>Checks</h2><ul>${ev.checks.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
  <h2>Screens</h2><ol>${pages.map((p) => `<li>${esc(p.title)}</li>`).join('')}</ol>
  <h2>Notes</h2><ul>${ev.notes.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
</section>
${pages
  .map(
    (p) => `<section class="shot s${p.n}"><div class="cap"><h2>${p.n}. ${esc(p.title)}</h2><p>${esc(p.caption)}</p></div><img src="${p.file}" alt=""></section>`
  )
  .join('\n')}
</body></html>`;

const htmlFile = join(dir, '_report.html');
writeFileSync(htmlFile, html);
const page = await launch({ width: WIDTH });
try {
  await page.goto(pathToFileURL(htmlFile).href);
  await page.pdf(join(dir, `${ev.id}-evidence.pdf`));
} finally {
  await page.close();
  rmSync(htmlFile, { force: true });
}
console.log(`wrote README.md and ${ev.id}-evidence.pdf in ${dir}`);
