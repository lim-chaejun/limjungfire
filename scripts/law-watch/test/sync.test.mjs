// 이슈 동기화 판단(planActions) — 가짜 이슈 목록으로 검증. gh 는 실행하지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MARKER_BROKEN, MARKER_LAW, fingerprint, parseState, renderReport, stateMarker } from '../lib.mjs';
import { MARKER_REMINDER, MARKER_RESOLVED, capBody, errorSignature, ghArgs, pickIssues, planActions, withState } from '../sync-issues.mjs';
import { chainAware, copySnapshot, replay, runCheck, tmpDir } from './helpers.mjs';

const NOW = new Date('2026-09-28T00:10:00Z');
const RUN = 'https://github.com/o/r/actions/runs/1';

function change(id, extra = {}) {
  const [sourceId] = id.split(':');
  return { id, sourceId, kind: 'law', title: '시행령', efYd: '20260701', ancYd: '20260623', number: '대통령령 제1호', revisionType: '일부개정', seq: '1', isCurrent: true, isFuture: false, link: 'https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=1', target: 'data/law_history_decree.json', suggestedRow: {}, excerpt: null, impactGuess: 'unknown', affects: [], ...extra };
}

function result({ ids = [], errors = [], code, scope = null } = {}) {
  const changes = ids.map((id) => change(id));
  const exitCode = code ?? (errors.length ? 20 : ids.length ? 10 : 0);
  return {
    schemaVersion: 1,
    runAt: NOW.toISOString(),
    todayKst: '20260928',
    status: exitCode === 0 ? 'ok' : exitCode === 10 ? 'changes' : 'broken',
    exitCode,
    scope,
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
const brokenIssue = (sig) => ({ number: 9, title: 'b', body: `${MARKER_BROKEN}\n<!-- law-watch:broken-sig ${JSON.stringify({ sig })} -->\n…`, createdAt: '2026-09-21T00:00:00Z', labels: [{ name: 'law-watch-broken' }], comments: [] });
const err = (sourceId, code) => ({ sourceId, code, url: 'https://www.law.go.kr/LSW/lsHstListR.do', http: 200, bytes: 812, snippet: '차단' });
// 2026-09-26 골든 13건 (diff.test.mjs 와 같음)
const ALL13 = [
  'decree:20260324:284781', 'decree:20260701:287375', 'nfpc-108:2100000278572', 'nfpc-201:2100000278574', 'nfpc-205:2100000278570',
  'nfpc-304:2100000278586', 'nfpc-401:2100000278590', 'nfpc-402:2100000278592', 'nfpc-503:2100000278594', 'nfpc-504:2100000278588',
  'nfpc-505:2100000278542', 'nfpc-602:2100000278578', 'rules:20260701:287831',
];
const scopeOf = (...sources) => ({ only: sources, sources });

test('라벨 4개(law-needs-review 포함)는 항상 --force 로 만든다', () => {
  const a = plan(result());
  assert.deepEqual(a.filter((x) => x.type === 'label').map((x) => x.name), ['law-update', 'law-watch-broken', 'law-watch-hold', 'law-needs-review']);
  assert.deepEqual(ghArgs(a[0]).slice(0, 4), ['label', 'create', 'law-update', '--force']);
  for (const l of a.filter((x) => x.type === 'label')) assert.ok(l.description.length <= 100, `${l.name}: GitHub 라벨 설명 100자 한도`);
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

test('정상 실행 + 반영할 개정 없음 → "반영 확인" 댓글(표지 포함) 후 닫기', () => {
  const a = nonLabel(plan(result(), { lawIssue: lawIssue(['decree:20260701:287375']) }));
  assert.deepEqual(a.map((x) => x.type), ['comment', 'close']);
  assert.ok(a[0].body.startsWith(MARKER_RESOLVED));
  assert.match(a[0].body, /반영 확인/);
  assert.match(a[0].body, new RegExp(RUN.replace(/[/.]/g, '\\$&')));
});

test('사람이 닫은 같은 지문의 이슈는 30일 동안 다시 만들지 않는다 (감시가 "반영 확인"으로 닫은 것은 예외)', () => {
  const ids = ['decree:20260701:287375', 'rules:20260701:287831'];
  const closed = (extra = {}) => ({ ...lawIssue(ids, { number: 5, state: 'CLOSED', closedAt: '2026-09-21T03:00:00Z' }), ...extra });
  const types = (closedLawIssues, r = result({ ids })) => nonLabel(plan(r, { closedLawIssues })).map((x) => x.type);
  assert.deepEqual(types([closed()]), [], '같은 지문, 7일 전 사람이 닫음 → 다시 만들지 않음');
  assert.deepEqual(types([closed({ closedAt: '2026-08-20T00:00:00Z' })]), ['create'], '30일이 지남');
  assert.deepEqual(types([closed({ comments: [{ body: `${MARKER_RESOLVED}\n반영 확인` }] })]), ['create'], '감시가 반영 확인으로 닫음 → 되돌림 등으로 다시 생기면 알림');
  assert.deepEqual(types([closed()], result({ ids: [...ids, 'nfpc-108:2100000278572'] })), ['create'], '새 항목이 생겨 지문이 다름');
  assert.deepEqual(types([closed({ closedAt: undefined })]), ['create'], 'closedAt 을 모르면 만든다');
  // pickIssues 는 닫힌 law 이슈를 따로 돌려준다 (gh 목록에 섞여 와도 열린 이슈로 고르지 않음)
  const picked = pickIssues([closed(), lawIssue(ids, { number: 9, state: 'OPEN' })]);
  assert.equal(picked.lawIssue.number, 9);
  assert.deepEqual(picked.closedLawIssues.map((i) => i.number), [5]);
});

// ───────────── 종료 코드·결과 파일 이상 (CHECK_STEP_FAILED) ─────────────

test('종료 코드가 비었거나 정수가 아니면 정상으로 보지 않는다 — Number("") === 0 으로 이슈를 닫던 문제', () => {
  for (const code of ['', ' ', 'none', '0x0', undefined, null]) {
    const a = nonLabel(planActions({ result: result(), reportMd: '', code, runUrl: RUN, now: NOW, lawIssue: lawIssue(ALL13), brokenIssue: brokenIssue('PARSE_ZERO_ROWS:decree') }));
    assert.deepEqual(a.map((x) => x.type), ['edit', 'comment'], `code=${JSON.stringify(code)}: law 이슈는 그대로, broken 이슈 갱신`);
    assert.equal(a[0].number, 9);
    assert.match(a[0].title, /감시 단계가 결과를 남기지 못함/);
    assert.match(a[0].body, /CHECK_STEP_FAILED/);
    assert.match(a[1].body, /CHECK_STEP_FAILED:-/);
  }
  // 정상 코드면 그대로 닫는다 (대조)
  const ok = nonLabel(planActions({ result: result(), code: '0', runUrl: RUN, now: NOW, lawIssue: lawIssue(ALL13) }));
  assert.deepEqual(ok.map((x) => x.type), ['comment', 'close']);
});

test('sourceId "-" 실행 오류만 있으면 제목에 소스 수 대신 코드', () => {
  const r = result({ ids: ['decree:20260701:287375'], errors: [{ sourceId: '-', code: 'CROSSCHECK_UNAVAILABLE', detail: '39개 중 36개' }] });
  const a = nonLabel(plan(r)).find((x) => x.labels?.includes('law-watch-broken'));
  assert.equal(a.title, '법령 감시 실패: CROSSCHECK_UNAVAILABLE');
  const both = nonLabel(plan(result({ errors: [err('decree', 'FETCH_FAILED'), { sourceId: '-', code: 'CROSSCHECK_UNAVAILABLE' }] })));
  assert.equal(both[0].title, '법령 감시 실패: 소스 1개 오류, CROSSCHECK_UNAVAILABLE');
});

// ───────────── 본문 길이 한도 ─────────────

test('이슈·댓글 본문은 65,536자를 넘지 않는다 (상태 표지는 맨 앞에 온전히 남는다)', () => {
  // 보고서(최대 60,000자) + 늘어난 상태 표지 + carried 안내가 한도를 넘고, 새 항목 1,200건 댓글(줄당 약 70자)도 넘는 경우
  const many = Array.from({ length: 1200 }, (_, i) => `nfpc-${String(i).padStart(4, '0')}:${2100000000000 + i}`);
  const prev = Array.from({ length: 300 }, (_, i) => `decree:2027${String(i).padStart(4, '0')}:${i}`);
  const r = { ...result({ ids: many }), status: 'broken', exitCode: 20, errors: [err('decree', 'FETCH_FAILED')] }; // decree 이전 항목은 carried
  const reportMd = `${renderReport(r, { runUrl: RUN })}\n${'가'.repeat(59000)}`;
  const a = nonLabel(planActions({ result: r, reportMd, code: '20', runUrl: RUN, now: NOW, lawIssue: lawIssue(prev) }));
  assert.deepEqual(a.map((x) => x.type), ['edit', 'comment', 'create']);
  for (const x of a) assert.ok(x.body.length <= 65536, `${x.type}: ${x.body.length}`);
  assert.ok(a[0].body.startsWith(MARKER_LAW));
  assert.deepEqual(parseState(a[0].body).ids, [...many, ...prev].sort(), '상태 표지는 잘리지 않는다');
  assert.match(a[0].body, /한도를 넘어 잘렸습니다/);
  assert.match(a[1].body, /^새로 감지된 개정 1200건:/);
  assert.match(a[1].body, /한도를 넘어 잘렸습니다/);
  // broken 이슈 본문(오류 표)도 자른다
  const errs = Array.from({ length: 400 }, (_, i) => ({ ...err(`nfpc-${i}`, 'PARSE_BAD_ROW'), detail: '가'.repeat(300), snippet: '나'.repeat(300) }));
  const b = nonLabel(plan(result({ errors: errs })));
  assert.ok(b[0].body.length <= 65536 && b[0].body.startsWith(MARKER_BROKEN), String(b[0].body.length));
  assert.match(b[0].body, /한도를 넘어 잘렸습니다/);
  assert.equal(capBody('짧음'), '짧음');
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

// ───────────── --only 부분 실행 ─────────────

test('부분 실행(scope): 범위 안이 모두 반영돼도 law 이슈·broken 이슈를 닫지 않는다', () => {
  const r = result({ scope: scopeOf('decree', 'rules') });
  const a = nonLabel(plan(r, { lawIssue: lawIssue(ALL13), brokenIssue: brokenIssue('FETCH_FAILED:nfpc-108') }));
  assert.deepEqual(a, []);
  // 같은 결과가 전체 실행이면 둘 다 닫는다 (대조)
  const full = nonLabel(plan(result(), { lawIssue: lawIssue(ALL13), brokenIssue: brokenIssue('FETCH_FAILED:nfpc-108') }));
  assert.deepEqual(full.map((x) => `${x.type}:${x.number}`), ['comment:7', 'close:7', 'comment:9', 'close:9']);
});

test('부분 실행(scope): 범위 밖 항목은 상태에 남기고, 새 항목만 알린다 (상태가 줄지 않는다)', () => {
  const quiet = nonLabel(plan(result({ ids: ALL13.filter((id) => id.startsWith('decree:')), scope: scopeOf('decree') }), { lawIssue: lawIssue(ALL13) }));
  assert.deepEqual(quiet, [], '새 항목이 없으면 이슈를 건드리지 않는다');

  const ids = [...ALL13.filter((id) => id.startsWith('decree:')), 'decree:20270101:999999'];
  const a = nonLabel(plan(result({ ids, scope: scopeOf('decree') }), { lawIssue: lawIssue(ALL13) }));
  assert.deepEqual(a.map((x) => x.type), ['edit', 'comment']);
  assert.deepEqual(parseState(a[0].body).ids, [...ALL13, 'decree:20270101:999999'].sort());
  assert.equal(a[0].title, '법령 개정 반영 필요: 14건');
  assert.match(a[0].body, /--only 범위 밖\)의 이전 항목 11건/);
  assert.match(a[1].body, /새로 감지된 개정 1건/);
  assert.match(a[1].body, /decree:20270101:999999/);
});

test('부분 실행(scope): 범위 안 소스가 실패해도 이전 항목을 유지하고 broken 이슈는 만든다', () => {
  const r = result({ ids: [], errors: [err('decree', 'FETCH_FAILED')], scope: scopeOf('decree', 'rules') });
  const a = nonLabel(plan(r, { lawIssue: lawIssue(ALL13) }));
  assert.deepEqual(a.map((x) => x.type), ['create']);
  assert.deepEqual(a[0].labels, ['law-watch-broken']);
});

test('재현: 연혁 반영 후 --only decree,rules 로 돌린 결과는 이슈를 닫지 않는다 (check.mjs → planActions)', async () => {
  const dir = copySnapshot();
  await runCheck({ dataDir: dir, args: ['--apply-history', '--only', 'decree,rules'] });
  const partial = await runCheck({ dataDir: dir, args: ['--only', 'decree,rules'], fetchImpl: chainAware(replay()) });
  assert.equal(partial.code, 0);
  assert.deepEqual(partial.result.scope, { only: ['decree', 'rules'], sources: ['decree', 'rules'] });
  assert.match(partial.report, /부분 실행\(--only decree,rules\)/);
  const a = planActions({ result: partial.result, reportMd: partial.report, code: String(partial.code), runUrl: RUN, now: NOW, lawIssue: lawIssue(ALL13), brokenIssue: brokenIssue('FETCH_FAILED:nfpc-108') });
  assert.deepEqual(nonLabel(a), []);

  // --only decree 로 변경이 남아 있는 실행도 상태를 13건에서 줄이지 않는다
  const one = await runCheck({ args: ['--only', 'decree'] });
  assert.equal(one.code, 10);
  const b = nonLabel(planActions({ result: one.result, reportMd: one.report, code: '10', runUrl: RUN, now: NOW, lawIssue: lawIssue(ALL13) }));
  assert.deepEqual(b, []);
});

test('결과 파일이 없으면(충돌·시간 초과·앞 단계 실패) CHECK_STEP_FAILED broken 이슈만', () => {
  const a = nonLabel(planActions({ result: null, code: 1, runUrl: RUN, now: NOW, lawIssue: lawIssue(['decree:1:1']) }));
  assert.deepEqual(a.map((x) => x.type), ['create']);
  assert.equal(a[0].title, '법령 감시 실패: 감시 단계가 결과를 남기지 못함 (exit 1)');
  assert.match(a[0].body, /CHECK_STEP_FAILED:-/);
  assert.match(a[0].body, /result\.json 이 없음/);
  assert.equal(errorSignature(null, 1), 'CHECK_STEP_FAILED:-');
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

const SYNC_SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'sync-issues.mjs');
function drySync(out, code, issueList) {
  const issues = path.join(out, 'issues.json');
  fs.writeFileSync(issues, JSON.stringify(issueList));
  const p = spawnSync(process.execPath, [SYNC_SCRIPT, '--out', out, '--code', code, '--dry-run', '--issues-json', issues, '--now', NOW.toISOString()], {
    encoding: 'utf8',
    // 만에 하나 gh 가 실행되더라도 쓰기가 일어나지 않도록 잘못된 토큰·저장소를 준다
    env: { ...process.env, RUN_URL: RUN, GH_TOKEN: 'invalid-token-for-test', GH_REPO: 'example/invalid' },
  });
  assert.equal(p.status, 0, p.stderr);
  const lines = p.stdout.trim().split('\n');
  assert.ok(lines.every((l) => l.startsWith('[dry-run] gh ')));
  return lines;
}

test('--dry-run: gh 를 실행하지 않고 명령만 출력한다', () => {
  const out = tmpDir('law-watch-sync-');
  const r = result({ ids: ['decree:20260701:287375'] });
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(r));
  fs.writeFileSync(path.join(out, 'report.md'), renderReport(r));
  const lines = drySync(out, '10', [lawIssue([], { number: 3, createdAt: '2026-09-01T00:00:00Z' })]);
  assert.deepEqual(
    lines.map((l) => l.split(' ').slice(2, 4).join(' ')),
    ['label create', 'label create', 'label create', 'label create', 'issue edit', 'issue comment', 'issue comment'],
  );
});

test('--dry-run: 워크플로가 결과 없이 --code none(또는 빈 값)을 넘기면 CHECK_STEP_FAILED broken 이슈를 만든다', () => {
  for (const code of ['none', '']) {
    const out = tmpDir('law-watch-sync-'); // result.json 없음 (테스트 단계 실패·시간 초과)
    const lines = drySync(out, code, [lawIssue(ALL13)]);
    const rest = lines.slice(4);
    assert.equal(rest.length, 1, rest.join('\n'));
    assert.match(rest[0], /^\[dry-run\] gh issue create --title "법령 감시 실패: 감시 단계가 결과를 남기지 못함 \(exit (none|없음)\)" .*--label law-watch-broken/);
  }
});
