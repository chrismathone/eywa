import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "happy-dom",
    maxWorkers: 2,
    testTimeout: 30_000,
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: [
      "tests/unit/**/*.{test,spec}.{ts,tsx}",
      "src/**/*.{test,spec}.{ts,tsx}",
      // ClassNote 워커(plain .mjs)는 src TS를 못 import → 순수 로직을 워커·테스트가 공유하는 .mjs로 두고 여기서 픽업.
      "scripts/_classnote/**/*.{test,spec}.mjs",
      // makeedu 동기화 임포터의 순수 분류기(CJS) — **청구서를 무효로 바꾸는 판정**이라 단위테스트 필수.
      "scripts/_makeedu/**/*.{test,spec}.{ts,mjs}",
    ],
    exclude: ["tests/e2e/**", "node_modules/**", ".next/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.d.ts", "src/components/ui/**", "src/app/**"],
      // 전역 70%는 미테스트 UI/서버 코드 때문에 비현실적 → 돈/계산 순수 모듈만 게이트한다(#Q5,
      // CLAUDE.md "계산 함수는 단위테스트 강제"). 새 계산 로직은 이 글롭에 들어가도록 calc.ts로.
      thresholds: {
        "src/lib/calc/**": { lines: 80, functions: 80 },
        "src/features/billing/calc.ts": { lines: 80, functions: 80 },
        "src/features/payroll/calc.ts": { lines: 80, functions: 80 },
        "src/features/makeups/quantity.ts": { lines: 80, functions: 80 },
        // 돈 계산의 **함수 정의 파일**(수정 계획 P0-5) — 강사 정산 티어 · 회차 금액 이월 · 이월 시수 맞춤. 분기까지 본다.
        // 로컬 게이트(scripts/verify-changed.mjs ④)가 이 파일들이 바뀔 때 관련 테스트로 커버리지를 재서 이 값을 강제한다.
        "src/features/payroll/tier-settlement.ts": { lines: 80, functions: 80, branches: 70 },
        "src/features/billing/session-terms/money-carryover.ts": { lines: 80, functions: 80, branches: 70 },
        "src/features/billing/session-terms/carry-session-sync.ts": { lines: 80, functions: 80, branches: 70 },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // `server-only`은 **Next 번들러 전용 가드**(클라 번들에 서버 코드가 섞이면 빌드를 깨뜨리는 마커, #61).
      // Next는 클라 컴포넌트의 서버 액션 import를 빌드 때 클라 참조로 치환하지만 vitest는 실제로 따라가므로,
      // 서버 액션을 쓰는 클라 컴포넌트를 렌더하는 테스트가 전부 "Cannot resolve server-only"로 죽었다.
      // 빈 모듈로 치환해 **테스트에서만** 통과시킨다 — 프로덕션 가드는 그대로다(빌드는 여전히 Next가 막는다).
      // 이 shim은 원래 이 용도로 만들어졌는데 어디에도 연결돼 있지 않았다(2026-08-05 배선).
      "server-only": path.resolve(__dirname, "./tests/support/server-only-shim.ts"),
    },
  },
});
