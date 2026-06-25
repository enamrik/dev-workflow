import { themes as prismThemes } from "prism-react-renderer";
import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";

const config: Config = {
  title: "dev-workflow",
  tagline: "AI-driven development workflow system",
  favicon: "img/favicon.ico",

  url: "https://your-org.github.io",
  baseUrl: "/dev-workflow/",

  organizationName: "your-org",
  projectName: "dev-workflow",

  onBrokenLinks: "throw",
  onBrokenMarkdownLinks: "warn",

  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  presets: [
    [
      "classic",
      {
        docs: {
          sidebarPath: "./sidebars.ts",
          routeBasePath: "/",
          editUrl: "https://github.com/your-org/dev-workflow/tree/main/docs-site/",
        },
        blog: false,
        theme: {
          customCss: "./src/css/custom.css",
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: "img/dev-workflow-social-card.png",
    navbar: {
      title: "dev-workflow",
      logo: {
        alt: "dev-workflow Logo",
        src: "img/logo.svg",
      },
      items: [
        {
          type: "docSidebar",
          sidebarId: "docs",
          position: "left",
          label: "Documentation",
        },
        {
          href: "https://github.com/your-org/dev-workflow",
          label: "GitHub",
          position: "right",
        },
      ],
    },
    footer: {
      style: "dark",
      links: [
        {
          title: "Docs",
          items: [
            {
              label: "Getting Started",
              to: "/getting-started/installation",
            },
            {
              label: "User Guide",
              to: "/user-guide/issues",
            },
            {
              label: "Reference",
              to: "/reference/cli-commands",
            },
          ],
        },
        {
          title: "Community",
          items: [
            {
              label: "GitHub Discussions",
              href: "https://github.com/your-org/dev-workflow/discussions",
            },
            {
              label: "GitHub Issues",
              href: "https://github.com/your-org/dev-workflow/issues",
            },
          ],
        },
        {
          title: "More",
          items: [
            {
              label: "GitHub",
              href: "https://github.com/your-org/dev-workflow",
            },
            {
              label: "npm",
              href: "https://www.npmjs.com/package/@dev-workflow/cli",
            },
          ],
        },
      ],
      copyright: `Copyright ${new Date().getFullYear()} dev-workflow. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ["bash", "json", "typescript"],
    },
    algolia: {
      appId: "YOUR_APP_ID",
      apiKey: "YOUR_SEARCH_API_KEY",
      indexName: "dev-workflow",
      contextualSearch: true,
      searchPagePath: "search",
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
