import { render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { StudentClassRow, StudentDetail } from "@/features/students/server/queries";

const mocks = vi.hoisted(() => ({ rows: [] as StudentClassRow[], teacher: vi.fn() }));
vi.mock("@/features/students/server/queries", () => ({ getStudentClassesDetail: async () => mocks.rows }));
vi.mock("@/features/classes/server/queries", () => ({ getClassesList: async () => [] }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: async () => ({ operations: { subjects: [] } }) }));
vi.mock("@/features/owner/subjects", () => ({ buildSubjectMaps: () => ({ labelOf: () => "수학", colorOf: () => "blue" }) }));
vi.mock("@/features/timetable/lib/periods", () => ({ settingsToPeriodsConfig: () => ({}) }));
vi.mock("@/features/students/lib/week-grid-row-mode", () => ({ usedRowSubjectsOf: () => [] }));
vi.mock("@/features/students/server/past-class-teachers", () => ({ getPastClassTeachers: mocks.teacher }));
vi.mock("@/lib/date-kst", async (original) => ({ ...await original<object>(), kstToday: () => "2026-10-02" }));
vi.mock("../_components/student-assign-action", () => ({ StudentAssignAction: () => null }));
vi.mock("../_components/delete-enrollment-button", () => ({ DeleteEnrollmentButton: () => null }));
vi.mock("../_components/move-enrollment-button", () => ({ MoveEnrollmentButton: () => null, MoveEnrollmentProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/features/enrollments/components/end-enrollment-action", () => ({ EndEnrollmentAction: () => null }));
vi.mock("@/features/enrollments/components/editable-date-cell", () => ({ EditableDateCell: () => null }));
vi.mock("@/features/enrollments/components/editable-attendance-cell", () => ({ EditableAttendanceCell: () => null }));
vi.mock("@/components/workspace/window-link", () => ({ WindowLink: ({ children }: { children: ReactNode }) => <span>{children}</span> }));
vi.mock("./student-week-grid", () => ({ StudentWeekGrid: () => null }));
import { ClassesTab } from "./classes-tab";

const row = (className: string, extra: Partial<StudentClassRow> = {}): StudentClassRow => ({
  enrollmentId: className, classId: className, className, subject: "math", teacherName: "강사",
  startDate: "2026-09-08", endDate: null, isTransferred: false, onHold: false,
  schedule: [], slots: [], attendanceDays: [], classDays: [], ...extra,
});
const show = async () => render(await ClassesTab({
  student: { id: "student", status: "enrolled" } as StudentDetail,
  canEnd: false, canEditDates: false, canEditSchedule: false, canDeleteEnrollment: false,
}));
const section = (name: string) => within(screen.getByRole("heading", { name: new RegExp(name) }).closest("section")!);
beforeEach(() => { vi.clearAllMocks(); mocks.teacher.mockResolvedValue(new Map()); });

it("기존 10/2 반이동 기록은 수강 중 2개·지난 수업 1개로 표시하고 이전 반 종료는 10/1이다", async () => {
  mocks.rows = [row("BS1K", { startDate: "2026-10-02" }), row("BS1L", { endDate: "2026-10-02", isTransferred: true }), row("BS1D")];
  await show();
  expect(screen.getByRole("heading", { name: "수강 중인 수업 (2)" })).toBeInTheDocument();
  expect(section("수강 중인 수업").queryByText("BS1L")).toBeNull();
  expect(section("지난 수업").getByText("BS1L")).toBeInTheDocument();
  expect(section("지난 수업").getByText("~2026-10-01")).toBeInTheDocument();
  expect(mocks.teacher).toHaveBeenCalledWith([{ enrollmentId: "BS1L", classId: "BS1L", startDate: "2026-09-08", lastDate: "2026-10-01" }]);
});

it("10/3 예약은 이전 반이 오늘까지 수강 중이고 새 반은 배정 예정이다", async () => {
  mocks.rows = [row("이전 반", { endDate: "2026-10-03", isTransferred: true }), row("새 반", { startDate: "2026-10-03" })];
  await show();
  expect(section("수강 중인 수업").getByText("~2026-10-02")).toBeInTheDocument();
  expect(section("배정 예정 수업").getByText("새 반")).toBeInTheDocument();
  expect(section("수강 중인 수업").queryByText("새 반")).toBeNull();
});

it("일반 수강 종료는 마지막 날까지 수강 중에 남는다", async () => {
  mocks.rows = [row("일반 종료", { endDate: "2026-10-02" })];
  await show();
  expect(section("수강 중인 수업").getByText("~2026-10-02")).toBeInTheDocument();
});

it("지난 수업의 추정 담당과 근거 날짜를 표시한다", async () => {
  mocks.rows = [row("지난 반", { endDate: "2026-10-02", isTransferred: true })];
  mocks.teacher.mockResolvedValue(new Map([["지난 반", { name: "종료 당시 강사", inferred: true, source: "report", date: "2026-09-29" }]]));
  await show();
  expect(section("지난 수업").getByText("종료 당시 강사")).toBeInTheDocument();
  expect(screen.getByTitle("2026-09-29 수업보고서 기록 기준으로 추정한 담당입니다")).toBeInTheDocument();
});
