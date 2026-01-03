import { KanbanColumn } from "./KanbanColumn";
import { EmptyState } from "../ui";
import type { ProjectIssueWithTasks, Task, CompletedTask } from "@/lib/types";

interface KanbanTask extends Task {
  issueNumber: number;
  issueTitle: string;
  projectId?: string;
  projectName?: string;
}

interface KanbanBoardProps {
  issuesWithTasks: ProjectIssueWithTasks[];
  completedTasks?: CompletedTask[];
}

export function KanbanBoard({
  issuesWithTasks,
  completedTasks = [],
}: KanbanBoardProps) {
  // Flatten all tasks and add issue context
  const allTasks: KanbanTask[] = [];
  for (const { issue, tasks, projectName } of issuesWithTasks) {
    for (const task of tasks) {
      allTasks.push({
        ...task,
        issueNumber: issue.number,
        issueTitle: issue.title,
        projectId: issue.projectId,
        projectName,
      });
    }
  }

  // Group tasks by status (mapping ABANDONED to COMPLETED column)
  // Ready column shows BACKLOG, READY, and PENDING (for backwards compatibility)
  const readyTasks = allTasks.filter(
    (t) => t.status === "BACKLOG" || t.status === "READY" || t.status === "PENDING"
  );
  const inProgressTasks = allTasks.filter((t) => t.status === "IN_PROGRESS");
  const prReviewTasks = allTasks.filter((t) => t.status === "PR_REVIEW");

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
