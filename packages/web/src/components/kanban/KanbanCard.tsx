"use client";

import { useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { Badge, Modal, Markdown, Tooltip } from "../ui";
import { TaskTiming, TaskMetadataPanel, TaskActions } from "../tasks";
import type { Task } from "@/lib/types";

interface KanbanCardProps {
  task: Task;
  issueNumber: number;
  issueTitle: string;
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
  issueUrl: string;
  projectId?: string;
}

function TaskModalContent({
  task,
  issueNumber,
  issueTitle,
  issueUrl,
  projectId,
}: TaskModalContentProps) {
  const [activeTab, setActiveTab] = useState<ModalTab>("task");

  return (
    <div>
      {/* Sticky Header */}
      <div className="sticky top-0 z-10 p-4 border-b border-gray-200 bg-white rounded-t-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-gray-900 text-sm">
              <Tooltip content={issueTitle} side="bottom">
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
          <Badge variant="status" value={task.status} />
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
            {(task.branchName || task.prUrl || projectId) ? (
              <TaskActions
                task={task}
                issueNumber={issueNumber}
                showCopyCommand={!!projectId}
              />
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
            <TaskTiming task={task} />
            {task.estimatedMinutes && (
              <span className="text-gray-500">
                Est: {task.estimatedMinutes}m
              </span>
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

function TaskTab({
  task,
}: {
  task: Task;
}) {
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
    return (
      <div className="text-sm text-gray-500">
        Project context required to load details.
      </div>
    );
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
  issueUrl,
  projectId,
  projectName,
}: {
  task: Task;
  issueNumber: number;
  issueTitle: string;
  issueUrl: string;
  projectId?: string;
  projectName?: string;
}) {
  const isCompleted = task.status === "COMPLETED";
  const isInProgress = task.status === "IN_PROGRESS";
  const isPRReview = task.status === "PR_REVIEW";
  const isAbandoned = task.status === "ABANDONED";

  return (
    <div
      className={clsx(
        "bg-white rounded-lg shadow-sm border p-3 transition-shadow hover:shadow-md",
        isCompleted && "border-green-200",
        isInProgress && "border-orange-200",
        isPRReview && "border-blue-200",
        isAbandoned && "border-red-200 opacity-75",
        !isCompleted && !isInProgress && !isPRReview && !isAbandoned && "border-gray-200"
      )}
    >
      {/* Task number and title at top */}
      <div className="font-medium text-gray-800 text-sm mb-1">
        <Tooltip content={issueTitle} side="bottom">
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
      <div className="text-xs text-gray-600 mb-2">
        {truncate(task.description, 100)}
      </div>

      {/* Footer: project and metadata */}
      <div className="flex items-center justify-between text-xs">
        {(projectName || projectId) && (
          <span className="font-medium text-gray-600">{projectName ?? projectId}</span>
        )}
        <div className="flex items-center gap-2">
          {task.estimatedMinutes && (
            <span className="text-gray-500">{task.estimatedMinutes}m</span>
          )}
          {/* Show PR indicator on card */}
          {task.prUrl && (
            <span className="text-blue-500" title={`PR #${task.prNumber}`}>
              <PRIcon />
            </span>
          )}
          {/* Show worktree indicator on card */}
          {task.worktreePath && (
            <span className="text-gray-500" title="Has worktree">
              <BranchIcon />
            </span>
          )}
          {isAbandoned && <Badge variant="status" value="ABANDONED" />}
          {task.labels.length > 0 && (
            <div className="flex gap-1 flex-wrap">
              {task.labels.slice(0, 2).map((label) => (
                <Badge key={label} variant="label" value={label} />
              ))}
            </div>
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
          issueUrl={issueUrl}
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
        issueUrl={issueUrl}
        projectId={projectId}
      />
    </Modal>
  );
}

function PRIcon() {
  return (
    <svg
      className="w-3.5 h-3.5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
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
    <svg
      className="w-3.5 h-3.5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M13 10V3L4 14h7v7l9-11h-7z"
      />
    </svg>
  );
}
