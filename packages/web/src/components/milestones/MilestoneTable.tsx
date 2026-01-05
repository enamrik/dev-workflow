import { MilestoneRow } from "./MilestoneRow";
import { EmptyState } from "../ui";
import type { MilestoneWithIssues } from "@/lib/types";

interface MilestoneTableProps {
  milestones: MilestoneWithIssues[];
  onRowClick: (milestone: MilestoneWithIssues) => void;
}

export function MilestoneTable({ milestones, onRowClick }: MilestoneTableProps) {
  if (milestones.length === 0) {
    return (
      <EmptyState
        title="No milestones found"
        description="No milestones match your search criteria."
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
            Date Range
          </th>
          <th className="text-left py-3 px-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">
            Status
          </th>
          <th className="text-left py-3 px-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">
            Progress
          </th>
        </tr>
      </thead>
      <tbody>
        {milestones.map((item) => (
          <MilestoneRow key={item.milestone.id} data={item} onClick={() => onRowClick(item)} />
        ))}
      </tbody>
    </table>
  );
}
