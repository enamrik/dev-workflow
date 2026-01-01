import { KanbanColumn } from "./KanbanColumn";
import { EmptyState } from "../ui";
import type { ProjectIssueWithTasks, Task } from "../../api";

interface KanbanTask extends Task {
  issueNumber: number;
  issueTitle: string;
  projectId?: string;
}

interface KanbanBoardProps {
  issuesWithTasks: ProjectIssueWithTasks[];
}

export function KanbanBoard({ issuesWithTasks }: KanbanBoardProps) {
  // Flatten all tasks and add issue context
  const allTasks: KanbanTask[] = [];
  for (const { issue, tasks } of issuesWithTasks) {
    for (const task of tasks) {
      allTasks.push({
        ...task,
        issueNumber: issue.number,
        issueTitle: issue.title,
        projectId: issue.projectId,
      });
    }
  }

  if (allTasks.length === 0) {
    return (
      <EmptyState
        title="No tasks found"
        description="Generate implementation plans for issues to see tasks here."
      />
    );
  }

  // Group tasks by status (mapping ABANDONED to COMPLETED column)
  const columns = {
    PENDING: allTasks.filter((t) => t.status === "PENDING"),
    IN_PROGRESS: allTasks.filter((t) => t.status === "IN_PROGRESS"),
    COMPLETED: allTasks.filter(
      (t) => t.status === "COMPLETED" || t.status === "ABANDONED"
    ),
  };

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      <KanbanColumn title="Ready" status="PENDING" tasks={columns.PENDING} />
      <KanbanColumn
        title="In Progress"
        status="IN_PROGRESS"
        tasks={columns.IN_PROGRESS}
      />
      <KanbanColumn title="Done" status="COMPLETED" tasks={columns.COMPLETED} />
    </div>
  );
}
