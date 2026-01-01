import type { Milestone } from "@dev-workflow/core";
import type { MilestoneWithIssues, Project } from "../application/multi-project-service.js";
import { escapeHtml } from "./layout.js";

/**
 * Renders a Gantt-style timeline view of milestones
 */
export function renderMilestoneTimeline(
  milestones: MilestoneWithIssues[],
  projects: Project[],
  projectFilter?: string
): string {
  if (milestones.length === 0) {
    return renderEmptyTimeline(projects, projectFilter);
  }

  // Calculate date range for the timeline
  const { minDate, maxDate, totalDays } = calculateDateRange(milestones);

  return `
    <div class="timeline-container">
      <div class="timeline-header">
        <div class="timeline-title-row">
          <h2>Milestones</h2>
          <span class="milestone-count">${milestones.length} milestone${milestones.length !== 1 ? "s" : ""}</span>
        </div>
        ${renderProjectFilter(projects, projectFilter, "/milestones")}
      </div>

      <div class="timeline-wrapper">
        ${renderTimelineHeader(minDate, maxDate)}
        <div class="timeline-body">
          ${milestones.map((m) => renderMilestoneBar(m, minDate, totalDays)).join("\n")}
        </div>
      </div>

      <div class="milestone-legend">
        <div class="legend-item">
          <span class="legend-color legend-planned"></span>
          <span>Planned</span>
        </div>
        <div class="legend-item">
          <span class="legend-color legend-in-progress"></span>
          <span>In Progress</span>
        </div>
        <div class="legend-item">
          <span class="legend-color legend-completed"></span>
          <span>Completed</span>
        </div>
        <div class="legend-item">
          <span class="legend-color legend-delayed"></span>
          <span>Delayed</span>
        </div>
      </div>

      <div class="milestone-list">
        <h3>Details</h3>
        ${milestones.map((m) => renderMilestoneCard(m)).join("\n")}
      </div>
    </div>
  `;
}

function renderEmptyTimeline(projects: Project[], projectFilter?: string): string {
  return `
    <div class="timeline-container">
      <div class="timeline-header">
        <div class="timeline-title-row">
          <h2>Milestones</h2>
        </div>
        ${renderProjectFilter(projects, projectFilter, "/milestones")}
      </div>
      <div class="timeline-empty">
        <p>No milestones found.</p>
        <p class="hint">Create milestones using the MCP tools to organize your issues into time-bounded goals.</p>
      </div>
    </div>
  `;
}

function renderProjectFilter(
  projects: Project[],
  currentFilter: string | undefined,
  basePath: string
): string {
  if (projects.length <= 1) {
    return "";
  }

  const options = projects
    .map(
      (p) =>
        `<option value="${escapeHtml(p.id)}" ${currentFilter === p.id ? "selected" : ""}>${escapeHtml(p.id)}</option>`
    )
    .join("\n");

  return `
    <div class="project-filter">
      <label for="project-select">Project:</label>
      <select id="project-select" onchange="window.location.href='${basePath}' + (this.value ? '?project=' + this.value : '')">
        <option value="">All Projects</option>
        ${options}
      </select>
    </div>
  `;
}

function calculateDateRange(milestones: MilestoneWithIssues[]): {
  minDate: Date;
  maxDate: Date;
  totalDays: number;
} {
  const today = new Date();

  // Find earliest start and latest end
  let minDate = new Date(milestones[0]!.milestone.startDate);
  let maxDate = new Date(milestones[0]!.milestone.endDate);

  for (const { milestone } of milestones) {
    const start = new Date(milestone.startDate);
    const end = new Date(milestone.endDate);
    if (start < minDate) minDate = start;
    if (end > maxDate) maxDate = end;
  }

  // Extend range slightly for padding
  minDate.setDate(minDate.getDate() - 7);
  maxDate.setDate(maxDate.getDate() + 7);

  // Ensure today is visible
  if (today < minDate) minDate = new Date(today);
  if (today > maxDate) maxDate = new Date(today);

  const totalDays = Math.ceil((maxDate.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24));

  return { minDate, maxDate, totalDays };
}

