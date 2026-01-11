import React from "react";
import { Box, Text, useInput, useApp } from "ink";
import type { KanbanData, KanbanTask } from "../hooks/useKanbanData.js";
import type { TaskStatus } from "@dev-workflow/core";

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
 * Header component showing project info and controls
 */
function Header({
  projectName,
  projectSlug,
  lastUpdated,
  intervalMs,
}: {
  projectName: string;
  projectSlug: string;
  lastUpdated: Date;
  intervalMs: number;
}): React.ReactElement {
  const time = lastUpdated.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  return (
    <Box borderStyle="single" borderColor="blue" paddingX={1} justifyContent="space-between">
      <Text>
        <Text bold color="blue">
          dev-workflow
        </Text>
        <Text color="gray"> • </Text>
        <Text>{projectName}</Text>
        <Text color="gray"> ({projectSlug})</Text>
      </Text>
      <Text color="gray">
        ↻ {intervalMs / 1000}s • {time} • <Text color="yellow">q</Text> quit •{" "}
        <Text color="yellow">r</Text> refresh
      </Text>
    </Box>
  );
}

/**
 * Single task card
 */
function TaskCard({ task }: { task: KanbanTask }): React.ReactElement {
  const typeColor = TYPE_COLORS[task.type] ?? "gray";
  const taskId = `#${task.issueNumber}.${task.taskNumber}`;

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Task ID and type */}
      <Box>
        <Text bold color={STATUS_COLORS[task.status]}>
          {taskId}
        </Text>
        <Text color="gray"> </Text>
        <Text color={typeColor}>[{task.type}]</Text>
      </Box>

      {/* Title (truncated) */}
      <Text dimColor>{task.title.length > 28 ? `${task.title.slice(0, 25)}...` : task.title}</Text>

      {/* Branch info for IN_PROGRESS */}
      {task.branchName && task.status === "IN_PROGRESS" && (
        <Text color="gray">
          ⎇ {task.branchName.length > 20 ? `${task.branchName.slice(0, 17)}...` : task.branchName}
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
 * Kanban column
 */
function KanbanColumn({
  label,
  status,
  tasks,
  width,
}: {
  label: string;
  status: TaskStatus;
  tasks: KanbanTask[];
  width: number;
}): React.ReactElement {
  const headerColor = STATUS_COLORS[status];

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

      {/* Tasks */}
      <Box flexDirection="column" marginTop={1}>
        {tasks.length === 0 ? (
          <Text color="gray" dimColor>
            No tasks
          </Text>
        ) : (
          tasks.map((task) => <TaskCard key={task.id} task={task} />)
        )}
      </Box>
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
 * Main Kanban board component
 */
export function KanbanBoard({
  data,
  loading,
  error,
  intervalMs,
  onRefresh,
}: {
  data: KanbanData | null;
  loading: boolean;
  error: Error | null;
  intervalMs: number;
  onRefresh: () => void;
}): React.ReactElement {
  const { exit } = useApp();

  // Handle keyboard input
  useInput((input, key) => {
    if (input === "q" || (key.ctrl && input === "c")) {
      exit();
    }
    if (input === "r") {
      onRefresh();
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

  // Calculate column width based on number of columns
  const columnWidth = Math.floor(80 / data.columns.length);

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Header
        projectName={data.project.name}
        projectSlug={data.project.slug}
        lastUpdated={data.lastUpdated}
        intervalMs={intervalMs}
      />

      {/* Columns */}
      <Box flexDirection="row" marginTop={1}>
        {data.columns.map((column) => (
          <KanbanColumn
            key={column.status}
            label={column.label}
            status={column.status}
            tasks={column.tasks}
            width={columnWidth}
          />
        ))}
      </Box>

      {/* Error indicator if there's a background error */}
      {error && (
        <Box marginTop={1}>
          <Text color="red">⚠ Update error: {error.message}</Text>
        </Box>
      )}
    </Box>
  );
}
