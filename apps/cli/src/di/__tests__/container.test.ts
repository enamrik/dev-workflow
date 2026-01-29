import { describe, it, expect, afterEach, vi } from "vitest";
import { asValue } from "awilix";
import { createCliContainer } from "../container.js";

describe("createCliContainer", () => {
  let container: ReturnType<typeof createCliContainer>;

  afterEach(async () => {
    if (container) {
      await container.dispose();
    }
  });

  it("should create a container with registered dependencies", () => {
    container = createCliContainer();

    // Register required runtime values
    container.register({
      workingDirectory: asValue("/test/path"),
      packageRoot: asValue("/test/package"),
    });

    // Verify infrastructure dependencies are registered
    expect(container.cradle.fileSystem).toBeDefined();
    expect(container.cradle.gitOps).toBeDefined();
    expect(container.cradle.sourceProvider).toBeDefined();
    expect(container.cradle.projectsResolver).toBeDefined();
    expect(container.cradle.workerQueueDb).toBeDefined();
  });

  it("should provide singletons for infrastructure dependencies", () => {
    container = createCliContainer();

    container.register({
      workingDirectory: asValue("/test/path"),
      packageRoot: asValue("/test/package"),
    });

    // Access the same dependency multiple times
    const fileSystem1 = container.cradle.fileSystem;
    const fileSystem2 = container.cradle.fileSystem;

    // Should be the same instance (singleton)
    expect(fileSystem1).toBe(fileSystem2);
  });

  describe("container scoping for test isolation", () => {
    it("should allow overriding dependencies in scoped container", () => {
      container = createCliContainer();

      container.register({
        workingDirectory: asValue("/test/path"),
        packageRoot: asValue("/test/package"),
      });

      // Create a mock file system
      const mockFileSystem = {
        mkdir: vi.fn().mockResolvedValue(undefined),
        rmdir: vi.fn().mockResolvedValue(undefined),
        rmFile: vi.fn().mockResolvedValue(undefined),
        copyFile: vi.fn().mockResolvedValue(undefined),
        copyDirectory: vi.fn().mockResolvedValue(undefined),
        writeFile: vi.fn().mockResolvedValue(undefined),
        readFile: vi.fn().mockResolvedValue("test content"),
        readdirWithFileTypes: vi.fn().mockResolvedValue([]),
        exists: vi.fn().mockResolvedValue(true),
      };

      // Create a scoped container and override the file system
      const scopedContainer = container.createScope();
      scopedContainer.register({
        fileSystem: asValue(mockFileSystem),
      });

      // Verify the scoped container uses the mock
      expect(scopedContainer.cradle.fileSystem).toBe(mockFileSystem);

      // Verify the parent container still uses the original
      expect(container.cradle.fileSystem).not.toBe(mockFileSystem);
    });

    it("should inherit registrations from parent container", () => {
      container = createCliContainer();

      container.register({
        workingDirectory: asValue("/parent/path"),
        packageRoot: asValue("/parent/package"),
      });

      // Create scoped container
      const scopedContainer = container.createScope();

      // Scoped container should inherit workingDirectory
      expect(scopedContainer.cradle.workingDirectory).toBe("/parent/path");
    });

    it("should allow scoped container to override specific values", () => {
      container = createCliContainer();

      container.register({
        workingDirectory: asValue("/parent/path"),
        packageRoot: asValue("/parent/package"),
      });

      // Create scoped container with different workingDirectory
      const scopedContainer = container.createScope();
      scopedContainer.register({
        workingDirectory: asValue("/scoped/path"),
      });

      // Scoped container should have the overridden value
      expect(scopedContainer.cradle.workingDirectory).toBe("/scoped/path");

      // Parent container should retain original value
      expect(container.cradle.workingDirectory).toBe("/parent/path");

      // Inherited values should be preserved
      expect(scopedContainer.cradle.packageRoot).toBe("/parent/package");
    });
  });

  describe("dispose", () => {
    it("should dispose registered disposers", async () => {
      container = createCliContainer();

      container.register({
        workingDirectory: asValue("/test/path"),
        packageRoot: asValue("/test/package"),
      });

      // Access dependencies that have disposers
      const sourceProvider = container.cradle.sourceProvider;
      const workerQueueDb = container.cradle.workerQueueDb;

      // Spy on close/dispose methods
      const sourceProviderCloseSpy = vi.spyOn(sourceProvider, "closeAll");
      const workerQueueDbCloseSpy = vi.spyOn(workerQueueDb, "close");

      // Dispose container
      await container.dispose();

      // Disposers should have been called
      expect(sourceProviderCloseSpy).toHaveBeenCalled();
      expect(workerQueueDbCloseSpy).toHaveBeenCalled();

      // Clear container reference since it's disposed
      container = undefined as unknown as ReturnType<typeof createCliContainer>;
    });
  });
});
