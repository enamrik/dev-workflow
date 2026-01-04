import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-plugin-prettier/recommended";
import globals from "globals";

export default tseslint.config(
  // Global ignores
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.next/**",
      "**/drizzle/**",
      "**/*.d.ts",
      "**/coverage/**",
    ],
  },

  // Base ESLint recommended rules
  eslint.configs.recommended,

  // TypeScript ESLint recommended rules
  ...tseslint.configs.recommended,

  // Prettier integration (must be last to override conflicting rules)
  prettier,

  // Project-specific configuration
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
    },
    rules: {
      // Relax some rules that conflict with project conventions
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // Allow explicit any in specific cases (we prefer avoiding it per CLAUDE.md)
      "@typescript-eslint/no-explicit-any": "warn",
      // Allow require imports for Node.js compatibility
      "@typescript-eslint/no-require-imports": "off",
    },
  },

  // Test files configuration
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/test/**/*.ts"],
    rules: {
      // Allow any in tests for mocking flexibility
      "@typescript-eslint/no-explicit-any": "off",
      // Allow non-null assertions in tests
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  }
);
