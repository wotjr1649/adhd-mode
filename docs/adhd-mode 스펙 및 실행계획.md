# `adhd-mode` 스펙 및 실행계획

`docs/chatgpt/adhd-mode 포크 최종 설계 결정서.md`를 환경 검증 후 개정한 문서다.
충돌 시 이 문서가 우선한다.

기준 커밋: `b42a45a` (ayghri/i-have-adhd)
검증 환경: `claude 2.1.241` / `codex-cli 0.149.0` / `node v24.19.0` / Windows 11

**개정 이력**
- rev1 — grilling 인터뷰 결과 반영
- rev2 — 적대적 리뷰 16건 + Claude Code 문서 검증 반영. 아래 §0 참조

---

## 0. rev2에서 뒤집힌 것

구현 전 검토에서 **설계를 무력화하는 결함 3건**이 나왔다. rev1을 그대로 구현했으면
플러그인이 "설치 성공"으로 표시되면서 아무것도 하지 않았을 것이다.

| # | rev1 | rev2 | 근거 |
|---|---|---|---|
| 1 | 두 매니페스트가 `"hooks": "./hooks/hooks.json"` 참조 | **매니페스트 `hooks` 키를 쓰지 않는다** | upstream 커밋 `ed6a0a2`가 제거한 바로 그 키. 관례 경로와 중복되어 duplicate 검사에 걸리고 훅 세트 전체가 드롭된다 |
| 2 | `node "${CLAUDE_PLUGIN_ROOT}/hooks/inject.mjs"` | **upstream의 `node -e` env-read 런처 유지** | upstream이 6단계에 걸쳐 하드닝한 형태. 변수명 fallback + 셸 확장 무의존 + 무조건 exit 0 |
| 3 | "세션 단위로 해제 가능" | **"다음 compaction·resume·fork까지 해제"** | 상태 파일이 없으면 off는 컨텍스트 문장뿐이고, SessionStart가 재발화하면 되켜진다 |

추가 정정:

| 항목 | rev1 | rev2 |
|---|---|---|
| matcher | `startup\|resume\|clear\|compact` | `startup\|resume\|clear\|compact\|fork` |
| timeout | `10` | `30` — `43eeda8`이 실측 6549ms 때문에 올린 값 |
| SubagentStart | 없음 | **추가** |
| 정적 검증 | `claude plugin validate .` | **2회 호출.** marketplace.json이 있으면 그것만 검사하고 깨진 hooks.json을 통과시킨다(실측) |
| 제거 목록 | `always-on.sh`/`.ps1` | **+ `always-on.mjs`, `agents/gemini.toml`, `logo.png`, `.gitignore` 재작성** |
| logo.png | 유지 | **삭제 + 매니페스트 참조 제거** — 이미지 안에 `i-have-adhd` 글자가 렌더링돼 있다 |
| 주입 토큰 | 약 2,500 | **약 1,600** (실측 6,393 bytes / 1,128 words) |
| 커밋 | 8개, CI 정리가 마지막 | **7개, hook 실측이 첫 커밋.** rev1은 커밋 2~7이 CI 레드였고 3~4는 훅이 죽어 있었다 |

---

## 1. 제품 정의

`adhd-mode`는 Claude Code와 Codex에 **설치하면 항상 켜지는** 출력 스타일 플러그인이다.

- 답변·판정·다음 행동을 먼저 제시
- 실제 절차만 번호 단계로 분리
- 서문·칭찬·맺음말 제거
- 정확성·안전성·완전성을 간결성보다 우선
- 메인 세션과 서브에이전트 모두에 적용
- `/adhd-mode:adhd-mode-off`로 해제 — **다음 compaction·resume·fork까지만 유효**

ADHD 진단·치료·의학적 판단을 제공하지 않는다. 사용자가 선택하는 응답 형식이다.

### 원 설계서(ChatGPT)에서 뒤집은 것

