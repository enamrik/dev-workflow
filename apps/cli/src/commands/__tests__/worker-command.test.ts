import { describe, it, expect, vi, beforeEach } from "vitest";
import { WorkerCommand } from "../worker-command.js";
import { ClaudeWorkerService } from "../../application/claude-worker.service.js";

vi.mock("../../application/claude-worker.service.js", () => ({
  ClaudeWorkerService: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
  })),
}));

const stubQueue = {} as never;
const stubSourceProvider = {} as never;
const stubProjectsResolver = {} as never;

describe("WorkerCommand.start", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards claudeArgs to ClaudeWorkerService config", async () => {
    const cmd = new WorkerCommand(stubQueue, stubSourceProvider, stubProjectsResolver);
    await cmd.start({ claudeArgs: ["--model", "claude-opus-4-5"] });

    expect(ClaudeWorkerService).toHaveBeenCalledWith(
      stubQueue,
      stubSourceProvider,
      stubProjectsResolver,
      expect.objectContaining({ claudeArgs: ["--model", "claude-opus-4-5"] })
    );
  });

  it("defaults claudeArgs to [] when not provided", async () => {
    const cmd = new WorkerCommand(stubQueue, stubSourceProvider, stubProjectsResolver);
    await cmd.start({});

    expect(ClaudeWorkerService).toHaveBeenCalledWith(
      stubQueue,
      stubSourceProvider,
      stubProjectsResolver,
      expect.objectContaining({ claudeArgs: [] })
    );
  });

  it("does not include name/autoClaim inside claudeArgs", async () => {
    const cmd = new WorkerCommand(stubQueue, stubSourceProvider, stubProjectsResolver);
    await cmd.start({
      name: "worker-1",
      autoClaim: true,
      claudeArgs: ["--dangerously-skip-permissions"],
    });

    expect(ClaudeWorkerService).toHaveBeenCalledWith(
      stubQueue,
      stubSourceProvider,
      stubProjectsResolver,
      expect.objectContaining({
        name: "worker-1",
        autoClaim: true,
        claudeArgs: ["--dangerously-skip-permissions"],
      })
    );
  });

  it("preserves claudeArgs order", async () => {
    const cmd = new WorkerCommand(stubQueue, stubSourceProvider, stubProjectsResolver);
    await cmd.start({
      claudeArgs: ["--model", "claude-opus-4-5", "--dangerously-skip-permissions"],
    });

    expect(ClaudeWorkerService).toHaveBeenCalledWith(
      stubQueue,
      stubSourceProvider,
      stubProjectsResolver,
      expect.objectContaining({
        claudeArgs: ["--model", "claude-opus-4-5", "--dangerously-skip-permissions"],
      })
    );
  });
});
