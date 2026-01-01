/**
 * @dev-workflow/web - Web UI for dev-workflow
 */

export {
  createServer,
  createMultiProjectServer,
  type ServerContext,
  type MultiProjectServerContext,
  type MultiProjectServerResult,
} from "./server.js";
export type { RepositoryContext } from "./routes/index.route.js";
export { MultiProjectService, type Project } from "./application/multi-project-service.js";
