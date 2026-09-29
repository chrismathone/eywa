import { describe, expect, it } from "vitest";
import { DEFAULT_VIDEO_HOMEWORK_POLICY, isVideoHomeworkEnabled } from "./policy";

describe("영상 제출 검사 대상", () => {
  it("기존 학원은 기본적으로 모든 학생을 검사할 수 있다", () => {
    expect(isVideoHomeworkEnabled(DEFAULT_VIDEO_HOMEWORK_POLICY,
      { classId: "class-a", subjectKey: "english", grade: "고1" })).toBe(true);
  });

  it("과목·실제 학교급·반 중 하나라도 꺼지면 새 검사를 막는다", () => {
    const policy = { enabled: true, disabledSubjectKeys: ["english"],
      disabledSchoolLevels: ["high" as const], disabledClassIds: ["class-off"] };
    expect(isVideoHomeworkEnabled(policy, { classId: "class-a", subjectKey: "english", grade: "중1" })).toBe(false);
    expect(isVideoHomeworkEnabled(policy, { classId: "class-a", subjectKey: "math", grade: "고1" })).toBe(false);
    expect(isVideoHomeworkEnabled(policy, { classId: "class-off", subjectKey: "math", grade: "중1" })).toBe(false);
    expect(isVideoHomeworkEnabled(policy, { classId: "class-a", subjectKey: "math", grade: "중1" })).toBe(true);
  });
});
