import { Link } from "react-router-dom";
import { clsx } from "clsx";
import { Badge } from "../ui";
import type { Task } from "../../api";

interface KanbanCardProps {
  task: Task;
  issueNumber: number;
  issueTitle: string;
  projectId?: string;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength - 3) + "...";
}

export function KanbanCard({
  task,
  issueNumber,
  issueTitle,
  projectId,
}: KanbanCardProps) {
  const isCompleted = task.status === "COMPLETED";
  const isInProgress = task.status === "IN_PROGRESS";
  const isAbandoned = task.status === "ABANDONED";

  const issueUrl = projectId
    ? `/projects/${encodeURIComponent(projectId)}/issues/${issueNumber}`
    : `/issues/${issueNumber}`;

  return (
    <div
      className={clsx(
        "bg-white rounded-lg shadow-sm border p-3",
        isCompleted && "border-green-200",
        isInProgress && "border-orange-200",
        isAbandoned && "border-red-200 opacity-75",
        !isCompleted && !isInProgress && !isAbandoned && "border-gray-200"
      )}
    >
      {/* Task number and title at top */}
      <div className="font-medium text-gray-800 text-sm mb-1">
        <Link
          to={issueUrl}
          className="text-blue-600 hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          #{issueNumber}.{task.number}
        </Link>{" "}
        {task.title}
      </div>

      {/* Task description */}
      <div className="text-xs text-gray-600 mb-2">
        {truncate(task.description, 100)}
      </div>

      {/* Footer: project and metadata */}
      <div className="flex items-center justify-between text-xs">
        {projectId && (
          <span className="font-medium text-gray-600">{projectId}</span>
        )}
        <div className="flex items-center gap-2">
          {task.estimatedMinutes && (
            <span className="text-gray-500">{task.estimatedMinutes}m</span>
          )}
          {isAbandoned && <Badge variant="status" value="ABANDONED" />}
          {task.sessionId && (
            <span
              className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-medium"
              title={`Session: ${task.sessionId}`}
            >
              Active
            </span>
          )}
          {task.labels.length > 0 && (
            <div className="flex gap-1 flex-wrap">
              {task.labels.slice(0, 2).map((label) => (
                <Badge key={label} variant="label" value={label} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
