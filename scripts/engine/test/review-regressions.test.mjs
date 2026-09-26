// 독립 리뷰(REQUEST CHANGES) 재현 사례의 회귀 시험 — 1차 HIGH(H1~H4)·MEDIUM(M1~M7), 2차(N1·N2·N2′·MEDIUM·LOW) 사례가
// 올바른 결과를 내는지 고정한다.
// 사례 정의는 review-cases.mjs (성질 시험과 공유). 픽스처·데이터는 모두 TEST-ONLY.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EARLIEST, classifyUses, coverage, evalCondition, evaluateBuilding, makeEnv, makeValidationContext, normalizeManual, normalizeRegistry, resolvePolicy,
  validateFileSet,
} from '../../../js/engine/index.js';
import { addDays } from '../../../js/engine/dates.js';
import { inputDefsFrom } from '../../../js/engine/questions.js';
import { FACILITIES, INDEX, INPUTS, TODAY, VOCABULARY, evaluate, loadBuildingFixtures } from './helpers.mjs';
import { CASES, PILOTI_DATA, caseById, pilotiBuilding, row, v2 } from './review-cases.mjs';

const FIXTURES = loadBuildingFixtures();
const qkeys = (f) => f.questions.map((q) => q.key);
const fac = (r, dong, id) => r.dongs.find((d) => d.id === dong)?.facilities.find((f) => f.id === id);

function runCase(c, { answers = {}, policy = c.policy } = {}) {
  const building = c.input.manual ? normalizeManual(c.input.manual, { useIndex: INDEX, policy }) : normalizeRegistry(c.input.registry, { useIndex: INDEX, policy });
  return evaluateBuilding({ building, dataFiles: c.dataFiles, useIndex: INDEX, inputs: INPUTS, facilities: FACILITIES, answers: { ...(c.answers || {}), ...answers }, policy, today: TODAY });
}
const verdictOf = (id, dong, fid, opts) => fac(runCase(caseById(id), opts), dong, fid).verdict;

// ───── HIGH ─────

test('H1 (CE1): 가정값 두 개에 함께 기대는 F — 하나씩 바꿔서는 안 바뀌어도 가정값을 풀면 비해당이 아님, 두 층을 함께 묻는다', () => {
  const c = caseById('ce1-joint-assumed');
  const f = fac(runCase(c), '본동', 'smoke_control');
  // 한 층씩도 결정적이다: 어느 층이든 '아니오'면 나머지를 몰라도 합계가 1,000㎡ 미만으로 확정
  assert.deepEqual([f.verdict, qkeys(f), f.jointQuestions], ['확인 필요', ['windowless@본동/1F', 'windowless@본동/2F'], false]);
  assert.equal(verdictOf('ce1-joint-assumed', '본동', 'smoke_control', { answers: { 'windowless@본동/2F': false } }), '비해당');
  assert.ok(f.questions.every((q) => q.note), '가정값에 기대는 질문에는 안내 문구');
  assert.match(f.reasons.join(' '), /가정값·미확인 입력을 모름으로 두면 비해당이 확정되지 않음/);
  assert.deepEqual(qkeys(fac(runCase(c, { answers: { 'windowless@본동/1F': true } }), '본동', 'smoke_control')), ['windowless@본동/2F']);
  assert.equal(verdictOf('ce1-joint-assumed', '본동', 'smoke_control', { answers: { 'windowless@본동/1F': true, 'windowless@본동/2F': true } }), '해당');
  assert.equal(verdictOf('ce1-joint-assumed', '본동', 'smoke_control', { answers: { 'windowless@본동/1F': false, 'windowless@본동/2F': false } }), '비해당');
  const unknown = fac(runCase(caseById('ce1-joint-unknown')), '본동', 'smoke_control');
  assert.deepEqual([unknown.verdict, qkeys(unknown)], ['확인 필요', ['windowless@본동/1F', 'windowless@본동/2F']]);
  // 대조군: 확정 면적만으로 성립하는 not(...) 은 정당한 비해당
  assert.equal(verdictOf('ce1b-confirmed-not', '본동', 'smoke_control'), '비해당');
});

test('H1 (CE8): 개정 경계(신청일) × 가정값(수동 입력 지하층 빈칸) 결합 — 두 질문을 함께', () => {
  const f = fac(runCase(caseById('ce8-date-x-assumed')), '직접입력', 'standpipe');
  assert.deepEqual([f.verdict, qkeys(f).sort()], ['확인 필요', ['application_date', 'basement_floors@직접입력']]);
  const at = (answers) => verdictOf('ce8-date-x-assumed', '직접입력', 'standpipe', { answers });
  assert.equal(at({ application_date: '20260201', 'basement_floors@직접입력': 2 }), '해당');
  assert.equal(at({ application_date: '20260201', 'basement_floors@직접입력': 0 }), '비해당');
  assert.equal(at({ application_date: '20260401' }), '비해당');
  assert.deepEqual(qkeys(fac(runCase(caseById('ce8-date-x-assumed'), { answers: { 'basement_floors@직접입력': 2 } }), '직접입력', 'standpipe')), ['application_date']);
  assert.deepEqual(qkeys(fac(runCase(caseById('ce8-date-x-assumed'), { answers: { application_date: '20260201' } }), '직접입력', 'standpipe')), ['basement_floors@직접입력']);
});

test('H2 (CE2): use+floors 가 불완전한 층 목록(지하층수 모름)에서 F 를 내지 않는다 — 층수 질문', () => {
  for (const id of ['ce2a-use-floors', 'ce2b-use-floors-no-counts', 'ce2c-floor-exists']) {
    const f = fac(runCase(caseById(id)), '본동', 'smoke_control');
    assert.deepEqual([f.verdict, qkeys(f)], ['확인 필요', ['basement_floors@본동']], id);
  }
  assert.equal(verdictOf('ce2a-use-floors', '본동', 'smoke_control', { answers: { 'basement_floors@본동': 0 } }), '비해당');
});

test('H3 (CE3): 날짜가 없으면 가장 이른 개정 경계부터 오늘까지 모두 본다 — 결과가 갈리면 허가일 질문, 가정 표시', () => {
  const r = runCase(caseById('ce3-no-dates'));
  assert.deepEqual([r.dateInfo.source, r.dateInfo.status, r.dateInfo.window], ['today', 'assumed', { from: EARLIEST, to: TODAY, question: 'permit_date' }]);
  const afd = fac(r, 'A동', 'auto_fire_detection');
  assert.deepEqual([afd.verdict, qkeys(afd)], ['확인 필요', ['permit_date']]);
  assert.ok(afd.assumptions.some((a) => a.startsWith('기준일: 오늘')), afd.assumptions.join('; '));
  assert.equal(verdictOf('ce3-no-dates', 'A동', 'auto_fire_detection', { answers: { permit_date: '20150101' } }), '해당');
  const manual = fac(runCase(caseById('ce3b-manual-default-permit')), '직접입력', 'auto_fire_detection');
  assert.deepEqual([manual.verdict, qkeys(manual)], ['확인 필요', ['permit_date']]);
});

test('H3: 사용승인일만 있으면 추정 구간(정책 approvalOnlyLookbackDays + 신청 구간)을 모두 보고, 그 가정을 비해당에도 표시', () => {
  const fx = FIXTURES.find((f) => f.id === 'approval-date-only');
  const r = evaluate(fx.input, { answers: fx.answers || {} });
  const pol = resolvePolicy();
  assert.deepEqual(r.dateInfo.window, { from: addDays(r.dateInfo.approval, -(pol.approvalOnlyLookbackDays + pol.applicationWindowDays)), to: r.dateInfo.approval, question: 'permit_date' });
  const notApplicable = r.dongs[0].facilities.filter((f) => f.verdict === '비해당');
  assert.ok(notApplicable.length > 0);
  for (const f of notApplicable) assert.ok(f.assumptions.some((a) => a.startsWith('기준일: 사용승인일')), f.id);
});