function renderTimelineHeader(minDate: Date, maxDate: Date): string {
  const months: { name: string; width: number }[] = [];
  let current = new Date(minDate);
  const totalDays = Math.ceil((maxDate.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24));

  while (current <= maxDate) {
    const monthStart = new Date(current);
    const monthEnd = new Date(current.getFullYear(), current.getMonth() + 1, 0);
    const effectiveEnd = monthEnd > maxDate ? maxDate : monthEnd;
    const effectiveStart = monthStart < minDate ? minDate : monthStart;

    const daysInMonth = Math.ceil(
      (effectiveEnd.getTime() - effectiveStart.getTime()) / (1000 * 60 * 60 * 24)
    ) + 1;

    const width = (daysInMonth / totalDays) * 100;

    months.push({
      name: monthStart.toLocaleString("default", { month: "short", year: "2-digit" }),
      width,
    });

    // Move to next month
    current = new Date(current.getFullYear(), current.getMonth() + 1, 1);
  }

  // Calculate today marker position
  const today = new Date();
  const todayOffset = Math.max(
    0,
    Math.min(
      100,
      ((today.getTime() - minDate.getTime()) / (maxDate.getTime() - minDate.getTime())) * 100
    )
  );

  return `
    <div class="timeline-header-row">
      ${months.map((m) => `<div class="timeline-month" style="width: ${m.width}%">${m.name}</div>`).join("")}
    </div>
    <div class="timeline-today-marker" style="left: ${todayOffset}%">
      <div class="today-line"></div>
      <div class="today-label">Today</div>
    </div>
  `;
}

function renderMilestoneBar(
  { milestone, progress }: MilestoneWithIssues,
  minDate: Date,
  totalDays: number
): string {
  const start = new Date(milestone.startDate);
  const end = new Date(milestone.endDate);

  const startOffset = Math.max(0, (start.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24));
  const duration = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

  const leftPercent = (startOffset / totalDays) * 100;
  const widthPercent = (duration / totalDays) * 100;

  const statusClass = milestone.status.toLowerCase().replace("_", "-");

  return `
    <div class="timeline-row">
      <div class="timeline-label">
        <span class="milestone-number">M${milestone.number}</span>
        <span class="milestone-title">${escapeHtml(truncate(milestone.title, 25))}</span>
      </div>
      <div class="timeline-bar-container">
        <div
          class="timeline-bar timeline-bar-${statusClass}"
          style="left: ${leftPercent}%; width: ${widthPercent}%"
          title="${escapeHtml(milestone.title)}: ${milestone.startDate} to ${milestone.endDate}"
        >
          <div class="timeline-bar-progress" style="width: ${progress.percentage}%"></div>
          <span class="timeline-bar-label">${progress.closed}/${progress.total}</span>
        </div>
      </div>
    </div>
  `;
}

function renderMilestoneCard({ milestone, issues, progress }: MilestoneWithIssues): string {
  const statusClass = milestone.status.toLowerCase().replace("_", "-");
  const statusLabel = milestone.status.replace("_", " ");

  const issuesList = issues.length > 0
    ? issues
        .map(
          (i) => `
            <li class="milestone-issue">
              <a href="/projects/${milestone.projectId}/issues/${i.number}">#${i.number}</a>
              <span class="milestone-issue-title">${escapeHtml(truncate(i.title, 40))}</span>
              <span class="badge badge-status badge-${i.status.toLowerCase().replace("_", "-")}">${i.status}</span>
            </li>
          `
        )
        .join("")
    : '<li class="no-issues">No issues assigned</li>';

  return `
    <div class="milestone-card">
      <div class="milestone-card-header">
        <div class="milestone-card-title">
          <span class="milestone-number">M${milestone.number}</span>
          <span>${escapeHtml(milestone.title)}</span>
        </div>
        <span class="badge badge-milestone-status badge-${statusClass}">${statusLabel}</span>
      </div>
      <div class="milestone-card-dates">
        <span class="date-label">Start:</span> ${milestone.startDate}
        <span class="date-separator">|</span>
        <span class="date-label">End:</span> ${milestone.endDate}
      </div>
      ${milestone.description ? `<p class="milestone-description">${escapeHtml(milestone.description)}</p>` : ""}
      <div class="milestone-progress">
        <div class="milestone-progress-bar">
          <div class="milestone-progress-fill" style="width: ${progress.percentage}%"></div>
        </div>
        <span class="milestone-progress-text">${progress.closed}/${progress.total} issues (${progress.percentage}%)</span>
      </div>
      <ul class="milestone-issues-list">
        ${issuesList}
      </ul>
    </div>
  `;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength - 3) + "...";
}
