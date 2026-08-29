import { describe, expect, it } from "vitest";
import { computeRosterDiff, type RosterDesiredRow, type RosterEnrollmentRow } from "./roster-diff";

const enr = (o: Partial<RosterEnrollmentRow> & { enrollmentId: string; studentId: string; classId: string }): RosterEnrollmentRow => ({
  studentName: "학생", className: "옛반", ...o,
});
const want = (o: Partial<RosterDesiredRow> & { studentId: string; classId: string }): RosterDesiredRow => ({
  studentName: "학생", school: null, grade: null, className: "새반", ...o,
});
const removable = (...ids: string[]) => new Set(ids);

describe("computeRosterDiff", () => {
  it("반 이름이 바뀌어도 classId가 같으면 무변경이다", () => {
    // 🔴 이 테스트가 이 모듈의 존재 이유다 — 이름으로 비교하면 여기서 '이동'이 나온다.
    const d = computeRosterDiff(
      [want({ studentId: "s1", classId: "c1", className: "LE1" })],
      [enr({ enrollmentId: "e1", studentId: "s1", classId: "c1", className: "LS6" })],
      removable("c1"),
    );
    expect(d.unchanged).toBe(1);
    expect(d.moves).toHaveLength(0);
    expect(d.removes).toHaveLength(0);
  });

  it("잃은 반 하나 + 얻은 반 하나 = 이동(추가+종료가 아니다)", () => {
    // 이동으로 처리해야 attendance_days·on_hold가 승계된다(0228a).
    const d = computeRosterDiff(
      [want({ studentId: "s1", classId: "c2", className: "MS2A" })],
      [enr({ enrollmentId: "e1", studentId: "s1", classId: "c1", className: "MS2B" })],
      removable("c1", "c2"),
    );
    expect(d.moves).toEqual([
      { enrollmentId: "e1", studentName: "학생", fromClassName: "MS2B", toClassName: "MS2A", toClassId: "c2" },
    ]);
    expect(d.adds).toHaveLength(0);
    expect(d.removes).toHaveLength(0);
  });

  it("현재 수강이 없으면 추가", () => {
    const d = computeRosterDiff([want({ studentId: "s9", classId: "c1" })], [], removable("c1"));
    expect(d.adds).toHaveLength(1);
    expect(d.adds[0]!.studentId).toBe("s9");
  });

  it("명단에 없는 학생은 그 반이 시트에 있을 때만 종료 후보", () => {
    const d = computeRosterDiff(
      [],
      [enr({ enrollmentId: "e1", studentId: "s1", classId: "c1", studentName: "가나다" })],
      removable("c1"),
    );
    expect(d.removes).toHaveLength(1);
    expect(d.warnings).toHaveLength(0);
  });

  it("🔴 시트에 블록이 없는 반은 종료하지 않고 경고한다", () => {
    // 파싱이 한 블록을 통째로 놓쳤을 때 그 반 전원이 조용히 퇴출되는 것을 막는 마지막 방어.
    const d = computeRosterDiff(
      [],
      [enr({ enrollmentId: "e1", studentId: "s1", classId: "cX", className: "안읽힌반", studentName: "가나다" })],
      removable("c1"),
    );
    expect(d.removes).toHaveLength(0);
    expect(d.warnings[0]).toContain("안읽힌반");
    expect(d.warnings[0]).toContain("손대지 않았습니다");
  });

  it("한 학생이 두 영어 반이면 각 반을 따로 본다", () => {
    // 실측: 영어 활성 수강 240건 중 한 명이 2반이다.
    const d = computeRosterDiff(
      [want({ studentId: "s1", classId: "c1" }), want({ studentId: "s1", classId: "c3" })],
      [
        enr({ enrollmentId: "e1", studentId: "s1", classId: "c1" }),
        enr({ enrollmentId: "e2", studentId: "s1", classId: "c2" }),
      ],
      removable("c1", "c2", "c3"),
    );
    expect(d.unchanged).toBe(1);
    expect(d.moves).toHaveLength(1);
    expect(d.moves[0]!.enrollmentId).toBe("e2");
    expect(d.moves[0]!.toClassId).toBe("c3");
    expect(d.removes).toHaveLength(0);
  });

  it("같은 학생·반이 시트에 두 번 적혀도 한 번만 만든다", () => {
    const d = computeRosterDiff(
      [want({ studentId: "s1", classId: "c1" }), want({ studentId: "s1", classId: "c1" })],
      [],
      removable("c1"),
    );
    expect(d.adds).toHaveLength(1);
  });

  it("짝이 안 맞으면 남는 쪽만 추가·종료가 된다", () => {
    // 두 반에 있었는데 시트엔 한 반뿐 → 이동 1 + 종료 1.
    const d = computeRosterDiff(
      [want({ studentId: "s1", classId: "c3", className: "새반" })],
      [
        enr({ enrollmentId: "e1", studentId: "s1", classId: "c1", className: "A반" }),
        enr({ enrollmentId: "e2", studentId: "s1", classId: "c2", className: "B반" }),
      ],
      removable("c1", "c2"),
    );
    expect(d.moves).toHaveLength(1);
    expect(d.removes).toHaveLength(1);
    // 결정적이어야 한다 — 이름 순으로 A반이 먼저 짝지어진다.
    expect(d.moves[0]!.fromClassName).toBe("A반");
    expect(d.removes[0]!.className).toBe("B반");
  });
});
