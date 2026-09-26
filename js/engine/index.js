// 판정 엔진 v2 공개 API — 브라우저(type="module")와 Node(node:test) 공용 순수 ES 모듈
// 데이터(용도 어휘·입력 정의·카테고리 파일 등)는 호출자가 불러와 넘긴다. 엔진은 fetch·파일 접근을 하지 않는다.
//
// 기본 흐름
//   const building = normalizeRegistry({ title, floors, recap, permit }, { vocabulary });   // 또는 normalizeManual(manualInput, …)
//   const codes = requiredTypeCodes(building, { vocabulary });                            // 불러올 data/NN_*.json (대지 연결 후보면 합친 동의 용도군 포함)
//   const result = evaluateBuilding({ building, dataFiles, vocabulary, inputs, facilities, exemptions, answers, today });
//   result.status === 'v2' 가 아니면 notEvaluated 에 적힌 파일은 기존(v1) 판정으로 대체한다.
//   결과의 문자열(시설명·근거·질문·경고)은 데이터 파일·건축물대장 값을 그대로 담은 평문이다 — 화면에 넣을 때 반드시 이스케이프.

export { SCHEMA_VERSION, NODE_TYPES, COMPARISON_OPS, WORDING_TO_OP, ROW_KINDS, SCOPE_TYPES, FLOOR_KINDS } from './schema.js';
export { T, F, U, CONFIRMED, ASSUMED, UNKNOWN, tv, all, any, not, ite, interval, exact, compareInterval, depKey, makeDep, mergeDeps } from './logic.js';
export { POLICY_OPTIONS, DEFAULT_POLICY, resolvePolicy } from './policy.js';
export { buildUseIndex, classifyUses, coverage } from './uses.js';
export { normalizeRegistry, normalizeManual, effectiveFloors, countOf, mergeDongs, siteLinkCandidate, SITE_DONG_ID } from './facts.js';
export { EARLIEST, resolveDateInfo } from './dates.js';
export { makeEnv, evalCondition } from './conditions.js';
export { inputDefsFrom, buildQuestion } from './questions.js';
export { VERDICT, DECISIVE_TEST_BUDGET, evaluateRow, evaluateDong, classifyFile } from './evaluate.js';
export { ENGINE_VERSION, evaluateBuilding, requiredTypeCodes, facilityNames } from './building.js';
export {
  ERROR_CODES, WARNING_CODES, makeValidationContext, validateConditions, validateRow, validateFile, validateFileSet, checkItemKeyOverlaps,
  findFacilityCycles, lintRow, compareV1Fields,
} from './validate.js';
