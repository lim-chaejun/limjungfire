# 판정 엔진 v2 — 기반(P0-core)

> 상태: **P0-core** — 엔진 코어·입력/용도 스키마·검증기·테스트 하네스·판정 비교 도구(독립 리뷰 반영).
> 실제 데이터 변환(P1~P3), 행 id 일괄 부여, `main.js`의 v1/v2 게이트, `scripts/validate-data.mjs` 연결은 이후 단계다.
> 이 문서의 해석 기본값은 모두 **CP1 법령 검수 전 잠정값**이다(§11).

## 1. 왜 v2 인가

현재(v1) 판정(`main.js getRequiredFireFacilities`)의 두 결함을 고친다.

- **B1 규모 미평가** — 허가일에 유효한 규정 행이 하나라도 있으면 '필수'로 표시한다. 1,280행 중 827행이 날짜 없음(항상 유효)이라 거의 모든 시설이 '필수'가 된다. 수동 입력의 연면적·층수도 쓰지 않는다.
- **B2 대지 합산** — 동별이 아니라 대지 전체(연면적 합, 층수 최댓값)로 판정하고, 옥탑을 지상층으로 센다.

v2 의 원칙:

1. **3값 판정** — 해당(T) / 확인 필요(U) / 비해당(F). 모르면 모른다고 한다.
2. **출처(provenance)** — 모든 값은 어떤 입력에 기댔는지, 그 입력이 확정(건축물대장·사용자 답변)인지 가정인지 안다.
3. **비해당은 확정 근거로만** — 가정값을 모두 풀어(모름으로) 다시 판정해도 F 일 때만 비해당이다(§5.4). 대장끼리 맞지 않거나 빠진 값은 확정값으로 만들지 않고 구간(모름)으로 둔다(§6).
4. **결정적 질문만** — 답에 따라 판정이 바뀌는 질문만 묻는다(§5.5).
5. **동별 판정** — 건축물대장 표제부의 동 단위로 판정하고, 대지 전체는 결과를 모아 보여줄 뿐이다. 다만 지하주차장 등으로 이어져 하나의 소방대상물일 수 있는 대지는, 합치면 판정이 달라지는 비해당을 확인 필요로 둔다(§6.6, CP1 Q11).
6. **해석은 이름 있는 정책으로** — 층수 산정·무창층·신청일 경계 등 해석이 갈리는 지점은 코드 상수가 아니라 `policy.js`의 옵션이다(§8).
7. **추가형 스키마** — 기존 v1 필드(`criteria`·`start_date`·`end_date`·`applicable_to`·`note` 등)는 바꾸지 않고 필드를 더한다. `schema_version: 2`가 아닌 파일은 v2 가 평가하지 않는다(파일 단위 무중단 전환).

## 2. 구성

| 경로 | 역할 |
|---|---|
| `js/engine/index.js` | 공개 API (아래 모듈 재수출) |
| `js/engine/schema.js` | 스키마 상수(노드 종류·연산자·범위·층 선택자), 조건 트리 순회 도구 |
| `js/engine/logic.js` | 3값 논리(all/any/not/ite)·출처(dep)·구간 비교 |
| `js/engine/policy.js` | 해석 정책 옵션·기본값 |
| `js/engine/dates.js` | YYYYMMDD 날짜 도구, 행 유효성, 기준일·개정 경계 검사 구간(`resolveDateInfo`) |
| `js/engine/uses.js` | 용도 어휘 색인, 건축물대장 용도 문자열 분류(동 주용도 군에 따른 별칭) |
| `js/engine/facts.js` | 건축물대장·수동 입력 → 동별 사실 정규화, 대지 합친 동(`mergeDongs`) |
| `js/engine/conditions.js` | 조건 노드 평가(지표·층·용도·질문 키), 가정값 풀기(release) |
| `js/engine/questions.js` | 질문 문장·질문 선별 시험값 |
| `js/engine/evaluate.js` | 행 → 시설 → 동 판정, 개정 경계, 재평가(§5.4), 결정적 질문 선별(§5.5) |
| `js/engine/building.js` | 건물 판정, 대지 연결(§6.6), 동 결합, v1 호환 결과 |
| `js/engine/validate.js` | 검증기(오류·경고 코드), 파일 묶음 검증, v1 필드 불변 비교 |
| `js/engine/format.js` | 수치·구간·층 범위 문장 |
| `data/schema/inputs.json` | 입력 항목 정의(라벨·유형·단위·출처·질문 문장) |
| `data/schema/use_vocabulary.json` | 세부 용도 어휘(ref01 기반) |
| `scripts/engine/verdict-diff.mjs` | 두 데이터 디렉터리의 판정 차이 비교 CLI |
| `scripts/engine/test/` | `node --test` 테스트, TEST-ONLY 픽스처(`fixtures/data`, `fixtures/buildings`), 리뷰 재현 사례(`review-cases.mjs`) |

엔진 모듈은 **순수 ES 모듈**이다 — Node 내장 모듈·DOM·`fetch`를 쓰지 않고, 데이터는 호출자가 불러와 넘긴다(브라우저 `type="module"`과 `node:test` 공용, 빌드 단계 없음).

## 3. 사용법

```js
import { normalizeRegistry, normalizeManual, requiredTypeCodes, evaluateBuilding } from './engine/index.js';

// 1) 사실 정규화 (표제부·층별개요·총괄표제부·인허가 API 항목 그대로)
const building = normalizeRegistry({ title, floors, recap, permit }, { vocabulary });
//    수동 입력이면: normalizeManual(submitManualInput 의 객체, { vocabulary })

// 2) 필요한 데이터 파일만 불러오기 (예: ['02', '12', '30']) — vocabulary 를 넘기면 대지 연결 후보의 합친 동(§6.6)이 쓰는 파일도 포함
const codes = requiredTypeCodes(building, { vocabulary });

// 3) 판정
const result = evaluateBuilding({ building, dataFiles /* { '02': json, … } */, vocabulary, inputs, facilities, exemptions, answers, today });
// result.status: 'v2' | 'partial' | 'v1' | 'unmapped' — 'v2' 가 아니면 result.notEvaluated 의 파일은 기존 판정으로 대체
```

공개 함수(주요):

| 함수 | 설명 |
|---|---|
| `normalizeRegistry(items, { vocabulary \| useIndex, policy })` | 건축물대장 → `Building` |
| `normalizeManual(input, { vocabulary \| useIndex, policy, dongId })` | 수동 입력 → `Building` |
| `requiredTypeCodes(building, { vocabulary \| useIndex, policy }?)` | 평가에 필요한 파일 번호(어휘를 넘기면 대지 합친 동 포함) |
| `evaluateBuilding({ building, dataFiles, vocabulary \| useIndex, inputs, facilities, exemptions, answers, policy, today })` | 건물 판정(v1 호환 + v2) |
| `resolveDateInfo(dates, answers, policy, today)` | 기준일·경계 검사 구간 |
| `effectiveFloors(dong, groundCount, basementCount)` · `countOf(interval)` · `mergeDongs(dongs, opts)` · `siteLinkCandidate(building)` | 층 목록·구분별 완전성, 대지 합친 동 |
| `evaluateDong(dong, ctx)` · `evaluateRow(row, env)` · `evalCondition(node, env)` · `makeEnv(...)` | 하위 평가(테스트·도구용) |
| `makeValidationContext({ inputs, vocabulary, facilities })` · `validateFile(file, ctx, { fileName })` · `validateFileSet(files, ctx)` · `validateRow` · `validateConditions` · `checkItemKeyOverlaps` · `findFacilityCycles` · `lintRow(row, path, ctx?)` · `compareV1Fields(before, after)` | 검증기(§9) |
| `resolvePolicy(overrides)` · `DEFAULT_POLICY` · `POLICY_OPTIONS` | 정책 |
| `buildUseIndex(vocabulary)` · `classifyUses(main, etc, index, contextGroup?)` · `coverage(terms, targets, index)` | 용도 분류 |

`answers` 는 질문 키 → 답(참/거짓·수·날짜) 맵이다(§5.5).

