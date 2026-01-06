import { KanbanColumn } from "./KanbanColumn";
import { EmptyState } from "../ui";
import type {
  ProjectIssueWithTasks,
  Task,
  CompletedTask,
  Issue,
  ComputedIssueStatus,
} from "@/lib/types";

/**
 * Compute issue status based on issue state and task progress.
 * Mirrors the server-side logic in multi-project-service.ts.
 */
function computeIssueStatus(issue: Issue, tasks: Task[]): ComputedIssueStatus {
  if (issue.status === "PLANNED") {
    return "PLANNED";
  }
  if (issue.status === "CLOSED") {
    return "CLOSED";
  }
  if (tasks.length === 0) {
    return "OPEN";
  }

  const completed = tasks.filter((t) => t.status === "COMPLETED").length;
  const abandoned = tasks.filter((t) => t.status === "ABANDONED").length;
  const inProgress = tasks.filter((t) => t.status === "IN_PROGRESS").length;
  const prReview = tasks.filter((t) => t.status === "PR_REVIEW").length;

  if (completed + abandoned === tasks.length) {
    return "TASKS_DONE";
  }
  if (inProgress === 0 && prReview === 0) {
    return "OPEN";
  }
  return "IN_PROGRESS";
}

interface KanbanTask extends Task {
  issueNumber: number;
  issueTitle: string;
  issueType: "FEATURE" | "BUG" | "ENHANCEMENT" | "TASK" | "SPIKE";
  issueGithubUrl?: string;
  issueComputedStatus: ComputedIssueStatus;
  projectId?: string;
  projectName?: string;
  projectSlug?: string;
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
  for (const { issue, tasks, projectName, projectSlug } of issuesWithTasks) {
    const issueComputedStatus = computeIssueStatus(issue, tasks);
    for (const task of tasks) {
      allTasks.push({
        ...task,
        issueNumber: issue.number,
        issueTitle: issue.title,
        issueType: issue.type,
        issueGithubUrl: issue.githubSync?.githubUrl ?? undefined,
        issueComputedStatus,
        projectId: issue.projectId,
        projectName,
        projectSlug,
      });
    }
  }

  // Sort helper: newest first (descending by date string)
  const sortNewestFirst = <T,>(tasks: T[], getDate: (task: T) => string | undefined): T[] =>
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
    allTasks.filter((t) => t.status === "COMPLETED" || t.status === "ABANDONED").map((t) => t.id)
  );

  // Add completed tasks from completedTasks that aren't already in openIssueCompletedIds
  const doneTasks: KanbanTask[] = allTasks.filter(
    (t) => t.status === "COMPLETED" || t.status === "ABANDONED"
  );

  for (const task of completedTasks) {
    if (!openIssueCompletedIds.has(task.id)) {
      // Map issueStatus to ComputedIssueStatus for completed tasks from closed issues
      const issueComputedStatus: ComputedIssueStatus =
        task.issueStatus === "CLOSED" ? "CLOSED" : "TASKS_DONE";
      doneTasks.push({
        ...task,
        projectId: task.projectId,
        projectName: task.projectName,
        projectSlug: task.projectSlug,
        issueType: task.issueType,
        issueComputedStatus,
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
    <div className="flex gap-3 md:gap-4 overflow-x-auto overflow-y-hidden h-full scrollbar-auto-hide">
      {showBacklog && (
        <div className="flex flex-col gap-2 min-w-[180px] md:min-w-[220px] flex-1 h-full">
          <KanbanColumn
            title="Backlog"
            status="BACKLOG"
            tasks={backlogTasks}
            tooltip="Tasks refined and awaiting prioritization"
          />
          <KanbanColumn
            title="Planned"
            status="PLANNED"
            tasks={plannedTasks}
            tooltip="Tasks in planned issues not yet moved to backlog"
          />
        </div>
      )}
      <KanbanColumn title="Ready" status="READY" tasks={readyTasks} />
      <KanbanColumn title="In Progress" status="IN_PROGRESS" tasks={inProgressTasks} />
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
