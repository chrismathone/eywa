/**
 * 일회성 E2E 러너 — `notice-attachment-hakwoni.e2e.ts` 전용.
 *
 * 왜 별도 config인가: 이 E2E는 **실제로 ClassNote에 글을 올린다**(학원이 보드 한정). 평소 `pnpm test`에
 * 섞이면 CI·로컬 전체 실행마다 실발송이 나가므로 기본 include(`*.test.ts`)에서 일부러 벗어난 이름을 쓰고
 * 이 config로만 돌린다. `server-only` alias는 src의 server 모듈을 Node에서 그대로 실행하기 위한 시무.
 *
 * 실행: node node_modules/vitest/vitest.mjs run --config scripts/_oneoff/vitest.notice-e2e.config.ts
 */
import { defineConfig } from "vitest/config";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..", "..");

export default defineConfig({
  root: ROOT,
  test: {
    environment: "node",
    globals: true,
    include: ["scripts/_oneoff/notice-attachment-hakwoni.e2e.ts"],
    testTimeout: 400_000,
    hookTimeout: 400_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(ROOT, "src"),
      // server-only는 Next 번들러 전용 가드 — Node 실행에선 빈 모듈로 대체(런타임 동작 영향 없음).
      "server-only": path.resolve(ROOT, "scripts/_oneoff/_server-only-shim.ts"),
    },
  },
});
