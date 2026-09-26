// 레지스트리·inline 기준선·HTTP 예절·연혁 삽입·영향 추정·보고서
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BudgetError, FetchError, createHttp } from '../check.mjs';
import {
  MARKER_LAW,
  expandSources,
  fingerprint,
  historyCmp,
  historyRowKey,
  impactGuess,
  insertHistoryRow,
  isSubstitutionOnly,
  parseState,
  renderReport,
  todayKst,
  validateRegistry,
} from '../lib.mjs';
import { REGISTRY, REPO_DATA, SNAPSHOT, readJson, runCheck, writeRegistry } from './helpers.mjs';

// ───────────── 레지스트리 ─────────────

test('저장소 레지스트리(data/law_watch.json)는 유효하고 연혁 기준 소스 39개(법령 3 + 기준 36)로 펼쳐진다', () => {
  const reg = readJson(path.join(REPO_DATA, 'law_watch.json'));
  assert.deepEqual(validateRegistry(reg), []);
  const baselines = { 'data/nfsc_history.json': readJson(path.join(SNAPSHOT, 'nfsc_history.json')) };
  const { sources, errors } = expandSources(reg, baselines);
  assert.deepEqual(errors, []);
  assert.equal(sources.filter((s) => s.baseline.from === 'history').length, 39);
  assert.deepEqual(sources.slice(0, 3).map((s) => s.id), ['act', 'decree', 'rules']);
  const ids = sources.map((s) => s.id);
  for (const id of ['nfpc-103a', 'nfpc-107a', 'nfpc-501a', 'nfpc-604', 'nfpc-seismic']) assert.ok(ids.includes(id), id);
  const hi = sources.find((s) => s.id === 'nfpc-604');
  assert.deepEqual(hi.affects, ['data/ref06_high_rise_building.json']);
  assert.equal(hi.targetKey, '고층건축물의 화재안전기준 (NFSC 604)');
  assert.equal(hi.name, '고층건축물의 화재안전성능기준 (NFPC 604)');
  const n108 = sources.find((s) => s.id === 'nfpc-108');
  assert.deepEqual([n108.anchorSeq, n108.kind, n108.group, n108.target], ['2100000253098', 'admrul', 'nfpc', 'data/nfsc_history.json']);
  // 기록 당시 소스는 저장소 레지스트리에 그대로 있다 (inline 소스 추가는 허용 — 골든은 기록 당시 레지스트리로 재생)
  for (const s of readJson(REGISTRY).sources) assert.deepEqual(reg.sources.find((x) => x.id === s.id), s, s.id);
});

test('레지스트리 형식 오류를 잡는다', () => {
  const ok = readJson(REGISTRY);
  const bad = (edit) => {
    const r = structuredClone(ok);
    edit(r);
    return validateRegistry(r);
  };
  assert.match(bad((r) => (r.version = 2)).join(), /version/);
  assert.match(bad((r) => (r.sources[1].id = 'act')).join(), /id 중복/);
  assert.match(bad((r) => delete r.sources[1].lsId).join(), /lsId/);
  assert.match(bad((r) => (r.sources[0].baseline = { from: 'inline', asOf: '2026-13-01', known: [] })).join(), /asOf/);
  assert.match(bad((r) => (r.sources[0].baseline = { from: 'inline', asOf: '2026-01-20', known: ['20260701-287375'] })).join(), /키 형식/);
  assert.match(bad((r) => (r.http.maxRequests = -1)).join(), /maxRequests/);
  assert.match(bad((r) => (r.sources[3].expand = 'other')).join(), /expand/);
  assert.deepEqual(validateRegistry([]), ['레지스트리가 JSON 객체가 아님']);
  const noCode = expandSources({ sources: [{ id: 'g', kind: 'admrul', expand: 'nfsc', baseline: { from: 'history', file: 'x.json' } }] }, {
    'x.json': { '이름에 코드 없는 기준': [{ link: 'https://www.law.go.kr/LSW/admRulInfoP.do?admRulSeq=1', name: 'n' }] },
  });
  assert.match(noCode.errors[0], /overrides/);
});

