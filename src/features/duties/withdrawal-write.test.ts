import { describe, expect, it } from "vitest";
import { withdrawalState } from "./withdrawal-write";

const NOW = Date.parse("2026-11-11T05:00:00Z");
describe("퇴원보고서 작성 차례의 상태", () => {
  it("기한 내 · 기한 후 완료 · 미처리 · 남음 · 기한 전에 끝낸 것은 '완료'(판정 밖)", () => {
    const due = "2026-11-10T15:00:00Z";
    expect(withdrawalState({ status: "done", dueAt: due, closedAt: "2026-11-10T10:00:00Z" }, NOW)).toBe("ontime");
    expect(withdrawalState({ status: "done", dueAt: due, closedAt: "2026-11-11T01:00:00Z" }, NOW)).toBe("late_done");
    expect(withdrawalState({ status: "open", dueAt: due, closedAt: null }, NOW)).toBe("late");
    expect(withdrawalState({ status: "open", dueAt: "2026-11-12T15:00:00Z", closedAt: null }, NOW)).toBe("upcoming");
    expect(withdrawalState({ status: "done", dueAt: "2026-11-12T15:00:00Z", closedAt: "2026-11-11T01:00:00Z" }, NOW)).toBe("early");
  });
});
