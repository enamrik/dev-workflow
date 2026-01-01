import { useQuery } from "@tanstack/react-query";
import {
  getMilestones,
  type MilestoneWithIssues,
  type MilestonesFilters,
} from "../api";

export function useMilestones(filters?: MilestonesFilters) {
  return useQuery<MilestoneWithIssues[]>({
    queryKey: ["milestones", filters],
    queryFn: () => getMilestones(filters),
  });
}
