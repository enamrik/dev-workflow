/**
 * Tests for GitHubIdentityResolver.
 *
 * The resolver maps a repo's configured `dev-workflow.githubUser` to that
 * account's token WITHOUT switching the active gh account. Both collaborators
 * (the .git/config read and the `gh auth token` fetch) are injected so these
 * tests need neither a real gh install nor logged-in accounts.
 */

import { describe, it, expect, vi } from "vitest";
import { GitOperations } from "../../operations/git-operations.js";
import { GitHubIdentityResolver, type TokenFetcher } from "../github-identity.js";

function gitOpsReturning(user: string | null): GitOperations {
  const ops = new GitOperations();
  vi.spyOn(ops, "readGitHubUserFromGitConfig").mockReturnValue(user);
  return ops;
}

describe("GitHubIdentityResolver.resolve", () => {
  it("returns null when no per-project user is configured (fall back to active account)", () => {
    const fetchToken = vi.fn<TokenFetcher>();
    const resolver = new GitHubIdentityResolver(gitOpsReturning(null), fetchToken);

    expect(resolver.resolve("/repo")).toBeNull();
    expect(fetchToken).not.toHaveBeenCalled();
  });

  it("resolves the configured user's token without switching accounts", () => {
    const fetchToken: TokenFetcher = vi.fn().mockReturnValue("gho_abc123");
    const resolver = new GitHubIdentityResolver(gitOpsReturning("enamrik"), fetchToken);

    expect(resolver.resolve("/repo")).toEqual({ user: "enamrik", token: "gho_abc123" });
    expect(fetchToken).toHaveBeenCalledWith("enamrik", "github.com");
  });

  it("passes a custom hostname through to the token fetcher", () => {
    const fetchToken: TokenFetcher = vi.fn().mockReturnValue("gho_ent");
    const resolver = new GitHubIdentityResolver(gitOpsReturning("enamrik"), fetchToken);

    resolver.resolve("/repo", "github.acme.com");
    expect(fetchToken).toHaveBeenCalledWith("enamrik", "github.acme.com");
  });

  it("returns null when the configured account's token cannot be fetched", () => {
    // e.g. that account isn't logged in — caller falls back to the active account.
    const fetchToken: TokenFetcher = vi.fn().mockReturnValue(null);
    const resolver = new GitHubIdentityResolver(gitOpsReturning("not-logged-in"), fetchToken);

    expect(resolver.resolve("/repo")).toBeNull();
  });
});
