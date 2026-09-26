#!/usr/bin/env node
// 법령 개정 주간 감시 — CLI (네트워크·파일 I/O 담당, 판단 로직은 lib.mjs)
//
// 사용법
//   node scripts/law-watch/check.mjs [--out DIR] [--only id,..] [--no-crosscheck]
//        [--record [DIR]] [--replay DIR] [--data-dir DIR] [--registry FILE]
//        [--today YYYYMMDD] [--apply-history]
//   node scripts/law-watch/check.mjs --apply-from RESULT.json [--data-dir DIR]
//   node scripts/law-watch/check.mjs --bootstrap ID [--as-of YYYY-MM-DD]
//   node scripts/law-watch/check.mjs --ack ID[,ID..]
//
//   --apply-history  이번 실행에서 가져온 결과의 제안 행을 연혁 파일에 넣는다
//   --apply-from     이미 검토한 result.json 의 제안 행을 그대로 넣는다 (네트워크 없음 — 검토한 것 = 반영한 것)
//
// 종료 코드
//   0  모든 소스를 가져와 해석·대조했고 반영할 개정이 없음 (유일한 "최신" 판정)
//   10 반영할 개정 있음, 오류 없음
//   20 하나 이상의 소스 실패 (정상 소스의 개정은 그대로 보고)
//   30 설정·사용법 오류
//
// 장애 대비 — 어떤 경우든 result.json 은 끝까지 온 만큼 남긴다
//   · 실행 전체 기한 http.deadlineMs(기본 15분): 넘으면 남은 소스는 요청 없이 DEADLINE_EXCEEDED
//   · 회로 차단: 연속 3개 소스의 목록 요청이 전송 오류·5xx·429 로 실패하면 나머지는 SKIPPED_OUTAGE
//   · 소스 하나에서 예상 못 한 예외가 나도 INTERNAL_ERROR 로 기록하고 다음 소스로 넘어간다
//
// 기준선(baseline)
//   history : 연혁 파일 자체가 기준선이다. "변경 없음" ⇔ 사이트 데이터가 최신.
//   inline  : 레지스트리의 baseline.known 키 목록이 기준선이다. --bootstrap 으로 씨앗을 만들고
//             반영 후 --ack 로 키를 추가한다. 예)
//             { "id": "fire-decree", "kind": "law", "lsId": "014353",
//               "name": "화재의 예방 및 안전관리에 관한 법률 시행령",
//               "baseline": { "from": "inline", "asOf": "2026-01-20", "known": ["20250101:123456"] },
//               "affects": ["data/ref05_fire_safety_manager.json"] }
//   키 형식 — 법령 `${시행일}:${lsiSeq}`, 고시 `${admRulSeq}` (seq 없는 옛 행은 `${시행일}#${번호}`)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  DATA_FILE_RE,
  DEFAULT_HTTP,
  ENRICH_CAP,
  LAW_GO_KR,
  admChainRequest,
  admDocRequest,
  analyzeSource,
  baselineKeys,
  buildChange,
  crossCheck,
  currentAdmKey,
  exitCodeFor,
  expandSources,
  fingerprint,
  historyRowKey,
  insertHistoryRow,
  isValidKey,
  isValidYmd,
  lawDocRequest,
  lawListRequest,
  parseAdmChain,
  parseLawList,
  parseRevisionDoc,
  parseWrapper,
  renderReport,
  requestKey,
  snippet,
  statusFor,
  todayKst,
  validateRegistry,
  wrapperRequest,
} from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..', '..');
const DEFAULT_REGISTRY = path.join(REPO_ROOT, 'data', 'law_watch.json');
const DEFAULT_DATA_DIR = path.join(REPO_ROOT, 'data');

export const EXIT = Object.freeze({ OK: 0, CHANGES: 10, BROKEN: 20, CONFIG: 30 });
export const OUTAGE_TRIP = 3; // 연속 N개 소스의 목록 요청이 전송·5xx·429 로 실패하면 law.go.kr 장애로 본다

export const USAGE = `사용법:
  node scripts/law-watch/check.mjs [--out DIR] [--only id,..] [--no-crosscheck]
       [--record [DIR]] [--replay DIR] [--data-dir DIR] [--registry FILE]
       [--today YYYYMMDD] [--apply-history]
  node scripts/law-watch/check.mjs --apply-from RESULT.json [--data-dir DIR]
  node scripts/law-watch/check.mjs --bootstrap ID [--as-of YYYY-MM-DD]
  node scripts/law-watch/check.mjs --ack ID[,ID..]
종료 코드: 0 최신 · 10 개정 있음 · 20 소스 오류 · 30 설정/사용법 오류`;

