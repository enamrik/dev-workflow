"use client";

import { Suspense } from "react";
import { useWorkerData, useUrlState } from "@/hooks";
import { Card, Badge, LoadingState, ErrorState, EmptyState } from "@/components/ui";
import type { Worker, DispatchQueueEntry } from "@/lib/types";

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h ago`;
  return `${Math.floor(diffSeconds / 86400)}d ago`;
}

function formatHeartbeatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function formatDuration(startDateString: string): string {
  const start = new Date(startDateString);
  const now = new Date();
  const diffSeconds = Math.floor((now.getTime() - start.getTime()) / 1000);

  if (diffSeconds < 0) return "0s";
  if (diffSeconds < 60) return `${diffSeconds}s`;

  const hours = Math.floor(diffSeconds / 3600);
  const minutes = Math.floor((diffSeconds % 3600) / 60);
  const seconds = diffSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m ${seconds}s`;
}

export default function WorkersPage() {
  return (
    <Suspense
      fallback={
        <Card>
          <LoadingState message="Loading..." />
        </Card>
      }
    >
      <WorkersPageContent />
    </Suspense>
  );
}

function WorkersPageContent() {
  // Enable URL state persistence
  useUrlState();

  const { data, isLoading, error, refetch } = useWorkerData();

  const workers = data?.workers ?? [];
  const queue = data?.queue ?? [];
  const stats = data?.stats ?? { total: 0, unclaimed: 0, claimed: 0, stale: 0 };

  // Separate alive and dead workers
  const aliveWorkers = workers.filter((w) => w.isAlive);
  const deadWorkers = workers.filter((w) => !w.isAlive);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Task Workers</h1>
          <p className="text-gray-600 mt-1">
            Background task execution and dispatch queue • Updates automatically
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded transition-colors"
          title="Force refresh (updates automatically via WebSocket)"
        >
          ↻ Refresh
        </button>
      </div>

      {/* Stats summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="text-sm text-gray-500">Total Queue</div>
          <div className="text-2xl font-bold text-gray-800">{stats.total}</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-gray-500">Unclaimed</div>
          <div className="text-2xl font-bold text-gray-800">{stats.unclaimed}</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-gray-500">In Progress</div>
          <div className="text-2xl font-bold text-gray-800">{stats.claimed - stats.stale}</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-gray-500">Stale</div>
          <div className="text-2xl font-bold text-gray-800">
            {stats.stale}
            {stats.stale > 0 && <span className="text-sm text-orange-600 ml-2">(dead worker)</span>}
          </div>
        </Card>
      </div>

      {/* Content */}
      {isLoading ? (
        <Card>
          <LoadingState message="Loading worker data..." />
        </Card>
      ) : error ? (
        <Card>
          <ErrorState
            title="Failed to load worker data"
            message={error instanceof Error ? error.message : "Unknown error"}
            onRetry={() => refetch()}
          />
        </Card>
      ) : (
        <>
          {/* Workers section */}
          <Card>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-800">
                Workers
                <span className="ml-2 text-sm text-gray-500">
                  ({aliveWorkers.length} active
                  {deadWorkers.length > 0 ? `, ${deadWorkers.length} dead` : ""})
                </span>
              </h2>
            </div>

            {workers.length === 0 ? (
              <EmptyState
                title="No Workers"
                description="No task workers are currently registered. Workers register when Claude Code runs in worker mode."
              />
            ) : (
              <div className="space-y-3">
                {aliveWorkers.map((worker) => (
                  <WorkerCard key={worker.id} worker={worker} />
                ))}
                {deadWorkers.length > 0 && (
                  <>
                    <div className="text-sm text-gray-500 pt-2 border-t border-gray-200 mt-2">
                      Dead Workers (no heartbeat)
                    </div>
                    {deadWorkers.map((worker) => (
                      <WorkerCard key={worker.id} worker={worker} />
                    ))}
                  </>
                )}
              </div>
            )}
          </Card>

          {/* Dispatch Queue section */}
          <Card>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-800">
                Dispatch Queue
                <span className="ml-2 text-sm text-gray-500">({stats.unclaimed} waiting)</span>
              </h2>
            </div>

            {queue.length === 0 ? (
              <EmptyState
                title="Queue Empty"
                description="No tasks are currently in the dispatch queue. Tasks are added when dispatched to workers."
              />
            ) : (
              <div className="space-y-3">
                {queue.map((entry) => (
                  <QueueEntryCard key={entry.taskId} entry={entry} />
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

interface WorkerCardProps {
  worker: Worker;
}

function WorkerCard({ worker }: WorkerCardProps) {
  const statusColor = {
    IDLE: "bg-green-100 text-green-700",
    WORKING: "bg-blue-100 text-blue-700",
    DRAINING: "bg-yellow-100 text-yellow-700",
  }[worker.status];

  return (
    <div
      className={`p-4 rounded-lg border ${
        worker.isAlive ? "bg-gray-50 border-gray-200" : "bg-red-50 border-red-200"
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          {/* Worker name and status */}
          <div className="flex items-center gap-2">
            <WorkerIcon className={worker.isAlive ? "text-green-500" : "text-red-500"} />
            <span className="font-medium text-gray-800">{worker.name}</span>
            {worker.isAlive ? (
              <Badge variant="status" value={worker.status} className={statusColor} />
            ) : (
              <Badge variant="status" value="DEAD" className="bg-red-100 text-red-700" />
            )}
          </div>

          {/* Current task - only show if we have the task details */}
          {worker.issueNumber !== undefined && worker.taskNumber !== undefined && (
            <div className="mt-1 text-sm">
              <span className="text-gray-600">Working on:</span>{" "}
              <span className="font-medium text-gray-800">
                #{worker.issueNumber}.{worker.taskNumber}
                {worker.totalTasks !== undefined && (
                  <span className="text-gray-500 ml-1">
                    [{worker.taskNumber}/{worker.totalTasks}]
                  </span>
                )}
              </span>
            </div>
          )}
        </div>

        {/* Task duration (alive workers with task) or heartbeat */}
        <div className="text-right">
          {worker.isAlive && worker.taskStartedAt ? (
            <>
              <div className="text-sm text-gray-600">Running for</div>
              <div className="text-sm font-medium text-blue-600">
                {formatDuration(worker.taskStartedAt)}
              </div>
            </>
          ) : (
            <>
              <div className="text-sm text-gray-600">Heartbeat</div>
              <div
                className={`text-sm font-medium ${worker.isAlive ? "text-green-600" : "text-red-600"}`}
              >
                {formatHeartbeatAge(worker.heartbeatAge)}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

interface QueueEntryCardProps {
  entry: DispatchQueueEntry;
}

function QueueEntryCard({ entry }: QueueEntryCardProps) {
  const isClaimed = entry.workerId !== null;

  return (
    <div
      className={`p-4 rounded-lg border ${
        entry.isStale
          ? "bg-orange-50 border-orange-200"
          : isClaimed
            ? "bg-blue-50 border-blue-200"
            : "bg-gray-50 border-gray-200"
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          {/* Task info */}
          <div className="flex items-center gap-2">
            <QueueIcon className="text-gray-500" />
            {entry.issueNumber !== undefined && entry.taskNumber !== undefined ? (
              <span className="font-medium text-gray-800">
                #{entry.issueNumber}.{entry.taskNumber}
                {entry.totalTasks !== undefined && (
                  <span className="text-gray-500 ml-1">
                    [{entry.taskNumber}/{entry.totalTasks}]
                  </span>
                )}
              </span>
            ) : (
              <span className="font-mono text-sm text-gray-600">{entry.taskId.slice(0, 8)}...</span>
            )}
            {entry.isStale && (
              <Badge variant="status" value="STALE" className="bg-orange-100 text-orange-700" />
            )}
            {isClaimed && !entry.isStale && (
              <Badge variant="status" value="CLAIMED" className="bg-blue-100 text-blue-700" />
            )}
            {!isClaimed && (
              <Badge variant="status" value="WAITING" className="bg-gray-100 text-gray-700" />
            )}
          </div>

          {/* Task title */}
          {entry.taskTitle && (
            <div className="text-sm text-gray-700 mt-1 truncate">{entry.taskTitle}</div>
          )}

          {/* Worker info */}
          {entry.workerName && (
            <div className="text-xs text-gray-500 mt-1">
              {entry.isStale ? "Was claimed by:" : "Claimed by:"} {entry.workerName}
            </div>
          )}
        </div>

        {/* Timing */}
        <div className="text-right">
          <div className="text-sm text-gray-600">Queued</div>
          <div className="text-sm text-gray-800">{formatTimeAgo(entry.createdAt)}</div>
          {entry.claimedAt && (
            <>
              <div className="text-sm text-gray-600 mt-1">Claimed</div>
              <div className="text-sm text-gray-800">{formatTimeAgo(entry.claimedAt)}</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function WorkerIcon({ className }: { className?: string }) {
  return (
    <svg className={`w-5 h-5 ${className}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
      />
    </svg>
  );
}

function QueueIcon({ className }: { className?: string }) {
  return (
    <svg className={`w-5 h-5 ${className}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 6h16M4 10h16M4 14h16M4 18h16"
      />
    </svg>
  );
}
