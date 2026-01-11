"use client";

import { useRouter } from "next/navigation";
import { IssueRow } from "./IssueRow";
import { EmptyState, Badge, ProgressBar } from "../ui";
import Link from "next/link";
import type { ProjectIssueWithPlanInfo } from "@/lib/types";

interface IssueTableProps {
  issues: ProjectIssueWithPlanInfo[];
}

export function IssueTable({ issues }: IssueTableProps) {
  if (issues.length === 0) {
    return (
      <EmptyState
        title="No issues found"
        description="Create your first issue using the MCP server tools or Claude Code."
      />
    );
  }

  return (
    <>
      {/* Mobile card view */}
      <div className="md:hidden space-y-3">
        {issues.map((item) => (
          <IssueCard key={item.issue.id} item={item} />
        ))}
      </div>

      {/* Tablet/Desktop table view */}
      <table className="hidden md:table w-full">
        <thead className="bg-gray-50 border-b-2 border-gray-200">
          <tr>
            <th className="text-left py-3 px-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">
              #
            </th>
            <th className="text-left py-3 px-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">
              Title
            </th>
            <th className="text-left py-3 px-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">
              Type
            </th>
            <th className="text-left py-3 px-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">
              Priority
            </th>
            <th className="text-left py-3 px-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">
              Status
            </th>
            <th className="text-left py-3 px-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">
              Tasks
            </th>
          </tr>
        </thead>
        <tbody>
          {issues.map((item) => (
            <IssueRow key={item.issue.id} item={item} />
          ))}
        </tbody>
      </table>
    </>
  );
}

interface IssueCardProps {
  item: ProjectIssueWithPlanInfo;
}

function IssueCard({ item }: IssueCardProps) {
  const router = useRouter();
  const { issue, hasPlan, taskCounts, computedStatus, projectName, projectSlug, milestoneTitle } =
    item;

  const issueUrl = projectSlug
    ? `/projects/${encodeURIComponent(projectSlug)}/issues/${issue.number}`
    : `/issues/${issue.number}`;

  const boardUrl = "/";

  function handleCardClick() {
    router.push(issueUrl);
  }

  return (
    <div
      className="bg-white border border-gray-200 rounded-lg p-4 hover:bg-gray-50 cursor-pointer transition-colors"
      onClick={handleCardClick}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-semibold text-gray-600">#{issue.number}</span>
            <Badge variant="status" value={computedStatus} />
          </div>
          <h3 className="font-medium text-gray-800 mb-2">{issue.title}</h3>
          <div className="flex flex-wrap gap-2">
            <Badge variant="type" value={issue.type} />
            <Badge variant="priority" value={issue.priority} />
            {projectName && (
              <span className="inline-block px-2 py-1 text-xs rounded bg-gray-100 text-gray-600">
                {projectName}
              </span>
            )}
            {milestoneTitle && (
              <span className="inline-block px-2 py-1 text-xs rounded bg-gray-100 text-gray-600">
                {milestoneTitle}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Tasks progress */}
      {hasPlan && taskCounts && taskCounts.total > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <div className="flex items-center gap-2">
            <Link
              href={boardUrl}
              className="flex-1"
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
              title="View tasks on board"
            >
              <ProgressBar
                completed={taskCounts.completed}
                total={taskCounts.total}
                inProgress={taskCounts.inProgress}
                size="sm"
              />
            </Link>
            {taskCounts.inProgress > 0 && (
              <span
                className="w-2 h-2 rounded-full bg-orange-400 animate-pulse"
                title={`${taskCounts.inProgress} in progress`}
              />
            )}
          </div>
        </div>
      )}
      {hasPlan && (!taskCounts || taskCounts.total === 0) && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <Link
            href={issueUrl}
            className="text-blue-600 hover:underline text-sm"
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          >
            View Plan
          </Link>
        </div>
      )}
    </div>
  );
}
