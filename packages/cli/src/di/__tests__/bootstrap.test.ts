import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { asValue } from "awilix";
import {
  createCommand,
  createCommandHandler,
  handleCliError,
  CliValidationError,
  type CommandHandler,
} from "../bootstrap.js";
import { ProjectConfigError } from "@dev-workflow/core";

// Mock process.exit to prevent test from actually exiting
const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
  throw new Error("process.exit called");
});

// Mock console.error to capture error output
const mockConsoleError = vi.spyOn(console, "error").mockImplementation(() => {});

describe("bootstrap", () => {
  beforeEach(() => {
    mockExit.mockClear();
    mockConsoleError.mockClear();
  });

  afterEach(() => {
    mockExit.mockClear();
    mockConsoleError.mockClear();
  });

  describe("handleCliError", () => {
    it("should handle CliValidationError with user-friendly message", () => {
      expect(() => handleCliError(new CliValidationError("Invalid input"))).toThrow(
        "process.exit called"
      );

      expect(mockConsoleError).toHaveBeenCalledWith("❌ Invalid: Invalid input");
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("should handle ProjectConfigError NOT_GIT_REPO", () => {
      const error = new ProjectConfigError("Not a git repository", "NOT_GIT_REPO");

      expect(() => handleCliError(error)).toThrow("process.exit called");

      expect(mockConsoleError).toHaveBeenCalledWith(
        "❌ Not a git repository. dev-workflow requires git."
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("should handle ProjectConfigError SLUG_NOT_FOUND", () => {
      const error = new ProjectConfigError("Slug not found", "SLUG_NOT_FOUND");

      expect(() => handleCliError(error)).toThrow("process.exit called");

      expect(mockConsoleError).toHaveBeenCalledWith(
        "❌ dev-workflow is not initialized for this repository."
      );
      expect(mockConsoleError).toHaveBeenCalledWith("\nRun: dev-workflow init");
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("should handle ProjectConfigError WORKTREE_DETECTED", () => {
      const error = new ProjectConfigError("Worktree detected", "WORKTREE_DETECTED");

      expect(() => handleCliError(error)).toThrow("process.exit called");

      expect(mockConsoleError).toHaveBeenCalledWith(
        "❌ Cannot run this command from a git worktree."
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("should handle generic errors", () => {
      expect(() => handleCliError(new Error("Something went wrong"))).toThrow(
        "process.exit called"
      );

      expect(mockConsoleError).toHaveBeenCalledWith("❌ Error: Something went wrong");
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("should handle non-Error objects", () => {
      expect(() => handleCliError("string error")).toThrow("process.exit called");

      expect(mockConsoleError).toHaveBeenCalledWith("❌ Error: string error");
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });

  describe("createCommand", () => {
    it("should wrap handler and catch errors", async () => {
      interface Deps {
        value: string;
      }

      const handler: CommandHandler<object, Deps> = async (_opts, deps) => {
        if (deps.value === "error") {
          throw new CliValidationError("Test error");
        }
      };

      const command = createCommand(handler);

      // Should succeed without error
      await expect(command({}, { value: "success" })).resolves.toBeUndefined();

      // Should catch error and call handleCliError
      await expect(command({}, { value: "error" })).rejects.toThrow("process.exit called");
      expect(mockConsoleError).toHaveBeenCalledWith("❌ Invalid: Test error");
    });

    it("should pass options and deps to handler", async () => {
      interface Options {
        flag: boolean;
      }

      interface Deps {
        service: { getValue: () => string };
      }

      const handler: CommandHandler<Options, Deps> = vi.fn(async (_opts, _deps) => {
        // Handler implementation
      });

      const command = createCommand(handler);

      const opts = { flag: true };
      const deps = { service: { getValue: () => "test" } };

      await command(opts, deps);

      expect(handler).toHaveBeenCalledWith(opts, deps);
    });
  });

  describe("createCommandHandler", () => {
    it("should create a handler that manages container lifecycle", async () => {
      let containerCreated = false;

      interface Deps {
        testValue: string;
      }

      const handler: CommandHandler<object, Deps> = async (_opts, deps) => {
        expect(deps.testValue).toBe("test");
      };

      const command = createCommand(handler);

      const runCommand = createCommandHandler(
        command,
        (_cradle) => {
          containerCreated = true;
          return { testValue: "test" };
        },
        {
          initializer: (container, context) => {
            container.register({
              workingDirectory: asValue(context.workingDirectory),
              packageRoot: asValue(context.packageRoot),
            });
          },
        }
      );

      await runCommand({});

      expect(containerCreated).toBe(true);
    });

    it("should call async initializer", async () => {
      let initializerCalled = false;

      interface Deps {
        value: string;
      }

      const handler: CommandHandler<object, Deps> = async () => {};
      const command = createCommand(handler);

      const runCommand = createCommandHandler(command, () => ({ value: "test" }), {
        initializer: async (container, context) => {
          // Simulate async operation
          await new Promise((resolve) => setTimeout(resolve, 10));
          initializerCalled = true;
          container.register({
            workingDirectory: asValue(context.workingDirectory),
            packageRoot: asValue(context.packageRoot),
          });
        },
      });

      await runCommand({});

      expect(initializerCalled).toBe(true);
    });

    it("should catch initialization errors", async () => {
      interface Deps {
        value: string;
      }

      const handler: CommandHandler<object, Deps> = async () => {};
      const command = createCommand(handler);

      const runCommand = createCommandHandler(command, () => ({ value: "test" }), {
        initializer: async () => {
          throw new CliValidationError("Init failed");
        },
      });

      await expect(runCommand({})).rejects.toThrow("process.exit called");
      expect(mockConsoleError).toHaveBeenCalledWith("❌ Invalid: Init failed");
    });

    it("should dispose container even on error", async () => {
      interface Deps {
        value: string;
      }

      const handler: CommandHandler<object, Deps> = async () => {
        throw new Error("Handler error");
      };
      const command = createCommand(handler);

      // Track disposal
      let disposed = false;

      const runCommand = createCommandHandler(command, () => ({ value: "test" }), {
        initializer: (container, context) => {
          container.register({
            workingDirectory: asValue(context.workingDirectory),
            packageRoot: asValue(context.packageRoot),
          });
          // Wrap dispose to track it
          const originalDispose = container.dispose.bind(container);
          container.dispose = async () => {
            disposed = true;
            return originalDispose();
          };
        },
      });

      await expect(runCommand({})).rejects.toThrow("process.exit called");
      expect(disposed).toBe(true);
    });
  });
});