test('H4 (CE3·CE4): 신축이 아닌 인허가(증축 등)도 허가일 후보 — 가정 + 경고, 검사 구간은 가장 늦은 허가일까지', () => {
  const r = runCase(caseById('ce4-apt-extension'));
  assert.deepEqual([r.dateInfo.refDate, r.dateInfo.status, r.dateInfo.window.to, r.dateInfo.window.question], ['20100301', 'assumed', '20210301', 'permit_date']);
  assert.match(r.warnings.find((w) => w.code === 'MULTIPLE_PERMITS').message, /2010\.03\.01 신축, 2021\.03\.01 증축/);
  const sp = fac(r, 'A동', 'sprinkler');
  assert.deepEqual([sp.verdict, qkeys(sp)], ['확인 필요', ['permit_date']]);
  assert.ok(sp.assumptions.some((a) => /인허가 2건/.test(a)), sp.assumptions.join('; '));
  assert.equal(verdictOf('ce4-apt-extension', 'A동', 'sprinkler', { answers: { permit_date: '20210301' } }), '해당');
  assert.equal(verdictOf('ce4-apt-extension', 'A동', 'sprinkler', { answers: { permit_date: '20100301' } }), '비해당');
  const ext = runCase(caseById('ce3c-extension-permit'));
  assert.deepEqual([ext.dateInfo.refDate, ext.dateInfo.status], ['19950301', 'assumed']);
  assert.match(ext.warnings.find((w) => w.code === 'MULTIPLE_PERMITS').message, /1995\.03\.01 신축, 2023\.03\.01 증축/);
});

// ───── MEDIUM ─────

test('M1 (CE5): 표제부 층수 ↔ 층별개요 불일치는 확정값이 아니라 구간 + 경고 — 결정적이면 층수 질문, 정책으로 한쪽 선택', () => {
  const a = runCase(caseById('ce5a-title-vs-items-ground'));
  assert.deepEqual(a.warnings.map((w) => w.code), ['FLOOR_COUNT_MISMATCH']);
  const sp = fac(a, '본동', 'sprinkler');
  assert.deepEqual([sp.verdict, qkeys(sp)], ['확인 필요', ['ground_floors@본동']]);
  assert.equal(fac(a, '본동', 'auto_fire_detection').verdict, '해당');
  assert.equal(verdictOf('ce5a-title-vs-items-ground', '본동', 'sprinkler', { answers: { 'ground_floors@본동': 6 } }), '해당');
  assert.equal(verdictOf('ce5a-title-vs-items-ground', '본동', 'sprinkler', { policy: { floorCountConflict: 'floor_items' } }), '해당');
  const b = fac(runCase(caseById('ce5b-title-vs-items-basement')), '본동', 'emergency_broadcast');
  assert.deepEqual([b.verdict, qkeys(b)], ['확인 필요', ['basement_floors@본동']]);
});

test('M2 (CE5·CE6): 표제부 연면적이 없으면 층별개요가 모든 층을 덮을 때만 합계, 아니면 [알려진 합, ∞) — 연면적 질문', () => {
  const c = runCase(caseById('ce5c-total-missing-5f'));
  const ih = fac(c, '본동', 'indoor_hydrant');
  assert.equal(ih.verdict, '확인 필요');
  assert.ok(qkeys(ih).includes('total_area@본동'), qkeys(ih).join());
  assert.equal(fac(c, '본동', 'auto_fire_detection').verdict, '해당');
  const eb = fac(runCase(caseById('ce6-total-missing-9f')), '본동', 'emergency_broadcast');
  assert.deepEqual([eb.verdict, qkeys(eb)], ['확인 필요', ['total_area@본동']]);
  assert.equal(verdictOf('ce6-total-missing-9f', '본동', 'emergency_broadcast', { answers: { 'total_area@본동': 4500 } }), '해당');
  assert.equal(verdictOf('ce6-total-missing-9f', '본동', 'emergency_broadcast', { answers: { 'total_area@본동': 3000 } }), '비해당');
});

test('M2 확장: 표제부 층수가 빈칸이면 층별개요의 최고층은 하한일 뿐 — 6층 이상 기준은 층수 질문', () => {
  const sp = fac(runCase(caseById('count-from-items-only')), '본동', 'sprinkler');
  assert.deepEqual([sp.verdict, qkeys(sp)], ['확인 필요', ['ground_floors@본동']]);
  assert.equal(verdictOf('count-from-items-only', '본동', 'sprinkler', { answers: { 'ground_floors@본동': 5 } }), '비해당');
  assert.equal(verdictOf('count-from-items-only', '본동', 'sprinkler', { answers: { 'ground_floors@본동': 6 } }), '해당');
});

test('M3 (CE11): 폭 1짜리 기준(지하층 포함 정확히 7개층)도 좁은 정수 범위는 모든 값을 시험해 결정적 질문을 찾는다', () => {
  const f = fac(runCase(caseById('ce11-eq-grid')), '직접입력', 'standpipe');
  assert.deepEqual([f.verdict, qkeys(f)], ['확인 필요', ['basement_floors@직접입력']]);
  assert.equal(verdictOf('ce11-eq-grid', '직접입력', 'standpipe', { answers: { 'basement_floors@직접입력': 5 } }), '해당');
  assert.equal(verdictOf('ce11-eq-grid', '직접입력', 'standpipe', { answers: { 'basement_floors@직접입력': 4 } }), '비해당');
});

// 리뷰의 perf2: 미확인 입력(무창층 30개 층 + 층 면적)이 많은 시설 30개 × 30층 동 3개
function adversarial(withArea) {
  const facs = Array.from({ length: 30 }, (_, i) => ({
    facility_id: `f${i}`,
    facility_name: `F${i}`,
    regulations: [
      row(`r${i}a`, { floor_exists: { floors: ['windowless'], area: { gte: 1000 + i * 10 } } }, { scope: 'matching_floors' }),
      row(`r${i}b`, { sum_area: { floors: ['basement', 'windowless'], use: ['02'] }, gte: 5000 + i }),
      row(`r${i}c`, { all: [{ m: 'occupants', gte: 100 + i }, { floor_exists: { floors: [{ kind: 'ground', level: { gte: 11 } }], area: { gte: 300 } } }] }),
    ],
  }));
  const names = ['A동', 'B동', 'C동'];
  const items = (name) => [
    ...[1, 2, 3].map((n) => ({ dongNm: name, flrGbCd: '10', flrNo: n, mainPurpsCdNm: '제2종근린생활시설', etcPurps: '', area: withArea ? 1100 : '' })),
    ...Array.from({ length: 30 }, (_, i) => ({ dongNm: name, flrGbCd: '20', flrNo: i + 1, mainPurpsCdNm: '제2종근린생활시설', etcPurps: '', area: withArea ? 1100 : '' })),
  ];
  const registry = {
    title: names.map((n) => ({ dongNm: n, mainPurpsCdNm: '제2종근린생활시설', etcPurps: '', totArea: 33 * 1100, grndFlrCnt: 30, ugrndFlrCnt: 3 })),
    floors: names.flatMap(items),
    permit: [{ archPmsDay: '20150101', archGbCdNm: '신축' }],
  };
  return { input: { registry }, dataFiles: { '02': v2('02', facs) } };
}

test('M3 (perf2): 미확인 입력이 많은 시설 30개 × 30층 동 3개 — 질문 선별 예산 안에서 1초 안팎 (여유 있게 5초 한도)', () => {
  for (const withArea of [true, false]) {
    const c = adversarial(withArea);
    runCase(c); // 준비 실행(JIT)
    const t0 = performance.now();
    const r = runCase(c);
    const ms = performance.now() - t0;
    assert.ok(ms < 5000, `${withArea ? '면적 앎' : '면적 모름'}: ${ms.toFixed(0)}ms`);
    const dongA = r.dongs.find((d) => d.id === 'A동').facilities;
    assert.equal(dongA.length, 30);
    for (const f of dongA) {
      assert.equal(f.verdict, '확인 필요', f.id);
      assert.ok(f.questions.length > 0, f.id);
      assert.ok(f.diagnostics.questionTests <= 400 + 64, `${f.id}: 시험 ${f.diagnostics.questionTests}회`);
    }
  }
});