| 원 설계서 | 이 문서 | 근거 |
|---|---|---|
| §1 "명시 호출형 출력 모드" | 설치형 상시 모드 | 사용자 요구: 매 세션 자동 로드 |
| §3.5 "Hook 미사용" | 플러그인 hooks 사용 | hook은 홈에 쓰지 않는다. 읽고 실패 시 exit 0 |
| §7 "매 세션 수동 재호출" | SessionStart가 재주입 | Claude는 compact·fork까지 커버 |
| §4 "Python eval → Node 이식" | `evals/` 삭제 | 안 돌릴 하네스 |
| §8 4단계 버전 사다리 | `0.1.0` 단일 | 개인 전용 |
| §11 60회 유료 eval 게이트 | 없음 | 개인 전용 |

---

## 2. 네이밍

```text
저장소        adhd-mode  (github.com/wotjr1649/adhd-mode)
플러그인 ID    adhd-mode
marketplace   adhd-mode
활성 스킬      adhd-mode        → /adhd-mode:adhd-mode        $adhd-mode
해제 스킬      adhd-mode-off    → /adhd-mode:adhd-mode-off    $adhd-mode-off
```

Codex의 `$` 접두사는 확인됨 — codex 0.149.0 바이너리 자체 지침에
*"It must explicitly mention the skill as `$skill-name`"* 이 있다.

`skills/adhd-mode/SKILL.md`는 두 역할을 겸한다: 스킬 본문이자 hook이 읽는 룰셋 원본.
평소에는 hook이 자동 주입하므로 활성 스킬을 칠 일이 없고, `off` 뒤 같은 세션에서 되켤 때만 쓴다.
`disable-model-invocation: true`인 스킬은 description조차 컨텍스트에 올라가지 않으므로
미사용 시 토큰 비용이 0이다.

---

## 3. 최종 구조

```text
adhd-mode/
├─ .claude-plugin/
│  ├─ plugin.json                 name·version·description·author 만. hooks 키 없음
│  └─ marketplace.json            name·owner·plugins (owner 필수)
├─ .codex-plugin/
│  └─ plugin.json                 + "skills": "./skills/" + interface. hooks 키 없음
├─ .agents/
│  └─ plugins/marketplace.json    url → wotjr1649/adhd-mode
├─ hooks/
│  ├─ hooks.json                  관례 경로. 두 호스트가 자동 로드
│  └─ inject.mjs                  SKILL.md 프론트매터 제거 후 stdout
├─ skills/
│  ├─ adhd-mode/
│  │  ├─ SKILL.md                 ★ 단일 원본
│  │  └─ agents/openai.yaml       allow_implicit_invocation: false
│  └─ adhd-mode-off/
│     ├─ SKILL.md
│     └─ agents/openai.yaml
├─ .github/workflows/plugin-load-check.yml
├─ .gitignore
├─ LICENSE
├─ README.md                      한국어, INSTALL 흡수
└─ UPSTREAM.md
```

실행 코드는 `hooks/inject.mjs` 하나다. 런타임 의존성 0, `package.json` 없음
(`.mjs` 확장자가 ESM을 지정하므로 불필요).

### 설계 원칙

1. 행동의 단일 원본은 `skills/adhd-mode/SKILL.md`. hook도 스킬도 같은 파일을 읽는다.
2. 호스트별 파일은 packaging과 호출 정책만 담당한다.
3. **`hooks/hooks.json`은 관례 경로에 두고 매니페스트에서 참조하지 않는다.**
   두 호스트 모두 이 경로를 자동 로드한다. 참조하면 중복 등록으로 훅이 드롭된다.
4. hook은 읽기 전용이다. 홈·설정·사용자 파일에 쓰지 않는다.
5. MCP, network, telemetry, credential, 상태 파일을 쓰지 않는다.
6. Codex 자동 호출은 `allow_implicit_invocation: false`로 막는다.
7. Claude 자동 호출은 `disable-model-invocation: true`로 막는다.
8. **규칙은 한 곳에만 쓴다.** hook 주입 헤더는 활성 사실만 알리고,
   해제 방법과 지속 정책은 SKILL.md의 Persistence 섹션에만 둔다.

---

## 4. 제거 목록

호스트 어댑터:

