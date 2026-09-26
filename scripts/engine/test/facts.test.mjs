// 건물 사실 정규화 — 동별 분리, 옥탑·지하층 정책, 용도 혼재 층, 수동 입력, 허가일 선택
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ASSUMED, CONFIRMED, UNKNOWN, effectiveFloors, makeEnv, normalizeManual, normalizeRegistry, resolvePolicy } from '../../../js/engine/index.js';
import { metric } from '../../../js/engine/conditions.js';
import { INDEX } from './helpers.mjs';

const floor = (dongNm, gb, no, main, etc, area) => ({ dongNm, flrGbCd: gb, flrNo: no, mainPurpsCdNm: main, etcPurps: etc, area });
const reg = (items, policy) => normalizeRegistry(items, { useIndex: INDEX, policy });
const statusOf = (iv) => [...iv.loDeps, ...iv.hiDeps, ...iv.open].map((d) => d.status);

test('동별 분리: 층별개요는 dongNm 으로 나뉘고 면적·층수를 합산하지 않는다 (B2)', () => {
  const b = reg({
    title: [
      { dongNm: 'A동', mainPurpsCdNm: '공동주택', etcPurps: '아파트', totArea: 3000, grndFlrCnt: 10, ugrndFlrCnt: 0 },
      { dongNm: 'B동', mainPurpsCdNm: '제1종근린생활시설', etcPurps: '소매점', totArea: 200, grndFlrCnt: 1, ugrndFlrCnt: 0 },
    ],
    floors: [floor('A동', '20', 1, '공동주택', '아파트', 300), floor('B동', '20', 1, '제1종근린생활시설', '소매점', 200)],
  });
  assert.deepEqual(b.dongs.map((d) => d.id), ['A동', 'B동']);
  assert.equal(b.dongs[0].metrics.total_area.lo, 3000);
  assert.equal(b.dongs[1].metrics.total_area.lo, 200);
  assert.deepEqual(b.dongs[1].floors.map((f) => f.key), ['1F']);
  assert.deepEqual(b.dongs[0].typeCodes, ['01']);
  assert.deepEqual(b.dongs[1].typeCodes, ['02']);
});

test('옥탑: 층수·지상층 목록에서 제외(기본), 정책 rooftopCountsAsFloor 면 최상층 위 지상층', () => {
  const items = {
    title: [{ mainPurpsCdNm: '업무시설', etcPurps: '사무소', totArea: 950, grndFlrCnt: 3, ugrndFlrCnt: 0 }],
    floors: [
      floor('', '20', 1, '업무시설', '사무소', 300),
      floor('', '20', 2, '업무시설', '사무소', 300),
      floor('', '20', 3, '업무시설', '사무소', 300),
      { flrGbCd: '30', flrGbCdNm: '옥탑', flrNo: 1, flrNoNm: '옥탑1층', mainPurpsCdNm: '업무시설', etcPurps: '계단실', area: 50 },
    ],
  };
  const d = reg(items).dongs[0];
  assert.equal(d.metrics.ground_floors.lo, 3);
  const roof = d.floors.find((f) => f.key === 'R1');
  assert.equal(roof.kind, 'rooftop');
  assert.equal(roof.label, '옥탑1층');
  const d2 = reg(items, { rooftopCountsAsFloor: true }).dongs[0];
  assert.equal(d2.metrics.ground_floors.lo, 4);
  assert.deepEqual(d2.floors.map((f) => f.key), ['1F', '2F', '3F', '4F']);
  assert.equal(d2.floors[3].label, '4층(옥탑)');
});

