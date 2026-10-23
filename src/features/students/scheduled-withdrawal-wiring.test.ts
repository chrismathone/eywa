import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **퇴원 예약** 배선 가드 — 원장 2026-09-28 *"퇴원이 미래인학생은 퇴원당일전까지 '재원'임."*
 * 미래 퇴원일 저장 = 상태·수강 그대로 + 날짜·사유만 → 그날 cron이 **같은 종료 함수**로 퇴원 처리.
 * 한쪽만 바뀌면 "예약은 걸렸는데 영영 퇴원이 안 된다"(cron 미등록) 또는 "저장 즉시 재원에서 빠진다"(옛 동작)가 된다.
 */
const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("퇴원 예약", () => {
  it("🔴 새 예약은 걸지 않는다 — 상태 변경 창의 퇴원(미래 날짜 포함)은 퇴원보고서로(원장 2026-10-23). 걸린 예약은 cron이 그대로 처리한다", () => {
    const src = read("src/features/students/server/actions.ts");
    expect(src).not.toContain("if (date > kstToday()) {");
    expect(src).toContain('if (target === "withdrawn") return { error: WITHDRAWAL_VIA_REPORT };');
    // 미래 날짜 퇴원은 퇴원보고서가 그날 처리한다(같은 cron이 보고서 처리 함수를 부른다).
    expect(read("src/app/api/cron/apply-due-withdrawals/route.ts")).toContain("applyDueWithdrawalReports()");
  });

  it("학생 폼(등록·수정) — 퇴원일 칸이 예약을 정한다(한 판정 함수)", () => {
    const src = read("src/features/students/server/actions.ts");
    expect(read("src/features/students/withdrawal-plan.ts")).toContain("export function planFormWithdrawal(");
    expect(src).toContain("withdrawn_at: savedWithdrawnAt,");
    expect(src).toContain("withdrawn_at: createPlan.withdrawnAt,");
    expect(src).not.toContain('withdrawn_at: input.status === "withdrawn" ? input.withdrawnAt : null,');
  });

  it("cron이 등록돼 있고 퇴원 저장과 같은 종료 함수를 쓴다", () => {
    const vercel = JSON.parse(read("vercel.json")) as { crons: { path: string; schedule: string }[] };
    expect(vercel.crons.some((c) => c.path === "/api/cron/apply-due-withdrawals")).toBe(true);
    const route = read("src/app/api/cron/apply-due-withdrawals/route.ts");
    expect(route).toContain("closeActiveEnrollmentsClamped");
    expect(route).toContain('.eq("withdrawn_at", s.withdrawn_at)'); // 그 사이 취소·변경되면 손대지 않는다
    expect(read("src/features/students/server/enrollment-sync.ts")).toContain(
      "export async function closeActiveEnrollmentsClamped(",
    );
  });

  it("퇴원관리 목록은 예약을 싣지 않는다 — 퇴원일 전까지 재원(숫자·사유·추이에 미리 섞이지 않게)", () => {
    const src = read("src/features/withdrawals/server/queries.ts");
    const fn = src.slice(src.indexOf("export async function getWithdrawnStudents"), src.indexOf("export type WithdrawalDetail"));
    expect(fn).toContain('.eq("status", "withdrawn")');
  });

  it("복구 두 문 — 퇴원이 아니던 학생의 예약은 안 지우고, 퇴원관리 복구는 퇴원 상태만", () => {
    expect(read("src/features/students/server/actions.ts")).toContain('const wasWithdrawn = before?.status === "withdrawn";');
    expect(read("src/features/withdrawals/server/actions.ts")).toContain('if (cur?.status !== "withdrawn") return');
  });
});
