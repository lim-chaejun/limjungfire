// 이슈 동기화 판단(planActions) — 가짜 이슈 목록으로 검증. gh 는 실행하지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MARKER_BROKEN, MARKER_LAW, fingerprint, parseState, renderReport, stateMarker } from '../lib.mjs';
import { MARKER_REMINDER, errorSignature, ghArgs, pickIssues, planActions, withState } from '../sync-issues.mjs';
import { tmpDir } from './helpers.mjs';

const NOW = new Date('2026-09-28T00:10:00Z');
const RUN = 'https://github.com/o/r/actions/runs/1';

function change(id, extra = {}) {
  const [sourceId] = id.split(':');
  return { id, sourceId, kind: 'law', title: '시행령', efYd: '20260701', ancYd: '20260623', number: '대통령령 제1호', revisionType: '일부개정', seq: '1', isCurrent: true, isFuture: false, link: 'https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=1', target: 'data/law_history_decree.json', suggestedRow: {}, excerpt: null, impactGuess: 'unknown', affects: [], ...extra };
}

function result({ ids = [], errors = [], code } = {}) {
  const changes = ids.map((id) => change(id));
  const exitCode = code ?? (errors.length ? 20 : ids.length ? 10 : 0);
  return {
    schemaVersion: 1,
    runAt: NOW.toISOString(),
    todayKst: '20260928',
    status: exitCode === 0 ? 'ok' : exitCode === 10 ? 'changes' : 'broken',
    exitCode,
    fingerprint: fingerprint(ids),
    stats: { sources: 39, healthy: 39 - new Set(errors.map((e) => e.sourceId)).size, requests: 90, ms: 1 },
    changes,
    warnings: [],
    errors,
  };
}

const plan = (r, issues = {}) => planActions({ result: r, reportMd: renderReport(r, { runUrl: RUN }), code: r?.exitCode, runUrl: RUN, now: NOW, ...issues });
const nonLabel = (actions) => actions.filter((a) => a.type !== 'label');
const lawIssue = (ids, extra = {}) => ({ number: 7, title: 'x', body: `${MARKER_LAW}\n${stateMarker(fingerprint(ids), ids)}\n본문`, createdAt: '2026-09-21T00:10:00Z', labels: [{ name: 'law-update' }], comments: [], ...extra });

test('라벨 3개는 항상 --force 로 만든다', () => {
  const a = plan(result());
  assert.deepEqual(a.filter((x) => x.type === 'label').map((x) => x.name), ['law-update', 'law-watch-broken', 'law-watch-hold']);
  assert.deepEqual(ghArgs(a[0]).slice(0, 4), ['label', 'create', 'law-update', '--force']);
});

test('개정 있음 + 이슈 없음 → 이슈 생성(표지 포함), 댓글 없음', () => {
  const r = result({ ids: ['decree:20260701:287375', 'rules:20260701:287831'] });
  const a = nonLabel(plan(r));
  assert.equal(a.length, 1);
  assert.equal(a[0].type, 'create');
  assert.equal(a[0].title, '법령 개정 반영 필요: 2건');
  assert.deepEqual(a[0].labels, ['law-update']);
  assert.ok(a[0].body.startsWith(MARKER_LAW));
  assert.deepEqual(parseState(a[0].body).ids, ['decree:20260701:287375', 'rules:20260701:287831']);
  assert.deepEqual(ghArgs(a[0]), ['issue', 'create', '--title', '법령 개정 반영 필요: 2건', '--body-file', '-', '--label', 'law-update']);
});

test('같은 id 목록 → 본문·제목만 조용히 수정 (댓글 없음)', () => {
  const ids = ['decree:20260701:287375'];
  const a = nonLabel(plan(result({ ids }), { lawIssue: lawIssue(ids) }));
  assert.deepEqual(a.map((x) => x.type), ['edit']);
  assert.equal(a[0].number, 7);
});

test('새 id 가 생기면 수정 + 새 id 만 댓글 (알림)', () => {
  const a = nonLabel(plan(result({ ids: ['decree:20260701:287375', 'nfpc-108:2100000278572'] }), { lawIssue: lawIssue(['decree:20260701:287375']) }));
  assert.deepEqual(a.map((x) => x.type), ['edit', 'comment']);
  assert.match(a[1].body, /새로 감지된 개정 1건/);
  assert.match(a[1].body, /nfpc-108:2100000278572/);
  assert.doesNotMatch(a[1].body, /decree:20260701/);
  assert.equal(a[0].title, '법령 개정 반영 필요: 2건');
});

