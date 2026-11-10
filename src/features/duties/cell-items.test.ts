import { describe, expect, it } from "vitest";
import { cellItemState, cellItemTitle, cellItemWhen } from "./cell-items";

const NOW = Date.parse("2026-11-10T03:00:00Z");
const it0 = (o: object) => ({ status: "done", voidReason: null, dueAt: "2026-11-09T15:00:00Z", doneAt: "2026-11-09T10:00:00Z", ...o });

describe("칸 목록의 한 줄", () => {
  it("🔴 상태는 집계와 같다 — 기한 안 완료 = 준수 · 넘겨 완료 = 기한 후 완료 · 기한 전 완료 = 조기 완료(준수 아님) · 열린 것은 기한으로 · 미이행 확정", () => {
    expect(cellItemState(it0({}), NOW)).toBe("ontime");
    expect(cellItemState(it0({ doneAt: null }), NOW)).toBe("ontime");
    expect(cellItemState(it0({ doneAt: "2026-11-09T16:00:00Z" }), NOW)).toBe("late_done");
    expect(cellItemState(it0({ dueAt: "2026-11-30T15:00:00Z" }), NOW)).toBe("early");
    expect(cellItemState(it0({ status: "open", doneAt: null }), NOW)).toBe("late");
    expect(cellItemState(it0({ status: "open", doneAt: null, dueAt: "2026-11-10T15:00:00Z" }), NOW)).toBe("upcoming");
    expect(cellItemState(it0({ status: "void", voidReason: "expired" }), NOW)).toBe("expired");
  });
  it("무엇 · 언제 — 일간은 수업일 · 월간은 달 · 신규생 정착은 항목 · 건별은 날짜만(시각을 지어내지 않는다) · 기한은 사람 눈의 그날", () => {
    expect(cellItemTitle({ kind: "attendance", period: "daily", cycle: "2026-11-07" })).toBe("11/7 출결 입력");
    expect(cellItemTitle({ kind: "counsel_monthly", period: "monthly", cycle: "2026-10" })).toBe("10월 학생 상담");
    expect(cellItemTitle({ kind: "newcomer_call", period: "case", cycle: "month1_call" })).toBe("신규생 관리 — 1개월 콜");
    expect(cellItemWhen({ state: "late_done", period: "daily", dueAt: "2026-11-07T15:00:00Z", doneAt: "2026-11-08T09:42:00Z" })).toBe("11/8 18:42 기록");
    expect(cellItemWhen({ state: "ontime", period: "case", dueAt: "2026-11-07T15:00:00Z", doneAt: "2026-10-23T00:00:00Z" })).toBe("10/23 기록");
    expect(cellItemWhen({ state: "late", period: "daily", dueAt: "2026-11-07T15:00:00Z", doneAt: null })).toBe("기한 11/7");
  });
});
