import { describe, expect, it } from "vitest";
import { enrollmentEventTimes, type EnrollmentOutcomeLog } from "./enrolled-outcome";
import { splitEnrolledRecent } from "./enrolled-recent";

const event = (id: string, via?: unknown, created_at = "2026-10-23T10:14:40Z"): EnrollmentOutcomeLog => ({
  metadata: { consultationId: id, from: "consulted", to: "enrolled", ...(via === undefined ? {} : { via }) }, created_at,
});

describe("신규 등록 사건과 자료 정리 감사로그 구분", () => {
  it("실제 전환 2건 + 반 배정 1건은 이달 3건, 일괄 정리 88건은 전일·이달 모두 제외", () => {
    const logs = [event("new1", "convert", "2026-10-01T11:17:27Z"), event("new2", "convert", "2026-10-17T05:16:00Z"),
      ...Array.from({ length: 88 }, (_, i) => event(`old${i}`, "scripts/_oneoff/cleanup-stale-enrollment-consultations.cjs"))];
    const dates = [...enrollmentEventTimes(logs).values()].map((at) => ({ date: at.slice(0, 10) }));
    const counts = splitEnrolledRecent([...dates, { date: "2026-10-16" }], "2026-10-24");
    expect(counts.yesterday).toHaveLength(0);
    expect(counts.month).toHaveLength(3);
  });
  it("실제 등록 날짜를 나중의 정리·복구 날짜로 덮지 않는다", () => {
    const first = "2026-10-01T10:00:00Z";
    const logs = [event("a", undefined, first), event("a", "calendar_fix_2026_10_22"), event("a", "revert")];
    expect([...enrollmentEventTimes(logs)]).toEqual([["a", first]]);
    expect(enrollmentEventTimes([event("a", "scripts/new-import.cjs")]).size).toBe(0);
  });
  it("상담이 옛 자료여도 직원의 실제 상태 변경·수업 배정은 유지, 같은 상태 저장은 제외", () => {
    const logs = [event("old-consult"), event("convert", "convert"), event("demo", "demo"), event("no-via", null),
      { ...event("unchanged"), metadata: { consultationId: "unchanged", from: "enrolled", to: "enrolled" } },
      { metadata: null, created_at: "2026-10-23T10:00:00Z" }];
    expect([...enrollmentEventTimes(logs).keys()]).toEqual(["old-consult", "convert", "demo", "no-via"]);
  });
});