**출력 문자열은 평문이다.** 결과의 시설명·근거·질문·경고 문장은 데이터 파일과 건축물대장 값을 그대로 담고 이스케이프하지 않는다. 화면에 넣을 때는 반드시 `textContent` 등으로 넣거나 이스케이프해야 한다(엔진은 HTML 을 만들지 않는다).

## 4. 데이터 스키마 (추가형)

### 4.1 파일

| 필드 | 필수 | 설명 |
|---|---|---|
| `schema_version` | v2 | `2`. 없으면 v1 파일 — v2 엔진은 평가하지 않고 'v1 — v2 엔진 미평가'로 보고 |
| `type_code` | v2 | `'00'`~`'30'` (파일명 앞 번호와 같아야 함) |
| `review` | v2 | `{ status: draft\|reviewed\|approved, by: 문자열\|null, date: YYYYMMDD\|null }` — 법령 검수 상태 |
| `strengthened_retroactive` | 선택 | 제13조 강화기준 소급 대상 `facility_id` 배열(§5.7) |
| 그 밖의 모든 필드 | v1 | `building_type`·`definition`·`note`·`sub_types`·`modular_classroom` 등 — 그대로 둔다(`compareV1Fields` 가 깊게 비교) |

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

trigger 행이 하나도 없는 시설(info·modifier 행만 있음)은 비해당이 아니라 **확인 필요**다 — 원문 확인 질문 `review[facility:시설 id]@동` 을 묻는다(검증기 경고 `W_NO_TRIGGER`).

### 4.4 조건 노드

노드는 아래 종류 키를 **정확히 하나** 가진 객체다.

| 노드 | 형식 | 의미 |
|---|---|---|
| `all` / `any` / `not` | `{ "all": [노드…] }` · `{ "not": 노드 }` | Kleene 3값 논리곱·합·부정 |
| `m` | `{ "m": "total_area", "gte": 600 }` | 동 지표 비교. 연산자 `gte·gt·lte·lt·eq` 를 여럿 쓰면 모두 만족(예: `"gte": 300, "lt": 600`) |
| `sum_area` | `{ "sum_area": { "floors": [선택자…], "use": [용도…] }, "gte": 1000 }` | 선택한 층의 (용도별) 바닥면적 합계 비교. floors 생략 = 모든 층, use 생략 = 용도 무관 |
| `floor_exists` | `{ "floor_exists": { "floors": […], "area": { "gte": 300 }, "use": […] } }` | 조건을 만족하는 층이 하나라도 있는가(해당 층 = 만족한 층) |
| `use` | `{ "use": ["midwifery_clinic", "02"], "floors": […]? }` | 동(또는 선택 층)에 그 용도가 있는가. 세부 용도 id 또는 용도군 코드. floors 가 있고 그 구분의 층 목록이 불완전하면(층수 모름) F 가 아니라 U |
| `flag` | `{ "flag": "gas_facility" }` | 동 단위 참/거짓 입력(inputs.json, `engine` 아님) |
| `facility` | `{ "facility": "auto_fire_detection" }` | 같은 동의 다른 시설 판정(해당=T, 비해당=F, 확인 필요=U). 순환 금지 |
| `installed` | `{ "installed": "co2_extinguishing" }` | 그 설비가 실제로 설치돼 있는가(사용자 답변) |
| `const` | `{ "const": true }` | 무조건 적용('적용' 행) |

지표(`m`)는 inputs.json 의 동 단위 수치 입력: `total_area`(연면적), `ground_floors`(층수), `basement_floors`(지하층수), `floors_incl_basement`(지하층 포함 층수), `height`, `households`, `occupants`(수용인원), `mechanical_parking_spaces`, `workers_indoor`, `electrical_room_area`, `stage_area`, `special_combustibles_multiple`, `tunnel_length`, `building_area`.

**전기실·발전실·변전실 등(보조 용도)** 은 층별개요에 거의 적히지 않는다. 그래서 이런 방을 기준으로 하는 행(예: 물분무등소화설비 '전기실·발전실·변전실… 바닥면적 300㎡ 이상')은 `use` 가 아니라 지표 `{ "m": "electrical_room_area", "gte": 300 }`(사용자 입력)으로 쓴다. `use` 로 참조하면 검증기가 `W_AUXILIARY_USE` 로 경고하고, 실행 시에도 다른 세부 용도가 적힌 층까지 '미확인'(maybe)으로 보아 확인 필요가 된다.

### 4.5 층 선택자

`floors` 는 선택자 목록(합집합)이다. 선택자는 약칭 문자열이거나 필드의 논리곱인 객체다.

- 약칭: `all`(지하층·지상층, 옥탑 제외) · `basement` · `ground` · `rooftop` · `windowless`
- 객체 필드: `kind`(basement·ground·rooftop 또는 배열), `level`(비교 객체 — 지하층은 깊이: 지하3층 = 3), `windowless: true`, `use: [용도…]`
- 예: '지하층·무창층·4층 이상인 층' → `["basement", "windowless", { "kind": "ground", "level": { "gte": 4 } }]`, '지상 1층~2층' → `[{ "kind": "ground", "level": { "gte": 1, "lte": 2 } }]`
- **`level` 에는 `kind` 를 함께 쓴다.** `kind` 없는 `{ "level": { "gte": 4 } }` 는 지하층 깊이에도 맞는다(지하4층이 '4층 이상'에 해당) — 이 실행 의미는 유지하되 검증기가 `W_LEVEL_WITHOUT_KIND` 로 경고한다.

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

값은 `{ v: T|F|U, deps, why }` 다. `deps` 의 각 입력은 상태를 가진다: **confirmed**(건축물대장·사용자 답변) · **assumed**(정책 기본값·대체값, 예: 수동 입력 지하층 빈칸 = 0층 가정, 무창층 정책 `assume_none`, 복합건축물 가정) · **unknown**(값 없음 → 질문 후보).

결합은 Kleene 강한 논리다(`all`: F 하나면 F, `any`: T 하나면 T). F(또는 T)가 여럿이면 **가장 확실한 증인 하나만** 근거로 남긴다 — 확정 F 가 하나라도 있으면 `all` 의 F 는 확정이다. `any` 의 F 는 모든 자식의 근거를 합친다. U 의 근거는 U 자식들의 근거(= 질문 후보)다. 근거(deps)는 설명과 질문 후보를 위한 것이고, 비해당의 안전성은 근거 추적이 아니라 재평가(§5.4)가 보장한다.

### 5.2 구간

수치는 구간 `[lo, hi]` 이고 하한·상한 근거를 따로 가진다. 예: 층 용도가 섞였거나 미상이면 그 층의 대상 용도 면적은 `[0, 층 면적]`. 비교는 상한·하한만으로 결론이 나면 확정한다.

- 연면적 450㎡ 동의 '조산원·산후조리원 바닥면적 합계 600㎡ 이상' → 상한이 연면적(450)이라 **묻지 않고 확정 F**.
- 모든 층·부분 면적과 합계의 상한은 동 연면적으로 제한한다.
- 층 목록의 완전성은 **구분별**(지상·지하·옥탑)이다. 지상층수를 몰라도 지하층만 보는 조건은 결정되고, 층수를 모르는 구분을 고르는 조건만 F 대신 U(층수 질문)가 된다.
- **면적 항등식**: 층수를 정확히 알고(구간이 아니고) 연면적이 유한하면 `연면적 = 각 층 바닥면적의 합`(옥탑은 0 ~ 그 면적)을 쓴다. ① 층 면적 좁히기 — 나머지 층이 정해지면 그 층도 정해진다(1층 600 + 지하1층 400, 연면적 1,200 → 보충한 2층 = 200, 묻지 않음). 한 층이 여러 행이면 빈 행 = 층 면적 − 나머지 행. 질문의 범위(`range`)도 좁힌 구간이다. ② 합계 하한 보강 — 용도 조건이 없으면 '선택한 층 바닥면적 합계 ≥ 연면적 − (선택되지 않았거나 미확정인 층 면적 상한)'.
- 항등식이 **모순**이면(층별개요의 확정 층 면적 합이 연면적보다 작거나 큼, 또는 답변한 면적이 그렇게 만듦) 이 항등식으로는 아무것도 추론하지 않는다. 어느 층에 있는지 모르는 면적을 선택한 층에 몰아 주면 답을 받을수록 판정이 뒤집히기 때문이다(리뷰 N1). 대장 불일치는 `FLOOR_AREA_MISMATCH`, 답변 불일치는 `AREA_ANSWER_MISMATCH` 로 경고한다(§6.7).

