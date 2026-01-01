import { clsx } from "clsx";
import { Badge, Markdown } from "../ui";
import type { Task } from "../../api";

interface TaskItemProps {
  task: Task;
}

function getStatusIcon(status: Task["status"]): string {
  switch (status) {
    case "COMPLETED":
      return "✓";
    case "IN_PROGRESS":
      return "→";
    case "ABANDONED":
      return "✗";
    default:
      return "○";
  }
}

export function TaskItem({ task }: TaskItemProps) {
  const isCompleted = task.status === "COMPLETED";
  const isInProgress = task.status === "IN_PROGRESS";
  const isAbandoned = task.status === "ABANDONED";

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
        <div className="font-medium text-gray-800">{task.title}</div>
        <div className="text-sm text-gray-600 mt-1">
          <Markdown>{task.description}</Markdown>
        </div>

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