test('M5 (CE9): 별칭은 동의 주용도 군에 따라 — 주차 전용 동의 주차장은 주차용 건축물, 보조 용도는 미확인(maybe)', () => {
  assert.deepEqual(classifyUses('자동차관련시설', '주차장', INDEX).terms, [{ use: 'parking_structure' }]);
  assert.equal(coverage([{ use: 'parking_structure' }], ['parking_structure'], INDEX), 'all');
  assert.equal(coverage([{ use: 'parking_structure' }], ['18'], INDEX), 'all');
  assert.equal(coverage([{ use: 'retail_small' }], ['electrical_room'], INDEX), 'maybe');
  assert.equal(coverage([{ group: '02' }], ['electrical_room'], INDEX), 'maybe');
  assert.equal(verdictOf('ce9-parking-building', '주차타워', 'water_spray'), '해당');
  // level 에 kind 가 없는 선택자는 지하 깊이에도 맞는다(실행 의미는 유지, 검증기가 W_LEVEL_WITHOUT_KIND 로 경고)
  const d = normalizeRegistry({ title: [{ mainPurpsCdNm: '업무시설', totArea: 1000, grndFlrCnt: 2, ugrndFlrCnt: 4 }] }, { useIndex: INDEX }).dongs[0];
  const env = makeEnv({ dong: d, index: INDEX, policy: resolvePolicy(), inputDefs: inputDefsFrom(INPUTS) });
  assert.equal(evalCondition({ floor_exists: { floors: [{ level: { gte: 4 } }] } }, env).v, 'T');
  assert.equal(evalCondition({ floor_exists: { floors: [{ kind: 'ground', level: { gte: 4 } }] } }, env).v, 'F');
});

test('M6 (CE7): 한 층의 여러 행 — 면적 빈 행은 부분 질문 part_area[n](부분 이름 표시), 답하면 반영', () => {
  // 층이 하나뿐이면 층 면적 = 연면적(600) 이라 빈 행 = 600 − 300 으로 정해져 묻지 않는다
  const one = fac(runCase(caseById('ce7-multipart')), '본동', 'smoke_control');
  assert.deepEqual([one.verdict, qkeys(one)], ['해당', []]);
  // 다른 층 면적이 미상이면 부분 질문, 범위는 [0, 900 − 300]
  const f = fac(runCase(caseById('ce7b-multipart-open')), '본동', 'smoke_control');
  assert.deepEqual([f.verdict, qkeys(f)], ['확인 필요', ['part_area[2]@본동/1F']]);
  assert.match(f.questions[0].text, /노래연습장/);
  assert.deepEqual(f.questions[0].range, [0, 600]);
  for (const [v, verdict] of [[300, '해당'], [100, '비해당']]) {
    assert.equal(verdictOf('ce7b-multipart-open', '본동', 'smoke_control', { answers: { 'part_area[2]@본동/1F': v } }), verdict, String(v));
  }
});

// ───── 2차 리뷰 HIGH: 단조성 ─────

test('N1: 층별개요 면적 합(800) < 연면적(1,000) 이면 면적 항등식으로 합계 하한을 올리지 않는다 — 무창층을 묻고, 답에 따라 뒤집히지 않음', () => {
  const both = { 'windowless@본동/1F': false, 'windowless@본동/2F': false };
  for (const id of ['n1-lt', 'n1-excluded', 'n1-gte']) {
    const f = fac(runCase(caseById(id)), '본동', 'x');
    assert.deepEqual([f.verdict, qkeys(f)], ['확인 필요', ['windowless@본동/1F', 'windowless@본동/2F']], id);
  }
  assert.equal(verdictOf('n1-lt', '본동', 'x', { answers: both }), '해당');
  assert.equal(verdictOf('n1-excluded', '본동', 'x', { answers: both }), '해당');
  assert.equal(verdictOf('n1-gte', '본동', 'x', { answers: both }), '비해당');
  assert.equal(verdictOf('n1-gte', '본동', 'x', { answers: { 'windowless@본동/1F': true } }), '해당');
  const r = runCase(caseById('n1-lt'));
  assert.match(r.warnings.find((w) => w.code === 'FLOOR_AREA_MISMATCH').message, /800㎡ ↔ 연면적 1,000㎡/);
});

test('N2: 층 목록이 불완전할 때 표제부 용도로 빠진 층의 용도를 확정하지 않는다 — 부정 조건이 확정 비해당이 되지 않음', () => {
  for (const id of ['n2-excluded-use', 'n2-not-use']) {
    const f = fac(runCase(caseById(id)), '본동', 'x');
    assert.deepEqual([f.verdict, qkeys(f)], ['확인 필요', ['use_presence[{"floors":null,"use":["singing_room"]}]@본동']], id);
    const noSinging = { 'basement_floors@본동': 0, 'use_presence[{"use":["singing_room"]}]@본동/1F': false };
    assert.equal(verdictOf(id, '본동', 'x', { answers: { 'basement_floors@본동': 0 } }), '확인 필요', id);
    assert.equal(verdictOf(id, '본동', 'x', { answers: noSinging }), '해당', id);
    assert.equal(verdictOf(id, '본동', 'x', { answers: { 'use_presence[{"floors":null,"use":["singing_room"]}]@본동': true } }), '비해당', id);
  }
});

test("N2′: 보충한 층에 표제부 용도가 여럿이면 그 층 용도는 모름 — 그 층 질문을 묻고 답을 읽는다", () => {
  const key = 'use_presence[{"use":["singing_room"]}]@본동/2F';
  const f = fac(runCase(caseById('n2p-synth-floor')), '본동', 'x');
  assert.deepEqual([f.verdict, qkeys(f)], ['확인 필요', [key]]);
  assert.equal(verdictOf('n2p-synth-floor', '본동', 'x', { answers: { [key]: false } }), '해당');
  assert.equal(verdictOf('n2p-synth-floor', '본동', 'x', { answers: { [key]: true } }), '비해당');
});

test('2차 MEDIUM: 층의 용도별 면적 질문(floor_use_area)에 답하면 반영된다 — 같은 용도의 합계 조건에도', () => {
  const key = 'floor_use_area[{"use":["singing_room"]}]@본동/1F';
  const f = fac(runCase(caseById('floor-use-area')), '본동', 'smoke_control');
  assert.deepEqual([f.verdict, qkeys(f)], ['확인 필요', [key]]);
  assert.deepEqual(f.questions[0].range, [0, 600]);
  for (const [v, verdict] of [[0, '비해당'], [299, '비해당'], [450, '해당'], [600, '해당']]) {
    assert.equal(verdictOf('floor-use-area', '본동', 'smoke_control', { answers: { [key]: v } }), verdict, String(v));
  }
  // 같은 층·용도의 합계 조건(용도별 바닥면적 합계 400㎡ 이상)도 이 답을 쓴다
  const sumCase = { ...caseById('floor-use-area'), dataFiles: { '02': v2('02', [{ facility_id: 'smoke_control', facility_name: '제연설비', regulations: [row('s', { sum_area: { use: ['singing_room'] }, gte: 400 })] }]) } };
  assert.equal(fac(runCase(sumCase), '본동', 'smoke_control').verdict, '확인 필요');
  assert.equal(fac(runCase(sumCase, { answers: { [key]: 450 } }), '본동', 'smoke_control').verdict, '해당');
  assert.equal(fac(runCase(sumCase, { answers: { [key]: 350 } }), '본동', 'smoke_control').verdict, '비해당');
});

test('2차 MEDIUM: 대지 전체(합친 동) 판정은 동 이름 키의 답을 읽는다 — 같은 질문을 되풀이하지 않는다(rv_site_stuck)', () => {
  const c = caseById('site-stuck');
  const sp = (answers) => fac(runCase(c, { answers }), '상가동', 'sprinkler');
  // 면적 항등식으로 묶인 면적 질문은 동마다 한 번에 하나(3차 리뷰) — 1층을 답하면 2층 범위가 좁혀져 다음에 나온다
  assert.deepEqual([qkeys(sp({})), sp({}).moreQuestions], [['floor_area@상가동/1F'], 1]);
  const areas = { 'floor_area@상가동/1F': 800, 'floor_area@상가동/2F': 800 };
  // 동별로도, 합친 동에서도 1,000㎡ 이상인 층이 없다 → 연결 여부를 묻지 않고 비해당
  assert.deepEqual([sp(areas).verdict, qkeys(sp(areas))], ['비해당', []]);
  assert.deepEqual([sp({ ...areas, site_connected: true }).verdict, qkeys(sp({ ...areas, site_connected: true }))], ['비해당', []]);
  const big = { 'floor_area@상가동/1F': 1200, 'floor_area@상가동/2F': 400 };
  assert.equal(sp(big).verdict, '해당');
});

