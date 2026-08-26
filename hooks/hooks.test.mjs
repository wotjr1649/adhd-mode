#!/usr/bin/env node
// 훅 런처 자체 검사 — node hooks/hooks.test.mjs
//
// 이 플러그인의 실패 모드는 "안 켜짐"이 아니라 "켜진 것처럼 보이는데 조용히 아무것도
// 안 함"이다. 런처는 exit 0 으로 세션 시작을 막지 않는 것이 설계인데, 그 때문에
// 플러그인 루트를 못 찾거나 import 가 깨져도 호스트에는 성공으로 보인다. 이유가
// stderr 에 남지 않으면 아무도 알 수 없다 — 실제로 그 상태였다.
//
// hooks.json 에 적힌 명령을 그대로 실행한다. 복사본을 검사하면 출하되는 문자열이
// 바뀌었을 때 이 검사가 통과해 버린다. 모델 호출이 없으니 무료다.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const command = JSON.parse(fs.readFileSync(path.join(ROOT, "hooks", "hooks.json"), "utf8"))
  .hooks.SessionStart[0].hooks[0].command;

let n = 0;

// ── 명령 문자열 자체 ──
// 셸 인용을 두 번 통과하는 한 줄이라 이스케이프가 조용히 깨진다. 개행이 섞이면
// node 는 문자열 미종료로 죽고, 그 죽음은 exit 0 뒤에 숨는다.
assert.ok(!command.includes("\n"), "런처 명령에 실제 개행이 들어가면 구문 오류로 죽는다");
assert.ok(!command.includes("\\"), "런처 명령의 역슬래시 이스케이프는 셸을 통과하며 깨진다");
n += 2;

const run = (env) => spawnSync(command, { shell: true, encoding: "utf8", env });
const withoutRoot = { ...process.env };
delete withoutRoot.CLAUDE_PLUGIN_ROOT;
delete withoutRoot.PLUGIN_ROOT;

// ── 루트를 못 찾는 경우 ──
const noRoot = run(withoutRoot);
assert.equal(noRoot.status, 0, "런처는 어떤 경우에도 세션 시작을 막지 않는다");
assert.equal(noRoot.stdout, "", "룰셋을 못 읽었으면 부분 출력도 내면 안 된다");
assert.match(noRoot.stderr, /^adhd-mode:/m, "루트가 없으면 이유가 stderr 에 남아야 한다");
n += 3;

// ── 루트는 있는데 그 경로에 플러그인이 없는 경우 ──
const badRoot = run({ ...withoutRoot, CLAUDE_PLUGIN_ROOT: path.join(ROOT, "no-such-dir") });
assert.equal(badRoot.status, 0);
assert.equal(badRoot.stdout, "");
assert.match(badRoot.stderr, /^adhd-mode:/m, "import 실패가 삼켜지면 무음 실패로 돌아간다");
n += 3;

// ── 정상 경로 (대조군) ──
// 위 두 검사만 있으면 "항상 실패하고 항상 stderr 를 찍는" 런처도 통과한다.
const ok = run({ ...withoutRoot, CLAUDE_PLUGIN_ROOT: ROOT });
assert.equal(ok.status, 0);
assert.equal(ok.stderr, "", "정상 실행에서 stderr 가 나오면 경고가 소음이 된다");
assert.match(ok.stdout, /^ADHD MODE ACTIVE\./, "주입 본문은 활성 표시로 시작한다");
assert.ok((ok.stdout.match(/^### /gm) || []).length >= 10, "규칙이 10개 미만이면 본문이 잘린 것이다");
n += 4;

console.log(`훅 런처 자체 검사 통과 — ${n}건`);
