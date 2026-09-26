#!/usr/bin/env node
// law-watch 결과 → GitHub 이슈 동기화 (GitHub Actions 전용, gh CLI 사용)
// 판단은 순수 함수 planActions() 가 하고, main() 은 그 결과를 gh 명령으로 실행한다.
//
// 사용법: node scripts/law-watch/sync-issues.mjs --out DIR --code N [--dry-run] [--issues-json FILE] [--now ISO]
//   --dry-run      gh 쓰기 명령을 실행하지 않고 출력만 한다
//   --issues-json  열린 이슈 목록을 gh 대신 파일(gh issue list --json 과 같은 배열)에서 읽는다 (시험용)
// 환경변수: RUN_URL (실행 링크), GH_TOKEN (gh 인증)
//
// 규칙
//   · 라벨 law-update / law-watch-broken / law-watch-hold 를 만든다(--force: 있으면 갱신).
//   · 개정이 있으면 law-update 이슈(본문 표지 포함)를 만들거나 본문·제목을 조용히 고친다.
//     댓글(=알림)은 이전 상태 표지에 없던 새 id 가 있을 때만 단다.
//   · 정상 실행에서 반영할 개정이 없으면 "반영 확인" 댓글을 달고 닫는다.
//   · --only 부분 실행(result.scope)은 어떤 이슈도 닫지 않고, 범위 밖 소스의 이전 항목을 상태에 남긴다.
//   · 이슈가 14일 넘게 열려 있으면 리마인더 댓글을 한 번만 단다(law-watch-hold 라벨이면 생략).
//   · 실패한 실행은 별도 이슈(<!-- law-watch:broken -->)로 알리고, 오류 구성(코드+소스)이 바뀔 때만
//     댓글을 단다. 다음 오류 없는 실행에서 자동으로 닫는다.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { MARKER_BROKEN, MARKER_LAW, STATE_RE, fingerprint, fmtYmd, parseState, renderReport, stateMarker } from './lib.mjs';

export const LABELS = [
  { name: 'law-update', color: 'd93f0b', description: '법령 개정 반영 필요 (law-watch 자동 생성)' },
  { name: 'law-watch-broken', color: 'b60205', description: '법령 감시 실행 실패 (law-watch 자동 생성)' },
  { name: 'law-watch-hold', color: 'fbca04', description: '법령 감시 보류 — 14일 리마인더를 보내지 않음' },
];
export const MARKER_REMINDER = '<!-- law-watch:reminder -->';
export const BROKEN_SIG_RE = /<!-- law-watch:broken-sig (\{.*?\}) -->/;
export const REMIND_AFTER_DAYS = 14;

const labelNames = (issue) => (issue?.labels ?? []).map((l) => (typeof l === 'string' ? l : l?.name));
const ageDays = (createdAt, now) => (now.getTime() - Date.parse(createdAt)) / 86400000;

// 본문의 상태 표지를 주어진 id 목록으로 바꾼다(없으면 맨 앞에 넣는다)
export function withState(body, ids) {
  const marker = stateMarker(fingerprint(ids), ids);
  let b = String(body ?? '');
  b = STATE_RE.test(b) ? b.replace(STATE_RE, () => marker) : `${marker}\n${b}`;
  return b.includes(MARKER_LAW) ? b : `${MARKER_LAW}\n${b}`;
}

export function errorSignature(result, code) {
  if (!result) return `RUN_FAILED:exit${code}`;
  const errs = result.errors ?? [];
  if (!errs.length) return `EXIT:${code}`;
  return [...new Set(errs.map((e) => `${e.code}:${e.sourceId}`))].sort().join(',');
}

export function parseBrokenSig(body) {
  const m = BROKEN_SIG_RE.exec(String(body ?? ''));
  if (!m) return null;
  try {
    return String(JSON.parse(m[1]).sig ?? '');
  } catch {
    return null;
  }
}

const cell = (s) => String(s ?? '').replace(/[<>]/g, '').replace(/\|/g, '\\|').replace(/\s+/g, ' ');

function brokenBody(result, code, runUrl, sig) {
  const L = [MARKER_BROKEN, `<!-- law-watch:broken-sig ${JSON.stringify({ sig })} -->`, ''];
  if (!result) L.push(`**법령 감시 실행 실패** — 결과 파일이 없습니다 (exit ${code}).`);
  else {
    L.push(`**법령 감시 실행 실패** (exit ${code}) — 소스 ${result.stats?.sources ?? '?'}개 중 정상 ${result.stats?.healthy ?? '?'}개`);
    if (result.errors?.length) {
      L.push('', '| 소스 | 코드 | HTTP | 내용 | URL |', '|---|---|---|---|---|');
      for (const e of result.errors) L.push(`| \`${cell(e.sourceId)}\` | ${cell(e.code)} | ${e.http ?? ''} | ${cell([e.detail, e.snippet].filter(Boolean).join(' / '))} | ${cell(e.url)} |`);
    }
  }
  L.push('', runUrl ? `실행: ${runUrl} (원문 응답은 아티팩트의 raw/ 참고)` : '실행 링크 없음', '');
  L.push('다음 오류 없는 실행에서 이 이슈는 자동으로 닫힙니다. 파서 수정이 필요하면 아티팩트의 원문으로 test/fixtures 를 갱신하세요.');
  return L.join('\n');
}