```text
.cursor/                    .opencode/                  extensions/
GEMINI.md                   gemini-extension.json       kimi.plugin.json
opencode.json               qwen-extension.json         plugin.json      ← Antigravity, 루트
package.json                                            ← Pi/OMP 매니페스트
skills/i-have-adhd/agents/gemini.toml                   ← 디렉터리 rename에 딸려가지 않게 명시
```

문서·에셋:

```text
AGENTS.md                   ← ayghri 레포 issue #127 댓글 지시 포함. 반드시 제거
CONTRIBUTING.md             INSTALL.md
.github/readme/     (5개)   .github/install/    (5개)
.github/pull_request_template.md
logo.png                    ← 이미지에 i-have-adhd 글자가 그려져 있다. 매니페스트 참조도 함께 제거
```

검증·CI:

```text
scripts/            (3개)   tests/              (5개)   evals/              (4개)
hooks/always-on.sh          hooks/always-on.ps1         hooks/always-on.mjs
.github/workflows/claude.yml
.github/workflows/cursor-skill-sync.yml
.github/workflows/pi-load-check.yml
```

재작성: `.gitignore` (`__pycache__/`, `*.py[cod]`, `evals/results/`가 전부 무의미해진다)

유지: `LICENSE`

신규: `hooks/inject.mjs`, `UPSTREAM.md`, `skills/adhd-mode-off/`, `README.md` 재작성

### 개명 범위

디렉터리 rename만으로는 부족하다. `i-have-adhd`가 남는 곳 전부:

| 파일 | 개수 | 처리 |
|---|---|---|
| `skills/*/SKILL.md` | 3 | frontmatter `name`, `description`, H1 |
| `skills/*/agents/openai.yaml` | 1 | `default_prompt`의 `$i-have-adhd` → `$adhd-mode` |
| `.codex-plugin/plugin.json` | 5 | `homepage`, `repository`, `websiteURL`, `defaultPrompt`, `name` |
| `.claude-plugin/plugin.json` | 1 | `name` |
| `.claude-plugin/marketplace.json` | 2 | `name`, `plugins[].name` |
| `.agents/plugins/marketplace.json` | 3 | `name`, `plugins[].name`, `source.url` |
| `.github/workflows/plugin-load-check.yml` | 1 | install 대상 |

### 구 식별자 정책

`i-have-adhd`는 다음에서만 허용한다.

```text
UPSTREAM.md    원본 저장소 URL과 기준 커밋
README.md      attribution 링크 1곳
docs/          설계 이력 문서 (이 파일 포함)
```

원 설계서 §4는 `LICENSE`를 허용 목록에 넣었으나 **LICENSE에는 그 문자열이 없다**
(MIT 원문 + `Copyright (c) 2026 Ayoub Ghriss`). 반대로 README는 attribution 때문에
반드시 포함해야 하고, `docs/`는 설계 이력이라 원본 이름을 지울 수 없다.

---

## 5. hook 스펙

### `hooks/hooks.json`

