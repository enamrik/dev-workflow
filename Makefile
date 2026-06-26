# Global installation support
SHELL := /bin/bash
PNPM_HOME ?= $(HOME)/Library/pnpm
export PNPM_HOME
export PATH := $(PNPM_HOME):$(PATH)
DEV_WORKFLOW := $(PNPM_HOME)/dfl

.PHONY: help install build clean reset init dogfood test test-ai test-npm-install test-mcp test-e2e link unlink flatten-migrations ui ui-dev ui-stop local-track ui-dev-local worktree-setup prep

help:
	@echo "dev-workflow - Makefile commands"
	@echo ""
	@echo "Available commands:"
	@echo "  make install          - Install all dependencies"
	@echo "  make build            - Build all packages"
	@echo "  make clean            - Clean build artifacts"
	@echo "  make link             - Install dev-workflow globally (for testing in other repos)"
	@echo "  make unlink           - Uninstall global dev-workflow"
	@echo "  make reset            - Uninstall dev-workflow (run 'dfl uninit')"
	@echo "  make init             - Initialize dev-workflow in this repository"
	@echo "  make dogfood          - Build + link + update + restart MCP server"
	@echo "  make test             - Run unit tests"
	@echo "  make test-e2e         - Run E2E tests (requires Claude CLI)"
	@echo "  make test-ai          - Run AI-driven E2E tests (costs money, uses Claude API)"
	@echo "  make prep             - Run all checks before pushing (typecheck, lint, format, tests)"
	@echo "  make test-npm-install - Test npm install scenario (simulates user install)"
	@echo "  make test-mcp         - Test MCP server startup and migrations"
	@echo "  make flatten-migrations - Delete all migrations and regenerate (dev only)"
	@echo "  make ui               - Restart UI server (rebuild + restart)"
	@echo "  make ui-dev           - Start UI in dev mode with hot reload"
	@echo "  make ui-stop          - Stop running UI server"
	@echo "  make local-track      - Set up local .track/ for isolated testing"
	@echo "  make ui-dev-local     - Start UI dev mode with local data"
	@echo "  make worktree-setup   - Ensure worktree has deps installed and packages built"

install:
	@echo "📦 Installing dependencies..."
	pnpm install

build:
	@echo "🔨 Building all packages..."
	pnpm build

clean:
	@echo "🧹 Cleaning build artifacts..."
	pnpm --filter @dev-workflow/cli clean
	pnpm --filter @dev-workflow/mcp-server clean

link: build
	@echo "🔗 Linking dev-workflow globally for development..."
	@# Remove any stale global references first (prevents ENOENT errors from old tarballs)
	@pnpm remove -g @dev-workflow/mcp-server @dev-workflow/cli 2>/dev/null || true
	@cd apps/mcp-server && pnpm link --global
	@cd apps/cli && pnpm link --global
	@echo "✓ dfl is now linked globally"
	@echo ""
	@if ! command -v dfl >/dev/null 2>&1; then \
		echo "⚠️  dfl is NOT in your PATH yet!"; \
		echo ""; \
		echo "To fix this, add these lines to your ~/.zshrc (or ~/.bashrc):"; \
		echo ""; \
		echo '  export PNPM_HOME="$(PNPM_HOME)"'; \
		echo '  export PATH="$$PNPM_HOME:$$PATH"'; \
		echo ""; \
		echo "Then run: source ~/.zshrc"; \
		echo ""; \
		echo "Or run pnpm setup to do this automatically:"; \
		echo "  pnpm setup && source ~/.zshrc"; \
		echo ""; \
		echo "Until then, use the full path:"; \
		echo "  $(DEV_WORKFLOW) init"; \
		echo "  $(DEV_WORKFLOW) ui"; \
	else \
		echo "✓ dfl is available on your PATH!"; \
		echo ""; \
		echo "You can now use these commands anywhere:"; \
		echo "  dfl init"; \
		echo "  dfl ui"; \
	fi

unlink:
	@echo "🔓 Uninstalling global dfl..."
	@pnpm remove -g @dev-workflow/cli || true
	@echo "✓ Global dfl removed"

reset:
	@$(DEV_WORKFLOW) uninit || true