function newIdsComment(newIds, changes, runUrl) {
  const byId = new Map(changes.map((c) => [c.id, c]));
  const L = [`새로 감지된 개정 ${newIds.length}건:`];
  for (const id of newIds) {
    const c = byId.get(id);
    L.push(c ? `- \`${id}\` ${c.title} ${c.number} (시행 ${fmtYmd(c.efYd)}, ${c.revisionType})` : `- \`${id}\``);
  }
  if (runUrl) L.push('', `실행: ${runUrl}`);
  return L.join('\n');
}

// 순수 함수: 결과 + 열린 이슈 → 해야 할 일 목록
export function planActions({ result = null, reportMd = '', code, runUrl = '', now = new Date(), lawIssue = null, brokenIssue = null } = {}) {
  const actions = LABELS.map((l) => ({ type: 'label', ...l }));
  const codeNum = Number(code);
  const healthyRun = !!result && (codeNum === 0 || codeNum === 10) && result.status !== 'broken';
  // --only 로 일부 소스만 본 실행: 범위 밖 소스의 항목은 상태에 남기고, 어떤 이슈도 닫지 않는다
  const scope = Array.isArray(result?.scope?.sources) ? new Set(result.scope.sources) : null;
  const changes = result?.changes ?? [];
  const ids = [...new Set(changes.map((c) => c.id))].sort();
  const runLine = runUrl ? `\n\n실행: ${runUrl}` : '';

  // ── 법령 개정 이슈 ──
  let closingLaw = false;
  if (changes.length) {
    const prevIds = new Set(lawIssue ? (parseState(lawIssue.body)?.ids ?? []) : []);
    const failed = new Set((result?.errors ?? []).map((e) => e.sourceId));
    // 이번에 보지 못한 소스(실패했거나 --only 범위 밖)의 이전 항목은 상태에 남긴다
    // → 다음 전체 실행에서 "새 항목" 알림이 다시 가지 않는다
    const unseen = (src) => (!healthyRun && failed.has(src)) || (scope != null && !scope.has(src));
    const carried = [...prevIds].filter((id) => !ids.includes(id) && unseen(id.split(':')[0]));
    const stateIds = [...new Set([...ids, ...carried])].sort();
    let body = withState(reportMd || renderReport(result, { runUrl }), stateIds);
    if (carried.length) body += `\n\n> 이번 실행에서 보지 못한 소스(오류 또는 --only 범위 밖)의 이전 항목 ${carried.length}건은 그대로 유지합니다: ${carried.map((id) => `\`${id}\``).join(', ')}`;
    const title = `법령 개정 반영 필요: ${stateIds.length}건`;
    if (!lawIssue) actions.push({ type: 'create', title, body, labels: ['law-update'] });
    else {
      const newIds = ids.filter((id) => !prevIds.has(id));
      if ((healthyRun && !scope) || newIds.length) actions.push({ type: 'edit', number: lawIssue.number, title, body });
      if (newIds.length) actions.push({ type: 'comment', number: lawIssue.number, body: newIdsComment(newIds, changes, runUrl) });
    }
  } else if (healthyRun && !scope && result.status === 'ok' && lawIssue) {
    actions.push({ type: 'comment', number: lawIssue.number, body: `반영 확인 — 최신 감시에서 반영할 개정이 없습니다. 이슈를 닫습니다.${runLine}` });
    actions.push({ type: 'close', number: lawIssue.number });
    closingLaw = true;
  }
  if (
    lawIssue &&
    !closingLaw &&
    ageDays(lawIssue.createdAt, now) > REMIND_AFTER_DAYS &&
    !labelNames(lawIssue).includes('law-watch-hold') &&
    !(lawIssue.comments ?? []).some((c) => String(c?.body ?? '').includes(MARKER_REMINDER))
  ) {
    actions.push({
      type: 'comment',
      number: lawIssue.number,
      body: `${MARKER_REMINDER}\n이 이슈가 ${REMIND_AFTER_DAYS}일 넘게 열려 있습니다. \`law-update\` 절차(Claude 반영)로 처리하거나, 보류하려면 \`law-watch-hold\` 라벨을 붙여 주세요.${runLine}`,
    });
  }

  // ── 실행 실패 이슈 ──
  if (!healthyRun) {
    const sig = errorSignature(result, code);
    const failedCount = new Set((result?.errors ?? []).map((e) => e.sourceId)).size;
    const title = result && failedCount ? `법령 감시 실패: 소스 ${failedCount}개 오류` : `법령 감시 실패: 실행 오류(exit ${code})`;
    const body = brokenBody(result, code, runUrl, sig);
    if (!brokenIssue) actions.push({ type: 'create', title, body, labels: ['law-watch-broken'] });
    else {
      const prevSig = parseBrokenSig(brokenIssue.body);
      actions.push({ type: 'edit', number: brokenIssue.number, title, body });
      if (prevSig !== sig) actions.push({ type: 'comment', number: brokenIssue.number, body: `오류 구성이 바뀌었습니다: \`${sig}\`${runLine}` });
    }
  } else if (brokenIssue && !scope) {
    actions.push({ type: 'comment', number: brokenIssue.number, body: `정상화 확인 — 오류 없이 실행되었습니다. 이슈를 닫습니다.${runLine}` });
    actions.push({ type: 'close', number: brokenIssue.number });
  }
  return actions;
}

