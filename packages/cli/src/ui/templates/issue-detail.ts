import type { Issue } from "@dev-workflow/mcp-server/domain/issue.js";
import { escapeHtml } from "./layout.js";

export function renderIssueDetail(issue: Issue): string {
  return `
    <div class="issue-detail-container">
      <div class="issue-detail-header">
        <a href="/" class="back-link">← Back to Issues</a>
        <h2>Issue #${issue.number}</h2>
      </div>

      <div class="issue-detail-content">
        <div class="issue-title-section">
          <h1>${escapeHtml(issue.title)}</h1>
          <div class="issue-badges">
            ${renderTypeBadge(issue.type)}
            ${renderPriorityBadge(issue.priority)}
            ${renderStatusBadge(issue.status)}
          </div>
        </div>

        <div class="issue-section">
          <h3>Description</h3>
          <div class="issue-description">
            ${escapeHtml(issue.description).replace(/\n/g, "<br>")}
          </div>
        </div>

        ${issue.acceptanceCriteria.length > 0 ? renderAcceptanceCriteria(issue.acceptanceCriteria) : ""}

        ${issue.labels.length > 0 ? renderLabelsSection(issue.labels) : ""}

        <div class="issue-metadata">
          <div class="metadata-row">
            <span class="metadata-label">Created:</span>
            <span class="metadata-value">${formatDate(issue.createdAt)}</span>
          </div>
          <div class="metadata-row">
            <span class="metadata-label">Updated:</span>
            <span class="metadata-value">${formatDate(issue.updatedAt)}</span>
          </div>
          ${issue.createdBy ? `
            <div class="metadata-row">
              <span class="metadata-label">Created By:</span>
              <span class="metadata-value">${escapeHtml(issue.createdBy)}</span>
            </div>
          ` : ""}
          ${issue.templateUsed ? `
            <div class="metadata-row">
              <span class="metadata-label">Template:</span>
              <span class="metadata-value">${escapeHtml(issue.templateUsed)}</span>
            </div>
          ` : ""}
        </div>
      </div>
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

function renderAcceptanceCriteria(criteria: string[]): string {
  return `
    <div class="issue-section">
      <h3>Acceptance Criteria</h3>
      <ul class="acceptance-criteria">
        ${criteria.map(criterion => `
          <li>
            <label class="criterion-item">
              <input type="checkbox" disabled>
              <span>${escapeHtml(criterion)}</span>
            </label>
          </li>
        `).join("\n")}
      </ul>
    </div>
  `;
}

function renderLabelsSection(labels: string[]): string {
  return `
    <div class="issue-section">
      <h3>Labels</h3>
      <div class="labels-list">
        ${labels.map(label => `<span class="badge badge-label">${escapeHtml(label)}</span>`).join(" ")}
      </div>
    </div>
  `;
}

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
