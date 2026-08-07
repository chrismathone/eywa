import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEACHER_HOME,
  ENGLISH_TEACHER_HOME,
  teacherHomeFromAssistantClasses,
  teacherHomeFromClassSubjects,
} from "./teacher-home-rule";

describe("강사뷰 홈 규칙 — 담당 반 과목", () => {
  it("영어만 담당하면 ECS", () => {
    expect(teacherHomeFromClassSubjects(["english"])).toBe(ENGLISH_TEACHER_HOME);
  });

  it("수학 전담은 원스크린", () => {
    expect(teacherHomeFromClassSubjects(["math"])).toBe(DEFAULT_TEACHER_HOME);
  });

  it("겸업(영어+수학)은 원스크린 — 수학 반 보고서 마감을 잃으면 안 된다", () => {
    expect(teacherHomeFromClassSubjects(["english", "math"])).toBe(DEFAULT_TEACHER_HOME);
    expect(teacherHomeFromClassSubjects(["math", "english"])).toBe(DEFAULT_TEACHER_HOME);
  });

  it("영어 아닌 과목(국어·과학 등)도 원스크린 — ECS는 영어 전용 화면이다", () => {
    expect(teacherHomeFromClassSubjects(["korean"])).toBe(DEFAULT_TEACHER_HOME);
    expect(teacherHomeFromClassSubjects(["math", "science"])).toBe(DEFAULT_TEACHER_HOME);
  });

  it("담당 반이 없으면 null — 부담임 슬롯을 봐야 한다는 신호(원스크린으로 단정 금지)", () => {
    expect(teacherHomeFromClassSubjects([])).toBeNull();
  });
});

describe("강사뷰 홈 규칙 — 부담임 폴백", () => {
  it("영어 반 슬롯이 있으면 ECS", () => {
    expect(teacherHomeFromAssistantClasses(5)).toBe(ENGLISH_TEACHER_HOME);
    expect(teacherHomeFromAssistantClasses(1)).toBe(ENGLISH_TEACHER_HOME);
  });

  it("영어 슬롯도 없으면 원스크린(기존 동작 유지)", () => {
    expect(teacherHomeFromAssistantClasses(0)).toBe(DEFAULT_TEACHER_HOME);
  });
});