test('정상 실행 + 반영할 개정 없음 → "반영 확인" 댓글 후 닫기', () => {
  const a = nonLabel(plan(result(), { lawIssue: lawIssue(['decree:20260701:287375']) }));
  assert.deepEqual(a.map((x) => x.type), ['comment', 'close']);
  assert.match(a[0].body, /반영 확인/);
  assert.match(a[0].body, new RegExp(RUN.replace(/[/.]/g, '\\$&')));
});

test('이슈가 14일 넘게 열려 있으면 리마인더 한 번만 (표지로 중복 방지, hold 라벨이면 생략)', () => {
  const ids = ['decree:20260701:287375'];
  const old = { createdAt: '2026-09-10T00:00:00Z' };
  const a = nonLabel(plan(result({ ids }), { lawIssue: lawIssue(ids, old) }));
  assert.deepEqual(a.map((x) => x.type), ['edit', 'comment']);
  assert.ok(a[1].body.startsWith(MARKER_REMINDER));
  const again = nonLabel(plan(result({ ids }), { lawIssue: lawIssue(ids, { ...old, comments: [{ body: `${MARKER_REMINDER}\n…` }] }) }));
  assert.deepEqual(again.map((x) => x.type), ['edit']);
  const hold = nonLabel(plan(result({ ids }), { lawIssue: lawIssue(ids, { ...old, labels: [{ name: 'law-update' }, { name: 'law-watch-hold' }] }) }));
  assert.deepEqual(hold.map((x) => x.type), ['edit']);
  const fresh = nonLabel(plan(result({ ids }), { lawIssue: lawIssue(ids, { createdAt: '2026-09-20T00:00:00Z' }) }));
  assert.deepEqual(fresh.map((x) => x.type), ['edit']);
});

const brokenIssue = (sig) => ({ number: 9, title: 'b', body: `${MARKER_BROKEN}\n<!-- law-watch:broken-sig ${JSON.stringify({ sig })} -->\n…`, createdAt: '2026-09-21T00:00:00Z', labels: [{ name: 'law-watch-broken' }], comments: [] });
const err = (sourceId, code) => ({ sourceId, code, url: 'https://www.law.go.kr/LSW/lsHstListR.do', http: 200, bytes: 812, snippet: '차단' });

test('실패 실행 → 별도 broken 이슈 생성, 같은 오류 구성이면 댓글 없이 갱신, 바뀌면 댓글', () => {
  const r = result({ errors: [err('decree', 'PARSE_ZERO_ROWS')] });
  const a = nonLabel(plan(r));
  assert.deepEqual(a.map((x) => x.type), ['create']);
  assert.deepEqual(a[0].labels, ['law-watch-broken']);
  assert.ok(a[0].body.startsWith(MARKER_BROKEN));
  assert.equal(a[0].title, '법령 감시 실패: 소스 1개 오류');
  const sig = errorSignature(r, 20);
  assert.equal(sig, 'PARSE_ZERO_ROWS:decree');

  const same = nonLabel(plan(r, { brokenIssue: brokenIssue(sig) }));
  assert.deepEqual(same.map((x) => x.type), ['edit']);
  const r2 = result({ errors: [err('decree', 'PARSE_ZERO_ROWS'), err('nfpc-108', 'FETCH_FAILED')] });
  const changed = nonLabel(plan(r2, { brokenIssue: brokenIssue(sig) }));
  assert.deepEqual(changed.map((x) => x.type), ['edit', 'comment']);
  assert.match(changed[1].body, /FETCH_FAILED:nfpc-108,PARSE_ZERO_ROWS:decree/);
});

test('오류 없는 실행이 오면 broken 이슈는 댓글 후 자동으로 닫힌다', () => {
  const a = nonLabel(plan(result({ ids: ['decree:20260701:287375'] }), { brokenIssue: brokenIssue('PARSE_ZERO_ROWS:decree') }));
  assert.deepEqual(a.map((x) => `${x.type}:${x.number ?? ''}`), ['create:', 'comment:9', 'close:9']);
});

