/**
 * Per-project GitHub identity resolution.
 *
 * dfl lets each repo declare which `gh` account to use for its push/PR
 * operations (stored in .git/config as `dev-workflow.githubUser`). This module
 * turns that configured username into a usable token WITHOUT changing the
 * globally active gh account:
 *
 *   1. read `dev-workflow.githubUser` from the repo's .git/config
 *   2. fetch that specific account's token with `gh auth token --user <user>`
 *      (gh reads it straight from its keyring; no `gh auth switch`)
 *
 * The resulting token is then passed per-command as `GH_TOKEN` to `gh` and as
 * the `x-access-token` git credential (via `gh auth git-credential`), so two
 * projects configured for different accounts never clobber each other's global
 * active account.
 */

import { execFileSync } from "node:child_process";
import { GitOperations } from "../operations/git-operations.js";

export interface GitHubIdentity {
  /** The configured `gh` account username. */
  readonly user: string;
  /** That account's token, fetched per-command (never globally switched). */
  readonly token: string;
}

/**
 * Fetches a specific gh account's token without switching the active account.
 * Injectable so tests don't need a real `gh` install or logged-in accounts.
 */
export type TokenFetcher = (user: string, hostname: string) => string | null;

/**
 * Default {@link TokenFetcher} backed by `gh auth token --user <user>`.
 * Returns null on any failure (gh missing, user not logged in, etc.) so the
 * caller can fall back to the ambient active account.
 */
export const ghAuthTokenFetcher: TokenFetcher = (user, hostname) => {
  try {
    const token = execFileSync("gh", ["auth", "token", "--user", user, "--hostname", hostname], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return token || null;
  } catch {
    return null;
  }
};

/**
 * Resolves the per-project GitHub identity for a repo. Returns null when no
 * identity is configured, or when the configured account's token cannot be
 * fetched — callers treat null as "use the ambient active gh account".
 */
export class GitHubIdentityResolver {
  constructor(
    private readonly gitOps: GitOperations = new GitOperations(),
    private readonly fetchToken: TokenFetcher = ghAuthTokenFetcher
  ) {}

  resolve(gitRoot: string, hostname = "github.com"): GitHubIdentity | null {
    const user = this.gitOps.readGitHubUserFromGitConfig(gitRoot);
    if (!user) {
      return null;
    }
    const token = this.fetchToken(user, hostname);
    if (!token) {
      return null;
    }
    return { user, token };
  }
}
