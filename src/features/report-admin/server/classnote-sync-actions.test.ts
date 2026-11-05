import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncRequestRow } from "../classnote-sync";

/**
 * 지금 반 보드 동기화 서버 액션 — 중복(23505)·멈춘 요청 인수·쿨다운·권한·모듈 게이트·지점 격리.
 * DB는 조회·합치기 모듈(classnote-sync-core)을 모킹하고, 액션이 직접 쓰는 insert/update/count만 가짜 빌더로 받는다.
 */
const m = vi.hoisted(() => ({
  user: vi.fn(),
  settings: vi.fn(),
  canWrite: vi.fn(),
  readonly: vi.fn(),
  loadRows: vi.fn(),
  workerOk: vi.fn(),
  merge: vi.fn(),
  report: vi.fn(),
  log: vi.fn(),
  calls: [] as { table: string; op: string; args: unknown[] }[],
  insertResult: { data: { id: "new" }, error: null } as { data: unknown; error: unknown },
  boardCount: 3,
  autoSync: false,
  superAdmin: vi.fn(),
}));

vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canWriteTenant: m.canWrite }));
vi.mock("@/lib/auth/super-admin", () => ({ isCurrentUserSuperAdmin: m.superAdmin }));
vi.mock("@/lib/auth/view-mode", () => ({ readonlyTeacherViewError: m.readonly }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: m.settings }));
vi.mock("@/features/audit/server/log", () => ({ logAction: m.log }));
vi.mock("./classnote-sync-core", () => ({
  loadSyncRows: m.loadRows,
  workerAcceptsSyncRequests: m.workerOk,
  loadWorkerSyncState: async (...a: unknown[]) => ({ ready: (await m.workerOk(...a)) === true, autoSync: m.autoSync }),
  mergeIntoPending: m.merge,
  isMissingTableError: (e: { code?: string }) => e?.code === "42P01" || e?.code === "PGRST205",
}));
vi.mock("./classnote-sync-report-core", () => ({ loadSyncReportSummary: m.report }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      let op = "select";
      const b: Record<string, unknown> = {};
      const rec = (name: string) => (...args: unknown[]) => {
        if (name === "insert" || name === "update") op = name;
        m.calls.push({ table, op: name, args });
        return b;
      };
      for (const k of ["select", "eq", "in", "update", "insert", "order", "limit"]) b[k] = rec(k);
      b.single = () => Promise.resolve(op === "insert" ? m.insertResult : { data: null, error: null });
      b.then = (res: (v: unknown) => unknown) =>
        Promise.resolve(table === "classnote_class_boards" ? { count: m.boardCount, error: null } : { data: [], error: null }).then(res);
      return b;
    },
  }),
}));

import { getClassnoteSyncStatus, requestClassnoteBoardSync } from "./classnote-sync-actions";
import { runAsAutoSyncRequest } from "./classnote-sync-auto";

const CLASS_ID = "11111111-1111-4111-8111-111111111111";
const STUDENT_ID = "22222222-2222-4222-8222-222222222222";
const iso = (minAgo: number) => new Date(Date.now() - minAgo * 60_000).toISOString();
const row = (p: Partial<SyncRequestRow>): SyncRequestRow => ({
  id: "r1",
  status: "pending",
  requestedAt: iso(1),
  startedAt: null,
  finishedAt: null,
  result: null,
  error: null,
  scope: { full: true, classIds: [], studentIds: [] },
  mergeCount: 0,
  nextScope: null,
  ...p,
});

beforeEach(() => {
  vi.clearAllMocks();
  m.calls.length = 0;
  m.insertResult = { data: { id: "new" }, error: null };
  m.boardCount = 3;
  m.user.mockResolvedValue({ id: "u1", tenantId: "t1", systemRole: "admin", displayName: "관리자" });
  m.settings.mockResolvedValue({ modules: { disabled: [] }, report: {} });
  m.canWrite.mockResolvedValue(true);
  m.superAdmin.mockResolvedValue(false);
  m.readonly.mockResolvedValue(null);
  m.loadRows.mockResolvedValue({ active: null, latest: null });
  m.workerOk.mockResolvedValue(true);
  m.merge.mockResolvedValue(false);
  m.report.mockResolvedValue(null);
});

