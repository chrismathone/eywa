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
    daily: { score: 18, max: 20, prevScore: null, mode: "count" },
    check: { score: null, max: 20, prevScore: null, mode: "count" },
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
    expect(screen.getByText("20문제 중 18개")).toBeTruthy();
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
});
