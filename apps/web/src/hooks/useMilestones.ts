"use client";

import { useQuery } from "@tanstack/react-query";
import { getMilestones, type MilestonesFilters } from "@/lib/api";
import type { MilestoneWithIssues } from "@/lib/types";

export function useMilestones(filters?: MilestonesFilters) {
  return useQuery<MilestoneWithIssues[]>({
    queryKey: ["milestones", filters],
    queryFn: () => getMilestones(filters),
  });
}
