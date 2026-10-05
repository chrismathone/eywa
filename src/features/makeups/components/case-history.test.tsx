import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CaseHistory } from "./case-history";
import { CaseDetailReloadContext } from "./case-detail-context";
import { uuid } from "./ui-test-fixtures";

const calls = vi.hoisted(() => ({ events: vi.fn() }));
vi.mock("../server/actions", () => ({ loadMakeupEvents: calls.events }));
const page = (reason: string, number = 1) => ({ data: { rows: [{ id: uuid(20), event_type: "assigned",
  actor_name: "담당", reason, occurred_at: "2026-10-05T00:00:00Z" }], page: number, total: 90, page_size: 30 } });
const toggle = (open: boolean) => {
  const el = screen.getByText("변경 이력").closest("details")!;
  act(() => { el.open = open; fireEvent(el, new Event("toggle")); });
};
const view = (version: number, caseId = uuid(1)) => <CaseDetailReloadContext value={{ reload: async () => true, ...{ version } }}>
  <label>초안<input defaultValue="" /></label><CaseHistory caseId={caseId} />
</CaseDetailReloadContext>;

describe("상세 이력 갱신", () => {
  beforeEach(() => vi.resetAllMocks());
  it("펼친 이력의 현재 페이지를 갱신하고 형제 초안을 유지한다", async () => {
    calls.events.mockResolvedValueOnce(page("처음")) .mockResolvedValueOnce(page("둘째", 2)) .mockResolvedValueOnce(page("새 변경", 2));
    const rendered = render(view(0));
    toggle(true); await screen.findByText("처음");
    fireEvent.click(screen.getByRole("button", { name: "변경 이력 다음 페이지" }));
    await screen.findByText("둘째");
    fireEvent.change(screen.getByRole("textbox", { name: "초안" }), { target: { value: "작성 중" } });
    rendered.rerender(view(1));
    await screen.findByText("새 변경");
    expect(calls.events).toHaveBeenLastCalledWith({ case_id: uuid(1), page: 2 });
    expect(screen.getByRole("textbox", { name: "초안" })).toHaveValue("작성 중");
  });
  it("접힌 상태의 갱신은 조회하지 않고 캐시를 비워 다음 펼침에 새로 읽는다", async () => {
    calls.events.mockResolvedValueOnce(page("옛 변경")).mockResolvedValueOnce(page("최신 변경"));
    const rendered = render(view(0));
    toggle(true); await screen.findByText("옛 변경"); toggle(false);
    rendered.rerender(view(1));
    expect(calls.events).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("옛 변경")).toBeNull();
    toggle(true); await screen.findByText("최신 변경");
  });
  it("겹친 조회에서 늦게 끝난 옛 응답이 최신 페이지를 덮지 않는다", async () => {
    let older!: (value: unknown) => void;
    calls.events.mockImplementationOnce(() => new Promise(resolve => { older = resolve; })).mockResolvedValueOnce(page("새 응답"));
    const rendered = render(view(0));
    toggle(true); rendered.rerender(view(1));
    await screen.findByText("새 응답");
    await act(async () => { older(page("늦은 옛 응답")); });
    expect(screen.getByText("새 응답")).toBeTruthy();
    expect(screen.queryByText("늦은 옛 응답")).toBeNull();
  });
  it("다른 건으로 이동하면 새 건 1페이지를 읽고 이전 건 응답을 버린다", async () => {
    calls.events.mockResolvedValueOnce(page("첫 건")).mockResolvedValueOnce(page("첫 건 둘째", 2));
    const rendered = render(view(0));
    toggle(true); await screen.findByText("첫 건");
    fireEvent.click(screen.getByRole("button", { name: "변경 이력 다음 페이지" })); await screen.findByText("첫 건 둘째");
    let older!: (value: unknown) => void;
    calls.events.mockImplementationOnce(() => new Promise(resolve => { older = resolve; })).mockResolvedValueOnce(page("다른 건"));
    rendered.rerender(view(1));
    await waitFor(() => expect(calls.events).toHaveBeenCalledTimes(3));
    rendered.rerender(view(2, uuid(22)));
    await screen.findByText("다른 건");
    await act(async () => { older(page("이전 건의 늦은 변경", 2)); });
    expect(calls.events).toHaveBeenLastCalledWith({ case_id: uuid(22), page: 1 });
    expect(screen.queryByText("이전 건의 늦은 변경")).toBeNull();
  });
  it("접을 때 진행 중 응답을 무효화해서 다음 펼침이 새로 조회한다", async () => {
    let older!: (value: unknown) => void;
    calls.events.mockImplementationOnce(() => new Promise(resolve => { older = resolve; })).mockResolvedValueOnce(page("재조회"));
    render(view(0)); toggle(true); toggle(false);
    await act(async () => { older(page("접힌 동안 끝난 응답")); });
    toggle(true); await screen.findByText("재조회");
    expect(screen.queryByText("접힌 동안 끝난 응답")).toBeNull();
  });
});
