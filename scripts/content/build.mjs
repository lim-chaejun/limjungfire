#!/usr/bin/env node
// 콘텐츠 생성기 — 기준 페이지(standards/), 글(news/·guide/·qa/), 색인, sitemap.xml, news/feed.xml
//
//   node scripts/content/build.mjs                      생성 (저장소에 씀)
//   node scripts/content/build.mjs --check              커밋된 결과가 최신인지 확인 (CI 용, 다르면 exit 1)
//   node scripts/content/build.mjs --drafts --out DIR   초안까지 렌더링한 미리보기를 저장소 밖 DIR 에 씀
//   --root DIR                                          다른 사이트 루트 (테스트용)
//
// 종료 코드: 0 성공·최신, 1 생성 결과가 오래됨(--check), 2 콘텐츠·데이터 오류 또는 잘못된 사용.
// 의존성 없음(Node 22). 시계를 쓰지 않으므로 같은 입력이면 항상 같은 출력이 나온다.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MANAGED_DIRS, POST_TYPES } from './lib/config.mjs';
import { loadConfig, loadSiteData, loadStaticPageSettings } from './lib/data.mjs';
import { buildStandards } from './lib/standards.mjs';
import { loadPosts, isPublished, byNewest, renderPost, renderIndex } from './lib/posts.mjs';
import { discoverStaticPages, staticSitemapEntries, renderSitemap, renderRss } from './lib/feeds.mjs';
import { BuildError, GENERATED_MARKER, SITE_URL } from './lib/util.mjs';

export const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const SITEMAP_HINTS = {
  'standards-hub': ['weekly', '0.8'],
  'standards-use': ['monthly', '0.7'],
  'standards-facility': ['monthly', '0.6'],
  post: ['monthly', '0.6'],
  index: ['weekly', '0.6'],
};

/**
 * 사이트 전체를 메모리에서 만든다 (디스크에 쓰지 않음).
 * @returns {{ files: Map<string,string>, pages: object[], warnings: string[], sitemapCount: number }}
 */
export function buildSite({ root = DEFAULT_ROOT, includeDrafts = false } = {}) {
  const warnings = [];
  const config = loadConfig(root);
  const site = loadSiteData(root, config);
  const posts = loadPosts(root);
  const published = posts.filter(isPublished);
  const rendered = includeDrafts ? posts : published;

  const standards = buildStandards(site, config, { latestPosts: [...published].sort(byNewest).slice(0, 5) });

  // 관련 링크 글자와 경로 검사용 제목 목록
  const staticPages = discoverStaticPages(root);
  const titles = new Map();
  for (const p of staticPages) titles.set(p.path, p.title);
  for (const p of standards) titles.set(p.path, p.title);
  for (const def of Object.values(POST_TYPES)) titles.set(def.indexPath, def.indexTitle);
  for (const p of rendered) titles.set(p.url, p.data.title);

  for (const p of posts) {
    for (const r of p.data.related) {
      if (titles.has(r.split('#')[0])) continue;
      const msg = `${p.file}: related 경로를 찾을 수 없습니다: ${r} (확장자 없는 사이트 경로, 예: /standards/facility/sprinkler)`;
      if (isPublished(p)) throw new BuildError(msg);
      warnings.push(msg);
    }
  }

  const postPages = rendered.map((p) => ({
    kind: 'post',
    type: p.type,
    path: p.url,
    file: p.outFile,
    title: p.data.title,
    date: p.data.date,
    indexable: isPublished(p),
    lastmod: p.data.updated,
    html: renderPost(p, titles, { preview: includeDrafts }),
  }));
  const indexPages = Object.keys(POST_TYPES).map((type) => ({ ...renderIndex(type, rendered), type }));

  // 사이트맵 순서: 기준 페이지 → 유형별 색인과 글(최신순)
  const ordered = [...standards];
  for (const type of Object.keys(POST_TYPES)) {
    ordered.push(indexPages.find((p) => p.type === type));
    ordered.push(...postPages.filter((p) => p.type === type).sort((a, b) => b.lastmod.localeCompare(a.lastmod) || b.date.localeCompare(a.date) || a.path.localeCompare(b.path)));
  }

  const files = new Map();
  for (const p of ordered) {
    if (files.has(p.file)) throw new BuildError(`같은 출력 파일을 두 페이지가 씁니다: ${p.file}`);
    // 손으로 쓴 파일과 겹치면 멈춘다 (예: content/guide/sprinkler.md ↔ guide/sprinkler.html)
    const abs = path.join(root, p.file);
    if (fs.existsSync(abs) && !fs.readFileSync(abs, 'utf8').includes(GENERATED_MARKER)) {
      throw new BuildError(`손으로 쓴 파일과 경로가 겹칩니다: ${p.file} — 글 파일 이름(슬러그)을 바꾸세요`);
    }
    files.set(p.file, p.html);
  }

  const hint =(p) => SITEMAP_HINTS[p.kind] || (p.kind.startsWith('index-') ? SITEMAP_HINTS.index : SITEMAP_HINTS.post);
  const sitemapEntries = [
    ...staticSitemapEntries(staticPages, loadStaticPageSettings(root)),
    ...ordered
      .filter((p) => p.indexable)
      .map((p) => ({ loc: `${SITE_URL}${p.path}`, lastmod: p.lastmod, changefreq: hint(p)[0], priority: hint(p)[1] })),
  ];
  files.set('sitemap.xml', renderSitemap(sitemapEntries));
  files.set('news/feed.xml', renderRss(published.filter((p) => p.type === 'news').sort(byNewest)));

  return { files, pages: ordered, warnings, sitemapCount: sitemapEntries.length, preview: includeDrafts };
}

