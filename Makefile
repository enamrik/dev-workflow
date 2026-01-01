# Global installation support
SHELL := /bin/bash
PNPM_HOME ?= $(HOME)/Library/pnpm
export PNPM_HOME
export PATH := $(PNPM_HOME):$(PATH)
DEV_WORKFLOW := $(PNPM_HOME)/dev-workflow

.PHONY: help install build clean reset init dogfood test test-npm-install test-mcp test-e2e link unlink flatten-migrations ui ui-dev ui-stop

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

dogfood: install build link
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
	@echo "🗑️  Flattening database migrations..."
	@rm -rf packages/core/drizzle/*
	@cd packages/core && pnpm drizzle-kit generate
	@echo "✓ Migrations regenerated from scratch"
	@echo ""
	@echo "⚠️  WARNING: This is for development only!"
	@echo "   - All existing databases will need to be recreated"
	@echo "   - Run 'make reset && make dogfood' to reset your local dev-workflow setup"
	@echo "   - Or 'make dogfood' to attempt migration (may fail if incompatible)"

ui-stop:
	@echo "🛑 Stopping UI server..."
	@-lsof -ti :3456 | xargs kill 2>/dev/null || true
	@echo "✓ UI server stopped"

ui: ui-stop build
	@echo "🚀 Starting UI server..."
	@$(DEV_WORKFLOW) ui

ui-dev:
	@echo "🔥 Starting UI in dev mode (hot reload enabled)..."
	@echo "   http://localhost:3457"
	@(cd packages/web && npx wait-on tcp:3457 && open http://localhost:3457) &
	@pnpm --filter @dev-workflow/web dev
