// 법령 해석 선택지 — 이름 있는 정책 옵션과 기본값
// 해석이 갈리는 지점은 코드 속 상수로 묻지 않고 여기에 모은다. 각 옵션의 근거·대안은 docs/engine-v2.md 참고.
// 기본값은 CP1 법령 검수 전의 잠정값이며, 모든 기본값은 "비해당을 잘못 내지 않는" 쪽을 택했다.

export const POLICY_OPTIONS = Object.freeze({
  // 층수(지상층수)의 출처. 'title' = 표제부 지상층수(건축법 시행령 제119조①9호로 산정된 값),
  // 'floor_items' = 층별개요의 지상층 최대 층번호. 한쪽이 없으면 다른 쪽을 쓴다.
  groundFloorsFrom: { default: 'title', values: ['title', 'floor_items'] },

  // 옥탑(층별개요 구분 '옥탑')을 층으로 보는가. false = 층수·'N층 이상인 층'·'모든 층'에서 제외
  // (건축법 시행령 제119조①9호: 수평투영면적이 건축면적의 1/8 이하인 옥탑은 층수에 산입하지 않음).
  rooftopCountsAsFloor: { default: false, values: [false, true] },

  // 층수에 지하층을 넣는가. false = 층수는 지상층만('지하층 포함 N개층'은 별도 지표 floors_incl_basement).
  basementCountsInFloors: { default: false, values: [false, true] },

  // 무창층 여부. 'unknown' = 답변 전에는 모름(U → 결정적이면 질문),
  // 'assume_none' = 무창층이 아니라고 가정(가정 F — 불변식에 따라 비해당으로 표시되지 않고 확인 필요가 됨).
  windowless: { default: 'unknown', values: ['unknown', 'assume_none'] },

  // 허가일 전 이 일수 안에 개정 경계가 있고 판정이 갈리면 '확인 필요(허가 신청일)'.
  // 부칙 적용례는 대개 '건축허가등을 신청(동의 요구)하는 경우부터'라서 허가일만으로는 확정할 수 없다.
  applicationWindowDays: { default: 180, min: 0 },

  // 허가 신청일이 답변되면 그 날짜로 규정 행을 고르는가 (true = 신청일 기준).
  applicationDateSelectsRows: { default: true, values: [true, false] },

  // 허가일 없이 사용승인일만 있을 때, 허가일이 있을 수 있는 범위(사용승인일 이전 일수).
  // 이 범위(+신청 구간) 안의 개정 경계로 판정이 갈리면 '확인 필요(허가일)'.
  approvalOnlyLookbackDays: { default: 1095, min: 0 },

  // 수동 입력에서 지하층수 0(빈칸 포함)의 취급. 'assume_zero' = 0층으로 가정(가정값),
  // 'unknown' = 모름. 입력 객체의 enteredFields 에 ugrndFlrCnt 가 있으면 둘 다 확정 0.
  manualBlankBasement: { default: 'assume_zero', values: ['assume_zero', 'unknown'] },

  // 2개 이상 용도군 동(복합건축물 후보)에서 30번(복합건축물) 파일 결과를 사용자 확인 전에는 U 로 둔다.
  mixedUseRequiresConfirmation: { default: true, values: [true, false] },

  // 복합건축물 후보 판정에서 부수 용도(용도 어휘의 ancillary — 건축물 내부 주차장 등)를 용도군 수에서 뺀다
  // (별표2 제30호: 주된 용도의 부수시설·주차 등은 복합건축물 판단에서 제외).
  mixedUseIgnoreAncillary: { default: true, values: [true, false] },

  // 제13조 강화기준 소급(파일의 strengthened_retroactive). 'apply' = 현행 기준을 기존 건물에도 적용해 판정,
  // 'badge' = 판정은 허가일 기준으로 두고 '강화기준 소급 대상' 표시만, 'off' = 고려 안 함.
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
