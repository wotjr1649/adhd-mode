# `adhd-mode` 포크 최종 설계 결정서

## 1. 제품 정의

`adhd-mode`는 Claude Code와 Codex에서 AI 응답을 다음 특성으로 바꾸는 명시 호출형 출력 모드다.

- 답변·판정·다음 행동을 먼저 제시
- 실제 절차만 번호 단계로 분리
- 불필요한 서문·칭찬·맺음말 제거
- 다단계 작업의 진행 상태와 검증 결과 표시
- 간결성을 이유로 오류·위험·요구사항을 누락하지 않음
- 시간 추정은 충분한 근거가 있을 때만 제공
- 사용자가 직접 활성화하고 직접 해제

이 플러그인은 ADHD 진단, 치료, 의학적 판단을 제공하지 않는다. 단지 사용자가 선택하는 응답 형식이다.

---

## 2. 네이밍

### 최종 이름

- 저장소: `adhd-mode`
- 플러그인 ID: `adhd-mode`
- 표시 이름: `ADHD Mode`
- 활성화 스킬: `adhd-mode`
- 해제 스킬: `adhd-mode-off`

### 호출

```text
Claude Code
/adhd-mode:adhd-mode
/adhd-mode:adhd-mode-off

Codex
$adhd-mode
$adhd-mode-off
```

공개 검색 차별화가 반드시 필요할 때만 저장소 이름을 `adhd-output-mode`로 늘린다. 플러그인과 스킬 ID는 짧고 안정적인 `adhd-mode`를 유지하는 것이 낫다.

---

## 3. 아키텍처

```text
adhd-mode/
├─ .claude-plugin/
│  ├─ plugin.json
│  └─ marketplace.json
├─ .codex-plugin/
│  └─ plugin.json
├─ .agents/
│  └─ plugins/
│     └─ marketplace.json
├─ skills/
│  ├─ adhd-mode/
│  │  ├─ SKILL.md
│  │  └─ agents/openai.yaml
│  └─ adhd-mode-off/
│     ├─ SKILL.md
│     └─ agents/openai.yaml
├─ evals/
├─ scripts/
├─ tests/
├─ .github/workflows/
├─ CHANGELOG.md
├─ CONTRIBUTING.md
├─ LICENSE
├─ README.md
├─ UPSTREAM.md
└─ package.json
```

### 설계 원칙

1. 실제 행동의 단일 원본은 `skills/adhd-mode/SKILL.md`다.
2. Claude와 Codex별 파일은 packaging과 호출 정책만 담당한다.
3. 실제 플러그인 동작에는 Node.js, Python, TypeScript가 필요하지 않다.
4. JavaScript ESM은 정적 검증, 테스트, Eval에만 사용한다.
5. Hook, MCP, network, telemetry, credential, 사용자 홈 디렉터리 상태를 사용하지 않는다.
6. Codex의 자동 호출은 `allow_implicit_invocation: false`로 막는다.
7. Claude의 자동 호출은 `disable-model-invocation: true`로 막는다.

---

## 4. 원본에서 제거할 범위

다음 호스트와 관련된 파일은 모두 제거한다.

```text
.cursor/
.opencode/
extensions/
hooks/
GEMINI.md
gemini-extension.json
kimi.plugin.json
opencode.json
qwen-extension.json
Pi/OMP package 설정
Shell/PowerShell fallback
다중 호스트 번역 설치 문서
비대상 호스트 CI
```

Python Eval과 테스트는 필요한 기능만 JavaScript ESM으로 이식한 뒤 제거한다.

`i-have-adhd`라는 구 식별자는 다음 파일에서만 허용한다.

```text
UPSTREAM.md
CHANGELOG.md
LICENSE
```

---

## 5. 원본 규칙의 주요 보완점

### 원본의 문제점

