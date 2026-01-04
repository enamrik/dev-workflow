"use client";

import { Suspense } from "react";
import { useWorktrees, usePruneWorktrees } from "@/hooks";
import { useProjectContext } from "@/contexts";
import {
  Card,
  Badge,
  LoadingState,
  ErrorState,
  EmptyState,
} from "@/components/ui";
import type { Worktree } from "@/lib/types";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatPath(path: string): string {
  // Show just the last 2-3 segments for readability
  const parts = path.split("/");
  if (parts.length <= 3) return path;
  return ".../" + parts.slice(-3).join("/");
}

export default function WorktreesPage() {
  return (
    <Suspense fallback={<Card><LoadingState message="Loading..." /></Card>}>
      <WorktreesPageContent />
    </Suspense>
  );
}

function WorktreesPageContent() {
  const { projectId } = useProjectContext();

  const { data: worktrees, isLoading, error, refetch } = useWorktrees({ project: projectId || undefined });
  const pruneMutation = usePruneWorktrees();

  const handlePrune = async (projectId: string) => {
    try {
      await pruneMutation.mutateAsync(projectId);
    } catch (e) {
      console.error("Failed to prune worktrees:", e);
    }
  };

  // Calculate totals
  const totalWorktrees = worktrees?.length ?? 0;
  const totalDiskUsage = worktrees?.reduce((sum, w) => sum + (w.diskUsageBytes ?? 0), 0) ?? 0;
  const orphanedWorktrees = worktrees?.filter((w) => !w.taskId) ?? [];

  // Group worktrees by project
  const worktreesByProject = worktrees?.reduce<Record<string, Worktree[]>>((acc, w) => {
    const existing = acc[w.projectId];
    if (existing) {
      existing.push(w);
    } else {
      acc[w.projectId] = [w];
    }
    return acc;
  }, {}) ?? {};

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-800">Worktrees</h1>
        <p className="text-gray-600 mt-1">
          Git worktrees for isolated task execution
        </p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="text-sm text-gray-500">Total Worktrees</div>
          <div className="text-2xl font-bold text-gray-800">{totalWorktrees}</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-gray-500">Total Disk Usage</div>
          <div className="text-2xl font-bold text-gray-800">
            {formatBytes(totalDiskUsage)}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-gray-500">Orphaned</div>
          <div className="text-2xl font-bold text-gray-800">
            {orphanedWorktrees.length}
            {orphanedWorktrees.length > 0 && (
              <span className="text-sm text-orange-600 ml-2">(no linked task)</span>
            )}
          </div>
        </Card>
      </div>

      {/* Content */}
      {isLoading ? (
        <Card>
          <LoadingState message="Loading worktrees..." />
        </Card>
      ) : error ? (
        <Card>
          <ErrorState
            title="Failed to load worktrees"
            message={error instanceof Error ? error.message : "Unknown error"}
            onRetry={() => refetch()}
          />
        </Card>
      ) : totalWorktrees === 0 ? (
        <Card>
          <EmptyState
            title="No Worktrees"
            description="No git worktrees found. Worktrees are created when starting tasks with the createWorktree option."
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {Object.entries(worktreesByProject).map(([projectId, projectWorktrees]) => (
            <Card key={projectId}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-800">
                  {projectId}
                  <span className="ml-2 text-sm text-gray-500">
                    ({projectWorktrees.length} worktree{projectWorktrees.length !== 1 ? "s" : ""})
                  </span>
                </h2>
                <button
                  onClick={() => handlePrune(projectId)}
                  disabled={pruneMutation.isPending}
                  className="px-3 py-1.5 text-sm bg-orange-100 text-orange-700 rounded hover:bg-orange-200 transition-colors disabled:opacity-50"
                >
                  {pruneMutation.isPending ? "Pruning..." : "Prune Stale"}
                </button>
              </div>

              <div className="space-y-3">
                {projectWorktrees.map((worktree) => (
                  <WorktreeCard key={worktree.path} worktree={worktree} />
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

interface WorktreeCardProps {
  worktree: Worktree;
}

function WorktreeCard({ worktree }: WorktreeCardProps) {
  const isOrphaned = !worktree.taskId;

  return (
    <div
      className={`p-4 rounded-lg border ${
        isOrphaned
          ? "bg-orange-50 border-orange-200"
          : "bg-gray-50 border-gray-200"
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          {/* Branch name */}
          <div className="flex items-center gap-2">
            <BranchIcon className="text-gray-500" />
            <code className="font-mono text-sm text-gray-800 truncate">
              {worktree.branch}
            </code>
            {isOrphaned && (
              <Badge variant="status" value="ORPHANED" className="bg-orange-100 text-orange-700" />
            )}
          </div>

          {/* Path */}
          <div className="text-xs text-gray-500 mt-1" title={worktree.path}>
            {formatPath(worktree.path)}
          </div>

          {/* Task info */}
          {worktree.taskId && (
            <div className="mt-2 text-sm">
              <span className="text-gray-600">
                Issue #{worktree.issueNumber} / Task #{worktree.taskNumber}:
              </span>{" "}
              <span className="text-gray-800">{worktree.taskTitle}</span>
              {worktree.taskStatus && (
                <Badge
                  variant="status"
                  value={worktree.taskStatus}
                  className="ml-2"
                />
              )}
            </div>
          )}
        </div>

        {/* Disk usage */}
        <div className="text-right">
          <div className="text-sm font-medium text-gray-800">
            {worktree.diskUsageBytes ? formatBytes(worktree.diskUsageBytes) : "-"}
          </div>
          <div className="text-xs text-gray-500">
            {worktree.head.substring(0, 7)}
          </div>
        </div>
      </div>
    </div>
  );
}

function BranchIcon({ className }: { className?: string }) {
  return (
    <svg
      className={`w-4 h-4 ${className}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M13 10V3L4 14h7v7l9-11h-7z"
      />
    </svg>
  );
}
