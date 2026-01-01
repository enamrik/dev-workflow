import type { Task } from "@dev-workflow/core";
import type { Project, ProjectIssueWithTasks } from "../application/multi-project-service.js";
import { escapeHtml } from "./layout.js";

type KanbanColumn = "PENDING" | "IN_PROGRESS" | "COMPLETED";

interface ProjectKanbanTask extends Task {
  projectId: string;
  issueNumber: number;
  issueTitle: string;
  milestoneNumber?: number;
  milestoneTitle?: string;
}

export function renderMultiProjectKanbanBoard(
  issuesWithTasks: ProjectIssueWithTasks[],
  projects: Project[],
  projectFilter?: string,
  issueFilter?: number
): string {
  // Flatten all tasks and add project/issue/milestone context
  const allTasks: ProjectKanbanTask[] = [];
  for (const { issue, tasks, milestoneNumber, milestoneTitle } of issuesWithTasks) {
    for (const task of tasks) {
      allTasks.push({
        ...task,
        projectId: issue.projectId,
        issueNumber: issue.number,
        issueTitle: issue.title,
        milestoneNumber,
        milestoneTitle,
      });
    }
  }

  // Group tasks by status (mapping ABANDONED to COMPLETED column)
  const columns: Record<KanbanColumn, ProjectKanbanTask[]> = {
    PENDING: allTasks.filter((t) => t.status === "PENDING"),
    IN_PROGRESS: allTasks.filter((t) => t.status === "IN_PROGRESS"),
    COMPLETED: allTasks.filter(
      (t) => t.status === "COMPLETED" || t.status === "ABANDONED"
    ),
  };

  const totalTasks = allTasks.length;

  if (totalTasks === 0) {
    return renderEmptyBoard(projects, projectFilter, issueFilter);
  }

  const headerTitle = issueFilter
    ? `Tasks for Issue #${issueFilter}`
    : "Task Board";

  return `
    <div class="kanban-container">
      <div class="kanban-header">
        <div class="kanban-title-row">
          ${issueFilter ? `<a href="/board${projectFilter ? `?project=${encodeURIComponent(projectFilter)}` : ""}" class="back-link">← All Tasks</a>` : ""}
          <h2>${headerTitle}</h2>
        </div>
        <span class="task-count">${totalTasks} task${totalTasks !== 1 ? "s" : ""}</span>
      </div>

      ${renderProjectFilter(projects, projectFilter, issueFilter)}

      ${issueFilter && projectFilter ? `<div class="board-filter-info"><a href="/projects/${encodeURIComponent(projectFilter)}/issues/${issueFilter}">View Issue Details</a></div>` : ""}

      <div class="kanban-board">
        ${renderColumn("PENDING", "Ready", columns.PENDING)}
        ${renderColumn("IN_PROGRESS", "In Progress", columns.IN_PROGRESS)}
        ${renderColumn("COMPLETED", "Done", columns.COMPLETED)}
      </div>
    </div>
  `;
}

function renderProjectFilter(
  projects: Project[],
  currentFilter?: string,
  issueFilter?: number
): string {
  if (projects.length <= 1) {
    return "";
  }

  return `
    <div class="project-filter board-project-filter">
      <label for="board-project-select">Project:</label>
      <select id="board-project-select" onchange="filterBoardByProject(this.value)">
        <option value="">All Projects (${projects.length})</option>
        ${projects
          .map(
            (p) =>
              `<option value="${escapeHtml(p.id)}" ${currentFilter === p.id ? "selected" : ""}>${escapeHtml(p.id)}</option>`
          )
          .join("\n")}
      </select>
    </div>
    <script>
      function filterBoardByProject(projectId) {
        const url = new URL(window.location.href);
        if (projectId) {
          url.searchParams.set('project', projectId);
        } else {
          url.searchParams.delete('project');
        }
        ${issueFilter ? "" : "url.searchParams.delete('issue');"}
        window.location.href = url.toString();
      }
    </script>
  `;
}

function renderEmptyBoard(
  projects: Project[],
  projectFilter?: string,
  issueFilter?: number
): string {
  const headerTitle = issueFilter
    ? `Tasks for Issue #${issueFilter}`
    : "Task Board";

  return `
    <div class="kanban-container">
      <div class="kanban-header">
        <div class="kanban-title-row">
          ${issueFilter ? `<a href="/board${projectFilter ? `?project=${encodeURIComponent(projectFilter)}` : ""}" class="back-link">← All Tasks</a>` : ""}
          <h2>${headerTitle}</h2>
        </div>
      </div>
      ${renderProjectFilter(projects, projectFilter, issueFilter)}
      ${issueFilter && projectFilter ? `<div class="board-filter-info"><a href="/projects/${encodeURIComponent(projectFilter)}/issues/${issueFilter}">View Issue Details</a></div>` : ""}
      <div class="kanban-empty">
        <p>No tasks found.</p>
        <p class="hint">${issueFilter ? "Generate an implementation plan for this issue to see tasks here." : "Generate implementation plans for issues to see tasks here."}</p>
      </div>
    </div>
  `;
}

function renderColumn(
  status: KanbanColumn,
  title: string,
  tasks: ProjectKanbanTask[]
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

function renderKanbanCard(task: ProjectKanbanTask): string {
  const statusClass = task.status.toLowerCase().replace("_", "-");
  const issueUrl = `/projects/${encodeURIComponent(task.projectId)}/issues/${task.issueNumber}`;

  // Extract short project name (before the hash)
  const shortProjectName = task.projectId.includes("-")
    ? task.projectId.substring(0, task.projectId.lastIndexOf("-"))
    : task.projectId;

  // Build hierarchy breadcrumb: project → M# → #issue
  const milestoneLink = task.milestoneNumber
    ? `<a href="/milestones?project=${encodeURIComponent(task.projectId)}" class="milestone-link" title="${escapeHtml(task.milestoneTitle || "")}">M${task.milestoneNumber}</a><span class="hierarchy-sep">›</span>`
    : "";

  // Task number display: issue#.task# (e.g., 5.3)
  const taskNumberDisplay = `${task.issueNumber}.${task.number}`;

  return `
    <div class="kanban-card kanban-card-${statusClass}">
      <div class="card-hierarchy">
        <div class="card-breadcrumb">
          <span class="badge badge-project-mini" title="${escapeHtml(task.projectId)}">${escapeHtml(shortProjectName)}</span>
          <span class="hierarchy-sep">›</span>
          ${milestoneLink}
          <a href="${issueUrl}" class="issue-link">#${task.issueNumber}</a>
        </div>
        <span class="card-task-number">${taskNumberDisplay}</span>
      </div>
      <div class="card-title">${escapeHtml(task.title)}</div>
      <div class="card-description">${escapeHtml(truncate(task.description, 80))}</div>
      <div class="card-footer">
        ${task.estimatedMinutes ? `<span class="card-estimate">${task.estimatedMinutes}m</span>` : ""}
        ${task.status === "ABANDONED" ? '<span class="badge badge-abandoned">ABANDONED</span>' : ""}
        ${renderSessionIndicator(task)}
      </div>
    </div>
  `;
}

function renderSessionIndicator(task: ProjectKanbanTask): string {
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
