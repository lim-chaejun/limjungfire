// `node --test scripts/engine/test/` 진입점
// Node 22 의 --test 는 디렉터리 인자를 테스트 파일 목록으로 펼치지 않고 `node <디렉터리>`(= 이 index.js)로 실행한다.
// 그래서 디렉터리로 실행됐을 때만 이 디렉터리의 *.test.mjs 를 모두 불러온다.
// 인자 없는 `node --test`(기본 탐색)는 각 *.test.mjs 를 따로 찾아 실행하므로 여기서는 아무것도 하지 않는다(중복 실행 방지).
// 파일 목록으로 실행해도 된다: node --test scripts/engine/test/*.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const invokedAsDirectory = path.resolve(process.argv[1] || '') === HERE;

if (invokedAsDirectory) {
  for (const name of fs.readdirSync(HERE).filter((f) => f.endsWith('.test.mjs')).sort()) {
    await import(pathToFileURL(path.join(HERE, name)).href);
  }
}
