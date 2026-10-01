import { describe, expect, it } from "vitest";
import { videoFilename, videoSchoolGrade } from "./video-filename.mjs";
import { schoolGradeLabel } from "../../src/lib/format/school-grade.ts";
const route = { studentId: "student", studentName: "류태경", classId: "class", className: "LT4", school: "칠성초", grade: "초3" };
describe("영상 표시 파일명", () => {
  it("에이와 학생·반·학교학년과 원본의 한국 날짜를 사용한다", () => {
    expect(videoFilename({ boardName: "클래스노트 다른 반", postedAt: "2026-09-29T23:30:00Z" }, route)).toBe("류태경_LT4_칠성초3_2026-09-30.mp4");
  });
  it("반을 못 정하면 반미정, 학생 연결이 없으면 미연결 + 보드 이름으로 올린다(없는 값을 지어내지 않는다)", () => {
    expect(videoFilename({ postedAt: "2026-09-30" }, { ...route, classId: null })).toBe("류태경_반미정_칠성초3_2026-09-30.mp4");
    expect(videoFilename({ postedAt: "2026-09-30" }, { ...route, classId: null, className: null })).toBe("류태경_반미정_칠성초3_2026-09-30.mp4");
    expect(videoFilename({ postedAt: "2026-09-30", boardName: "(수학)류태경" }, { studentId: null, studentName: null, classId: null, className: null, school: "칠성초", grade: "초3" }))
      .toBe("미연결 (수학)류태경_반미정_학교학년미등록_2026-09-30.mp4");
    expect(videoFilename({ postedAt: "2026-09-30" }, { studentId: null })).toBe("미연결_반미정_학교학년미등록_2026-09-30.mp4");
  });
  it("원본 날짜가 없으면 이름을 짓지 않는다", () => {
    expect(() => videoFilename({}, route)).toThrow("날짜");
  });
  it("경로 구분자와 파일명 필드 구분자를 정리하며 학교 표기는 앱과 일치한다", () => {
    expect(videoFilename({ postedAt: "2026-09-30" }, { ...route, className: 'A/B_C:반' })).toContain("_A B C 반_");
    for (const [school, grade] of [["칠성초", "초3"], ["경명여중", "중1"], ["Ing유치원", "7세"], [null, "초2"], ["칠성초", null]])
      expect(videoSchoolGrade(school, grade)).toBe(schoolGradeLabel(school, grade));
  });
});
