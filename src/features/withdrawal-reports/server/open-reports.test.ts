import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
import { withOpenReports } from "./open-reports";
import { snapshotMatches, type CourseSnapshot, type StudentSnapshot } from "../model";

const course = (id: string, subject: string): CourseSnapshot => ({ id, classId: `c-${id}`, className: `${subject}반`, subject, teacherId: "t", teacherName: "선생님", startDate: "2026-01-01", endDate: null, onHold: false });
const student = { id: "s", name: "김소은", school: null, grade: null, courses: [course("m", "math"), course("e", "english")] };

describe("withOpenReports — 과목이 다르면 따로 요청한다(s2_0014)", () => {
  it("진행 중인 보고서가 없으면 그대로", () => {
    expect(withOpenReports(student, undefined)).toBe(student);
  });
  it("영어 보고서가 진행 중이면 수학 반만 고르고 영어 반은 busyCourses로", () => {
    const got = withOpenReports(student, { subjects: new Set(["english"]), all: false });
    expect(got?.courses.map(c => c.id)).toEqual(["m"]);
    expect(got?.busyCourses?.map(c => c.id)).toEqual(["e"]);
  });
  it("모든 과목이 진행 중이거나 학생 전체(퇴원 묶음·옛 단건)가 진행 중이면 고를 수 없다", () => {
    expect(withOpenReports(student, { subjects: new Set(["english", "math"]), all: false })).toBeNull();
    expect(withOpenReports(student, { subjects: new Set(), all: true })).toBeNull();
  });
  it("다니는 반이 없는 학생(바로 처리 퇴원)은 진행 중인 보고서가 있으면 뺀다", () => {
    expect(withOpenReports({ ...student, courses: [] }, { subjects: new Set(["english"]), all: false })).toBeNull();
  });
});

describe("snapshotMatches — 과목 수강종료 묶음은 자기 과목만 대조", () => {
  const snap = (courses: CourseSnapshot[]): StudentSnapshot => ({ name: "김소은", school: null, grade: null, enrolledAt: null, status: "enrolled", withdrawnAt: null, courses });
  const before = snap([course("m", "math"), course("e", "english")]);
  const englishClosed = snap([course("m", "math")]);
  it("영어가 먼저 닫혀도 수학 보고서는 바뀐 것이 아니다", () => {
    expect(snapshotMatches(before, englishClosed, ["math"])).toBe(true);
  });
  it("과목을 안 주면(퇴원 묶음) 학생 전체를 대조한다", () => {
    expect(snapshotMatches(before, englishClosed)).toBe(false);
  });
  it("자기 과목의 수강이 바뀌면 바뀐 것이다", () => {
    expect(snapshotMatches(before, snap([{ ...course("m", "math"), teacherId: "x" }, course("e", "english")]), ["math"])).toBe(false);
  });
});
