#!/usr/bin/env node
// adhd-mode A/B 러너 — 플러그인 있음/없음으로 같은 프롬프트를 돌려 출력 차이를 잰다.
//
//   node evals/run.mjs --models opus,sonnet
//
// `claude plugin eval` 을 쓰지 않는다. 실비 과금이라 구독 플랜에서 못 쓴다.
// 대신 `claude -p` 를 구독 인증 그대로 쓰고, 암 구분은 cwd 로컬 설정으로 만든다.
//
// 무증상 실패 하나가 이 하네스 전체를 무의미하게 만든다:
// `claude -p` 는 검증에 실패한 설정 파일을 **아무 말 없이 무시한다**. OFF 암의
// settings.local.json 이 무시되면 OFF 가 실은 ON 이 되고, 모든 규칙이 "차이 없음"
// 으로 나와 전부 삭제 대상이 된다. 그래서 본 케이스 전에 암을 두 번 검증한다 —
// 정적(plugin list)으로 한 번, 카나리아 프롬프트로 한 번. 둘 중 하나라도 어긋나면 중단한다.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CASES } from "./cases.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ID = "adhd-mode@adhd-mode";
// 도구를 막아 단일 턴을 보장한다. 양쪽 암에 똑같이 적용되므로 교란 변수가 아니다.
//
// TodoWrite 를 막는 것은 측정 범위를 좁힌다: 규칙 5 는 "harness 에 plan tool 이
// 있으면 그걸 쓰라"고 하는데 그 경로가 봉쇄된다. 의도한 것이다 — -p 의 result
// 필드에는 도구 호출이 담기지 않아, 허용해도 사람이 볼 수 없고 채점기도 못 읽는다.
// 규칙 5 는 산문 재진술 경로만 측정된다. README 한계 절에 적어 뒀다.
const NO_TOOLS = ["Bash", "Read", "Write", "Edit", "NotebookEdit", "Glob", "Grep",
  "WebFetch", "WebSearch", "Task", "Agent", "Skill", "TodoWrite"];
const RUN_TIMEOUT_MS = 300_000;

// 채점기가 키워드 정규식이라 응답 언어가 교란 변수다. 88회 중 1개가 영어로 나왔고
// 그 셀만 체계적으로 불리했다. 양쪽 암에 똑같이 붙여 언어를 상수로 만든다.
const LANG_SUFFIX = "\n\n(한국어로 답해라.)";

function parseArgs(argv) {
  const a = { models: ["opus", "sonnet"], concurrency: 3, case: null, canary: true, isolate: false,
    repeat: 1, arms: path.join(os.tmpdir(), "adhd-mode-evals"), out: path.join(HERE, "results") };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--models") a.models = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (k === "--concurrency") a.concurrency = Number(argv[++i]);
    else if (k === "--case") a.case = argv[++i];
    else if (k === "--arms") a.arms = path.resolve(argv[++i]);
    else if (k === "--out") a.out = path.resolve(argv[++i]);
    else if (k === "--no-canary") a.canary = false;
    else if (k === "--isolate") a.isolate = true;
    else if (k === "--repeat") a.repeat = Math.max(1, Number(argv[++i]));
    else if (k === "--regrade") a.regrade = path.resolve(argv[++i]);
    else if (k === "--help" || k === "-h") { console.log(HELP); process.exit(0); }
    else { console.error(`알 수 없는 인자: ${k}\n`); console.log(HELP); process.exit(2); }
  }
  return a;
}

