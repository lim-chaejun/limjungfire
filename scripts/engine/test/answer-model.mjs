// 시험용 답변 모형 — 성질 시험(property)·단조성 퍼즈(monotonicity)가 "모형 안의" 답변 조합만 쓰도록 거르는 도구.
// 엔진과 따로 쓴다(엔진의 좁힌 범위에 기대지 않음): 건물 사실과 답변만 보고, 엔진의 면적 모형과 모순되는 답을 가려낸다.
//   - 층별개요 행(부분)마다 연면적 산입 여부(정규화한 inTotal — 산입·제외·모름)가 있다. 면적은 층의 산입 몫(산입 행 합)과
//     모르는 몫(옥탑·필로티·다락·면적제외여부 빈칸 행 합 — 0 ~ 전부 산입)으로 나눠 본다. 제외 행은 연면적과 무관
//   - 한 층의 산입 몫은 연면적을 넘을 수 없다(엔진은 산입 몫을 연면적으로 상한)
//   - 산입 몫의 합 ≤ 연면적, 층수를 정확히 알면 연면적 ≤ 산입 몫 + 모르는 몫의 합 — 대장 자체가 이와 모순이면 엔진은
//     항등식을 쓰지 않으므로 이 검사도 하지 않는다
// 모순 답변은 엔진이 AREA_ANSWER_MISMATCH 로 경고하는 대상이라 단조성 보장 밖이다.
import { CONFIRMED, countOf, effectiveFloors, inTotalOf } from '../../../js/engine/index.js';

export const isExactConfirmed = (iv) => Boolean(iv) && iv.lo === iv.hi && !iv.open.length && [...iv.loDeps, ...iv.hiDeps].every((d) => d.status === CONFIRMED);

const known = (dong, answers, id) => answers[`${id}@${dong.id}`] ?? (isExactConfirmed(dong.metrics[id]) ? dong.metrics[id].lo : null);

// 층 하나의 산입 몫 하한(답변·확정 산입 행 합)·모르는 몫 상한(미상이면 ∞)·산입 몫 미상 여부. 층 면적 답변은 그 층 행들이
// 모두 같은 쪽이면 그 몫, 섞였으면 모르는 몫
function floorKnown(dong, f, answers) {
  const whole = answers[`floor_area@${dong.id}/${f.key}`];
  if (whole !== undefined) {
    const kinds = new Set(f.parts.map((p) => inTotalOf(p, f)));
    const k = kinds.size === 1 ? [...kinds][0] : 'maybe';
    return { lo: k === 'yes' ? whole : 0, maybe: k === 'maybe' ? whole : 0, open: false };
  }
  let lo = 0;
  let maybe = 0;
  let open = false;
  f.parts.forEach((p, i) => {
    const k = inTotalOf(p, f);
    if (k === 'no') return;
    const part = answers[`part_area[${p.n ?? i + 1}]@${dong.id}/${f.key}`];
    const v = part !== undefined ? part : p.area.open.length ? null : p.area.lo;
    if (k === 'yes') {
      if (v === null) open = true;
      else lo += v;
    } else maybe += v === null ? Infinity : v;
  });
  return { lo, maybe, open };
}

// 산입 몫 합계 하한·모르는 몫 상한·미상 여부(층수를 모르면 알려진 층만 — 그때는 open). 연면적을 모르면 null
function identitySums(dong, answers) {
  const total = known(dong, answers, 'total_area');
  if (total === null) return null;
  const g = known(dong, answers, 'ground_floors');
  const b = known(dong, answers, 'basement_floors');
  let lo = 0;
  let maybe = 0;
  let open = g === null || b === null;
  for (const f of effectiveFloors(dong, g ?? countOf(dong.metrics.ground_floors), b ?? countOf(dong.metrics.basement_floors)).floors) {
    const a = floorKnown(dong, f, answers);
    lo += a.lo;
    maybe += a.maybe;
    if (a.open) open = true;
  }
  return { total, lo, maybe, open };
}

const consistentSums = (s) => s.lo <= s.total + 1e-6 && (s.open || s.lo + s.maybe >= s.total - 1e-6);

export function areasConsistent(building, answers) {
  for (const dong of building.dongs) {
    const total = known(dong, answers, 'total_area');
    if (total === null) continue;
    // 층마다 면적 ≤ 연면적
    const g = answers[`ground_floors@${dong.id}`] ?? countOf(dong.metrics.ground_floors);
    const b = answers[`basement_floors@${dong.id}`] ?? countOf(dong.metrics.basement_floors);
    for (const f of effectiveFloors(dong, g, b).floors) if (floorKnown(dong, f, answers).lo > total + 1e-6) return false;
    // 면적 항등식 (대장 자체가 모순이면 건너뜀)
    const base = identitySums(dong, {});
    if (base && !consistentSums(base)) continue;
    const withAnswers = identitySums(dong, answers);
    if (withAnswers && !consistentSums(withAnswers)) return false;
  }
  return true;
}