export class ConfigError extends Error {}
export class BudgetError extends Error {
  code = 'BUDGET_EXCEEDED';
}
// 시간 예산(http.deadlineMs) 초과 — 요청 예산 초과와 똑같이 다룬다 (이후 소스도 요청하지 않고 실패)
export class DeadlineError extends BudgetError {
  code = 'DEADLINE_EXCEEDED';
}
export class FetchError extends Error {}

// ───────────────────────── 인자 ─────────────────────────

export function parseArgs(argv) {
  const o = { crosscheck: true };
  const list = (v) =>
    String(v)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      const v = argv[i + 1];
      if (v == null || v.startsWith('--')) throw new ConfigError(`${a} 에 값이 필요함`);
      i++;
      return v;
    };
    switch (a) {
      case '--out': o.out = val(); break;
      case '--only': o.only = list(val()); break;
      case '--no-crosscheck': o.crosscheck = false; break;
      case '--record': {
        const v = argv[i + 1];
        if (v != null && !v.startsWith('--')) { o.record = v; i++; } else o.record = true;
        break;
      }
      case '--replay': o.replay = val(); break;
      case '--data-dir': o.dataDir = val(); break;
      case '--registry': o.registry = val(); break;
      case '--today': o.today = val(); break;
      case '--apply-history': o.applyHistory = true; break;
      case '--apply-from': o.applyFrom = val(); break;
      case '--bootstrap': o.bootstrap = val(); break;
      case '--as-of': o.asOf = val(); break;
      case '--ack': o.ack = list(val()); break;
      case '-h':
      case '--help': o.help = true; break;
      default: throw new ConfigError(`알 수 없는 인자: ${a}`);
    }
  }
  if (o.today != null && !isValidYmd(o.today)) throw new ConfigError('--today 는 YYYYMMDD');
  if (o.asOf != null && !(/^\d{4}-\d{2}-\d{2}$/.test(o.asOf) && isValidYmd(o.asOf.replace(/-/g, '')))) throw new ConfigError('--as-of 는 YYYY-MM-DD');
  if (o.only && !o.only.length) throw new ConfigError('--only 목록이 비어 있음');
  if (o.ack && !o.ack.length) throw new ConfigError('--ack 목록이 비어 있음');
  if (o.ack && o.bootstrap) throw new ConfigError('--ack 와 --bootstrap 은 함께 쓸 수 없음');
  if (o.record && o.replay) throw new ConfigError('--record 와 --replay 는 함께 쓸 수 없음');
  if (o.applyFrom && (o.ack || o.bootstrap || o.applyHistory || o.only)) throw new ConfigError('--apply-from 은 --ack·--bootstrap·--apply-history·--only 와 함께 쓸 수 없음');
  return o;
}

// ───────────────────────── 파일 ─────────────────────────

function readJson(p, what = p) {
  let s;
  try {
    s = fs.readFileSync(p, 'utf8');
  } catch (e) {
    throw new ConfigError(`${what} 를 읽을 수 없음: ${e.code ?? e.message}`);
  }
  try {
    return JSON.parse(s.replace(/^﻿/, ''));
  } catch (e) {
    throw new ConfigError(`${what} JSON 해석 실패: ${e.message}`);
  }
}

// 레지스트리의 "data/…" 경로를 --data-dir 기준으로 바꾼다
export function dataPath(file, dataDir = DEFAULT_DATA_DIR) {
  const rel = String(file).replace(/\\/g, '/');
  return rel.startsWith('data/') ? path.join(dataDir, rel.slice('data/'.length)) : path.resolve(REPO_ROOT, rel);
}

export function loadConfig({ registry: registryPath = DEFAULT_REGISTRY, dataDir = DEFAULT_DATA_DIR, only } = {}) {
  const registry = readJson(registryPath, `레지스트리(${registryPath})`);
  const errs = validateRegistry(registry);
  if (errs.length) throw new ConfigError(`레지스트리 오류:\n  - ${errs.join('\n  - ')}`);
  const baselines = {};
  for (const s of registry.sources) {
    if (s.baseline.from === 'history' && !(s.baseline.file in baselines)) {
      baselines[s.baseline.file] = readJson(dataPath(s.baseline.file, dataDir), `기준 연혁 ${s.baseline.file}`);
    }
  }
  const { sources: all, errors } = expandSources(registry, baselines);
  if (errors.length) throw new ConfigError(`소스 확장 오류:\n  - ${errors.join('\n  - ')}`);
  let sources = all;
  if (only) {
    const unknown = only.filter((id) => !all.some((s) => s.id === id || s.group === id));
    if (unknown.length) throw new ConfigError(`--only 에 없는 소스 id: ${unknown.join(', ')}`);
    sources = all.filter((s) => only.includes(s.id) || (s.group && only.includes(s.group)));
  }
  for (const src of sources) {
    try {
      baselineKeys(src, baselines);
    } catch (e) {
      throw new ConfigError(e.message);
    }
  }
  return { registry, baselines, sources, allSources: all, dataDir };
}

