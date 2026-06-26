#!/usr/bin/env node
/**
 * Isolated sandbox smoke test for the GLOBAL model.
 *
 * dev-workflow is a global tool: it installs skills into ~/.claude/skills, registers one
 * `--scope user` MCP server, and the server resolves which project it's in from its working
 * directory. That makes "test a version without touching my real setup" the key concern.
 *
 * This harness redirects every global location into a throwaway temp dir:
 *   - DFL_HOME           → dev-workflow's data root (DBs, project configs, worktrees)
 *   - CLAUDE_CONFIG_DIR  → Claude Code's config home (where skills are read from)
 *   - a stub `claude` on PATH → captures the MCP registration without writing the real registry
 *
 * Then it runs the real `dfl init`, asserts everything landed in the sandbox (not the
 * real ~/.dfl/track / ~/.claude), and finally launches the actual MCP server via `dfl mcp`
 * with NO slug env — proving the server resolves the project purely from its cwd — and drives a
 * real MCP initialize → tools/list handshake over stdio. A negative case confirms it refuses a
 * non-project directory.
 */
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readdirSync,
  readFileSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync, spawn } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = dirname(__dirname);
const CLI = join(REPO, "apps/cli/dist/main.js");

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

if (!existsSync(CLI)) {
  console.error(`CLI not built: ${CLI}\nRun 'pnpm build' first (or 'make e2e-sandbox').`);
  process.exit(1);
}

const sandbox = mkdtempSync(join(tmpdir(), "dfl-sandbox-"));
const dflHome = join(sandbox, "data");
const claudeDir = join(sandbox, "claude");
const proj = join(sandbox, "proj");
const nonProj = join(sandbox, "elsewhere");
const binDir = join(sandbox, "bin");
const claudeLog = join(sandbox, "claude-calls.log");
for (const d of [dflHome, claudeDir, proj, nonProj, binDir]) mkdirSync(d, { recursive: true });

// Stub `claude` so init's MCP registration is captured here, never touching the real registry.
const stub = join(binDir, "claude");
writeFileSync(stub, `#!/bin/sh\necho "$@" >> "${claudeLog}"\nexit 0\n`);
chmodSync(stub, 0o755);

// Fully isolated env: point the data root + Claude config at the sandbox, and strip any
// leaked DFL_PROJECT_SLUG from the parent shell so the server resolves the project from cwd.
const env = {
  ...process.env,
  DFL_HOME: dflHome,
  CLAUDE_CONFIG_DIR: claudeDir,
  PATH: `${binDir}:${process.env.PATH}`,
};
delete env.DFL_PROJECT_SLUG;

function git(args) {
  execSync(`git ${args}`, { cwd: proj, stdio: "pipe", env });
}

/** Spawn `dfl mcp` and run a request/response RPC loop over its stdio. */
function startMcp(cwd) {
  const child = spawn("node", [CLI, "mcp"], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map();
  let buf = "";
  let stderr = "";
  child.stdout.on("data", (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id != null && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    }
  });
  child.stderr.on("data", (d) => {
    stderr += d.toString();
  });
  const rpc = (req) =>
    new Promise((resolve, reject) => {
      if (req.id != null) {
        const t = setTimeout(() => {
          pending.delete(req.id);
          reject(new Error(`RPC timeout (id=${req.id}); stderr:\n${stderr}`));
        }, 20000);
        pending.set(req.id, (m) => {
          clearTimeout(t);
          resolve(m);
        });
      }
      child.stdin.write(`${JSON.stringify(req)}\n`);
      if (req.id == null) resolve();
    });
  return { child, rpc };
}

async function mcpToolsList(cwd) {
  const { child, rpc } = startMcp(cwd);
  try {
    await rpc({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "sandbox", version: "0" },
      },
    });
    await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });
    const res = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    return res?.result?.tools;
  } finally {
    child.kill();
  }
}

/** Launch the server somewhere that is NOT a dev-workflow project; expect a non-zero exit. */
function mcpExpectFailure(cwd) {
  return new Promise((resolve) => {
    const child = spawn("node", [CLI, "mcp"], { cwd, env, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    const t = setTimeout(() => {
      child.kill();
      resolve({ code: -1, stderr });
    }, 20000);
    child.on("exit", (code) => {
      clearTimeout(t);
      resolve({ code, stderr });
    });
  });
}

try {
  console.log(`\n📦 Sandbox: ${sandbox}\n`);

  // 1. A throwaway git repo to play the part of a user's project.
  git("init -q");
  git('config user.email "sandbox@example.com"');
  git('config user.name "sandbox"');
  writeFileSync(join(proj, "README.md"), "# sandbox\n");
  git("add .");
  git('commit -qm "init"');

  // 2. Run the real init, fully isolated.
  console.log("▶ dfl init (isolated)\n");
  execSync(`node ${CLI} init`, { cwd: proj, stdio: "inherit", env });

  // 3. Everything must have landed in the sandbox, not the real home dirs.
  console.log("\n▶ Isolation assertions");
  const projectsDir = join(dflHome, "projects");
  const projects = existsSync(projectsDir) ? readdirSync(projectsDir) : [];
  check("data root populated under DFL_HOME", projects.length > 0, `projects=[${projects}]`);
  check(
    "project config.json written",
    projects.some((p) => existsSync(join(projectsDir, p, "config.json")))
  );
  const skillsDir = join(claudeDir, "skills");
  const skills = existsSync(skillsDir)
    ? readdirSync(skillsDir).filter((d) => d.startsWith("dfl-"))
    : [];
  check("skills installed under CLAUDE_CONFIG_DIR", skills.length > 0, `skills=[${skills}]`);

  // 4. Registration shape — captured by the stub, never touching the real registry.
  const log = existsSync(claudeLog) ? readFileSync(claudeLog, "utf8") : "";
  check("MCP registered with --scope user", /mcp add .*--scope user/.test(log), log.trim());
  check("registration bakes in no DFL_PROJECT_SLUG", !/DFL_PROJECT_SLUG/.test(log));

  // 5. The crux: the server resolves the project from cwd alone (no slug env).
  console.log("\n▶ MCP server resolves project from cwd (no slug env)");
  const tools = await mcpToolsList(proj);
  check(
    "tools/list returned tools",
    Array.isArray(tools) && tools.length > 0,
    `count=${tools?.length}`
  );

  // 6. Negative: a non-project dir must be refused, not silently mis-served.
  console.log("\n▶ MCP server refuses a non-project directory");
  const neg = await mcpExpectFailure(nonProj);
  check("server exits non-zero outside a project", neg.code !== 0, `code=${neg.code}`);
  check(
    "error explains it's not a dev-workflow project",
    /not a (git repository|dev-workflow project)/i.test(neg.stderr),
    neg.stderr.trim().split("\n").slice(0, 2).join(" / ")
  );
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}

console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
