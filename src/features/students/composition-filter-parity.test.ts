/**
 * **막대 숫자 = 열린 원생목록 건수**(원장 2026-09-28) — 운영실 '재원생 구성' 막대와 원생목록 필터(`level=`·`mix=`·
 * 수강 과목 '미수강')가 **같은 함수**에서 숫자를 뽑는지 잠근다. 막대는 `levelSubjectSplit`·`summarizePrograms`,
 * 목록은 `compositionStudentIds`·`activeStudentIds`인데 — 같은 재료를 넣으면 조각마다 같은 수가 나와야 한다.
 */
import { describe, expect, it } from "vitest";
import {
  activeStudentIds,
  compositionStudentIds,
  composeEnrolled,
  summarizePrograms,
  type ActiveEnrollmentRow,
} from "./enrolled-composition";
import { levelSubjectSplit } from "@/features/dashboard/overview/student-composition";
import { STUDENT_LEVELS, levelKeyOfLabel, studentLevelOf, type StudentLevel } from "./list-filter-values";

const SUBJECTS = [
  { key: "math", label: "수학" },
  { key: "english", label: "영어" },
  { key: "subject_1", label: "수학(심화)" },
  { key: "science", label: "과학" },
];
const TODAY = "2026-09-28";
let seq = 0;
const enr = (
  studentId: string,
  subject: string,
  opts: { track?: string | null; start?: string | null } = {},
): ActiveEnrollmentRow => {
  seq += 1;
  return {
    id: `e${seq}`,
    student_id: studentId,
    start_date: opts.start ?? null,
    class: { subject, english_track: opts.track ?? null },
  };
};

// 초등·중등·고등·미취학·미입력 × 영어만·동시·수학만·기타 과목·미수강 · 시작 전 · 과목 미상 반을 섞는다.
const students = [
  { id: "a", grade: "초4", school: null }, // 영어(EiE)+수학 = 동시
  { id: "b", grade: "초5", school: null }, // 영어만
  { id: "c", grade: "중1", school: null }, // 수학(심화)만 = 수학만
  { id: "d", grade: "중2", school: null }, // 과학만 = 기타 과목
  { id: "e", grade: "중3", school: null }, // 수강 없음 = 미수강
  { id: "f", grade: "고1", school: null }, // 수학(시작) + 영어(10월 시작) = 오늘은 수학만
  { id: "g", grade: "고2", school: null }, // 전부 10월 시작 = 실시간 재원생에서 빠진다
  { id: "h", grade: "6세", school: null }, // 미취학 영어만
  { id: "i", grade: null, school: null }, // 미입력 · 수학만
  { id: "j", grade: " 중1 ", school: null }, // 공백 섞인 학년도 같은 학교급
];
const rows = [
  enr("a", "english", { track: "eie" }),
  enr("a", "math"),
  enr("b", "english"),
  enr("c", "subject_1"),
  enr("d", "science"),
  enr("f", "math", { start: "2026-09-01" }),
  enr("f", "english", { start: "2026-10-01" }),
  enr("g", "math", { start: "2026-10-06" }),
  enr("h", "english"),
  enr("i", "math"),
  enr("j", "english"),
  enr("j", "math"),
];

function card(scope: { studentIds: string[]; subjects: string[] } | null) {
  const composition = composeEnrolled({ students, rows, scope, subjects: SUBJECTS, today: TODAY });
  const split = levelSubjectSplit(composition.students, composition.programs);
  return { composition, split };
}

describe("재원생 구성 막대 ↔ 원생목록 필터 = 같은 수", () => {
  for (const scope of [null, { studentIds: ["a", "b", "c", "d", "e", "j"], subjects: ["math"] }]) {
    const label = scope ? "강사 스코프(수학 축)" : "학원 전체";
    it(`${label} — 학교급 × 조각마다 막대 숫자 = compositionStudentIds 크기`, () => {
      const { composition, split } = card(scope);
      for (const row of split.rows) {
        const level = levelKeyOfLabel(row.label) as StudentLevel;
        expect(level).not.toBeNull();
        for (const mix of ["englishOnly", "both", "mathOnly"] as const) {
          expect(compositionStudentIds(composition, { levels: [level], mixes: [mix] }).size).toBe(row[mix]);
        }
        // 줄 전체(이름·숫자) = 세 조각 합.
        expect(
          compositionStudentIds(composition, { levels: [level], mixes: ["englishOnly", "both", "mathOnly"] }).size,
        ).toBe(row.englishOnly + row.both + row.mathOnly);
      }
    });

    it(`${label} — '미수강' 막대 = activeStudentIds 여집합 · '기타 과목' = mix=other`, () => {
      const { composition, split } = card(scope);
      const noEnrollment = summarizePrograms(
        composition.students.map((s) => s.id),
        composition.programs,
        composition.active,
      ).noEnrollment;
      // 목록: 재원생 명단(시작 전 학생·스코프 밖은 이미 빠짐)에서 activeStudentIds에 없는 학생.
      const active = activeStudentIds(rows, scope, TODAY);
      const listed = composition.students.filter((s) => !active.has(s.id));
      expect(listed.length).toBe(noEnrollment);
      const otherOnly = split.rows.reduce((sum, row) => sum + row.neither, 0) - noEnrollment;
      expect(compositionStudentIds(composition, { levels: [], mixes: ["other"] }).size).toBe(otherOnly);
    });
  }

  it("학원 전체 기준 실제 값 — 미수강은 e 한 명(g는 시작 전이라 재원생 밖), 기타 과목은 d", () => {
    const { composition } = card(null);
    const active = activeStudentIds(rows, null, TODAY);
    expect(composition.students.filter((s) => !active.has(s.id)).map((s) => s.id)).toEqual(["e"]);
    expect([...compositionStudentIds(composition, { levels: [], mixes: ["other"] })]).toEqual(["d"]);
    expect([...compositionStudentIds(composition, { levels: ["middle"], mixes: ["mathOnly"] })]).toEqual(["c"]);
    expect([...compositionStudentIds(composition, { levels: ["middle"], mixes: ["both"] })]).toEqual(["j"]);
    expect([...compositionStudentIds(composition, { levels: ["high"], mixes: ["mathOnly"] })]).toEqual(["f"]);
  });

  it("학교급 분류는 막대 줄 이름과 한 벌이다", () => {
    expect(STUDENT_LEVELS.map((l) => l.label)).toEqual(["초등", "중등", "고등", "미취학", "기타·미입력"]);
    expect(studentLevelOf("초4")).toBe("elem");
    expect(studentLevelOf(" 중1 ")).toBe("middle");
    expect(studentLevelOf("6세")).toBe("preschool");
    expect(studentLevelOf(null)).toBe("etc");
  });
});
