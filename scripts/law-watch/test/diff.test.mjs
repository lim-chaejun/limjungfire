// 골든(재생) · 왕복(연혁 반영 후 재실행) · 고장 시나리오
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runChecks, loadDataDir, CHECKS } from '../../validate-data.mjs';
import { HISTORY_ROW_FIELDS, MARKER_LAW, historyRowKey, parseState, wrapperRequest } from '../lib.mjs';
import { REGISTRY, SNAPSHOT, chainAware, copySnapshot, fakeClock, mutating, readJson, replay, runCheck, tmpDir, writeRegistry } from './helpers.mjs';

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
  assert.equal(result.scope, null, '전체 실행');
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

test('--apply-from: 검토한 result.json 을 네트워크 없이 그대로 반영 — --apply-history 와 바이트까지 같고, 두 번 해도 같다', async () => {
  const viaHistory = copySnapshot();
  await runCheck({ dataDir: viaHistory, args: ['--apply-history'] });

  const dir = copySnapshot();
  const reviewed = await runCheck({ dataDir: dir }); // 1단계: 검토용 결과만 (데이터는 그대로)
  assert.equal(reviewed.code, 10);
  const resultFile = path.join(reviewed.out, 'result.json');
  const { main } = await import('../check.mjs');
  const logs = [];
  // --replay 없이도 요청하지 않는다: 전역 fetch 를 막아 둔 채로 반영한다
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error('네트워크 금지');
  };
  try {
    assert.equal(await main(['--apply-from', resultFile, '--data-dir', dir, '--registry', REGISTRY], { log: (m) => logs.push(m) }), 0);
  } finally {
    globalThis.fetch = realFetch;
  }
  for (const f of fs.readdirSync(viaHistory)) assert.equal(fs.readFileSync(path.join(dir, f), 'utf8'), fs.readFileSync(path.join(viaHistory, f), 'utf8'), f);
  assert.ok(logs.some((l) => /nfsc_history\.json \(\+10행\)/.test(l)), logs.join('\n'));
  const snap = fs.readFileSync(path.join(dir, 'law_history_decree.json'), 'utf8');
  assert.equal(await main(['--apply-from', resultFile, '--data-dir', dir, '--registry', REGISTRY], { log: () => {} }), 0);
  assert.equal(fs.readFileSync(path.join(dir, 'law_history_decree.json'), 'utf8'), snap, '멱등');
});

const fileTexts = (dir) => Object.fromEntries(fs.readdirSync(dir).map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]));

test('--apply-from: 대상 파일·기준명·종류가 레지스트리 소스와 다르거나 행 형식이 틀리면 아무것도 쓰지 않고 exit 30', async () => {
  const dir = copySnapshot();
  // 레지스트리의 연혁 파일이 아닌 data 파일도 둔다 — 예전에는 [새 행] 으로 통째로 덮어써졌다
  fs.writeFileSync(path.join(dir, 'facilities.json'), JSON.stringify({ facilities: [{ id: 'powder', nfsc_key: 'x' }] }, null, 2));
  fs.copyFileSync(REGISTRY, path.join(dir, 'law_watch.json'));
  const reviewed = await runCheck({ dataDir: dir });
  const before = fileTexts(dir);
  const { main } = await import('../check.mjs');
  const tamper = (edit) => {
    const r = structuredClone(reviewed.result);
    edit(r);
    const p = path.join(tmpDir('law-watch-apply-'), 'result.json');
    fs.writeFileSync(p, JSON.stringify(r));
    return p;
  };
  const nfpc = (r) => r.changes.find((c) => c.sourceId === 'nfpc-108');
  const logs = [];
  const cases = [
    (r) => (r.changes[0].target = '../package.json'),
    (r) => (r.changes[0].target = 'scripts/law-watch/lib.mjs'),
    (r) => (r.changes[0].target = 'data/facilities.json'), // 레지스트리 연혁 파일이 아님(객체 파일)
    (r) => (r.changes[0].target = 'data/law_watch.json'),
    (r) => delete nfpc(r).targetKey, // 리뷰 재현: 기준명 없이 nfsc_history.json → 파일 전체가 [새 행] 이 되던 문제
    (r) => (delete nfpc(r).targetKey, (nfpc(r).target = 'data/law_history_decree.json')), // 리뷰 재현: 고시 행이 시행령 연혁에
    (r) => (nfpc(r).targetKey = '없는 기준(NFSC 999)'),
    (r) => (r.changes[0].kind = 'admrul'), // 종류가 소스와 다름
    (r) => (r.changes[0].sourceId = 'no-such-source'),
    (r) => (r.changes.at(-1).suggestedRow.link = 'https://example.com/LSW/lsInfoP.do?lsiSeq=1'),
    (r) => (r.changes[0].suggestedRow.link = 'https://www.law.go.kr/LSW/admRulInfoP.do?lsiSeq=287375'), // 종류에 맞는 원문 링크가 아님
    (r) => (r.changes.at(-1).suggestedRow.effective_date = '2026-07-01'),
    (r) => delete r.changes[1].suggestedRow.revision_type,
    (r) => (r.schemaVersion = 2),
  ];
  for (const edit of cases) assert.equal(await main(['--apply-from', tamper(edit), '--data-dir', dir, '--registry', REGISTRY], { log: (m) => logs.push(m) }), 30, String(edit));
  assert.deepEqual(fileTexts(dir), before, '나머지 12건이 정상이어도 아무 파일도 쓰지 않는다');
  assert.match(logs.join('\n'), /반영할 수 없는 항목/);
  assert.equal(await main(['--apply-from', path.join(reviewed.out, 'result.json'), '--only', 'decree'], { log: () => {} }), 30, '--only 와 함께 못 씀');
});

