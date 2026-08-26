# adhd-mode

Claude Code와 Codex의 응답을 읽고 바로 실행할 수 있는 형태로 바꾸는 플러그인.
**설치하면 켜진다.** 매 세션 호출할 필요가 없다.

[ayghri/i-have-adhd](https://github.com/ayghri/i-have-adhd)의 포크다.
갈라진 범위와 근거는 [`UPSTREAM.md`](UPSTREAM.md)에 있다.

## 무엇이 달라지나

| | |
|---|---|
| Before | "좋은 질문입니다! 인증 흐름을 살펴보면 미들웨어, 토큰 검증, 쿠키 처리 등 여러 부분이 얽혀 있는데요… 도움이 되셨길 바랍니다!" |
| After | `npm install jsonwebtoken` 실행 후 `src/auth.ts:42` 수정.<br>1. `src/auth.ts` 열기 2. `verifyToken`(42–58행) 교체 3. `npm test -- auth.spec.ts` |

## 설치

### 로컬 경로 (개발용)

```bash
git clone https://github.com/wotjr1649/adhd-mode.git
cd adhd-mode

claude plugin marketplace add "$PWD"
claude plugin install adhd-mode@adhd-mode

codex plugin marketplace add "$PWD"
codex plugin add adhd-mode@adhd-mode
```

**Claude**는 작업 트리를 직접 읽는다. 고치면 다음 세션에 바로 반영된다.

**Codex**는 `~/.codex/plugins/cache/` 로 복사한 것을 실행한다. 고칠 때마다
`codex plugin add adhd-mode@adhd-mode` 를 다시 돌려야 반영된다. `codex plugin list` 의
`PATH` 열은 marketplace root를 보여주지만 실행본은 캐시다.

### GitHub

```bash
claude plugin marketplace add wotjr1649/adhd-mode      # 브랜치는 owner/repo@ref
claude plugin install adhd-mode@adhd-mode

codex plugin marketplace add wotjr1649/adhd-mode --ref main
codex plugin add adhd-mode@adhd-mode
```

### Codex는 훅 승인이 한 번 더 필요하다

플러그인 설치와 훅 신뢰는 별개다. **승인 전까지 훅은 실행되지 않고, 그 사실은 어디에도
표시되지 않는다** — `codex plugin list` 는 그대로 `installed, enabled` 를 찍는다.

설치 뒤 대화형 `codex` 를 한 번 띄워 훅 승인 프롬프트를 수락한다. 승인되면 항목이 생긴다.

```bash
grep "adhd-mode@adhd-mode:" ~/.codex/config.toml
# [hooks.state."adhd-mode@adhd-mode:hooks/hooks.json:session_start:0:0"]
```

`codex exec` 같은 비대화형 실행으로는 승인을 받을 수 없다. 훅 내용이 바뀌어 해시가
달라지면 다시 승인해야 한다.

### 확인

```bash
claude plugin details adhd-mode     # Skills (1), Hooks (1) 가 보여야 한다
codex plugin list                   # installed, enabled
```

새 세션을 열면 첫 응답 전에 `ADHD MODE ACTIVE` 가 뜬다.

## 끄기

```text
"stop adhd mode"    양쪽 호스트. 주입된 룰셋 본문이 처리한다
"normal mode"       같음
```

전용 off 스킬이 있었는데 지웠다. Codex 는 원래 그 스킬을 로드하지 않고 룰셋 본문으로
끄기를 처리하고 있었다 — 같은 기능을 Claude Code 에서만 스킬로 한 번 더 만든 셈이었다.
상시 70 토큰을 쓰고, "한 줄로 확인"(룰셋)과 "정확히 이 문장"(스킬)이 서로 다른 답을
지시하는 모순도 있었다.

**끄기는 현재 컨텍스트에만 적용된다.** 아래 경계에서 SessionStart 훅이 다시 발동해 규칙이
재주입되고, 그 사실은 별도로 알려주지 않는다. 다만 **끄기가 살아남는지는 경계마다 다르다** —
껐다는 지시가 트랜스크립트에 남아 있으면 끄기가 이긴다.

| 경계 | 규칙 재주입 | 끄기 유지 |
|---|---|---|
| resume | 예 | **예** (실측) |
| compaction | 예 | 아니오 (실측) |
| `/clear`, 새 세션 | 예 | 아니오 (트랜스크립트 소멸) |
| 세션 fork | 예 | 미측정 |
| 서브에이전트 스폰 | 아니오 | 무관 (주입이 없으니 규칙도 없다) |

서브에이전트 행은 원래 반대였다. `SubagentStart` 훅이 matcher 없이 모든 서브에이전트에
룰셋을 주입했고, 훅에 끄기 분기가 없어 **껐는데 위임하면 규칙이 되살아났다**. 그 주입을
지웠다 — 서브에이전트 출력의 독자는 사람이 아니라 부모 모델이고, 사람에게 닿는 서식은
부모 세션의 주입이 이미 담당한다. 서브에이전트에게 검증 라벨을 받고 싶으면 위임
프롬프트에 직접 적는 편이 싸고 정확하다.

영구히 끄려면:

```bash
claude plugin disable adhd-mode
codex plugin remove adhd-mode
```

## 규칙 10개

전문은 [`skills/adhd-mode/SKILL.md`](skills/adhd-mode/SKILL.md).

1. 다음 행동을 먼저 제시한다
2. 여러 단계 작업은 번호를 매긴다
3. 남은 작업이 있을 때만 다음 행동으로 끝낸다
4. 곁가지를 억제한다
5. 3단계 이상이거나 여러 턴에 걸친 작업에서 진행 상태를 재진술한다
6. 근거가 있을 때만 시간을 추정한다
7. 완료된 작업을 구체적으로 보여준다
8. 검증 여부를 `Verified` / `Not verified` / `Blocked by`로 명시한다
9. 선택지는 5개로 정렬하되, 발견 사항은 절대 자르지 않는다
10. 서문·요약·맺음말 없음

규칙은 11개였다. **"오류는 담담하게"는 측정 결과 지웠다** — 규칙 없이도 양쪽 암이
같은 출력을 냈다. 근거는 [`evals/README.md`](evals/README.md)의 「지운 규칙」 절에 있다.

간결성보다 정확성·안전성·완전성이 우선한다. 규칙이 답 자체를 지우게 되면
답이 이긴다 — SKILL.md의 "When to break the rules" 참조.

## 동작 방식

```text
SessionStart(startup|resume|clear|compact|fork)
  → hooks/inject.mjs
  → skills/adhd-mode/SKILL.md 본문을 stdout으로
```

- 훅은 파일 하나를 읽어 출력할 뿐이다. 어디에도 쓰지 않는다
- 상태 파일, 홈 디렉터리 수정, 네트워크, MCP, telemetry 없음
- 실패해도 세션 시작을 막지 않는다 (exit 0). 다만 이유는 stderr에 남긴다
- 비용: 세션당 **1,933 토큰**(o200k 실측, 본문 8,254 바이트 기준. 현재 8,262 바이트).
  서브에이전트는 0 — 주입하지 않는다.
  `claude plugin details` 의 `Always-on: ~103 tok` 과 `Hooks (1) SessionStart (harness-only
  — no model context cost)` 는 이 플러그인에 대해 틀리다. 실제 주입량은 위 수치다
- `additionalContextLimit: 4000` 을 명시한다. Codex 기본값은 핸들러당 2,500 토큰이고
  (공식 config-schema의 `HookHandlerConfig`), 넘으면 전문을 모델에 넣지 않고 파일로
  흘린 뒤 앞뒤 preview만 준다. 본문 1,933는 기본값의 77%라 여유가 없다
- 스킬은 모델도 사용자도 부를 수 없다 (`disable-model-invocation`, `user-invocable: false`,
  Codex 쪽 `allow_implicit_invocation: false`). 훅이 본문을 주입하므로 부를 일이 없다.
  `disable-model-invocation` 은 모델 자동 호출만 막고 슬래시 명령은 그대로 남기며, 사용자
  호출에는 중복 감지가 걸리지 않아 치면 같은 본문이 한 벌 더 들어갔다 — 그래서 둘 다 끈다

`hooks/hooks.json`은 관례 경로다. Claude Code는 이 경로를 자동으로 읽으므로
`.claude-plugin/plugin.json`에서는 참조하지 않는다 — 참조하면 중복 등록으로 훅 세트
전체가 드롭되고 플러그인이 조용히 무력화된다 (upstream `ed6a0a2`).

Codex는 이 경로를 자동으로 읽지 않는다. `.codex-plugin/plugin.json`의
`"hooks": "./hooks/hooks.json"` 이 있어야 훅이 등록된다. 이 키가 없으면
`codex plugin list`는 `installed, enabled`를 찍는데 훅은 하나도 등록되지 않는다.

## 안 켜질 때

플러그인이 `enabled`인데 배너가 안 뜨는 경우가 있다. 순서대로 본다.

1. **훅이 등록됐나** — `claude plugin details adhd-mode`가 `Hooks (1) SessionStart`를
   보여야 한다. 훅은 하나뿐이다 — `SubagentStart` 주입은 지웠다.
2. **Codex: 훅이 신뢰됐나** — `grep "adhd-mode@adhd-mode:" ~/.codex/config.toml` 에 항목이
   없으면 승인되지 않은 것이다. 위 설치 절 참조.
   **UI에는 정상으로 보이는데 규칙만 안 들어가는 가장 유력한 경로다.**
3. **Codex: 훅 기능이 켜져 있나** — `~/.codex/config.toml`의 `[features] hooks = true`.
   관리 환경이면 `allow_managed_hooks_only`도 확인한다.
4. **훅이 조용히 실패했나** — 훅 로그의 stderr에 `adhd-mode:` 로 시작하는 줄이 있는지 본다.
5. **`node`가 PATH에 있나** — 훅은 비대화형 셸에서 돈다.

스크립트만 따로 돌려볼 수 있다.

```bash
node hooks/inject.mjs | head -3
```

## 라이선스

MIT. 원 저작권 고지는 [`LICENSE`](LICENSE)에 그대로 유지한다.
