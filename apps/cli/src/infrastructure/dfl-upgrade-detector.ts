/**
 * DflUpgradeDetector
 *
 * Owns the single domain question: "has the dfl artifact installed under
 * <DFL_HOME>/install been replaced with a version different from the one this
 * worker process is running?" A running worker consults this at a task boundary
 * to decide whether to self-restart into the freshly-installed binary, so a
 * `make dogfood` / update propagates without a manual restart.
 *
 * Where the installed version comes from: it is NOT recorded in a marker file —
 * it is baked into the installed `cli.js` bundle via the tsup `__DFL_VERSION__`
 * define (the same value `dfl --version` prints). So the only reliable read is
 * to exec the installed bundle with `--version`. To keep the worker's idle poll
 * loop cheap, that exec is gated on the bundle's mtime: it runs at most once per
 * actual install event, never on every poll tick.
 */

import { statSync } from "node:fs";
import * as path from "node:path";
import { resolveGlobalDflHome } from "@dev-workflow/git/track-directory-resolver.js";
import { readInstalledBundleVersion } from "./installed-version.js";

/** A detected transition from the running version to a different installed one. */
export interface UpgradeTransition {
  from: string;
  to: string;
}

export class DflUpgradeDetector {
  private readonly installedCliPath: string;
  private lastSeenMtimeMs: number | null;

  /**
   * @param runningVersion version string of THIS worker's build (the
   *   `__DFL_VERSION__` define surfaced by `dfl --version`).
   * @param installDir directory the launcher runs the bundle from; defaults to
   *   `<DFL_HOME>/install`. The bundle is `<installDir>/cli.js`.
   */
  constructor(
    private readonly runningVersion: string,
    installDir: string = path.join(resolveGlobalDflHome(), "install")
  ) {
    this.installedCliPath = path.join(installDir, "cli.js");
    // Baseline the bundle's mtime at construction (worker start). Any later
    // advance means the install dir was rewritten — the cheap trigger to exec.
    this.lastSeenMtimeMs = this.bundleMtimeMs();
  }

  /**
   * Pure decision: should we restart from `running` into `installed`?
   * Restart only when we can read a concrete installed version that strictly
   * differs from what we're running — never on a null/empty read (can't tell,
   * so don't gamble) and never on an equal version (guards against thrash and
   * restart loops). Kept static + pure so it can be unit-tested in isolation.
   */
  static isUpgrade(running: string, installed: string | null): boolean {
    if (!installed) {
      return false;
    }
    return installed !== running;
  }

  /**
   * Detect an available upgrade at a task boundary. Cheap: returns null without
   * exec'ing if the installed bundle's mtime hasn't advanced since the last
   * check (or there is no installed bundle to compare against — e.g. running
   * from a dev build outside the install dir). Only when the bundle was
   * rewritten does it exec `cli.js --version` and compare.
   *
   * @returns the version transition to restart into, or null when none.
   */
  detectUpgrade(): UpgradeTransition | null {
    const mtimeMs = this.bundleMtimeMs();
    if (mtimeMs === null) {
      return null;
    }
    if (this.lastSeenMtimeMs !== null && mtimeMs === this.lastSeenMtimeMs) {
      return null;
    }
    // Consume the change before reading: even if the read or compare yields no
    // upgrade (re-install of the same version, broken bundle), we won't re-exec
    // node on every subsequent tick until the bundle changes again.
    this.lastSeenMtimeMs = mtimeMs;

    const installed = this.readInstalledVersion();
    if (!DflUpgradeDetector.isUpgrade(this.runningVersion, installed)) {
      return null;
    }
    return { from: this.runningVersion, to: installed as string };
  }

  /** Read the installed bundle's version, or null if it can't be determined. */
  private readInstalledVersion(): string | null {
    return readInstalledBundleVersion(this.installedCliPath);
  }

  /** Current mtime (ms) of the installed bundle, or null if it doesn't exist. */
  private bundleMtimeMs(): number | null {
    try {
      return statSync(this.installedCliPath).mtimeMs;
    } catch {
      return null;
    }
  }
}
