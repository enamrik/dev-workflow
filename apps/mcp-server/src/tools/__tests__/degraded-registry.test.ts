import { describe, it, expect } from "vitest";
import { createDegradedToolsRegistry } from "../tools-registry.js";

// #45: when the server can't resolve a dfl project (e.g. launched in a non-dfl
// directory), it serves this registry instead of exiting on startup. Every tool
// must return a clean error result so the MCP connection stays alive (no -32000).
describe("createDegradedToolsRegistry (#45)", () => {
  const REASON = "This directory isn't a dev-workflow project. Run 'dfl init'.";

  it("returns a clean error result for any tool name, current or unknown", async () => {
    const registry = createDegradedToolsRegistry(REASON);

    for (const name of [
      "create_issue",
      "get_work_queue",
      "load_task_session",
      "some_future_tool",
    ]) {
      const tool = registry[name];
      expect(typeof tool).toBe("function");

      const res = await tool({});
      expect(res.isError).toBe(true);

      const payload = JSON.parse((res.content[0] as { text: string }).text);
      expect(payload.success).toBe(false);
      expect(payload.error).toBe(REASON);
    }
  });
});
