import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "happy-dom",
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
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
