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

// Which event fired. Hosts pass the hook payload as JSON on stdin; if that is
// unavailable we assume SessionStart, whose plain-stdout path works anyway.
function readEventName() {
  try {
    const name = JSON.parse(fs.readFileSync(0, "utf8"))?.hook_event_name;
    return typeof name === "string" ? name : null;
  } catch {
    return null;
  }
}

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
  const text =
    "ADHD MODE ACTIVE. The ruleset below applies to every response in this session.\n\n" +
    `${body}\n`;

  // SessionStart injects plain stdout. SubagentStart does not — its context is
  // a separate thread, and plain text there is read and discarded, which is why
  // a subagent runs unaware while the parent session is shaped. That event
  // needs the structured form.
  if (readEventName() === "SubagentStart") {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "SubagentStart",
          additionalContext: text,
        },
      }),
    );
  } else {
    process.stdout.write(text);
  }
} catch (err) {
  // Never block session start — but say why on stderr. Both hosts read "exit 0
  // with empty stdout" as "succeeded, no extra context", so a silent catch
  // turns every failure here into a plugin that loads and does nothing.
  // stderr goes to the hook log, not the model's context.
  process.stderr.write(`adhd-mode: ${err?.message ?? err}\n`);
  process.exit(0);
}
