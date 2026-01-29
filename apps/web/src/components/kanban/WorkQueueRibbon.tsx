import Link from "next/link";
import { clsx } from "clsx";
import { Tooltip } from "../ui";
import { isTerminal, isActive } from "@/lib/types";
import type { ProjectIssueWithTasks, Task, ComputedIssueStatus } from "@/lib/types";

interface IssuePreviewTarget {
  projectSlug: string;
  issueNumber: number;
}

/**
 * Status tag config for corner tags
 */
const statusTagConfig: Record<ComputedIssueStatus, { label: string; style: string }> = {
  PLANNED: { label: "plan", style: "bg-slate-100 text-slate-600" },
  OPEN: { label: "open", style: "bg-green-50 text-green-700" },
  IN_PROGRESS: { label: "wip", style: "bg-orange-50 text-orange-600" },
  TASKS_DONE: { label: "done", style: "bg-green-100 text-green-700" },
  CLOSED: { label: "closed", style: "bg-gray-100 text-gray-500" },
};

/**
 * Compute issue status based on issue state and task progress.
 * Uses trait functions (single source of truth).
 */
function computeIssueStatus(issueStatus: string, tasks: Task[]): ComputedIssueStatus {
  if (issueStatus === "PLANNED") {
    return "PLANNED";
  }
  if (issueStatus === "CLOSED") {
    return "CLOSED";
  }
  if (tasks.length === 0) {
    return "OPEN";
  }

  const terminal = tasks.filter(isTerminal).length;
  const active = tasks.filter(isActive).length;

  if (terminal === tasks.length) {
    return "TASKS_DONE";
  }
  if (active === 0) {
    return "OPEN";
  }
  return "IN_PROGRESS";
}

/**
 * Status order for sorting: left (earliest) to right (closest to done)
 */
const STATUS_ORDER: Record<ComputedIssueStatus, number> = {
  PLANNED: 0,
  OPEN: 1,
  IN_PROGRESS: 2,
  TASKS_DONE: 3,
  CLOSED: 4,
};

interface IssueWithStatus {
  issue: ProjectIssueWithTasks["issue"];
  tasks: Task[];
  computedStatus: ComputedIssueStatus;
  projectSlug?: string;
}

interface WorkQueueRibbonProps {
  issuesWithTasks: ProjectIssueWithTasks[];
  onIssueClick?: (target: IssuePreviewTarget) => void;
}

interface IssueCardProps {
  item: IssueWithStatus;
  onIssueClick?: (target: IssuePreviewTarget) => void;
}

function IssueCard({ item, onIssueClick }: IssueCardProps) {
  const issueUrl = item.projectSlug
    ? `/projects/${encodeURIComponent(item.projectSlug)}/issues/${item.issue.number}`
    : `/issues/${item.issue.number}`;

  const taskProgress =
    item.tasks.length > 0 ? `${item.tasks.filter(isTerminal).length}/${item.tasks.length}` : null;

  const statusConfig = statusTagConfig[item.computedStatus];

  const handleCardClick = (e: React.MouseEvent) => {
    // Only handle if we have a callback and projectSlug
    if (onIssueClick && item.projectSlug) {
      e.preventDefault();
      onIssueClick({
        projectSlug: item.projectSlug,
        issueNumber: item.issue.number,
      });
    }
  };

  // If we have an onIssueClick callback, render as a clickable div with a separate link
  // Otherwise, render as a Link for full navigation
  if (onIssueClick && item.projectSlug) {
    return (
      <div
        onClick={handleCardClick}
        className={clsx(
          "relative flex-shrink-0 p-2 pr-3 rounded-lg border border-gray-200 bg-white cursor-pointer",
          "hover:shadow-md hover:border-gray-300 transition-all",
          "min-w-[120px] max-w-[160px]"
        )}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onIssueClick({
              projectSlug: item.projectSlug!,
              issueNumber: item.issue.number,
            });
          }
        }}
      >
        {/* Status tag - corner */}
        <span
          className={clsx(
            "absolute top-0 right-0 text-[8px] font-medium uppercase px-1 py-px rounded-bl",
            statusConfig.style
          )}
        >
          {statusConfig.label}
        </span>

        {/* Task progress tag - top left corner */}
        {taskProgress && (
          <span className="absolute top-0 left-0 text-[8px] font-medium px-1 py-px rounded-br bg-gray-100 text-gray-500">
            {taskProgress}
          </span>
        )}

        {/* Issue number and title - 2 lines max with ellipsis */}
        <Tooltip content={`#${item.issue.number} ${item.issue.title}`} side="top">
          <p
            className="text-[11px] leading-tight overflow-hidden text-gray-700 mt-1"
            style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}
          >
            <Link
              href={issueUrl}
              className="font-medium text-blue-600 hover:text-blue-800 hover:underline"
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
            >
              #{item.issue.number}
            </Link>{" "}
            {item.issue.title}
          </p>
        </Tooltip>
      </div>
    );
  }

  // Default: full card is a link
  return (
    <Link
      href={issueUrl}
      className={clsx(
        "relative flex-shrink-0 p-2 pr-3 rounded-lg border border-gray-200 bg-white",
        "hover:shadow-md hover:border-gray-300 transition-all",
        "min-w-[120px] max-w-[160px]"
      )}
    >
      {/* Status tag - corner */}
      <span
        className={clsx(
          "absolute top-0 right-0 text-[8px] font-medium uppercase px-1 py-px rounded-bl",
          statusConfig.style
        )}
      >
        {statusConfig.label}
      </span>

      {/* Task progress tag - top left corner */}
      {taskProgress && (
        <span className="absolute top-0 left-0 text-[8px] font-medium px-1 py-px rounded-br bg-gray-100 text-gray-500">
          {taskProgress}
        </span>
      )}

      {/* Issue number and title - 2 lines max with ellipsis */}
      <Tooltip content={`#${item.issue.number} ${item.issue.title}`} side="top">
        <p
          className="text-[11px] leading-tight overflow-hidden text-gray-700 mt-1"
          style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}
        >
          <span className="font-medium text-blue-600">#{item.issue.number}</span> {item.issue.title}
        </p>
      </Tooltip>
    </Link>
  );
}