test('지하층은 층수에서 제외(기본) — 지하층 포함 층수는 별도 지표, 정책으로 산입 가능', () => {
  const items = { title: [{ mainPurpsCdNm: '업무시설', totArea: 1000, grndFlrCnt: 3, ugrndFlrCnt: 2 }] };
  const d = reg(items).dongs[0];
  const env = makeEnv({ dong: d, index: INDEX, policy: resolvePolicy() });
  assert.equal(metric(env, 'ground_floors').lo, 3);
  assert.equal(metric(env, 'floors_incl_basement').lo, 5);
  const env2 = makeEnv({ dong: d, index: INDEX, policy: resolvePolicy({ basementCountsInFloors: true }) });
  assert.equal(metric(env2, 'ground_floors').lo, 5);
});

test('용도 혼재 층: 한 행에 용도가 둘이면 부분의 용도 목록이 둘(면적 배분 미상)', () => {
  const d = reg({
    title: [{ mainPurpsCdNm: '제1종근린생활시설', totArea: 300, grndFlrCnt: 1, ugrndFlrCnt: 0 }],
    floors: [floor('', '20', 1, '제1종근린생활시설', '소매점, 사무소', 300)],
  }).dongs[0];
  assert.deepEqual(d.floors[0].parts[0].terms, [{ use: 'retail_small' }, { use: 'office_small' }]);
});

test('같은 층의 여러 행은 한 층의 부분들 — 층 면적은 합, 부분 면적은 각각 확정', () => {
  const d = reg({
    title: [{ mainPurpsCdNm: '제2종근린생활시설', totArea: 300, grndFlrCnt: 1, ugrndFlrCnt: 0 }],
    floors: [floor('', '20', 1, '제2종근린생활시설', '일반음식점', 120), floor('', '20', 1, '제2종근린생활시설', '노래연습장', 180)],
  }).dongs[0];
  assert.equal(d.floors.length, 1);
  assert.equal(d.floors[0].area.lo, 300);
  assert.deepEqual(d.floors[0].parts.map((p) => p.area.lo), [120, 180]);
});

test('층별개요가 없으면 층수만큼 층을 보충 — 면적은 [0, 연면적] 미상, 층 목록은 완전', () => {
  const d = reg({ title: [{ mainPurpsCdNm: '제2종근린생활시설', totArea: 450, grndFlrCnt: 3, ugrndFlrCnt: 1 }] }).dongs[0];
  const { floors, complete } = effectiveFloors(d, 3, 1);
  assert.equal(complete, true);
  assert.deepEqual(floors.map((f) => f.key), ['B1', '1F', '2F', '3F']);
  assert.ok(floors.every((f) => f.synthesized && f.area.lo === 0 && f.area.hi === 450));
  assert.equal(floors[1].area.open[0].key, 'floor_area@본동/1F');
  assert.equal(effectiveFloors(d, null, 1).complete, false);
});

test('층수 출처 정책: 표제부 vs 층별개요 (불일치 표시)', () => {
  const items = {
    title: [{ mainPurpsCdNm: '업무시설', totArea: 1000, grndFlrCnt: 5, ugrndFlrCnt: 0 }],
    floors: [floor('', '20', 1, '업무시설', '사무소', 500), floor('', '20', 2, '업무시설', '사무소', 500)],
  };
  const byTitle = reg(items).dongs[0];
  assert.equal(byTitle.metrics.ground_floors.lo, 5);
  assert.ok(byTitle.notes.includes('FLOOR_COUNT_MISMATCH'));
  assert.equal(reg(items, { groundFloorsFrom: 'floor_items' }).dongs[0].metrics.ground_floors.lo, 2);
});

test('지하층만 있는 동(지하주차장): 지상 0층은 확정 0, 그 밖의 0층은 빈 값', () => {
  const d = reg({ title: [{ dongNm: '주차장동', mainPurpsCdNm: '자동차관련시설', etcPurps: '지하주차장', totArea: 5000, grndFlrCnt: 0, ugrndFlrCnt: 1 }] }).dongs[0];
  assert.equal(d.metrics.ground_floors.lo, 0);
  assert.deepEqual(statusOf(d.metrics.ground_floors), [CONFIRMED, CONFIRMED]);
  const blank = reg({ title: [{ mainPurpsCdNm: '업무시설', totArea: 100, grndFlrCnt: 0, ugrndFlrCnt: 0 }] }).dongs[0];
  assert.equal(blank.metrics.ground_floors.open[0].status, UNKNOWN);
});

