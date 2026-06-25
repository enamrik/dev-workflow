import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  docs: [
    "intro",
    {
      type: "category",
      label: "Getting Started",
      items: [
        "getting-started/installation",
        "getting-started/quick-start",
        "getting-started/concepts",
      ],
    },
    {
      type: "category",
      label: "User Guide",
      items: [
        "user-guide/issues",
        "user-guide/planning",
        "user-guide/task-execution",
        "user-guide/github-integration",
        "user-guide/milestones",
        "user-guide/snapshots",
        "user-guide/web-ui",
      ],
    },
    {
      type: "category",
      label: "Reference",
      items: [
        "reference/cli-commands",
        "reference/mcp-tools",
        "reference/configuration",
        "reference/claude-skills",
      ],
    },
    {
      type: "category",
      label: "Advanced",
      items: [
        "advanced/architecture",
        "advanced/workers",
        "advanced/troubleshooting",
        "advanced/contributing",
      ],
    },
  ],
};

export default sidebars;
