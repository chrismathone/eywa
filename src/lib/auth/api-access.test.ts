import { beforeEach, expect, it, vi } from "vitest";
import { resolveMatrix } from "@/lib/permissions";

/**
 * API 게이트 = 페이지 게이트(requireAccess)와 같은 매트릭스(역할 override + **개인별 권한**).
 * 2026-11-05 리뷰: 역할 매트릭스만 보던 시절엔 개인별 권한으로 원생목록을 연 아르바이트가 화면은 여는데
 * 학생 요약 창(/api/students/[id]/summary)에서 403을 받았다.
 */
const m = vi.hoisted(() => ({ user: { id: "u1", systemRole: "parttime", tenantId: "t1" } as Record<string, unknown> | null }));
vi.mock("./current-user", () => ({ getCurrentUser: async () => m.user }));
vi.mock("./perm-matrix", () => ({
  // 개인별 권한 반영본 — 이 사람에게 원생목록 '조회'가 열려 있다.
  getUserPermMatrix: async () => resolveMatrix([{ menu: "students", role: "parttime", access: "readonly" }]),
  // 역할만 본 매트릭스 — 아르바이트 기본값(none). 이걸 보면 403이 난다.
  getPermMatrix: async () => resolveMatrix([]),
}));
import { apiAccess } from "./api-access";

beforeEach(() => {
  m.user = { id: "u1", systemRole: "parttime", tenantId: "t1" };
});

it("개인별 권한으로 연 메뉴는 API도 통과한다", async () => {
  await expect(apiAccess("students")).resolves.toMatchObject({ ok: true });
});

it("열리지 않은 메뉴는 403", async () => {
  await expect(apiAccess("documents")).resolves.toEqual({ ok: false, status: 403 });
});

it("로그인이 없으면 401", async () => {
  m.user = null;
  await expect(apiAccess("students")).resolves.toEqual({ ok: false, status: 401 });
});
