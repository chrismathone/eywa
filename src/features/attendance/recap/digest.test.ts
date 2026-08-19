import { describe, expect, it } from "vitest";
import { buildDayRecap, type RecapSlotInput } from "./digest";

function slot(over: Partial<RecapSlotInput> = {}): RecapSlotInput {
  return {
    classId: "c1",
    className: "중2 A",
    subject: "math",
    slotStart: "16:20",
    saveSlot: null,
    teacherName: "김강사",
    slotTeacherLabel: null,
    hasAnyRecord: true,
    students: [],
    ...over,
  };
}

function student(over: Partial<RecapSlotInput["students"][number]> = {}) {
  return {
    studentId: "s1",
    studentName: "학생A",
    schoolGrade: "경명여중2",
    status: "present" as string | null,
    note: null as string | null,
    ...over,
  };
}

describe("buildDayRecap", () => {
  it("같은 반 여러 교시의 같은 결석은 한 건으로 접고 교시를 모은다(0221a와 같은 단위)", () => {
    // 영어는 교시마다 행이 남는다 — 행을 그냥 세면 하루 결석이 3회가 된다.
    const recap = buildDayRecap({
      date: "2026-08-18",
      slots: ["16:20", "17:20", "18:20"].map((t) =>
        slot({ subject: "english", slotStart: t, saveSlot: t, students: [student({ status: "absent" })] }),
      ),
    });
    expect(recap.totals.absent).toBe(1);
    expect(recap.absences).toHaveLength(1);
    expect(recap.absences[0]!.slots).toEqual(["16:20", "17:20", "18:20"]);
  });

  it("같은 학생이 다른 반에서 빠지면 따로 센다(빠진 수업을 센다)", () => {
    const recap = buildDayRecap({
      date: "2026-08-18",
      slots: [
        slot({ classId: "c1", students: [student({ status: "absent" })] }),
        slot({ classId: "c2", className: "영어 B", students: [student({ status: "absent" })] }),
      ],
    });
    expect(recap.totals.absent).toBe(2);
  });

  it("같은 반에서 상태가 갈리면(4교시 결석·5교시 지각) 두 건 다 남긴다", () => {
    const recap = buildDayRecap({
      date: "2026-08-18",
      slots: [
        slot({ slotStart: "16:20", students: [student({ status: "absent" })] }),
        slot({ slotStart: "17:20", students: [student({ status: "late" })] }),
      ],
    });
    expect(recap.totals.absent).toBe(1);
    expect(recap.totals.late).toBe(1);
    expect(recap.others).toHaveLength(1);
  });

  it("입력률은 칸(교시×학생) 단위 — 접지 않는다", () => {
    const recap = buildDayRecap({
      date: "2026-08-18",
      slots: [
        slot({
          students: [student({ status: "present" }), student({ studentId: "s2", status: null })],
        }),
      ],
    });
    expect(recap.totals.cells).toBe(2);
    expect(recap.totals.recorded).toBe(1);
    expect(recap.totals.inputRate).toBe(50);
  });

  it("칸이 0이면 입력률은 null — 0%는 사실이 아니다", () => {
    expect(buildDayRecap({ date: "2026-08-18", slots: [] }).totals.inputRate).toBeNull();
  });

  it("통째로 비어 있는 반은 반 단위 한 줄로 접고 학생 수는 중복을 뺀다", () => {
    const recap = buildDayRecap({
      date: "2026-08-18",
      slots: ["16:20", "17:20"].map((t) =>
        slot({
          slotStart: t,
          hasAnyRecord: false,
          students: [student({ status: null }), student({ studentId: "s2", status: null })],
        }),
      ),
    });
    expect(recap.unmarked).toHaveLength(1);
    expect(recap.unmarked[0]!.expected).toBe(2);
    expect(recap.unmarked[0]!.slots).toEqual(["16:20", "17:20"]);
    expect(recap.totals.unmarkedClasses).toBe(1);
    expect(recap.totals.unmarkedStudents).toBe(2);
    expect(recap.teachers[0]!.unmarkedClasses).toBe(1);
  });

  it("미조치 결석이 먼저, 그다음 반복 결석이 많은 순", () => {
    const recap = buildDayRecap({
      date: "2026-08-18",
      slots: [
        slot({ classId: "c1", students: [student({ studentId: "done", status: "absent" })] }),
        slot({ classId: "c2", students: [student({ studentId: "few", status: "absent" })] }),
        slot({ classId: "c3", students: [student({ studentId: "many", status: "absent" })] }),
      ],
      followupOf: (id) => (id === "done" ? { state: "resolved", outcome: "contacted", handledByName: "데스크" } : null),
      recentAbsenceOf: (id) => (id === "many" ? 4 : id === "few" ? 2 : null),
    });
    expect(recap.absences.map((a) => a.studentId)).toEqual(["many", "few", "done"]);
    expect(recap.totals.absentPending).toBe(2);
  });

  it("접힌 교시 중 **뒤 교시**에 조치가 남아 있어도 '처리함'으로 읽는다", () => {
    // 데스크가 2교시 건을 처리했는데 첫 교시로만 찾으면 요약이 "조치 미완료"라고 거짓말한다.
    const recap = buildDayRecap({
      date: "2026-08-18",
      slots: ["16:20", "17:20"].map((t) =>
        slot({ subject: "english", slotStart: t, saveSlot: t, students: [student({ status: "absent" })] }),
      ),
      followupOf: (_id, saveSlot) =>
        saveSlot === "17:20" ? { state: "resolved", outcome: "contacted", handledByName: "데스크" } : null,
    });
    expect(recap.absences[0]!.settled).toBe(true);
    expect(recap.totals.absentPending).toBe(0);
  });

  it("사유 메모가 한 교시에만 있으면 접힌 건에 남는다", () => {
    const recap = buildDayRecap({
      date: "2026-08-18",
      slots: [
        slot({ slotStart: "16:20", saveSlot: "16:20", students: [student({ status: "absent" })] }),
        slot({
          slotStart: "17:20",
          saveSlot: "17:20",
          students: [student({ status: "absent", note: "감기로 결석" })],
        }),
      ],
    });
    expect(recap.absences[0]!.note).toBe("감기로 결석");
  });

  it("출석도 (학생·반) 단위로 접어 센다", () => {
    const recap = buildDayRecap({
      date: "2026-08-18",
      slots: ["16:20", "17:20"].map((t) => slot({ slotStart: t, students: [student({ status: "present" })] })),
    });
    expect(recap.totals.present).toBe(1);
    expect(recap.totals.recorded).toBe(2); // 칸은 2
  });

  it("입력이 덜 된 강사가 먼저 온다", () => {
    const recap = buildDayRecap({
      date: "2026-08-18",
      slots: [
        slot({ teacherName: "다찍음", students: [student({ status: "present" })] }),
        slot({
          classId: "c2",
          teacherName: "덜찍음",
          hasAnyRecord: false,
          students: [student({ status: null }), student({ studentId: "s2", status: null })],
        }),
      ],
    });
    expect(recap.teachers[0]!.teacherName).toBe("덜찍음");
  });
});
