/**
 * ReleaseInstaller — phase 1 of `dfl update`: fetch + apply a released artifact.
 *
 * This is the TypeScript sister of the curl|bash installer
 * (`docs-site/static/install.sh`). The shell script is the BOOTSTRAP path: it
 * runs at `curl | sh` time when no `dfl` bundle exists yet, so it cannot import
 * this module. Once a bundle IS installed, `dfl update` owns the same job from
 * inside the running CLI, and that logic lives here — one TS owner so the
 * update command never re-implements download/verify/extract/launcher inline.
 *
 * Scope of phase 1 (frozen): resolve the target release, download the
 * per-platform tarball, verify its checksum, replace `~/.dfl/install`, and
 * rewrite the `~/.local/bin/dfl` launcher. Skills/templates/migrations/MCP
 * registration are PHASE 2 — the existing UpdateService reconciliation — which
 * reads from `packageRoot` (= `~/.dfl/install`, the dir this just rewrote), so
 * they are intentionally NOT duplicated here.
 *
 * Distribution is a self-contained GitHub Release tarball — NO npm/registry
 * access (the corporate npm/CodeArtifact proxy is the original blocker).
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, rmSync, renameSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { FileSystem } from "../infrastructure/file-system.js";
import { readInstalledBundleVersion } from "../infrastructure/installed-version.js";

/** GitHub `owner/repo` the released artifacts are published under. */
const REPO = "enamrik/dev-workflow";

/** Default number of releases `--list` prints. */
const DEFAULT_LIST_LIMIT = 10;

export class ReleaseInstallError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "ReleaseInstallError";
  }
}

/** A published release, newest-first when returned from {@link ReleaseInstaller.listReleases}. */
export interface ReleaseSummary {
  /** Version without the leading `v` (e.g. `1.2.3`). */
  version: string;
  /** Raw git tag (e.g. `v1.2.3`). */
  tag: string;
  /** ISO publish timestamp, or null when GitHub omits it. */
  publishedAt: string | null;
}

/** Outcome of {@link ReleaseInstaller.installRelease}. */
export interface InstallResult {
  /** The target version (without the leading `v`). */
  version: string;
  /** False when the install dir already held this version — nothing was downloaded. */
  changed: boolean;
}

export class ReleaseInstaller {
  /** `~/.dfl` (holds both `install/` and data `track/`). */
  private readonly dflDir: string;
  /** `~/.dfl/install` — only this subdir is replaced; sibling `track/` is untouched. */
  private readonly installDir: string;
  /** `~/.local/bin` — where the `dfl` launcher lives. */
  private readonly binDir: string;

  constructor(private readonly fileSystem: FileSystem) {
    // Match install.sh / uninstall.service.ts env contract exactly so install,
    // update, and uninstall all target the same locations.
    this.dflDir = process.env["DFL_INSTALL_DIR"] ?? path.join(os.homedir(), ".dfl");
    this.installDir = path.join(this.dflDir, "install");
    this.binDir = process.env["DFL_BIN_DIR"] ?? path.join(os.homedir(), ".local", "bin");
  }

  // ===========================================================================
  // Pure resolution (the hot spot: WHICH version / WHERE its asset lives)
  // ===========================================================================

  /**
   * Map the host platform/arch to the release asset slug (e.g. `darwin-arm64`).
   * Mirrors `scripts/assemble-artifact.mjs` so the resolved name matches a real
   * published asset. Throws on an unsupported platform/arch.
   */
  static platformSlug(
    platform: NodeJS.Platform = process.platform,
    arch: string = process.arch
  ): string {
    const osName = platform === "win32" ? "windows" : platform;
    if (!["darwin", "linux", "windows"].includes(osName)) {
      throw new ReleaseInstallError(`Unsupported OS: ${platform}`);
    }
    if (!["x64", "arm64"].includes(arch)) {
      throw new ReleaseInstallError(`Unsupported architecture: ${arch}`);
    }
    return `${osName}-${arch}`;
  }

  /** Release asset filename for a slug (`.zip` for windows, `.tar.gz` otherwise). */
  static assetName(slug: string): string {
    const ext = slug.startsWith("windows-") ? "zip" : "tar.gz";
    return `dev-workflow-${slug}.${ext}`;
  }