// ───────────────────────── HTTP ─────────────────────────

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));
const noSleep = async () => {};

function decodeBody(buf, contentType) {
  let cs = /charset=["']?([\w-]+)/i.exec(contentType ?? '')?.[1];
  if (!cs) cs = /<meta[^>]+charset=["']?([\w-]+)/i.exec(new TextDecoder('latin1').decode(buf.subarray(0, 2048)))?.[1];
  const enc = /euc-?kr|ks_c_5601|cp949|windows-949/i.test(cs ?? '') ? 'euc-kr' : 'utf-8';
  return new TextDecoder(enc).decode(buf);
}

function retryAfterMs(v, nowMs) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s) * 1000;
  const t = Date.parse(s);
  return Number.isFinite(t) ? Math.max(0, t - nowMs) : null;
}

// 단일 큐: 요청 간격 delay±jitter, 요청당 timeout, 네트워크 오류·5xx·429 는 백오프 후 재시도,
// 그 밖의 4xx 는 재시도하지 않는다. 재시도를 포함한 모든 시도가 예산(maxRequests)에 들어간다.
// 시간 예산: 만든 시점부터 deadlineMs 가 지나면(기다림을 포함해 넘게 되면) 시도하지 않고 DeadlineError.
export function createHttp({ fetchImpl = globalThis.fetch, sleep = realSleep, random = Math.random, now = Date.now, config = DEFAULT_HTTP, recorder = null } = {}) {
  const cfg = { ...DEFAULT_HTTP, ...config };
  const deadline = now() + cfg.deadlineMs;
  const checkDeadline = (waitMs) => {
    if (now() + waitMs >= deadline) throw new DeadlineError(`실행 기한 ${cfg.deadlineMs / 60000}분 초과`);
  };
  let count = 0;
  let started = false;
  const headersFor = (req) => {
    const h = { 'User-Agent': cfg.userAgent, 'Accept-Language': 'ko-KR', Referer: 'https://www.law.go.kr/' };
    if (req.method === 'POST') {
      h['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
      h['X-Requested-With'] = 'XMLHttpRequest';
    }
    return h;
  };
  async function request(req) {
    for (let attempt = 0; ; attempt++) {
      if (count >= cfg.maxRequests) throw new BudgetError(`요청 예산 ${cfg.maxRequests}회 초과`);
      const gap = started ? Math.max(0, cfg.delayMs + Math.round((random() * 2 - 1) * cfg.jitterMs)) : 0;
      checkDeadline(gap);
      if (started) await sleep(gap);
      started = true;
      count++;
      let res = null;
      let err = null;
      try {
        const r = await fetchImpl(req.url, {
          method: req.method,
          headers: headersFor(req),
          body: req.method === 'POST' ? req.body : undefined,
          redirect: 'follow',
          // 기한 직전의 요청이 기한을 넘겨 매달리지 않도록 남은 시간으로 줄인다
          signal: AbortSignal.timeout(Math.max(1, Math.min(cfg.timeoutMs, deadline - now()))),
        });
        const buf = new Uint8Array(await r.arrayBuffer());
        const contentType = r.headers.get('content-type') ?? '';
        res = { status: r.status, contentType, bytes: buf.length, buf, text: decodeBody(buf, contentType), retryAfter: r.headers.get('retry-after') };
      } catch (e) {
        err = e;
      }
      const retryable = err ? !err.noRetry : res.status >= 500 || res.status === 429;
      let wait = cfg.backoffMs[Math.min(attempt, cfg.backoffMs.length - 1)] ?? 0;
      let giveUp = false;
      if (retryable && res) {
        const ra = retryAfterMs(res.retryAfter, now());
        if (ra != null && ra > cfg.retryAfterMaxMs) giveUp = true; // 너무 길면 기다리지 않고 포기
        else if (ra != null) wait = Math.max(wait, ra);
      }
      if (!retryable || giveUp || attempt >= cfg.retries) {
        if (err) throw new FetchError(`${err.name === 'TimeoutError' ? '시간 초과' : err.message} (${attempt + 1}회 시도)`);
        if (recorder) recorder.save(req, res);
        return res;
      }
      checkDeadline(wait);
      await sleep(wait);
    }
  }
  return {
    request,
    get count() {
      return count;
    },
  };
}

// 원문 기록: <DIR>/<sha1>.html + index.json
export function createRecorder(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const idxPath = path.join(dir, 'index.json');
  const index = fs.existsSync(idxPath) ? readJson(idxPath) : { version: 1, entries: {} };
  return {
    dir,
    save(req, res) {
      const key = requestKey(req);
      const file = `${key}.html`;
      fs.writeFileSync(path.join(dir, file), res.buf);
      index.entries[key] = { method: req.method, url: req.url, body: req.body ?? '', status: res.status, contentType: res.contentType, bytes: res.bytes, file };
    },
    finish({ runAt, todayKst: today }) {
      index.recordedAt = runAt;
      index.todayKst = today;
      fs.writeFileSync(idxPath, JSON.stringify(index, null, 2));
    },
  };
}

// 재생: 기록된 응답을 fetch 처럼 돌려준다(기록에 없는 요청은 재시도 없이 실패)
export function createReplayFetch(dir) {
  const index = readJson(path.join(dir, 'index.json'), `재생 색인 ${dir}`);
  const fn = async (url, init = {}) => {
    const req = { method: init.method ?? 'GET', url, body: init.body ?? '' };
    const e = index.entries[requestKey(req)];
    if (!e) {
      const err = new Error(`재생 기록 없음: ${req.method} ${url}${req.body ? ` ${req.body}` : ''}`);
      err.noRetry = true;
      throw err;
    }
    const buf = fs.readFileSync(path.join(dir, e.file));
    return new Response(buf, { status: e.status, headers: { 'content-type': e.contentType || 'text/html;charset=UTF-8' } });
  };
  fn.index = index;
  return fn;
}

// ───────────────────────── 소스 하나 점검 ─────────────────────────

async function checkSource(src, ctx) {
  const { http, baselines, today, crosscheck, enrich } = ctx;
  const out = { changes: [], warnings: [], errors: [] };
  const warn = (code, detail) => out.warnings.push({ sourceId: src.id, code, detail });
  const fail = (code, extra = {}) => {
    out.errors.push({ sourceId: src.id, code, ...extra });
    return out;
  };
  // 예산·기한 초과(BudgetError, DeadlineError)는 budget 로 구분한다 — 코드는 e.code
  const get = async (req) => {
    try {
      return { res: await http.request(req) };
    } catch (e) {
      if (e instanceof BudgetError) return { budget: true, error: e };
      if (e instanceof FetchError) return { error: e };
      throw e;
    }
  };

  const base = baselineKeys(src, baselines);
  for (const n of base.noSeq) {
    const r = n.row;
    warn('ROW_WITHOUT_SEQ', `${r.effective_date} ${r.notice_no ?? r.law_no ?? ''} — 링크에 seq 가 없어 대체 키 ${n.key ?? '(없음)'} 로 대조`);
  }

  // 1) 연혁 목록
  const req = src.kind === 'law' ? lawListRequest(src.lsId) : admChainRequest(src.anchorSeq);
  const got = await get(req);
  if (got.budget) return fail(got.error.code, { url: req.url, detail: got.error.message });
  // 전송 오류·5xx·429 로 목록을 못 받으면 장애 신호(outage) — 연속되면 checkMode 가 나머지를 건너뛴다
  out.outage = !!got.error || got.res.status >= 500 || got.res.status === 429;
  if (got.error) return fail('FETCH_FAILED', { url: req.url, detail: got.error.message });
  const res = got.res;
  const meta = { url: req.url, http: res.status, bytes: res.bytes };
  if (res.status !== 200) return fail('FETCH_FAILED', { ...meta, snippet: snippet(res.text) });
  const parsed = src.kind === 'law' ? parseLawList(res.text) : parseAdmChain(res.text);
  // 200 인데 행이 없으면 차단·오류 페이지일 수 있다 → "변경 없음"이 아니라 실패
  if (!parsed.rows.length) return fail('PARSE_ZERO_ROWS', { ...meta, snippet: snippet(res.text) });
  if (parsed.unparsed.length) return fail('PARSE_BAD_ROW', { ...meta, detail: `${parsed.unparsed.length}행 해석 실패`, snippet: parsed.unparsed[0] });

  // 2) 정합성 + 집합 차이
  const a = analyzeSource(src, base, parsed.rows);
  for (const w of a.warnings) warn(w.code, w.detail);
  if (a.errors.length) {
    for (const e of a.errors) fail(e.code, { ...meta, detail: e.detail });
    return out;
  }

  // 3) 이름 교차검증 (래퍼를 못 가져오면 소스는 경고만 — 절반 이상이면 checkMode 가 실행 오류로 올린다)
  if (crosscheck) {
    const wreq = wrapperRequest(src.kind, src.name);
    const w = await get(wreq);
    if (w.budget) return fail(w.error.code, { url: wreq.url, detail: w.error.message });
    out.crosscheck = 'unavailable';
    if (w.error) warn('CROSSCHECK_SKIPPED', `래퍼 요청 실패: ${w.error.message}`);
    else if (w.res.status !== 200) warn('CROSSCHECK_SKIPPED', `래퍼 HTTP ${w.res.status}`);
    else {
      const cc = crossCheck(src, parsed.rows, parseWrapper(w.res.text));
      if (cc.warning) warn(cc.warning.code, cc.warning.detail);
      else out.crosscheck = 'done';
      if (cc.error) return fail(cc.error.code, { url: wreq.url, http: w.res.status, bytes: w.res.bytes, detail: cc.error.detail });
    }
  }

  // 4) 보강: 개정문 발췌·제안 행·영향 추정 (seq 당 한 번, 실행당 상한)
  const currentKey = src.kind === 'admrul' ? currentAdmKey(parsed.rows, today) : null;
  const docs = new Map();
  let budgetHit = false;
  for (const row of a.pending) {
    let doc = null;
    if (docs.has(row.seq)) doc = docs.get(row.seq);
    else if (budgetHit) doc = null;
    else if (enrich.used >= enrich.cap) enrich.capped = true;
    else {
      enrich.used++;
      const dreq = src.kind === 'law' ? lawDocRequest(row.seq, row.efYd) : admDocRequest(row.seq);
      const d = await get(dreq);
      if (d.budget) {
        budgetHit = true;
        fail(d.error.code, { url: dreq.url, detail: d.error.message });
      } else if (d.error) warn('ENRICH_FAILED', `${row.key}: ${d.error.message}`);
      else if (d.res.status !== 200) warn('ENRICH_FAILED', `${row.key}: HTTP ${d.res.status}`);
      else {
        doc = parseRevisionDoc(d.res.text, { kind: src.kind, name: src.name, revisionType: row.revisionType });
        if (doc.empty) {
          warn('DOC_PARSE_EMPTY', `${row.key}: 개정문·개정이유 구획을 찾지 못함 (${snippet(d.res.text, 120)})`);
          doc = null;
        }
      }
      docs.set(row.seq, doc);
    }
    out.changes.push(buildChange(src, row, { today, currentKey, doc }));
  }
  return out;
}

// ───────────────────────── 모드 ─────────────────────────

function defaultOutDir(nowMs) {
  const stamp = new Date(nowMs).toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
  return path.join(os.tmpdir(), 'law-watch', stamp);
}

function writeOutputs(outDir, result, runUrl) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  const report = renderReport(result, { runUrl });
  fs.writeFileSync(path.join(outDir, 'report.md'), report);
  return report;
}

