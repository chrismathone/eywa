import { describe, expect, it } from "vitest";
import {
  ASSIGN_START_MAX_AHEAD_DAYS,
  ASSIGN_START_MAX_BACK_DAYS,
  assignStartDateNotice,
  normalizeAssignStartDate,
} from "./assign-start-date";

const TODAY = "2026-09-09";

describe("normalizeAssignStartDate", () => {
  it("빈 값·공백은 오늘 — 종전 동작(항상 오늘)이 그대로 폴백이다", () => {
    expect(normalizeAssignStartDate("", TODAY)).toEqual({ date: TODAY });
    expect(normalizeAssignStartDate("   ", TODAY)).toEqual({ date: TODAY });
    expect(normalizeAssignStartDate(null, TODAY)).toEqual({ date: TODAY });
    expect(normalizeAssignStartDate(undefined, TODAY)).toEqual({ date: TODAY });
  });

  it("형식이 깨졌거나 없는 날짜면 배정을 실패시키지 않고 오늘로 떨어뜨린다", () => {
    expect(normalizeAssignStartDate("2026/09/09", TODAY)).toEqual({ date: TODAY });
    expect(normalizeAssignStartDate("내일", TODAY)).toEqual({ date: TODAY });
    // 형식만 맞는 날짜(2월 31일) — Date가 3/3으로 굴러가므로 통과시키면 엉뚱한 날이 저장된다.
    expect(normalizeAssignStartDate("2026-02-31", TODAY)).toEqual({ date: TODAY });
  });

  it("오늘·미래·과거 모두 그대로 통과한다 — 반 배정(createEnrollment) 규약", () => {
    expect(normalizeAssignStartDate(TODAY, TODAY)).toEqual({ date: TODAY });
    expect(normalizeAssignStartDate("2026-10-01", TODAY)).toEqual({ date: "2026-10-01" });
    expect(normalizeAssignStartDate("2026-09-01", TODAY)).toEqual({ date: "2026-09-01" });
  });

  it("경계일은 포함, 하루 넘으면 에러 — 연도 오타가 조용히 통과하지 않는다", () => {
    expect(normalizeAssignStartDate("2027-03-08", TODAY)).toEqual({ date: "2027-03-08" }); // +180
    expect(normalizeAssignStartDate("2026-03-13", TODAY)).toEqual({ date: "2026-03-13" }); // -180
    const ahead = normalizeAssignStartDate("2027-03-09", TODAY);
    expect("error" in ahead && ahead.error).toContain("2027-03-08");
    // 연도를 한 해 잘못 적은 실제 오타 모양.
    const back = normalizeAssignStartDate("2025-09-09", TODAY);
    expect("error" in back && back.error).toContain("연도");
  });

  it("상한·하한 상수가 시간표 적용일과 같은 값이다(근거 공유)", () => {
    expect(ASSIGN_START_MAX_AHEAD_DAYS).toBe(180);
    expect(ASSIGN_START_MAX_BACK_DAYS).toBe(180);
  });
});

describe("assignStartDateNotice", () => {
  it("오늘이면 할 말이 없다", () => {
    expect(assignStartDateNotice(TODAY, TODAY)).toBeNull();
  });

  it("미래·과거는 서로 다른 사실을 말한다 — 상대 표현이 아니라 실제 날짜로", () => {
    const future = assignStartDateNotice("2026-10-01", TODAY);
    expect(future).toContain("2026년 10월 1일");
    expect(future).toContain("출석부");
    const past = assignStartDateNotice("2026-09-01", TODAY);
    expect(past).toContain("2026년 9월 1일");
    expect(past).toContain("소급");
    expect(future).not.toBe(past);
  });

  it("형식이 깨진 값엔 아무 말도 지어내지 않는다", () => {
    expect(assignStartDateNotice("", TODAY)).toBeNull();
    expect(assignStartDateNotice("2026-02-31", TODAY)).toBeNull();
  });
});
