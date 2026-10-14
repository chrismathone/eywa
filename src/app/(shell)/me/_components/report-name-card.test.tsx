import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReportNameCard } from "./report-name-card";

const mocks = vi.hoisted(() => ({ update: vi.fn(), error: vi.fn(), success: vi.fn() }));
vi.mock("@/features/staff/server/me-actions", () => ({ updateMyReportName: mocks.update }));
vi.mock("sonner", () => ({ toast: { error: mocks.error, success: mocks.success } }));
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); mocks.update.mockResolvedValue({ ok: true }); });

describe("내 정보의 수업보고서 반명 토글", () => {
  it("기존 계정은 꺼짐이며 이름과 옵션을 함께 저장한다", async () => {
    render(<ReportNameCard realName="담당강사" initialName="Jane" mappingBlocked={false} />);
    const toggle = screen.getByRole("switch", { name: "이름 앞에 반명 붙이기" });
    expect((toggle as HTMLInputElement).checked).toBe(false);
    fireEvent.click(toggle);
    expect(screen.getByText("표시 예시: [수업 반명] Jane")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalled());
    const data = mocks.update.mock.calls[0]![1] as FormData;
    expect(data.get("reportName")).toBe("Jane");
    expect(data.get("includeClassName")).toBe("true");
  });
  it("실명 폴백·끄기·저장 실패에도 입력을 유지한다", async () => {
    mocks.update.mockResolvedValue({ error: "저장 실패" });
    render(<ReportNameCard realName="담당강사" initialName={null} initialIncludeClassName mappingBlocked={false} />);
    expect(screen.getByText("표시 예시: [수업 반명] 담당강사")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("발송에 표시할 이름"), { target: { value: "새 이름" } });
    fireEvent.click(screen.getByRole("switch"));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "저장" })); });
    expect(mocks.error).toHaveBeenCalledWith("저장 실패");
    expect((screen.getByLabelText("발송에 표시할 이름") as HTMLInputElement).value).toBe("새 이름");
    expect(mocks.update.mock.calls[0]![1].get("includeClassName")).toBe("false");
  });
});