관례 경로에 둔다. **어느 매니페스트에서도 참조하지 않는다.**

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume|clear|compact|fork",
        "hooks": [
          {
            "type": "command",
            "command": "node -e \"(async()=>{const root=process.env.CLAUDE_PLUGIN_ROOT||process.env.PLUGIN_ROOT;if(root)await import(require('node:url').pathToFileURL(require('node:path').join(root,'hooks','inject.mjs')).href)})().catch(()=>{})\"",
            "timeout": 30,
            "statusMessage": "Loading adhd-mode..."
          }
        ]
      }
    ],
    "SubagentStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node -e \"(async()=>{const root=process.env.CLAUDE_PLUGIN_ROOT||process.env.PLUGIN_ROOT;if(root)await import(require('node:url').pathToFileURL(require('node:path').join(root,'hooks','inject.mjs')).href)})().catch(()=>{})\"",
            "timeout": 30,
            "statusMessage": "Loading adhd-mode..."
          }
        ]
      }
    ]
  }
}
```

각 값의 근거:

- **매니페스트 참조 없음** — upstream `ed6a0a2`. `manifest.hooks`는 관례 파일 *외의*
  추가 훅 파일용이다. 관례 경로를 가리키면 duplicate 검사에 걸려 훅 세트가 드롭되고,
  플러그인은 설치 성공으로 표시된 채 아무것도 하지 않는다.
- **`node -e` env-read 런처** — upstream `d264f01` + `578d076`. 셸의 `${...}` 확장에
  의존하지 않고, `CLAUDE_PLUGIN_ROOT`와 `PLUGIN_ROOT` 양쪽을 읽으며,
  `.catch(()=>{})`로 어떤 예외에서도 세션 시작을 막지 않는다.
  Codex의 문자열 확장 지원 여부가 미확정이므로 이 형태가 더 안전하다.
- **`fork` 포함** — `claude.exe` 2.1.241에서 추출:
  `matcherMetadata:{fieldToMatch:"source",values:["startup","resume","clear","compact","fork"]}`
- **`timeout: 30`** — upstream `43eeda8`. 다른 SessionStart 훅이 여럿 등록된 환경에서
  런처가 6549ms 걸려 취소된 실측이 근거다. 이 개발 머신에도 claude-mem·ponytail 등이
  이미 등록돼 있다.
- **`SubagentStart`** — matcher 없음(전체). 서브에이전트 시작 시 1회만 주입되므로 저렴하다.
  **평문 stdout으로는 전달되지 않는다.** SessionStart 컨텍스트는 부모 스레드 전용이라
  서브에이전트에 닿지 않고, SubagentStart에서 쓴 평문은 읽힌 뒤 버려진다. 이 이벤트만
  `hookSpecificOutput.additionalContext` JSON을 써야 한다. `inject.mjs`가 stdin의
  `hook_event_name`을 읽어 분기한다. 검증된 SessionStart 평문 경로는 그대로 둔다.
  플러그인 표면(`plugin details`의 `Hooks (2)`, validate 통과, exit 0)은 이 실패를
  전혀 드러내지 않았다 — 실제 서브에이전트를 띄워야만 보인다.
- **`additionalContextLimit: 4000`** — Codex 기본값은 핸들러당 약 2,500 토큰이다.
  넘으면 전문을 모델에 넣지 않고 `<temp_dir>/hook_outputs/…`로 흘린 뒤 앞뒤 preview와
  경로만 전달한다. §6 개정 후 본문이 약 2.2k 토큰이라 기본값 여유가 12%뿐이다.
  Claude Code는 이 필드를 모르지만 `validate --strict`에서도 경고 없이 통과한다(실측).
- **`fork`는 Claude 전용.** Codex의 source enum은 4개(`startup|resume|clear|compact`)이고
  matcher는 정규식이므로 남는 대안은 그냥 매치되지 않는다. 한 파일 공유에 문제없다.

### `hooks/inject.mjs`

upstream `hooks/always-on.mjs`에서 플래그 파일 검사만 제거한 형태.

```text
1. import.meta.url 기준으로 ../skills/adhd-mode/SKILL.md 해석  (env var 신뢰 안 함)
2. 없으면 exit 0
3. 선두 YAML 프론트매터 블록 제거
4. 한 줄 헤더 + 본문을 stdout에 출력
5. 어떤 예외든 exit 0
```

헤더는 **한 줄, 활성 사실만**. 해제 방법은 SKILL.md의 Persistence 섹션에만 둔다(설계 원칙 8).

```text
ADHD MODE ACTIVE. The ruleset below applies to every response in this session.
```

주입 비용: 세션당 1회 + 서브에이전트당 1회, 본문 약 1,600 토큰
(실측 6,393 bytes / 1,128 words / 131 lines).

---

## 6. SKILL.md 개정

upstream 10규칙과 "When to break the rules" 구조를 유지하고 아래만 고친다.

### 6.0 frontmatter

```text
name:        i-have-adhd → adhd-mode
description: "… Invoke with /i-have-adhd; stays on until …" → §6.6 정책과 일치하게 재작성
H1:          # i-have-adhd → # adhd-mode
```

### 6.1 Rule 9 — 5개 상한

```text
현재  If a list grows past five, split into "do now" vs "later".
개정  선택지·우선순위·권장안은 5개 이하로 정렬한다.
      오류·위험·요구사항·검증 결과는 개수와 무관하게 전부 남긴다.
      자를 수 있는 것은 순위이지 발견 사항이 아니다.
