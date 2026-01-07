/**
 * Tests for ProviderRegistry and ProviderFactory
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  ProviderRegistry,
  ProviderNotFoundError,
  ProviderDependencyError,
  getProjectManagementProvider,
} from "../provider-registry.js";
import { GitHubProviderFactory, type ProviderFactory } from "../provider-factory.js";
import type { ProjectManagementProvider } from "../../../domain/project-management-provider.js";
import type { Project } from "../../../domain/project.js";
import { MockGitHubCLI } from "../../../__tests__/mocks/mock-github-cli.js";

/**
 * Helper to create a mock Project for testing
 *
 * Note: GitHubIssueSyncConfig doesn't have a providerId field - the provider
 * is determined by the getProviderId() function which defaults to "github".
 */
function createMockProject(githubSyncConfig: Project["githubSync"] = { enabled: true }): Project {
  return {
    id: "test-project-id",
    gitRootHash: "abc123",
    name: "test-project",
    slug: "test-project-abc123",
    githubSync: githubSyncConfig,
    isArchived: false,
    archivedAt: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  };
}

describe("ProviderRegistry", () => {
  beforeEach(() => {
    // Reset singleton before each test
    ProviderRegistry.resetInstance();
  });

  afterEach(() => {
    ProviderRegistry.resetInstance();
  });

  describe("getInstance", () => {
    it("should return the same instance on multiple calls", () => {
      const instance1 = ProviderRegistry.getInstance();
      const instance2 = ProviderRegistry.getInstance();
      expect(instance1).toBe(instance2);
    });

    it("should pre-register GitHub provider", () => {
      const registry = ProviderRegistry.getInstance();
      expect(registry.has("github")).toBe(true);
    });
  });

  describe("register", () => {
    it("should register a new provider factory", () => {
      const registry = ProviderRegistry.getInstance();
      const mockFactory: ProviderFactory = {
        providerId: "test-provider",
        displayName: "Test Provider",
        createProvider: () => ({}) as ProjectManagementProvider,
        canCreate: () => true,
        getMissingDependencies: () => [],
      };

      registry.register(mockFactory);

      expect(registry.has("test-provider")).toBe(true);
    });

    it("should throw when registering duplicate provider", () => {
      const registry = ProviderRegistry.getInstance();
      const mockFactory: ProviderFactory = {
        providerId: "github", // Already registered
        displayName: "Duplicate",
        createProvider: () => ({}) as ProjectManagementProvider,
        canCreate: () => true,
        getMissingDependencies: () => [],
      };

      expect(() => registry.register(mockFactory)).toThrow("already registered");
    });
  });

  describe("has", () => {
    it("should return true for registered providers", () => {
      const registry = ProviderRegistry.getInstance();
      expect(registry.has("github")).toBe(true);
    });

    it("should return false for unregistered providers", () => {
      const registry = ProviderRegistry.getInstance();
      expect(registry.has("nonexistent")).toBe(false);
    });
  });

  describe("get", () => {
    it("should return factory for registered provider", () => {
      const registry = ProviderRegistry.getInstance();
      const factory = registry.get("github");

      expect(factory).toBeDefined();
      expect(factory.providerId).toBe("github");
    });

    it("should throw ProviderNotFoundError for unregistered provider", () => {
      const registry = ProviderRegistry.getInstance();

      expect(() => registry.get("nonexistent")).toThrow(ProviderNotFoundError);
    });

    it("should include available providers in error message", () => {
      const registry = ProviderRegistry.getInstance();

      try {
        registry.get("nonexistent");
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderNotFoundError);
        const pnfError = error as ProviderNotFoundError;
        expect(pnfError.availableProviders).toContain("github");
      }
    });
  });

  describe("tryGet", () => {
    it("should return factory for registered provider", () => {
      const registry = ProviderRegistry.getInstance();
      const factory = registry.tryGet("github");

      expect(factory).toBeDefined();
    });

    it("should return undefined for unregistered provider", () => {
      const registry = ProviderRegistry.getInstance();
      const factory = registry.tryGet("nonexistent");

      expect(factory).toBeUndefined();
    });
  });

  describe("listIds", () => {
    it("should list all registered provider IDs", () => {
      const registry = ProviderRegistry.getInstance();
      const ids = registry.listIds();

      expect(ids).toContain("github");
    });
  });

  describe("list", () => {
    it("should list providers with availability info", () => {
      const registry = ProviderRegistry.getInstance();
      const mockGitHubCLI = new MockGitHubCLI();
      const providers = registry.list({ githubCLI: mockGitHubCLI });

      const github = providers.find((p) => p.providerId === "github");
      expect(github).toBeDefined();
      expect(github!.displayName).toBe("GitHub");
      expect(github!.available).toBe(true);
      expect(github!.missingDependencies).toHaveLength(0);
    });

    it("should show missing dependencies when not available", () => {
      const registry = ProviderRegistry.getInstance();
      const providers = registry.list({}); // No dependencies

      const github = providers.find((p) => p.providerId === "github");
      expect(github).toBeDefined();
      expect(github!.available).toBe(false);
      expect(github!.missingDependencies).toContain("githubCLI");
    });
  });

  describe("createProvider", () => {
    it("should create provider from project", () => {
      const registry = ProviderRegistry.getInstance();
      const mockGitHubCLI = new MockGitHubCLI();
      const project = createMockProject({ enabled: true });

      const provider = registry.createProvider(project, { githubCLI: mockGitHubCLI });

      expect(provider).toBeDefined();
      expect(provider.providerId).toBe("github");
    });

    it("should default to github provider when no explicit provider configured", () => {
      const registry = ProviderRegistry.getInstance();
      const mockGitHubCLI = new MockGitHubCLI();
      // githubSync config doesn't have providerId - defaults to "github" via getProviderId()
      const project = createMockProject({ enabled: true });

      const provider = registry.createProvider(project, { githubCLI: mockGitHubCLI });

      expect(provider.providerId).toBe("github");
    });

    it("should throw ProviderDependencyError when dependencies missing", () => {
      const registry = ProviderRegistry.getInstance();
      const project = createMockProject({ enabled: true });

      expect(() => registry.createProvider(project, {})).toThrow(ProviderDependencyError);
    });

    it("should include missing dependencies in error", () => {
      const registry = ProviderRegistry.getInstance();
      const project = createMockProject({ enabled: true });

      try {
        registry.createProvider(project, {});
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderDependencyError);
        const pdeError = error as ProviderDependencyError;
        expect(pdeError.missingDependencies).toContain("githubCLI");
      }
    });
  });
});

