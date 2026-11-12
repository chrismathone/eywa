import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SHEET_DICT } from "@/features/teacher-view/i18n";
import { SendClassDialog } from "./send-class-dialog";

vi.mock("@/features/report-admin/components/classnote-sync-now-button", () => ({ ClassnoteSyncNowButton: () => null }));
vi.mock("@/features/teacher-view/lang-context", () => ({
  useSheetT: () => (key: keyof typeof SHEET_DICT) => SHEET_DICT[key].ko,
  useSheetTf: () => (key: keyof typeof SHEET_DICT, args: Record<string, string>) =>
    SHEET_DICT[key].ko.replace(/\{(\w+)\}/g, (_, name: string) => args[name] ?? ""),
}));

describe("보강 보고서를 전달할 반 선택", () => {
  it("기존 JJ 보강에서는 출결 이동 대신 보고서만 전달한다고 안내한다", () => {
    const resolve = vi.fn();
    render(<SendClassDialog ask={{ studentName: "이현지", candidates: [{ id: "MS", name: "MS1A" }], makeupClassName: "JJ1A", deliveryOnly: true, resolve }} onClose={vi.fn()} />);
    expect(screen.getByRole("heading").textContent).toContain("보고서를 보낼 반 선택");
    expect(screen.getByText(/보강 반과 출결·시수 기록은 그대로 유지됩니다/)).toBeInTheDocument();
    expect(screen.queryByText(/옮겨집니다/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "이 반으로 보고서 보내기" }));
    expect(resolve).toHaveBeenCalledWith("MS");
  });
  it("보강 반 자체를 고르는 기능은 기존 동작을 유지한다", () => {
    render(<SendClassDialog ask={{ studentName: "학생", candidates: [{ id: "JJ", name: "JJ1A" }], pickOnly: true, resolve: vi.fn() }} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "이 반으로 정하기" })).toBeInTheDocument();
  });
});
