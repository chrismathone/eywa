import { describe, expect, it } from "vitest";
import { gradeKind } from "./normalize";

describe("기존 시험 종류 통합", () => {
  it("수학의 기존 중간·기말 기록도 내신으로 표시한다", () => {
    expect(gradeKind("midterm", "중간고사")).toBe("school");
    expect(gradeKind("final", "기말고사")).toBe("school");
    expect(gradeKind("school", "내신")).toBe("school");
  });

  it("영어 듣기평가도 학교 시험이다(시험정보 `26-2-듣기`)", () => {
    expect(gradeKind("listening", "듣기평가")).toBe("school");
    expect(gradeKind(null, "듣기평가")).toBe("school");
  });

  it("새로 추가한 테스트와 월말평가를 별도 종류로 구분한다", () => {
    expect(gradeKind(null, "일일테스트")).toBe("daily");
    expect(gradeKind(null, "확인테스트")).toBe("check");
    expect(gradeKind(null, "입학테스트")).toBe("admission");
    expect(gradeKind("monthly", "월말평가")).toBe("monthly");
  });
});
