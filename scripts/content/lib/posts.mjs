// 글(법령 개정 소식·실무 가이드·질문·사례) — content/<type>/*.md
//
// status: approved 인 글만 페이지·색인·사이트맵·RSS 에 들어간다. draft 는 검사만 하고 렌더링하지 않는다.

import fs from 'node:fs';
import path from 'node:path';
import { POST_TYPES, RESERVED_SLUGS } from './config.mjs';
import { splitFrontmatter } from './frontmatter.mjs';
import { renderMarkdown } from './markdown.mjs';
import { BuildError, esc, isValidIsoDate, safeHref, SLUG_RE } from './util.mjs';
import {
  renderPage,
  pageHeader,
  section,
  ctaBox,
  sourcesSection,
  relatedSection,
  articleSchema,
  collectionSchema,
  faqSchema,
  metaModified,
  timeKo,
  DISCLAIMER,
} from './template.mjs';

const FIELDS = ['title', 'description', 'date', 'updated', 'status', 'tags', 'related', 'sources', 'faq'];
const STATUSES = ['draft', 'approved'];

function check(cond, file, msg) {
  if (!cond) throw new BuildError(`${file}: ${msg}`);
}

const isText = (v) => typeof v === 'string' && v.trim() !== '';

/** 프론트매터 검사 → 정규화된 data */
export function validatePost(raw, file) {
  for (const key of Object.keys(raw)) check(FIELDS.includes(key), file, `알 수 없는 키 "${key}" (허용: ${FIELDS.join(', ')})`);
  check(isText(raw.title), file, 'title 이 필요합니다');
  check(isText(raw.description), file, 'description 이 필요합니다');
  check(isValidIsoDate(raw.date), file, 'date 는 YYYY-MM-DD 날짜여야 합니다');
  if (raw.updated !== undefined && raw.updated !== null) {
    check(isValidIsoDate(raw.updated), file, 'updated 는 YYYY-MM-DD 날짜여야 합니다');
    check(raw.updated >= raw.date, file, 'updated 가 date 보다 이릅니다');
  }
  check(STATUSES.includes(raw.status), file, `status 는 ${STATUSES.join(' 또는 ')} 이어야 합니다`);

  const list = (key) => {
    const v = raw[key];
    if (v === undefined || v === null) return [];
    check(Array.isArray(v), file, `${key} 는 목록이어야 합니다`);
    return v;
  };
  const tags = list('tags');
  tags.forEach((t) => check(isText(t), file, 'tags 항목은 글자여야 합니다'));
  const related = list('related');
  related.forEach((r) => check(typeof r === 'string' && /^\/(?![/\\])\S*$/.test(r), file, `related 는 / 로 시작하는 사이트 경로여야 합니다: ${r}`));
  const sources = list('sources');
  check(sources.length > 0, file, 'sources 가 하나 이상 필요합니다 (법령 원문 링크)');
  sources.forEach((s) => {
    check(s && typeof s === 'object' && !Array.isArray(s), file, 'sources 항목은 label·url 사전이어야 합니다');
    for (const k of Object.keys(s)) check(k === 'label' || k === 'url', file, `sources 항목의 알 수 없는 키 "${k}"`);
    check(isText(s.label), file, 'sources 항목에 label 이 필요합니다');
    check(typeof s.url === 'string' && /^https:\/\//.test(s.url) && safeHref(s.url), file, `sources url 은 https:// 주소여야 합니다: ${s.url}`);
  });
  const faq = list('faq');
  faq.forEach((f) => {
    check(f && typeof f === 'object' && !Array.isArray(f), file, 'faq 항목은 q·a 사전이어야 합니다');
    for (const k of Object.keys(f)) check(k === 'q' || k === 'a', file, `faq 항목의 알 수 없는 키 "${k}"`);
    check(isText(f.q) && isText(f.a), file, 'faq 항목에는 q 와 a 가 필요합니다');
  });

  return {
    title: raw.title.trim(),
    description: raw.description.trim(),
    date: raw.date,
    updated: raw.updated || raw.date,
    status: raw.status,
    tags,
    related,
    sources,
    faq,
  };
}

/** 글 읽기 (content/<type>/*.md). 형식 오류는 BuildError */
export function loadPosts(root) {
  const posts = [];
  for (const [type, def] of Object.entries(POST_TYPES)) {
    const dir = path.join(root, 'content', def.dir);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
      const rel = `content/${def.dir}/${name}`;
      const slug = name.slice(0, -3);
      check(SLUG_RE.test(slug), rel, '파일 이름(슬러그)은 영문 소문자·숫자·하이픈만 씁니다 (예: sprinkler-6th-floor.md)');
      check(!RESERVED_SLUGS.has(slug), rel, `예약된 이름입니다: ${slug}`);
      const { data, body } = splitFrontmatter(fs.readFileSync(path.join(dir, name), 'utf8'), rel);
      const clean = validatePost(data, rel);
      check(body.trim() !== '', rel, '본문이 비어 있습니다');
      posts.push({
        type,
        typeLabel: def.label,
        slug,
        file: rel,
        url: `/${def.dir}/${slug}`,
        outFile: `${def.dir}/${slug}.html`,
        data: clean,
        body,
      });
    }
  }
  return posts;
}

