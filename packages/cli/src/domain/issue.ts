export type IssueType = "FEATURE" | "BUG" | "ENHANCEMENT" | "TASK";
export type IssuePriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type IssueStatus = "OPEN" | "IN_PROGRESS" | "CLOSED";

export interface Issue {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly description: string;
  readonly acceptanceCriteria: string[];
  readonly type: IssueType;
  readonly priority: IssuePriority;
  readonly status: IssueStatus;
  readonly labels: string[];
  readonly templateUsed?: string;
  readonly createdBy?: string;
  readonly createdAt: string; // ISO date string
  readonly updatedAt: string; // ISO date string
}

export class IssueFactory {
  static createWelcomeIssue(): Issue {
    const now = new Date().toISOString();

    return {
      id: crypto.randomUUID(),
      number: 1,
      title: "Setup dev-workflow tracking for this repository",
      description: `This is your first issue created by dev-workflow!

## What is dev-workflow?

dev-workflow is an AI-driven development workflow system that helps you:
- Track issues and tasks
- Generate implementation plans
- Automate development workflows
- Integrate with GitHub and deployment systems

## Next Steps

1. Try creating a new issue:
   - Say: "I want to add user authentication"
   - Or use: \`/issue Add authentication\`

2. Explore the templates in \`.track/config/issues/templates/\`

3. Customize the configuration in \`.track/config.json\`

## Learn More

- Skills are in \`.claude/skills/dev-workflow/\`
- Subagents are in \`.claude/agents/dev-workflow/\`
- MCP server registered in \`.claude/config/mcp-servers.json\`
`,
      acceptanceCriteria: [
        "dev-workflow initialized successfully",
        "Can create issues via Claude Code",
        "Templates are customizable",
      ],
      type: "TASK",
      priority: "MEDIUM",
      status: "OPEN",
      labels: ["setup", "onboarding"],
      templateUsed: "task.md",
      createdBy: "dev-workflow-init",
      createdAt: now,
      updatedAt: now,
    };
  }
}