const HELP = `사용법: node evals/run.mjs [옵션]

  --models <목록>      쉼표 구분. 기본 opus,sonnet
  --concurrency <n>    동시 실행 수. 기본 3
  --case <목록>        케이스 id 부분 일치로 필터. 쉼표로 여럿 (예: r08,r10)
  --arms <경로>        암 디렉터리. 기본 <tmp>/adhd-mode-evals
  --out <경로>         결과 디렉터리. 기본 evals/results
  --no-canary          카나리아 검증 생략 (권장하지 않음)
  --isolate            다른 플러그인을 양쪽 암에서 모두 끈다
  --repeat <n>         셀당 반복 횟수. 기본 1. 판정은 과반으로 낸다
  --regrade <결과경로>  저장된 raw/ 를 다시 채점만 한다. 모델 호출 없음 (무료)

총 실행 수 = 케이스 수 × 2(암) × 모델 수 × 반복, + 카나리아 2 × 모델 수.

--repeat 를 왜 쓰나: 모델 출력은 비결정적이다. 셀당 1회 표본으로 규칙을 지우는 건
측정이 아니라 일화다. 기본값 1 은 "어느 규칙을 더 볼지" 를 싸게 고르는 용도고,
실제 삭제를 정하기 전에는 그 규칙만 --case 로 좁혀 --repeat 5 로 다시 잰다.

--isolate 를 왜 쓰나: 기본 실행은 사용자의 실제 환경을 잰다 — 다른 상시 규칙셋이
양쪽 암에 살아 있다. 그 상태에서 어떤 규칙이 "중복"으로 나오면 뜻이 둘이다.
(a) 이 규칙은 원래 필요 없다, (b) 다른 플러그인이 이미 같은 일을 한다.
--isolate 로 한 번 더 돌리면 갈린다 — 격리 실행에서 "효과"로 바뀌면 (b)다.
전역 CLAUDE.md 는 어느 쪽으로도 끌 수 없다 (--safe-mode 는 이 플러그인까지 끈다).`;

// shell:true + 인자 배열은 Node 가 DEP0190 으로 경고한다. 인자에 공백이 없으므로
// 직접 이어 붙여 넘긴다 — 프롬프트는 stdin 으로 가니 인용 문제가 없다.
const sh = (args) => "claude " + args.join(" ");

function claude(cwd, model, prompt, { json = true } = {}) {
  return new Promise((resolve) => {
    const args = ["-p", "--model", model, "--disallowed-tools", ...NO_TOOLS];
    if (json) args.push("--output-format", "json");
    const p = spawn(sh(args), { cwd, shell: true });
    let out = "", err = "";
    const timer = setTimeout(() => { p.kill(); resolve({ ok: false, error: "timeout", text: "", cost: 0 }); },
      RUN_TIMEOUT_MS);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => {
      clearTimeout(timer);
      if (!json) return resolve({ ok: code === 0, text: out.trim(), cost: 0, error: err.trim() });
      try {
        const j = JSON.parse(out);
        resolve({ ok: !j.is_error, text: String(j.result ?? ""), cost: j.total_cost_usd ?? 0,
          turns: j.num_turns, error: j.is_error ? j.result : "" });
      } catch {
        resolve({ ok: false, text: "", cost: 0, error: `JSON 파싱 실패 (exit ${code}): ${(out || err).slice(0, 300)}` });
      }
    });
    p.stdin.end(prompt);
  });
}

function plainClaude(cwd, args) {
  return new Promise((resolve) => {
    const p = spawn(sh(args), { cwd, shell: true });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("close", () => resolve(out));
  });
}

// 설치된 다른 플러그인 id 를 모은다. --isolate 가 양쪽 암에서 이것들을 끈다.
async function otherPlugins(cwd) {
  const out = await plainClaude(cwd, ["plugin", "list"]);
  return [...new Set(out.match(/[\w.-]+@[\w.-]+/g) || [])].filter((id) => id !== PLUGIN_ID);
}

function setupArms(armsDir, silence = []) {
  const off = Object.fromEntries(silence.map((id) => [id, false]));
  const arms = {};
  for (const arm of ["on", "off"]) {
    const dir = path.join(armsDir, arm);
    fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
    // `claude plugin disable <id> --scope local` 이 만드는 것과 같은 파일.
    // 양쪽 암에 똑같이 쓴다 — 파일의 존재 여부 자체가 변수가 되지 않게.
    fs.writeFileSync(
      path.join(dir, ".claude", "settings.local.json"),
      JSON.stringify({ enabledPlugins: { ...off, [PLUGIN_ID]: arm === "on" } }, null, 2) + "\n",
    );
    arms[arm] = dir;
  }
  return arms;
}

// 케이스 프롬프트의 지문. 재채점은 프롬프트가 그대로일 때만 유효하다 —
// 프롬프트를 고친 뒤 옛 raw 를 다시 채점하면 새 프롬프트에 옛 응답이 붙어
// review.md 가 있지도 않았던 질문에 답한 것처럼 보인다. 조용히 어긋난다.
export const promptHash = (p) => createHash("sha1").update(p).digest("hex").slice(0, 12);

