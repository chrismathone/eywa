import { describe, expect, it } from "vitest";

import { pairScheduledMoves, type ScheduledMoveRow } from "./scheduled-move";

const REF = "2026-09-09";

const row = (over: Partial<ScheduledMoveRow>): ScheduledMoveRow => ({
  id: "e1",
  classId: "A",
  studentId: "s1",
  startDate: "2026-03-01",
  endDate: null,
  isTransferred: false,
  isTransferredIn: false,
  ...over,
});

describe("pairScheduledMoves", () => {
  it("미래 적용일의 두 행을 한 사건으로 맞물린다", () => {
    const old = row({ id: "old", classId: "A", endDate: "2026-09-15", isTransferred: true });
    const neu = row({ id: "new", classId: "B", startDate: "2026-09-15", isTransferredIn: true });
    const r = pairScheduledMoves([old, neu], REF);
    expect(r.out.get("old")).toEqual({ on: "2026-09-15", otherClassId: "B" });
    expect(r.in.get("new")).toEqual({ on: "2026-09-15", otherClassId: "A" });
  });

  it("이미 지난·오늘 적용분은 예약이 아니다(오늘은 즉시)", () => {
    const past = row({ id: "p", endDate: "2026-09-01", isTransferred: true });
    const todayMove = row({ id: "t", endDate: REF, isTransferred: true });
    const r = pairScheduledMoves([past, todayMove], REF);
    expect(r.out.size).toBe(0);
  });

  it("짝이 화면 밖이면 날짜만 남고 반은 비운다(지어내지 않는다)", () => {
    const old = row({ id: "old", classId: "A", endDate: "2026-09-15", isTransferred: true });
    const r = pairScheduledMoves([old], REF);
    expect(r.out.get("old")).toEqual({ on: "2026-09-15", otherClassId: null });
  });

  it("같은 날짜에 두 건이면 모호하니 반을 비운다", () => {
    const old = row({ id: "old", classId: "A", endDate: "2026-09-15", isTransferred: true });
    const b = row({ id: "b", classId: "B", startDate: "2026-09-15", isTransferredIn: true });
    const c = row({ id: "c", classId: "C", startDate: "2026-09-15", isTransferredIn: true });
    const r = pairScheduledMoves([old, b, c], REF);
    expect(r.out.get("old")!.otherClassId).toBeNull();
    // 반대 방향은 짝이 하나(old)라 찾을 수 있다.
    expect(r.in.get("b")!.otherClassId).toBe("A");
  });

  it("전입 표식이 없는 미래 시작(그냥 배정 예정)은 반이동이 아니다", () => {
    const upcoming = row({ id: "u", startDate: "2026-09-15" });
    expect(pairScheduledMoves([upcoming], REF).in.size).toBe(0);
  });

  it("한 행이 나가고 들어오는 두 예약에 동시에 걸릴 수 있다", () => {
    // B반: 9/12에 들어와서 9/20에 또 나간다(연속 이동).
    const mid = row({
      id: "mid",
      classId: "B",
      startDate: "2026-09-12",
      endDate: "2026-09-20",
      isTransferred: true,
      isTransferredIn: true,
    });
    const r = pairScheduledMoves([mid], REF);
    expect(r.in.get("mid")!.on).toBe("2026-09-12");
    expect(r.out.get("mid")!.on).toBe("2026-09-20");
  });
});
