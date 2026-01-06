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
import type { ProjectManagementConfig } from "../../../domain/project-management-config.js";
import { MockGitHubCLI } from "../../../__tests__/mocks/mock-github-cli.js";

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
    it("should create provider from config", () => {
      const registry = ProviderRegistry.getInstance();
      const mockGitHubCLI = new MockGitHubCLI();
      const config: ProjectManagementConfig = {
        enabled: true,
        providerId: "github",
      };

      const provider = registry.createProvider(config, { githubCLI: mockGitHubCLI });

      expect(provider).toBeDefined();
      expect(provider.providerId).toBe("github");
    });

    it("should use default providerId when not specified", () => {
      const registry = ProviderRegistry.getInstance();
      const mockGitHubCLI = new MockGitHubCLI();
      const config: ProjectManagementConfig = {
        enabled: true,
        // No providerId - should default to "github"
      };

      const provider = registry.createProvider(config, { githubCLI: mockGitHubCLI });

      expect(provider.providerId).toBe("github");
    });

    it("should throw ProviderDependencyError when dependencies missing", () => {
      const registry = ProviderRegistry.getInstance();
      const config: ProjectManagementConfig = {
        enabled: true,
        providerId: "github",
      };

      expect(() => registry.createProvider(config, {})).toThrow(ProviderDependencyError);
    });

    it("should include missing dependencies in error", () => {
      const registry = ProviderRegistry.getInstance();
      const config: ProjectManagementConfig = {
        enabled: true,
        providerId: "github",
      };

      try {
        registry.createProvider(config, {});
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
    const config: ProjectManagementConfig = {
      enabled: true,
      providerId: "github",
    };

    const provider = getProjectManagementProvider(config, { githubCLI: mockGitHubCLI });

    expect(provider).toBeDefined();
    expect(provider.providerId).toBe("github");
  });

  it("should throw for unknown provider", () => {
    const config: ProjectManagementConfig = {
      enabled: true,
      providerId: "unknown",
    };

    expect(() => getProjectManagementProvider(config, {})).toThrow(ProviderNotFoundError);
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
      const config: ProjectManagementConfig = { enabled: true };

      const provider = factory.createProvider(config, { githubCLI: mockGitHubCLI });

      expect(provider).toBeDefined();
      expect(provider.providerId).toBe("github");
    });

    it("should throw when githubCLI is missing", () => {
      const factory = new GitHubProviderFactory();
      const config: ProjectManagementConfig = { enabled: true };

      expect(() => factory.createProvider(config, {})).toThrow("requires githubCLI");
    });
  });
});
