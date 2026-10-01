// js/lib/law-versions.js 의 허가 신청일 경계 함수 시험 (시험용 데이터만 사용 — 저장소 데이터와 무관)
// 실행: node --test scripts/test/law-versions.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  APPLICATION_WINDOW_DAYS, addDays, findCriteriaBoundaries
} from '../../js/lib/law-versions.js';

// 공동주택 스프링클러: 11층(~2018.1.26.) → 6층(2018.1.27.~), 상시 적용 행 하나
const housing = {
  fire_facilities: [
    {
      facility_name: '스프링클러설비', facility_id: 'sprinkler',
      regulations: [
        { start_date: '20050101', end_date: '20180126', criteria: '층수가 11층 이상일 경우 전층' },
        { start_date: '20180127', end_date: null, criteria: '층수가 6층 이상인 경우 모든 층', note: '대통령령 제27810호 부칙 제1조 단서' },
        { start_date: null, end_date: null, criteria: '기숙사 연면적 5,000㎡ 이상' }
      ]
    },
    {
      facility_name: '소화기구', facility_id: 'fire_extinguisher',
      regulations: [{ start_date: null, end_date: null, criteria: '연면적 33㎡ 이상' }]
    }
  ]
};

// 근린생활시설: 2024.12.31. 개정 — 간이스프링클러는 행 교체, 방염은 새 행만
const neighborhood = {
  fire_facilities: [
    {
      facility_name: '간이스프링클러설비', facility_id: 'simple_sprinkler',
      regulations: [
        { start_date: '20190806', end_date: '20241230', criteria: '의원·치과의원·한의원으로서 입원실이 있는 시설' },
        { start_date: '20241231', end_date: null, criteria: '의원·치과의원·한의원으로서 입원실 또는 인공신장실이 있는 시설' }
      ]
    },
    {
      facility_name: '방염', facility_id: 'flame_retardant',
      regulations: [{ start_date: '20241231', end_date: null, criteria: '의원·치과의원·한의원, 체력단련장, 공연장, 종교집회장' }]
    }
  ]
};

test('addDays 는 월·연 경계를 넘는다', () => {
  assert.equal(addDays('20180126', 1), '20180127');
  assert.equal(addDays('20241231', 1), '20250101');
  assert.equal(addDays('20240301', -1), '20240229');
  assert.equal(APPLICATION_WINDOW_DAYS, 180);
});

test('6층 스프링클러: 허가일 2018.3.2.이면 2018.1.27. 경계에서 11층 → 6층', () => {
  const b = findCriteriaBoundaries(housing, '20180302');
  assert.equal(b.length, 1);
  assert.equal(b[0].date, '20180127');
  assert.deepEqual(b[0].facilities, [{
    name: '스프링클러설비', facilityId: 'sprinkler',
    before: ['층수가 11층 이상일 경우 전층'],
    after: ['층수가 6층 이상인 경우 모든 층'],
    notes: ['대통령령 제27810호 부칙 제1조 단서']
  }]);
});

test('경계가 허가일 당일이면 포함하고, 허가일 뒤면 뺀다', () => {
  assert.equal(findCriteriaBoundaries(housing, '20180127')[0]?.date, '20180127');
  assert.deepEqual(findCriteriaBoundaries(housing, '20180126'), []);
});

test('기간 끝: 경계가 허가일 전 180일째보다 이르면 뺀다', () => {
  // 2018.1.27.부터 180일째 = 2018.7.26. → (허가일 − 180일, 허가일] 이므로 7.25.까지는 포함, 7.26.부터는 빠진다
  assert.equal(findCriteriaBoundaries(housing, '20180725').length, 1);
  assert.equal(findCriteriaBoundaries(housing, '20180726').length, 0);
  assert.equal(findCriteriaBoundaries(housing, '20180301', 30).length, 0);
});

test('35151호(2024.12.31.): 행 교체와 새 행만 있는 시설을 함께 찾는다', () => {
  const b = findCriteriaBoundaries(neighborhood, '20250301');
  assert.equal(b.length, 1);
  assert.equal(b[0].date, '20241231');
  const byName = Object.fromEntries(b[0].facilities.map((f) => [f.name, f]));
  assert.deepEqual(byName['간이스프링클러설비'].before, ['의원·치과의원·한의원으로서 입원실이 있는 시설']);
  assert.deepEqual(byName['간이스프링클러설비'].after, ['의원·치과의원·한의원으로서 입원실 또는 인공신장실이 있는 시설']);
  assert.deepEqual(byName['방염'].before, []);
  assert.equal(byName['방염'].after.length, 1);
});

test('경계 없음·잘못된 입력은 빈 목록', () => {
  assert.deepEqual(findCriteriaBoundaries(housing, '20200101'), []);
  assert.deepEqual(findCriteriaBoundaries(housing, ''), []);
  assert.deepEqual(findCriteriaBoundaries(null, '20180302'), []);
  assert.deepEqual(findCriteriaBoundaries({ fire_facilities: [] }, '20180302'), []);
});

test('여러 경계는 날짜 순으로', () => {
  const data = {
    fire_facilities: [
      { facility_name: 'A', regulations: [{ start_date: '20240101', end_date: null, criteria: 'a' }] },
      { facility_name: 'B', regulations: [{ start_date: null, end_date: '20231130', criteria: 'b' }] }
    ]
  };
  const b = findCriteriaBoundaries(data, '20240201');
  assert.deepEqual(b.map((x) => x.date), ['20231201', '20240101']);
  assert.deepEqual(b[0].facilities[0].before, ['b']);
  assert.deepEqual(b[0].facilities[0].after, []);
});
