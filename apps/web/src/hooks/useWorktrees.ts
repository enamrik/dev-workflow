"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getWorktrees, pruneWorktrees, type WorktreesFilters } from "@/lib/api";
import type { Worktree } from "@/lib/types";

export function useWorktrees(filters?: WorktreesFilters) {
  return useQuery<Worktree[]>({
    queryKey: ["worktrees", filters],
    queryFn: () => getWorktrees(filters),
  });
}

export function usePruneWorktrees() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (projectId: string) => pruneWorktrees(projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["worktrees"] });
    },
  });
}
