import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WorkQueueRibbon } from "../components/kanban/WorkQueueRibbon";
import type { ProjectIssueWithTasks } from "../lib/types";

const mockIssue: ProjectIssueWithTasks = {
  issue: {
    id: "issue-1",
    number: 42,
    title: "Test Issue",
    description: "Test description",
    type: "FEATURE",
    priority: "MEDIUM",
    status: "OPEN",
    acceptanceCriteria: [],
    projectId: "project-1",
    milestoneId: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  },
  plan: null,
  tasks: [
    {
      id: "task-1",
      planId: "plan-1",
      number: 1,
      title: "Test Task",
      description: "Test task description",
      type: "FEATURE",
      status: "IN_PROGRESS",
      estimatedMinutes: 60,
      acceptanceCriteria: [],
      implementationPlan: null,
      isManual: false,
      sessionId: null,
      worktreePath: null,
      branchName: null,
      prUrl: null,
      prNumber: null,
      prStatus: null,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    },
  ],
  projectSlug: "test-project",
};

describe("WorkQueueRibbon", () => {
  it("renders issue cards", () => {
    render(<WorkQueueRibbon issuesWithTasks={[mockIssue]} />);

    expect(screen.getByText("Work Queue")).toBeInTheDocument();
    expect(screen.getByText(/1 issue/)).toBeInTheDocument();
  });

  it("renders nothing when no issues", () => {
    const { container } = render(<WorkQueueRibbon issuesWithTasks={[]} />);
    expect(container.firstChild).toBeNull();
  });

  describe("click behavior without onIssueClick", () => {
    it("renders issue card as full link when no callback provided", () => {
      render(<WorkQueueRibbon issuesWithTasks={[mockIssue]} />);

      // The card should be a link (the entire card is the link)
      const links = screen.getAllByRole("link");
      expect(links.length).toBeGreaterThan(0);

      // Should link to the issue page
      const issueLink = links.find((link) => link.getAttribute("href")?.includes("/issues/42"));
      expect(issueLink).toBeDefined();
    });
  });

  describe("click behavior with onIssueClick", () => {
    it("calls onIssueClick when clicking issue card", () => {
      const onIssueClick = vi.fn();

      render(<WorkQueueRibbon issuesWithTasks={[mockIssue]} onIssueClick={onIssueClick} />);

      // Find the issue card (it's a div with role="button" when callback is provided)
      const issueCard = screen.getByRole("button");
      fireEvent.click(issueCard);

      expect(onIssueClick).toHaveBeenCalledWith({
        projectSlug: "test-project",
        issueNumber: 42,
      });
    });

    it("does not call onIssueClick when clicking issue number link", () => {
      const onIssueClick = vi.fn();

      render(<WorkQueueRibbon issuesWithTasks={[mockIssue]} onIssueClick={onIssueClick} />);

      // Find the issue number link inside the card
      const links = screen.getAllByRole("link");
      const issueNumberLink = links.find(
        (link) =>
          link.getAttribute("href")?.includes("/issues/42") && link.textContent?.includes("#42")
      );
      expect(issueNumberLink).toBeDefined();

      // Click the issue number link - should NOT call onIssueClick due to stopPropagation
      fireEvent.click(issueNumberLink!);

      expect(onIssueClick).not.toHaveBeenCalled();
    });

    it("calls onIssueClick on keyboard Enter", () => {
      const onIssueClick = vi.fn();

      render(<WorkQueueRibbon issuesWithTasks={[mockIssue]} onIssueClick={onIssueClick} />);

      const issueCard = screen.getByRole("button");
      fireEvent.keyDown(issueCard, { key: "Enter" });

      expect(onIssueClick).toHaveBeenCalledWith({
        projectSlug: "test-project",
        issueNumber: 42,
      });
    });

    it("calls onIssueClick on keyboard Space", () => {
      const onIssueClick = vi.fn();

      render(<WorkQueueRibbon issuesWithTasks={[mockIssue]} onIssueClick={onIssueClick} />);

      const issueCard = screen.getByRole("button");
      fireEvent.keyDown(issueCard, { key: " " });

      expect(onIssueClick).toHaveBeenCalledWith({
        projectSlug: "test-project",
        issueNumber: 42,
      });
    });
  });

  describe("issue without projectSlug", () => {
    it("renders as link when no projectSlug (onIssueClick not applicable)", () => {
      const issueWithoutSlug: ProjectIssueWithTasks = {
        ...mockIssue,
        projectSlug: undefined,
      };
      const onIssueClick = vi.fn();

      render(<WorkQueueRibbon issuesWithTasks={[issueWithoutSlug]} onIssueClick={onIssueClick} />);

      // Should render as a link, not a button, because projectSlug is missing
      const buttons = screen.queryAllByRole("button");
      expect(buttons.length).toBe(0);

      // Click on the card - should not call onIssueClick
      const links = screen.getAllByRole("link");
      fireEvent.click(links[0]!);

      expect(onIssueClick).not.toHaveBeenCalled();
    });
  });
});
