#!/usr/bin/env npx tsx

/**
 * Test script for tmux-based fixed header
 *
 * Uses tmux to create a split terminal:
 * - Top pane: Fixed header (clean, no shell prompt)
 * - Bottom pane: Claude runs freely
 *
 * After 10 seconds, counts down 5-1, kills Claude, and restarts.
 *
 * Usage:
 *   npx tsx scripts/test-tmux-header.ts
 *
 * Tmux commands:
 *   Ctrl+B d     - Detach (keeps session running)
 *   Ctrl+D       - Exit pane / end Claude
 *   tmux kill-session -t dwf-test  - Kill from outside
 */

import { execSync, spawnSync, spawn } from "child_process";
import * as fs from "fs";

const SESSION = "dwf-test";
const HEADER_FILE = "/tmp/dwf-header.txt";
const HEADER_SCRIPT = "/tmp/dwf-header-display.sh";
const ORCHESTRATOR_SCRIPT = "/tmp/dwf-orchestrator.sh";

function run(cmd: string): { ok: boolean; out: string; err: string } {
  try {
    const out = execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
    return { ok: true, out, err: "" };
  } catch (e: unknown) {
    const err = e as { stderr?: string };
    return { ok: false, out: "", err: err.stderr || String(e) };
  }
}

function hasTmux(): boolean {
  return run("which tmux").ok;
}

function makeHeader(status: string): string {
  const width = 78;
  const bar = "=".repeat(width);
  const title = "Worker-1: Task #42.1 - Test tmux header";
  const titlePad = " ".repeat(Math.max(0, width - title.length - 2));
  const statusLine = `Status: ${status}`;
  const statusPad = " ".repeat(Math.max(0, width - statusLine.length - 2));

  return [
    `+${bar}+`,
    `| ${title}${titlePad}|`,
    `| ${statusLine}${statusPad}|`,
    `+${bar}+`,
  ].join("\n");
}

async function main() {
  if (!hasTmux()) {
    console.error("tmux not found. Install with: brew install tmux");
    process.exit(1);
  }

  // Kill any existing session
  run(`tmux kill-session -t ${SESSION}`);

  console.log("Creating tmux session with fixed header...\n");
  console.log("Controls:");
  console.log("  Ctrl+B d     - Detach (keeps session running)");
  console.log("  Ctrl+D       - Exit Claude / pane");
  console.log(`  tmux kill-session -t ${SESSION}  - Kill from outside\n`);

  // Create the header display script
  const headerScript = `#!/bin/bash
tput civis
clear
LAST_MTIME=""
while true; do
  if [ -f "${HEADER_FILE}" ]; then
    MTIME=$(stat -f %m "${HEADER_FILE}" 2>/dev/null)
    if [ "$MTIME" != "$LAST_MTIME" ]; then
      tput cup 0 0
      cat "${HEADER_FILE}"
      LAST_MTIME="$MTIME"
    fi
  fi
  sleep 0.2
done
`;
  fs.writeFileSync(HEADER_SCRIPT, headerScript, { mode: 0o755 });

  // Create orchestrator script that manages Claude lifecycle
  const bar = "=".repeat(78);
  const orchestratorScript = `#!/bin/bash
SESSION="${SESSION}"
HEADER_FILE="${HEADER_FILE}"

update_header() {
  local status="\$1"
  cat > "\$HEADER_FILE" << EOF
+${bar}+
| Worker-1: Task #42.1 - Test tmux header                                      |
| Status: \$status                                                              |
+${bar}+
EOF
}

session_num=1

while true; do
  update_header "Session \$session_num - IN_PROGRESS"

  # Start Claude in the pane
  prompt="Session \$session_num: Say hello briefly, mention your session number, then wait for input."
  tmux send-keys -t "\$SESSION:0.1" "claude \\"\$prompt\\"" Enter

  # Wait 10 seconds
  sleep 10

  # Countdown
  for i in 5 4 3 2 1; do
    update_header "Session \$session_num - ENDING IN \$i s..."
    sleep 1
  done

  update_header "Session \$session_num - KILLING..."

  # Send /exit to Claude, then Ctrl+C as backup, then clear
  tmux send-keys -t "\$SESSION:0.1" "/exit" Enter
  sleep 1
  tmux send-keys -t "\$SESSION:0.1" C-c
  sleep 0.5
  tmux send-keys -t "\$SESSION:0.1" C-c
  sleep 0.5
  tmux send-keys -t "\$SESSION:0.1" "clear" Enter

  update_header "Session \$session_num - RESTARTING..."
  sleep 1

  session_num=\$((session_num + 1))
done
`;
  fs.writeFileSync(ORCHESTRATOR_SCRIPT, orchestratorScript, { mode: 0o755 });

  // Initial header
  fs.writeFileSync(HEADER_FILE, makeHeader("STARTING..."));

  // Step 1: Create session running the header script
  const create = run(`tmux new-session -d -s ${SESSION} '${HEADER_SCRIPT}'`);
  if (!create.ok) {
    console.error("Failed to create tmux session:", create.err);
    process.exit(1);
  }

  // Step 2: Split - bottom pane (90%) for Claude
  const split = run(`tmux split-window -t ${SESSION}:0 -v -p 90`);
  if (!split.ok) {
    console.error("Failed to split window:", split.err);
    run(`tmux kill-session -t ${SESSION}`);
    process.exit(1);
  }

  // Step 3: Select the bottom pane
  run(`tmux select-pane -t ${SESSION}:0.1`);

  // Step 4: Start orchestrator in background
  const child = spawn("bash", [ORCHESTRATOR_SCRIPT], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  // Step 5: Attach
  console.log("Attaching to tmux session...");
  console.log("Claude will restart every ~15 seconds (10s run + 5s countdown)\n");
  spawnSync("tmux", ["attach-session", "-t", SESSION], { stdio: "inherit" });

  // Cleanup
  run(`tmux kill-session -t ${SESSION}`);
  // Kill orchestrator
  run(`pkill -f ${ORCHESTRATOR_SCRIPT}`);

  try {
    fs.unlinkSync(HEADER_FILE);
    fs.unlinkSync(HEADER_SCRIPT);
    fs.unlinkSync(ORCHESTRATOR_SCRIPT);
  } catch {
    // ignore
  }

  console.log("\nSession ended.");
}

main().catch(console.error);
