import React, { useState, useMemo, useEffect } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { exec } from "child_process";
import type {
  KanbanData,
  KanbanTask,
  KanbanIssue,
  WorkerCounts,
  KanbanWorkerAssignment,
  KanbanActions,
} from "../hooks/useKanbanData.js";
import type { TaskStatus } from "@dev-workflow/tracking";
import { ScrollableContent } from "./ScrollableContent.js";

/**
 * View modes for the detail panel
 */
type ViewMode = "task" | "plan" | "details";

/**
 * View mode labels for display
 */
const VIEW_MODE_LABELS: Record<ViewMode, string> = {
  task: "Task",
  plan: "Plan",
  details: "Details",
};

/**
 * Status colors for visual distinction
 */
const STATUS_COLORS: Record<TaskStatus, string> = {
  PLANNED: "gray",
  BACKLOG: "gray",
  READY: "cyan",
  IN_PROGRESS: "yellow",
  PR_REVIEW: "magenta",
  COMPLETED: "green",
  ABANDONED: "red",
};

/**
 * Type badge colors
 */
const TYPE_COLORS: Record<string, string> = {
  FEATURE: "green",
  BUG: "red",
  ENHANCEMENT: "blue",
  TASK: "gray",
  SPIKE: "magenta",
};

/**
 * Short type labels (matches web kanban)
 */
const TYPE_LABELS: Record<string, string> = {
  FEATURE: "feat",
  BUG: "bug",
  ENHANCEMENT: "enh",
  TASK: "task",
  SPIKE: "spike",
};

/**
 * Format time elapsed since a date
 */
function formatTimeElapsed(startedAt: string): string {
  const start = new Date(startedAt).getTime();
  const now = Date.now();
  const minutes = Math.floor((now - start) / 60000);

  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }

  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/**
 * Header component showing project info, workers, and controls
 */
function Header({
  projectName,
  projectSlug,
  lastUpdated,
  intervalMs,
  workers,
  currentProjectIndex,
  projectCount,
}: {
  projectName: string;
  projectSlug: string;
  lastUpdated: Date;
  intervalMs: number;
  workers: WorkerCounts;
  currentProjectIndex: number;
  projectCount: number;
}): React.ReactElement {
  const time = lastUpdated.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const showProjectSwitcher = projectCount > 1;

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="blue" paddingX={1}>
      {/* Top row: project info and workers */}
      <Box justifyContent="space-between">
        <Text>
          <Text>{projectName}</Text>
          <Text color="gray"> ({projectSlug})</Text>
          {showProjectSwitcher && (
            <>
              <Text color="gray"> • </Text>
              <Text color="cyan">
                [{currentProjectIndex + 1}/{projectCount}]
              </Text>
            </>
          )}
        </Text>
        <Text>
          {workers.total > 0 ? (
            <>
              <Text color="gray">workers: </Text>
              <Text color="blue">{workers.active}</Text>
              <Text color="gray"> active </Text>
              <Text color="gray">{workers.idle}</Text>
              <Text color="gray"> idle</Text>
              {workers.dead > 0 && (
                <>
                  <Text color="gray"> </Text>
                  <Text color="red">{workers.dead}</Text>
                  <Text color="red"> dead</Text>
                </>
              )}
            </>
          ) : (
            <Text color="gray">no workers</Text>
          )}
        </Text>
      </Box>
      {/* Bottom row: time and controls */}
      <Box justifyContent="space-between">
        <Text color="gray">
          ↻ {intervalMs / 1000}s • {time}
        </Text>
        <Text color="gray">
          {showProjectSwitcher && (
            <>
              <Text color="yellow">[/]</Text>
              <Text> project • </Text>
            </>
          )}
          <Text color="yellow">↑↓←→</Text> nav • <Text color="yellow">g</Text> goto •{" "}
          <Text color="yellow">a</Text> actions • <Text color="yellow">Enter</Text> expand •{" "}
          <Text color="yellow">Tab</Text> view • <Text color="yellow">o</Text> GH •{" "}
          <Text color="yellow">p</Text> PR • <Text color="yellow">r</Text> refresh •{" "}
          <Text color="yellow">q</Text> quit
        </Text>
      </Box>
    </Box>
  );
}

/**
 * Single task card
 */
function TaskCard({
  task,
  isSelected,
  workerAssignment,
}: {
  task: KanbanTask;
  isSelected: boolean;
  workerAssignment?: KanbanWorkerAssignment;
}): React.ReactElement {
  const typeColor = TYPE_COLORS[task.type] ?? "gray";
  const taskId = `#${task.issueNumber}.${task.taskNumber}`;

  return (
    <Box
      flexDirection="column"
      marginBottom={1}
      borderStyle={isSelected ? "single" : undefined}
      borderColor={isSelected ? "cyan" : undefined}
      paddingX={isSelected ? 1 : 0}
    >
      {/* Task ID and type */}
      <Box>
        <Text bold color={isSelected ? "cyan" : STATUS_COLORS[task.status]}>
          {taskId}
        </Text>
        <Text color="gray"> </Text>
        <Text color={typeColor}>[{TYPE_LABELS[task.type] ?? task.type}]</Text>
      </Box>

      {/* Title (truncated) */}
      <Text dimColor={!isSelected} color={isSelected ? "white" : undefined}>
        {task.title.length > 45 ? `${task.title.slice(0, 42)}...` : task.title}
      </Text>

      {/* Worker assignment for IN_PROGRESS tasks */}
      {workerAssignment && task.status === "IN_PROGRESS" && (
        <Text color="blue">
          👤 {workerAssignment.workerName ?? workerAssignment.workerId.slice(0, 8)}
        </Text>
      )}

      {/* Branch info for IN_PROGRESS */}
      {task.branchName && task.status === "IN_PROGRESS" && (
        <Text color="gray">
          ⎇ {task.branchName.length > 35 ? `${task.branchName.slice(0, 32)}...` : task.branchName}
        </Text>
      )}

      {/* Time elapsed for IN_PROGRESS */}
      {task.startedAt && task.status === "IN_PROGRESS" && (
        <Text color="gray">⏱ {formatTimeElapsed(task.startedAt)}</Text>
      )}

      {/* PR info for PR_REVIEW */}
      {task.prNumber && task.status === "PR_REVIEW" && (
        <Text color="magenta">🔗 PR #{task.prNumber}</Text>
      )}

      {/* GitHub issue for PR_REVIEW */}
      {task.githubIssueNumber && task.status === "PR_REVIEW" && (
        <Text color="gray">🔗 GH #{task.githubIssueNumber}</Text>
      )}
    </Box>
  );
}

