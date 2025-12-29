.PHONY: help install build clean reset init dogfood test test-npm-install

help:
	@echo "dev-workflow - Makefile commands"
	@echo ""
	@echo "Available commands:"
	@echo "  make install          - Install all dependencies"
	@echo "  make build            - Build all packages"
	@echo "  make clean            - Clean build artifacts"
	@echo "  make reset            - Uninstall dev-workflow (run 'dev-workflow uninit')"
	@echo "  make init             - Initialize dev-workflow in this repository"
	@echo "  make dogfood          - Full reset + build + init (start dogfooding)"
	@echo "  make test             - Run all tests"
	@echo "  make test-npm-install - Test npm install scenario (simulates user install)"

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

reset:
	@node packages/cli/dist/index.js uninit || true

init: build
	@echo "🚀 Initializing dev-workflow in current repository..."
	node packages/cli/dist/index.js init
	@echo ""
	@echo "✨ Dogfooding setup complete!"
	@echo ""
	@echo "Next steps:"
	@echo "  1. Open Claude Code in this repository"
	@echo "  2. Say: 'Show me issue #1'"
	@echo "  3. Start using dev-workflow to build dev-workflow!"

dogfood: reset install build init
	@echo ""
	@echo "🐕 Ready to dogfood! You can now use dev-workflow to develop dev-workflow."

test:
	@echo "🧪 Running tests..."
	pnpm test

test-npm-install:
	@echo "🧪 Testing npm install scenario..."
	@./scripts/test-npm-install.sh