// ───────────── inline 기준선 (이번 PR 에서는 켜지 않지만 코드는 지원) ─────────────

const DECREE = '소방시설 설치 및 관리에 관한 법률 시행령';
const snapshotKeys = (file, kind, key) => {
  const data = readJson(path.join(SNAPSHOT, file));
  return (key ? data[key] : data).map((r) => historyRowKey(kind, r).key);
};

function inlineRegistry(extra = []) {
  return writeRegistry((reg) => {
    reg.sources = [
      {
        id: 'decree-inline',
        kind: 'law',
        lsId: '009694',
        name: DECREE,
        baseline: { from: 'inline', asOf: '2026-01-20', known: snapshotKeys('law_history_decree.json', 'law') },
        affects: ['data/ref05_fire_safety_manager.json'],
      },
      {
        id: 'nfpc108-inline',
        kind: 'admrul',
        admRulSeq: '2100000253098',
        name: '분말소화설비의 화재안전성능기준(NFPC 108)',
        baseline: { from: 'inline', asOf: '2026-01-20', known: snapshotKeys('nfsc_history.json', 'admrul', '분말소화설비의 화재안전기준(NFSC 108)') },
      },
      ...extra,
    ];
  });
}

test('inline 기준선: 연혁 파일 없이 known 키로 대조, 대상 파일 없음(target=null)', async () => {
  const registry = inlineRegistry();
  const { code, result } = await runCheck({ registry });
  assert.equal(code, 10);
  assert.deepEqual(result.changes.map((c) => c.id).sort(), ['decree-inline:20260324:284781', 'decree-inline:20260701:287375', 'nfpc108-inline:2100000278572']);
  for (const c of result.changes) {
    assert.equal(c.target, null);
    assert.ok(c.suggestedRow.link.startsWith('https://www.law.go.kr/LSW/'));
  }
  assert.equal(result.changes.find((c) => c.sourceId === 'decree-inline').suggestedRow.law_no, '제36432호');
});

test('--ack: inline known 에 키를 더하면 다음 실행에서 사라진다 (history 소스는 거부)', async () => {
  const registry = inlineRegistry();
  const logs = [];
  const { main } = await import('../check.mjs');
  assert.equal(await main(['--registry', registry, '--ack', 'decree-inline:20260701:287375,decree-inline:20260324:284781'], { log: (m) => logs.push(m) }), 0);
  const text = fs.readFileSync(registry, 'utf8');
  assert.equal(text, JSON.stringify(JSON.parse(text), null, 2));
  const after = await runCheck({ registry });
  assert.deepEqual(after.result.changes.map((c) => c.id), ['nfpc108-inline:2100000278572']);
  assert.equal(await main(['--registry', REGISTRY, '--ack', 'decree:20260701:287375'], { log: () => {} }), 30);
  assert.equal(await main(['--registry', registry, '--ack', 'decree-inline:2026-07-01'], { log: () => {} }), 30);
});

test('--bootstrap: 공포일 ≤ asOf 인 라이브 키 = 그 시점 연혁 키', async () => {
  const registry = inlineRegistry();
  const printed = [];
  const { code } = await runCheck({ registry, args: ['--bootstrap', 'decree-inline', '--as-of', '2026-01-20'], print: (m) => printed.push(m) });
  assert.equal(code, 0);
  const out = JSON.parse(printed.find((p) => p.startsWith('{')));
  assert.equal(out.asOf, '2026-01-20');
  assert.deepEqual(new Set(out.known), new Set(snapshotKeys('law_history_decree.json', 'law')));
});

