import { describe, expect, it } from "vitest";
import { formWithdrawalNeedsReason, planFormWithdrawal } from "./withdrawal-plan";

const T = "2026-09-28";
const plan = (a: Partial<Parameters<typeof planFormWithdrawal>[0]>) =>
  planFormWithdrawal({ prevStatus: "enrolled", status: "enrolled", withdrawnAt: null, today: T, ...a });

describe("학생 폼 — 새 퇴원·예약일 때만 사유를 받는다(원장 2026-10-15 *\"기타는 모든 곳을 일치하게\"*)", () => {
  const needs = (prevStatus: string | null, prevWithdrawnAt: string | null, a: Partial<Parameters<typeof planFormWithdrawal>[0]>) =>
    formWithdrawalNeedsReason({ prevStatus, prevWithdrawnAt, kind: plan({ prevStatus, prevWithdrawnAt, ...a }).kind });
  it("새 퇴원 · 새 예약 · 퇴원으로 등록 = 사유를 받는다", () => {
    expect(needs("enrolled", null, { status: "withdrawn", withdrawnAt: T })).toBe(true);
    expect(needs("enrolled", null, { withdrawnAt: "2026-10-01" })).toBe(true);
    expect(needs(null, null, { status: "withdrawn", withdrawnAt: T })).toBe(true);
    expect(needs(null, null, { status: "enrolled", withdrawnAt: "2026-10-01" })).toBe(true);
  });
  it("이미 퇴원한 학생 수정 · 예약 날짜만 바꿈 · 예약을 오늘로 당김 · 아무 일 없음 = 저장된 사유 그대로", () => {
    expect(needs("withdrawn", "2026-09-01", { status: "withdrawn", withdrawnAt: "2026-09-01" })).toBe(false);
    expect(needs("enrolled", "2026-10-01", { withdrawnAt: "2026-10-05" })).toBe(false);
    expect(needs("enrolled", "2026-10-01", { status: "withdrawn", withdrawnAt: T })).toBe(false);
    expect(needs("enrolled", null, {})).toBe(false);
    expect(needs(null, null, { status: "enrolled" })).toBe(false);
  });
});

describe("학생 폼 퇴원일 칸 → 퇴원 예약(원장 2026-09-28)", () => {
  it("재원 + 빈칸 = 아무 일 없음", () => {
    expect(plan({})).toEqual({ kind: "none", status: "enrolled", withdrawnAt: null });
  });
  it("재원·휴원 + 미래 날짜 = 예약(상태 그대로)", () => {
    expect(plan({ withdrawnAt: "2026-10-01" })).toEqual({ kind: "schedule", status: "enrolled", withdrawnAt: "2026-10-01" });
    expect(plan({ prevStatus: "on_hold", status: "on_hold", withdrawnAt: "2026-10-01" }).kind).toBe("schedule");
  });
  it("상태를 '퇴원'으로 + 미래 날짜 = 예약, 상태는 이전 그대로", () => {
    expect(plan({ status: "withdrawn", withdrawnAt: "2026-10-01" })).toEqual({
      kind: "schedule",
      status: "enrolled",
      withdrawnAt: "2026-10-01",
    });
  });
  it("상태를 '퇴원'으로 + 오늘 = 바로 퇴원(퇴원 당일은 퇴원)", () => {
    expect(plan({ status: "withdrawn", withdrawnAt: T }).kind).toBe("withdraw");
  });
  it("재원 + 지난 날짜 = 거절 · 단 저장된 날짜 그대로면 통과", () => {
    expect(plan({ withdrawnAt: "2026-09-27" }).error).toBeTruthy();
    expect(plan({ withdrawnAt: "2026-09-27", prevWithdrawnAt: "2026-09-27" }).error).toBeUndefined();
  });
  it("예비생 → '퇴원' + 미래 날짜 = 거절(예약은 재원·휴원만)", () => {
    expect(plan({ prevStatus: "prospect", status: "withdrawn", withdrawnAt: "2026-10-01" }).error).toBeTruthy();
  });
  it("예비생은 예약하지 않는다(칸을 버린다)", () => {
    expect(plan({ prevStatus: "prospect", status: "prospect", withdrawnAt: "2026-10-01" })).toEqual({
      kind: "none",
      status: "prospect",
      withdrawnAt: null,
    });
  });
  it("퇴원 → 재원 복구 = 옛 퇴원일을 비운다(지난 날짜여도 거절 안 함)", () => {
    expect(plan({ prevStatus: "withdrawn", withdrawnAt: "2026-08-01" })).toEqual({ kind: "none", status: "enrolled", withdrawnAt: null });
  });
  it("이미 퇴원 + 미래 날짜 = 거절", () => {
    expect(plan({ prevStatus: "withdrawn", status: "withdrawn", withdrawnAt: "2026-10-01" }).error).toBeTruthy();
  });
  it("등록(prevStatus null) + 퇴원 + 미래 = 재원으로 두고 예약", () => {
    expect(plan({ prevStatus: null, status: "withdrawn", withdrawnAt: "2026-10-01" }).status).toBe("enrolled");
  });
});
