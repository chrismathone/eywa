/**
 * 강사 홈 출결 스트립의 '데스크 확인 요청'과 결석 후속 조치 기록은 **화면 주인**으로 담당·명의를 정한다(2026-11-05 강사뷰 신원 점검).
 *
 * 사고 모양: 관리자 A가 '다른 강사 뷰'로 강사 X의 홈을 열면 스트립엔 X의 수업이 뜨는데(보드는 effectiveTeacherId), 버튼을 누르면
 * 서버가 실제 계정 A의 담당 반으로 판정해 "담당 반이 아닙니다"로 거절했다. 조치 기록의 처리자·작성자도 A로 남았다.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const A = { id: "a-admin", tenantId: "t1", email: "", displayName: "원장", jobTitle: null, systemRole: "admin" as const };
const X = { id: "x-teacher", tenantId: "t1", email: "", displayName: "강사X", jobTitle: null, systemRole: "teacher" as const };

const m = vi.hoisted(() => ({
  user: vi.fn(),
  level: vi.fn(),
  canWrite: vi.fn(),
  teaching: vi.fn(),
  slots: vi.fn(),
  optin: vi.fn(),
  notify: vi.fn(),
  upserts: [] as Record<string, unknown>[],
  eqs: [] as unknown[][],
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/auth/perm-matrix", () => ({ accessLevelTenant: m.level, canWriteTenant: m.canWrite }));
vi.mock("@/features/audit/server/log", () => ({ logAction: vi.fn() }));
vi.mock("@/features/classes/server/delegation", () => ({ getTeachingClassIds: m.teaching, getActiveDelegationsForClasses: vi.fn(async () => []) }));
vi.mock("@/lib/observability/report-error", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/supabase/db-error", () => ({ logDbError: vi.fn() }));
vi.mock("@/features/notifications/server/notify", () => ({ notifyUsers: m.notify }));
vi.mock("./load", () => ({ loadLiveSlots: m.slots }));
vi.mock("./cross-notify", () => ({ loadDeskOptin: m.optin }));

function builder(table: string, result: () => unknown) {
  const q: Record<string, unknown> = {};
  for (const name of ["select", "lte", "or", "limit", "in", "is"]) q[name] = () => q;
  q.eq = (k: string, v: unknown) => { m.eqs.push([table, k, v]); return q; };
  q.upsert = (row: Record<string, unknown>) => { m.upserts.push({ table, ...row }); return q; };
  q.maybeSingle = async () => result();
  q.then = (resolve: (v: unknown) => void) => resolve(result());
  return q;
}
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) =>
      builder(table, () => (table === "attendance_followups" ? { data: { id: "fu-1" }, error: null } : { data: [], error: null })),
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: (table: string) => builder(table, () => ({ data: [{ bucket: "b" }], error: null })) }),
}));

import { recordFollowup, requestDeskConfirm } from "./actions";

const PAST = "2026-01-05"; // 지난 날짜 — 교시 시작 전 판정이 끼지 않는다

beforeEach(() => {
  vi.clearAllMocks();
  m.upserts = [];
  m.eqs = [];
  m.user.mockImplementation(async (o?: { teacherView?: boolean }) => (o?.teacherView ? X : A));
  m.level.mockResolvedValue("scoped"); // A의 역할 줄도 X 값으로 덮인다(getUserPermMatrix)
  m.canWrite.mockResolvedValue(true);
  m.teaching.mockImplementation(async (_db: unknown, id: string) => ({ all: id === X.id ? ["c-x"] : ["c-a"] }));
  m.slots.mockResolvedValue([
    {
      saveSlot: null, slotTeacherLabel: null, slotStart: "09:00", slotEnd: "10:00", className: "X반",
      students: [{ status: null, studentId: "s1", studentName: "학생1" }],
    },
  ]);
  m.optin.mockResolvedValue(["desk-1"]);
  m.notify.mockResolvedValue(undefined);
});

describe("데스크 확인 요청(강사 → 데스크)", () => {
  it("대상 강사 X의 수업이면 통과하고, 요청자·수신자 제외도 X다", async () => {
    expect(await requestDeskConfirm({ classId: "c-x", sessionDate: PAST, slotStart: null })).toEqual({ ok: true, sent: true });
    expect(m.user).toHaveBeenCalledWith({ teacherView: true });
    expect(m.teaching).toHaveBeenCalledWith(expect.anything(), X.id, PAST);
    expect(m.eqs).toContainEqual(["class_schedules", "teacher_id", X.id]);
    expect(m.optin).toHaveBeenCalledWith(expect.anything(), "t1", X.id);
    expect(m.notify.mock.calls[0]![0][0]).toMatchObject({ actorId: X.id, recipientId: "desk-1" });
  });

  it("실제 계정 A의 반이어도 X 화면에서는 남의 반이다", async () => {
    expect(await requestDeskConfirm({ classId: "c-a", sessionDate: PAST, slotStart: null })).toEqual({ error: "담당 반이 아닙니다" });
    expect(m.notify).not.toHaveBeenCalled();
  });

  it("읽기 강사뷰(수준 readonly)는 요청하지 못한다", async () => {
    m.level.mockResolvedValue("readonly");
    expect(await requestDeskConfirm({ classId: "c-x", sessionDate: PAST, slotStart: null })).toEqual({ error: "출결 요청 권한이 없습니다" });
  });
});

describe("결석 후속 조치 기록", () => {
  it("담당 판정과 처리자·작성자가 대상 강사 X다", async () => {
    const res = await recordFollowup({ studentId: "s1", classId: "c-x", sessionDate: PAST, signal: "absent", state: "resolved" });
    expect(res).toEqual({ ok: true, id: "fu-1" });
    expect(m.teaching).toHaveBeenCalledWith(expect.anything(), X.id, PAST);
    expect(m.upserts[0]).toMatchObject({ table: "attendance_followups", handled_by: X.id, created_by: X.id, tenant_id: "t1" });
  });

  it("A의 반 학생은 X 화면에서 기록하지 못한다", async () => {
    expect(await recordFollowup({ studentId: "s1", classId: "c-a", sessionDate: PAST, signal: "absent", state: "open" })).toEqual({ error: "담당 반이 아닙니다" });
    expect(m.upserts).toHaveLength(0);
  });

  it("읽기 강사뷰는 쓰기 게이트(canWriteTenant)에서 막힌다", async () => {
    m.canWrite.mockResolvedValue(false);
    expect(await recordFollowup({ studentId: "s1", classId: "c-x", sessionDate: PAST, signal: "absent", state: "open" })).toEqual({ error: "출결 확인 권한이 없습니다" });
  });
});
