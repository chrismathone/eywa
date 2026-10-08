import { beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
const h = vi.hoisted(() => ({ gate: vi.fn(), rates: vi.fn(), classes: vi.fn(), manage: vi.fn(), editor: vi.fn() }));
vi.mock("@/features/attendance/server/salary-rates", () => ({ attendanceSalaryAdminOrNull: h.gate, loadAttendanceSalaryRates: h.rates }));
vi.mock("@/features/attendance/server/teacher-axis-queries", () => ({ loadClassAxisRows: h.classes }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canManageTenant: h.manage }));
vi.mock("@/app/(shell)/attendance/_components/salary-rates-button", () => ({ SalaryRatesButton: (props: unknown) => { h.editor(props); return <button>비율 설정</button>; } }));
import { PersonalSalaryScope } from "./_salary-scope";
const args = { teacherId: "selected", teacherName: "선생님", period: "2026-09" };
beforeEach(() => {
  vi.clearAllMocks();
  h.gate.mockResolvedValue({ tenantId: "authorized-tenant", systemRole: "admin" });
  h.manage.mockResolvedValue(true);
  h.rates.mockResolvedValue({ rates: { regular: { 고등: 50 }, special: { 중등: 50, 고등: 50 }, classes: {}, levels: ["고등"], includeSpecial: true } });
  h.classes.mockResolvedValue([{ id: "mine", className: "특강", taughtBy: ["selected"] }, { id: "other", className: "다른 반", taughtBy: ["other"] }]);
});
it("급여 설정 권한이 없으면 개인별 설정과 비율을 읽지 않는다", async () => {
  h.gate.mockResolvedValue(null);
  expect(await PersonalSalaryScope(args)).toBeNull();
  expect(h.rates).not.toHaveBeenCalled();
  expect(h.classes).not.toHaveBeenCalled();
});
it("권한자의 지점·선생님으로 설정을 읽고 같은 저장 창에 담당 반만 전달한다", async () => {
  render(await PersonalSalaryScope(args));
  expect(h.rates).toHaveBeenCalledWith("authorized-tenant", "selected");
  expect(screen.getByText("학년 제한 없이 포함")).toBeInTheDocument();
  expect(h.editor).toHaveBeenCalledWith(expect.objectContaining({ teacherId: "selected", month: "2026-09", classes: [{ id: "mine", name: "특강" }] }));
});
it("열람 권한만 있으면 범위를 보여주고 편집 버튼과 반 비율 재료는 싣지 않는다", async () => {
  h.manage.mockResolvedValue(false);
  render(await PersonalSalaryScope(args));
  expect(screen.getByText("개인별 급여 설정")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "비율 설정" })).not.toBeInTheDocument();
  expect(h.classes).not.toHaveBeenCalled();
});
it("개인별 예외를 켜지 않은 선생님은 모든 학년과 기존 특강 기준을 보여준다", async () => {
  h.rates.mockResolvedValue({ rates: { regular: {}, special: {}, classes: {} } });
  render(await PersonalSalaryScope(args));
  expect(screen.getByText("초등 · 중등 · 고등")).toBeInTheDocument();
  expect(screen.getByText("급여 대상 학년만 포함")).toBeInTheDocument();
});
it("프리랜서가 아니면 출석부 급여 예외를 새로 만들지 않는다", async () => {
  h.rates.mockResolvedValue(null);
  expect(await PersonalSalaryScope(args)).toBeNull();
  expect(h.classes).not.toHaveBeenCalled();
});
it("조회 실패를 기본값으로 꾸미지 않고 다시 열도록 안내한다", async () => {
  h.rates.mockRejectedValue(new Error("unavailable"));
  render(await PersonalSalaryScope(args));
  expect(screen.getByRole("status")).toHaveTextContent("불러오지 못했습니다");
  expect(h.editor).not.toHaveBeenCalled();
});