describe("동기화 보고서 요약(0329a) — 동기화 상태와 한 번에", () => {
  const summary = { finishedAt: "2026-10-01T20:12:00Z", ok: true, changed: 2, failed: 1, held: 3, releaseNames: 3, releaseClasses: 2, dailyFailed: 0, dailyStopped: false };
  it("보고서 쓰기 권한이 있으면 요약이 실린다 — 지점 id로 읽는다", async () => {
    m.report.mockResolvedValue(summary);
    const s = await getClassnoteSyncStatus();
    expect(s.available).toBe(true);
    expect(s.report).toEqual(summary);
    expect(m.report).toHaveBeenCalledWith(expect.anything(), "t1");
  });
  it("🔴 강사에게는 버튼이 서지 않는다 — 상태도, 전 반의 학생·원아 이름이 든 보고서 요약도 읽지 않는다", async () => {
    m.user.mockResolvedValue({ id: "u2", tenantId: "t1", systemRole: "teacher", displayName: "강사" });
    m.canWrite.mockResolvedValue(false);
    m.report.mockResolvedValue(summary);
    const s = await getClassnoteSyncStatus();
    expect(s.available).toBe(false);
    expect(s.report).toBeNull();
    expect(m.report).not.toHaveBeenCalled();
    expect(m.loadRows).not.toHaveBeenCalled();
  });
  it("회차 기록이 없거나 표가 없으면(null) 버튼만 빠지고 동기화 버튼은 그대로", async () => {
    const s = await getClassnoteSyncStatus();
    expect(s).toMatchObject({ available: true, report: null });
  });
});

const inserts = () => m.calls.filter((c) => c.table === "classnote_sync_requests" && c.op === "insert");

