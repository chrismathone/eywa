import { beforeEach, describe, expect, it, vi } from "vitest";
import { logAction } from "@/features/audit/server/log";
import { FREE_CLOSED_NAME_FIELDS } from "../class-name-conflict";
import { byId, fakeClassesDb, type FakeClassRow } from "./fake-classes-db.test-support";

/**
 * 반 수정·생성 액션 흐름 — 반 이름이 종강·폐지 반과 겹칠 때(원장 2026-10-01, 침산 PL4 → PL5).
 * 쓰기 게이트·교시 동기화·설정은 모킹하고, `classes` 표만 메모리 DB(유니크 인덱스 흉내)로 둔다.
 */
const h = vi.hoisted(() => ({
  db: null as unknown,
  canManage: true,
  user: { id: "u1", tenantId: "tenant-a", systemRole: "master", displayName: "원장" },
}));

vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => h.user }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => h.db }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db }));
vi.mock("@/features/owner/server/queries", async () => {
  const { DEFAULT_SETTINGS } = await import("@/features/owner/defaults");
  return { getTenantSettings: async () => DEFAULT_SETTINGS };
});
vi.mock("@/lib/auth/perm-matrix", () => ({
  canManageTenant: async () => h.canManage,
  accessLevelTenant: async () => (h.canManage ? "full" : "scoped"),
}));
vi.mock("@/lib/auth/super-admin", () => ({ isCurrentUserSuperAdmin: async () => false }));
vi.mock("@/features/audit/server/log", () => ({ logAction: vi.fn() }));
vi.mock("@/features/notifications/server/notify", () => ({ notifyUsers: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/date-kst", async (orig) => ({ ...(await orig<object>()), kstToday: () => "2026-10-01" }));
vi.mock("./class-scope", () => ({ requireClassWrite: async () => ({ user: h.user }) }));
vi.mock("./overlap-detect", () => ({ detectOverlaps: async () => [] }));
vi.mock("./schedule-sync", () => ({
  loadCurrentSlots: async () => ({ rows: [], labSeparateSupported: false }),
  deleteCurrentSlots: async () => ({}),
}));
vi.mock("./queries", () => ({ getClassroomAssignmentData: vi.fn() }));
vi.mock("./handover", () => ({ moveLiveSlotTeacher: vi.fn() }));
vi.mock("./enrollment-lifecycle", () => ({}));

const { createClass, updateClass } = await import("./actions");

const row = (p: Partial<FakeClassRow> & { id: string; class_name: string }): FakeClassRow => ({
  tenant_id: "tenant-a",
  subject: "english",
  is_active: true,
  closed_at: null,
  teacher_id: null,
  classroom_id: null,
  ...p,
});

function form(entries: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

const editForm = (extra: Record<string, string> = {}) =>
  form({ id: "pl4", className: "PL5", subject: "english", teacherId: "", classroomId: "", ...extra });

const pressFreeButton = (to = "PL5 (~26.07.02)") => ({
  [FREE_CLOSED_NAME_FIELDS.flag]: "1",
  [FREE_CLOSED_NAME_FIELDS.name]: "PL5",
  [FREE_CLOSED_NAME_FIELDS.holderId]: "old-pl5",
  [FREE_CLOSED_NAME_FIELDS.to]: to,
});

let db: ReturnType<typeof fakeClassesDb>;
beforeEach(() => {
  vi.mocked(logAction).mockClear();
  h.canManage = true;
  db = fakeClassesDb([
    row({ id: "pl4", class_name: "PL4" }),
    row({ id: "old-pl5", class_name: "PL5", is_active: false, closed_at: "2026-07-02" }),
  ]);
  h.db = db;
});

describe("반 수정 — 종강·폐지 반이 쥔 이름으로 개명", () => {
  it("버튼 없이 저장하면 일반 실패가 아니라 반 이름 칸에 '중복되는 반 이름(종강 처리된 반)' + 버튼 정보", async () => {
    const res = await updateClass(undefined, editForm());
    expect(res?.error).toBeUndefined();
    expect(res?.fieldErrors?.className).toBe("같은 과목에 중복되는 반 이름이 있습니다. (종강 처리된 반)");
    expect(res?.nameConflict).toMatchObject({ holderId: "old-pl5", freeTo: "PL5 (~26.07.02)" });
    expect(byId(db, "old-pl5").class_name).toBe("PL5");
    expect(byId(db, "pl4").class_name).toBe("PL4");
  });

  it("버튼을 누른 요청 → 그 반을 'PL5 (~26.07.02)'로 비우고 저장 + 두 반 모두 감사로그", async () => {
    const res = await updateClass(undefined, editForm(pressFreeButton()));
    expect(res?.ok).toBe(true);
    expect(byId(db, "old-pl5").class_name).toBe("PL5 (~26.07.02)");
    expect(byId(db, "pl4").class_name).toBe("PL5");
    const calls = vi.mocked(logAction).mock.calls.map((c) => c[0]);
    expect(calls).toEqual([
      expect.objectContaining({ targetLabel: "PL5 (~26.07.02)", metadata: expect.objectContaining({ classId: "old-pl5", freedForClassId: "pl4" }) }),
      expect.objectContaining({
        targetLabel: "PL5",
        metadata: expect.objectContaining({ classId: "pl4", changes: [{ field: "반 이름", from: "PL4", to: "PL5" }] }),
      }),
    ]);
  });

  it("운영 중인 반과 겹치면 문구만 — 버튼 요청을 위조해 보내도 그 반은 그대로", async () => {
    byId(db, "old-pl5").is_active = true;
    byId(db, "old-pl5").closed_at = null;
    const res = await updateClass(undefined, editForm(pressFreeButton()));
    expect(res?.fieldErrors?.className).toBe("같은 과목에 중복되는 반 이름이 있습니다. (운영 중인 반)");
    expect(res?.nameConflict?.freeTo).toBeNull();
    expect(byId(db, "old-pl5").class_name).toBe("PL5");
    expect(logAction).not.toHaveBeenCalled();
  });

  it("강사(관리자 아님)는 남의 반 이름을 비울 수 없다 — 문구만, 요청은 무시", async () => {
    h.canManage = false;
    const res = await updateClass(undefined, editForm(pressFreeButton()));
    expect(res?.nameConflict).toMatchObject({ status: "closed", freeTo: null });
    expect(byId(db, "old-pl5").class_name).toBe("PL5");
  });
});

describe("반 생성 — 같은 이름", () => {
  it("종강 반 이름으로 새 반 → 버튼 정보, 누르면 비우고 생성", async () => {
    const base = { className: "PL5", subject: "english", teacherId: "", classroomId: "" };
    const first = await createClass(undefined, form(base));
    expect(first?.nameConflict).toMatchObject({ status: "closed", freeTo: "PL5 (~26.07.02)" });
    expect(db.rows.filter((r) => r.class_name === "PL5")).toHaveLength(1);

    const second = await createClass(undefined, form({ ...base, ...pressFreeButton() }));
    expect(second?.ok).toBe(true);
    expect(byId(db, "old-pl5").class_name).toBe("PL5 (~26.07.02)");
    expect(db.rows.filter((r) => r.class_name === "PL5")).toHaveLength(1);
    expect(logAction).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ classId: "old-pl5" }) }));
  });
});