test('실패 실행: 정상 소스의 새 개정은 알리고, 실패한 소스의 이전 항목은 상태에 남긴다', () => {
  const prev = ['decree:20260701:287375', 'nfpc-108:2100000278572'];
  const r = result({ ids: ['decree:20260701:287375', 'rules:20260701:287831'], errors: [err('nfpc-108', 'FETCH_FAILED')] });
  const a = nonLabel(plan(r, { lawIssue: lawIssue(prev) }));
  assert.deepEqual(a.map((x) => x.type), ['edit', 'comment', 'create']);
  assert.deepEqual(parseState(a[0].body).ids, ['decree:20260701:287375', 'nfpc-108:2100000278572', 'rules:20260701:287831']);
  assert.match(a[1].body, /rules:20260701:287831/);
  // 새 항목이 없으면 실패 실행에서는 이슈를 건드리지 않는다
  const quiet = nonLabel(plan(result({ ids: ['decree:20260701:287375'], errors: [err('nfpc-108', 'FETCH_FAILED')] }), { lawIssue: lawIssue(prev) }));
  assert.deepEqual(quiet.map((x) => x.type), ['create']);
});

test('결과 파일이 없으면(설정 오류·충돌) broken 이슈만', () => {
  const a = nonLabel(planActions({ result: null, code: 1, runUrl: RUN, now: NOW, lawIssue: lawIssue(['decree:1:1']) }));
  assert.deepEqual(a.map((x) => x.type), ['create']);
  assert.equal(a[0].title, '법령 감시 실패: 실행 오류(exit 1)');
  assert.match(a[0].body, /RUN_FAILED:exit1/);
});

test('withState 는 상태 표지를 바꾸거나 없으면 앞에 붙인다', () => {
  const b = withState(`${MARKER_LAW}\n${stateMarker('x', ['a'])}\n본문`, ['b', 'a']);
  assert.deepEqual(parseState(b), { fp: fingerprint(['a', 'b']), ids: ['a', 'b'] });
  assert.equal(b.split('\n')[0], MARKER_LAW);
  const c = withState('본문 $& $1', ['a']);
  assert.ok(c.startsWith(MARKER_LAW));
  assert.ok(c.endsWith('본문 $& $1'));
});

test('pickIssues: 라벨과 본문 표지가 모두 맞는 열린 이슈 중 번호가 가장 작은 것', () => {
  const list = [
    { number: 12, state: 'OPEN', body: `${MARKER_LAW}`, labels: [{ name: 'law-update' }] },
    { number: 5, state: 'OPEN', body: '표지 없음', labels: [{ name: 'law-update' }] },
    { number: 8, state: 'OPEN', body: `${MARKER_LAW}`, labels: [{ name: 'law-update' }] },
    { number: 3, state: 'CLOSED', body: `${MARKER_LAW}`, labels: [{ name: 'law-update' }] },
    { number: 4, state: 'OPEN', body: MARKER_BROKEN, labels: ['law-watch-broken'] },
  ];
  const { lawIssue: l, brokenIssue: b } = pickIssues(list);
  assert.equal(l.number, 8);
  assert.equal(b.number, 4);
});

test('--dry-run: gh 를 실행하지 않고 명령만 출력한다', () => {
  const out = tmpDir('law-watch-sync-');
  const r = result({ ids: ['decree:20260701:287375'] });
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(r));
  fs.writeFileSync(path.join(out, 'report.md'), renderReport(r));
  const issues = path.join(out, 'issues.json');
  fs.writeFileSync(issues, JSON.stringify([lawIssue([], { number: 3, createdAt: '2026-09-01T00:00:00Z' })]));
  const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'sync-issues.mjs');
  const p = spawnSync(process.execPath, [script, '--out', out, '--code', '10', '--dry-run', '--issues-json', issues, '--now', NOW.toISOString()], {
    encoding: 'utf8',
    // 만에 하나 gh 가 실행되더라도 쓰기가 일어나지 않도록 잘못된 토큰·저장소를 준다
    env: { ...process.env, RUN_URL: RUN, GH_TOKEN: 'invalid-token-for-test', GH_REPO: 'example/invalid' },
  });
  assert.equal(p.status, 0, p.stderr);
  const lines = p.stdout.trim().split('\n');
  assert.ok(lines.every((l) => l.startsWith('[dry-run] gh ')));
  assert.deepEqual(
    lines.map((l) => l.split(' ').slice(2, 4).join(' ')),
    ['label create', 'label create', 'label create', 'issue edit', 'issue comment', 'issue comment'],
  );
});
