import type { Issue, Plan, Task } from "@dev-workflow/core";
import { escapeHtml } from "./layout.js";

export interface IssueWithTasks {
  issue: Issue;
  plan: Plan | null;
  tasks: Task[];
}

type KanbanColumn = "PENDING" | "IN_PROGRESS" | "COMPLETED";

interface KanbanTask extends Task {
  issueNumber: number;
  issueTitle: string;
}

export function renderKanbanBoard(
  issuesWithTasks: IssueWithTasks[],
  filterIssueNumber?: number
): string {
  // Flatten all tasks and add issue context
  const allTasks: KanbanTask[] = [];
  for (const { issue, tasks } of issuesWithTasks) {
    for (const task of tasks) {
      allTasks.push({
        ...task,
        issueNumber: issue.number,
        issueTitle: issue.title,
      });
    }
  }

  // Group tasks by status (mapping ABANDONED to COMPLETED column)
  const columns: Record<KanbanColumn, KanbanTask[]> = {
    PENDING: allTasks.filter((t) => t.status === "PENDING"),
    IN_PROGRESS: allTasks.filter((t) => t.status === "IN_PROGRESS"),
    COMPLETED: allTasks.filter(
      (t) => t.status === "COMPLETED" || t.status === "ABANDONED"
    ),
  };

  const totalTasks = allTasks.length;

  if (totalTasks === 0) {
    return renderEmptyBoard(filterIssueNumber);
  }

  const headerTitle = filterIssueNumber
    ? `Tasks for Issue #${filterIssueNumber}`
    : "Task Board";

  return `
    <div class="kanban-container">
      <div class="kanban-header">
        <div class="kanban-title-row">
          ${filterIssueNumber ? `<a href="/board" class="back-link">← All Tasks</a>` : ""}
          <h2>${headerTitle}</h2>
        </div>
        <span class="task-count">${totalTasks} task${totalTasks !== 1 ? "s" : ""}</span>
      </div>

      ${filterIssueNumber ? `<div class="board-filter-info"><a href="/issues/${filterIssueNumber}">View Issue Details</a></div>` : ""}

      <div class="kanban-board">
        ${renderColumn("PENDING", "Ready", columns.PENDING)}
        ${renderColumn("IN_PROGRESS", "In Progress", columns.IN_PROGRESS)}
        ${renderColumn("COMPLETED", "Done", columns.COMPLETED)}
      </div>
    </div>
  `;
}

function renderEmptyBoard(filterIssueNumber?: number): string {
  const headerTitle = filterIssueNumber
    ? `Tasks for Issue #${filterIssueNumber}`
    : "Task Board";

  return `
    <div class="kanban-container">
      <div class="kanban-header">
        <div class="kanban-title-row">
          ${filterIssueNumber ? `<a href="/board" class="back-link">← All Tasks</a>` : ""}
          <h2>${headerTitle}</h2>
        </div>
      </div>
      ${filterIssueNumber ? `<div class="board-filter-info"><a href="/issues/${filterIssueNumber}">View Issue Details</a></div>` : ""}
      <div class="kanban-empty">
        <p>No tasks found.</p>
        <p class="hint">${filterIssueNumber ? "Generate an implementation plan for this issue to see tasks here." : "Generate implementation plans for issues to see tasks here."}</p>
      </div>
    </div>
  `;
}

function renderColumn(
  status: KanbanColumn,
  title: string,
  tasks: KanbanTask[]
): string {
  const columnClass = status.toLowerCase().replace("_", "-");

  return `
    <div class="kanban-column kanban-column-${columnClass}">
      <div class="column-header">
        <h3>${title}</h3>
        <span class="column-count">${tasks.length}</span>
      </div>
      <div class="column-content">
        ${
          tasks.length > 0
            ? tasks.map((task) => renderKanbanCard(task)).join("\n")
            : '<div class="column-empty">No tasks</div>'
        }
      </div>
    </div>
  `;
}

function renderKanbanCard(task: KanbanTask): string {
  const statusClass = task.status.toLowerCase().replace("_", "-");

  return `
    <div class="kanban-card kanban-card-${statusClass}">
      <div class="card-issue">
        <a href="/issues/${task.issueNumber}" class="issue-link">#${task.issueNumber}</a>
        <span class="issue-title">${escapeHtml(truncate(task.issueTitle, 30))}</span>
      </div>
      <div class="card-title">${escapeHtml(task.title)}</div>
      <div class="card-description">${escapeHtml(truncate(task.description, 100))}</div>
      <div class="card-footer">
        ${task.estimatedMinutes ? `<span class="card-estimate">${task.estimatedMinutes}m</span>` : ""}
        ${task.status === "ABANDONED" ? '<span class="badge badge-abandoned">ABANDONED</span>' : ""}
        ${renderSessionIndicator(task)}
      </div>
    </div>
  `;
}

function renderSessionIndicator(task: KanbanTask): string {
  if (!task.sessionId || task.status !== "IN_PROGRESS") {
    return "";
  }

  return `<span class="session-indicator" title="Session: ${escapeHtml(task.sessionId)}">Active</span>`;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength - 3) + "...";
}
