import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildSite, writeOutputs } from '../build.mjs';
import { BuildError } from '../lib/util.mjs';
import { validatePost } from '../lib/posts.mjs';
import { makeFixture, write, read, jsonLd, pageInvariantProblems, APPROVED_QA, APPROVED_NEWS } from './helpers.mjs';

test('승인된 글만 렌더링한다 — 초안은 페이지·색인·사이트맵·RSS 어디에도 없다', () => {
  const r = buildSite({ root: makeFixture() });
  assert.ok(r.files.has('news/rack-warehouse.html'));
  assert.ok(r.files.has('qa/sprinkler-6th-floor.html'));
  assert.ok(r.files.has('guide/permit-date.html'));
  assert.equal(r.files.has('news/draft-news.html'), false);
  for (const f of ['news/index.html', 'sitemap.xml', 'news/feed.xml', 'standards/index.html']) {
    assert.ok(!r.files.get(f).includes('draft-news'), f);
    assert.ok(!r.files.get(f).includes('초안 소식'), f);
  }
  assert.ok(r.files.get('news/index.html').includes('href="/news/rack-warehouse"'));
  assert.ok(r.files.get('news/feed.xml').includes('<link>https://sobangcheck.com/news/rack-warehouse</link>'));
  assert.ok(r.files.get('standards/index.html').includes('href="/qa/sprinkler-6th-floor"'), '허브의 새 글');
});

test('초안이 되돌려지면 이전에 만든 페이지를 지운다 (생성 표시가 있는 파일만)', () => {
  const root = makeFixture();
  writeOutputs(root, buildSite({ root }).files);
  assert.ok(fs.existsSync(path.join(root, 'news/rack-warehouse.html')));
  write(root, 'content/news/rack-warehouse.md', APPROVED_NEWS.replace('status: approved', 'status: draft'));
  const { removed } = writeOutputs(root, buildSite({ root }).files);
  assert.deepEqual(removed, ['news/rack-warehouse.html']);
  assert.equal(fs.existsSync(path.join(root, 'news/rack-warehouse.html')), false);
  assert.ok(fs.existsSync(path.join(root, 'guide/sprinkler.html')), '손으로 쓴 가이드는 그대로');
  assert.ok(!read(root, 'news/feed.xml').includes('rack-warehouse'));
});

test('--drafts 미리보기에서는 초안도 noindex + 초안 표시로 렌더링된다', () => {
  const r = buildSite({ root: makeFixture(), includeDrafts: true });
  const h = r.files.get('news/draft-news.html');
  assert.ok(h.includes('<meta name="robots" content="noindex, follow">'));
  assert.ok(h.includes('초안 — 검수 전'));
  assert.ok(!r.files.get('sitemap.xml').includes('draft-news'), '미리보기에서도 사이트맵에는 없다');
  assert.ok(!r.files.get('news/feed.xml').includes('draft-news'), '미리보기에서도 RSS 에는 없다');
});

test('글 페이지: 제목·설명·최종 수정일·검수 표시·출처(noopener)·관련 링크·조회 안내', () => {
  const r = buildSite({ root: makeFixture() });
  const h = r.files.get('news/rack-warehouse.html');
  assert.deepEqual(pageInvariantProblems(h), []);
  assert.ok(h.includes('<title>랙식 창고 스프링클러 기준 개정 | 소방체크</title>'));
  assert.ok(h.includes('<link rel="canonical" href="https://sobangcheck.com/news/rack-warehouse">'));
  assert.ok(h.includes('최종 수정일 <time datetime="2026-09-21">2026년 9월 21일</time>'));
  assert.ok(h.includes('운영자 검수 완료'));
  assert.ok(h.includes('<a href="https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=279911" target="_blank" rel="noopener">소방시설법 시행령(대통령령 제35860호)</a>'));
  assert.ok(h.includes('<a href="/standards/facility/sprinkler">스프링클러설비 설치대상 — 용도별 설치기준 정리</a>'), '관련 링크는 페이지 제목으로');
  assert.ok(h.includes('<a class="ce-cta-btn" href="/">'));
  assert.ok(h.includes('<strong>랙이 설치된 부분</strong>'));
  assert.ok(h.includes('<link rel="alternate" type="application/rss+xml"'));
  const types = jsonLd(h).map((j) => j['@type']);
  assert.deepEqual(types, ['NewsArticle', 'BreadcrumbList']);
  const article = jsonLd(h)[0];
  assert.equal(article.datePublished, '2026-09-20');
  assert.equal(article.dateModified, '2026-09-21');
  assert.equal(article.mainEntityOfPage, 'https://sobangcheck.com/news/rack-warehouse');
});

test('FAQPage 는 FAQ 를 화면에 보일 때만, 질문 수도 같다', () => {
  const r = buildSite({ root: makeFixture() });
  const qa = r.files.get('qa/sprinkler-6th-floor.html');
  const ld = jsonLd(qa);
  const faq = ld.find((j) => j['@type'] === 'FAQPage');
  assert.ok(faq);
  const visible = (qa.match(/<dt>/g) || []).length;
  assert.equal(visible, 2);
  assert.equal(faq.mainEntity.length, visible);
  assert.equal(faq.mainEntity[1].acceptedAnswer.text, '부칙 제2조는 "신청" 기준입니다.');
  assert.ok(qa.includes('<dd>부칙 제2조는 &quot;신청&quot; 기준입니다.</dd>'));
  assert.ok(qa.includes('본문 &lt;script&gt;alert(1)&lt;/script&gt;'), '본문 HTML 은 이스케이프');
  const guide = r.files.get('guide/permit-date.html');
  assert.ok(!jsonLd(guide).some((j) => j['@type'] === 'FAQPage'));
  assert.ok(!guide.includes('ce-faq'));
});

