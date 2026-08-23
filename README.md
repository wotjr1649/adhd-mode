# adhd-mode (개조 중)

[ayghri/i-have-adhd](https://github.com/ayghri/i-have-adhd)의 포크다.
Claude Code와 Codex 전용으로 줄이고, 설치하면 항상 켜지도록 바꾸는 중이다.

작업 계획은 [`docs/adhd-mode 스펙 및 실행계획.md`](docs/adhd-mode%20스펙%20및%20실행계획.md)에 있다.
개조가 끝나면 이 파일을 사용 설명서로 다시 쓴다.

## 설치 (개발용, 로컬 경로)

```bash
claude plugin marketplace add "$PWD"
claude plugin install adhd-mode@adhd-mode

codex plugin marketplace add "$PWD"
codex plugin add adhd-mode@adhd-mode
```

## 라이선스

MIT. 원 저작권은 [`LICENSE`](LICENSE)에 그대로 유지한다. 자세한 내용은 [`UPSTREAM.md`](UPSTREAM.md).
