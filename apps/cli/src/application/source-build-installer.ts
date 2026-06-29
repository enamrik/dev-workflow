/**
 * SourceBuildInstaller — phase 1 of `dfl update --from <path>`: build the bundle
 * from a LOCAL dev-workflow source tree / git worktree and overlay it into
 * `~/.dfl/install`. This is `make dogfood` as a first-class command, runnable
 * from any directory and pointable at a specific worktree for parallel dev.
 *
 * It is the sibling of {@link ReleaseInstaller}: both PRODUCE the same
 * `~/.dfl/install` bundle shape, then `UpdateCommand` runs the shared phase-2
 * reconciliation (skills/templates/migrations/MCP) over it. ReleaseInstaller
 * downloads + extracts a published tarball; this builds the working tree and
 * overlays the freshly-built pieces. Neither owns phase 2.
 *
 * The build + overlay steps mirror what the Makefile `dogfood` target ran (and
 * the now-retired `scripts/dogfood.mjs`): `pnpm -r build` (incl. the web export),
 * a version-stamped tsup of cli + mcp-server, then overlay
 * cli.js/mcp-server.js/drizzle/skills/templates/ui into `~/.dfl/install`, keep
 * the vendored multi-ABI better-sqlite3, and rewrite the `~/.local/bin/dfl`
 * launcher. The global `~/.claude/skills` install is intentionally NOT done here
 * — that is phase 2's `updateSkills()`, reading from the `install/skills` this
 * overlays, so the two never duplicate.
 */

import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { InstallResult } from "./release-installer.js";

export class SourceBuildError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "SourceBuildError";
  }
}

/** Markers that identify a directory as a dev-workflow source tree. */
const REQUIRED_DIRS = ["apps/cli", "apps/mcp-server", "packages/database/drizzle"] as const;

export class SourceBuildInstaller {
  /** `~/.dfl` (holds both `install/` and data `track/`). */
  private readonly dflDir: string;
  /** `~/.dfl/install` — only this subdir is replaced; sibling `track/` is untouched. */
  private readonly installDir: string;
  /** `~/.local/bin` — where the `dfl` launcher lives. */
  private readonly binDir: string;

  constructor() {
    // Match install.sh / ReleaseInstaller / uninstall.service.ts env contract
    // exactly so install, update, and uninstall all target the same locations.
    this.dflDir = process.env["DFL_INSTALL_DIR"] ?? path.join(os.homedir(), ".dfl");
    this.installDir = path.join(this.dflDir, "install");
    this.binDir = process.env["DFL_BIN_DIR"] ?? path.join(os.homedir(), ".local", "bin");
  }

  /**
   * Resolve `<path>` (default `.`) to an absolute source-tree path, relative to
   * the current working directory — so `--from` works from any directory.
   */
  static resolveSourcePath(from?: string): string {
    return path.resolve(process.cwd(), from ?? ".");
  }

  /**
   * Phase 1: build the bundle from the source tree at `from` (default `.`) and
   * overlay it into `~/.dfl/install`. Always `changed: true` — a source build
   * always re-publishes the working tree (that is the whole point of dogfood).
   *
   * @param opts.from path to a dev-workflow source tree/worktree; omit for `.`.
   */
  async installFromSource(opts: { from?: string } = {}): Promise<InstallResult> {
    if (process.platform === "win32") {
      throw new SourceBuildError(
        "`dfl update --from` does not support Windows yet — use a Unix shell to build from source."
      );
    }

    const sourcePath = SourceBuildInstaller.resolveSourcePath(opts.from);
    this.validateSourceTree(sourcePath);

    const version = this.computeDevVersion(sourcePath);
    this.build(sourcePath, version);
    this.overlay(sourcePath);
    await this.writeLaunchers();

    return { version, changed: true };
  }

  // ===========================================================================
  // Validation (clear error when <path> isn't a dev-workflow source tree)
  // ===========================================================================

