// 테스트 공용 도구 — 모든 테스트는 2026-09-26 에 기록한 law.go.kr 응답을 재생한다 (네트워크 없음)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReplayFetch, main } from '../check.mjs';
import { parseAdmChain, requestKey } from '../lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FIX = path.join(HERE, 'fixtures', '2026-09-26');
export const SNAPSHOT = path.join(FIX, 'data-snapshot'); // origin/main 시점 연혁 4개 파일
export const REGISTRY = path.join(FIX, 'registry.json'); // 기록 당시 레지스트리
export const REPO_DATA = path.resolve(HERE, '..', '..', '..', 'data');

export const tmpDir = (prefix = 'law-watch-test-') => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
export const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

let indexCache = null;
const fixtureIndex = () => (indexCache ??= readJson(path.join(FIX, 'index.json')));

// 요청(method,url,body) 에 해당하는 기록 원문
export function fixtureText(req) {
  const e = fixtureIndex().entries[requestKey(req)];
  if (!e) throw new Error(`기록 없음: ${req.method} ${req.url} ${req.body ?? ''}`);
  return fs.readFileSync(path.join(FIX, e.file), 'utf8');
}

export function copySnapshot() {
  const dir = tmpDir('law-watch-data-');
  for (const f of fs.readdirSync(SNAPSHOT)) fs.copyFileSync(path.join(SNAPSHOT, f), path.join(dir, f));
  return dir;
}

// 실제 endpoint 는 체인 안의 어느 seq 로 조회해도 같은 체인을 준다 → 연혁 반영으로 앵커가 바뀌어도 재생되게 한다
export function chainAware(base) {
  const bySeq = new Map();
  for (const e of Object.values(base.index.entries)) {
    if (!e.url.endsWith('/admRulHstListR.do')) continue;
    for (const r of parseAdmChain(fs.readFileSync(path.join(FIX, e.file), 'utf8')).rows) bySeq.set(r.seq, e.body);
  }
  const fn = (url, init = {}) => {
    if (url.endsWith('/admRulHstListR.do')) {
      const seq = /admRulSeq=(\d+)/.exec(init.body ?? '')?.[1];
      const recorded = bySeq.get(seq);
      if (recorded) return base(url, { ...init, body: recorded });
    }
    return base(url, init);
  };
  fn.index = base.index;
  return fn;
}

// 응답 가공: edit({ url, body, text, status }) → { text?, status? } | null(그대로)
export function mutating(base, edit) {
  const fn = async (url, init = {}) => {
    const res = await base(url, init);
    const text = await res.text();
    const change = edit({ url, body: init.body ?? '', text, status: res.status });
    if (!change) return new Response(text, { status: res.status, headers: res.headers });
    return new Response(change.text ?? text, { status: change.status ?? res.status, headers: { 'content-type': 'text/html;charset=UTF-8' } });
  };
  fn.index = base.index;
  return fn;
}

export const replay = () => createReplayFetch(FIX);

// 가짜 시계: sleep·advance 가 시간을 앞당길 뿐 실제로 기다리지 않는다 (now/sleep 을 check.mjs 에 주입)
export function fakeClock(start = Date.parse('2026-09-26T00:00:00Z')) {
  let t = start;
  return {
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
    advance: (ms) => {
      t += ms;
    },
    elapsed: () => t - start,
  };
}

// check.mjs 를 프로세스 안에서 재생 모드로 실행
export async function runCheck({ args = [], dataDir = SNAPSHOT, registry = REGISTRY, ...deps } = {}) {
  const out = tmpDir();
  const logs = [];
  const code = await main(['--replay', FIX, '--data-dir', dataDir, '--registry', registry, '--out', out, ...args], {
    log: (m) => logs.push(m),
    print: (m) => logs.push(m),
    runUrl: '',
    ...deps,
  });
  const read = (f) => (fs.existsSync(path.join(out, f)) ? fs.readFileSync(path.join(out, f), 'utf8') : null);
  const resultText = read('result.json');
  return { code, out, logs, result: resultText ? JSON.parse(resultText) : null, report: read('report.md') };
}

// 레지스트리 사본을 고쳐 임시 파일로 쓴다 (sources 의 data/ 경로는 --data-dir 기준으로 풀린다)
export function writeRegistry(edit) {
  const reg = readJson(REGISTRY);
  const next = edit(reg) ?? reg;
  const p = path.join(tmpDir('law-watch-reg-'), 'law_watch.json');
  fs.writeFileSync(p, JSON.stringify(next, null, 2));
  return p;
}
