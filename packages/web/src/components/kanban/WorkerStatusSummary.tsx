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

export function WorkerStatusSummary() {
  const { data, isLoading } = useWorkerData();
  const counts = computeWorkerCounts(data?.workers);

  // Don't render if no workers exist and not loading
  if (!isLoading && (!data?.workers || data.workers.length === 0)) {
    return null;
  }

  // Show skeleton while loading
  if (isLoading) {
    return (
      <div className="flex items-center gap-3 text-xs text-gray-400">
        <span>Workers: ...</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="text-gray-500">Workers:</span>
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
