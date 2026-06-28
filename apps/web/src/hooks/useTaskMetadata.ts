"use client";

import { useQuery } from "@tanstack/react-query";
import { getTaskStatusHistory, getTaskExecutionLogs, getTaskDependencies } from "@/lib/api";
import type { Task, TaskStatusHistory, TaskExecutionLog } from "@/lib/types";

export interface TaskMetadata {
  history: TaskStatusHistory[];
  logs: TaskExecutionLog[];
  dependencies: Task[];
}

interface UseTaskMetadataOptions {
  enabled?: boolean;
}

/**
 * Hook to fetch task metadata (status history, execution logs, dependencies).
 * Fetches all three in parallel when enabled.
 */
export function useTaskMetadata(
  projectId: string | undefined,
  taskId: string | undefined,
  options: UseTaskMetadataOptions = {}
) {
  const { enabled = true } = options;
  const isEnabled = enabled && !!projectId && !!taskId;

  const historyQuery = useQuery<TaskStatusHistory[]>({
    queryKey: ["taskHistory", projectId, taskId],
    queryFn: () => getTaskStatusHistory(projectId!, taskId!),
    enabled: isEnabled,
  });

  const logsQuery = useQuery<TaskExecutionLog[]>({
    queryKey: ["taskLogs", projectId, taskId],
    queryFn: () => getTaskExecutionLogs(projectId!, taskId!),
    enabled: isEnabled,
  });

  const dependenciesQuery = useQuery<Task[]>({
    queryKey: ["taskDependencies", projectId, taskId],
    queryFn: () => getTaskDependencies(projectId!, taskId!),
    enabled: isEnabled,
  });

  const error = historyQuery.error || logsQuery.error || dependenciesQuery.error;
  // Error must dominate over loading: if any query has failed, surface the error
  // rather than the spinner. Otherwise a perpetually-retrying failed query (the
  // global 2s refetchInterval keeps re-fetching) would mask the error and the tab
  // would hang on "Loading metadata…" forever.
  const isLoading =
    !error && (historyQuery.isLoading || logsQuery.isLoading || dependenciesQuery.isLoading);

  const data: TaskMetadata | undefined =
    historyQuery.data && logsQuery.data && dependenciesQuery.data
      ? {
          history: historyQuery.data,
          logs: logsQuery.data,
          dependencies: dependenciesQuery.data,
        }
      : undefined;

  return {
    data,
    isLoading,
    error,
    refetch: () => {
      historyQuery.refetch();
      logsQuery.refetch();
      dependenciesQuery.refetch();
    },
  };
}