- 모든 응답에서 다음 행동을 강제하면 설명형 질문이 부자연스러워질 수 있음
- 모든 다중 항목을 번호 단계로 만들면 분석과 절차가 혼동됨
- 매 턴 상태 반복은 짧은 대화에서 새로운 boilerplate가 됨
- 무조건적인 시간 추정은 근거 없는 확신을 만듦
- 목록 최대 5개는 실제 발견 사항을 누락시킬 위험이 있음
- 항상 마지막에 다음 행동을 넣으면 완결된 답변도 미완성처럼 보임
- ADHD 관련 설명 일부가 보편적 의학 사실처럼 단정적으로 표현됨

### 개선 방향

- 실행 요청은 행동 먼저, 분석 요청은 판정 먼저
- 절차와 설명을 별도 구조로 처리
- 진행 상태는 실제 다단계 작업에서만 표시
- 시간 추정은 근거와 가정이 있을 때만 제공
- 선택지·우선순위는 5개 이하를 선호하되 발견 사항은 절대 절단하지 않음
- 완료된 답변은 다음 행동 없이 종료 가능
- 검증 여부를 `Verified`, `Not verified`, `Blocked by`로 명시
- 정확성·안전성·완전성을 간결성보다 우선
- ADHD 진단이나 의학적 일반화를 제거

---

## 6. 활성화 스킬 핵심 계약

`skills/adhd-mode/SKILL.md`는 다음 규칙을 가진다.

1. 실행 작업에서는 명령·경로·코드 변경을 먼저 제시한다.
2. 질문·비교·검토에서는 판정이나 추천을 먼저 제시한다.
3. 실제 순서가 있는 작업만 번호 단계로 작성한다.
4. 요청된 오류, 위험, 조건, 대안, 검증 결과를 축약 때문에 삭제하지 않는다.
5. 사실, 추론, 불확실성을 구분한다.
6. 현재 문제를 먼저 완료하고 관련 이슈는 필요할 때만 언급한다.
7. 세 단계 이상의 작업 또는 다중 턴 작업에서만 진행 상태를 표시한다.
8. 시간은 근거가 있을 때 범위와 가정을 함께 제시한다.
9. 오류는 위치 → 관찰 결과 → 원인/가설 → 수정 → 검증 순서로 정리한다.
10. 작업이 남아 있을 때만 하나의 다음 행동으로 끝낸다.
11. 세 번의 수정이 연속 실패하면 더 이상 코드를 바꾸지 않고 잘못된 전제를 지적한다.
12. 시스템·호스트·사용자 명시 요구사항이 이 스타일보다 우선한다.

---

## 7. 비활성화 스킬

`adhd-mode-off`는 앞서 로드된 `adhd-mode` 지침을 현재 대화에서 무시하고 기본 출력 스타일로 돌아가도록 지시한다.

응답은 다음 한 줄로 제한한다.

```text
ADHD Mode disabled.
```

새 세션, `/clear`, compaction 이후에는 모드가 다시 필요할 경우 사용자가 명시적으로 재호출한다. 이는 실행 Hook과 영구 상태를 제거하기 위해 의도적으로 선택한 trade-off다.

---

## 8. 버전 전략

```text
0.1.0  Claude/Codex 전용 구조, rename, 새 규칙
0.2.0  두 호스트 smoke test와 Eval 보강
0.3.0  설치 및 문서 안정화
1.0.0  Freeze
```

원본의 `0.2.0`을 그대로 이어받지 않는다. 호스트 범위, 이름, 행동 계약이 달라진 별도 파생 제품이므로 `0.1.0`부터 다시 시작한다.

---

## 9. Fork 절차

```bash
cd /d/git

git clone https://github.com/<YOUR_GITHUB_ID>/adhd-mode.git
cd adhd-mode

git remote add upstream https://github.com/ayghri/i-have-adhd.git
git fetch upstream

git tag upstream-i-have-adhd-2026-08-21 \
  b42a45a068e080294924bfba19a7a2e8944c48ff

git push origin upstream-i-have-adhd-2026-08-21
git switch -c refactor/claude-codex-only
```