test('inline 기준선이 비어 있으면 ANCHOR_MISSING, known 이 하나뿐이면 나머지 전부가 변경 (개정문 조회 상한 30)', async () => {
  const empty = writeRegistry((reg) => {
    reg.sources = [{ id: 'd', kind: 'law', lsId: '009694', name: DECREE, baseline: { from: 'inline', asOf: '2026-01-20', known: [] } }];
  });
  const a = await runCheck({ registry: empty });
  assert.equal(a.code, 20);
  assert.equal(a.result.errors[0].code, 'ANCHOR_MISSING');

  const one = writeRegistry((reg) => {
    reg.sources = [{ id: 'd', kind: 'law', lsId: '009694', name: DECREE, baseline: { from: 'inline', asOf: '2026-01-20', known: ['20270101:267669'] } }];
  });
  const b = await runCheck({ registry: one, args: ['--no-crosscheck'] });
  assert.equal(b.code, 10);
  assert.equal(b.result.changes.length, 78);
  assert.ok(b.result.warnings.some((w) => w.code === 'ENRICH_CAPPED'));
  assert.equal(b.result.stats.requests, 1 + 30);
});

// ───────────── HTTP 예절 ─────────────

function fakeFetch(script) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const step = script[Math.min(calls.length - 1, script.length - 1)];
    if (step instanceof Error) throw step;
    return new Response(step.body ?? 'ok', { status: step.status ?? 200, headers: step.headers ?? { 'content-type': 'text/html;charset=UTF-8' } });
  };
  fn.calls = calls;
  return fn;
}
const REQ = { method: 'POST', url: 'https://www.law.go.kr/LSW/lsHstListR.do', body: 'lsId=009694&chrClsCd=010202&ancYnChk=0' };

test('HTTP: POST 헤더, 요청 간격 2초±0.5초', async () => {
  const waits = [];
  const f = fakeFetch([{ status: 200 }]);
  const http = createHttp({ fetchImpl: f, sleep: async (ms) => void waits.push(ms), random: () => 1 });
  await http.request(REQ);
  await http.request(REQ);
  const h = f.calls[0].init.headers;
  assert.equal(h['Content-Type'], 'application/x-www-form-urlencoded; charset=UTF-8');
  assert.equal(h['X-Requested-With'], 'XMLHttpRequest');
  assert.equal(h.Referer, 'https://www.law.go.kr/');
  assert.equal(h['Accept-Language'], 'ko-KR');
  assert.match(h['User-Agent'], /^limjungfire-law-watch\/1\.0/);
  assert.equal(f.calls[0].init.body, REQ.body);
  assert.deepEqual(waits, [2500]);
  assert.equal(http.count, 2);
});

test('HTTP: 429 는 Retry-After(≤120초)를 따르고, 120초를 넘으면 기다리지 않는다', async () => {
  const waits = [];
  const sleep = async (ms) => void waits.push(ms);
  const a = createHttp({ fetchImpl: fakeFetch([{ status: 429, headers: { 'retry-after': '30' } }, { status: 200 }]), sleep, random: () => 0.5 });
  assert.equal((await a.request(REQ)).status, 200);
  assert.deepEqual(waits, [30000, 2000]);
  waits.length = 0;
  const f = fakeFetch([{ status: 429, headers: { 'retry-after': '600' } }, { status: 200 }]);
  const b = createHttp({ fetchImpl: f, sleep, random: () => 0.5 });
  assert.equal((await b.request(REQ)).status, 429);
  assert.equal(f.calls.length, 1);
});

test('HTTP: 404 는 재시도하지 않고, 네트워크 오류는 3번 재시도 후 FetchError', async () => {
  const f404 = fakeFetch([{ status: 404 }]);
  const http = createHttp({ fetchImpl: f404, sleep: async () => {} });
  assert.equal((await http.request(REQ)).status, 404);
  assert.equal(f404.calls.length, 1);
  const waits = [];
  const fErr = fakeFetch([new TypeError('fetch failed')]);
  const h2 = createHttp({ fetchImpl: fErr, sleep: async (ms) => void waits.push(ms), random: () => 0.5 });
  await assert.rejects(h2.request(REQ), FetchError);
  assert.equal(fErr.calls.length, 4);
  assert.deepEqual(waits.filter((w) => w >= 5000), [5000, 15000, 45000]);
});

test('HTTP: 예산(maxRequests)은 재시도를 포함해 센다', async () => {
  const http = createHttp({ fetchImpl: fakeFetch([{ status: 503 }]), sleep: async () => {}, config: { maxRequests: 2 } });
  await assert.rejects(http.request(REQ), BudgetError);
  assert.equal(http.count, 2);
});

