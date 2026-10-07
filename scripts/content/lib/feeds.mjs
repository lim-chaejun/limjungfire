// sitemap.xml·RSS 와 손으로 쓴 페이지 찾기
//
// 사이트맵 = 손으로 쓴 페이지(canonical 이 있고 noindex 가 아닌 index.html·pages/·guide/) + 생성 페이지(indexable).
// lastmod: 손으로 쓴 페이지는 content/static-pages.json 의 lastmod 와 페이지 JSON-LD dateModified 중 늦은 날,
//          기준 페이지는 데이터 기준일, 글은 프론트매터 updated.

import fs from 'node:fs';
import path from 'node:path';
import { SITE_URL, SITE_NAME, GENERATED_MARKER, BuildError, esc, rfc822, isValidIsoDate, maxIso } from './util.mjs';

const xmlEsc = esc;

/** index.html, pages/*.html, guide/*.html 중 손으로 쓴 페이지 → [{path, loc, title, lastmod, noindex, file}] */
export function discoverStaticPages(root) {
  const files = ['index.html'];
  for (const dir of ['pages', 'guide']) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs).filter((x) => x.endsWith('.html')).sort()) files.push(`${dir}/${f}`);
  }
  const pages = [];
  for (const file of files) {
    const abs = path.join(root, file);
    if (!fs.existsSync(abs)) continue;
    const html = fs.readFileSync(abs, 'utf8');
    if (html.includes(GENERATED_MARKER)) continue;
    const canon = /<link\s+rel="canonical"\s+href="([^"]+)"/i.exec(html);
    if (!canon || !canon[1].startsWith(`${SITE_URL}/`)) continue;
    const loc = canon[1];
    const title = (/<title>([^<]*)<\/title>/i.exec(html)?.[1] || '').replace(/\s*\|\s*소방체크\s*$/, '').trim();
    const dm = /"dateModified"\s*:\s*"(\d{4}-\d{2}-\d{2})"/.exec(html)?.[1];
    pages.push({
      file,
      loc,
      path: loc.slice(SITE_URL.length),
      title,
      dateModified: dm && isValidIsoDate(dm) ? dm : null,
      noindex: /<meta\s+name="robots"\s+content="[^"]*noindex/i.test(html),
    });
  }
  return pages;
}

/** 사이트맵 항목: 손으로 쓴 페이지 (설정 순서 먼저, 나머지는 경로순) */
export function staticSitemapEntries(discovered, settings) {
  const byPath = new Map(discovered.filter((p) => !p.noindex).map((p) => [p.path, p]));
  const out = [];
  const used = new Set();
  for (const s of settings) {
    const p = byPath.get(s.path);
    if (!p) continue; // 없어졌거나 noindex 가 된 페이지
    used.add(s.path);
    out.push({ loc: p.loc, lastmod: maxIso(s.lastmod, p.dateModified), changefreq: s.changefreq, priority: s.priority });
  }
  for (const p of [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path))) {
    if (used.has(p.path)) continue;
    out.push({ loc: p.loc, lastmod: p.dateModified, changefreq: 'monthly', priority: '0.5' });
  }
  return out;
}

export function renderSitemap(entries) {
  const seen = new Set();
  for (const e of entries) {
    if (seen.has(e.loc)) throw new BuildError(`사이트맵에 같은 주소가 두 번 있습니다: ${e.loc}`);
    seen.add(e.loc);
  }
  const urls = entries
    .map((e) =>
      [
        '  <url>',
        `    <loc>${xmlEsc(e.loc)}</loc>`,
        e.lastmod ? `    <lastmod>${xmlEsc(e.lastmod)}</lastmod>` : null,
        e.changefreq ? `    <changefreq>${xmlEsc(e.changefreq)}</changefreq>` : null,
        e.priority ? `    <priority>${xmlEsc(e.priority)}</priority>` : null,
        '  </url>',
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- scripts/content/build.mjs 가 만든 파일입니다. 직접 고치지 말고 content/static-pages.json 이나 content/·data/ 를 고친 뒤 다시 생성하세요. -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

/** RSS 2.0 — 승인된 법령 개정 소식 */
export function renderRss(newsPosts) {
  const channelLink = `${SITE_URL}/news/`;
  const items = newsPosts
    .map((p) => {
      const url = `${SITE_URL}${p.url}`;
      return [
        '    <item>',
        `      <title>${xmlEsc(p.data.title)}</title>`,
        `      <link>${xmlEsc(url)}</link>`,
        `      <guid isPermaLink="true">${xmlEsc(url)}</guid>`,
        `      <pubDate>${rfc822(p.data.date)}</pubDate>`,
        `      <description>${xmlEsc(p.data.description)}</description>`,
        ...p.data.tags.map((t) => `      <category>${xmlEsc(t)}</category>`),
        '    </item>',
      ].join('\n');
    })
    .join('\n');
  const last = newsPosts.map((p) => p.data.updated).sort().at(-1);
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${SITE_NAME} 법령 개정 소식</title>
    <link>${channelLink}</link>
    <description>소방시설 설치기준과 화재안전기준(NFPC·NFSC) 개정 소식</description>
    <language>ko</language>
    <atom:link href="${SITE_URL}/news/feed.xml" rel="self" type="application/rss+xml"/>
${last ? `    <lastBuildDate>${rfc822(last)}</lastBuildDate>\n` : ''}${items ? `${items}\n` : ''}  </channel>
</rss>
`;
}
