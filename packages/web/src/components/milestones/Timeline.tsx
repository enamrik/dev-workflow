"use client";

import { useState, useMemo } from "react";
import { clsx } from "clsx";
import { MilestoneTable } from "./MilestoneTable";
import { MilestoneDetailModal } from "./MilestoneDetailModal";
import { EmptyState, SearchInput } from "../ui";
import type { MilestoneWithIssues } from "@/lib/types";

interface TimelineProps {
  milestones: MilestoneWithIssues[];
  showCompleted?: boolean;
}

function calculateDateRange(milestones: MilestoneWithIssues[]): {
  minDate: Date;
  maxDate: Date;
  totalDays: number;
} {
  const today = new Date();
  const firstMilestone = milestones[0];
  if (!firstMilestone) {
    return { minDate: today, maxDate: today, totalDays: 1 };
  }

  let minDate = new Date(firstMilestone.milestone.startDate);
  let maxDate = new Date(firstMilestone.milestone.endDate);

  for (const { milestone } of milestones) {
    const start = new Date(milestone.startDate);
    const end = new Date(milestone.endDate);
    if (start < minDate) minDate = start;
    if (end > maxDate) maxDate = end;
  }

  // Extend range for padding
  minDate.setDate(minDate.getDate() - 7);
  maxDate.setDate(maxDate.getDate() + 7);

  // Ensure today is visible
  if (today < minDate) minDate = new Date(today);
  if (today > maxDate) maxDate = new Date(today);

  const totalDays = Math.ceil((maxDate.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24));

  return { minDate, maxDate, totalDays };
}

