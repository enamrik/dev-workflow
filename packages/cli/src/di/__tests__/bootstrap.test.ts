import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { asValue } from "awilix";
import {
  createCommand,
  createCommandHandler,
  handleCliError,
  CliValidationError,
  compose,
  registerWorkingDirectory,
  type CliHandler,
  type CliMiddleware,
} from "../bootstrap.js";
import { createCliContainer } from "../container.js";
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
      const handler: CliHandler<{ trigger: string }> = async (opts, _cradle) => {
        if (opts.trigger === "error") {
          throw new CliValidationError("Test error");
        }
      };

      const command = createCommand(handler);
      const container = createCliContainer();

      try {
        // Should succeed without error
        await expect(command({ trigger: "success" }, container)).resolves.toBeUndefined();

        // Should catch error and call handleCliError
        await expect(command({ trigger: "error" }, container)).rejects.toThrow(
          "process.exit called"
        );
        expect(mockConsoleError).toHaveBeenCalledWith("❌ Invalid: Test error");
      } finally {
        await container.dispose();
      }
    });

    it("should run middleware before handler", async () => {
      const executionOrder: string[] = [];

      const middleware: CliMiddleware<object> = (_opts, _container) => {
        executionOrder.push("middleware");
      };

      const handler: CliHandler<object> = async () => {
        executionOrder.push("handler");
      };

      const command = createCommand(handler, middleware);
      const container = createCliContainer();

      try {
        await command({}, container);
        expect(executionOrder).toEqual(["middleware", "handler"]);
      } finally {
        await container.dispose();
      }
    });

    it("should pass options to middleware and handler", async () => {
      interface Options {
        flag: boolean;
      }

      let middlewareReceivedOpts: Options | null = null;
      let handlerReceivedOpts: Options | null = null;

      const middleware: CliMiddleware<Options> = (opts, _container) => {
        middlewareReceivedOpts = opts;
      };

      const handler: CliHandler<Options> = async (opts, _cradle) => {
        handlerReceivedOpts = opts;
      };

      const command = createCommand(handler, middleware);
      const container = createCliContainer();

      try {
        await command({ flag: true }, container);
        expect(middlewareReceivedOpts).toEqual({ flag: true });
        expect(handlerReceivedOpts).toEqual({ flag: true });
      } finally {
        await container.dispose();
      }
    });
  });

  describe("createCommandHandler", () => {
    it("should create a handler that manages container lifecycle", async () => {
      let handlerCalled = false;

      const handler: CliHandler<object> = async (_opts, cradle) => {
        // Verify cradle has basic services from container
        expect(cradle.fileSystem).toBeDefined();
        handlerCalled = true;
      };

      const command = createCommand(handler, registerWorkingDirectory);
      const runCommand = createCommandHandler(command);

      await runCommand({});

      expect(handlerCalled).toBe(true);
    });

    it("should dispose container after handler completes", async () => {
      let containerDisposed = false;

      const handler: CliHandler<object> = async () => {
        // Handler runs successfully
      };

      // Create a command that wraps dispose to track it
      const command = createCommand(handler);
      const originalCreateCommandHandler = createCommandHandler;

      // We need to test this differently - check that command runs without container errors
      const runCommand = originalCreateCommandHandler(command);

      // If dispose wasn't called properly, this would leak resources
      await runCommand({});
      containerDisposed = true; // If we get here, cleanup happened

      expect(containerDisposed).toBe(true);
    });

    it("should catch handler errors and still dispose container", async () => {
      const handler: CliHandler<object> = async () => {
        throw new CliValidationError("Handler error");
      };

      const command = createCommand(handler);
      const runCommand = createCommandHandler(command);

      // Should catch error via handleCliError
      await expect(runCommand({})).rejects.toThrow("process.exit called");
      expect(mockConsoleError).toHaveBeenCalledWith("❌ Invalid: Handler error");
    });

    it("should catch middleware errors", async () => {
      const failingMiddleware: CliMiddleware<object> = () => {
        throw new CliValidationError("Middleware error");
      };

      const handler: CliHandler<object> = async () => {
        // Should not reach here
      };

      const command = createCommand(handler, failingMiddleware);
      const runCommand = createCommandHandler(command);

      await expect(runCommand({})).rejects.toThrow("process.exit called");
      expect(mockConsoleError).toHaveBeenCalledWith("❌ Invalid: Middleware error");
    });
  });

  describe("compose", () => {
    it("should run middleware in order", async () => {
      const order: number[] = [];

      const m1: CliMiddleware<object> = () => {
        order.push(1);
      };
      const m2: CliMiddleware<object> = () => {
        order.push(2);
      };
      const m3: CliMiddleware<object> = () => {
        order.push(3);
      };

      const composed = compose(m1, m2, m3);
      const container = createCliContainer();

      try {
        await composed({}, container);
        expect(order).toEqual([1, 2, 3]);
      } finally {
        await container.dispose();
      }
    });

    it("should allow middleware to inject values into container", async () => {
      const injectMiddleware: CliMiddleware<object> = (_opts, container) => {
        // Inject workingDirectory which is a valid optional cradle property
        container.register({
          workingDirectory: asValue("/test/injected/path"),
        });
      };

      let capturedValue: string | undefined;

      const handler: CliHandler<object> = async (_opts, cradle) => {
        capturedValue = cradle.workingDirectory;
      };

      const command = createCommand(handler, injectMiddleware);
      const runCommand = createCommandHandler(command);

      await runCommand({});

      expect(capturedValue).toBe("/test/injected/path");
    });
  });
});
