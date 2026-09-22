import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ move: vi.fn(), list: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/features/owner/operations-context", () => ({ useSubjectMaps: () => ({ labelOf: () => "수학" }) }));
vi.mock("@/features/enrollments/server/actions", () => ({ moveEnrollmentsBatch: mocks.move }));
vi.mock("@/features/enrollments/server/movable-actions", () => ({ listClassTransferCandidates: mocks.list }));
vi.mock("@/features/billing/session-terms/plan-change-signal", () => ({ notifyTermPlansChanged: vi.fn() }));
vi.mock("@/lib/ui/conflict-toast", () => ({ conflictToast: vi.fn() }));
import { MoveEnrollmentButton, MoveEnrollmentProvider } from "./move-enrollment-button";

it("부분 성공으로 출발 수강 버튼이 사라져도 실패 목록과 재시도 창이 유지된다", async () => {
  const user = userEvent.setup();
  const snapshot = { studentId: "s1", startDate: "2026-01-01", endDate: null, onHold: false, isTransferred: false, attendanceDays: [] };
  mocks.list.mockResolvedValue({ ok: true, classId: "source", className: "출발 반", items: [
    { id: "e1", name: "김하나", grade: "중3", snapshot },
    { id: "e2", name: "이다음", grade: "중3", snapshot: { ...snapshot, studentId: "s2" } },
  ] });
  mocks.move.mockResolvedValue({ results: [{ enrollmentId: "e1", ok: true }, { enrollmentId: "e2", ok: false, error: "overlap" }] });
  const view = render(<MoveEnrollmentProvider>
    <MoveEnrollmentButton enrollmentId="e1" student={{ id: "s1", name: "김하나", grade: "중3" }}
      currentClassId="source" currentClassName="출발 반" currentSubject="math"
      classes={[{ id: "target", className: "목적지 반", subject: "math", studentCount: 0, teacherName: null }]} />
  </MoveEnrollmentProvider>);
  await user.click(screen.getByRole("button", { name: "반 이동" }));
  await user.click(screen.getByText("반 선택..."));
  await user.click(screen.getByText("목적지 반"));
  await user.click(screen.getByRole("button", { name: "단체 반 이동" }));
  await user.click(await screen.findByRole("button", { name: "보이는 2명 모두 선택" }));
  await user.click(screen.getByRole("button", { name: "2명 반 이동" }));
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
  view.rerender(<MoveEnrollmentProvider><p>갱신된 수강 목록</p></MoveEnrollmentProvider>);
  expect(screen.getByRole("dialog", { name: "반 이동" })).toBeInTheDocument();
  expect(screen.getByText(/1명 이동 완료/)).toBeInTheDocument();
  expect(screen.getByText(/이다음 — 목적지 반의/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "1명 반 이동" })).toBeEnabled();
});