test('2차 MEDIUM: 합친 동에서만 모르는 사실은 그 동 이름 키로 묻고, 답하면 합친 판정이 정해진다', () => {
  const c = caseById('site-member-question');
  const wc = (answers) => fac(runCase(c, { answers }), '상가동', 'wireless_comm');
  const open = wc({});
  assert.deepEqual([open.verdict, qkeys(open), open.siteLink.mergedVerdict], ['확인 필요', ['site_connected'], '확인 필요']);
  const merged = wc({ site_connected: true });
  assert.equal(merged.verdict, '확인 필요');
  assert.equal(merged.questions.length, 1);
  assert.match(qkeys(merged)[0], /^floor_area@주차장동\/B[12]$/);
  assert.equal(wc({ site_connected: true, 'floor_area@주차장동/B1': 1200 }).verdict, '해당');
  // 지하1층 800 → 지하2층 = 1,500 − 800 = 700(면적 항등식) → 1,000㎡ 이상인 지하층 없음 → 합친 판정도 비해당
  assert.equal(wc({ site_connected: true, 'floor_area@주차장동/B1': 800 }).verdict, '비해당');
  assert.equal(wc({ site_connected: false }).verdict, '비해당');
  // 합친 동이 쓰는 파일 중 v2 가 아닌 것은 notEvaluated 에 '대지 전체'로
  const noMixed = runCase({ ...c, dataFiles: { '02': c.dataFiles['02'], '18': c.dataFiles['18'] } });
  assert.deepEqual(noMixed.notEvaluated.map((x) => [x.dong, x.type_code, x.status]), [['대지 전체', '30', 'missing']]);
  assert.deepEqual(runCase({ ...c, dataFiles: { '02': c.dataFiles['02'], '18': c.dataFiles['18'] } }, { answers: { site_connected: false } }).notEvaluated, []);
});

test('2차 MEDIUM: 긴 질문 목록 — 날짜 → 동 → 층 순, 면적 항등식 묶음은 동마다 하나, 시설마다 5개까지, 나머지는 moreQuestions (rv_q33)', () => {
  const sp = fac(runCase(caseById('q33-long-list')), '직접입력', 'sprinkler');
  assert.equal(sp.verdict, '확인 필요');
  assert.deepEqual(sp.questions.map((q) => q.input), ['application_date', 'use_area', 'floor_area']);
  assert.equal(sp.questions[2].key, 'floor_area@직접입력/B3');
  assert.equal(sp.moreQuestions, 29);
  // 동의 질문 목록은 시설별로 줄인 질문의 합
  const r = runCase(caseById('q33-long-list'));
  assert.ok(r.dongs[0].questions.length <= 5 * r.dongs[0].facilities.length);
  // 상한 아래면 moreQuestions 는 0
  const re = fac(r, '직접입력', 'rescue_equipment');
  assert.deepEqual([re.questions.length, re.moreQuestions], [1, 0]);
});

test('2차 LOW: 파일끼리의 시설 순환은 검증기 오류, 실행 중에는 풀 수 있는 원문 확인 질문(rv_cycle)', () => {
  const c = caseById('cross-file-cycle');
  const ctx = makeValidationContext({ inputs: INPUTS, vocabulary: VOCABULARY, facilities: FACILITIES });
  const set = validateFileSet([{ name: '02_x.json', json: c.dataFiles['02'] }, { name: '30_x.json', json: c.dataFiles['30'] }], ctx);
  assert.deepEqual(set.errors.map((e) => e.code), ['FACILITY_CROSS_FILE_CYCLE']);
  const key = 'review[facility:visual_alarm]@본동';
  const mixed = { 'mixed_use@본동': true };
  for (const fid of ['visual_alarm', 'auto_fire_detection']) {
    const f = fac(runCase(c, { answers: mixed }), '본동', fid);
    assert.deepEqual([f.verdict, qkeys(f)], ['확인 필요', [key]], fid);
    assert.doesNotMatch(f.questions[0].text, /facility_cycle/);
    assert.equal(fac(runCase(c, { answers: { ...mixed, [key]: true } }), '본동', fid).verdict, '해당', fid);
    assert.equal(fac(runCase(c, { answers: { ...mixed, [key]: false } }), '본동', fid).verdict, '비해당', fid);
  }
});

// ───── 3차 리뷰 HIGH: 합친 동의 부정 조건 ─────

test('3차 rv3_flow: 보이는 질문에만 사실대로 답해도 합친 동의 무창층 면적은 동별 무창층 층의 합 — 제외되지 않아 해당', () => {
  const truth = { site_connected: true, 'windowless@상가동/1F': true, 'windowless@상가동/2F': false, 'windowless@주차타워/1F': false };
  const c = caseById('rv3-flow');
  let answers = {};
  const seen = [];
  for (let round = 0; round < 6; round++) {
    const f = fac(runCase(c, { answers }), '상가동', 'x');
    seen.push(f.verdict);
    if (!f.questions.length) break;
    for (const q of f.questions) if (q.key in truth) answers = { ...answers, [q.key]: truth[q.key] };
  }
  assert.equal(seen[0], '확인 필요');
  assert.equal(seen.at(-1), '해당', seen.join(' → '));
  assert.ok(!seen.includes('비해당'), seen.join(' → '));
  // 합친 동의 무창층 바닥면적 합계 = 900(상가동 1층만)
  const r = runCase(c, { answers: truth });
  assert.equal(r.site.facilities.find((x) => x.id === 'x').verdict, '해당');
});

test('3차 S1b·S2: 층 단위 무창층 조건·전칭 플래그도 동별로 — 합친 층·any 로 모아 틀린 비해당을 내지 않는다', () => {
  const windowless = { site_connected: true, 'windowless@상가동/1F': true, 'windowless@상가동/2F': false, 'windowless@주차타워/1F': false };
  assert.equal(verdictOf('rv3-s1b', '상가동', 'x', { answers: windowless }), '해당');
  // 불연재료 구조는 모든 동이 그래야 참(site_aggregation: all)
  const onlyTower = { site_connected: true, 'noncombustible_structure@상가동': false, 'noncombustible_structure@주차타워': true };
  assert.equal(verdictOf('rv3-s2', '상가동', 'x', { answers: onlyTower }), '해당');
  const both = { site_connected: true, 'noncombustible_structure@상가동': true, 'noncombustible_structure@주차타워': true };
  assert.equal(verdictOf('rv3-s2', '상가동', 'x', { answers: both }), '비해당');
  // 한 동만 답했으면 확인 필요(다른 동을 묻는다)
  const f = fac(runCase(caseById('rv3-s2'), { answers: { site_connected: true, 'noncombustible_structure@주차타워': true } }), '상가동', 'x');
  assert.deepEqual([f.verdict, qkeys(f)], ['확인 필요', ['noncombustible_structure@상가동']]);
});

test('3차: 층 면적 기준은 동별 층과 합친 한 층 읽기가 갈리면 확인 필요(site_combined_floors) — 답하면 그 읽기', () => {
  const c = caseById('rv3-combined-floor');
  const f = fac(runCase(c, { answers: { site_connected: true } }), '상가동', 'x');
  assert.deepEqual([f.verdict, qkeys(f)], ['확인 필요', ['site_combined_floors@대지 전체']]);
  assert.match(f.reasons.join(' '), /동별 층으로 보면 없음, 같은 층을 합친 한 층으로 보면 있음/);
  assert.equal(verdictOf('rv3-combined-floor', '상가동', 'x', { answers: { site_connected: true, 'site_combined_floors@대지 전체': true } }), '해당');
  assert.equal(verdictOf('rv3-combined-floor', '상가동', 'x', { answers: { site_connected: true, 'site_combined_floors@대지 전체': false } }), '비해당');
  // 두 읽기가 같으면(1,000㎡ 이상 — 동별 900 < 1,000 이지만 합친 1층 1,800 도, … ) 묻지 않는다: 기준 2,000㎡ 이면 둘 다 없음
  const none = { ...c, dataFiles: { ...c.dataFiles, '02': v2('02', [{ facility_id: 'x', facility_name: 'X', regulations: [row('f', { floor_exists: { floors: [{ kind: 'ground', level: { lte: 1 } }], area: { gte: 2000 } } })] }]) } };
  assert.equal(fac(runCase(none, { answers: { site_connected: true } }), '상가동', 'x').verdict, '비해당');
});

// ───── 3차 리뷰 MEDIUM: 함께 물은 면적 질문의 모순 ─────

