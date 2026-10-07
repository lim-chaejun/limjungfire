// 평가기 — 불변식(가정값 F 는 비해당 아님), 결정적 질문, 개정 경계, 복합건축물, v1 대체, 면제 배지, 소급, 출력 호환
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  T, U, evaluateBuilding, evaluateRow, makeEnv, normalizeManual, normalizeRegistry, requiredTypeCodes, resolveDateInfo, resolvePolicy,
} from '../../../js/engine/index.js';
import { inputDefsFrom } from '../../../js/engine/questions.js';
import { FACILITIES, FIXTURE_SET, INDEX, INPUTS, TODAY, evaluate, facilityOf, loadBuildingFixtures } from './helpers.mjs';

const FX = Object.fromEntries(loadBuildingFixtures().map((f) => [f.id, f]));
const floor = (gb, no, etc, area, main = '제1종근린생활시설') => ({ flrGbCd: gb, flrNo: no, mainPurpsCdNm: main, etcPurps: etc, area });
const qkeys = (f) => f.questions.map((q) => q.key);

function run(items, { dataFiles = FIXTURE_SET.dataFiles, answers = {}, policy, exemptions = FIXTURE_SET.exemptions, today = TODAY, manual } = {}) {
  const building = manual ? normalizeManual(manual, { useIndex: INDEX, policy }) : normalizeRegistry(items, { useIndex: INDEX, policy });
  return evaluateBuilding({ building, dataFiles, exemptions, useIndex: INDEX, inputs: INPUTS, facilities: FACILITIES, answers, policy, today });
}

const v2 = (code, facilities, extra = {}) => ({ schema_version: 2, type_code: code, review: { status: 'draft', by: null, date: null }, fire_facilities: facilities, ...extra });
const row = (id, conditions, extra = {}) => ({ id, start_date: null, end_date: null, criteria: id, kind: 'trigger', conditions, scope: 'all_floors', ...extra });
const small = (permit = '20150101', extra = {}) => ({
  title: [{ mainPurpsCdNm: '제1종근린생활시설', etcPurps: '소매점', totArea: 500, grndFlrCnt: 1, ugrndFlrCnt: 0, ...extra }],
  floors: [floor('20', 1, '소매점', 500)],
  permit: [{ archPmsDay: permit, archGbCdNm: '신축' }],
});

// ───── 행 ─────

test('행 평가 결과는 { value, scope, questions, reasons } — 해당 층 범위는 만족한 층만', () => {
  const dong = normalizeRegistry(FX['nc-windowless-decisive'].input.registry, { useIndex: INDEX }).dongs[0];
  const envOf = (answers = {}) => makeEnv({ dong, index: INDEX, answers, policy: resolvePolicy(), inputDefs: inputDefsFrom(INPUTS) });
  const row = FIXTURE_SET.dataFiles['02'].fire_facilities.find((f) => f.facility_id === 'sprinkler').regulations.find((r) => r.id === 't02-sp-04');
  const u = evaluateRow(row, envOf());
  assert.equal(u.value.v, U);
  assert.deepEqual(u.questions, ['windowless@본동/1F', 'windowless@본동/2F']);
  assert.deepEqual(u.scope, { type: 'floors', floors: [], maybe: ['1F', '2F'] });
  assert.ok(u.reasons.some((x) => x.includes('무창층')));
  const t = evaluateRow(row, envOf({ 'windowless@본동/2F': true }));
  assert.equal(t.value.v, T);
  assert.deepEqual(t.scope.floors, ['2F']);
  assert.deepEqual(t.questions, []);
});

// ───── 불변식 ─────

test('불변식: 가정값(수동 입력 지하층 0)에 기대는 F 는 비해당이 아니라 확인 필요, 질문은 그 가정값', () => {
  const r = evaluate(FX['manual-area-floors'].input);
  const eb = facilityOf(r, '직접입력', 'emergency_broadcast');
  assert.equal(eb.verdict, '확인 필요');
  assert.deepEqual(qkeys(eb), ['basement_floors@직접입력']);
  assert.equal(eb.questions[0].status, 'assumed');
  assert.ok(eb.questions[0].note);
  assert.ok(eb.assumptions.length > 0);
});

test('불변식의 한계: 가정값이 근거에 있어도 어떤 값으로 바꿔도 결과가 같으면 비해당 (질문은 결정적인 것만)', () => {
  const r = evaluate(FX['manual-area-floors'].input);
  const ev = facilityOf(r, '직접입력', 'evacuation_equipment');
  assert.equal(ev.verdict, '비해당');
  assert.deepEqual(ev.questions, []);
});

