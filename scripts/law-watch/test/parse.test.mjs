// 파서 — 2026-09-26 기록 원문으로 검증
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RE_PROM,
  RE_TRANSIT,
  admChainRequest,
  admDocRequest,
  lawDocRequest,
  lawListRequest,
  normName,
  parseAdmChain,
  parseLawList,
  parseRevisionDoc,
  parseWrapper,
  reOwn,
  transitionalSummary,
  wrapperRequest,
} from '../lib.mjs';
import { fixtureText } from './helpers.mjs';

const DECREE = '소방시설 설치 및 관리에 관한 법률 시행령';

test('시행령 연혁 목록: 79행, 첫 행은 2027-01-01 시행예정(267669), 현행(Y)은 하나', () => {
  const { rows, unparsed } = parseLawList(fixtureText(lawListRequest('009694')));
  assert.equal(unparsed.length, 0);
  assert.equal(rows.length, 79);
  assert.equal(rows[0].seq, '267669');
  assert.equal(rows[0].efYd, '20270101');
  assert.equal(rows[0].future, true);
  assert.equal(rows[0].current, false);
  const cur = rows.filter((r) => r.current);
  assert.equal(cur.length, 1);
  assert.deepEqual([cur[0].key, cur[0].ancNo, cur[0].revisionType, cur[0].issuer], ['20260701:287375', '36432', '타법개정', '대통령령']);
  assert.equal(rows.filter((r) => r.future).length, 1, '"앞으로 시행될 법령" 표시는 첫 행에만');
});

test('법률 연혁 목록: 40행, 현행은 2024-12-01 시행분(236977), 영문 연혁 탭은 무시', () => {
  const html = fixtureText(lawListRequest('009503'));
  assert.match(html, /lsHstDivENG/);
  const { rows, unparsed } = parseLawList(html);
  assert.equal(unparsed.length, 0);
  assert.equal(rows.length, 40);
  assert.deepEqual(rows.filter((r) => r.current).map((r) => r.key), ['20241201:236977']);
  // 같은 lsiSeq 를 공유하는 단계별 시행일은 별도 행이다
  assert.deepEqual(rows.filter((r) => r.seq === '236977').map((r) => r.efYd), ['20241201', '20221201']);
});

test('시행규칙: 공포번호 "00628" → "628", 잘린 발령기관 "행정안전부..." 도 읽는다', () => {
  const { rows } = parseLawList(fixtureText(lawListRequest('009730')));
  assert.equal(rows.length, 41);
  assert.equal(rows[0].ancNo, '628');
  assert.equal(rows[0].issuer, '행정안전부...');
  assert.equal(rows[0].key, '20260701:287831');
});

test('NFPC 108 체인: 최신은 2100000278572, 발령 정보는 소방청고시 / 2026-15 / 20260504 / 일부개정', () => {
  const { rows, unparsed } = parseAdmChain(fixtureText(admChainRequest('2100000253098')));
  assert.equal(unparsed.length, 0);
  assert.equal(rows.length, 11);
  const r = rows[0];
  assert.deepEqual(
    [r.seq, r.name, r.efYd, r.issuer, r.noticeNo, r.ancYd, r.revisionType, r.altKey],
    ['2100000278572', '분말소화설비의 화재안전성능기준(NFPC 108)', '20260504', '소방청고시', '2026-15', '20260504', '일부개정', '20260504#2026-15'],
  );
  const m = RE_PROM.exec('소방청고시 제2026-15호, 2026. 5. 4., 일부개정');
  assert.deepEqual(m.slice(1), ['소방청고시', '2026-15', '2026', '5', '4', '일부개정']);
});

test('NFPC 107/107A 체인: 본문 없는 옛 버전(seq 비어 있던 행)도 대체 키로 맞출 수 있다', () => {
  const c107 = parseAdmChain(fixtureText(admChainRequest('2100000218508'))).rows;
  assert.ok(c107.some((r) => r.altKey === '20061230#2006-19'));
  const c107a = parseAdmChain(fixtureText(admChainRequest('2100000243628'))).rows;
  assert.ok(c107a.some((r) => r.altKey === '20090824#2009-31'));
});

test('래퍼: iframe src 의 &amp; 를 풀어 lsiSeq·efYd / admRulSeq 를 읽는다', () => {
  const law = fixtureText(wrapperRequest('law', DECREE));
  assert.match(law, /&amp;efYd=/);
  assert.deepEqual(
    (({ lsiSeq, efYd }) => ({ lsiSeq, efYd }))(parseWrapper(law)),
    { lsiSeq: '287375', efYd: '20260701' },
  );
  const adm = parseWrapper(fixtureText(wrapperRequest('admrul', '분말소화설비의 화재안전성능기준(NFPC 108)')));
  assert.equal(adm.admRulSeq, '2100000278572');
  assert.equal(parseWrapper('<html><title>국가법령정보센터 | 오류페이지</title></html>'), null);
  assert.equal(wrapperRequest('law', DECREE).url.includes('%EB%B2%95%EB%A0%B9/'), true, '한글 경로도 퍼센트 인코딩');
});

