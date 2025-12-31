import type { Project, ProjectIssueWithPlanInfo } from "../application/multi-project-service.js";
import { escapeHtml } from "./layout.js";

export function renderMultiProjectIssuesList(
  issues: ProjectIssueWithPlanInfo[],
  projects: Project[],
  currentProjectFilter?: string
): string {
  const issueCount = issues.length;
  const issuesWord = issueCount === 1 ? "issue" : "issues";

  return `
    <div class="issues-container">
      <div class="issues-header">
        <h2>Issues</h2>
        <span class="issue-count">${issueCount} ${issuesWord}</span>
      </div>

      ${renderProjectFilter(projects, currentProjectFilter)}

      ${issues.length === 0 ? renderEmpty(currentProjectFilter) : renderTable(issues)}
    </div>
  `;
}

function renderProjectFilter(projects: Project[], currentFilter?: string): string {
  if (projects.length <= 1) {
    return "";
  }

  return `
    <div class="project-filter">
      <label for="project-select">Project:</label>
      <select id="project-select" onchange="filterByProject(this.value)">
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
      function filterByProject(projectId) {
        const url = new URL(window.location.href);
        if (projectId) {
          url.searchParams.set('project', projectId);
        } else {
          url.searchParams.delete('project');
        }
        window.location.href = url.toString();
      }
    </script>
  `;
}

function renderEmpty(projectFilter?: string): string {
  const message = projectFilter
    ? `No issues found in project "${projectFilter}".`
    : "No issues found.";

  return `
    <div class="empty-state">
      <p>${message}</p>
      <p class="hint">Create your first issue using the MCP server tools or Claude Code.</p>
    </div>
  `;
}

function renderTable(issues: ProjectIssueWithPlanInfo[]): string {
  return `
    <table class="issues-table">
      <thead>
        <tr>
          <th class="col-project">Project</th>
          <th class="col-number">#</th>
          <th class="col-title">Title</th>
          <th class="col-type">Type</th>
          <th class="col-priority">Priority</th>
          <th class="col-status">Status</th>
          <th class="col-tasks">Tasks</th>
        </tr>
      </thead>
      <tbody>
        ${issues.map((item) => renderIssueRow(item)).join("\n")}
      </tbody>
    </table>
  `;
}

function renderIssueRow(item: ProjectIssueWithPlanInfo): string {
  const { issue, hasPlan, taskCounts } = item;
  const issueUrl = `/projects/${encodeURIComponent(issue.projectId)}/issues/${issue.number}`;
  const boardUrl = `/board?project=${encodeURIComponent(issue.projectId)}&issue=${issue.number}`;

  return `
    <tr class="issue-row" onclick="window.location.href='${issueUrl}'">
      <td class="col-project">${renderProjectBadge(issue.projectId)}</td>
      <td class="col-number">${issue.number}</td>
      <td class="col-title">${escapeHtml(issue.title)}</td>
      <td class="col-type">${renderTypeBadge(issue.type)}</td>
      <td class="col-priority">${renderPriorityBadge(issue.priority)}</td>
      <td class="col-status">${renderStatusBadge(issue.status)}</td>
      <td class="col-tasks">${renderTasksStatus(issueUrl, boardUrl, hasPlan, taskCounts)}</td>
    </tr>
  `;
}

function renderProjectBadge(projectId: string): string {
  // Extract just the folder name part (before the hash)
  const shortName = projectId.includes("-")
    ? projectId.substring(0, projectId.lastIndexOf("-"))
    : projectId;

  return `<span class="badge badge-project" title="${escapeHtml(projectId)}">${escapeHtml(shortName)}</span>`;
}

function renderTasksStatus(
  issueUrl: string,
  boardUrl: string,
  hasPlan: boolean,
  taskCounts?: { total: number; completed: number; inProgress: number }
): string {
  if (!hasPlan) {
    return '<span class="no-plan">—</span>';
  }

  if (!taskCounts || taskCounts.total === 0) {
    return `<a href="${issueUrl}" class="plan-link" onclick="event.stopPropagation()">View Plan</a>`;
  }

  const { total, completed, inProgress } = taskCounts;
  const progressPercent = Math.round((completed / total) * 100);

  return `
    <div class="plan-info">
      <a href="${boardUrl}" class="tasks-link" onclick="event.stopPropagation()" title="View tasks on board">
        <span class="task-progress-mini">
          <span class="progress-bar-mini">
            <span class="progress-fill-mini" style="width: ${progressPercent}%"></span>
          </span>
          <span class="task-counts">${completed}/${total}</span>
        </span>
      </a>
      ${inProgress > 0 ? `<span class="in-progress-indicator" title="${inProgress} in progress"></span>` : ""}
    </div>
  `;
}

function renderTypeBadge(type: string): string {
  return `<span class="badge badge-type badge-${type.toLowerCase()}">${type}</span>`;
}

function renderPriorityBadge(priority: string): string {
  return `<span class="badge badge-priority badge-${priority.toLowerCase()}">${priority}</span>`;
}

function renderStatusBadge(status: string): string {
  const statusClass = status.toLowerCase().replace("_", "-");
  return `<span class="badge badge-status badge-${statusClass}">${status.replace("_", " ")}</span>`;
}
