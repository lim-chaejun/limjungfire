import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSite } from '../build.mjs';
import { rfc822 } from '../lib/util.mjs';
import { makeFixture, write, xmlProblems, APPROVED_NEWS } from './helpers.mjs';

const locs = (xml) => [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);

test('사이트맵: 올바른 XML, 확장자 없는 절대 주소, 중복 없음, lastmod 는 YYYY-MM-DD', () => {
  const r = buildSite({ root: makeFixture() });
  const xml = r.files.get('sitemap.xml');
  assert.deepEqual(xmlProblems(xml), []);
  assert.ok(xml.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'));
  const all = locs(xml);
  assert.equal(all.length, r.sitemapCount);
  assert.equal(new Set(all).size, all.length, '중복 없음');
  for (const loc of all) {
    assert.match(loc, /^https:\/\/sobangcheck\.com\//, loc);
    assert.ok(!/\.html$/.test(loc), `확장자 없는 주소: ${loc}`);
  }
  for (const [, d] of xml.matchAll(/<lastmod>([^<]*)<\/lastmod>/g)) assert.match(d, /^\d{4}-\d{2}-\d{2}$/);
  // 날짜 근거(설정·dateModified)가 없는 손으로 쓴 페이지만 lastmod 를 비운다 — 지어내지 않는다
  const undated = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => m[1]).filter((b) => !b.includes('<lastmod>')).map((b) => /<loc>([^<]*)</.exec(b)[1]);
  assert.deepEqual(undated, ['https://sobangcheck.com/pages/about', 'https://sobangcheck.com/pages/checklist', 'https://sobangcheck.com/pages/timeline']);
});

test('사이트맵: 손으로 쓴 페이지(설정 순서 먼저) + noindex·관리자 페이지 제외 + 생성 페이지', () => {
  const r = buildSite({ root: makeFixture() });
  const all = locs(r.files.get('sitemap.xml'));
  assert.deepEqual(all.slice(0, 5), [
    'https://sobangcheck.com/',
    'https://sobangcheck.com/guide/sprinkler',
    'https://sobangcheck.com/pages/about',
    'https://sobangcheck.com/pages/checklist',
    'https://sobangcheck.com/pages/timeline',
  ]);
  assert.ok(!all.includes('https://sobangcheck.com/pages/privacy'), 'noindex 페이지');
  assert.ok(!all.some((l) => l.includes('admin')), '관리자 페이지');
  assert.ok(all.includes('https://sobangcheck.com/standards/'));
  assert.ok(all.includes('https://sobangcheck.com/news/'));
  assert.ok(all.includes('https://sobangcheck.com/news/rack-warehouse'));
  assert.ok(all.includes('https://sobangcheck.com/guide/articles'));
});

test('사이트맵 lastmod: 설정값과 페이지 dateModified 중 늦은 날 / 기준 페이지는 데이터 기준일 / 글은 updated', () => {
  const xml = buildSite({ root: makeFixture() }).files.get('sitemap.xml');
  const lastmodOf = (loc) => new RegExp(`<loc>${loc.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}</loc>\\s*<lastmod>([^<]+)</lastmod>`).exec(xml)?.[1];
  assert.equal(lastmodOf('https://sobangcheck.com/guide/sprinkler'), '2026-09-26', 'dateModified 가 더 늦다');
  assert.equal(lastmodOf('https://sobangcheck.com/'), '2026-01-21');
  assert.equal(lastmodOf('https://sobangcheck.com/standards/use/residential-complex'), '2026-09-27', '데이터 기준일과 첫 게시일 중 늦은 날');
  assert.equal(lastmodOf('https://sobangcheck.com/news/rack-warehouse'), '2026-09-21');
  assert.equal(lastmodOf('https://sobangcheck.com/news/'), '2026-09-21', '색인은 가장 늦은 글');
});

test('RSS 2.0: 올바른 XML, 채널 필수 요소, 승인된 소식만, RFC 822 날짜, 영구 링크 guid', () => {
  const root = makeFixture();
  write(root, 'content/news/second.md', APPROVED_NEWS.replace('date: 2026-09-20', 'date: 2026-09-22').replace('updated: 2026-09-21', 'updated: 2026-09-22').replace('랙식 창고', '두 번째 & <소식>'));
  const xml = buildSite({ root }).files.get('news/feed.xml');
  assert.deepEqual(xmlProblems(xml), []);
  assert.ok(xml.includes('<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">'));
  for (const tag of ['title', 'link', 'description', 'language']) assert.match(xml, new RegExp(`<channel>[\\s\\S]*<${tag}>[^<]+</${tag}>`), tag);
  assert.ok(xml.includes('<atom:link href="https://sobangcheck.com/news/feed.xml" rel="self" type="application/rss+xml"/>'));
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  assert.equal(items.length, 2);
  assert.ok(items[0].includes('<link>https://sobangcheck.com/news/second</link>'), '최신 글이 먼저');
  assert.ok(items[0].includes('두 번째 &amp; &lt;소식&gt;'), '제목 이스케이프');
  for (const it of items) {
    assert.match(it, /<pubDate>(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} 00:00:00 \+0900<\/pubDate>/);
    assert.match(it, /<guid isPermaLink="true">https:\/\/sobangcheck\.com\/news\/[a-z0-9-]+<\/guid>/);
  }
  assert.ok(!xml.includes('draft-news'));
  assert.match(xml, /<lastBuildDate>Tue, 22 Sep 2026 00:00:00 \+0900<\/lastBuildDate>/);
});

test('rfc822 요일 계산', () => {
  assert.equal(rfc822('2026-09-27'), 'Sun, 27 Sep 2026 00:00:00 +0900');
  assert.equal(rfc822('2024-02-29'), 'Thu, 29 Feb 2024 00:00:00 +0900');
  assert.equal(rfc822('2000-01-01'), 'Sat, 01 Jan 2000 00:00:00 +0900');
});