```

### 6.2 Rule 6 — 시간 추정

```text
현재  Vague estimates fail. Ballpark in concrete units.
개정  근거가 있을 때만 범위와 가정을 함께 낸다.
      근거가 없으면 추정을 지어내지 말고 "추정 근거 없음"이라고 쓴다.
```

### 6.3 Rule 5 — 상태 재진술

```text
현재  Restate state every turn.
개정  3단계 이상 작업 또는 여러 턴에 걸친 작업에서만 표시한다.
      1~2턴으로 끝나는 대화에서는 생략한다.
```

### 6.4 Rule 3 — 다음 행동

```text
현재  End with one concrete next action.
개정  남은 작업이 있을 때만 하나의 다음 행동으로 끝낸다.
      답이 완결되었으면 다음 행동 없이 끝낸다.
```

### 6.5 신규 — 검증 표기

Rule 8(오류 서술) 뒤에 추가한다.

```text
검증을 언급할 때는 셋 중 하나로 명시한다.
  Verified:     실행한 명령과 관찰한 결과
  Not verified: 확인하지 않은 것
  Blocked by:   막힌 이유
실행하지 않은 검사를 실행했다고 쓰지 않는다.
```

### 6.6 Persistence 섹션 — 정직한 재작성

**해제의 지속성을 과장하지 않는다.** 이 문서에서 지속 정책을 서술하는 유일한 곳이다.

```text
이 규칙은 설치 시점부터 모든 세션에 자동 적용된다.

해제: /adhd-mode:adhd-mode-off, $adhd-mode-off, 또는 "stop adhd mode".
해제는 현재 컨텍스트에만 적용된다. 새 세션, /clear, compaction, resume,
세션 fork 이후에는 규칙이 다시 주입된다. 영구 해제는 플러그인 비활성화다:
  claude plugin disable adhd-mode
  codex plugin remove adhd-mode
```

### 손대지 않는 것

upstream이 이미 처리하고 있어 원 설계서 §5의 지적이 성립하지 않는 부분:

- "explain/walk me through" 요청 시 길게 서술 — `When to break the rules` #1
- "what are my options"에서 옵션 자체가 답 — `#5`
- harness 시스템 프롬프트 우선 — `#6`
- 3연속 실패 시 전제 지적 — `#3`
- 최소 단계 수 — Rule 2 "Use the fewest steps that still work"

---

## 7. adhd-mode-off 스킬

`skills/adhd-mode-off/SKILL.md`

- frontmatter: `name: adhd-mode-off`, `disable-model-invocation: true`
- `agents/openai.yaml`: `allow_implicit_invocation: false`,
  `default_prompt`에 `$adhd-mode-off` 명시
- 본문: 이 컨텍스트에서 앞서 주입된 adhd-mode 지침을 무시하고 기본 출력 스타일로 돌아가라
- 응답은 한 줄로 제한

```text
ADHD Mode disabled for this context.
```

**알려진 한계 — README에 명시한다.** 상태 파일이 없으므로 해제는 컨텍스트 안의
지시문일 뿐이다. compaction·resume·fork가 발생하면 SessionStart가 재발화해
룰셋이 최신 위치에 다시 주입되고, 해제 지시는 요약에서 소실될 수 있다.
영구 해제는 플러그인 비활성화다.

---

## 8. 검증

### 정적 — 2회 호출이 필요하다

```bash
claude plugin validate .                            # marketplace.json
claude plugin validate .claude-plugin/plugin.json   # plugin manifest + hooks/hooks.json
node hooks/inject.mjs | head -3
node hooks/inject.mjs | wc -c
```

**실측 근거**: `hooks/hooks.json`을 `{ this is not json` 으로 망가뜨린 상태에서

