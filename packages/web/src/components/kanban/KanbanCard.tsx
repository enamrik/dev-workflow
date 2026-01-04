"use client";

import { useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { Badge, Modal, Markdown, Tooltip, GitHubLink } from "../ui";
import { TaskTiming, TaskMetadataPanel, TaskActions } from "../tasks";
import type { Task, ComputedIssueStatus } from "@/lib/types";

type IssueType = "FEATURE" | "BUG" | "ENHANCEMENT" | "TASK";

// Issue status dot colors - matches the status badge colors from Badge.tsx
const issueStatusDotColors: Record<ComputedIssueStatus, string> = {
  PLANNED: "bg-gray-500", // Falls back to default (gray)
  OPEN: "bg-green-600", // bg-green-100 text-green-800
  IN_PROGRESS: "bg-orange-500", // bg-orange-100 text-orange-700
  TASKS_DONE: "bg-green-600", // bg-green-100 text-green-800
  CLOSED: "bg-gray-400", // bg-gray-200 text-gray-700
};

// Human-readable status labels for tooltip
const issueStatusLabels: Record<ComputedIssueStatus, string> = {
  PLANNED: "Planned",
  OPEN: "Open",
  IN_PROGRESS: "In Progress",
  TASKS_DONE: "Tasks Done",
  CLOSED: "Closed",
};

function StatusDot({ status }: { status: ComputedIssueStatus }) {
  return (
    <Tooltip content={`Issue not closed (${issueStatusLabels[status]})`} side="top">
      <span
        className={clsx(
          "inline-block w-2 h-2 rounded-full cursor-help",
          issueStatusDotColors[status]
        )}
      />
    </Tooltip>
  );
}

// Issue type styles - tag background, text, and border colors
const issueTypeConfig: Record<IssueType, { label: string; tag: string; border: string }> = {
  FEATURE: { label: "feat", tag: "bg-emerald-50 text-emerald-600", border: "border-emerald-200" },
  BUG: { label: "bug", tag: "bg-rose-50 text-rose-600", border: "border-rose-200" },
  ENHANCEMENT: { label: "enh", tag: "bg-teal-50 text-teal-600", border: "border-teal-200" },
  TASK: { label: "task", tag: "bg-gray-100 text-gray-500", border: "border-gray-200" },
};

interface KanbanCardProps {
  task: Task;
  issueNumber: number;
  issueTitle: string;
  issueType: IssueType;
  issueGithubUrl?: string;
  issueComputedStatus: ComputedIssueStatus;
  projectId?: string;
  projectName?: string;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength - 3) + "...";
}

type ModalTab = "task" | "details";

interface TaskModalContentProps {
  task: Task;
  issueNumber: number;
  issueTitle: string;
  issueType: string;
  issueUrl: string;
  issueGithubUrl?: string;
  projectId?: string;
}