권장 commit 순서:

```text
chore: record upstream baseline and fork attribution
chore: remove unsupported host integrations
refactor: rename plugin and skills to adhd-mode
feat: revise the action-first response contract
feat: add explicit adhd-mode-off skill
test: add manifest and structure verification
test: port quality evaluations to node
docs: document Claude Code and Codex installation
ci: verify the fork on Windows and Ubuntu
```

---

## 10. 검증

### 정적 검증

```bash
npm run verify
```

검사 항목:

- 모든 manifest의 이름과 version 일치
- 두 스킬의 frontmatter 유효성
- Claude 자동 호출 비활성화
- Codex implicit invocation 비활성화
- 구 식별자 누수 없음
- 비대상 host 파일 없음
- README 호출 예제 존재
- 원본 MIT 고지 유지

### 테스트

```bash
npm test
npm run check
```

Node.js 내장 `node:test`만 사용하며 runtime dependency는 추가하지 않는다.

### Claude Code

```bash
claude plugin validate .
```

그 뒤 격리 config에서 실제 설치, 두 스킬 호출, 활성화 전 무동작, off 이후 복귀를 검증한다.

### Codex

```bash
codex plugin --help
codex plugin marketplace --help
codex plugin marketplace add .
codex plugin marketplace list
```

현재 설치 표면에서 플러그인을 설치하고 `$adhd-mode`, `$adhd-mode-off`, implicit invocation 비활성화를 확인한다.

---

## 11. Eval release gate

최소 10개 사례를 baseline과 candidate에서 각각 3회 실행한다.

평가 기준:

```text
correctness   35%
autonomy      20%
actionability 20%
safety        15%
concision     10%
```

Release 조건:

- correctness와 safety의 유의미한 회귀 없음
- 요청된 finding 누락 없음
- 검증하지 않은 내용을 검증했다고 주장하지 않음
- blocking finding 0개
- candidate 총점이 baseline보다 높음

유료 모델 Eval은 일반 PR CI에서 실행하지 않고 수동 workflow로 분리한다.

---

## 12. Upstream 정책

원본을 wholesale merge하지 않는다.

```bash
git fetch upstream

git log --oneline \
  upstream-i-have-adhd-2026-08-21..upstream/main \
  -- skills/i-have-adhd/SKILL.md .claude-plugin .codex-plugin
```

의미 있는 skill 개선, manifest 호환성 수정, 실제 회귀 수정만 선택적으로 cherry-pick한다. 채택한 upstream SHA는 commit body와 `CHANGELOG.md`에 기록한다.

MIT `LICENSE`와 원 저작권 고지는 그대로 유지하고, `UPSTREAM.md`에 원본 저장소, 기준 commit, 변경 범위를 기록한다.

---

## 13. Freeze 판정 기준

다음 조건을 모두 충족하면 `1.0.0`으로 Freeze한다.

- Claude/Codex manifest 동기화
- Windows/Ubuntu CI green
- Claude plugin validate green
- Claude 실제 활성화·비활성화 확인
- Codex 실제 활성화·비활성화 확인
- 두 호스트에서 명시 호출 전 자동 적용되지 않음
- 최소 10 case × 3 trial Eval 통과
- correctness/safety 회귀 없음
- 원본 라이선스 및 attribution 유지
- 사용자 파일·홈 디렉터리를 수정하는 코드 없음
- Hook, MCP, network, credential, telemetry 없음
- README가 새 세션·clear·compaction 뒤 재호출 가능성을 명시

## 최종 결정

`adhd-mode`는 **두 개의 명시 호출 스킬로만 구성된 Claude Code + Codex 전용 플러그인**으로 만든다.

실행 인프라를 추가하지 않고, 원본의 행동 우선 UX를 유지하면서 정보 누락과 과도한 형식 강제를 해결한다. 개발 검증만 JavaScript ESM으로 통일하고, 원본 업데이트는 선택적으로 흡수한다.