import { IssueRow } from "./IssueRow";
import { EmptyState } from "../ui";
import type { ProjectIssueWithPlanInfo } from "../../api";

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
    <table className="w-full">
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
  );
}
