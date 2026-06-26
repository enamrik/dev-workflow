/**
 * CLI Service Tags
 *
 * Effect service tags for CLI command classes.
 * Tag IDs match CliCradle keys exactly for Awilix resolution.
 */

import { Service } from "@dev-workflow/effect";
import type { UninitCommand } from "../commands/uninit-command.js";
import type { InitCommand } from "../commands/init-command.js";
import type { UpdateCommand } from "../commands/update-command.js";
import type { UICommand } from "../commands/ui-command.js";
import type { WorkerCommand } from "../commands/worker-command.js";
import type { ClaudeConfigCommand } from "../commands/claude-config-command.js";
import type { MCPCommand } from "../commands/mcp-command.js";
import type { SetupCommand } from "../commands/setup-command.js";
import type { UninstallCommand } from "../commands/uninstall-command.js";

export class UninitCommandTag extends Service<UninitCommand>()("uninitCommand") {}
export class InitCommandTag extends Service<InitCommand>()("initCommand") {}
export class UpdateCommandTag extends Service<UpdateCommand>()("updateCommand") {}
export class UICommandTag extends Service<UICommand>()("uiCommand") {}
export class WorkerCommandTag extends Service<WorkerCommand>()("workerCommand") {}
export class ClaudeConfigCommandTag extends Service<ClaudeConfigCommand>()("claudeConfigCommand") {}
export class MCPCommandTag extends Service<MCPCommand>()("mcpCommand") {}
export class SetupCommandTag extends Service<SetupCommand>()("setupCommand") {}
export class UninstallCommandTag extends Service<UninstallCommand>()("uninstallCommand") {}
