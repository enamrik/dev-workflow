/**
 * DflUpgradeDetector — version-compare decision logic + mtime-gated detection.
 *
 * The decision the worker hangs its self-restart on must be precise: restart
 * only when a concrete installed version strictly differs from the running one,
 * never thrash on equal versions, and never exec node on every idle poll tick.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { DflUpgradeDetector } from "../dfl-upgrade-detector.js";

describe("DflUpgradeDetector.isUpgrade (pure decision)", () => {
  it("is true only when the installed version strictly differs", () => {
    expect(DflUpgradeDetector.isUpgrade("1.0.0", "2.0.0")).toBe(true);
    expect(DflUpgradeDetector.isUpgrade("0.0.0-dev+gabc123", "0.0.0-dev+gdef456")).toBe(true);
  });

  it("is false when the versions match (no thrash / no restart loop)", () => {
    expect(DflUpgradeDetector.isUpgrade("1.0.0", "1.0.0")).toBe(false);
    expect(DflUpgradeDetector.isUpgrade("0.0.0-dev+gabc123", "0.0.0-dev+gabc123")).toBe(false);
  });

  it("is false when the installed version can't be read (null/empty)", () => {
    expect(DflUpgradeDetector.isUpgrade("1.0.0", null)).toBe(false);
    expect(DflUpgradeDetector.isUpgrade("1.0.0", "")).toBe(false);
  });
});

describe("DflUpgradeDetector.detectUpgrade (mtime-gated, execs the bundle)", () => {
  let installDir: string;
  let cliPath: string;

  /** Write a fake cli.js that prints `version` regardless of args. */
  const writeBundle = (version: string): void => {
    writeFileSync(cliPath, `process.stdout.write(${JSON.stringify(version)} + "\\n");\n`);
  };

  /** Push the bundle's mtime into the future so the gate sees a change. */
  const bumpMtime = (): void => {
    const future = statSync(cliPath).mtimeMs / 1000 + 100;
    utimesSync(cliPath, future, future);
  };

  beforeEach(() => {
    installDir = mkdtempSync(path.join(tmpdir(), "dfl-upgrade-"));
    cliPath = path.join(installDir, "cli.js");
  });

  afterEach(() => {
    rmSync(installDir, { recursive: true, force: true });
  });

  it("returns null when there is no installed bundle to compare against", () => {
    const detector = new DflUpgradeDetector("1.0.0", installDir);
    expect(detector.detectUpgrade()).toBeNull();
  });

  it("returns null when the bundle is unchanged since construction (no exec)", () => {
    writeBundle("2.0.0");
    const detector = new DflUpgradeDetector("1.0.0", installDir);
    // Even though 2.0.0 !== 1.0.0, the mtime hasn't advanced past the baseline,
    // so the gate skips the exec entirely.
    expect(detector.detectUpgrade()).toBeNull();
  });

  it("detects a differing installed version once the bundle is rewritten", () => {
    writeBundle("1.0.0");
    const detector = new DflUpgradeDetector("1.0.0", installDir);

    writeBundle("2.0.0");
    bumpMtime();

    expect(detector.detectUpgrade()).toEqual({ from: "1.0.0", to: "2.0.0" });
  });

  it("does not restart when the rewritten bundle is the same version", () => {
    writeBundle("1.0.0");
    const detector = new DflUpgradeDetector("1.0.0", installDir);

    writeBundle("1.0.0"); // re-install of the same version (e.g. dogfood, no change)
    bumpMtime();

    expect(detector.detectUpgrade()).toBeNull();
  });

  it("consumes a change so it does not re-exec on the next tick (no thrash)", () => {
    writeBundle("1.0.0");
    const detector = new DflUpgradeDetector("1.0.0", installDir);

    writeBundle("2.0.0");
    bumpMtime();

    expect(detector.detectUpgrade()).toEqual({ from: "1.0.0", to: "2.0.0" });
    // Second call without any further on-disk change → gated out, returns null.
    expect(detector.detectUpgrade()).toBeNull();
  });
});
