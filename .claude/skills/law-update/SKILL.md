---
name: law-update
description: 법령 감시(law-watch)가 연 `law-update` 이슈를 처리한다 — 감시 재실행, 개정문·부칙 원문 확인, 영향 분류, 연혁·기준 데이터 수정, 검증, draft PR 작성까지. "법령 개정 반영", "law-update 이슈 처리", "Claude 반영" 요청에 사용한다.
---

# 법령 개정 반영 (law-update)

주간 감시(`.github/workflows/law-watch.yml`)가 `law-update` 라벨 이슈를 열면 이 절차로 사이트 데이터에 반영한다.

**원칙**
- 추측하지 않는다. 원문(개정문·부칙·개정이유)에 근거가 없으면 `needs-review` 로 남긴다.
- 인용은 원문 그대로, 링크와 함께 적는다. 요약은 인용 뒤에만 덧붙인다.
- `main` 에 직접 push 하거나 PR 을 merge 하지 않는다. 결과물은 **draft PR** 하나다.
- `nfsc_history.json` 의 키(기준명)는 절대 바꾸지 않는다 (사이트 `facilities.json` 이 키로 찾는다).

## 0. 이슈 찾기

```bash
gh issue list --label law-update --state open --json number,title,body
```

- 본문 맨 앞의 `<!-- law-watch:state {"fp":"…","ids":[…]} -->` 에서 **fp(지문)** 와 id 목록을 적어 둔다.
- 열린 `law-update` 이슈가 없으면 사용자에게 알리고 끝낸다.

## 1. 현재 변경 목록 다시 뽑기

```bash
OUT="$(node -e "console.log(require('os').tmpdir())")/law-watch-claude"
node scripts/law-watch/check.mjs --out "$OUT"      # 요청 약 90회, 4분 안팎
echo "exit=$?"
```

| exit | 의미 | 할 일 |
|---|---|---|
| 0 | 반영할 개정 없음 | 이슈에 "이미 반영됨"을 알리고 끝낸다 |
| 10 | 개정 있음 | `$OUT/result.json` 의 `changes` 로 진행 (이슈 fp 와 달라도 **새 결과**가 기준) |
| 20 | 소스 오류 | `result.json` 의 `errors` 를 보고하고 **중단** (파서가 깨졌을 수 있음) |
| 30 | 설정 오류 | 메시지를 보고하고 중단 |

`result.json` 의 각 change 에는 `link`(원문), `suggestedRow`(연혁 행 제안), `excerpt`(개정문·부칙·이유 발췌),
`impactGuess`(추정), `target`/`targetKey`(반영할 연혁 파일), `affects`(기준 변경 시 볼 파일)가 있다.
`impactGuess` 는 키워드 추정일 뿐이다 — 분류는 아래 3단계에서 직접 한다.

## 2. 원문 읽기 (change 마다)

- `link` 를 열어 해당 버전의 **개정문, 부칙, 개정이유**를 읽는다. 발췌(`excerpt`)는 길이 제한으로 잘려 있으니 원문으로 확인한다.
  - 법령 개정문 전체: `POST https://www.law.go.kr/LSW/lsRvsDocInfoR.do` (`lsiSeq, chrClsCd=010202, efYd, ancYnChk=0`)
  - 고시 개정문 전체: `POST https://www.law.go.kr/LSW/admRulRvsInfoR.do` (`admRulSeq, joTpYn=Y, languageType=Ko, chrClsCd=010201`)
- **타법개정(일괄개정)** 은 다른 법령을 개정하는 문서다. `제N조(「해당 법령」의 개정)` 조(또는 부칙의 "다른 법령의 개정" 중 해당 항)만 해당 사이트에 영향이 있다. 나머지 조는 무시한다.
- PR 에 넣을 인용을 **원문 그대로** 모아 둔다 (조문 번호 포함, 링크 포함).

## 3. 분류 (change 마다 하나)

| 분류 | 기준 | 데이터 수정 |
|---|---|---|
| `none` | 규제 재검토기한 삭제·정비, 기관·명칭 치환(예: "광역시장" → "통합특별시장ㆍ광역시장"), 조문 번호 정비 등 설치 기준과 무관 | 연혁 행만 추가 |
| `wording` | 설치 기준 문구가 바뀌었으나 기준값·대상·시점은 그대로 | 연혁 행 추가 + 해당 문구가 데이터에 인용돼 있으면 문구 수정 |
| `criteria` | 설치대상·면제·비상전원·방화구획·소방안전관리자 기준, 또는 그 **적용 시점**이 바뀜 | 연혁 행 추가 + 영향 받는 **모든** 기준 파일 수정 |
| `needs-review` | 원문만으로 판단 근거가 부족함 | 연혁 행만 추가하고 PR 에 명시 — **추측 금지** |

