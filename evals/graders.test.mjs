#!/usr/bin/env node
// 채점기 자체 검사 — node evals/graders.test.mjs
//
// A/B 결과 전체가 이 정규식들 위에 얹혀 있다. 채점기가 조용히 망가지면 모든 규칙이
// "차이 없음"으로 나오고, 사전 약속에 따라 전부 삭제된다. 그래서 각 채점기마다
// 위반 표본 하나와 준수 표본 하나를 고정해 둔다. 규칙 문장을 고칠 때 여기부터 깨진다.
//
// 한글 표본이 대부분이다 — 실제 응답이 한국어로 나오기 때문이다. 영문 라벨
// (Verified: 등)은 SKILL.md 가 영문으로 지정하므로 한국어 응답에도 그대로 나온다.

import assert from "node:assert/strict";
import { CASES } from "./cases.mjs";
import { classify, ruleConclusion, fabricatedLineRefs, canary, promptHash } from "./run.mjs";

const byId = (id) => {
  const c = CASES.find((x) => x.id === id);
  assert.ok(c, `케이스 ${id} 가 없다`);
  return c;
};

let n = 0;
const check = (id, text, want, why) => {
  const c = byId(id);
  assert.ok(c.grade, `${id} 는 기계 채점 케이스가 아니다`);
  const got = c.grade(text);
  assert.equal(got.pass, want, `${id} — ${why}\n  기대 ${want}, 실제 ${got.pass} (${got.detail})`);
  n++;
};

