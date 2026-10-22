import { beforeEach, expect, it, vi } from "vitest";
import { CONTRIBUTION_PILOT_TENANT } from "../model/access";
const mocks = vi.hoisted(() => ({ user: vi.fn(), access: vi.fn(), write: vi.fn(), super: vi.fn(), view: vi.fn(), lab: vi.fn() }));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canAccessTenant: mocks.access, canWriteTenant: mocks.write }));
vi.mock("@/lib/auth/super-admin", () => ({ isCurrentUserSuperAdmin: mocks.super }));
vi.mock("@/lib/auth/view-as", () => ({ viewAsTeacher: mocks.view }));
vi.mock("@/lib/laboratory/server", () => ({ isLaboratoryMenuAvailable: mocks.lab }));
import { getContributionGate, requireContributionWrite } from "./access";
beforeEach(() => { vi.resetAllMocks(); mocks.user.mockResolvedValue({ id: "owner", tenantId: CONTRIBUTION_PILOT_TENANT, systemRole: "master" });
  mocks.access.mockResolvedValue(true); mocks.write.mockResolvedValue(true); mocks.lab.mockResolvedValue(true); mocks.view.mockResolvedValue(null); mocks.super.mockResolvedValue(false); });
it("모든 메뉴·수납 열쇠를 통과하고 원장은 설정 가능", async () => {
  expect(await getContributionGate()).toMatchObject({ canConfigure: true, canWrite: true });
  expect(mocks.user).toHaveBeenCalledWith({ teacherView: true });
  mocks.access.mockImplementation(async (_role, key) => key !== "billing");
  expect(await getContributionGate()).toBeNull();
  await expect(requireContributionWrite()).rejects.toThrow();
});
it("다른 강사 뷰에서 원래 계정의 권한으로 설정을 열지 않는다", async () => {
  mocks.user.mockResolvedValue({ id: "teacher", tenantId: CONTRIBUTION_PILOT_TENANT, systemRole: "teacher" });
  mocks.super.mockResolvedValue(true); mocks.view.mockResolvedValue({ id: "teacher" });
  expect(await getContributionGate()).toMatchObject({ canConfigure: false, canWrite: false });
  await expect(requireContributionWrite()).rejects.toThrow();
});
it("읽기 전용 지점 보기·메뉴 차단·실험실 꺼짐을 우회하지 않는다", async () => {
  mocks.write.mockResolvedValue(false);
  expect(await getContributionGate()).toMatchObject({ canConfigure: true, canWrite: false });
  await expect(requireContributionWrite()).rejects.toThrow();
  mocks.access.mockResolvedValue(false); expect(await getContributionGate()).toBeNull();
  mocks.access.mockResolvedValue(true); mocks.lab.mockResolvedValue(false); expect(await getContributionGate()).toBeNull();
});
