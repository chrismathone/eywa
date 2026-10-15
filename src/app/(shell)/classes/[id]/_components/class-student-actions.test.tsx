import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ClassStudentRow } from "@/features/classes/server/queries";
import type { ScheduledChange } from "@/features/enrollments/scheduled-changes";
vi.mock("@/features/enrollments/components/end-enrollment-action", () => ({ EndEnrollmentAction: () => <button>end</button> }));
vi.mock("@/features/enrollments/components/cancel-assignment-button", () => ({ CancelAssignmentButton: () => <button>cancel</button> }));
vi.mock("@/components/scheduled-change-actions", () => ({ ScheduledChangeActions: () => <button>schedule</button> }));
import { ClassStudentActions } from "./class-student-actions";
const student = { enrollmentId: "e", studentId: "s", enrolledAt: "2099-01-01", phase: "upcoming", name: "Synthetic" } as ClassStudentRow;
afterEach(cleanup);
it("basic editor without status assignment keeps future cancellation and scheduled transfer actions", () => {
  const props = { student, className: student.name, today: "2026-10-15", lang: "ko" as const, permissions: { basic: true, status: false, schedule: true } };
  const { rerender } = render(<ClassStudentActions {...props} />);
  expect(screen.getByRole("button", { name: "cancel" })).toBeInTheDocument();
  rerender(<ClassStudentActions {...props} scheduled={{ kind: "join" } as ScheduledChange} />);
  expect(screen.getByRole("button", { name: "schedule" })).toBeInTheDocument();
  rerender(<ClassStudentActions {...props} student={{ ...student, phase: "active" }} />);
  expect(screen.queryByRole("button", { name: "end" })).toBeNull();
});
it("readonly hides every mutation and assigned status editor can end current enrollment", () => {
  const props = { student, className: student.name, today: "2026-10-15", lang: "ko" as const, permissions: { basic: false, status: false, schedule: false } };
  const { rerender } = render(<ClassStudentActions {...props} />); expect(screen.queryByRole("button")).toBeNull();
  rerender(<ClassStudentActions {...props} student={{ ...student, phase: "active" }} permissions={{ basic: true, status: true, schedule: false }} />);
  expect(screen.getByRole("button", { name: "end" })).toBeInTheDocument();
});
