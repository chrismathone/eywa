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

  it("출석부는 열렸는데 남은 빈 칸을 반·교시·학생까지 담는다", () => {
    // 원장 제보 2026-08-20: 유형숙(40칸 중 38칸)처럼 **학생 한 명만** 빈 출석부가 실제로 흔하다.
    const recap = buildDayRecap({
      date: "2026-08-19",
      slots: ["18:20", "19:15"].map((t) =>
        slot({
          classId: "jj3l",
          className: "중등M 개별 JJ3L",
          slotStart: t,
          saveSlot: t,
          teacherName: "유형숙",
          students: [
            student({ studentId: "a", studentName: "김하늘", status: "present" }),
            student({ studentId: "b", studentName: "이주영A", status: null }),
          ],
        }),
      ),
    });
    expect(recap.partial).toHaveLength(1);
    const row = recap.partial[0]!;
    expect(row.className).toBe("중등M 개별 JJ3L");
    expect(row.teacherLine).toBe("유형숙");
    expect(row.cells).toBe(2);
    expect(row.slots.map((s) => s.start)).toEqual(["18:20", "19:15"]);
    expect(row.slots[0]!.students.map((s) => s.studentName)).toEqual(["이주영A"]);
    expect(recap.teachers[0]!.partialCells).toBe(2);
  });

  it("통째로 비어 있는 슬롯은 partial에 안 들어간다(통째 미입력과 겹쳐 세지 않는다)", () => {
    const recap = buildDayRecap({
      date: "2026-08-19",
      slots: [
        slot({
          classId: "empty",
          hasAnyRecord: false,
          students: [student({ status: null }), student({ studentId: "s2", status: null })],
        }),
      ],
    });
    expect(recap.partial).toEqual([]);
    expect(recap.teachers[0]!.partialCells).toBe(0);
    expect(recap.unmarked).toHaveLength(1);
  });

  it("같은 반이라도 교시마다 담당이 갈리면 각자 자기 교시만 나온다", () => {
    // 실측 2026-08-19 `중등E_초등 브릿지 A` — 14:20·16:20은 KRISTINE, 15:00은 추민아.
    const recap = buildDayRecap({
      date: "2026-08-19",
      slots: [
        slot({
          classId: "bridge",
          className: "중등E_초등 브릿지 A",
          subject: "english",
          slotStart: "14:20",
          saveSlot: "14:20",
          teacherName: "KRISTINE DRIVER",
          students: [student({ studentId: "k1", studentName: "김준영", status: null })],
        }),
        slot({
          classId: "bridge",
          className: "중등E_초등 브릿지 A",
          subject: "english",
          slotStart: "15:00",
          saveSlot: "15:00",
          teacherName: "추민아",
          students: [student({ studentId: "k2", studentName: "김윤호", status: null })],
        }),
      ],
    });
    expect(recap.partial).toHaveLength(2);
    const kristine = recap.partial.find((p) => p.teacherLine === "KRISTINE DRIVER")!;
    const chu = recap.partial.find((p) => p.teacherLine === "추민아")!;
    expect(kristine.slots.map((s) => s.start)).toEqual(["14:20"]);
    expect(chu.slots.map((s) => s.start)).toEqual(["15:00"]);
    // 🔴 여기가 무너지면 "KRISTINE 줄을 폈는데 추민아가 안 찍은 교시가 보인다"가 된다.
    expect(kristine.slots[0]!.students.map((s) => s.studentName)).toEqual(["김준영"]);
    expect(chu.slots[0]!.students.map((s) => s.studentName)).toEqual(["김윤호"]);
  });

  it("빈 칸 목록은 교시 오름차순·이름 한국어 정렬, 목록은 빈 칸 많은 순", () => {
    const recap = buildDayRecap({
      date: "2026-08-19",
      slots: [
        slot({
          classId: "few",
          className: "하나 반",
          slotStart: "17:20",
          students: [student({ studentId: "x", studentName: "가학생", status: null })],
        }),
        slot({
          classId: "many",
          className: "둘 반",
          slotStart: "16:20",
          students: [
            student({ studentId: "m2", studentName: "장윤진", status: null }),
            student({ studentId: "m1", studentName: "박창현", status: null }),
          ],
        }),
        slot({
          classId: "many",
          className: "둘 반",
          slotStart: "15:00",
          students: [student({ studentId: "m3", studentName: "전주율", status: null })],
        }),
      ],
    });
    expect(recap.partial.map((p) => p.classId)).toEqual(["many", "few"]);
    expect(recap.partial[0]!.slots.map((s) => s.start)).toEqual(["15:00", "16:20"]);
    expect(recap.partial[0]!.slots[1]!.students.map((s) => s.studentName)).toEqual(["박창현", "장윤진"]);
  });

  it("🔴 불변식: 빈 칸 합 + 통째 미입력 칸 합 = 전체 칸 − 입력된 칸", () => {
    const slots = [
      // 통째 미입력(2교시 × 2명 = 4칸).
      ...["16:20", "17:20"].map((t) =>
        slot({
          classId: "empty",
          slotStart: t,
          hasAnyRecord: false,
          students: [student({ studentId: "e1", status: null }), student({ studentId: "e2", status: null })],
        }),
      ),
      // 일부만 찍힌 반(2칸 중 1칸 빔).
      slot({
        classId: "half",
        teacherName: "추민아",
        students: [
          student({ studentId: "h1", status: "present" }),
          student({ studentId: "h2", studentName: "김윤호", status: null }),
        ],
      }),
      // 다 찍힌 반.
      slot({ classId: "full", teacherName: "다찍음", students: [student({ status: "absent" })] }),
    ];
    const recap = buildDayRecap({ date: "2026-08-19", slots });
    const partialCells = recap.partial.reduce((n, p) => n + p.cells, 0);
    // 통째 미입력 슬롯의 칸은 partial이 안 담으므로 입력에서 직접 센다(두 곳 합이 미입력 전부여야 한다).
    const unmarkedCells = slots
      .filter((s) => !s.hasAnyRecord)
      .reduce((n, s) => n + s.students.filter((x) => x.status == null).length, 0);
    expect(partialCells + unmarkedCells).toBe(recap.totals.cells - recap.totals.recorded);
    // 강사 줄의 합도 같은 값이다(줄과 목록이 같은 순회에서 나온다).
    expect(recap.teachers.reduce((n, t) => n + t.partialCells, 0)).toBe(partialCells);
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