describe("요청", () => {
  it("정상 — 지점 id로 넣고 감사로그를 남긴다", async () => {
    const r = await requestClassnoteBoardSync({ source: "test" });
    expect(r.ok).toBe(true);
    expect(inserts()[0].args[0]).toMatchObject({ tenant_id: "t1", requested_by: "u1", scope: { full: true } });
    expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ action: "classnote_board_sync_request" }));
  });

  it("🔴 23505(다른 화면이 먼저 넣음) = 실패가 아니라 그 요청에 합친다 · 감사로그는 '합류'로", async () => {
    m.insertResult = { data: null, error: { code: "23505", message: "duplicate key" } };
    m.loadRows.mockResolvedValueOnce({ active: null, latest: null }).mockResolvedValue({ active: row({}), latest: null });
    const r = await requestClassnoteBoardSync({ classIds: ["11111111-1111-4111-8111-111111111111"] });
    expect(r.ok).toBe(true);
    expect(r.ok && r.message).toMatch(/먼저 요청/);
    expect(m.merge).toHaveBeenCalledWith(expect.anything(), "t1", expect.objectContaining({ id: "r1" }), expect.objectContaining({ full: false }));
    expect(m.log).toHaveBeenCalledTimes(1);
    expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ requestId: "r1", joined: true }) }));
  });

  it("살아 있는 요청이 있으면 새로 넣지 않는다(대기 = 범위만 합침, 실행 중 = 안내만)", async () => {
    m.loadRows.mockResolvedValue({ active: row({}), latest: null });
    m.merge.mockResolvedValue(true);
    const r = await requestClassnoteBoardSync({ classIds: ["11111111-1111-4111-8111-111111111111"] });
    expect(r.ok && r.message).toMatch(/합쳤습니다/);
    expect(inserts()).toHaveLength(0);

    m.loadRows.mockResolvedValue({ active: row({ status: "running", startedAt: iso(2) }), latest: null });
    const r2 = await requestClassnoteBoardSync();
    expect(r2.ok && r2.message).toMatch(/실행 중/);
    expect(inserts()).toHaveLength(0);
  });

  it("멈춘 요청(대기 40분)은 실패로 내리고 새로 받는다 — 조건부(status 그대로일 때만)", async () => {
    const stale = row({ requestedAt: iso(40) });
    m.loadRows.mockResolvedValueOnce({ active: stale, latest: null }).mockResolvedValue({ active: null, latest: null });
    const r = await requestClassnoteBoardSync();
    expect(r.ok).toBe(true);
    const upd = m.calls.findIndex((c) => c.op === "update");
    expect(m.calls[upd].args[0]).toMatchObject({ status: "failed", result: { timedOut: true } });
    const guards = m.calls.slice(upd + 1, upd + 4).map((c) => c.args);
    expect(guards).toEqual([["tenant_id", "t1"], ["id", "r1"], ["status", "pending"]]);
    expect(inserts()).toHaveLength(1);
  });

  it("🔴 멈춘 실행 중 요청에 합류해 있던 범위(nextScope)는 새 요청에 실린다 — 버리지 않는다", async () => {
    const C = "22222222-2222-4222-8222-222222222222";
    const stale = row({ status: "running", startedAt: iso(40), nextScope: { full: false, classIds: [C], studentIds: [] } });
    m.loadRows.mockResolvedValueOnce({ active: stale, latest: null }).mockResolvedValue({ active: null, latest: null });
    const r = await requestClassnoteBoardSync({ classIds: ["11111111-1111-4111-8111-111111111111"] });
    expect(r.ok).toBe(true);
    const ins = inserts()[0].args[0] as { scope: { classIds: string[] } };
    expect(ins.scope.classIds).toEqual(expect.arrayContaining(["11111111-1111-4111-8111-111111111111", C]));
  });

  it("쿨다운 — 2분 전에 끝났으면 서버가 거절한다(화면 잠금 우회 방지)", async () => {
    m.loadRows.mockResolvedValue({ active: null, latest: row({ status: "done", finishedAt: iso(2) }) });
    const r = await requestClassnoteBoardSync();
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.error).toMatch(/3분 뒤/);
    expect(inserts()).toHaveLength(0);
  });

  it("연동 PC가 없거나 옛 버전이면 받지 않는다(영원히 '대기 중' 방지)", async () => {
    m.workerOk.mockResolvedValue(false);
    const r = await requestClassnoteBoardSync();
    expect(!r.ok && r.error).toMatch(/연동 PC/);
    expect(inserts()).toHaveLength(0);
  });

  it("🔴 모듈 꺼짐·권한 없음·열람 전용 강사 뷰 = 거절, 아무것도 안 넣는다", async () => {
    m.settings.mockResolvedValue({ modules: { disabled: ["classnote"] }, report: {} });
    expect((await requestClassnoteBoardSync()).ok).toBe(false);
    m.settings.mockResolvedValue({ modules: { disabled: [] }, report: {} });
    m.user.mockResolvedValue({ id: "u2", tenantId: "t1", systemRole: "viewer" });
    m.canWrite.mockResolvedValue(false);
    expect((await requestClassnoteBoardSync()).ok).toBe(false);
    m.user.mockResolvedValue({ id: "u3", tenantId: "t1", systemRole: "teacher" });
    m.readonly.mockResolvedValue("열람 전용입니다");
    expect((await requestClassnoteBoardSync()).ok).toBe(false);
    expect(inserts()).toHaveLength(0);
  });

  // 원장 2026-10-06 *"선생님 버튼은 자동 동기화 요청에 의한 건 아니면 누를 수 없게"*.
  describe("강사(보고서 쓰기 권한 없음)", () => {
    beforeEach(() => {
      m.user.mockResolvedValue({ id: "u3", tenantId: "t1", systemRole: "teacher" });
      m.canWrite.mockResolvedValue(false);
    });

    it("🔴 직접 요청은 거절한다 — 요청 행도 감사로그도 남지 않는다", async () => {
      const res = await requestClassnoteBoardSync({ classIds: ["c1"], studentIds: ["s1"], source: "onescreen_send_class" });
      expect(res).toMatchObject({ ok: false, error: expect.stringContaining("직접 동기화를 요청할 수 없습니다") });
      expect(inserts()).toHaveLength(0);
      expect(m.log).not.toHaveBeenCalled();
    });

    it("🔴 '자동 요청'이라고 값을 꾸며 보내도 거절한다 — 구분은 인자가 아니라 서버의 실행 문맥이다", async () => {
      const res = await requestClassnoteBoardSync({ classIds: ["c1"], studentIds: ["s1"], source: "send_blocked" });
      expect(res.ok).toBe(false);
      expect(inserts()).toHaveLength(0);
    });

    it("발송이 막혀 서버가 대신 내는 요청(runAsAutoSyncRequest)은 받는다 — 그 반·학생만, 자동으로 기록된다", async () => {
      const res = await runAsAutoSyncRequest(() => requestClassnoteBoardSync({ classIds: [CLASS_ID], studentIds: [STUDENT_ID], source: "send_blocked" }));
      expect(res.ok).toBe(true);
      // 요청 안에서 다시 읽는 상태도 문맥 안이라 숨겨지지 않는다.
      expect(res.ok && res.status.available).toBe(true);
      expect(inserts()).toHaveLength(1);
      expect(inserts()[0]!.args[0]).toMatchObject({ scope: { full: false, classIds: [CLASS_ID], studentIds: [STUDENT_ID] } });
      expect(m.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: "classnote_board_sync_request", metadata: expect.objectContaining({ source: "send_blocked", trigger: "auto", full: false }) }),
      );
    });

    it("🔴 운영자 계정은 역할이 강사여도 이 제한에 걸리지 않는다", async () => {
      m.superAdmin.mockResolvedValue(true);
      expect((await getClassnoteSyncStatus()).available).toBe(true);
      expect((await requestClassnoteBoardSync()).ok).toBe(true);
    });

    it("그 문맥은 그 요청 안에서만 유효하다 — 끝난 뒤의 직접 요청은 다시 거절된다", async () => {
      await runAsAutoSyncRequest(() => requestClassnoteBoardSync({ classIds: ["c1"], studentIds: ["s1"], source: "send_blocked" }));
      expect((await requestClassnoteBoardSync()).ok).toBe(false);
    });
  });

  // 원장 2026-11-05 강사뷰 전수 — 원장(A)이 강사 X 화면에서 발송이 막혔을 때 서버가 대신 내는 요청도 X로 판정·기록한다.
  it("🔴 강사뷰(대상 X = 강사)면 역할·요청 명의가 X — 자동 요청은 받고, requested_by는 X", async () => {
    m.user.mockImplementation(async (o?: { teacherView?: boolean }) =>
      o?.teacherView ? { id: "x1", tenantId: "t1", systemRole: "teacher" } : { id: "a1", tenantId: "t1", systemRole: "master" });
    m.canWrite.mockResolvedValue(false); // 권한표의 A 역할 줄은 X 값(none)으로 덮여 있다
    const direct = await requestClassnoteBoardSync({ classIds: [CLASS_ID], source: "onescreen_send_class" });
    expect(direct).toMatchObject({ ok: false, error: expect.stringContaining("직접 동기화를 요청할 수 없습니다") });
    const auto = await runAsAutoSyncRequest(() => requestClassnoteBoardSync({ classIds: [CLASS_ID], studentIds: [STUDENT_ID], source: "send_blocked" }));
    expect(auto.ok).toBe(true);
    expect(inserts()[0]!.args[0]).toMatchObject({ tenant_id: "t1", requested_by: "x1" });
    expect(m.user).toHaveBeenCalledWith({ teacherView: true });
  });

  it("보고서 쓰기 권한이 있는 계정은 종전처럼 버튼으로 요청한다(역할이 강사여도) — 수동으로 기록된다", async () => {
    m.user.mockResolvedValue({ id: "u4", tenantId: "t1", systemRole: "teacher" });
    m.canWrite.mockResolvedValue(true);
    expect((await requestClassnoteBoardSync({ source: "lesson_reports_queue" })).ok).toBe(true);
    expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ trigger: "manual", source: "lesson_reports_queue" }) }));
    // 권한이 있으면 운영자 여부를 조회하지 않는다(평소 경로에 조회를 더하지 않는다).
    expect(m.superAdmin).not.toHaveBeenCalled();
  });

  it("🔴 버튼을 누른 사람이 '자동 요청' 값을 꾸며 보내도 수동으로 남는다 — 새 요청이든 합류든", async () => {
    expect((await requestClassnoteBoardSync({ classIds: [CLASS_ID], source: "send_blocked" })).ok).toBe(true);
    expect(m.log).toHaveBeenLastCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ trigger: "manual", source: null }) }));
    // 이미 살아 있는 요청에 합류하는 경우도 같다.
    m.loadRows.mockResolvedValue({ active: row({ status: "pending", requestedAt: iso(0) }), latest: null });
    expect((await requestClassnoteBoardSync({ classIds: [CLASS_ID], source: "send_blocked" })).ok).toBe(true);
    expect(m.log).toHaveBeenLastCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ joined: true, trigger: "manual", source: null }) }));
  });

  it("0313a 적용 전(표 없음) = 없는 기능", async () => {
    m.loadRows.mockRejectedValue({ code: "42P01" });
    expect(await requestClassnoteBoardSync()).toMatchObject({ ok: false, error: "사용할 수 없는 기능입니다" });
  });
});

