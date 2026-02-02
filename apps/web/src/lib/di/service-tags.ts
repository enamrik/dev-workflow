import { Service } from "@dev-workflow/effect";
import type { GitWorktreeService } from "@dev-workflow/git/worktrees/git-worktree-service.js";

export { WorkerQueueDbTag } from "@dev-workflow/dispatch/worker-queue-db.js";
export { GitWorktreeServiceTag } from "@dev-workflow/git/worktrees/git-worktree-service.js";
export class WorktreeServiceFactoryTag extends Service<(gitRoot: string) => GitWorktreeService>()(
  "createWorktreeService"
) {}
