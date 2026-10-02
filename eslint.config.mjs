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
    "coverage/**",
    "next-env.d.ts",
    // Design handoff reference files (HTML/JSX prototypes, not source code)
    "data/**",
    // Claude tooling: nested git worktrees ship their own .next build artifacts +
    // duplicated source — linting them produces false errors/OOM (see CLAUDE.md trap).
    ".claude/**",
    // 일회용 마이그레이션 POC(수동 실행, 앱 빌드 비포함). Firestore 무타입 입력 특성상 any 다수 → 린트 제외.
    "scripts/_poc_migration/**",
    // 수동 실행 CJS 운영 도구(CORS 설정 등) — 앱 빌드 비포함, require 사용.
    "scripts/**/*.cjs",
    // Standalone timetable experiment: lint source, not generated bundles/browser artifacts.
    "experiments/timetable-lab-p0/dist/**",
    "experiments/timetable-lab-p0/.artifacts/**",
    "experiments/timetable-lab-p0/test-results/**",
    "experiments/timetable-lab-p0/playwright-report/**",
  ]),
]);

export default eslintConfig;
