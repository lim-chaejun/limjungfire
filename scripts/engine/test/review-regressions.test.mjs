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
import { caseById, row, v2 } from './review-cases.mjs';

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
  assert.deepEqual(qkeys(sp({})), ['floor_area@상가동/1F', 'floor_area@상가동/2F']);
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
  assert.deepEqual(qkeys(merged).sort(), ['floor_area@주차장동/B1', 'floor_area@주차장동/B2']);
  assert.equal(wc({ site_connected: true, 'floor_area@주차장동/B1': 1200 }).verdict, '해당');
  // 지하1층 800 → 지하2층 = 1,500 − 800 = 700(면적 항등식) → 1,000㎡ 이상인 지하층 없음 → 합친 판정도 비해당
  assert.equal(wc({ site_connected: true, 'floor_area@주차장동/B1': 800 }).verdict, '비해당');
  assert.equal(wc({ site_connected: false }).verdict, '비해당');
  // 합친 동이 쓰는 파일 중 v2 가 아닌 것은 notEvaluated 에 '대지 전체'로
  const noMixed = runCase({ ...c, dataFiles: { '02': c.dataFiles['02'], '18': c.dataFiles['18'] } });
  assert.deepEqual(noMixed.notEvaluated.map((x) => [x.dong, x.type_code, x.status]), [['대지 전체', '30', 'missing']]);
  assert.deepEqual(runCase({ ...c, dataFiles: { '02': c.dataFiles['02'], '18': c.dataFiles['18'] } }, { answers: { site_connected: false } }).notEvaluated, []);
});

test('2차 MEDIUM: 긴 질문 목록 — 날짜 → 동 → 층 순으로 시설마다 5개까지, 나머지는 moreQuestions (rv_q33)', () => {
  const sp = fac(runCase(caseById('q33-long-list')), '직접입력', 'sprinkler');
  assert.equal(sp.verdict, '확인 필요');
  assert.equal(sp.questions.length, 5);
  assert.ok(sp.moreQuestions >= 20, String(sp.moreQuestions));
  assert.deepEqual(sp.questions.slice(0, 2).map((q) => q.input), ['application_date', 'use_area']);
  assert.deepEqual(sp.questions.slice(2).map((q) => q.key), ['floor_area@직접입력/B3', 'floor_area@직접입력/B2', 'floor_area@직접입력/B1']);
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
