import { execFileSync } from "node:child_process";

/**
 * Read the version a bundled `cli.js` self-reports via `--version`, or null if
 * it can't be determined (no install yet / broken bundle).
 *
 * The installed version is NOT recorded in a marker file — it is baked into the
 * bundle via the tsup `__DFL_VERSION__` define (the same value `dfl --version`
 * prints). So the only reliable read is to exec the bundle. Returns the raw
 * trimmed string; callers normalize (e.g. strip a leading `v`) as they need.
 *
 * Single source of truth for "what version is the installed bundle?" — shared
 * by DflUpgradeDetector (worker self-restart) and ReleaseInstaller (`dfl update`
 * no-op check) so the two can't drift.
 */
export function readInstalledBundleVersion(cliPath: string): string | null {
  try {
    const out = execFileSync(process.execPath, [cliPath, "--version"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const version = out.trim();
    return version.length > 0 ? version : null;
  } catch {
    return null;
  }
}