test('부수 용도(내부 주차장)는 복합건축물 후보 판단에서 제외 — 정책으로 끌 수 있음', () => {
  const items = {
    title: [{ mainPurpsCdNm: '제1종근린생활시설', etcPurps: '소매점', totArea: 400, grndFlrCnt: 1, ugrndFlrCnt: 1 }],
    floors: [floor('', '10', 1, '제1종근린생활시설', '주차장', 200), floor('', '20', 1, '제1종근린생활시설', '소매점', 200)],
  };
  const d = reg(items).dongs[0];
  assert.deepEqual(d.groups, ['02', '18']);
  assert.equal(d.mixedUseCandidate, false);
  assert.deepEqual(d.typeCodes, ['02']);
  const d2 = reg(items, { mixedUseIgnoreAncillary: false }).dongs[0];
  assert.equal(d2.mixedUseCandidate, true);
  assert.deepEqual(d2.typeCodes, ['02', '18', '30']);
});

test('용도군 둘 이상 → 복합건축물 후보, 30번 파일을 평가 목록에 추가', () => {
  const d = reg({
    title: [{ mainPurpsCdNm: '공동주택', etcPurps: '아파트, 근린생활시설', totArea: 5000, grndFlrCnt: 10, ugrndFlrCnt: 0 }],
    floors: [floor('', '20', 1, '제1종근린생활시설', '소매점', 500), floor('', '20', 2, '공동주택', '아파트', 500)],
  }).dongs[0];
  assert.equal(d.mixedUseCandidate, true);
  assert.deepEqual(d.typeCodes, ['01', '02', '30']);
});

test('단독주택은 00 용도군, 모르는 용도는 미분류(평가 파일 없음)', () => {
  const house = reg({ title: [{ mainPurpsCdNm: '다가구주택', totArea: 200, grndFlrCnt: 3, ugrndFlrCnt: 0 }] }).dongs[0];
  assert.deepEqual(house.typeCodes, ['00']);
  const camp = reg({ title: [{ mainPurpsCdNm: '야영장시설', totArea: 90, grndFlrCnt: 1, ugrndFlrCnt: 0 }] }).dongs[0];
  assert.deepEqual(camp.typeCodes, []);
  assert.equal(camp.notCovered[0].name, '야영장시설');
});

test('승강기·세대수: 대장 값으로 확정, 주거용 0세대는 빈 값', () => {
  const apt = reg({ title: [{ mainPurpsCdNm: '공동주택', etcPurps: '아파트', totArea: 5000, grndFlrCnt: 10, ugrndFlrCnt: 0, hhldCnt: 0, rideUseElvtCnt: 1, emgenUseElvtCnt: 0 }] }).dongs[0];
  assert.equal(apt.flags.elevator.v, 'T');
  assert.equal(apt.metrics.households.open[0]?.status, UNKNOWN);
  const shop = reg({ title: [{ mainPurpsCdNm: '제1종근린생활시설', totArea: 100, grndFlrCnt: 1, ugrndFlrCnt: 0, hhldCnt: 0, rideUseElvtCnt: 0, emgenUseElvtCnt: 0 }] }).dongs[0];
  assert.equal(shop.flags.elevator.v, 'F');
  assert.equal(shop.metrics.households.lo, 0);
});