```
$ claude plugin validate .
Validating marketplace manifest: …\.claude-plugin\marketplace.json
✔ Validation passed                                  ← 통과시킨다

$ claude plugin validate .claude-plugin/plugin.json
Validating plugin manifest: …\.claude-plugin\plugin.json
Validating hooks: …\hooks\hooks.json
✘ json: Invalid JSON syntax … At runtime this breaks the entire plugin load.
```

marketplace.json이 있으면 `validate .`는 그것만 본다. rev1의 "validate 하나로 충분하다"는
틀렸다. 별도 verify 스크립트는 여전히 불필요하지만 **호출은 2회**다.

### Claude Code 격리 설치

Windows에서 `mktemp -d`는 POSIX 경로를 주는데 `claude.exe`는 네이티브 Windows
바이너리다. 변환이 필요하다. 그리고 개발 중에는 GitHub이 아니라 **작업 트리**를 가리켜야 한다.

```bash
export CLAUDE_CONFIG_DIR="$(cygpath -w "$(mktemp -d)")"
claude plugin marketplace add "$PWD"
claude plugin install adhd-mode@adhd-mode
claude plugin list                    # ✔ enabled 확인
```

새 세션에서 확인할 것:

1. 첫 응답 전에 `ADHD MODE ACTIVE` 배너가 뜬다
2. 서브에이전트 리포트에도 규칙이 적용된다
3. `/adhd-mode:adhd-mode-off` → 한 줄 응답 후 기본 스타일 복귀
4. `/clear` → 배너 재출현
5. `/compact` → 배너 재출현
6. **off 직후 `/compact` → 모드가 되켜지는지 확인하고 결과를 기록한다.**
   §7의 "알려진 한계"가 실제로 그렇게 동작하는지 확인하는 항목이다.

### Codex 설치

```bash
codex plugin marketplace add "$PWD"
codex plugin add adhd-mode@adhd-mode
codex plugin list                     # installed, enabled 확인
```

원 설계서 §10은 `codex plugin marketplace add .`만 적고 설치 단계를 빠뜨렸다.
`codex plugin add <PLUGIN>@<MARKETPLACE>`가 별도로 필요하다 (0.149.0 `--help`로 확인).

새 세션에서 확인할 것:

1. 배너 출현 — **안 뜨면 Codex가 `hooks/hooks.json`을 관례 로드하지 않는다는 뜻이다.**
   그때만 `.codex-plugin/plugin.json`에 `hooks` 키를 추가한다(Claude 쪽에는 절대 추가하지 않는다).
2. `$adhd-mode-off` 동작
3. 명시 호출 전 스킬이 자동 발동하지 않음
4. `/compact` 후 배너 재출현. **해결됨** — Codex `rust-v0.149.0`의
   `hooks/src/events/session_start.rs`가 수동·자동 compact 모두에서 `source: "compact"`로
   SessionStart를 발화한다. `PostCompactHookSpecificOutputWire`가 없는 것은 PostCompact가
   context 주입 이벤트가 아니라는 뜻이지, SessionStart가 안 뛴다는 뜻이 아니었다.
   claude-mem이 matcher를 `startup|resume`로 좁힌 건 그 작성자의 선택이고, 그 설정은
   Codex에서 `/clear`와 `/compact` 재주입을 놓친다.

### Codex 무음 실패 경로

`installed, enabled`인데 규칙이 모델에 안 닿는 경로가 셋 있다. README 트러블슈팅에 옮겼다.

1. **훅 trust 미승인.** plugin enable과 hook trust는 별개다. 훅 정의를 승인하지 않으면
   Codex가 건너뛴다. 훅 내용이 바뀌어 해시가 달라져도 재승인이 필요할 수 있다.
2. **`[features] hooks = false` 또는 `allow_managed_hooks_only = true`.**
   플러그인 설치·활성화와 무관하게 모든 훅이 꺼진다.
