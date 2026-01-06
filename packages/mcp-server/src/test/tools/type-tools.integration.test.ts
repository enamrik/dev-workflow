/**
 * Type Tools Integration Tests
 *
 * Tests actual MCP tool handlers with real TypeService.
 */

import { describe, it, expect } from "vitest";
import { TypeService, type TypeServiceConfig, NodeFileSystem } from "@dev-workflow/core";
import { handleListTypes, type TypeToolContext } from "../../tools/type-tools.js";

/**
 * Create a TypeToolContext for testing
 */
function createTypeToolContext(): TypeToolContext {
  const fileSystem = new NodeFileSystem();
  const typeConfig: TypeServiceConfig = {
    localTypesPath: "/tmp/test-types-local-nonexistent.md",
    globalTypesPath: "/tmp/test-types-global-nonexistent.md",
  };
  const typeService = new TypeService(fileSystem, typeConfig);

  return {
    typeService,
  };
}

describe("Type Tools Integration", () => {
  describe("handleListTypes", () => {
    it("should return all valid types with their metadata", async () => {
      const ctx = createTypeToolContext();

      const result = await handleListTypes(ctx);

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);

      expect(content.types).toBeDefined();
      expect(content.types.length).toBeGreaterThan(0);

      // Check default types are present
      const typeNames = content.types.map((t: { name: string }) => t.name);
      expect(typeNames).toContain("FEATURE");
      expect(typeNames).toContain("BUG");
      expect(typeNames).toContain("ENHANCEMENT");
      expect(typeNames).toContain("TASK");
    });

    it("should include name, description, and githubLabel for each type", async () => {
      const ctx = createTypeToolContext();

      const result = await handleListTypes(ctx);

      const content = JSON.parse(result.content[0].text);

      for (const type of content.types) {
        expect(type.name).toBeDefined();
        expect(type.description).toBeDefined();
        expect(type.githubLabel).toBeDefined();
      }

      // Check specific type details
      const featureType = content.types.find((t: { name: string }) => t.name === "FEATURE");
      expect(featureType).toBeDefined();
      expect(featureType.githubLabel).toBe("feature");

      const bugType = content.types.find((t: { name: string }) => t.name === "BUG");
      expect(bugType).toBeDefined();
      expect(bugType.githubLabel).toBe("bug");
    });

    it("should include helpful message about usage", async () => {
      const ctx = createTypeToolContext();

      const result = await handleListTypes(ctx);

      const content = JSON.parse(result.content[0].text);

      expect(content.message).toBeDefined();
      expect(content.message).toContain("type");
      expect(content.message).toContain("generate_plan");
    });
  });
});
