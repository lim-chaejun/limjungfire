// 생성기 설정 — 사이트 구조에 묶인 고정값. 자주 바뀌는 값(데이터 기준일 등)은 content/config.json 에 둔다.

/** 이 행 수 미만인 기준 페이지는 noindex + 사이트맵 제외 (얇은 페이지 방지) */
export const MIN_INDEXABLE_ROWS = 2;

/** 용도 페이지 '최근 개정·변경' 에 보여줄 최대 건수 */
export const RECENT_EVENTS_USE = 8;
/** 시설 페이지 '기준 변경 이력' 최대 건수 */
export const HISTORY_EVENTS_FACILITY = 20;
/** 시설 페이지 화재안전기준 개정 이력 최대 건수 */
export const NFSC_REVISIONS_SHOWN = 5;
/** 허브 페이지 '최근 법령 개정' 최대 건수 */
export const HUB_LAW_EVENTS = 10;

/** 시설 분류 표시 순서 (facilities.json 의 category) */
export const CATEGORY_ORDER = ['소화설비', '경보설비', '피난구조설비', '소화활동설비', '건축', '기타'];

/**
 * 손으로 쓴 시설 가이드(guide/<slug>.html) 와 시설 id 연결.
 * 파일이 실제로 있는지는 테스트(standards.test.mjs)가 확인한다.
 */
export const GUIDE_BY_FACILITY = {
  fire_extinguisher: 'fire-extinguisher',
  auto_extinguisher: 'auto-extinguisher',
  indoor_hydrant: 'indoor-hydrant',
  sprinkler: 'sprinkler',
  auto_fire_detection: 'fire-detector',
  emergency_alarm: 'emergency-alarm',
  emergency_broadcast: 'emergency-broadcast',
  evacuation_equipment: 'escape-equipment',
  guide_light: 'exit-sign',
  emergency_light: 'emergency-light',
};

/**
 * 조회 화면 '건축물대장 없이 직접 입력하기' 의 용도 선택지 중, 그 용도 데이터 파일로 바로 이어지는 것.
 * (index.html 의 #manualPurpose 선택지 값 → js/main.js mapPurposeToFireDataType 결과가 이 building_type)
 * 여기 없는 용도는 안내 문구를 넣지 않는다. 드리프트는 standards.test.mjs 가 잡는다.
 */
export const MANUAL_PURPOSE_BY_TYPE = {
  공동주택: ['공동주택'],
  근린생활시설: ['제1종근린생활시설', '제2종근린생활시설'],
  문화및집회시설: ['문화및집회시설'],
  종교시설: ['종교시설'],
  판매시설: ['판매시설'],
  운수시설: ['운수시설'],
  의료시설: ['의료시설'],
  교육연구시설: ['교육연구시설'],
  노유자시설: ['노유자시설'],
  운동시설: ['운동시설'],
  업무시설: ['업무시설'],
  숙박시설: ['숙박시설'],
  위락시설: ['위락시설'],
  공장: ['공장'],
  창고시설: ['창고시설'],
  위험물저장및처리시설: ['위험물저장및처리시설'],
  항공기및자동차관련시설: ['자동차관련시설'],
  방송통신시설: ['방송통신시설'],
};

/** 생성 파일을 두는 폴더 — 표시(GENERATED_MARKER)가 있는 파일만 관리한다 */
export const MANAGED_DIRS = ['standards', 'news', 'qa', 'guide'];


/** 글 유형 */
export const POST_TYPES = {
  news: {
    dir: 'news',
    label: '법령 개정 소식',
    indexPath: '/news/',
    indexFile: 'news/index.html',
    indexTitle: '법령 개정 소식',
    indexDescription: '소방시설 설치기준과 화재안전기준(NFPC·NFSC) 개정 소식을 법령 원문 링크와 함께 정리합니다.',
    schemaType: 'NewsArticle',
  },
  guide: {
    dir: 'guide',
    label: '실무 가이드',
    indexPath: '/guide/articles',
    indexFile: 'guide/articles.html',
    indexTitle: '실무 가이드',
    indexDescription: '소방시설 설치기준을 실무에서 확인하고 적용하는 방법을 법령 원문 근거와 함께 설명합니다.',
    schemaType: 'Article',
  },
  qa: {
    dir: 'qa',
    label: '질문·사례',
    indexPath: '/qa/',
    indexFile: 'qa/index.html',
    indexTitle: '질문·사례',
    indexDescription: '소방시설 설치기준에 관한 자주 묻는 질문과 사례를 법령 원문 근거와 함께 답합니다.',
    schemaType: 'Article',
  },
};

/** 글 슬러그로 쓸 수 없는 이름 (색인·피드 파일과 충돌) */
export const RESERVED_SLUGS = new Set(['index', 'feed', 'articles']);
