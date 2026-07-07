import { describe, expect, it } from "vitest";
import { buildReportCommentInput, buildReportCommentPrompt } from "./report-comment";
import type { OneScreenStudent } from "./types";

function student(overrides: Partial<OneScreenStudent> = {}): OneScreenStudent {
  return {
    id: "s1",
    name: "김민승",
    grade: "초3",
    tag: "월A",
    attendance: "출석",
    subjects: [{ name: "수학(상)", prev: "일차함수", today: "이차함수" }],
    tests: {
      daily: { score: 16, max: 20, prevScore: 14 },
      check: { score: 18, max: 20, prevScore: null },
    },
    attitude: "좋음",
    homework: "완료",
    progressConfirmed: false,
    reportDraft: "",
    reportSent: false,
    ...overrides,
  };
}

describe("buildReportCommentInput", () => {
  it("진도·테스트(증감 포함)·태도·과제를 매핑한다", () => {
    const input = buildReportCommentInput(student(), 0);
    expect(input.studentName).toBe("김민승");
    expect(input.subject).toBe("수학(상)");
    expect(input.progress).toBe("이차함수");
    expect(input.dailyTest).toBe("20문제 중 16개 (지난 회차 대비 ▲2)");
    expect(input.checkTest).toBe("20문제 중 18개"); // prev 없으면 증감 미부기
    expect(input.attitude).toBe("좋음");
    expect(input.homework).toBe("완료");
  });

  it("미입력 점수·과제(—)는 빈 문자열", () => {
    const input = buildReportCommentInput(
      student({
        tests: { daily: { score: null, max: 20, prevScore: null }, check: { score: null, max: 20, prevScore: null } },
        attitude: null,
        homework: "—",
      }),
      0,
    );
    expect(input.dailyTest).toBe("");
    expect(input.checkTest).toBe("");
    expect(input.attitude).toBe("");
    expect(input.homework).toBe("");
  });
});

describe("buildReportCommentPrompt", () => {
  // [예시](few-shot)와 [반드시] 가이드에도 "[입력]" 문구가 있으므로, 헤더("[입력]\n") 뒤 ~ "[출력]" 앞의
  // 실제 주입 섹션만 잘라 검사한다.
  const inputSection = (prompt: string) => prompt.split("[입력]\n")[1]?.split("\n\n[출력]")[0] ?? "";

  it("채워진 사실만 [입력]에 넣고 JSON 출력 계약을 담는다", () => {
    const prompt = buildReportCommentPrompt(buildReportCommentInput(student(), 0));
    const sec = inputSection(prompt);
    expect(sec).toContain("오늘 진도: 수학(상) 이차함수");
    expect(sec).toContain("일일테스트(이전 진도 범위): 20문제 중 16개 (지난 회차 대비 ▲2)");
    expect(sec).toContain("수업 태도: 좋음");
    expect(sec).toContain("과제: 완료");
    expect(prompt).toContain("JSON"); // Upstage JSON mode 필수 토큰
    expect(prompt).toContain('{"comment"');
  });

  it("빈 항목은 [입력] 섹션에서 침묵(라인 미포함)", () => {
    const prompt = buildReportCommentPrompt(
      buildReportCommentInput(
        student({
          tests: { daily: { score: null, max: 20, prevScore: null }, check: { score: null, max: 20, prevScore: null } },
          attitude: null,
          homework: "—",
        }),
        0,
      ),
    );
    const sec = inputSection(prompt);
    expect(sec).toContain("오늘 진도: 수학(상) 이차함수"); // 진도는 남아있음
    expect(sec).not.toContain("일일테스트");
    expect(sec).not.toContain("확인테스트");
    expect(sec).not.toContain("수업 태도");
    expect(sec).not.toContain("과제");
  });
});
