import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { REPORT_OPTOUT_CONFIRM_LABEL, REPORT_OPTOUT_CONFIRM_REQUIRED } from "@/features/classes/report-optout-warning";
import { ClassReportFields } from "./class-report-fields";

/** 보내던 반을 '수업보고서 미발송'으로 켜는 순간 경고 + 확인 체크(2026-11-04 사고). */
function renderFields(p: { initial?: boolean; on: boolean; recentSent?: number | null; subject?: string }) {
  const { container } = render(
    <form>
      <ClassReportFields
        reportOptout={p.on}
        onReportOptoutChange={() => {}}
        initialReportOptout={p.initial ?? false}
        recentSentReports={p.recentSent}
        subject={p.subject ?? "math"}
        classnoteOn
      />
    </form>,
  );
  return { form: container.querySelector("form")! };
}

describe("반 설정 — 수업보고서 미발송 켜기 전 경고", () => {
  it("최근 발송이 있는 반을 켜면 건수와 결과를 알리고, 확인 체크 전에는 폼이 제출되지 않는다", () => {
    const { form } = renderFields({ on: true, recentSent: 14 });
    expect(screen.getByRole("alert")).toHaveTextContent("최근 30일 동안 수업보고서 14건을 보냈습니다");
    const confirm = screen.getByRole("checkbox", { name: REPORT_OPTOUT_CONFIRM_LABEL }) as HTMLInputElement;
    // 이름이 없어야 서버·초안 자동저장에 안 섞인다.
    expect(confirm.name).toBe("");
    expect(confirm.required).toBe(true);
    expect(form.checkValidity()).toBe(false);
    fireEvent.click(confirm);
    expect(form.checkValidity()).toBe(true);
  });

  it("체크 없이 제출하면 무엇을 해야 하는지 안내한다(브라우저 기본 문구 대신)", () => {
    renderFields({ on: true, recentSent: 3 });
    const confirm = screen.getByRole("checkbox", { name: REPORT_OPTOUT_CONFIRM_LABEL }) as HTMLInputElement;
    fireEvent.invalid(confirm);
    expect(confirm.validationMessage).toBe(REPORT_OPTOUT_CONFIRM_REQUIRED);
    fireEvent.click(confirm);
    expect(confirm.validationMessage).toBe("");
  });

  it("건수를 못 셌어도(null) 경고한다", () => {
    renderFields({ on: true, recentSent: null });
    expect(screen.getByRole("alert")).toHaveTextContent("건수를 확인하지 못했습니다");
  });

  it("반 보드 문장은 폼의 지금 과목이 수학(math·subject_1)일 때만 — 영어 반 방은 미발송과 무관하게 남는다", () => {
    const { unmount } = render(
      <ClassReportFields reportOptout onReportOptoutChange={() => {}} recentSentReports={4} subject="subject_1" classnoteOn />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("ClassNote 반 보드 연결도 다음 정기 동기화 때 풀립니다");
    unmount();
    render(<ClassReportFields reportOptout onReportOptoutChange={() => {}} recentSentReports={4} subject="english" classnoteOn />);
    expect(screen.getByRole("alert")).toHaveTextContent("보고서 칸이 잠깁니다(출결만 기록)");
    expect(screen.getByRole("alert")).not.toHaveTextContent("반 보드");
  });

  // 리뷰 2026-11-04: 꺼진 기능은 있었는지조차 모르게 — ClassNote 모듈을 끈 지점엔 ClassNote 문장이 한 글자도 없어야 한다.
  it("🔴 ClassNote 모듈이 꺼진 지점 — 수학 반이어도 안내·경고 어디에도 ClassNote 문장이 없다", () => {
    const { container } = render(
      <ClassReportFields reportOptout onReportOptoutChange={() => {}} recentSentReports={null} subject="math" classnoteOn={false} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("보고서 칸이 잠깁니다(출결만 기록)");
    expect(container.textContent).not.toContain("ClassNote");
  });

  // 리뷰 2026-11-04: 영어에서 체크한 뒤 수학으로 바꾸면 경고가 무거워졌는데 체크가 남아 다시 확인하지 않고 저장됐다.
  it("과목을 바꿔 경고가 '반 보드 연결도 풀림'으로 무거워지면 확인 체크를 다시 받는다", () => {
    const view = (subject: string) => (
      <form>
        <ClassReportFields reportOptout onReportOptoutChange={() => {}} recentSentReports={4} subject={subject} classnoteOn />
      </form>
    );
    const { rerender } = render(view("english"));
    fireEvent.click(screen.getByRole("checkbox", { name: REPORT_OPTOUT_CONFIRM_LABEL }));
    expect((screen.getByRole("checkbox", { name: REPORT_OPTOUT_CONFIRM_LABEL }) as HTMLInputElement).checked).toBe(true);
    rerender(view("math"));
    expect((screen.getByRole("checkbox", { name: REPORT_OPTOUT_CONFIRM_LABEL }) as HTMLInputElement).checked).toBe(false);
  });

  it("발송 0건 · 이미 미발송이던 반 · 꺼진 상태 · 새 반(건수 없음)은 경고하지 않는다", () => {
    for (const p of [
      { on: true, recentSent: 0 },
      { on: true, initial: true, recentSent: 14 },
      { on: false, recentSent: 14 },
      { on: true },
    ]) {
      const { unmount } = render(
        <ClassReportFields
          reportOptout={p.on}
          onReportOptoutChange={() => {}}
          initialReportOptout={p.initial ?? false}
          recentSentReports={p.recentSent}
        />,
      );
      expect(screen.queryByRole("alert")).toBeNull();
      unmount();
    }
  });
});
