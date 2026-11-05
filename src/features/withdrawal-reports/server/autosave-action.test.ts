import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_BODY } from "../model";

// 자동 저장 서버 액션(원장 2026-11-05 실시간 저장) — 권한 · 충돌 판정 · 응답 유실 재전송 · 재시도 구분 · 감사로그 10분 묶기.
const REPORT_ID = "10000000-0000-4000-8000-000000000001";
const m = vi.hoisted(() => ({
  viewer: null as null | { writable: boolean; user: { id: string; tenantId: string } },
  record: null as null | { report: Record<string, unknown>; consultations: { id: string }[] },
  rpc: vi.fn(),
  recentAudit: [] as unknown[],
  logAction: vi.fn(),
  afterFns: [] as (() => Promise<void>)[],
  realUser: { id: "teacher" } as { id: string },
  readFails: false,
  billingFails: false,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: (fn: () => Promise<void>) => { m.afterFns.push(fn); } }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => m.realUser }));
vi.mock("@/features/audit/server/log", () => ({ logAction: m.logAction }));
vi.mock("@/features/slack/server/poke", () => ({ pokeSlack: vi.fn() }));
vi.mock("@/features/withdrawals/server/withdrawal-sheet", () => ({ recordMathWithdrawalToSheet: vi.fn() }));
vi.mock("@/features/students/server/status-access", () => ({ canManageStudentStatusNow: vi.fn() }));
vi.mock("./queries", () => ({
  reportViewer: async () => m.viewer,
  getReport: async () => m.record,
  getReportForSave: async () => { if (m.readFails) throw new Error("connection reset"); return m.record; },
}));
vi.mock("./billing", () => ({
  loadReportBilling: async () => { if (m.billingFails) throw new Error("장부 조회 실패"); return { tuition: "장부", arrears: "no", arrearsNote: "" }; },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: (...a: unknown[]) => ({ single: () => m.rpc(...a) }),
    from: () => {
      const q = { select: () => q, eq: () => q, gte: () => q, in: () => q, order: () => q, limit: async () => ({ data: m.recentAudit, error: null }) };
      return q;
    },
  }),
}));

import { autosaveWithdrawalReport, changeWithdrawalReport } from "./actions";

const written = { ...EMPTY_BODY, detail: "쓰는 중인 글" };
const baseReport = { id: REPORT_ID, tenant_id: "t1", teacher_id: "teacher", status: "requested", revision: 3, body: { ...EMPTY_BODY, tuition: "옛 장부" }, snapshot: { name: "학생" }, effective_date: "2026-11-30", updated_at: "2026-11-05T07:00:00Z" };

beforeEach(() => {
  m.viewer = { writable: true, user: { id: "teacher", tenantId: "t1" } };
  m.record = { report: { ...baseReport }, consultations: [] };
  m.rpc.mockReset();
  m.rpc.mockImplementation(async () => ({ data: { ...baseReport, revision: 4, body: written }, error: null }));
  m.recentAudit = [];
  m.logAction.mockReset();
  m.afterFns = [];
  m.readFails = false;
  m.billingFails = false;
});
const runAfter = async () => { for (const fn of m.afterFns.splice(0)) await fn(); };

