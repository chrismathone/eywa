import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../defaults";
import { operationsForViewer } from "../seat-pin-view";
import type { OperationsSettings } from "../settings-types";

/**
 * 자리 PIN과 운영 설정 저장(2026-10-03 운영점검 합의 A15) — 실제 저장 액션으로 확인한다.
 *  · 읽기 전용 열람자가 받은(값이 지워진) payload로 저장을 시도하면 거절되고 저장값은 그대로다.
 *  · 편집자가 다른 항목만 고쳐 저장하면(과목 운영 면) PIN이 그대로 저장된다.
 *  · 값이 지워진 payload는 편집 권한이 있어도 검증에서 떨어진다(렌더와 저장 사이에 권한이 바뀐 경우).
 * 합성 값만 쓴다.
 */
const SYNTHETIC_LAB = "Zq7!labPIN";
const SYNTHETIC_JJ = "Xk3#jjPIN";

const m = vi.hoisted(() => ({
  actor: { id: "actor", tenantId: "tenant-a", systemRole: "manager" },
  allowed: true,
  askedMenus: [] as string[],
  stored: null as unknown,
  write: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => m.actor }));
vi.mock("@/lib/auth/perm-matrix", () => ({
  canWriteTenant: async (_role: string, menu: string) => {
    m.askedMenus.push(menu);
    return m.allowed;
  },
}));
vi.mock("@/lib/auth/super-admin", () => ({ isCurrentUserSuperAdmin: async () => false }));
vi.mock("@/features/audit/server/log", () => ({ logAction: m.audit }));
vi.mock("./queries", () => ({ tenantSettingsTag: (id: string) => `settings:${id}` }));
vi.mock("next/cache", () => ({ updateTag: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({ select: () => ({ in: async () => ({ data: [], error: null }) }) }) }),
}));
vi.mock("./dashboard-assignments", () => ({ validateDashboardAssignments: vi.fn() }));
vi.mock("@/lib/storage/media-storage", () => ({ createUploadTicket: vi.fn(), MEDIA_KIND: {} }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const writer = { eq: () => writer, select: async () => ({ data: [{ tenant_id: "tenant-a" }], error: null }) };
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: m.stored, error: null }) }) }),
        update: (value: unknown) => {
          m.write("update", value);
          return writer;
        },
        insert: (value: unknown) => {
          m.write("insert", value);
          return writer;
        },
      };
    },
  }),
}));
import { saveOwnerSection } from "./actions";

const storedOperations = (): OperationsSettings => ({
  ...DEFAULT_SETTINGS.operations,
  seatPins: { lab: SYNTHETIC_LAB, jj: SYNTHETIC_JJ },
});
const form = (data: unknown) => {
  const fd = new FormData();
  fd.set("section", "operations");
  fd.set("data", JSON.stringify(data));
  return fd;
};
const savedOperations = () =>
  (m.write.mock.calls[0]![1] as { data: { operations: OperationsSettings } }).data.operations;

beforeEach(() => {
  vi.clearAllMocks();
  m.allowed = true;
  m.askedMenus = [];
  m.stored = { data: { operations: storedOperations() }, updated_at: "2026-10-03T00:00:00Z" };
});

describe("읽기 전용 열람자", () => {
  it("🔴 값이 지워진 payload로 저장을 시도하면 거절되고 아무것도 쓰지 않는다", async () => {
    m.allowed = false;
    const result = await saveOwnerSection(undefined, form(operationsForViewer(storedOperations(), false)));
    expect(result?.ok).toBeUndefined();
    expect(result?.error).toBe("학원 설정 변경 권한이 없습니다");
    expect(m.write).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
    // 판정 키 = 운영 설정(화면이 PIN을 지울지 정하는 키와 같다).
    expect(m.askedMenus).toEqual(["operations_settings"]);
  });

  it("실제 값을 알아맞혀 보내도 권한이 없으면 거절된다", async () => {
    m.allowed = false;
    const result = await saveOwnerSection(undefined, form({ ...storedOperations(), seatPins: { lab: "", jj: "" } }));
    expect(result?.error).toBeTruthy();
    expect(m.write).not.toHaveBeenCalled();
  });
});

describe("편집자", () => {
  it("과목 운영 면처럼 다른 항목만 고쳐 저장하면 PIN이 그대로 저장된다", async () => {
    const edited = storedOperations();
    const submitted = {
      ...edited,
      subjects: edited.subjects.map((s, i) => (i === 0 ? { ...s, label: `${s.label}X` } : s)),
    };
    const result = await saveOwnerSection(undefined, form(submitted));
    expect(result?.ok).toBe(true);
    expect(m.write).toHaveBeenCalledTimes(1);
    expect(savedOperations().seatPins).toEqual({ lab: SYNTHETIC_LAB, jj: SYNTHETIC_JJ });
    expect(savedOperations().subjects[0]!.label).toBe(`${edited.subjects[0]!.label}X`);
  });

  it("칸을 비워 저장하면 그 자리만 꺼진다(비우기 = 끄기 그대로)", async () => {
    const result = await saveOwnerSection(undefined, form({ ...storedOperations(), seatPins: { lab: SYNTHETIC_LAB, jj: "" } }));
    expect(result?.ok).toBe(true);
    expect(savedOperations().seatPins).toEqual({ lab: SYNTHETIC_LAB, jj: "" });
  });

  it("🔴 값이 지워진 payload는 편집 권한이 있어도 검증에서 떨어진다 — PIN을 덮어쓰지 못한다", async () => {
    const result = await saveOwnerSection(undefined, form(operationsForViewer(storedOperations(), false)));
    expect(result?.ok).toBeUndefined();
    expect(result?.error).toContain("seatPins");
    expect(m.write).not.toHaveBeenCalled();
  });

  it("감사 기록에 PIN 값이 실리지 않는다", async () => {
    await saveOwnerSection(undefined, form({ ...storedOperations(), seatPins: { lab: "N3w!pin", jj: SYNTHETIC_JJ } }));
    const logged = JSON.stringify(m.audit.mock.calls);
    expect(logged).not.toContain("N3w!pin");
    expect(logged).not.toContain(SYNTHETIC_LAB);
  });
});
