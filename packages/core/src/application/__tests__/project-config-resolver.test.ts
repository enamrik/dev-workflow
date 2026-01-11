import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import {
  resolveConnectionString,
  getConfigPath,
  resolveConfig,
  writeConfig,
  listConfiguredProjects,
  ProjectConfigError,
  type ProjectConfig,
} from "../project-config-resolver.js";

describe("project-config-resolver", () => {
  const originalEnv = process.env["TRACK_DIR"];
  let testTrackDir: string;

  beforeEach(async () => {
    // Create a temp directory for TRACK_DIR
    testTrackDir = await fs.mkdtemp(path.join(os.tmpdir(), "track-test-"));
    process.env["TRACK_DIR"] = testTrackDir;
  });

  afterEach(async () => {
    // Restore original environment
    if (originalEnv === undefined) {
      delete process.env["TRACK_DIR"];
    } else {
      process.env["TRACK_DIR"] = originalEnv;
    }

    // Clean up temp directory
    if (testTrackDir) {
      await fs.rm(testTrackDir, { recursive: true, force: true });
    }
  });

  describe("resolveConnectionString", () => {
    const gitRoot = "/Users/test/code/my-project";

    describe("file:./relative/path format", () => {
      it("should resolve file:./path relative to gitRoot", () => {
        const result = resolveConnectionString("file:./track/workflow.db", gitRoot);

        expect(result).toBe("/Users/test/code/my-project/track/workflow.db");
      });

      it("should resolve file:./.track/workflow.db", () => {
        const result = resolveConnectionString("file:./.track/workflow.db", gitRoot);

        expect(result).toBe("/Users/test/code/my-project/.track/workflow.db");
      });

      it("should resolve file:track/workflow.db (no leading ./)", () => {
        const result = resolveConnectionString("file:track/workflow.db", gitRoot);

        expect(result).toBe("/Users/test/code/my-project/track/workflow.db");
      });
    });

    describe("file:///absolute/path format", () => {
      it("should return absolute path without file:// prefix", () => {
        const result = resolveConnectionString("file:///home/user/.track/workflow.db", gitRoot);

        expect(result).toBe("/home/user/.track/workflow.db");
      });

      it("should expand ~ to home directory", () => {
        const result = resolveConnectionString("file:///~/.track/workflow.db", gitRoot);

        expect(result).toBe(path.join(os.homedir(), ".track/workflow.db"));
      });
    });

    describe("postgresql:// format", () => {
      it("should pass through postgresql:// unchanged", () => {
        const connectionString = "postgresql://user:pass@host.neon.tech/db?sslmode=require";
        const result = resolveConnectionString(connectionString, gitRoot);

        expect(result).toBe(connectionString);
      });

      it("should pass through postgres:// unchanged", () => {
        const connectionString = "postgres://user:pass@host.neon.tech/db";
        const result = resolveConnectionString(connectionString, gitRoot);

        expect(result).toBe(connectionString);
      });
    });

    describe("invalid format", () => {
      it("should throw for unknown format", () => {
        expect(() => resolveConnectionString("mysql://host/db", gitRoot)).toThrow(
          ProjectConfigError
        );
      });

      it("should throw for plain path without file: prefix", () => {
        expect(() => resolveConnectionString("/absolute/path/db.sqlite", gitRoot)).toThrow(
          ProjectConfigError
        );
      });
    });
  });

  describe("getConfigPath", () => {
    it("should return path to config.json in projects directory for slug", () => {
      const result = getConfigPath("my-project-abc123");

      expect(result).toBe(path.join(testTrackDir, "projects", "my-project-abc123", "config.json"));
    });
  });

  describe("writeConfig and resolveConfig", () => {
    const testSlug = "test-project-123456";
    const testConfig: ProjectConfig = {
      database: "file:./track/workflow.db",
      gitRoot: "/Users/test/code/my-project",
      projectId: "uuid-12345",
    };

    it("should write and read config correctly", async () => {
      await writeConfig(testSlug, testConfig);

      const result = await resolveConfig(testSlug);

      expect(result.database).toBe(testConfig.database);
      expect(result.gitRoot).toBe(testConfig.gitRoot);
      expect(result.projectId).toBe(testConfig.projectId);
      expect(result.slug).toBe(testSlug);
    });

    it("should resolve relative database path", async () => {
      await writeConfig(testSlug, testConfig);

      const result = await resolveConfig(testSlug);

      expect(result.resolvedDatabase).toBe("/Users/test/code/my-project/track/workflow.db");
    });

    it("should throw CONFIG_NOT_FOUND for missing config", async () => {
      try {
        await resolveConfig("nonexistent-slug");
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ProjectConfigError);
        expect((error as ProjectConfigError).code).toBe("CONFIG_NOT_FOUND");
      }
    });

    it("should throw CONFIG_INVALID for malformed JSON", async () => {
      const configDir = path.join(testTrackDir, "projects", testSlug);
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(path.join(configDir, "config.json"), "not valid json");

      try {
        await resolveConfig(testSlug);
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ProjectConfigError);
        expect((error as ProjectConfigError).code).toBe("CONFIG_INVALID");
      }
    });

    it("should throw CONFIG_INVALID for missing required fields", async () => {
      const configDir = path.join(testTrackDir, "projects", testSlug);
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(
        path.join(configDir, "config.json"),
        JSON.stringify({ database: "file:./db" })
      );

      try {
        await resolveConfig(testSlug);
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ProjectConfigError);
        expect((error as ProjectConfigError).code).toBe("CONFIG_INVALID");
      }
    });
  });

  describe("listConfiguredProjects", () => {
    it("should return empty array when no projects configured", async () => {
      const result = await listConfiguredProjects();

      expect(result).toEqual([]);
    });

    it("should return slugs of configured projects", async () => {
      // Create two configured projects
      await writeConfig("project-a-123456", {
        database: "file:./track/workflow.db",
        gitRoot: "/path/a",
        projectId: "uuid-a",
      });
      await writeConfig("project-b-654321", {
        database: "file:./track/workflow.db",
        gitRoot: "/path/b",
        projectId: "uuid-b",
      });

      const result = await listConfiguredProjects();

      expect(result).toHaveLength(2);
      expect(result).toContain("project-a-123456");
      expect(result).toContain("project-b-654321");
    });

    it("should skip directories without config.json", async () => {
      await writeConfig("project-a-123456", {
        database: "file:./track/workflow.db",
        gitRoot: "/path/a",
        projectId: "uuid-a",
      });

      // Create a directory without config.json in the projects directory
      await fs.mkdir(path.join(testTrackDir, "projects", "no-config-dir"), { recursive: true });

      const result = await listConfiguredProjects();

      expect(result).toHaveLength(1);
      expect(result).toContain("project-a-123456");
    });

    it("should skip hidden directories", async () => {
      await writeConfig("project-a-123456", {
        database: "file:./track/workflow.db",
        gitRoot: "/path/a",
        projectId: "uuid-a",
      });

      // Create a hidden directory with config.json in the projects directory
      const hiddenDir = path.join(testTrackDir, "projects", ".hidden");
      await fs.mkdir(hiddenDir, { recursive: true });
      await fs.writeFile(
        path.join(hiddenDir, "config.json"),
        JSON.stringify({
          database: "file:./db",
          gitRoot: "/path",
          projectId: "uuid",
        })
      );

      const result = await listConfiguredProjects();

      expect(result).toHaveLength(1);
      expect(result).not.toContain(".hidden");
    });
  });

  describe("ProjectConfigError", () => {
    it("should include error code", () => {
      const error = new ProjectConfigError("Config not found", "CONFIG_NOT_FOUND", {
        slug: "test",
      });

      expect(error.code).toBe("CONFIG_NOT_FOUND");
      expect(error.name).toBe("ProjectConfigError");
      expect(error.details).toEqual({ slug: "test" });
    });
  });

  describe("migration from legacy location", () => {
    const testSlug = "legacy-project-123456";
    const testConfig = {
      database: "file:./track/workflow.db",
      gitRoot: "/Users/test/code/my-project",
      projectId: "uuid-12345",
    };

    it("should migrate project from legacy location on resolveConfig", async () => {
      // Create project at legacy location (~/.track/<slug>/)
      const legacyDir = path.join(testTrackDir, testSlug);
      await fs.mkdir(legacyDir, { recursive: true });
      await fs.writeFile(path.join(legacyDir, "config.json"), JSON.stringify(testConfig));
      // Also create a worktrees directory to verify whole dir is migrated
      await fs.mkdir(path.join(legacyDir, "worktrees"), { recursive: true });
      await fs.writeFile(path.join(legacyDir, "worktrees", "test.txt"), "test content");

      // resolveConfig should migrate and return config
      const result = await resolveConfig(testSlug);

      // Verify config is returned correctly
      expect(result.database).toBe(testConfig.database);
      expect(result.gitRoot).toBe(testConfig.gitRoot);
      expect(result.projectId).toBe(testConfig.projectId);
      expect(result.slug).toBe(testSlug);

      // Verify migration occurred - old location should not exist
      const legacyExists = await fs
        .access(legacyDir)
        .then(() => true)
        .catch(() => false);
      expect(legacyExists).toBe(false);

      // New location should exist with all content
      const newDir = path.join(testTrackDir, "projects", testSlug);
      const newExists = await fs
        .access(newDir)
        .then(() => true)
        .catch(() => false);
      expect(newExists).toBe(true);

      // Worktrees directory should have been migrated
      const worktreeContent = await fs.readFile(
        path.join(newDir, "worktrees", "test.txt"),
        "utf-8"
      );
      expect(worktreeContent).toBe("test content");
    });

    it("should prefer new location over legacy when both exist", async () => {
      // Create project at both locations (shouldn't happen, but test edge case)
      const legacyDir = path.join(testTrackDir, testSlug);
      await fs.mkdir(legacyDir, { recursive: true });
      await fs.writeFile(
        path.join(legacyDir, "config.json"),
        JSON.stringify({ ...testConfig, projectId: "legacy-uuid" })
      );

      const newDir = path.join(testTrackDir, "projects", testSlug);
      await fs.mkdir(newDir, { recursive: true });
      await fs.writeFile(
        path.join(newDir, "config.json"),
        JSON.stringify({ ...testConfig, projectId: "new-uuid" })
      );

      // resolveConfig should use new location
      const result = await resolveConfig(testSlug);

      expect(result.projectId).toBe("new-uuid");
    });

    it("should list projects from both legacy and new locations", async () => {
      // Create project at new location
      await writeConfig("new-project-123456", {
        database: "file:./track/workflow.db",
        gitRoot: "/path/new",
        projectId: "uuid-new",
      });

      // Create project at legacy location
      const legacyDir = path.join(testTrackDir, "legacy-project-654321");
      await fs.mkdir(legacyDir, { recursive: true });
      await fs.writeFile(
        path.join(legacyDir, "config.json"),
        JSON.stringify({
          database: "file:./track/workflow.db",
          gitRoot: "/path/legacy",
          projectId: "uuid-legacy",
        })
      );

      const result = await listConfiguredProjects();

      expect(result).toHaveLength(2);
      expect(result).toContain("new-project-123456");
      expect(result).toContain("legacy-project-654321");
    });

    it("should not include system directories from legacy location", async () => {
      // Create project at new location
      await writeConfig("new-project-123456", {
        database: "file:./track/workflow.db",
        gitRoot: "/path/new",
        projectId: "uuid-new",
      });

      // Create system directories at legacy location that should be skipped
      await fs.mkdir(path.join(testTrackDir, "templates"), { recursive: true });
      await fs.mkdir(path.join(testTrackDir, "config"), { recursive: true });

      const result = await listConfiguredProjects();

      expect(result).toHaveLength(1);
      expect(result).toContain("new-project-123456");
      expect(result).not.toContain("templates");
      expect(result).not.toContain("config");
    });
  });
});
