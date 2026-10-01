import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildSite, writeOutputs } from '../build.mjs';
import { makeFixture, write, read, tmpDir, residential } from './helpers.mjs';

const CLI = fileURLToPath(new URL('../build.mjs', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

function snapshot(dir) {
  const out = {};
  const walk = (rel) => {
    for (const ent of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const child = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) walk(child);
      else out[child] = fs.readFileSync(path.join(dir, child), 'utf8');
    }
  };
  walk('');
  return out;
}

test('결정적 출력: 같은 입력을 두 번 만들면 모든 파일이 같다', () => {
  const root = makeFixture();
  const a = buildSite({ root });
  const b = buildSite({ root });
  assert.deepEqual([...a.files.keys()], [...b.files.keys()]);
  for (const [f, content] of a.files) assert.equal(b.files.get(f), content, f);
  // 다른 폴더에 두 번 써도 바이트가 같다
  const outA = tmpDir();
  const outB = tmpDir();
  assert.equal(run('--root', root, '--out', outA).status, 0);
  assert.equal(run('--root', root, '--out', outB).status, 0);
  assert.deepEqual(snapshot(outA), snapshot(outB));
});

test('두 번째 실행은 아무 파일도 다시 쓰지 않는다', () => {
  const root = makeFixture();
  const first = writeOutputs(root, buildSite({ root }).files);
  assert.ok(first.written > 0);
  const second = writeOutputs(root, buildSite({ root }).files);
  assert.equal(second.written, 0);
  assert.deepEqual(second.removed, []);
});

test('--check: 없음·최신·데이터 변경·파일 삭제·남은 생성 파일을 가려낸다', () => {
  const root = makeFixture();
  let res = run('--root', root, '--check');
  assert.equal(res.status, 1, '아직 생성 전');
  assert.match(res.stderr, /없음: standards\/index\.html/);

  assert.equal(run('--root', root).status, 0);
  res = run('--root', root, '--check');
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /생성 결과 최신/);

  // 데이터가 바뀌면 오래된 결과
  const d = residential();
  d.fire_facilities[0].regulations[0].criteria = '연면적 34㎡ 이상';
  write(root, 'data/01_residential_complex.json', d);
  res = run('--root', root, '--check');
  assert.equal(res.status, 1);
  assert.match(res.stderr, /다름: standards\/use\/residential-complex\.html/);
  assert.equal(run('--root', root).status, 0);
  assert.equal(run('--root', root, '--check').status, 0);

  // 생성 파일을 지우면
  fs.rmSync(path.join(root, 'standards/facility/sprinkler.html'));
  res = run('--root', root, '--check');
  assert.equal(res.status, 1);
  assert.match(res.stderr, /없음: standards\/facility\/sprinkler\.html/);
  assert.equal(run('--root', root).status, 0);

  // 더는 만들지 않는 생성 파일이 남아 있으면
  fs.copyFileSync(path.join(root, 'standards/facility/sprinkler.html'), path.join(root, 'standards/facility/ghost.html'));
  res = run('--root', root, '--check');
  assert.equal(res.status, 1);
  assert.match(res.stderr, /남은 생성 파일: standards\/facility\/ghost\.html/);
  res = run('--root', root);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /1개 지움 \(standards\/facility\/ghost\.html\)/);
  assert.equal(run('--root', root, '--check').status, 0);
});

test('--check 는 CRLF 로 체크아웃된 결과도 최신으로 본다 (core.autocrlf)', () => {
  const root = makeFixture();
  assert.equal(run('--root', root).status, 0);
  for (const f of ['standards/index.html', 'sitemap.xml', 'news/feed.xml']) write(root, f, read(root, f).replace(/\n/g, '\r\n'));
  const res = run('--root', root, '--check');
  assert.equal(res.status, 0, res.stderr);
});

test('--check 는 손으로 쓴 파일을 건드리지 않고, 사이트맵을 손으로 고치면 오래된 결과로 본다', () => {
  const root = makeFixture();
  assert.equal(run('--root', root).status, 0);
  write(root, 'sitemap.xml', read(root, 'sitemap.xml').replace('</urlset>', '  <url><loc>https://sobangcheck.com/x</loc></url>\n</urlset>'));
  const res = run('--root', root, '--check');
  assert.equal(res.status, 1);
  assert.match(res.stderr, /다름: sitemap\.xml/);
});

test('콘텐츠 오류는 exit 2 와 파일·줄 번호', () => {
  const root = makeFixture();
  write(root, 'content/qa/broken.md', '---\ntitle: 제목\nstatus: approved\n---\n본문\n');
  const res = run('--root', root);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /오류: content\/qa\/broken\.md: description 이 필요합니다/);
  const res2 = run('--root', root, '--check');
  assert.equal(res2.status, 2);
});

test('--drafts 는 저장소 밖 --out 에만 쓴다', () => {
  const root = makeFixture();
  let res = run('--root', root, '--drafts');
  assert.equal(res.status, 2);
  assert.match(res.stderr, /저장소 밖 폴더/);
  res = run('--root', root, '--drafts', '--out', path.join(root, 'preview'));
  assert.equal(res.status, 2);
  const out = tmpDir();
  res = run('--root', root, '--drafts', '--out', out);
  assert.equal(res.status, 0, res.stderr);
  assert.ok(fs.existsSync(path.join(out, 'news/draft-news.html')));
  assert.equal(fs.existsSync(path.join(root, 'news/draft-news.html')), false);
});

test('알 수 없는 옵션은 exit 2', () => {
  assert.equal(run('--nope').status, 2);
});