test('불변식: 무창층 정책 assume_none 이어도 가정 F 로 비해당을 내지 않고 결정적 층만 묻는다', () => {
  const r = evaluate(FX['nc-windowless-decisive'].input, { policy: { windowless: 'assume_none' } });
  const sp = facilityOf(r, '본동', 'sprinkler');
  assert.equal(sp.verdict, '확인 필요');
  assert.deepEqual(qkeys(sp), ['windowless@본동/1F', 'windowless@본동/2F']);
});

// 출력 형식만 본다 — "가정값·미확인 입력에 어떤 값을 답해도 비해당"이라는 안전성 자체는 property.test.mjs 가 확인한다
test('출력 형식: 비해당에는 질문이 없고 required=false (골든 전체)', () => {
  for (const fx of Object.values(FX)) {
    const r = evaluate(fx.input, { answers: fx.answers || {} });
    for (const d of r.dongs) {
      for (const f of d.facilities) {
        if (f.verdict !== '비해당') continue;
        assert.deepEqual(f.questions, [], `${fx.id}/${d.id}/${f.id}`);
        assert.equal(f.required, false);
      }
    }
  }
});

// ───── 결정적 질문 ─────

test('결정적 질문만: 확정 F 인 행의 입력은 묻지 않는다', () => {
  const files = {
    '02': v2('02', [
      {
        facility_id: 'gas_leak_detector',
        facility_name: '가스누설경보기',
        category: '경보설비',
        regulations: [row('g1', { all: [{ flag: 'gas_facility' }, { m: 'total_area', gte: 1000 }] }), row('g2', { flag: 'inpatient_room' })],
      },
    ]),
  };
  const f = facilityOf(run(small(), { dataFiles: files }), '본동', 'gas_leak_detector');
  assert.equal(f.verdict, '확인 필요');
  assert.deepEqual(qkeys(f), ['inpatient_room@본동']);
  assert.equal(f.jointQuestions, false);
});

test('한 질문만으로는 결과가 안 바뀌면(결합 의존) 관련 질문을 모두 묻고 jointQuestions 표시', () => {
  const files = {
    '02': v2('02', [
      {
        facility_id: 'gas_leak_detector',
        facility_name: '가스누설경보기',
        regulations: [row('g1', { any: [{ all: [{ flag: 'gas_facility' }, { flag: 'inpatient_room' }] }, { all: [{ flag: 'window_bars' }, { flag: 'multi_use_business' }] }] })],
      },
    ]),
  };
  const f = facilityOf(run(small(), { dataFiles: files }), '본동', 'gas_leak_detector');
  assert.equal(f.verdict, '확인 필요');
  assert.equal(f.jointQuestions, true);
  assert.deepEqual(qkeys(f).sort(), ['gas_facility@본동', 'inpatient_room@본동', 'multi_use_business@본동', 'window_bars@본동']);
});

test('기준 원문 확인이 필요한 행(needs_review, 조건 없음)은 원문 질문 → 답하면 확정', () => {
  const items = { title: [{ mainPurpsCdNm: '제1종근린생활시설', etcPurps: '소매점', totArea: 100, grndFlrCnt: 1, ugrndFlrCnt: 0 }], floors: [floor('20', 1, '소매점', 100)], permit: [{ archPmsDay: '20150101' }] };
  const f = facilityOf(run(items), '본동', 'emergency_alarm');
  assert.equal(f.verdict, '확인 필요');
  assert.deepEqual(qkeys(f), ['review[t02-ea-03]@본동']);
  assert.equal(f.questions[0].text, '50명 이상의 근로자가 작업하는 옥내 작업장이 있습니까?');
  assert.ok(f.review.some((x) => x.id === 't02-ea-03'));
  assert.equal(facilityOf(run(items, { answers: { 'review[t02-ea-03]@본동': false } }), '본동', 'emergency_alarm').verdict, '비해당');
  assert.equal(facilityOf(run(items, { answers: { 'review[t02-ea-03]@본동': true } }), '본동', 'emergency_alarm').verdict, '해당');
});