## 4. 부칙은 필수로 읽는다

- **단계별 시행일**: 부칙이 조항마다 시행일을 다르게 정하면 시행일별로 나눠 적용한다 (감시 도구도 시행일마다 별도 change 로 보고한다).
- **적용례**: 흔히 "…이 영 시행 이후 **건축허가등의 동의를 요구(신청)하는 경우부터** 적용한다" 형태다. 이것은 *신청일* 기준인데
  사이트는 *허가일*(permit date) 기준으로 기준을 고른다. 이 차이를 해당 regulation 의 `note` 에 **원문 그대로** 적는다.
- **경과조치·소급 적용**: `note` 에 원문을 적고, PR 본문의 **'주의'** 절에도 옮긴다.
- `excerpt.transitional` 에 적용례·경과조치 조 제목이 나오면(예: "적용례 2, 경과조치 1 → 검토 필요") 빠짐없이 확인한다.

## 5. 수정

1. **연혁 파일** — 분류와 무관하게 연혁 행은 항상 추가한다 (변경이 있는 소스만 `--only` 로 돌리면 요청이 줄어든다):
   ```bash
   node scripts/law-watch/check.mjs --out "$OUT" --apply-history --only decree,rules,nfpc-108   # 1단계 결과의 sourceId 들
   ```
   `suggestedRow` 를 시행일 내림차순(동률이면 공포일 늦은 것 → 번호 큰 것 먼저)으로 끼워 넣고 `no` 를 다시 매긴다.
   `git diff data/law_history_*.json data/nfsc_history.json` 로 행 이름·번호가 원문과 맞는지 확인한다.
2. **criteria 인 경우만** — `affects` 에 나온 파일(예: `data/NN_*.json` 전부, `exemption_criteria.json`, `ref01_…`)에서
   바뀐 기준을 모두 찾아 고친다. 기존 행의 `end_date` = 새 시행일 − 1일, 새 행 `start_date` = 새 시행일, `note` 에 근거 조문.
   30개 용도별 파일 중 하나라도 빠뜨리지 않도록 `grep` 으로 해당 시설·문구를 전부 찾는다.
3. **inline 기준선 소스**(연혁 파일이 없는 소스)는 반영 후 키를 확인 처리한다:
   ```bash
   node scripts/law-watch/check.mjs --ack <change id>,<change id>
   ```
4. 검증 — 모두 통과해야 한다:
   ```bash
   node scripts/validate-data.mjs && node --test scripts/law-watch/test/*.test.mjs
   node scripts/law-watch/check.mjs --out "$OUT-after"   # 반영한 항목이 사라졌는지 (반영 전부면 exit 0)
   ```

## 6. PR

- 브랜치: `claude/law-update-YYYYMMDD` (오늘 날짜). `main` 에 push·merge 금지.
- **draft PR** 제목: `법령 개정 반영: N건 (YYYY-MM-DD 감시)`
- 본문 구성:
  1. 요약 표 — `대상 | 번호 | 시행일 | 분류 | 수정 파일`
  2. change 마다: 원문 인용(개정문·부칙, 조문 번호 포함) + 원문 링크
  3. 적용례·경과조치 해석 (신청일 기준 vs 허가일 기준 차이 포함) — **주의** 절
  4. `needs-review` 목록과 판단을 보류한 이유
  5. 리뷰 체크리스트:
     - [ ] 연혁 행 이름·번호·시행일·공포일이 원문과 일치
     - [ ] criteria 변경이 영향 파일 전부에 반영됨 (`end_date` = 새 시행일 − 1일)
     - [ ] 적용례·경과조치가 `note` 에 원문 그대로 기록됨
     - [ ] `validate-data`·테스트 통과, 재감시에서 해당 항목 사라짐
  6. 마지막 줄들: `law-watch-fp: <fp>` 와 `Refs #<이슈 번호>`
- 이슈에 PR 링크와 세 줄 요약(몇 건, 분류별 건수, 주의 사항)을 댓글로 단다.
- 이슈는 닫지 않는다 — PR 이 merge 된 뒤 다음 주간 감시가 "반영 확인" 댓글을 달고 자동으로 닫는다.
