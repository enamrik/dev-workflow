/**
 * `dfl github-identity [user]` — get or set this repo's per-project GitHub
 * identity.
 *
 * The identity is the `gh` account dfl uses for this repo's push/PR operations.
 * It is stored in .git/config as `dev-workflow.githubUser` (next to
 * `dev-workflow.slug`) and applied per-command via a token — dfl never runs a
 * global `gh auth switch`, so projects configured for different accounts don't
 * interfere with each other.
 *
 * Thin enough not to need DI: the read/write logic lives on GitOperations
 * (which is independently tested).
 */

import { GitOperations } from "@dev-workflow/git/operations/git-operations.js";

export interface GithubIdentityOptions {
  /** The gh account username to set. When omitted, the current value is shown. */
  user?: string;
}

export async function runGithubIdentity(options: GithubIdentityOptions): Promise<void> {
  const gitOps = new GitOperations();

  let gitRoot: string;
  try {
    // Resolve the MAIN repo root so the identity is written/read consistently
    // whether invoked from the main checkout or a worktree.
    gitRoot = gitOps.getMainRepoRoot(process.cwd());
  } catch {
    console.error("Not a git repository. Run `dfl github-identity` inside a dev-workflow project.");
    process.exit(1);
    return;
  }

  if (options.user) {
    gitOps.writeGitHubUserToGitConfig(gitRoot, options.user);
    console.log(`✓ Set GitHub identity for this repo to "${options.user}".`);
    console.log("  Stored in .git/config as dev-workflow.githubUser.");
    console.log(
      "  dfl will use this account's token (gh auth token --user) for push/PR — no global gh auth switch."
    );
    console.log(`  Make sure that account is logged in: gh auth login`);
    return;
  }

  const current = gitOps.readGitHubUserFromGitConfig(gitRoot);
  if (current) {
    console.log(current);
  } else {
    console.log("No per-project GitHub identity set; dfl uses the active gh account.");
    console.log("Set one with: dfl github-identity <gh-username>");
  }
}