// 카나리아는 모델 자기보고를 믿지 않는다. "룰셋이 주입됐나?" 는 모델이 틀리거나
// 지어낼 수 있다. 룰셋에만 있는 문자열을 되돌려 받아야 주입을 증명한 것이다.
// 기대값은 SKILL.md 에서 그때그때 읽는다 — 규칙 제목이 바뀌면 카나리아도 따라간다.
export function canary(skillPath = path.join(HERE, "..", "skills", "adhd-mode", "SKILL.md")) {
  const md = fs.readFileSync(skillPath, "utf8");
  const m = /^###\s*8\.\s*(.+?)\s*$/m.exec(md);
  if (!m) throw new Error(`${skillPath} 에서 규칙 8 제목을 찾지 못했다 — 카나리아 기대값을 만들 수 없다`);
  return {
    heading: m[1],
    prompt:
      'Reply with exactly one line and nothing else. If a ruleset titled "adhd-mode" ' +
      "is present in your context, reply with the exact heading text of its rule 8 " +
      "(the words only, no number). Otherwise reply with exactly: NO_RULESET",
  };
}

async function guardArms(arms, models, useCanary) {
  const problems = [];

  for (const [arm, cwd] of Object.entries(arms)) {
    const out = await plainClaude(cwd, ["plugin", "list"]);
    const i = out.indexOf(PLUGIN_ID);
    if (i < 0) { problems.push(`${arm}: plugin list 에 ${PLUGIN_ID} 가 없다 — 설치되지 않았다`); continue; }
    const window = out.slice(i, i + 240);
    const disabled = /disabled/i.test(window);
    const want = arm === "off";
    if (disabled !== want) {
      problems.push(`${arm}: 정적 검사 실패 — disabled=${disabled}, 기대=${want}`);
    }
  }
  if (problems.length) return problems;
  if (!useCanary) return problems;

  // 모델마다 돌린다. 한 모델로만 검증하면 나머지 모델의 실행 전체가
  // 주입되지 않았을 수도 있는 전제 위에 놓인다.
  const { heading, prompt } = canary();
  for (const model of models) {
    for (const [arm, cwd] of Object.entries(arms)) {
      const r = await claude(cwd, model, prompt);
      if (!r.ok) { problems.push(`${arm}/${model}: 카나리아 실행 실패 — ${r.error}`); continue; }
      const got = r.text.trim();
      const ok = arm === "on"
        ? got.toLowerCase().includes(heading.toLowerCase())
        : got.includes("NO_RULESET") && !got.toLowerCase().includes(heading.toLowerCase());
      if (!ok) {
        problems.push(`${arm}/${model}: 카나리아 불일치 — 기대 ${
          arm === "on" ? JSON.stringify(heading) : "NO_RULESET"}, 실제 ${JSON.stringify(got.slice(0, 120))}`);
      }
    }
  }
  return problems;
}

