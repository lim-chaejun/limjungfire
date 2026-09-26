// 골든(재생) · 왕복(연혁 반영 후 재실행) · 고장 시나리오
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runChecks, loadDataDir, CHECKS } from '../../validate-data.mjs';
import { MARKER_LAW, historyRowKey, parseState } from '../lib.mjs';
import { SNAPSHOT, chainAware, copySnapshot, mutating, readJson, replay, runCheck, writeRegistry } from './helpers.mjs';

// 2026-09-26 law.go.kr 기준, origin/main 연혁 데이터에 없는 개정 13건
const GOLDEN = [
  'decree:20260324:284781', // 대통령령 제36220호 (타법개정, 규제 재검토기한 정비)
  'decree:20260701:287375', // 대통령령 제36432호 (타법개정, 통합특별시)
  'nfpc-108:2100000278572', // 소방청고시 제2026-15호
  'nfpc-201:2100000278574', // 제2026-16호
  'nfpc-205:2100000278570', // 제2026-13호
  'nfpc-304:2100000278586', // 제2026-17호
  'nfpc-401:2100000278590', // 제2026-19호
  'nfpc-402:2100000278592', // 제2026-22호
  'nfpc-503:2100000278594', // 제2026-24호
  'nfpc-504:2100000278588', // 제2026-18호
  'nfpc-505:2100000278542', // 제2026-14호
  'nfpc-602:2100000278578', // 제2026-21호
  'rules:20260701:287831', // 행정안전부령 제628호 (타법개정)
];

test('골든: 연혁 기준 39개 소스 → 정확히 13건, exit 10', async () => {
  const { code, result, report } = await runCheck();
  assert.equal(code, 10);
  assert.equal(result.status, 'changes');
  assert.equal(result.todayKst, '20260926');
  assert.deepEqual(result.stats.sources, 39);
  assert.equal(result.stats.healthy, 39);
  assert.equal(result.stats.requests, 91);
  assert.deepEqual(result.changes.map((c) => c.id).sort(), GOLDEN);
  assert.deepEqual(result.errors, []);

  const byId = Object.fromEntries(result.changes.map((c) => [c.id, c]));
  const d36432 = byId['decree:20260701:287375'];
  assert.deepEqual(
    [d36432.efYd, d36432.ancYd, d36432.number, d36432.revisionType, d36432.isCurrent, d36432.isFuture, d36432.impactGuess, d36432.target],
    ['20260701', '20260623', '대통령령 제36432호', '타법개정', true, false, 'wording', 'data/law_history_decree.json'],
  );
  assert.deepEqual(d36432.suggestedRow, {
    name: '소방시설 설치 및 관리에 관한 법률 시행령',
    effective_date: '20260701',
    law_no: '제36432호',
    promulgation_date: '20260623',
    revision_type: '타법개정',
    link: 'https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=287375',
  });
  const d36220 = byId['decree:20260324:284781'];
  assert.deepEqual([d36220.efYd, d36220.number, d36220.revisionType, d36220.isCurrent, d36220.impactGuess], ['20260324', '대통령령 제36220호', '타법개정', false, 'none']);
  assert.equal(byId['rules:20260701:287831'].suggestedRow.law_no, '행정안전부령 제628호');

  const nfpc = result.changes.filter((c) => c.sourceId.startsWith('nfpc-'));
  assert.equal(nfpc.length, 10);
  for (const c of nfpc) {
    assert.equal(c.efYd, '20260504');
    assert.equal(c.revisionType, '일부개정');
    assert.equal(c.impactGuess, 'none');
    assert.equal(c.target, 'data/nfsc_history.json');
    assert.match(c.suggestedRow.notice_no, /^소방청고시 제2026-(1[3-9]|2[0-4])호$/);
  }
  assert.equal(byId['nfpc-108:2100000278572'].suggestedRow.notice_no, '소방청고시 제2026-15호');
  assert.equal(byId['nfpc-108:2100000278572'].targetKey, '분말소화설비의 화재안전기준(NFSC 108)');

  // 법률은 변경 없음, 109·303(같은 시행일 2행)은 오탐하지 않음, 시행령의 2027 시행예정 행이 2026 개정을 가리지 않음
  assert.equal(result.changes.filter((c) => c.sourceId === 'act').length, 0);
  assert.equal(result.changes.filter((c) => ['nfpc-109', 'nfpc-303'].includes(c.sourceId)).length, 0);
  assert.equal(result.changes.filter((c) => c.sourceId === 'decree').length, 2);

  // 경고: seq 없는 옛 고시 2행만
  assert.deepEqual(
    result.warnings.map((w) => `${w.sourceId}:${w.code}`),
    ['nfpc-107:ROW_WITHOUT_SEQ', 'nfpc-107a:ROW_WITHOUT_SEQ'],
  );

  // 보고서 표지와 상태
  const lines = report.split('\n');
  assert.equal(lines[0], MARKER_LAW);
  const state = parseState(lines[1]);
  assert.equal(state.fp, result.fingerprint);
  assert.deepEqual(state.ids, GOLDEN);
  assert.match(report, /\| 대상 \| 시행일 \| 공포 \| 번호 \| 구분 \| 현행\/시행예정 \| 영향\(추정\) \| 원문 \|/);
  assert.equal((report.match(/<details>/g) ?? []).length, 13);
});