test('분기(목욕탕 1,000㎡ / 그 밖 600㎡): 용도 미상이어도 양쪽 결과가 같으면 묻지 않음', () => {
  const at = (area) => {
    const items = { title: [{ mainPurpsCdNm: '제2종근린생활시설', totArea: area, grndFlrCnt: 1, ugrndFlrCnt: 0 }], floors: [floor('20', 1, '', area, '제2종근린생활시설')], permit: [{ archPmsDay: '20150101' }] };
    return facilityOf(run(items), '본동', 'auto_fire_detection');
  };
  assert.equal(at(450).verdict, '비해당');
  assert.equal(at(1200).verdict, '해당');
  const mid = at(800);
  assert.equal(mid.verdict, '확인 필요');
  assert.deepEqual(qkeys(mid), ['use_presence[{"floors":null,"use":["bathhouse"]}]@본동']);
});

// ───── 개정 경계(허가 신청일) ─────

const apt = (floors, permit) => ({
  title: [{ dongNm: '101동', mainPurpsCdNm: '공동주택', etcPurps: '아파트', totArea: floors * 500, grndFlrCnt: floors, ugrndFlrCnt: 0, hhldCnt: floors * 4 }],
  permit: [{ archPmsDay: permit, archGbCdNm: '신축' }],
});

test('경계: 기존 행의 종료(end_date+1)와 새 행 시작이 신청 구간 안이고 결과가 갈리면 확인 필요', () => {
  const f = facilityOf(run(apt(8, '20180302')), '101동', 'sprinkler');
  assert.equal(f.verdict, '확인 필요');
  assert.deepEqual(qkeys(f), ['application_date']);
  assert.deepEqual(f.boundary.points, ['20180127']);
  assert.deepEqual(f.boundary.epochs.map((e) => e.value), ['F', 'T']);
});

test('경계: 구간 안에 개정이 있어도 결과가 같으면 묻지 않음 (12층은 전후 모두 해당)', () => {
  const f = facilityOf(run(apt(12, '20180302')), '101동', 'sprinkler');
  assert.equal(f.verdict, '해당');
  assert.equal(f.boundary, null);
});

test('경계: 신청 구간 정책 0일이면 허가일로만 판정', () => {
  const f = facilityOf(run(apt(8, '20180302'), { policy: { applicationWindowDays: 0 } }), '101동', 'sprinkler');
  assert.equal(f.verdict, '해당');
});

test('기준일로 행을 고른다 — 2010년 허가 12층은 11층 기준, 2003년 허가는 기준 없음(비해당)', () => {
  assert.equal(facilityOf(run(apt(12, '20100101')), '101동', 'sprinkler').verdict, '해당');
  const old = facilityOf(run(apt(12, '20030101')), '101동', 'sprinkler');
  assert.equal(old.verdict, '비해당');
  assert.match(old.reason, /유효한 설치 기준 없음/);
});

test('기준일 결정: 신청일 답변 · 정책(신청일로 행 선택 안 함) · 허가일 후보 여럿 · 날짜 없음', () => {
  const pol = resolvePolicy();
  const dates = { permit: { value: '20180302', source: 'permit_api', status: 'confirmed', candidates: ['20180302'] }, approval: { value: '20190101' } };
  assert.equal(resolveDateInfo(dates, { application_date: '2018-01-15' }, pol, TODAY).refDate, '20180115');
  const noSel = resolveDateInfo(dates, { application_date: '20180115' }, resolvePolicy({ applicationDateSelectsRows: false }), TODAY);
  assert.deepEqual([noSel.refDate, noSel.window], ['20180302', null]);
  const multi = resolveDateInfo({ permit: { value: '20150101', status: 'assumed', candidates: ['20150101', '20190505'] } }, {}, pol, TODAY);
  assert.deepEqual([multi.window.from, multi.window.to, multi.window.question], ['20140705', '20190505', 'permit_date']);
  const none = resolveDateInfo({}, {}, pol, TODAY);
  assert.deepEqual([none.refDate, none.source, none.status, none.window.question], [TODAY, 'today', 'assumed', 'permit_date']);
});

// ───── 복합건축물 ─────

test('복합건축물 확인 불필요 정책이면 30번 기준을 가정으로 적용(가정 표시)', () => {
  const r = evaluate(FX['mixed-use-candidate'].input, { policy: { mixedUseRequiresConfirmation: false } });
  const sp = facilityOf(r, '본동', 'sprinkler');
  assert.equal(sp.verdict, '해당');
  assert.ok(sp.assumptions.some((a) => a.startsWith('복합건축물')));
  assert.deepEqual(sp.files.map((x) => [x.type_code, x.value]), [['02', 'F'], ['12', 'F'], ['30', 'T']]);
});

