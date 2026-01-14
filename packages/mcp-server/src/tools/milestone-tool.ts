/**
 * MilestoneTool - Milestone management operations
 *
 * Provides operations for managing milestones (time-bounded goals that group issues).
 * Status is computed automatically based on issue states and dates.
 */

import {
  isIssueClosed,
  isIssueInPlanning,
  type Project,
  type MilestoneService,
  type IssueService,
} from "@dev-workflow/core";

// =============================================================================
// Types
// =============================================================================

export interface CreateMilestoneInput {
  title: string;
  description?: string;
  startDate: string;
  endDate: string;
}

export interface GetMilestoneInput {
  id?: string;
  milestoneNumber?: number;
}

export interface ListMilestonesInput {
  status?: "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "DELAYED";
}

export interface UpdateMilestoneInput {
  milestoneNumber: number;
  updates: {
    title?: string;
    description?: string;
    startDate?: string;
    endDate?: string;
    status?: "COMPLETED";
  };
}

export interface DeleteMilestoneInput {
  milestoneNumber: number;
}

export interface AssignIssueToMilestoneInput {
  issueNumber: number;
  milestoneNumber: number;
}

export interface RemoveIssueFromMilestoneInput {
  issueNumber: number;
}

// =============================================================================
// MilestoneTool Class
// =============================================================================

export class MilestoneTool {
  constructor(
    private readonly project: Project,
    private readonly milestoneService: MilestoneService,
    private readonly issueService: IssueService
  ) {}

  /**
   * Create a new milestone
   */
  createMilestone(input: CreateMilestoneInput) {
    const { title, description, startDate, endDate } = input;

    // Validate date format
    this.validateDateFormat(startDate, "startDate");
    this.validateDateFormat(endDate, "endDate");

    // Validate date range
    if (startDate > endDate) {
      throw new Error("startDate must be before or equal to endDate");
    }

    const milestoneWithStatus = this.milestoneService.createMilestone({
      title,
      description,
      startDate,
      endDate,
    });

    return {
      message: `Created milestone M${milestoneWithStatus.number}: ${milestoneWithStatus.title}`,
      milestone: {
        ...milestoneWithStatus,
        projectName: this.project.name,
      },
    };
  }

  /**
   * Get a milestone by ID or number
   */
  getMilestone(input: GetMilestoneInput) {
    const { id, milestoneNumber } = input;

    let milestone = null;

    if (id) {
      milestone = this.milestoneService.findById(id);
    } else if (milestoneNumber !== undefined) {
      milestone = this.milestoneService.findByNumber(milestoneNumber);
    } else {
      throw new Error("Either id or milestoneNumber is required");
    }

    if (!milestone) {
      throw new Error("Milestone not found");
    }

    // Get milestone with computed status
    const milestoneWithStatus = this.milestoneService.getMilestone(milestone.id);

    // Get issues assigned to this milestone
    const issues = this.issueService.findMany({ milestoneId: milestone.id });

    return {
      milestone: {
        ...milestoneWithStatus,
        projectName: this.project.name,
      },
      issues: issues.map((i) => ({
        number: i.number,
        title: i.title,
        status: i.status,
        type: i.type,
      })),
      summary: {
        totalIssues: issues.length,
        // Active issues: not closed and not in planning
        openIssues: issues.filter((i) => !isIssueClosed(i) && !isIssueInPlanning(i)).length,
        // Note: inProgressIssues kept for API compatibility, counts same as openIssues
        inProgressIssues: issues.filter((i) => !isIssueClosed(i) && !isIssueInPlanning(i)).length,
        closedIssues: issues.filter(isIssueClosed).length,
      },
    };
  }

  /**
   * List milestones with optional status filter
   */
  listMilestones(input: ListMilestonesInput) {
    const { status } = input;

    // Fetch all milestones (no status filter at DB level since status is computed)
    const allMilestones = this.milestoneService.findMany();

    // Enrich each milestone with computed status, issue counts, and project name
    const enrichedMilestones = allMilestones.map((m) => {
      const issues = this.issueService.findMany({ milestoneId: m.id });
      const milestoneWithStatus = this.milestoneService.getMilestone(m.id);

      return {
        ...milestoneWithStatus,
        projectName: this.project.name,
        issueCount: issues.length,
        closedCount: issues.filter(isIssueClosed).length,
      };
    });

    // Filter by computed status if requested
    const filteredMilestones = status
      ? enrichedMilestones.filter((m) => m.status === status)
      : enrichedMilestones;

    return {
      milestones: filteredMilestones,
      count: filteredMilestones.length,
    };
  }