// GitHub Actions 실행 요약($GITHUB_STEP_SUMMARY)에 보고서를 붙인다 — 정상 실행의 경고처럼
// 이슈에 드러나지 않는 내용도 실행 페이지에서 보이게. 부가 기능이라 실패해도 결과는 그대로다.
function appendStepSummary(file, report, log) {
  if (!file) return;
  try {
    fs.appendFileSync(file, `${report}\n`);
  } catch (e) {
    log(`실행 요약을 쓰지 못함: ${e.message}`);
  }
}

export function applyHistory(changes, dataDir = DEFAULT_DATA_DIR) {
  const byFile = new Map();
  for (const c of changes) {
    if (!c.target || !c.suggestedRow) continue;
    if (!byFile.has(c.target)) byFile.set(c.target, []);
    byFile.get(c.target).push(c);
  }
  const written = [];
  for (const [file, list] of byFile) {
    const p = dataPath(file, dataDir);
    let json = readJson(p);
    for (const c of list) {
      if (c.targetKey != null) {
        if (!Array.isArray(json[c.targetKey])) throw new ConfigError(`${file} 에 키 '${c.targetKey}' 가 없음 (키 이름은 바꾸지 않는다)`);
        json[c.targetKey] = insertHistoryRow(json[c.targetKey], c.suggestedRow, c.kind);
      } else json = insertHistoryRow(json, c.suggestedRow, c.kind);
    }
    fs.writeFileSync(p, JSON.stringify(json, null, 2)); // 저장소 형식: 끝 개행 없음
    written.push({ file: p, rows: list.length });
  }
  return written;
}

