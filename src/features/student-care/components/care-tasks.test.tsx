import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CareTaskPanel } from "./care-tasks";
import type { CareTasks } from "../tasks";
vi.mock("@/features/staff-tasks/components/task-detail", () => ({
  TaskDetail: ({ onBack }: { onBack: () => void }) => <button onClick={onBack}>업무 이력에서 돌아오기</button>,
}));
const fetcher = vi.fn();
const result: CareTasks = { canMonitor: false, total: 1, items: [{
  id: "task-a", kind: "followup_due", title: "", detail: null, link: "/consultations/a", status: "done",
  openedAt: "2026-10-19T00:00:00Z", dueAt: "2026-10-20T00:00:00Z", closedAt: "2026-10-20T01:00:00Z",
  closedBy: { id: "staff-a", name: "가상 담당자" }, closeReason: "followup_done", assignees: [{ id: "staff-a", name: "가상 담당자" }],
}] };
beforeEach(() => { vi.stubGlobal("fetch", fetcher); fetcher.mockReset(); fetcher.mockResolvedValue({ ok: true, json: async () => result }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("학생 관련 업무", () => {
  it("페이지를 보는 것만으로 조회·생성·발송하지 않는다", () => {
    render(<CareTaskPanel studentId="student-a" />);
    expect(fetcher).not.toHaveBeenCalled();
    expect(screen.getByText(/실제 개선 여부는/)).toBeInTheDocument();
  });
  it("명시 요청으로 담당자와 실제 완료 근거를 읽고 기존 상세를 재사용한다", async () => {
    render(<CareTaskPanel studentId="student-a" />);
    fireEvent.click(screen.getByRole("button", { name: "관련 업무 확인" }));
    expect(await screen.findByText(/후속조치 완료 체크/)).toBeInTheDocument();
    expect(screen.getByText(/내가 담당하고 열람할 수 있는 학생 업무/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /상담 후속조치/ }));
    fireEvent.click(screen.getByRole("button", { name: "업무 이력에서 돌아오기" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(fetcher.mock.calls.every(([url, options]) => String(url).startsWith("/api/students/student-a/care-tasks") && options.cache === "no-store")).toBe(true);
  });
  it("실패와 조회된 업무 없음은 구분하고 다시 시도할 수 있다", async () => {
    fetcher.mockResolvedValueOnce({ ok: false });
    render(<CareTaskPanel studentId="student-a" />);
    fireEvent.click(screen.getByRole("button", { name: "관련 업무 확인" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("불러오지 못했습니다");
    expect(screen.queryByText(/확인된 업무가 없습니다/)).not.toBeInTheDocument();
    fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ ...result, items: [], total: 0 }) });
    fireEvent.click(screen.getByRole("button", { name: "새로 확인" }));
    expect(await screen.findByText(/학생의 문제가 해결됐다는 뜻은 아닙니다/)).toBeInTheDocument();
  });
  it("종료 탭으로 바꾸면 전 응답을 취소해 이전 목록이 덮어쓰지 못한다", async () => {
    let resolveFirst!: (value: unknown) => void;
    fetcher.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }));
    render(<CareTaskPanel studentId="student-a" />);
    fireEvent.click(screen.getByRole("button", { name: "관련 업무 확인" }));
    fireEvent.click(screen.getByRole("button", { name: "종료 이력" }));
    expect(await screen.findByText(/후속조치 완료 체크/)).toBeInTheDocument();
    resolveFirst({ ok: true, json: async () => ({ ...result, total: 0, items: [] }) });
    await waitFor(() => expect(fetcher.mock.calls[0]![1].signal.aborted).toBe(true));
    expect(screen.queryByText(/확인된 업무가 없습니다/)).not.toBeInTheDocument();
  });
});