### 5.3 행 → 시설 → 동

1. 기준일에 유효한 행을 고른다(+소급 행·강화기준, §5.7).
2. 시설값 = `any(trigger 행)` → `excluded_if` 가 있으면 `all(값, not(제외))`. trigger 행이 없는 시설은 원문 확인 질문(U, §4.3).
3. 한 동에 파일이 여럿이면(복합건축물 후보) 파일별 값의 `any`(가장 강한 결과). 30번(복합건축물) 파일의 값은 `all(복합건축물 여부, 값)` 로 게이트된다 — 사용자가 확인하기 전에는 U.
4. modifier 행은 시설이 해당일 때 범위 확장(`extensions`)으로, info 행은 안내(`info`)로 붙는다.

### 5.4 확정 규칙과 불변식

| 값 | 판정 | 출력 |
|---|---|---|
| T | **해당** | 적용 범위(`scope`), 근거 |
| U | **확인 필요** | 결정적 질문(`questions`) |
| F | **비해당** | 근거(`reasons`) |

**불변식: 가정값을 사실로 삼는 F 는 비해당으로 표시하지 않는다.** 판정 절차(`judge`):

1. 개정 경계 검사 구간(§5.6)의 각 시기(구간 시작과 경계일마다)에서 보통 평가를 한다. 모두 T 면 해당, 하나라도 U 이거나 시기마다 다르면 확인 필요.
2. 모든 시기에서 F 이면, **가정값을 모두 푼(release) 재평가**를 한다: 정책·대체값으로 만든 가정(무창층 `assume_none`, 수동 입력 지하층 빈칸 0, 복합건축물 가정, 가정된 지표)은 모두 '모름'(입력 정의의 가능한 범위 전체)으로 바꾼다. 각 시기에서 다시 F 일 때만 비해당이다. 하나라도 F 가 아니면 확인 필요 — 이유에 '가정값·미확인 입력을 모름으로 두면 비해당이 확정되지 않음'을 적는다.

재평가가 건전한 까닭 — **단조성**: 어떤 입력을 모름(U·넓은 구간)에서 값으로 좁혀도 이미 확정된 T/F 가 바뀌지 않으면, 가정값을 푼 평가가 F 일 때 그 가정값들이 **어떤 값이든(여럿이 함께 틀려도)** F 이고, 개정 경계 구간의 **모든 시기**에서 F 이면 구간 안의 어느 날이 기준일이어도 F 다. (예전에는 입력을 하나씩 바꿔 보는 시험으로 확인했는데 가정값 두 개가 함께 틀린 경우를 놓쳤다 — 리뷰 H1. 하나씩 바꿔 보는 시험은 이제 **무엇을 물을지** 고를 때만 쓴다, §5.5.)

단조성은 저절로 성립하지 않는다. Kleene 논리(`all`·`any`·`not`)와 구간 비교는 그 자체로 단조이지만, 사실에서 값을 **추론하는** 단계는 모름을 확정값으로 바꾸면 단조성이 깨진다. 그런 단계와 지키는 방법(2차 리뷰):

| 단계 | 깨지던 경우 | 지키는 방법 |
|---|---|---|
| 면적 항등식(합계 하한·층 면적 좁히기, §5.2) | 층별개요 면적 합 < 연면적이면 빈 면적을 선택한 층에 몰아 줌 → 무창층 답에 따라 비해당↔해당(N1) | 층수를 정확히 알고 항등식이 모순 없을 때만 쓴다 |
| 층 목록이 불완전할 때 동 전체 `use` 의 빠진 층 몫 | 표제부 용도를 확정 T 로 → `not`·`excluded_if` 에서 확정 비해당, 층수를 답하면 뒤집힘(N2) | 표제부에 대상 용도가 있으면 U, 없을 때만 F |
| 보충한 층·용도가 빈 행(표제부 용도를 빌려 옴) | 표제부 용도가 여럿이면 모두 있다고 확정 T, 그 층 답변을 읽지 않음(N2′) | 여러 용도 중 일부만 대상이면 '모름'(maybe) — 그 층 질문을 묻고 답을 읽는다. 표제부 용도가 하나면 그 용도(문서화한 가정) |

단조성은 **모형 안의** 답변에 대해 성립한다. 확정 사실과 모순되는 답(한 층 면적 > 연면적, 층수를 알 때 층 면적 합 ≠ 연면적)은 모형 밖이라 판정이 뒤집힐 수 있다 — 엔진은 이런 답을 받으면 모순된 쪽으로 추론하지 않고 `AREA_ANSWER_MISMATCH` 로 경고한다. 질문의 범위(`range`)는 모형 안의 값만 담는다(좁힌 구간 ∩ 입력 정의의 `range`).

보장의 범위: 이 불변식은 (1) 확정으로 받아들인 사실(건축물대장 값·사용자 답변)과 그 구간 모형, (2) 문서화한 날짜 구간 정책(`applicationWindowDays`·`approvalOnlyLookbackDays`, §5.6·§8), (3) 해석 정책(층수 산입·부수 용도·소급, §8)을 전제로 한다. 해석 정책이 법령과 다르거나 날짜 구간을 줄이면 비해당이 틀릴 수 있다 — 그래서 CP1 검수 대상이다(§11).

시험:
- `property.test.mjs`: 골든 픽스처(기본·변형 × 무창층 정책 둘)와 리뷰 재현 사례의 모든 비해당에 대해, 건물 사실과 데이터에서 직접 모은 가정값·미확인 입력(층별 무창층, 확정이 아닌 층수·연면적·층·부분 면적, 사용자 확인 플래그·설치 여부, 미상 용도, 복합건축물·대지 연결, 기준일 구간 안의 허가일·신청일)에 끝값 조합과 시드 고정 무작위 조합을 답으로 넣어 비해당이 그대로인지 확인한다(엔진의 근거 추적·질문 선별에 기대지 않음).
- `monotonicity.test.mjs`: 무작위 건물(단조성을 깨기 쉬운 모양 포함)·무작위 기준으로 ① 조건 잎 단위 — 가정값을 푼 평가의 확정값이 모형 안의 답을 더해도 그대로인지, ② 판정 단위 — 묻는 질문·확정이 아닌 사실에 답해 가도 비해당이 비해당인지, 각 단계의 비해당이 가정값 정책을 모두 끈 평가에서도 비해당인지.
- 두 시험 모두 모형 밖 답(면적 모순)은 거른다(`answer-model.mjs`). 재평가를 끄거나 위 표의 단계를 되돌리면 시험이 실패하는 것을 변이 점검으로 확인했다(N2′ 의 '답을 읽지 않는 확정 T'는 엔진 자신과 비교하는 퍼즈로는 드러나지 않아 회귀 시험으로 고정).

### 5.5 결정적 질문

U 인 시설에서 **무엇을 물을지** 고른다(비해당의 안전성과는 별개 — §5.4). 후보는 각 시기의 보통 평가와 재평가에서 확정이 아닌 입력(+날짜가 판정을 가르면 날짜 질문)이다. 후보 입력 하나에 값을 넣어 다시 판정해(`judge`) 판정이 확정되면(T 또는 F) 그 입력은 **결정적**이다. 결정적 입력이 없으면(여러 답이 함께 있어야 풀리는 경우) 후보를 모두 묻고 `jointQuestions: true` 로 표시한다. 답을 받으면 다시 평가해 다음 질문을 고른다.

비용을 제한하기 위해 단계적으로 시험한다(시설마다 시험 예산 `DECISIVE_TEST_BUDGET` = 400회, 다 쓰면 후보 전부를 함께 묻는다):