/**
 * Priority colors for visual distinction
 */
const PRIORITY_COLORS: Record<string, string> = {
  LOW: "gray",
  MEDIUM: "blue",
  HIGH: "yellow",
  CRITICAL: "red",
};

/**
 * Computed issue status based on task progress
 */
type ComputedIssueStatus = "PLANNED" | "OPEN" | "IN_PROGRESS" | "TASKS_DONE" | "CLOSED";

/**
 * Status display config matching web UI
 */
const COMPUTED_STATUS_CONFIG: Record<ComputedIssueStatus, { label: string; color: string }> = {
  PLANNED: { label: "plan", color: "gray" },
  OPEN: { label: "open", color: "green" },
  IN_PROGRESS: { label: "wip", color: "yellow" },
  TASKS_DONE: { label: "done", color: "green" },
  CLOSED: { label: "closed", color: "gray" },
};

/**
 * Status order for sorting: TASKS_DONE first (closest to done), PLANNED last
 */
const STATUS_ORDER: Record<ComputedIssueStatus, number> = {
  TASKS_DONE: 0,
  IN_PROGRESS: 1,
  OPEN: 2,
  PLANNED: 3,
  CLOSED: 4,
};

/**
 * Ordered statuses for display (left to right: closest to done → backlog)
 */
const ORDERED_STATUSES: ComputedIssueStatus[] = ["TASKS_DONE", "IN_PROGRESS", "OPEN", "PLANNED"];

/**
 * Compute issue status based on issue state and task progress
 */
function computeIssueStatus(
  issueStatus: string,
  tasks: Array<{ status: string }>
): ComputedIssueStatus {
  if (issueStatus === "PLANNED") {
    return "PLANNED";
  }
  if (issueStatus === "CLOSED") {
    return "CLOSED";
  }
  if (tasks.length === 0) {
    return "OPEN";
  }

  const terminal = tasks.filter((t) => t.status === "COMPLETED" || t.status === "ABANDONED").length;
  const active = tasks.filter((t) => t.status === "IN_PROGRESS" || t.status === "PR_REVIEW").length;

  if (terminal === tasks.length) {
    return "TASKS_DONE";
  }
  if (active === 0) {
    return "OPEN";
  }
  return "IN_PROGRESS";
}

/**
 * Issue with computed status
 */
interface IssueWithStatus {
  issue: KanbanIssue;
  computedStatus: ComputedIssueStatus;
  taskProgress: string | null;
}

/**
 * Single issue card in the ribbon
 */
function IssueCard({
  item,
  isSelected,
}: {
  item: IssueWithStatus;
  isSelected: boolean;
}): React.ReactElement {
  const statusConfig = COMPUTED_STATUS_CONFIG[item.computedStatus];

  return (
    <Box
      marginRight={1}
      borderStyle={isSelected ? "round" : "single"}
      borderColor={isSelected ? "cyan" : "gray"}
      paddingX={1}
      flexDirection="column"
    >
      {/* Top row: status tag and task progress */}
      <Box justifyContent="space-between">
        <Text color={statusConfig.color} dimColor={!isSelected}>
          {statusConfig.label}
        </Text>
        {item.taskProgress && (
          <Text color="gray" dimColor>
            {item.taskProgress}
          </Text>
        )}
      </Box>
      {/* Issue number and title */}
      <Box>
        <Text bold={isSelected} color={isSelected ? "cyan" : "blue"}>
          #{item.issue.number}
        </Text>
        <Text color="gray"> </Text>
        <Text dimColor={!isSelected}>
          {item.issue.title.length > 20 ? `${item.issue.title.slice(0, 17)}...` : item.issue.title}
        </Text>
      </Box>
    </Box>
  );
}

/**
 * Work Queue Ribbon showing issues grouped by status (matches web UI design)
 */
