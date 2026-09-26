// 3값 논리(Kleene) 진리표·출처(provenance)·구간 비교
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ASSUMED, CONFIRMED, F, T, U, UNKNOWN, all, any, compareInterval, depKey, exact, interval, ite, makeDep, mergeDeps, not, tv,
} from '../../../js/engine/index.js';
import { addInterval, capInterval, hasAssumed } from '../../../js/engine/logic.js';

const V = [T, F, U];
const val = (v) => tv(v);

test('not 진리표', () => {
  assert.deepEqual(V.map((v) => not(val(v)).v), [F, T, U]);
});

test('all 진리표 (Kleene 강한 논리곱)', () => {
  const table = { TT: T, TF: F, TU: U, FT: F, FF: F, FU: F, UT: U, UF: F, UU: U };
  for (const a of V) for (const b of V) assert.equal(all([val(a), val(b)]).v, table[a + b], `${a} ∧ ${b}`);
});

test('any 진리표 (Kleene 강한 논리합)', () => {
  const table = { TT: T, TF: T, TU: T, FT: T, FF: F, FU: U, UT: T, UF: U, UU: U };
  for (const a of V) for (const b of V) assert.equal(any([val(a), val(b)]).v, table[a + b], `${a} ∨ ${b}`);
});

test('빈 all 은 T, 빈 any 는 F', () => {
  assert.equal(all([]).v, T);
  assert.equal(any([]).v, F);
});

test('ite: 조건이 U 여도 두 결과가 같은 확정값이면 그 값', () => {
  for (const a of V) for (const b of V) {
    assert.equal(ite(val(T), val(a), val(b)).v, a);
    assert.equal(ite(val(F), val(a), val(b)).v, b);
    assert.equal(ite(val(U), val(a), val(b)).v, a === b && a !== U ? a : U, `U ? ${a} : ${b}`);
  }
});

test('드모르간: not(all(a,b)) = any(not a, not b) — 모든 조합', () => {
  for (const a of V) for (const b of V) assert.equal(not(all([val(a), val(b)])).v, any([not(val(a)), not(val(b))]).v);
});

const conf = (input) => makeDep(input, CONFIRMED, { dong: '본동' });
const asm = (input) => makeDep(input, ASSUMED, { dong: '본동' });
const unk = (input) => makeDep(input, UNKNOWN, { dong: '본동' });

test('출처: all 의 F 는 가장 확실한 증인 하나만 근거로 남긴다', () => {
  const r = all([tv(F, [asm('basement_floors')]), tv(F, [conf('total_area')])]);
  assert.equal(r.v, F);
  assert.deepEqual(r.deps.map((d) => d.key), ['total_area@본동']);
  assert.equal(hasAssumed(r), false);
});

test('출처: 확정 증인이 없으면 all 의 F 는 가정값에 기댄다', () => {
  const r = all([tv(F, [asm('basement_floors')]), tv(T, [conf('total_area')])]);
  assert.equal(r.v, F);
  assert.equal(hasAssumed(r), true);
});

test('출처: any 의 T 는 확정 증인 우선, any 의 F 는 모든 자식 근거의 합', () => {
  const t = any([tv(T, [asm('windowless')]), tv(T, [conf('total_area')])]);
  assert.deepEqual(t.deps.map((d) => d.status), [CONFIRMED]);
  const f = any([tv(F, [conf('total_area')]), tv(F, [asm('basement_floors')])]);
  assert.deepEqual(f.deps.map((d) => d.input).sort(), ['basement_floors', 'total_area']);
  assert.equal(hasAssumed(f), true);
});

test('출처: U 의 근거는 U 자식들의 근거(질문 후보)', () => {
  const r = all([tv(T, [conf('total_area')]), tv(U, [unk('windowless')]), tv(U, [unk('occupants')])]);
  assert.equal(r.v, U);
  assert.deepEqual(r.deps.map((d) => d.input).sort(), ['occupants', 'windowless']);
});

test('mergeDeps: 같은 키는 하나로, 상태는 더 불확실한 쪽', () => {
  const merged = mergeDeps([conf('x')], [unk('x')], [asm('y')]);
  assert.equal(merged.length, 2);
  assert.equal(merged.find((d) => d.input === 'x').status, UNKNOWN);
});

test('질문 키 형식', () => {
  assert.equal(depKey('windowless', '본동', '2F'), 'windowless@본동/2F');
  assert.equal(depKey('use_area', '101동', undefined, '{"use":["x"]}'), 'use_area[{"use":["x"]}]@101동');
  assert.equal(depKey('application_date'), 'application_date');
});

// ───── 구간 ─────

const ge = (iv, c) => compareInterval(iv, { gte: c }, ['gte']);

test('구간: 상한만으로 결론 — [0,450] ≥ 600 은 묻지 않고 확정 F', () => {
  const iv = interval(0, 450, { hiDeps: [conf('total_area')], open: [unk('use_area')] });
  const r = ge(iv, 600);
  assert.equal(r.v, F);
  assert.deepEqual(r.deps.map((d) => d.input), ['total_area']);
});

test('구간: 기준이 구간 안이면 U, 근거는 미확정 입력(open)', () => {
  const r = ge(interval(0, 800, { hiDeps: [conf('total_area')], open: [unk('use_area')] }), 600);
  assert.equal(r.v, U);
  assert.deepEqual(r.deps.map((d) => d.input), ['use_area']);
});

test('구간: 하한만으로 T', () => {
  const r = ge(interval(700, Infinity, { loDeps: [conf('floor_area')], open: [unk('x')] }), 600);
  assert.equal(r.v, T);
  assert.deepEqual(r.deps.map((d) => d.input), ['floor_area']);
});

test('구간: 이상·초과·이하·미만·같음 경계값', () => {
  const at = (x) => exact(x, [conf('m')]);
  const cmp = (x, cond) => compareInterval(at(x), cond, Object.keys(cond)).v;
  assert.equal(cmp(600, { gte: 600 }), T);
  assert.equal(cmp(600, { gt: 600 }), F);
  assert.equal(cmp(200, { lt: 200 }), F);
  assert.equal(cmp(200, { lte: 200 }), T);
  assert.equal(cmp(3, { eq: 3 }), T);
  assert.equal(cmp(4, { eq: 3 }), F);
  // '200㎡ 미만'(존재 전제): 0 초과 200 미만
  assert.equal(cmp(180, { gt: 0, lt: 200 }), T);
  assert.equal(cmp(0, { gt: 0, lt: 200 }), F);
  assert.equal(cmp(200, { gt: 0, lt: 200 }), F);
});

test('구간: 합과 상한 제한', () => {
  const s = addInterval(interval(0, 150, { hiDeps: [conf('a')] }), exact(100, [conf('b')]));
  assert.deepEqual([s.lo, s.hi], [100, 250]);
  const capped = capInterval(s, exact(200, [conf('total_area')]));
  assert.deepEqual([capped.lo, capped.hi], [100, 200]);
  assert.deepEqual(capped.hiDeps.map((d) => d.input), ['total_area']);
  assert.equal(capInterval(s, exact(999, [])), s);
});
