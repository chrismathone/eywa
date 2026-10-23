import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
const read = vi.hoisted(() => vi.fn());
vi.mock("../server/pending-actions", () => ({ getContributionPendingDetails: read }));
import { PendingBadge } from "./pending-badge";
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it("목록에서는 조회하지 않고 배지를 열면 해당 월·수업명·사유를 표시한다", async () => {
  read.mockResolvedValue({ computedAt: "2026-10-23T01:00:00Z", details: [{ metric: "subjectMonths", count: null,
    reason: "담당 과목을 확인하지 못했습니다.", months: ["2024-02"], lessons: ["중등3T 월수목"] }] });
  render(<PendingBadge studentId="student" name="김학생" metrics={["subjectMonths"]} />);
  expect(read).not.toHaveBeenCalled();
  const button = screen.getByRole("button", { name: "김학생 확인 전 항목 1개" });
  fireEvent.click(button);
  expect(await screen.findByText("수업명: 중등3T 월수목")).toBeTruthy();
  expect(screen.getByText("확인된 해당 월: 2024-02")).toBeTruthy();
  expect(screen.getByText("담당 과목을 확인하지 못했습니다.")).toBeTruthy();
  fireEvent.click(button); fireEvent.click(button);
  expect(read).toHaveBeenCalledExactlyOnceWith("student");
});
it("조회 실패는 확인 완료나 실적 0으로 표시하지 않는다", async () => {
  read.mockRejectedValue(new Error("offline"));
  render(<PendingBadge studentId="student" name="김학생" metrics={["subjectMonths"]} />);
  fireEvent.click(screen.getByRole("button"));
  expect(await screen.findByText(/세부 자료를 불러오지 못했습니다/)).toBeTruthy();
  expect(screen.queryByText(/모두 확인됐습니다/)).toBeNull();
});
it("실패 후 배지를 다시 열면 재시도한다", async () => {
  read.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ computedAt: "now", details: [
    { metric: "subjectMonths", count: null, reason: "담당 과목 미확인", months: ["2024-02"], lessons: ["중등3T 월수목"] },
  ] });
  render(<PendingBadge studentId="student" name="김학생" metrics={["subjectMonths"]} />);
  const button = screen.getByRole("button");
  fireEvent.click(button);
  expect(await screen.findByText(/세부 자료를 불러오지 못했습니다/)).toBeTruthy();
  fireEvent.click(button); fireEvent.click(button);
  expect(await screen.findByText("담당 과목 미확인")).toBeTruthy();
  expect(read).toHaveBeenCalledTimes(2);
});
