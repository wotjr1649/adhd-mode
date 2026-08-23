# Upstream

이 저장소는 [ayghri/i-have-adhd](https://github.com/ayghri/i-have-adhd)의 포크다.

## 기준선

```text
원본      https://github.com/ayghri/i-have-adhd
커밋      b42a45a068e080294924bfba19a7a2e8944c48ff
날짜      2026-08-21
제목      Merge pull request #128 from ayghri/docs/ai-agora-routing
태그      upstream-i-have-adhd-2026-08-24
```

`git show upstream-i-have-adhd-2026-08-24` 로 포크 시점의 상태를 볼 수 있다.

## 갈라진 범위

| 항목 | 원본 | 이 포크 |
|---|---|---|
| 대상 호스트 | Claude Code, Codex, Cursor, OpenCode, Pi, OMP, Gemini, Qwen, Kimi, Antigravity | Claude Code, Codex |
| 활성화 | 명시 호출. 항상 켜기는 홈 디렉터리 플래그 파일로 opt-in | 설치하면 항상 켜짐. 플래그 파일 없음 |
| 적용 범위 | 메인 세션 | 메인 세션 + 서브에이전트 |
| 규칙 | 10개 원본 | 10개 유지, 4개 개정 + 검증 표기 추가 |
| 검증 | Python 테스트와 eval 하네스 | 호스트 CLI 검증 + 실제 설치 실측 |
| 문서 | 영어 + 5개 번역 | 한국어 1개 |

규칙 개정의 내용과 근거는 `docs/adhd-mode 스펙 및 실행계획.md` §6에 있다.

## 동기화 정책

**upstream을 병합하지 않는다.** 호스트 범위와 활성화 방식이 갈라졌기 때문에
wholesale merge는 이 포크의 전제를 되돌린다.

원격은 참고용으로만 걸어 둔다.

```bash
git remote add upstream https://github.com/ayghri/i-have-adhd.git
git fetch upstream
git log --oneline upstream-i-have-adhd-2026-08-24..upstream/main -- skills/ hooks/
```

가져올 만한 변경이 보이면 그때 개별 cherry-pick 한다. 정기 동기화 절차는 두지 않는다.

## 라이선스

MIT. `LICENSE`의 원 저작권 고지(`Copyright (c) 2026 Ayoub Ghriss`)는 그대로 유지한다.

## 참고

원본 저장소에서 가져온 판단 중 이 포크가 그대로 따르는 것:

- `manifest.hooks` 키를 쓰지 않는다 (`ed6a0a2`). 관례 경로 `hooks/hooks.json`을
  가리키면 중복 검사에 걸려 훅 세트 전체가 드롭되고, 플러그인은 설치 성공으로
  표시된 채 아무 일도 하지 않는다.
- SessionStart 런처는 셸 확장이 아니라 `node -e`로 환경변수를 읽는다
  (`d264f01`, `578d076`). `CLAUDE_PLUGIN_ROOT`와 `PLUGIN_ROOT` 양쪽을 본다.
- 훅 timeout은 30초다 (`43eeda8`). 다른 SessionStart 훅이 여럿 등록된 환경에서
  런처가 6549ms 걸려 취소된 실측이 근거다.
