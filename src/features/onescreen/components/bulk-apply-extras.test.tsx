/** 일괄 입력의 추가 칸(2026-10-02) — 그릴 칸 판정과 입력 → 값. */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BulkTestFields,
  BulkVideoFields,
  bulkCount,
  EMPTY_BULK_TESTS,
  EMPTY_BULK_VIDEO,
  type BulkVideoState,
} from "./bulk-apply-extras";

afterEach(cleanup);

describe("숫자 칸 값", () => {
  it("빈칸·숫자 아님은 '적용 안 함', 0은 값이다", () => {
    expect(bulkCount("")).toBeUndefined();
    expect(bulkCount(" ")).toBeUndefined();
    expect(bulkCount("1.5")).toBeUndefined();
    expect(bulkCount("0")).toBe(0);
    expect(bulkCount(" 18 ")).toBe(18);
  });
});

describe("테스트 칸 — 학원 설정이 켠 테스트만, 문항수는 허용된 학원만", () => {
  it("둘 다 꺼져 있으면 아무것도 안 그린다", () => {
    const { container } = render(<BulkTestFields config={{ dailyEnabled: false, checkEnabled: false, allowTestMax: true }} value={EMPTY_BULK_TESTS} onChange={vi.fn()} />);
    expect(container.innerHTML).toBe("");
  });
  it("일일만 켠 학원 · 문항수 변경을 막은 학원은 개수 칸 하나뿐 — 숫자만 받는다", () => {
    const onChange = vi.fn();
    render(<BulkTestFields config={{ dailyEnabled: true, checkEnabled: false, allowTestMax: false }} value={EMPTY_BULK_TESTS} onChange={onChange} />);
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("일괄 일일 테스트 맞은 개수"), { target: { value: "4개" } });
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_BULK_TESTS, dailyScore: "4" });
  });
  it("둘 다 켜고 문항수를 허용하면 네 칸", () => {
    render(<BulkTestFields config={{ dailyEnabled: true, checkEnabled: true, allowTestMax: true }} value={EMPTY_BULK_TESTS} onChange={vi.fn()} />);
    expect(screen.getAllByRole("textbox")).toHaveLength(4);
    expect(screen.getByLabelText("일괄 확인 테스트 문항수")).toBeTruthy();
  });
});

