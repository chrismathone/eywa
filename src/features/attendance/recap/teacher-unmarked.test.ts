/**
 * 강사 줄 → 미입력 반 파생. **줄의 숫자와 펼친 목록이 같다**는 성질이 이 파일의 핵심이다.
 * (숫자가 어긋나면 "3반이라며 왜 2개만 뜨지"가 되고, 그 순간 이 화면은 더 이상 근거가 아니다.)
 */
import { describe, expect, it } from "vitest";
import { buildDayRecap, type RecapSlotInput } from "./digest";
import { buildRangeRecap, type RecapDay } from "./range";
import {
  countPartialCellsByTeacher,
  countUnmarkedByTeacher,
  partialByTeacher,
  unmarkedByTeacher,
} from "./teacher-unmarked";

function slot(over: Partial<RecapSlotInput> & Pick<RecapSlotInput, "classId">): RecapSlotInput {
  return {
    className: `반 ${over.classId}`,
    subject: "english",
    slotStart: "16:20",
    saveSlot: "16:20",
    teacherName: "김강사",
    slotTeacherLabel: null,
    hasAnyRecord: false,
    students: [{ studentId: "s1", studentName: "이학생", schoolGrade: null, status: null, note: null }],
    ...over,
  };
}

function day(date: string, slots: RecapSlotInput[]): RecapDay {
  return { ...buildDayRecap({ date, slots }), holiday: null };
}

describe("unmarkedByTeacher", () => {
  it("여러 날에 걸친 미입력을 날짜별로 모은다(날짜 오름차순, 빈 날은 빠진다)", () => {
    const days = [
      day("2026-08-22", [slot({ classId: "c2" })]),
      day("2026-08-21", [slot({ classId: "c1" }), slot({ classId: "c9", hasAnyRecord: true })]),
    ];
    const got = unmarkedByTeacher(days, "김강사");
    expect(got.map((d) => d.date)).toEqual(["2026-08-21", "2026-08-22"]);
    expect(got[0].classes.map((c) => c.classId)).toEqual(["c1"]);
    expect(got[1].classes.map((c) => c.classId)).toEqual(["c2"]);
  });

  it("같은 반의 여러 교시는 한 줄이고 교시는 함께 적힌다(영어는 하루 2~4교시가 흔하다)", () => {
    const d = day("2026-08-21", [
      slot({ classId: "c1", slotStart: "16:20", saveSlot: "16:20" }),
      slot({ classId: "c1", slotStart: "17:20", saveSlot: "17:20" }),
      slot({ classId: "c1", slotStart: "18:20", saveSlot: "18:20" }),
    ]);
    const got = unmarkedByTeacher([d], "김강사");
    expect(got[0].classes).toHaveLength(1);
    expect(got[0].classes[0].slots).toEqual(["16:20", "17:20", "18:20"]);
  });

  it("담당이 교시마다 갈리는 반은 두 강사 줄에 모두 뜬다", () => {
    const d = day("2026-08-21", [
      slot({ classId: "c1", slotStart: "16:20", teacherName: "김강사" }),
      slot({ classId: "c1", slotStart: "17:20", teacherName: "최강사" }),
    ]);
    expect(unmarkedByTeacher([d], "김강사")[0].classes[0].classId).toBe("c1");
    expect(unmarkedByTeacher([d], "최강사")[0].classes[0].classId).toBe("c1");
  });

  it("자리(LAB·JJ)는 각자 제 줄로 가고 `담당 미지정`엔 자리 아닌 반만 남는다", () => {
    // 보드가 자리 슬롯을 방 이름으로 묶는다(teacher-group.ts, 원장 2026-08-20
    // *"담당미지정으로 나오게하지말고, lAB이면 lAB, JJ면 JJ"*) → 줄 이름이 곧 자리 이름이다.
    const d = day("2026-08-21", [
      slot({ classId: "lab", className: "LT3", teacherName: "LAB", slotTeacherLabel: "LAB" }),
      slot({ classId: "jj", className: "LS2", teacherName: "JJ", slotTeacherLabel: "JJ" }),
      slot({ classId: "c9", className: "중2 A", teacherName: "담당 미지정", slotTeacherLabel: null }),
    ]);
    // 🔴 LAB과 JJ는 서로 다른 방이라 절대 한 줄로 합치지 않는다(같은 시각에 동시에 돌아간다).
    expect(unmarkedByTeacher([d], "LAB")[0].classes.map((c) => c.classId)).toEqual(["lab"]);
    expect(unmarkedByTeacher([d], "JJ")[0].classes.map((c) => c.classId)).toEqual(["jj"]);
    // `담당 미지정`은 자리도 아니고 담당·담임도 없는 반에만 남는다(수학 담임 공석 반).
    expect(unmarkedByTeacher([d], "담당 미지정")[0].classes.map((c) => c.classId)).toEqual(["c9"]);
    const lab = unmarkedByTeacher([d], "LAB")[0].classes[0];
    expect(lab.teacherNames).toEqual(["LAB"]);
    expect(lab.teacherLines).toEqual(["LAB"]);
  });

  it("영어 닉네임 라벨(teacher_id + Jane)이 붙어도 담당 계정 이름으로 뜬다", () => {
    // 실측: 살아 있는 슬롯 194개가 담당 계정과 시트 닉네임을 함께 들고 있다.
    const d = day("2026-08-21", [
      slot({ classId: "dp6", className: "DP6", teacherName: "이현이", slotTeacherLabel: "Hannah" }),
    ]);
    expect(unmarkedByTeacher([d], "이현이")[0].classes[0].className).toBe("DP6");
    // 화면 표시는 시트 닉네임 그대로(기존 규약) — 그래서 표시로 고르면 안 된다.
    expect(unmarkedByTeacher([d], "Hannah")).toEqual([]);
  });

  it("🔴 펼친 목록의 반 수 = 강사 줄의 미입력 N반 (하루·기간 모두)", () => {
    const days = [
      day("2026-08-21", [
        // 영어: 같은 반 3교시가 통째로 비었고 담당이 갈린다.
        slot({ classId: "dp6", teacherName: "이현이", slotTeacherLabel: "Hannah", slotStart: "16:20" }),
        slot({ classId: "dp6", teacherName: "박강사", slotTeacherLabel: "Jane", slotStart: "17:20" }),
        // 자리 반 — 줄 이름이 방 이름이다(사람 줄에 섞이지 않는다).
        slot({ classId: "lab", teacherName: "LAB", slotTeacherLabel: "LAB" }),
        // 일부만 찍힌 반(미입력 아님) — 강사 줄엔 남지만 목록엔 안 뜬다.
        slot({
          classId: "c9",
          teacherName: "이현이",
          hasAnyRecord: true,
          students: [
            { studentId: "a", studentName: "가", schoolGrade: null, status: "present", note: null },
            { studentId: "b", studentName: "나", schoolGrade: null, status: null, note: null },
          ],
        }),
      ]),
      day("2026-08-22", [
        slot({ classId: "dp6", teacherName: "이현이", slotTeacherLabel: "Hannah" }),
        slot({ classId: "lt3", teacherName: "이현이", slotTeacherLabel: "Hannah" }),
      ]),
    ];
    const range = buildRangeRecap(days);
    expect(range.teachers.length).toBeGreaterThan(0);
    for (const line of range.teachers) {
      expect(countUnmarkedByTeacher(range.days, line.teacherName)).toBe(line.unmarkedClasses);
    }
    // 값이 0인 항등식만 도는 일이 없게 — 실제로 세고 있는지 못 박는다.
    const hyeoni = range.teachers.find((t) => t.teacherName === "이현이");
    expect(hyeoni?.unmarkedClasses).toBe(3); // 21일 dp6 + 22일 dp6·lt3
    // 하루 단위로도 같다(줄이 하루짜리 요약일 때).
    for (const d of range.days) {
      for (const line of d.teachers) {
        expect(countUnmarkedByTeacher([d], line.teacherName)).toBe(line.unmarkedClasses);
      }
    }
  });
});

