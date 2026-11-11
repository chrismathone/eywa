import { describe, expect, it } from "vitest";
import { consultDateFull, consultDateLabel } from "./list-date";

describe("원생상담 목록 '날짜' 칸 — 실제 상담 날짜", () => {
  it("올해 상담은 월/일 + 요일, 다른 해는 연도를 붙인다", () => {
    expect(consultDateLabel("2026-11-10T09:00:00+09:00", "2026-11-11")).toBe("11/10 (화)");
    expect(consultDateLabel("2025-11-10T09:00:00+09:00", "2026-11-11")).toBe("2025/11/10");
    expect(consultDateLabel("2026-01-05T10:00:00+09:00", "2026-11-11")).toBe("1/5 (월)");
  });
  it("🔴 날짜는 KST로 자른다 — 새벽 상담(UTC로는 전날)이 하루 전으로 적히지 않는다", () => {
    // 2026-11-10 00:30 KST = 2026-11-09 15:30 UTC
    expect(consultDateLabel("2026-11-09T15:30:00Z", "2026-11-11")).toBe("11/10 (화)");
    // 해가 바뀌는 새벽도 KST 연도로 판정한다: 2026-01-01 00:10 KST = 2025-12-31 15:10 UTC
    expect(consultDateLabel("2025-12-31T15:10:00Z", "2026-11-11")).toBe("1/1 (목)");
  });
  it("못 읽는 값은 '—'(지어내지 않는다) · 전문은 '2026년 11월 10일 (화)'", () => {
    for (const bad of [null, undefined, "", "not-a-date"]) expect(consultDateLabel(bad, "2026-11-11")).toBe("—");
    expect(consultDateFull("2026-11-10T09:00:00+09:00")).toBe("2026년 11월 10일 (화)");
    expect(consultDateFull("nope")).toBeNull();
  });
});
