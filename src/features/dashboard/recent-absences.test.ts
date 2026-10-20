import { describe, expect, it } from "vitest";
import { foldRecentAbsences, sortRecentAbsentStudents, withAbsences, type RecentAbsenceRow } from "./recent-absences";

let seq = 0;
const row = (o: Partial<RecentAbsenceRow> & Pick<RecentAbsenceRow, "student_id" | "class_id" | "session_date" | "status">): RecentAbsenceRow => ({
  id: `r${String(++seq).padStart(4, "0")}`,
  slot_start: null,
  recorded_at: `${o.session_date}T09:00:00+00:00`,
  subject: "math",
  note: null,
  student_name: o.student_id.toUpperCase(),
  class_name: `${o.class_id}반`,
  ...o,
});
const range = { from: "2026-10-13", to: "2026-10-19" };
const teacherOf = (c: RecentAbsenceRow) => ({ label: `${c.class_id}선생님${c.slot_start ? `(${c.slot_start})` : ""}` });

describe("foldRecentAbsences — 세는 단위 = (학생, 반, 수업일) 결석 1회(0221a와 같다)", () => {
  it("교시가 여럿이어도 그 반의 그날은 1회 · 담당은 교시마다 모아 중복 없이", () => {
    const out = foldRecentAbsences(
      [
        row({ student_id: "a", class_id: "e1", session_date: "2026-10-14", status: "absent", slot_start: "16:20" }),
        row({ student_id: "a", class_id: "e1", session_date: "2026-10-14", status: "absent", slot_start: "17:00" }),
      ],
      range,
      teacherOf,
    );
    expect(out.students).toHaveLength(1);
    expect(out.students[0]!.count).toBe(1);
    expect(out.students[0]!.absences[0]!.teachers).toEqual(["e1선생님(16:20)", "e1선생님(17:00)"]);
  });

  it("같은 날 두 반을 빠지면 2회 · 다른 반에 나온 날의 결석도 센다", () => {
    const out = foldRecentAbsences(
      [
        row({ student_id: "a", class_id: "m1", session_date: "2026-10-14", status: "absent" }),
        row({ student_id: "a", class_id: "e1", session_date: "2026-10-14", status: "absent" }),
        row({ student_id: "a", class_id: "m1", session_date: "2026-10-15", status: "present" }),
        row({ student_id: "a", class_id: "e1", session_date: "2026-10-15", status: "absent" }),
      ],
      range,
      teacherOf,
    );
    expect(out.students[0]!.count).toBe(3);
  });

  it("정정해 출석이 된 칸은 결석이 아니다(최신 행만)", () => {
    const out = foldRecentAbsences(
      [
        row({ student_id: "a", class_id: "m1", session_date: "2026-10-14", status: "absent", recorded_at: "2026-10-14T09:00:00+00:00" }),
        row({ student_id: "a", class_id: "m1", session_date: "2026-10-14", status: "present", recorded_at: "2026-10-14T10:00:00+00:00" }),
      ],
      range,
      teacherOf,
    );
    expect(out.students).toHaveLength(0);
  });

  it("창 밖 날짜는 세지 않는다", () => {
    const out = foldRecentAbsences([row({ student_id: "a", class_id: "m1", session_date: "2026-10-20", status: "absent" })], range, teacherOf);
    expect(out.students).toHaveLength(0);
  });

  it("사전 통보 — 그날 그 반 결석 칸이 전부 미리 알린 것이면 표식, 연락 필요 수는 미리 안 알린 결석만", () => {
    const out = foldRecentAbsences(
      [
        row({ student_id: "a", class_id: "m1", session_date: "2026-10-14", status: "absent", recorded_at: "2026-10-13T09:00:00+00:00" }),
        row({ student_id: "a", class_id: "m1", session_date: "2026-10-15", status: "absent" }),
      ],
      range,
      teacherOf,
    );
    const a = out.students[0]!;
    expect(a.absences.map((x) => x.preNotified)).toEqual([true, false]);
    expect(a.unnotified).toBe(1);
  });
});

describe("정렬 — 누적 결석 많은 순 → 연락 필요 먼저 → 이름", () => {
  it("횟수 → 연락 필요 → 이름", () => {
    const mk = (id: string, name: string, count: number, unnotified: number) => ({ studentId: id, name, count, unnotified, absences: [] });
    const sorted = sortRecentAbsentStudents([mk("1", "다", 1, 1), mk("2", "가", 3, 0), mk("3", "나", 1, 0), mk("4", "라", 3, 2)]);
    expect(sorted.map((s) => s.studentId)).toEqual(["4", "2", "1", "3"]);
  });
  it("일부 결석만 남기면 횟수·연락 필요를 다시 센다", () => {
    const base = { studentId: "1", name: "가", count: 2, unnotified: 2, absences: [] };
    const absence = { date: "2026-10-14", classId: "m1", className: null, subject: "math", preNotified: true, teachers: [] };
    expect(withAbsences(base, [absence])).toMatchObject({ count: 1, unnotified: 0 });
  });
});
