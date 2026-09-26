# 판정 엔진 v2 — 기반(P0-core)

> 상태: **P0-core** — 엔진 코어·입력/용도 스키마·검증기·테스트 하네스·판정 비교 도구.
> 실제 데이터 변환(P1~P3), 행 id 일괄 부여, `main.js`의 v1/v2 게이트, `scripts/validate-data.mjs` 연결은 이후 단계다.
> 이 문서의 해석 기본값은 모두 **CP1 법령 검수 전 잠정값**이다(§11).

## 1. 왜 v2 인가

현재(v1) 판정(`main.js getRequiredFireFacilities`)의 두 결함을 고친다.

- **B1 규모 미평가** — 허가일에 유효한 규정 행이 하나라도 있으면 '필수'로 표시한다. 1,280행 중 827행이 날짜 없음(항상 유효)이라 거의 모든 시설이 '필수'가 된다. 수동 입력의 연면적·층수도 쓰지 않는다.
- **B2 대지 합산** — 동별이 아니라 대지 전체(연면적 합, 층수 최댓값)로 판정하고, 옥탑을 지상층으로 센다.

v2 의 원칙:

1. **3값 판정** — 해당(T) / 확인 필요(U) / 비해당(F). 모르면 모른다고 한다.
2. **출처(provenance)** — 모든 값은 어떤 입력에 기댔는지, 그 입력이 확정(건축물대장·사용자 답변)인지 가정인지 안다.
3. **비해당은 확정 근거로만** — 가정·미확인 입력에 기대는 F 는 비해당으로 내지 않는다(불변식, §5.4).
4. **결정적 질문만** — 답에 따라 판정이 바뀌는 질문만 묻는다(§5.5).
5. **동별 판정** — 건축물대장 표제부의 동 단위로 판정하고, 대지 전체는 결과를 모아 보여줄 뿐이다.
6. **해석은 이름 있는 정책으로** — 층수 산정·무창층·신청일 경계 등 해석이 갈리는 지점은 코드 상수가 아니라 `policy.js`의 옵션이다(§8).
7. **추가형 스키마** — 기존 v1 필드(`criteria`·`start_date`·`end_date`·`applicable_to`·`note`)는 바꾸지 않고 필드를 더한다. `schema_version: 2`가 아닌 파일은 v2 가 평가하지 않는다(파일 단위 무중단 전환).

## 2. 구성

| 경로 | 역할 |
|---|---|
| `js/engine/index.js` | 공개 API (아래 모듈 재수출) |
| `js/engine/schema.js` | 스키마 상수(노드 종류·연산자·범위·층 선택자), 조건 트리 순회 도구 |
| `js/engine/logic.js` | 3값 논리(all/any/not/ite)·출처(dep)·구간 비교 |
| `js/engine/policy.js` | 해석 정책 옵션·기본값 |
| `js/engine/dates.js` | YYYYMMDD 날짜 도구, 행 유효성 |
| `js/engine/uses.js` | 용도 어휘 색인, 건축물대장 용도 문자열 분류 |
| `js/engine/facts.js` | 건축물대장·수동 입력 → 동별 사실 정규화 |
| `js/engine/conditions.js` | 조건 노드 평가(지표·층·용도·질문 키) |
| `js/engine/questions.js` | 질문 문장·결정적 질문 시험값 |
| `js/engine/evaluate.js` | 행 → 시설 → 동 판정, 개정 경계, 불변식 |
| `js/engine/building.js` | 기준일 결정, 건물 판정, v1 호환 결과 |
| `js/engine/validate.js` | 검증기(오류·경고 코드), v1 필드 불변 비교 |
| `js/engine/format.js` | 수치·구간·층 범위 문장 |
| `data/schema/inputs.json` | 입력 항목 정의(라벨·유형·단위·출처·질문 문장) |
| `data/schema/use_vocabulary.json` | 세부 용도 어휘(ref01 기반) |
| `scripts/engine/verdict-diff.mjs` | 두 데이터 디렉터리의 판정 차이 비교 CLI |
| `scripts/engine/test/` | `node --test` 테스트, TEST-ONLY 픽스처(`fixtures/data`, `fixtures/buildings`) |

엔진 모듈은 **순수 ES 모듈**이다 — Node 내장 모듈·DOM·`fetch`를 쓰지 않고, 데이터는 호출자가 불러와 넘긴다(브라우저 `type="module"`과 `node:test` 공용, 빌드 단계 없음).

## 3. 사용법

```js
import { normalizeRegistry, normalizeManual, requiredTypeCodes, evaluateBuilding } from './engine/index.js';

// 1) 사실 정규화 (표제부·층별개요·총괄표제부·인허가 API 항목 그대로)
const building = normalizeRegistry({ title, floors, recap, permit }, { vocabulary });
//    수동 입력이면: normalizeManual(submitManualInput 의 객체, { vocabulary })

// 2) 필요한 데이터 파일만 불러오기 (예: ['02', '12', '30'])
const codes = requiredTypeCodes(building);

// 3) 판정
const result = evaluateBuilding({ building, dataFiles /* { '02': json, … } */, vocabulary, inputs, facilities, exemptions, answers, today });
// result.status: 'v2' | 'partial' | 'v1' | 'unmapped' — 'v2' 가 아니면 result.notEvaluated 의 파일은 기존 판정으로 대체
```

