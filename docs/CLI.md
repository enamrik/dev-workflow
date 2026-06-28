# CLI Reference

> This guide is part of the [dev-workflow documentation](../README.md).

Command-line interface documentation for dev-workflow.

_Documentation coming soon - see [Issue #162](https://github.com/enamrik/dev-workflow/issues/162) for progress._

## Commands

- `dfl init` - Initialize project
- `dfl mcp` - Start MCP server
- `dfl ui` - Start Web UI server
- `dfl worker` - Run as background worker
- `dfl update` - Apply database migrations
- `dfl github-identity [user]` - Set or show the GitHub account this repo uses for push/PR (per-project, no global `gh auth switch`)

### `dfl github-identity [user]`

Sets (or, with no argument, shows) the `gh` account dev-workflow uses for **this
repo's** `git push` and PR creation. Run with no argument to print the current
value; pass a `gh` username to set it.

```bash
dfl github-identity                 # show the configured account (or "none")
dfl github-identity enamrik         # use the `enamrik` account for this repo
```

The identity is stored in `.git/config` as `dev-workflow.githubUser` and applied
**per command** via a token — dev-workflow never runs a global `gh auth switch`,
so two repos configured for different accounts never clobber each other. See
[GitHub Integration → Per-project GitHub identity](GITHUB_INTEGRATION.md#per-project-github-identity).