test('--apply-from: 제안 행은 정해진 필드만 넣고 문자열은 cleanName (사이트가 이름을 HTML 에 그대로 넣는다)', async () => {
  const dir = copySnapshot();
  const reviewed = await runCheck({ dataDir: dir });
  const r = structuredClone(reviewed.result);
  const c = r.changes.find((x) => x.sourceId === 'nfpc-108');
  c.suggestedRow.name = '  <img src=x onerror="alert(1)">분말소화설비의   화재안전성능기준(NFPC 108)  ';
  c.suggestedRow.onclick = 'evil()';
  r.changes = [c];
  const p = path.join(tmpDir('law-watch-apply-'), 'result.json');
  fs.writeFileSync(p, JSON.stringify(r));
  const { main } = await import('../check.mjs');
  assert.equal(await main(['--apply-from', p, '--data-dir', dir, '--registry', REGISTRY], { log: () => {} }), 0);
  const row = readJson(path.join(dir, 'nfsc_history.json'))['분말소화설비의 화재안전기준(NFSC 108)'][0];
  assert.deepEqual(Object.keys(row), ['no', ...HISTORY_ROW_FIELDS.admrul]);
  assert.equal(row.name, 'img src=x onerror=alert(1)분말소화설비의 화재안전성능기준(NFPC 108)');
  assert.equal(row.notice_no, '소방청고시 제2026-15호');
});