// ───── v1 대체 ─────

test('데이터 파일이 없으면 missing, v1 이면 v1 — 호출자가 기존 판정으로 대체', () => {
  const missing = run(small(), { dataFiles: {} });
  assert.equal(missing.status, 'v1');
  assert.deepEqual(missing.notEvaluated, [{ dong: '본동', type_code: '02', status: 'missing', message: '데이터 파일 없음' }]);
  const v1 = run(small(), { dataFiles: { '02': { building_type: '근린생활시설', fire_facilities: [] } } });
  assert.equal(v1.status, 'v1');
  assert.equal(v1.notEvaluated[0].message, 'v1 — v2 엔진 미평가');
  assert.deepEqual(v1.facilities, []);
});

test('필요한 데이터 파일 목록 (동별 용도 + 복합건축물 후보의 30번 + 연결 가능 대지면 합친 동의 용도군)', () => {
  const b = normalizeRegistry(FX['site-3dong-parking'].input.registry, { useIndex: INDEX });
  assert.deepEqual(requiredTypeCodes(b), ['01', '02', '18']);
  // 용도 어휘를 넘기면 대지 전체(합친 동)가 복합건축물 후보라 30번도 필요
  assert.deepEqual(requiredTypeCodes(b, { useIndex: INDEX }), ['01', '02', '18', '30']);
  const m = normalizeRegistry(FX['mixed-use-candidate'].input.registry, { useIndex: INDEX });
  assert.deepEqual(requiredTypeCodes(m), ['02', '12', '30']);
});

// ───── 면제·소급·의존 ─────

test('면제는 배지만: 해당은 그대로, exempt_if 가 F 면 배지 없음', () => {
  const r = evaluate(FX['nc-6f-boundary-2018'].input, { answers: { application_date: '20230101' } });
  const ssp = facilityOf(r, '본동', 'simple_sprinkler');
  assert.equal(ssp.verdict, '해당');
  assert.equal(ssp.exemption.possible, true);
  const ea = facilityOf(r, '본동', 'emergency_alarm');
  assert.equal(ea.verdict, '해당');
  assert.equal(ea.exemption.possible, true, '자동화재탐지설비 해당 → 면제 가능 배지');
  const small450 = evaluate(FX['nc-3f-450'].input, { answers: { application_date: '20230101' } });
  assert.equal(facilityOf(small450, '본동', 'emergency_alarm').exemption, null, '자동화재탐지설비 비해당 → exempt_if F');
});

test('소급 행(retroactive): 시행 전 허가 건물에도 적용, 기한 표시', () => {
  const r = run(small('20100101'), { answers: { 'installed[co2_extinguishing]@본동': true } });
  const re = facilityOf(r, '본동', 'rescue_equipment');
  assert.equal(re.verdict, '해당');
  assert.deepEqual(re.retroactive, [{ id: 't02-re-01', basis: 'retroactive', criteria: re.retroactive[0].criteria, deadline: '20130205' }]);
});

test('제13조 강화기준 소급(strengthened_retroactive): apply 는 판정 반영, badge 는 표시만, off 는 무시', () => {
  const base = FIXTURE_SET.dataFiles['02'];
  const files = { '02': { ...base, strengthened_retroactive: ['standalone_detector'] } };
  const items = {
    title: [{ mainPurpsCdNm: '제1종근린생활시설', etcPurps: '소매점', totArea: 380, grndFlrCnt: 2, ugrndFlrCnt: 1 }],
    floors: [floor('10', 1, '주차장', 180), floor('20', 1, '소매점', 100), floor('20', 2, '소매점', 100)],
    permit: [{ archPmsDay: '20150101' }],
  };
  const apply = facilityOf(run(items, { dataFiles: files }), '본동', 'standalone_detector');
  assert.equal(apply.verdict, '해당');
  assert.equal(apply.retroactive[0].basis, 'strengthened');
  const badge = facilityOf(run(items, { dataFiles: files, policy: { strengthenedRetroactive: 'badge' } }), '본동', 'standalone_detector');
  assert.equal(badge.verdict, '비해당');
  assert.equal(badge.retroactive[0].basis, 'strengthened');
  const off = facilityOf(run(items, { dataFiles: files, policy: { strengthenedRetroactive: 'off' } }), '본동', 'standalone_detector');
  assert.deepEqual([off.verdict, off.retroactive], ['비해당', []]);
});

