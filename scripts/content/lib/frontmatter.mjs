// 프론트매터 파서 — YAML 의 작은 부분집합 (docs/content-engine.md "프론트매터 형식")
//
// ---
// title: 한 줄 문자열 (따옴표 없이 써도 된다. "…" 는 JSON 문자열, '…' 는 '' 로 작은따옴표 표기)
// tags: [스프링클러, 허가일]          ← 한 줄 목록
// related:                            ← 블록 목록 (항목은 "- " 로 시작, 들여쓰기 일정)
//   - /standards/facility/sprinkler
// sources:                            ← 사전(key: value) 목록
//   - label: 소방시설법 시행령
//     url: https://www.law.go.kr/...
// ---
//
// 값은 모두 문자열(또는 문자열 목록·사전 목록)이다. 숫자·불리언 변환, 줄 끝 주석, 여러 줄 문자열(| >),
// 중첩 목록, {…} 흐름 사전은 지원하지 않으며 쓰면 오류로 멈춘다(조용히 잘못 읽지 않도록).

import { BuildError } from './util.mjs';

const KEY_LINE = /^([A-Za-z_][A-Za-z0-9_]*):(?:[ ]+(.*))?$/;
const UNSUPPORTED_START = /^[{|>&*!%@`]/;

function fail(file, lineNo, msg) {
  return new BuildError(`${file || '(frontmatter)'}:${lineNo}: ${msg}`);
}

const isSkippable = (line) => line.trim() === '' || line.trimStart().startsWith('#');

/** 파일 전체 → { data, body, bodyLine } (bodyLine: 본문이 시작하는 줄 번호) */
export function splitFrontmatter(text, file = '') {
  const src = String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = src.split('\n');
  if (lines[0] !== '---') throw fail(file, 1, '파일 첫 줄은 --- 여야 합니다 (프론트매터 시작)');
  const end = lines.indexOf('---', 1);
  if (end === -1) throw fail(file, 1, '프론트매터를 닫는 --- 줄이 없습니다');
  const data = parseFrontmatterLines(lines.slice(1, end), file, 2);
  return { data, body: lines.slice(end + 1).join('\n'), bodyLine: end + 2 };
}

/** 프론트매터 본문(구분선 제외) 파싱 */
export function parseFrontmatter(text, file = '') {
  return parseFrontmatterLines(String(text).replace(/\r\n?/g, '\n').split('\n'), file, 1);
}

function parseFrontmatterLines(lines, file, firstLineNo) {
  const data = {};
  let i = 0;
  const lineNo = (k) => firstLineNo + k;
  while (i < lines.length) {
    const raw = lines[i];
    if (isSkippable(raw)) {
      i++;
      continue;
    }
    if (/^\s/.test(raw)) throw fail(file, lineNo(i), '들여쓴 줄이 목록 밖에 있습니다 (최상위 키는 줄 맨 앞에서 시작)');
    const m = KEY_LINE.exec(raw.replace(/\s+$/, ''));
    if (!m) throw fail(file, lineNo(i), '"키: 값" 형식이 아닙니다 (콜론 뒤에 공백 필요)');
    const key = m[1];
    if (Object.hasOwn(data, key)) throw fail(file, lineNo(i), `같은 키가 두 번 나옵니다: ${key}`);
    const rest = (m[2] ?? '').trim();
    if (rest === '') {
      const res = parseBlockList(lines, i + 1, file, lineNo);
      data[key] = res.value;
      i = res.next;
    } else if (rest.startsWith('[')) {
      data[key] = parseInlineList(rest, file, lineNo(i));
      i++;
    } else {
      data[key] = parseScalar(rest, file, lineNo(i));
      i++;
    }
  }
  return data;
}

function parseBlockList(lines, i, file, lineNo) {
  const items = [];
  let dashIndent = null;
  while (i < lines.length) {
    const raw = lines[i];
    if (isSkippable(raw)) {
      i++;
      continue;
    }
    const indent = raw.length - raw.trimStart().length;
    if (indent === 0) break;
    const m = /^( +)-(?: (.*))?$/.exec(raw.replace(/\s+$/, ''));
    if (!m) throw fail(file, lineNo(i), '목록 항목은 "- " 로 시작해야 합니다');
    if (dashIndent === null) dashIndent = indent;
    else if (indent !== dashIndent) throw fail(file, lineNo(i), '목록 들여쓰기가 일정하지 않습니다');
    const content = (m[2] ?? '').trim();
    if (content === '') throw fail(file, lineNo(i), '빈 목록 항목입니다');
    const kv = KEY_LINE.exec(content);
    if (!kv) {
      if (content.startsWith('[')) throw fail(file, lineNo(i), '목록 안의 목록은 지원하지 않습니다');
      items.push(parseScalar(content, file, lineNo(i)));
      i++;
      continue;
    }
    // 사전 항목: "- key: value" 다음 줄부터 key 열에 맞춘 "key: value"
    const obj = {};
    const keyCol = indent + 2;
    const addPair = (k, v, at) => {
      if (Object.hasOwn(obj, k)) throw fail(file, lineNo(at), `같은 키가 두 번 나옵니다: ${k}`);
      if (v === undefined || v.trim() === '') throw fail(file, lineNo(at), `값이 비어 있습니다: ${k} (중첩 목록은 지원하지 않습니다)`);
      if (v.trim().startsWith('[')) throw fail(file, lineNo(at), '사전 안의 목록은 지원하지 않습니다');
      obj[k] = parseScalar(v.trim(), file, lineNo(at));
    };
    addPair(kv[1], kv[2], i);
    i++;
    while (i < lines.length) {
      const next = lines[i];
      if (isSkippable(next)) {
        i++;
        continue;
      }
      const ind = next.length - next.trimStart().length;
      if (ind <= indent) break;
      if (ind !== keyCol) throw fail(file, lineNo(i), `사전 항목의 키는 ${keyCol}칸 들여써야 합니다`);
      const kv2 = KEY_LINE.exec(next.trim());
      if (!kv2) throw fail(file, lineNo(i), '"키: 값" 형식이 아닙니다');
      addPair(kv2[1], kv2[2], i);
      i++;
    }
    items.push(obj);
  }
  return { value: items.length ? items : null, next: i };
}

function parseInlineList(rest, file, line) {
  if (!rest.endsWith(']')) throw fail(file, line, '한 줄 목록은 ] 로 끝나야 합니다');
  const inner = rest.slice(1, -1).trim();
  if (inner === '') return [];
  const parts = [];
  let cur = '';
  let quote = null;
  for (let k = 0; k < inner.length; k++) {
    const c = inner[k];
    if (quote) {
      cur += c;
      if (c === '\\' && quote === '"' && k + 1 < inner.length) {
        cur += inner[++k];
      } else if (c === quote) {
        quote = null;
      }
    } else if (c === '"' || c === "'") {
      quote = c;
      cur += c;
    } else if (c === ',') {
      parts.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  if (quote) throw fail(file, line, '따옴표가 닫히지 않았습니다');
  parts.push(cur);
  return parts.map((p) => {
    const t = p.trim();
    if (t === '') throw fail(file, line, '한 줄 목록에 빈 항목이 있습니다');
    if (t.startsWith('[')) throw fail(file, line, '목록 안의 목록은 지원하지 않습니다');
    return parseScalar(t, file, line);
  });
}

function parseScalar(s, file, line) {
  if (s.startsWith('"')) {
    if (s.length < 2 || !s.endsWith('"')) throw fail(file, line, '큰따옴표 문자열이 닫히지 않았습니다');
    try {
      return JSON.parse(s);
    } catch {
      throw fail(file, line, '큰따옴표 문자열이 올바르지 않습니다 (JSON 문자열 규칙)');
    }
  }
  if (s.startsWith("'")) {
    if (s.length < 2 || !s.endsWith("'")) throw fail(file, line, '작은따옴표 문자열이 닫히지 않았습니다');
    const inner = s.slice(1, -1);
    if (inner.replace(/''/g, '').includes("'")) throw fail(file, line, "작은따옴표 안의 ' 는 '' 로 씁니다");
    return inner.replace(/''/g, "'");
  }
  if (UNSUPPORTED_START.test(s)) throw fail(file, line, `지원하지 않는 YAML 문법입니다: ${s.slice(0, 20)} (필요하면 "…" 로 감싸세요)`);
  return s;
}
