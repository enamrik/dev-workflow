import Link from "next/link";
import { clsx } from "clsx";
import { Badge, Modal, Markdown } from "../ui";
import type { Task } from "@/lib/types";

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

interface TaskModalContentProps {
  task: Task;
  issueNumber: number;
  issueUrl: string;
}

function TaskModalContent({
  task,
  issueNumber,
  issueUrl,
}: TaskModalContentProps) {
  return (
    <div className="p-4">
      {/* Header: Task number and title */}
      <div className="font-semibold text-gray-900 text-sm mb-3 pb-2 border-b border-gray-100">
        <Link
          href={issueUrl}
          className="text-blue-600 hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          #{issueNumber}.{task.number}
        </Link>{" "}
        {task.title}
      </div>

      {/* Full description */}
      {task.description && (
        <div className="mb-3">
          <Markdown className="text-sm">{task.description}</Markdown>
        </div>
      )}

      {/* Acceptance criteria */}
      {task.acceptanceCriteria.length > 0 && (
        <div className="mb-3">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
            Acceptance Criteria
          </div>
          <ul className="text-sm text-gray-700 space-y-1">
            {task.acceptanceCriteria.map((criterion, index) => (
              <li key={index} className="flex items-start gap-2">
                <span className="text-gray-400 mt-0.5">-</span>
                <span>{criterion}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Metadata: estimated time and labels */}
      <div className="flex items-center gap-3 pt-2 border-t border-gray-100 text-xs">
        {task.estimatedMinutes && (
          <span className="text-gray-500">
            Est: {task.estimatedMinutes} min
          </span>
        )}
        {task.labels.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            {task.labels.map((label) => (
              <Badge key={label} variant="label" value={label} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CardContent({
  task,
  issueNumber,
  issueUrl,
  projectId,
}: {
  task: Task;
  issueNumber: number;
  issueUrl: string;
  projectId?: string;
}) {
  const isCompleted = task.status === "COMPLETED";
  const isInProgress = task.status === "IN_PROGRESS";
  const isAbandoned = task.status === "ABANDONED";

  return (
    <div
      className={clsx(
        "bg-white rounded-lg shadow-sm border p-3 transition-shadow hover:shadow-md",
        isCompleted && "border-green-200",
        isInProgress && "border-orange-200",
        isAbandoned && "border-red-200 opacity-75",
        !isCompleted && !isInProgress && !isAbandoned && "border-gray-200"
      )}
    >
      {/* Task number and title at top */}
      <div className="font-medium text-gray-800 text-sm mb-1">
        <Link
          href={issueUrl}
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

export function KanbanCard({
  task,
  issueNumber,
  projectId,
}: KanbanCardProps) {
  const issueUrl = projectId
    ? `/projects/${encodeURIComponent(projectId)}/issues/${issueNumber}`
    : `/issues/${issueNumber}`;

  return (
    <Modal
      trigger={
        <CardContent
          task={task}
          issueNumber={issueNumber}
          issueUrl={issueUrl}
          projectId={projectId}
        />
      }
    >
      <TaskModalContent
        task={task}
        issueNumber={issueNumber}
        issueUrl={issueUrl}
      />
    </Modal>
  );
}
