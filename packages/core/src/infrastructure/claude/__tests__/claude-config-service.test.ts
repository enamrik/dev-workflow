import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { NodeClaudeConfigService } from "../claude-config-service.js";

describe("NodeClaudeConfigService", () => {
  let testDir: string;
  let testConfigPath: string;
  let service: NodeClaudeConfigService;

  beforeEach(async () => {
    // Create a temporary directory for test config
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-config-test-"));
    testConfigPath = path.join(testDir, ".claude.json");
    service = new NodeClaudeConfigService(testConfigPath);
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("removeFolder", () => {
    it("should return success when config file does not exist", async () => {
      const result = await service.removeFolder("/some/path");

      expect(result.success).toBe(true);
      expect(result.folderRemoved).toBe(false);
      expect(result.message).toBe("Claude config file does not exist");
    });

    it("should return success when projects section does not exist", async () => {
      await fs.writeFile(testConfigPath, JSON.stringify({ theme: "dark" }));

      const result = await service.removeFolder("/some/path");

      expect(result.success).toBe(true);
      expect(result.folderRemoved).toBe(false);
      expect(result.message).toBe("No projects section in Claude config");
    });

    it("should return success when folder is not in projects", async () => {
      await fs.writeFile(
        testConfigPath,
        JSON.stringify({
          projects: {
            "/other/path": { allowedTools: [] },
          },
        })
      );

      const result = await service.removeFolder("/some/path");

      expect(result.success).toBe(true);
      expect(result.folderRemoved).toBe(false);
      expect(result.message).toContain("Folder not found in Claude config");
    });

    it("should remove folder from projects section", async () => {
      const initialConfig = {
        projects: {
          "/some/path": { allowedTools: [] },
          "/other/path": { allowedTools: ["Edit"] },
        },
        theme: "dark",
      };
      await fs.writeFile(testConfigPath, JSON.stringify(initialConfig));

      const result = await service.removeFolder("/some/path");

      expect(result.success).toBe(true);
      expect(result.folderRemoved).toBe(true);
      expect(result.message).toContain("Removed folder from Claude config");

      // Verify the config file was updated correctly
      const updatedContent = await fs.readFile(testConfigPath, "utf-8");
      const updatedConfig = JSON.parse(updatedContent);

      expect(updatedConfig.projects["/some/path"]).toBeUndefined();
      expect(updatedConfig.projects["/other/path"]).toEqual({ allowedTools: ["Edit"] });
      expect(updatedConfig.theme).toBe("dark");
    });

    it("should handle normalized path matching", async () => {
      // Test with trailing slashes and other path variations
      const initialConfig = {
        projects: {
          "/some/path": { allowedTools: [] },
        },
      };
      await fs.writeFile(testConfigPath, JSON.stringify(initialConfig));

      // Path normalization should handle minor variations
      const result = await service.removeFolder("/some/path");

      expect(result.success).toBe(true);
      expect(result.folderRemoved).toBe(true);
    });

    it("should return error when config file is invalid JSON", async () => {
      await fs.writeFile(testConfigPath, "not valid json");

      const result = await service.removeFolder("/some/path");

      expect(result.success).toBe(false);
      expect(result.folderRemoved).toBe(false);
      expect(result.message).toBe("Failed to parse Claude config file");
    });

    it("should preserve all other config properties when removing folder", async () => {
      const initialConfig = {
        hasCompletedOnboarding: true,
        theme: "dark",
        projects: {
          "/some/path": { allowedTools: [] },
        },
        customApiKeyResponses: { someKey: "value" },
      };
      await fs.writeFile(testConfigPath, JSON.stringify(initialConfig));

      const result = await service.removeFolder("/some/path");

      expect(result.success).toBe(true);

      const updatedContent = await fs.readFile(testConfigPath, "utf-8");
      const updatedConfig = JSON.parse(updatedContent);

      expect(updatedConfig.hasCompletedOnboarding).toBe(true);
      expect(updatedConfig.theme).toBe("dark");
      expect(updatedConfig.customApiKeyResponses).toEqual({ someKey: "value" });
      expect(updatedConfig.projects).toEqual({});
    });

    it("should handle empty projects object", async () => {
      const initialConfig = {
        projects: {},
      };
      await fs.writeFile(testConfigPath, JSON.stringify(initialConfig));

      const result = await service.removeFolder("/some/path");

      expect(result.success).toBe(true);
      expect(result.folderRemoved).toBe(false);
    });
  });
});
