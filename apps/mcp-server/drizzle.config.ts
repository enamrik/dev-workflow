import type { Config } from "drizzle-kit";

export default {
  schema: "./src/infrastructure/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: ".track/data/workflow.db",
  },
} satisfies Config;
