import { describe, expect, it } from "vitest";
import {
  EFFECTIVE_DATE_MAX_DAYS,
  effectiveDateLabel,
  isImmediate,
  nextMondayAfter,
  normalizeEffectiveDate,
} from "./effective-date";

const TODAY = "2026-08-28"; // 금요일

describe("normalizeEffectiveDate", () => {
  it("빈 값은 오늘 — 적용일을 안 고른 기존 동작이 그대로 유지된다", () => {
    for (const v of [undefined, null, "", "   "]) {
      expect(normalizeEffectiveDate(v, TODAY)).toEqual({ date: TODAY });
    }
  });

  it("오늘·미래는 통과", () => {
    expect(normalizeEffectiveDate(TODAY, TODAY)).toEqual({ date: TODAY });
    expect(normalizeEffectiveDate("2026-09-07", TODAY)).toEqual({ date: "2026-09-07" });
  });

  it("과거는 거절 — 소급하면 이미 찍힌 출결이 사라진 슬롯에 매달린다", () => {
    const r = normalizeEffectiveDate("2026-08-27", TODAY);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toContain("소급");
  });

  it("상한(오늘+180일)까지만 — 하루 넘으면 거절", () => {
    expect(normalizeEffectiveDate("2027-02-24", TODAY)).toEqual({ date: "2027-02-24" }); // +180
    expect("error" in normalizeEffectiveDate("2027-02-25", TODAY)).toBe(true); // +181
    expect(EFFECTIVE_DATE_MAX_DAYS).toBe(180);
  });

  it("형식이 아니거나 실재하지 않는 날짜는 거절 — 2026-02-31이 3/3으로 굴러가면 안 된다", () => {
    for (const v of ["2026/09/07", "20260907", "내일", "2026-02-31", "2026-13-01"]) {
      expect("error" in normalizeEffectiveDate(v, TODAY)).toBe(true);
    }
  });
});

describe("nextMondayAfter", () => {
  it("주중이면 그 주 월요일의 다음 주", () => {
    expect(nextMondayAfter("2026-08-28")).toBe("2026-08-31"); // 금 → 다음 월
    expect(nextMondayAfter("2026-08-30")).toBe("2026-08-31"); // 일 → 다음 날 월
  });

  it("오늘이 월요일이어도 **다음** 주 월요일 — 오늘 프리셋과 겹치지 않는다", () => {
    expect(nextMondayAfter("2026-08-31")).toBe("2026-09-07");
  });

  it("항상 미래라 normalizeEffectiveDate를 통과한다", () => {
    for (const d of ["2026-08-28", "2026-08-31", "2026-09-06"]) {
      expect(normalizeEffectiveDate(nextMondayAfter(d), d)).toEqual({ date: nextMondayAfter(d) });
    }
  });
});

describe("effectiveDateLabel / isImmediate", () => {
  it("요일을 붙인다", () => {
    expect(effectiveDateLabel("2026-08-31")).toBe("2026-08-31(월)");
    expect(effectiveDateLabel("2026-08-30")).toBe("2026-08-30(일)");
  });

  it("망가진 값은 그대로 돌려준다(화면에 NaN·Invalid Date를 흘리지 않는다)", () => {
    expect(effectiveDateLabel("내일")).toBe("내일");
    expect(effectiveDateLabel("2026-02-31")).toBe("2026-02-31");
  });

  it("오늘이면 즉시", () => {
    expect(isImmediate(TODAY, TODAY)).toBe(true);
    expect(isImmediate("2026-08-31", TODAY)).toBe(false);
  });
});