test('3차 MEDIUM: 면적 항등식으로 묶인 면적 질문은 동마다 한 번에 하나 — 범위 안에서 답하면 모순이 생기지 않는다(rv3_misc)', () => {
  const c = caseById('coupled-areas');
  const f = fac(runCase(c), '본동', 'x');
  // 2층·3층 모두 결정적이지만 한 번에 하나만(범위 [0, 600]) — 답을 받으면 나머지가 정해지거나 좁혀진다
  assert.deepEqual([f.verdict, qkeys(f), f.questions[0].range, f.moreQuestions], ['확인 필요', ['floor_area@본동/2F'], [0, 600], 1]);
  for (const [v2F, verdict] of [[550, '비해당'], [50, '비해당'], [300, '해당']]) {
    const r = runCase(c, { answers: { 'floor_area@본동/2F': v2F } });
    assert.deepEqual([fac(r, '본동', 'x').verdict, qkeys(fac(r, '본동', 'x'))], [verdict, []], String(v2F));
    assert.ok(!r.warnings.some((w) => w.code === 'AREA_ANSWER_MISMATCH'));
  }
  // 2층만 보는 기준: 2층 50 → 3층 550 이어도 제외 아님 → 해당
  assert.equal(verdictOf('coupled-areas-2f', '본동', 'x', { answers: { 'floor_area@본동/2F': 50 } }), '해당');
  assert.equal(verdictOf('coupled-areas-2f', '본동', 'x', { answers: { 'floor_area@본동/2F': 550 } }), '비해당');
});

test('3차 MEDIUM: 그래도 모순된 면적 답변이 들어오면 면적에 기대는 비해당은 확인 필요 + 면적 답변 확인 질문, "예"면 그 답대로', () => {
  const c = caseById('coupled-areas-2f');
  const both = { 'floor_area@본동/2F': 550, 'floor_area@본동/3F': 550 };
  const r = runCase(c, { answers: both });
  assert.ok(r.warnings.some((w) => w.code === 'AREA_ANSWER_MISMATCH'));
  const f = fac(r, '본동', 'x');
  assert.deepEqual([f.verdict, qkeys(f)], ['확인 필요', ['area_check@본동']]);
  assert.match(f.reasons.join(' '), /AREA_ANSWER_MISMATCH/);
  assert.equal(verdictOf('coupled-areas-2f', '본동', 'x', { answers: { ...both, 'area_check@본동': true } }), '비해당');
  assert.equal(verdictOf('coupled-areas-2f', '본동', 'x', { answers: { ...both, 'area_check@본동': false } }), '확인 필요');
  // 면적에 기대지 않는 비해당(확정 사실만으로 F)은 그대로
  const noArea = { ...c, dataFiles: { '02': v2('02', [{ facility_id: 'x', facility_name: 'X', regulations: [row('g', { m: 'ground_floors', gte: 5 })] }]) } };
  assert.equal(fac(runCase(noArea, { answers: both }), '본동', 'x').verdict, '비해당');
  // 대장 자체의 불일치(층별개요 합 ≠ 연면적)는 답변 탓이 아니다 — 면적을 하나 답해도 AREA_ANSWER_MISMATCH 아님
  const n1 = runCase(caseById('n1-lt'), { answers: { 'windowless@본동/1F': false } });
  assert.ok(!n1.warnings.some((w) => w.code === 'AREA_ANSWER_MISMATCH'));
});

test('3차 MEDIUM(fz_rounds): 면적 질문 범위는 답을 받을 때마다 다시 좁혀진다 — 연면적은 층 면적으로, 빈 부분은 층 범위 − 다른 부분', () => {
  // 연면적 빈칸: 알려진 층 면적 합(700) 이상 — 2층을 답하면 연면적이 정해져, 그와 모순되는 연면적 질문이 나오지 않는다
  const t = fac(runCase(caseById('rounds-total-range')), '본동', 'x');
  assert.deepEqual([t.verdict, qkeys(t), t.questions[0].range], ['확인 필요', ['total_area@본동'], [700, Infinity]]);
  assert.equal(verdictOf('rounds-total-range', '본동', 'x', { answers: { 'floor_area@본동/2F': 0 } }), '비해당'); // 연면적 = 700
  assert.equal(verdictOf('rounds-total-range', '본동', 'x', { answers: { 'floor_area@본동/2F': 500 } }), '해당'); // 연면적 = 1,200
  // 여러 부분 층의 빈 부분: 지하1층 [100, 600] − 주차장 100 → [0, 500] (층 범위를 그대로 보이면 600 을 답해 연면적을 넘는다)
  const p = fac(runCase(caseById('rounds-part-range')), '본동', 'x');
  assert.deepEqual([p.verdict, qkeys(p), p.questions[0].range], ['확인 필요', ['part_area[2]@본동/B1'], [0, 500]]);
  for (const [v, verdict] of [[500, '해당'], [100, '비해당']]) {
    const r = runCase(caseById('rounds-part-range'), { answers: { 'part_area[2]@본동/B1': v } });
    assert.deepEqual([fac(r, '본동', 'x').verdict, r.warnings.some((w) => w.code === 'AREA_ANSWER_MISMATCH')], [verdict, false], String(v));
  }
});

test('3차 MEDIUM(fz_rounds): 층수도 면적 항등식 묶음 — 면적보다 먼저 묻고, 층수 범위는 답한 면적에 맞춘다', () => {
  // 같은 차례에 지하층수와 1층 면적을 함께 물으면 따로따로 범위 안의 답(지하 0층, 1층 0)이 연면적 900 과 모순 — 지하층수만 먼저
  const first = fac(runCase(caseById('rounds-count-first')), '직접입력', 'x');
  assert.deepEqual([first.verdict, qkeys(first), first.moreQuestions], ['확인 필요', ['basement_floors@직접입력'], 1]);
  assert.equal(verdictOf('rounds-count-first', '직접입력', 'x', { answers: { 'basement_floors@직접입력': 0 } }), '해당'); // 1층 = 900
  const next = fac(runCase(caseById('rounds-count-first'), { answers: { 'basement_floors@직접입력': 1 } }), '직접입력', 'x');
  assert.deepEqual([qkeys(next), next.questions[0].range], [['floor_area@직접입력/1F'], [0, 900]]);
  // 1층 800 을 답한 뒤의 지하층수: 0 층이면 연면적 1,600 을 채울 수 없으므로 [1, 30]
  const range = (answers) => fac(runCase(caseById('rounds-count-range'), { answers }), '직접입력', 'x').questions[0].range;
  assert.deepEqual([range({}), range({ 'floor_area@직접입력/1F': 800 }), range({ 'floor_area@직접입력/1F': 1600 })], [[0, 30], [1, 30], [0, 30]]);
  // 가정값 층수(지하 빈칸 → 0): 가정값을 푼 재평가의 1층 면적 범위 [0, 3,000] 을 묻는 대신 지하층수부터 — 그 뒤 1층 면적은 모순 없이
  const assumed = fac(runCase(caseById('rounds-assumed-count')), '직접입력', 'x');
  assert.deepEqual([assumed.verdict, qkeys(assumed).sort()], ['확인 필요', ['basement_floors@직접입력', 'windowless@직접입력/1F']]);
  assert.equal(verdictOf('rounds-assumed-count', '직접입력', 'x', { answers: { 'basement_floors@직접입력': 0, 'windowless@직접입력/1F': false } }), '비해당');
  const after = fac(runCase(caseById('rounds-assumed-count'), { answers: { 'basement_floors@직접입력': 1 } }), '직접입력', 'x');
  assert.deepEqual([qkeys(after), after.questions[0].range], [['floor_area@직접입력/1F'], [0, 3000]]);
  const answered = runCase(caseById('rounds-assumed-count'), { answers: { 'basement_floors@직접입력': 1, 'floor_area@직접입력/1F': 0 } });
  assert.deepEqual([fac(answered, '직접입력', 'x').verdict, answered.warnings.some((w) => w.code === 'AREA_ANSWER_MISMATCH')], ['해당', false]);
});