  /** Strip a leading `v` so user input (`v1.2.3`) and tags compare cleanly against `1.2.3`. */
  static normalizeVersion(version: string): string {
    return version.trim().replace(/^v/, "");
  }

  /**
   * Download URL for this platform's asset. With no version → GitHub's
   * `releases/latest/download` redirect; with a version → the pinned
   * `releases/download/v<version>` path.
   */
  assetUrl(version?: string): string {
    const asset = ReleaseInstaller.assetName(ReleaseInstaller.platformSlug());
    if (!version) {
      return `https://github.com/${REPO}/releases/latest/download/${asset}`;
    }
    const tag = `v${ReleaseInstaller.normalizeVersion(version)}`;
    return `https://github.com/${REPO}/releases/download/${tag}/${asset}`;
  }

  // ===========================================================================
  // GitHub metadata
  // ===========================================================================

  /** Resolve the latest published release version (without leading `v`). */
  async resolveLatestVersion(): Promise<string> {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: this.githubHeaders(),
    });
    if (!res.ok) {
      throw new ReleaseInstallError(
        `Could not resolve the latest release (GitHub API HTTP ${res.status}). ` +
          `Pass --version <v> to install a specific release, or set GH_TOKEN to raise the rate limit.`
      );
    }
    const data = (await res.json()) as { tag_name?: string };
    if (!data.tag_name) {
      throw new ReleaseInstallError("Latest release has no tag_name — cannot resolve a version.");
    }
    return ReleaseInstaller.normalizeVersion(data.tag_name);
  }

  /** Recent releases, newest-first, capped at `limit`. */
  async listReleases(limit: number = DEFAULT_LIST_LIMIT): Promise<ReleaseSummary[]> {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=${limit}`, {
      headers: this.githubHeaders(),
    });
    if (!res.ok) {
      throw new ReleaseInstallError(
        `Could not list releases (GitHub API HTTP ${res.status}). ` +
          `Set GH_TOKEN to raise the rate limit.`
      );
    }
    const data = (await res.json()) as Array<{ tag_name?: string; published_at?: string | null }>;
    return data
      .filter((r): r is { tag_name: string; published_at?: string | null } => !!r.tag_name)
      .map((r) => ({
        version: ReleaseInstaller.normalizeVersion(r.tag_name),
        tag: r.tag_name,
        publishedAt: r.published_at ?? null,
      }));
  }

  /**
   * Version of the currently-installed bundle (normalized, no leading `v`), or
   * null if it can't be determined. Delegates to the shared bundle-version
   * reader so this and DflUpgradeDetector can't drift.
   */
  readInstalledVersion(): string | null {
    const raw = readInstalledBundleVersion(path.join(this.installDir, "cli.js"));
    return raw ? ReleaseInstaller.normalizeVersion(raw) : null;
  }

  // ===========================================================================
  // Install (the frozen lifecycle)
  // ===========================================================================

  /**
   * Phase 1: install the target release into `~/.dfl/install` and rewrite the
   * launcher. No-op (returns `changed: false`, downloads nothing) when the
   * installed bundle is already on the target version.
   *
   * @param opts.version specific version to install; omit for the latest.
   */
  async installRelease(opts: { version?: string } = {}): Promise<InstallResult> {
    if (process.platform === "win32") {
      throw new ReleaseInstallError(
        "`dfl update` does not support Windows yet — re-run the install.ps1 installer to update."
      );
    }

    // Resolve target up front so the no-op check has a concrete version to
    // compare. A pinned --version needs no API call; latest does.
    const target = opts.version
      ? ReleaseInstaller.normalizeVersion(opts.version)
      : await this.resolveLatestVersion();

    const installed = this.readInstalledVersion();
    if (installed && installed === target) {
      return { version: target, changed: false };
    }

    // Always download via the concrete tag (not the floating latest redirect)
    // so the bytes match the version we just resolved — no race with a release
    // published between resolve and download.
    const url = this.assetUrl(target);
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "dfl-update-"));
    try {
      const assetName = ReleaseInstaller.assetName(ReleaseInstaller.platformSlug());
      const archivePath = path.join(tmpDir, assetName);
      const bytes = await this.download(url);
      writeFileSync(archivePath, bytes);
      await this.verifyChecksum(url, bytes, assetName);
      await this.extractInstall(archivePath);
      await this.writeLauncher();
      return { version: target, changed: true };
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  /** GitHub API headers (User-Agent is required; token avoids rate limits when present). */
  private githubHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "dev-workflow-cli",
    };
    const token = process.env["GH_TOKEN"] ?? process.env["GITHUB_TOKEN"];
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    return headers;
  }

  /** Download a URL into a Buffer, failing loudly on a non-2xx response. */
  private async download(url: string): Promise<Buffer> {
    const res = await fetch(url);
    if (!res.ok) {
      throw new ReleaseInstallError(`Download failed: ${url} (HTTP ${res.status})`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  /**
   * Verify the asset's SHA-256 against the published `<asset>.sha256` sidecar.
   * Best-effort to match install.sh: a missing sidecar is tolerated (older
   * releases), but a present-and-mismatched checksum is fatal.
   */
  private async verifyChecksum(url: string, bytes: Buffer, assetName: string): Promise<void> {
    let res: Response;
    try {
      res = await fetch(`${url}.sha256`);
    } catch {
      return; // network hiccup fetching the sidecar — skip, like install.sh
    }
    if (!res.ok) {
      return; // no published checksum for this asset
    }
    const expected = (await res.text()).trim().split(/\s+/)[0];
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (expected !== actual) {
      throw new ReleaseInstallError(
        `Checksum mismatch for ${assetName} — corrupt or incomplete download; retry.`
      );
    }
  }

  /**
   * Apply the tarball to `~/.dfl/install`, replacing only `install/` and leaving
   * sibling data (`track/`) untouched.
   *
   * Crash-safe, unlike install.sh's rm-then-extract: a failed/partial extract
   * must never leave the user without a working `dfl` (update runs OVER a live
   * install). So we extract into a staging dir on the SAME filesystem, verify
   * the bundle is intact, then atomically rename the new tree into place —
   * restoring the previous install if the swap itself fails. The archive's
   * single top-level dir is `install`, so extracting into staging yields
   * `staging/install`.
   */
  private async extractInstall(archivePath: string): Promise<void> {
    await this.fileSystem.mkdir(this.dflDir, { recursive: true });
    // Staging + backup live under dflDir so every rename is intra-filesystem
    // (cross-device renames throw EXDEV). pid-suffixed to avoid clobbering a
    // concurrent run.
    const staging = path.join(this.dflDir, `.install-staging-${process.pid}`);
    const backup = path.join(this.dflDir, `.install-backup-${process.pid}`);
    rmSync(staging, { recursive: true, force: true });
    rmSync(backup, { recursive: true, force: true });
    await this.fileSystem.mkdir(staging, { recursive: true });

    try {
      try {
        execFileSync("tar", ["-xzf", archivePath, "-C", staging], { stdio: "ignore" });
      } catch (error) {
        throw new ReleaseInstallError(`Failed to extract ${path.basename(archivePath)}`, error);
      }
      const stagedInstall = path.join(staging, "install");
      if (!(await this.fileSystem.exists(path.join(stagedInstall, "cli.js")))) {
        throw new ReleaseInstallError(
          "Extracted artifact is missing install/cli.js — aborting (install left unchanged)."
        );
      }

      // Atomic swap: move the old install aside, move the new one in, drop the
      // backup. If the second rename fails, restore the backup so a working
      // install always remains.
      const hadInstall = await this.fileSystem.exists(this.installDir);
      if (hadInstall) {
        renameSync(this.installDir, backup);
      }
      try {
        renameSync(stagedInstall, this.installDir);
      } catch (error) {
        if (hadInstall) {
          renameSync(backup, this.installDir);
        }
        throw new ReleaseInstallError("Failed to swap in the new install directory", error);
      }
    } finally {
      rmSync(staging, { recursive: true, force: true });
      rmSync(backup, { recursive: true, force: true });
    }
  }

  /**
   * Write the `dfl` launcher with the absolute cli.js path. A symlink to the
   * bundled wrapper would break (the wrapper derives its dir from $0), so we
   * write an explicit exec — identical to install.sh.
   */
  private async writeLauncher(): Promise<void> {
    await this.fileSystem.mkdir(this.binDir, { recursive: true });
    const launcher = path.join(this.binDir, "dfl");
    await this.fileSystem.writeFile(
      launcher,
      `#!/bin/sh\nexec node "${path.join(this.installDir, "cli.js")}" "$@"\n`
    );
    chmodSync(launcher, 0o755);
  }
}
