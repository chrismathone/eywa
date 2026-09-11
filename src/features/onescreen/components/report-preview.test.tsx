import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ReportPreview, type ReportPreviewContext } from "./report-preview";
import { DEFAULT_SETTINGS } from "@/features/owner/defaults";
import type { OneScreenStudent, Subject } from "../types";

afterEach(cleanup);

/**
 * 카드 뷰 우측 '학부모 미리보기'가 **입력값 그대로**를 학부모 카드 형태로 보여주는지 — 그리고
 * 학원설정 표시 토글을 그대로 따르는지. 🔴 이 두 성질이 깨지면 화면과 발송물이 갈라진다.
 */
const ctx: ReportPreviewContext = {
  settings: DEFAULT_SETTINGS.report,
  academyName: "인재원",
  logoSrc: null,
  teacherName: "박소선",
  reportDate: "2026-08-05",
  showDailyTest: true,
  showCheckTest: true,
};

const subject: Subject = {
  name: "수학",
  subjectLabel: "수학",
  prev: "",
  today: "1-1-1 백 알아보기",
  textbook: "개념원리 초2-1",
  homeworkToday: "개념편 p10~16",
};

const student = {
  id: "s1",
  name: "이윤건",
  grade: "초2",
  school: "달성초",
  tag: "초2 A반",
  attendance: "출석",
  subjects: [subject],
  tests: {
    daily: { score: 18, max: 20, prevScore: null },
    check: { score: null, max: 20, prevScore: null },
  },
  attitude: "매우 좋음",
  homework: "90%",
  progressConfirmed: true,
  reportDraft: "",
  reportSent: false,
} as unknown as OneScreenStudent;

const renderPreview = (over: Partial<Parameters<typeof ReportPreview>[0]> = {}) =>
  render(
    <ReportPreview
      ctx={ctx}
      student={student}
      subject={subject}
      draft="원과 현을 무리 없이 따라왔습니다."
      attachments={[]}
      {...over}
    />,
  );

describe("ReportPreview", () => {
  it("입력값이 학부모 카드 형태로 그대로 보인다(진도 접두 = 과목 라벨)", () => {
    renderPreview();
    expect(screen.getByText("이윤건")).toBeTruthy();
    expect(screen.getByText("달성초2")).toBeTruthy(); // fmtSchoolGrade 압축 표기
    expect(screen.getByText("박소선")).toBeTruthy(); // 담임
    expect(screen.getByText("수학 1-1-1 백 알아보기")).toBeTruthy();
    expect(screen.getByText("개념원리 초2-1")).toBeTruthy();
    expect(screen.getByText("20문제 중 18개 맞음")).toBeTruthy();
    expect(screen.getByText("90%")).toBeTruthy();
    expect(screen.getByText("원과 현을 무리 없이 따라왔습니다.")).toBeTruthy();
    // 미입력 항목(확인테스트)은 학부모 카드에 줄 자체가 없다.
    expect(screen.queryByText("확인테스트")).toBeNull();
  });

  it("학원설정에서 끈 항목은 미리보기에도 안 나온다(발송본과 같은 토글을 본다)", () => {
    renderPreview({
      ctx: { ...ctx, settings: { ...DEFAULT_SETTINGS.report, showTextbook: false, showAttitude: false } },
    });
    expect(screen.queryByText("개념원리 초2-1")).toBeNull();
    expect(screen.queryByText("매우 좋음")).toBeNull();
    expect(screen.getByText("수학 1-1-1 백 알아보기")).toBeTruthy(); // 끄지 않은 항목은 그대로
  });

  it("멘트가 비면 학부모 카드의 빈 문구를 그대로 보여준다(강사가 빈 발송을 눈으로 안다)", () => {
    renderPreview({ draft: "   " });
    expect(screen.getByText("작성된 보고 내용이 없습니다.")).toBeTruthy();
  });

  it("템플릿 모드(영어)면 강사가 조립한 글이 본문이고 항목 칸은 없다(발송본과 같은 판정)", () => {
    renderPreview({
      templateMode: true,
      draft: "안녕하세요 학부모님, 부원장입니다!\n\n📍 오늘의 진도\nUnit 1~3 리뷰",
    });
    expect(screen.getByText(/부원장입니다!/)).toBeTruthy();
    expect(screen.queryByText("오늘 수업")).toBeNull();
    expect(screen.queryByText("평가")).toBeNull();
    expect(screen.queryByText("학부모 전달 내용")).toBeNull();
    expect(screen.queryByText("수학 1-1-1 백 알아보기")).toBeNull();
  });

  it("템플릿 모드에서 글이 비면 기존 빈 문구", () => {
    renderPreview({ templateMode: true, draft: "   " });
    expect(screen.getByText("작성된 보고 내용이 없습니다.")).toBeTruthy();
  });

  it("추이 이력이 오면 학습 추이 그래프도 그린다(발송본에 크게 들어가는 블록)", () => {
    // 이력이 없으면 그래프 섹션 자체가 없다 — 실제 발송본과 같은 규약(유효점 2개 이상일 때만).
    expect(screen.queryByText("학습 추이")).toBeNull();
    cleanup();
    renderPreview({
      trendRows: [
        { id: "r1", date: "2026-07-29", examInfo: "20문제 중 16개", homeworkScore: "100%" },
        { id: "r2", date: "2026-08-03", examInfo: "20문제 중 12개", homeworkScore: "100%" },
      ],
    });
    expect(screen.getByText("학습 추이")).toBeTruthy();
  });

  it("🔴 오늘 회차는 아직 저장 전이라 **지금 입력값**이 그래프의 마지막 점이 된다", () => {
    // 일일 18/20 = 90% → 오늘(08-05) 점이 90으로 찍혀야 한다(저장 전에도 왼쪽 수정이 그래프에 반영).
    renderPreview({
      trendRows: [{ id: "r1", date: "2026-07-29", examInfo: "20문제 중 16개", homeworkScore: "100%" }],
    });
    const svg = document.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg!.textContent).toContain("90");
    // 같은 날짜의 저장분이 있어도 **입력값이 이긴다**(중복 점 방지 + 편집 중 값이 진실).
    cleanup();
    renderPreview({
      trendRows: [
        { id: "r1", date: "2026-07-29", examInfo: "20문제 중 16개", homeworkScore: "100%" },
        { id: "r2", date: "2026-08-05", examInfo: "20문제 중 4개", homeworkScore: "0%" }, // 옛 저장분(20%)
      ],
    });
    const svg2 = document.querySelector("svg");
    expect(svg2!.textContent).toContain("90");
    expect(svg2!.textContent).not.toContain("20문제");
  });
});
