import { describe, it, expect, vi, afterEach } from "vitest";
import { asValue } from "awilix";
import { createTestContainer } from "./test-helpers.js";
import { createTestCliCommand } from "../../di/bootstrap.js";
import { handleMCP } from "../mcp-command-def.js";
import type { MCPCommand } from "../mcp-command.js";

describe("mcp-command-def", () => {
  let container: ReturnType<typeof createTestContainer>;

  afterEach(async () => {
    vi.clearAllMocks();
    if (container) {
      await container.dispose();
    }
  });

  describe("handleMCP", () => {
    it("should call mcpCommand.execute when executed", async () => {
      container = createTestContainer();

      const mockMCPCommand = {
        execute: vi.fn(),
      };

      container.register({
        mcpCommand: asValue(mockMCPCommand as unknown as MCPCommand),
      });

      const runMCP = createTestCliCommand(handleMCP, container);
      await runMCP({});

      expect(mockMCPCommand.execute).toHaveBeenCalled();
    });
  });
});