test('회귀: 같은 시행일을 공유하는 NFPC 109·303 연혁은 기준선에 모두 있다', () => {
  const nfsc = readJson(path.join(SNAPSHOT, 'nfsc_history.json'));
  for (const key of ['옥외소화전설비의 화재안전기준(NFSC 109)', '유도등 및 유도표지의 화재안전기준(NFSC 303)']) {
    const [a, b] = nfsc[key];
    assert.equal(a.effective_date, b.effective_date, `${key} 첫 두 행 시행일 동률`);
  }
});

test('왕복: --apply-history 로 스냅샷 사본에 반영 → 다시 실행하면 0건, exit 0', async () => {
  const dir = copySnapshot();
  const first = await runCheck({ dataDir: dir, args: ['--apply-history'] });
  assert.equal(first.code, 10);

  for (const f of ['law_history_act.json', 'law_history_decree.json', 'law_history_rules.json', 'nfsc_history.json']) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.equal(text, JSON.stringify(JSON.parse(text), null, 2), `${f}: JSON.stringify(x,null,2), 끝 개행 없음`);
  }
  // 법률은 손대지 않음(바이트 동일)
  assert.equal(fs.readFileSync(path.join(dir, 'law_history_act.json'), 'utf8'), fs.readFileSync(path.join(SNAPSHOT, 'law_history_act.json'), 'utf8'));

  const decree = readJson(path.join(dir, 'law_history_decree.json'));
  assert.equal(decree.length, 79);
  assert.deepEqual(
    decree.slice(0, 5).map((r) => `${r.no}:${r.effective_date}:${r.law_no}`),
    ['1:20270101:제35151호', '2:20260701:제36432호', '3:20260324:제36220호', '4:20260301:제35860호', '5:20251201:제35860호'],
  );
  assert.deepEqual(decree[1], {
    no: 2,
    name: '소방시설 설치 및 관리에 관한 법률 시행령',
    effective_date: '20260701',
    law_no: '제36432호',
    promulgation_date: '20260623',
    revision_type: '타법개정',
    link: 'https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=287375',
  });
  const rules = readJson(path.join(dir, 'law_history_rules.json'));
  assert.deepEqual([rules.length, rules[0].law_no, rules[1].no], [41, '행정안전부령 제628호', 2]);
  const nfsc = readJson(path.join(dir, 'nfsc_history.json'));
  const before = readJson(path.join(SNAPSHOT, 'nfsc_history.json'));
  assert.deepEqual(Object.keys(nfsc), Object.keys(before), '기준명 키는 그대로, 순서도 그대로');
  assert.equal(nfsc['분말소화설비의 화재안전기준(NFSC 108)'][0].notice_no, '소방청고시 제2026-15호');
  assert.equal(nfsc['옥외소화전설비의 화재안전기준(NFSC 109)'].length, before['옥외소화전설비의 화재안전기준(NFSC 109)'].length);

  // 동률 규칙: 같은 시행일이면 공포일 늦은 것 → 번호 큰 것 먼저 (기존 동률 순서 유지 포함)
  const d20240517 = decree.filter((r) => r.effective_date === '20240517').map((r) => r.law_no);
  assert.deepEqual(d20240517, ['제34488호', '제34487호']);

  // 반영 결과는 데이터 가드를 통과한다
  const v = runChecks(loadDataDir(dir), { checks: CHECKS.filter((c) => c.name.startsWith('history-')) });
  assert.equal(v.errorCount, 0, JSON.stringify(v.results.filter((r) => r.errors.length)));

  // 체인 조회는 새 앵커 seq 로 나가므로, 체인 안의 어느 seq 로도 같은 체인을 주는 실제 동작을 재현한다
  const second = await runCheck({ dataDir: dir, fetchImpl: chainAware(replay()) });
  assert.equal(second.code, 0, JSON.stringify(second.result.errors));
  assert.equal(second.result.status, 'ok');
  assert.equal(second.result.changes.length, 0);
  assert.deepEqual(
    second.result.warnings.map((w) => w.code),
    ['ROW_WITHOUT_SEQ', 'ROW_WITHOUT_SEQ'],
  );
  assert.match(second.report, /\*\*변경 없음\*\*/);

  // 한 번 더 반영해도 그대로 (멱등)
  const snap = fs.readFileSync(path.join(dir, 'nfsc_history.json'), 'utf8');
  await runCheck({ dataDir: dir, args: ['--apply-history'], fetchImpl: chainAware(replay()) });
  assert.equal(fs.readFileSync(path.join(dir, 'nfsc_history.json'), 'utf8'), snap);
});