// result.json 의 변경 항목을 연혁 파일에 넣어도 되는지 — --apply-from 은 파일 내용을 그대로 믿지 않는다
function applicableChange(c) {
  if (!c || typeof c !== 'object' || !['law', 'admrul'].includes(c.kind)) return false;
  if (c.target == null) return true; // inline 소스: 연혁 파일 없음(반영하지 않고 --ack 안내)
  if (typeof c.target !== 'string' || !DATA_FILE_RE.test(c.target)) return false;
  if (c.targetKey != null && typeof c.targetKey !== 'string') return false;
  const r = c.suggestedRow;
  const fields = ['name', 'effective_date', c.kind === 'law' ? 'law_no' : 'notice_no', 'promulgation_date', 'revision_type', 'link'];
  return (
    !!r &&
    typeof r === 'object' &&
    fields.every((k) => typeof r[k] === 'string' && r[k].length > 0) &&
    isValidYmd(r.effective_date) &&
    isValidYmd(r.promulgation_date) &&
    r.link.startsWith(`${LAW_GO_KR}/LSW/`) &&
    historyRowKey(c.kind, r).seq != null
  );
}

// 검토한 result.json 의 제안 행을 그대로 반영한다 (네트워크 없음). --apply-history 는 그 자리에서 다시
// 가져온 결과를 넣으므로 검토한 뒤 사이트가 바뀌면 검토하지 않은 행이 들어갈 수 있다.
async function applyFromMode(opts, deps) {
  const log = deps.log ?? ((m) => process.stderr.write(`${m}\n`));
  const file = path.resolve(opts.applyFrom);
  const res = readJson(file, `결과 파일(${file})`);
  if (res?.schemaVersion !== 1 || !Array.isArray(res.changes)) throw new ConfigError(`--apply-from: ${file} 는 check.mjs 의 result.json 이 아님`);
  const bad = res.changes.filter((c) => !applicableChange(c)).map((c) => c?.id ?? '?');
  if (bad.length) throw new ConfigError(`--apply-from: 반영할 수 없는 항목 ${bad.join(', ')} (target 은 data/*.json, suggestedRow 는 law.go.kr 연혁 행 형식)`);
  const written = applyHistory(res.changes, opts.dataDir ?? DEFAULT_DATA_DIR);
  for (const w of written) log(`연혁 반영: ${w.file} (+${w.rows}행)`);
  const inline = res.changes.filter((c) => !c.target);
  if (inline.length) log(`inline 소스 변경 ${inline.length}건은 연혁 파일이 없으므로 --ack 로 확인 처리하세요.`);
  if (!res.changes.length) log(`--apply-from: 반영할 변경 없음 (${res.status ?? '?'})`);
  return EXIT.OK;
}