function getMonthLabels(
  minDate: Date,
  maxDate: Date,
  totalDays: number
): { name: string; width: number }[] {
  const months: { name: string; width: number }[] = [];
  const current = new Date(minDate);

  while (current <= maxDate) {
    const monthStart = new Date(current);
    const monthEnd = new Date(current.getFullYear(), current.getMonth() + 1, 0);
    const effectiveEnd = monthEnd > maxDate ? maxDate : monthEnd;
    const effectiveStart = monthStart < minDate ? minDate : monthStart;

    const daysInMonth =
      Math.ceil((effectiveEnd.getTime() - effectiveStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    const width = (daysInMonth / totalDays) * 100;

    months.push({
      name: monthStart.toLocaleString("default", {
        month: "short",
        year: "2-digit",
      }),
      width,
    });

    current.setMonth(current.getMonth() + 1);
    current.setDate(1);
  }

  return months;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength - 3) + "...";
}

export function Timeline({ milestones, showCompleted = false }: TimelineProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMilestone, setSelectedMilestone] = useState<MilestoneWithIssues | null>(null);

  // Filter milestones based on status (hide COMPLETED by default)
  const visibleMilestones = useMemo(() => {
    if (showCompleted) {
      return milestones;
    }
    return milestones.filter((item) => item.milestone.status !== "COMPLETED");
  }, [milestones, showCompleted]);

  // Further filter by search query
  const filteredMilestones = useMemo(() => {
    if (!searchQuery.trim()) {
      return visibleMilestones;
    }
    const query = searchQuery.toLowerCase();
    return visibleMilestones.filter(
      (item) =>
        item.milestone.title.toLowerCase().includes(query) ||
        (item.milestone.description?.toLowerCase().includes(query) ?? false)
    );
  }, [visibleMilestones, searchQuery]);

  if (milestones.length === 0) {
    return (
      <EmptyState
        title="No milestones found"
        description="Create milestones using the MCP tools to organize your issues into time-bounded goals."
      />
    );
  }

  // Use visibleMilestones for timeline (respects showCompleted filter)
  const { minDate, maxDate, totalDays } = calculateDateRange(visibleMilestones);
  const months = getMonthLabels(minDate, maxDate, totalDays);

  // Calculate today marker position
  const today = new Date();
  const todayOffset = Math.max(
    0,
    Math.min(
      100,
      ((today.getTime() - minDate.getTime()) / (maxDate.getTime() - minDate.getTime())) * 100
    )
  );

  return (
    <div className="space-y-8">
      {/* Timeline visualization */}
      {visibleMilestones.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-4 overflow-x-auto">
          {/* Month header */}
          <div className="flex border-b border-gray-200 mb-4 min-w-[600px]">
            {months.map((month, idx) => (
              <div
                key={idx}
                className="text-xs font-medium text-gray-600 py-2 text-center"
                style={{ width: `${month.width}%` }}
              >
                {month.name}
              </div>
            ))}
          </div>

          {/* Timeline body with today marker */}
          <div className="relative min-w-[600px]">
            {/* Today marker */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10"
              style={{ left: `${todayOffset}%` }}
            >
              <div className="absolute -top-5 left-1/2 -translate-x-1/2 text-xs bg-red-500 text-white px-1 rounded">
                Today
              </div>
            </div>

            {/* Milestone bars */}
            <div className="space-y-3">
              {visibleMilestones.map((data) => (
                <MilestoneBar
                  key={data.milestone.id}
                  data={data}
                  minDate={minDate}
                  totalDays={totalDays}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex gap-4 justify-center text-sm">
        <LegendItem status="PLANNED" label="Planned" />
        <LegendItem status="IN_PROGRESS" label="In Progress" />
        <LegendItem status="COMPLETED" label="Completed" />
        <LegendItem status="DELAYED" label="Delayed" />
      </div>

      {/* Milestone table with search */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-800">Details</h3>
          <SearchInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search milestones..."
            className="w-64"
          />
        </div>
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <MilestoneTable
            milestones={filteredMilestones}
            onRowClick={setSelectedMilestone}
          />
        </div>
      </div>

      {/* Detail modal */}
      <MilestoneDetailModal
        isOpen={selectedMilestone !== null}
        onClose={() => setSelectedMilestone(null)}
        data={selectedMilestone}
      />
    </div>
  );
}

interface MilestoneBarProps {
  data: MilestoneWithIssues;
  minDate: Date;
  totalDays: number;
}

function MilestoneBar({ data, minDate, totalDays }: MilestoneBarProps) {
  const { milestone, progress } = data;

  const start = new Date(milestone.startDate);
  const end = new Date(milestone.endDate);

  const startOffset = Math.max(0, (start.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24));
  const duration = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

  const leftPercent = (startOffset / totalDays) * 100;
  const widthPercent = (duration / totalDays) * 100;

  const statusColors: Record<string, string> = {
    PLANNED: "bg-gray-300",
    IN_PROGRESS: "bg-orange-400",
    COMPLETED: "bg-green-500",
    DELAYED: "bg-red-400",
  };

  const progressColor = milestone.status === "COMPLETED" ? "bg-green-600" : "bg-green-500";

  return (
    <div className="flex items-center gap-4">
      {/* Label */}
      <div className="w-32 flex-shrink-0">
        <span className="text-xs font-bold text-gray-500">M{milestone.number}</span>
        <span className="ml-2 text-sm text-gray-700 truncate">{truncate(milestone.title, 15)}</span>
      </div>

      {/* Bar container */}
      <div className="flex-1 relative h-6">
        <div
          className={clsx(
            "absolute h-full rounded-full overflow-hidden",
            statusColors[milestone.status] ?? "bg-gray-300"
          )}
          style={{ left: `${leftPercent}%`, width: `${widthPercent}%` }}
          title={`${milestone.title}: ${milestone.startDate} to ${milestone.endDate}`}
        >
          {/* Progress fill */}
          <div
            className={clsx("h-full", progressColor)}
            style={{ width: `${progress.percentage}%` }}
          />
          {/* Label */}
          <span className="absolute inset-0 flex items-center justify-center text-xs font-medium text-white">
            {progress.closed}/{progress.total}
          </span>
        </div>
      </div>
    </div>
  );
}

interface LegendItemProps {
  status: string;
  label: string;
}

function LegendItem({ status, label }: LegendItemProps) {
  const colors: Record<string, string> = {
    PLANNED: "bg-gray-300",
    IN_PROGRESS: "bg-orange-400",
    COMPLETED: "bg-green-500",
    DELAYED: "bg-red-400",
  };

  return (
    <div className="flex items-center gap-2">
      <div className={clsx("w-3 h-3 rounded-full", colors[status])} />
      <span className="text-gray-600">{label}</span>
    </div>
  );
}
