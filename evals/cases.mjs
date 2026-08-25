// adhd-mode eval cases — 10개 규칙 × (적대적 1 + 자연 1) = 20 케이스.
//
// 프롬프트는 자기완결적이다: 파일도 도구도 필요 없다. 러너가 도구를 전부 막고
// 단일 턴으로 돌린다. 코드는 백틱 없이 들여쓰기로 넣는다 — 템플릿 리터럴과 충돌한다.
//
// grade(text) -> {pass, detail}   기계 채점. null이면 사람이 review.md에서 읽는다.
// 규칙마다 채점 기준이 다르므로 grader는 케이스가 직접 들고 있다.
// signal(text) -> string          사람이 읽을 때 옆에 붙는 힌트. 판정이 아니다.

// 모델은 강조를 구절 한가운데 넣는다 — "항상 `True` 반환", "**5단계 중 2단계**".
// 그대로 두면 정규식이 구절을 놓치고 거짓 "무효" 판정이 나온다. 채점 전에 벗긴다.
// CODE 는 백틱 자체가 신호라 이 정규화를 쓰지 않는다.
const plain = (t) => t.replace(/[`*_]/g, "");
const first = (t) => (t.trim().split("\n").find((l) => l.trim()) || "").trim();
const tail = (t, n = 3) =>
  t.trim().split("\n").filter((l) => l.trim()).slice(-n).join("\n");
const sentences = (t) => t.split(/(?<=[.!?。])\s+|\n+/).filter((s) => s.trim());
const v = (pass, detail) => ({ pass, detail });

const OPENERS =
  /^\s*(좋은 질문|훌륭한 질문|재미있는 질문|물론|넵|네[,!]|알겠|Great question|Sure[,!]|Of course|Let me |I'?ll |I will |I'?m going to|Looking at|To answer)/i;
const CLOSERS =
  /(도움이 되|도움이 됐|도움 되[셨었]|더 궁금|궁금한 점|편하게 (말씀|물어|알려)|필요하[면시][^.]*말씀|언제든|Hope this helps|Let me know|Feel free|Happy to (help|clarify))/i;
// 규칙 3 은 "2분 안에 할 수 있는 한 가지를 지목하라"고 한다. `다음:` 접두사는
// SKILL.md 에서 Good 예시로만 나오고 요구사항이 아니다. 접두사만 인정하면 독자를
// 향한 명령·요청을 다른 형태로 낸 응답을 놓친다.
//
// 이 확장은 양방향이다: r03-adv 는 다음 행동이 *없어야* 통과이므로 더 엄격해지고,
// r03-nat 은 느슨해진다. 한쪽 암에 유리한 변경이 아니다.
const NEXT_LABEL = /^\s*(Next|다음)\s*[::]|^\s*다음 (행동|단계|할 일)\s*[::]/im;
// 한국어는 어미 자체가 명령이라 어디에 있어도 안전하다. 영어 동사는 줄머리로
// 한정한다 — 그러지 않으면 "npm run dev" 의 run 이 명령형으로 잡힌다.
const NEXT_ASK = {
  test: (t) =>
    /(해라|하라|해줘|해봐|봐라|보라|돌려|실행해|확인해|붙여|알려주|넣어|열어|재현해|찍어)/.test(t) ||
    /^\s*[-*>]?\s*(run|try|check|paste|open|see|add|set)\b/im.test(t),
};
const NEXT = { test: (t) => NEXT_LABEL.test(t) || NEXT_ASK.test(t) };

const STATE =
  /\d+\s*단계\s*중\s*\d+|\d+\s*개\s*중\s*\d+|\d+\s*\/\s*\d+\s*단계|\d+\s*단계\s*\/\s*\d+|(step|단계)\s*\d+\s*(of|\/)\s*\d+|\d+\s*of\s*\d+\s*(steps?|단계)/i;
const TIME =
  /\d+\s*(분|시간|일|주일?|개월|달|년|minutes?|mins?|hours?|hrs?|days?|weeks?|months?)/i;
const LABEL =
  /(Verified\s*[::]|Not verified\s*[::]|Blocked by\s*[::]|검증함|검증하지 않|미검증|검증 안 |확인하지 않)/i;
// 규칙 2 는 "번호 목록"을 요구한다. 1. / 1) 만 보면 한국어에서 흔한 "1단계",
// 영어의 "Step 1" 형태를 놓친다 — 둘 다 번호 매긴 목록이다.
const NUMLIST = /^\s{0,3}(\d+[.)]\s+\S|\d+\s*단계\s*[::\s]|(Step|단계)\s*\d+\s*[::\s])/im;
// 코드 펜스 여는 줄(```python)도 코드로 친다. 인라인 스팬 패턴만 보면
// 펜스로 시작하는 응답이 "코드 없음"으로 나와 힌트가 거꾸로 가리킨다.
const CODE = /^\s*```|`[^`]+`|^\s{4,}\S|^\s*\$\s+\S/m;
// 독자를 향한 명령형. 규칙 1·7 의 신호에 쓴다 — 코드 유무만 보면 프롬프트에 코드가
// 있는 케이스에서 모든 셀이 "있음"으로 나와 힌트가 무용지물이 된다.
const IMPERATIVE = NEXT_ASK;
const RANKED = /(1[.)]\s|1위|먼저|우선|추천|권장|Recommended|start with|top pick)/i;
// 규칙 9 가 5개 초과에 허용하는 유일한 형태: 지금/나중, must/nice 2단 분할.
// 두 단이 각각 줄머리(또는 제목)에 서야 한다 — 산문 속의 "나중에 복잡해지면" 같은
// 표현을 분할로 오인하면, 순위만 매긴 8개짜리 목록이 통과해 규칙이 헐거워진다.
const TIER_NOW = /^ {0,3}(#{1,4} *)?(지금|당장|먼저|우선|must|do now)/im;
const TIER_LATER = /^ {0,3}(#{1,4} *)?(나중|추후|그 외|나머지|nice|later)/im;
const SPLIT = { test: (t) => TIER_NOW.test(t) && TIER_LATER.test(t) };

// 규칙 6 — 시간값이 있으면 그 문장 안에 가정이 함께 있어야 한다.
// 시간값이 아예 없으면 근거 없음을 말해야 한다.
const gradeTime = (raw) => {
  const t = plain(raw);
  const timed = sentences(t).filter((s) => TIME.test(s));
  const range = /\d+\s*[~\-–]\s*\d+/.test(t);
  const noBasis =
    /(근거[^.]*없|알 수 없|추정[^.]*(불가|어렵|힘들)|모른|판단[^.]*불가|no basis|cannot estimate|no way to|not enough)/i.test(t);
  if (timed.length === 0) {
    return v(noBasis, noBasis ? "시간값 없음 + 근거 없음 명시" : "시간값도 근거 언급도 없음");
  }
  // 한글 뒤에서는 \b 가 경계로 잡히지 않는다 (\b 는 ASCII 기준). 조건 어미를
  // 통째로 나열한다 — 맨 "면" 하나만 보면 화면·측면 같은 명사에 걸린다.
  const hedged = timed.filter((s) =>
    /(으면|이면|라면|하면|다면|경우|가정|따라|기준|따져|달[려라]|if |assum|depend)/i.test(s),
  );
  return v(
    hedged.length === timed.length || (range && hedged.length > 0),
    `시간값 ${timed.length}문장 중 가정 동반 ${hedged.length}${range ? " (범위 표기 있음)" : ""}`,
  );
};

// 규칙 9 적대적 — 심어둔 결함 8개 중 몇 개를 보고했나.
const BUGS = [
  [/==\s*None|!=\s*None|is None|None\s*(과|와|비교|검사)/i, "== None 비교"],
  [/changeme|하드코딩|기본\s*(비밀번호|패스워드|암호)|default password/i, "하드코딩 기본 비밀번호"],
  [/\bwith\b|\.close\(|닫[지히]|파일[^.]*닫|리소스[^.]*누수|file handle/i, "파일 미close"],
  [/평문|plaintext|plain text|해시|hash|bcrypt|암호화|encrypt/i, "비밀번호 평문 저장"],
  [/os\.system|인젝션|injection|subprocess|셸 명령|shell command/i, "명령 인젝션"],
  [/777/, "777 권한"],
  [/항상\s*True|무조건\s*True|반환값[^.]*(의미|무의미|쓸모)|실패[^.]*(알리|반영|구분)/i, "항상 True 반환"],
  [/예외|except|try\b|error handling|오류 처리|에러 처리/i, "예외 처리 없음"],
];
const gradeBugs = (raw) => {
  const t = plain(raw);
  const missed = BUGS.filter(([re]) => !re.test(t)).map(([, n]) => n);
  return v(missed.length === 0, `${BUGS.length - missed.length}/8 — 누락: ${missed.join(", ") || "없음"}`);
};

const gradeNoFrame = (raw) => {
  const t = plain(raw);
  const bad = { o: OPENERS.test(first(t)), c: CLOSERS.test(tail(t, 2)) };
  return v(!bad.o && !bad.c, `서두 ${bad.o ? "있음" : "없음"} / 맺음말 ${bad.c ? "있음" : "없음"}`);
};

const gradeNumbered = (raw) => {
  const ok = NUMLIST.test(plain(raw));
  return v(ok, ok ? "번호 목록 있음" : "번호 목록 없음");
};
const gradeLabel = (raw) => {
  const ok = LABEL.test(plain(raw));
  return v(ok, ok ? "검증 라벨 있음" : "검증 라벨 없음");
};
const gradeNext = (want) => (raw) => {
  const has = NEXT.test(tail(plain(raw), 3));
  return v(has === want, has ? "다음 행동 있음" : "다음 행동 없음");
};
const gradeState = (want) => (raw) => {
  const has = STATE.test(plain(raw));
  return v(has === want, has ? "상태 재진술 있음" : "상태 재진술 없음");
};
// 규칙 4 — "두 번째 이슈가 있으면 첫 번째를 끝내고, 두 번째는 별도 질문으로 낸다."
//
// 기계로 재려면 두 이슈가 서로 독립이어야 한다. 이전 프롬프트(따옴표 이스케이프 +
// SQL 인젝션)는 뿌리와 수정이 같아서 둘을 묶어 답하는 편이 옳았다 — 규칙 준수와
// 좋은 판단을 구분할 수 없는 케이스였고, 그건 양쪽 암에 똑같이 해당했다.
//
// 처음에는 "곁가지가 마지막 3분의 1에 있는가"로 쟀다. 그 기준은 버렸다: 규칙 3이
// 꼬리 자리를 정당하게 차지하기 때문이다. 두 규칙을 다 지킨 응답은 곁가지가 끝에서
// 두 번째로 밀려 백분율이 내려가고, 실측에서 64·65%가 통과선 67%에 걸렸다 —
// 임의의 수치가 판정을 좌우했다.
//
// 지금 기준에는 조정할 수치가 없다: 곁가지의 첫 언급이 본답의 **마지막** 언급보다
// 뒤여야 한다. "첫 번째를 끝내고, 두 번째를 낸다"를 그대로 옮긴 것이다.
const lastIndex = (t, re) => {
  let i = -1;
  for (const m of t.matchAll(new RegExp(re.source, re.flags.replace("g", "") + "g"))) i = m.index;
  return i;
};
const gradeTangent = (primary, second) => (raw) => {
  const t = plain(raw);
  const pFirst = t.search(primary);
  const pLast = lastIndex(t, primary);
  const s = t.search(second);
  if (pFirst < 0) return v(false, "물어본 것에 답하지 않았다");
  if (s < 0) return v(false, "두 번째 이슈를 아예 안 냈다 (규칙 4 도 내라고 한다)");
  const at = (i) => Math.round((i / t.length) * 100);
  return v(s > pLast, `본답 ${at(pFirst)}~${at(pLast)}% / 곁가지 ${at(s)}%`);
};

// 곁가지가 없는 질문에서 곁가지를 만들어내면 실패. "따로"는 평범한 부사라 뺀다.
const MANUFACTURED = /(별도로|참고로|덧붙이자면|한 가지 더|Separately|By the way)/i;

// 규칙 1 — "첫 줄은 독자가 할 수 있는 것". 코드일 수도, 명령형 문장일 수도 있다.
const codeSignal = (t) => {
  const l = first(t);
  const bits = [CODE.test(l) && "코드", IMPERATIVE.test(l) && "명령형"].filter(Boolean);
  return bits.length ? `첫 줄에 ${bits.join("+")} 있음` : "첫 줄에 실행 가능한 것 없음";
};

// 규칙 7 — "이제 되는 것을 구체적으로". 아무 데나 코드가 있는 것으로는 안 갈린다:
// 프롬프트가 코드를 주는 케이스라 8셀 전부 "있음"이 나왔다. 끝부분에서 독자에게
// 확인을 시키는지를 본다.
const verifySignal = (t) => {
  const end = tail(t, 4);
  const code = CODE.test(end), imp = IMPERATIVE.test(end);
  return code && imp ? "끝부분에 확인 명령 있음"
    : code ? "끝부분에 코드만 있음 (시켜보지는 않음)"
    : imp ? "끝부분에 명령형만 있음 (코드 없음)"
    : "끝부분에 확인 방법 없음";
};

export const CASES = [
  // ── 규칙 1: 다음 행동을 먼저 제시한다 ── 사람 판정
  {
    id: "r01-adv",
    rule: 1,
    kind: "adversarial",
    title: "설명 요구가 섞인 실행 가능한 질문",
    prompt: "파이썬에서 딕셔너리 두 개를 합치는 방법이 궁금해. 왜 방법이 여러 개인지도 궁금하고.",
    expect: "첫 줄이 실행 가능한 답(코드/명령). 설명은 그 뒤.",
    grade: null,
    signal: codeSignal,
  },
  {
    id: "r01-nat",
    rule: 1,
    kind: "natural",
    title: "평범한 실행 질문",
    prompt: "리눅스에서 8080 포트를 쓰고 있는 프로세스를 찾아서 종료하려면?",
    expect: "첫 줄이 명령어.",
    grade: null,
    signal: codeSignal,
  },

  // ── 규칙 2: 여러 단계 작업은 번호를 매긴다 ── 기계
  {
    id: "r02-adv",
    rule: 2,
    kind: "adversarial",
    title: "단계가 많은데 한 문장으로 뭉뚱그리기 쉬운 작업",
    prompt: "git에서 마지막 커밋 메시지만 고치고 싶은데, 이미 원격에 푸시한 상태야.",
    expect: "번호 목록.",
    grade: gradeNumbered,
  },
  {
    id: "r02-nat",
    rule: 2,
    kind: "natural",
    title: "명백한 다단계 설치 작업",
    prompt: "우분투에 도커를 설치하고 sudo 없이 쓸 수 있게 설정하려면 어떻게 해?",
    expect: "번호 목록.",
    grade: gradeNumbered,
  },

  // ── 규칙 3: 남은 작업이 있을 때만 다음 행동으로 끝낸다 ── 기계, 양극성
  {
    id: "r03-adv",
    rule: 3,
    kind: "adversarial",
    title: "완결된 질문 — 다음 행동을 지어내면 실패",
    prompt: "파이썬에서 is 와 == 의 차이가 뭐야?",
    expect: "다음 행동 없음. 답에서 끝.",
    grade: gradeNext(false),
  },
  {
    id: "r03-nat",
    rule: 3,
    kind: "natural",
    // 이전 프롬프트(2줄짜리 add 함수)는 구조적 결함이었다: 모델이 수정본을 통째로
    // 주면 남은 작업이 사라져 "다음 행동 없음"이 규칙 3상 정답이 된다. 그래서 양쪽
    // 암이 함께 실패했다. 모델이 확정할 수 없는 정보를 남겨 다음 행동을 강제한다.
    title: "모델이 확정할 수 없는 정보가 남는 질문",
    prompt: [
      "이 테스트가 CI에서만 실패하고 로컬에선 통과해. 왜 그럴까?",
      "",
      "    def test_report_name():",
      "        assert build_name() == 'report-2026-08-24.csv'",
    ].join("\n"),
    expect: "가설을 대고, 마지막에 2분 안에 확인할 수 있는 다음 행동 하나.",
    grade: gradeNext(true),
  },

  // ── 규칙 4: 곁가지를 억제한다 ── 사람 판정
  {
    id: "r04-adv",
    rule: 4,
    kind: "adversarial",
    title: "물어본 것과 무관한 두 번째 문제가 같이 보임",
    prompt: [
      "이 함수가 10만 줄짜리 파일에서 너무 느려. 왜지?",
      "",
      "    def load_ids(path):",
      "        ids = []",
      "        for line in open(path):",
      "            try:",
      "                ids = ids + [int(line)]",
      "            except:",
      "                pass",
      "        return ids",
    ].join("\n"),
    expect: "성능(O(n^2) 리스트 재생성)을 먼저 끝내고, 맨 except 는 맨 끝에 별도로.",
    grade: gradeTangent(
      /O\(n|이차|제곱|quadratic|append|매번 새|새 리스트|리스트를 새로|복사/i,
      // 실측에서 이 정규식이 교과서적으로 준수한 응답을 놓쳤다: "…까지 삼켜서",
      // "조용히 버리는" 을 `삼키`·`버려` 로만 찾은 탓이다. 어간 변화를 통째로 받는다.
      // `ValueError` 는 일부러 뺐다 — 코드 안에서 조용히 고친 것은 "별도로 낸" 것이
      // 아니고, 그걸 세면 곁가지를 본문에 접어 넣은 응답이 통과한다.
      /except\s*:|맨\s*except|bare except|삼[키켜킨]|조용히|silently|swallow|KeyboardInterrupt|SystemExit/i,
    ),
  },
  {
    id: "r04-nat",
    rule: 4,
    kind: "natural",
    title: "곁가지가 없는 단일 질문",
    prompt: "파이썬 리스트에서 순서를 유지하면서 중복을 제거하려면?",
    expect: "곁가지 없음.",
    grade: (raw) => {
      const has = MANUFACTURED.test(plain(raw));
      return v(!has, has ? "없는 곁가지를 만들었다" : "곁가지 없음");
    },
  },

  // ── 규칙 5: 3단계 이상 작업에서만 상태를 재진술한다 ── 기계, 양극성
  {
    id: "r05-adv",
    rule: 5,
    kind: "adversarial",
    title: "5단계 중 2단계 완료 — 상태 재진술이 필요",
    prompt: "스키마 마이그레이션 5단계 중 2단계까지 끝냈어. 컬럼 추가하고 인덱스 만들었어. 다음은 뭐지?",
    // 러너가 TodoWrite 를 막으므로 "plan tool 로 상태 재진술" 경로는 측정되지
    // 않는다 — -p 의 result 필드에 도구 호출이 안 담겨 사람이 볼 수 없기 때문이다.
    // 여기서 재는 것은 산문 재진술 경로뿐이다.
    expect: "몇 단계 중 몇 단계인지 다시 말한다 (산문 경로만 측정).",
    grade: gradeState(true),
  },
  {
    id: "r05-nat",
    rule: 5,
    kind: "natural",
    title: "2단계 작업 — 재진술하면 그게 군더더기",
    prompt: "requests 패키지 설치는 끝났어. 이제 임포트만 하면 되는데 다음은?",
    expect: "상태 재진술 없음.",
    grade: gradeState(false),
  },

  // ── 규칙 6: 근거가 있을 때만 시간을 추정한다 ── 기계
  {
    id: "r06-adv",
    rule: 6,
    kind: "adversarial",
    title: "모델이 알 수 없는 규모의 추정 요구",
    prompt: "자바스크립트 5만 줄짜리 레거시 프로젝트를 타입스크립트로 마이그레이션하는 데 얼마나 걸릴까?",
    expect: "근거 없음을 말하거나, 가정을 붙인 범위.",
    grade: gradeTime,
  },
  {
    id: "r06-nat",
    rule: 6,
    kind: "natural",
    title: "근거가 있는 소규모 작업",
    prompt: "함수 하나에서 매직 넘버 3개를 상수로 빼는 리팩터링이야. 얼마나 걸려?",
    expect: "가정을 붙인 범위.",
    grade: gradeTime,
  },

  // ── 규칙 7: 완료된 작업을 구체적으로 보여준다 ── 사람 판정
  {
    id: "r07-adv",
    rule: 7,
    kind: "adversarial",
    title: "diff만 주고 사용자 통보문을 요구",
    prompt: [
      "아래 diff를 적용했어. 사용자한테 뭐가 달라졌는지 알려줘.",
      "",
      "    - app.post('/login', (req, res) => res.status(501).send())",
      "    + app.post('/login', sendMagicLink)",
      "    + app.get('/login/verify/:token', verifyMagicLink)",
    ].join("\n"),
    expect: "이제 되는 것 + 확인 방법(실행 가능한 명령/경로).",
    grade: null,
    signal: verifySignal,
  },
  {
    id: "r07-nat",
    rule: 7,
    kind: "natural",
    title: "작은 패치의 통보문",
    prompt: [
      "아래 패치를 적용했어. 사용자한테 뭐라고 알려주지?",
      "",
      "    - TIMEOUT = 5",
      '    + TIMEOUT = int(os.environ.get("HTTP_TIMEOUT", "30"))',
    ].join("\n"),
    expect: "이제 되는 것 + 확인 방법.",
    grade: null,
    signal: verifySignal,
  },

  // ── 규칙 8: 검증 여부를 명시한다 ── 기계
  {
    id: "r08-adv",
    rule: 8,
    kind: "adversarial",
    title: "실행할 수 없는데 확인을 요구",
    prompt: [
      "이 정규식이 이메일을 제대로 검증하는지 확인해줘.",
      "",
      "    ^[^@]+@[^@]+\\.[a-z]{2,}$",
    ].join("\n"),
    expect: "Verified / Not verified / Blocked by 라벨.",
    grade: gradeLabel,
  },
  {
    id: "r08-nat",
    rule: 8,
    kind: "natural",
    title: "짧은 함수 리뷰",
    prompt: ["이 함수 리뷰해줘.", "", "    def avg(xs):", "        return sum(xs) / len(xs)"].join("\n"),
    expect: "Verified / Not verified / Blocked by 라벨.",
    grade: gradeLabel,
  },

  // ── 규칙 9: 선택지는 5개로 정렬, 발견 사항은 자르지 않는다 ── 기계
  {
    id: "r09-adv",
    rule: 9,
    kind: "adversarial",
    title: "결함 8개를 심은 스니펫 — 자르면 실패",
    prompt: [
      "이 함수의 문제점을 전부 찾아줘.",
      "",
      "    import os",
      "",
      "    def save(user, pw, path):",
      "        if pw == None:",
      '            pw = "changeme"',
      '        f = open(path, "w")',
      '        f.write("%s:%s" % (user, pw))',
      '        os.system("chmod 777 " + path)',
      "        return True",
    ].join("\n"),
    expect: "심어둔 결함 8개 전부.",
    grade: gradeBugs,
  },
  {
    id: "r09-nat",
    rule: 9,
    kind: "natural",
    // 이전 프롬프트는 8개를 전부 지명했다. 채점기의 named<=5 는 이름만 언급해도
    // 세므로, 지명된 것을 빼고 답하는 것이 사실상 불가능했다 — 2단 분할만이 유일한
    // 통과로였고 양쪽 암이 함께 실패했다. 개수를 모델이 정하게 둔다.
    title: "선택지가 많은 영역 — 5개로 줄여 순위를 매겨야",
    prompt: "파이썬 웹 프레임워크가 너무 많아서 뭘 골라야 할지 모르겠어. 정리해줘.",
    expect: "5개 이하로 순위, 또는 지금/나중 분할.",
    // 규칙 9 는 두 경로를 허용한다: 5개 이하로 순위, 또는 5개를 넘기면 2단으로 분할.
    // 순위만 매긴 8개짜리 단일 목록은 어느 쪽도 아니다 — 통과시키지 않는다.
    grade: (raw) => {
      const t = plain(raw);
      const named = ["Django", "Flask", "FastAPI", "Tornado", "Bottle", "Pyramid", "Sanic", "Starlette"]
        .filter((n) => new RegExp(n, "i").test(t)).length;
      const ranked = RANKED.test(t);
      const split = SPLIT.test(t);
      return v(
        (ranked && named <= 5) || split,
        `언급 ${named}개 / 순위 ${ranked ? "있음" : "없음"} / 2단 분할 ${split ? "있음" : "없음"}`,
      );
    },
  },

  // ── 규칙 10: 서문·요약·맺음말 없음 ── 기계
  {
    id: "r10-adv",
    rule: 10,
    kind: "adversarial",
    title: "친근한 인사가 붙은 초보 질문 — 서문 유도",
    prompt: "안녕! 나 파이썬 처음인데 리스트 컴프리헨션이 뭔지 알려줄래? 고마워!",
    expect: "서두·맺음말 없이 바로 답.",
    grade: gradeNoFrame,
  },
  {
    id: "r10-nat",
    rule: 10,
    kind: "natural",
    title: "평범한 기술 질문",
    prompt: "파이썬에서 얕은 복사와 깊은 복사의 차이가 뭐야?",
    expect: "서두·맺음말 없이 바로 답.",
    grade: gradeNoFrame,
  },
];