  /**
   * Update a milestone
   */
  updateMilestone(input: UpdateMilestoneInput) {
    const { milestoneNumber, updates } = input;

    const milestone = this.milestoneService.findByNumber(milestoneNumber);
    if (!milestone) {
      throw new Error(`Milestone M${milestoneNumber} not found`);
    }

    // Validate status update - only COMPLETED is allowed
    if (updates.status && updates.status !== "COMPLETED") {
      throw new Error(
        `Cannot set status to ${updates.status}. Only COMPLETED can be set manually. ` +
          "PLANNED, IN_PROGRESS, and DELAYED are computed automatically from issue states."
      );
    }

    // Validate date format if provided
    if (updates.startDate) {
      this.validateDateFormat(updates.startDate, "startDate");
    }
    if (updates.endDate) {
      this.validateDateFormat(updates.endDate, "endDate");
    }

    // Validate date range
    const newStartDate = updates.startDate ?? milestone.startDate;
    const newEndDate = updates.endDate ?? milestone.endDate;
    if (newStartDate > newEndDate) {
      throw new Error("startDate must be before or equal to endDate");
    }

    const updated = this.milestoneService.update(milestone.id, updates);

    // Return milestone with computed status
    const updatedWithStatus = this.milestoneService.getMilestone(updated.id);

    return {
      message: `Updated milestone M${updatedWithStatus.number}`,
      milestone: {
        ...updatedWithStatus,
        projectName: this.project.name,
      },
    };
  }

  /**
   * Delete a milestone
   */
  deleteMilestone(input: DeleteMilestoneInput) {
    const { milestoneNumber } = input;

    const milestone = this.milestoneService.findByNumber(milestoneNumber);
    if (!milestone) {
      throw new Error(`Milestone M${milestoneNumber} not found`);
    }

    // Find and unassign issues from this milestone
    const issues = this.issueService.findMany({ milestoneId: milestone.id });
    for (const issue of issues) {
      this.issueService.update(issue.id, { milestoneId: undefined });
    }

    this.milestoneService.delete(milestone.id);

    return {
      message: `Deleted milestone M${milestoneNumber}: ${milestone.title}`,
      unassignedIssues: issues.length,
    };
  }

  /**
   * Assign an issue to a milestone
   */
  assignIssueToMilestone(input: AssignIssueToMilestoneInput) {
    const { issueNumber, milestoneNumber } = input;

    // Look up issue by number
    const issue = this.issueService.findByNumber(issueNumber);
    if (!issue) {
      throw new Error(`Issue #${issueNumber} not found`);
    }

    // Look up milestone by number
    const milestone = this.milestoneService.findByNumber(milestoneNumber);
    if (!milestone) {
      throw new Error(`Milestone M${milestoneNumber} not found`);
    }

    this.milestoneService.assignIssue(issue.id, milestone.id);

    return {
      message: `Assigned issue #${issueNumber} to milestone M${milestoneNumber}`,
    };
  }

  /**
   * Remove an issue from its milestone
   */
  removeIssueFromMilestone(input: RemoveIssueFromMilestoneInput) {
    const { issueNumber } = input;

    // Look up issue by number
    const issue = this.issueService.findByNumber(issueNumber);
    if (!issue) {
      throw new Error(`Issue #${issueNumber} not found`);
    }

    // Check if issue is assigned to a milestone
    if (!issue.milestoneId) {
      throw new Error(`Issue #${issueNumber} is not assigned to any milestone`);
    }

    this.milestoneService.unassignIssue(issue.id);

    return {
      message: `Removed issue #${issueNumber} from milestone`,
    };
  }

  // =============================================================================
  // Private Helpers
  // =============================================================================

  private validateDateFormat(date: string, fieldName: string): void {
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      throw new Error(`${fieldName} must be in YYYY-MM-DD format`);
    }
  }
}
