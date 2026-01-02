# Global installation support
SHELL := /bin/bash
PNPM_HOME ?= $(HOME)/Library/pnpm
export PNPM_HOME
export PATH := $(PNPM_HOME):$(PATH)
DEV_WORKFLOW := $(PNPM_HOME)/dev-workflow

.PHONY: help install build clean reset init dogfood test test-npm-install test-mcp test-e2e link unlink flatten-migrations ui ui-dev ui-stop local-track ui-dev-local

help:
	@echo "dev-workflow - Makefile commands"
	@echo ""
	@echo "Available commands:"
	@echo "  make install          - Install all dependencies"
	@echo "  make build            - Build all packages"
	@echo "  make clean            - Clean build artifacts"
	@echo "  make link             - Install dev-workflow globally (for testing in other repos)"
	@echo "  make unlink           - Uninstall global dev-workflow"
	@echo "  make reset            - Uninstall dev-workflow (run 'dev-workflow uninit')"
	@echo "  make init             - Initialize dev-workflow in this repository"
	@echo "  make dogfood          - Build + link + update (or init if first time)"
	@echo "  make test             - Run unit tests"
	@echo "  make test-e2e         - Run E2E tests (requires Claude CLI)"
	@echo "  make test-npm-install - Test npm install scenario (simulates user install)"
	@echo "  make test-mcp         - Test MCP server startup and migrations"
	@echo "  make flatten-migrations - Delete all migrations and regenerate (dev only)"
	@echo "  make ui               - Restart UI server (rebuild + restart)"
	@echo "  make ui-dev           - Start UI in dev mode with hot reload"
	@echo "  make ui-stop          - Stop running UI server"
	@echo "  make local-track      - Set up local .track/ for isolated testing"
	@echo "  make ui-dev-local     - Start UI dev mode with local data"

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
	@cd packages/mcp-server && pnpm link --global
	@cd packages/cli && pnpm link --global
	@echo "✓ dev-workflow is now linked globally"
	@echo ""
	@if ! command -v dev-workflow >/dev/null 2>&1; then \
		echo "⚠️  dev-workflow is NOT in your PATH yet!"; \
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
		echo "✓ dev-workflow is available on your PATH!"; \
		echo ""; \
		echo "You can now use these commands anywhere:"; \
		echo "  dev-workflow init"; \
		echo "  dev-workflow ui"; \
	fi

unlink:
	@echo "🔓 Uninstalling global dev-workflow..."
	@pnpm remove -g @dev-workflow/cli || true
	@echo "✓ Global dev-workflow removed"

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
	@rm -rf packages/web/.next
	@$(MAKE) build
	@$(MAKE) link
	@echo ""
	@if [ -d ".track" ]; then \
		echo "🔄 Updating existing dev-workflow installation..."; \
		$(DEV_WORKFLOW) update; \
	else \
		echo "🚀 First-time setup - initializing dev-workflow..."; \
		$(DEV_WORKFLOW) init; \
	fi
	@echo ""
	@echo "🐕 Ready to dogfood! You can now use dev-workflow anywhere on this machine."
	@echo ""
	@echo "Try these commands:"
	@echo "  dev-workflow --help      - See all available commands"
	@echo "  dev-workflow ui          - Start the web UI"
	@echo "  cd /path/to/other/repo && dev-workflow init  - Use in other repos"

test:
	@echo "🧪 Running tests..."
	pnpm test

test-npm-install:
	@echo "🧪 Testing npm install scenario..."
	@./scripts/test-npm-install.sh

test-mcp:
	@./scripts/test-mcp-server.sh

test-e2e: build
	@echo "🧪 Running E2E tests (requires Claude CLI)..."
	@cd packages/e2e && pnpm test:e2e

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
	@echo "🔥 Starting UI in dev mode (hot reload enabled)..."
	@echo "   http://localhost:3457"
	@(cd packages/web && npx wait-on tcp:3457 && open http://localhost:3457) &
	@pnpm --filter @dev-workflow/web dev

# Compute project ID from git root (matches TrackDirectoryResolver logic)
# Format: <folder-name>-<6-char-sha256-hash>
# Uses git-common-dir to get the main repo path even when in a worktree
define GET_GIT_ROOT
$(shell dirname "$$(git rev-parse --path-format=absolute --git-common-dir)")
endef

define GET_PROJECT_ID
$(shell basename "$(GET_GIT_ROOT)")-$(shell printf '%s' "$(GET_GIT_ROOT)" | shasum -a 256 | cut -c1-6)
endef

local-track:
	@echo "📁 Setting up local .track/ directory for isolated testing..."
	@if [ ! -d "$$HOME/.track" ]; then \
		echo "❌ Error: ~/.track does not exist. Run 'dev-workflow init' first."; \
		exit 1; \
	fi
	@if [ ! -f "$$HOME/.track/workflow.db" ]; then \
		echo "❌ Error: ~/.track/workflow.db does not exist. Run 'dev-workflow init' first."; \
		exit 1; \
	fi
	@PROJECT_ID=$(GET_PROJECT_ID); \
	echo "   Project ID: $$PROJECT_ID"; \
	mkdir -p .track; \
	if [ -f "$$HOME/.track/workflow.db" ]; then \
		echo "   Copying workflow.db..."; \
		cp "$$HOME/.track/workflow.db" .track/workflow.db; \
	fi; \
	if [ -d "$$HOME/.track/$$PROJECT_ID" ]; then \
		echo "   Copying project config..."; \
		cp -R "$$HOME/.track/$$PROJECT_ID" .track/; \
	else \
		echo "⚠️  Warning: No project config found at ~/.track/$$PROJECT_ID"; \
	fi
	@echo ""
	@echo "✓ Local .track/ directory created!"
	@echo ""
	@echo "To use local data, set the TRACK_DIR environment variable:"
	@echo ""
	@echo "  export TRACK_DIR=$$(pwd)/.track"
	@echo ""
	@echo "Examples:"
	@echo "  TRACK_DIR=.track dev-workflow ui           # Start UI with local data"
	@echo "  TRACK_DIR=.track pnpm --filter @dev-workflow/web dev  # Dev mode"
	@echo ""
	@echo "Or use 'make ui-dev-local' for convenience."

ui-dev-local: local-track
	@-lsof -ti :3457 | xargs kill 2>/dev/null || true
	@echo "🔥 Starting UI in dev mode with local data..."
	@echo "   http://localhost:3457"
	@echo "   Using: TRACK_DIR=$$(pwd)/.track"
	@(cd packages/web && npx wait-on tcp:3457 && open http://localhost:3457) &
	@TRACK_DIR=$$(pwd)/.track pnpm --filter @dev-workflow/web dev