// ───────────── 고장 시나리오 ─────────────

const isDecreeList = ({ url, body }) => url.endsWith('/lsHstListR.do') && body.includes('lsId=009694');

test('고장: 목록의 lsViewLsHst2 이름이 바뀌면 PARSE_ZERO_ROWS, exit 20 (변경 없음으로 보지 않음)', async () => {
  const fetchImpl = mutating(replay(), (r) => (isDecreeList(r) ? { text: r.text.replaceAll('lsViewLsHst2(', 'lsViewLsHstX(') } : null));
  const { code, result } = await runCheck({ fetchImpl });
  assert.equal(code, 20);
  assert.equal(result.status, 'broken');
  const e = result.errors.find((x) => x.sourceId === 'decree');
  assert.equal(e.code, 'PARSE_ZERO_ROWS');
  assert.equal(e.http, 200);
  assert.ok(e.bytes > 0 && e.snippet.length > 0 && e.snippet.length <= 300);
  // 정상 소스의 변경은 그대로 보고된다
  assert.equal(result.changes.length, 11);
  assert.equal(result.stats.healthy, 38);
});

test('고장: 한 행의 형식이 깨지면 PARSE_BAD_ROW (조용히 빠뜨리지 않음)', async () => {
  const fetchImpl = mutating(replay(), (r) => (isDecreeList(r) ? { text: r.text.replace("'20260623', '36432', '20260701'", "'20260623', '36432', '2026-07-01'") } : null));
  const { code, result } = await runCheck({ fetchImpl, args: ['--only', 'decree'] });
  assert.equal(code, 20);
  assert.equal(result.errors[0].code, 'PARSE_BAD_ROW');
});

test('고장: 앵커 행이 사라지면 ANCHOR_MISSING (고시 체인 · 법령 목록)', async () => {
  const dropLi = (text, needle) => text.replace(new RegExp(`<li>(?:(?!</li>)[\\s\\S])*${needle}[\\s\\S]*?</li>`), '');
  const adm = mutating(replay(), (r) => (r.url.endsWith('/admRulHstListR.do') && r.body === 'admRulSeq=2100000253098' ? { text: dropLi(r.text, "'2100000253098'") } : null));
  const a = await runCheck({ fetchImpl: adm, args: ['--only', 'nfpc-108'] });
  assert.equal(a.code, 20);
  assert.deepEqual(a.result.errors.map((e) => `${e.sourceId}:${e.code}`), ['nfpc-108:ANCHOR_MISSING']);

  const law = mutating(replay(), (r) => (isDecreeList(r) ? { text: r.text.replace(/<li style="width:auto">(?:(?!<\/li>)[\s\S])*'267669', '20241231', '35151', '20270101'[\s\S]*?<\/li>/, '') } : null));
  const b = await runCheck({ fetchImpl: law, args: ['--only', 'decree'] });
  assert.equal(b.code, 20);
  assert.deepEqual(b.result.errors.map((e) => e.code), ['ANCHOR_MISSING']);
});

test('고장: 목록이 잘려 기준선보다 짧으면 LIVE_SHRUNK', async () => {
  const fetchImpl = mutating(replay(), (r) => {
    if (!isDecreeList(r)) return null;
    const parts = r.text.split('<li style="width:auto">');
    return { text: parts.slice(0, 31).join('<li style="width:auto">') + '</ul></div>' };
  });
  const { code, result } = await runCheck({ fetchImpl, args: ['--only', 'decree'] });
  assert.equal(code, 20);
  assert.equal(result.errors[0].code, 'LIVE_SHRUNK');
});

test('고장: 현행(Y) 행이 없으면 CURRENT_NOT_UNIQUE', async () => {
  const fetchImpl = mutating(replay(), (r) => (isDecreeList(r) ? { text: r.text.replace("'20260701', 'Y'", "'20260701', 'N'") } : null));
  const { code, result } = await runCheck({ fetchImpl, args: ['--only', 'decree'] });
  assert.equal(code, 20);
  assert.equal(result.errors[0].code, 'CURRENT_NOT_UNIQUE');
});