공개 함수(주요):

| 함수 | 설명 |
|---|---|
| `normalizeRegistry(items, { vocabulary \| useIndex, policy })` | 건축물대장 → `Building` |
| `normalizeManual(input, { vocabulary \| useIndex, policy, dongId })` | 수동 입력 → `Building` |
| `requiredTypeCodes(building)` | 평가에 필요한 파일 번호 |
| `evaluateBuilding({ building, dataFiles, vocabulary \| useIndex, inputs, facilities, exemptions, answers, policy, today })` | 건물 판정(v1 호환 + v2) |
| `resolveDateInfo(dates, answers, policy, today)` | 기준일·경계 검사 구간 |
| `evaluateDong(dong, ctx)` · `evaluateRow(row, env)` · `evalCondition(node, env)` · `makeEnv(...)` | 하위 평가(테스트·도구용) |
| `makeValidationContext({ inputs, vocabulary, facilities })` · `validateFile(file, ctx, { fileName })` · `validateRow` · `validateConditions` · `checkItemKeyOverlaps` · `findFacilityCycles` · `lintRow` · `compareV1Fields(before, after)` | 검증기 |
| `resolvePolicy(overrides)` · `DEFAULT_POLICY` · `POLICY_OPTIONS` | 정책 |
| `buildUseIndex(vocabulary)` · `classifyUses(main, etc, index)` | 용도 분류 |

`answers` 는 질문 키 → 답(참/거짓·수·날짜) 맵이다(§5.5).

## 4. 데이터 스키마 (추가형)

### 4.1 파일

| 필드 | 필수 | 설명 |
|---|---|---|
| `schema_version` | v2 | `2`. 없으면 v1 파일 — v2 엔진은 평가하지 않고 'v1 — v2 엔진 미평가'로 보고 |
| `type_code` | v2 | `'00'`~`'30'` (파일명 앞 번호와 같아야 함) |
| `review` | v2 | `{ status: draft\|reviewed\|approved, by: 문자열\|null, date: YYYYMMDD\|null }` — 법령 검수 상태 |
| `strengthened_retroactive` | 선택 | 제13조 강화기준 소급 대상 `facility_id` 배열(§5.7) |
| `building_type`·`definition`·`note`·`sub_types` | v1 | 그대로 둔다 |

### 4.2 시설

| 필드 | 설명 |
|---|---|
| `facility_id`·`facility_name`·`category`·`note` | v1 그대로 (`facility_id` 는 `data/facilities.json` 에 있어야 함) |
| `excluded_if` | 조건 트리. T 면 이 파일에서 시설 제외(예: '가스시설 제외'), U 면 확인 필요 |

### 4.3 규정 행

| 필드 | 설명 |
|---|---|
| `start_date`·`end_date`·`criteria`·`applicable_to`·`note` | **v1 필드 — 바꾸지 않는다** (`compareV1Fields` 로 검사) |
| `id` | 불변 행 id (파일 안에서 유일). 답변 키(`review[id]`)와 diff 에 쓰인다 |
| `kind` | `trigger`(설치 트리거) · `modifier`(해당일 때 범위를 넓히는 행, 예: '부속된 보일러실·연결통로 포함') · `info`(규격·안내, 판정에 쓰지 않음) |
| `conditions` | 조건 트리(§4.4) |
| `scope` | 적용 범위(§4.6). trigger 행은 필수 |
| `branches` | `[{ when?, conditions, scope? }]` — 앞에서부터 when 이 참인 첫 분기(마지막 분기는 when 생략 = 그 밖). 예: '연면적 600㎡ 이상 *목욕탕은 1,000㎡ 이상' |
| `specs` | 규격·수량 등 자유 객체(출력에 전달) |
| `retroactive` | `{ deadline: YYYYMMDD, grace_until?: YYYYMMDD, note? }` — 시행 전 허가 건물에도 적용(소급)과 기한 |
| `item_key` | 같은 법령 항목의 버전 체인 키 — 같은 키 행들의 유효 기간은 겹치면 안 된다 |
| `needs_review` | `{ reason, question? }` — 검수 필요 표시. 조건이 없는 trigger 행은 원문 질문(`question`)을 묻는 U 가 된다 |
| `inputs_required` | 행이 쓰는 입력 id (있으면 조건이 참조하는 입력을 모두 포함해야 함) |

### 4.4 조건 노드

노드는 아래 종류 키를 **정확히 하나** 가진 객체다.

