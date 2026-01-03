"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, ProgressBar } from "../ui";
import type { ProjectIssueWithPlanInfo } from "@/lib/types";

interface IssueRowProps {
  item: ProjectIssueWithPlanInfo;
}

export function IssueRow({ item }: IssueRowProps) {
  const router = useRouter();
  const { issue, hasPlan, taskCounts, projectName } = item;

  const issueUrl = issue.projectId
    ? `/projects/${encodeURIComponent(issue.projectId)}/issues/${issue.number}`
    : `/issues/${issue.number}`;

  const boardUrl = issue.projectId
    ? `/?project=${encodeURIComponent(issue.projectId)}&issue=${issue.number}`
    : `/?issue=${issue.number}`;

  function handleRowClick() {
    router.push(issueUrl);
  }

  return (
    <tr
      className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors"
      onClick={handleRowClick}
    >
      <td className="py-3 px-3 w-20 font-semibold text-gray-600">
        {issue.number}
      </td>
      <td className="py-3 px-3">
        <div className="font-medium text-gray-800">{issue.title}</div>
        {projectName && (
          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded inline-block mt-1">
            {projectName}
          </span>
        )}
      </td>
      <td className="py-3 px-3 w-28">
        <Badge variant="type" value={issue.type} />
      </td>
      <td className="py-3 px-3 w-28">
        <Badge variant="priority" value={issue.priority} />
      </td>
      <td className="py-3 px-3 w-28">
        <Badge variant="status" value={issue.status} />
      </td>
      <td className="py-3 px-3 w-36">
        <TasksStatus
          issueUrl={issueUrl}
          boardUrl={boardUrl}
          hasPlan={hasPlan}
          taskCounts={taskCounts}
        />
      </td>
    </tr>
  );
}

interface TasksStatusProps {
  issueUrl: string;
  boardUrl: string;
  hasPlan: boolean;
  taskCounts?: {
    total: number;
    completed: number;
    inProgress: number;
  };
}

function TasksStatus({
  issueUrl,
  boardUrl,
  hasPlan,
  taskCounts,
}: TasksStatusProps) {
  if (!hasPlan) {
    return <span className="text-gray-400">-</span>;
  }

  if (!taskCounts || taskCounts.total === 0) {
    return (
      <Link
        href={issueUrl}
        className="text-blue-600 hover:underline text-sm"
        onClick={(e) => e.stopPropagation()}
      >
        View Plan
      </Link>
    );
  }

  const { total, completed, inProgress } = taskCounts;

  return (
    <div className="flex items-center gap-2">
      <Link
        href={boardUrl}
        className="flex-1"
        onClick={(e) => e.stopPropagation()}
        title="View tasks on board"
      >
        <ProgressBar
          completed={completed}
          total={total}
          inProgress={inProgress}
          size="sm"
        />
      </Link>
      {inProgress > 0 && (
        <span
          className="w-2 h-2 rounded-full bg-orange-400 animate-pulse"
          title={`${inProgress} in progress`}
        />
      )}
    </div>
  );
}
