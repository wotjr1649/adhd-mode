// SessionStart / SubagentStart hook: injects the ruleset from SKILL.md.
//
// Unconditional: installing the plugin turns the mode on. There is no flag
// file and nothing is written anywhere; this reads one file and prints it.
// Never blocks session start: any failure exits 0.
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
  if (!fs.existsSync(skillPath)) process.exit(0);

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
  process.stdout.write(
    "ADHD MODE ACTIVE. The ruleset below applies to every response in this session.\n\n" +
      `${body}\n`,
  );
} catch {
  // Never block session start.
  process.exit(0);
}