1. **묶음 확인** — 같은 종류 입력이 셋 이상(예: 층마다 무창층)이면 모두 한쪽 끝값으로 두어 본다. 어느 끝으로도 판정이 안 바뀌면 — 조건이 그 입력에 단조이면 하나만 답해서도 바뀌지 않으므로 — 개별 시험을 건너뛴다.
2. **끝값 시험** — 입력마다 참/거짓, 수치는 가능한 범위의 양 끝(위 끝이 무한이면 가장 큰 기준값 + 1), 날짜는 각 시기.
3. 여전히 결정적 입력이 없으면 **기준값 앞뒤**(±ε, 정수는 ±1)와 **좁은 정수 범위 전체**(범위 폭 40 이하 — 예: 지상 2층 + 지하 x층 = 정확히 7개층 같은 폭 1짜리 조건).

평가 결과는 (기준일, 가정 풀기 여부, 가상 답변) 단위로 시설끼리 공유하고, 질문 선별용 평가는 근거·설명을 만들지 않는 값 전용 평가로 한다. 리뷰의 적대적 사례(미확인 입력 수십 개인 시설 30개 × 30층 동 3개)가 약 0.3초, 30층 × 3개 동 실제형 건물이 50ms 안팎이다(§10). UI 에서 답변마다 다시 평가할 때 메인 스레드를 막지 않도록, 이후 UI 단계에서 Web Worker 로 옮기는 것을 권장한다.

- 예: 1·2층 1,050㎡, 3층 500㎡ 근생 — 스프링클러('무창층 1,000㎡ 이상인 층')는 1·2층 무창층만 묻고 3층은 묻지 않는다. 옥내소화전은 연면적 2,600㎡ 로 이미 해당이라 무창층을 묻지 않는다.
- 예: 무창층 정책 `assume_none` 에서 '지하층·무창층 바닥면적 합계 1,000㎡ 이상'(1·2층 각 600㎡) — 재평가가 F 가 아니므로 확인 필요, 1·2층 무창층을 묻는다(어느 한 층이든 '아니오'면 비해당으로 확정되므로 각각 결정적).

질문·답변 키 형식: `입력[세부]@동/층`

| 예 | 뜻 |
|---|---|
| `windowless@본동/2F` | 본동 2층 무창층 여부 |
| `ground_floors@본동` · `basement_floors@본동` · `total_area@본동` | 본동 층수·지하층수·연면적(대장 값이 없거나 서로 맞지 않을 때) |
| `floor_area@본동/3F` | 본동 3층 바닥면적 |
| `part_area[2]@본동/1F` | 본동 1층의 둘째 행(부분) 바닥면적 — 한 층이 여러 행이고 그 행의 면적이 빈 경우 |
| `gas_facility@101동` | 101동 가스시설 여부 |
| `use_area[{"floors":"all","use":["midwifery_clinic","postpartum_care"]}]@본동` | 본동 조산원·산후조리원 바닥면적 합계 |
| `use_presence[{"floors":null,"use":["bathhouse"]}]@본동` | 본동 목욕장 용도 여부 |
| `installed[co2_extinguishing]@본동` | 이산화탄소소화설비 설치 여부 |
| `mixed_use@본동` | 복합건축물 해당 여부 |
| `review[행 id]@본동` · `review[facility:시설 id]@본동` | 구조화 전 행의 원문 해당 여부 · trigger 행이 없는 시설의 설치 대상 여부 |
| `site_connected` | 대지의 동들이 지하주차장·연결통로 등으로 이어져 하나의 소방대상물인가(대지 단위, §6.6) |
| `application_date` · `permit_date` | 허가 신청일 · 허가일(대지 단위) |

층 키는 `B1`(지하1층) · `3F`(3층) · `R1`(옥탑1층). 질문 객체는 `{ key, input, dong, floor, type, unit, label, text, status, range?, note? }` 이고 문장은 inputs.json 의 `question` 틀로 만든다. `range` 는 답할 수 있는 값의 범위 — 지금 알려진 구간(면적 항등식으로 좁힌 구간 포함) ∩ 입력 정의의 `range`(예: 지하층수 [2, ∞) ∩ [0, 30] → [2, 30]). 가정값에 기대는 질문에는 `note`(가정값으로 두면 판정을 확정할 수 없다는 안내)가 붙는다.

### 5.6 기준일과 개정 경계

| 상황 | 기준일(행 선택) | 경계 검사 구간 | 경계에서 결과가 갈리면 묻는 것 |
|---|---|---|---|
| 허가일 있음(인허가 1건) | 허가일(확정) | [허가일 − `applicationWindowDays`, 허가일] | 허가 신청일 |
| 인허가 여러 건(신축·증축·개축·용도변경 등) | 가장 이른 신축일(가정) | [가장 이른 날 − 신청 구간, 가장 늦은 날] | 허가일(어느 허가가 판정 기준인지) |
| 사용승인일만 | 사용승인일(가정) | [승인일 − (`approvalOnlyLookbackDays` + 신청 구간), 승인일] | 허가일 |
| 날짜 없음(수동 입력 허가일 빈칸 포함) | 오늘(가정) | [1900.01.01, 오늘] — 허가 시점을 전혀 모르므로 모든 개정 경계 | 허가일 |
| 신청일 답변 | 신청일(`applicationDateSelectsRows`) | 없음 | — |

**개정 경계 규칙**: 시설(과 그 시설이 의존하는 시설)의 행이 구간 안에서 시작하거나 끝나면(`end_date` 다음 날), 구간 시작과 각 경계일에서 다시 판정한다(§5.4의 시기). 결과가 하나라도 다르면 **확인 필요**로 두고 위 표의 날짜를 묻는다. 부칙 적용례는 대개 '이 영 시행 후 최초로 건축허가등을 신청(동의 요구)하는 경우부터'라서 허가일만으로 확정할 수 없기 때문이다. 결과가 같으면 묻지 않는다. 기준일이 가정이면 그 가정을 판정 근거(`assumptions`)에 적는다 — 비해당에도 적는다(예: '기준일: 사용승인일 2019.03.01 — 허가일 없음(가정, 추정 구간 안의 개정 경계 확인)').

예: 근생 6층, 허가 2018.3.2. — 6층 스프링클러 강화(2018.1.27.)가 180일 안: `2017.09.03~ 비해당 → 2018.01.27~ 해당` → 확인 필요(신청일). 신청일 2018.1.15.이면 비해당, 2018.2.1.이면 해당.

사용승인일만 있는 경우의 추정 구간(허가가 사용승인 전 3년 안)은 문서화한 정책이다. 허가가 그보다 오래전이면 구간 밖의 개정을 놓칠 수 있다(CP1 Q8).

### 5.7 소급·강화기준·면제

- `retroactive` 행: 기준일이 행 시작일보다 앞서도(시행 전 허가) 오늘 유효하면 적용하고 `retroactive` 에 기한(`deadline`·`grace_until`)을 싣는다.
- `strengthened_retroactive`(파일): 그 시설은 오늘 유효한 행도 적용(제13조 강화기준 소급). 정책 `strengthenedRetroactive`: `apply`(판정 반영) · `badge`(표시만) · `off`.
- 면제(`exemption_criteria.json`): 판정을 바꾸지 않고 해당·확인 필요 시설에 `exemption: { possible: true, rules }` 배지만 붙인다. 면제 행에 `exempt_if` 조건이 있고 F 면 배지를 붙이지 않는다(P3 에서 `exempt_if` 구조화).

### 5.8 v1 게이트(파일 단위 전환)

동이 필요로 하는 파일마다 상태를 매긴다: `v2`(평가) · `v1`(schema_version 2 아님 → 'v1 — v2 엔진 미평가') · `missing`(데이터 없음). 동 상태는 `v2`·`partial`·`v1`·`missing`·`unmapped`(용도 미분류), 건물 상태(`result.status`)는 `v2`(모든 동 평가) · `partial` · `v1`(평가한 동 없음 → 기존 판정 사용) · `unmapped`. 호출자는 `notEvaluated` 의 파일을 기존(v1) 방식으로 대체한다.

**일부 파일만 v2 인 동(`partial`)**: v2 파일 기준으로 비해당이어도 v1 파일의 기준이 빠진 판정이므로 비해당으로 확정하지 않는다 — 확인 필요로 두고 이유('이 동의 NN번 기준 파일이 v1 이라 판정에 빠짐 — 기존(v1) 판정과 함께 확인 필요')와 `pendingV1: ['NN']` 을 싣는다. 화면은 그 파일의 v1 판정과 함께 보여준다.