test('3차 MEDIUM: 한 동의 면적 항등식 묶음 질문(층·부분 면적, 연면적, 층수)은 건물 전체(동별·대지 전체 목록)에서 한 번에 하나', () => {
  const IDENT = /^(floor_area|part_area\[[^\]]*\]|total_area|ground_floors|basement_floors)@/;
  const check = (r, where) => {
    const byDong = new Map();
    for (const f of [...r.dongs.flatMap((d) => d.facilities), ...(r.site?.facilities || [])]) {
      for (const q of f.questions) if (IDENT.test(q.key) && q.dong) byDong.set(q.dong, new Set([...(byDong.get(q.dong) || []), q.key]));
    }
    for (const [dong, keys] of byDong) assert.equal(keys.size, 1, `${where} ${dong}: ${[...keys].join(', ')}`);
    return byDong.size;
  };
  let groups = 0;
  for (const c of CASES) {
    for (const answers of [{}, { site_connected: true }, { site_connected: false }]) groups += check(runCase(c, { answers }), `${c.id} ${JSON.stringify(answers)}`);
  }
  for (const fx of FIXTURES) groups += check(evaluate(fx.input, { answers: fx.answers || {} }), fx.id);
  assert.ok(groups > 20, String(groups));
});

test('3차 MEDIUM: 합친 동(대지 전체)도 동별 면적 답변 모순이면 그 동 면적에 기대는 비해당을 보류 — 질문은 그 동의 area_check', () => {
  const c = caseById('site-area-mismatch');
  const base = runCase(c, { answers: { site_connected: true } });
  assert.deepEqual([fac(base, '상가동', 'x').verdict, base.site.facilities.find((f) => f.id === 'x').verdict], ['비해당', '비해당']);
  // 상가동 1층·2층 각 1,200 → 합 2,400 ≠ 연면적 1,600
  const both = { 'floor_area@상가동/1F': 1200, 'floor_area@상가동/2F': 1200 };
  for (const connected of [true, undefined]) {
    const r = runCase(c, { answers: { ...both, ...(connected === undefined ? {} : { site_connected: connected }) } });
    assert.ok(r.warnings.some((w) => w.code === 'AREA_ANSWER_MISMATCH' && w.dong === '상가동'));
    const site = r.site.facilities.find((f) => f.id === 'x');
    assert.deepEqual([site.verdict, qkeys(site)], ['확인 필요', ['area_check@상가동']], String(connected));
    assert.deepEqual([fac(r, '상가동', 'x').verdict, qkeys(fac(r, '상가동', 'x'))], ['확인 필요', ['area_check@상가동']], String(connected));
  }
  const ok = runCase(c, { answers: { ...both, site_connected: true, 'area_check@상가동': true } });
  assert.deepEqual([fac(ok, '상가동', 'x').verdict, ok.site.facilities.find((f) => f.id === 'x').verdict], ['비해당', '비해당']);
});

test('3차 MEDIUM: 면적 답변 모순은 답변끼리·확정 사실과의 모순만 — 대장 자체의 모순(상한에 가려진 층)이나 가정값과만 어긋난 답은 아니다', () => {
  // 3층 400 > 연면적 300: 대장 자체가 모순 → 면적 항등식을 쓰지 않아 1·2층을 0 으로 몰지 않고, 다른 층 답변은 답변 탓 모순이 아니다
  const base = runCase(caseById('data-over-total'));
  assert.ok(base.warnings.some((w) => w.code === 'FLOOR_AREA_MISMATCH'));
  assert.deepEqual([fac(base, '본동', 'x').verdict, fac(base, '본동', 'x').questions[0].range], ['확인 필요', [0, 300]]);
  const both = runCase(caseById('data-over-total'), { answers: { 'floor_area@본동/1F': 100, 'floor_area@본동/2F': 100 } });
  assert.deepEqual([fac(both, '본동', 'x').verdict, both.warnings.some((w) => w.code === 'AREA_ANSWER_MISMATCH')], ['비해당', false]);
  // 지하층수 가정 0 에서 지상층 면적 합 210 < 연면적 400: 지하층이 있으면 맞는 답 — 경고·비해당 보류 없이 비해당(재평가도 비해당)
  const a = runCase(caseById('assumed-count-answers'), { answers: { 'floor_area@직접입력/1F': 60, 'floor_area@직접입력/2F': 0, 'floor_area@직접입력/3F': 150 } });
  assert.deepEqual([fac(a, '직접입력', 'x').verdict, a.warnings.some((w) => w.code === 'AREA_ANSWER_MISMATCH')], ['비해당', false]);
});

test('3차 LOW(rv3_range): 부분 면적 답이 연면적을 넘으면 연면적 상한에 가려지지 않고 경고 — 면적에 기대는 비해당은 보류', () => {
  const c = caseById('rv3-range');
  // 대장 자체도 모순(2층 600 + 400 > 700)이라 항등식은 쓰지 않는다 — 그래도 지하1층 답은 답변 탓 모순으로 잡는다
  const base = runCase(c);
  assert.ok(base.warnings.some((w) => w.code === 'FLOOR_AREA_MISMATCH'));
  assert.equal(fac(base, '본동', 'x').verdict, '비해당');
  const over = runCase(c, { answers: { 'part_area[2]@본동/B1': 600 } });
  const w = over.warnings.find((x) => x.code === 'AREA_ANSWER_MISMATCH');
  assert.match(w?.message ?? '', /지하1층 면적\(답변 포함\)이 연면적 700㎡ 보다 큼/);
  assert.deepEqual([fac(over, '본동', 'x').verdict, qkeys(fac(over, '본동', 'x'))], ['확인 필요', ['area_check@본동']]);
  assert.equal(verdictOf('rv3-range', '본동', 'x', { answers: { 'part_area[2]@본동/B1': 600, 'area_check@본동': true } }), '비해당');
  // 연면적 안의 답(지하1층 600 + 50)은 경고 없음 — 2층(대장 자체 모순)은 답변 탓이 아니다
  const fine = runCase(c, { answers: { 'part_area[2]@본동/B1': 50 } });
  assert.deepEqual([fac(fine, '본동', 'x').verdict, fine.warnings.some((x) => x.code === 'AREA_ANSWER_MISMATCH')], ['비해당', false]);
});

// ───── 4차 리뷰 HIGH: 연면적에 들어가지 않는 층별개요 행(필로티·다락·부속건축물·면적제외) ─────

test('4차 HIGH(rv4_piloti): 면적제외 "1" 인 필로티 주차 행은 면적 항등식에서 빼고, 면적제외여부가 없는 행은 다른 층을 고정하지 않는다', () => {
  // 필로티 제외 · 2층 산입 여부 모름 → 3층 = 1,000 − (2층 0 ~ 400) = 600 ~ 1,000 ≥ 500 → 해당(묻지 않음). 예전에는 3층 = 400 → 틀린 비해당
  const f = fac(runCase(caseById('rv4-piloti')), '본동', 'x');
  assert.deepEqual([f.verdict, qkeys(f)], ['해당', []]);
  assert.match(f.reasons.join(' '), /3층 600~1,000㎡/);
  const verdict = (registry, answers = {}) => fac(runCase({ ...caseById('rv4-piloti'), input: { registry } }, { answers }), '본동', 'x');
  // 2층도 산입('0')이면 3층 = 600 으로 정해진다
  assert.deepEqual([verdict(pilotiBuilding({ second: { areaExctYn: '0' } })).verdict, qkeys(verdict(pilotiBuilding({ second: { areaExctYn: '0' } })))], ['해당', []]);
  // 필로티 행의 면적제외여부가 빈칸이면 산입 여부를 모름(필로티는 '0' 이어도 모름) → 3층 [400, 600] — 물어서 정한다
  for (const piloti of [{ areaExctYn: ' ' }, {}, { areaExctYn: '0' }]) {
    const u = verdict(pilotiBuilding({ piloti, second: { areaExctYn: '0' } }));
    assert.deepEqual([u.verdict, qkeys(u), u.questions[0].range], ['확인 필요', ['floor_area@본동/3F'], [400, 600]], JSON.stringify(piloti));
    const b = pilotiBuilding({ piloti, second: { areaExctYn: '0' } });
    assert.equal(verdict(b, { 'floor_area@본동/3F': 600 }).verdict, '해당');
    const low = runCase({ ...caseById('rv4-piloti'), input: { registry: b } }, { answers: { 'floor_area@본동/3F': 400 } });
    assert.deepEqual([fac(low, '본동', 'x').verdict, low.warnings.some((w) => w.code === 'AREA_ANSWER_MISMATCH')], ['비해당', false]);
  }
  // 대조군(필로티 행 없음 — 1층도 빠진 층): 3층은 1층과 나눠 가지므로 확인 필요 — 2층 '0' 이면 [0, 600], 면적제외여부가 없으면 [0, 1,000]
  for (const [second, range] of [[{ areaExctYn: '0' }, [0, 600]], [{}, [0, 1000]]]) {
    const control = verdict(pilotiBuilding({ withPiloti: false, second }));
    assert.deepEqual([control.verdict, qkeys(control), control.questions[0].range], ['확인 필요', ['floor_area@본동/3F'], range], JSON.stringify(second));
  }
});