test('HTTP: 선언된 charset 이 EUC-KR 이면 그대로 디코드', async () => {
  const euc = new Uint8Array([0xbc, 0xd2, 0xb9, 0xe6]); // "소방"
  const f = async () => new Response(euc, { status: 200, headers: { 'content-type': 'text/html; charset=EUC-KR' } });
  const http = createHttp({ fetchImpl: f, sleep: async () => {} });
  assert.equal((await http.request(REQ)).text, '소방');
});

// ───────────── 연혁 삽입 · 동률 규칙 ─────────────

const row = (ef, prom, no, seq) => ({ no: 0, name: 'n', effective_date: ef, law_no: `제${no}호`, promulgation_date: prom, revision_type: '일부개정', link: `https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=${seq}` });

test('insertHistoryRow: 시행일 내림차순, 동률이면 공포일 늦은 것 → 번호 큰 것 먼저, no 재부여, 멱등', () => {
  const base = [row('20260301', '20251125', 100, 1), row('20240517', '20240507', 90, 2), row('20240517', '20240507', 80, 3), row('20200101', '20191201', 70, 4)].map((r, i) => ({ ...r, no: i + 1 }));
  let rows = insertHistoryRow(base, row('20240517', '20240601', 10, 5), 'law'); // 공포일 더 늦음 → 동률 맨 앞
  rows = insertHistoryRow(rows, row('20240517', '20240507', 85, 6), 'law'); // 공포일 같고 번호 85 → 90 과 80 사이
  rows = insertHistoryRow(rows, row('20270101', '20241231', 99, 7), 'law'); // 가장 최근 → 맨 앞
  rows = insertHistoryRow(rows, row('20240517', '20240501', 999, 8), 'law'); // 공포일 더 이름 → 동률 맨 뒤
  assert.deepEqual(rows.map((r) => `${r.no}:${r.effective_date}:${r.law_no}`), [
    '1:20270101:제99호',
    '2:20260301:제100호',
    '3:20240517:제10호',
    '4:20240517:제90호',
    '5:20240517:제85호',
    '6:20240517:제80호',
    '7:20240517:제999호',
    '8:20200101:제70호',
  ]);
  assert.deepEqual(Object.keys(rows[0]), ['no', 'name', 'effective_date', 'law_no', 'promulgation_date', 'revision_type', 'link']);
  assert.deepEqual(insertHistoryRow(rows, row('20240517', '20240507', 85, 6), 'law'), rows);
  // 고시 번호 "2023-40" > "2023-39"
  assert.ok(historyCmp({ effective_date: '1', promulgation_date: '1', notice_no: '소방청고시 제2023-40호' }, { effective_date: '1', promulgation_date: '1', notice_no: '소방청고시 제2023-39호' }) < 0);
});

// ───────────── 영향 추정 ─────────────

test('impactGuess: 재검토 → none, 자구 치환만 → wording, 기준 키워드 → criteria, 그 밖 → unknown', () => {
  assert.equal(impactGuess({ amendment: '제18조를 삭제한다.', reason: '재검토기한을 삭제하여 정비' }), 'none');
  assert.equal(impactGuess({ amendment: '제20조 중 "광역시장"을 "통합특별시장ㆍ광역시장"으로 한다.' }), 'wording');
  assert.equal(impactGuess({ amendment: '별표 4 제1호다목 중 "600제곱미터"를 "300제곱미터"로 하고, 같은 호에 라목을 신설한다.' }), 'criteria');
  assert.equal(impactGuess({ amendment: '제3조제2항 중 "연면적 600㎡"를 "연면적 300㎡"로 하고 제4조를 삭제한다.', reason: '면적 기준 강화' }), 'criteria');
  assert.equal(impactGuess({ amendment: '제12조를 삭제한다.', names: [DECREE] }), 'unknown');
  // 법령 이름의 "설치" 는 기준 키워드로 보지 않는다
  assert.equal(impactGuess({ amendment: `${DECREE} 제40조를 삭제한다.`, names: [DECREE] }), 'unknown');
  assert.equal(isSubstitutionOnly('제1조 중 "A"를 "B"로, "C"를 "D"로 한다. 별지 제1호서식 중 "E"를 각각 "F"로 한다.'), true);
  assert.equal(isSubstitutionOnly('제1조 중 "A"를 "B"로 하고, 제2조를 신설한다.'), false);
  assert.equal(isSubstitutionOnly(''), false);
});

