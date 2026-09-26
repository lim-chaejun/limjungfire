// verdict-diff — 두 데이터 디렉터리의 판정 차이
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { diffResults, formatDiff, main, parseArgs } from '../verdict-diff.mjs';
import { FIXTURE_DATA, FIXTURE_SET, ROOT, TODAY, evaluate, loadBuildingFixtures } from './helpers.mjs';

const SCRIPT = path.join(ROOT, 'scripts', 'engine', 'verdict-diff.mjs');
const FX = Object.fromEntries(loadBuildingFixtures().map((f) => [f.id, f]));

// 픽스처 데이터 복사본에서 소화기구 기준을 33㎡ → 500㎡ 로 바꾼 디렉터리
function modifiedDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verdict-diff-'));
  for (const name of fs.readdirSync(FIXTURE_DATA)) fs.copyFileSync(path.join(FIXTURE_DATA, name), path.join(dir, name));
  const file = path.join(dir, '02_neighborhood_facilities.json');
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  json.fire_facilities[0].regulations[0].conditions = { m: 'total_area', gte: 500 };
  fs.writeFileSync(file, JSON.stringify(json));
  return dir;
}

const capture = () => {
  const lines = { log: [], error: [] };
  return { out: { log: (s) => lines.log.push(s), error: (s) => lines.error.push(s) }, lines };
};

test('diffResults: 같은 데이터면 차이 없음, 기준을 바꾸면 판정·범위 차이', () => {
  const r = evaluate(FX['nc-3f-450'].input);
  assert.deepEqual(diffResults(r, r), []);
  const files = structuredClone(FIXTURE_SET.dataFiles);
  files['02'].fire_facilities[0].regulations[0].conditions = { m: 'total_area', gte: 500 };
  const r2 = evaluate(FX['nc-3f-450'].input, { set: { ...FIXTURE_SET, dataFiles: files } });
  const diffs = diffResults(r, r2);
  assert.equal(diffs.length, 1);
  assert.deepEqual(diffs[0].before, { verdict: '해당', scope: '모든 층', questions: '-' });
  assert.deepEqual(diffs[0].after, { verdict: '비해당', scope: '-', questions: '-' });
});

test('diffResults: 동 상태가 바뀌면(v1 → v2 전환) 동 단위 차이', () => {
  const r = evaluate(FX['v1-fallback'].input);
  const files = { ...FIXTURE_SET.dataFiles, 18: { schema_version: 2, type_code: '18', review: { status: 'draft', by: null, date: null }, fire_facilities: [] } };
  const r2 = evaluate(FX['v1-fallback'].input, { set: { ...FIXTURE_SET, dataFiles: files } });
  const diffs = diffResults(r, r2);
  assert.deepEqual(diffs.map((d) => [d.dong, d.name, d.before, d.after]), [['주차타워', '동 상태', 'v1', 'v2']]);
  assert.match(formatDiff({ a: 'A', b: 'B', today: TODAY, buildings: 1, diffs: diffs.map((d) => ({ building: 'x', ...d })) }), /\[x\] 주차타워: 동 상태 v1 → v2/);
});

test('인자 해석: 필수 인자·날짜 형식·기본 픽스처', () => {
  assert.throws(() => parseArgs(['--a', 'x']), /--b/);
  assert.throws(() => parseArgs(['--a', 'x', '--b', 'y', '--today', '2026-13-01']), /YYYYMMDD/);
  assert.throws(() => parseArgs(['--a', 'x', '--b', 'y', '--oops']), /알 수 없는 인자/);
  const o = parseArgs(['--a', 'x', '--b', 'y']);
  assert.equal(o.buildings.length, 1);
  assert.match(o.buildings[0], /fixtures[\\/]buildings$/);
});

test('main: 차이 보고, --fail-on-diff 종료 코드, --json', () => {
  const dir = modifiedDataDir();
  try {
    const same = capture();
    assert.equal(main(['--a', FIXTURE_DATA, '--b', FIXTURE_DATA, '--today', TODAY, '--fail-on-diff'], same.out), 0);
    assert.match(same.lines.log[0], /차이 없음$/);

    const diff = capture();
    assert.equal(main(['--a', FIXTURE_DATA, '--b', dir, '--today', TODAY, '--fail-on-diff'], diff.out), 1);
    const text = diff.lines.log[0];
    assert.match(text, /\[nc-3f-450\] 본동 · 소화기구: 해당 → 비해당 \| 범위 모든 층 → -/);
    assert.match(text, /\[nc-parking-180-2026\] 본동 · 소화기구: 해당 → 비해당/);
    assert.match(text, /차이 \d+건 \(건물 \d+개\)$/);

    const json = capture();
    assert.equal(main(['--a', FIXTURE_DATA, '--b', dir, '--today', TODAY, '--json'], json.out), 0);
    const report = JSON.parse(json.lines.log[0]);
    assert.equal(report.buildings, 10);
    assert.ok(report.diffs.some((d) => d.building === 'nc-3f-450' && d.facility === 'fire_extinguisher'));

    const bad = capture();
    assert.equal(main(['--a', path.join(dir, 'nope'), '--b', dir], bad.out), 2);
    assert.match(bad.lines.error[0], /데이터 디렉터리가 없음/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI 실행: node scripts/engine/verdict-diff.mjs (같은 디렉터리 → 차이 없음, 종료 0)', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--a', FIXTURE_DATA, '--b', FIXTURE_DATA, '--today', TODAY], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /건물 10개/);
  assert.match(r.stdout, /차이 없음/);
});
