import { describe, expect, it } from "vitest";
import { maxUsedEnd, usedRangeLabel } from "./used-range";

describe("휴가 사용 기간 표기", () => {
  it("하루면 날짜 하나 — 끝이 비었거나 시작과 같을 때", () => {
    expect(usedRangeLabel("2026-08-15", null)).toBe("2026-08-15");
    expect(usedRangeLabel("2026-08-15", undefined)).toBe("2026-08-15");
    expect(usedRangeLabel("2026-08-15", "2026-08-15")).toBe("2026-08-15");
  });

  it("같은 달이면 날짜만, 같은 해면 월·일, 해가 다르면 통째로", () => {
    expect(usedRangeLabel("2026-08-15", "2026-08-17")).toBe("2026-08-15~17");
    expect(usedRangeLabel("2026-08-28", "2026-09-02")).toBe("2026-08-28~09-02");
    expect(usedRangeLabel("2026-12-30", "2027-01-02")).toBe("2026-12-30~2027-01-02");
  });
});

describe("가감 일수에 맞는 종료일 상한", () => {
  it("일수만큼 뒤로 — 4일이면 시작일 포함 나흘째(원장 예: 9/21 → 9/24)", () => {
    expect(maxUsedEnd("2026-09-21", 4)).toBe("2026-09-24"); // 월·화·수·목
  });

  it("🔴 일요일은 세지 않아 달력으로는 하루 더 간다(휴가 신청과 같은 규칙)", () => {
    // 금(9/25)에서 4일 = 금·토·[일 제외]·월·화
    expect(maxUsedEnd("2026-09-25", 4)).toBe("2026-09-29");
  });

  it("1일 이하(반차·반반차 포함)면 시작일 그대로 — 하루짜리다", () => {
    expect(maxUsedEnd("2026-09-21", 1)).toBe("2026-09-21");
    expect(maxUsedEnd("2026-09-21", 0.5)).toBe("2026-09-21");
    expect(maxUsedEnd("2026-09-21", 0.25)).toBe("2026-09-21");
    expect(maxUsedEnd("2026-09-21", 0)).toBe("2026-09-21");
  });

  it("반 일수는 올려 센다 — 1.5일이면 이틀째까지 고를 수 있다", () => {
    expect(maxUsedEnd("2026-09-21", 1.5)).toBe("2026-09-22");
  });

  it("형식이 아니면 그대로 돌려준다(화면이 빈 칸을 넘길 수 있다)", () => {
    expect(maxUsedEnd("2026-9-1", 3)).toBe("2026-9-1");
    expect(maxUsedEnd("", 3)).toBe("");
  });
});
