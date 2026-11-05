import { beforeEach, expect, it, vi } from "vitest";

/**
 * 엑셀 가져오기 게이트 — '다른 강사 뷰'면 대상 직원이 사람이다(기록 명의·역할 판정). 로그인 계정으로 열면 원장이 실장 화면에서 올린
 * 지출·일정이 원장 명의로 남고, 직원 가져오기가 원장 역할로 '원장' 역할까지 줄 수 있다(원장 2026-11-05 강사뷰 전수).
 */
const m = vi.hoisted(() => ({ user: vi.fn(), manage: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canManageTenant: m.manage }));
vi.mock("@/features/audit/server/log", () => ({ logAction: vi.fn() }));
vi.mock("./workbook", () => ({ annotateErrors: vi.fn(), findSheet: vi.fn(), loadWorkbook: vi.fn(), sheetGrid: vi.fn() }));
import { gateImport } from "./run";
import type { ImporterDef } from "./types";

const def = { title: "지출", menu: "billing" } as unknown as ImporterDef;
const actual = { id: "actual", tenantId: "t1", systemRole: "master" };
const target = { id: "target", tenantId: "t1", systemRole: "admin" };

beforeEach(() => {
  vi.clearAllMocks();
  m.manage.mockResolvedValue(true);
});

it("강사뷰면 대상 직원을 ctx.user로 넘기고, 그 역할로 전체 권한을 본다", async () => {
  m.user.mockImplementation(async (o?: { teacherView: boolean }) => (o?.teacherView ? target : actual));
  expect(await gateImport(def)).toEqual({ user: target, tenantId: "t1" });
  expect(m.manage).toHaveBeenCalledWith("admin", "billing");
});

it("대상 직원에게 전체 권한이 없으면(읽기 강사뷰 포함) 403", async () => {
  m.user.mockImplementation(async (o?: { teacherView: boolean }) => (o?.teacherView ? target : actual));
  m.manage.mockResolvedValue(false);
  expect(await gateImport(def)).toMatchObject({ status: 403 });
});

it("비로그인은 401", async () => {
  m.user.mockResolvedValue(null);
  expect(await gateImport(def)).toMatchObject({ status: 401 });
});
