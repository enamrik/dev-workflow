/**
 * ServerControl — owns the MCP server's mutable "which project am I serving?" state.
 *
 * One stdio MCP server is registered globally and spawned per session with cwd =
 * the session's project dir. By default it serves the project its cwd resolves to.
 * A Claude session can SWITCH the served project at runtime, from ANY directory,
 * via the `select_project` control tool — no MCP restart. This class is the host
 * that holds that state (the frozen spots: container cache, resolver, cwd signal,
 * active-slug dispatch) so main.ts stays a thin transport shell.
 *
 * Two slugs are tracked:
 * - `activeSlug`  — the project currently served (drives every issue/task/milestone tool).
 * - `cwdSlug`     — the project the server's cwd physically resolves to (computed once
 *                   at startup). The "where you are" signal that powers the cross-project
 *                   guard: when active !== cwd, the session is operating on a project that
 *                   differs from the user's folder and the skills must confirm before mutating.
 *
 * Containers/registries are built once per slug and reused on re-select, so flipping
 * back and forth between projects never rebuilds (the module-level DbSourceProvider in
 * di/container.ts already shares DB connections across containers).
 */

import { createContainer, asClass, InjectionMode } from "awilix";
import { createRuntime, type Runtime } from "@dev-workflow/effect";
import { ProjectsResolver, resolveConfigFromGit, type ProjectInfo } from "@dev-workflow/tracking";

import { createMcpContainer, type McpContainer } from "./di/container.js";
import {
  createToolsRegistry,
  createDegradedToolsRegistry,
  type ToolsRegistry,
} from "./tools/tools-registry.js";
import { type ToolResponse, successResponse, errorResponse } from "./tools/types.js";

/** A built, reusable bundle for one project slug. */
interface ProjectBinding {
  readonly container: McpContainer;
  readonly tools: ToolsRegistry;
}

/** Result shape shared by select_project / current_project (the guard payload). */
interface ActiveProjectStatus {
  readonly active: { slug: string; name: string; gitRoot: string } | null;
  readonly cwd: { slug: string; name: string; gitRoot: string } | null;
  readonly mismatch: boolean;
}

export class ServerControl {
  /** The slug currently served; null until the first successful setActiveProject. */
  private activeSlug: string | null = null;

  /** The slug the server's cwd resolves to; null when cwd isn't a dfl project. */
  private cwdSlug: string | null = null;

  /** Build-once-per-slug cache of {container, tools}, reused on re-select. */
  private readonly bindingCache = new Map<string, ProjectBinding>();

  /** Display info per slug (name, gitRoot), captured as projects become known. */
  private readonly infoBySlug = new Map<string, ProjectInfo>();

  /** Config-only resolver (never touches a DB); validates slugs + lists projects. */
  private readonly projectsResolver: ProjectsResolver;

  /** Runtime bound to the resolver container — runs resolver Effects with their deps. */
  private readonly runtime: Runtime<{ projectsResolver: ProjectsResolver }>;

  /**
   * The live registry the dispatcher reads. Starts degraded so a tool call that
   * arrives before the cwd project is resolved (or when cwd isn't a project) gets
   * a clean error rather than an undefined-handler crash.
   */
  private toolsRegistry: ToolsRegistry = createDegradedToolsRegistry(
    "dev-workflow MCP server is still starting up; retry in a moment."
  );

  constructor() {
    // ProjectsResolver is an Effect service tag (abstract at the type level);
    // Awilix instantiates the concrete class. A throwaway container is the
    // standard way to obtain an instance without a full MCP container — which
    // matters because the control tools must work even when no project resolves.
    const resolverContainer = createContainer<{ projectsResolver: ProjectsResolver }>({
      injectionMode: InjectionMode.PROXY,
    });
    resolverContainer.register({ projectsResolver: asClass(ProjectsResolver).scoped() });
    this.projectsResolver = resolverContainer.cradle.projectsResolver;
    this.runtime = createRuntime(resolverContainer);
  }

  /** The registry the CallTool dispatcher serves (degraded until a project loads). */
  get tools(): ToolsRegistry {
    return this.toolsRegistry;
  }

  /**
   * Compute the cwd slug ONCE at startup (the "where you physically are" signal).
   * Null when cwd isn't a registered dfl project — that simply means there's no
   * folder-anchored project to mismatch against, never a crash.
   */
  async resolveCwdSlug(cwd: string): Promise<void> {
    try {
      const config = await resolveConfigFromGit(cwd);
      this.cwdSlug = config.slug;
      this.infoBySlug.set(config.slug, {
        projectId: config.projectId,
        slug: config.slug,
        name: config.name,
        sourceInfo: { connectionString: config.database },
        gitRoot: config.gitRoot,
      });
    } catch {
      this.cwdSlug = null;
    }
  }