async function checkMode(opts, deps) {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((m) => process.stderr.write(`${m}\n`));
  const t0 = now();
  const runAt = new Date(t0).toISOString();
  const outDir = path.resolve(opts.out ?? defaultOutDir(t0));
  const runUrl = deps.runUrl ?? process.env.RUN_URL ?? '';
  const stepSummary = deps.stepSummary ?? process.env.GITHUB_STEP_SUMMARY;
  let config;
  try {
    config = loadConfig({ registry: opts.registry, dataDir: opts.dataDir, only: opts.only });
  } catch (e) {
    if (e instanceof ConfigError) {
      const report = writeOutputs(outDir, {
        schemaVersion: 1, runAt, todayKst: opts.today ?? todayKst(new Date(t0)), status: 'broken', exitCode: EXIT.CONFIG,
        scope: opts.only ? { only: opts.only, sources: [] } : null,
        fingerprint: fingerprint([]), stats: { sources: 0, healthy: 0, requests: 0, ms: now() - t0 },
        changes: [], warnings: [], errors: [{ sourceId: '-', code: 'CONFIG_INVALID', detail: e.message }],
      }, runUrl);
      appendStepSummary(stepSummary, report, log);
    }
    throw e;
  }
  // --only 로 일부 소스만 본 실행임을 결과에 남긴다 → 이슈 동기화가 부분 결과로 이슈를 닫거나 상태를 줄이지 않는다
  const scope = opts.only ? { only: opts.only, sources: config.sources.map((s) => s.id) } : null;

  const replay = opts.replay ? createReplayFetch(path.resolve(opts.replay)) : null;
  const recordDir = opts.record === true ? path.join(outDir, 'raw') : opts.record ? path.resolve(opts.record) : null;
  const recorder = recordDir ? createRecorder(recordDir) : null;
  const today = opts.today ?? replay?.index.todayKst ?? todayKst(new Date(t0));
  const http = createHttp({
    fetchImpl: deps.fetchImpl ?? replay ?? globalThis.fetch,
    sleep: deps.sleep ?? (replay ? noSleep : realSleep),
    random: deps.random ?? Math.random,
    now,
    config: config.registry.http ?? {},
    recorder,
  });
  const ctx = { http, baselines: config.baselines, today, crosscheck: opts.crosscheck !== false, enrich: { used: 0, cap: ENRICH_CAP, capped: false } };

  const changes = [];
  const warnings = [];
  const errors = [];
  let healthy = 0;
  let outageRun = 0; // 목록 요청이 장애로 실패한 연속 소스 수
  const cc = { tried: 0, missed: 0 }; // 이름 교차검증을 시도한 소스 / 그중 하지 못한 소스
  const n = config.sources.length;
  for (const [i, src] of config.sources.entries()) {
    let r;
    if (outageRun >= OUTAGE_TRIP) {
      const detail = `연속 ${OUTAGE_TRIP}개 소스의 목록 요청이 실패해 law.go.kr 장애로 보고 요청하지 않음`;
      r = { changes: [], warnings: [], errors: [{ sourceId: src.id, code: 'SKIPPED_OUTAGE', detail }] };
    } else {
      try {
        r = await checkSource(src, ctx);
      } catch (e) {
        // 소스 하나의 예상 못 한 예외로 나머지 결과(result.json)까지 잃지 않는다
        r = { changes: [], warnings: [], errors: [{ sourceId: src.id, code: 'INTERNAL_ERROR', detail: String(e?.stack ?? e).slice(0, 500) }] };
      }
      outageRun = r.outage ? outageRun + 1 : 0;
    }
    if (r.crosscheck) {
      cc.tried++;
      if (r.crosscheck === 'unavailable') cc.missed++;
    }
    changes.push(...r.changes);
    warnings.push(...r.warnings);
    errors.push(...r.errors);
    if (!r.errors.length) healthy++;
    const note = r.errors.length ? `오류 ${r.errors.map((e) => e.code).join(',')}` : r.changes.length ? `변경 ${r.changes.length}건` : '변경 없음';
    log(`[${String(i + 1).padStart(2)}/${n}] ${src.id.padEnd(12)} ${note}`);
  }
  if (ctx.enrich.capped) warnings.push({ sourceId: '-', code: 'ENRICH_CAPPED', detail: `개정문 조회 상한 ${ENRICH_CAP}건을 넘어 나머지는 발췌 없이 보고` });
  // 교차검증이 절반 이상에서 안 되면 안전망이 사실상 꺼진 것 — 경고가 아니라 실행 오류(exit 20)
  if (cc.tried && cc.missed * 2 >= cc.tried) {
    errors.push({
      sourceId: '-',
      code: 'CROSSCHECK_UNAVAILABLE',
      detail: `이름 교차검증을 ${cc.tried}개 소스 중 ${cc.missed}개에서 하지 못함(절반 이상) — 래퍼 페이지 형식이 바뀌었거나 이름 조회가 막혔을 수 있음`,
    });
  }

  const exitCode = exitCodeFor(changes, errors);
  const result = {
    schemaVersion: 1,
    runAt,
    todayKst: today,
    status: statusFor(exitCode),
    exitCode,
    scope,
    fingerprint: fingerprint(changes.map((c) => c.id)),
    stats: { sources: n, healthy, requests: http.count, ms: now() - t0 },
    changes,
    warnings,
    errors,
  };
  appendStepSummary(stepSummary, writeOutputs(outDir, result, runUrl), log);
  if (recorder) recorder.finish({ runAt, todayKst: today });
  log(`결과: ${result.status} (exit ${exitCode}) · 변경 ${changes.length} · 경고 ${warnings.length} · 오류 ${errors.length} · 요청 ${http.count} → ${outDir}`);

  if (opts.applyHistory) {
    const written = applyHistory(changes, config.dataDir);
    for (const w of written) log(`연혁 반영: ${w.file} (+${w.rows}행)`);
    const inline = changes.filter((c) => !c.target);
    if (inline.length) log(`inline 소스 변경 ${inline.length}건은 연혁 파일이 없으므로 --ack 로 확인 처리하세요.`);
  }
  return exitCode;
}

