import { describe, it, expect, vi, afterEach } from "vitest";
import { asValue } from "awilix";
import { createTestContainer } from "./test-helpers.js";
import { createTestCliCommand } from "../../di/bootstrap.js";
import { handleCleanClaudeConfig } from "../claude-config-command-def.js";
import type { ClaudeConfigCommand } from "../claude-config-command.js";

describe("claude-config-command-def", () => {
  let container: ReturnType<typeof createTestContainer>;

  afterEach(async () => {
    vi.clearAllMocks();
    if (container) {
      await container.dispose();
    }
  });

  describe("handleCleanClaudeConfig", () => {
    it("should call claudeConfigCommand.clean with options when executed", async () => {
      container = createTestContainer();

      const mockClaudeConfigCommand = {
        clean: vi.fn().mockResolvedValue(undefined),
      };

      container.register({
        claudeConfigCommand: asValue(mockClaudeConfigCommand as unknown as ClaudeConfigCommand),
      });

      const runCleanClaudeConfig = createTestCliCommand(handleCleanClaudeConfig, container);
      await runCleanClaudeConfig({ dryRun: true });

      expect(mockClaudeConfigCommand.clean).toHaveBeenCalledWith({ dryRun: true });
    });
  });
});
