import { beforeEach, describe, expect, it, vi } from "vitest";
import { EIE_TRACK_UNAVAILABLE_MESSAGE } from "../english-track";

type Row = { id: string; tenant_id: string; class_name: string; english_track: string | null; is_active: boolean };

const m = vi.hoisted(() => ({
  user: { id: "owner", tenantId: "tenant-a", systemRole: "master", displayName: "원장" },
  disabled: ["eie"] as string[],
  row: { id: "class-a", tenant_id: "tenant-a", class_name: "PL1", english_track: "eie", is_active: false } as Row,
  updated: 0,
  enrollments: vi.fn(),
  reopenTerm: vi.fn(),
}));

vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => m.user }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canManageTenant: async () => true, accessLevelTenant: async () => "full" }));
vi.mock("@/lib/auth/super-admin", () => ({ isCurrentUserSuperAdmin: async () => false }));
vi.mock("@/features/owner/server/queries", () => ({
  getTenantSettings: async () => ({ modules: { disabled: m.disabled } }),
}));
vi.mock("@/features/audit/server/log", () => ({ logAction: vi.fn() }));
vi.mock("@/features/notifications/server/notify", () => ({ notifyUsers: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("./enrollment-lifecycle", () => ({
  ARCHIVE_REASON: "반 폐지",
  reopenClassEnrollments: (...args: unknown[]) => m.enrollments(...args),
}));
vi.mock("./class-term-store", () => ({
  ClassTermError: class ClassTermError extends Error {},
  endClassWithName: vi.fn(),
  reopenClassWithSchedules: (...args: unknown[]) => m.reopenTerm(...args),
}));
vi.mock("./class-scope", () => ({ requireClassWrite: async () => ({ user: m.user }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const filters: Array<(row: Row) => boolean> = [];
      let patch: Partial<Row> | null = null;
      const query = {
        select: () => query,
        update: (value: Partial<Row>) => {
          patch = value;
          return query;
        },
        eq: (column: keyof Row, value: unknown) => {
          filters.push((row) => row[column] === value);
          return query;
        },
        maybeSingle: async () => ({
          data: filters.every((filter) => filter(m.row)) ? { ...m.row } : null,
          error: null,
        }),
        then: (resolve: (value: unknown) => unknown) => {
          if (patch && filters.every((filter) => filter(m.row))) {
            Object.assign(m.row, patch);
            m.updated += 1;
          }
          return Promise.resolve(resolve({ error: null }));
        },
      };
      return query;
    },
  }),
}));

import { archiveClass, reopenClassTerm } from "./actions";

function form(kind: "archive" | "term") {
  const data = new FormData();
  data.set("id", m.row.id);
  if (kind === "archive") data.set("isActive", "true");
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.user.tenantId = "tenant-a";
  m.disabled = ["eie"];
  m.row = { id: "class-a", tenant_id: "tenant-a", class_name: "PL1", english_track: "eie", is_active: false };
  m.updated = 0;
  m.enrollments.mockResolvedValue({ error: null, studentIds: [] });
  m.reopenTerm.mockResolvedValue({});
});

describe("꺼진 EiE 반 되살리기 차단", () => {
  it("폐지 해제와 재개강을 반 생성과 같은 문구로 거절한다", async () => {
    expect(await archiveClass(undefined, form("archive"))).toEqual({ error: EIE_TRACK_UNAVAILABLE_MESSAGE });
    expect(await reopenClassTerm(undefined, form("term"))).toEqual({ error: EIE_TRACK_UNAVAILABLE_MESSAGE });
    expect(m.updated).toBe(0);
    expect(m.enrollments).not.toHaveBeenCalled();
    expect(m.reopenTerm).not.toHaveBeenCalled();
  });

  it("꺼진 지점의 인재원 영어 반은 종전처럼 되살린다", async () => {
    m.row.english_track = "injaewon";

    await expect(archiveClass(undefined, form("archive"))).resolves.toBeUndefined();
    await expect(reopenClassTerm(undefined, form("term"))).resolves.toBeUndefined();
    expect(m.updated).toBe(1);
    expect(m.enrollments).toHaveBeenCalledOnce();
    expect(m.reopenTerm).toHaveBeenCalledOnce();
  });

  it("EiE가 켜진 침산은 EiE 반도 종전처럼 되살린다", async () => {
    m.user.tenantId = "cs";
    m.row.tenant_id = "cs";
    m.disabled = [];

    await expect(archiveClass(undefined, form("archive"))).resolves.toBeUndefined();
    await expect(reopenClassTerm(undefined, form("term"))).resolves.toBeUndefined();
    expect(m.updated).toBe(1);
    expect(m.enrollments).toHaveBeenCalledOnce();
    expect(m.reopenTerm).toHaveBeenCalledOnce();
  });
});
