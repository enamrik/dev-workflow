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

  const isLoading = historyQuery.isLoading || logsQuery.isLoading || dependenciesQuery.isLoading;
  const error = historyQuery.error || logsQuery.error || dependenciesQuery.error;

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