describe("autosaveWithdrawalReport", () => {
  it("저장하고 새 revision을 돌려준다 — 감사로그는 그 보고서 10분 안 자동 저장이 없을 때만 한 줄", async () => {
    expect(await autosaveWithdrawalReport(REPORT_ID, 3, written)).toEqual({ ok: true, revision: 4, savedAt: baseReport.updated_at });
    expect(m.rpc).toHaveBeenCalledWith("transition_withdrawal_report", expect.objectContaining({ p_actor: "teacher", p_action: "save", p_payload: expect.objectContaining({ revision: 3 }) }));
    await runAfter();
    expect(m.logAction).toHaveBeenCalledTimes(1);
    m.recentAudit = [{ id: "a1" }];
    await autosaveWithdrawalReport(REPORT_ID, 3, written);
    await runAfter();
    expect(m.logAction).toHaveBeenCalledTimes(1);
  });

  it("쓸 수 없는 화면이면 거절 — 다시 보내지 않는다(retry 없음)", async () => {
    m.viewer = { writable: false, user: { id: "teacher", tenantId: "t1" } };
    const res = await autosaveWithdrawalReport(REPORT_ID, 3, written);
    expect(res).toMatchObject({ ok: false, conflict: false });
    expect(res.ok === false && res.retry).toBeFalsy();
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("다른 화면이 앞서 다른 글을 저장했으면 충돌 — 덮지 않는다", async () => {
    m.record = { report: { ...baseReport, revision: 5, body: { ...EMPTY_BODY, detail: "휴대폰 글" } }, consultations: [] };
    expect(await autosaveWithdrawalReport(REPORT_ID, 3, written)).toMatchObject({ ok: false, conflict: true });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("앞선 저장이 들어갔는데 응답만 끊겼으면(서버 글 = 보내는 글) 그 revision을 받아들인다", async () => {
    m.record = { report: { ...baseReport, revision: 4, body: { ...written, tuition: "장부", arrears: "no" } }, consultations: [] };
    expect(await autosaveWithdrawalReport(REPORT_ID, 3, written)).toEqual({ ok: true, revision: 4, savedAt: baseReport.updated_at });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("DB 검사 거절(P0001)은 다시 보내지 않고, 연결 오류는 다시 보낸다", async () => {
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "작성 요청을 받은 강사만 작성할 수 있습니다." } });
    const denied = await autosaveWithdrawalReport(REPORT_ID, 3, written);
    expect(denied).toMatchObject({ ok: false, conflict: false, retry: false });
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: "", message: "fetch failed" } });
    expect(await autosaveWithdrawalReport(REPORT_ID, 3, written)).toMatchObject({ ok: false, conflict: false, retry: true });
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "보고서가 변경되었습니다. 새로고침 후 다시 진행해 주세요." } });
    expect(await autosaveWithdrawalReport(REPORT_ID, 3, written)).toMatchObject({ ok: false, conflict: true });
  });

  // 2026-11-05 재리뷰 A — 저장 중 이어 쓴 글: 서버 글이 결과를 모르던 내 글이면 서버 revision 위에 이어 쓴다.
  it("서버 글 = 결과를 모르던 내 글이면 서버 revision 위에 지금 글을 쓴다", async () => {
    const first = { ...EMPTY_BODY, detail: "쓰는 중" };
    m.record = { report: { ...baseReport, revision: 4, body: { ...first, tuition: "장부", arrears: "no" } }, consultations: [] };
    m.rpc.mockImplementation(async () => ({ data: { ...baseReport, revision: 5, body: written }, error: null }));
    expect(await autosaveWithdrawalReport(REPORT_ID, 3, written, [first])).toMatchObject({ ok: true, revision: 5 });
    expect(m.rpc).toHaveBeenCalledWith("transition_withdrawal_report", expect.objectContaining({ p_payload: expect.objectContaining({ revision: 4 }) }));
  });

  it("결과를 모르던 글이 서버 글과 다르거나 내 보고서가 아니면 충돌 — 덮지 않는다", async () => {
    m.record = { report: { ...baseReport, revision: 4, body: { ...EMPTY_BODY, detail: "휴대폰 글" } }, consultations: [] };
    expect(await autosaveWithdrawalReport(REPORT_ID, 3, written, [{ ...EMPTY_BODY, detail: "다른 글" }])).toMatchObject({ ok: false, conflict: true });
    m.record = { report: { ...baseReport, revision: 4, teacher_id: "other", body: { ...EMPTY_BODY, detail: "쓰는 중" } }, consultations: [] };
    expect(await autosaveWithdrawalReport(REPORT_ID, 3, written, [{ ...EMPTY_BODY, detail: "쓰는 중" }])).toMatchObject({ ok: false, conflict: true });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  // 재리뷰 B — revision이 다르면 검사 · 장부 조회 전에 판정한다(충돌이 장부 재시도에 가려지지 않게).
  it("다른 화면이 앞섰으면 장부 조회가 실패해도 충돌로 알린다(재시도로 돌지 않는다)", async () => {
    m.billingFails = true;
    m.record = { report: { ...baseReport, revision: 5, body: { ...EMPTY_BODY, detail: "휴대폰 글" } }, consultations: [] };
    expect(await autosaveWithdrawalReport(REPORT_ID, 3, written)).toMatchObject({ ok: false, conflict: true });
    m.record = { report: { ...baseReport }, consultations: [] };
    expect(await autosaveWithdrawalReport(REPORT_ID, 3, written)).toMatchObject({ ok: false, conflict: false, retry: true });
  });

  // 재리뷰 C — 조회 오류는 다시 보낼 실패, 없음 · 볼 수 없음은 거절.
  it("보고서 조회 오류는 retry, 없거나 볼 수 없으면 retry 없이 거절", async () => {
    m.readFails = true;
    expect(await autosaveWithdrawalReport(REPORT_ID, 3, written)).toMatchObject({ ok: false, conflict: false, retry: true });
    m.readFails = false;
    m.record = null;
    const res = await autosaveWithdrawalReport(REPORT_ID, 3, written);
    expect(res).toMatchObject({ ok: false, conflict: false });
    expect(res.ok === false && res.retry).toBeFalsy();
  });
});

// 재리뷰 D — 강사가 쓰는 동안 자동 저장이 revision을 올려도 요청자 · 원장의 '요청 취소'는 막히지 않는다(본 상태가 같을 때만).
describe("changeWithdrawalReport 취소", () => {
  beforeEach(() => {
    m.viewer = { writable: true, user: { id: "requester", tenantId: "t1" } } as typeof m.viewer;
    m.record = { report: { ...baseReport, revision: 9, requested_by: "requester" }, consultations: [] };
    m.rpc.mockImplementation(async () => ({ data: { ...baseReport, status: "canceled", revision: 10 }, error: null }));
  });
  it("화면이 본 상태 그대로면 서버가 방금 읽은 revision으로 취소한다", async () => {
    expect(await changeWithdrawalReport(REPORT_ID, "cancel", 3, { seenStatus: "requested" })).toEqual({ ok: true, id: REPORT_ID });
    expect(m.rpc).toHaveBeenCalledWith("transition_withdrawal_report", expect.objectContaining({ p_action: "cancel", p_payload: { revision: 9 } }));
  });
  it("그사이 상태가 바뀌었으면(제출 등) 화면의 revision 그대로 — DB가 거절해 새로 보게 한다", async () => {
    m.record = { report: { ...baseReport, status: "manager_pending", revision: 9, requested_by: "requester" }, consultations: [] };
    await changeWithdrawalReport(REPORT_ID, "cancel", 3, { seenStatus: "requested" });
    expect(m.rpc).toHaveBeenCalledWith("transition_withdrawal_report", expect.objectContaining({ p_payload: { revision: 3 } }));
  });
  it("취소가 아닌 처리는 늘 화면의 revision", async () => {
    m.viewer = { writable: true, user: { id: "teacher", tenantId: "t1" } };
    await changeWithdrawalReport(REPORT_ID, "save", 3, written);
    expect(m.rpc).toHaveBeenCalledWith("transition_withdrawal_report", expect.objectContaining({ p_payload: expect.objectContaining({ revision: 3 }) }));
  });
});