  /**
   * Throw a clear {@link SourceBuildError} unless `sourcePath` looks like a
   * dev-workflow source tree: a workspace root (`pnpm-workspace.yaml` + a
   * `package.json` named `dev-workflow`) holding the cli/mcp/drizzle sources the
   * build + overlay depend on.
   */
  validateSourceTree(sourcePath: string): void {
    if (!existsSync(sourcePath)) {
      throw new SourceBuildError(`--from path does not exist: ${sourcePath}`);
    }

    const pkgPath = path.join(sourcePath, "package.json");
    const hasWorkspace = existsSync(path.join(sourcePath, "pnpm-workspace.yaml"));
    let isDevWorkflow = false;
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { name?: string };
        isDevWorkflow = pkg.name === "dev-workflow";
      } catch {
        isDevWorkflow = false;
      }
    }

    const missingDirs = REQUIRED_DIRS.filter((d) => !existsSync(path.join(sourcePath, d)));

    if (!hasWorkspace || !isDevWorkflow || missingDirs.length > 0) {
      throw new SourceBuildError(
        `${sourcePath} is not a dev-workflow source tree. ` +
          `Expected a workspace root with a package.json named "dev-workflow", ` +
          `pnpm-workspace.yaml, and ${REQUIRED_DIRS.join(", ")}. ` +
          `Point --from at a dev-workflow checkout or worktree.`
      );
    }
  }

  // ===========================================================================
  // Build (mirror the Makefile dogfood build: pnpm -r build + stamped tsup)
  // ===========================================================================

  /**
   * Dev version string stamped into the bundle, matching the Makefile dogfood
   * recipe: `0.0.0-dev+g<short-sha>` (+ `.dirty` when the tree has uncommitted
   * changes). Falls back to a plain dev marker when git metadata is unavailable.
   */
  private computeDevVersion(sourcePath: string): string {
    try {
      const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: sourcePath })
        .toString()
        .trim();
      let dirty = "";
      try {
        execFileSync("git", ["diff", "--quiet"], { cwd: sourcePath, stdio: "ignore" });
      } catch {
        dirty = ".dirty";
      }
      return `0.0.0-dev+g${sha}${dirty}`;
    } catch {
      return "0.0.0-dev";
    }
  }

  /** Build all packages (incl. the web export), then re-stamp cli + mcp via tsup. */
  private build(sourcePath: string, version: string): void {
    const run = (args: string[], env?: NodeJS.ProcessEnv): void => {
      try {
        execFileSync("pnpm", args, { cwd: sourcePath, stdio: "inherit", env: env ?? process.env });
      } catch (error) {
        throw new SourceBuildError(`Build step failed: pnpm ${args.join(" ")}`, error);
      }
    };

    console.log("🔨 Building all packages (incl. web export)...");
    run(["-r", "build"]);

    console.log("🔨 Bundling cli + mcp-server...");
    const stampedEnv = { ...process.env, DFL_VERSION: version };
    run(["--filter", "@dev-workflow/cli", "exec", "tsup"], stampedEnv);
    run(["--filter", "@dev-workflow/mcp-server", "exec", "tsup"], stampedEnv);
  }

  // ===========================================================================
  // Overlay (produce the ~/.dfl/install bundle shape; ported from dogfood.mjs)
  // ===========================================================================

  /** Recursive copy that dereferences symlinks, matching the old dogfood.mjs. */
  private cp(src: string, dest: string): void {
    cpSync(src, dest, { recursive: true, dereference: true });
  }

  /** Overlay the freshly-built pieces into `~/.dfl/install` (keeps vendored native module). */
  private overlay(sourcePath: string): void {
    const cliBundle = path.join(sourcePath, "apps/cli/dist/cli.js");
    const mcpBundle = path.join(sourcePath, "apps/mcp-server/dist/mcp-server.js");
    const webOut = path.join(sourcePath, "apps/web/out");
    for (const [p, hint] of [
      [cliBundle, "pnpm --filter @dev-workflow/cli exec tsup"],
      [mcpBundle, "pnpm --filter @dev-workflow/mcp-server exec tsup"],
      [webOut, "pnpm --filter @dev-workflow/web build"],
    ] as const) {
      if (!existsSync(p)) {
        throw new SourceBuildError(`Build did not produce ${p} (expected from: ${hint}).`);
      }
    }

    console.log(`📦 Publishing local build into ${this.installDir}...`);
    mkdirSync(path.join(this.installDir, "bin"), { recursive: true });

    this.cp(cliBundle, path.join(this.installDir, "cli.js"));
    this.cp(mcpBundle, path.join(this.installDir, "mcp-server.js"));
    this.replaceDir(path.join(sourcePath, "packages/database/drizzle"), "drizzle");
    this.replaceDir(path.join(sourcePath, "apps/cli/skills"), "skills");
    this.replaceDir(path.join(sourcePath, "apps/cli/templates"), "templates");
    this.replaceDir(webOut, "ui");

    // Native module: reuse the vendored multi-ABI one from a prior curl install
    // if present, else fall back to the source tree's local build (current ABI).
    const vendored = path.join(this.installDir, "node_modules/better-sqlite3");
    if (!existsSync(vendored)) {
      const local = path.join(sourcePath, "node_modules/better-sqlite3");
      if (!existsSync(local)) {
        throw new SourceBuildError(
          "No better-sqlite3 found (neither vendored in ~/.dfl/install nor in the source tree). " +
            "Run a curl install once, or `pnpm install` in the source tree."
        );
      }
      mkdirSync(path.join(this.installDir, "node_modules"), { recursive: true });
      this.cp(local, vendored);
    }
  }

  /** Replace `install/<name>` with a fresh copy of `src` (rm-then-copy). */
  private replaceDir(src: string, name: string): void {
    const dest = path.join(this.installDir, name);
    rmSync(dest, { recursive: true, force: true });
    this.cp(src, dest);
  }

  // ===========================================================================
  // Launchers (absolute-path exec, identical to install.sh / ReleaseInstaller)
  // ===========================================================================

  /** Rewrite both the bundled `install/bin/dfl` and the `~/.local/bin/dfl` launchers. */
  private async writeLaunchers(): Promise<void> {
    const launcher = `#!/bin/sh\nexec node "${path.join(this.installDir, "cli.js")}" "$@"\n`;
    writeFileSync(path.join(this.installDir, "bin", "dfl"), launcher, { mode: 0o755 });
    mkdirSync(this.binDir, { recursive: true });
    const binLauncher = path.join(this.binDir, "dfl");
    writeFileSync(binLauncher, launcher);
    chmodSync(binLauncher, 0o755);
  }
}
