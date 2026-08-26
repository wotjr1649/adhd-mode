// SessionStart hook: injects the ruleset from SKILL.md.
//
// Unconditional: installing the plugin turns the mode on. There is no flag
// file and nothing is written anywhere; this reads one file and prints it.
// Never blocks session start: any failure exits 0.
//
// Subagents are deliberately not injected. Their reader is the parent model,
// not a person, and the parent's own session injection already shapes what
// reaches the reader. Injecting there also cost the full ruleset per spawn,
// which a fan-out multiplies. A caller that needs a subagent to report what it
// did not verify asks for that in the dispatch prompt.
//
// Runs under Node so it works on macOS, Linux, and Windows. The shared Claude
// Code/Codex hook launches this module from the plugin-root environment rather
// than relying on shell expansion for the script path.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

try {
  // Resolve SKILL.md relative to this script's own location, not a trusted env var.
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const skillPath = path.join(scriptDir, "..", "skills", "adhd-mode", "SKILL.md");
  if (!fs.existsSync(skillPath)) {
    process.stderr.write(`adhd-mode: ruleset not found at ${skillPath}\n`);
    process.exit(0);
  }

  // Strip a leading YAML frontmatter block (--- ... --- at the very top of file).
  const body = fs
    .readFileSync(skillPath, "utf8")
    .replace(
      /^---[^\S\r\n]*\r?\n[\s\S]*?\r?\n---[^\S\r\n]*(?:\r?\n|$)/,
      "",
    )
    .replace(/(?:\r?\n)+$/, "");

  // One-line header: state that the mode is active, nothing else. How to turn
  // it off and how long that lasts is stated once, in SKILL.md's Persistence
  // section, so the two cannot drift apart.
  //
  // SessionStart reads plain stdout as additional context. Nothing here parses
  // the hook payload, so stdin is left unread — that is also why running this
  // by hand no longer hangs waiting on a pipe that never closes.
  process.stdout.write(
    "ADHD MODE ACTIVE. The ruleset below applies to every response in this session.\n\n" +
      `${body}\n`,
  );
} catch (err) {
  // Never block session start — but say why on stderr. Both hosts read "exit 0
  // with empty stdout" as "succeeded, no extra context", so a silent catch
  // turns every failure here into a plugin that loads and does nothing.
  // stderr goes to the hook log, not the model's context.
  process.stderr.write(`adhd-mode: ${err?.message ?? err}\n`);
  process.exit(0);
}
