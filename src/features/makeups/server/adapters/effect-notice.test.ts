import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
const { effectNoticeOf, mergeEffectNotice } = await import("./effects");

const gap = (kind: string, queued = true) => ({ effectKey: "att:p1", kind, participantId: "p1", reservationId: "r1", error: "합성", queued });

describe("보강 기록 반영 알림 — 무엇을 알리나", () => {
  it("남은 것이 없으면 알리지 않는다", () => {
    expect(effectNoticeOf([])).toBeNull();
  });

  it("대기·보류·실패는 알린다", () => {
    for (const kind of ["participation_pending", "participation_failed", "teacher_hold", "units_write_failed", "units_review"]) {
      expect(effectNoticeOf([gap(kind)])).toEqual({ state: "pending", queued: true });
    }
  });

  it("관측은 설계된 대기라 알리지 않는다 — 목록에 넣지 못한 관측은 알린다", () => {
    expect(effectNoticeOf([gap("observation")])).toBeNull();
    expect(effectNoticeOf([gap("observation", false)])).toEqual({ state: "pending", queued: false });
    expect(effectNoticeOf([gap("observation"), gap("teacher_hold")])).toEqual({ state: "pending", queued: true });
  });

  it("하나라도 목록에 넣지 못했으면 queued = false(복구 목록에 없을 수 있다고 알린다)", () => {
    expect(effectNoticeOf([gap("teacher_hold"), gap("participation_failed", false)])).toEqual({ state: "pending", queued: false });
  });

  it("확인하지 못한 경우는 unknown — 남은 항목이 무엇이든", () => {
    expect(effectNoticeOf([], true)).toEqual({ state: "unknown", queued: false });
    expect(effectNoticeOf([gap("observation")], true)).toEqual({ state: "unknown", queued: false });
  });

  it("여러 칸의 알림은 더 나쁜 쪽으로 합친다", () => {
    const pending = { state: "pending" as const, queued: true };
    expect(mergeEffectNotice(null, undefined)).toBeNull();
    expect(mergeEffectNotice(null, pending)).toEqual(pending);
    expect(mergeEffectNotice(pending, null)).toEqual(pending);
    expect(mergeEffectNotice(pending, { state: "pending", queued: false })).toEqual({ state: "pending", queued: false });
    expect(mergeEffectNotice(pending, { state: "unknown", queued: false })).toEqual({ state: "unknown", queued: false });
  });
});