| 노드 | 형식 | 의미 |
|---|---|---|
| `all` / `any` / `not` | `{ "all": [노드…] }` · `{ "not": 노드 }` | Kleene 3값 논리곱·합·부정 |
| `m` | `{ "m": "total_area", "gte": 600 }` | 동 지표 비교. 연산자 `gte·gt·lte·lt·eq` 를 여럿 쓰면 모두 만족(예: `"gte": 300, "lt": 600`) |
| `sum_area` | `{ "sum_area": { "floors": [선택자…], "use": [용도…] }, "gte": 1000 }` | 선택한 층의 (용도별) 바닥면적 합계 비교. floors 생략 = 모든 층, use 생략 = 용도 무관 |
| `floor_exists` | `{ "floor_exists": { "floors": […], "area": { "gte": 300 }, "use": […] } }` | 조건을 만족하는 층이 하나라도 있는가(해당 층 = 만족한 층) |
| `use` | `{ "use": ["midwifery_clinic", "02"], "floors": […]? }` | 동(또는 선택 층)에 그 용도가 있는가. 세부 용도 id 또는 용도군 코드 |
| `flag` | `{ "flag": "gas_facility" }` | 동 단위 참/거짓 입력(inputs.json, `engine` 아님) |
| `facility` | `{ "facility": "auto_fire_detection" }` | 같은 동의 다른 시설 판정(해당=T, 비해당=F, 확인 필요=U). 순환 금지 |
| `installed` | `{ "installed": "co2_extinguishing" }` | 그 설비가 실제로 설치돼 있는가(사용자 답변) |
| `const` | `{ "const": true }` | 무조건 적용('적용' 행) |

지표(`m`)는 inputs.json 의 동 단위 수치 입력: `total_area`(연면적), `ground_floors`(층수), `basement_floors`(지하층수), `floors_incl_basement`(지하층 포함 층수), `height`, `households`, `occupants`(수용인원), `mechanical_parking_spaces`, `workers_indoor`, `electrical_room_area`, `stage_area`, `special_combustibles_multiple`, `tunnel_length`, `building_area`.

### 4.5 층 선택자

`floors` 는 선택자 목록(합집합)이다. 선택자는 약칭 문자열이거나 필드의 논리곱인 객체다.

- 약칭: `all`(지하층·지상층, 옥탑 제외) · `basement` · `ground` · `rooftop` · `windowless`
- 객체 필드: `kind`(basement·ground·rooftop 또는 배열), `level`(비교 객체 — 지하층은 깊이: 지하3층 = 3), `windowless: true`, `use: [용도…]`
- 예: '지하층·무창층·4층 이상인 층' → `["basement", "windowless", { "kind": "ground", "level": { "gte": 4 } }]`, '지상 1층~2층' → `[{ "kind": "ground", "level": { "gte": 1, "lte": 2 } }]`

### 4.6 적용 범위(scope)

| scope | 의미 | 원문 예 |
|---|---|---|
| `"all_floors"` | 모든 층(지하층·지상층) | '… 모든 층', '전층' |
| `{ "type": "floors", "floors": [선택자…], "label"? }` | 선택자에 해당하는 층 | '11층 이상의 층', '지하 모든 층' |
| `"matching_floors"` | `floor_exists`·`sum_area` 를 만족한 층 | '…인 층이 있는 경우 해당 층' |
| `{ "type": "part", "label": "…" }` | 층이 아닌 부분 | '해당 부분', '무대부' |
| `"inherit"` | modifier 행 — 시설의 범위를 따름 | '부속된 보일러실·연결통로 포함' |

### 4.7 행 예시

```json
{
  "id": "02-sp-04",
  "start_date": "19840701",
  "end_date": null,
  "criteria": "지하층·무창층·4층 이상인 층이 바닥면적 1,000㎡ 이상인 층이 있는 경우 해당 층",
  "applicable_to": "근린생활시설",
  "kind": "trigger",
  "conditions": {
    "floor_exists": { "floors": ["basement", "windowless", { "kind": "ground", "level": { "gte": 4 } }], "area": { "gte": 1000 } }
  },
  "scope": "matching_floors",
  "item_key": "02-sp-floor1000",
  "inputs_required": ["floor_area", "windowless"]
}
```

## 5. 판정 의미론

### 5.1 3값과 출처

값은 `{ v: T|F|U, deps, why }` 다. `deps` 의 각 입력은 상태를 가진다: **confirmed**(건축물대장·사용자 답변) · **assumed**(정책 기본값·대체값, 예: 수동 입력 지하층 빈칸 = 0층 가정) · **unknown**(값 없음 → 질문 후보).

결합은 Kleene 강한 논리다(`all`: F 하나면 F, `any`: T 하나면 T). F(또는 T)가 여럿이면 **가장 확실한 증인 하나만** 근거로 남긴다 — 확정 F 가 하나라도 있으면 `all` 의 F 는 확정이다. `any` 의 F 는 모든 자식의 근거를 합친다. U 의 근거는 U 자식들의 근거(= 질문 후보)다.

### 5.2 구간

수치는 구간 `[lo, hi]` 이고 하한·상한 근거를 따로 가진다. 예: 층 용도가 섞였거나 미상이면 그 층의 대상 용도 면적은 `[0, 층 면적]`. 비교는 상한·하한만으로 결론이 나면 확정한다.

- 연면적 450㎡ 동의 '조산원·산후조리원 바닥면적 합계 600㎡ 이상' → 상한이 연면적(450)이라 **묻지 않고 확정 F**.
- 층 목록이 완전하고 용도 조건이 없으면 '모든 층 바닥면적 합계'는 연면적 − (대상 아닌 층 면적 상한) 이상 — 층별 면적을 몰라도 연면적으로 결론.
- 모든 합계의 상한은 동 연면적으로 제한한다.

### 5.3 행 → 시설 → 동

