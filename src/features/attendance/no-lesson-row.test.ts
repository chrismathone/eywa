import { describe, expect, it } from "vitest";
import { hasNoLessonDays, NO_LESSON_TERM, noLessonZeroView } from "./no-lesson-row";

/** 2026-09 첫 주 — 9/1(화)~9/6(일). dow 0=일. */
const DAYS = [
  { date: "2026-09-01", dow: 2 },
  { date: "2026-09-02", dow: 3 },
  { date: "2026-09-03", dow: 4 },
  { date: "2026-09-04", dow: 5 },
  { date: "2026-09-05", dow: 6 },
  { date: "2026-09-06", dow: 0 },
];
const base = { days: DAYS, holidays: {}, attendDows: [2, 4], spans: [], marks: {} };

describe("hasNoLessonDays — 그 달 수업날이 하나도 없는 줄(원장 2026-09-18)", () => {
  it("등원 요일이 그 달에 하나라도 있으면 수업날이 있다", () => {
    expect(hasNoLessonDays(base)).toBe(false);
  });

  it("등원 요일이 없으면(시간표에 요일이 없는 반) 수업날이 없다", () => {
    expect(hasNoLessonDays({ ...base, attendDows: [] })).toBe(true);
  });

  it("수강 기간 밖의 요일은 수업날이 아니다 — 종강·퇴원 뒤만 남은 줄", () => {
    // 8월 말에 끝난 수강 — 9월 요일은 전부 기간 밖.
    expect(hasNoLessonDays({ ...base, spans: [{ start: "2026-08-01", end: "2026-08-31" }] })).toBe(true);
    // 9/3까지 다녔으면 9/1(화)·9/3(목)이 수업날.
    expect(hasNoLessonDays({ ...base, spans: [{ start: "2026-08-01", end: "2026-09-03" }] })).toBe(false);
  });

  it("휴일은 수업날이 아니다", () => {
    expect(
      hasNoLessonDays({ ...base, holidays: { "2026-09-01": "휴원", "2026-09-03": "휴원" } }),
    ).toBe(true);
  });

  it("🔴 사실이 규칙을 이긴다 — 찍힌 값이나 보고서 파생이 하루라도 있으면 수업날이 없다고 하지 않는다", () => {
    const none = { ...base, attendDows: [] };
    expect(hasNoLessonDays({ ...none, marks: { "2026-09-05": "makeup" } })).toBe(false);
    expect(hasNoLessonDays({ ...none, derived: { "2026-09-05": true } })).toBe(false);
  });

  it("그 달에 없는 칸(placeholder)은 세지 않는다", () => {
    expect(
      hasNoLessonDays({ ...base, days: DAYS.map((d) => ({ ...d, placeholder: d.dow === 2 || d.dow === 4 })) }),
    ).toBe(true);
  });
});

describe("noLessonZeroView — 표 한 곳에서 0으로 적을 줄을 정한다", () => {
  const T = { units: 3, daysBasis: false };
  it("🔴 청구액과 등록 차수가 **둘 다** 빈 줄만 0 — 한쪽이라도 있으면 그 줄은 손대지 않는다", () => {
    const v = noLessonZeroView({
      rows: [
        { key: "a", noLessons: true },
        { key: "b", noLessons: true },
        { key: "c", noLessons: true },
        { key: "d", noLessons: false },
      ],
      billed: { b: 96000 },
      term: { c: T },
    });
    expect([...v.zeroRows]).toEqual(["a"]);
    expect(v.billed).toEqual({ a: 0, b: 96000 });
    expect(v.term).toEqual({ a: NO_LESSON_TERM, c: T });
  });
  it("열이 없는 값은 빈 것으로 본다 — 그 열은 결과에도 없다", () => {
    const v = noLessonZeroView({ rows: [{ key: "a", noLessons: true }] });
    expect([...v.zeroRows]).toEqual(["a"]);
    expect(v.billed).toBeUndefined();
    expect(v.term).toBeUndefined();
  });
});
