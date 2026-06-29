/**
 * ReleaseInstaller — phase 1 of `dfl update`.
 *
 * Covers the hot spot (version resolution: latest vs --version, asset URLs),
 * the already-on-target no-op (downloads nothing), and GitHub metadata reads.
 * Pure logic is tested directly; the installed-version read uses a real temp
 * bundle (like dfl-upgrade-detector.test.ts) and network calls stub `fetch`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { ReleaseInstaller } from "../release-installer.js";
import { NodeFileSystem, type FileSystem } from "../../infrastructure/file-system.js";

function createMockFileSystem(): FileSystem {
  return {
    exists: vi.fn().mockResolvedValue(false),
    readFile: vi.fn().mockResolvedValue(""),
    writeFile: vi.fn().mockResolvedValue(undefined),
    rmFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
    rmdir: vi.fn().mockResolvedValue(undefined),
    readdirWithFileTypes: vi.fn().mockResolvedValue([]),
    copyDirectory: vi.fn().mockResolvedValue(undefined),
    copyFile: vi.fn().mockResolvedValue(undefined),
  } as unknown as FileSystem;
}

describe("ReleaseInstaller.platformSlug (pure)", () => {
  it("maps supported platform/arch to the asset slug", () => {
    expect(ReleaseInstaller.platformSlug("darwin", "arm64")).toBe("darwin-arm64");
    expect(ReleaseInstaller.platformSlug("darwin", "x64")).toBe("darwin-x64");
    expect(ReleaseInstaller.platformSlug("linux", "x64")).toBe("linux-x64");
    expect(ReleaseInstaller.platformSlug("linux", "arm64")).toBe("linux-arm64");
    expect(ReleaseInstaller.platformSlug("win32", "x64")).toBe("windows-x64");
  });

  it("throws on an unsupported OS or arch", () => {
    expect(() => ReleaseInstaller.platformSlug("aix" as NodeJS.Platform, "x64")).toThrow();
    expect(() => ReleaseInstaller.platformSlug("linux", "ppc64")).toThrow();
  });
});

describe("ReleaseInstaller.assetName (pure)", () => {
  it("uses tar.gz for unix slugs and zip for windows", () => {
    expect(ReleaseInstaller.assetName("darwin-arm64")).toBe("dev-workflow-darwin-arm64.tar.gz");
    expect(ReleaseInstaller.assetName("linux-x64")).toBe("dev-workflow-linux-x64.tar.gz");
    expect(ReleaseInstaller.assetName("windows-x64")).toBe("dev-workflow-windows-x64.zip");
  });
});

describe("ReleaseInstaller.normalizeVersion (pure)", () => {
  it("strips a leading v and trims", () => {
    expect(ReleaseInstaller.normalizeVersion("v1.2.3")).toBe("1.2.3");
    expect(ReleaseInstaller.normalizeVersion("1.2.3")).toBe("1.2.3");
    expect(ReleaseInstaller.normalizeVersion(" v1.2.3\n")).toBe("1.2.3");
  });
});

describe("ReleaseInstaller.assetUrl (version resolution)", () => {
  const installer = new ReleaseInstaller(createMockFileSystem());

  it("uses the latest redirect when no version is given", () => {
    const url = installer.assetUrl();
    expect(url).toContain("/releases/latest/download/");
    expect(url).toContain("dev-workflow-");
  });

  it("uses the pinned tag path when a version is given", () => {
    const slug = ReleaseInstaller.platformSlug();
    const asset = ReleaseInstaller.assetName(slug);
    expect(installer.assetUrl("1.2.3")).toBe(
      `https://github.com/enamrik/dev-workflow/releases/download/v1.2.3/${asset}`
    );
  });

  it("normalizes a leading v in the version", () => {
    expect(installer.assetUrl("v9.9.9")).toContain("/releases/download/v9.9.9/");
  });
});

describe("ReleaseInstaller GitHub metadata (fetch stubbed)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolveLatestVersion reads tag_name and strips the v", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ tag_name: "v3.4.5" }) })
    );
    const installer = new ReleaseInstaller(createMockFileSystem());
    await expect(installer.resolveLatestVersion()).resolves.toBe("3.4.5");
  });

  it("resolveLatestVersion throws on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    const installer = new ReleaseInstaller(createMockFileSystem());
    await expect(installer.resolveLatestVersion()).rejects.toThrow(/GitHub API HTTP 403/);
  });

  it("listReleases returns newest-first summaries, skipping entries without a tag", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          { tag_name: "v2.0.0", published_at: "2026-01-02T00:00:00Z" },
          { tag_name: "v1.0.0", published_at: null },
          { published_at: "2025-01-01T00:00:00Z" },
        ],
      })
    );
    const installer = new ReleaseInstaller(createMockFileSystem());
    const releases = await installer.listReleases(5);
    expect(releases).toEqual([
      { version: "2.0.0", tag: "v2.0.0", publishedAt: "2026-01-02T00:00:00Z" },
      { version: "1.0.0", tag: "v1.0.0", publishedAt: null },
    ]);
  });
});

describe("ReleaseInstaller installed-version read + no-op", () => {
  let installRoot: string;
  let prevInstallDir: string | undefined;

  /** Write a fake bundle that prints `version` for any args (incl. --version). */
  const writeBundle = (version: string): void => {
    const installDir = path.join(installRoot, "install");
    mkdirSync(installDir, { recursive: true });
    writeFileSync(
      path.join(installDir, "cli.js"),
      `process.stdout.write(${JSON.stringify(version)} + "\\n");\n`
    );
  };

  beforeEach(() => {
    installRoot = mkdtempSync(path.join(tmpdir(), "dfl-installer-"));
    prevInstallDir = process.env["DFL_INSTALL_DIR"];
    process.env["DFL_INSTALL_DIR"] = installRoot;
  });

  afterEach(() => {
    if (prevInstallDir === undefined) {
      delete process.env["DFL_INSTALL_DIR"];
    } else {
      process.env["DFL_INSTALL_DIR"] = prevInstallDir;
    }
    rmSync(installRoot, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it("readInstalledVersion returns the bundle's version (normalized)", () => {
    writeBundle("v1.5.0");
    const installer = new ReleaseInstaller(createMockFileSystem());
    expect(installer.readInstalledVersion()).toBe("1.5.0");
  });

  it("readInstalledVersion returns null when no bundle is installed", () => {
    const installer = new ReleaseInstaller(createMockFileSystem());
    expect(installer.readInstalledVersion()).toBeNull();
  });

  it("installRelease is a no-op (no download) when already on the pinned version", async () => {
    writeBundle("1.2.3");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const installer = new ReleaseInstaller(createMockFileSystem());

    const result = await installer.installRelease({ version: "1.2.3" });

    expect(result).toEqual({ version: "1.2.3", changed: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("installRelease is a no-op when already on the resolved latest version", async () => {
    writeBundle("4.0.0");
    const fetchSpy = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ tag_name: "v4.0.0" }) });
    vi.stubGlobal("fetch", fetchSpy);
    const installer = new ReleaseInstaller(createMockFileSystem());

    const result = await installer.installRelease({});

    expect(result).toEqual({ version: "4.0.0", changed: false });
    // Only the metadata call happened — no asset download.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("ReleaseInstaller installRelease lifecycle (real tarball + atomic swap)", () => {
  let dflDir: string;
  let binDir: string;
  let archiveBytes: Buffer;
  let archiveSha: string;
  let assetName: string;
  let prevInstallDir: string | undefined;
  let prevBinDir: string | undefined;

  /** Build a real `install/cli.js` tarball stamped with `version`. */
  const buildArchive = (version: string): void => {
    const src = mkdtempSync(path.join(tmpdir(), "dfl-archive-src-"));
    mkdirSync(path.join(src, "install"), { recursive: true });
    writeFileSync(
      path.join(src, "install", "cli.js"),
      `process.stdout.write(${JSON.stringify(version)} + "\\n");\n`
    );
    const out = mkdtempSync(path.join(tmpdir(), "dfl-archive-out-"));
    const archive = path.join(out, "artifact.tar.gz");
    execFileSync("tar", ["-czf", archive, "-C", src, "install"]);
    archiveBytes = readFileSync(archive);
    archiveSha = createHash("sha256").update(archiveBytes).digest("hex");
    rmSync(src, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  };

  /** Stub fetch: asset download returns the archive bytes; `.sha256` per `sha`. */
  const stubFetch = (sha: { ok: boolean; value?: string }): void => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith(".sha256")) {
          return sha.ok
            ? { ok: true, text: async () => `${sha.value}  ${assetName}\n` }
            : { ok: false, status: 404 };
        }
        return { ok: true, arrayBuffer: async () => new Uint8Array(archiveBytes).buffer };
      })
    );
  };

  beforeEach(() => {
    dflDir = mkdtempSync(path.join(tmpdir(), "dfl-install-root-"));
    binDir = mkdtempSync(path.join(tmpdir(), "dfl-bin-"));
    prevInstallDir = process.env["DFL_INSTALL_DIR"];
    prevBinDir = process.env["DFL_BIN_DIR"];
    process.env["DFL_INSTALL_DIR"] = dflDir;
    process.env["DFL_BIN_DIR"] = binDir;
    assetName = ReleaseInstaller.assetName(ReleaseInstaller.platformSlug());
    buildArchive("1.2.3");
  });

  afterEach(() => {
    const restore = (key: string, prev: string | undefined): void => {
      if (prev === undefined) delete process.env[key];
      else process.env[key] = prev;
    };
    restore("DFL_INSTALL_DIR", prevInstallDir);
    restore("DFL_BIN_DIR", prevBinDir);
    rmSync(dflDir, { recursive: true, force: true });
    rmSync(binDir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it("downloads, extracts into install/, and writes the launcher", async () => {
    stubFetch({ ok: true, value: archiveSha });
    const installer = new ReleaseInstaller(new NodeFileSystem());

    const result = await installer.installRelease({ version: "1.2.3" });

    expect(result).toEqual({ version: "1.2.3", changed: true });
    expect(existsSync(path.join(dflDir, "install", "cli.js"))).toBe(true);
    const launcher = readFileSync(path.join(binDir, "dfl"), "utf-8");
    expect(launcher).toContain(`exec node "${path.join(dflDir, "install", "cli.js")}"`);
    // No staging/backup scratch dirs left behind.
    expect(existsSync(path.join(dflDir, `.install-staging-${process.pid}`))).toBe(false);
    expect(existsSync(path.join(dflDir, `.install-backup-${process.pid}`))).toBe(false);
  });

  it("tolerates a missing checksum sidecar (older releases)", async () => {
    stubFetch({ ok: false });
    const installer = new ReleaseInstaller(new NodeFileSystem());

    const result = await installer.installRelease({ version: "1.2.3" });

    expect(result.changed).toBe(true);
    expect(existsSync(path.join(dflDir, "install", "cli.js"))).toBe(true);
  });

  it("aborts on a checksum mismatch without touching the existing install", async () => {
    // Seed a prior working install that must survive a failed update.
    mkdirSync(path.join(dflDir, "install"), { recursive: true });
    writeFileSync(path.join(dflDir, "install", "cli.js"), "OLD");
    stubFetch({ ok: true, value: "deadbeef" });
    const installer = new ReleaseInstaller(new NodeFileSystem());

    await expect(installer.installRelease({ version: "1.2.3" })).rejects.toThrow(
      /Checksum mismatch/
    );
    // The old install is intact.
    expect(readFileSync(path.join(dflDir, "install", "cli.js"), "utf-8")).toBe("OLD");
  });
});
