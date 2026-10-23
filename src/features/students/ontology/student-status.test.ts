import { expect, it } from "vitest";
import { describeStudentStatus } from "./student-status";
const base = { status: "enrolled", enrolled_at: "2026-01-01", withdrawn_at: null, withdrawal_metadata: null };
it("does not turn a scheduled withdrawal into a completed withdrawal", () => {
  expect(describeStudentStatus({ ...base, withdrawn_at: "2027-01-01" }, true, "2026-10-23"))
    .toEqual({ title: "현재 상태 · 재원", detail: "기록된 재원 시작일 2026-01-01 · 퇴원 예정일 2027-01-01" });
});
it("does not use a bulk cleanup date as the actual withdrawal date", () => {
  const result = describeStudentStatus({ ...base, status: "withdrawn", withdrawn_at: "2026-07-10" }, false, "2026-10-23");
  expect(result.detail).toContain("실제 퇴원일 확인 전"); expect(result.detail).not.toContain("2026-07-10");
});
it("leaves unknown hold and enrollment dates unknown", () => {
  expect(describeStudentStatus({ ...base, status: "on_hold", enrolled_at: null }, false, "2026-10-23").detail)
    .toBe("재원 시작일 기록 없음 · 휴원 시작일은 이 자료로 확인할 수 없습니다");
});
it("flags a past withdrawal field inconsistent with the current enrolled status", () => {
  expect(describeStudentStatus({ ...base, withdrawn_at: "2026-10-01" }, true, "2026-10-23").detail).toContain("현재 상태와 대조 필요");
});
