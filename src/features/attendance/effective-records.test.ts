import { describe, expect, it } from "vitest";
import { effectiveAttendanceRecords } from "./effective-records";

const row = (
  overrides: Partial<{
    id: string;
    student_id: string;
    class_id: string;
    session_date: string;
    recorded_at: string;
    status: string;
  }> = {},
) => ({
  id: "record-1",
  student_id: "student-1",
  class_id: "class-1",
  session_date: "2026-07-16",
  recorded_at: "2026-07-16T09:00:00.000Z",
  status: "absent",
  ...overrides,
});

describe("effectiveAttendanceRecords", () => {
  it("같은 학생·반·수업일의 최신 정정만 유효하게 남긴다", () => {
    const original = row();
    const correction = row({
      recorded_at: "2026-07-16T10:00:00.000Z",
      status: "present",
    });

    expect(effectiveAttendanceRecords([correction, original])).toEqual([correction]);
    expect(effectiveAttendanceRecords([original, correction])).toEqual([correction]);
  });

  it("학생·반·수업일 중 하나라도 다르면 각각의 유효 기록으로 유지한다", () => {
    const rows = [
      row(),
      row({ id: "record-2", student_id: "student-2" }),
      row({ id: "record-3", class_id: "class-2" }),
      row({ id: "record-4", session_date: "2026-07-15" }),
    ];

    expect(effectiveAttendanceRecords(rows)).toEqual(rows);
  });

  it("입력 배열을 변경하지 않는다", () => {
    const older = row();
    const newer = row({ recorded_at: "2026-07-16T10:00:00.000Z", status: "late" });
    const rows = [older, newer];

    effectiveAttendanceRecords(rows);

    expect(rows).toEqual([older, newer]);
  });

  it("recorded_at이 올바른 timestamptz가 아니면 조용히 잘못 집계하지 않는다", () => {
    expect(() => effectiveAttendanceRecords([row({ recorded_at: "invalid" })])).toThrow(
      "Invalid attendance recorded_at",
    );
  });

  it("recorded_at이 같으면 UUID 정렬상 마지막 행을 결정적 정정으로 채택", () => {
    const lowerId = row({ id: "00000000-0000-0000-0000-000000000001", status: "absent" });
    const higherId = row({ id: "00000000-0000-0000-0000-000000000002", status: "present" });

    expect(effectiveAttendanceRecords([higherId, lowerId])).toEqual([higherId]);
    expect(effectiveAttendanceRecords([lowerId, higherId])).toEqual([higherId]);
  });
});
