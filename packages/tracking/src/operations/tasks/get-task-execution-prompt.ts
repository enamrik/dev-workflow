/**
 * getTaskExecutionPrompt - Generate an execution prompt for a task
 *
 * Builds a structured prompt containing issue context, plan approach,
 * task details, and acceptance criteria for subagent execution.
 */

import { z } from "zod";
import { TaskDomainService } from "../../domain/tasks/task-domain-service.js";
import { PlanDomainService } from "../../domain/plans/plan-domain-service.js";
import { IssueDomainService } from "../../domain/issues/issue-domain-service.js";
import { EntityNotFoundError } from "../../domain/errors.js";
import { validateInput } from "../validation.js";
import { Effect } from "@dev-workflow/effect";

// =============================================================================
// Schema
// =============================================================================

export const getTaskExecutionPromptSchema = z.object({
  taskId: z.string().min(1),
});

export type GetTaskExecutionPromptInput = z.infer<typeof getTaskExecutionPromptSchema>;

// =============================================================================
// Types
// =============================================================================

export interface GetTaskExecutionPromptResult {
  success: boolean;
  taskId: string;
  sessionId: string;
  prompt: string;
}

// =============================================================================
// Operation
// =============================================================================

export function getTaskExecutionPrompt(input: GetTaskExecutionPromptInput) {
  return Effect.gen(function* () {
    const { taskId } = validateInput(getTaskExecutionPromptSchema, input);
    const taskDomainService = yield* TaskDomainService;
    const planDomainService = yield* PlanDomainService;
    const issueDomainService = yield* IssueDomainService;

    const task = yield* taskDomainService.findById(taskId);
    if (!task) {
      return yield* Effect.fail(new EntityNotFoundError("Task", taskId));
    }

    // Get parent context
    const plan = yield* planDomainService.findById(task.planId);
    if (!plan) {
      return yield* Effect.fail(new EntityNotFoundError("Plan", `for task ${taskId}`));
    }

    const issue = yield* issueDomainService.findById(plan.issueId);
    if (!issue) {
      return yield* Effect.fail(new EntityNotFoundError("Issue", `for plan ${plan.id}`));
    }

    // Generate session ID for the subagent
    const sessionId = crypto.randomUUID();

    // Build the execution prompt
    const issueAcceptanceCriteria = issue.acceptanceCriteria.map((c) => `- [ ] ${c}`).join("\n");
    const taskAcceptanceCriteria = task.acceptanceCriteria.map((c) => `- [ ] ${c}`).join("\n");

    const prompt = `# Task Execution

You are executing task #${task.order} for issue #${issue.number}.

## Issue: ${issue.title}
${issue.description}

**Issue Acceptance Criteria:**
${issueAcceptanceCriteria || "- None specified"}

## Plan Approach
${plan.approach}

## Your Task: ${task.title}
${task.description}

**Task Acceptance Criteria:**
${taskAcceptanceCriteria || "- None specified"}

${task.implementationPlan ? `## Additional Instructions\n${task.implementationPlan}\n` : ""}## Execution Instructions

1. Implement the task following the plan's approach
2. Ensure all acceptance criteria are met
3. Use \`log_task_progress\` to record significant steps (for audit trail)
4. When complete: call \`complete_task_session\` with:
   - taskId: "${taskId}"
   - sessionId: "${sessionId}"
5. If blocked: call \`abandon_task\` with:
   - taskId: "${taskId}"
   - sessionId: "${sessionId}"
   - reason: (explain why)

**Important:** You have access to dev-workflow-tracker MCP tools for task lifecycle management.`;

    return {
      success: true,
      taskId,
      sessionId,
      prompt,
    } satisfies GetTaskExecutionPromptResult;
  });
}
