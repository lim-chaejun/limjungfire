import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitFrontmatter, parseFrontmatter } from '../lib/frontmatter.mjs';
import { BuildError } from '../lib/util.mjs';

const FULL = `---
title: Q&A: 무창층이란?
description: "큰따옴표 \\"안\\" 문자열"
date: 2026-09-27
updated: 2026-09-28
status: draft
# 주석 줄
tags: [무창층, "쉼표, 포함", 'It''s']
related:
  - /standards/use/retail
  - /guide/sprinkler

sources:
  - label: 소방시설법 시행령
    url: https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=279911
  - label: 둘째 출처
    url: https://www.law.go.kr/b
faq:
  - q: 질문?
    a: "답: 콜론이 있는 답"
---
## 본문
`;

test('전체 형식: 스칼라·따옴표·한 줄 목록·블록 목록·사전 목록·주석', () => {
  const { data, body, bodyLine } = splitFrontmatter(FULL, 'x.md');
  assert.deepEqual(data, {
    title: 'Q&A: 무창층이란?',
    description: '큰따옴표 "안" 문자열',
    date: '2026-09-27',
    updated: '2026-09-28',
    status: 'draft',
    tags: ['무창층', '쉼표, 포함', "It's"],
    related: ['/standards/use/retail', '/guide/sprinkler'],
    sources: [
      { label: '소방시설법 시행령', url: 'https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=279911' },
      { label: '둘째 출처', url: 'https://www.law.go.kr/b' },
    ],
    faq: [{ q: '질문?', a: '답: 콜론이 있는 답' }],
  });
  assert.equal(body, '## 본문\n');
  assert.equal(bodyLine, 22);
});

test('CRLF·BOM 파일도 같은 결과', () => {
  const crlf = String.fromCharCode(0xfeff) + FULL.replace(/\n/g, '\r\n');
  assert.deepEqual(splitFrontmatter(crlf, 'x.md').data, splitFrontmatter(FULL, 'x.md').data);
});

test('값은 모두 문자열 — 숫자·불리언으로 바꾸지 않는다', () => {
  assert.deepEqual(parseFrontmatter('a: 123\nb: true\nc: 2026-09-27\nd: null'), { a: '123', b: 'true', c: '2026-09-27', d: 'null' });
});

test('빈 값 + 블록 없음은 null', () => {
  assert.deepEqual(parseFrontmatter('faq:\ntitle: x'), { faq: null, title: 'x' });
});

const bad = [
  ['시작 --- 없음', 'title: x\n---\n본문', /첫 줄은 ---/],
  ['닫는 --- 없음', '---\ntitle: x\n본문', /닫는 --- 줄이 없습니다/],
  ['콜론 뒤 공백 없음', '---\ntitle:x\n---\n', /키: 값/],
  ['중복 키', '---\ntitle: a\ntitle: b\n---\n', /두 번/],
  ['목록 밖 들여쓰기', '---\ntitle: a\n  extra: b\n---\n', /들여쓴 줄/],
  ['목록 들여쓰기 불일치', '---\ntags:\n  - a\n    - b\n---\n', /들여쓰기가 일정하지/],
  ['사전 키 들여쓰기', '---\nsources:\n  - label: a\n      url: b\n---\n', /4칸/],
  ['여러 줄 문자열', '---\ndescription: |\n  여러 줄\n---\n', /지원하지 않는 YAML/],
  ['흐름 사전', '---\nx: {a: 1}\n---\n', /지원하지 않는 YAML/],
  ['닫히지 않은 따옴표', '---\ntitle: "abc\n---\n', /닫히지 않았습니다/],
  ['작은따옴표 안 홑따옴표', "---\ntitle: 'a'b'\n---\n", /''/],
  ['한 줄 목록의 빈 항목', '---\ntags: [a, , b]\n---\n', /빈 항목/],
  ['중첩 목록', '---\ntags: [[a]]\n---\n', /목록 안의 목록/],
];
for (const [name, text, re] of bad) {
  test(`형식 오류는 줄 번호와 함께 멈춘다: ${name}`, () => {
    assert.throws(() => splitFrontmatter(text, 'bad.md'), (e) => e instanceof BuildError && re.test(e.message) && /bad\.md:\d+/.test(e.message));
  });
}