function IssuesRibbon({
  issues,
  selectedIssueId,
  isIssueModeActive,
}: {
  issues: KanbanIssue[];
  selectedIssueId: string | null;
  isIssueModeActive: boolean;
}): React.ReactElement {
  // Compute status and task progress for each issue
  const issuesWithStatus: IssueWithStatus[] = issues.map((issue) => {
    const terminal = issue.tasks.filter(
      (t) => t.status === "COMPLETED" || t.status === "ABANDONED"
    ).length;
    const taskProgress = issue.tasks.length > 0 ? `${terminal}/${issue.tasks.length}` : null;

    return {
      issue,
      computedStatus: computeIssueStatus(issue.status, issue.tasks),
      taskProgress,
    };
  });

  // Sort by status order
  const sortedIssues = [...issuesWithStatus].sort((a, b) => {
    const statusDiff = STATUS_ORDER[a.computedStatus] - STATUS_ORDER[b.computedStatus];
    if (statusDiff !== 0) return statusDiff;
    return a.issue.number - b.issue.number;
  });

  // Group by status
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

  if (issues.length === 0) {
    return (
      <Box
        borderStyle="single"
        borderColor={isIssueModeActive ? "cyan" : "gray"}
        paddingX={1}
        marginTop={1}
      >
        <Text color="gray" dimColor>
          No issues in work queue
        </Text>
      </Box>
    );
  }

  return (
    <Box
      borderStyle="single"
      borderColor={isIssueModeActive ? "cyan" : "gray"}
      paddingX={1}
      marginTop={1}
      flexDirection="column"
    >
      {/* Header */}
      <Box marginBottom={1}>
        <Text color="gray" bold>
          Work Queue
        </Text>
        <Text color="gray" dimColor>
          {" "}
          ({issues.length} issue{issues.length !== 1 ? "s" : ""})
        </Text>
      </Box>
      {/* Issues grouped by status */}
      <Box flexDirection="row" flexWrap="wrap">
        {ORDERED_STATUSES.map((status) => {
          const statusIssues = groupedByStatus[status];
          if (!statusIssues || statusIssues.length === 0) return null;

          const statusConfig = COMPUTED_STATUS_CONFIG[status];

          return (
            <Box key={status} marginRight={2} flexDirection="column">
              {/* Status header */}
              <Text color={statusConfig.color} dimColor bold>
                {statusConfig.label.toUpperCase()}
              </Text>
              {/* Issue cards */}
              <Box flexDirection="row" flexWrap="wrap">
                {statusIssues.map((item) => (
                  <IssueCard
                    key={item.issue.id}
                    item={item}
                    isSelected={item.issue.id === selectedIssueId}
                  />
                ))}
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

/**
 * Issue details panel showing full issue information
 */
function IssueDetailsPanel({
  issue,
  scrollOffset,
  maxLines,
  isExpanded,
}: {
  issue: KanbanIssue;
  scrollOffset: number;
  maxLines: number;
  isExpanded: boolean;
}): React.ReactElement {
  const typeColor = TYPE_COLORS[issue.type] ?? "gray";
  const priorityColor = PRIORITY_COLORS[issue.priority] ?? "gray";

  // Build content for scrollable display
  const contentLines: string[] = [];

  // Description section
  contentLines.push("## Description");
  contentLines.push(issue.description || "No description");
  contentLines.push("");

  // Acceptance Criteria section
  if (issue.acceptanceCriteria && issue.acceptanceCriteria.length > 0) {
    contentLines.push("## Acceptance Criteria");
    issue.acceptanceCriteria.forEach((criterion) => {
      contentLines.push(`• ${criterion}`);
    });
    contentLines.push("");
  }

  // Plan Summary section
  if (issue.planSummary) {
    contentLines.push("## Plan Summary");
    contentLines.push(issue.planSummary);
    contentLines.push("");
  }

  // Plan Approach section (if available)
  if (issue.planApproach) {
    contentLines.push("## Approach");
    contentLines.push(issue.planApproach);
    contentLines.push("");
  }

  // Tasks section
  if (issue.tasks.length > 0) {
    contentLines.push("## Tasks");
    issue.tasks.forEach((task) => {
      const statusIcon =
        task.status === "COMPLETED"
          ? "✓"
          : task.status === "IN_PROGRESS"
            ? "⏳"
            : task.status === "PR_REVIEW"
              ? "🔍"
              : task.status === "ABANDONED"
                ? "✗"
                : "○";
      contentLines.push(`${statusIcon} ${task.number}. ${task.title} [${task.status}]`);
    });
  } else {
    contentLines.push("## Tasks");
    contentLines.push("No tasks planned yet");
  }

  const content = contentLines.join("\n");

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="cyan"
      paddingX={2}
      paddingY={1}
      marginTop={1}
    >
      {/* Header row */}
      <Box justifyContent="space-between">
        <Box>
          <Text bold color="cyan">
            #{issue.number}
          </Text>
          <Text color="gray"> • </Text>
          <Text color={typeColor}>{TYPE_LABELS[issue.type] ?? issue.type}</Text>
          <Text color="gray"> • </Text>
          <Text color={priorityColor}>{issue.priority}</Text>
          <Text color="gray"> • </Text>
          <Text color={STATUS_COLORS[issue.status as TaskStatus] ?? "white"}>{issue.status}</Text>
          {issue.milestone && (
            <>
              <Text color="gray"> • </Text>
              <Text color="magenta">
                M{issue.milestone.number}: {issue.milestone.title}
              </Text>
            </>
          )}
        </Box>
        <Box>
          {isExpanded ? (
            <>
              <Text color="yellow">[Esc]</Text>
              <Text color="gray"> collapse • </Text>
              <Text color="yellow">[PgUp/Dn]</Text>
              <Text color="gray"> scroll</Text>
            </>
          ) : (
            <>
              <Text color="yellow">[Enter]</Text>
              <Text color="gray"> expand • </Text>
              <Text color="yellow">[PgUp/Dn]</Text>
              <Text color="gray"> scroll</Text>
            </>
          )}
        </Box>
      </Box>

      {/* Full title */}
      <Box marginTop={1}>
        <Text bold>{issue.title}</Text>
      </Box>

      {/* Scrollable content */}
      <Box marginTop={1} flexDirection="column">
        <ScrollableContent content={content} maxLines={maxLines} scrollOffset={scrollOffset} />
      </Box>
    </Box>
  );
}

/**
 * Task view content - shows description and acceptance criteria
 */
function TaskViewContent({
  task,
  scrollOffset,
  maxLines,
}: {
  task: KanbanTask;
  scrollOffset: number;
  maxLines: number;
}): React.ReactElement {
  // Build the full content as a single string for scrolling
  const contentLines: string[] = [];

  // Description section
  contentLines.push("Description");
  contentLines.push(task.description || "No description");

  // Acceptance Criteria section
  if (task.acceptanceCriteria && task.acceptanceCriteria.length > 0) {
    contentLines.push(""); // blank line separator
    contentLines.push("Acceptance Criteria");
    task.acceptanceCriteria.forEach((criterion) => {
      contentLines.push(`• ${criterion}`);
    });
  }

  const content = contentLines.join("\n");

  return (
    <Box marginTop={1} flexDirection="column">
      <ScrollableContent content={content} maxLines={maxLines} scrollOffset={scrollOffset} />
    </Box>
  );
}

/**
 * Plan view content - shows implementation plan
 */
function PlanViewContent({
  task,
  scrollOffset,
  maxLines,
}: {
  task: KanbanTask;
  scrollOffset: number;
  maxLines: number;
}): React.ReactElement {
  const contentLines: string[] = [];
  contentLines.push("Implementation Plan");
  contentLines.push(task.implementationPlan || "No implementation plan available");

  const content = contentLines.join("\n");

  return (
    <Box marginTop={1} flexDirection="column">
      <ScrollableContent content={content} maxLines={maxLines} scrollOffset={scrollOffset} />
    </Box>
  );
}

/**
 * Details view content - shows branch, PR, GitHub link, and timing
 */
function DetailsViewContent({
  task,
  scrollOffset,
  maxLines,
}: {
  task: KanbanTask;
  scrollOffset: number;
  maxLines: number;
}): React.ReactElement {
  const contentLines: string[] = [];

  // Branch info
  if (task.branchName) {
    contentLines.push("Branch");
    contentLines.push(`⎇ ${task.branchName}`);
    contentLines.push(""); // separator
  }

  // Links section
  contentLines.push("Links");
  if (task.githubUrl) {
    contentLines.push(`[o] ${task.githubUrl}`);
  } else if (task.githubIssueNumber) {
    contentLines.push(`GH #${task.githubIssueNumber} (no URL)`);
  } else {
    contentLines.push("No GitHub link");
  }

  if (task.prUrl) {
    contentLines.push(`[p] ${task.prUrl}`);
  } else if (task.prNumber) {
    contentLines.push(`PR #${task.prNumber} (no URL)`);
  } else {
    contentLines.push("No PR");
  }

  contentLines.push(""); // separator

  // Timing section
  contentLines.push("Timing");
  contentLines.push(`Created: ${new Date(task.createdAt).toLocaleString()}`);
  if (task.startedAt) {
    contentLines.push(`Started: ${new Date(task.startedAt).toLocaleString()}`);
    contentLines.push(`Elapsed: ${formatTimeElapsed(task.startedAt)}`);
  }
  if (task.submittedForReviewAt) {
    contentLines.push(
      `Submitted for review: ${new Date(task.submittedForReviewAt).toLocaleString()}`
    );
  }
  if (task.completedAt) {
    contentLines.push(`Completed: ${new Date(task.completedAt).toLocaleString()}`);
  }
  if (task.abandonedAt) {
    contentLines.push(`Abandoned: ${new Date(task.abandonedAt).toLocaleString()}`);
  }

  const content = contentLines.join("\n");

  return (
    <Box marginTop={1} flexDirection="column">
      <ScrollableContent content={content} maxLines={maxLines} scrollOffset={scrollOffset} />
    </Box>
  );
}

/**
 * Detail panel showing full task information with multiple views
 */
function DetailPanel({
  task,
  viewMode,
  scrollOffset,
  maxLines,
  isExpanded,
}: {
  task: KanbanTask;
  viewMode: ViewMode;
  scrollOffset: number;
  maxLines: number;
  isExpanded: boolean;
}): React.ReactElement {
  const taskId = `#${task.issueNumber}.${task.taskNumber}`;
  const typeColor = TYPE_COLORS[task.type] ?? "gray";

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="cyan"
      paddingX={2}
      paddingY={1}
      marginTop={1}
    >
      {/* Header row with view indicator */}
      <Box justifyContent="space-between">
        <Box>
          <Text bold color="cyan">
            {taskId}
          </Text>
          <Text color="gray"> • </Text>
          <Text color={typeColor}>{TYPE_LABELS[task.type] ?? task.type}</Text>
          <Text color="gray"> • </Text>
          <Text color={STATUS_COLORS[task.status]}>{task.status}</Text>
        </Box>
        <Box>
          <Text color="gray">[</Text>
          <Text bold color="cyan">
            {VIEW_MODE_LABELS[viewMode]}
          </Text>
          <Text color="gray">] </Text>
          {isExpanded ? (
            <>
              <Text color="yellow">[Esc]</Text>
              <Text color="gray"> collapse • </Text>
            </>
          ) : (
            <>
              <Text color="yellow">[Enter]</Text>
              <Text color="gray"> expand • </Text>
            </>
          )}
          <Text color="yellow">[Tab]</Text>
          <Text color="gray"> view • </Text>
          <Text color="yellow">[PgUp/Dn]</Text>
          <Text color="gray"> scroll</Text>
        </Box>
      </Box>

      {/* Full title */}
      <Box marginTop={1}>
        <Text bold>{task.title}</Text>
      </Box>

      {/* View-specific content */}
      {viewMode === "task" && (
        <TaskViewContent task={task} scrollOffset={scrollOffset} maxLines={maxLines} />
      )}
      {viewMode === "plan" && (
        <PlanViewContent task={task} scrollOffset={scrollOffset} maxLines={maxLines} />
      )}
      {viewMode === "details" && (
        <DetailsViewContent task={task} scrollOffset={scrollOffset} maxLines={maxLines} />
      )}
    </Box>
  );
}

/**
 * Max visible tasks per column before scrolling
 */
const MAX_VISIBLE_TASKS = 5;

/**
 * Kanban column with virtual scrolling
 */
function KanbanColumn({
  label,
  status,
  tasks,
  width,
  selectedTaskId,
  scrollOffset,
  workerAssignments,
}: {
  label: string;
  status: TaskStatus;
  tasks: KanbanTask[];
  width: number;
  selectedTaskId: string | null;
  scrollOffset: number;
  workerAssignments: Map<string, KanbanWorkerAssignment>;
}): React.ReactElement {
  const headerColor = STATUS_COLORS[status];

  // Calculate visible window
  const visibleTasks = tasks.slice(scrollOffset, scrollOffset + MAX_VISIBLE_TASKS);
  const hasMoreAbove = scrollOffset > 0;
  const hasMoreBelow = scrollOffset + MAX_VISIBLE_TASKS < tasks.length;

  return (
    <Box flexDirection="column" width={width} borderStyle="single" borderColor="gray" paddingX={1}>
      {/* Column header */}
      <Box marginBottom={1}>
        <Text bold color={headerColor}>
          {label}
        </Text>
        <Text color="gray"> ({tasks.length})</Text>
      </Box>

      {/* Separator */}
      <Text color="gray">{"─".repeat(width - 4)}</Text>

      {/* Scroll up indicator */}
      {hasMoreAbove && (
        <Text color="cyan" dimColor>
          ▲ {scrollOffset} more
        </Text>
      )}

      {/* Tasks */}
      <Box flexDirection="column" marginTop={hasMoreAbove ? 0 : 1}>
        {tasks.length === 0 ? (
          <Text color="gray" dimColor>
            No tasks
          </Text>
        ) : (
          visibleTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              isSelected={task.id === selectedTaskId}
              workerAssignment={workerAssignments.get(task.id)}
            />
          ))
        )}
      </Box>

      {/* Scroll down indicator */}
      {hasMoreBelow && (
        <Text color="cyan" dimColor>
          ▼ {tasks.length - scrollOffset - MAX_VISIBLE_TASKS} more
        </Text>
      )}
    </Box>
  );
}

/**
 * Loading indicator
 */
function Loading(): React.ReactElement {
  return (
    <Box padding={2}>
      <Text color="yellow">Loading...</Text>
    </Box>
  );
}

/**
 * Error display
 */
function ErrorDisplay({ error }: { error: Error }): React.ReactElement {
  return (
    <Box padding={2} flexDirection="column">
      <Text color="red" bold>
        Error loading data
      </Text>
      <Text color="red">{error.message}</Text>
    </Box>
  );
}

/**
 * Open a URL in the default browser
 */
function openUrl(url: string): void {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  exec(`${command} "${url}"`);
}

/**
 * Main Kanban board component
 */
export function KanbanBoard({
  data,
  loading,
  error,
  intervalMs,
  onRefresh,
  currentProjectIndex = 0,
  projectCount = 1,
  onProjectChange,
  actions,
}: {
  data: KanbanData | null;
  loading: boolean;
  error: Error | null;
  intervalMs: number;
  onRefresh: () => void;
  currentProjectIndex?: number;
  projectCount?: number;
  onProjectChange?: (index: number) => void;
  actions?: KanbanActions;
}): React.ReactElement {
  const { exit } = useApp();

  // Unified selection state - either an issue or task is selected, not both
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);

  // View mode for task detail panel
  const [viewMode, setViewMode] = useState<ViewMode>("task");
  const [detailScrollOffset, setDetailScrollOffset] = useState(0);

  // Panel expanded state - when true, panel takes full screen
  const [isPanelExpanded, setIsPanelExpanded] = useState(false);

  // Action menu state
  const [showActionMenu, setShowActionMenu] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // Goto mode state (for jumping to issue/task by number)
  const [gotoMode, setGotoMode] = useState(false);
  const [gotoInput, setGotoInput] = useState("");

  // Calculate max visible lines for detail panel based on terminal height and expanded state
  const terminalRows = process.stdout.rows || 24;
  // Collapsed: small panel (5 lines)
  // Expanded: ~90% of terminal height (reserve 8 lines for header + panel borders)
  const COLLAPSED_PANEL_LINES = 5;
  const EXPANDED_PANEL_LINES = Math.max(12, Math.floor((terminalRows - 8) * 0.9));
  const detailMaxLines = isPanelExpanded ? EXPANDED_PANEL_LINES : COLLAPSED_PANEL_LINES;

  // Get selected issue
  const selectedIssue = useMemo(() => {
    if (!selectedIssueId || !data) return null;
    return data.issues.find((i) => i.id === selectedIssueId) ?? null;
  }, [selectedIssueId, data]);

  // Sort issues by computed status (matches display order in ribbon)
  const sortedIssues = useMemo(() => {
    if (!data) return [];
    return [...data.issues].sort((a, b) => {
      const statusA = computeIssueStatus(a.status, a.tasks);
      const statusB = computeIssueStatus(b.status, b.tasks);
      const statusDiff = STATUS_ORDER[statusA] - STATUS_ORDER[statusB];
      if (statusDiff !== 0) return statusDiff;
      return a.number - b.number;
    });
  }, [data]);

  // Reset view mode and scroll when selection changes
  useEffect(() => {
    setViewMode("task");
    setDetailScrollOffset(0);
  }, [selectedTaskId, selectedIssueId]);

  // Reset scroll when view mode changes
  useEffect(() => {
    setDetailScrollOffset(0);
  }, [viewMode]);

  // Determine if issue ribbon is active (an issue is selected)
  const isIssueSelected = selectedIssueId !== null;

  // Cycle through view modes: task -> plan -> details -> task
  const cycleViewMode = (): void => {
    setViewMode((current) => {
      switch (current) {
        case "task":
          return "plan";
        case "plan":
          return "details";
        case "details":
          return "task";
      }
    });
  };

  // Build flat list of all tasks for navigation
  const allTasks = useMemo(() => {
    if (!data) return [];
    const tasks: Array<{ task: KanbanTask; columnIndex: number; taskIndex: number }> = [];
    data.columns.forEach((column, columnIndex) => {
      column.tasks.forEach((task, taskIndex) => {
        tasks.push({ task, columnIndex, taskIndex });
      });
    });
    return tasks;
  }, [data]);

  // Get currently selected task with its position
  const selectedTaskInfo = useMemo(() => {
    if (!selectedTaskId) return null;
    return allTasks.find((t) => t.task.id === selectedTaskId) ?? null;
  }, [selectedTaskId, allTasks]);

  const selectedTask = selectedTaskInfo?.task ?? null;

  // Calculate scroll offsets per column to keep selected task visible
  const columnScrollOffsets = useMemo(() => {
    if (!data) return {};
    const offsets: Record<number, number> = {};

    data.columns.forEach((_, columnIndex) => {
      offsets[columnIndex] = 0;
    });

    // If a task is selected, scroll its column to show it
    if (selectedTaskInfo) {
      const { columnIndex, taskIndex } = selectedTaskInfo;
      // Scroll so selected task is visible in the window
      if (taskIndex >= MAX_VISIBLE_TASKS) {
        // Task is below visible area, scroll down
        offsets[columnIndex] = Math.min(
          taskIndex - MAX_VISIBLE_TASKS + 1,
          (data.columns[columnIndex]?.tasks.length ?? 0) - MAX_VISIBLE_TASKS
        );
      }
      if (taskIndex < (offsets[columnIndex] ?? 0)) {
        // Task is above visible area, scroll up
        offsets[columnIndex] = taskIndex;
      }
    }

    return offsets;
  }, [data, selectedTaskInfo]);

  // Helper to select an issue and clear task selection
  const selectIssue = (issueId: string | null): void => {
    setSelectedIssueId(issueId);
    setSelectedTaskId(null);
  };

  // Helper to select a task and clear issue selection
  const selectTask = (taskId: string | null): void => {
    setSelectedTaskId(taskId);
    setSelectedIssueId(null);
  };

  /**
   * Action definition for quick actions menu
   */
  interface QuickAction {
    key: string; // Number key to press
    label: string;
    execute: () => Promise<void>; // Action to execute
  }

  /**
   * Execute an action and show result
   */
  const executeAction = async (action: QuickAction): Promise<void> => {
    setShowActionMenu(false);
    setActionMessage(`Executing: ${action.label}...`);
    try {
      await action.execute();
    } catch (error) {
      setActionMessage(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  /**
   * Get available actions for a task based on its status
   */
  const getTaskActions = (task: KanbanTask): QuickAction[] => {
    if (!actions) return [];
    const taskActions: QuickAction[] = [];

    switch (task.status) {
      case "PLANNED":
        // Tasks in PLANNED need their issue activated first - no direct action
        break;

      case "BACKLOG":
        taskActions.push({
          key: "1",
          label: "Move to Ready",
          execute: async () => {
            const result = await actions.moveToReady(task.id);
            setActionMessage(result.message);
            if (result.success) onRefresh();
          },
        });
        taskActions.push({
          key: "2",
          label: "Start (→ In Progress)",
          execute: async () => {
            const result = await actions.start(task.id);
            setActionMessage(result.message);
            if (result.success) onRefresh();
          },
        });
        taskActions.push({
          key: "3",
          label: "Abandon",
          execute: async () => {
            const result = await actions.abandonTask(task.id);
            setActionMessage(result.message);
            if (result.success) onRefresh();
          },
        });
        break;

      case "READY":
        taskActions.push({
          key: "1",
          label: "Start (→ In Progress)",
          execute: async () => {
            const result = await actions.start(task.id);
            setActionMessage(result.message);
            if (result.success) onRefresh();
          },
        });
        taskActions.push({
          key: "2",
          label: "Move to Backlog",
          execute: async () => {
            const result = await actions.moveToBacklog(task.id);
            setActionMessage(result.message);
            if (result.success) onRefresh();
          },
        });
        taskActions.push({
          key: "3",
          label: "Abandon",
          execute: async () => {
            const result = await actions.abandonTask(task.id);
            setActionMessage(result.message);
            if (result.success) onRefresh();
          },
        });
        break;

      case "IN_PROGRESS":
        taskActions.push({
          key: "1",
          label: "Submit for Review",
          execute: async () => {
            const result = await actions.submitForReview(task.id);
            setActionMessage(result.message);
            if (result.success) onRefresh();
          },
        });
        taskActions.push({
          key: "2",
          label: "Complete",
          execute: async () => {
            const result = await actions.complete(task.id);
            setActionMessage(result.message);
            if (result.success) onRefresh();
          },
        });
        taskActions.push({
          key: "3",
          label: "Abandon",
          execute: async () => {
            const result = await actions.abandonTask(task.id);
            setActionMessage(result.message);
            if (result.success) onRefresh();
          },
        });
        break;

      case "PR_REVIEW":
        taskActions.push({
          key: "1",
          label: "Complete (merge)",
          execute: async () => {
            const result = await actions.complete(task.id);
            setActionMessage(result.message);
            if (result.success) onRefresh();
          },
        });
        taskActions.push({
          key: "2",
          label: "Abandon",
          execute: async () => {
            const result = await actions.abandonTask(task.id);
            setActionMessage(result.message);
            if (result.success) onRefresh();
          },
        });
        break;

      case "COMPLETED":
      case "ABANDONED":
        // Terminal states - no actions available
        break;
    }

    return taskActions;
  };

  /**
   * Get available actions for an issue
   */
  const getIssueActions = (issue: KanbanIssue): QuickAction[] => {
    if (!actions) return [];
    const issueActions: QuickAction[] = [];

    if (issue.status === "PLANNED") {
      // PLANNED issues can be activated (moves tasks to BACKLOG)
      issueActions.push({
        key: "1",
        label: "Activate (→ Open)",
        execute: async () => {
          const result = await actions.updateIssueStatus(issue.id, "OPEN");
          setActionMessage(result.message);
          if (result.success) onRefresh();
        },
      });
    } else if (issue.status === "OPEN") {
      // OPEN issues can have tasks moved to ready, or be closed
      issueActions.push({
        key: "1",
        label: "Move tasks to Ready",
        execute: async () => {
          const result = await actions.activateIssueTasks(issue.id);
          setActionMessage(result.message);
          if (result.success) onRefresh();
        },
      });
      issueActions.push({
        key: "2",
        label: "Move to Planned",
        execute: async () => {
          const result = await actions.updateIssueStatus(issue.id, "PLANNED");
          setActionMessage(result.message);
          if (result.success) onRefresh();
        },
      });
      issueActions.push({
        key: "3",
        label: "Close issue",
        execute: async () => {
          const result = await actions.closeIssue(issue.id);
          setActionMessage(result.message);
          if (result.success) onRefresh();
        },
      });
    } else if (issue.status !== "CLOSED") {
      // IN_PROGRESS or other non-closed issues
      issueActions.push({
        key: "1",
        label: "Close issue",
        execute: async () => {
          const result = await actions.closeIssue(issue.id);
          setActionMessage(result.message);
          if (result.success) onRefresh();
        },
      });
    }

    return issueActions;
  };

  // Get current actions based on selection
  const currentActions = useMemo(() => {
    if (selectedTask) {
      return getTaskActions(selectedTask);
    }
    if (selectedIssue) {
      return getIssueActions(selectedIssue);
    }
    return [];
  }, [selectedTask, selectedIssue]);

  // Clear action message after 5 seconds
  useEffect(() => {
    if (!actionMessage) return;
    const timer = setTimeout(() => setActionMessage(null), 5000);
    return () => clearTimeout(timer);
  }, [actionMessage]);

  // Handle goto mode - find issue or task by number
  const handleGoto = (input: string): void => {
    if (!data) return;

    // Check if it's an issue.task format (e.g., "5.2")
    if (input.includes(".")) {
      const [issueNumStr, taskNumStr] = input.split(".");
      const issueNum = parseInt(issueNumStr ?? "", 10);
      const taskNum = parseInt(taskNumStr ?? "", 10);

      if (!isNaN(issueNum) && !isNaN(taskNum)) {
        // Find task by issue number and task number
        const taskInfo = allTasks.find(
          (t) => t.task.issueNumber === issueNum && t.task.taskNumber === taskNum
        );
        if (taskInfo) {
          selectTask(taskInfo.task.id);
          setActionMessage(`Jumped to task #${issueNum}.${taskNum}`);
          return;
        }
      }
      setActionMessage(`Task ${input} not found`);
      return;
    }

    // Try as issue number
    const num = parseInt(input, 10);
    if (!isNaN(num)) {
      const issue = sortedIssues.find((i) => i.number === num);
      if (issue) {
        selectIssue(issue.id);
        setActionMessage(`Jumped to issue #${num}`);
        return;
      }

      // Also check if it's a task in format "N" where we jump to issue N's first task
      const issueData = data.issues.find((i) => i.number === num);
      if (issueData && issueData.tasks.length > 0) {
        const firstTaskNum = issueData.tasks[0]?.number;
        if (firstTaskNum !== undefined) {
          const taskInfo = allTasks.find(
            (t) => t.task.issueNumber === num && t.task.taskNumber === firstTaskNum
          );
          if (taskInfo) {
            selectTask(taskInfo.task.id);
            setActionMessage(`Jumped to task #${num}.${firstTaskNum}`);
            return;
          }
        }
      }

      setActionMessage(`Issue #${num} not found`);
    }
  };

  // Handle keyboard input
  useInput((input, key) => {
    // =========================================================================
    // Goto mode - typing issue/task number to jump to
    // =========================================================================
    if (gotoMode) {
      if (key.escape) {
        setGotoMode(false);
        setGotoInput("");
        return;
      }
      if (key.return) {
        handleGoto(gotoInput);
        setGotoMode(false);
        setGotoInput("");
        return;
      }
      if (key.backspace || key.delete) {
        setGotoInput((prev) => prev.slice(0, -1));
        return;
      }
      // Accept digits and dots
      if (/^[0-9.]$/.test(input)) {
        setGotoInput((prev) => prev + input);
        return;
      }
      return; // Ignore other keys in goto mode
    }

    // =========================================================================
    // Action menu mode - selecting an action to perform
    // =========================================================================
    if (showActionMenu) {
      if (key.escape) {
        setShowActionMenu(false);
        return;
      }
      // Number keys to select action
      const actionIndex = parseInt(input, 10);
      if (!isNaN(actionIndex) && actionIndex >= 1 && actionIndex <= currentActions.length) {
        const action = currentActions[actionIndex - 1];
        if (action) {
          executeAction(action);
        }
        return;
      }
      return; // Ignore other keys in action menu
    }

    // =========================================================================
    // Normal mode
    // =========================================================================
    if (input === "q" || (key.ctrl && input === "c")) {
      exit();
    }
    if (input === "r") {
      onRefresh();
    }

    // 'g' to enter goto mode
    if (input === "g" && !isPanelExpanded) {
      setGotoMode(true);
      setGotoInput("");
      return;
    }

    // 'a' to toggle action menu (when something is selected)
    if (input === "a" && (selectedTaskId || selectedIssueId) && currentActions.length > 0) {
      setShowActionMenu(!showActionMenu);
      return;
    }

    // Project switching with [ and ]
    if (projectCount > 1 && onProjectChange) {
      if (input === "[") {
        const newIndex = currentProjectIndex === 0 ? projectCount - 1 : currentProjectIndex - 1;
        onProjectChange(newIndex);
        setSelectedTaskId(null);
        setSelectedIssueId(null);
        return;
      }
      if (input === "]") {
        const newIndex = (currentProjectIndex + 1) % projectCount;
        onProjectChange(newIndex);
        setSelectedTaskId(null);
        setSelectedIssueId(null);
        return;
      }
    }

    // Tab key to cycle view modes (only when a task is selected)
    if (key.tab && selectedTaskId) {
      cycleViewMode();
      return;
    }

    // Enter to toggle panel expansion (when something is selected)
    if (key.return && (selectedTaskId || selectedIssueId)) {
      // Clear screen and move cursor to top to prevent ghost frames
      process.stdout.write("\x1b[2J\x1b[H");
      setIsPanelExpanded((prev) => !prev);
      setDetailScrollOffset(0); // Reset scroll to top when toggling
      return;
    }

    // Escape: if panel expanded, collapse it; otherwise clear selection
    if (key.escape) {
      if (isPanelExpanded) {
        // Clear screen when collapsing to prevent ghost frames
        process.stdout.write("\x1b[2J\x1b[H");
        setIsPanelExpanded(false);
        setDetailScrollOffset(0);
      } else {
        setSelectedTaskId(null);
        setSelectedIssueId(null);
      }
      return;
    }

    // PageUp/PageDown to scroll detail panel content
    if (key.pageUp) {
      setDetailScrollOffset((prev) => Math.max(0, prev - 5));
      return;
    }
    if (key.pageDown) {
      setDetailScrollOffset((prev) => prev + 5);
      return;
    }

    // Open GitHub URL (for selected task)
    if (input === "o" && selectedTask?.githubUrl) {
      openUrl(selectedTask.githubUrl);
      return;
    }

    // Open PR URL (for selected task)
    if (input === "p" && selectedTask?.prUrl) {
      openUrl(selectedTask.prUrl);
      return;
    }

    // =========================================================================
    // Unified arrow key navigation between issues (ribbon) and tasks (columns)
    // Disabled when panel is expanded (user should focus on reading)
    // =========================================================================
    if ((key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) && !isPanelExpanded) {
      // Nothing selected - start with first task or first issue
      if (!selectedTaskId && !selectedIssueId) {
        if (allTasks.length > 0) {
          selectTask(allTasks[0]?.task.id ?? null);
        } else if (sortedIssues.length > 0) {
          selectIssue(sortedIssues[0]?.id ?? null);
        }
        return;
      }

      // Issue is selected - navigate in ribbon or move down to tasks
      if (isIssueSelected) {
        const currentIssueIndex = sortedIssues.findIndex((i) => i.id === selectedIssueId);

        if (key.leftArrow && currentIssueIndex > 0) {
          // Move left in ribbon
          selectIssue(sortedIssues[currentIssueIndex - 1]?.id ?? null);
        } else if (key.rightArrow && currentIssueIndex < sortedIssues.length - 1) {
          // Move right in ribbon
          selectIssue(sortedIssues[currentIssueIndex + 1]?.id ?? null);
        } else if (key.downArrow) {
          // Move down to tasks - select first task in first non-empty column
          if (allTasks.length > 0) {
            selectTask(allTasks[0]?.task.id ?? null);
          }
        }
        // Up arrow in ribbon does nothing (already at top)
        return;
      }

      // Task is selected - navigate in columns or move up to ribbon
      if (selectedTaskId && data) {
        const currentTaskInfo = allTasks.find((t) => t.task.id === selectedTaskId);
        if (!currentTaskInfo) {
          selectTask(allTasks[0]?.task.id ?? null);
          return;
        }

        const { columnIndex, taskIndex } = currentTaskInfo;
        const tasksInColumn = allTasks.filter((t) => t.columnIndex === columnIndex);
        const indexInColumn = tasksInColumn.findIndex((t) => t.task.id === selectedTaskId);

        if (key.upArrow) {
          if (indexInColumn > 0) {
            // Move up within column
            selectTask(tasksInColumn[indexInColumn - 1]?.task.id ?? null);
          } else if (sortedIssues.length > 0) {
            // At top of column - move up to issue ribbon
            selectIssue(sortedIssues[0]?.id ?? null);
          }
        } else if (key.downArrow) {
          if (indexInColumn < tasksInColumn.length - 1) {
            // Move down within column
            selectTask(tasksInColumn[indexInColumn + 1]?.task.id ?? null);
          }
          // At bottom of column - do nothing
        } else if (key.leftArrow) {
          // Move to previous column (find nearest task at same row)
          for (let col = columnIndex - 1; col >= 0; col--) {
            const colTasks = allTasks.filter((t) => t.columnIndex === col);
            if (colTasks.length > 0) {
              const targetIndex = Math.min(taskIndex, colTasks.length - 1);
              selectTask(colTasks[targetIndex]?.task.id ?? null);
              break;
            }
          }
        } else if (key.rightArrow) {
          // Move to next column (find nearest task at same row)
          for (let col = columnIndex + 1; col < data.columns.length; col++) {
            const colTasks = allTasks.filter((t) => t.columnIndex === col);
            if (colTasks.length > 0) {
              const targetIndex = Math.min(taskIndex, colTasks.length - 1);
              selectTask(colTasks[targetIndex]?.task.id ?? null);
              break;
            }
          }
        }
      }
    }
  });

  // Loading state (only on first load)
  if (loading && !data) {
    return <Loading />;
  }

  // Error state
  if (error && !data) {
    return <ErrorDisplay error={error} />;
  }

  // No data
  if (!data) {
    return (
      <Box padding={2}>
        <Text color="yellow">No project data found</Text>
      </Box>
    );
  }

  // Calculate column width based on terminal width
  const terminalWidth = process.stdout.columns || 120;
  const columnWidth = Math.floor(terminalWidth / data.columns.length);

  return (
    <Box flexDirection="column">
      {/* Header - always shown */}
      <Header
        projectName={data.project.name}
        projectSlug={data.project.slug}
        lastUpdated={data.lastUpdated}
        intervalMs={intervalMs}
        workers={data.workers}
        currentProjectIndex={currentProjectIndex}
        projectCount={projectCount}
      />

      {/* Goto mode input */}
      {gotoMode && (
        <Box marginTop={1} paddingX={1}>
          <Text color="cyan" bold>
            Go to:{" "}
          </Text>
          <Text color="white">{gotoInput}</Text>
          <Text color="cyan">▏</Text>
          <Text color="gray"> (issue# or issue#.task# • Enter to go • Esc to cancel)</Text>
        </Box>
      )}

      {/* Action menu */}
      {showActionMenu && currentActions.length > 0 && (
        <Box
          marginTop={1}
          paddingX={1}
          paddingY={1}
          borderStyle="single"
          borderColor="yellow"
          flexDirection="column"
        >
          <Text color="yellow" bold>
            Actions for{" "}
            {selectedTask
              ? `#${selectedTask.issueNumber}.${selectedTask.taskNumber}`
              : `#${selectedIssue?.number}`}
          </Text>
          {currentActions.map((action) => (
            <Box key={action.key}>
              <Text color="cyan">[{action.key}]</Text>
              <Text color="white"> {action.label}</Text>
            </Box>
          ))}
          <Box marginTop={1}>
            <Text color="gray">(Esc to cancel)</Text>
          </Box>
        </Box>
      )}

      {/* Action message/feedback */}
      {actionMessage && (
        <Box marginTop={1} paddingX={1}>
          <Text color="green">{actionMessage}</Text>
        </Box>
      )}

      {/* Board view (hidden when panel expanded) */}
      {!isPanelExpanded && (
        <>
          {/* Issues ribbon */}
          <IssuesRibbon
            issues={data.issues}
            selectedIssueId={selectedIssueId}
            isIssueModeActive={isIssueSelected}
          />

          {/* Columns */}
          <Box flexDirection="row" marginTop={1}>
            {data.columns.map((column, columnIndex) => (
              <KanbanColumn
                key={column.status}
                label={column.label}
                status={column.status}
                tasks={column.tasks}
                width={columnWidth}
                selectedTaskId={selectedTaskId}
                scrollOffset={columnScrollOffsets[columnIndex] ?? 0}
                workerAssignments={data.workerAssignments}
              />
            ))}
          </Box>
        </>
      )}

      {/* Issue details panel when issue selected */}
      {selectedIssue && isIssueSelected && (
        <IssueDetailsPanel
          issue={selectedIssue}
          scrollOffset={detailScrollOffset}
          maxLines={detailMaxLines}
          isExpanded={isPanelExpanded}
        />
      )}

      {/* Task detail panel when task selected */}
      {selectedTask && !isIssueSelected && (
        <DetailPanel
          task={selectedTask}
          viewMode={viewMode}
          scrollOffset={detailScrollOffset}
          maxLines={detailMaxLines}
          isExpanded={isPanelExpanded}
        />
      )}

      {/* Error indicator if there's a background error */}
      {error && (
        <Box marginTop={1}>
          <Text color="red">⚠ Update error: {error.message}</Text>
        </Box>
      )}
    </Box>
  );
}