test('래퍼가 메인 페이지를 주면 NAME_LOOKUP_MISS 경고만 (exit 는 변경 여부로)', async () => {
  const fetchImpl = mutating(replay(), (r) => (r.url.includes('/%EB%B2%95%EB%A0%B9/') ? { text: '<html><head><title>국가법령정보센터</title></head><body>메인</body></html>' } : null));
  const { code, result } = await runCheck({ fetchImpl, args: ['--only', 'act,decree'] });
  assert.equal(code, 10);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings.map((w) => `${w.sourceId}:${w.code}`), ['act:NAME_LOOKUP_MISS', 'decree:NAME_LOOKUP_MISS']);
  assert.equal(result.changes.length, 2);
});

test('래퍼가 다른 현행 버전을 가리키면 CROSSCHECK_MISMATCH, exit 20', async () => {
  const fetchImpl = mutating(replay(), (r) => (r.url.includes('/%EB%B2%95%EB%A0%B9/') ? { text: r.text.replace('lsiSeq=287375', 'lsiSeq=279911') } : null));
  const { code, result } = await runCheck({ fetchImpl, args: ['--only', 'decree'] });
  assert.equal(code, 20);
  assert.equal(result.errors[0].code, 'CROSSCHECK_MISMATCH');
  assert.equal(result.changes.length, 0);
});

test('고장: 503 이 4번 이어지면 재시도(5/15/45초) 후 FETCH_FAILED, exit 20', async () => {
  let attempts = 0;
  const waits = [];
  const fetchImpl = mutating(replay(), (r) => {
    if (!isDecreeList(r)) return null;
    attempts++;
    return { status: 503, text: 'Service Unavailable' };
  });
  const { code, result } = await runCheck({ fetchImpl, sleep: async (ms) => void waits.push(ms), random: () => 0.5, args: ['--only', 'decree'] });
  assert.equal(code, 20);
  assert.equal(attempts, 4);
  assert.deepEqual(waits.filter((ms) => ms >= 5000), [5000, 15000, 45000]);
  assert.ok(waits.filter((ms) => ms < 5000).every((ms) => ms === 2000), '요청 간격 2초(jitter 0)');
  assert.deepEqual([result.errors[0].code, result.errors[0].http], ['FETCH_FAILED', 503]);
});

test('요청 예산을 넘으면 BUDGET_EXCEEDED, 이후 소스도 요청하지 않고 실패', async () => {
  const registry = writeRegistry((reg) => {
    reg.http.maxRequests = 5;
  });
  const { code, result } = await runCheck({ registry });
  assert.equal(code, 20);
  assert.equal(result.stats.requests, 5);
  const codes = new Set(result.errors.map((e) => e.code));
  assert.deepEqual([...codes], ['BUDGET_EXCEEDED']);
  assert.ok(result.errors.length >= 36);
});

test('레지스트리가 잘못되면 exit 30, result.json 에 CONFIG_INVALID', async () => {
  const registry = writeRegistry((reg) => {
    reg.sources[0].kind = 'statute';
  });
  const { code, result } = await runCheck({ registry });
  assert.equal(code, 30);
  assert.equal(result.status, 'broken');
  assert.equal(result.errors[0].code, 'CONFIG_INVALID');
  assert.match(result.errors[0].detail, /kind/);

  const missing = await runCheck({ registry: path.join(SNAPSHOT, 'nope.json') });
  assert.equal(missing.code, 30);
  const badOnly = await runCheck({ args: ['--only', 'no-such-source'] });
  assert.equal(badOnly.code, 30);
  const badArg = await runCheck({ args: ['--frobnicate'] });
  assert.equal(badArg.code, 30);
});

test('--no-crosscheck 는 래퍼 요청을 하지 않는다', async () => {
  const { code, result } = await runCheck({ args: ['--no-crosscheck', '--only', 'decree,nfpc-108'] });
  assert.equal(code, 10);
  assert.equal(result.stats.requests, 2 + 2 + 1); // 목록 2 + 개정문 3
});

test('연혁 키: seq 없는 행은 시행일#번호 대체 키', () => {
  assert.deepEqual(historyRowKey('admrul', { effective_date: '20061230', notice_no: '소방청고시 제2006-19호', link: 'https://www.law.go.kr/LSW/admRulInfoP.do?admRulSeq=' }), {
    seq: null,
    key: '20061230#2006-19',
  });
  assert.deepEqual(historyRowKey('law', { effective_date: '20260701', link: 'https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=287375' }), { seq: '287375', key: '20260701:287375' });
});
