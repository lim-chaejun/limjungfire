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

## 0. 이슈 찾기, 작업 브랜치 만들기

```bash
gh issue list --label law-update --state open --json number,title,body
```

- 본문 맨 앞의 `<!-- law-watch:state {"fp":"…","ids":[…]} -->` 에서 **fp(지문)** 와 id 목록을 적어 둔다.
- 열린 `law-update` 이슈가 없으면 사용자에게 알리고 끝낸다.
- 추적 중인 파일에 커밋하지 않은 변경이 없어야 한다. `git status --porcelain --untracked-files=no` 가 비어 있지 않으면
  **중단**하고 사용자에게 묻는다. 추적하지 않는 파일·폴더(`.omc/`, `.claude/worktrees/` 등)는 막지 않는다 — 브랜치를
  바꿔도 그대로 남고, `origin/main` 의 파일과 겹치면 git 이 switch 를 거부하므로 덮어쓸 일이 없다.
- 감시·수정은 모두 **최신 `origin/main` 에서 만든 브랜치**에서 한다 (오래되거나 손댄 체크아웃에서 돌리면
  "이미 반영됨"을 잘못 판단하거나 로컬 `main` 에서 수정을 시작하게 된다):
  ```bash
  git fetch origin
  git switch -c "claude/law-update-$(date +%Y%m%d)" origin/main   # 이미 있으면 -$(date +%H%M) 을 덧붙인다
  ```

## 1. 현재 변경 목록 다시 뽑기

```bash
OUT="$(node -e "console.log(require('os').tmpdir())")/law-watch-claude"
node scripts/law-watch/check.mjs --out "$OUT"      # 요청 약 90회, 4분 안팎
echo "exit=$?"
```

| exit | 의미 | 할 일 |
|---|---|---|
| 0 | 반영할 개정 없음 | 이슈에 "이미 반영됨(origin/main 기준)"을 알리고 끝낸다 |
| 10 | 개정 있음 | `$OUT/result.json` 의 `changes` 로 진행 (이슈 fp 와 달라도 **새 결과**가 기준) |
| 20 | 소스 오류 | 아래 "exit 20 일 때" |
| 30 | 설정 오류 | 메시지를 보고하고 중단 |

**exit 20 일 때** — `result.json` 의 `errors` 를 본다.
- `sourceId` 가 `-` 인 **실행 오류**(`CROSSCHECK_UNAVAILABLE` 등)가 하나라도 있으면 결과 전체를 믿을 수 없다 → **중단**하고 오류를 이슈에 보고한다.
- 소스별 오류만 있으면 그 소스들만 건너뛴다. `changes` 에는 **목록 대조를 마친 소스의 변경만** 들어 있으므로 그대로
  진행하고(개정문 조회에서 멈춘 항목은 `excerpt` 가 비어 있다 — 2단계에서 원문을 직접 읽는다), 오류 표(소스·코드·내용)는
  이슈 댓글과 PR 의 **주의** 절에 옮긴다. `changes` 가 비어 있으면 오류만 보고하고 끝낸다.

`result.json` 의 각 change 에는 `link`(원문), `suggestedRow`(연혁 행 제안), `excerpt`(개정문·부칙·이유 발췌),
`impactGuess`(추정), `target`/`targetKey`(반영할 연혁 파일), `affects`(기준 변경 시 볼 파일)가 있다.
`impactGuess` 는 키워드 추정일 뿐이다 — 분류는 아래 3단계에서 직접 한다.

**경고도 본다** (`warnings`):
- `ANCHOR_REKEYED` — 기준선 맨 앞 행(흔히 시행예정 행)의 **시행일이 바뀌었다**(시행 연기 등). 새 시행일 행은 change 로,
  옛 시행일 키는 `KNOWN_NOT_LIVE` 로 나온다. 5단계에서 새 행을 넣은 뒤 **옛 시행일 행을 연혁 파일에서 지우고**,
  기준 데이터가 옛 시행일(`start_date`/`end_date`)을 쓰고 있으면 새 시행일로 옮긴다. PR **주의** 절에 원문과 함께 적는다.
- `KNOWN_NOT_LIVE` 만 있으면(앵커 변경 없음) 라이브 목록에서 사라진 연혁 행이다 — 원문을 확인해 PR 에 보고하고, 근거 없이 지우지 않는다.

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
| `needs-review` | 원문만으로 판단 근거가 부족함 | 연혁 행만 추가하고 PR 에 명시 + **`law-needs-review` 이슈에 올린다**(7단계) — **추측 금지** |

`needs-review` 를 이슈로 따로 올리는 이유: 연혁 행은 PR 로 들어가므로 merge 뒤 감시는 그 항목을 "반영됨"으로 보고
`law-update` 이슈를 닫는다. 판단이 남은 항목은 `law-needs-review` 이슈로만 추적된다.

## 4. 부칙은 필수로 읽는다

- **단계별 시행일**: 부칙이 조항마다 시행일을 다르게 정하면 시행일별로 나눠 적용한다 (감시 도구도 시행일마다 별도 change 로 보고한다).
- **적용례**: 흔히 "…이 영 시행 이후 **건축허가등의 동의를 요구(신청)하는 경우부터** 적용한다" 형태다. 이것은 *신청일* 기준인데
  사이트는 *허가일*(permit date) 기준으로 기준을 고른다. 이 차이를 해당 regulation 의 `note` 에 **원문 그대로** 적는다.
- **경과조치·소급 적용**: `note` 에 원문을 적고, PR 본문의 **'주의'** 절에도 옮긴다.
- `excerpt.transitional` 에 적용례·경과조치 조 제목이 나오면(예: "적용례 2, 경과조치 1 → 검토 필요") 빠짐없이 확인한다.