describe("getProjectManagementProvider", () => {
  beforeEach(() => {
    ProviderRegistry.resetInstance();
  });

  afterEach(() => {
    ProviderRegistry.resetInstance();
  });

  it("should create provider using registry singleton", () => {
    const mockGitHubCLI = new MockGitHubCLI();
    const project = createMockProject({ enabled: true });

    const provider = getProjectManagementProvider(project, { githubCLI: mockGitHubCLI });

    expect(provider).toBeDefined();
    expect(provider.providerId).toBe("github");
  });

  it("should throw ProviderNotFoundError for unknown provider", () => {
    // Test that registry.get() throws for unknown provider
    // (since GitHubIssueSyncConfig doesn't support custom providerId,
    // we test via the registry directly)
    const registry = ProviderRegistry.getInstance();

    expect(() => registry.get("unknown")).toThrow(ProviderNotFoundError);
  });
});

describe("GitHubProviderFactory", () => {
  describe("identity", () => {
    it("should have correct providerId", () => {
      const factory = new GitHubProviderFactory();
      expect(factory.providerId).toBe("github");
    });

    it("should have correct displayName", () => {
      const factory = new GitHubProviderFactory();
      expect(factory.displayName).toBe("GitHub");
    });
  });

  describe("canCreate", () => {
    it("should return true when githubCLI is provided", () => {
      const factory = new GitHubProviderFactory();
      const mockGitHubCLI = new MockGitHubCLI();

      expect(factory.canCreate({ githubCLI: mockGitHubCLI })).toBe(true);
    });

    it("should return false when githubCLI is not provided", () => {
      const factory = new GitHubProviderFactory();

      expect(factory.canCreate({})).toBe(false);
    });
  });

  describe("getMissingDependencies", () => {
    it("should return empty array when all dependencies present", () => {
      const factory = new GitHubProviderFactory();
      const mockGitHubCLI = new MockGitHubCLI();

      expect(factory.getMissingDependencies({ githubCLI: mockGitHubCLI })).toHaveLength(0);
    });

    it("should return githubCLI when missing", () => {
      const factory = new GitHubProviderFactory();

      const missing = factory.getMissingDependencies({});
      expect(missing).toContain("githubCLI");
    });
  });

  describe("createProvider", () => {
    it("should create GitHubProjectManagementProvider", () => {
      const factory = new GitHubProviderFactory();
      const mockGitHubCLI = new MockGitHubCLI();
      const project = createMockProject({ enabled: true });

      const provider = factory.createProvider(project, { githubCLI: mockGitHubCLI });

      expect(provider).toBeDefined();
      expect(provider.providerId).toBe("github");
    });

    it("should throw when githubCLI is missing", () => {
      const factory = new GitHubProviderFactory();
      const project = createMockProject({ enabled: true });

      expect(() => factory.createProvider(project, {})).toThrow("requires githubCLI");
    });
  });
});
