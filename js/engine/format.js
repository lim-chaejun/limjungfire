// 사람이 읽는 문장 조각 — 수치·구간·층 범위 설명 (근거 문장과 질문 문장에서 공용)

import { FLOOR_SHORTHANDS, OP_WORD, comparisonOps, normalizeFloors } from './schema.js';
import { describeUses } from './uses.js';

export function fmtNum(n) {
  if (!Number.isFinite(n)) return '∞';
  const [i, d] = String(Math.round(n * 100) / 100).split('.');
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (d ? `.${d}` : '');
}

// 구간 → '1,050㎡' · '0~450㎡' · '미확인'
export function fmtInterval(iv, unit = '') {
  if (iv.lo === iv.hi) return `${fmtNum(iv.lo)}${unit}`;
  if (iv.lo === 0 && !Number.isFinite(iv.hi)) return '미확인';
  return `${fmtNum(iv.lo)}~${fmtNum(iv.hi)}${unit}`;
}

// 비교 조건 → '600㎡ 이상' · '300㎡ 이상 600㎡ 미만'
export function fmtCondition(cond, unit = '') {
  return comparisonOps(cond)
    .map((op) => (op === 'eq' ? `${fmtNum(cond[op])}${unit}` : `${fmtNum(cond[op])}${unit} ${OP_WORD[op]}`))
    .join(' ');
}

function describeLevel(level, basement) {
  const ops = comparisonOps(level);
  const n = (op) => fmtNum(level[op]);
  const floorWord = (x) => (basement ? `지하${x}층` : `${x}층`);
  if (ops.includes('gte') && ops.includes('lte')) return `${basement ? '지하' : '지상 '}${n('gte')}~${n('lte')}층`;
  if (ops.length === 1 && ops[0] === 'eq') return floorWord(n('eq'));
  // 지하층의 level 은 깊이(지하3층 = 3)라서 '이상'이 '아래로'를 뜻한다
  return ops.map((op) => `${floorWord(n(op))} ${basement ? { gte: '이하', gt: '미만', lte: '이상', lt: '초과' }[op] : OP_WORD[op]}`).join(' ');
}

function describeSelector(s, index) {
  if (s === FLOOR_SHORTHANDS.all) return '모든 층';
  const kinds = s.kind === undefined ? [] : [].concat(s.kind);
  const parts = [];
  if (s.level) parts.push(describeLevel(s.level, kinds.length === 1 && kinds[0] === 'basement'));
  else if (kinds.length) parts.push(kinds.map((k) => ({ basement: '지하층', ground: '지상층', rooftop: '옥탑' })[k]).join('·'));
  if (s.windowless) parts.push('무창층');
  if (s.use) parts.push(`${describeUses(s.use, index)} 용도 층`);
  return parts.join(' 중 ') || '모든 층';
}

// 층 선택자 목록 → '지하층·무창층·4층 이상'
export function describeFloors(floors, index) {
  const sels = normalizeFloors(floors);
  return sels ? sels.map((s) => describeSelector(s, index)).join('·') : '?';
}