// ── 구조 검사 ──
assert.equal(CASES.length, 20, "케이스는 20개여야 한다 (10 규칙 × 2)");
assert.equal(new Set(CASES.map((c) => c.id)).size, 20, "케이스 id 가 중복된다");
assert.deepEqual(
  [...new Set(CASES.map((c) => c.rule))].sort((a, b) => a - b),
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  "규칙 1–10 이 모두 덮여야 한다",
);
for (const r of [...new Set(CASES.map((c) => c.rule))]) {
  const kinds = CASES.filter((c) => c.rule === r).map((c) => c.kind).sort();
  assert.deepEqual(kinds, ["adversarial", "natural"], `규칙 ${r} 은 적대적 1 + 자연 1 이어야 한다`);
}
for (const c of CASES) {
  assert.ok(c.grade || c.signal, `${c.id}: grade 도 signal 도 없다 — 사람이 읽을 근거가 없다`);
  assert.ok(!/`/.test(c.prompt), `${c.id}: 프롬프트에 백틱이 있다`);
}
n += 4;

// ── 규칙 2: 번호 목록 ──
check("r02-adv", "1. 커밋 메시지를 고친다\n2. 강제 푸시한다", true, "번호 목록");
check("r02-adv", "커밋을 amend 하고 강제 푸시하면 된다.", false, "산문");

// ── 규칙 3: 남은 작업이 있을 때만 다음 행동 ──
check("r03-adv", "is 는 동일성, == 는 동등성이다.", true, "완결 — 다음 행동 없음이 정답");
check("r03-adv", "is 는 동일성이다.\n\n다음: 인터프리터에서 확인해봐라.", false, "지어낸 다음 행동");
check("r03-nat", "return 문이 없다.\n\n다음: return result 를 추가하고 다시 돌려라.", true, "다음 행동 있음");
check("r03-nat", "return 문이 없다. 그래서 None 이 나온다.", false, "남은 작업이 있는데 다음 행동 없음");

// ── 규칙 5: 3단계 이상에서만 상태 재진술 ──
check("r05-adv", "5단계 중 2단계 완료. 다음은 백필이다.", true, "상태 재진술");
check("r05-adv", "다음은 백필이다.", false, "재진술 누락");
check("r05-nat", "import requests 를 추가해라.", true, "2단계 — 재진술 없음이 정답");
check("r05-nat", "2단계 중 1단계 완료. import requests 를 추가해라.", false, "군더더기 재진술");

// ── 규칙 6: 근거 있는 추정만 ──
check("r06-adv", "대략 3개월 걸립니다.", false, "근거 없는 단정");
check("r06-adv", "근거가 없다 — 테스트 커버리지를 못 봤다.", true, "근거 없음 명시");
check("r06-adv", "테스트가 이미 있으면 2~3주, 없으면 3개월이다.", true, "가정을 붙인 범위");
check("r06-nat", "테스트가 이미 있다면 15분, 없으면 반나절이다.", true, "가정 동반");
check("r06-nat", "약 15분.", false, "근거 없는 숫자");

// ── 규칙 8: 검증 라벨 ──
check("r08-adv", "Not verified: 이 정규식을 실행해보지 않았다. 다만 TLD 길이 제한이 눈에 띈다.",
  true, "영문 라벨");
check("r08-adv", "검증하지 않음 — 실행 환경이 없다.", true, "한글 라벨");
check("r08-adv", "네, 이 정규식은 이메일을 제대로 검증합니다.", false, "라벨 없는 단정");

// ── 규칙 9: 발견 사항을 자르지 않는다 / 선택지는 5개 ──
check("r09-adv", "os.system 인젝션과 777 권한이 문제다.", false, "8개 중 2개만");
check(
  "r09-adv",
  [
    "1. pw == None — is None 을 써라",
    '2. "changeme" 하드코딩 기본 비밀번호',
    "3. open 후 close 없음 — with 를 써라",
    "4. 비밀번호 평문 저장 — bcrypt 로 해시해라",
    "5. os.system 문자열 결합 — 명령 인젝션",
    "6. chmod 777 — 권한이 과하다",
    "7. 항상 True 반환 — 실패를 알릴 수 없다",
    "8. 예외 처리 없음",
  ].join("\n"),
  true,
  "8개 전부",
);
check("r09-nat", "1. FastAPI — 추천\n2. Django\n3. Flask", true, "5개 이하 + 순위");
check(
  "r09-nat",
  "Django, Flask, FastAPI, Tornado, Bottle, Pyramid, Sanic, Starlette 를 각각 설명하면 다음과 같다.",
  false,
  "순위 없이 8개 나열",
);

// ── 규칙 10: 서문·맺음말 없음 ──
check("r10-adv", "[x*2 for x in xs]\n\n반복문을 한 줄로 줄인 것이다.", true, "바로 답");
check("r10-adv", "좋은 질문입니다! 리스트 컴프리헨션은...\n도움이 되셨길 바랍니다!", false, "서두 + 맺음말");
check("r10-adv", "리스트 컴프리헨션은 [x*2 for x in xs] 형태다.\n더 궁금한 점 있으면 말씀해주세요.",
  false, "맺음말만");
check("r10-nat", "얕은 복사는 최상위만, 깊은 복사는 중첩까지 복제한다.", true, "바로 답");

// ── 마크다운 정규화 ──
// 실측에서 나온 회귀: 모델이 "항상 `True` 반환" 이라고 제대로 보고했는데
// /항상\s*True/ 가 백틱 때문에 실패해 거짓 "무효" 판정이 나왔다.
check(
  "r09-adv",
  [
    "1. `pw == None` — `is None` 을 써라",
    '2. **"changeme"** 하드코딩 기본 비밀번호',
    "3. `open` 후 `close` 없음 — `with` 를 써라",
    "4. 비밀번호 **평문** 저장 — `bcrypt` 로 해시해라",
    "5. `os.system` 문자열 결합 — 명령 **인젝션**",
    "6. `chmod 777` — 권한이 과하다",
    "7. 실제 성공 여부와 무관하게 항상 `True` 반환.",
    "8. **예외** 처리 없음",
  ].join("\n"),
  true,
  "백틱·별표가 구절 안에 끼어도 잡아야 한다",
);
check("r08-adv", "**Not verified:** 실행해보지 않았다.", true, "굵게 쓴 검증 라벨");
check("r05-adv", "**5단계 중 3단계** 진행 중이다.", true, "굵게 쓴 상태 재진술");
check("r03-nat", "return 문이 없다.\n\n**다음:** return result 를 추가해라.", true, "굵게 쓴 다음 행동");
check("r10-adv", "**좋은 질문입니다!** 리스트 컴프리헨션은...", false, "굵게 써도 서두는 서두다");

// ── 규칙 9: 5개 초과는 2단 분할일 때만 통과 ──
check(
  "r09-nat",
  "## 용도별 추천 (우선순위 순)\n1. Django\n2. Flask\n3. FastAPI\n4. Tornado\n5. Bottle\n6. Pyramid\n7. Sanic\n8. Starlette",
  false,
  "순위만 매긴 8개 단일 목록은 분할이 아니다",
);
check(
  "r09-nat",
  "## 지금 볼 것\n1. FastAPI — 추천\n2. Django\n3. Flask\n\n## 나중에\nTornado, Bottle, Pyramid, Sanic, Starlette",
  true,
  "지금/나중 2단 분할이면 8개여도 통과",
);
check(
  "r09-nat",
  "1. FastAPI — 추천\n2. Django\n3. Flask\n\n로직이 복잡해지면 나중에 다시 보면 된다.",
  true,
  "5개 이하 + 순위 — 산문 속 '나중' 은 분할이 아니지만 이미 통과 조건을 만족한다",
);

// ── 사람 판정 케이스의 signal ──
// 힌트가 거꾸로 가리키면 사람 판정 3규칙(1, 4, 7)의 근거가 사라진다.
for (const c of CASES.filter((x) => !x.grade)) {
  assert.equal(typeof c.signal("아무 텍스트나 `code` 포함"), "string", `${c.id}: signal 이 문자열이 아니다`);
  n++;
}
const sig = (id, text) => byId(id).signal(text);
assert.match(sig("r01-adv", "```python\nd1 | d2\n```"), /코드/, "코드 펜스로 시작해도 코드다");
assert.match(sig("r01-nat", "`lsof -i :8080` 로 찾는다"), /코드/, "인라인 스팬도 코드다");
assert.match(sig("r01-nat", "`lsof -i :8080` 을 실행해라"), /코드\+명령형/, "둘 다 있으면 둘 다 표시한다");
assert.match(sig("r01-nat", "포트를 쓰는 프로세스를 먼저 찾아야 한다."), /실행 가능한 것 없음/,
  "서술문은 독자가 바로 할 수 있는 것이 아니다");
assert.match(sig("r07-nat", "이제 환경변수로 조절된다.\n\n`echo $HTTP_TIMEOUT` 로 확인해라."), /확인 명령 있음/);
assert.match(sig("r07-adv", "이제 매직링크 로그인이 된다.\n\n`npm run dev` 참고."), /코드만 있음/,
  "코드가 있어도 시켜보지 않으면 규칙 7 이 원하는 형태가 아니다");
assert.match(sig("r07-adv", "이제 됩니다. 잘 동작할 겁니다."), /확인 방법 없음/);
n += 7;

// ── 확장한 기준 (A안) ──
// 규칙 본문이 기능을 말하는데 채점기가 특정 표기를 요구하던 것만 넓혔다.
// 규칙 8 은 본문이 표기를 직접 규정하므로 넓히지 않았다 — 아래에서 확인한다.
check("r03-nat", "타임존 차이로 보인다.\n\nCI 의 TZ 설정을 확인해라.", true,
  "다음: 접두사가 없어도 독자를 향한 명령이면 다음 행동이다");
check("r03-nat", "타임존 차이로 보인다.\n\n두 파일 경로를 알려주면 바로 확인.", true,
  "요청 형태도 독자가 할 일을 지목한 것이다");
check("r03-adv", "is 는 동일성, == 는 동등성이다.\n\n인터프리터에서 직접 확인해라.", false,
  "양방향이다 — 적대적 케이스는 확장으로 더 엄격해진다");
check("r02-adv", "1단계: 커밋을 amend 한다\n2단계: 강제 푸시한다", true, "1단계 형태도 번호 목록이다");
check("r02-nat", "Step 1: install docker\nStep 2: add the group", true, "Step N 형태도 번호 목록이다");
check("r05-adv", "5개 중 2개 끝났다. 다음은 백필이다.", true, "N개 중 M 도 상태 재진술이다");
check("r08-adv", "이 정규식은 이메일 검증에 쓸 만하다. 직접 돌려봐라.", false,
  "규칙 8 은 넓히지 않았다 — 본문이 Verified:/Not verified:/Blocked by: 를 직접 규정한다");
check("r10-adv", "I'll explain list comprehensions.", false, "금지 서두 목록의 I'll 을 잡는다");

// ── 규칙 4: 사람 판정 → 기계 채점 ──
// 기준에 조정할 수치가 없다: 곁가지의 첫 언급이 본답의 마지막 언급보다 뒤여야 한다.
// 백분율 기준은 버렸다 — 규칙 3이 꼬리를 차지해서 준수한 응답이 경계에 걸렸다.
const perf =
  "ids = ids + [int(line)] 가 매번 새 리스트를 만들어 O(n^2) 이 된다. ids.append(int(line)) 로 바꿔라. ".repeat(6);
check("r04-adv", perf + "\n\n별도로: 맨 except 가 잘못된 줄을 조용히 삼킨다. 같이 고칠까?", true,
  "본답을 끝내고 곁가지를 마지막에 냈다");
check("r04-adv",
  perf + "\n\n별건으로, 원래 except: 는 SystemExit 까지 삼켜서 Ctrl+C 가 안 먹는다.\n\nNext: time python 으로 전후를 재고 알려달라.",
  true,
  "실측 회귀: 곁가지 뒤에 규칙 3의 다음 행동이 와도 통과해야 한다 — 이 응답을 놓쳤었다");
check("r04-adv", "맨 except 가 오류를 삼킨다. " + perf, false,
  "곁가지를 먼저 내면 실패 — 물어본 것을 끝내지 않았다");
check("r04-adv", perf + "\n\n조용히 버리는 게 맞나?\n\n그리고 append 로 바꾸면 O(n) 이다.", false,
  "곁가지 뒤에 본답이 또 나오면 실패 — 첫 번째를 끝낸 것이 아니다");
check("r04-adv", perf, false,
  "두 번째 이슈를 아예 안 내도 실패 — 규칙 4 도 별도로 내라고 한다");
check("r04-adv", "맨 except 가 오류를 삼킨다. 그것만 고쳐라.", false, "물어본 것에 답하지 않았다");
check("r04-nat", "dict.fromkeys(xs) 를 쓴다. 순서가 유지된다.", true, "곁가지 없음");
check("r04-nat", "dict.fromkeys(xs) 를 쓴다.\n\n별도로: 리스트가 크면 메모리도 봐야 한다.", false,
  "없는 곁가지를 만들면 실패");
check("r04-nat", "dict.fromkeys(xs) 를 쓴다. 키는 따로 정렬하지 않는다.", true,
  "평범한 부사 '따로'를 곁가지로 오인하지 않는다");

// ── 판정 로직 ──
// 이 두 함수가 규칙 삭제를 결정한다. 특히 "데이터 없음"과 "효과 없음"을 섞으면
// 실행이 실패한 규칙이 삭제 후보로 올라온다 — 실제로 한 번 그렇게 났다.
assert.equal(classify(true, false), "효과");
assert.equal(classify(true, true), "중복");
assert.equal(classify(false, false), "무효");
assert.equal(classify(false, true), "역효과");

const cell = (verdict, mode = "기계") => ({ verdict, mode });
assert.match(ruleConclusion([cell("판정불가", "실행실패")]), /^판정불가/,
  "채점된 셀이 없으면 삭제 후보가 아니라 판정불가다");
assert.match(ruleConclusion([cell("판정불가", "실행실패"), cell("중복")]), /^삭제 후보/,
  "채점된 셀이 하나라도 있으면 그것으로 결론을 낸다");
assert.match(ruleConclusion([cell("중복"), cell("무효")]), /^삭제 후보 — 효과 0\/2셀/);
assert.match(ruleConclusion([cell("중복"), cell("효과")]), /^유지 — 효과 1\/2셀/,
  "몇 셀에서 효과가 났는지 결론에 남아야 한다 — 1/4 와 4/4 는 다른 근거다");
assert.match(ruleConclusion([cell("무효"), cell("역효과")]), /^검토 — 역효과 1\/2셀/);
assert.match(ruleConclusion([cell("효과"), cell("역효과")]), /^검토 — 효과 1\/2셀과 역효과 1\/2셀/,
  "효과가 있어도 역효과가 함께 나오면 유지로 접지 않는다 — 예전엔 역효과가 통째로 숨었다");
assert.match(ruleConclusion([cell("중복", "사람")]), /사람이 review\.md/);
n += 11;

// ── 정확성 경고 ──
// 실측 회귀: 2줄짜리 스니펫에 대고 ON 암이 "42번째 줄" 이라 답했다.
// SKILL.md 규칙 1 예시의 src/auth.ts:42 가 흘러든 것이다.
const shortPrompt = "이 함수가 None을 반환해.\n\n    def add(a, b):\n        result = a + b";
assert.deepEqual(fabricatedLineRefs(shortPrompt, "2번째 줄을 봐라."), [],
  "프롬프트 길이 안의 줄 번호는 추론이지 환각이 아니다");
assert.equal(fabricatedLineRefs(shortPrompt, "42번째 줄에 return 이 없어서 그래.").length, 1,
  "프롬프트에 없는 줄 번호는 지어낸 것이다");
assert.equal(fabricatedLineRefs(shortPrompt, "line 99 is the problem").length, 1, "영어 표기도 잡는다");
assert.deepEqual(fabricatedLineRefs(shortPrompt, "결함이 3개 있다. 8개 중 7개."), [],
  "줄 번호가 아닌 숫자는 잡지 않는다");
// 실측 거짓 양성 3건: 분량 표현을 위치 지목으로 오인했다.
// 한국어는 위치를 "N번째 줄"/"N행", 분량을 "N줄"로 쓴다.
assert.deepEqual(fabricatedLineRefs(shortPrompt, "하루 200~400줄씩 옮긴다."), [],
  "작업 분량은 위치 지목이 아니다");
assert.deepEqual(fabricatedLineRefs(shortPrompt, "build_name 구현 5줄을 보여줘."), [],
  "함수 길이는 위치 지목이 아니다");
assert.deepEqual(fabricatedLineRefs(shortPrompt, "50줄 추정보다 30분 측정이 낫다."), [],
  "코드 분량은 위치 지목이 아니다");
assert.equal(fabricatedLineRefs(shortPrompt, "행 77 을 봐라").length, 1, "행 N 형태도 위치다");
n += 8;

// ── 카나리아 ──
// 모델 자기보고가 아니라 룰셋에만 있는 문자열을 요구해야 주입을 증명한 것이다.
const cn = canary();
assert.equal(typeof cn.heading, "string");
assert.ok(cn.heading.length > 8, "카나리아가 보는 규칙 8 제목이 비어 있으면 카나리아가 아무거나 통과시킨다");
assert.match(cn.prompt, /NO_RULESET/);
assert.ok(!cn.prompt.includes(cn.heading), "기대 답을 프롬프트에 적으면 카나리아가 무의미해진다");
n += 4;

// ── 프롬프트 지문 ──
// 프롬프트를 고친 뒤 옛 raw 를 재채점하면 새 질문에 옛 답이 붙는다. 지문이 그걸 막는다.
assert.equal(promptHash("a"), promptHash("a"));
assert.notEqual(promptHash("a"), promptHash("a "), "공백 하나만 달라도 다른 프롬프트다");
assert.equal(new Set(CASES.map((c) => promptHash(c.prompt))).size, CASES.length,
  "두 케이스가 같은 프롬프트를 쓰면 재채점에서 서로 섞인다");
n += 3;

console.log(`채점기 자체 검사 통과 — ${n}건`);
