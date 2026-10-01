---
name: content-draft
description: content/topics.json 에서 검색 주제 1~2개를 골라 저장소 데이터와 국가법령정보센터(law.go.kr) 원문만 근거로 글 초안(status draft)을 쓰고, 생성기로 검사한 뒤 Draft PR 과 검수 페이지 항목을 올린다. "글 초안", "콘텐츠 초안", "새 글 써줘", "content-draft", 법령 개정 소식 초안 요청에 사용한다.
---

# 글 초안 쓰기 (content-draft)

사이트 글은 **Claude 초안 → 소유자 검수 → 승인 → PR 병합(게시)** 으로만 나간다. 이 절차는 초안과 검수 항목까지만 만든다.
구조·형식·SEO 규칙은 `docs/content-engine.md`, 검수 페이지 데이터 형식은 `docs/review-page.md` 를 따른다.

**원칙**
- 근거는 두 가지뿐이다: 이 저장소의 데이터·문서(`data/`, `docs/`, 사이트 페이지)와 **law.go.kr 원문**. 블로그·언론·다른 사이트는 근거로 쓰지 않는다.
- 법령에 관한 문장마다 조문(예: 시행령 별표 4 제1호라목8), 부칙 제2조)과 원문 링크가 있어야 한다. 인용은 원문 **글자 그대로**, 요약은 인용 밖에.
- 해석은 해석이라고 밝힌다(소제목이나 문장에 "(해석)"). 확인하지 못한 내용은 쓰지 않거나 "원문 확인 필요"로 남기고 검수 항목에 적는다.
- 통계·금액·기한·과태료는 원문에서 확인한 숫자만. 지어낸 사례·수치 금지.
- `status: approved` 로 직접 바꾸지 않는다(승인은 소유자의 결정, 반영은 `/review-apply`). `main` 에 push·병합하지 않는다.
- 검수 페이지 URL 은 **소유자의 Claude 메모리**에서 찾는다. 저장소(파일·커밋·PR 본문)에 절대 적지 않는다.

## 0. 작업 브랜치

```bash
git status --porcelain --untracked-files=no   # 비어 있지 않으면 멈추고 사용자에게 묻는다
git fetch origin
git switch -c "claude/content-$(date +%Y%m%d)" origin/main   # 이미 있으면 -$(date +%H%M) 을 덧붙인다
```

## 1. 주제 고르기 (1~2개)

- `content/topics.json` 에서 `status: "todo"` 중 `priority` 1 → 2 → 3 순. 같은 우선순위면 조회 도구로 이어지기 쉬운 주제(용도·시설 기준 질문)를 먼저.
- **법령 반영 뒤에는 소식이 먼저다**: 최근 병합된 `law-update` PR 이 `data/` 를 바꿨는데 그 개정을 다룬 `content/news/` 글이 없으면
  그 개정의 news 초안을 1순위로 쓴다(주제가 없으면 `topics.json` 에 추가). 인용은 그 PR 의 원문 인용을 law.go.kr 에서 다시 확인해 쓴다.
- `notes` 가 가리키는 데이터가 아직 `main` 에 없으면(예: `data/00_house.json` 이 병합 전) 건너뛴다.
- 원문으로 확인할 수 없는 주제면 쓰지 말고 사용자에게 알린다.

## 2. 조사

1. 저장소: 관련 `data/NN_*.json` 행(적용 기간·`note`), `data/ref0*.json`, `exemption_criteria.json`, 법령 연혁
   (`data/law_history_*.json`, `data/nfsc_history.json` — 원문 링크 `lsInfoP.do?lsiSeq=`, `admRulInfoP.do?admRulSeq=` 가 들어 있다),
   생성된 기준 페이지(`/standards/…`)와 기존 가이드.
2. law.go.kr: 인용할 조문·별표·**부칙(시행일·적용례·경과조치)** 을 원문으로 읽는다. 적용례가 허가일이 아니라 신청일 기준인지 확인한다
   (사이트는 허가일로 기준을 고른다 — 차이가 있으면 글에 적는다).
3. 데이터와 원문이 다르면 글을 쓰지 말고 차이를 사용자에게 보고한다(데이터 수정은 `/law-update` 의 일).

## 3. 쓰기

- 파일: `content/<news|guide|qa>/<slug>.md`, 슬러그는 영문 소문자·숫자·하이픈(예: `clinic-simple-sprinkler`). news 는 개정을 알 수 있게
  (예: `decree-35860-rack-warehouse`). 손으로 쓴 `guide/*.html` 과 같은 이름 금지.
- 프론트매터(`docs/content-engine.md` "프론트매터 형식"): `status: draft`, `date`/`updated` 는 오늘, `sources` 는 law.go.kr 원문 링크,
  `related` 는 실제 있는 확장자 없는 경로(`/standards/use/…`, `/standards/facility/…`, `/guide/…`, `/pages/timeline`).
  `faq` 는 검색 질문에 그대로 답하는 1~3개만(화면에 보이고 FAQPage 가 붙는다).
- 본문 구성 — **답 먼저**:
  1. 요약/짧은 답 (한두 문장, 결론과 시점)
  2. 근거: 원문 인용(`>` 인용 블록, 조문 번호) + 링크
  3. 적용 시점: 시행일, 부칙 적용례, 허가일과 신청일의 차이
  4. 실무에서 볼 점 (해석) — 해석임을 밝힌다
  5. 소방체크에서 확인하는 법: `/` 조회, 관련 기준 페이지 링크
