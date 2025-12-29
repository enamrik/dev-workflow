import type { Issue } from "@dev-workflow/mcp-server/domain/issue.js";
import { escapeHtml } from "./layout.js";

export function renderIssuesList(issues: Issue[]): string {
  const issueCount = issues.length;
  const issuesWord = issueCount === 1 ? "issue" : "issues";

  return `
    <div class="issues-container">
      <div class="issues-header">
        <h2>Issues</h2>
        <span class="issue-count">${issueCount} ${issuesWord}</span>
      </div>

      ${issues.length === 0 ? renderEmpty() : renderTable(issues)}
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

function renderTable(issues: Issue[]): string {
  return `
    <table class="issues-table">
      <thead>
        <tr>
          <th class="col-number">#</th>
          <th class="col-title">Title</th>
          <th class="col-type">Type</th>
          <th class="col-priority">Priority</th>
          <th class="col-status">Status</th>
          <th class="col-labels">Labels</th>
        </tr>
      </thead>
      <tbody>
        ${issues.map(issue => renderIssueRow(issue)).join("\n")}
      </tbody>
    </table>
  `;
}

function renderIssueRow(issue: Issue): string {
  return `
    <tr class="issue-row" onclick="window.location.href='/issues/${issue.number}'">
      <td class="col-number">${issue.number}</td>
      <td class="col-title">${escapeHtml(issue.title)}</td>
      <td class="col-type">${renderTypeBadge(issue.type)}</td>
      <td class="col-priority">${renderPriorityBadge(issue.priority)}</td>
      <td class="col-status">${renderStatusBadge(issue.status)}</td>
      <td class="col-labels">${renderLabels(issue.labels)}</td>
    </tr>
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