test('허가일: 인허가 신축 우선 → 후보가 여럿이면 가장 이른 날(가정) → 총괄표제부 → 표제부, 사용승인일', () => {
  const one = reg({ title: [{ mainPurpsCdNm: '업무시설', useAprDay: '20200101' }], permit: [{ archPmsDay: '20190505', archGbCdNm: '증축' }, { archPmsDay: '20150101', archGbCdNm: '신축' }] });
  assert.deepEqual(one.dates.permit, { value: '20150101', source: 'permit_api', status: CONFIRMED, candidates: ['20150101'] });
  assert.equal(one.dates.approval.value, '20200101');
  const many = reg({ title: [{ mainPurpsCdNm: '업무시설' }], permit: [{ archPmsDay: '20190505' }, { archPmsDay: '20150101' }] });
  assert.equal(many.dates.permit.status, ASSUMED);
  assert.deepEqual(many.dates.permit.candidates, ['20150101', '20190505']);
  assert.ok(many.warnings.some((w) => w.code === 'MULTIPLE_PERMITS'));
  const recap = reg({ title: [{ mainPurpsCdNm: '업무시설', pmsDay: '20100101' }], recap: [{ pmsDay: '20090909' }] });
  assert.equal(recap.dates.permit.value, '20090909');
  assert.equal(recap.dates.permit.source, 'recap');
});

test('총괄표제부만 있으면 그것으로 한 동을 만들고 경고', () => {
  const b = reg({ recap: [{ mainPurpsCdNm: '업무시설', totArea: 1200 }] });
  assert.equal(b.dongs.length, 1);
  assert.equal(b.dongs[0].metrics.total_area.lo, 1200);
  assert.ok(b.warnings.some((w) => w.code === 'RECAP_ONLY'));
});

test('층 구분을 알 수 없는 층별개요 행은 경고하고 건너뜀', () => {
  const b = reg({ title: [{ mainPurpsCdNm: '업무시설', totArea: 100, grndFlrCnt: 1, ugrndFlrCnt: 0 }], floors: [{ flrGbCd: '99', flrNoNm: '?', area: 10 }] });
  assert.ok(b.warnings.some((w) => w.code === 'FLOOR_ITEM_UNPARSED'));
  assert.equal(b.dongs[0].floors.length, 0);
});

test('수동 입력: 입력값은 사용자 확정, 지하층 빈칸(0)은 정책에 따라 가정 0 또는 모름, 직접 입력하면 확정', () => {
  const manual = { mainPurpsCdNm: '제2종근린생활시설', totArea: 800, grndFlrCnt: 2, ugrndFlrCnt: 0, pmsDay: '20240101', isManualInput: true };
  const d = normalizeManual(manual, { useIndex: INDEX }).dongs[0];
  assert.equal(d.id, '직접입력');
  assert.deepEqual(statusOf(d.metrics.total_area), [CONFIRMED, CONFIRMED]);
  assert.equal(d.metrics.basement_floors.lo, 0);
  assert.deepEqual(statusOf(d.metrics.basement_floors), [ASSUMED, ASSUMED]);
  assert.equal(normalizeManual(manual, { useIndex: INDEX, policy: { manualBlankBasement: 'unknown' } }).dongs[0].metrics.basement_floors.open[0].status, UNKNOWN);
  const entered = normalizeManual({ ...manual, enteredFields: ['ugrndFlrCnt'] }, { useIndex: INDEX }).dongs[0];
  assert.deepEqual(statusOf(entered.metrics.basement_floors), [CONFIRMED, CONFIRMED]);
  assert.deepEqual(d.synthTerms, [{ group: '02' }]);
});

test('수동 입력: 연면적·층수 0은 모름, 허가일 기본값(오늘)은 허가일로 쓰지 않음', () => {
  const b = normalizeManual({ mainPurpsCdNm: '공동주택(아파트)', totArea: 0, grndFlrCnt: 0, pmsDay: '20260926', permitDateIsDefault: true }, { useIndex: INDEX });
  const d = b.dongs[0];
  assert.equal(d.metrics.total_area.open[0].status, UNKNOWN);
  assert.equal(d.metrics.ground_floors.open[0].status, UNKNOWN);
  assert.equal(b.dates.permit, null);
  assert.deepEqual(d.typeCodes, ['01']);
  assert.deepEqual(d.synthTerms, [{ use: 'apartment' }]);
});