export const isPublished = (p) => p.data.status === 'approved';

/** 최신순: 수정일 ↓, 게시일 ↓, 슬러그 ↑ */
export const byNewest = (a, b) =>
  b.data.updated.localeCompare(a.data.updated) || b.data.date.localeCompare(a.data.date) || a.slug.localeCompare(b.slug);

function faqHtml(faq) {
  return `<dl class="ce-faq">
${faq.map((f) => `<dt>${esc(f.q)}</dt>\n<dd>${esc(f.a)}</dd>`).join('\n')}
</dl>`;
}

/** 글 페이지. titles: 경로 → 제목 (관련 링크 글자) */
export function renderPost(post, titles, { preview = false } = {}) {
  const def = POST_TYPES[post.type];
  const d = post.data;
  const schemaType = def.schemaType;
  const meta = [
    `게시 ${timeKo(d.date)}`,
    metaModified(d.updated),
    d.status === 'approved'
      ? '<span class="ce-badge ce-badge--ok">운영자 검수 완료</span>'
      : '<span class="ce-badge ce-badge--warn">초안 — 검수 전</span>',
  ];
  const related = d.related.map((p) => ({ path: p, title: titles.get(p) || p }));
  const body = `<article class="ce-article">
${pageHeader({ kicker: def.label, title: d.title, lede: d.description, meta, tags: d.tags })}
<div class="ce-prose">
${renderMarkdown(post.body)}
</div>
${d.faq.length ? section({ id: 'faq', title: '자주 묻는 질문', body: faqHtml(d.faq) }) : ''}
${ctaBox()}
${sourcesSection(d.sources, { intro: '법령 인용은 국가법령정보센터(law.go.kr) 등 원문을 기준으로 합니다.' })}
${relatedSection(related)}
${DISCLAIMER}
</article>`;

  const schema = [articleSchema({ type: schemaType, path: post.url, title: d.title, description: d.description, published: d.date, modified: d.updated, keywords: d.tags })];
  // FAQPage 는 FAQ 를 화면에 보일 때만
  if (d.faq.length) schema.push(faqSchema(d.faq));

  return renderPage({
    path: post.url,
    title: d.title,
    description: d.description,
    noindex: preview || d.status !== 'approved',
    breadcrumbs: [{ name: '홈', path: '/' }, { name: def.label, path: def.indexPath }, { name: d.title }],
    schema,
    published: d.date,
    modified: d.updated,
    feed: post.type === 'news' ? { title: '소방체크 법령 개정 소식', href: '/news/feed.xml' } : undefined,
    body,
  });
}

/** 유형별 색인 페이지 (/news/, /qa/, /guide/articles). 글이 없으면 noindex */
export function renderIndex(type, posts) {
  const def = POST_TYPES[type];
  const list = posts.filter((p) => p.type === type).sort(byNewest);
  const lastmod = list.length ? list.map((p) => p.data.updated).sort().at(-1) : null;
  const items = list.length
    ? `<ul class="ce-post-list">
${list
  .map(
    (p) => `<li>
<a class="ce-post-title" href="${p.url}">${esc(p.data.title)}</a>${isPublished(p) ? '' : ' <span class="ce-badge ce-badge--warn">초안</span>'}
<p class="ce-post-desc">${esc(p.data.description)}</p>
<p class="ce-note">${timeKo(p.data.updated)}${p.data.tags.length ? ` · ${p.data.tags.map(esc).join(', ')}` : ''}</p>
</li>`,
  )
  .join('\n')}
</ul>`
    : `<p>아직 게시된 글이 없습니다. 용도·시설별 설치기준은 <a href="/standards/">기준 찾기</a>에서 볼 수 있습니다.</p>`;
  const feedNote = type === 'news' ? '<p class="ce-note"><a href="/news/feed.xml">RSS 피드</a>로 새 소식을 받아 볼 수 있습니다.</p>' : '';
  const body = `<article class="ce-article">
${pageHeader({ kicker: '소방체크', title: def.indexTitle, lede: def.indexDescription, meta: lastmod ? [metaModified(lastmod)] : [] })}
${section({ id: 'list', title: '글 목록', body: items + feedNote })}
${ctaBox()}
</article>`;
  return {
    kind: `index-${type}`,
    path: def.indexPath,
    file: def.indexFile,
    title: def.indexTitle,
    indexable: list.some(isPublished),
    lastmod,
    html: renderPage({
      path: def.indexPath,
      title: def.indexTitle,
      description: def.indexDescription,
      ogType: 'website',
      noindex: !list.some(isPublished),
      breadcrumbs: [{ name: '홈', path: '/' }, { name: def.indexTitle }],
      schema: [collectionSchema({ path: def.indexPath, title: def.indexTitle, description: def.indexDescription })],
      feed: type === 'news' ? { title: '소방체크 법령 개정 소식', href: '/news/feed.xml' } : undefined,
      body,
    }),
  };
}
