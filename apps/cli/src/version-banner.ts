/**
 * Version banner — prints a one-line version marker to stderr on every CLI
 * invocation so it's always obvious which build of dfl is running
 * (e.g. `dfl 1.5.0` vs `dfl 0.0.0-dev`).
 */

// Verbs that own their own output and must NOT be prefixed with a banner:
// `version`/`--version`/`-V` already print the version; `mcp` is the stdio
// JSON-RPC server (its stdout is the protocol stream and stderr is the server
// log — keep both uncluttered); help output is left clean too.
const BANNER_SUPPRESSED_VERBS = new Set([
  "version",
  "--version",
  "-V",
  "mcp",
  "help",
  "--help",
  "-h",
]);

/**
 * Decide whether the version banner should print for the given verb.
 * Returns false for `undefined` (bare invocation) and for the suppress-set;
 * true for any other verb.
 */
export function shouldPrintVersionBanner(verb: string | undefined): boolean {
  if (verb === undefined) {
    return false;
  }
  return !BANNER_SUPPRESSED_VERBS.has(verb);
}

/**
 * Print a one-line version banner to stderr unless the verb owns its own
 * output. stderr-only so stdout stays clean for piping/scripting. `verb`
 * defaults to `process.argv[2]` (the CLI verb).
 */
export function printVersionBanner(
  version: string,
  verb: string | undefined = process.argv[2]
): void {
  if (shouldPrintVersionBanner(verb)) {
    process.stderr.write(`dfl ${version}\n`);
  }
}