// 열린 이슈 배열(gh issue list --json 형식)에서 표지로 대상 이슈를 고른다
export function pickIssues(list) {
  const open = (list ?? []).filter((i) => (i.state ?? 'OPEN').toUpperCase() === 'OPEN');
  const pick = (label, marker) =>
    open.filter((i) => labelNames(i).includes(label) && String(i.body ?? '').includes(marker)).sort((a, b) => a.number - b.number)[0] ?? null;
  return { lawIssue: pick('law-update', MARKER_LAW), brokenIssue: pick('law-watch-broken', MARKER_BROKEN) };
}

export function ghArgs(a) {
  switch (a.type) {
    case 'label':
      return ['label', 'create', a.name, '--force', '--color', a.color, '--description', a.description];
    case 'create':
      return ['issue', 'create', '--title', a.title, '--body-file', '-', ...a.labels.flatMap((l) => ['--label', l])];
    case 'edit':
      return ['issue', 'edit', String(a.number), ...(a.title ? ['--title', a.title] : []), '--body-file', '-'];
    case 'comment':
      return ['issue', 'comment', String(a.number), '--body-file', '-'];
    case 'close':
      return ['issue', 'close', String(a.number)];
    default:
      throw new Error(`알 수 없는 동작: ${a.type}`);
  }
}

function gh(args, input) {
  return execFileSync('gh', args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'] });
}

function listOpenIssues() {
  const fields = 'number,title,body,createdAt,labels,comments,state';
  const out = [];
  for (const label of ['law-update', 'law-watch-broken']) {
    out.push(...JSON.parse(gh(['issue', 'list', '--state', 'open', '--label', label, '--limit', '50', '--json', fields]) || '[]'));
  }
  return out;
}

export function main(argv, deps = {}) {
  const log = deps.log ?? ((m) => process.stdout.write(`${m}\n`));
  const o = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') o.dryRun = true;
    else if (['--out', '--code', '--issues-json', '--now'].includes(a) && argv[i + 1] != null) o[a.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = argv[++i];
    else {
      process.stderr.write(`알 수 없는 인자: ${a}\n`);
      return 2;
    }
  }
  if (!o.out) {
    process.stderr.write('--out DIR 가 필요합니다\n');
    return 2;
  }
  const read = (f) => (fs.existsSync(path.join(o.out, f)) ? fs.readFileSync(path.join(o.out, f), 'utf8') : null);
  let result = null;
  try {
    result = read('result.json') ? JSON.parse(read('result.json')) : null;
  } catch {
    result = null;
  }
  const reportMd = read('report.md') ?? '';
  const code = o.code ?? String(result?.exitCode ?? '');
  const exec = (a) => {
    const args = ghArgs(a);
    const input = a.body ?? undefined;
    if (o.dryRun) {
      log(`[dry-run] gh ${args.map((x) => (/[\s"']/.test(x) ? JSON.stringify(x) : x)).join(' ')}${input ? `  (본문 ${input.length}자: ${JSON.stringify(input.split('\n')[0].slice(0, 80))})` : ''}`);
    } else {
      gh(args, input);
      log(`gh ${args.slice(0, 3).join(' ')} … 완료`);
    }
  };
  // 라벨을 먼저 만든다 — 첫 실행에서도 라벨 필터 조회가 확실히 동작하도록
  for (const l of LABELS) exec({ type: 'label', ...l });
  const issues = pickIssues(o.issuesJson ? JSON.parse(fs.readFileSync(o.issuesJson, 'utf8')) : listOpenIssues());
  const actions = planActions({ result, reportMd, code, runUrl: process.env.RUN_URL ?? '', now: o.now ? new Date(o.now) : new Date(), ...issues });
  for (const a of actions) if (a.type !== 'label') exec(a);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
