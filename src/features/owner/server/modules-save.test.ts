import { beforeEach, describe, expect, it, vi } from "vitest";
import { MODULE_IDS } from "@/lib/modules";

type ClassRow = {
  tenant_id: string;
  class_name: string;
  english_track: string | null;
  is_active: boolean;
  closed_at: string | null;
};

const m = vi.hoisted(() => ({
  classes: [] as ClassRow[],
  classError: null as null | { message: string },
  writes: 0,
  audit: vi.fn(),
}));

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: async () => ({ id: "owner", tenantId: "tenant-a", systemRole: "master", displayName: "원장" }),
}));
vi.mock("@/lib/auth/perm-matrix", () => ({ canWriteTenant: async () => true }));
vi.mock("@/lib/auth/super-admin", () => ({ isCurrentUserSuperAdmin: async () => false }));
vi.mock("@/features/audit/server/log", () => ({ logAction: m.audit }));
vi.mock("./queries", () => ({ tenantSettingsTag: (id: string) => `settings:${id}` }));
vi.mock("next/cache", () => ({ updateTag: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/lib/date-kst", async (original) => ({ ...(await original<object>()), kstToday: () => "2026-11-12" }));
vi.mock("@/lib/storage/media-storage", () => ({ createUploadTicket: vi.fn(), MEDIA_KIND: {} }));
vi.mock("./platform-settings", () => ({ platformSettingsError: async () => null }));

const stored = {
  data: { preset: "generic", modules: { disabled: [], known: [...MODULE_IDS] } },
  updated_at: "2026-11-12T00:00:00.000Z",
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      if (table === "tenant_settings") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: stored, error: null }) }) }),
          update: () => {
            const writer = {
              eq: () => writer,
              select: async () => {
                m.writes += 1;
                return { data: [{ tenant_id: "tenant-a" }], error: null };
              },
            };
            return writer;
          },
        };
      }

      const filters: Array<(row: ClassRow) => boolean> = [];
      let limit = Number.POSITIVE_INFINITY;
      const query = {
        select: () => query,
        eq: (column: keyof ClassRow, value: unknown) => {
          filters.push((row) => row[column] === value);
          return query;
        },
        or: (expression: string) => {
          const conditions = expression.split(",").map((part) => {
            const [column, operator, ...rest] = part.split(".");
            const value = rest.join(".");
            return (row: ClassRow) => operator === "is"
              ? row[column as keyof ClassRow] === null
              : operator === "gte" && row[column as keyof ClassRow] != null
                ? String(row[column as keyof ClassRow]) >= value
                : false;
          });
          filters.push((row) => conditions.some((condition) => condition(row)));
          return query;
        },
        order: () => query,
        limit: (value: number) => {
          limit = value;
          return query;
        },
        then: (resolve: (value: unknown) => unknown) => {
          const matched = m.classes.filter((row) => filters.every((filter) => filter(row)));
          return Promise.resolve(resolve({
            data: matched.slice(0, limit).map(({ class_name }) => ({ class_name })),
            count: matched.length,
            error: m.classError,
          }));
        },
      };
      return query;
    },
  }),
}));

import { saveOwnerSection } from "./actions";

function form() {
  const data = new FormData();
  data.set("section", "modules");
  data.set("data", JSON.stringify({ disabled: ["eie"], known: MODULE_IDS }));
  return data;
}

const row = (value: Partial<ClassRow> & Pick<ClassRow, "class_name">): ClassRow => ({
  tenant_id: "tenant-a",
  english_track: "eie",
  is_active: true,
  closed_at: null,
  ...value,
});

beforeEach(() => {
  vi.clearAllMocks();
  m.classes = [];
  m.classError = null;
  m.writes = 0;
});

describe("기능 면 저장의 EiE 보호", () => {
  it("지난 종강 반과 폐지 반만 있으면 EiE를 끌 수 있다", async () => {
    m.classes = [
      row({ class_name: "옛 종강반", closed_at: "2024-12-31" }),
      row({ class_name: "폐지반", is_active: false, closed_at: null }),
      row({ tenant_id: "tenant-b", class_name: "다른 지점 운영반", closed_at: null }),
    ];

    await expect(saveOwnerSection(undefined, form())).resolves.toMatchObject({ ok: true });
    expect(m.writes).toBe(1);
  });

  it("활성 상태이며 아직 종강하지 않은 EiE 반만 저장을 막는다", async () => {
    m.classes = [
      row({ class_name: "운영반", closed_at: null }),
      row({ class_name: "종강 예정반", closed_at: "2026-11-12" }),
      row({ class_name: "폐지반", is_active: false, closed_at: null }),
    ];

    const result = await saveOwnerSection(undefined, form());
    expect(result?.error).toContain("운영 중인 EiE 반 2개");
    expect(result?.error).toContain("먼저 종강하거나 '인재원 영어'로 바꾸세요");
    expect(m.writes).toBe(0);
  });

  it("반 조회 실패 때도 끄기를 허용하지 않는다", async () => {
    m.classError = { message: "조회 실패" };

    expect((await saveOwnerSection(undefined, form()))?.error).toContain("EiE 반을 확인하지 못해 기능을 끄지 않았습니다");
    expect(m.writes).toBe(0);
  });
});
