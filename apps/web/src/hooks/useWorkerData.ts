"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getWorkerData } from "@/lib/api";
import type { WorkerData } from "@/lib/types";

export function useWorkerData() {
  return useQuery<WorkerData>({
    queryKey: ["workerData"],
    queryFn: getWorkerData,
  });
}

export function useRefreshWorkerData() {
  const queryClient = useQueryClient();

  return () => {
    queryClient.invalidateQueries({ queryKey: ["workerData"] });
  };
}