test('applyHistory: 파일 모양이 맞지 않으면 거부하고, 여러 파일 중 하나라도 실패하면 아무 파일도 쓰지 않는다', async () => {
  const { applyHistory, ConfigError } = await import('../check.mjs');
  const dir = copySnapshot();
  fs.writeFileSync(path.join(dir, 'facilities.json'), JSON.stringify({ facilities: [{ id: 'powder' }] }, null, 2));
  const { result } = await runCheck({ dataDir: dir });
  const before = fileTexts(dir);
  const decree = result.changes.find((c) => c.sourceId === 'decree');
  const nfpc = result.changes.find((c) => c.sourceId === 'nfpc-108');
  const { targetKey, ...nfpcNoKey } = nfpc;
  assert.ok(targetKey);
  const cases = [
    ['객체 파일(nfsc_history)에 targetKey 없이', [nfpcNoKey]],
    ['객체 파일(facilities)에 targetKey 없이', [{ ...decree, target: 'data/facilities.json' }]],
    ['배열 파일에 targetKey', [{ ...decree, targetKey: '분말소화설비의 화재안전기준(NFSC 108)' }]],
    ['없는 기준명', [{ ...nfpc, targetKey: '없는 기준(NFSC 999)' }]],
    ['첫 파일(시행령)은 맞고 둘째 파일에서 실패 — 첫 파일도 쓰지 않는다', [decree, { ...nfpc, targetKey: '없는 기준(NFSC 999)' }]],
  ];
  for (const [label, changes] of cases) assert.throws(() => applyHistory(changes, dir), ConfigError, label);
  assert.deepEqual(fileTexts(dir), before);
  // 정상 입력은 그대로 반영 (대조)
  assert.deepEqual(applyHistory([decree, nfpc], dir).map((w) => path.basename(w.file)), ['law_history_decree.json', 'nfsc_history.json']);
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

test('앵커(시행예정 행)의 시행일만 바뀌면(같은 lsiSeq) 오류가 아니라 변경 + ANCHOR_REKEYED 경고', async () => {
  const postpone = mutating(replay(), (r) =>
    isDecreeList(r)
      ? { text: r.text.replace("lsViewLsHst2('267669', '20241231', '35151', '20270101'", "lsViewLsHst2('267669', '20241231', '35151', '20280101'").replace('[시행 2027. 1. 1.]', '[시행 2028. 1. 1.]') }
      : null,
  );
  const { code, result } = await runCheck({ fetchImpl: postpone, args: ['--only', 'decree'] });
  assert.equal(code, 10);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.changes.map((c) => c.id).sort(), ['decree:20260324:284781', 'decree:20260701:287375', 'decree:20280101:267669']);
  const moved = result.changes.find((c) => c.id === 'decree:20280101:267669');
  assert.deepEqual([moved.isFuture, moved.suggestedRow.effective_date, moved.suggestedRow.law_no], [true, '20280101', '제35151호']);
  const byCode = Object.fromEntries(result.warnings.map((w) => [w.code, w.detail]));
  assert.match(byCode.ANCHOR_REKEYED, /20270101:267669 의 시행일이 20280101 로 바뀜/);
  assert.match(byCode.KNOWN_NOT_LIVE, /20270101:267669/);

  // lsiSeq 가 이미 아는 다른 시행일로만 남아 있으면(새 키 없음) 여전히 ANCHOR_MISSING — 법률 236977(2024·2022 시행)
  const dropAnchor = mutating(replay(), (r) =>
    r.url.endsWith('/lsHstListR.do') && r.body.includes('lsId=009503')
      ? { text: r.text.replace(/<li style="width:auto">(?:(?!<\/li>)[\s\S])*'236977', '20211130', '18522', '20241201'[\s\S]*?<\/li>/, '') }
      : null,
  );
  const act = await runCheck({ fetchImpl: dropAnchor, args: ['--only', 'act'] });
  assert.equal(act.code, 20);
  assert.ok(act.result.errors.some((e) => e.code === 'ANCHOR_MISSING'), JSON.stringify(act.result.errors));
  assert.ok(!act.result.warnings.some((w) => w.code === 'ANCHOR_REKEYED'));
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

const MAIN_PAGE = '<html><head><title>국가법령정보센터</title></head><body>메인</body></html>';
const LAW_WRAPPER = '/%EB%B2%95%EB%A0%B9/'; // /법령/
const ADM_WRAPPER = '/%ED%96%89%EC%A0%95%EA%B7%9C%EC%B9%99/'; // /행정규칙/

const ACT_WRAPPER_URL = wrapperRequest('law', '소방시설 설치 및 관리에 관한 법률').url;
const DECREE_WRAPPER_URL = wrapperRequest('law', '소방시설 설치 및 관리에 관한 법률 시행령').url;
const FOUR = ['--only', 'act,decree,rules,nfpc-108']; // 교차검증 시도 4개 (법령 래퍼 3 + 행정규칙 래퍼 1)

test('래퍼가 메인 페이지를 주는 소스가 절반 미만이면 NAME_LOOKUP_MISS 경고만 (exit 는 변경 여부로)', async () => {
  const fetchImpl = mutating(replay(), (r) => (r.url === ACT_WRAPPER_URL ? { text: MAIN_PAGE } : null));
  const { code, result } = await runCheck({ fetchImpl, args: FOUR });
  assert.equal(code, 10);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings.map((w) => `${w.sourceId}:${w.code}`), ['act:NAME_LOOKUP_MISS']);
  assert.equal(result.changes.length, 4);
});

test('교차검증을 4개 이상 시도해 절반 이상에서 못 하면 CROSSCHECK_UNAVAILABLE 실행 오류, exit 20 (감지한 개정은 그대로 보고)', async () => {
  const laws = mutating(replay(), (r) => (r.url.includes(LAW_WRAPPER) ? { text: MAIN_PAGE } : null));
  const a = await runCheck({ fetchImpl: laws, args: FOUR });
  assert.equal(a.code, 20);
  assert.deepEqual(a.result.errors.map((e) => `${e.sourceId}:${e.code}`), ['-:CROSSCHECK_UNAVAILABLE']);
  assert.match(a.result.errors[0].detail, /4개 소스 중 3개/);
  assert.deepEqual(a.result.warnings.map((w) => w.code), ['NAME_LOOKUP_MISS', 'NAME_LOOKUP_MISS', 'NAME_LOOKUP_MISS']);
  assert.equal(a.result.changes.length, 4);
  assert.equal(a.result.stats.healthy, 4, '소스 자체는 정상');
  assert.match(a.report, /\*\*감시 오류: CROSSCHECK_UNAVAILABLE\*\*/);

  // 딱 절반(4개 중 2개)도 실행 오류
  const half = mutating(replay(), (r) => ([ACT_WRAPPER_URL, DECREE_WRAPPER_URL].includes(r.url) ? { text: MAIN_PAGE } : null));
  const h = await runCheck({ fetchImpl: half, args: FOUR });
  assert.deepEqual([h.code, h.result.errors.map((e) => e.code)], [20, ['CROSSCHECK_UNAVAILABLE']]);

  // 재현(리뷰): 행정규칙 래퍼 형식만 바뀐 전체 실행 — 예전에는 경고 36개와 함께 exit 10 이었다
  const adm = mutating(replay(), (r) => (r.url.includes(ADM_WRAPPER) ? { text: '<html>main</html>' } : null));
  const b = await runCheck({ fetchImpl: adm });
  assert.equal(b.code, 20);
  assert.equal(b.result.warnings.filter((w) => w.code === 'NAME_LOOKUP_MISS').length, 36);
  assert.match(b.result.errors.at(-1).detail, /39개 소스 중 36개/);
});

test('교차검증을 시도한 소스가 4개 미만(작은 --only 실행)이면 래퍼가 다 안 돼도 경고만 — exit 는 목록 대조로', async () => {
  const laws = mutating(replay(), (r) => (r.url.includes(LAW_WRAPPER) ? { text: MAIN_PAGE } : null));
  const a = await runCheck({ fetchImpl: laws, args: ['--only', 'act,decree'] });
  assert.equal(a.code, 10);
  assert.deepEqual(a.result.errors, []);
  assert.deepEqual(a.result.warnings.map((w) => `${w.sourceId}:${w.code}`), ['act:NAME_LOOKUP_MISS', 'decree:NAME_LOOKUP_MISS']);

  // 리뷰 재현: --only decree + 래퍼 한 번의 오류(404) — 예전에는 1개 중 1개로 exit 20
  const down = mutating(replay(), (r) => (r.url.includes(LAW_WRAPPER) ? { status: 404, text: 'nf' } : null));
  const c = await runCheck({ fetchImpl: down, args: ['--only', 'decree'] });
  assert.deepEqual([c.code, c.result.warnings.map((w) => w.code), c.result.errors], [10, ['CROSSCHECK_SKIPPED'], []]);
  // 반영 뒤 확인 실행(SKILL 5.4)은 --no-crosscheck — 래퍼를 부르지 않는다
  const off = await runCheck({ fetchImpl: down, args: ['--only', 'decree', '--no-crosscheck'] });
  assert.deepEqual([off.code, off.result.warnings], [10, []]);
});

test('재현(리뷰): NFPC 108 최신 행의 onclick 이름만 바뀌면 PARSE_BAD_ROW (예전: 행이 조용히 빠져 exit 0)', async () => {
  const rename = (r) =>
    r.url.endsWith('/admRulHstListR.do') && r.body === 'admRulSeq=2100000253098'
      ? { text: r.text.replace("admRulViewHst('Y','2100000278572')", "admRulViewHstNew('Y','2100000278572')") }
      : null;
  const brokenWrapper = (r) => (r.url.includes(ADM_WRAPPER) ? { text: '<html>main</html>' } : null);
  for (const edit of [rename, (r) => rename(r) ?? brokenWrapper(r)]) {
    const { code, result } = await runCheck({ fetchImpl: mutating(replay(), edit), args: ['--only', 'nfpc-108'] });
    assert.equal(code, 20);
    assert.equal(result.errors[0].code, 'PARSE_BAD_ROW');
    assert.match(result.errors[0].snippet, /<li>\) 11개 ≠ .* 10개/);
  }
});

test('GITHUB_STEP_SUMMARY 가 있으면 보고서(경고·오류 포함)를 실행 요약에 덧붙인다', async () => {
  const file = path.join(tmpDir('law-watch-summary-'), 'summary.md');
  fs.writeFileSync(file, '# 앞 단계\n');
  const { report } = await runCheck({ stepSummary: file });
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(text.startsWith('# 앞 단계\n'), '덧붙이기(append)');
  assert.ok(text.includes(report));
  assert.match(text, /### 경고\n- `nfpc-107` \*\*ROW_WITHOUT_SEQ\*\*/);
  // 설정 오류로 끝나도 남긴다
  const bad = await runCheck({ stepSummary: file, args: ['--only', 'no-such-source'] });
  assert.equal(bad.code, 30);
  assert.match(fs.readFileSync(file, 'utf8'), /CONFIG_INVALID/);
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

test('장애: 모든 요청이 503·전송 오류면 목록 endpoint 마다 3개 소스(각 4회) 뒤 나머지는 SKIPPED_OUTAGE — exit 20, result.json 기록', async () => {
  const MIN = 60000;
  const cases = [
    ['503', async () => new Response('Service Unavailable', { status: 503 })],
    ['전송 오류', async () => { throw new TypeError('fetch failed'); }],
  ];
  for (const [label, fetchImpl] of cases) {
    const clock = fakeClock();
    const { code, result } = await runCheck({ fetchImpl, sleep: clock.sleep, now: clock.now, random: () => 0.5 });
    assert.equal(code, 20, label);
    assert.equal(result.stats.requests, 2 * 3 * 4, `${label}: endpoint 2개 × 소스 3개 × 시도 4회만 요청`);
    assert.equal(result.stats.healthy, 0);
    const failed = result.errors.filter((e) => e.code === 'FETCH_FAILED').map((e) => e.sourceId);
    assert.deepEqual(failed.slice(0, 3), ['act', 'decree', 'rules'], label);
    assert.equal(failed.length, 6, label);
    assert.equal(result.errors.filter((e) => e.code === 'SKIPPED_OUTAGE').length, 33, label);
    assert.ok(clock.elapsed() < 8 * MIN, `${label}: ${clock.elapsed() / MIN}분`);
  }
  // 요청마다 30초씩 매달리면 회로 차단보다 실행 기한(15분)이 먼저 — 그래도 제한 안에서 끝난다
  const clock = fakeClock();
  const hang = async () => {
    clock.advance(30000);
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  };
  const { code, result } = await runCheck({ fetchImpl: hang, sleep: clock.sleep, now: clock.now, random: () => 0.5 });
  assert.equal(code, 20);
  assert.equal(result.stats.healthy, 0);
  assert.ok(clock.elapsed() <= 15 * MIN + 30000, `${clock.elapsed() / MIN}분`);
  assert.ok(result.stats.requests < 2 * 3 * 4, String(result.stats.requests));
  assert.deepEqual([...new Set(result.errors.map((e) => e.code))].sort(), ['DEADLINE_EXCEEDED', 'FETCH_FAILED']);

  // 같은 endpoint 에서 목록 하나가 살아나면 연속 횟수는 다시 센다 (고시 체인: 실패 2 · 성공 · 실패 2 → 차단하지 않음)
  const lists = [];
  const flaky = mutating(replay(), (r) => {
    if (!r.url.endsWith('/admRulHstListR.do')) return null;
    if (!lists.includes(r.body)) lists.push(r.body);
    return [0, 1, 3, 4].includes(lists.indexOf(r.body)) ? { status: 503, text: 'busy' } : null;
  });
  const f = await runCheck({ fetchImpl: flaky, sleep: async () => {}, random: () => 0.5 });
  assert.equal(f.code, 20);
  assert.deepEqual(f.result.errors.map((e) => e.code), ['FETCH_FAILED', 'FETCH_FAILED', 'FETCH_FAILED', 'FETCH_FAILED']);
  assert.equal(f.result.stats.healthy, 35);
});

test('회로 차단은 목록 endpoint 별 — 법령 목록만 죽으면 고시는 계속, 고시 체인만 죽으면 법령은 계속', async () => {
  // 법령 목록을 쓰는 소스를 고시 36개 뒤에 하나 더 둔다 (차단된 endpoint 의 뒤쪽 소스만 건너뛰는지 보려고)
  const known = readJson(path.join(SNAPSHOT, 'law_history_decree.json')).map((r) => historyRowKey('law', r).key);
  const registry = writeRegistry((reg) => {
    reg.sources.push({ id: 'decree-late', kind: 'law', lsId: '009694', name: '소방시설 설치 및 관리에 관한 법률 시행령', baseline: { from: 'inline', asOf: '2026-01-20', known } });
  });
  const down = (endpoint) => mutating(replay(), (r) => (r.url.endsWith(endpoint) ? { status: 503, text: 'busy' } : null));
  const quick = { sleep: async () => {}, random: () => 0.5 };

  const law = await runCheck({ registry, fetchImpl: down('/lsHstListR.do'), ...quick });
  assert.equal(law.code, 20);
  assert.deepEqual(law.result.errors.map((e) => `${e.sourceId}:${e.code}`), ['act:FETCH_FAILED', 'decree:FETCH_FAILED', 'rules:FETCH_FAILED', 'decree-late:SKIPPED_OUTAGE']);
  assert.match(law.result.errors.at(-1).detail, /\/LSW\/lsHstListR\.do 목록 요청이 연속 3개 소스에서 실패/);
  assert.equal(law.result.stats.healthy, 36, '고시 36개는 계속 확인');
  assert.equal(law.result.changes.length, 10);

  const adm = await runCheck({ registry, fetchImpl: down('/admRulHstListR.do'), ...quick });
  assert.equal(adm.code, 20);
  const codes = adm.result.errors.map((e) => e.code);
  assert.deepEqual([codes.filter((c) => c === 'FETCH_FAILED').length, codes.filter((c) => c === 'SKIPPED_OUTAGE').length], [3, 33]);
  assert.ok(adm.result.errors.every((e) => e.sourceId.startsWith('nfpc-')), JSON.stringify(adm.result.errors.map((e) => e.sourceId)));
  assert.equal(adm.result.stats.healthy, 4, '법령 3개 + 끝의 decree-late 는 계속 확인');
  assert.deepEqual(adm.result.changes.map((c) => c.sourceId).sort(), ['decree', 'decree', 'decree-late', 'decree-late', 'rules']);
});

test('장애: 느리지만 응답하는 서버 — 실행 기한(15분)에 멈추고 남은 소스는 DEADLINE_EXCEEDED, 끝난 소스의 개정은 보고', async () => {
  const clock = fakeClock();
  const base = replay();
  const slow = async (url, init) => {
    clock.advance(25000);
    return base(url, init);
  };
  const { code, result, report } = await runCheck({ fetchImpl: slow, sleep: clock.sleep, now: clock.now, random: () => 0.5 });
  assert.equal(code, 20);
  assert.ok(clock.elapsed() <= 15 * 60000 + 25000, `기한 + 요청 한 번 이내: ${clock.elapsed()}ms`);
  assert.ok(result.stats.requests > 10 && result.stats.requests < 91, String(result.stats.requests));
  const codes = new Set(result.errors.map((e) => e.code));
  assert.deepEqual([...codes], ['DEADLINE_EXCEEDED']);
  assert.equal(result.stats.healthy + new Set(result.errors.map((e) => e.sourceId)).size, 39);
  assert.ok(result.changes.some((c) => c.sourceId === 'decree'), '기한 전에 끝난 소스의 개정은 그대로 보고');
  assert.match(report, /DEADLINE_EXCEEDED/);

  // 레지스트리의 http.deadlineMs 로 줄일 수 있다
  const registry = writeRegistry((reg) => {
    reg.http.deadlineMs = 60000;
  });
  const clock2 = fakeClock();
  const short = await runCheck({ registry, fetchImpl: async (url, init) => (clock2.advance(25000), base(url, init)), sleep: clock2.sleep, now: clock2.now, random: () => 0.5 });
  assert.equal(short.code, 20);
  assert.equal(short.result.stats.requests, 3); // act 목록·래퍼, decree 목록 → decree 래퍼에서 기한
  assert.equal(short.result.stats.healthy, 1);
  assert.equal(short.result.errors.length, 38);
});

test('소스 하나의 예상 못 한 예외는 INTERNAL_ERROR 로 기록하고 나머지를 계속한다 (result.json 유지)', async () => {
  let calls = 0;
  const random = () => {
    if (++calls === 1) throw new Error('boom'); // 두 번째 요청(act 의 래퍼)에서 한 번만 터진다
    return 0.5;
  };
  const { code, result } = await runCheck({ random });
  assert.equal(code, 20);
  assert.deepEqual(result.errors.map((e) => `${e.sourceId}:${e.code}`), ['act:INTERNAL_ERROR']);
  assert.match(result.errors[0].detail, /boom/);
  assert.equal(result.changes.length, 13);
  assert.equal(result.stats.healthy, 38);
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
