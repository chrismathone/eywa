import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AllocationPicker } from "./allocation-picker";
import { ReserveForm } from "./reserve-form";
import { CaseDetailReloadContext } from "./case-detail-context";
import { caseRow, periods, uuid } from "./ui-test-fixtures";

const calls = vi.hoisted(() => ({ search: vi.fn(), command: vi.fn() }));
vi.mock("../server/actions", () => ({ searchAllocationCases: calls.search, executeMakeupCommand: calls.command }));
vi.mock("@/lib/realtime/mutation-signal", () => ({ publishMutation: vi.fn() }));
vi.mock("@/components/workspace/use-unsaved-guard", () => ({ useUnsavedGuard: () => ({ markSaved: vi.fn() }) }));
vi.mock("./session-fields", () => ({ SessionFields: () => <input name="session_date" aria-label="실시 날짜" defaultValue="2026-10-05" /> }));
vi.mock("./option-picker", () => ({ OptionPicker: ({ name, filter }: { name: string; filter?: { session_date?: string } }) =>
  <input name={name} aria-label="출결 반" data-date={filter?.session_date} defaultValue={uuid(3)} /> }));

describe("예약 분량과 저장한 폼만 초기화", () => {
  beforeEach(() => vi.resetAllMocks());
  it("최신 예약량과 한도를 표시하면서 이미 입력한 150분과 형제 초안을 유지한다", () => {
    const view = (minutes: number) => <><label>형제 메모<input defaultValue="" /></label><AllocationPicker row={caseRow({ reservable_minutes: minutes })} /></>;
    const rendered = render(view(180));
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "150" } });
    fireEvent.change(screen.getByRole("textbox", { name: "형제 메모" }), { target: { value: "미저장 메모" } });
    rendered.rerender(view(120));
    expect(screen.getByRole("spinbutton")).toHaveValue(150);
    expect(screen.getByRole("spinbutton")).toHaveAttribute("max", "120");
    expect(screen.getByText("예약 가능 120분")).toBeTruthy();
    expect(screen.getByText(/입력한 분량이 현재 예약 가능량을/)).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "형제 메모" })).toHaveValue("미저장 메모");
  });
  it("예약 성공 후 분량만 최신 잔량으로 리셋하고 추가 검색도 새로 읽는다", async () => {
    const extra = caseRow({ id: uuid(10), original_date: "2026-09-28", reservable_minutes: 90 });
    calls.search.mockResolvedValueOnce({ data: { rows: [extra], total: 1, page: 1 } })
      .mockResolvedValueOnce({ data: { rows: [{ ...extra, reservable_minutes: 20 }], total: 1, page: 1 } });
    calls.command.mockResolvedValue({ ok: true, result: {} });
    const replace = (minutes: number) => rendered.rerender(<CaseDetailReloadContext value={{ reload: async () => true }}>
      <label>형제 메모<input defaultValue="작성 중" /></label><ReserveForm row={caseRow({ reservable_minutes: minutes, revision: 2 })} periods={periods} />
    </CaseDetailReloadContext>);
    const rendered = render(<CaseDetailReloadContext value={{ reload: async () => { replace(30); return true; } }}>
      <label>형제 메모<input defaultValue="작성 중" /></label><ReserveForm row={caseRow()} periods={periods} />
    </CaseDetailReloadContext>);
    fireEvent.click(screen.getByRole("button", { name: "같은 학생의 다른 미처리 건 찾기" }));
    await screen.findByText(/예약 가능 90분/);
    fireEvent.click(screen.getByRole("button", { name: "함께 배정" }));
    fireEvent.change(screen.getAllByRole("spinbutton")[0], { target: { value: "120" } });
    fireEvent.change(screen.getByRole("textbox", { name: "예약 메모" }), { target: { value: "이번 예약" } });
    await act(async () => { fireEvent.submit(screen.getByRole("button", { name: "예약 확정" }).closest("form")!); });
    await waitFor(() => expect(calls.search).toHaveBeenCalledTimes(2));
    expect(screen.getAllByRole("spinbutton")).toHaveLength(1);
    expect(screen.getByRole("spinbutton")).toHaveValue(30);
    expect(screen.getByText(/예약 가능 20분/)).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "형제 메모" })).toHaveValue("작성 중");
    expect(screen.getByRole("textbox", { name: "예약 메모" })).toHaveValue("이번 예약");
  });
  it("실패한 예약은 입력 분량을 그대로 유지한다", async () => {
    calls.command.mockResolvedValue({ ok: false, error: "예약할 수 없습니다" });
    render(<ReserveForm row={caseRow()} periods={periods} />);
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "120" } });
    await act(async () => { fireEvent.submit(screen.getByRole("button", { name: "예약 확정" }).closest("form")!); });
    expect(screen.getByRole("spinbutton")).toHaveValue(120);
    expect(calls.search).not.toHaveBeenCalled();
  });
  it("추가 지도는 예약 폼을 제공하지 않는다", () => {
    render(<ReserveForm row={caseRow({ reason: "additional" })} periods={periods} />);
    expect(screen.queryByRole("button", { name: "예약 확정" })).toBeNull();
    expect(screen.getByText(/예약은 아직 지원하지 않습니다/)).toBeTruthy();
  });
  it("실시 날짜를 바꾸면 출결 반 후보 날짜도 변경한다", () => {
    render(<ReserveForm row={caseRow()} periods={periods} />);
    fireEvent.change(screen.getByRole("textbox", { name: "실시 날짜" }), { target: { value: "2026-10-10" } });
    expect(screen.getByRole("textbox", { name: "출결 반" })).toHaveAttribute("data-date", "2026-10-10");
  });
});