## 6. 사실 정규화

### 6.1 동과 층

- **동**: 표제부 1건 = 동 1개(`dongNm`, 없으면 '본동'). 층별개요는 `dongNm` 으로 나눈다(표제부가 하나면 전부 그 동). 표제부가 없으면 총괄표제부로 동 하나(`RECAP_ONLY` 경고).
- **층 구분**: `flrGbCd` 10 지하 · 20 지상 · 30 옥탑(없으면 `flrGbCdNm`·`flrNoNm` 으로 추정). 같은 층의 여러 행은 한 층의 부분(part) — 부분마다 용도와 면적. 면적이 빈 부분은 `part_area[n]` 으로 묻는다(n = 층 안의 행 순서).
- **빠진 층 보충**: 층수가 확정이면 층별개요에 없는 층을 채우고 면적은 `[0, 연면적]` 미상(면적 항등식으로 좁혀질 수 있음, §5.2). 보충한 층의 용도는 표제부 용도를 빌려 온다(`fromTitle`) — 표제부 용도가 하나면 그 용도(문서화한 가정), 여럿이면 그중 무엇이 그 층에 있는지 모르므로 대상 용도가 일부만 겹치면 '모름'(그 층 질문). 층 목록의 완전성은 구분별이다(§5.2) — 층수를 모르는(구간인) 구분은 층별개요가 그 상한까지 모든 층을 덮을 때만 완전하다.

### 6.2 층수

- 표제부 `grndFlrCnt`·`ugrndFlrCnt` 가 기준이다. 지상 0층은 지하층만 있는 동일 때만 확정 0(그 밖의 0 은 빈 값).
- **층별개요가 표제부보다 높은(깊은) 층을 보이면 충돌**이다 — 정책 `floorCountConflict`: `'ask'`(기본) = 두 값 사이 구간(모름)으로 두고 결정적이면 층수를 묻는다, `'title'` = 표제부, `'floor_items'` = 층별개요. 경고 `FLOOR_COUNT_MISMATCH`(지상)·`BASEMENT_COUNT_MISMATCH`(지하).
- 층별개요가 표제부보다 **적은** 층만 보이면 충돌이 아니라 덜 적힌 목록으로 보고 표제부를 따른다(빠진 층은 보충, 경고 `FLOOR_ITEMS_PARTIAL`).
- 표제부 층수가 **빈칸**이면 층별개요의 최고층은 하한일 뿐이다 — `[최고층, ∞)` 모름, 그 구분의 층 목록은 불완전.

### 6.3 연면적·높이·세대수·승강기

- 표제부 값(0 은 빈 값으로 봄. 단 세대수 0 은 주거 용도가 아닐 때만 확정 0, 승강기는 두 필드가 모두 0 이면 확정 '없음').
- 표제부 연면적이 없으면 층별개요가 층수만큼의 **모든 층을 면적과 함께 덮을 때만** 그 합을 쓴다. 아니면 `[알려진 층 면적 합, ∞)` 모름(결정적이면 연면적을 묻는다). 옥탑 면적은 바닥면적 산입 여부가 갈리므로 구간으로 둔다.
- 층별개요의 층 면적과 표제부 연면적이 맞지 않으면(알려진 층만으로 연면적을 넘거나, 모든 층을 덮는데 합이 모자람) `FLOOR_AREA_MISMATCH` — 이때 면적 항등식으로는 추론하지 않는다(§5.2).

### 6.4 용도 분류

- 주용도명(`mainPurpsCdNm`) → 용도군, 기타용도(`etcPurps`) → 세부 용도. 기타용도에서 세부 용도가 나오면 그것을 믿고(층별개요의 주용도는 분류 코드이기 때문), 없으면 용도군 와일드카드(`{ group: '02' }` — 그 군의 어떤 세부 용도든 가능). 별칭이 여러 군에 있으면(예: 사무소) 층의 주용도 군을 우선한다.
- **동의 주용도 군에 따른 별칭**(`context_aliases`): 같은 말이 동에 따라 뜻이 다르다 — 자동차관련시설(18) 동의 '주차장'(지하주차장·옥내주차장·부설주차장·필로티주차장 포함)은 주차용 건축물(`parking_structure`), 그 밖의 동에서는 건축물 내부 주차장(`indoor_parking`, 부수 용도). 층별개요 행은 그 동(표제부)의 주용도 군으로 읽는다.
- **보조 용도**(`auxiliary` — 전기실·기계실 등, 용도군 없음): 층별개요에 거의 적히지 않으므로, 다른 세부 용도가 적힌 층에서도 있을 수 있다고(maybe) 본다(§4.4).
- **표제부 용도를 빌려 온 부분**(`fromTitle` — 보충한 층, 용도가 비어 표제부 용도로 채운 행): 표제부 용도가 여럿이고 대상 용도가 그 일부만 덮으면 '모름'(maybe). 한 행에 용도가 둘 적힌 층별개요 행(예: '소매점, 노래연습장')은 그 층에 둘 다 있다고 본다.
- **층 목록이 불완전할 때**(층수 미상) 동 전체 `use` 조건의 빠진 층 몫: 표제부에 대상 용도가 없으면 F, 있으면 U(확정 T 가 아님, §5.4).

### 6.5 허가일·사용승인일

- 허가일: 인허가 API → 총괄표제부 `pmsDay` → 표제부 `pmsDay`. **인허가가 여러 건이면**(신축·증축·개축·재축·용도변경·대수선 등) 신축이 아닌 것도 모두 후보로 남기고, 가장 이른 신축일을 기준일(가정)로 삼아 가장 늦은 허가일까지의 개정 경계를 검사한다(§5.6). 경고 `MULTIPLE_PERMITS`(예: '건축 인허가 2건(2010.03.01 신축, 2021.03.01 증축) — 판정 기준이 되는 허가일 확인 필요'). 어느 허가가 판정 기준인지는 CP1 검수 전이라 엔진이 묻는다(CP1 Q16).
- 사용승인일: 총괄표제부 → 표제부(가장 이른 날).
- **수동 입력**(`submitManualInput` 객체): 값 > 0 은 사용자 확정, 연면적·층수 0 은 모름, 지하층 0 은 정책 `manualBlankBasement`. 선택 필드 `enteredFields`(사용자가 실제로 입력한 필드명 — 있으면 0 도 확정), `permitDateIsDefault`(허가일 빈칸이라 오늘로 채운 경우 → 허가일 없음으로 처리, §5.6).

### 6.6 대지 연결(연결된 동, CP1 Q11 검수 전 보수적 처리)

지하층만 있는 동이나 주차 전용 동이 있는 여러 동 대지는 지하주차장·연결통로로 이어져 하나의 소방대상물일 수 있다. 검수 전에는 모든 동을 합친 가상 동 '대지 전체'(`mergeDongs`: 연면적 합, 층수·지하층수 최댓값, 층은 층 키별로 합침, 용도군 합집합 → 복합건축물 후보)도 평가한다.

- 동별로는 비해당인데 합친 동에서는 비해당이 아닌 시설 → **확인 필요**, 질문 `site_connected`('대지의 동들이 이어져 하나의 소방대상물인가'), 시설에 `siteLink: { mergedVerdict }`.
- `site_connected` = 예 → 그 시설은 합친 동의 판정(`siteLink: { merged: true }`), 아니오 → 동별 판정 그대로.
- 결과의 `site`: `{ id: '대지 전체', members, status, typeCodes, counts, connected, facilities }`.

### 6.7 정규화·평가 경고

`building.warnings[]`(정규화)와 평가 중 경고가 결과 `warnings[]` = `{ code, dong?, message }` 로 모인다:

