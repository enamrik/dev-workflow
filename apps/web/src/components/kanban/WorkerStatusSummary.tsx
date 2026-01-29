"use client";

import { useWorkerData } from "@/hooks";

interface WorkerCounts {
  active: number;
  idle: number;
  dead: number;
}

function computeWorkerCounts(
  workers: { isAlive: boolean; status: string }[] | undefined
): WorkerCounts {
  if (!workers || workers.length === 0) {
    return { active: 0, idle: 0, dead: 0 };
  }

  let active = 0;
  let idle = 0;
  let dead = 0;

  for (const worker of workers) {
    if (!worker.isAlive) {
      dead++;
    } else if (worker.status === "WORKING") {
      active++;
    } else {
      // IDLE or DRAINING
      idle++;
    }
  }

  return { active, idle, dead };
}

function TaskIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

function WorkerIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 6.75v10.5a2.25 2.25 0 002.25 2.25z"
      />
    </svg>
  );
}

interface StatBadgeProps {
  value: number;
  label: string;
  variant: "default" | "active" | "idle" | "dead";
  title?: string;
}

function StatBadge({ value, label, variant, title }: StatBadgeProps) {
  const variantStyles = {
    default: "bg-gray-100 text-gray-600",
    active: "bg-blue-50 text-blue-700",
    idle: "bg-gray-100 text-gray-600",
    dead: "bg-red-50 text-red-700",
  };

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${variantStyles[variant]}`}
      title={title}
    >
      <span className="font-semibold">{value}</span>
      <span className="font-normal">{label}</span>
    </span>
  );
}

interface BoardStatsRibbonProps {
  activeTasks: number;
}

export function BoardStatsRibbon({ activeTasks }: BoardStatsRibbonProps) {
  const { data, isLoading } = useWorkerData();
  const counts = computeWorkerCounts(data?.workers);
  const hasWorkers = !isLoading && data?.workers && data.workers.length > 0;

  return (
    <div className="inline-flex items-center gap-4 px-3 py-1.5 bg-gray-50 rounded-lg text-xs">
      {/* Tasks section */}
      <div className="flex items-center gap-2">
        <TaskIcon className="w-4 h-4 text-gray-400" />
        <span className="text-gray-500">Tasks</span>
        <StatBadge
          value={activeTasks}
          label="active"
          variant="default"
          title="Tasks in Ready, In Progress, or PR Review"
        />
      </div>

      {/* Divider - only show if workers section will render */}
      {(isLoading || hasWorkers) && <div className="w-px h-4 bg-gray-200" />}

      {/* Workers section */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-gray-400">
          <WorkerIcon className="w-4 h-4" />
          <span>Loading...</span>
        </div>
      ) : hasWorkers ? (
        <div className="flex items-center gap-2">
          <WorkerIcon className="w-4 h-4 text-gray-400" />
          <span className="text-gray-500">Workers</span>
          <div className="flex items-center gap-1">
            <StatBadge
              value={counts.active}
              label="active"
              variant="active"
              title="Workers currently executing tasks"
            />
            <StatBadge
              value={counts.idle}
              label="idle"
              variant="idle"
              title="Workers available for work"
            />
            {counts.dead > 0 && (
              <StatBadge
                value={counts.dead}
                label="dead"
                variant="dead"
                title="Workers that stopped responding"
              />
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// Keep original export for backwards compatibility
export function WorkerStatusSummary() {
  const { data, isLoading } = useWorkerData();
  const counts = computeWorkerCounts(data?.workers);

  if (!isLoading && (!data?.workers || data.workers.length === 0)) {
    return null;
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-3 text-xs text-gray-400">
        <span>workers: ...</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="text-gray-500">workers:</span>
      <span className="text-blue-600" title="Workers currently executing tasks">
        {counts.active} active
      </span>
      <span className="text-gray-500" title="Workers available for work">
        {counts.idle} idle
      </span>
      {counts.dead > 0 && (
        <span className="text-red-600 font-medium" title="Workers that stopped responding">
          {counts.dead} dead
        </span>
      )}
    </div>
  );
}
