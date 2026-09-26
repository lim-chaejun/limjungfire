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
const SINGING_150 = { '02': v2('02', [{ facility_id: 'smoke_control', facility_name: '제연설비', regulations: [row('k', { sum_area: { use: ['singing_room'] }, gte: 150 })] }]) };
// N1: 층별개요 400 + 400 = 800 < 연면적 1,000 (200㎡ 는 어느 층인지 모름)
const N1_BUILDING = { title: [{ mainPurpsCdNm: '제2종근린생활시설', etcPurps: '소매점', totArea: 1000, grndFlrCnt: 2, ugrndFlrCnt: 0 }], floors: [nc2(1, '소매점', 400), nc2(2, '소매점', 400)], permit: [permit('20150101')] };
const windowlessSum = (cmp) => ({ '02': v2('02', [{ facility_id: 'x', facility_name: 'X', regulations: [row('w', { sum_area: { floors: ['windowless'] }, ...cmp })] }]) });
// N2: 지하층수 빈칸(층 목록 불완전), 표제부 소매점·노래연습장, 1층 행은 용도 미상
const N2_BUILDING = { title: [{ mainPurpsCdNm: '제2종근린생활시설', etcPurps: '소매점, 노래연습장', totArea: 600, grndFlrCnt: 1, ugrndFlrCnt: '' }], floors: [nc2(1, '', 600)], permit: [permit('20150101')] };
// 연결 가능 대지: 상가동(2층, 층별개요 없음 — 층 면적 미상) + 지하층만 있는 주차장동
const SITE_TWO_DONGS = {
  title: [
    { dongNm: '상가동', mainPurpsCdNm: '제1종근린생활시설', etcPurps: '소매점', totArea: 1600, grndFlrCnt: 2, ugrndFlrCnt: 0 },
    { dongNm: '주차장동', mainPurpsCdNm: '자동차관련시설', etcPurps: '지하주차장', totArea: 900, grndFlrCnt: 0, ugrndFlrCnt: 1 },
  ],
  floors: [{ dongNm: '주차장동', flrGbCd: '10', flrNo: 1, mainPurpsCdNm: '자동차관련시설', etcPurps: '지하주차장', area: 900 }],
  permit: [permit('20150101')],
};
// 3차 리뷰 MEDIUM: 연면적 1,000, 지상 3층 중 1층(400)만 층별개요 — 2층·3층 면적이 면적 항등식으로 묶임
const COUPLED = { title: [{ mainPurpsCdNm: '제2종근린생활시설', etcPurps: '소매점', totArea: 1000, grndFlrCnt: 3, ugrndFlrCnt: 0 }], floors: [nc2(1, '소매점', 400)], permit: [permit('20150101')] };
// 3차 리뷰: 상가동(1층 900 + 2층 100) + 주차 전용 주차타워(1층 900) — 연결되면 대지 전체로 평가
const RV3_SITE = {
  title: [
    { dongNm: '상가동', mainPurpsCdNm: '제1종근린생활시설', etcPurps: '소매점', totArea: 1000, grndFlrCnt: 2, ugrndFlrCnt: 0 },
    { dongNm: '주차타워', mainPurpsCdNm: '자동차관련시설', etcPurps: '주차장', totArea: 900, grndFlrCnt: 1, ugrndFlrCnt: 0 },
  ],
  floors: [
    { dongNm: '상가동', flrGbCd: '20', flrNo: 1, mainPurpsCdNm: '제1종근린생활시설', etcPurps: '소매점', area: 900 },
    { dongNm: '상가동', flrGbCd: '20', flrNo: 2, mainPurpsCdNm: '제1종근린생활시설', etcPurps: '소매점', area: 100 },
    { dongNm: '주차타워', flrGbCd: '20', flrNo: 1, mainPurpsCdNm: '자동차관련시설', etcPurps: '주차장', area: 900 },
  ],
  permit: [permit('20150101')],
};
const rv3Data = (excluded) => ({
  '02': v2('02', [{ facility_id: 'x', facility_name: 'X', regulations: [row('big', { m: 'total_area', gte: 1500 })], excluded_if: excluded }]),
  '18': v2('18', []),
  '30': v2('30', []),
});
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
    title: 'M6 한 층이 두 행, 한 행 면적 빈칸 (층이 하나뿐이라 면적 항등식으로 정해짐)',
    input: { registry: { title: [{ mainPurpsCdNm: '제2종근린생활시설', etcPurps: '소매점, 노래연습장', totArea: 600, grndFlrCnt: 1, ugrndFlrCnt: 0 }], floors: [nc2(1, '소매점', 300), nc2(1, '노래연습장', '')], permit: [permit('20150101')] } },
    dataFiles: SINGING_150,
  },
  {
    id: 'ce7b-multipart-open',
    title: 'M6 같은 층 구성 + 면적 미상인 2층(소매점) — 빈 행 면적은 부분 질문',
    input: { registry: { title: [{ mainPurpsCdNm: '제2종근린생활시설', etcPurps: '소매점, 노래연습장', totArea: 900, grndFlrCnt: 2, ugrndFlrCnt: 0 }], floors: [nc2(1, '소매점', 300), nc2(1, '노래연습장', ''), nc2(2, '소매점', '')], permit: [permit('20150101')] } },
    dataFiles: SINGING_150,
  },
  // ── 2차 리뷰: 단조성(재평가의 전제)을 깨던 세 단계 ──
  { id: 'n1-lt', title: 'N1 층별개요 400+400 < 연면적 1,000, 무창층 바닥면적 합계 150㎡ 미만', input: { registry: N1_BUILDING }, dataFiles: windowlessSum({ lt: 150 }) },
  {
    id: 'n1-excluded',
    title: 'N1 같은 건물, 제외 조건 무창층 합계 150㎡ 이상',
    input: { registry: N1_BUILDING },
    dataFiles: { '02': v2('02', [{ facility_id: 'x', facility_name: 'X', regulations: [row('c', { const: true })], excluded_if: { sum_area: { floors: ['windowless'] }, gte: 150 } }]) },
  },
  { id: 'n1-gte', title: 'N1 같은 건물, 무창층 합계 150㎡ 이상(잘못된 해당 방향)', input: { registry: N1_BUILDING }, dataFiles: windowlessSum({ gte: 150 }) },
  {
    id: 'n2-excluded-use',
    title: 'N2 지하층수 빈칸, 표제부 소매점·노래연습장, 제외 조건 노래연습장',
    input: { registry: N2_BUILDING },
    dataFiles: { '02': v2('02', [{ facility_id: 'x', facility_name: 'X', regulations: [row('c', { m: 'total_area', gte: 33 })], excluded_if: { use: ['singing_room'] } }]) },
  },
  {
    id: 'n2-not-use',
    title: 'N2 같은 건물, all(연면적 300 이상, not 노래연습장)',
    input: { registry: N2_BUILDING },
    dataFiles: { '02': v2('02', [{ facility_id: 'x', facility_name: 'X', regulations: [row('n', { all: [{ m: 'total_area', gte: 300 }, { not: { use: ['singing_room'] } }] })] }]) },
  },
  {
    id: 'n2p-synth-floor',
    title: "N2′ 보충한 2층(표제부 소매점·노래연습장), 제외 조건 '2층 이상 노래연습장'",
    input: {
      registry: {
        title: [{ mainPurpsCdNm: '제2종근린생활시설', etcPurps: '소매점, 노래연습장', totArea: 800, grndFlrCnt: 2, ugrndFlrCnt: 0 }],
        floors: [nc2(1, '노래연습장', 400)],
        permit: [permit('20150101')],
      },
    },
    dataFiles: { '02': v2('02', [{ facility_id: 'x', facility_name: 'X', regulations: [row('c', { m: 'total_area', gte: 33 })], excluded_if: { use: ['singing_room'], floors: [{ kind: 'ground', level: { gte: 2 } }] } }]) },
  },
  {
    id: 'floor-use-area',
    title: '2차 MEDIUM: 1층 600㎡ 용도 미상, 지상층 중 노래연습장 300㎡ 이상인 층 — floor_use_area 질문에 답할 수 있어야',
    input: { registry: { title: [{ mainPurpsCdNm: '제2종근린생활시설', etcPurps: '노래연습장', totArea: 600, grndFlrCnt: 1, ugrndFlrCnt: 0 }], floors: [nc2(1, '', 600)], permit: [permit('20150101')] } },
    dataFiles: { '02': v2('02', [{ facility_id: 'smoke_control', facility_name: '제연설비', regulations: [row('fe', { floor_exists: { floors: 'ground', area: { gte: 300 }, use: ['singing_room'] } })] }]) },
  },
  {
    id: 'site-stuck',
    title: '2차 MEDIUM: 상가동 2층(층 면적 미상) + 주차장동 — 동 이름 키의 면적 답이 대지 전체 판정에도 반영',
    input: { registry: SITE_TWO_DONGS },
    dataFiles: {
      '02': v2('02', [{ facility_id: 'sprinkler', facility_name: '스프링클러설비', regulations: [row('fe', { floor_exists: { floors: 'ground', area: { gte: 1000 } } }, { scope: 'matching_floors' })] }]),
      '18': v2('18', [{ facility_id: 'sprinkler', facility_name: '스프링클러설비', regulations: [row('p', { m: 'total_area', gte: 99999 })] }]),
      '30': v2('30', [{ facility_id: 'sprinkler', facility_name: '스프링클러설비', regulations: [row('q', { m: 'total_area', gte: 99999 })] }]),
    },
  },
  {
    id: 'site-member-question',
    title: '2차 MEDIUM: 합친 동에서만 미상인 사실(주차장동 지하1층 면적)은 그 동 이름 키로 묻고, 답하면 합친 판정이 정해진다',
    input: {
      registry: {
        title: [
          { dongNm: '상가동', mainPurpsCdNm: '제1종근린생활시설', etcPurps: '소매점', totArea: 400, grndFlrCnt: 2, ugrndFlrCnt: 0 },
          { dongNm: '주차장동', mainPurpsCdNm: '자동차관련시설', etcPurps: '지하주차장', totArea: 1500, grndFlrCnt: 0, ugrndFlrCnt: 2 },
        ],
        floors: [],
        permit: [permit('20150101')],
      },
    },
    dataFiles: {
      '02': v2('02', [{ facility_id: 'wireless_comm', facility_name: '무선통신보조설비', regulations: [row('w', { floor_exists: { floors: 'basement', area: { gte: 1000 } } })] }]),
      '18': v2('18', [{ facility_id: 'wireless_comm', facility_name: '무선통신보조설비', regulations: [row('p', { m: 'total_area', gte: 99999 })] }]),
      '30': v2('30', [{ facility_id: 'wireless_comm', facility_name: '무선통신보조설비', regulations: [row('q', { m: 'total_area', gte: 99999 })] }]),
    },
  },
  {
    id: 'q33-long-list',
    title: '2차 MEDIUM: 수동 입력 30층+지하3층 33,000㎡, 허가 2018.3.2 — 층마다 "결정적"인 면적 질문이 32개',
    input: { manual: { mainPurpsCdNm: '제2종근린생활시설', totArea: 33000, grndFlrCnt: 30, ugrndFlrCnt: 3, pmsDay: '20180302' } },
    dataFiles: { '02': DATA['02'] },
  },
  {
    id: 'cross-file-cycle',
    title: '2차 LOW: 02 파일 시각경보기 → 자동화재탐지설비, 30 파일 자동화재탐지설비 → 시각경보기 — 복합건축물이면 순환',
    input: {
      registry: {
        title: [{ mainPurpsCdNm: '제1종근린생활시설', etcPurps: '소매점, 업무시설', totArea: 500, grndFlrCnt: 2, ugrndFlrCnt: 0 }],
        floors: [nc1(1, 250), { flrGbCd: '20', flrNo: 2, mainPurpsCdNm: '업무시설', etcPurps: '사무소', area: 250 }],
        permit: [permit('20150101')],
      },
    },
    dataFiles: {
      '02': v2('02', [
        { facility_id: 'visual_alarm', facility_name: '시각경보기', regulations: [row('a', { facility: 'auto_fire_detection' })] },
        { facility_id: 'auto_fire_detection', facility_name: '자동화재탐지설비', regulations: [row('b', { m: 'total_area', gte: 99999 })] },
      ]),
      '12': v2('12', [{ facility_id: 'fire_extinguisher', facility_name: '소화기구', regulations: [row('e', { m: 'total_area', gte: 33 })] }]),
      '30': v2('30', [{ facility_id: 'auto_fire_detection', facility_name: '자동화재탐지설비', regulations: [row('c', { facility: 'visual_alarm' })] }]),
    },
  },
  // ── 3차 리뷰: 합친 동의 부정 조건(제외 조건) ──
  { id: 'rv3-flow', title: '3차 HIGH: 제외 조건 "무창층 바닥면적 합계 1,000㎡ 이상" — 상가동 1층만 무창층(900㎡)', input: { registry: RV3_SITE }, dataFiles: rv3Data({ sum_area: { floors: ['windowless'] }, gte: 1000 }) },
  { id: 'rv3-s1b', title: '3차 HIGH: 제외 조건 "무창층으로서 바닥면적 1,000㎡ 이상인 층"', input: { registry: RV3_SITE }, dataFiles: rv3Data({ floor_exists: { floors: ['windowless'], area: { gte: 1000 } } }) },
  { id: 'rv3-s2', title: '3차 HIGH: 제외 조건 "불연재료·내화구조"(전칭) — 주차타워만 불연', input: { registry: RV3_SITE }, dataFiles: rv3Data({ flag: 'noncombustible_structure' }) },
  {
    id: 'rv3-combined-floor',
    title: '3차: 층별 면적 기준 "1층 바닥면적 1,500㎡ 이상인 층" — 동별 층(900·900)과 합친 1층(1,800)이 갈림',
    input: { registry: RV3_SITE },
    dataFiles: {
      '02': v2('02', [{ facility_id: 'x', facility_name: 'X', regulations: [row('f', { floor_exists: { floors: [{ kind: 'ground', level: { lte: 1 } }], area: { gte: 1500 } } })] }]),
      '18': v2('18', []),
      '30': v2('30', []),
    },
  },
  {
    id: 'coupled-areas',
    title: '3차 MEDIUM: 연면적 1,000, 지상 3층 중 1층(400)만 층별개요 — 2층·3층 면적은 서로 묶임, 제외 조건 "2층 이상 500㎡ 이상인 층"',
    input: { registry: COUPLED },
    dataFiles: { '02': v2('02', [{ facility_id: 'x', facility_name: 'X', regulations: [row('c', { m: 'total_area', gte: 33 })], excluded_if: { floor_exists: { floors: [{ kind: 'ground', level: { gte: 2 } }], area: { gte: 500 } } } }]) },
  },
  {
    id: 'coupled-areas-2f',
    title: '3차 MEDIUM: 같은 건물, 제외 조건 "2층 바닥면적 500㎡ 이상"',
    input: { registry: COUPLED },
    dataFiles: { '02': v2('02', [{ facility_id: 'x', facility_name: 'X', regulations: [row('c', { m: 'total_area', gte: 33 })], excluded_if: { floor_exists: { floors: [{ kind: 'ground', level: { gte: 2, lte: 2 } }], area: { gte: 500 } } } }]) },
  },
  {
    id: 'rounds-total-range',
    title: '3차 fz_rounds: 연면적 빈칸, 지상 3층 중 1층 600·3층 100 — 연면적 질문 범위는 [700, ∞), 2층을 답하면 연면적이 정해진다',
    input: { registry: { title: [{ mainPurpsCdNm: '제2종근린생활시설', etcPurps: '소매점', totArea: '', grndFlrCnt: 3, ugrndFlrCnt: 0 }], floors: [nc2(1, '소매점', 600), nc2(3, '소매점', 100)], permit: [permit('20150101')] } },
    dataFiles: { '02': v2('02', [{ facility_id: 'x', facility_name: 'X', regulations: [row('t', { m: 'total_area', gte: 1000 })] }]) },
  },
  {
    id: 'rounds-part-range',
    title: '3차 fz_rounds: 연면적 1,200, 1층 600, 지하1층 = 주차장 100 + 노래연습장(빈칸), 2층 없음 — 빈 부분의 질문 범위는 층 범위 − 다른 부분',
    input: { registry: { title: [{ mainPurpsCdNm: '제2종근린생활시설', etcPurps: '소매점', totArea: 1200, grndFlrCnt: 2, ugrndFlrCnt: 1 }], floors: [nc2(1, '소매점', 600), nc2(1, '주차장', 100, '10'), nc2(1, '노래연습장', '', '10')], permit: [permit('20150101')] } },
    dataFiles: { '02': v2('02', [{ facility_id: 'x', facility_name: 'X', regulations: [row('s', { floor_exists: { floors: [{ use: ['singing_room'] }], area: { gte: 308 } } })] }]) },
  },
  {
    id: 'rounds-count-range',
    title: '3차 fz_rounds: 직접 입력 연면적 1,600, 지상 1층, 지하층수 빈칸(모름) — 1층 800 을 답하면 지하층수는 1 이상이어야 한다',
    input: { manual: { mainPurpsCdNm: '제2종근린생활시설', totArea: 1600, grndFlrCnt: 1, ugrndFlrCnt: '', pmsDay: '20150601' } },
    policy: { manualBlankBasement: 'unknown' },
    dataFiles: { '02': v2('02', [{ facility_id: 'x', facility_name: 'X', regulations: [row('b', { m: 'basement_floors', gte: 2 })] }]) },
  },
  {
    id: 'rounds-count-first',
    title: '3차 fz_rounds: 직접 입력 연면적 900, 지상 1층, 지하층수 빈칸(모름) — 1층 면적보다 지하층수를 먼저 묻는다',
    input: { manual: { mainPurpsCdNm: '제2종근린생활시설', totArea: 900, grndFlrCnt: 1, ugrndFlrCnt: '', pmsDay: '20150601' } },
    policy: { manualBlankBasement: 'unknown' },
    dataFiles: { '02': v2('02', [{ facility_id: 'x', facility_name: 'X', regulations: [row('g', { floor_exists: { floors: 'ground', area: { gte: 500 } } })] }]) },
  },
  {
    id: 'rounds-assumed-count',
    title: '3차 fz_rounds: 직접 입력 연면적 3,000, 지상 1층, 지하층수 빈칸(가정 0) — 가정값을 풀면 1층 면적이 [0, 3,000] 이라도 지하층수부터 묻는다',
    input: { manual: { mainPurpsCdNm: '제2종근린생활시설', totArea: 3000, grndFlrCnt: 1, ugrndFlrCnt: '', pmsDay: '20150601' } },
    policy: { windowless: 'assume_none' },
    dataFiles: { '02': v2('02', [{ facility_id: 'x', facility_name: 'X', regulations: [row('r', { any: [{ floor_exists: { floors: 'windowless' } }, { not: { floor_exists: { floors: 'ground', area: { gte: 403 } } } }] })] }]) },
  },
  {
    id: 'site-shared-group',
    title: '3차 MEDIUM: 상가동(2층, 층 면적 미상) + 주차장동 — 동별 목록은 상가동 2층 면적, 대지 전체 목록은 상가동 1층 면적을 물으려 함(같은 묶음)',
    input: { registry: SITE_TWO_DONGS },
    dataFiles: {
      '02': v2('02', [
        { facility_id: 'a', facility_name: 'A', regulations: [row('a', { all: [{ m: 'total_area', lt: 2000 }, { floor_exists: { floors: [{ kind: 'ground', level: { gte: 2 } }], area: { gte: 1000 } } }] })] },
        { facility_id: 'b', facility_name: 'B', regulations: [row('b', { all: [{ m: 'total_area', gte: 2000 }, { floor_exists: { floors: [{ kind: 'ground', level: { lte: 1 } }], area: { gte: 1200 } } }] })] },
      ]),
      '18': v2('18', []),
      '30': v2('30', []),
    },
  },
  {
    id: 'site-area-mismatch',
    title: '3차 MEDIUM: 상가동(2층, 연면적 1,600, 층 면적 미상) + 주차장동 — "바닥면적 2,000㎡ 이상인 지상층" 은 동별·대지 전체 모두 층 면적(연면적 상한)에 기대는 비해당',
    input: { registry: SITE_TWO_DONGS },
    dataFiles: {
      '02': v2('02', [{ facility_id: 'x', facility_name: 'X', regulations: [row('g', { floor_exists: { floors: 'ground', area: { gte: 2000 } } })] }]),
      '18': v2('18', []),
      '30': v2('30', []),
    },
  },
  {
    id: 'data-over-total',
    title: '층별개요의 3층(400)이 이미 연면적 300 보다 큼 — 대장 자체의 모순이라 면적 항등식을 쓰지 않고, 다른 층 면적 답변은 답변 탓 모순이 아니다',
    input: { registry: { title: [{ mainPurpsCdNm: '제2종근린생활시설', etcPurps: '소매점', totArea: 300, grndFlrCnt: 3, ugrndFlrCnt: 0 }], floors: [nc2(3, '소매점', 400)], permit: [permit('20150101')] } },
    dataFiles: { '02': v2('02', [{ facility_id: 'x', facility_name: 'X', regulations: [row('a', { floor_exists: { floors: [{ kind: 'ground', level: { lte: 2 } }], area: { gte: 250 } } })] }]) },
  },
  {
    id: 'assumed-count-answers',
    title: '직접 입력 연면적 400, 지상 3층, 지하층수 빈칸(가정 0) — 지상층 면적 답의 합(210)이 연면적보다 작음: 가정값과만 어긋남(지하층이 있으면 맞음)',
    input: { manual: { mainPurpsCdNm: '제2종근린생활시설', totArea: 400, grndFlrCnt: 3, ugrndFlrCnt: '', pmsDay: '20150601' } },
    dataFiles: { '02': v2('02', [{ facility_id: 'x', facility_name: 'X', regulations: [row('s', { sum_area: { floors: 'ground' }, gte: 300 })] }]) },
  },
  {
    id: 'rv3-range',
    title: '3차 LOW(rv3_range): 연면적 700, 지하1층 = 소매점 600 + 노래연습장(빈칸) — 빈 부분에 600 을 답하면 층 면적 1,200 > 연면적',
    input: {
      registry: {
        title: [{ mainPurpsCdNm: '제2종근린생활시설', etcPurps: '일반음식점', totArea: 700, grndFlrCnt: 1, ugrndFlrCnt: 1 }],
        floors: [nc2(1, '주차장', 600), nc2(1, '일반음식점', ''), nc2(2, '', 600), nc2(2, '소매점', 400), nc2(1, '소매점', 600, '10'), nc2(1, '노래연습장', '', '10')],
        permit: [permit('20150601')],
      },
    },
    dataFiles: { '02': v2('02', [{ facility_id: 'x', facility_name: 'X', regulations: [row('b', { floor_exists: { floors: 'basement', area: { gte: 1500 } } })] }]) },
  },
  {
    id: 'area-determined',
    title: '1층 600 + 지하1층 400, 연면적 1,200 → 2층 200(항등식), 2층 이상 바닥면적 합계 150㎡ 미만',
    input: { registry: { title: [{ mainPurpsCdNm: '제2종근린생활시설', etcPurps: '소매점', totArea: 1200, grndFlrCnt: 2, ugrndFlrCnt: 1 }], floors: [nc2(1, '소매점', 600), nc2(1, '소매점', 400, '10')], permit: [permit('20150101')] } },
    dataFiles: { '02': v2('02', [{ facility_id: 'x', facility_name: 'X', regulations: [row('s', { sum_area: { floors: [{ kind: 'ground', level: { gte: 2 } }] }, lt: 150 })] }]) },
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
