import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
const m = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/features/visitor-history/server/actions", () => ({ loadVisitorMonth: m.load }));
vi.mock("@/components/ui/button", () => ({ Button: ({ variant, ...p }: ComponentProps<"button"> & { variant?: string }) => {
  void variant; return <button {...p} />;
} }));
import { VisitorView } from "./visitor-view";
import { MonthTable } from "./month-table";
import { RecordTable } from "./record-table";
import { mergeMonth, reservation } from "@/features/visitor-history/model";
const month = mergeMonth("2025-01", [{ source: "입학 상담", complete: true, scanned: 2, unclassified: 0, records: [
  reservation({ id: "one", summary: "입테 가상학생", start: { date: "2025-01-01" } }, "입학 상담", "a", "2025-01")!,
  reservation({ id: "two", summary: "취소 상담", start: { date: "2025-01-02" } }, "입학 상담", "a", "2025-01")!,
] }], "2026-10-20T03:00:00Z");
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);
it("does not fetch on first paint and disables unconfigured access", () => {
  render(<VisitorView today="2026-10-20" sources={[]} />);
  expect(m.load).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "구글 기록 조회" })).toBeDisabled();
});
it("discards old results after switching years", async () => {
  let resolve!: (v: unknown) => void;
  m.load.mockReturnValue(new Promise(r => { resolve = r; }));
  render(<VisitorView today="2026-10-20" sources={["입학 상담"]} />);
  fireEvent.click(screen.getByRole("button", { name: "구글 기록 조회" }));
  fireEvent.change(screen.getByLabelText("조회 연도"), { target: { value: "2025" } });
  await act(async () => { resolve({ data: month }); });
  expect(screen.queryByText("1개월 조회됨")).toBeNull();
  expect(m.load).toHaveBeenCalledTimes(1);
});
it("shows partial months as unavailable, not zero, and hides YoY", () => {
  render(<MonthTable year={2025} today="2026-10-20" history={{ "2025-01": { ...month, complete: false } }}
    errors={{}} selected="2025-01" onSelect={vi.fn()} />);
  const row = screen.getByRole("button", { name: "1월" }).closest("tr")!;
  expect(within(row).getByText("일부 조회")).toBeInTheDocument();
  expect(within(row).queryByText("0")).toBeNull();
  expect(within(row).getByText("비교 보류")).toBeInTheDocument();
});
it("filters cancellations and never labels past bookings as completed visits", () => {
  render(<RecordTable month="2025-01" data={month} today="2026-10-20" />);
  expect(screen.getByText("지난 예약 · 방문 미확인")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("기록 분류"), { target: { value: "cancelled" } });
  expect(screen.queryByText("입테 가상학생")).toBeNull();
  expect(screen.getByText("취소 상담")).toBeInTheDocument();
});
it("returns to a valid page when a refresh shrinks the record list", () => {
  const large = { ...month, records: Array.from({ length: 51 }, (_, i) => ({ ...month.records[0], key: String(i), title: `가상 예약 ${i}` })) };
  const { rerender } = render(<RecordTable month="2025-01" data={large} today="2026-10-20" />);
  fireEvent.click(screen.getByRole("button", { name: "다음" }));
  expect(screen.getByText("가상 예약 50")).toBeInTheDocument();
  rerender(<RecordTable month="2025-01" data={month} today="2026-10-20" />);
  expect(screen.getByText("입테 가상학생")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "다음" })).toBeDisabled();
});
