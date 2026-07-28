import { describe, expect, it } from "vitest";
import { MONTHLY_EXAM_LABEL, isMonthlyExam, isMonthlyExamProgress } from "./monthly-exam";
import { positionOf } from "@/features/progress/curriculum-position";

describe("isMonthlyExam — 진도칸 원본값(Subject.today)", () => {
  it("라벨 단독이면 참", () => {
    expect(isMonthlyExam(MONTHLY_EXAM_LABEL)).toBe(true);
    expect(isMonthlyExam(" 월말평가 ")).toBe(true);
  });

  it("빈 값·미입력은 거짓", () => {
    expect(isMonthlyExam("")).toBe(false);
    expect(isMonthlyExam(null)).toBe(false);
    expect(isMonthlyExam(undefined)).toBe(false);
  });

  it("차시가 섞여 있으면 거짓 — 월말평가는 차시와 상호배타(선택기가 값을 통째로 교체한다)", () => {
    expect(isMonthlyExam("1. 다항식\n월말평가")).toBe(false);
    expect(isMonthlyExam("월말평가 대비 문제풀이")).toBe(false);
  });
});

describe("isMonthlyExamProgress — 저장값(lesson_reports.progress, 과목 라벨 접두)", () => {
  it("과목 라벨이 앞에 붙은 저장값을 인식", () => {
    expect(isMonthlyExamProgress("수학 월말평가")).toBe(true);
    expect(isMonthlyExamProgress("영어 월말평가")).toBe(true);
    expect(isMonthlyExamProgress("월말평가")).toBe(true);
  });

  it("일반 진도 저장값은 거짓", () => {
    expect(isMonthlyExamProgress("수학 1. 다항식의 연산")).toBe(false);
    expect(isMonthlyExamProgress(null)).toBe(false);
  });

  it("라벨이 문장 중간에 섞인 값은 삼키지 않는다(진짜 기록 보존)", () => {
    expect(isMonthlyExamProgress("수학 월말평가 오답풀이")).toBe(false);
  });
});

describe("진도 파이프라인 격리", () => {
  it("월말평가는 커리큘럼 차시로 매핑되지 않는다 — ingestReport가 no-position으로 skip(진도 컨테이너 무오염)", () => {
    expect(positionOf("수학 월말평가")).toBeNull();
    expect(positionOf(MONTHLY_EXAM_LABEL)).toBeNull();
  });
});
