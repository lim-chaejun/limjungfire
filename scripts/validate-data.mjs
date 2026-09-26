#!/usr/bin/env node
// 데이터 가드 — data/*.json 정합성 검사
// 검사는 "이름 있는 검사"의 배열(CHECKS)이다. 새 검사는 { name, description, run(ctx) } 를 추가하면 된다.
// run(ctx) 는 문제 목록 [{ file, at, detail }] 을 돌려준다. KNOWN_ISSUES 에 맞는 문제는 경고로 내린다.
//
// 사용법: node scripts/validate-data.mjs [--data-dir DIR]
// 종료 코드: 0 통과(경고 허용) · 1 오류

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expandSources, historyCmp, historyRowKey, isValidYmd, validateRegistry } from './law-watch/lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_DIR = path.resolve(HERE, '..', 'data');

// seq 없는 옛 고시 연혁 2행 — law.go.kr 에서도 본문 없는 버전이라 링크에 seq 가 비어 있다
export const ALLOW_NO_SEQ = [
  { file: 'nfsc_history.json', key: '할론소화설비의 화재안전기준(NFSC 107)', effective_date: '20061230', notice_no: '소방청고시 제2006-19호' },
  {
    file: 'nfsc_history.json',
    key: '할로겐화합물 및 불활성기체소화설비의 화재안전기준(NFSC 107A)',
    effective_date: '20090824',
    notice_no: '소방방재청고시 제2009-31호',
  },
];

// 이미 알고 있으나 당장 고치지 않는 문제 → 오류 대신 경고. { check, file, contains } 로 지정한다.
export const KNOWN_ISSUES = [];

const LAW_HISTORY_RE = /^law_history_.+\.json$/;
const NFSC_FILE = 'nfsc_history.json';
const CATEGORY_RE = /^[0-3][0-9]_.+\.json$/;
const LINK_RE = /^https:\/\/www\.law\.go\.kr\/LSW\/(?:lsInfoP|admRulInfoP)\.do\?/;

// ───────────────────────── 파일 적재 ─────────────────────────

export function loadDataDir(dir) {
  const files = new Map();
  for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const raw = fs.readFileSync(path.join(dir, name), 'utf8');
    try {
      files.set(name, { raw, json: JSON.parse(raw.replace(/^﻿/, '')), error: null });
    } catch (e) {
      files.set(name, { raw, json: undefined, error: e.message });
    }
  }
  return files;
}

// 단위 테스트용: { '파일명': 값 } → 파일 맵 (문자열 값은 원문으로 취급)
export function filesFromObject(obj) {
  const files = new Map();
  for (const [name, v] of Object.entries(obj)) {
    if (typeof v === 'string') {
      try {
        files.set(name, { raw: v, json: JSON.parse(v), error: null });
      } catch (e) {
        files.set(name, { raw: v, json: undefined, error: e.message });
      }
    } else files.set(name, { raw: JSON.stringify(v, null, 2), json: v, error: null });
  }
  return files;
}

const json = (ctx, name) => {
  const f = ctx.files.get(name);
  return f && !f.error ? f.json : undefined;
};

// 연혁 목록들: 법령 연혁 파일(배열) + nfsc_history.json(기준명 → 배열)
function historyLists(ctx) {
  const lists = [];
  for (const [name, f] of ctx.files) {
    if (f.error) continue;
    if (LAW_HISTORY_RE.test(name) && Array.isArray(f.json)) lists.push({ file: name, key: null, kind: 'law', rows: f.json });
    if (name === NFSC_FILE && f.json && typeof f.json === 'object' && !Array.isArray(f.json)) {
      for (const [key, rows] of Object.entries(f.json)) if (Array.isArray(rows)) lists.push({ file: name, key, kind: 'admrul', rows });
    }
  }
  return lists;
}

const where = (l, i) => `${l.key ? `['${l.key}']` : ''}[${i}]`;
const rowLabel = (r) => `${r?.effective_date ?? '?'} ${r?.law_no ?? r?.notice_no ?? ''}`.trim();