init: link
	@echo "🚀 Initializing dev-workflow in current repository..."
	@$(DEV_WORKFLOW) init
	@echo ""
	@echo "✨ Setup complete!"
	@echo ""
	@echo "Next steps:"
	@echo "  1. Open Claude Code in this repository"
	@echo "  2. Say: 'Show me issue #1'"
	@echo "  3. Start using dev-workflow to build dev-workflow!"
	@echo "  4. Or run '$(DEV_WORKFLOW) ui' to open the web UI"

dogfood: install
	@echo "🧹 Clearing Next.js cache..."
	@rm -rf apps/web/.next
	@$(MAKE) build
	@$(MAKE) link
	@echo ""
	@echo "🚀 Initializing dev-workflow..."
	@$(DEV_WORKFLOW) init
	@echo "🔄 Updating dev-workflow installation..."
	@$(DEV_WORKFLOW) update
	@echo ""
	@echo "🔄 Restarting MCP server (if running)..."
	@-pkill -f "dev-workflow.*mcp" 2>/dev/null || true
	@echo "✓ MCP server will restart automatically on next tool call"
	@echo ""
	@echo "🐕 Ready to dogfood! You can now use dfl anywhere on this machine."
	@echo ""
	@echo "Try these commands:"
	@echo "  dfl --help      - See all available commands"
	@echo "  dfl ui          - Start the web UI"
	@echo "  cd /path/to/other/repo && dfl init  - Use in other repos"

test:
	@echo "🧪 Running tests..."
	pnpm test

test-npm-install:
	@echo "🧪 Testing npm install scenario..."
	@./scripts/test-npm-install.sh

test-mcp:
	@./scripts/test-mcp-server.sh

e2e-sandbox: build
	@echo "🧪 Sandbox smoke test: install + global MCP cwd-resolution in an isolated temp home..."
	@node scripts/e2e-sandbox.mjs

test-e2e: build
	@echo "🧪 Running E2E tests (requires Claude CLI)..."
	@cd packages/e2e && pnpm test:e2e

test-ai: build
	@echo "🤖 Running AI-driven E2E tests (costs money!)..."
	@echo "   Uses Claude API to test full user flows via natural language"
	@cd packages/e2e && pnpm test:ai

# Pre-push validation: runs all checks before pushing to remote
# Fails fast on first error - no point continuing if typecheck fails
prep:
	@echo "🔍 Running pre-push validation..."
	@echo ""
	@echo "Step 1/6: Type checking..."
	@pnpm typecheck
	@echo ""
	@echo "Step 2/6: Linting..."
	@pnpm lint
	@echo ""
	@echo "Step 3/6: Format checking..."
	@pnpm format:check
	@echo ""
	@echo "Step 4/6: Unit tests..."
	@pnpm test
	@echo ""
	@echo "Step 5/6: Integration tests..."
	@pnpm test:integration
	@echo ""
	@echo "Step 6/6: E2E tests... (skipped - run 'make test-e2e' separately)"
	@# @pnpm test:e2e
	@echo ""
	@echo "✅ All checks passed! Ready to push."

flatten-migrations:
	@./scripts/flatten-migrations.sh

ui-stop:
	@echo "🛑 Stopping UI server..."
	@-lsof -ti :3456 | xargs kill 2>/dev/null || true
	@echo "✓ UI server stopped"

ui: ui-stop build
	@echo "🚀 Starting UI server..."
	@$(DEV_WORKFLOW) ui

ui-dev:
	@-lsof -ti :3457 | xargs kill 2>/dev/null || true
	@echo "🧹 Clearing Next.js cache..."
	@rm -rf apps/web/.next apps/web/node_modules/.cache
	@echo "🔥 Starting UI in dev mode (hot reload enabled)..."
	@echo "   http://localhost:3457"
	@(cd apps/web && npx wait-on tcp:3457 && open http://localhost:3457) &
	@pnpm --filter @dev-workflow/web dev

local-track:
	@./scripts/local-track.sh

# Ensure worktree is ready for development (deps installed, packages built)
worktree-setup:
	@echo "📦 Ensuring dependencies are up to date..."
	@pnpm install
	@if [ ! -d "packages/tracking/dist" ]; then \
		echo "🔨 Building packages..."; \
		pnpm build; \
	fi

ui-dev-local: worktree-setup local-track
	@./scripts/ui-dev-local.sh