function lastCommitDate(file) {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cs', '--', file], { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(out) ? out : null;
  } catch {
    return null;
  }
}

// 라이브 목록에서 공포일 ≤ asOf 인 키를 출력 → inline baseline.known 씨앗
async function bootstrapMode(opts, deps) {
  const log = deps.log ?? ((m) => process.stderr.write(`${m}\n`));
  const print = deps.print ?? ((m) => process.stdout.write(`${m}\n`));
  const config = loadConfig({ registry: opts.registry, dataDir: opts.dataDir });
  const src = config.allSources.find((s) => s.id === opts.bootstrap);
  if (!src) throw new ConfigError(`--bootstrap: 레지스트리에 없는 소스 id ${opts.bootstrap}`);
  const asOf = opts.asOf ?? (src.affects[0] ? lastCommitDate(src.affects[0]) : null);
  if (!asOf) throw new ConfigError('--as-of 를 정할 수 없음 (affects 첫 파일의 커밋 날짜 없음) — --as-of YYYY-MM-DD 를 지정하세요');
  const replay = opts.replay ? createReplayFetch(path.resolve(opts.replay)) : null;
  const http = createHttp({
    fetchImpl: deps.fetchImpl ?? replay ?? globalThis.fetch,
    sleep: deps.sleep ?? (replay ? noSleep : realSleep), // 실제 요청이면 재시도 백오프를 지킨다
    config: config.registry.http ?? {},
  });
  const req = src.kind === 'law' ? lawListRequest(src.lsId) : admChainRequest(src.anchorSeq);
  let res;
  try {
    res = await http.request(req);
  } catch (e) {
    log(`목록 요청 실패: ${e.message}`);
    return EXIT.BROKEN;
  }
  const parsed = res.status === 200 ? (src.kind === 'law' ? parseLawList(res.text) : parseAdmChain(res.text)) : { rows: [], unparsed: [] };
  if (!parsed.rows.length || parsed.unparsed.length) {
    log(`목록 해석 실패 (HTTP ${res.status}, 행 ${parsed.rows.length}, 해석 실패 ${parsed.unparsed.length}): ${snippet(res.text, 200)}`);
    return EXIT.BROKEN;
  }
  const cut = asOf.replace(/-/g, '');
  const known = parsed.rows.filter((r) => r.ancYd <= cut).map((r) => r.key);
  print(JSON.stringify({ id: src.id, asOf, known }, null, 2));
  log(`${src.id}: 라이브 ${parsed.rows.length}행 중 공포일 ≤ ${asOf} 인 키 ${known.length}개 — 레지스트리 baseline.known 에 넣으세요.`);
  return EXIT.OK;
}