1. 기준일에 유효한 행을 고른다(+소급 행·강화기준, §5.7).
2. 시설값 = `any(trigger 행)` → `excluded_if` 가 있으면 `all(값, not(제외))`.
3. 한 동에 파일이 여럿이면(복합건축물 후보) 파일별 값의 `any`(가장 강한 결과). 30번(복합건축물) 파일의 값은 `all(복합건축물 여부, 값)` 로 게이트된다 — 사용자가 확인하기 전에는 U.
4. modifier 행은 시설이 해당일 때 범위 확장(`extensions`)으로, info 행은 안내(`info`)로 붙는다.

### 5.4 확정 규칙과 불변식

| 값 | 판정 | 출력 |
|---|---|---|
| T | **해당** | 적용 범위(`scope`), 근거 |
| U | **확인 필요** | 결정적 질문(`questions`) |
| F | **비해당** | 근거(`reasons`) |

**불변식: 가정·미확인 입력에 기대는 F 는 비해당으로 표시하지 않는다.** F 의 근거에 확정이 아닌 입력이 있으면, 그 입력을 다른 값으로 바꿔 다시 판정한다(§5.5 시험값). 결과가 달라지면 **확인 필요**(그 입력이 질문)가 되고, 어떤 값으로도 같으면 결과가 그 입력에 "의존하지 않으므로" 비해당을 유지한다(질문은 결정적인 것만 묻는다는 원칙과 함께 성립시키기 위한 해석). 테스트는 골든 전체에서 "비해당에는 질문이 없고 `required=false`"를 확인한다.

### 5.5 결정적 질문

- U 인 시설: 근거의 미확정 입력마다 시험값을 답으로 넣어 다시 판정해, **그 질문 하나만으로 판정이 바뀌면** 결정적이다. 결정적 질문이 없으면(여러 답이 함께 있어야 풀리는 경우) 관련 질문을 모두 묻고 `jointQuestions: true` 로 표시한다. 답을 받으면 다시 평가해 다음 결정적 질문을 고른다.
- 시험값: 참/거짓은 둘 다, 수치는 조건 트리의 기준값 ±ε(정수 입력은 ±1)과 거친 격자, inputs.json `range` 안, 미확정 구간 안.
- 예: 1·2층 1,050㎡, 3층 500㎡ 근생 — 스프링클러('무창층 1,000㎡ 이상인 층')는 1·2층 무창층만 묻고 3층은 묻지 않는다. 옥내소화전은 연면적 2,600㎡ 로 이미 해당이라 무창층을 묻지 않는다.

질문·답변 키 형식: `입력[세부]@동/층`

| 예 | 뜻 |
|---|---|
| `windowless@본동/2F` | 본동 2층 무창층 여부 |
| `gas_facility@101동` | 101동 가스시설 여부 |
| `use_area[{"floors":"all","use":["midwifery_clinic","postpartum_care"]}]@본동` | 본동 조산원·산후조리원 바닥면적 합계 |
| `use_presence[{"floors":null,"use":["bathhouse"]}]@본동` | 본동 목욕장 용도 여부 |
| `installed[co2_extinguishing]@본동` | 이산화탄소소화설비 설치 여부 |
| `mixed_use@본동` | 복합건축물 해당 여부 |
| `review[행 id]@본동` | 구조화 전 행의 원문 해당 여부 |
| `application_date` · `permit_date` | 허가 신청일 · 허가일(대지 단위) |

층 키는 `B1`(지하1층) · `3F`(3층) · `R1`(옥탑1층). 질문 객체는 `{ key, input, dong, floor, type, unit, label, text, status, range?, note? }` 이고 문장은 inputs.json 의 `question` 틀로 만든다.

### 5.6 기준일과 개정 경계

| 상황 | 기준일(행 선택) | 경계 검사 구간 | 경계에서 결과가 갈리면 묻는 것 |
|---|---|---|---|
| 허가일 있음 | 허가일(확정) | [허가일 − `applicationWindowDays`, 허가일] | 허가 신청일 |
| 허가일 후보 여럿(인허가 여러 건) | 가장 이른 날(가정) | [가장 이른 날 − 구간, 가장 늦은 날] | 허가일 |
| 사용승인일만 | 사용승인일(가정) | [승인일 − (`approvalOnlyLookbackDays` + 신청 구간), 승인일] | 허가일 |
| 날짜 없음 | 오늘(가정) | [오늘 − 신청 구간, 오늘] | 허가일 |
| 신청일 답변 | 신청일(`applicationDateSelectsRows`) | 없음 | — |

**개정 경계 규칙**: 시설(과 그 시설이 의존하는 시설)의 행이 구간 안에서 시작하거나 끝나면(`end_date` 다음 날), 구간 시작과 각 경계일에서 다시 판정해 결과가 하나라도 다르면 **확인 필요**로 두고 허가 **신청일**을 묻는다. 부칙 적용례는 대개 '이 영 시행 후 최초로 건축허가등을 신청(동의 요구)하는 경우부터'라서 허가일만으로 확정할 수 없기 때문이다. 결과가 같으면 묻지 않는다.

예: 근생 6층, 허가 2018.3.2. — 6층 스프링클러 강화(2018.1.27.)가 180일 안: `2017.09.03~ 비해당 → 2018.01.27~ 해당` → 확인 필요(신청일). 신청일 2018.1.15.이면 비해당, 2018.2.1.이면 해당.

