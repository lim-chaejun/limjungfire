// 특정소방대상물 용도(소방시설 기준 데이터 파일) 정의와 건축물대장 주용도 매핑
// - type 은 data/NN_*.json 의 building_type 과 같아야 한다.
// - 목록에 없는 주용도는 null 을 돌려준다(부분 문자열로 추측 매핑하지 않음).
// DOM에 의존하지 않으므로 브라우저와 node:test 양쪽에서 사용 가능.

export const FIRE_DATA_TYPES = [
  { type: '단독주택', file: '00_house', display: '단독주택' },
  { type: '공동주택', file: '01_residential_complex', display: '공동주택' },
  { type: '근린생활시설', file: '02_neighborhood_facilities', display: '근린생활시설' },
  { type: '문화및집회시설', file: '03_cultural_assembly', display: '문화 및 집회시설' },
  { type: '종교시설', file: '04_religious', display: '종교시설' },
  { type: '판매시설', file: '05_retail', display: '판매시설' },
  { type: '운수시설', file: '06_transportation', display: '운수시설' },
  { type: '의료시설', file: '07_medical', display: '의료시설' },
  { type: '교육연구시설', file: '08_education_research', display: '교육연구시설' },
  { type: '노유자시설', file: '09_elderly_childcare', display: '노유자시설' },
  { type: '수련시설', file: '10_training', display: '수련시설' },
  { type: '운동시설', file: '11_sports', display: '운동시설' },
  { type: '업무시설', file: '12_office', display: '업무시설' },
  { type: '숙박시설', file: '13_accommodation', display: '숙박시설' },
  { type: '위락시설', file: '14_entertainment', display: '위락시설' },
  { type: '공장', file: '15_factory', display: '공장' },
  { type: '창고시설', file: '16_warehouse', display: '창고시설' },
  { type: '위험물저장및처리시설', file: '17_hazardous_materials', display: '위험물 저장 및 처리 시설' },
  { type: '항공기및자동차관련시설', file: '18_aviation_automotive', display: '항공기 및 자동차 관련 시설' },
  { type: '동물및식물관련시설', file: '19_animal_plant', display: '동물 및 식물 관련 시설' },
  { type: '자원순환관련시설', file: '20_resource_recycling', display: '자원순환 관련 시설' },
  { type: '교정및군사시설', file: '21_correctional_military', display: '교정 및 군사시설' },
  { type: '방송통신시설', file: '22_broadcasting', display: '방송통신시설' },
  { type: '발전시설', file: '23_power_generation', display: '발전시설' },
  { type: '묘지관련시설', file: '24_cemetery', display: '묘지 관련 시설' },
  { type: '관광휴게시설', file: '25_tourism_leisure', display: '관광 휴게시설' },
  { type: '장례시설', file: '26_funeral', display: '장례시설' },
  { type: '지하상가·터널', file: '27_underground_mall', display: '지하상가·터널' },
  { type: '지하구', file: '28_underground_passage', display: '지하구' },
  { type: '국가유산', file: '29_national_heritage', display: '국가유산' },
  { type: '복합건축물', file: '30_mixed_use', display: '복합건축물' }
];

const BY_TYPE = new Map(FIRE_DATA_TYPES.map((t) => [t.type, t]));

// 건축물대장 주용도명(공백 제거) → 소방 데이터 용도
const PURPOSE_ALIASES = {
  // 주택
  '아파트': '공동주택', '연립주택': '공동주택', '다세대주택': '공동주택', '기숙사': '공동주택',
  '공동주택(아파트)': '공동주택',
  '다중주택': '단독주택', '다가구주택': '단독주택', '공관': '단독주택',
  // 근린생활시설
  '제1종근린생활시설': '근린생활시설', '제2종근린생활시설': '근린생활시설',
  // 문화·집회
  '공연장': '문화및집회시설', '집회장': '문화및집회시설', '관람장': '문화및집회시설', '전시장': '문화및집회시설',
  // 판매·운수
  '도매시장': '판매시설', '소매시장': '판매시설', '상점': '판매시설',
  '여객자동차터미널': '운수시설', '철도역사': '운수시설', '공항시설': '운수시설', '항만시설': '운수시설',
  // 의료·장례 (장례식장은 2012년부터 의료시설이 아닌 장례시설)
  '병원': '의료시설', '격리병원': '의료시설',
  '장례식장': '장례시설',
  // 교육·노유자·수련·운동
  '학교': '교육연구시설', '학원': '교육연구시설', '도서관': '교육연구시설', '연구소': '교육연구시설',
  '아동관련시설': '노유자시설', '노인복지시설': '노유자시설', '어린이집': '노유자시설',
  '유스호스텔': '수련시설', '청소년수련관': '수련시설',
  '체육관': '운동시설', '수영장': '운동시설', '볼링장': '운동시설',
  // 업무·숙박·위락
  '오피스텔': '업무시설', '사무소': '업무시설',
  '일반숙박시설': '숙박시설', '관광숙박시설': '숙박시설', '호텔': '숙박시설', '모텔': '숙박시설', '여관': '숙박시설',
  '유흥주점': '위락시설', '단란주점': '위락시설',
  // 산업
  '창고': '창고시설', '물류창고': '창고시설',
  '주유소': '위험물저장및처리시설', '석유판매소': '위험물저장및처리시설', '가스충전소': '위험물저장및처리시설',
  '자동차관련시설': '항공기및자동차관련시설', '주차장': '항공기및자동차관련시설', '세차장': '항공기및자동차관련시설',
  '정비공장': '항공기및자동차관련시설',
  '축사': '동물및식물관련시설', '온실': '동물및식물관련시설',
  '분뇨.쓰레기처리시설': '자원순환관련시설', '분뇨및쓰레기처리시설': '자원순환관련시설',
  '분뇨처리시설': '자원순환관련시설', '폐기물처리시설': '자원순환관련시설',
  // 기타
  '방송국': '방송통신시설', '통신시설': '방송통신시설',
  '납골당': '묘지관련시설', '봉안당': '묘지관련시설', '화장시설': '묘지관련시설',
  '야외음악당': '관광휴게시설', '야외극장': '관광휴게시설', '휴게소': '관광휴게시설',
  '지하상가': '지하상가·터널', '터널': '지하상가·터널', '지하상가터널': '지하상가·터널',
  '문화재': '국가유산'
};

export function normalizePurpose(value) {
  return String(value || '').replace(/\s+/g, '');
}

// 주용도 → 소방 데이터 용도 (없으면 null)
export function mapPurposeToFireType(mainPurpose) {
  const key = normalizePurpose(mainPurpose);
  if (!key) return null;
  if (BY_TYPE.has(key)) return key;
  return PURPOSE_ALIASES[key] || null;
}

// 소방 데이터 용도 → 데이터 파일명 (확장자 제외)
export function getFireDataFile(type) {
  return BY_TYPE.get(type)?.file || null;
}

// 화면 표시용 분류 { class, category } — category는 원래 주용도가 분류명과 다를 때만
export function classifyPurpose(mainPurpose) {
  if (!normalizePurpose(mainPurpose)) return null;
  const type = mapPurposeToFireType(mainPurpose);
  if (!type) return { class: '미분류', category: String(mainPurpose).trim() };
  const display = BY_TYPE.get(type).display;
  const original = String(mainPurpose).trim();
  return { class: display, category: normalizePurpose(original) === type ? '일반' : original };
}