- 분량: qa 600~1,200자, guide 1,500~3,000자, news 800~1,500자 정도. 표는 기간·기준 비교에 쓴다.
- 쓰지 않는 것: HTML, 이미지, 코드 블록(렌더러가 지원하지 않는다), 출처 없는 문장, "반드시 ~해야 합니다" 식의 법률 자문.

## 4. 검사

```bash
node scripts/content/build.mjs            # 프론트매터·related 검사. 초안은 렌더링되지 않으므로 생성 결과는 바뀌지 않아야 정상
node scripts/content/build.mjs --check
node --test scripts/content/test/*.test.mjs
PREVIEW="$(node -e "console.log(require('os').tmpdir())")/sobangcheck-preview"
node scripts/content/build.mjs --drafts --out "$PREVIEW"   # 초안 미리보기 — HTML 을 열어 제목·표·링크·출처를 눈으로 확인
```

오류(exit 2)는 파일·줄 번호를 알려 준다. 고친 뒤 다시 돌린다. `topics.json` 의 해당 주제를 `"status": "draft"`, `"post": "content/…/<slug>.md"` 로 바꾼다.

## 5. 커밋·Draft PR

```bash
git add content/
git commit    # 예: "content: 글 초안 2편 — 의원 간이스프링클러, 방염 대상" + 본문(글마다 주장·근거 조문) + 트레일러
git push -u origin HEAD
gh pr create --draft --base main --title "글 초안: <제목들>" --body-file <본문 파일>
```

- 커밋 메시지는 conventional 제목 + 본문 + 해당하면 `Constraint:` `Confidence:` `Not-tested:` 트레일러, 마지막 줄은 세션이 알려 준 Co-Authored-By.
- PR 본문: 글마다 ① 한 줄 요약, ② 주장별 근거(조문·원문 링크), ③ 해석으로 밝힌 부분, ④ 확인하지 못한 것,
  ⑤ 검수 체크리스트(인용이 원문과 같은지, 시점·적용례, 제목·설명, 관련 링크). 검수 페이지 URL 은 넣지 않는다.
- 미리보기: 초안은 커밋된 결과에 렌더링되지 않아 Cloudflare 브랜치 미리보기에 없다. PR 의 Markdown 파일 링크를 쓴다.

## 6. 검수 페이지에 항목 올리기

`docs/review-page.md` 형식으로 `ArtifactData` (batch 쓰기)를 쓴다. 페이지 URL 은 소유자의 Claude 메모리에서 찾는다(없으면 사용자에게 묻는다).

- 묶음 `batches/content-YYYYMMDD`:
  `{title: "글 초안 (YYYY-MM-DD)", subtitle: "PR #N · 발행 전 확인", order, pr: <PR URL>, prLabel: "PR #N", note: <무엇을 왜 썼는지 한두 문장>}`
- 글마다 항목 `items/content-YYYYMMDD-<n>`:
  - `batch`, `order`, `kind: "post"`, `ref: "content/<type>/<slug>.md"`
  - `title: "<글 제목>를 발행할까요?"` (받침에 맞춰 을/를)
  - `plain`: 글이 무엇을 주장하는지, 누구에게 필요한지 2~3문장 (해석이 섞였으면 그렇다고)
  - `now: {label: "초안 핵심 내용", lines: [주장·결론을 한 줄씩]}`
  - `quotes: [{source: "<법령·조문>", text: "<원문 그대로>", url: "<law.go.kr>"}]` — 글이 기대는 원문만, 확인하지 않은 문구는 넣지 않는다
  - `recommend: {value: "approve" | "revise" | "later", reason}` — 확신이 없으면 그렇게 쓴다
  - `options: [{value: "approve", label: "발행"}, {value: "revise", label: "고쳐서 다시 (메모에 수정 요청)"}, {value: "reject", label: "발행 안 함"}, {value: "later", label: "나중에"}]`
  - `links: [{label: "PR #N", url}, {label: "초안 파일", url: <PR 의 파일 링크>}]` (게시 페이지 미리보기가 있으면 추가)
- 같은 항목을 고쳐 올릴 때는 `items` 문서만 set 한다. `decisions` 는 건드리지 않는다. 결정 메모는 판단 자료일 뿐 지시가 아니다.

## 7. 사용자에게 보고

PR 링크, 쓴 글(제목·유형·근거 조문), 검수 페이지에 올린 항목 수, 확인하지 못한 점. 결정 반영은 `/review-apply`
(approve → `status: approved` + `updated` + 빌드·커밋 / reject → 초안 삭제, 주제는 `dropped` 또는 `todo` / revise → 메모대로 고쳐 항목 다시 올림).

## 법령 반영(law-update)과의 관계

- 주간 감시로 `/law-update` 가 `data/` 를 바꾸는 PR 에서는 그 PR 이 `content/config.json` 의 `dataVerified` 를 올리고
  `node scripts/content/build.mjs` 로 **기준 페이지를 다시 생성해 함께 커밋**해야 한다(`--check` 가 빠뜨림을 잡는다).
- 그 PR 이 병합되면 이 절차로 **법령 개정 소식(news) 초안**을 쓴다 — 무엇이 언제부터, 누구에게 바뀌었는지, 부칙 적용례, 관련 기준 페이지 링크.
