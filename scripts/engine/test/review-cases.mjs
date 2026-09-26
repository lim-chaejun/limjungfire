// 독립 리뷰(REQUEST CHANGES)의 재현 사례 — 회귀 시험(review-regressions.test.mjs)과 성질 시험(property.test.mjs)이 함께 쓴다.
// 사례마다 건물 입력·데이터(TEST-ONLY)·정책·답변만 담고, 기대 결과는 회귀 시험에 둔다.
import { FIXTURE_SET } from './helpers.mjs';

export const v2 = (code, facilities) => ({ schema_version: 2, type_code: code, review: { status: 'draft', by: null, date: null }, fire_facilities: facilities });
export const row = (id, conditions, extra = {}) => ({ id, start_date: null, end_date: null, criteria: id, kind: 'trigger', conditions, scope: 'all_floors', ...extra });

const DATA = FIXTURE_SET.dataFiles;
const nc1 = (no, area, etc = '소매점', gb = '20') => ({ flrGbCd: gb, flrNo: no, mainPurpsCdNm: '제1종근린생활시설', etcPurps: etc, area });
const nc2 = (no, etc, area, gb = '20') => ({ flrGbCd: gb, flrNo: no, mainPurpsCdNm: '제2종근린생활시설', etcPurps: etc, area });
const permit = (day, kind = '신축') => ({ archPmsDay: day, archGbCdNm: kind });

// 제연설비형 규칙: 지하층·무창층의 근린생활시설 바닥면적 합계 1,000㎡ 이상 (무창층 두 개가 함께여야 넘는다)
const SMOKE_JOINT = { '02': v2('02', [{ facility_id: 'smoke_control', facility_name: '제연설비', category: '소화활동설비', regulations: [row('smoke-1', { sum_area: { floors: ['basement', 'windowless'], use: ['02'] }, gte: 1000 })] }]) };
const TWO_FLOOR_RETAIL = {
  title: [{ mainPurpsCdNm: '제1종근린생활시설', etcPurps: '소매점', totArea: 1200, grndFlrCnt: 2, ugrndFlrCnt: 0 }],
  floors: [nc1(1, 600), nc1(2, 600)],
  permit: [permit('20150101')],
};
const SINGING_BASEMENT_USE = { '02': v2('02', [{ facility_id: 'smoke_control', facility_name: '제연설비', regulations: [row('u1', { use: ['singing_room'], floors: ['basement'] })] }]) };
const SINGING_BASEMENT_EXISTS = { '02': v2('02', [{ facility_id: 'smoke_control', facility_name: '제연설비', regulations: [row('u2', { floor_exists: { floors: ['basement'], use: ['singing_room'] } })] }]) };
const BASEMENT_UNKNOWN = {
  title: [{ mainPurpsCdNm: '제2종근린생활시설', etcPurps: '일반음식점, 노래연습장', totArea: 900, grndFlrCnt: 2, ugrndFlrCnt: '' }],
  floors: [nc2(1, '일반음식점', 300), nc2(2, '일반음식점', 300)],
  permit: [permit('20150101')],
};
const ROW_HOUSE = (extra = {}) => ({ title: [{ dongNm: 'A동', mainPurpsCdNm: '공동주택', etcPurps: '연립주택', totArea: 1200, grndFlrCnt: 4, ugrndFlrCnt: 0, hhldCnt: 16, ...extra }] });
const APT8 = (permits) => ({ title: [{ dongNm: 'A동', mainPurpsCdNm: '공동주택', etcPurps: '아파트', totArea: 4000, grndFlrCnt: 8, ugrndFlrCnt: 0, hhldCnt: 32 }], permit: permits });
// 개정 경계(2026.03.01)를 사이에 둔 두 기준: 옛 기준은 지하층 포함 7개층, 새 기준은 지상 11층
const STANDPIPE_BOUNDARY = { '02': v2('02', [{ facility_id: 'standpipe', facility_name: '연결송수관설비', regulations: [
  { id: 'old', start_date: null, end_date: '20260228', criteria: '지하층 포함 7개층 이상', kind: 'trigger', conditions: { m: 'floors_incl_basement', gte: 7 }, scope: 'all_floors' },
  { id: 'new', start_date: '20260301', end_date: null, criteria: '층수 11층 이상', kind: 'trigger', conditions: { m: 'ground_floors', gte: 11 }, scope: 'all_floors' },
] }]) };