## 5. 수정

1. **연혁 파일** — 분류와 무관하게 연혁 행은 항상 추가한다. 1단계에서 검토한 결과 파일을 **그대로** 반영한다
   (다시 가져오지 않으므로 검토한 것과 반영하는 것이 같다, 네트워크 없음):
   ```bash
   node scripts/law-watch/check.mjs --apply-from "$OUT/result.json"
   ```
   `suggestedRow` 를 시행일 내림차순(동률이면 공포일 늦은 것 → 번호 큰 것 먼저)으로 끼워 넣고 `no` 를 다시 매긴다.
   `git diff data/law_history_*.json data/nfsc_history.json` 로 행 이름·번호가 원문과 맞는지 확인한다.
   (`ANCHOR_REKEYED` 가 있었다면 여기서 옛 시행일 행을 지우고 `no` 를 1..N 으로 다시 매긴다.)
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
   node scripts/law-watch/check.mjs --out "$OUT-after" --no-crosscheck --only <반영한 change 의 sourceId 들>   # exit 0 이어야 한다
   ```
   이 확인은 반영한 항목이 목록 대조에서 사라졌는지만 본다. 이름 교차검증(래퍼)은 1단계에서 이미 했으므로
   `--no-crosscheck` 로 끈다 — 래퍼 한 번의 일시 오류로 확인이 멈추지 않게.
   1단계가 exit 10 이었으면 `--only` 없이 전체로 돌려 exit 0 을 확인해도 된다. exit 20 이었으면 오류 소스를 빼고
   `--only` 로 돌린다 (같은 오류가 다시 나는 것은 이 PR 의 실패가 아니다).

## 6. 커밋·PR

- 브랜치는 0단계에서 만든 `claude/law-update-YYYYMMDD`. `main` 에 push·merge 금지.
  ```bash
  git add data/ && git commit -m "fix(data): 법령 개정 반영 N건 (YYYY-MM-DD 감시)"
  git push -u origin HEAD
  gh pr create --draft --base main --title "법령 개정 반영: N건 (YYYY-MM-DD 감시)" --body-file "$OUT/pr-body.md"
  ```
- 본문(`pr-body.md`) 구성:
  1. 요약 표 — `대상 | 번호 | 시행일 | 분류 | 수정 파일`
  2. change 마다: 원문 인용(개정문·부칙, 조문 번호 포함) + 원문 링크
  3. 적용례·경과조치 해석 (신청일 기준 vs 허가일 기준 차이 포함) — **주의** 절. exit 20 이었으면 오류 표, `ANCHOR_REKEYED` 처리도 여기에
  4. `needs-review` 목록, 판단을 보류한 이유, `law-needs-review` 이슈 링크
  5. 리뷰 체크리스트:
     - [ ] 연혁 행 이름·번호·시행일·공포일이 원문과 일치
     - [ ] criteria 변경이 영향 파일 전부에 반영됨 (`end_date` = 새 시행일 − 1일)
     - [ ] 적용례·경과조치가 `note` 에 원문 그대로 기록됨
     - [ ] `validate-data`·테스트 통과, 재감시에서 해당 항목 사라짐
  6. 마지막 줄들: `law-watch-fp: <fp>` 와 `Refs #<이슈 번호>`
- 이슈에 PR 링크와 세 줄 요약(몇 건, 분류별 건수, 주의 사항)을 댓글로 단다.

## 7. needs-review 항목은 `law-needs-review` 이슈로

`needs-review` 가 하나라도 있으면 **열린 `law-needs-review` 이슈 하나**에 모은다 — 없으면 만들고, 있으면 댓글로 덧붙인다:

```bash
gh label create law-needs-review --force --color 5319e7 --description "법령 개정 검토 필요 — 원문만으로 판단 보류 (law-update 절차가 만들고 사람이 닫음)"
N=$(gh issue list --label law-needs-review --state open --json number --jq '.[0].number')
if [ -z "$N" ]; then
  gh issue create --title "법령 개정 검토 필요 (needs-review)" --label law-needs-review --body-file "$OUT/needs-review.md"
else
  gh issue comment "$N" --body-file "$OUT/needs-review.md"
fi
```

`needs-review.md` 에는 항목마다: change id, 대상·번호·시행일, **원문 링크**, **원문 인용**(개정문·부칙, 조문 번호 포함),
판단을 보류한 이유, 확인할 파일(`affects`), PR 링크. 이 이슈는 사람이 판단을 마친 뒤 닫는다 — law-watch 는 라벨만 만들고
이 이슈를 열거나 닫지 않는다.

## 참고: 이슈 수명

- `law-update` 이슈는 닫지 않는다 — PR 이 merge 된 뒤 다음 주간 감시가 "반영 확인" 댓글을 달고 자동으로 닫는다.
- 반영하지 않고 **사람이 직접 닫으면**, 감시는 같은 항목 목록(지문)으로는 **30일 동안** 이슈를 다시 만들지 않는다.
  30일이 지나거나 새 개정이 더해지면(지문이 바뀌면) 다시 연다. 잠시 미루려면 닫지 말고 `law-watch-hold` 라벨을 붙인다(14일 리마인더만 멈춘다).
- `law-watch-broken` 이슈는 오류 없는 전체 실행에서 자동으로 닫히고, 오류가 남아 있으면 사람이 닫아도 다음 실행에서 다시 열린다.
- 수동 실행(workflow_dispatch)에서 `only` 를 쓰거나 기본 브랜치가 아니면 이슈 동기화는 항상 dry-run 이다 (부분 결과로 이슈를 닫지 않는다).
