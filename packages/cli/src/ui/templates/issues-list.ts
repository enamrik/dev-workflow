import type { Issue } from "@dev-workflow/mcp-server/domain/issue.js";
import { escapeHtml } from "./layout.js";

export interface IssueWithPlanInfo {
  issue: Issue;
  hasPlan: boolean;
  taskCounts?: {
    total: number;
    completed: number;
    inProgress: number;
  };
}

export function renderIssuesList(issuesWithPlans: IssueWithPlanInfo[]): string {
  const issueCount = issuesWithPlans.length;
  const issuesWord = issueCount === 1 ? "issue" : "issues";

  return `
    <div class="issues-container">
      <div class="issues-header">
        <h2>Issues</h2>
        <span class="issue-count">${issueCount} ${issuesWord}</span>
      </div>

      ${issuesWithPlans.length === 0 ? renderEmpty() : renderTable(issuesWithPlans)}
    </div>
  `;
}

function renderEmpty(): string {
  return `
    <div class="empty-state">
      <p>No issues found.</p>
      <p class="hint">Create your first issue using the MCP server tools or Claude Code.</p>
    </div>
  `;
}

function renderTable(issuesWithPlans: IssueWithPlanInfo[]): string {
  return `
    <table class="issues-table">
      <thead>
        <tr>
          <th class="col-number">#</th>
          <th class="col-title">Title</th>
          <th class="col-type">Type</th>
          <th class="col-priority">Priority</th>
          <th class="col-status">Status</th>
          <th class="col-tasks">Tasks</th>
          <th class="col-labels">Labels</th>
        </tr>
      </thead>
      <tbody>
        ${issuesWithPlans.map(item => renderIssueRow(item)).join("\n")}
      </tbody>
    </table>
  `;
}

function renderIssueRow(item: IssueWithPlanInfo): string {
  const { issue, hasPlan, taskCounts } = item;
  return `
    <tr class="issue-row" onclick="window.location.href='/issues/${issue.number}'">
      <td class="col-number">${issue.number}</td>
      <td class="col-title">${escapeHtml(issue.title)}</td>
      <td class="col-type">${renderTypeBadge(issue.type)}</td>
      <td class="col-priority">${renderPriorityBadge(issue.priority)}</td>
      <td class="col-status">${renderStatusBadge(issue.status)}</td>
      <td class="col-tasks">${renderTasksStatus(issue.number, hasPlan, taskCounts)}</td>
      <td class="col-labels">${renderLabels(issue.labels)}</td>
    </tr>
  `;
}

function renderTasksStatus(
  issueNumber: number,
  hasPlan: boolean,
  taskCounts?: { total: number; completed: number; inProgress: number }
): string {
  if (!hasPlan) {
    return '<span class="no-plan">—</span>';
  }

  if (!taskCounts || taskCounts.total === 0) {
    return `<a href="/issues/${issueNumber}" class="plan-link" onclick="event.stopPropagation()">View Plan</a>`;
  }

  const { total, completed, inProgress } = taskCounts;
  const progressPercent = Math.round((completed / total) * 100);

  return `
    <div class="plan-info">
      <a href="/board?issue=${issueNumber}" class="tasks-link" onclick="event.stopPropagation()" title="View tasks on board">
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

function renderLabels(labels: string[]): string {
  if (labels.length === 0) {
    return '<span class="no-labels">—</span>';
  }
  return labels.map(label =>
    `<span class="badge badge-label">${escapeHtml(label)}</span>`
  ).join(" ");
}

export function render404(): string {
  return `
    <div class="error-container">
      <h2>404 - Issue Not Found</h2>
      <p>The issue you're looking for doesn't exist.</p>
      <a href="/" class="btn">← Back to Issues</a>
    </div>
  `;
}
