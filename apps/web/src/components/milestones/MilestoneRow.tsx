"use client";

import { Badge, ProgressBar } from "../ui";
import type { MilestoneWithIssues } from "@/lib/types";

interface MilestoneRowProps {
  data: MilestoneWithIssues;
  onClick: () => void;
  isMobile?: boolean;
}

export function MilestoneRow({ data, onClick, isMobile = false }: MilestoneRowProps) {
  const { milestone, progress } = data;

  // Mobile card layout
  if (isMobile) {
    return (
      <div className="p-4 hover:bg-gray-50 cursor-pointer transition-colors" onClick={onClick}>
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-bold text-gray-500">M{milestone.number}</span>
              <div className="font-medium text-gray-800">{milestone.title}</div>
            </div>
            {milestone.projectName && (
              <span className="inline-block px-1.5 py-0.5 text-xs rounded bg-gray-100 text-gray-500">
                {milestone.projectName}
              </span>
            )}
          </div>
          <Badge variant="status" value={milestone.status} />
        </div>
        <div className="text-xs text-gray-600 mb-3">
          {milestone.startDate} – {milestone.endDate}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <ProgressBar completed={progress.closed} total={progress.total} size="sm" />
          </div>
          <span className="text-xs text-gray-500 whitespace-nowrap">
            {progress.closed}/{progress.total}
          </span>
        </div>
      </div>
    );
  }

  // Desktop table row layout
  return (
    <tr
      className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors"
      onClick={onClick}
    >
      <td className="py-3 px-3 w-20">
        <span className="font-bold text-gray-500">M{milestone.number}</span>
      </td>
      <td className="py-3 px-3">
        <div className="font-medium text-gray-800">{milestone.title}</div>
        {milestone.projectName && (
          <span className="inline-block mt-1 px-1.5 py-0.5 text-xs rounded bg-gray-100 text-gray-500">
            {milestone.projectName}
          </span>
        )}
      </td>
      <td className="py-3 px-3 w-56">
        <span className="text-xs text-gray-600 whitespace-nowrap">
          {milestone.startDate} – {milestone.endDate}
        </span>
      </td>
      <td className="py-3 px-3 w-32">
        <Badge variant="status" value={milestone.status} />
      </td>
      <td className="py-3 px-3 w-36">
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <ProgressBar completed={progress.closed} total={progress.total} size="sm" />
          </div>
          <span className="text-xs text-gray-500 whitespace-nowrap">
            {progress.closed}/{progress.total}
          </span>
        </div>
      </td>
    </tr>
  );
}
