import Link from "next/link";
import { Badge, ProgressBar } from "../ui";
import type { MilestoneWithIssues } from "@/lib/types";

interface MilestoneCardProps {
  data: MilestoneWithIssues;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength - 3) + "...";
}

export function MilestoneCard({ data }: MilestoneCardProps) {
  const { milestone, issues, progress } = data;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-gray-500">M{milestone.number}</span>
          <span className="font-semibold text-gray-800">{milestone.title}</span>
        </div>
        <Badge variant="status" value={milestone.status} />
      </div>

      {/* Dates */}
      <div className="text-sm text-gray-600 mb-3">
        <span className="font-medium">Start:</span> {milestone.startDate}
        <span className="mx-2">|</span>
        <span className="font-medium">End:</span> {milestone.endDate}
      </div>

      {/* Description */}
      {milestone.description && (
        <p className="text-sm text-gray-600 mb-3">{milestone.description}</p>
      )}

      {/* Progress */}
      <div className="mb-3">
        <div className="flex items-center justify-between text-sm text-gray-600 mb-1">
          <span>Progress</span>
          <span>
            {progress.closed}/{progress.total} issues ({progress.percentage}%)
          </span>
        </div>
        <ProgressBar
          completed={progress.closed}
          total={progress.total}
          showLabel={false}
        />
      </div>

      {/* Issues list */}
      <div className="border-t border-gray-100 pt-3">
        {issues.length > 0 ? (
          <ul className="space-y-2">
            {issues.map((issue) => (
              <li
                key={issue.number}
                className="flex items-center gap-2 text-sm"
              >
                <Link
                  href={`/projects/${encodeURIComponent(milestone.projectId)}/issues/${issue.number}`}
                  className="text-blue-600 hover:underline font-medium"
                >
                  #{issue.number}
                </Link>
                <span className="text-gray-700 truncate flex-1">
                  {truncate(issue.title, 40)}
                </span>
                <Badge variant="status" value={issue.status} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-400">No issues assigned</p>
        )}
      </div>
    </div>
  );
}