3. **injector가 조용히 실패.** exit 0 + 빈 stdout은 두 호스트 모두 "성공, 추가 컨텍스트 없음"으로
   읽는다. `allow_implicit_invocation: false` 때문에 스킬이 대신 발동하지도 않는다.
   → `inject.mjs`가 실패 사유를 stderr에 남기도록 고쳤다.

### CI

`.github/workflows/plugin-load-check.yml` 하나만 남긴다.

```text
runs-on: ubuntu-latest        ← windows 매트릭스 제거 (OS 의존 코드가 0이 됨)
trigger paths: .claude-plugin/**, .codex-plugin/**, hooks/**, skills/**, 워크플로 자신
steps: claude 설치 → 스크래치 CLAUDE_CONFIG_DIR에 install → "✔ enabled" grep
제거: hook-parity job (tests/test_always_on_hooks.py가 사라진다)
```

---

## 9. 실행계획

```bash
git switch -c refactor/claude-codex-only
git tag upstream-i-have-adhd-2026-08-24 b42a45a068e080294924bfba19a7a2e8944c48ff
git push origin upstream-i-have-adhd-2026-08-24
```

rev1의 8커밋은 커밋 2~7이 CI 레드였고 3~4 구간은 훅이 조용히 죽어 있었다.
**가장 불확실한 것을 먼저 돌려보고**, 각 커밋이 스스로 온전하도록 재편한다.

```text
0  fix(hooks): make the always-on launcher unconditional
   이름은 i-have-adhd 그대로. hooks/inject.mjs 신규, 플래그 파일 게이트 제거,
   matcher에 fork 추가, SubagentStart 추가, timeout 30 유지.
   .sh/.ps1/always-on.mjs 및 그 파이썬 테스트 제거 + 워크플로에서 hook-parity job 제거.
   ▶ 게이트: 두 호스트 격리 설치 실측. 배너가 안 뜨면 여기서 정지.
      삭제·리네임을 아직 안 했으므로 되돌리는 비용이 0이다.

1  chore: remove unsupported host integrations
   §4 제거 목록 전체 + .gitignore 재작성 + README를 최소 스텁으로 교체.
   README를 여기서 손대는 이유: 링크 대상(.github/readme/, AGENTS.md, INSTALL.md)이
   이 커밋에서 사라진다. 나중에 고치면 공개 저장소 첫 화면이 여러 커밋 동안 404다.
   워크플로의 install 대상은 아직 i-have-adhd로 유효하다.

2  chore: record upstream baseline and fork attribution
   UPSTREAM.md (원본 저장소, 기준 커밋 b42a45a, 변경 범위, MIT 고지)

3  refactor: rename plugin and skills to adhd-mode
   §4 개명 범위 표 전체를 한 커밋에. 디렉터리 rename과 hook이 읽는 경로,
   워크플로 install 대상이 동시에 바뀌어야 중간에 죽은 훅이 생기지 않는다.
   ▶ 게이트: 재설치 실측

4  feat: patch the four rule gaps and add verification labels
   §6.0 ~ §6.6

5  feat: add the adhd-mode-off skill
   ▶ 게이트: off 동작 + off 후 compact 동작 실측 및 기록

6  docs: rewrite README in Korean
   설치·해제·알려진 한계·규칙 요약·attribution. INSTALL.md 흡수
```

각 커밋 후:

```bash
claude plugin validate .
claude plugin validate .claude-plugin/plugin.json
git diff --check
git status          # 예상 밖 삭제·잔존 확인
```

---

## 10. 완료 기준

실제 설정 설치 후 실측 결과는 §11에 기록했다.

정적

- [ ] `claude plugin validate .` 통과
- [ ] `claude plugin validate .claude-plugin/plugin.json` 통과
- [ ] `node hooks/inject.mjs`가 프론트매터 없는 본문을 출력
- [ ] 두 매니페스트 어디에도 `hooks` 키가 없다
- [ ] 추적 대상 파일에서 `i-have-adhd` 매치가 `UPSTREAM.md`·`README.md`·`docs/`뿐
      (`git ls-files | xargs grep -l "i-have-adhd"`)
- [ ] LICENSE 원문과 저작권 고지 무변경