| 코드 | 내용 |
|---|---|
| `FLOOR_COUNT_MISMATCH` · `BASEMENT_COUNT_MISMATCH` | 층별개요가 표제부보다 높은(깊은) 층을 보임 — 정책 `floorCountConflict` |
| `FLOOR_ITEMS_PARTIAL` | 층별개요가 표제부 층수보다 적은 층만 보임 — 빠진 층은 면적 미상으로 보충 |
| `FLOOR_AREA_MISMATCH` | 층별개요 층 면적과 표제부 연면적이 맞지 않음 — 면적 항등식으로 추론하지 않음 |
| `MULTIPLE_PERMITS` | 인허가 여러 건 — 판정 기준 허가일 확인 필요 |
| `RECAP_ONLY` | 표제부 없이 총괄표제부로 평가 |
| `FLOOR_ITEM_UNPARSED` | 층 구분을 알 수 없는 층별개요 항목(건너뜀) |
| `FLOOR_ITEMS_UNMATCHED` | 표제부 동과 맞지 않는 층별개요 |
| `AREA_ANSWER_MISMATCH` | (평가) 답변한 면적이 확정 사실과 모순 — 한 층이 연면적보다 크거나 층 면적 합 ≠ 연면적. 모형 밖의 답이라 단조성 보장 밖(§5.4) |

## 7. 결과 형태

`evaluateBuilding` 결과는 v1 모양을 유지한다.

| v1 필드 | v2 에서 |
|---|---|
| `facilities[]` | 동별 판정을 시설별로 모은 목록. 시설마다 **가장 강한 판정(T > U > F, 같으면 앞 동)의 한 동**에서 판정·근거·범위·질문·가정·경계·면제를 모두 가져와 서로 어긋나지 않게 하고(`dong` = 그 동), `dongs`(동별 판정)와 규정 행 합집합(`regulations`·`allRegulations`, v1 모달용)만 모은다 |
| `required` | **해당 또는 확인 필요면 true** — 기존 화면이 확인 필요를 '비해당'으로 보이지 않게(보수적) |
| `permitDate` | 기준일(`dateInfo.refDate`) |
| `usedApprovalDate` | 사용승인일로 판정했는가 |
| `buildingType`·`summary` | 가장 큰 동의 용도군 이름, 동 합계(연면적 합, 층수·지하층수·높이 최댓값) |

v2 필드: `status`, `dateInfo`, `counts`(해당·확인 필요·비해당 수), `dongs[]`(동별 `status`·`groups`·`typeCodes`·`mixedUseCandidate`·`files`·`facilities`·`questions`·`counts`·`pendingV1`), `site`(§6.6, 대지 연결 후보가 아니면 `null`), `questions`(전체 결정적 질문), `notEvaluated`, `warnings`(§6.7), `engine`(버전·정책).

시설 항목(v2): `id`·`verdict`('해당'|'확인 필요'|'비해당')·`value`(T/U/F)·`scope`(`{ type, floors, maybeFloors, parts }`)·`possibleScope`·`extensions`·`questions`·`jointQuestions`·`reasons`·`assumptions`(가정값·가정한 기준일)·`boundary`(시기별 보통·재평가 값)·`exemption`·`retroactive`·`review`·`info`·`files`(파일별 값)·`rows`(행별 값·범위·질문 후보·근거)·`pendingV1`(§5.8)·`siteLink`(§6.6)·`diagnostics`(`{ questionTests, budgetExhausted }` — 질문 선별 시험 횟수)·`dongs`·`dong`(결합 목록에서).

모든 문자열은 이스케이프하지 않은 평문이다(§3).

## 8. 정책 옵션

| 옵션 | 기본값 | 대안 | 내용 |
|---|---|---|---|
| `floorCountConflict` | `'ask'` | `'title'`·`'floor_items'` | 표제부 층수 ↔ 층별개요 충돌: 구간(모름)으로 두고 결정적이면 묻기 / 표제부(건축법 시행령 제119조①9호로 산정된 값) / 층별개요 최대 층번호(§6.2) |
| `rooftopCountsAsFloor` | `false` | `true` | 옥탑을 층수·'N층 이상인 층'·'모든 층'에 넣는가(제119조①9호: 수평투영면적 1/8 이하 옥탑은 층수 제외) |
| `basementCountsInFloors` | `false` | `true` | 층수에 지하층을 넣는가('지하층 포함 N개층'은 별도 지표) |
| `windowless` | `'unknown'` | `'assume_none'` | 무창층 여부 답변 전: 모름(U) / 아니라고 가정. **`assume_none` 은 권장하지 않는다** — 비해당은 재평가(§5.4)로 틀리지 않지만, 부정 조건(`not`)에서는 가정에 기댄 해당을 낼 수 있고 근거가 가정값이 된다 |
| `applicationWindowDays` | `180` | 0 이상 정수 | 허가일 전 신청 구간(개정 경계 검사). 실제 신청~허가 기간이 더 길면 구간 밖 개정을 놓칠 수 있다(줄이면 비해당이 틀릴 수 있음) |
| `applicationDateSelectsRows` | `true` | `false` | 신청일이 답변되면 신청일로 행을 고르는가 |
| `approvalOnlyLookbackDays` | `1095` | 0 이상 정수 | 사용승인일만 있을 때 허가일이 있을 수 있는 기간(이보다 오래전 허가면 놓칠 수 있음 — CP1 Q8) |
| `manualBlankBasement` | `'assume_zero'` | `'unknown'` | 수동 입력 지하층 빈칸(0): 0층 가정 / 모름 |
| `mixedUseRequiresConfirmation` | `true` | `false` | 복합건축물 후보의 30번 파일 결과를 사용자 확인 전 U 로 둠 / 복합건축물로 가정(해당에 '가정' 표시) |
| `mixedUseIgnoreAncillary` | `true` | `false` | 부수 용도(용도 어휘 `ancillary`, 건축물 내부 주차장 등)를 복합건축물 용도군 수에서 제외 |
| `strengthenedRetroactive` | `'apply'` | `'badge'`·`'off'` | 제13조 강화기준 소급 반영 방식(`badge`·`off` 는 비해당이 늘어난다) |

정책의 두 종류를 구분한다.

- **가정값을 만드는 옵션**(`windowless`·`manualBlankBasement`·`mixedUseRequiresConfirmation`)은 비해당을 틀리게 만들지 않는다 — 비해당 전에 가정값을 모두 풀어 다시 평가하기 때문이다(§5.4). 다만 해당·질문·근거 문장에는 영향을 준다.
- **해석·구간 옵션**(층수 산입·충돌 처리·부수 용도·소급·신청 구간·사용승인일 추정 구간)은 판정 자체를 정한다. 해석이 법령과 다르거나 구간을 줄이면 비해당이 틀릴 수 있다. 기본값은 CP1 검수 전 잠정값이다(§11).

모르는 옵션·값은 `resolvePolicy` 가 예외를 던진다.

## 9. 검증기

`validateFile(file, makeValidationContext({ inputs, vocabulary, facilities }), { fileName })` → `{ v1, errors, warnings }`. v1 파일은 `{ v1: true }` 로 건너뛴다. 이후 `scripts/validate-data.mjs`(PR2 데이터 가드)의 검사 목록에 연결한다(계획서 E1~E11·W1~W6).

`validateFileSet(files, ctx)` — 파일 묶음(`{ 파일명: json }` 또는 `[{ name, json }]`)을 파일마다 검증하고(`byFile`, 오류·경고에 `file` 표시), 파일끼리 합쳐 평가할 때(복합건축물 동: 구성 용도 파일 + 30번)만 생기는 시설 의존 순환을 `W_CROSS_FILE_CYCLE` 로 경고한다(실행 시에는 확인 필요로 처리됨). 한 파일 안의 순환은 그 파일의 `FACILITY_CYCLE` 오류로만 보고한다.

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

경고 코드:

| 코드 | 내용 |
|---|---|
| `W_NUMBER_MISSING` | 원문 수치가 조건·범위에 없음(`lintRow`) |
| `W_OP_MISMATCH` | 이상·초과·이하·미만 ↔ 연산자 불일치 |
| `W_SCOPE_WORDING` | '모든 층'·'해당 층'·'해당 부분' ↔ scope 불일치 |
| `W_NEEDS_REVIEW` | 검수 필요 표시가 있는 행 |
| `W_NO_TRIGGER` | trigger 행이 없는 시설 — 평가 시 원문 확인 질문(확인 필요) |
| `W_LEVEL_WITHOUT_KIND` | 층 선택자의 level 에 kind 가 없음 — 지하층 깊이에도 맞는다(§4.5) |
| `W_AUXILIARY_USE` | 보조 용도(전기실 등)를 use 로 참조 — 지표(`electrical_room_area` 등) 권장(§4.4). `lintRow` 에 검증 문맥(ctx)을 넘길 때만 |
| `W_CROSS_FILE_CYCLE` | 파일끼리 합쳐 평가하면 시설 의존이 순환(`validateFileSet`) |