// ───────────── 보고서 · 지문 · 날짜 ─────────────

function fakeResult(n) {
  const changes = Array.from({ length: n }, (_, i) => ({
    id: `decree:2026${String(i).padStart(4, '0')}:${i}`,
    sourceId: 'decree',
    kind: 'law',
    title: DECREE,
    efYd: '20260701',
    ancYd: '20260623',
    number: `대통령령 제${i}호`,
    revisionType: '일부개정',
    seq: String(i),
    isCurrent: false,
    isFuture: true,
    link: `https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=${i}`,
    target: 'data/law_history_decree.json',
    suggestedRow: { name: DECREE },
    excerpt: { amendment: '가'.repeat(700), addenda: '<부칙> | 표', reason: '나'.repeat(300), transitional: ['제2조(적용례)'] },
    impactGuess: 'criteria',
    affects: [],
  }));
  const ids = changes.map((c) => c.id);
  return { todayKst: '20260926', status: 'changes', fingerprint: fingerprint(ids), stats: { sources: 1, healthy: 1, requests: 3, ms: 1 }, changes, warnings: [], errors: [] };
}

test('renderReport: 표지 두 줄, 표, <details>, 꺾쇠·파이프 이스케이프, 60,000자에서 자르고 아티팩트 안내', () => {
  const small = renderReport(fakeResult(2), { runUrl: 'https://example/run/1' });
  const lines = small.split('\n');
  assert.equal(lines[0], MARKER_LAW);
  assert.equal(parseState(lines[1]).ids.length, 2);
  assert.match(small, /\*\*법령 개정 반영 필요: 2건\*\*/);
  assert.match(small, /&lt;부칙&gt; \| 표/);
  assert.match(small, /적용례 1 → 검토 필요/);
  assert.match(small, /시행예정/);
  const big = renderReport(fakeResult(200), { runUrl: 'https://example/run/1' });
  assert.ok(big.length <= 60000, String(big.length));
  assert.match(big, /60,000자를 넘어 잘렸습니다/);
  assert.match(big, /https:\/\/example\/run\/1/);
  assert.equal(parseState(big.split('\n')[1]).ids.length, 200, '상태 표지에는 전체 id');
});

test('fingerprint 는 순서와 무관, todayKst 는 UTC+9', () => {
  assert.equal(fingerprint(['b', 'a']), fingerprint(['a', 'b']));
  assert.equal(fingerprint(['a']).length, 12);
  assert.equal(todayKst(new Date('2026-09-25T14:59:59Z')), '20260925');
  assert.equal(todayKst(new Date('2026-09-25T15:00:00Z')), '20260926');
});

test('기본 --out 은 저장소 밖(os.tmpdir 아래)이다', async () => {
  const { main } = await import('../check.mjs');
  const logs = [];
  const code = await main(['--replay', path.join(SNAPSHOT, '..'), '--data-dir', SNAPSHOT, '--registry', REGISTRY, '--only', 'act'], { log: (m) => logs.push(m), runUrl: '' });
  assert.equal(code, 0);
  const outLine = logs.find((l) => l.startsWith('결과:'));
  const out = path.resolve(outLine.slice(outLine.lastIndexOf('→') + 1).trim());
  assert.ok(out.startsWith(path.resolve(os.tmpdir())), out);
  assert.ok(!out.startsWith(path.resolve(REPO_DATA, '..')), out);
  assert.ok(fs.existsSync(path.join(out, 'result.json')));
  fs.rmSync(out, { recursive: true, force: true });
});
