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
  /** 교시 지우기 실패를 흉내 낸다(반 행은 이미 저장된 뒤의 실패). */
  deleteSlotsError: null as string | null,
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
  deleteCurrentSlots: async () => (h.deleteSlotsError ? { error: h.deleteSlotsError } : {}),
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
  h.deleteSlotsError = null;
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

/**
 * 특강·수업보고서 미발송 켜고 끄기의 감사로그(2026-11-04 사고 — 10-30 JJ 반 일괄 미발송이 기록에 안 남았다).
 * 폼은 hidden("0") + 체크박스("1") 쌍을 보낸다 — 켜면 ["0","1"], 끄면 ["0"], 칸을 모르는 폼은 키가 없다.
 */
describe("반 수정·생성 — 특강·수업보고서 미발송 감사로그", () => {
  const plain = (extra: Record<string, string[]> = {}) => {
    const fd = form({ id: "pl4", className: "PL4", subject: "english", teacherId: "", classroomId: "" });
    for (const [k, vs] of Object.entries(extra)) for (const v of vs) fd.append(k, v);
    return fd;
  };
  const updateLog = () =>
    vi.mocked(logAction).mock.calls.map((c) => c[0]).find((a) => a.action === "class_update");

  it("미발송을 켜면 저장 + '수업보고서 미발송 꺼짐 → 켜짐' 기록", async () => {
    byId(db, "pl4").report_optout = false;
    const res = await updateClass(undefined, plain({ reportOptout: ["0", "1"] }));
    expect(res?.ok).toBe(true);
    expect(byId(db, "pl4").report_optout).toBe(true);
    expect(updateLog()?.metadata).toMatchObject({
      classId: "pl4",
      changed: ["수업보고서 미발송"],
      changes: [{ field: "수업보고서 미발송", from: "꺼짐", to: "켜짐" }],
    });
  });

  // 리뷰 2026-11-04: 반 행은 저장됐는데 교시 저장이 실패해 돌아가면, 다시 저장할 때 이전값이 이미 '켜짐'이라 끝내 기록이 안 남았다.
  it("🔴 교시 저장이 실패해도 이미 저장된 미발송 켜기는 기록한다(note로 실패를 밝힌다)", async () => {
    byId(db, "pl4").report_optout = false;
    h.deleteSlotsError = "스케줄 저장에 실패했습니다.";
    const res = await updateClass(undefined, plain({ reportOptout: ["0", "1"] }));
    expect(res?.error).toBe("스케줄 저장에 실패했습니다.");
    expect(byId(db, "pl4").report_optout).toBe(true);
    expect(updateLog()?.metadata).toMatchObject({
      classId: "pl4",
      changes: [{ field: "수업보고서 미발송", from: "꺼짐", to: "켜짐" }],
      note: "교시 저장 실패 — 반 정보만 저장됨",
    });
  });

  it("교시 저장이 실패해도 켜고 끄는 칸을 안 바꿨으면 기록하지 않는다", async () => {
    byId(db, "pl4").report_optout = true;
    h.deleteSlotsError = "스케줄 저장에 실패했습니다.";
    await updateClass(undefined, plain({ reportOptout: ["0", "1"] }));
    expect(updateLog()).toBeUndefined();
  });

  it("특강을 끄고 미발송을 끄면 둘 다 '켜짐 → 꺼짐'", async () => {
    byId(db, "pl4").is_special = true;
    byId(db, "pl4").report_optout = true;
    await updateClass(undefined, plain({ isSpecial: ["0"], reportOptout: ["0"] }));
    expect(updateLog()?.metadata).toMatchObject({
      changes: [
        { field: "특강", from: "켜짐", to: "꺼짐" },
        { field: "수업보고서 미발송", from: "켜짐", to: "꺼짐" },
      ],
    });
  });

  it("🔴 칸을 안 보낸 폼·같은 값 저장은 기록하지 않는다(다른 변경도 없으면 로그 자체가 없다)", async () => {
    byId(db, "pl4").report_optout = true;
    await updateClass(undefined, plain());
    await updateClass(undefined, plain({ reportOptout: ["0", "1"] }));
    expect(byId(db, "pl4").report_optout).toBe(true);
    expect(updateLog()).toBeUndefined();
  });

  it("반 만들기 기록에 미발송 값을 남긴다", async () => {
    const res = await createClass(
      undefined,
      (() => {
        const fd = form({ className: "JJ9", subject: "math", teacherId: "", classroomId: "" });
        fd.append("reportOptout", "0");
        fd.append("reportOptout", "1");
        return fd;
      })(),
    );
    expect(res?.ok).toBe(true);
    expect(logAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "class_create", metadata: expect.objectContaining({ reportOptout: true, isSpecial: false }) }),
    );
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
