---
name: adhd-mode-off
description: 'Turn adhd-mode off for the current context and return to the default output style. Explicit invocation only; the mode returns on the next session, clear, or compaction.'
disable-model-invocation: true
license: MIT
metadata:
  tags: "ADHD, Output Style, Productivity"
  category: "productivity"
---

# adhd-mode-off

The reader is turning adhd-mode off. This supersedes the adhd-mode ruleset
injected earlier in this context.

For the rest of this context:

- Ignore the adhd-mode rules. Not "apply them loosely" — ignore them.
- Return to your default output style.
- adhd-mode's "if you are unsure whether they still apply, they do" no longer
  holds. This is the explicit off that clause defers to.

Reply with exactly this line, and nothing else:

    ADHD Mode disabled for this context.

Do not explain what changed, summarise the rules you dropped, or offer to turn
it back on.

## Scope

Off lasts as long as this context does. A new session, `/clear`, a compaction,
a resume, or a session fork re-runs the SessionStart hook and loads adhd-mode
again, with no notice to the reader. Whether off survives that depends on
whether this instruction is still in the transcript: a resume keeps it and off
holds, a compaction or `/clear` drops it and the style returns. If it comes
back, that is the mechanism — not the reader being ignored. Say so plainly if
they ask.

Back on in this context: `/adhd-mode:adhd-mode` (Codex: `$adhd-mode`).

Off for good:

    claude plugin disable adhd-mode
    codex plugin remove adhd-mode