export const CASES = [
  { id: 'ce1-joint-assumed', title: 'H1 무창층 가정값 두 개에 함께 기대는 F', input: { registry: TWO_FLOOR_RETAIL }, dataFiles: SMOKE_JOINT, policy: { windowless: 'assume_none' } },
  { id: 'ce1-joint-unknown', title: 'H1 같은 건물, 무창층 정책 기본(모름)', input: { registry: TWO_FLOOR_RETAIL }, dataFiles: SMOKE_JOINT },
  {
    id: 'ce1b-confirmed-not',
    title: 'H1 대조군: 확정 면적의 not(floor_exists) 는 정당한 비해당',
    input: { registry: TWO_FLOOR_RETAIL },
    dataFiles: { '02': v2('02', [{ facility_id: 'smoke_control', facility_name: '제연설비', regulations: [
      row('x', { all: [{ m: 'total_area', gte: 33 }, { not: { floor_exists: { floors: [{ kind: 'ground', level: { gte: 1 } }], area: { gte: 500 } } } }] }),
    ] }]) },
  },
  { id: 'ce2a-use-floors', title: 'H2 use+floors, 지하층수 빈칸', input: { registry: BASEMENT_UNKNOWN }, dataFiles: SINGING_BASEMENT_USE },
  {
    id: 'ce2b-use-floors-no-counts',
    title: 'H2 use+floors, 층수·층별개요 모두 없음',
    input: { registry: { title: [{ mainPurpsCdNm: '제2종근린생활시설', etcPurps: '노래연습장', totArea: 500 }], permit: [permit('20150101')] } },
    dataFiles: SINGING_BASEMENT_USE,
  },
  { id: 'ce2c-floor-exists', title: 'H2 대조군: 같은 기준을 floor_exists 로', input: { registry: BASEMENT_UNKNOWN }, dataFiles: SINGING_BASEMENT_EXISTS },
  { id: 'ce3-no-dates', title: 'H3 허가일·사용승인일 없음(오늘 가정)', input: { registry: ROW_HOUSE() }, dataFiles: { '01': DATA['01'] } },
  {
    id: 'ce3b-manual-default-permit',
    title: 'H3 수동 입력, 허가일 빈칸(화면 기본값 오늘)',
    input: { manual: { mainPurpsCdNm: '공동주택', mainPurpose: '연립주택', totArea: 1200, grndFlrCnt: 4, ugrndFlrCnt: 0, pmsDay: '20260926', permitDateIsDefault: true, enteredFields: ['ugrndFlrCnt'] } },
    dataFiles: { '01': DATA['01'] },
  },
  { id: 'ce3c-extension-permit', title: 'H4 신축 1995 + 증축 2023', input: { registry: { ...ROW_HOUSE(), permit: [permit('19950301'), permit('20230301', '증축')] } }, dataFiles: { '01': DATA['01'] } },
  { id: 'ce4-apt-extension', title: 'H4 아파트 8층, 신축 2010 + 증축 2021', input: { registry: APT8([permit('20100301'), permit('20210301', '증축')]) }, dataFiles: { '01': DATA['01'] } },
  {
    id: 'ce5a-title-vs-items-ground',
    title: 'M1 표제부 지상 5층 ↔ 층별개요 6층',
    input: { registry: { title: [{ mainPurpsCdNm: '제1종근린생활시설', etcPurps: '소매점', totArea: 1800, grndFlrCnt: 5, ugrndFlrCnt: 0 }], floors: [1, 2, 3, 4, 5, 6].map((n) => nc1(n, 300)), permit: [permit('20200101')] } },
    dataFiles: { '02': DATA['02'] },
  },
  {
    id: 'ce5b-title-vs-items-basement',
    title: 'M1 표제부 지하 2층 ↔ 층별개요 지하 3층',
    input: { registry: { title: [{ mainPurpsCdNm: '제1종근린생활시설', etcPurps: '소매점', totArea: 1500, grndFlrCnt: 2, ugrndFlrCnt: 2 }], floors: [nc1(3, 300, '소매점', '10'), nc1(2, 300, '소매점', '10'), nc1(1, 300, '소매점', '10'), nc1(1, 300), nc1(2, 300)], permit: [permit('20200101')] } },
    dataFiles: { '02': DATA['02'] },
  },
  {
    id: 'ce5c-total-missing-5f',
    title: 'M2 연면적 없음, 층별개요가 5개 층 중 2개만',
    input: { registry: { title: [{ mainPurpsCdNm: '제1종근린생활시설', etcPurps: '소매점', grndFlrCnt: 5, ugrndFlrCnt: 0 }], floors: [nc1(1, 500), nc1(2, 500)], permit: [permit('20200101')] } },
    dataFiles: { '02': DATA['02'] },
  },
  {
    id: 'ce6-total-missing-9f',
    title: 'M2 연면적 없음, 층별개요가 9개 층 중 2개만',
    input: { registry: { title: [{ mainPurpsCdNm: '제1종근린생활시설', etcPurps: '소매점', grndFlrCnt: 9, ugrndFlrCnt: 0 }], floors: [nc1(1, 500), nc1(2, 500)], permit: [permit('20200101')] } },
    dataFiles: { '02': DATA['02'] },
  },
  {
    id: 'ce7-multipart',
    title: 'M6 한 층이 두 행, 한 행 면적 빈칸',
    input: { registry: { title: [{ mainPurpsCdNm: '제2종근린생활시설', etcPurps: '소매점, 노래연습장', totArea: 600, grndFlrCnt: 1, ugrndFlrCnt: 0 }], floors: [nc2(1, '소매점', 300), nc2(1, '노래연습장', '')], permit: [permit('20150101')] } },
    dataFiles: { '02': v2('02', [{ facility_id: 'smoke_control', facility_name: '제연설비', regulations: [row('k', { sum_area: { use: ['singing_room'] }, gte: 150 })] }]) },
  },
  {
    id: 'ce8-date-x-assumed',
    title: 'H1 신청일(개정 경계) × 수동 입력 지하층 가정값',
    input: { manual: { mainPurpsCdNm: '제2종근린생활시설', totArea: 3000, grndFlrCnt: 5, ugrndFlrCnt: 0, pmsDay: '20260415' } },
    dataFiles: STANDPIPE_BOUNDARY,
  },
  {
    id: 'ce9-parking-building',
    title: 'M5 주차 전용 건축물의 주차장 = 주차용 건축물',
    input: { registry: { title: [{ dongNm: '주차타워', mainPurpsCdNm: '자동차관련시설', etcPurps: '주차장', totArea: 2400, grndFlrCnt: 4, ugrndFlrCnt: 0 }], permit: [permit('20150101')] } },
    dataFiles: { '18': v2('18', [{ facility_id: 'water_spray', facility_name: '물분무등소화설비', regulations: [row('p', { all: [{ use: ['parking_structure'] }, { m: 'total_area', gte: 800 }] })] }]) },
  },
  {
    id: 'ce11-eq-grid',
    title: 'M3 폭 1짜리 기준(지하층 포함 정확히 7개층)과 지하층 가정값',
    input: { manual: { mainPurpsCdNm: '제2종근린생활시설', totArea: 900, grndFlrCnt: 2, ugrndFlrCnt: 0, pmsDay: '20240101' } },
    dataFiles: { '02': v2('02', [{ facility_id: 'standpipe', facility_name: '연결송수관설비', regulations: [row('b', { m: 'floors_incl_basement', eq: 7 })] }]) },
  },
  {
    id: 'golden06-released-basement',
    title: '정책 manualBlankBasement=unknown 인 수동 입력(골든 06 과 같은 건물)',
    input: { manual: { mainPurpsCdNm: '제2종근린생활시설', totArea: 800, grndFlrCnt: 2, ugrndFlrCnt: 0, pmsDay: '20240101' } },
    dataFiles: { '02': DATA['02'] },
    policy: { manualBlankBasement: 'unknown' },
  },
  {
    id: 'count-from-items-only',
    title: '표제부 층수 빈칸 — 층별개요 최고층(5층)은 하한일 뿐',
    input: { registry: { title: [{ mainPurpsCdNm: '제1종근린생활시설', etcPurps: '소매점', totArea: 6000, grndFlrCnt: '', ugrndFlrCnt: 0 }], floors: [1, 2, 3, 4, 5].map((n) => nc1(n, 400)), permit: [permit('20200101')] } },
    dataFiles: { '02': DATA['02'] },
  },
];

export const caseById = (id) => {
  const c = CASES.find((x) => x.id === id);
  if (!c) throw new Error(`사례 없음: ${id}`);
  return c;
};