// 저장된 raw/ 를 다시 읽어 채점만 새로 한다. 채점기를 고쳤을 때 88회를 다시
// 돌리지 않기 위한 것 — 모델 출력은 이미 디스크에 있고, 바뀐 건 판정 로직뿐이다.
//
// 원본의 scores.json 을 반드시 함께 읽는다. 격리 여부를 잃으면 요약이 정반대
// 해석을 단다 — 격리 실행 데이터에 "다른 플러그인 때문일 수 있으니 --isolate 로
// 다시 재라"가 붙고, 삭제 판단의 전제가 틀어진다. 없으면 재채점을 거부한다.
function loadRuns(dir, cases) {
  const rawDir = path.join(dir, "raw");
  if (!fs.existsSync(rawDir)) throw new Error(`raw 디렉터리가 없다: ${rawDir}`);
  const scoresPath = path.join(dir, "scores.json");
  if (!fs.existsSync(scoresPath)) {
    throw new Error(`scores.json 이 없다: ${scoresPath} — 격리 여부를 알 수 없어 재채점하지 않는다`);
  }
  const meta = JSON.parse(fs.readFileSync(scoresPath, "utf8"));
  // 프롬프트가 바뀐 케이스는 재채점 대상에서 뺀다. 기록이 없는 옛 결과는
  // 확인할 방법이 없으므로 통과시키되 경고한다.
  const recorded = meta.promptHashes || null;
  const stale = recorded
    ? cases.filter((c) => recorded[c.id] && recorded[c.id] !== promptHash(c.prompt)).map((c) => c.id)
    : [];
  const usable = cases.filter((c) => !stale.includes(c.id));
  const byId = new Map(usable.map((c) => [c.id, c]));
  const runs = [];
  for (const f of fs.readdirSync(rawDir).filter((n) => n.endsWith(".txt"))) {
    const m = /^(.+?)__(on|off)__(.+?)__r(\d+)\.txt$/.exec(f);
    if (!m) continue;
    const c = byId.get(m[1]);
    if (!c) continue;
    const text = fs.readFileSync(path.join(rawDir, f), "utf8");
    const failed = text.startsWith("[실행 실패]");
    runs.push({ c, arm: m[2], model: m[3], rep: Number(m[4]),
      ok: !failed, text, cost: 0, error: failed ? text : "" });
  }
  if (!runs.length) throw new Error(`${rawDir} 에서 읽을 수 있는 실행 결과가 없다`);
  return { runs, meta, stale, hashed: Boolean(recorded) };
}

async function pool(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await worker(items[i], i);
    }
  }));
  return out;
}

// ON/OFF 한 쌍을 4분면으로 분류한다. 이게 삭제 판단의 단위다.
export function classify(on, off) {
  if (on && !off) return "효과";      // 규칙이 일한다
  if (on && off) return "중복";       // 규칙 없이도 된다
  if (!on && !off) return "무효";     // 규칙이 있어도 안 된다
  return "역효과";                     // 규칙이 방해한다
}

// 한 규칙의 셀들을 하나의 결론으로 접는다. 이 함수가 삭제를 결정한다.
//
// 판정불가(실행 실패, 또는 재채점 대상에 그 케이스가 없음)를 "효과 없음"과
// 구분한다. 구분하지 않으면 실행이 실패한 규칙이 삭제 후보로 올라온다 —
// 데이터가 없는 것과 데이터가 효과 없음을 말하는 것은 정반대다.
// 셀 수를 항상 같이 낸다. 예전에는 4셀 중 1셀만 효과여도 그냥 "유지"였고, 효과와
// 역효과가 같이 나오면 역효과가 통째로 숨었다 — 규칙이 어떤 조건에서 방해하는지가
// 결론에서 사라지는 셈이라, 그 경우는 유지가 아니라 검토로 올린다.
export function ruleConclusion(rs) {
  const decided = rs.filter((r) => r.verdict !== "판정불가");
  if (!decided.length) return "판정불가 — 이 실행에 채점된 셀이 없다";
  if (rs.some((r) => r.mode === "사람")) return "사람이 review.md 를 읽고 판정";
  const n = decided.length;
  const eff = decided.filter((r) => r.verdict === "효과").length;
  const harm = decided.filter((r) => r.verdict === "역효과").length;
  if (eff && harm) return `검토 — 효과 ${eff}/${n}셀과 역효과 ${harm}/${n}셀이 함께 나왔다`;
  if (eff) return `유지 — 효과 ${eff}/${n}셀`;
  if (harm) return `검토 — 역효과 ${harm}/${n}셀`;
  return `삭제 후보 — 효과 0/${n}셀`;
}