test('4차 HIGH(rv4_piloti2): 층 목록이 일부여도(지하층수 빈칸) 필로티·면적제외여부 없는 행으로 다른 층의 상한을 좁히지 않는다', () => {
  const c = caseById('rv4-piloti2');
  const f = fac(runCase(c), '본동', 'x');
  assert.deepEqual([f.verdict, qkeys(f)], ['확인 필요', ['basement_floors@본동']]);
  assert.match(f.reasons.join(' '), /3층 0~1,000㎡/);
  const next = fac(runCase(c, { answers: { 'basement_floors@본동': 0 } }), '본동', 'x');
  assert.deepEqual([next.verdict, qkeys(next), next.questions[0].range], ['확인 필요', ['floor_area@본동/3F'], [400, 1000]]);
  assert.equal(verdictOf('rv4-piloti2', '본동', 'x', { answers: { 'basement_floors@본동': 0, 'floor_area@본동/3F': 600 } }), '해당');
});

test('4차 HIGH: 층별개요 면적제외여부(areaExctYn)·주/부속 구분(mainAtchGbCd) 읽기 — 실제 대장 값 "0"·" " 포함', () => {
  const inTotal = (row, title = {}) => normalizeRegistry({ title: [{ mainPurpsCdNm: '제2종근린생활시설', totArea: 1000, grndFlrCnt: 1, ugrndFlrCnt: 0, ...title }], floors: [{ flrGbCd: '20', flrNo: 1, mainPurpsCdNm: '제2종근린생활시설', etcPurps: '소매점', area: 500, ...row }] }, { useIndex: INDEX }).dongs[0].floors[0].parts[0].inTotal;
  const flags = [['0', 'yes'], ['N', 'yes'], [' 0 ', 'yes'], ['1', 'no'], ['Y', 'no'], ['y', 'no'], [' ', 'maybe'], ['', 'maybe'], [undefined, 'maybe'], ['?', 'maybe']];
  for (const [v, want] of flags) assert.equal(inTotal(v === undefined ? {} : { areaExctYn: v }), want, JSON.stringify(v));
  // 주/부속: 주건축물 표제부 아래의 부속건축물 행은 제외, 표제부 구분을 모르면 모름, 같은 구분이면 면적제외여부대로
  assert.equal(inTotal({ areaExctYn: '0', mainAtchGbCd: '1' }, { mainAtchGbCd: '0' }), 'no');
  assert.equal(inTotal({ areaExctYn: '0', mainAtchGbCdNm: '부속건축물' }, { mainAtchGbCdNm: '주건축물' }), 'no');
  assert.equal(inTotal({ areaExctYn: '0', mainAtchGbCd: '1' }), 'maybe');
  assert.equal(inTotal({ areaExctYn: '0', mainAtchGbCd: '1' }, { mainAtchGbCd: '1' }), 'yes');
  assert.equal(inTotal({ areaExctYn: '0', mainAtchGbCd: '0' }, { mainAtchGbCd: '0' }), 'yes');
  assert.equal(inTotal({ areaExctYn: '0', mainAtchGbCd: ' ' }, { mainAtchGbCd: '0' }), 'yes');
  // 필로티·다락은 '0' 이어도 모름, 옥탑은 늘 모름(면적제외 '1' 이면 제외)
  assert.equal(inTotal({ areaExctYn: '0', etcPurps: '필로티(주차장)' }), 'maybe');
  assert.equal(inTotal({ areaExctYn: '0', etcPurps: '다락' }), 'maybe');
  const roof = (row) => normalizeRegistry({ title: [{ mainPurpsCdNm: '제2종근린생활시설', totArea: 1000, grndFlrCnt: 1, ugrndFlrCnt: 0 }], floors: [{ flrGbCd: '30', flrNo: 1, mainPurpsCdNm: '제2종근린생활시설', etcPurps: '계단실', area: 20, ...row }] }, { useIndex: INDEX }).dongs[0].floors[0].parts[0].inTotal;
  assert.deepEqual([roof({ areaExctYn: '0' }), roof({ areaExctYn: '1' })], ['maybe', 'no']);
});

test('4차 HIGH: 부속건축물 행·면적제외 행은 연면적 합계·불일치 경고에서 빼고, 모르는 행은 0 ~ 그 면적(연면적 파생·FLOOR_AREA_MISMATCH)', () => {
  const rows = (extra) => [
    { flrGbCd: '20', flrNo: 1, mainPurpsCdNm: '제2종근린생활시설', etcPurps: '소매점', area: 600, areaExctYn: '0', mainAtchGbCd: '0' },
    { flrGbCd: '20', flrNo: 2, mainPurpsCdNm: '제2종근린생활시설', etcPurps: '소매점', area: 400, areaExctYn: '0', mainAtchGbCd: '0' },
    { flrGbCd: '20', flrNo: 1, mainPurpsCdNm: '창고시설', etcPurps: '창고', area: 300, ...extra },
  ];
  const build = (title, extra) => normalizeRegistry({ title: [{ mainPurpsCdNm: '제2종근린생활시설', grndFlrCnt: 2, ugrndFlrCnt: 0, mainAtchGbCd: '0', ...title }], floors: rows(extra) }, { useIndex: INDEX });
  // 부속건축물 창고(주건축물 표제부) — 연면적 1,000 과 맞음: 경고 없음, 면적 항등식도 그대로(예전: 1,300 > 1,000 경고)
  const annex = build({ totArea: 1000 }, { areaExctYn: '0', mainAtchGbCd: '1' });
  assert.ok(!annex.warnings.some((w) => w.code === 'FLOOR_AREA_MISMATCH'));
  // 연면적 빈칸이면 층별개요 합계: 부속 행 제외 → 1,000, 면적제외여부 빈칸 행은 0 ~ 300 → [1,000, 1,300], 면적제외 '1' → 1,000
  const total = (extra) => { const t = build({ totArea: '' }, extra).dongs[0].metrics.total_area; return [t.lo, t.hi]; };
  assert.deepEqual([total({ areaExctYn: '0', mainAtchGbCd: '1' }), total({ areaExctYn: ' ' }), total({ areaExctYn: '1' })], [[1000, 1000], [1000, 1300], [1000, 1000]]);
  // 산입 행만으로 연면적을 넘으면 여전히 경고 — 모르는 행은 넘김 판단에 넣지 않는다
  assert.ok(build({ totArea: 900 }, { areaExctYn: '1' }).warnings.some((w) => w.code === 'FLOOR_AREA_MISMATCH'));
  assert.ok(!build({ totArea: 1100 }, { areaExctYn: ' ' }).warnings.some((w) => w.code === 'FLOOR_AREA_MISMATCH'));
});

