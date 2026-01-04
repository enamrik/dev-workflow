import { KanbanColumn } from "./KanbanColumn";
import { EmptyState } from "../ui";
import type { ProjectIssueWithTasks, Task, CompletedTask } from "@/lib/types";

interface KanbanTask extends Task {
  issueNumber: number;
  issueTitle: string;
  issueType: "FEATURE" | "BUG" | "ENHANCEMENT" | "TASK";
  issueGithubUrl?: string;
  projectId?: string;
  projectName?: string;
}

interface KanbanBoardProps {
  issuesWithTasks: ProjectIssueWithTasks[];
  completedTasks?: CompletedTask[];
  showBacklog?: boolean;
}

export function KanbanBoard({
  issuesWithTasks,
  completedTasks = [],
  showBacklog = false,
}: KanbanBoardProps) {
  // Flatten all tasks and add issue context
  const allTasks: KanbanTask[] = [];
  for (const { issue, tasks, projectName } of issuesWithTasks) {
    for (const task of tasks) {
      allTasks.push({
        ...task,
        issueNumber: issue.number,
        issueTitle: issue.title,
        issueType: issue.type,
        issueGithubUrl: issue.githubSync?.githubUrl ?? undefined,
        projectId: issue.projectId,
        projectName,
      });
    }
  }

  // Sort helper: newest first (descending by date string)
  const sortNewestFirst = <T,>(
    tasks: T[],
    getDate: (task: T) => string | undefined
  ): T[] =>
    [...tasks].sort((a, b) => {
      const dateA = getDate(a) ?? "";
      const dateB = getDate(b) ?? "";
      return dateB.localeCompare(dateA);
    });

  // Group tasks by status (mapping ABANDONED to COMPLETED column)
  // Backlog and Planned columns show when showBacklog is enabled
  // All columns sorted newest first
  const backlogTasks = showBacklog
    ? sortNewestFirst(
        allTasks.filter((t) => t.status === "BACKLOG"),
        (t) => t.createdAt
      )
    : [];
  const plannedTasks = showBacklog
    ? sortNewestFirst(
        allTasks.filter((t) => t.status === "PLANNED"),
        (t) => t.createdAt
      )
    : [];
  // Ready column shows only READY tasks (BACKLOG tasks are paused/inactive)
  const readyTasks = sortNewestFirst(
    allTasks.filter((t) => t.status === "READY"),
    (t) => t.createdAt
  );
  const inProgressTasks = sortNewestFirst(
    allTasks.filter((t) => t.status === "IN_PROGRESS"),
    (t) => t.startedAt
  );
  const prReviewTasks = sortNewestFirst(
    allTasks.filter((t) => t.status === "PR_REVIEW"),
    (t) => t.submittedForReviewAt
  );

  // For Done column: merge completed tasks from open issues with completedTasks prop
  // The completedTasks prop includes tasks from closed issues (last 7 days, max 20)
  const openIssueCompletedIds = new Set(
    allTasks
      .filter((t) => t.status === "COMPLETED" || t.status === "ABANDONED")
      .map((t) => t.id)
  );

  // Add completed tasks from completedTasks that aren't already in openIssueCompletedIds
  const doneTasks: KanbanTask[] = allTasks.filter(
    (t) => t.status === "COMPLETED" || t.status === "ABANDONED"
  );

  for (const task of completedTasks) {
    if (!openIssueCompletedIds.has(task.id)) {
      doneTasks.push({
        ...task,
        projectId: task.projectId,
        projectName: task.projectName,
        issueType: task.issueType,
      });
    }
  }

  // Sort done tasks by completion date descending
  doneTasks.sort((a, b) => {
    const dateA = a.completedAt ?? a.abandonedAt ?? "";
    const dateB = b.completedAt ?? b.abandonedAt ?? "";
    return dateB.localeCompare(dateA);
  });

  // Limit to 20 tasks
  const limitedDoneTasks = doneTasks.slice(0, 20);

  const hasAnyTasks =
    backlogTasks.length > 0 ||
    plannedTasks.length > 0 ||
    readyTasks.length > 0 ||
    inProgressTasks.length > 0 ||
    prReviewTasks.length > 0 ||
    limitedDoneTasks.length > 0;

  if (!hasAnyTasks) {
    return (
      <EmptyState
        title="No tasks found"
        description="Generate implementation plans for issues to see tasks here."
      />
    );
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {showBacklog && (
        <div className="flex flex-col gap-2 min-w-[220px] flex-1">
          <KanbanColumn
            title="Backlog"
            status="BACKLOG"
            tasks={backlogTasks}
            tooltip="Inactive tasks waiting to be started"
            stacked
          />
          <KanbanColumn
            title="Planned"
            status="PLANNED"
            tasks={plannedTasks}
            tooltip="Tasks in planned issues not yet moved to backlog"
            stacked
          />
        </div>
      )}
      <KanbanColumn title="Ready" status="READY" tasks={readyTasks} />
      <KanbanColumn
        title="In Progress"
        status="IN_PROGRESS"
        tasks={inProgressTasks}
      />
      <KanbanColumn
        title="In Review"
        status="PR_REVIEW"
        tasks={prReviewTasks}
        tooltip="Tasks with open PRs awaiting review"
      />
      <KanbanColumn
        title="Done"
        status="COMPLETED"
        tasks={limitedDoneTasks}
        tooltip="Shows up to 20 tasks completed in the last 7 days"
      />
    </div>
  );
}