Claude Code 실측

- [ ] 격리 설치 후 `✔ enabled`
- [ ] 새 세션에서 배너 자동 출현
- [ ] 서브에이전트에도 규칙 적용
- [ ] `/clear`·`/compact` 후 배너 재출현
- [ ] `/adhd-mode:adhd-mode-off` 동작
- [ ] off 후 compact 동작을 실측하고 §7의 "알려진 한계" 서술과 일치하는지 기록

Codex 실측

- [ ] 설치 후 `installed, enabled`
- [ ] 새 세션에서 배너 자동 출현 (안 뜨면 §8의 분기 적용)
- [ ] 서브에이전트에도 규칙 적용
- [ ] `$adhd-mode-off` 동작
- [ ] compact 후 동작을 실측하고 결과를 문서화 (통과/미통과 무관, 기록이 요건)

공통

- [ ] 두 호스트에서 스킬이 자동 발동하지 않음
- [ ] 사용자 홈·설정 파일을 쓰는 코드 없음
- [ ] MCP·network·credential·telemetry 없음
- [ ] Ubuntu CI green

---

## 11. 실측 결과

실제 `~/.claude`, `~/.codex`에 설치한 뒤 확인한 것. 2026-08-24.

### Verified

| 항목 | 증거 |
|---|---|
| Claude 설치 | `adhd-mode@adhd-mode 0.1.0 ✔ enabled`, Skills (2), Hooks (2) |
| Codex 설치 | `installed, enabled 0.1.0`, PATH = 작업 트리 |
| SessionStart 주입 | 헤드리스 세션에서 모델이 `ADHD MODE ACTIVE` 존재를 `YES`로 확인 |
| 본문 전달 | 모델이 개정된 규칙 9·10·11의 제목을 그대로 인용 |
| SubagentStart 주입 | `MAIN=YES SUB=YES`. 훅 로그: `(Loading ADHD mode...) provided additionalContext (8743 chars)` |
| off 스킬 | `/adhd-mode:adhd-mode-off` → `ADHD Mode disabled for this context.` 한 줄 |
| 출력 성형 | "How do I read a file in Python?" → 서문·맺음말 없이 코드부터 |
| 런처 견고성 | `CLAUDE_PLUGIN_ROOT`/`PLUGIN_ROOT` 양쪽, root 없으면 무출력 exit 0, SKILL.md 없으면 stderr 진단 |
| 정적 | validate 3종 통과(`--strict` 포함), 매니페스트 hooks 키 0, LICENSE 무변경 |

### 구현 중 발견한 결함 4건

계획 단계에서는 보이지 않았고 실측으로만 잡힌 것들.

1. **Codex가 로컬 대신 upstream을 설치** — `.agents/plugins/marketplace.json`의 `url` 소스.
   `list`는 `installed, enabled`를 찍는데 설치본이 다른 코드였다. `local` 상대경로로 수정.
2. **`additionalContextLimit` 기본 2,500 토큰** — 규칙 개정 후 본문이 2.2k(한도의 87%).
   넘으면 전문 대신 파일 경로와 preview만 간다. 4000으로 명시.
3. **`inject.mjs`가 모든 오류를 삼킴** — exit 0 + 빈 stdout은 두 호스트 다 "성공"으로 읽는다.
   stderr 진단 추가.
4. **SubagentStart가 등록만 되고 전달은 안 됨** — 평문 stdout이 서브에이전트에 안 닿는다.
   `plugin details`·validate·exit 0 어디에도 안 나타났고, 실제 서브에이전트를 띄워서만 발견.
   `hookSpecificOutput` JSON으로 수정.

공통점: **넷 다 "설치 성공"으로 표시되면서 조용히 동작하지 않는 종류였다.**
정적 검증으로는 하나도 못 잡았다.

### Not verified

- GitHub marketplace 설치 — push 필요
- Ubuntu CI — push 필요
- off가 여러 턴에 걸쳐 유지되는지 — 한 번의 헤드리스 호출로는 판정 불가.
  지시가 도달하고 준수되는 것까지만 확인했다
