import { describe, expect, it } from "vitest";

import { resolveDayArrivals, type DayEnrollmentRow } from "./day-arrivals";

const TODAY = "2026-09-09";

function row(over: Partial<DayEnrollmentRow> & Pick<DayEnrollmentRow, "studentId" | "startDate">): DayEnrollmentRow {
  return {
    studentName: `학생-${over.studentId}`,
    endDate: null,
    isTransferred: false,
    isTransferredIn: false,
    onHold: false,
    ...over,
  };
}

describe("오늘 첫 수업 · 오늘 마지막 수업 (학생 단위 판정)", () => {
  it("오늘 시작한 수강 하나뿐인 학생은 '첫 수업'", () => {
    const out = resolveDayArrivals([row({ studentId: "s1", startDate: TODAY })], TODAY);
    expect(out.starting.map((s) => s.studentId)).toEqual(["s1"]);
    expect(out.ending).toEqual([]);
  });

  it("이미 다니던 학생이 반을 하나 더 받은 것은 첫 수업이 아니다 (실측: 김라윤A)", () => {
    const out = resolveDayArrivals(
      [
        row({ studentId: "s1", startDate: TODAY }),
        row({ studentId: "s1", startDate: "2026-03-02" }), // 계속 다니는 반
      ],
      TODAY,
    );
    expect(out.starting).toEqual([]);
  });

  it("반이동으로 들어온 수강은 첫 수업이 아니다", () => {
    const out = resolveDayArrivals(
      [row({ studentId: "s1", startDate: TODAY, isTransferredIn: true })],
      TODAY,
    );
    expect(out.starting).toEqual([]);
  });

  it("오늘 끝나는 수강이 있어도 남은 반이 있으면 마지막 수업이 아니다 (실측: 김지호 continues=4)", () => {
    const out = resolveDayArrivals(
      [
        row({ studentId: "s1", startDate: "2026-03-02", endDate: TODAY }),
        row({ studentId: "s1", startDate: "2026-03-02", endDate: null }),
      ],
      TODAY,
    );
    expect(out.ending).toEqual([]);
  });

  it("남은 반이 없으면 마지막 수업 — 같은 날 두 반이 끝나도 학생 한 번만 (실측: 조현준 행 2개)", () => {
    const out = resolveDayArrivals(
      [
        row({ studentId: "s1", startDate: "2026-03-02", endDate: TODAY }),
        row({ studentId: "s1", startDate: "2026-03-02", endDate: TODAY }),
      ],
      TODAY,
    );
    expect(out.ending.map((s) => s.studentId)).toEqual(["s1"]);
  });

  it("반이동으로 끝난 수강은 마지막 수업이 아니다 (그날 이미 새 반)", () => {
    const out = resolveDayArrivals(
      [row({ studentId: "s1", startDate: "2026-03-02", endDate: TODAY, isTransferred: true })],
      TODAY,
    );
    expect(out.ending).toEqual([]);
  });

  it("휴원 수강만 남으면 오늘이 마지막 수업이다", () => {
    const out = resolveDayArrivals(
      [
        row({ studentId: "s1", startDate: "2026-03-02", endDate: TODAY }),
        row({ studentId: "s1", startDate: "2026-03-02", endDate: null, onHold: true }),
      ],
      TODAY,
    );
    expect(out.ending.map((s) => s.studentId)).toEqual(["s1"]);
  });

  it("어제 끝난 수강은 오늘의 신호가 아니다", () => {
    const out = resolveDayArrivals(
      [row({ studentId: "s1", startDate: "2026-03-02", endDate: "2026-09-08" })],
      TODAY,
    );
    expect(out.ending).toEqual([]);
  });

  it("반이동으로 어제 나간 수강은 '오늘까지 다닌 것'으로 치지 않는다(반열림)", () => {
    // 어제 반이동으로 끝났고 오늘 새 반이 시작 → 첫 수업이 아니다(반이동 들어옴 표식이 없어도).
    const out = resolveDayArrivals(
      [
        row({ studentId: "s1", startDate: "2026-03-02", endDate: TODAY, isTransferred: true }),
        row({ studentId: "s1", startDate: TODAY }),
      ],
      TODAY,
    );
    expect(out.starting).toEqual([]);
  });

  it("이름은 한글 정렬, 이름이 비면 대체 문구", () => {
    const out = resolveDayArrivals(
      [
        row({ studentId: "b", studentName: "박서준", startDate: TODAY }),
        row({ studentId: "a", studentName: "김하늘", startDate: TODAY }),
        row({ studentId: "c", studentName: "", startDate: TODAY }),
      ],
      TODAY,
    );
    expect(out.starting.map((s) => s.name)).toEqual(["(학생)", "김하늘", "박서준"]);
  });
});