**`compareV1Fields(before, after)` 는 데이터 변환(구조화) PR 전용이다.** 변환 전후 파일에서 v2 가 더하는 필드(허용 목록: 파일의 `schema_version`·`type_code`·`review`·`strengthened_retroactive`, 시설의 `excluded_if`, 행의 v2 필드)만 빼고 나머지 전부 — 파일 최상위의 `building_type`·`definition`·`modular_classroom` 같은 필드까지 — 를 위치 기준으로 깊게 비교해, 바뀐 경로마다 `V1_FIELD_CHANGED` 를 낸다. 법령 개정 반영 PR 은 종료일 변경·행 추가가 정상이므로 이 검사를 쓰지 않는다(그 PR 은 `verdict-diff` 로 검토).

## 10. 테스트와 도구

```sh
node --test scripts/engine/test/
node scripts/engine/verdict-diff.mjs --a <데이터 디렉터리 A> --b <데이터 디렉터리 B> [--buildings <픽스처>] [--today YYYYMMDD] [--json] [--fail-on-diff]
```

- Node 22 의 `--test` 는 디렉터리 인자를 파일 목록으로 펼치지 않고 `node <디렉터리>` 로 실행하므로, `scripts/engine/test/index.js` 가 디렉터리로 실행됐을 때만 `*.test.mjs` 를 모두 불러온다(인자 없는 `node --test` 에서는 아무것도 하지 않아 중복 실행이 없다). 파일 목록 실행 `node --test scripts/engine/test/*.test.mjs` 도 같다.
- 테스트: 3값 진리표·출처, 정규화(옥탑·지하층·혼재 층·층수 충돌·연면적 파생·여러 행 층·수동 입력·허가일·대지 연결), 구간 결정, 구분별 층 목록 완전성, 재평가, 검증기 오류·경고 코드(순환·item_key 중복·파일 묶음 포함), 결정적 질문, 개정 경계, 복합건축물, v1 대체·일부 v2 동, 면제·소급, 스키마 데이터 정합성, 엔진 순수성, verdict-diff.
- **성질 시험**(`property.test.mjs`, §5.4): 기본은 사례마다 끝값 조합 4개 + 무작위 조합 12개. 더 돌리려면 `ENGINE_PROPERTY_SAMPLES=400 node --test scripts/engine/test/property.test.mjs`.
- **단조성 퍼즈**(`monotonicity.test.mjs`, §5.4): 기본은 시드 1·2·3 × 사례 40(약 1초). 더 돌리려면 `ENGINE_FUZZ_SEEDS=1,2,3,4,5,6,7,8,9,10 ENGINE_FUZZ_CASES=200 ENGINE_FUZZ_WALKS=8 node --test scripts/engine/test/monotonicity.test.mjs`(약 20초, 전부 통과 확인).
- **리뷰 회귀 시험**(`review-regressions.test.mjs`): 독립 리뷰 1·2차의 재현 사례(`review-cases.mjs` — H1~H4, M1~M7, N1·N2·N2′)가 올바른 결과를 내는지와 적대적 성능 사례(여유 있는 5초 한도)를 고정한다.
- 골든 픽스처(`scripts/engine/test/fixtures/buildings`, **TEST-ONLY** 데이터 `fixtures/data` 로 판정 — 실제 데이터 변환본이 아님): 근생 3층 450㎡ · 지하주차장 180㎡ 2026년 허가 · 아파트 25층 200세대 · 6층 스프링클러 경계(2018.1.27./허가 2018.3.2.) · 무창층 결정적 질문 · 수동 입력(연면적·층수만) · 사용승인일만 · 3개 동 + 지하주차장(대지 연결 질문과 예/아니오 변형) · 복합건축물 후보 · v1 대체.
- `verdict-diff`: 같은 픽스처를 두 데이터 디렉터리로 판정해 달라진 판정·범위·질문·**면제·소급·범위 확장**을 한 줄씩 출력한다. 데이터 디렉터리에 `schema/`·`facilities.json`·`exemption_criteria.json` 이 없으면 저장소 것을 쓴다. `--today` 가 없으면 **한국 시간(KST) 오늘**. 출력 예:

```
verdict-diff  A=data  B=../pr/data  건물 10개 · 오늘 20260926
[nc-3f-450] 본동 · 소화기구: 해당 → 비해당 | 범위 모든 층 → -
[nc-windowless-decisive] 본동 · 간이스프링클러설비: 해당 → 해당 | 면제 면제 가능(1) → -
차이 2건 (건물 2개)
```

성능(개발 PC, Node 22, 한 번 평가): 리뷰 적대적 사례(시설 30개 × 30층+지하3층 동 3개, 무창층·층 면적 미확인) 약 0.3초(리뷰 전 2.9초·36.5초), 1개 동 40층 미확인 시설 10개 약 50ms(리뷰 전 5.9초), 30층 × 3개 동 실제형 건물 약 40ms.

## 11. CP1 법령 검수 질문

실제 데이터를 변환(P1)하기 전에 소유자가 확인할 해석이다. 각 항목의 현재 기본값과 바뀌었을 때 고칠 곳을 적었다.

