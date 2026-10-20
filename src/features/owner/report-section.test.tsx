import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { ReportSection } from "@/app/(shell)/owner/_components/report-section";
import { DEFAULT_SETTINGS } from "./defaults";
import type { ReportSettings } from "./settings-types";

const { save } = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("@/app/(shell)/owner/_components/section-form", () => ({
  SectionForm: ({ payload, children, header, readOnly }: { payload: ReportSettings; children: ReactNode; header?: ReactNode; readOnly?: boolean }) => (
    <form onSubmit={(event) => { event.preventDefault(); save(payload); }}>
      {header}<fieldset disabled={readOnly}>{children}</fieldset>{readOnly ? null : <button type="submit">저장</button>}
    </form>
  ),
  SettingsCard: ({ title, children }: { title: string; children: ReactNode }) => (
    <section aria-label={title}><h3>{title}</h3>{children}</section>
  ),
}));
vi.mock("./operations-context", () => ({
  useSubjectMaps: () => ({
    options: [{ value: "math", label: "수학" }, { value: "english", label: "영어" }],
    labelOf: (key: string) => key === "math" ? "수학" : "영어",
  }),
}));

afterEach(() => { cleanup(); save.mockClear(); });

describe("보고서 설정 탭", () => {
  it("탭 이동은 제출하지 않고 각 탭의 변경을 함께 저장한다", () => {
    render(<ReportSection initial={structuredClone(DEFAULT_SETTINGS.report)} />);
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    fireEvent.click(screen.getByRole("tab", { name: "보고서 표시" }));
    fireEvent.change(screen.getByRole("textbox", { name: /^보고서 제목/ }), { target: { value: "우리 반 보고서" } });
    fireEvent.click(screen.getByRole("tab", { name: "영상 제출" }));
    fireEvent.click(screen.getByRole("button", { name: "영어 사용" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "영상 제출 반 검색" }), { target: { value: "중등" } });
    fireEvent.click(screen.getByRole("tab", { name: "발송 예외" }));
    fireEvent.click(screen.getByRole("button", { name: "보드 추가" }));
    fireEvent.change(screen.getAllByPlaceholderText("예: (수학)홍길동").at(-1)!, { target: { value: "확인한 보드" } });
    fireEvent.click(screen.getByRole("tab", { name: "영상 제출" }));
    expect(screen.getByRole("searchbox", { name: "영상 제출 반 검색" })).toHaveValue("중등");
    fireEvent.click(screen.getByRole("tab", { name: "보고서 표시" }));
    expect(screen.getByRole("textbox", { name: /^보고서 제목/ })).toHaveValue("우리 반 보고서");
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      title: "우리 반 보고서",
      videoHomeworkPolicy: expect.objectContaining({ disabledSubjectKeys: ["english"] }),
      classnoteSharedBoardAllowlist: expect.arrayContaining(["확인한 보드"]),
    }));
  });

  it("화살표와 Home·End로 탭과 키보드 포커스를 함께 이동한다", () => {
    render(<ReportSection initial={structuredClone(DEFAULT_SETTINGS.report)} />);
    const first = screen.getByRole("tab", { name: "발송" });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "영상 제출", selected: true })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(screen.getByRole("tab", { name: "발송 예외", selected: true })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(first).toHaveFocus();
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
  });

  it("학부모 글 답글·공감 — 기본 끔, 끔·시험·전체 셋만 고르고 저장값에 실린다", () => {
    render(<ReportSection initial={structuredClone(DEFAULT_SETTINGS.report)} />);
    const group = screen.getByRole("radiogroup", { name: "학부모 글 답글·공감" });
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(3);
    expect(within(group).getByRole("radio", { name: /^끔/ })).toBeChecked();
    expect(within(group).queryByText(/바로 알림이 갑니다/)).not.toBeInTheDocument();
    fireEvent.click(within(group).getByRole("radio", { name: /^전체/ }));
    expect(screen.getByText(/답글은 학부모에게 바로 알림이 갑니다/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ classnoteParentReplyMode: "on" }));
    fireEvent.click(within(group).getByRole("radio", { name: /^시험/ }));
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ classnoteParentReplyMode: "test" }));
    // 화면에 영문 코드가 보이지 않는다.
    expect(group.textContent).not.toMatch(/\b(off|test|on|pilot)\b/);
  });

  it("ClassNote 기능이 꺼진 학원엔 그 칸이 없다(발송 탭째 없다)", () => {
    render(<ReportSection initial={structuredClone(DEFAULT_SETTINGS.report)} classnoteOn={false} />);
    expect(screen.queryByRole("radiogroup", { name: "학부모 글 답글·공감" })).not.toBeInTheDocument();
    expect(screen.queryByText("학부모 글 답글·공감")).not.toBeInTheDocument();
  });

  it("비활성 반을 숨기고 운영 중인 반의 일괄 변경에만 적용한다", () => {
    const initial = structuredClone(DEFAULT_SETTINGS.report);
    initial.videoHomeworkPolicy.disabledClassIds = ["open", "retired"];
    render(<ReportSection initial={initial} videoClasses={[
      { id: "open", name: "운영반", subjectKey: "math", active: true },
      { id: "retired", name: "폐지반", subjectKey: "math", active: false },
    ]} />);
    fireEvent.click(screen.getByRole("tab", { name: "영상 제출" }));
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByRole("button", { name: /운영반/ })).toBeVisible();
    expect(within(panel).queryByRole("button", { name: /폐지반/ })).not.toBeInTheDocument();
    expect(within(panel).getByText(/운영 중인 반 중 제외 1개/)).toBeVisible();
    fireEvent.click(within(panel).getByRole("button", { name: "운영 중인 반 모두 사용" }));
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      videoHomeworkPolicy: expect.objectContaining({ disabledClassIds: ["retired"] }),
    }));
  });
});
