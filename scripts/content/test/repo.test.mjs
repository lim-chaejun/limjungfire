// 실제 저장소(data/·content/·index.html·js/main.js)에 대한 검사 — 생성기와 사이트가 어긋나지 않게
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildSite, DEFAULT_ROOT } from '../build.mjs';
import { MANUAL_PURPOSE_BY_TYPE } from '../lib/config.mjs';
import { discoverStaticPages } from '../lib/feeds.mjs';
import { pageInvariantProblems, xmlProblems } from './helpers.mjs';

const root = DEFAULT_ROOT;
const result = buildSite({ root, includeDrafts: true });

test('실제 데이터·콘텐츠가 오류 없이 만들어진다 (초안 포함)', () => {
  const useFiles = fs.readdirSync(path.join(root, 'data')).filter((f) => /^\d{2}_[a-z0-9_]+\.json$/.test(f));
  assert.equal(result.pages.filter((p) => p.kind === 'standards-use').length, useFiles.length);
  assert.ok(result.pages.filter((p) => p.kind === 'standards-facility').length > 20);
  assert.deepEqual(result.warnings, []);
});

test('모든 생성 페이지가 구조 검사를 통과한다', () => {
  for (const p of result.pages) assert.deepEqual(pageInvariantProblems(p.html), [], p.path);
  assert.deepEqual(xmlProblems(result.files.get('sitemap.xml')), []);
  assert.deepEqual(xmlProblems(result.files.get('news/feed.xml')), []);
});

test('생성 페이지의 사이트 내부 링크가 모두 있는 페이지·파일을 가리킨다', () => {
  const generated = new Set(result.pages.map((p) => p.path));
  const statics = new Set(discoverStaticPages(root).map((p) => p.path));
  const exists = (p) => {
    if (generated.has(p) || statics.has(p) || result.files.has(p.slice(1))) return true;
    const abs = path.join(root, p);
    if (p.endsWith('/')) return fs.existsSync(path.join(abs, 'index.html'));
    return (fs.existsSync(abs) && fs.statSync(abs).isFile()) || fs.existsSync(`${abs}.html`);
  };
  const broken = new Set();
  for (const page of result.pages) {
    for (const [, href] of page.html.matchAll(/(?:href|src)="(\/[^"]*)"/g)) {
      const p = href.split('#')[0].split('?')[0];
      if (p && !exists(p)) broken.add(`${page.path} → ${href}`);
    }
  }
  assert.deepEqual([...broken], []);
});

test('직접 입력 안내가 실제 조회 화면과 맞다 (index.html 선택지, main.js 용도 연결)', () => {
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const select = /<select id="manualPurpose">([\s\S]*?)<\/select>/.exec(index)?.[1];
  assert.ok(select, 'index.html 에 #manualPurpose 가 있다');
  const options = new Set([...select.matchAll(/<option value="([^"]+)">/g)].map((m) => m[1]));
  const main = fs.readFileSync(path.join(root, 'js/main.js'), 'utf8');
  const fn = /function mapPurposeToFireDataType[\s\S]*?const mappingTable = \{([\s\S]*?)\n {2}\};/.exec(main)?.[1];
  assert.ok(fn, 'main.js 에 mapPurposeToFireDataType 의 mappingTable 이 있다');
  const mapping = Object.fromEntries([...fn.matchAll(/'([^']+)':\s*'([^']+)'/g)].map((m) => [m[1], m[2]]));
  const types = new Set(result.pages.filter((p) => p.kind === 'standards-use').map((p) => p.title.split(' 소방시설 설치기준')[0]));
  for (const [type, opts] of Object.entries(MANUAL_PURPOSE_BY_TYPE)) {
    assert.ok(types.has(type), `데이터에 ${type} 용도 파일이 있다`);
    for (const o of opts) {
      assert.ok(options.has(o), `직접 입력 선택지에 ${o} 가 있다`);
      assert.equal(mapping[o], type, `main.js 가 ${o} 를 ${type} 로 연결한다`);
    }
  }
});

test('content/topics.json 형식', () => {
  const { topics } = JSON.parse(fs.readFileSync(path.join(root, 'content/topics.json'), 'utf8'));
  assert.ok(topics.length >= 30);
  const ids = new Set();
  for (const t of topics) {
    assert.match(t.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, t.id);
    assert.ok(!ids.has(t.id), `중복 id ${t.id}`);
    ids.add(t.id);
    assert.ok(typeof t.keyword === 'string' && t.keyword.trim(), t.id);
    assert.ok(['guide', 'qa', 'news'].includes(t.type), t.id);
    assert.ok(typeof t.intent === 'string' && t.intent.trim(), t.id);
    assert.ok([1, 2, 3].includes(t.priority), t.id);
    assert.ok(['todo', 'draft', 'published', 'dropped'].includes(t.status), t.id);
    if (t.status === 'draft' || t.status === 'published') {
      assert.ok(t.post && fs.existsSync(path.join(root, t.post)), `${t.id}: post 파일`);
      assert.ok(t.post.startsWith(`content/${t.type}/`), `${t.id}: 유형 폴더`);
    }
  }
});

test('config.json 의 데이터 기준일이 법령 연혁보다 늦다 (빌드가 확인) 그리고 기준 페이지에 보인다', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'content/config.json'), 'utf8'));
  const hub = result.files.get('standards/index.html');
  assert.ok(hub.includes(`데이터 기준일 <time datetime="${cfg.dataVerified}">`));
});