1. **층수 산정** — '층수'를 표제부 지상층수(건축법 시행령 제119조①9호: 지하층 제외, 수평투영면적 1/8 이하 옥탑 제외, 부분마다 다르면 가장 많은 층수)로 보는가? 현재: 예(`rooftopCountsAsFloor: false`, `basementCountsInFloors: false`). 층별개요와의 충돌은 Q18.
2. **'지하층 포함 N개층'·'지하층의 층수'** — 지하층 포함 층수 = 지상층수 + 지하층수, 지하층의 층수 = 표제부 지하층수로 보는가?
3. **해당 층 vs 모든 층** — '…인 층이 있는 것은 모든 층' → 모든 층, '…인 층이 있는 경우 해당 층' → 조건을 만족한 층만, 범위 문구가 없는 행('연면적 1,500㎡ 이상')은 모든 층으로 보는가? '모든 층'에 옥탑을 넣지 않는 것이 맞는가?
4. **용도별 바닥면적 합계** — '조산원·산후조리원의 바닥면적 합계 600㎡ 이상'을 동 안의 해당 용도 부분 합계(층과 무관)로 보는가? 한 층에 용도가 섞이면 배분을 모르므로 사용자에게 합계를 묻는다. 대지(여러 동) 합계로 봐야 하는 행이 있는가?
5. **이상·초과·미만·이하 대응** — 이상 → `gte`(≥), 초과 → `gt`(>), 이하 → `lte`(≤), 미만 → `lt`(<). 검증기 경고 `W_OP_MISMATCH` 가 이 표로 원문과 조건을 대조한다.
6. **2026.3.1. '미만' 신설 문구** — '지하에 차고·주차장이 200㎡ 미만'을 "지하층에 차고·주차장이 있고(0 초과) 그 바닥면적 합계가 200㎡ 미만"으로 보는가(없으면 비해당)? '지하에'는 지하층 전체 합계인가, 층별인가? '또는 20대 미만의 기계장치 주차시설'과의 결합은?
7. **허가 신청일 경계 규칙** — 허가일 전 180일 안에 개정 시행일이 있고 판정이 갈리면 '확인 필요(신청일)'로 두는 것이 맞는가? 부칙 적용례의 기준일이 '건축허가 신청일'인지 '건축허가등의 동의 요구일'인지(질문 문구에 둘 다 적었다), 180일이 충분한가, 신청일이 답변되면 모든 행을 신청일로 고르는 것이 맞는가(적용례가 허가일·착공일 기준인 개정은 없는가)?
8. **사용승인일만 있을 때** — 허가일이 사용승인일 전 3년(1,095일) 안에 있다고 보고 그 구간(+신청 구간)의 모든 개정 경계를 검사하는 것이 적절한가? 이 구간은 문서화한 가정이다 — 허가가 그보다 오래전이면 구간 밖 개정을 놓칠 수 있다(비해당에도 이 가정을 표시한다).
9. **무창층** — 답변 전에는 모름(U)으로 두고, 결정적일 때만 묻는다(지하층은 무창층 정의상 제외). 가정하지 않는 것이 맞는가? **`assume_none`(무창층 아님 가정)을 고르는 것은 안전하지 않다** — 무창층 여부는 법령 해석이 아니라 건물 사실이라 검수로 정할 수 없고, 부정 조건에서는 가정에 기댄 해당을 내며, 비해당이 틀리지 않는 것은 재평가(§5.4) 덕분일 뿐 판정 근거가 가정값이 된다. 기본값 `unknown` 유지를 권장한다.
10. **복합건축물** — 동의 용도군이 둘 이상이면 후보로 표시하고, 30번 파일 결과는 사용자가 복합건축물이라고 답한 뒤에만 적용(구성 용도 파일 결과 중 가장 강한 것과 결합)한다. 부수 용도(건축물 내부 주차장)는 용도군 수에서 뺀다. 구성 용도 파일을 적용할 때 '연면적'을 동 전체로 보는 현재 방식이 맞는가(해당 용도 부분 면적으로 봐야 하는 기준이 있는가)?
11. **동 단위와 연결된 동** — 현재는 표제부 동마다 따로 판정한다. 지하주차장·연결통로로 이어진 동을 하나의 소방대상물로 보는 경우(ref01 비고: 연결통로 6m·10m 이하 등)를 어떻게 다룰 것인가? **검수 전 잠정 처리(보수적)**: 지하층만 있는 동·주차 전용 동이 있는 대지는 모든 동을 합친 '대지 전체'도 평가하고, 동별로는 비해당인데 합치면 비해당이 아닌 시설은 '확인 필요(동 연결 여부, `site_connected`)'로 둔다. 예 → 합친 판정, 아니오 → 동별 판정(§6.6). 연결 판단 기준(연결통로 길이·구조 등)을 질문으로 세분할지, 대지 합산 방식(연면적 합·층수 최댓값)이 맞는지 확인이 필요하다.
12. **제13조 강화기준 소급** — `strengthened_retroactive` 에 넣을 시설(소화기구·비상경보설비·자동화재탐지설비·자동화재속보설비·피난구조설비, 노유자·의료시설의 지정 시설 등)과 '판정 반영(apply)' 방식이 맞는가?
13. **6층 스프링클러 강화 시행일** — **2018.1.27.로 확인**: 대통령령 제27810호(2017.1.26. 공포) 부칙 제1조 단서 "공포 후 1년이 경과한 날부터 시행", 부칙 제2조 적용례 — 시행일 이후 건축허가등을 신청(협의)하는 경우부터. 데이터의 2018.1.28.은 데이터 PR lim-chaejun/limjungfire#4 에서 2018.1.27.로 정정했다(더 이상 추정 아님). TEST-ONLY 픽스처도 2018.1.27.이다. 적용례가 신청일 기준이므로 Q7 의 신청일 경계 규칙이 그대로 적용된다.
14. **대장에 없는 입력** — 수용인원·무대부·전기실 등·특수가연물·근로자 수는 사용자 질문으로 받는다. 수용인원을 면적으로 추정(예: '100명(460㎡)')해도 되는 기준이 있는가? 전기실 등을 기준으로 하는 행은 용도(`use`)가 아니라 지표 `electrical_room_area` 로 구조화하는 것이 맞는가(§4.4)?
15. **'바닥면적의 합계'(동 전체)** — 간이스프링클러 '바닥면적의 합계 1,000㎡ 이상'처럼 용도 한정 없는 합계를 연면적과 같게 보는가?
16. **증축·개축·용도변경 등 허가가 여러 건일 때 판정 기준 허가일** — 건물 전체에 최초 신축 허가일의 기준을 적용하는가, 증축 부분(또는 용도변경 부분)에는 그 허가일의 기준을 적용하는가? 소방시설법령의 증축·용도변경 특례가 어느 범위에 적용되는지는 **확인 필요**다. 현재: 인허가를 모두 후보로 두고 가장 이른 신축일을 기준일(가정)로, 가장 늦은 허가일까지의 모든 개정 경계를 검사해 결과가 갈리면 허가일을 묻는다(`MULTIPLE_PERMITS`, §6.5). 부분별 기준 적용(증축 부분만)은 아직 모형에 없다.
17. **날짜가 전혀 없는 건물**(허가일·사용승인일 없음, 수동 입력 허가일 빈칸) — 현재: 기준일을 오늘(현행 기준, 가정)로 두고 1900.1.1.부터 오늘까지 모든 개정 경계에서 판정해 결과가 갈리면 허가일을 묻는다. 결과가 모든 시기에서 같을 때만 확정한다. 이렇게 '현행 기준 + 모든 경계 검사'로 두는 것이 맞는가, 아니면 날짜 없이는 판정을 보류해야 하는가?
18. **표제부 층수 ↔ 층별개요 충돌** — 층별개요가 표제부보다 높은(깊은) 층을 보이면 현재 두 값 사이 구간(모름) + 경고, 결정적이면 층수를 묻는다(`floorCountConflict: 'ask'`). 층수 산정 규정(Q1)에 따라 표제부를 믿어야 하는가(옥탑·부분 층수 차이 등), 층별개요를 믿어야 하는가? 층별개요가 적게 보이면 목록 누락으로 보고 표제부를 따르며(`FLOOR_ITEMS_PARTIAL`), 표제부 층수가 빈칸이면 층별개요 최고층을 하한으로만 쓴다(§6.2).

## 12. 이후 단계와 알려진 한계

- **P0 나머지**: 기존 1,280행에 불변 `id` 기계 부여(1커밋), `main.js` v1/v2 게이트(`?engine=v2` 스테이징, 출력 문자열 이스케이프), `scripts/validate-data.mjs` 에 `validateFileSet`·`compareV1Fields`(변환 PR) 연결.
- **P1**: 상위 50개 문구의 공용 조건 사전 → CP1 검수 → 일괄 적용 스크립트(적용 전후 `verdict-diff`).
- **P2·P3**: 롱테일 파일별 구조화, 대체 행 종료일(`item_key`), 소급·제13조, 면제 `exempt_if` → CP4.
- **UI**: 답변마다 다시 평가하므로 대형 건물은 Web Worker 에서 평가(§5.5).
- 한계:
  - 비해당의 안전성은 확정 사실·문서화한 날짜 구간·해석 정책을 전제로 한다(§5.4). 해석 정책이 법령과 다르면 비해당이 틀릴 수 있다.
  - 피난층 판단 없음 · 층별 면적을 모를 때 '면적 N 이상인 층이 있다'는 비둘기집 추론을 하지 않음(질문으로 해결).
  - 허가일은 대지 단위(동별 허가일 미구분), 증축 부분별 기준 적용 없음(CP1 Q16).
  - 대지 연결(§6.6): 합친 동의 질문은 '대지 전체' 키로 묻는다(동별 질문과 따로). 어느 동에도 없는 시설(예: 상가동 파일에 없는 시설)은 동별 목록에 더하지 않는다 — 합친 판정은 `site.facilities` 에만 있다. 동별로 이미 해당·확인 필요인 시설은 그대로 둔다.
  - 보충한 층(층별개요에 없는 층)의 용도: 표제부 용도가 하나면 그 용도로 본다(문서화한 가정 — 실제로는 다른 용도일 수 있음). 여럿이면 그 층에 무엇이 있는지 모름으로 두고 묻는다(§6.1). 이 구분이 틀리면 부정 조건에서 비해당이 틀릴 수 있어 단조성 표(§5.4)에 넣어 두었다.
  - `level` 에 `kind` 없는 층 선택자의 실행 의미(지하 깊이에도 맞음)는 유지했다 — 검증기 경고로만 막는다(§4.5).
  - 단독주택(00) 파일은 별도 PR(fix/accuracy-core)에서 추가.
