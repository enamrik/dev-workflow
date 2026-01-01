import { clsx } from "clsx";
import { Badge, Markdown, Tooltip } from "../ui";
import type { Task } from "@/lib/types";

interface TaskItemProps {
  task: Task;
}

function getStatusIcon(status: Task["status"]): string {
  switch (status) {
    case "COMPLETED":
      return "\u2713";
    case "IN_PROGRESS":
      return "\u2192";
    case "ABANDONED":
      return "\u2717";
    default:
      return "\u25CB";
  }
}

export function TaskItem({ task }: TaskItemProps) {
  const isCompleted = task.status === "COMPLETED";
  const isInProgress = task.status === "IN_PROGRESS";
  const isAbandoned = task.status === "ABANDONED";
  const hasWorktree = !!task.worktreePath;
  const hasPR = !!task.prUrl;

  return (
    <li
      className={clsx(
        "flex gap-4 p-4 rounded-lg border",
        isCompleted && "bg-green-50 border-green-200",
        isInProgress && "bg-orange-50 border-orange-200",
        isAbandoned && "bg-red-50 border-red-200",
        !isCompleted && !isInProgress && !isAbandoned && "bg-gray-50 border-gray-200"
      )}
    >
      <div
        className={clsx(
          "w-6 h-6 flex items-center justify-center rounded-full text-sm font-bold",
          isCompleted && "bg-green-500 text-white",
          isInProgress && "bg-orange-500 text-white",
          isAbandoned && "bg-red-500 text-white",
          !isCompleted && !isInProgress && !isAbandoned && "bg-gray-300 text-gray-600"
        )}
      >
        {getStatusIcon(task.status)}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-800">{task.title}</span>
          {/* Worktree indicator */}
          {hasWorktree && (
            <Tooltip content={task.worktreePath || ""}>
              <span className="text-gray-500" title="Has worktree">
                <BranchIcon />
              </span>
            </Tooltip>
          )}
          {/* PR indicator */}
          {hasPR && (
            <Tooltip content={`PR #${task.prNumber}`}>
              <span className="text-gray-500" title="Has PR">
                <PRIcon />
              </span>
            </Tooltip>
          )}
        </div>
        <div className="text-sm text-gray-600 mt-1">
          <Markdown>{task.description}</Markdown>
        </div>

        {/* Worktree/Branch info */}
        {task.branchName && (
          <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
            <BranchIcon />
            <code className="bg-gray-100 px-1.5 py-0.5 rounded font-mono">
              {task.branchName}
            </code>
          </div>
        )}

        {/* PR info */}
        {task.prUrl && task.prStatus && (
          <div className="mt-2 flex items-center gap-2">
            <a
              href={task.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-600 hover:text-blue-800 hover:underline flex items-center gap-1"
            >
              <PRIcon />
              PR #{task.prNumber}
            </a>
            <Badge variant="prStatus" value={task.prStatus} />
          </div>
        )}

        {task.acceptanceCriteria.length > 0 && (
          <ul className="mt-2 text-sm text-gray-600 list-disc list-inside">
            {task.acceptanceCriteria.map((criterion, idx) => (
              <li key={idx}>{criterion}</li>
            ))}
          </ul>
        )}

        {task.labels.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {task.labels.map((label) => (
              <Badge key={label} variant="label" value={label} />
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col items-end gap-2">
        <Badge variant="status" value={task.status} />
        {task.estimatedMinutes && (
          <span className="text-xs text-gray-500">{task.estimatedMinutes}m</span>
        )}
      </div>
    </li>
  );
}

function BranchIcon() {
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M13 10V3L4 14h7v7l9-11h-7z"
      />
    </svg>
  );
}

function PRIcon() {
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
      />
    </svg>
  );
}
