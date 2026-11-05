/**
 * 연결 앱 단일 판정 `getMyConnectedApps`의 **실제 동작** — 지점 스위치 → 본인 권한 표(역할·개인) → 담당 과목(원장 2026-11-05).
 * 원문 정규식 가드(apps.test.ts)와 따로, 사람마다 무엇이 서는지 본다.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveMatrix, type AccessMatrix, type PermissionOverride } from "@/lib/permissions";

const h = vi.hoisted(() => ({
  user: null as null | { id: string; tenantId: string; systemRole: string; tenantView?: boolean },
  optedIn: true,
  matrix: null as unknown as AccessMatrix,
  superAdmin: false,
  subjects: [] as string[] | null,
  subjectQueries: 0,
}));

vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => h.user }));
vi.mock("@/lib/license/server", () => ({ isFeatureOptedIn: async () => h.optedIn }));
vi.mock("@/lib/auth/perm-matrix", () => ({ getActorPermMatrix: async () => h.matrix }));
vi.mock("@/lib/auth/super-admin", () => ({ isCurrentUserSuperAdmin: async () => h.superAdmin }));
vi.mock("@/lib/auth/user-menu-blocks", () => ({ USER_MENU_BLOCKS: { "blocked-user": ["app_todays_math"] } }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            h.subjectQueries += 1;
            return { data: { subjects: h.subjects }, error: null };
          },
        }),
      }),
    }),
  }),
}));

const { getMyConnectedApps } = await import("./visible");
const run = async () => (await getMyConnectedApps()).map((a) => a.feature);
const as = (systemRole: string, extra: Partial<NonNullable<typeof h.user>> = {}) => {
  h.user = { id: "u1", tenantId: "t1", systemRole, ...extra };
};
const withOverrides = (overrides: PermissionOverride[]) => {
  h.matrix = resolveMatrix(overrides);
};

beforeEach(() => {
  h.user = null;
  h.optedIn = true;
  h.superAdmin = false;
  h.subjects = ["math"];
  h.subjectQueries = 0;
  withOverrides([]);
});

describe("getMyConnectedApps — 연결 앱을 세울 사람", () => {
  it("기본값: 강사 이상(원장·관리자·매니저·강사)에게만 선다 — 상담·회계·열람·아르바이트는 없다", async () => {
    for (const role of ["master", "admin", "manager", "teacher"]) {
      as(role);
      expect(await run(), role).toEqual(["todays_math"]);
    }
    for (const role of ["counselor", "accountant", "viewer", "parttime"]) {
      as(role);
      expect(await run(), role).toEqual([]);
    }
  });

  it("역할 표에서 끄면 그 역할에는 서지 않는다 · 켜면 선다(아르바이트도)", async () => {
    withOverrides([
      { menu: "app_todays_math", role: "teacher", access: "none" },
      { menu: "app_todays_math", role: "parttime", access: "full" },
    ]);
    as("teacher");
    expect(await run()).toEqual([]);
    as("parttime");
    expect(await run()).toEqual(["todays_math"]);
  });

  it("권한이 없으면 담당 과목을 조회하지 않는다(대부분의 직원은 조회 0)", async () => {
    as("viewer");
    await run();
    expect(h.subjectQueries).toBe(0);
  });

  it("지점 스위치가 꺼졌거나 운영 콘솔 '지점 보기'면 아무에게도 안 선다", async () => {
    h.optedIn = false;
    as("master");
    expect(await run()).toEqual([]);
    h.optedIn = true;
    as("master", { tenantView: true });
    expect(await run()).toEqual([]);
  });

  it("영어만 맡은 선생님에게는 권한이 있어도 안 선다(과목 축) — 총괄은 과목 축을 건너뛴다", async () => {
    h.subjects = ["english"];
    as("teacher");
    expect(await run()).toEqual([]);
    h.superAdmin = true;
    expect(await run()).toEqual(["todays_math"]);
  });

  it("총괄은 권한 축도 통과한다 — 단 개인 메뉴 차단은 따른다", async () => {
    h.superAdmin = true;
    withOverrides([{ menu: "app_todays_math", role: "admin", access: "none" }]);
    as("admin");
    expect(await run()).toEqual(["todays_math"]);
    h.user = { id: "blocked-user", tenantId: "t1", systemRole: "admin" };
    expect(await run()).toEqual([]);
  });
});