/** 출석부를 열어 놓고 남긴 빈 칸 — 반 단위 미입력이 표현하지 못하던 자리(원장 제보 2026-08-20). */
function marked(over: Partial<RecapSlotInput> & Pick<RecapSlotInput, "classId">): RecapSlotInput {
  return slot({ hasAnyRecord: true, ...over });
}

describe("partialByTeacher", () => {
  it("빈 칸이 남은 반을 날짜별로 모은다(날짜 오름차순, 빈 날은 빠진다)", () => {
    const days = [
      day("2026-08-20", [
        marked({
          classId: "c2",
          students: [{ studentId: "s1", studentName: "이학생", schoolGrade: null, status: null, note: null }],
        }),
      ]),
      day("2026-08-19", [
        marked({
          classId: "c1",
          students: [
            { studentId: "s1", studentName: "이학생", schoolGrade: null, status: "present", note: null },
            { studentId: "s2", studentName: "박학생", schoolGrade: null, status: null, note: null },
          ],
        }),
        // 다 찍힌 반은 목록에 없다.
        marked({
          classId: "c9",
          students: [{ studentId: "s3", studentName: "정학생", schoolGrade: null, status: "absent", note: null }],
        }),
      ]),
    ];
    const got = partialByTeacher(days, "김강사");
    expect(got.map((d) => d.date)).toEqual(["2026-08-19", "2026-08-20"]);
    expect(got[0].classes.map((c) => c.classId)).toEqual(["c1"]);
    expect(got[0].classes[0].slots[0].students.map((s) => s.studentName)).toEqual(["박학생"]);
  });

  it("자리(LAB·JJ)의 빈 칸은 그 자리 줄로 간다 — LAB과 JJ는 서로 다른 줄", () => {
    const d = day("2026-08-19", [
      marked({
        classId: "lab",
        className: "LT3",
        teacherName: "LAB",
        slotTeacherLabel: "LAB",
        students: [
          { studentId: "a", studentName: "가학생", schoolGrade: null, status: "present", note: null },
          { studentId: "b", studentName: "나학생", schoolGrade: null, status: null, note: null },
        ],
      }),
      marked({
        classId: "jj",
        className: "LS2",
        teacherName: "JJ",
        slotTeacherLabel: "JJ",
        students: [{ studentId: "c", studentName: "다학생", schoolGrade: null, status: null, note: null }],
      }),
    ]);
    const got = partialByTeacher([d], "LAB");
    expect(got[0].classes.map((c) => c.className)).toEqual(["LT3"]);
    expect(got[0].classes[0].teacherNames).toEqual(["LAB"]);
    // 🔴 방이 다르므로 JJ의 빈 칸이 LAB 줄에 섞이지 않는다.
    expect(partialByTeacher([d], "JJ")[0].classes.map((c) => c.className)).toEqual(["LS2"]);
    // 자리가 갈렸으니 `담당 미지정` 줄엔 아무것도 남지 않는다.
    expect(partialByTeacher([d], "담당 미지정")).toEqual([]);
  });

  it("🔴 표시(시트 닉네임)로는 안 걸린다 — 고르는 축은 담당 계정 이름이다", () => {
    // 자리에서는 표시와 축이 같아졌지만(LAB=LAB), 영어 닉네임 슬롯에선 여전히 갈린다.
    // 실측 2026-08-19: 살아 있는 슬롯 194개가 teacher_id + 시트 닉네임을 함께 들고 있다.
    const d = day("2026-08-19", [
      marked({
        classId: "dp6",
        className: "DP6",
        teacherName: "이현이",
        slotTeacherLabel: "Hannah",
        students: [
          { studentId: "a", studentName: "가학생", schoolGrade: null, status: "present", note: null },
          { studentId: "b", studentName: "나학생", schoolGrade: null, status: null, note: null },
        ],
      }),
    ]);
    // 표시로 고르면 "빈 칸 N개"인데 펼치면 0건이 된다.
    expect(partialByTeacher([d], "Hannah")).toEqual([]);
    const got = partialByTeacher([d], "이현이");
    expect(got[0].classes[0].className).toBe("DP6");
    // 표시(누구에게 말하나)는 시트 닉네임 그대로 — 두 배열의 뜻을 섞지 말 것.
    expect(got[0].classes[0].teacherNames).toEqual(["Hannah"]);
  });

  it("🔴 펼친 빈 칸 수 = 강사 줄의 빈 칸 N개 (하루·기간 모두)", () => {
    const days = [
      day("2026-08-19", [
        // 같은 반인데 교시마다 담당이 갈린다(실측 브릿지 A 형태).
        marked({
          classId: "bridge",
          className: "중등E_초등 브릿지 A",
          slotStart: "14:20",
          teacherName: "KRISTINE DRIVER",
          slotTeacherLabel: "Kristine",
          students: [
            { studentId: "k1", studentName: "김준영", schoolGrade: null, status: null, note: null },
            { studentId: "k2", studentName: "박창현", schoolGrade: null, status: "present", note: null },
          ],
        }),
        marked({
          classId: "bridge",
          className: "중등E_초등 브릿지 A",
          slotStart: "15:00",
          teacherName: "추민아",
          students: [{ studentId: "k3", studentName: "김윤호", schoolGrade: null, status: null, note: null }],
        }),
        // 통째 미입력은 빈 칸이 아니라 반 단위로 센다(겹쳐 세면 불변식이 깨진다).
        slot({ classId: "empty", teacherName: "추민아" }),
      ]),
      day("2026-08-20", [
        marked({
          classId: "jj3l",
          teacherName: "유형숙",
          students: [{ studentId: "j1", studentName: "이주영A", schoolGrade: null, status: null, note: null }],
        }),
      ]),
    ];
    const range = buildRangeRecap(days);
    for (const line of range.teachers) {
      expect(countPartialCellsByTeacher(range.days, line.teacherName)).toBe(line.partialCells);
    }
    // 항등식만 도는 일이 없게 — 실제로 세고 있는지 못 박는다.
    expect(range.teachers.find((t) => t.teacherName === "KRISTINE DRIVER")?.partialCells).toBe(1);
    expect(range.teachers.find((t) => t.teacherName === "추민아")?.partialCells).toBe(1);
    expect(range.teachers.find((t) => t.teacherName === "유형숙")?.partialCells).toBe(1);
    for (const d of range.days) {
      for (const line of d.teachers) {
        expect(countPartialCellsByTeacher([d], line.teacherName)).toBe(line.partialCells);
      }
    }
  });
});
