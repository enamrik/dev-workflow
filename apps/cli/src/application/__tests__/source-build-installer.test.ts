/**
 * SourceBuildInstaller — phase 1 of `dfl update --from <path>`.
 *
 * Covers the cheap, pure hot spots: resolving `--from` to an absolute path
 * (relative to cwd, so it works from any directory) and the source-tree
 * validation that produces a clear error when `<path>` isn't a dev-workflow
 * checkout. The build/overlay steps shell out to pnpm/tsup + copy real trees,
 * so they are exercised via dogfood, not unit tests.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { SourceBuildInstaller, SourceBuildError } from "../source-build-installer.js";

/** Build a directory tree that passes (or, with omissions, fails) validation. */
function makeSourceTree(
  root: string,
  opts: { name?: string; workspace?: boolean; dirs?: string[] } = {}
): void {
  const { name = "dev-workflow", workspace = true, dirs = REQUIRED } = opts;
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name }));
  if (workspace) {
    writeFileSync(path.join(root, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
  }
  for (const d of dirs) {
    mkdirSync(path.join(root, d), { recursive: true });
  }
}

const REQUIRED = ["apps/cli", "apps/mcp-server", "packages/database/drizzle"];

describe("SourceBuildInstaller.resolveSourcePath", () => {
  it("resolves a relative path against the current working directory", () => {
    const resolved = SourceBuildInstaller.resolveSourcePath("some/dir");
    expect(resolved).toBe(path.resolve(process.cwd(), "some/dir"));
  });

  it("defaults to the current directory when --from is omitted", () => {
    expect(SourceBuildInstaller.resolveSourcePath()).toBe(path.resolve(process.cwd(), "."));
    expect(SourceBuildInstaller.resolveSourcePath(".")).toBe(process.cwd());
  });

  it("keeps an absolute path as-is", () => {
    const abs = path.join(tmpdir(), "abs-source");
    expect(SourceBuildInstaller.resolveSourcePath(abs)).toBe(abs);
  });
});

describe("SourceBuildInstaller.validateSourceTree", () => {
  let installer: SourceBuildInstaller;
  let tmp: string;

  beforeEach(() => {
    installer = new SourceBuildInstaller();
    tmp = mkdtempSync(path.join(tmpdir(), "dfl-source-build-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("accepts a well-formed dev-workflow source tree", () => {
    const root = path.join(tmp, "good");
    makeSourceTree(root);
    expect(() => installer.validateSourceTree(root)).not.toThrow();
  });

  it("throws when the path does not exist", () => {
    expect(() => installer.validateSourceTree(path.join(tmp, "nope"))).toThrow(SourceBuildError);
  });

  it("throws when package.json is not named dev-workflow", () => {
    const root = path.join(tmp, "wrong-name");
    makeSourceTree(root, { name: "some-other-project" });
    expect(() => installer.validateSourceTree(root)).toThrow(/not a dev-workflow source tree/);
  });

  it("throws when pnpm-workspace.yaml is missing", () => {
    const root = path.join(tmp, "no-workspace");
    makeSourceTree(root, { workspace: false });
    expect(() => installer.validateSourceTree(root)).toThrow(SourceBuildError);
  });

  it("throws when a required source dir is missing", () => {
    const root = path.join(tmp, "missing-dir");
    makeSourceTree(root, { dirs: ["apps/cli", "apps/mcp-server"] }); // no drizzle
    expect(() => installer.validateSourceTree(root)).toThrow(/packages\/database\/drizzle/);
  });
});