// inline 기준선에 키 추가 (네트워크 없음). id 는 변경 항목 id `${소스id}:${키}`
async function ackMode(opts, deps) {
  const log = deps.log ?? ((m) => process.stderr.write(`${m}\n`));
  const regPath = path.resolve(opts.registry ?? DEFAULT_REGISTRY);
  const reg = readJson(regPath, `레지스트리(${regPath})`);
  const errs = validateRegistry(reg);
  if (errs.length) throw new ConfigError(`레지스트리 오류:\n  - ${errs.join('\n  - ')}`);
  let added = 0;
  for (const id of opts.ack) {
    const i = id.indexOf(':');
    const srcId = i > 0 ? id.slice(0, i) : '';
    const key = i > 0 ? id.slice(i + 1) : '';
    const s = reg.sources.find((x) => x.id === srcId);
    if (!s) throw new ConfigError(`--ack: 소스 id 를 찾을 수 없음: ${id}`);
    if (s.baseline.from !== 'inline') throw new ConfigError(`--ack: ${srcId} 는 history 기준선 — 연혁 파일 반영(--apply-history)으로 처리하세요`);
    if (!isValidKey(s.kind, key)) throw new ConfigError(`--ack: 키 형식 오류 ${id}`);
    if (!s.baseline.known.includes(key)) {
      s.baseline.known.push(key);
      added++;
    }
  }
  fs.writeFileSync(regPath, JSON.stringify(reg, null, 2));
  log(`--ack: ${added}개 키 추가 (${opts.ack.length - added}개는 이미 있음) → ${regPath}`);
  return EXIT.OK;
}

export async function main(argv, deps = {}) {
  const log = deps.log ?? ((m) => process.stderr.write(`${m}\n`));
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    log(`사용법 오류: ${e.message}\n${USAGE}`);
    return EXIT.CONFIG;
  }
  if (opts.help) {
    (deps.print ?? ((m) => process.stdout.write(`${m}\n`)))(USAGE);
    return EXIT.OK;
  }
  try {
    if (opts.ack) return await ackMode(opts, deps);
    if (opts.applyFrom) return await applyFromMode(opts, deps);
    if (opts.bootstrap) return await bootstrapMode(opts, deps);
    return await checkMode(opts, deps);
  } catch (e) {
    if (e instanceof ConfigError) {
      log(`설정 오류: ${e.message}`);
      return EXIT.CONFIG;
    }
    throw e;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      process.stderr.write(`치명적 오류: ${e?.stack ?? e}\n`);
      process.exitCode = 1;
    },
  );
}
