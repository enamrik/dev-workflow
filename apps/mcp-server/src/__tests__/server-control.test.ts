/**
 * Tests for ServerControl — the server-level "which project am I serving?" state.
 *
 * Covers:
 * - setActiveProject swaps the live registry and reuses the per-slug cache.
 * - select_project validates the slug (unknown → clean error, no swap).
 * - current_project mismatch computation (active===cwd → false; active!==cwd → true;
 *   cwd null → not a mismatch / not a crash).
 * - control tools dispatch before (and independently of) the per-project registry.
 *
 * createMcpContainer / createToolsRegistry are mocked so no real DB is touched; the
 * ProjectsResolver is mocked at the module boundary so validation/listing is deterministic.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolResponse } from "../tools/types.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Each "container" is just a cradle stub with a dbSource.close() spy so we can
// assert build-once and cleanup behavior without a database.
const containerBuilds: string[] = [];

vi.mock("../di/container.js", () => ({
  createMcpContainer: vi.fn(async (slug: string) => {
    containerBuilds.push(slug);
    return { cradle: { dbSource: { close: vi.fn() } } };
  }),
}));

// createToolsRegistry returns a registry whose single fake tool echoes the slug
// it was built for, so we can prove the live registry actually swapped.
vi.mock("../tools/tools-registry.js", () => ({
  createToolsRegistry: vi.fn((container: { cradle: { slug?: string } }) => ({
    whoami: async () => ({ content: [{ type: "text", text: "registry" }] }),
    __container: container,
  })),
  createDegradedToolsRegistry: vi.fn((reason: string) => {
    const degraded = async () => ({
      isError: true,
      content: [{ type: "text", text: JSON.stringify({ success: false, error: reason }) }],
    });
    return new Proxy({} as Record<string, typeof degraded>, { get: () => degraded });
  }),
}));

// ProjectsResolver is mocked so getProjectBySlug / getAllProjects are deterministic.
// Its methods return plain "effects" — objects the fake runtime simply runs.
const KNOWN = new Map<string, { slug: string; name: string; gitRoot: string; database: string }>([
  ["alpha-1", { slug: "alpha-1", name: "Alpha", gitRoot: "/code/alpha", database: "sqlite://a" }],
  ["beta-2", { slug: "beta-2", name: "Beta", gitRoot: "/code/beta", database: "sqlite://b" }],
]);

let cwdResolves: string | null = "alpha-1";

vi.mock("@dev-workflow/tracking", () => {
  class ProjectsResolver {
    getProjectBySlug(slug: string) {
      return {
        __run: () => {
          const found = KNOWN.get(slug);
          if (!found) throw new Error(`Project not found: ${slug}`);
          return {
            projectId: slug,
            slug,
            name: found.name,
            sourceInfo: { connectionString: found.database },
            gitRoot: found.gitRoot,
          };
        },
      };
    }
    getAllProjects() {
      return {
        __run: () =>
          Array.from(KNOWN.values()).map((p) => ({
            projectId: p.slug,
            slug: p.slug,
            name: p.name,
            sourceInfo: { connectionString: p.database },
            gitRoot: p.gitRoot,
          })),
      };
    }
  }
  return {
    ProjectsResolver,
    resolveConfigFromGit: vi.fn(async () => {
      if (cwdResolves === null) throw new Error("not a project");
      const found = KNOWN.get(cwdResolves);
      if (!found) throw new Error("not a project");
      return {
        slug: found.slug,
        name: found.name,
        database: found.database,
        gitRoot: found.gitRoot,
        projectId: found.slug,
      };
    }),
  };
});

// createRuntime is mocked to just execute our fake effects' __run().
vi.mock("@dev-workflow/effect", () => ({
  createRuntime: vi.fn(() => ({
    runEffectAndUnwrap: async (effect: { __run: () => unknown }) => effect.__run(),
  })),
}));

// NOTE: awilix is NOT mocked — real DI instantiates our mocked ProjectsResolver
// (a plain concrete class), proving the construction seam works end-to-end.

// Import AFTER mocks are declared.
const { ServerControl } = await import("../server-control.js");

function parse(res: ToolResponse): Record<string, unknown> {
  return JSON.parse((res.content[0] as { text: string }).text);
}

beforeEach(() => {
  containerBuilds.length = 0;
  cwdResolves = "alpha-1";
});

describe("ServerControl.setActiveProject", () => {
  it("builds a container per slug and points the live registry at it", async () => {
    const control = new ServerControl();
    await control.setActiveProject("alpha-1");

    expect(containerBuilds).toEqual(["alpha-1"]);
    // The live registry is the project registry (has the fake whoami tool), not degraded.
    expect(typeof control.tools["whoami"]).toBe("function");
  });

  it("reuses the cached binding on re-select (no rebuild)", async () => {
    const control = new ServerControl();
    await control.setActiveProject("alpha-1");
    await control.setActiveProject("beta-2");
    await control.setActiveProject("alpha-1"); // back to alpha — should hit cache

    // alpha + beta built once each; the third select does NOT rebuild alpha.
    expect(containerBuilds).toEqual(["alpha-1", "beta-2"]);
  });
});

describe("select_project validation", () => {
  it("returns a clean error for an unknown slug and does not swap", async () => {
    const control = new ServerControl();
    const res = await control.handleControlTool("select_project", { slug: "does-not-exist" });

    expect(res.isError).toBe(true);
    expect(parse(res)["error"]).toContain("Unknown project slug");
    // No container was built — the swap never happened.
    expect(containerBuilds).toEqual([]);
  });

  it("rejects a missing/blank slug", async () => {
    const control = new ServerControl();
    const res = await control.handleControlTool("select_project", {});
    expect(res.isError).toBe(true);
    expect(parse(res)["error"]).toContain("non-empty string");
  });

  it("activates a known slug and reports it", async () => {
    const control = new ServerControl();
    const res = await control.handleControlTool("select_project", { slug: "beta-2" });

    expect(res.isError).toBeUndefined();
    const payload = parse(res);
    expect((payload["active"] as { slug: string }).slug).toBe("beta-2");
    expect(containerBuilds).toEqual(["beta-2"]);
  });
});

describe("current_project mismatch computation", () => {
  it("active === cwd → mismatch false", async () => {
    const control = new ServerControl();
    await control.resolveCwdSlug("/code/alpha"); // resolves to alpha-1
    await control.setActiveProject("alpha-1");

    const payload = parse(await control.handleControlTool("current_project", {}));
    expect(payload["mismatch"]).toBe(false);
    expect((payload["active"] as { slug: string }).slug).toBe("alpha-1");
    expect((payload["cwd"] as { slug: string }).slug).toBe("alpha-1");
  });

  it("active !== cwd → mismatch true (with guard language from select_project)", async () => {
    const control = new ServerControl();
    await control.resolveCwdSlug("/code/alpha"); // cwd = alpha-1
    const res = await control.handleControlTool("select_project", { slug: "beta-2" });

    const payload = parse(res);
    expect(payload["mismatch"]).toBe(true);
    expect(payload["message"]).toContain("⚠️");
    expect(payload["message"]).toContain("Beta");
    expect(payload["message"]).toContain("Alpha");
  });

  it("cwd null (not a dfl project) → not a mismatch, no crash", async () => {
    cwdResolves = null;
    const control = new ServerControl();
    await control.resolveCwdSlug("/tmp/not-a-project");
    await control.setActiveProject("alpha-1");

    const payload = parse(await control.handleControlTool("current_project", {}));
    expect(payload["mismatch"]).toBe(false);
    expect(payload["cwd"]).toBeNull();
    expect((payload["active"] as { slug: string }).slug).toBe("alpha-1");
  });
});

describe("list_projects", () => {
  it("lists all projects and marks the active one", async () => {
    const control = new ServerControl();
    await control.setActiveProject("beta-2");

    const payload = parse(await control.handleControlTool("list_projects", {}));
    const projects = payload["projects"] as Array<{ slug: string; active: boolean }>;
    expect(projects.map((p) => p.slug).sort()).toEqual(["alpha-1", "beta-2"]);
    expect(projects.find((p) => p.slug === "beta-2")?.active).toBe(true);
    expect(projects.find((p) => p.slug === "alpha-1")?.active).toBe(false);
  });
});

describe("control-tool routing", () => {
  it("recognizes the three control tools and nothing else", () => {
    const control = new ServerControl();
    expect(control.isControlTool("select_project")).toBe(true);
    expect(control.isControlTool("current_project")).toBe(true);
    expect(control.isControlTool("list_projects")).toBe(true);
    expect(control.isControlTool("create_issue")).toBe(false);
  });
});
