import React, { useState, useMemo, useEffect } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { exec } from "child_process";
import type { KanbanData, KanbanTask, WorkerCounts } from "../hooks/useKanbanData.js";
import type { TaskStatus } from "@dev-workflow/core";
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
          <Text color="yellow">↑↓←→</Text> select • <Text color="yellow">Tab</Text> view •{" "}
          <Text color="yellow">o</Text> open GH • <Text color="yellow">p</Text> open PR •{" "}
          <Text color="yellow">r</Text> refresh • <Text color="yellow">q</Text> quit
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
}: {
  task: KanbanTask;
  isSelected: boolean;
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
}: {
  task: KanbanTask;
  viewMode: ViewMode;
  scrollOffset: number;
  maxLines: number;
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
}: {
  label: string;
  status: TaskStatus;
  tasks: KanbanTask[];
  width: number;
  selectedTaskId: string | null;
  scrollOffset: number;
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
            <TaskCard key={task.id} task={task} isSelected={task.id === selectedTaskId} />
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
}: {
  data: KanbanData | null;
  loading: boolean;
  error: Error | null;
  intervalMs: number;
  onRefresh: () => void;
  currentProjectIndex?: number;
  projectCount?: number;
  onProjectChange?: (index: number) => void;
}): React.ReactElement {
  const { exit } = useApp();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("task");
  const [detailScrollOffset, setDetailScrollOffset] = useState(0);

  // Calculate max visible lines for detail panel based on terminal height
  // Reserve space for: header (~4), columns (~10 minimum), detail panel border/header (~4)
  const terminalRows = process.stdout.rows || 24;
  const detailMaxLines = Math.max(5, terminalRows - 20);

  // Reset view mode and scroll when selected task changes
  useEffect(() => {
    setViewMode("task");
    setDetailScrollOffset(0);
  }, [selectedTaskId]);

  // Reset scroll when view mode changes
  useEffect(() => {
    setDetailScrollOffset(0);
  }, [viewMode]);

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

  // Handle keyboard input
  useInput((input, key) => {
    if (input === "q" || (key.ctrl && input === "c")) {
      exit();
    }
    if (input === "r") {
      onRefresh();
    }

    // Project switching with [ and ]
    if (projectCount > 1 && onProjectChange) {
      if (input === "[") {
        // Previous project (wrap around)
        const newIndex = currentProjectIndex === 0 ? projectCount - 1 : currentProjectIndex - 1;
        onProjectChange(newIndex);
        setSelectedTaskId(null); // Clear selection when switching projects
        return;
      }
      if (input === "]") {
        // Next project (wrap around)
        const newIndex = (currentProjectIndex + 1) % projectCount;
        onProjectChange(newIndex);
        setSelectedTaskId(null); // Clear selection when switching projects
        return;
      }
    }

    // Tab key to cycle view modes (only when a task is selected)
    if (key.tab && selectedTaskId) {
      cycleViewMode();
      return;
    }

    // Arrow key navigation
    if (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) {
      if (allTasks.length === 0) return;

      // If nothing selected, select first task
      if (!selectedTaskId) {
        setSelectedTaskId(allTasks[0]?.task.id ?? null);
        return;
      }

      const currentIndex = allTasks.findIndex((t) => t.task.id === selectedTaskId);
      if (currentIndex === -1) {
        setSelectedTaskId(allTasks[0]?.task.id ?? null);
        return;
      }

      const current = allTasks[currentIndex];
      if (!current || !data) return;

      if (key.upArrow) {
        // Move up within column
        const tasksInColumn = allTasks.filter((t) => t.columnIndex === current.columnIndex);
        const indexInColumn = tasksInColumn.findIndex((t) => t.task.id === selectedTaskId);
        if (indexInColumn > 0) {
          setSelectedTaskId(tasksInColumn[indexInColumn - 1]?.task.id ?? null);
        }
      } else if (key.downArrow) {
        // Move down within column
        const tasksInColumn = allTasks.filter((t) => t.columnIndex === current.columnIndex);
        const indexInColumn = tasksInColumn.findIndex((t) => t.task.id === selectedTaskId);
        if (indexInColumn < tasksInColumn.length - 1) {
          setSelectedTaskId(tasksInColumn[indexInColumn + 1]?.task.id ?? null);
        }
      } else if (key.leftArrow) {
        // Move to previous column
        for (let col = current.columnIndex - 1; col >= 0; col--) {
          const tasksInColumn = allTasks.filter((t) => t.columnIndex === col);
          if (tasksInColumn.length > 0) {
            const targetIndex = Math.min(current.taskIndex, tasksInColumn.length - 1);
            setSelectedTaskId(tasksInColumn[targetIndex]?.task.id ?? null);
            break;
          }
        }
      } else if (key.rightArrow) {
        // Move to next column
        for (let col = current.columnIndex + 1; col < data.columns.length; col++) {
          const tasksInColumn = allTasks.filter((t) => t.columnIndex === col);
          if (tasksInColumn.length > 0) {
            const targetIndex = Math.min(current.taskIndex, tasksInColumn.length - 1);
            setSelectedTaskId(tasksInColumn[targetIndex]?.task.id ?? null);
            break;
          }
        }
      }
    }

    // Open GitHub URL
    if (input === "o" && selectedTask?.githubUrl) {
      openUrl(selectedTask.githubUrl);
    }

    // Open PR URL
    if (input === "p" && selectedTask?.prUrl) {
      openUrl(selectedTask.prUrl);
    }

    // Escape to deselect
    if (key.escape) {
      setSelectedTaskId(null);
    }

    // PageUp/PageDown to scroll detail panel content
    if (selectedTaskId && key.pageUp) {
      setDetailScrollOffset((prev) => Math.max(0, prev - 5));
    }
    if (selectedTaskId && key.pageDown) {
      setDetailScrollOffset((prev) => prev + 5);
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
      {/* Header */}
      <Header
        projectName={data.project.name}
        projectSlug={data.project.slug}
        lastUpdated={data.lastUpdated}
        intervalMs={intervalMs}
        workers={data.workers}
        currentProjectIndex={currentProjectIndex}
        projectCount={projectCount}
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
          />
        ))}
      </Box>

      {/* Detail panel when task selected */}
      {selectedTask && (
        <DetailPanel
          task={selectedTask}
          viewMode={viewMode}
          scrollOffset={detailScrollOffset}
          maxLines={detailMaxLines}
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
