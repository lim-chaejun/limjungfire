import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildSite } from '../build.mjs';
import { rowStatus, periodText } from '../lib/standards.mjs';
import { BuildError } from '../lib/util.mjs';
import { makeFixture, write, residential, house, pageInvariantProblems, jsonLd } from './helpers.mjs';

const page = (result, p) => result.pages.find((x) => x.path === p);
const html = (result, p) => page(result, p).html;
/** <tbody> 행 수 (한 표 안) */
const tableRows = (h) => (h.match(/<tr class="ce-row--/g) || []).length;

test('기간 표기와 상태 (기준일 20260926)', () => {
  const asOf = '20260926';
  const cases = [
    [{ start_date: null, end_date: null }, '상시 적용', 'current'],
    [{ start_date: '20190806', end_date: null }, '2019.08.06 ~ 현재', 'current'],
    [{ start_date: null, end_date: '20241230' }, '~ 2024.12.30', 'ended'],
    [{ start_date: '20190806', end_date: '20241230' }, '2019.08.06 ~ 2024.12.30', 'ended'],
    [{ start_date: '20270101', end_date: null }, '2027.01.01 ~', 'future'],
    [{ start_date: '20260926', end_date: '20260926' }, '2026.09.26 ~ 2026.09.26', 'current'],
  ];
  for (const [r, text, status] of cases) {
    assert.equal(periodText(r, asOf), text);
    assert.equal(rowStatus(r, asOf), status);
  }
});

test('용도 슬러그·파일 경로와 허브 목록 (파일 이름 순)', () => {
  const r = buildSite({ root: makeFixture() });
  const uses = r.pages.filter((p) => p.kind === 'standards-use').map((p) => [p.path, p.file]);
  assert.deepEqual(uses, [
    ['/standards/use/residential-complex', 'standards/use/residential-complex.html'],
    ['/standards/use/neighborhood-facilities', 'standards/use/neighborhood-facilities.html'],
    ['/standards/use/underground-passage', 'standards/use/underground-passage.html'],
  ]);
  const hub = html(r, '/standards/');
  for (const [p] of uses) assert.ok(hub.includes(`href="${p}"`), p);
  assert.ok(hub.includes('href="/standards/facility/auto-fire-detection"'));
});

test('용도 페이지: 시설별 기간표에 데이터 행이 모두 들어가고 기간순으로 정렬된다', () => {
  const r = buildSite({ root: makeFixture() });
  const h = html(r, '/standards/use/residential-complex');
  assert.equal(tableRows(h), 5);
  const sp = h.slice(h.indexOf('id="f-sprinkler"'));
  const order = ['1990.07.01 ~ 1992.07.27', '2005.01.01 ~ 2018.01.26', '2018.01.27 ~ 현재'].map((t) => sp.indexOf(t));
  assert.ok(order.every((i, k) => i > -1 && (k === 0 || i > order[k - 1])), `순서 ${order}`);
  assert.ok(h.includes('<span class="ce-badge ce-badge--muted">종료</span>'));
  assert.ok(h.includes('<span class="ce-badge ce-badge--info">시행 예정</span>'));
  assert.ok(h.includes('<th scope="col">기준 (원문 요약)</th>'));
  // 비고(근거) 칸
  assert.ok(h.includes('부칙 제2조 — 그 시행일 이후 신축 등 허가·협의를 신청하거나 신고하는 경우부터 적용'));
  // 하위 구분(sub_types) 표
  assert.ok(h.includes('연립주택') && h.includes('2024.12.01'));
  // 허가일 설명: 끝난 행과 다음 날 시작하는 행 쌍
  assert.match(h, /2018\.01\.26까지 허가된 건물에는 “층수가 11층 이상일 경우 전층”, 2018\.01\.27부터 허가된 건물에는 “층수가 6층 이상인 경우 모든 층”이 적용됩니다/);
  // 조회 도구 안내 + 직접 입력 용도
  assert.ok(h.includes('<a class="ce-cta-btn" href="/">'));
  assert.ok(h.includes('용도 <strong>공동주택</strong>을 고르고'));
  // 데이터 기준일·최종 수정일
  assert.ok(h.includes('최종 수정일 <time datetime="2026-09-27">2026년 9월 27일</time>'), '첫 게시일보다 앞서지 않는다');
  assert.ok(h.includes('데이터 기준일 <time datetime="2026-09-26">'));
});

test('용도 페이지: 출처에 현행 시행령과 비고에 인용된 개정 법령(law.go.kr)이 있다', () => {
  const r = buildSite({ root: makeFixture() });
  const h = html(r, '/standards/use/residential-complex');
  const sources = h.slice(h.indexOf('id="ce-sources-title"'));
  assert.ok(sources.includes('소방시설법 시행령(대통령령 제35860호) (2026.03.01 시행판)'), '기준일 현재 판');
  assert.ok(!sources.includes('제35151호) (2027.01.01 시행판)'), '시행 예정 판은 현행이 아니다');
  assert.ok(sources.includes('href="https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=191373" target="_blank" rel="noopener">소방시설법 시행령(대통령령 제27810호)'));
  assert.ok(sources.includes('스프링클러설비의 화재안전성능기준(NFPC 103)'));
});

test('데이터 문자열은 모두 이스케이프된다 (XSS)', () => {
  const r = buildSite({ root: makeFixture() });
  for (const p of ['/standards/use/neighborhood-facilities', '/standards/facility/auto-fire-detection']) {
    const h = html(r, p);
    assert.ok(!h.includes('<script>alert(1)</script>'), p);
    assert.ok(h.includes('&lt;script&gt;alert(1)&lt;/script&gt; 연면적 600㎡ 이상'), p);
    assert.ok(!h.includes('<b>굵게</b>'), p);
  }
  assert.ok(html(r, '/standards/use/neighborhood-facilities').includes('의원 &amp; &quot;치과&quot; &lt;병원&gt;'));
});

test('얇은 페이지: 기준 행이 2건 미만이면 noindex + 사이트맵 제외', () => {
  const r = buildSite({ root: makeFixture() });
  const thinUse = page(r, '/standards/use/underground-passage');
  const thinFac = page(r, '/standards/facility/firewall');
  for (const p of [thinUse, thinFac]) {
    assert.equal(p.indexable, false, p.path);
    assert.ok(p.html.includes('<meta name="robots" content="noindex, follow">'), p.path);
  }
  const rich = page(r, '/standards/use/residential-complex');
  assert.equal(rich.indexable, true);
  assert.ok(!rich.html.includes('noindex'));
  const sitemap = r.files.get('sitemap.xml');
  assert.ok(!sitemap.includes('/standards/use/underground-passage<'));
  assert.ok(!sitemap.includes('/standards/facility/firewall<'));
  assert.ok(sitemap.includes('<loc>https://sobangcheck.com/standards/use/residential-complex</loc>'));
});

test('기준 행이 하나도 없는 시설은 페이지를 만들지 않는다', () => {
  const r = buildSite({ root: makeFixture() });
  assert.equal(page(r, '/standards/facility/fire-alarm'), undefined);
  assert.equal(r.files.has('standards/facility/fire-alarm.html'), false);
});

test('00_house.json 이 없으면 단독주택 페이지도 없고, 있으면 만든다', () => {
  const without = buildSite({ root: makeFixture() });
  assert.equal(page(without, '/standards/use/house'), undefined);
  const root = makeFixture();
  write(root, 'data/00_house.json', house());
  const withHouse = buildSite({ root });
  const p = page(withHouse, '/standards/use/house');
  assert.ok(p, 'house 페이지');
  assert.equal(p.indexable, true, '기준 2건 = 문턱값');
  assert.equal(withHouse.pages.filter((x) => x.kind === 'standards-use')[0].path, '/standards/use/house', '00 이 맨 앞');
  assert.ok(!p.html.includes('직접 입력하기’에서 용도'), '직접 입력 용도 연결이 없는 용도는 안내하지 않는다');
});

test('시설 페이지: 현행 기준만 현행 표에, 시행 예정은 따로, 이력·가이드·화재안전기준', () => {
  const r = buildSite({ root: makeFixture() });
  const sp = html(r, '/standards/facility/sprinkler');
  const current = sp.slice(sp.indexOf('id="current"'), sp.indexOf('id="history"'));
  assert.ok(current.includes('층수가 6층 이상인 경우 모든 층'));
  assert.ok(!current.includes('층수가 11층 이상일 경우 전층'), '끝난 기준은 현행 표에 없다');
  // 되풀이되는 비고는 주석으로 한 번만
  assert.equal((current.match(/부칙 제2조/g) || []).length, 1);
  assert.ok(current.includes('<a href="#cur-n1">주석 1</a>'));
  const history = sp.slice(sp.indexOf('id="history"'));
  assert.ok(history.includes('2018.01.27</time> 시행'));
  assert.ok(history.includes('1992.07.27</time>까지 적용 후 종료'), '후속 행이 없는 종료');
  assert.ok(!history.includes('2018.01.26</time>까지 적용 후 종료'), '다음 날 후속 행이 있으면 종료로 따로 적지 않는다');
  assert.ok(sp.includes('href="/guide/sprinkler"'), '손으로 쓴 가이드 연결');
  assert.ok(sp.includes('기준일 현재: <a href="https://www.law.go.kr/LSW/admRulInfoP.do?admRulSeq=2100000270474" target="_blank" rel="noopener">스프링클러설비의 화재안전성능기준(NFPC 103)</a>'));

  const fe = html(r, '/standards/facility/fire-extinguisher');
  assert.ok(fe.includes('id="future"'), '시행 예정 기준 절');
  assert.ok(fe.includes('시행 예정 기준 (가짜)'));
  assert.ok(fe.includes('연결된 화재안전기준(NFPC·NFSC)이 없습니다'));
  assert.ok(!fe.includes('id="guide"') || fe.includes('/guide/fire-extinguisher'));
  assert.ok(!html(r, '/standards/facility/firewall').includes('id="guide"'), '가이드가 없는 시설');
});

test('모든 기준 페이지가 구조 검사를 통과한다 (태그 짝, h1 하나, canonical, 인라인 핸들러 없음, 외부 링크 noopener, 앵커)', () => {
  const root = makeFixture();
  write(root, 'data/00_house.json', house());
  const r = buildSite({ root });
  for (const p of r.pages.filter((x) => x.kind.startsWith('standards'))) {
    assert.deepEqual(pageInvariantProblems(p.html), [], p.path);
    const types = jsonLd(p.html).map((j) => j['@type']);
    assert.ok(types.includes('BreadcrumbList'), p.path);
    assert.ok(types.includes(p.kind === 'standards-hub' ? 'CollectionPage' : 'Article'), p.path);
    assert.ok(!types.includes('FAQPage'), `${p.path}: 화면에 FAQ 가 없으면 FAQPage 도 없다`);
  }
});

test('데이터 검사: 기준일 뒤에 공포된 연혁이 있으면 멈춘다', () => {
  const root = makeFixture();
  write(root, 'content/config.json', { dataVerified: '2025-01-01', standardsPublished: '2026-09-27' });
  assert.throws(() => buildSite({ root }), (e) => e instanceof BuildError && /dataVerified\(2025-01-01\)/.test(e.message));
});

test('데이터 검사: 잘못된 날짜·없는 시설 id·거꾸로 된 기간', () => {
  const cases = [
    [(d) => (d.fire_facilities[0].regulations[0].start_date = '2024-01-01'), /YYYYMMDD/],
    [(d) => (d.fire_facilities[0].regulations[0].end_date = '20240231'), /YYYYMMDD/],
    [(d) => (d.fire_facilities[0].facility_id = 'no_such'), /facility_id no_such/],
    [(d) => Object.assign(d.fire_facilities[1].regulations[1], { start_date: '20200101', end_date: '20100101' }), /늦습니다/],
    [(d) => (d.fire_facilities[0].regulations[0].criteria = ' '), /criteria/],
  ];
  for (const [mutate, re] of cases) {
    const root = makeFixture();
    const d = residential();
    mutate(d);
    write(root, 'data/01_residential_complex.json', d);
    assert.throws(() => buildSite({ root }), (e) => e instanceof BuildError && re.test(e.message), String(re));
  }
});

test('시계에 의존하지 않는다: 기준일을 바꾸면 현행 판단이 따라 바뀐다', () => {
  const root = makeFixture();
  write(root, 'content/config.json', { dataVerified: '2027-01-02', standardsPublished: '2026-09-27' });
  const r = buildSite({ root });
  const fe = html(r, '/standards/facility/fire-extinguisher');
  assert.ok(!fe.includes('id="future"'), '2027-01-01 기준은 이제 현행');
  assert.ok(fe.includes('2027.01.01 ~ 현재'));
  assert.ok(html(r, '/standards/use/residential-complex').includes('소방시설법 시행령(대통령령 제35151호) (2027.01.01 시행판)'));
  assert.equal(page(r, '/standards/use/residential-complex').lastmod, '2027-01-02', '기준일이 첫 게시일보다 늦으면 기준일');
  assert.ok(r.files.get('sitemap.xml').includes('<loc>https://sobangcheck.com/standards/</loc>\n    <lastmod>2027-01-02</lastmod>'));
});

test('실제 저장소: 손으로 쓴 가이드 연결 대상 파일이 있다', async () => {
  const { GUIDE_BY_FACILITY } = await import('../lib/config.mjs');
  const repo = path.resolve(import.meta.dirname, '..', '..', '..');
  for (const slug of Object.values(GUIDE_BY_FACILITY)) assert.ok(fs.existsSync(path.join(repo, 'guide', `${slug}.html`)), slug);
});
