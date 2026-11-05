import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PermissionOverride, UserPermissionOverride } from "@/lib/permissions";

// 읽기 강사뷰의 캡이 지운 담당 범위(2026-11-05 강사뷰 적대 리뷰 · 재리뷰) — 읽기 강사뷰는 대상 X의 scoped를 readonly로 누르므로
// `level === "scoped"`로 읽기를 좁히던 자리(반 상세 · 학생 상세)가 학원 전체로 열렸다. 공용 판정 readonlyViewErasedScope는
// X의 **캡 이전** 값(역할 기본 + 학원 설정 + X의 개인 권한)을 본다. view-as · perm-matrix · read-scope는 실제 모듈.
const A_ID = "11111111-1111-4111-8111-111111111111";
const X_ID = "22222222-2222-4222-8222-222222222222";
const m = vi.hoisted(() => ({
  cookies: {} as Record<string, string>,
  overrides: [] as PermissionOverride[],
  userOverrides: [] as UserPermissionOverride[],
  targetRole: "teacher",
  enrollQueries: [] as Record<string, unknown>[],
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (k: string) => (k in m.cookies ? { value: m.cookies[k] } : undefined) }),
  headers: async () => new Headers(),
}));
const actor = { id: A_ID, tenantId: "t1", email: "a@x", displayName: "상담사", jobTitle: null, systemRole: "counselor" as const };
vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: async (o?: { teacherView: boolean }) => {
    if (!o?.teacherView) return actor;
    const { viewAsTeacher } = await import("@/lib/auth/view-as");
    return (await viewAsTeacher()) ?? actor;
  },
}));
vi.mock("@/lib/auth/super-admin", () => ({
  isCurrentUserSuperAdmin: async () => false,
  isSignedInSuperAdmin: async () => false,
  superAdminTargetProtection: async () => "allowed",
}));
vi.mock("@/lib/auth/tenant-view", () => ({
  isTenantViewWriteBlocked: async () => false, isTenantViewRequest: async () => false, tenantViewWriteError: async () => null,
}));
vi.mock("@/lib/license/server", () => ({ isFeatureLicensed: async () => true, isFeatureOptedIn: async () => true }));
vi.mock("@/lib/laboratory/server", () => ({ getLaboratoryMenus: async () => [] }));
vi.mock("@/features/owner/server/queries", () => ({
  getTenantSettings: async () => ({
    modules: { disabled: [] }, makeups: {},
    permissions: { overrides: m.overrides, userOverrides: m.userOverrides, specialAccess: { staffTaskMonitorIds: [] } },
  }),
}));
vi.mock("@/features/classes/server/delegation", () => ({ getDelegatedClassIdsInRange: async () => [] }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ kind: "admin" }) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      let head = false;
      const q: Record<string, unknown> = {
        select: (_cols?: string, opts?: { head?: boolean }) => { head = !!opts?.head; return q; },
        eq: (k: string, v: unknown) => { filters[k] = v; return q; },
        in: (k: string, v: unknown) => { filters[k] = v; return q; },
        or: () => q,
        // users = 강사뷰 대상 검증(loadViewAsTarget).
        maybeSingle: async () => ({
          data: { id: X_ID, tenant_id: "t1", email: "x@x", display_name: "강사X", job_title: null, system_role: m.targetRole, status: "active" },
        }),
        then: (resolve: (v: unknown) => void) => {
          // 담임 반: X = c-x 하나. 교시 담당은 없음. 수강: s-mine만 c-x에 있다.
          // 반 상세 게이트(class-scope)는 행 없이 count만 묻는다(head).
          if (head && table === "classes") return resolve({ count: filters.id === "c-x" && filters.teacher_id === X_ID ? 1 : 0, error: null });
          if (head && table === "class_schedules") return resolve({ count: 0, error: null });
          if (table === "classes") return resolve({ data: filters.teacher_id === X_ID ? [{ id: "c-x" }] : [], error: null });
          if (table === "class_schedules") return resolve({ data: [], error: null });
          if (table === "enrollments") {
            m.enrollQueries.push({ ...filters });
            const hit = filters.student_id === "s-mine" && (filters.class_id as string[]).includes("c-x");
            return resolve({ count: hit ? 1 : 0, error: null });
          }
          return resolve({ data: [], error: null });
        },
      };
      return q;
    },
  }),
}));