test('reOwn: 일괄개정 36220 에서 「시행령」의 개정 조(제51조)만 잘라내고 다음 조·생략 앞에서 멈춘다', () => {
  const html = fixtureText(lawDocRequest('284781', '20260324'));
  const doc = parseRevisionDoc(html, { kind: 'law', name: DECREE, revisionType: '타법개정' });
  assert.equal(doc.omnibus, true);
  assert.match(doc.amendment, /^제51조를 다음과 같이 한다\. 제51조\(규제의 재검토\)/);
  assert.doesNotMatch(doc.amendment, /생략|부칙|제67조/);
  assert.equal(doc.addenda, '이 영은 공포한 날부터 시행한다.');
  assert.equal(doc.impact, 'none');

  const synthetic =
    '제1조부터 제3조까지 생략 제4조(「소방시설 설치 및 관리에 관한 법률 시행령」의 개정) 소방시설 설치 및 관리에 관한 법률 시행령 일부를 다음과 같이 개정한다. 제5조 중 "A"를 "B"로 한다. ' +
    '제5조(「소방시설 설치 및 관리에 관한 법률 시행규칙」의 개정) 규칙 일부를 다음과 같이 개정한다. 제9조를 삭제한다.';
  const m = reOwn(DECREE).exec(synthetic);
  assert.ok(m);
  assert.match(m[1], /제5조 중 "A"를 "B"로 한다\.\s*$/);
  assert.doesNotMatch(m[1], /시행규칙|제9조/);
  // 띄어쓰기·가운뎃점이 달라도 찾는다
  assert.ok(reOwn('소방시설 설치ㆍ유지 및 안전관리에 관한 법률').exec('제9조(「소방시설설치·유지 및 안전관리에 관한 법률」의 개정) … 제10조부터 제12조까지 생략'));
});

test('개정문 발췌: 36432·628 은 자구 치환만(wording), 고시 2026-15 는 재검토 삭제(none)', () => {
  const d36432 = parseRevisionDoc(fixtureText(lawDocRequest('287375', '20260701')), { kind: 'law', name: DECREE, revisionType: '타법개정' });
  assert.equal(d36432.amendment, '제20조제2항제3호 중 "광역시장"을 "통합특별시장ㆍ광역시장"으로 한다.');
  assert.equal(d36432.impact, 'wording');
  const r628 = parseRevisionDoc(fixtureText(lawDocRequest('287831', '20260701')), {
    kind: 'law',
    name: '소방시설 설치 및 관리에 관한 법률 시행규칙',
    revisionType: '타법개정',
  });
  assert.equal(r628.impact, 'wording');
  assert.match(r628.amendment, /각각 "통합특별시장ㆍ광역시장"으로 한다\.$/);
  const n108 = parseRevisionDoc(fixtureText(admDocRequest('2100000278572')), { kind: 'admrul', name: '분말소화설비의 화재안전성능기준(NFPC 108)', revisionType: '일부개정' });
  assert.equal(n108.name, '분말소화설비의 화재안전성능기준(NFPC 108)');
  assert.equal(n108.amendment, '제18조를 삭제한다.');
  assert.equal(n108.addenda, '이 고시는 발령한 날부터 시행한다.');
  assert.match(n108.reason, /재검토기한을 삭제/);
  assert.equal(n108.impact, 'none');
});

test('normName: 공백·가운뎃점 변형·전각 괄호·말줄임을 같게 본다 (NFKC 없음)', () => {
  const a = normName('소방시설 설치·유지 및 안전관리에 관한 법률');
  assert.equal(a, normName('소방시설설치ㆍ유지및안전관리에관한법률'));
  assert.equal(a, normName('소방시설 설치‧유지 및 안전관리에 관한 법률'));
  assert.equal(a, normName('소방시설 설치・유지　및 안전관리에 관한 법률'));
  assert.equal(normName('비상방송설비의 화재안전성능기준（NFPC 202）'), '비상방송설비의화재안전성능기준(NFPC202)');
  assert.equal(normName('화재예방, 소방시설 설치ㆍ유지 및 안전관리에...'), '화재예방,소방시설설치ㆍ유지및안전관리에');
});

test('RE_TRANSIT: 부칙의 적용례·경과조치·특례·유효기간 조 제목을 찾는다', () => {
  const addenda =
    '제1조(시행일) 이 영은 공포 후 6개월이 경과한 날부터 시행한다. 제2조(스프링클러설비 설치에 관한 적용례) 별표 4의 개정규정은 이 영 시행 이후 건축허가등의 동의를 요구하는 경우부터 적용한다. ' +
    '제3조(비상전원에 관한 적용례) … 제4조(종전 기준에 따른 소방시설에 관한 경과조치) … 제5조(다른 법령의 개정) …';
  const heads = [...addenda.matchAll(RE_TRANSIT)].map((m) => m[0]);
  assert.deepEqual(heads, ['제2조(스프링클러설비 설치에 관한 적용례)', '제3조(비상전원에 관한 적용례)', '제4조(종전 기준에 따른 소방시설에 관한 경과조치)']);
  assert.equal(transitionalSummary(heads), '적용례 2, 경과조치 1 → 검토 필요');
  assert.equal(transitionalSummary([]), '');
});
