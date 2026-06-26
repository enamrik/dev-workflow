import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { asValue } from "awilix";
import {
  createCliHandler,
  createCliCommand,
  handleCliError,
  CliValidationError,
  composeMiddleware,
  registerWorkingDirectory,
  type ContainerMiddleware,
} from "../bootstrap.js";
import { createCliContainer } from "../container.js";
import { Effect } from "@dev-workflow/effect";
import { ProjectConfigError } from "@dev-workflow/tracking";

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
      expect(mockConsoleError).toHaveBeenCalledWith("\nRun: dfl init");
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

  describe("createCliHandler", () => {
    it("should wrap handler and catch errors", async () => {
      let shouldError = false;

      const wrapped = createCliHandler({
        handler: (_opts: object) =>
          Effect.promise(async () => {
            if (shouldError) {
              throw new CliValidationError("Test error");
            }
          }),
      });
      const container = createCliContainer();

      try {
        // Should succeed without error
        await expect(wrapped({}, container)).resolves.toBeUndefined();

        // Toggle to error state
        shouldError = true;

        // Should catch error and call handleCliError
        await expect(wrapped({}, container)).rejects.toThrow("process.exit called");
        expect(mockConsoleError).toHaveBeenCalledWith("❌ Invalid: Test error");
      } finally {
        await container.dispose();
      }
    });

    it("should run middleware before handler", async () => {
      const executionOrder: string[] = [];

      const middleware: ContainerMiddleware = () => {
        executionOrder.push("middleware");
      };

      const wrapped = createCliHandler({
        handler: (_opts: object) =>
          Effect.promise(async () => {
            executionOrder.push("handler");
          }),
        middleware,
      });
      const container = createCliContainer();

      try {
        await wrapped({}, container);
        expect(executionOrder).toEqual(["middleware", "handler"]);
      } finally {
        await container.dispose();
      }
    });

    it("should allow middleware to register values into container", async () => {
      const injectMiddleware: ContainerMiddleware = (container) => {
        container.register({
          workingDirectory: asValue("/test/injected/path"),
        });
      };

      let capturedValue: string | undefined;

      const wrapped = createCliHandler({
        handler: (_opts: object) => Effect.succeed(undefined as void),
        middleware: injectMiddleware,
      });
      const container = createCliContainer();

      try {
        await wrapped({}, container);
        // Verify middleware registered the value
        capturedValue = container.cradle.workingDirectory;
        expect(capturedValue).toBe("/test/injected/path");
      } finally {
        await container.dispose();
      }
    });
  });

  describe("createCliCommand", () => {
    it("should create a runner that manages container lifecycle", async () => {
      let handlerCalled = false;

      const wrapped = createCliHandler({
        handler: (_opts: object) =>
          Effect.promise(async () => {
            handlerCalled = true;
          }),
        middleware: registerWorkingDirectory,
      });
      const runCommand = createCliCommand(wrapped);

      await runCommand({});

      expect(handlerCalled).toBe(true);
    });

    it("should catch handler errors and still dispose container", async () => {
      const wrapped = createCliHandler({
        handler: (_opts: object) =>
          Effect.promise(async () => {
            throw new CliValidationError("Handler error");
          }),
      });
      const runCommand = createCliCommand(wrapped);

      // Should catch error via handleCliError
      await expect(runCommand({})).rejects.toThrow("process.exit called");
      expect(mockConsoleError).toHaveBeenCalledWith("❌ Invalid: Handler error");
    });

    it("should catch middleware errors", async () => {
      const failingMiddleware: ContainerMiddleware = () => {
        throw new CliValidationError("Middleware error");
      };

      const wrapped = createCliHandler({
        handler: (_opts: object) => Effect.succeed(undefined as void),
        middleware: failingMiddleware,
      });
      const runCommand = createCliCommand(wrapped);

      await expect(runCommand({})).rejects.toThrow("process.exit called");
      expect(mockConsoleError).toHaveBeenCalledWith("❌ Invalid: Middleware error");
    });
  });

  describe("composeMiddleware", () => {
    it("should run middleware in order", async () => {
      const order: number[] = [];

      const m1: ContainerMiddleware = () => {
        order.push(1);
      };
      const m2: ContainerMiddleware = () => {
        order.push(2);
      };
      const m3: ContainerMiddleware = () => {
        order.push(3);
      };

      const composed = composeMiddleware(m1, m2, m3);
      const container = createCliContainer();

      try {
        await composed(container);
        expect(order).toEqual([1, 2, 3]);
      } finally {
        await container.dispose();
      }
    });
  });
});