test('손으로 쓴 페이지와 슬러그가 겹치면 멈추고 파일을 건드리지 않는다', () => {
  const root = makeFixture();
  const before = read(root, 'guide/sprinkler.html');
  write(root, 'content/guide/sprinkler.md', APPROVED_QA);
  assert.throws(() => buildSite({ root }), (e) => e instanceof BuildError && /손으로 쓴 파일과 경로가 겹칩니다: guide\/sprinkler\.html/.test(e.message));
  assert.equal(read(root, 'guide/sprinkler.html'), before);
});

test('초안이라도 겹치는 슬러그는 렌더링하지 않으므로 통과한다 (승인 시점에 멈춤)', () => {
  const root = makeFixture();
  write(root, 'content/guide/sprinkler.md', APPROVED_QA.replace('status: approved', 'status: draft'));
  assert.doesNotThrow(() => buildSite({ root }));
});

test('관련 경로 검사: 승인된 글은 없는 경로면 멈추고, 초안은 경고만', () => {
  const root = makeFixture();
  write(root, 'content/qa/sprinkler-6th-floor.md', APPROVED_QA.replace('/guide/sprinkler', '/guide/sprinkler.html'));
  assert.throws(() => buildSite({ root }), (e) => e instanceof BuildError && /related 경로를 찾을 수 없습니다: \/guide\/sprinkler\.html/.test(e.message));
  write(root, 'content/qa/sprinkler-6th-floor.md', APPROVED_QA.replace('/guide/sprinkler', '/nope').replace('status: approved', 'status: draft'));
  const r = buildSite({ root });
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /\/nope/);
});

test('승인된 글이 초안 글을 관련 링크로 걸면 멈춘다 (게시되지 않은 페이지로 가는 링크)', () => {
  const root = makeFixture();
  write(root, 'content/news/rack-warehouse.md', APPROVED_NEWS.replace('  - /standards/facility/sprinkler', '  - /news/draft-news'));
  assert.throws(() => buildSite({ root }), /related 경로를 찾을 수 없습니다: \/news\/draft-news/);
});

test('파일 이름 검사: 대문자·한글·예약어 슬러그는 멈춘다', () => {
  for (const name of ['Bad.md', '한글.md', 'index.md', 'feed.md', 'a--b.md']) {
    const root = makeFixture({ posts: false });
    write(root, `content/qa/${name}`, APPROVED_QA);
    assert.throws(() => buildSite({ root }), BuildError, name);
  }
});

test('글이 없으면 색인 페이지는 noindex 이고 사이트맵에서 빠진다', () => {
  const r = buildSite({ root: makeFixture({ posts: false }) });
  for (const [file, p] of [
    ['news/index.html', '/news/'],
    ['qa/index.html', '/qa/'],
    ['guide/articles.html', '/guide/articles'],
  ]) {
    assert.ok(r.files.get(file).includes('<meta name="robots" content="noindex, follow">'), file);
    assert.ok(r.files.get(file).includes('아직 게시된 글이 없습니다'), file);
    assert.ok(!r.files.get('sitemap.xml').includes(`https://sobangcheck.com${p}<`), p);
  }
  assert.ok(!r.files.get('news/feed.xml').includes('<item>'));
});

// ── 프론트매터 값 검사 ──

const base = () => ({
  title: '제목',
  description: '설명',
  date: '2026-09-27',
  status: 'approved',
  sources: [{ label: '원문', url: 'https://www.law.go.kr/x' }],
});

test('검사: 기본값 채우기 (updated=date, 목록은 빈 배열)', () => {
  const v = validatePost(base(), 'p.md');
  assert.equal(v.updated, '2026-09-27');
  assert.deepEqual([v.tags, v.related, v.faq], [[], [], []]);
});

const invalid = [
  ['알 수 없는 키 (오타)', { stauts: 'approved' }, /알 수 없는 키 "stauts"/],
  ['status 값', { status: 'published' }, /status/],
  ['status 없음', { status: undefined }, /status/],
  ['날짜 형식', { date: '2026-9-27' }, /date/],
  ['없는 날짜', { date: '2026-02-30' }, /date/],
  ['updated 가 date 보다 이름', { updated: '2026-09-01' }, /updated/],
  ['출처 없음', { sources: [] }, /sources/],
  ['출처가 https 아님', { sources: [{ label: 'x', url: 'http://www.law.go.kr/x' }] }, /https/],
  ['출처 url 이 javascript', { sources: [{ label: 'x', url: 'javascript:alert(1)' }] }, /https/],
  ['출처 키 오타', { sources: [{ label: 'x', link: 'https://a' }] }, /알 수 없는 키 "link"/],
  ['related 가 외부 주소', { related: ['https://evil.example/'] }, /related/],
  ['related 가 // 주소', { related: ['//evil.example/'] }, /related/],
  ['faq 에 a 없음', { faq: [{ q: '질문' }] }, /faq/],
  ['tags 가 목록 아님', { tags: '한 줄' }, /tags/],
  ['제목 없음', { title: '  ' }, /title/],
];
for (const [name, patch, re] of invalid) {
  test(`검사 실패: ${name}`, () => {
    const data = { ...base(), ...patch };
    for (const k of Object.keys(data)) if (data[k] === undefined) delete data[k];
    assert.throws(() => validatePost(data, 'p.md'), (e) => e instanceof BuildError && re.test(e.message) && e.message.startsWith('p.md:'));
  });
}