function isAllowedNoSeq(l, r, allow) {
  return allow.some((a) => a.file === l.file && a.key === l.key && a.effective_date === r.effective_date && a.notice_no === r.notice_no);
}

// ───────────────────────── 검사 목록 ─────────────────────────

export const CHECKS = [
  {
    name: 'json-parse',
    description: '모든 data/*.json 이 JSON 으로 해석된다',
    run(ctx) {
      return [...ctx.files].filter(([, f]) => f.error).map(([file, f]) => ({ file, at: '', detail: `JSON 해석 실패: ${f.error}` }));
    },
  },
  {
    name: 'history-shape',
    description: '연혁 파일이 있고, 행마다 필수 필드가 문자열로 있다',
    run(ctx) {
      const out = [];
      const names = [...ctx.files.keys()];
      if (!names.some((n) => LAW_HISTORY_RE.test(n))) out.push({ file: 'law_history_*.json', at: '', detail: '법령 연혁 파일이 없음' });
      if (!ctx.files.has(NFSC_FILE)) out.push({ file: NFSC_FILE, at: '', detail: '파일이 없음' });
      for (const [name, f] of ctx.files) {
        if (f.error) continue;
        if (LAW_HISTORY_RE.test(name) && !Array.isArray(f.json)) out.push({ file: name, at: '', detail: '최상위가 배열이 아님' });
        if (name === NFSC_FILE && (typeof f.json !== 'object' || Array.isArray(f.json) || f.json == null)) {
          out.push({ file: name, at: '', detail: '최상위가 {기준명: 배열} 객체가 아님' });
        } else if (name === NFSC_FILE) {
          for (const [k, v] of Object.entries(f.json)) if (!Array.isArray(v) || !v.length) out.push({ file: name, at: `['${k}']`, detail: '연혁이 비어 있거나 배열이 아님' });
        }
      }
      for (const l of historyLists(ctx)) {
        const numField = l.kind === 'law' ? 'law_no' : 'notice_no';
        l.rows.forEach((r, i) => {
          if (!r || typeof r !== 'object') return out.push({ file: l.file, at: where(l, i), detail: '행이 객체가 아님' });
          const missing = ['name', 'effective_date', numField, 'promulgation_date', 'revision_type', 'link'].filter((k) => typeof r[k] !== 'string');
          if (!Number.isInteger(r.no)) missing.unshift('no');
          if (missing.length) out.push({ file: l.file, at: where(l, i), detail: `필드 누락/형식 오류: ${missing.join(', ')}` });
        });
      }
      return out;
    },
  },
  {
    name: 'history-dates',
    description: '연혁의 시행일·공포일이 올바른 YYYYMMDD 이다',
    run(ctx) {
      const out = [];
      for (const l of historyLists(ctx)) {
        l.rows.forEach((r, i) => {
          for (const k of ['effective_date', 'promulgation_date']) {
            if (!isValidYmd(r?.[k])) out.push({ file: l.file, at: where(l, i), detail: `${k} 가 올바른 날짜가 아님: ${r?.[k]}` });
          }
        });
      }
      return out;
    },
  },
  {
    name: 'history-order',
    description: '시행일 내림차순, 동률이면 공포일 늦은 것 → 번호 큰 것 순서',
    run(ctx) {
      const out = [];
      for (const l of historyLists(ctx)) {
        for (let i = 1; i < l.rows.length; i++) {
          const a = l.rows[i - 1];
          const b = l.rows[i];
          if (!a || !b) continue;
          if (String(b.effective_date) > String(a.effective_date)) {
            out.push({ file: l.file, at: where(l, i), detail: `시행일 역순: ${rowLabel(a)} 다음에 ${rowLabel(b)}` });
          } else if (historyCmp(a, b) > 0) {
            out.push({ file: l.file, at: where(l, i), detail: `동률 순서 위반(공포일 늦은 것 → 번호 큰 것 먼저): ${rowLabel(a)} / ${rowLabel(b)}` });
          }
        }
      }
      return out;
    },
  },
  {
    name: 'history-numbering',
    description: 'no 가 1..N 으로 이어진다',
    run(ctx) {
      const out = [];
      for (const l of historyLists(ctx)) {
        l.rows.forEach((r, i) => {
          if (r?.no !== i + 1) out.push({ file: l.file, at: where(l, i), detail: `no=${r?.no}, 기대값 ${i + 1}` });
        });
      }
      return out;
    },
  },
  {
    name: 'history-unique-keys',
    description: '연혁 키(법령 시행일:lsiSeq, 고시 admRulSeq)가 목록 안에서 유일하다',
    run(ctx) {
      const out = [];
      for (const l of historyLists(ctx)) {
        const seen = new Map();
        l.rows.forEach((r, i) => {
          const { key } = historyRowKey(l.kind, r ?? {});
          if (!key) return;
          if (seen.has(key)) out.push({ file: l.file, at: where(l, i), detail: `키 ${key} 중복 (앞선 행 [${seen.get(key)}])` });
          else seen.set(key, i);
        });
      }
      return out;
    },
  },
  {
    name: 'history-link-seq',
    description: '링크가 law.go.kr 연혁 주소이고 seq 가 들어 있다 (옛 고시 2행은 예외)',
    run(ctx) {
      const out = [];
      for (const l of historyLists(ctx)) {
        l.rows.forEach((r, i) => {
          if (typeof r?.link !== 'string') return;
          if (!LINK_RE.test(r.link)) return out.push({ file: l.file, at: where(l, i), detail: `law.go.kr 연혁 링크가 아님: ${r.link}` });
          const param = l.kind === 'law' ? 'lsiSeq' : 'admRulSeq';
          if (!new RegExp(`[?&]${param}=\\d+(?:&|$)`).test(r.link) && !isAllowedNoSeq(l, r, ctx.allowNoSeq)) {
            out.push({ file: l.file, at: where(l, i), detail: `링크에 ${param} 가 없음: ${rowLabel(r)}` });
          }
        });
      }
      return out;
    },
  },
  {
    name: 'history-effective-after-promulgation',
    description: '시행일 ≥ 공포일',
    run(ctx) {
      const out = [];
      for (const l of historyLists(ctx)) {
        l.rows.forEach((r, i) => {
          if (isValidYmd(r?.effective_date) && isValidYmd(r?.promulgation_date) && r.effective_date < r.promulgation_date) {
            out.push({ file: l.file, at: where(l, i), detail: `시행일 ${r.effective_date} < 공포일 ${r.promulgation_date}` });
          }
        });
      }
      return out;
    },
  },
  {
    name: 'facilities-nfsc-key',
    description: 'facilities.json 의 nfsc_key 가 모두 nfsc_history.json 에 있다',
    run(ctx) {
      const fac = json(ctx, 'facilities.json');
      const nfsc = json(ctx, NFSC_FILE);
      if (!fac) return [{ file: 'facilities.json', at: '', detail: '파일이 없거나 해석 불가' }];
      if (!nfsc || typeof nfsc !== 'object') return [{ file: NFSC_FILE, at: '', detail: '파일이 없거나 해석 불가' }];
      if (!Array.isArray(fac.facilities)) return [{ file: 'facilities.json', at: '', detail: 'facilities 배열이 없음' }];
      return fac.facilities
        .map((f, i) => ({ f, i }))
        .filter(({ f }) => f?.nfsc_key != null && !Object.hasOwn(nfsc, f.nfsc_key))
        .map(({ f, i }) => ({ file: 'facilities.json', at: `facilities[${i}](${f.id})`, detail: `nfsc_key 가 연혁에 없음: ${f.nfsc_key}` }));
    },
  },
  {
    name: 'category-date-range',
    description: '용도별 파일의 기준 행: 날짜는 YYYYMMDD, 둘 다 있으면 end_date ≥ start_date',
    run(ctx) {
      const out = [];
      for (const [name, f] of ctx.files) {
        if (!CATEGORY_RE.test(name) || f.error) continue;
        const visit = (x, at) => {
          if (Array.isArray(x)) return x.forEach((v, i) => visit(v, `${at}[${i}]`));
          if (!x || typeof x !== 'object') return;
          if ('start_date' in x || 'end_date' in x) {
            for (const k of ['start_date', 'end_date']) {
              if (x[k] != null && !isValidYmd(x[k])) out.push({ file: name, at, detail: `${k} 가 올바른 날짜가 아님: ${x[k]}` });
            }
            if (isValidYmd(x.start_date) && isValidYmd(x.end_date) && x.end_date < x.start_date) {
              out.push({ file: name, at, detail: `end_date ${x.end_date} < start_date ${x.start_date}` });
            }
          }
          for (const [k, v] of Object.entries(x)) if (v && typeof v === 'object') visit(v, `${at}.${k}`);
        };
        visit(f.json, '');
      }
      return out;
    },
  },
  {
    name: 'law-watch-registry',
    description: 'data/law_watch.json 레지스트리 형식과 소스 확장이 올바르다',
    run(ctx) {
      const file = 'law_watch.json';
      const reg = json(ctx, file);
      if (reg === undefined) return [{ file, at: '', detail: '파일이 없거나 해석 불가' }];
      const errs = validateRegistry(reg);
      if (errs.length) return errs.map((detail) => ({ file, at: '', detail }));
      const baselines = {};
      const out = [];
      for (const s of reg.sources) {
        if (s.baseline.from !== 'history') continue;
        const base = path.posix.basename(s.baseline.file);
        const data = json(ctx, base);
        if (!s.baseline.file.startsWith('data/') || data === undefined) out.push({ file, at: s.id, detail: `기준 연혁 파일을 찾을 수 없음: ${s.baseline.file}` });
        else baselines[s.baseline.file] = data;
      }
      if (out.length) return out;
      const { errors } = expandSources(reg, baselines);
      return errors.map((detail) => ({ file, at: '', detail }));
    },
  },
];

