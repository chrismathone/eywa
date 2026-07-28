import { describe, expect, it } from "vitest";
import {
  MONTHLY_EXAM_LABEL,
  SKIP_PROGRESS_STATUSES,
  isSkipStatus,
  isSkipStatusProgress,
  skipStatusOf,
  skipStatusOfProgress,
} from "./progress-status";
import { positionOf } from "@/features/progress/curriculum-position";

describe("skipStatusOf — 진도칸 원본값(Subject.today)", () => {
  it("네 가지 특수 상태를 모두 인식한다(edutrix SKIP_CHAPTER_STATUSES 이식)", () => {
    for (const s of SKIP_PROGRESS_STATUSES) {
      expect(skipStatusOf(s)).toBe(s);
      expect(isSkipStatus(s)).toBe(true);
    }
    expect(SKIP_PROGRESS_STATUSES).toEqual(["월말평가", "모의고사", "내신대비", "시험대비"]);
    expect(MONTHLY_EXAM_LABEL).toBe("월말평가");
  });

  it("앞뒤 공백은 무시", () => {
    expect(skipStatusOf(" 모의고사 ")).toBe("모의고사");
  });

  it("edutrix 옛 표기 '월간테스트'도 인식하되 선택지로는 안 내보낸다", () => {
    expect(isSkipStatus("월간테스트")).toBe(true);
    expect(SKIP_PROGRESS_STATUSES as readonly string[]).not.toContain("월간테스트");
  });

  it("빈 값·미입력은 상태 아님", () => {
    expect(skipStatusOf("")).toBeNull();
    expect(skipStatusOf(null)).toBeNull();
    expect(skipStatusOf(undefined)).toBeNull();
  });

  it("차시가 섞여 있으면 상태 아님 — 특수 상태는 차시와 상호배타(선택기가 값을 통째로 교체한다)", () => {
    expect(isSkipStatus("1. 다항식\n월말평가")).toBe(false);
    expect(isSkipStatus("모의고사 대비 문제풀이")).toBe(false);
  });

  it("진도와 병행하는 edutrix 상태는 여기 없다 — 별도 컬럼이 선행돼야 한다(진도 파이프라인 오염)", () => {
    for (const parallel of [
      "오답 정리",
      "과제오답",
      "모르는 문제 풀이",
      "문제 풀이",
      "덜한 과제 진행",
      "일일테스트",
    ]) {
      expect(isSkipStatus(parallel)).toBe(false);
    }
  });
});

describe("skipStatusOfProgress — 저장값(lesson_reports.progress, 과목 라벨 접두)", () => {
  it("과목 라벨이 앞에 붙은 저장값을 인식", () => {
    expect(skipStatusOfProgress("수학 월말평가")).toBe("월말평가");
    expect(skipStatusOfProgress("영어 모의고사")).toBe("모의고사");
    expect(skipStatusOfProgress("수학 내신대비")).toBe("내신대비");
    expect(skipStatusOfProgress("시험대비")).toBe("시험대비");
    expect(isSkipStatusProgress("수학 월간테스트")).toBe(true);
  });

  it("일반 진도 저장값은 상태 아님", () => {
    expect(skipStatusOfProgress("수학 1. 다항식의 연산")).toBeNull();
    expect(isSkipStatusProgress(null)).toBe(false);
  });

  it("라벨이 문장 중간에 섞인 값은 삼키지 않는다(진짜 기록 보존)", () => {
    expect(isSkipStatusProgress("수학 월말평가 오답풀이")).toBe(false);
  });
});

describe("진도 파이프라인 격리", () => {
  it("특수 상태는 커리큘럼 차시로 매핑되지 않는다 — ingestReport가 no-position으로 skip(진도 컨테이너 무오염)", () => {
    for (const s of SKIP_PROGRESS_STATUSES) {
      expect(positionOf(s)).toBeNull();
      expect(positionOf(`수학 ${s}`)).toBeNull();
    }
  });
});
