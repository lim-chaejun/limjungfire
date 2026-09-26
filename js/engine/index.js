// 판정 엔진 v2 공개 API — 브라우저(type="module")와 Node(node:test) 공용 순수 ES 모듈
// 데이터(용도 어휘·입력 정의·카테고리 파일 등)는 호출자가 불러와 넘긴다. 엔진은 fetch·파일 접근을 하지 않는다.
//
// 기본 흐름
//   const building = normalizeRegistry({ title, floors, recap, permit }, { vocabulary });   // 또는 normalizeManual(manualInput, …)
//   const codes = requiredTypeCodes(building);                                            // 불러올 data/NN_*.json
//   const result = evaluateBuilding({ building, dataFiles, vocabulary, inputs, facilities, exemptions, answers, today });
//   result.status === 'v2' 가 아니면 notEvaluated 에 적힌 파일은 기존(v1) 판정으로 대체한다.

export { SCHEMA_VERSION, NODE_TYPES, COMPARISON_OPS, WORDING_TO_OP, ROW_KINDS, SCOPE_TYPES, FLOOR_KINDS } from './schema.js';
export { T, F, U, CONFIRMED, ASSUMED, UNKNOWN, tv, all, any, not, ite, interval, exact, compareInterval, depKey, makeDep, mergeDeps } from './logic.js';
export { POLICY_OPTIONS, DEFAULT_POLICY, resolvePolicy } from './policy.js';
export { buildUseIndex, classifyUses, coverage } from './uses.js';
export { normalizeRegistry, normalizeManual, effectiveFloors } from './facts.js';
export { makeEnv, evalCondition } from './conditions.js';
export { inputDefsFrom, buildQuestion } from './questions.js';
export { VERDICT, evaluateRow, evaluateDong, classifyFile } from './evaluate.js';
export { ENGINE_VERSION, evaluateBuilding, resolveDateInfo, requiredTypeCodes, facilityNames } from './building.js';
export {
  ERROR_CODES, WARNING_CODES, makeValidationContext, validateConditions, validateRow, validateFile, checkItemKeyOverlaps,
  findFacilityCycles, lintRow, compareV1Fields,
} from './validate.js';