// ───────────────────────── 실행 ─────────────────────────

export function runChecks(files, { checks = CHECKS, knownIssues = KNOWN_ISSUES, allowNoSeq = ALLOW_NO_SEQ } = {}) {
  const ctx = { files, allowNoSeq };
  const results = checks.map((c) => {
    const issues = c.run(ctx);
    const isKnown = (p) => knownIssues.some((k) => k.check === c.name && (!k.file || k.file === p.file) && (!k.contains || `${p.at} ${p.detail}`.includes(k.contains)));
    return { name: c.name, description: c.description, errors: issues.filter((p) => !isKnown(p)), warnings: issues.filter(isKnown) };
  });
  return {
    results,
    errorCount: results.reduce((n, r) => n + r.errors.length, 0),
    warningCount: results.reduce((n, r) => n + r.warnings.length, 0),
  };
}

export function formatReport(res, { fileCount } = {}) {
  const L = [`데이터 검사: ${fileCount != null ? `파일 ${fileCount}개, ` : ''}검사 ${res.results.length}종`];
  for (const r of res.results) {
    const mark = r.errors.length ? '✖' : r.warnings.length ? '⚠' : '✔';
    const tail = r.errors.length || r.warnings.length ? ` — 오류 ${r.errors.length}건, 경고 ${r.warnings.length}건` : ' — 통과';
    L.push(`${mark} ${r.name}: ${r.description}${tail}`);
    for (const p of r.errors) L.push(`    ✖ ${p.file}${p.at}: ${p.detail}`);
    for (const p of r.warnings) L.push(`    ⚠ ${p.file}${p.at}: ${p.detail} (알려진 문제)`);
  }
  L.push(`결과: ${res.errorCount ? '실패' : '통과'} — 오류 ${res.errorCount}건, 경고 ${res.warningCount}건`);
  return L.join('\n');
}

export function main(argv = []) {
  let dir = DEFAULT_DATA_DIR;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--data-dir' && argv[i + 1]) dir = path.resolve(argv[++i]);
    else {
      process.stderr.write(`알 수 없는 인자: ${argv[i]}\n사용법: node scripts/validate-data.mjs [--data-dir DIR]\n`);
      return 1;
    }
  }
  const files = loadDataDir(dir);
  const res = runChecks(files);
  process.stdout.write(`${formatReport(res, { fileCount: files.size })}\n`);
  return res.errorCount ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