test('4차 HIGH: 산입 여부가 다른 행이 섞인 층 — 좁히는 것은 산입 몫뿐, 면적제외 행은 층 면적에 그대로(연면적 상한도 씌우지 않음)', () => {
  // 1층 = 소매점(면적 빈칸, 산입) + 필로티 주차 700(면적제외 '1'), 2층 소매점 600(산입), 연면적 1,000
  const registry = {
    title: [{ mainPurpsCdNm: '제2종근린생활시설', etcPurps: '소매점', totArea: 1000, grndFlrCnt: 2, ugrndFlrCnt: 0 }],
    floors: [
      { flrGbCd: '20', flrNo: 1, mainPurpsCdNm: '제2종근린생활시설', etcPurps: '소매점', area: '', areaExctYn: '0' },
      { flrGbCd: '20', flrNo: 1, mainPurpsCdNm: '제2종근린생활시설', etcPurps: '필로티주차장', area: 700, areaExctYn: '1' },
      { flrGbCd: '20', flrNo: 2, mainPurpsCdNm: '제2종근린생활시설', etcPurps: '소매점', area: 600, areaExctYn: '0' },
    ],
    permit: [{ archPmsDay: '20150101', archGbCdNm: '신축' }],
  };
  const dong = normalizeRegistry(registry, { useIndex: INDEX }).dongs[0];
  const at = (node, answers = {}) => evalCondition(node, makeEnv({ dong, index: INDEX, answers, policy: resolvePolicy(), inputDefs: inputDefsFrom(INPUTS) }));
  // 소매점 행 = 1,000 − 600 = 400 (정해짐 — 묻지 않음), 1층 면적 = 400 + 700 = 1,100 (연면적보다 커도 모순 아님)
  const ge = (n) => at({ floor_exists: { floors: [{ kind: 'ground', level: { lte: 1 } }], area: { gte: n } } });
  assert.deepEqual([ge(1100).v, ge(1101).v], ['T', 'F']);
  const retail = at({ sum_area: { floors: [{ kind: 'ground', level: { lte: 1 } }], use: ['retail_small'] }, gte: 400 });
  assert.equal(retail.v, 'T');
  assert.equal(at({ sum_area: { floors: [{ kind: 'ground', level: { lte: 1 } }], use: ['retail_small'] }, gt: 400 }).v, 'F');
  // 바닥면적 합계의 상한도 연면적 + 연면적 밖일 수 있는 면적 — 1층 합계 1,100 ≥ 1,050 (연면적 1,000 으로 자르면 틀린 F)
  assert.equal(at({ sum_area: { floors: [{ kind: 'ground', level: { lte: 1 } }] }, gte: 1050 }).v, 'T');
  const r = runCase({ input: { registry }, dataFiles: { '02': v2('02', [{ facility_id: 'x', facility_name: 'X', regulations: [row('a', { m: 'total_area', gte: 1 })] }]) } }, { answers: { 'part_area[1]@본동/1F': 400 } });
  assert.ok(!r.warnings.some((w) => w.code === 'AREA_ANSWER_MISMATCH' || w.code === 'FLOOR_AREA_MISMATCH'), JSON.stringify(r.warnings));
  // 제외 행의 면적도 빈칸이면: 1층 = 소매점(산입, 빈칸) + 필로티(제외, 빈칸). 소매점 행의 범위는 산입 몫으로만 좁힌다 — 층 범위 − 다른 행으로
  // 보이면 [0, 1,000] 이 되어 1,000 을 답하면 연면적(1,000 − 2층 600)과 모순
  const both = { ...registry, floors: registry.floors.map((f) => (f.etcPurps === '필로티주차장' ? { ...f, area: '' } : f)) };
  const mixed = normalizeRegistry(both, { useIndex: INDEX }).dongs[0];
  const node = { sum_area: { floors: [{ kind: 'ground', level: { lte: 1 } }], use: ['retail_small'] }, gte: 300 };
  const v = evalCondition(node, makeEnv({ dong: mixed, index: INDEX, answers: {}, policy: resolvePolicy(), inputDefs: inputDefsFrom(INPUTS) }));
  assert.deepEqual([v.v, v.deps.some((d) => d.key === 'part_area[1]@본동/1F')], ['T', false]); // 소매점 행 = 400 으로 정해짐
  // 행 면적을 다 알 때: 소매점 400 + 필로티 700 = 1층 1,100 — 연면적 1,000 으로 자르지 않는다(예전: 층 전체에 상한 → 1,000)
  const known = normalizeRegistry({ ...registry, floors: registry.floors.map((f) => (f.etcPurps === '소매점' && f.flrNo === 1 ? { ...f, area: 400 } : f)) }, { useIndex: INDEX }).dongs[0];
  const envK = makeEnv({ dong: known, index: INDEX, answers: {}, policy: resolvePolicy(), inputDefs: inputDefsFrom(INPUTS) });
  assert.equal(evalCondition({ floor_exists: { floors: [{ kind: 'ground', level: { lte: 1 } }], area: { gte: 1100 } } }, envK).v, 'T');
});

test('4차 HIGH: 층수 질문의 범위도 연면적 밖 행은 빼고 본다 — 제외 행 면적으로 연면적을 채울 수 있다고 보지 않는다', () => {
  // 연면적 1,600, 지상 1층(소매점 800 산입 + 필로티 주차 800), 지하층수 빈칸 — 필로티가 제외('1')면 지하 0층으로는 연면적을 못 채운다
  const registry = (flag) => ({
    title: [{ mainPurpsCdNm: '제2종근린생활시설', etcPurps: '소매점', totArea: 1600, grndFlrCnt: 1, ugrndFlrCnt: '' }],
    floors: [
      { flrGbCd: '20', flrNo: 1, mainPurpsCdNm: '제2종근린생활시설', etcPurps: '소매점', area: 800, areaExctYn: '0' },
      { flrGbCd: '20', flrNo: 1, mainPurpsCdNm: '제2종근린생활시설', etcPurps: '필로티주차장', area: 800, areaExctYn: flag },
    ],
    permit: [{ archPmsDay: '20150101', archGbCdNm: '신축' }],
  });
  const range = (flag) => {
    const f = fac(runCase({ input: { registry: registry(flag) }, dataFiles: { '02': v2('02', [{ facility_id: 'x', facility_name: 'X', regulations: [row('b', { m: 'basement_floors', gte: 2 })] }]) } }), '본동', 'x');
    return [qkeys(f), f.questions[0].range];
  };
  assert.deepEqual(range('1'), [['basement_floors@본동'], [1, 30]]);
  assert.deepEqual(range(' '), [['basement_floors@본동'], [0, 30]]); // 필로티가 산입될 수도 있으면 0층도 가능
});

test('면적 항등식으로 정해지는 층은 묻지 않고, 연면적과 모순되는 면적 답변은 경고(AREA_ANSWER_MISMATCH)', () => {
  const r = runCase(caseById('area-determined'));
  const f = fac(r, '본동', 'x');
  assert.deepEqual([f.verdict, qkeys(f)], ['비해당', []]);
  assert.ok(!r.warnings.some((w) => w.code === 'AREA_ANSWER_MISMATCH'));
  const contra = runCase(caseById('area-determined'), { answers: { 'floor_area@본동/2F': 0 } });
  assert.match(contra.warnings.find((w) => w.code === 'AREA_ANSWER_MISMATCH').message, /1,000㎡ 가 연면적 1,200㎡/);
  const fine = runCase(caseById('area-determined'), { answers: { 'floor_area@본동/2F': 200 } });
  assert.ok(!fine.warnings.some((w) => w.code === 'AREA_ANSWER_MISMATCH'));
  assert.equal(fac(fine, '본동', 'x').verdict, '비해당');
});

test('재평가 방향 점검(fixcheck_release): 가정값 정책을 끈 결과와 같고, 정당한 비해당은 그대로', () => {
  const r = runCase(caseById('golden06-released-basement'));
  assert.equal(fac(r, '직접입력', 'evacuation_equipment').verdict, '비해당');
  const eb = fac(r, '직접입력', 'emergency_broadcast');
  assert.deepEqual([eb.verdict, qkeys(eb)], ['확인 필요', ['basement_floors@직접입력']]);
  // 기본 정책(지하층 빈칸 = 가정 0)도 같은 판정 — 가정값에 기대는 비해당은 재평가가 막는다
  const d = runCase({ ...caseById('golden06-released-basement'), policy: undefined });
  assert.deepEqual(['evacuation_equipment', 'emergency_broadcast'].map((id) => fac(d, '직접입력', id).verdict), ['비해당', '확인 필요']);
});

test('골든 전체 스캔(golden_scan, 무창층 정책 기본·assume_none): 가정이 붙은 비해당은 문서화한 사용승인일 추정 구간 가정뿐', () => {
  for (const policy of [undefined, { windowless: 'assume_none' }]) {
    for (const fx of FIXTURES) {
      const r = evaluate(fx.input, { answers: fx.answers || {}, policy });
      for (const d of r.dongs) {
        for (const f of d.facilities) {
          if (f.verdict !== '비해당' || !f.assumptions.length) continue;
          const where = `${JSON.stringify(policy ?? null)} ${fx.id}/${d.id}/${f.id}`;
          assert.equal(r.dateInfo.source, 'approval', where);
          assert.ok(f.assumptions.every((a) => a.startsWith('기준일: 사용승인일')), `${where}: ${f.assumptions.join('; ')}`);
        }
      }
    }
  }
});