describe("상태", () => {
  it("모듈 꺼짐 / 표 없음 / 반 보드 없는 지점 = 숨김", async () => {
    m.settings.mockResolvedValue({ modules: { disabled: ["classnote"] }, report: {} });
    expect((await getClassnoteSyncStatus()).available).toBe(false);
    m.settings.mockResolvedValue({ modules: { disabled: [] }, report: {} });
    m.loadRows.mockRejectedValue({ code: "PGRST205" });
    expect((await getClassnoteSyncStatus()).available).toBe(false);
    m.loadRows.mockResolvedValue({ active: null, latest: null });
    m.boardCount = 0;
    expect((await getClassnoteSyncStatus()).available).toBe(false);
  });
  it("정상 — 지점 id로만 묻는다", async () => {
    const s = await getClassnoteSyncStatus();
    expect(s).toMatchObject({ available: true, workerReady: true, autoSync: false });
    expect(m.loadRows).toHaveBeenCalledWith(expect.anything(), "t1");
    // 연동 PC가 자동 동기화를 내걸 때만 그렇다고 알린다(버튼 설명 문구가 이 값을 읽는다)
    m.autoSync = true;
    expect((await getClassnoteSyncStatus()).autoSync).toBe(true);
    m.autoSync = false;
    expect(m.calls.some((c) => c.table === "classnote_class_boards" && c.op === "eq" && c.args[0] === "tenant_id" && c.args[1] === "t1")).toBe(true);
  });
});