import { readonlyViewErasedScope } from "@/lib/auth/perm-matrix";
import { canViewStudentDetail } from "@/features/students/server/read-scope";
import { canViewClassDetail } from "@/features/classes/server/class-scope";

const viewAs = (access: "full" | "readonly") => {
  m.userOverrides = [{ userId: A_ID, menu: "teacher_view", access }];
};

beforeEach(() => {
  // 원장이 상담사에게 '강사뷰 접근'(읽기)을 개인별로 줬고, 상담사가 강사 X를 연다.
  m.cookies = { "eywa-view": "teacher", "eywa-view-as": X_ID };
  m.overrides = [];
  viewAs("readonly");
  m.targetRole = "teacher";
  m.enrollQueries = [];
});

describe("readonlyViewErasedScope — X의 캡 이전 값이 scoped인가", () => {
  it("🔴 읽기 강사뷰로 강사 X를 열면 반 · 학생 모두 담당 범위가 지워졌다고 본다", async () => {
    expect(await readonlyViewErasedScope("classes")).toBe(true);
    expect(await readonlyViewErasedScope("students")).toBe(true);
  });

  it("전체 강사뷰 · 강사뷰 아님은 언제나 false(수준이 scoped 그대로라 종전 판정이 좁힌다)", async () => {
    viewAs("full");
    expect(await readonlyViewErasedScope("classes")).toBe(false);
    m.cookies = {};
    viewAs("readonly");
    expect(await readonlyViewErasedScope("classes")).toBe(false);
  });

  it("X의 개인 권한이 반 전체면 지워진 범위가 없다 — 역할만 보던 옛 판정과 달리 개인 권한까지 본다", async () => {
    m.userOverrides = [...m.userOverrides, { userId: X_ID, menu: "classes", access: "full" }];
    expect(await readonlyViewErasedScope("classes")).toBe(false);
    expect(await readonlyViewErasedScope("students")).toBe(true);
  });

  it("지점 설정이 강사 반 수준을 full로 열어 두었거나 대상 역할이 원래 전체면 false", async () => {
    m.overrides = [{ menu: "classes", role: "teacher", access: "full" }];
    expect(await readonlyViewErasedScope("classes")).toBe(false);
    m.overrides = [];
    m.targetRole = "counselor"; // 같은 역할 대상 — 상담사의 원생 수준은 담당 범위가 아니다
    expect(await readonlyViewErasedScope("students")).toBe(false);
  });
});

describe("학생 상세 — 읽기 강사뷰도 X의 담당 학생만(반 상세와 같은 판정)", () => {
  it("🔴 X의 반 수강생은 열리고, X와 무관한 학생은 닫힌다(재리뷰 재현: 담당 조회 없이 무조건 열렸다)", async () => {
    expect(await canViewStudentDetail("s-other")).toBe(false);
    expect(await canViewStudentDetail("s-mine")).toBe(true);
    expect(m.enrollQueries.length).toBeGreaterThan(0);
    expect(m.enrollQueries.every((f) => (f.class_id as string[]).includes("c-x"))).toBe(true);
  });

  it("전체 강사뷰도 같은 넓이(X = scoped)", async () => {
    viewAs("full");
    expect(await canViewStudentDetail("s-other")).toBe(false);
    expect(await canViewStudentDetail("s-mine")).toBe(true);
  });
});

describe("반 상세 — 같은 판정(실제 perm-matrix · view-as)", () => {
  it("🔴 읽기 강사뷰도 X의 반만 열린다", async () => {
    expect(await canViewClassDetail("c-other")).toBe(false);
    expect(await canViewClassDetail("c-x")).toBe(true);
  });

  it("X의 개인 권한이 반 전체면 종전대로 무제한(캡이 지운 범위가 없다)", async () => {
    m.userOverrides = [...m.userOverrides, { userId: X_ID, menu: "classes", access: "full" }];
    expect(await canViewClassDetail("c-other")).toBe(true);
  });
});
