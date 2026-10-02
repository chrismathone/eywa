import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ScheduledChangeBanner } from "./scheduled-change-banner";
import { ScheduledChangeActions } from "./scheduled-change-actions";
import type { ScheduledChange } from "@/features/enrollments/scheduled-changes";

const mocks = vi.hoisted(() => ({ cancel: vi.fn(), edit: vi.fn(), refresh: vi.fn(), signal: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/features/enrollments/server/scheduled-actions", () => ({ cancelScheduledEnrollment: mocks.cancel, rescheduleEnrollment: mocks.edit }));
vi.mock("@/features/billing/session-terms/plan-change-signal", () => ({ notifyTermPlansChanged: mocks.signal }));
const change: ScheduledChange = {
  kind: "move", date: "2026-10-03", studentId: "s", studentName: "학생", classId: "new", className: "새 반",
  fromClassId: "old", fromClassName: "이전 반", enrollmentId: "incoming", pairedEnrollmentId: "outgoing", canCancel: true,
};
beforeEach(() => { vi.clearAllMocks(); mocks.cancel.mockResolvedValue({ ok: true }); mocks.edit.mockResolvedValue({ ok: true }); });
const show = (subject: "student" | "class") => render(<ScheduledChangeBanner changes={[change]} today="2026-10-02" subject={subject}
  actions={(c) => <ScheduledChangeActions change={c} today="2026-10-02" />} />);

it.each(["student", "class"] as const)("%s 예약 줄에서 이동 없이 양쪽 수강 id로 취소한다", async (subject) => {
  show(subject);
  fireEvent.click(screen.getByRole("button", { name: "취소" }));
  await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith({ enrollmentId: "incoming", pairedEnrollmentId: "outgoing" }));
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
});

it("같은 줄에서 날짜를 수정하며 이전 반 종료도 함께 수정하도록 요청한다", async () => {
  show("class");
  fireEvent.click(screen.getByRole("button", { name: "수정" }));
  fireEvent.change(screen.getByLabelText("예약 적용일"), { target: { value: "2026-10-06" } });
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  await waitFor(() => expect(mocks.edit).toHaveBeenCalledWith({ enrollmentId: "incoming", pairedEnrollmentId: "outgoing", date: "2026-10-06", newClassId: undefined }));
});

it("서버가 취소를 거절하면 성공으로 표시하지 않고 같은 자리에 이유를 남긴다", async () => {
  mocks.cancel.mockResolvedValue({ error: "이미 시작된 수강입니다" });
  show("class");
  fireEvent.click(screen.getByRole("button", { name: "취소" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("이미 시작된 수강");
  expect(mocks.refresh).not.toHaveBeenCalled();
});

it("읽기 권한만 있으면 예약 내용은 보이고 쓰기 버튼은 없다", () => {
  render(<ScheduledChangeBanner changes={[change]} today="2026-10-02" subject="student" />);
  expect(screen.getByRole("region", { name: "예정된 변경" })).toHaveTextContent("이전 반 → 새 반");
  expect(screen.queryByRole("button", { name: "취소" })).toBeNull();
});
