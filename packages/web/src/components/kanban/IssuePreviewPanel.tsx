"use client";

import { useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { useIssue } from "@/hooks";
import { TaskList } from "@/components/tasks";
import {
  Badge,
  Tabs,
  TabPanel,
  ProgressBar,
  LoadingState,
  ErrorState,
  EmptyState,
  Markdown,
  GitHubLink,
} from "@/components/ui";
import type { Issue, Plan, Task, ComputedIssueStatus } from "@/lib/types";

type TabId = "details" | "plan" | "tasks";

interface IssuePreviewPanelProps {
  projectSlug: string;
  issueNumber: number;
  onClose: () => void;
}

export function IssuePreviewPanel({ projectSlug, issueNumber, onClose }: IssuePreviewPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>("details");

  const { data, isLoading, error, refetch } = useIssue(projectSlug, issueNumber);

  function handleTabChange(tabId: string) {
    setActiveTab(tabId as TabId);
  }

  const issueUrl = `/projects/${encodeURIComponent(projectSlug)}/issues/${issueNumber}`;

  return (
    <>
      {/* Backdrop for clicking outside */}
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} aria-hidden="true" />
      <div
        className="fixed inset-y-0 right-0 w-[480px] max-w-full bg-white shadow-xl border-l border-gray-200 z-50 flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-label={`Issue #${issueNumber} preview`}
      >
        {/* Header with close button */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Link
              href={issueUrl}
              className="text-blue-600 hover:text-blue-800 font-medium"
              onClick={(e) => e.stopPropagation()}
            >
              Issue #{issueNumber}
            </Link>
            <span className="text-gray-400">|</span>
            <Link
              href={issueUrl}
              className="text-sm text-gray-500 hover:text-gray-700"
              onClick={(e) => e.stopPropagation()}
            >
              Open full page &rarr;
            </Link>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700"
            aria-label="Close preview"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-y-auto">
          {isLoading && (
            <div className="p-4">
              <LoadingState message="Loading issue..." />
            </div>
          )}

          {error && (
            <div className="p-4">
              <ErrorState
                title="Failed to load issue"
                message={error instanceof Error ? error.message : "Unknown error"}
                onRetry={() => refetch()}
              />
            </div>
          )}

          {data && (
            <IssuePreviewContent
              data={data}
              activeTab={activeTab}
              onTabChange={handleTabChange}
              projectSlug={projectSlug}
            />
          )}
        </div>
      </div>
    </>
  );
}

interface IssuePreviewContentProps {
  data: { issue: Issue; plan: Plan | null; tasks: Task[] };
  activeTab: TabId;
  onTabChange: (tabId: string) => void;
  projectSlug: string;
}

function IssuePreviewContent({
  data,
  activeTab,
  onTabChange,
  projectSlug,
}: IssuePreviewContentProps) {
  const { issue, plan, tasks } = data;
  const taskCounts = {
    total: tasks.length,
    completed: tasks.filter((t) => t.status === "COMPLETED").length,
    inProgress: tasks.filter((t) => t.status === "IN_PROGRESS").length,
  };

  const computedStatus = computeIssueStatus(issue, plan, tasks);

  const tabs = [
    { id: "details", label: "Details" },
    { id: "plan", label: plan ? "Plan \u2713" : "Plan" },
    {
      id: "tasks",
      label: tasks.length > 0 ? `Tasks (${taskCounts.completed}/${taskCounts.total})` : "Tasks",
    },
  ];

  return (
    <div className="p-4">
      {/* Title and badges */}
      <div className="mb-4">
        <h2 className="text-lg font-bold text-gray-800 mb-2">{issue.title}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="type" value={issue.type} />
          <Badge variant="priority" value={issue.priority} />
          <Badge variant="status" value={computedStatus} />
          {issue.githubSync?.githubUrl && (
            <GitHubLink
              url={issue.githubSync.githubUrl}
              label={`#${issue.githubSync.githubIssueNumber}`}
              tooltip={`View on GitHub: ${issue.githubSync.githubUrl}`}
            />
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={onTabChange} />

      {/* Tab content */}
      {activeTab === "details" && <DetailsTab issue={issue} />}
      {activeTab === "plan" && <PlanTab plan={plan} />}
      {activeTab === "tasks" && (
        <TasksTab
          tasks={tasks}
          taskCounts={taskCounts}
          projectId={projectSlug}
          issueNumber={issue.number}
        />
      )}
    </div>
  );
}

interface DetailsTabProps {
  issue: Issue;
}

function DetailsTab({ issue }: DetailsTabProps) {
  return (
    <TabPanel>
      {/* Description */}
      <section className="mb-4">
        <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2">
          Description
        </h3>
        <Markdown>{issue.description}</Markdown>
      </section>

      {/* Acceptance Criteria */}
      {issue.acceptanceCriteria.length > 0 && (
        <section className="mb-4">
          <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2">
            Acceptance Criteria
          </h3>
          <ul className="space-y-1">
            {issue.acceptanceCriteria.map((criterion, idx) => (
              <li key={idx} className="flex items-start gap-2 text-sm">
                <input type="checkbox" disabled className="mt-0.5 rounded border-gray-300" />
                <span className="text-gray-800">{criterion}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Metadata */}
      <section className="border-t border-gray-200 pt-3 text-sm">
        <dl className="grid grid-cols-2 gap-3">
          <div>
            <dt className="text-gray-500">Created</dt>
            <dd className="text-gray-800">{formatDate(issue.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Updated</dt>
            <dd className="text-gray-800">{formatDate(issue.updatedAt)}</dd>
          </div>
        </dl>
      </section>
    </TabPanel>
  );
}

interface PlanTabProps {
  plan: Plan | null;
}

function PlanTab({ plan }: PlanTabProps) {
  if (!plan) {
    return (
      <TabPanel>
        <EmptyState
          title="No Implementation Plan"
          description="No implementation plan has been generated yet."
        />
      </TabPanel>
    );
  }

  return (
    <TabPanel>
      {/* Complexity badge */}
      <div className="mb-3">
        <Badge variant="complexity" value={plan.estimatedComplexity} />
        <span className="ml-2 text-sm text-gray-600">Complexity</span>
      </div>

      {/* Summary */}
      <section className="mb-4">
        <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2">
          Summary
        </h3>
        <Markdown>{plan.summary}</Markdown>
      </section>

      {/* Approach */}
      <section className="mb-4">
        <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2">
          Approach
        </h3>
        <Markdown>{plan.approach}</Markdown>
      </section>
    </TabPanel>
  );
}

interface TasksTabProps {
  tasks: Task[];
  taskCounts: { total: number; completed: number; inProgress: number };
  projectId: string;
  issueNumber: number;
}

function TasksTab({ tasks, taskCounts, projectId, issueNumber }: TasksTabProps) {
  if (tasks.length === 0) {
    return (
      <TabPanel>
        <EmptyState title="No Tasks" description="No tasks have been created for this issue." />
      </TabPanel>
    );
  }

  return (
    <TabPanel>
      {/* Progress header */}
      <div className="mb-4">
        <div className="max-w-xs">
          <div className="text-sm text-gray-600 mb-1">
            {taskCounts.completed}/{taskCounts.total} completed
          </div>
          <ProgressBar
            completed={taskCounts.completed}
            total={taskCounts.total}
            inProgress={taskCounts.inProgress}
            showLabel={false}
          />
        </div>
      </div>

      {/* Task list */}
      <TaskList tasks={tasks} projectId={projectId} issueNumber={issueNumber} />
    </TabPanel>
  );
}

function formatDate(isoString: string): string {
  return format(new Date(isoString), "MMM d, yyyy");
}

/**
 * Compute single issue status from issue state and tasks.
 */
function computeIssueStatus(issue: Issue, plan: Plan | null, tasks: Task[]): ComputedIssueStatus {
  if (issue.status === "CLOSED") {
    return "CLOSED";
  }

  if (issue.status === "PLANNED") {
    return "PLANNED";
  }

  if (!plan || tasks.length === 0) {
    return "OPEN";
  }

  const completed = tasks.filter((t) => t.status === "COMPLETED").length;
  const abandoned = tasks.filter((t) => t.status === "ABANDONED").length;
  const inProgress = tasks.filter((t) => t.status === "IN_PROGRESS").length;
  const prReview = tasks.filter((t) => t.status === "PR_REVIEW").length;

  if (completed + abandoned === tasks.length) {
    return "TASKS_DONE";
  }

  if (inProgress === 0 && prReview === 0) {
    return "OPEN";
  }

  return "IN_PROGRESS";
}