// 하네스는 서식만 잰다. 내용이 맞는지는 안 본다 — 그건 LLM 심판이 필요하고 유료다.
// 다만 한 종류는 공짜로 잡힌다: 프롬프트에 없는 줄 번호를 지목하는 것.
// 실제로 ON 암이 2줄짜리 스니펫에 대고 "42번째 줄" 이라 답했다. SKILL.md 예시의
// src/auth.ts:42 가 흘러든 것이다 — 주입된 룰셋이 만든 환각이라 그냥 넘길 수 없다.
export function fabricatedLineRefs(prompt, text) {
  const bound = prompt.split("\n").length;
  const out = [];
  // 위치 지목만 잡는다. 분량은 아니다 — "번째"를 선택으로 두면 "200~400줄/일",
  // "구현 5줄" 같은 분량 표현이 전부 환각으로 잡힌다 (실측 거짓 양성 3건).
  // 한국어는 위치를 "N번째 줄" 또는 "N행"으로, 분량을 "N줄"로 쓴다.
  //
  // 줄/행 뒤에 \b 를 쓰면 안 된다 — \b 는 ASCII 기준이라 "42번째 줄에" 에서
  // 줄과 에 사이가 경계로 잡히지 않는다. 숫자가 앵커라 경계 없이도 안전하다.
  for (const m of text.matchAll(/(\d+)\s*번째\s*(?:줄|행)|(?:줄|행)\s*(\d+)|\bline\s+(\d+)/gi)) {
    const cited = Number(m[1] ?? m[2] ?? m[3]);
    if (Number.isFinite(cited) && cited > bound) out.push(`${m[0].trim()} (프롬프트는 ${bound}줄)`);
  }
  return [...new Set(out)];
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  // 쉼표로 여러 패턴을 받는다. 나눠 돌리면 카나리아만 중복 비용이 든다.
  const pats = a.case ? a.case.split(",").map((x) => x.trim()).filter(Boolean) : null;
  let cases = pats ? CASES.filter((c) => pats.some((x) => c.id.includes(x))) : CASES;
  if (!cases.length) { console.error(`--case ${a.case} 에 맞는 케이스가 없다`); process.exit(2); }

  // 재채점은 원본 scores.json 에서 물려받는다 — 여기서 다시 조회하지 않는다.
  let silence = !a.regrade && a.isolate ? await otherPlugins(HERE) : [];
  let runs, origin = null, originCost = 0, staleCases = [], originHashed = true;
  if (a.regrade) {
    const loaded = loadRuns(a.regrade, cases);
    runs = loaded.runs;
    if (loaded.stale.length) {
      console.log(`        제외: 프롬프트가 바뀐 케이스 ${loaded.stale.length}개 — ${loaded.stale.join(", ")}`);
      console.log(`              이 케이스는 다시 실행해야 한다. 옛 응답은 지금 프롬프트의 답이 아니다.`);
    }
    // 지문이 없으면 거부하지 않고 통과시킨다 — 지문 기록 이전 결과가 디스크에 남아
    // 있고, 그걸 재채점 불가로 만들 이유는 없다. 다만 콘솔 경고는 흘러간다. 나중에
    // 이 결과를 읽는 사람에게 남는 것은 summary.md 와 scores.json 뿐이므로, 격리
    // 여부와 같은 자리에 실어 보낸다. 그러지 않으면 지문 없이 채점한 판정이 지문을
    // 갖춘 판정과 구별되지 않는다.
    originHashed = loaded.hashed;
    if (!originHashed) {
      console.log(`        경고: 원본에 프롬프트 지문이 없다 (지문 기록 이전 결과). 케이스가 바뀌었는지 확인할 수 없다.`);
    }
    staleCases = loaded.stale;
    // 원본이 --case 로 좁혀 돌린 것이면 raw/ 에 그 케이스만 있다. 나머지를
    // 그대로 두면 전부 판정불가로 채워져 요약이 읽기 어려워진다.
    const present = new Set(runs.map((r) => r.c.id));
    cases = cases.filter((c) => present.has(c.id));
    // 원본 실행의 조건을 그대로 물려받는다. 여기서 잃으면 해석이 뒤집힌다.
    a.isolate = loaded.meta.isolate === true;
    silence = loaded.meta.silenced || [];
    originCost = loaded.meta.cost || 0;
    origin = path.basename(a.regrade);
    a.models = [...new Set(runs.map((r) => r.model))];
    a.repeat = Math.max(...runs.map((r) => r.rep)) + 1;
    console.log(`재채점: ${a.regrade}`);
    console.log(`        ${runs.length}개 출력 · 모델 ${a.models.join(", ")} · 반복 ${a.repeat}`);
    console.log(`        원본 조건 복원 — 격리 ${a.isolate ? `있음 (${silence.length}개 차단)` : "없음"}, 원본 비용 $${originCost.toFixed(4)}`);
    console.log(`        모델 호출 없음`);
  } else {
    const arms = setupArms(a.arms, silence);
    console.log(`암: ${arms.on}\n    ${arms.off}`);
    console.log(a.isolate
      ? `격리: 양쪽 암에서 끈 플러그인 — ${silence.join(", ") || "(없음)"}`
      : `격리: 없음 — 실제 환경 그대로 잰다 (다른 상시 규칙셋이 양쪽 암에 살아 있다)`);

    console.log(`\n[1/3] 암 검증 (정적 + 카나리아)…`);
    const problems = await guardArms(arms, a.models, a.canary);
    if (problems.length) {
      console.error(`\n암 검증 실패 — 중단한다. 이 상태로 돌리면 모든 규칙이 "차이 없음"으로 나온다.\n`);
      for (const p of problems) console.error(`  - ${p}`);
      process.exit(1);
    }
    console.log(`      OK — OFF 는 실제로 꺼져 있고 ON 은 켜져 있다.`);

    const jobs = [];
    for (const model of a.models) for (const c of cases) for (const arm of ["on", "off"]) {
      for (let rep = 0; rep < a.repeat; rep++) jobs.push({ model, c, arm, rep });
    }
    console.log(`\n[2/3] ${jobs.length}회 실행 (케이스 ${cases.length} × 암 2 × 모델 ${a.models.length} × 반복 ${a.repeat}), 동시 ${a.concurrency}…`);

    let done = 0;
    runs = await pool(jobs, a.concurrency, async (j) => {
      const r = await claude(arms[j.arm], j.model, j.c.prompt + LANG_SUFFIX);
      done++;
      process.stdout.write(`\r      ${done}/${jobs.length}  ${j.c.id} ${j.arm} ${j.model}${" ".repeat(20)}`);
      return { ...j, ...r };
    });
    process.stdout.write("\n");
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outDir = path.join(a.out, stamp);
  fs.mkdirSync(path.join(outDir, "raw"), { recursive: true });

  const failed = runs.filter((r) => !r.ok);
  const cost = runs.reduce((s, r) => s + (r.cost || 0), 0);

  // 재채점은 원문을 다시 쓰지 않는다 — 출처가 둘이 되면 어느 쪽이 진짜인지 흐려진다.
  if (!a.regrade) {
    for (const r of runs) {
      fs.writeFileSync(path.join(outDir, "raw", `${r.c.id}__${r.arm}__${r.model}__r${r.rep}.txt`),
        r.ok ? r.text : `[실행 실패] ${r.error}`);
    }
  }

  const fabrications = runs
    .filter((r) => r.ok)
    .map((r) => ({ id: r.c.id, arm: r.arm, model: r.model, refs: fabricatedLineRefs(r.c.prompt, r.text) }))
    .filter((f) => f.refs.length);

  // ── 채점 ── 반복이 있으면 과반으로 셀 판정을 낸다.
  const rows = [];
  for (const model of a.models) for (const c of cases) {
    const arm = (which) => runs.filter((r) => r.model === model && r.c.id === c.id && r.arm === which && r.ok);
    const onR = arm("on"), offR = arm("off");
    if (!onR.length || !offR.length) {
      const bad = runs.find((r) => r.model === model && r.c.id === c.id && !r.ok);
      rows.push({ rule: c.rule, id: c.id, kind: c.kind, model, mode: "실행실패",
        verdict: "판정불가", detail: bad?.error || "성공한 실행이 없다" });
      continue;
    }
    if (c.grade) {
      const g1 = onR.map((r) => c.grade(r.text)), g0 = offR.map((r) => c.grade(r.text));
      const p1 = g1.filter((g) => g.pass).length, p0 = g0.filter((g) => g.pass).length;
      const onPass = p1 * 2 > g1.length, offPass = p0 * 2 > g0.length;
      rows.push({ rule: c.rule, id: c.id, kind: c.kind, model, mode: "기계",
        onPass, offPass, verdict: classify(onPass, offPass),
        onDetail: `${p1}/${g1.length} · ${g1[0].detail}`,
        offDetail: `${p0}/${g0.length} · ${g0[0].detail}` });
    } else {
      rows.push({ rule: c.rule, id: c.id, kind: c.kind, model, mode: "사람",
        verdict: "사람판정", onDetail: c.signal ? c.signal(onR[0].text) : "",
        offDetail: c.signal ? c.signal(offR[0].text) : "" });
    }
  }

  // ── 규칙별 결론 ──
  const rules = [...new Set(cases.map((c) => c.rule))].sort((x, y) => x - y);
  const perRule = rules.map((rule) => {
    const rs = rows.filter((r) => r.rule === rule);
    return { rule, conclusion: ruleConclusion(rs),
      cells: rs.map((r) => `${r.model}/${r.kind}=${r.verdict}`).join(" ") };
  });

  // ── 리포트 ──
  const summary = [
    `# adhd-mode A/B 결과 — ${stamp}`, "",
    `모델: ${a.models.join(", ")} · 케이스 ${cases.length} · 실행 ${runs.length}회 · 실패 ${failed.length}회`,
    `반복: 셀당 ${a.repeat}회${a.repeat === 1 ? " — 단일 표본이다. 삭제를 정하기 전에 그 규칙만 --repeat 5 로 다시 잰다." : " (과반 판정)"}`,
    ...(origin
      ? [`출처: ${origin} 을 재채점한 것이다. 모델 출력은 그 실행의 것이고 (원본 비용 $${originCost.toFixed(4)}),`,
         `      바뀐 것은 채점 로직뿐이다. 아래 조건은 원본 실행의 조건이다.`]
      : []),
    ...(origin && !originHashed
      ? [`경고: 원본에 프롬프트 지문이 없다 — 케이스가 그 뒤 바뀌었는지 확인할 수 없다.`,
         `      지금 프롬프트가 그때와 다르면 아래 판정은 새 질문에 옛 응답을 붙인 것이다.`]
      : []),
    `실측 비용: $${(origin ? originCost : cost).toFixed(4)} · 격리: ${a.isolate ? silence.join(", ") || "(끌 것 없음)" : "없음"}`, "",
    ...(a.isolate
      ? [`> 격리 실행이다 — 다른 플러그인을 양쪽 암에서 껐다. 전역 CLAUDE.md 는 끌 수 없어`,
         `> 남아 있다. 여기서 "효과"로 나온 규칙은 adhd-mode 가 단독으로 만들어내는 것이다.`]
      : [`> 실제 환경 실행이다 — 전역 CLAUDE.md 와 다른 플러그인이 양쪽 암에 모두 살아 있다.`,
         `> 따라서 "중복"은 "이 규칙이 쓸모없다"가 아니라 "이 설정에서는 다른 규칙셋이 이미`,
         `> 같은 일을 한다"는 뜻이다. --isolate 로 한 번 더 돌려 둘을 가른 뒤 삭제를 정한다.`]),
    "",
    "## 규칙별 결론", "",
    "| 규칙 | 결론 | 셀 |", "|---|---|---|",
    ...perRule.map((p) => `| ${p.rule} | ${p.conclusion} | ${p.cells} |`), "",
    "## 4분면", "",
    "| 판정 | 뜻 |", "|---|---|",
    "| 효과 | ON 통과, OFF 실패 — 규칙이 일한다 |",
    "| 중복 | 양쪽 통과 — 이 환경에서는 규칙 없이도 된다 |",
    "| 무효 | 양쪽 실패 — 규칙이 있어도 안 된다 |",
    "| 역효과 | ON 실패, OFF 통과 — 규칙이 방해한다 |", "",
    "## 셀 상세", "",
    "| 규칙 | 케이스 | 모델 | 채점 | 판정 | ON | OFF |", "|---|---|---|---|---|---|---|",
    ...rows.map((r) => `| ${r.rule} | ${r.id} | ${r.model} | ${r.mode} | ${r.verdict} | ${
      (r.onDetail || "").replace(/\|/g, "/")} | ${(r.offDetail || r.detail || "").replace(/\|/g, "/")} |`),
    // 정확성은 4분면과 다른 축이라 판정에 섞지 않는다. 규칙을 잘 지킨 응답이
    // 틀린 내용을 담을 수 있고, 그건 이 하네스의 통과/실패로는 안 잡힌다.
    ...(fabrications.length
      ? ["", "## 정확성 경고 — 프롬프트에 없는 줄 번호", "",
         "판정에는 반영하지 않는다. 서식과 내용은 다른 축이다.", "",
         "| 케이스 | 암 | 모델 | 지어낸 참조 |", "|---|---|---|---|",
         ...fabrications.map((f) => `| ${f.id} | ${f.arm} | ${f.model} | ${f.refs.join(", ")} |`)]
      : ["", "## 정확성 경고", "", "프롬프트에 없는 줄 번호를 지목한 응답 없음."]),
    ...(failed.length ? ["", "## 실행 실패", "",
      ...failed.map((f) => `- ${f.c.id} ${f.arm} ${f.model}: ${f.error}`)] : []),
  ].join("\n");

  const humanCases = cases.filter((c) => !c.grade);
  const review = [
    `# 사람이 읽을 것 — ${stamp}`, "",
    `기계로 채점할 수 없는 규칙 ${[...new Set(humanCases.map((c) => c.rule))].join(", ")}.`,
    `각 쌍에서 ON 이 기대 동작에 더 가까운지만 본다. 아니면 그 규칙은 삭제 후보다.`, "",
    // 반복을 전부 싣는다. 예전에는 rep 0 만 실어서, --repeat 5 로 재도 사람은
    // 1표본만 읽고 판정했다 — 기계 채점에만 반복을 적용하고 사람 판정은 n=1 인 셈.
    ...a.models.flatMap((model) => humanCases.flatMap((c) => {
      const reps = [...new Set(runs.filter((r) => r.c.id === c.id).map((r) => r.rep))].sort((x, y) => x - y);
      return [
        "---", "", `## 규칙 ${c.rule} · ${c.id} · ${model}`, "",
        `**${c.title}**`, "", `기대: ${c.expect}`, "",
        `프롬프트:`, "", "```", c.prompt, "```", "",
        ...reps.flatMap((rep) => {
          const t = (arm) => runs.find((r) => r.model === model && r.c.id === c.id && r.arm === arm && r.rep === rep);
          const on = t("on"), off = t("off");
          const sig = (r) => (c.signal ? c.signal(r?.text ?? "") : "-");
          return [
            reps.length > 1 ? `### 표본 ${rep + 1}/${reps.length}` : "",
            "", `#### ON  (신호: ${sig(on)})`, "", (on?.text ?? `[실패] ${on?.error}`), "",
            `#### OFF (신호: ${sig(off)})`, "", (off?.text ?? `[실패] ${off?.error}`), "",
          ];
        }),
      ];
    })),
  ].join("\n");

  fs.writeFileSync(path.join(outDir, "summary.md"), summary + "\n");
  fs.writeFileSync(path.join(outDir, "review.md"), review + "\n");
  fs.writeFileSync(path.join(outDir, "scores.json"),
    JSON.stringify({ stamp, models: a.models, cost: origin ? originCost : cost,
      isolate: a.isolate, silenced: silence, regradedFrom: origin,
      repeat: a.repeat, fabrications, staleCases, originHashed: origin ? originHashed : null,
      promptHashes: Object.fromEntries(cases.map((c) => [c.id, promptHash(c.prompt)])),
      rows, perRule,
      failed: failed.map((f) => ({ id: f.c.id, arm: f.arm, model: f.model, error: f.error })) }, null, 2) + "\n");

  console.log(`\n[3/3] 결과: ${outDir}`);
  console.log(`      비용 $${cost.toFixed(4)} · 실행 실패 ${failed.length}회\n`);
  for (const p of perRule) console.log(`      규칙 ${String(p.rule).padStart(2)} — ${p.conclusion}`);
  const del = perRule.filter((p) => p.conclusion.startsWith("삭제 후보"));
  console.log(`\n      삭제 후보 ${del.length}개${del.length ? ": 규칙 " + del.map((p) => p.rule).join(", ") : ""}`);
  console.log(`      사람이 읽을 것: ${path.join(outDir, "review.md")}`);
}

// 직접 실행했을 때만 돌린다. 이 가드가 없으면 테스트가 import 하는 순간
// 88회 매트릭스가 돌기 시작하고 실비가 나간다.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