### 5.7 소급·강화기준·면제

- `retroactive` 행: 기준일이 행 시작일보다 앞서도(시행 전 허가) 오늘 유효하면 적용하고 `retroactive` 에 기한(`deadline`·`grace_until`)을 싣는다.
- `strengthened_retroactive`(파일): 그 시설은 오늘 유효한 행도 적용(제13조 강화기준 소급). 정책 `strengthenedRetroactive`: `apply`(판정 반영) · `badge`(표시만) · `off`.
- 면제(`exemption_criteria.json`): 판정을 바꾸지 않고 해당·확인 필요 시설에 `exemption: { possible: true, rules }` 배지만 붙인다. 면제 행에 `exempt_if` 조건이 있고 F 면 배지를 붙이지 않는다(P3 에서 `exempt_if` 구조화).

### 5.8 v1 게이트(파일 단위 전환)

동이 필요로 하는 파일마다 상태를 매긴다: `v2`(평가) · `v1`(schema_version 2 아님 → 'v1 — v2 엔진 미평가') · `missing`(데이터 없음). 동 상태는 `v2`·`partial`·`v1`·`missing`·`unmapped`(용도 미분류), 건물 상태(`result.status`)는 `v2`(모든 동 평가) · `partial` · `v1`(평가한 동 없음 → 기존 판정 사용) · `unmapped`. 호출자는 `notEvaluated` 의 파일을 기존(v1) 방식으로 대체한다.

## 6. 사실 정규화

- **동**: 표제부 1건 = 동 1개(`dongNm`, 없으면 '본동'). 층별개요는 `dongNm` 으로 나눈다(표제부가 하나면 전부 그 동). 표제부가 없으면 총괄표제부로 동 하나(`RECAP_ONLY` 경고).
- **층 구분**: `flrGbCd` 10 지하 · 20 지상 · 30 옥탑(없으면 `flrGbCdNm`·`flrNoNm` 으로 추정). 같은 층의 여러 행은 한 층의 부분(part) — 부분마다 용도와 면적.
- **용도 분류**: 주용도명(`mainPurpsCdNm`) → 용도군, 기타용도(`etcPurps`) → 세부 용도. 기타용도에서 세부 용도가 나오면 그것을 믿고(층별개요의 주용도는 분류 코드이기 때문), 없으면 용도군 와일드카드(`{ group: '02' }` — 그 군의 어떤 세부 용도든 가능). 별칭이 여러 군에 있으면(예: 사무소) 층의 주용도 군을 우선한다.
- **층수**: 표제부 `grndFlrCnt`(정책 `groundFloorsFrom`), 층별개요와 다르면 `FLOOR_COUNT_MISMATCH` 표시. 지상 0층은 지하층만 있는 동일 때만 확정 0.
- **빠진 층 보충**: 층수만큼 층을 채우고(층별개요에 없는 층) 면적은 `[0, 연면적]` 미상. 층수를 모르면 층 목록이 불완전 — 층 존재 조건은 F 대신 U.
- **연면적·높이·세대수·승강기**: 표제부 값(0 은 빈 값으로 봄. 단 세대수 0 은 주거 용도가 아닐 때만 확정 0, 승강기는 두 필드가 모두 0 이면 확정 '없음').
- **허가일**: 인허가 API(`archGbCdNm` 신축 우선, 서로 다른 날이 여럿이면 가장 이른 날 = 가정 + 후보 목록 + `MULTIPLE_PERMITS`) → 총괄표제부 `pmsDay` → 표제부 `pmsDay`. 사용승인일: 총괄표제부 → 표제부(가장 이른 날).
- **수동 입력**(`submitManualInput` 객체): 값 > 0 은 사용자 확정, 연면적·층수 0 은 모름, 지하층 0 은 정책 `manualBlankBasement`. 선택 필드 `enteredFields`(사용자가 실제로 입력한 필드명 — 있으면 0 도 확정), `permitDateIsDefault`(허가일 빈칸이라 오늘로 채운 경우 → 허가일 없음으로 처리).

## 7. 결과 형태

`evaluateBuilding` 결과는 v1 모양을 유지한다.

| v1 필드 | v2 에서 |
|---|---|
| `facilities[]` | 동별 판정을 시설별로 모은 목록(가장 강한 판정). 각 항목에 `name`·`category`·`required`·`regulations`(기준일에 선택된 행)·`allRegulations`·`reason` |
| `required` | **해당 또는 확인 필요면 true** — 기존 화면이 확인 필요를 '비해당'으로 보이지 않게(보수적) |
| `permitDate` | 기준일(`dateInfo.refDate`) |
| `usedApprovalDate` | 사용승인일로 판정했는가 |
| `buildingType`·`summary` | 가장 큰 동의 용도군 이름, 동 합계(연면적 합, 층수·지하층수·높이 최댓값) |

v2 필드: `status`, `dateInfo`, `counts`(해당·확인 필요·비해당 수), `dongs[]`(동별 `status`·`groups`·`typeCodes`·`mixedUseCandidate`·`files`·`facilities`·`questions`), `questions`(전체 결정적 질문), `notEvaluated`, `warnings`, `engine`(버전·정책).

