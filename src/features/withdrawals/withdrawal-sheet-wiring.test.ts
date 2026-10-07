import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 수학 퇴원 → 시트 기입(원장 2026-10-07)은 **퇴원이 일어나는 문마다** 불려야 한다 — 한 곳이 빠지면 그 길로 처리한 퇴원만
 * 시트에서 조용히 사라진다. 새 퇴원·수강 종료 경로를 만들면 여기에도 추가할 것.
 */
const read = (...p: string[]) => readFileSync(join(process.cwd(), "src", ...p), "utf-8");

describe("수학 퇴원 시트 기입 — 문 다섯 곳", () => {
  it("학생 상태 퇴원 · 수정 폼 퇴원 · 수강 종료(고른 것 · 한 건)", () => {
    const src = read("features", "students", "server", "actions.ts");
    expect((src.match(/after\(\(\) =>\s*recordMathWithdrawalToSheet\(/g) ?? []).length).toBe(4);
  });
  it("예약 퇴원 cron", () => {
    expect(read("app", "api", "cron", "apply-due-withdrawals", "route.ts")).toContain("await recordMathWithdrawalToSheet(");
  });
});