describe("영상 칸 — 대상 행이 있는 줄만", () => {
  const show = (config: { videoRows: number; linkRows: number; videoCheckRows: number; dueRows?: number }, value: BulkVideoState = EMPTY_BULK_VIDEO) => {
    const onChange = vi.fn();
    const view = render(<BulkVideoFields config={config} value={value} onChange={onChange} />);
    return { onChange, ...view };
  };
  it("영상 칸이 있는 행이 하나도 없으면 묶음 자체가 없다", () => {
    expect(show({ videoRows: 0, linkRows: 0, videoCheckRows: 0 }).container.innerHTML).toBe("");
  });
  it("검사 칸만 있는 대상이면 '오늘 과제' 줄은 없다", () => {
    show({ videoRows: 0, linkRows: 0, videoCheckRows: 3 });
    expect(screen.getByText("지난 숙제 검사")).toBeTruthy();
    expect(screen.queryByText("오늘 과제")).toBeNull();
  });
  it("링크 넣기는 '있음'을 고른 때만 뜬다 · 고를 수 있는 행이 없으면 안 뜬다", () => {
    show({ videoRows: 5, linkRows: 5, videoCheckRows: 0 });
    expect(screen.queryByText("영상 첨부 링크 넣기")).toBeNull();
    cleanup();
    const { onChange } = show({ videoRows: 5, linkRows: 5, videoCheckRows: 0 }, { ...EMPTY_BULK_VIDEO, homework: true });
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenCalledWith({ check: null, homework: true, link: true, due: null });
    cleanup();
    show({ videoRows: 5, linkRows: 0, videoCheckRows: 0 }, { ...EMPTY_BULK_VIDEO, homework: true });
    expect(screen.queryByText("영상 첨부 링크 넣기")).toBeNull();
  });
  it("'없음'으로 바꾸거나 적용 안 함으로 돌리면 링크 넣기도 꺼진다", () => {
    const on = { ...EMPTY_BULK_VIDEO, homework: true, link: true };
    const { onChange } = show({ videoRows: 5, linkRows: 5, videoCheckRows: 0 }, on);
    fireEvent.click(screen.getByRole("button", { name: "없음" }));
    expect(onChange).toHaveBeenLastCalledWith({ check: null, homework: false, link: false, due: null });
    fireEvent.click(screen.getByRole("button", { name: "적용 안 함" }));
    expect(onChange).toHaveBeenLastCalledWith({ check: null, homework: null, link: false, due: null });
  });
  // 원장 2026-10-15 *"이것도 일괄입력에 넣을 수 있게 배선해주고"* — 마감(7일 · 다음 수업)도 일괄로. '없음'을 고르면 줄이 숨고 값도 버린다.
  it("마감 줄 — 마감 칸이 준비된 행이 있을 때만 · '있음'·적용 안 함에서 고른다 · '없음'이면 숨고 버린다", () => {
    const { onChange } = show({ videoRows: 5, linkRows: 0, videoCheckRows: 0, dueRows: 5 }, { ...EMPTY_BULK_VIDEO, homework: true });
    fireEvent.click(screen.getByRole("button", { name: "다음 수업" }));
    expect(onChange).toHaveBeenLastCalledWith({ check: null, homework: true, link: false, due: "next" });
    cleanup();
    const off = show({ videoRows: 5, linkRows: 0, videoCheckRows: 0, dueRows: 5 }, { ...EMPTY_BULK_VIDEO, homework: true, due: "next" });
    fireEvent.click(screen.getByRole("button", { name: "없음" }));
    expect(off.onChange).toHaveBeenLastCalledWith({ check: null, homework: false, link: false, due: null });
    cleanup();
    show({ videoRows: 5, linkRows: 0, videoCheckRows: 0, dueRows: 5 }, { ...EMPTY_BULK_VIDEO, homework: false });
    expect(screen.queryByRole("button", { name: "다음 수업" })).toBeNull();
    cleanup();
    // 마감 칸이 준비되지 않았으면(SQL 적용 전) 줄 자체가 없다
    show({ videoRows: 5, linkRows: 0, videoCheckRows: 0, dueRows: 0 }, { ...EMPTY_BULK_VIDEO, homework: true });
    expect(screen.queryByRole("button", { name: "다음 수업" })).toBeNull();
  });
  it("고른 검사의 대상을 그 자리에서 밝힌다 — 찍을 칸 수와 바꾸는 칸 수(적용 즉시 기록되므로)", () => {
    const view = render(<BulkVideoFields config={{ videoRows: 0, linkRows: 0, videoCheckRows: 5 }}
      value={{ ...EMPTY_BULK_VIDEO, check: "missing" }} onChange={vi.fn()} checkPlan={{ cells: 5, overwrite: 2 }} />);
    expect(view.container.textContent).toContain("5건 기록 · 기존 기록 2건 덮어씀");
    cleanup();
    const none = render(<BulkVideoFields config={{ videoRows: 0, linkRows: 0, videoCheckRows: 5 }}
      value={{ ...EMPTY_BULK_VIDEO, check: "missing" }} onChange={vi.fn()} checkPlan={{ cells: 0, overwrite: 0 }} />);
    expect(none.container.textContent).toContain("기록할 대상이 없습니다");
    cleanup();
    // 검사를 고르지 않았으면 그 줄이 없다
    const idle = render(<BulkVideoFields config={{ videoRows: 0, linkRows: 0, videoCheckRows: 5 }} value={EMPTY_BULK_VIDEO} onChange={vi.fn()} checkPlan={null} />);
    expect(idle.container.textContent).not.toContain("건 기록");
  });
  it("검사는 같은 값을 다시 누르면 적용 안 함으로", () => {
    const { onChange } = show({ videoRows: 0, linkRows: 0, videoCheckRows: 2 }, { ...EMPTY_BULK_VIDEO, check: "submitted" });
    fireEvent.click(screen.getByRole("button", { name: "완료" }));
    expect(onChange).toHaveBeenLastCalledWith({ check: null, homework: null, link: false, due: null });
    fireEvent.click(screen.getByRole("button", { name: "미제출" }));
    expect(onChange).toHaveBeenLastCalledWith({ check: "missing", homework: null, link: false, due: null });
  });
});