시설 항목(v2): `id`·`verdict`('해당'|'확인 필요'|'비해당')·`value`(T/U/F)·`scope`(`{ type, floors, maybeFloors, parts }`)·`possibleScope`·`extensions`·`questions`·`jointQuestions`·`reasons`·`assumptions`·`boundary`·`exemption`·`retroactive`·`review`·`info`·`files`(파일별 값)·`rows`(행별 값·범위·질문 후보·근거)·`dongs`(동별 판정, 결합 목록에서).

## 8. 정책 옵션

| 옵션 | 기본값 | 대안 | 내용 |
|---|---|---|---|
| `groundFloorsFrom` | `'title'` | `'floor_items'` | 층수 출처: 표제부 지상층수(건축법 시행령 제119조①9호로 산정된 값) / 층별개요 지상층 최대 층번호 |
| `rooftopCountsAsFloor` | `false` | `true` | 옥탑을 층수·'N층 이상인 층'·'모든 층'에 넣는가(제119조①9호: 수평투영면적 1/8 이하 옥탑은 층수 제외) |
| `basementCountsInFloors` | `false` | `true` | 층수에 지하층을 넣는가('지하층 포함 N개층'은 별도 지표) |
| `windowless` | `'unknown'` | `'assume_none'` | 무창층 여부 답변 전: 모름(U) / 아니라고 가정(가정 F — 불변식으로 비해당이 되지 않음) |
| `applicationWindowDays` | `180` | 0 이상 정수 | 허가일 전 신청 구간(개정 경계 검사) |
| `applicationDateSelectsRows` | `true` | `false` | 신청일이 답변되면 신청일로 행을 고르는가 |
| `approvalOnlyLookbackDays` | `1095` | 0 이상 정수 | 사용승인일만 있을 때 허가일이 있을 수 있는 기간 |
| `manualBlankBasement` | `'assume_zero'` | `'unknown'` | 수동 입력 지하층 빈칸(0): 0층 가정 / 모름 |
| `mixedUseRequiresConfirmation` | `true` | `false` | 복합건축물 후보의 30번 파일 결과를 사용자 확인 전 U 로 둠 / 가정 적용 |
| `mixedUseIgnoreAncillary` | `true` | `false` | 부수 용도(용도 어휘 `ancillary`, 건축물 내부 주차장 등)를 복합건축물 용도군 수에서 제외 |
| `strengthenedRetroactive` | `'apply'` | `'badge'`·`'off'` | 제13조 강화기준 소급 반영 방식 |

모든 기본값은 "비해당을 잘못 내지 않는" 쪽이다. 모르는 옵션·값은 `resolvePolicy` 가 예외를 던진다.

## 9. 검증기

`validateFile(file, makeValidationContext({ inputs, vocabulary, facilities }), { fileName })` → `{ v1, errors, warnings }`. v1 파일은 `{ v1: true }` 로 건너뛴다. 이후 `scripts/validate-data.mjs`(PR2 데이터 가드)의 검사 목록에 연결한다(계획서 E1~E11·W1~W6).

오류 코드:

| 코드 | 내용 |
|---|---|
| `COND_NOT_NODE` | 종류 키가 0개·2개 이상이거나 객체가 아님 |
| `COND_EXTRA_KEY` | 노드 종류에 허용되지 않는 키 |
| `COND_EMPTY_LIST` | 빈 all·any |
| `COND_BAD_OP` | 비교 연산자 없음·값이 수가 아님(층 level 은 정수) |
| `COND_UNKNOWN_METRIC` | m 이 동 단위 수치 입력이 아님 |
| `COND_UNKNOWN_FLAG` | flag 가 동 단위 참/거짓 입력이 아님 |
| `COND_UNKNOWN_USE` | 용도 어휘에 없는 용도·용도군 |
| `COND_BAD_FLOORS` | 층 선택자 형식 오류 |
| `COND_BAD_AREA_SPEC` | sum_area·floor_exists 형식 오류 |
| `COND_UNKNOWN_FACILITY` | 시설 마스터에 없는 facility |
| `COND_UNKNOWN_INSTALLABLE` | installed 대상이 시설 마스터·inputs.json `installed.targets` 에 없음 |
| `COND_BAD_CONST` | const 가 true/false 가 아님 |
| `COND_TOO_DEEP` | 트리 깊이 20 초과 |
| `ROW_NOT_OBJECT` | 행이 객체가 아님 |
| `ROW_UNKNOWN_FIELD` | 알 수 없는 행 필드(오타 방지) |
| `ROW_BAD_ID` | id 없음 |
| `ROW_DUPLICATE_ID` | 파일 안 id 중복 |
| `ROW_BAD_KIND` | kind 오류 |
| `ROW_MISSING_CRITERIA` | v1 criteria 없음 |
| `ROW_BAD_DATE` | 날짜 형식 오류 |
| `ROW_DATE_ORDER` | end_date < start_date |
| `ROW_NO_CONDITIONS` | 조건 없는 trigger(needs_review 없이) |
| `ROW_BAD_SCOPE` | scope 형식 오류·trigger 에 scope 없음 |
| `ROW_BAD_BRANCHES` | branches 형식 오류 |
| `ROW_BAD_SPECS` | specs 가 객체가 아님 |
| `ROW_BAD_RETROACTIVE` | retroactive 형식 오류 |
| `ROW_BAD_ITEM_KEY` | item_key 가 빈 값 |
| `ROW_BAD_NEEDS_REVIEW` | needs_review 형식 오류 |
| `ROW_BAD_INPUTS_REQUIRED` | inputs_required 에 모르는 입력 |
| `ROW_INPUTS_MISSING` | 조건이 쓰는 입력이 inputs_required 에 빠짐 |
| `ITEM_KEY_OVERLAP` | 같은 item_key 행들의 기간 중복 |
| `FACILITY_BAD_ID` | facility_id 가 문자열이 아님 |
| `FACILITY_UNKNOWN_ID` | 시설 마스터에 없는 facility_id |
| `FACILITY_DUPLICATE` | 파일 안 facility_id 중복 |
| `FACILITY_CYCLE` | facility 노드 의존 순환 |
| `FILE_NOT_OBJECT` | 파일이 객체가 아님 |
| `FILE_BAD_SCHEMA_VERSION` | schema_version 이 2 가 아님 |
| `FILE_BAD_TYPE_CODE` | type_code 형식 오류 |
| `FILE_TYPE_CODE_MISMATCH` | type_code ≠ 파일명 번호 |
| `FILE_BAD_REVIEW` | review 형식 오류·없음 |
| `FILE_BAD_STRENGTHENED` | strengthened_retroactive 가 파일에 없는 시설을 가리킴 |
| `FILE_BAD_FACILITIES` | fire_facilities·regulations 가 배열이 아님 |
| `V1_FIELD_CHANGED` | v1 필드 변경(`compareV1Fields`) |
| `V1_ROW_COUNT_CHANGED` | v1 행 수 변경 |
| `V1_FACILITY_CHANGED` | v1 시설 목록·순서 변경 |