  /**
   * Make `slug` the active project: get-or-build its {container, tools} from the
   * cache, point the live registry at it, and record it as active. Throws if the
   * slug has no resolvable container (caller decides whether to degrade).
   */
  async setActiveProject(slug: string): Promise<void> {
    let binding = this.bindingCache.get(slug);
    if (!binding) {
      const container = await createMcpContainer(slug);
      binding = { container, tools: createToolsRegistry(container) };
      this.bindingCache.set(slug, binding);
    }
    this.toolsRegistry = binding.tools;
    this.activeSlug = slug;
  }

  /** Serve the degraded registry (cwd isn't a project / container build failed). */
  degrade(reason: string): void {
    this.toolsRegistry = createDegradedToolsRegistry(reason);
  }

  /**
   * Close DB connections for every project selected this session. The module-level
   * DbSourceProvider caches connections by string, so distinct containers may share
   * one DbSource; close() is idempotent, so closing each cached binding is safe.
   */
  close(): void {
    for (const binding of this.bindingCache.values()) {
      binding.container.cradle.dbSource.close();
    }
  }

  /** True when the server-level control tools own this name. */
  isControlTool(name: string): boolean {
    return name === "select_project" || name === "current_project" || name === "list_projects";
  }

  /**
   * Dispatch a server-level control tool. These run BEFORE the per-project
   * `tools[name]` lookup so they remain the escape hatch even when the project
   * registry is degraded.
   */
  async handleControlTool(name: string, args: Record<string, unknown>): Promise<ToolResponse> {
    switch (name) {
      case "select_project":
        return this.selectProject(args);
      case "current_project":
        return this.currentProject();
      case "list_projects":
        return this.listProjects();
      default:
        return errorResponse(`Unknown control tool: ${name}`);
    }
  }

  // ===========================================================================
  // Control tool implementations
  // ===========================================================================

  private async selectProject(args: Record<string, unknown>): Promise<ToolResponse> {
    const slug = args["slug"];
    if (typeof slug !== "string" || slug.trim() === "") {
      return errorResponse("select_project requires a non-empty string 'slug'.");
    }

    // Validate the slug resolves to a known project BEFORE switching.
    let target: ProjectInfo;
    try {
      target = await this.runtime.runEffectAndUnwrap(this.projectsResolver.getProjectBySlug(slug));
    } catch {
      return errorResponse(
        `Unknown project slug: "${slug}". Call list_projects to see available slugs.`
      );
    }
    this.infoBySlug.set(target.slug, target);

    try {
      await this.setActiveProject(slug);
    } catch (error) {
      return errorResponse(
        `Failed to activate project "${slug}": ${
          error instanceof Error ? error.message : String(error)
        }. Run 'dfl init' to (re)create its config.`
      );
    }

    const status = this.status();
    const message = status.mismatch
      ? `⚠️ Now operating on ${target.name} (${target.gitRoot}). Your folder is ` +
        `${status.cwd ? status.cwd.name : "not a dev-workflow project"} (mismatch) — confirm the ` +
        `target project before each create/update/dispatch.`
      : `Now operating on ${target.name} (${target.gitRoot}). This matches your current folder.`;

    return successResponse({ message, ...status });
  }

  private async currentProject(): Promise<ToolResponse> {
    return successResponse(this.status());
  }

  private async listProjects(): Promise<ToolResponse> {
    let projects: ProjectInfo[];
    try {
      projects = await this.runtime.runEffectAndUnwrap(this.projectsResolver.getAllProjects());
    } catch (error) {
      return errorResponse(
        `Failed to list projects: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    return successResponse({
      active: this.activeSlug,
      cwd: this.cwdSlug,
      projects: projects.map((p) => ({
        slug: p.slug,
        name: p.name,
        gitRoot: p.gitRoot,
        active: p.slug === this.activeSlug,
      })),
    });
  }

  /** Build the active/cwd/mismatch payload from current state + known info. */
  private status(): ActiveProjectStatus {
    const active = this.toStatusEntry(this.activeSlug);
    const cwd = this.toStatusEntry(this.cwdSlug);
    // Mismatch is meaningful only when there IS a folder-anchored project to
    // compare against; a null cwd is "no anchor", not a mismatch.
    const mismatch =
      this.activeSlug !== null && this.cwdSlug !== null && this.activeSlug !== this.cwdSlug;
    return { active, cwd, mismatch };
  }

  private toStatusEntry(slug: string | null): ActiveProjectStatus["active"] {
    if (slug === null) return null;
    const info = this.infoBySlug.get(slug);
    return {
      slug,
      name: info?.name ?? slug,
      gitRoot: info?.gitRoot ?? "",
    };
  }
}
