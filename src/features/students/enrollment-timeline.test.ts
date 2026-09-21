import { describe, expect, it } from "vitest";
import { enrollmentTimeline, type TimelineEnrollment } from "./enrollment-timeline";

function row(id: string, patch: Partial<TimelineEnrollment> = {}): TimelineEnrollment {
  return { id, classId: id, className: id, subject: "english", startDate: "2026-04-07", endDate: null, isTransferred: false, reason: null, ...patch };
}
const top = row("top", { className: "중등E_중1 TOP", endDate: "2026-07-08" });
const regular = row("regular", { className: "중등E_중1 정규 A", startDate: "2026-07-09" });
const transfers = (rows: TimelineEnrollment[]) => enrollmentTimeline(rows).filter(e => e.kind === "enrollment_transfer");

describe("수강 타임라인의 반이동", () => {
  it("종료 다음 날 같은 과목의 새 반을 시작하면 새 반 시작일 한 건으로 합친다", () => {
    expect(enrollmentTimeline([top, regular])).toEqual([
      { date: "2026-07-09", kind: "enrollment_transfer", title: "중등E_중1 TOP → 중등E_중1 정규 A", description: null },
      { date: "2026-04-07", kind: "enrollment_start", title: "중등E_중1 TOP 수강 시작" },
    ]);
  });
  it("이동이 이어져도 첫 시작·두 번의 이동·최종 종료가 각각 남는다", () => {
    const first = row("first", { classId: "regular", className: regular.className, startDate: "2025-07-15", endDate: "2026-04-06" });
    const events = enrollmentTimeline([regular, first, top].map(e => e.id === regular.id ? {...e, endDate: "2026-09-20", reason: "이사"} : e));
    expect(events.map(e => e.kind)).toEqual(["enrollment_end", "enrollment_transfer", "enrollment_transfer", "enrollment_start"]);
    expect(events[0].description).toBe("이사");
  });
  it("명시적 전출은 종료일을 새 반 시작일로 취급한다", () => {
    expect(transfers([{...top, endDate: regular.startDate, isTransferred: true}, regular])).toHaveLength(1);
    expect(transfers([{...top, endDate: regular.startDate}, regular])).toHaveLength(0);
  });
  it.each([
    ["다른 과목", {...regular, subject: "math"}],
    ["과목 미상", {...regular, subject: null}],
    ["같은 반의 날짜 분리", {...regular, classId: top.classId}],
    ["수강 공백", {...regular, startDate: "2026-07-10"}],
  ])("%s은 반이동으로 합치지 않는다", (_label, next) => {
    expect(enrollmentTimeline([top, next])).toHaveLength(3);
    expect(transfers([top, next])).toHaveLength(0);
  });
  it("이동 목적지 후보가 둘이면 둘 중 하나를 임의로 고르지 않는다", () => {
    expect(transfers([top, regular, {...regular, id: "another", classId: "another"}])).toEqual([]);
  });
  it("이동 출발지 후보가 둘이면 임의로 고르지 않는다", () => {
    expect(transfers([top, {...top, id: "another", classId: "another"}, regular])).toEqual([]);
  });
  it("서로 다른 과목의 두 반이동은 독립적으로 묶는다", () => {
    expect(transfers([top, regular, {...top, id: "m1", classId: "m1", subject: "math"}, {...regular, id: "m2", classId: "m2", subject: "math"}])).toHaveLength(2);
  });
  it("월 경계·윤년에도 날짜를 이어 주고 사유를 보존한다", () => {
    expect(transfers([{...top, startDate: "2024-01-01", endDate: "2024-02-29", reason: "수준 변경"}, {...regular, startDate: "2024-03-01"}])[0]).toMatchObject({date: "2024-03-01", description: "수준 변경"});
  });
  it("입력 순서가 뒤집혀도 같은 결과이며 원본 수강 기록을 변경하지 않는다", () => {
    const rows = [Object.freeze(top), Object.freeze(regular)];
    expect(enrollmentTimeline(rows)).toEqual(enrollmentTimeline([...rows].reverse()));
    expect(top.isTransferred).toBe(false);
  });
  it("미래에 예약된 반이동도 예약된 시작일로 표시한다", () => {
    expect(transfers([{...top, endDate: "2027-01-31"}, {...regular, startDate: "2027-02-01"}])[0].date).toBe("2027-02-01");
  });
});
