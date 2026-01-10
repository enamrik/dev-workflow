"use client";

import { clsx } from "clsx";
import { Tooltip } from "../ui";

// Color palette for worker badges - visually distinguishable colors
const workerColors = [
  "text-purple-600",
  "text-blue-600",
  "text-cyan-600",
  "text-teal-600",
  "text-amber-600",
  "text-orange-600",
  "text-pink-600",
  "text-indigo-600",
];

/**
 * Hash a worker ID to a consistent color index
 */
function getWorkerColor(workerId: string): string {
  let hash = 0;
  for (let i = 0; i < workerId.length; i++) {
    hash = (hash << 5) - hash + workerId.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit integer
  }
  const index = Math.abs(hash) % workerColors.length;
  return workerColors[index] ?? "text-gray-600";
}

function BotIcon({ className }: { className?: string }) {
  return (
    <svg
      className={clsx("w-3.5 h-3.5", className)}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
      />
    </svg>
  );
}

interface WorkerBadgeProps {
  workerId: string;
  workerName?: string;
  /** Compact mode shows just the icon with tooltip */
  compact?: boolean;
  className?: string;
}

/**
 * Badge showing worker information for tasks with active workers.
 * - Compact mode: just a colored bot icon with worker name tooltip
 * - Full mode: bot icon + worker name + "Working" status badge
 */
export function WorkerBadge({
  workerId,
  workerName,
  compact = false,
  className,
}: WorkerBadgeProps) {
  const displayName = workerName ?? "Worker";
  const color = getWorkerColor(workerId);

  if (compact) {
    return (
      <Tooltip content={displayName} side="top">
        <span className={clsx("cursor-help", color, className)}>
          <BotIcon />
        </span>
      </Tooltip>
    );
  }

  return (
    <div className={clsx("p-3 bg-blue-50 rounded-lg border border-blue-200", className)}>
      <div className="flex items-center gap-2 text-sm">
        <BotIcon className="w-4 h-4 text-blue-600" />
        <span className="text-gray-900 font-medium">{displayName}</span>
        <span className="text-xs text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded">Working</span>
      </div>
    </div>
  );
}