export function WorkQueueRibbon({ issuesWithTasks, onIssueClick }: WorkQueueRibbonProps) {
  // Compute status for each issue (CLOSED issues already filtered at API level)
  const issuesWithStatus: IssueWithStatus[] = issuesWithTasks.map(
    ({ issue, tasks, projectSlug }) => ({
      issue,
      tasks,
      computedStatus: computeIssueStatus(issue.status, tasks),
      projectSlug,
    })
  );

  // Sort by status order (PLANNED on left, TASKS_DONE on right)
  const sortedIssues = [...issuesWithStatus].sort((a, b) => {
    const statusDiff = STATUS_ORDER[a.computedStatus] - STATUS_ORDER[b.computedStatus];
    if (statusDiff !== 0) return statusDiff;
    // Within same status, sort by issue number
    return a.issue.number - b.issue.number;
  });

  if (sortedIssues.length === 0) {
    return null;
  }

  // Group issues by status for visual separation
  const groupedByStatus = sortedIssues.reduce(
    (acc, item) => {
      const status = item.computedStatus;
      if (!acc[status]) {
        acc[status] = [];
      }
      acc[status].push(item);
      return acc;
    },
    {} as Record<ComputedIssueStatus, IssueWithStatus[]>
  );

  const statusLabels: Record<ComputedIssueStatus, string> = {
    PLANNED: "Planned",
    OPEN: "Open",
    IN_PROGRESS: "In Progress",
    TASKS_DONE: "Tasks Done",
    CLOSED: "Closed",
  };

  // CLOSED issues are filtered at API level - only active statuses shown
  const orderedStatuses: ComputedIssueStatus[] = ["TASKS_DONE", "IN_PROGRESS", "OPEN", "PLANNED"];

  return (
    <div className="sticky bottom-0 flex-shrink-0 border-t border-gray-200 bg-gray-50 px-3 md:px-4 py-2 md:py-3 z-10 rounded-b-lg">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
          Work Queue
        </span>
        <span className="text-xs text-gray-400">
          {sortedIssues.length} issue{sortedIssues.length !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="flex gap-3 md:gap-4 overflow-x-auto pb-1 scrollbar-auto-hide">
        {orderedStatuses.map((status) => {
          const issues = groupedByStatus[status];
          if (!issues || issues.length === 0) return null;

          return (
            <div key={status} className="flex-shrink-0">
              <div className="text-[10px] text-gray-400 uppercase tracking-wide mb-1">
                {statusLabels[status]}
              </div>
              <div className="flex gap-2">
                {issues.map((item) => (
                  <IssueCard key={item.issue.id} item={item} onIssueClick={onIssueClick} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