/** 관리 폴더에서 생성 표시가 있는 파일 (posix 상대 경로) */
export function findGeneratedFiles(dir) {
  const out = [];
  const walk = (rel) => {
    const abs = path.join(dir, rel);
    if (!fs.existsSync(abs)) return;
    for (const ent of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const child = `${rel}/${ent.name}`;
      if (ent.isDirectory()) walk(child);
      else if (ent.name.endsWith('.html') && fs.readFileSync(path.join(dir, child), 'utf8').includes(GENERATED_MARKER)) out.push(child);
    }
  };
  for (const d of MANAGED_DIRS) walk(d);
  return out;
}

const normalize = (s) => s.replace(/\r\n/g, '\n');

/** 디스크에 쓰기: 바뀐 파일만 쓰고, 더는 만들지 않는 생성 파일은 지운다 */
export function writeOutputs(outDir, files) {
  const removed = findGeneratedFiles(outDir).filter((f) => !files.has(f));
  for (const f of removed) fs.rmSync(path.join(outDir, f));
  let written = 0;
  for (const [f, content] of files) {
    const abs = path.join(outDir, f);
    if (fs.existsSync(abs) && normalize(fs.readFileSync(abs, 'utf8')) === content) continue;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    written++;
  }
  return { written, removed };
}

/** 커밋된 결과와 비교 (줄바꿈 CRLF/LF 차이는 무시) → 문제 목록 */
export function checkOutputs(root, files) {
  const problems = [];
  for (const [f, content] of files) {
    const abs = path.join(root, f);
    if (!fs.existsSync(abs)) problems.push(`없음: ${f}`);
    else if (normalize(fs.readFileSync(abs, 'utf8')) !== content) problems.push(`다름: ${f}`);
  }
  for (const f of findGeneratedFiles(root)) if (!files.has(f)) problems.push(`남은 생성 파일: ${f}`);
  return problems;
}

function parseArgs(argv) {
  const opts = { check: false, drafts: false, root: DEFAULT_ROOT, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') opts.check = true;
    else if (a === '--drafts') opts.drafts = true;
    else if (a === '--root' || a === '--out') {
      const v = argv[++i];
      if (!v) throw new BuildError(`${a} 뒤에 폴더가 필요합니다`);
      opts[a.slice(2)] = path.resolve(v);
    } else if (a === '--help' || a === '-h') opts.help = true;
    else throw new BuildError(`알 수 없는 옵션: ${a}`);
  }
  if (opts.drafts) {
    if (opts.check) throw new BuildError('--drafts 와 --check 는 함께 쓸 수 없습니다');
    const rel = opts.out ? path.relative(opts.root, opts.out) : '';
    if (!opts.out || rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
      throw new BuildError('--drafts 미리보기는 저장소 밖 폴더(--out DIR)에만 씁니다 — 초안이 게시되지 않도록');
    }
  }
  return opts;
}

function summary(result) {
  const count = (kind) => result.pages.filter((p) => p.kind === kind).length;
  const noindex = result.pages.filter((p) => !p.indexable).map((p) => p.path);
  return [
    `기준 페이지: 허브 ${count('standards-hub')}, 용도 ${count('standards-use')}, 시설 ${count('standards-facility')}`,
    `글: ${result.pages.filter((p) => p.kind === 'post').length}건${result.preview ? ' (초안 포함 미리보기)' : ' (승인된 글만)'}`,
    `noindex ${noindex.length}건${noindex.length ? `: ${noindex.join(', ')}` : ''}`,
    `사이트맵 URL ${result.sitemapCount}개`,
  ].join('\n');
}

export function main(argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = parseArgs(argv);
    if (opts.help) {
      console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 9).join('\n'));
      return 0;
    }
    const result = buildSite({ root: opts.root, includeDrafts: opts.drafts });
    for (const w of result.warnings) console.warn(`경고: ${w}`);
    if (opts.check) {
      const problems = checkOutputs(opts.root, result.files);
      if (problems.length) {
        console.error(`생성 결과가 최신이 아닙니다 (${problems.length}건). node scripts/content/build.mjs 를 실행해 결과를 커밋하세요.`);
        for (const p of problems.slice(0, 50)) console.error(`  ${p}`);
        if (problems.length > 50) console.error(`  … 외 ${problems.length - 50}건`);
        return 1;
      }
      console.log(`생성 결과 최신 (${result.files.size}개 파일)`);
      return 0;
    }
    const outDir = opts.out || opts.root;
    const { written, removed } = writeOutputs(outDir, result.files);
    console.log(summary(result));
    console.log(`파일 ${result.files.size}개 중 ${written}개 씀, ${removed.length}개 지움${removed.length ? ` (${removed.join(', ')})` : ''} → ${outDir}`);
    return 0;
  } catch (e) {
    if (e instanceof BuildError) {
      console.error(`오류: ${e.message}`);
      return 2;
    }
    throw e;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
