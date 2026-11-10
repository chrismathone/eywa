import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * 통합 테스트 전용 설정 — 실제 dev DB(DATABASE_URL)에 붙는 테스트만.
 * 기본 `pnpm test`(vitest.config.ts)는 `tests/unit/**`+`src/**`만 포함하므로 이 디렉터리는 자동 제외 →
 * DB 없는 CI에서 기본 스위트는 깨지지 않는다. `pnpm test:rls`로만 실행.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "server-only": path.resolve(__dirname, "./tests/support/server-only-shim.ts"),
    },
  },
});
