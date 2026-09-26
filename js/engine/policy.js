// 법령 해석 선택지 — 이름 있는 정책 옵션과 기본값
// 해석이 갈리는 지점은 코드 속 상수로 묻지 않고 여기에 모은다. 각 옵션의 근거·대안은 docs/engine-v2.md §8 참고.
//
// 비해당(F)의 안전성: 가정값을 만드는 옵션(windowless·manualBlankBasement·mixedUseRequiresConfirmation)은
// 비해당을 틀리게 만들지 않는다 — 엔진이 비해당을 내기 전에 가정값을 모두 풀어(모름으로) 다시 평가하기 때문이다(§5.4).
// 다만 해당·질문·근거 문장에는 영향을 준다(예: assume_none 은 부정 조건에서 가정에 기댄 해당을 낼 수 있다).
// 법령 해석 옵션(층수 산입·충돌 처리·부수 용도·소급)과 날짜 구간 옵션은 판정 자체를 정하므로, 해석이 틀리거나
// 구간을 줄이면 비해당이 틀릴 수 있다. "기본값이면 비해당이 틀리지 않는다"는 보장은 없다 — 기본값은 CP1 법령 검수 전 잠정값이다.

export const POLICY_OPTIONS = Object.freeze({
  // 표제부 층수와 층별개요가 다를 때. 'ask' = 두 값 사이 구간(모름)으로 두고 결정적이면 층수를 묻는다,
  // 'title' = 표제부(건축법 시행령 제119조①9호로 산정된 값), 'floor_items' = 층별개요 최대 층번호. 지상층·지하층 모두에 적용.
  floorCountConflict: { default: 'ask', values: ['ask', 'title', 'floor_items'] },

  // 옥탑(층별개요 구분 '옥탑')을 층으로 보는가. false = 층수·'N층 이상인 층'·'모든 층'에서 제외
  // (건축법 시행령 제119조①9호: 수평투영면적이 건축면적의 1/8 이하인 옥탑은 층수에 산입하지 않음). 해석 — CP1.
  rooftopCountsAsFloor: { default: false, values: [false, true] },

  // 층수에 지하층을 넣는가. false = 층수는 지상층만('지하층 포함 N개층'은 별도 지표 floors_incl_basement). 해석 — CP1.
  basementCountsInFloors: { default: false, values: [false, true] },

  // 무창층 여부를 답하기 전의 취급. 'unknown' = 모름(U), 'assume_none' = 무창층이 아니라고 가정.
  // 비해당은 가정을 풀어 다시 확인하므로 틀리지 않지만, 'assume_none' 은 부정 조건(not)에서 가정에 기댄 해당을 낼 수 있고
  // 판정 근거가 가정값이 된다 — 쓰지 않는 것을 권장.
  windowless: { default: 'unknown', values: ['unknown', 'assume_none'] },

  // 허가일 전 이 일수 안에 개정 경계가 있고 판정이 갈리면 '확인 필요(허가 신청일)'.
  // 부칙 적용례는 대개 '건축허가등을 신청(동의 요구)하는 경우부터'라서 허가일만으로는 확정할 수 없다.
  // 실제 신청~허가 기간이 이보다 길면 구간 밖의 개정을 놓칠 수 있다(줄이면 비해당이 틀릴 수 있음).
  applicationWindowDays: { default: 180, min: 0 },

  // 허가 신청일이 답변되면 그 날짜로 규정 행을 고르는가 (true = 신청일 기준).
  applicationDateSelectsRows: { default: true, values: [true, false] },

  // 허가일 없이 사용승인일만 있을 때, 허가일이 있을 수 있는 범위(사용승인일 이전 일수).
  // 이 범위(+신청 구간) 안의 모든 개정 경계에서 다시 평가한다. 허가가 이보다 오래전이면 놓칠 수 있다(가정 — CP1).
  approvalOnlyLookbackDays: { default: 1095, min: 0 },

  // 수동 입력에서 지하층수 0(빈칸 포함)의 취급. 'assume_zero' = 0층으로 가정(가정값 — 비해당 전에 풀어서 확인),
  // 'unknown' = 모름. 입력 객체의 enteredFields 에 ugrndFlrCnt 가 있으면 둘 다 확정 0.
  manualBlankBasement: { default: 'assume_zero', values: ['assume_zero', 'unknown'] },

  // 2개 이상 용도군 동(복합건축물 후보)에서 30번(복합건축물) 파일 결과를 사용자 확인 전에는 U 로 둔다.
  // false 면 복합건축물로 가정(가정값 — 해당에 '가정' 표시).
  mixedUseRequiresConfirmation: { default: true, values: [true, false] },

  // 복합건축물 후보 판정에서 부수 용도(용도 어휘의 ancillary — 건축물 내부 주차장 등)를 용도군 수에서 뺀다
  // (별표2 제30호: 주된 용도의 부수시설·주차 등은 복합건축물 판단에서 제외). 해석 — CP1.
  mixedUseIgnoreAncillary: { default: true, values: [true, false] },

  // 제13조 강화기준 소급(파일의 strengthened_retroactive). 'apply' = 현행 기준을 기존 건물에도 적용해 판정,
  // 'badge' = 판정은 허가일 기준으로 두고 '강화기준 소급 대상' 표시만, 'off' = 고려 안 함('badge'·'off' 는 비해당이 늘어난다).
  strengthenedRetroactive: { default: 'apply', values: ['apply', 'badge', 'off'] },
});

export const DEFAULT_POLICY = Object.freeze(
  Object.fromEntries(Object.entries(POLICY_OPTIONS).map(([k, o]) => [k, o.default])),
);

// 기본값 + 덮어쓰기. 모르는 키·허용되지 않는 값은 예외 (해석 선택은 조용히 무시되면 안 된다)
export function resolvePolicy(overrides = {}) {
  if (overrides && Object.isFrozen(overrides) && overrides.__resolved) return overrides;
  const out = { ...DEFAULT_POLICY };
  for (const [key, value] of Object.entries(overrides || {})) {
    if (key === '__resolved') continue;
    const opt = POLICY_OPTIONS[key];
    if (!opt) throw new Error(`알 수 없는 정책 옵션: ${key}`);
    if (opt.values && !opt.values.includes(value)) throw new Error(`정책 ${key} 에 허용되지 않는 값: ${JSON.stringify(value)}`);
    if (opt.min !== undefined && !(Number.isFinite(value) && value >= opt.min)) {
      throw new Error(`정책 ${key} 는 ${opt.min} 이상의 수여야 함: ${JSON.stringify(value)}`);
    }
    out[key] = value;
  }
  Object.defineProperty(out, '__resolved', { value: true, enumerable: false });
  return Object.freeze(out);
}
