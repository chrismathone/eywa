import { describe, it, expect } from "vitest";
import {
  buildJumpSuppressionDetails,
  isSameTeacher,
  JUMP_SUPPRESSED_OTHER_TEACHER,
  jumpSuppressionLabel,
  jumpWarningApplies,
  normalizeTeacherName,
} from "./same-teacher-jump";
import { JUMP_ERROR_THRESHOLD } from "./progress-detector";

describe("normalizeTeacherName — 공백·대소문자", () => {
  it("앞뒤 공백과 연속 공백을 접는다", () => {
    expect(normalizeTeacherName("  허은진 ")).toBe("허은진");
    expect(normalizeTeacherName("김 은정")).toBe("김 은정");
    expect(normalizeTeacherName("김   은정")).toBe("김 은정");
    expect(normalizeTeacherName("Florence\tPark")).toBe("florence park");
  });
  it("빈 이름은 null — 공백뿐인 문자열·null·undefined 모두", () => {
    expect(normalizeTeacherName("")).toBeNull();
    expect(normalizeTeacherName("   ")).toBeNull();
    expect(normalizeTeacherName(null)).toBeNull();
    expect(normalizeTeacherName(undefined)).toBeNull();
  });
});

describe("isSameTeacher", () => {
  it("공백·대소문자만 다르면 같은 강사", () => {
    expect(isSameTeacher("허은진", " 허은진 ")).toBe(true);
    expect(isSameTeacher("Florence Park", "florence  park")).toBe(true);
  });
  it("다른 이름은 다른 강사", () => {
    expect(isSameTeacher("김은정", "김윤하")).toBe(false);
  });
  it("한쪽이라도 비어 있으면 같다고 보지 않는다(모르면 억제 방향)", () => {
    expect(isSameTeacher(null, "김윤하")).toBe(false);
    expect(isSameTeacher("김윤하", "")).toBe(false);
    expect(isSameTeacher(null, null)).toBe(false);
  });
});

describe("jumpWarningApplies — 경고 유지/억제/비교불가", () => {
  it("유지: 같은 강사 자기 줄에서 임계(20) 이상 건너뜀 — 공서연 307→340 실사례", () => {
    expect(jumpWarningApplies({ sameTeacherLastPosition: 307, newPosition: 340 })).toBe(true);
  });
  it("억제: 같은 강사 직전과의 차가 임계 미만", () => {
    expect(jumpWarningApplies({ sameTeacherLastPosition: 307, newPosition: 326 })).toBe(false);
  });
  it("비교 불가(null): 그 강사의 직전 진도가 없음 — 최다은 8/4 강사 교체 실사례", () => {
    expect(jumpWarningApplies({ sameTeacherLastPosition: null, newPosition: 245 })).toBe(false);
  });
  it("경계 = 임계값 정확히 20이면 유지, 19면 억제(detectJumpError와 같은 경계)", () => {
    expect(jumpWarningApplies({ sameTeacherLastPosition: 100, newPosition: 100 + JUMP_ERROR_THRESHOLD })).toBe(true);
    expect(jumpWarningApplies({ sameTeacherLastPosition: 100, newPosition: 119 })).toBe(false);
  });
  it("역행(같은 강사 직전보다 뒤)도 경고 아님", () => {
    expect(jumpWarningApplies({ sameTeacherLastPosition: 300, newPosition: 250 })).toBe(false);
  });
});

describe("억제 표식 — details와 화면 라벨", () => {
  it("details에 사유·강사·비교값을 함께 남긴다(역검수용)", () => {
    expect(buildJumpSuppressionDetails({ teacherName: "김윤하", sameTeacherLastPosition: null })).toEqual({
      suppressed: JUMP_SUPPRESSED_OTHER_TEACHER,
      teacherName: "김윤하",
      sameTeacherLastPosition: null,
    });
  });
  it("화면 라벨은 한글 — raw 키를 그대로 내지 않는다", () => {
    const label = jumpSuppressionLabel({ suppressed: JUMP_SUPPRESSED_OTHER_TEACHER });
    expect(label).toBe("같은 선생님 진도 기준 자동 확인");
    expect(label).not.toContain(JUMP_SUPPRESSED_OTHER_TEACHER);
  });
  it("모르는 details는 null — 없는 사유를 지어내지 않는다", () => {
    expect(jumpSuppressionLabel(null)).toBeNull();
    expect(jumpSuppressionLabel({ status: "archived", reason: "full" })).toBeNull();
    expect(jumpSuppressionLabel("other_teacher")).toBeNull();
  });
});