test('타 시설 판정 의존: 시각경보기는 자동화재탐지설비를 따른다 (U 도 전파)', () => {
  const r = evaluate(FX['manual-area-floors'].input);
  const afd = facilityOf(r, '직접입력', 'auto_fire_detection');
  const va = facilityOf(r, '직접입력', 'visual_alarm');
  assert.equal(va.verdict, afd.verdict);
  assert.deepEqual(qkeys(va), qkeys(afd));
});

test('실행 중 순환 의존은 F 가 아니라 U — 순환에 걸린 시설의 원문 확인 질문으로 풀 수 있다', () => {
  const files = {
    '02': v2('02', [
      { facility_id: 'visual_alarm', facility_name: '시각경보기', regulations: [row('a', { facility: 'auto_fire_detection' })] },
      { facility_id: 'auto_fire_detection', facility_name: '자동화재탐지설비', regulations: [row('b', { facility: 'visual_alarm' })] },
    ]),
  };
  const r = run(small(), { dataFiles: files });
  const key = 'review[facility:visual_alarm]@본동';
  for (const fid of ['visual_alarm', 'auto_fire_detection']) {
    const f = facilityOf(r, '본동', fid);
    assert.deepEqual([f.verdict, qkeys(f)], ['확인 필요', [key]], fid);
    assert.match(f.questions[0].text, /시각경보기 설치 대상입니까\? \(설치 기준이 다른 시설의 판정과 서로를 참조/);
  }
  for (const [answer, verdict] of [[true, '해당'], [false, '비해당']]) {
    const done = run(small(), { dataFiles: files, answers: { [key]: answer } });
    for (const fid of ['visual_alarm', 'auto_fire_detection']) assert.equal(facilityOf(done, '본동', fid).verdict, verdict, `${fid} ${answer}`);
  }
});

// ───── 출력 호환 ─────

test('v1 호환 결과: facilities[].required·regulations·allRegulations·reason, permitDate, summary', () => {
  const r = evaluate(FX['nc-3f-450'].input);
  assert.equal(r.permitDate, '20150610');
  assert.equal(r.usedApprovalDate, false);
  assert.equal(r.buildingType, '근린생활시설');
  assert.deepEqual(r.summary, { totalArea: 450, groundFloors: 3, undergroundFloors: 0, height: 11.5 });
  const sp = r.facilities.find((f) => f.id === 'sprinkler');
  assert.equal(sp.name, '스프링클러설비');
  assert.equal(sp.category, '소화설비');
  assert.equal(sp.required, false);
  assert.deepEqual(sp.regulations.map((x) => x.criteria), [
    '조산원·산후조리원의 바닥면적 합계가 600㎡ 이상인 것은 모든 층',
    '지하층·무창층·4층 이상인 층이 바닥면적 1,000㎡ 이상인 층이 있는 경우 해당 층',
  ]);
  assert.equal(sp.allRegulations.length, 4);
  assert.equal(typeof sp.reason, 'string');
  const re = r.facilities.find((f) => f.id === 'rescue_equipment');
  assert.equal(re.required, true, '확인 필요는 기존 화면에서 비해당으로 보이지 않게 required=true');
  assert.deepEqual(r.counts, { applicable: 4, check: 1, notApplicable: 8 });
  assert.ok(r.engine.version && r.engine.policy.applicationWindowDays === 180);
});

test('여러 동 결합: 시설별로 가장 강한 판정 — 근거·범위·질문·가정은 모두 그 한 동에서(서로 어긋나지 않게), 동별 내역', () => {
  const r = evaluate(FX['site-3dong-parking'].input, { answers: { site_connected: false } });
  const ea = r.facilities.find((f) => f.id === 'emergency_alarm');
  assert.equal(ea.verdict, '해당');
  assert.deepEqual(ea.dongs, { 상가동: '해당' });
  const sp = r.facilities.find((f) => f.id === 'sprinkler');
  assert.deepEqual(sp.dongs, { '101동': '해당', '102동': '해당', 상가동: '비해당' });
  assert.equal(sp.verdict, '해당');
  assert.equal(sp.dong, '101동');
  const from = facilityOf(r, '101동', 'sprinkler');
  for (const k of Object.keys(from)) if (!['regulations', 'allRegulations'].includes(k)) assert.deepEqual(sp[k], from[k], k);
  // v1 모달용 규정 행은 동들의 합집합
  for (const row of facilityOf(r, '상가동', 'sprinkler').allRegulations) assert.ok(sp.allRegulations.includes(row));
  // 판정이 U 인 동이 가장 강하면 그 동의 질문을 그대로 (다른 동의 F 근거와 섞지 않음)
  const open = evaluate(FX['site-3dong-parking'].input);
  const ih = open.facilities.find((f) => f.id === 'indoor_hydrant');
  assert.deepEqual([ih.verdict, ih.dong, ih.questions.map((q) => q.key)], ['확인 필요', '상가동', ['site_connected']]);
});

test('연결 가능 대지(M7a, CP1 Q11 검수 전): 동별로 비해당이어도 합치면 해당이면 확인 필요(site_connected) — 답하면 합친 판정 또는 동별 판정', () => {
  const fx = FX['site-3dong-parking'];
  const open = evaluate(fx.input);
  assert.deepEqual([open.site.id, open.site.members, open.site.connected], ['대지 전체', ['101동', '102동', '상가동', '지하주차장'], null]);
  const sp = facilityOf(open, '상가동', 'sprinkler');
  assert.equal(sp.verdict, '확인 필요');
  assert.deepEqual(qkeys(sp), ['site_connected']);
  assert.equal(sp.siteLink.mergedVerdict, '해당');
  assert.match(sp.reason, /연결 여부 확인 필요/);
  assert.equal(open.questions[0].key, 'site_connected');
  // 동별로 이미 해당인 시설은 그대로
  assert.equal(facilityOf(open, '상가동', 'emergency_alarm').siteLink, undefined);
  const yes = facilityOf(evaluate(fx.input, { answers: { site_connected: true } }), '상가동', 'sprinkler');
  assert.deepEqual([yes.verdict, yes.siteLink.merged], ['해당', true]);
  const no = facilityOf(evaluate(fx.input, { answers: { site_connected: false } }), '상가동', 'sprinkler');
  assert.deepEqual([no.verdict, no.siteLink], ['비해당', undefined]);
  // 지하층만 있는 동·주차 전용 동이 없는 건물은 연결 질문 없음
  assert.equal(evaluate(FX['nc-3f-450'].input).site, null);
});

test('일부 파일만 v2 인 동(M7b): v2 파일 기준으로 비해당이어도 v1 파일 기준이 빠졌으므로 비해당으로 확정하지 않는다', () => {
  const files = { ...FIXTURE_SET.dataFiles, 12: { building_type: '업무시설', fire_facilities: [] } };
  const r = evaluate(FX['mixed-use-candidate'].input, { set: { ...FIXTURE_SET, dataFiles: files } });
  const d = r.dongs.find((x) => x.id === '본동');
  assert.equal(d.status, 'partial');
  assert.deepEqual(r.notEvaluated.map((x) => [x.dong, x.type_code, x.status]), [['본동', '12', 'v1']]);
  assert.ok(d.facilities.length > 0);
  for (const f of d.facilities) {
    assert.notEqual(f.verdict, '비해당', f.id);
    assert.deepEqual(f.pendingV1, ['12']);
  }
  const downgraded = d.facilities.filter((f) => /12번 기준 파일이 v1/.test(f.reason));
  assert.ok(downgraded.length > 0);
  assert.ok(downgraded.every((f) => f.verdict === '확인 필요' && f.required));
});

test('판정 행(trigger)이 없는 시설(안내·수정 행만)은 비해당이 아니라 원문 확인 질문 — 답하면 확정', () => {
  for (const regulation of [
    { id: 'i1', start_date: null, end_date: null, criteria: '피난구유도등 설치(NFPC 303)', kind: 'info' },
    { id: 'm1', start_date: null, end_date: null, criteria: '부속 보일러실 포함', kind: 'modifier', conditions: { const: true }, scope: 'all_floors' },
  ]) {
    const files = { '02': v2('02', [{ facility_id: 'guide_light', facility_name: '유도등', regulations: [regulation] }]) };
    const f = facilityOf(run(small(), { dataFiles: files }), '본동', 'guide_light');
    assert.equal(f.verdict, '확인 필요', regulation.kind);
    assert.deepEqual(qkeys(f), ['review[facility:guide_light]@본동']);
    const key = 'review[facility:guide_light]@본동';
    assert.equal(facilityOf(run(small(), { dataFiles: files, answers: { [key]: true } }), '본동', 'guide_light').verdict, '해당');
    assert.equal(facilityOf(run(small(), { dataFiles: files, answers: { [key]: false } }), '본동', 'guide_light').verdict, '비해당');
  }
});
