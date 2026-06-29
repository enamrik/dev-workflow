/**
 * UpdateCommand — two-phase orchestration.
 *
 * Verifies phase 1 (ReleaseInstaller) runs before phase 2 (UpdateService
 * reconciliation), that --version is forwarded, that an already-on-target
 * result short-circuits phase 2 (full no-op), and that --list neither installs
 * nor reconciles.
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { UpdateCommand } from "../update-command.js";
import type { UpdateService } from "../../application/update.service.js";
import type { UIService } from "../../application/ui.service.js";
import type { ReleaseInstaller, InstallResult } from "../../application/release-installer.js";

beforeAll(() => {
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`process.exit(${code})`);
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterAll(() => {
  vi.restoreAllMocks();
});

function createMockUpdateService(): UpdateService {
  return {
    migrateTrackDirectory: vi.fn().mockResolvedValue({ migrated: false }),
    updateSkills: vi.fn().mockResolvedValue(undefined),
    updateTemplates: vi.fn().mockResolvedValue(undefined),
    updateGlobalTemplates: vi.fn().mockResolvedValue(undefined),
    runMigrations: vi.fn().mockResolvedValue(undefined),
    registerProject: vi.fn().mockResolvedValue({ name: "proj", id: "abcdef1234567890" }),
    migrateIssues: vi.fn().mockResolvedValue({ migrated: 0 }),
    updateMCPServer: vi.fn().mockResolvedValue(undefined),
    configureClaudePermissions: vi.fn().mockResolvedValue({ configured: false }),
  } as unknown as UpdateService;
}

function createMockUiService(): UIService {
  return { restart: vi.fn().mockResolvedValue(undefined) } as unknown as UIService;
}

function createMockReleaseInstaller(result: InstallResult): ReleaseInstaller {
  return {
    installRelease: vi.fn().mockResolvedValue(result),
    listReleases: vi
      .fn()
      .mockResolvedValue([
        { version: "2.0.0", tag: "v2.0.0", publishedAt: "2026-01-02T00:00:00Z" },
      ]),
  } as unknown as ReleaseInstaller;
}

describe("UpdateCommand", () => {
  let updateService: UpdateService;
  let uiService: UIService;

  beforeEach(() => {
    vi.clearAllMocks();
    updateService = createMockUpdateService();
    uiService = createMockUiService();
  });

  it("installs the latest release, then reconciles (phase 1 before phase 2)", async () => {
    const installer = createMockReleaseInstaller({ version: "1.2.3", changed: true });
    const command = new UpdateCommand(updateService, uiService, installer);

    await command.execute({});

    expect(installer.installRelease).toHaveBeenCalledWith({ version: undefined });
    expect(updateService.updateSkills).toHaveBeenCalled();
    expect(updateService.updateMCPServer).toHaveBeenCalled();
    expect(uiService.restart).toHaveBeenCalled();

    // Phase 1 must run before phase 2.
    const installOrder = (installer.installRelease as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0]!;
    const reconcileOrder = (updateService.updateSkills as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0]!;
    expect(installOrder).toBeLessThan(reconcileOrder);
  });

  it("forwards --version to the installer", async () => {
    const installer = createMockReleaseInstaller({ version: "1.0.0", changed: true });
    const command = new UpdateCommand(updateService, uiService, installer);

    await command.execute({ version: "1.0.0" });

    expect(installer.installRelease).toHaveBeenCalledWith({ version: "1.0.0" });
    expect(updateService.updateSkills).toHaveBeenCalled();
  });

  it("is a full no-op (skips phase 2) when already on the target version", async () => {
    const installer = createMockReleaseInstaller({ version: "1.2.3", changed: false });
    const command = new UpdateCommand(updateService, uiService, installer);

    await command.execute({});

    expect(installer.installRelease).toHaveBeenCalled();
    expect(updateService.updateSkills).not.toHaveBeenCalled();
    expect(updateService.runMigrations).not.toHaveBeenCalled();
    expect(uiService.restart).not.toHaveBeenCalled();
  });

  it("--list prints releases without installing or reconciling", async () => {
    const installer = createMockReleaseInstaller({ version: "1.2.3", changed: true });
    const command = new UpdateCommand(updateService, uiService, installer);

    await command.execute({ list: true });

    expect(installer.listReleases).toHaveBeenCalled();
    expect(installer.installRelease).not.toHaveBeenCalled();
    expect(updateService.updateSkills).not.toHaveBeenCalled();
  });
});