function TaskModalContent({
  task,
  issueNumber,
  issueTitle,
  issueType,
  issueUrl,
  issueGithubUrl,
  projectId,
}: TaskModalContentProps) {
  const tooltipContent = `${issueType.toLowerCase()}(#${issueNumber}): ${issueTitle}`;
  const [activeTab, setActiveTab] = useState<ModalTab>("task");

  return (
    <div>
      {/* Sticky Header */}
      <div className="sticky top-0 z-10 p-4 border-b border-gray-200 bg-white rounded-t-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-gray-900 text-sm">
              <Tooltip content={tooltipContent} side="bottom">
                <Link
                  href={issueUrl}
                  className="text-blue-600 hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  #{issueNumber}.{task.number}
                </Link>
              </Tooltip>{" "}
              {task.title}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {issueGithubUrl && (
              <GitHubLink
                url={issueGithubUrl}
                label="Issue"
                tooltip={`View issue on GitHub: ${issueGithubUrl}`}
              />
            )}
            <Badge variant="status" value={task.status} />
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-3">
          <button
            onClick={() => setActiveTab("task")}
            className={clsx(
              "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
              activeTab === "task"
                ? "bg-gray-900 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            )}
          >
            Task
          </button>
          <button
            onClick={() => setActiveTab("details")}
            className={clsx(
              "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
              activeTab === "details"
                ? "bg-gray-900 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            )}
          >
            Details
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        {/* Subheader: Actions panel + PR status */}
        {(task.branchName || task.prUrl || projectId || task.prStatus) && (
          <div className="flex items-center justify-between gap-2 mb-4">
            {task.branchName || task.prUrl || projectId ? (
              <TaskActions task={task} issueNumber={issueNumber} showCopyCommand={!!projectId} />
            ) : (
              <div />
            )}
            {task.prStatus && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">PR Status:</span>
                <Badge variant="prStatus" value={task.prStatus} />
              </div>
            )}
          </div>
        )}

        {activeTab === "task" ? (
          <TaskTab task={task} />
        ) : (
          <DetailsTab task={task} projectId={projectId} issueNumber={issueNumber} />
        )}
      </div>

      {/* Sticky Footer */}
      <div className="sticky bottom-0 z-10 p-3 border-t border-gray-200 bg-gray-50 rounded-b-xl">
        <div className="flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-3">
            <TaskTiming task={task} variant="detailed" />
            {task.estimatedMinutes && (
              <span className="text-gray-500">Est: {task.estimatedMinutes}m</span>
            )}
          </div>
          {task.labels.length > 0 && (
            <div className="flex gap-1 flex-wrap">
              {task.labels.map((label) => (
                <Badge key={label} variant="label" value={label} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TaskTab({ task }: { task: Task }) {
  return (
    <div className="space-y-4">
      {/* Description */}
      {task.description && (
        <div>
          <Markdown className="text-sm">{task.description}</Markdown>
        </div>
      )}

      {/* Acceptance criteria */}
      {task.acceptanceCriteria.length > 0 && (
        <div>
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
            Acceptance Criteria
          </div>
          <ul className="text-sm text-gray-700 space-y-1">
            {task.acceptanceCriteria.map((criterion, index) => (
              <li key={index} className="flex items-start gap-2">
                <span className="text-gray-400 mt-0.5">-</span>
                <span>{criterion}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Context instructions */}
      {task.contextInstructions && (
        <div>
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
            Context Instructions
          </div>
          <div className="text-sm text-gray-700 bg-gray-50 p-3 rounded-lg border border-gray-200">
            {task.contextInstructions}
          </div>
        </div>
      )}
    </div>
  );
}

function DetailsTab({
  task,
  projectId,
  issueNumber,
}: {
  task: Task;
  projectId?: string;
  issueNumber: number;
}) {
  if (!projectId) {
    return <div className="text-sm text-gray-500">Project context required to load details.</div>;
  }

  return (
    <TaskMetadataPanel
      task={task}
      projectId={projectId}
      issueNumber={issueNumber}
      hideActions
      hidePRStatus
      hideTimestamps
    />
  );
}

function CardContent({
  task,
  issueNumber,
  issueTitle,
  issueType,
  issueUrl,
  issueComputedStatus,
  projectId,
  projectName,
}: {
  task: Task;
  issueNumber: number;
  issueTitle: string;
  issueType: IssueType;
  issueUrl: string;
  issueComputedStatus: ComputedIssueStatus;
  projectId?: string;
  projectName?: string;
}) {
  const tooltipContent = `${issueType.toLowerCase()}(#${issueNumber}): ${issueTitle}`;
  const isAbandoned = task.status === "ABANDONED";

  return (
    <div
      className={clsx(
        "relative bg-white rounded-lg shadow-sm border border-gray-200 p-3 transition-shadow hover:shadow-md overflow-hidden",
        isAbandoned && "opacity-75"
      )}
    >
      {/* Issue type tag - flush top right */}
      <span
        className={clsx(
          "absolute top-0 right-0 text-[8px] font-medium uppercase px-1 py-px rounded-bl",
          issueTypeConfig[issueType].tag
        )}
      >
        {issueTypeConfig[issueType].label}
      </span>

      {/* Task number and title */}
      <div className="font-medium text-gray-800 text-sm mb-1">
        <Tooltip content={tooltipContent} side="bottom">
          <Link
            href={issueUrl}
            className="text-blue-600 hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            #{issueNumber}.{task.number}
          </Link>
        </Tooltip>{" "}
        {task.title}
      </div>

      {/* Task description */}
      <div className="text-xs text-gray-600 mb-2">{truncate(task.description, 100)}</div>

      {/* Footer: project and metadata */}
      <div className="flex items-center justify-between text-xs">
        {(projectName || projectId) && (
          <span className="font-medium text-gray-600">{projectName ?? projectId}</span>
        )}
        <div className="flex items-center gap-2">
          <TaskTiming task={task} className="text-gray-500" />
          {/* Show PR indicator on card */}
          {task.prUrl && (
            <Tooltip content={`PR #${task.prNumber}`} side="top">
              <span className="text-blue-500 cursor-help">
                <PRIcon />
              </span>
            </Tooltip>
          )}
          {/* Show worktree indicator on card */}
          {task.worktreePath && (
            <Tooltip content="Has worktree" side="top">
              <span className="text-gray-500 cursor-help">
                <BranchIcon />
              </span>
            </Tooltip>
          )}
          {isAbandoned && <Badge variant="status" value="ABANDONED" />}
          {task.labels.length > 0 && (
            <div className="flex gap-1 flex-wrap">
              {task.labels.slice(0, 2).map((label) => (
                <Badge key={label} variant="label" value={label} />
              ))}
            </div>
          )}
          {/* Issue status indicator - only show for completed tasks whose issue isn't closed yet */}
          {task.status === "COMPLETED" && issueComputedStatus !== "CLOSED" && (
            <StatusDot status={issueComputedStatus} />
          )}
        </div>
      </div>
    </div>
  );
}

export function KanbanCard({
  task,
  issueNumber,
  issueTitle,
  issueType,
  issueGithubUrl,
  issueComputedStatus,
  projectId,
  projectName,
}: KanbanCardProps) {
  const issueUrl = projectId
    ? `/projects/${encodeURIComponent(projectId)}/issues/${issueNumber}`
    : `/issues/${issueNumber}`;

  return (
    <Modal
      trigger={
        <CardContent
          task={task}
          issueNumber={issueNumber}
          issueTitle={issueTitle}
          issueType={issueType}
          issueUrl={issueUrl}
          issueComputedStatus={issueComputedStatus}
          projectId={projectId}
          projectName={projectName}
        />
      }
      maxHeight={600}
    >
      <TaskModalContent
        task={task}
        issueNumber={issueNumber}
        issueTitle={issueTitle}
        issueType={issueType}
        issueUrl={issueUrl}
        issueGithubUrl={issueGithubUrl}
        projectId={projectId}
      />
    </Modal>
  );
}

function PRIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
      />
    </svg>
  );
}

function BranchIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M13 10V3L4 14h7v7l9-11h-7z"
      />
    </svg>
  );
}
