"use client";

import { use } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { format } from "date-fns";
import { useIssue } from "@/hooks";
import { TaskList } from "@/components/tasks";
import {
  Card,
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

interface PageProps {
  params: Promise<{
    project: string;
    number: string;
  }>;
}

export default function IssueDetailPage({ params }: PageProps) {
  const { project: projectId, number } = use(params);
  const searchParams = useSearchParams();
  const router = useRouter();

  const issueNumber = number ? parseInt(number, 10) : undefined;
  const activeTab = (searchParams.get("tab") as TabId) || "details";

  const { data, isLoading, error, refetch } = useIssue(projectId, issueNumber);

  function handleTabChange(tabId: string) {
    router.push(`/projects/${projectId}/issues/${number}?tab=${tabId}`);
  }

  if (isLoading) {
    return (
      <Card>
        <LoadingState message="Loading issue..." />
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <ErrorState
          title="Issue Not Found"
          message={error instanceof Error ? error.message : "The issue could not be found."}
          onRetry={() => refetch()}
        />
      </Card>
    );
  }

  const { issue, plan, tasks } = data;
  const taskCounts = {
    total: tasks.length,
    completed: tasks.filter((t) => t.status === "COMPLETED").length,
    inProgress: tasks.filter((t) => t.status === "IN_PROGRESS").length,
  };

  // Compute single status from issue state and tasks
  const computedStatus = computeIssueStatus(issue, plan, tasks);

  const backUrl = projectId ? `/?project=${encodeURIComponent(projectId)}` : "/";
  const boardUrl = projectId
    ? `/?project=${encodeURIComponent(projectId)}&issue=${issue.number}`
    : `/?issue=${issue.number}`;

  const tabs = [
    { id: "details", label: "Details" },
    { id: "plan", label: plan ? "Plan \u2713" : "Plan" },
    {
      id: "tasks",
      label:
        tasks.length > 0 ? `Tasks (${taskCounts.completed}/${taskCounts.total})` : "Tasks",
    },
  ];

  return (
    <Card>
      {/* Header */}
      <div className="mb-6">
        <Link
          href={backUrl}
          className="text-gray-600 hover:text-gray-800 text-sm mb-3 inline-block"
        >
          &larr; Back to Issues
        </Link>
        <h2 className="text-lg font-semibold text-gray-600 mb-2">
          Issue #{issue.number}
        </h2>
      </div>

      {/* Title and badges */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800 mb-3">{issue.title}</h1>
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
      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={handleTabChange} />

      {/* Tab content */}
      {activeTab === "details" && <DetailsTab issue={issue} />}
      {activeTab === "plan" && <PlanTab plan={plan} />}
      {activeTab === "tasks" && (
        <TasksTab
          tasks={tasks}
          taskCounts={taskCounts}
          boardUrl={boardUrl}
          projectId={projectId}
          issueNumber={issue.number}
        />
      )}
    </Card>
  );
}

interface DetailsTabProps {
  issue: Issue;
}

function DetailsTab({ issue }: DetailsTabProps) {
  return (
    <TabPanel>
      {/* Description */}
      <section className="mb-6">
        <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2">
          Description
        </h3>
        <Markdown>{issue.description}</Markdown>
      </section>

      {/* Acceptance Criteria */}
      {issue.acceptanceCriteria.length > 0 && (
        <section className="mb-6">
          <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2">
            Acceptance Criteria
          </h3>
          <ul className="space-y-2">
            {issue.acceptanceCriteria.map((criterion, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <input
                  type="checkbox"
                  disabled
                  className="mt-1 rounded border-gray-300"
                />
                <span className="text-gray-800">{criterion}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Metadata */}
      <section className="border-t border-gray-200 pt-4">
        <dl className="grid grid-cols-2 gap-4 text-sm">
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
          description="No implementation plan has been generated yet. Use the MCP tool generate_plan to create a plan for this issue."
        />
      </TabPanel>
    );
  }

  return (
    <TabPanel>
      {/* Complexity badge */}
      <div className="mb-4">
        <Badge variant="complexity" value={plan.estimatedComplexity} />
        <span className="ml-2 text-sm text-gray-600">Complexity</span>
      </div>

      {/* Summary */}
      <section className="mb-6">
        <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2">
          Summary
        </h3>
        <Markdown>{plan.summary}</Markdown>
      </section>

      {/* Approach */}
      <section className="mb-6">
        <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2">
          Approach
        </h3>
        <Markdown>{plan.approach}</Markdown>
      </section>

      {/* Metadata */}
      <section className="border-t border-gray-200 pt-4 text-sm text-gray-500">
        Generated on {formatDate(plan.createdAt)}
      </section>
    </TabPanel>
  );
}

interface TasksTabProps {
  tasks: Task[];
  taskCounts: { total: number; completed: number; inProgress: number };
  boardUrl: string;
  projectId: string;
  issueNumber: number;
}

function TasksTab({ tasks, taskCounts, boardUrl, projectId, issueNumber }: TasksTabProps) {
  if (tasks.length === 0) {
    return (
      <TabPanel>
        <EmptyState
          title="No Tasks"
          description="No tasks have been created for this issue. Generate an implementation plan to create tasks."
        />
      </TabPanel>
    );
  }

  return (
    <TabPanel>
      {/* Progress header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex-1 max-w-xs">
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
        <Link
          href={boardUrl}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
        >
          View on Board &rarr;
        </Link>
      </div>

      {/* Task list */}
      <TaskList tasks={tasks} projectId={projectId} issueNumber={issueNumber} />
    </TabPanel>
  );
}

function formatDate(isoString: string): string {
  return format(new Date(isoString), "MMM d, yyyy 'at' h:mm a");
}

/**
 * Compute single issue status from issue state and tasks.
 *
 * Status rules:
 * - CLOSED: Issue is explicitly closed
 * - TASKS_DONE: All tasks are COMPLETED or ABANDONED (issue ready to be closed)
 * - IN_PROGRESS: Some tasks not completed AND no tasks in BACKLOG/READY (work has started)
 * - OPEN: Plan exists but work not started (tasks in BACKLOG/READY), or no plan/tasks yet
 */
function computeIssueStatus(
  issue: Issue,
  plan: Plan | null,
  tasks: Task[]
): ComputedIssueStatus {
  // Explicitly closed issues stay CLOSED
  if (issue.status === "CLOSED") {
    return "CLOSED";
  }

  // No plan means OPEN
  if (!plan || tasks.length === 0) {
    return "OPEN";
  }

  const completed = tasks.filter((t) => t.status === "COMPLETED").length;
  const abandoned = tasks.filter((t) => t.status === "ABANDONED").length;
  const inProgress = tasks.filter((t) => t.status === "IN_PROGRESS").length;
  const prReview = tasks.filter((t) => t.status === "PR_REVIEW").length;

  // All tasks done (completed or abandoned) = TASKS_DONE
  if (completed + abandoned === tasks.length) {
    return "TASKS_DONE";
  }

  // No tasks have progressed past READY (all are BACKLOG, READY, or terminal) = OPEN
  if (inProgress === 0 && prReview === 0) {
    return "OPEN";
  }

  // At least one task is IN_PROGRESS or PR_REVIEW = IN_PROGRESS
  return "IN_PROGRESS";
}
