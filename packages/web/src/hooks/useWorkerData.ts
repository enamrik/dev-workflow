"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getWorkerData } from "@/lib/api";
import type { WorkerData } from "@/lib/types";

const REFETCH_INTERVAL = 5000; // 5 seconds

export function useWorkerData() {
  return useQuery<WorkerData>({
    queryKey: ["workerData"],
    queryFn: getWorkerData,
    refetchInterval: REFETCH_INTERVAL,
  });
}

export function useRefreshWorkerData() {
  const queryClient = useQueryClient();

  return () => {
    queryClient.invalidateQueries({ queryKey: ["workerData"] });
  };
}
