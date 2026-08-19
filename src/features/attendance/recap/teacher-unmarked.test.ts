/**
 * 강사 줄 → 미입력 반 파생. **줄의 숫자와 펼친 목록이 같다**는 성질이 이 파일의 핵심이다.
 * (숫자가 어긋나면 "3반이라며 왜 2개만 뜨지"가 되고, 그 순간 이 화면은 더 이상 근거가 아니다.)
 */
import { describe, expect, it } from "vitest";
import { buildDayRecap, type RecapSlotInput } from "./digest";
import { buildRangeRecap, type RecapDay } from "./range";
import { countUnmarkedByTeacher, unmarkedByTeacher } from "./teacher-unmarked";

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

  it("담당 미지정·자리(LAB·JJ)도 같은 규칙으로 뜬다 — 표시는 자리, 축은 담당 미지정", () => {
    const d = day("2026-08-21", [
      slot({ classId: "lab", className: "LT3", teacherName: "담당 미지정", slotTeacherLabel: "LAB" }),
      slot({ classId: "jj", className: "LS2", teacherName: "담당 미지정", slotTeacherLabel: "JJ" }),
      slot({ classId: "c9", className: "중2 A", teacherName: "담당 미지정", slotTeacherLabel: null }),
    ]);
    const got = unmarkedByTeacher([d], "담당 미지정");
    // 순서는 digest(학생 수·반 이름)가 정한다 — 여기서 다시 정렬하지 않는다.
    expect(got[0].classes.map((c) => c.classId).sort()).toEqual(["c9", "jj", "lab"]);
    // 표시(누구에게 말하나)는 자리 이름 그대로 — 축과 섞이지 않는다.
    const lab = got[0].classes.find((c) => c.classId === "lab")!;
    expect(lab.teacherNames).toEqual(["LAB"]);
    expect(lab.teacherLines).toEqual(["담당 미지정"]);
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
        // 자리 반.
        slot({ classId: "lab", teacherName: "담당 미지정", slotTeacherLabel: "LAB" }),
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