경고 코드(`lintRow`): `W_NUMBER_MISSING`(원문 수치가 조건·범위에 없음) · `W_OP_MISMATCH`(이상·초과·이하·미만 ↔ 연산자 불일치) · `W_SCOPE_WORDING`('모든 층'·'해당 층'·'해당 부분' ↔ scope 불일치) · `W_NEEDS_REVIEW`.

## 10. 테스트와 도구

```sh
node --test scripts/engine/test/
node scripts/engine/verdict-diff.mjs --a <데이터 디렉터리 A> --b <데이터 디렉터리 B> [--buildings <픽스처>] [--today YYYYMMDD] [--json] [--fail-on-diff]
```

- Node 22 의 `--test` 는 디렉터리 인자를 파일 목록으로 펼치지 않고 `node <디렉터리>` 로 실행하므로, `scripts/engine/test/index.js` 가 디렉터리로 실행됐을 때만 `*.test.mjs` 를 모두 불러온다(인자 없는 `node --test` 에서는 아무것도 하지 않아 중복 실행이 없다). 파일 목록 실행 `node --test scripts/engine/test/*.test.mjs` 도 같다.
- 테스트: 3값 진리표·출처, 정규화(옥탑·지하층·혼재 층·수동 입력·허가일), 구간 결정, 검증기 오류 코드(순환·item_key 중복 포함), 불변식·결정적 질문, 개정 경계, 복합건축물, v1 대체, 면제·소급, 스키마 데이터 정합성, 엔진 순수성, verdict-diff.
- 골든 픽스처(`scripts/engine/test/fixtures/buildings`, **TEST-ONLY** 데이터 `fixtures/data` 로 판정 — 실제 데이터 변환본이 아님): 근생 3층 450㎡ · 지하주차장 180㎡ 2026년 허가 · 아파트 25층 200세대 · 6층 스프링클러 경계(2018.1.27./허가 2018.3.2.) · 무창층 결정적 질문 · 수동 입력(연면적·층수만) · 사용승인일만 · 3개 동 + 지하주차장 · 복합건축물 후보 · v1 대체.
- `verdict-diff`: 같은 픽스처를 두 데이터 디렉터리로 판정해 달라진 판정·범위·질문을 한 줄씩 출력한다. 데이터 디렉터리에 `schema/`·`facilities.json` 이 없으면 저장소 것을 쓴다. 출력 예:

```
verdict-diff  A=data  B=../pr/data  건물 10개 · 오늘 20260926
[nc-3f-450] 본동 · 소화기구: 해당 → 비해당 | 범위 모든 층 → -
차이 1건 (건물 1개)
```

## 11. CP1 법령 검수 질문

실제 데이터를 변환(P1)하기 전에 소유자가 확인할 해석이다. 각 항목의 현재 기본값과 바뀌었을 때 고칠 곳을 적었다.

