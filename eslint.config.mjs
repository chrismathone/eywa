import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Design handoff reference files (HTML/JSX prototypes, not source code)
    "data/**",
    // Claude tooling: nested git worktrees ship their own .next build artifacts +
    // duplicated source — linting them produces false errors/OOM (see CLAUDE.md trap).
    ".claude/**",
  ]),
]);

export default eslintConfig;