1. **층수 산정** — '층수'를 표제부 지상층수(건축법 시행령 제119조①9호: 지하층 제외, 수평투영면적 1/8 이하 옥탑 제외, 부분마다 다르면 가장 많은 층수)로 보는가? 현재: 예(`groundFloorsFrom: 'title'`, `rooftopCountsAsFloor: false`, `basementCountsInFloors: false`). 층별개요와 표제부가 다르면 표제부를 따르고 `FLOOR_COUNT_MISMATCH` 로 표시한다.
2. **'지하층 포함 N개층'·'지하층의 층수'** — 지하층 포함 층수 = 지상층수 + 지하층수, 지하층의 층수 = 표제부 지하층수로 보는가?
3. **해당 층 vs 모든 층** — '…인 층이 있는 것은 모든 층' → 모든 층, '…인 층이 있는 경우 해당 층' → 조건을 만족한 층만, 범위 문구가 없는 행('연면적 1,500㎡ 이상')은 모든 층으로 보는가? '모든 층'에 옥탑을 넣지 않는 것이 맞는가?
4. **용도별 바닥면적 합계** — '조산원·산후조리원의 바닥면적 합계 600㎡ 이상'을 동 안의 해당 용도 부분 합계(층과 무관)로 보는가? 한 층에 용도가 섞이면 배분을 모르므로 사용자에게 합계를 묻는다. 대지(여러 동) 합계로 봐야 하는 행이 있는가?
5. **이상·초과·미만·이하 대응** — 이상 → `gte`(≥), 초과 → `gt`(>), 이하 → `lte`(≤), 미만 → `lt`(<). 검증기 경고 `W_OP_MISMATCH` 가 이 표로 원문과 조건을 대조한다.
6. **2026.3.1. '미만' 신설 문구** — '지하에 차고·주차장이 200㎡ 미만'을 "지하층에 차고·주차장이 있고(0 초과) 그 바닥면적 합계가 200㎡ 미만"으로 보는가(없으면 비해당)? '지하에'는 지하층 전체 합계인가, 층별인가? '또는 20대 미만의 기계장치 주차시설'과의 결합은?
7. **허가 신청일 경계 규칙** — 허가일 전 180일 안에 개정 시행일이 있고 판정이 갈리면 '확인 필요(신청일)'로 두는 것이 맞는가? 부칙 적용례의 기준일이 '건축허가 신청일'인지 '건축허가등의 동의 요구일'인지(질문 문구에 둘 다 적었다), 180일이 충분한가, 신청일이 답변되면 모든 행을 신청일로 고르는 것이 맞는가(적용례가 허가일·착공일 기준인 개정은 없는가)?
8. **사용승인일만 있을 때** — 허가일이 사용승인일 전 3년(1,095일) 안에 있다고 보고 그 구간의 개정 경계만 묻는 것이 적절한가?
9. **무창층** — 답변 전에는 모름(U)으로 두고, 면적 기준을 넘는 지상층에만 결정적일 때 묻는다(지하층은 무창층 정의상 제외). 가정하지 않는 것이 맞는가?
10. **복합건축물** — 동의 용도군이 둘 이상이면 후보로 표시하고, 30번 파일 결과는 사용자가 복합건축물이라고 답한 뒤에만 적용(구성 용도 파일 결과 중 가장 강한 것과 결합)한다. 부수 용도(건축물 내부 주차장)는 용도군 수에서 뺀다. 구성 용도 파일을 적용할 때 '연면적'을 동 전체로 보는 현재 방식이 맞는가(해당 용도 부분 면적으로 봐야 하는 기준이 있는가)?
11. **동 단위** — 현재는 표제부 동마다 따로 판정한다. 지하주차장·연결통로로 이어진 동을 하나의 소방대상물로 보는 경우(ref01 비고: 연결통로 6m·10m 이하)를 어떻게 다룰 것인가(질문으로 확인 → 합산 평가)?
12. **제13조 강화기준 소급** — `strengthened_retroactive` 에 넣을 시설(소화기구·비상경보설비·자동화재탐지설비·자동화재속보설비·피난구조설비, 노유자·의료시설의 지정 시설 등)과 '판정 반영(apply)' 방식이 맞는가?
13. **6층 스프링클러 강화 시행일** — 데이터는 2018.1.28., 제27810호 부칙 "공포 후 1년이 경과한 날"은 2018.1.27.로 추정(계획서 A5). TEST-ONLY 픽스처는 2018.1.27.을 가정했다.
14. **대장에 없는 입력** — 수용인원·무대부·전기실 등·특수가연물·근로자 수는 사용자 질문으로 받는다. 수용인원을 면적으로 추정(예: '100명(460㎡)')해도 되는 기준이 있는가?
15. **'바닥면적의 합계'(동 전체)** — 간이스프링클러 '바닥면적의 합계 1,000㎡ 이상'처럼 용도 한정 없는 합계를 연면적과 같게 보는가?

## 12. 이후 단계와 알려진 한계

- **P0 나머지**: 기존 1,280행에 불변 `id` 기계 부여(1커밋), `main.js` v1/v2 게이트(`?engine=v2` 스테이징), `scripts/validate-data.mjs` 에 `validateFile`·`compareV1Fields` 연결.
- **P1**: 상위 50개 문구의 공용 조건 사전 → CP1 검수 → 일괄 적용 스크립트(적용 전후 `verdict-diff`).
- **P2·P3**: 롱테일 파일별 구조화, 대체 행 종료일(`item_key`), 소급·제13조, 면제 `exempt_if` → CP4.
- 한계: 피난층 판단 없음 · 층별 면적을 모를 때 '면적 N 이상인 층이 있다'는 비둘기집 추론을 하지 않음(질문으로 해결) · 허가일은 대지 단위(동별 허가일 미구분) · 단독주택(00) 파일은 별도 PR(fix/accuracy-core)에서 추가.
