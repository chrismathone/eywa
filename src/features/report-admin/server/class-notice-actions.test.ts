// 반 단체 공지 — 누가 어느 반에 보낼 수 있는가(강사는 담당 반만 · 열람 전용 강사뷰는 못 보낸다).
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  user: vi.fn(), canWrite: vi.fn(), teacherId: vi.fn(), readonly: vi.fn(), teaching: vi.fn(), settings: vi.fn(), log: vi.fn(),
  sendOn: true, classes: [] as { id: string; class_name: string }[], boards: [] as { class_id: string }[], inserted: [] as unknown[],
  // 반 공지 재료 조회(loadMyClassWideNotice)용 — 조회 헬퍼가 부른 순서대로 돌려준다.
  chunkIds: [] as string[][], chunks: [] as unknown[][], paged: [] as unknown[][], chunkFail: false, mine: [] as unknown[],
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canWriteTenant: m.canWrite, canAccessTenant: async () => true }));
vi.mock("@/lib/auth/view-mode", () => ({ effectiveTeacherId: m.teacherId, readonlyTeacherViewError: m.readonly }));
vi.mock("@/features/classes/server/delegation", () => ({ getTeachingClassIds: m.teaching }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: m.settings }));
vi.mock("@/features/owner/classnote-gate", () => ({ classnoteSendOn: () => m.sendOn }));
vi.mock("@/features/audit/server/log", () => ({ logAction: m.log }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    // 내가 보낸 반 공지 이력(classnote_class_notices) — 체인 끝의 limit이 결과를 돌려준다.
    from: () => {
      const q = { select: () => q, eq: () => q, order: () => q, limit: async () => ({ data: m.mine, error: null }) };
      return q;
    },
  }),
}));
vi.mock("@/lib/supabase/batch", () => ({
  fetchInChunks: async (ids: string[]) => {
    if (m.chunkFail) throw new Error("fetchInChunks: 414");
    m.chunkIds.push(ids);
    return m.chunks.shift() ?? [];
  },
  fetchAllPaged: async () => m.paged.shift() ?? [],
  fetchAllPagedInChunks: async () => m.paged.shift() ?? [],
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const rows = table === "classes" ? m.classes : m.boards;
      const q = {
        select: () => q,
        eq: () => q,
        in: () => Promise.resolve({ data: rows, error: null }),
        insert: (row: unknown) => {
          m.inserted.push(row);
          return { select: () => ({ single: async () => ({ data: { id: "n1" }, error: null }) }) };
        },
      };
      return q;
    },
  }),
}));

import { loadMyClassWideNotice, sendClassWideNotice } from "./class-notice-actions";

beforeEach(() => {
  vi.clearAllMocks();
  m.user.mockResolvedValue({ id: "u1", tenantId: "t1", systemRole: "teacher" });
  m.canWrite.mockResolvedValue(false);
  m.teacherId.mockResolvedValue("u1");
  m.readonly.mockResolvedValue(null);
  m.teaching.mockResolvedValue({ own: ["c1"], delegated: ["c2"], all: ["c1", "c2"] });
  m.settings.mockResolvedValue({});
  m.sendOn = true;
  m.classes = [{ id: "c1", class_name: "가반" }, { id: "c2", class_name: "나반" }];
  m.boards = [{ class_id: "c1" }, { class_id: "c2" }];
  m.inserted = [];
  m.chunkIds = [];
  m.chunks = [];
  m.paged = [];
  m.chunkFail = false;
  m.mine = [];
});

const input = (classIds: string[]) => ({ classIds, title: "휴원 안내", body: "다음 주 월요일은 휴원입니다." });

describe("반 단체 공지 인가", () => {
  it("강사는 담당 반(담임 ∪ 오늘 위임)에 보낼 수 있다 — 수업보고서 쓰기 권한이 없어도", async () => {
    const r = await sendClassWideNotice(input(["c1", "c2"]));
    expect(r).toMatchObject({ ok: true, queued: 2 });
    expect(m.inserted[0]).toMatchObject({ tenant_id: "t1", title: "휴원 안내", created_by: "u1", targets: [{ classId: "c1", className: "가반" }, { classId: "c2", className: "나반" }] });
    expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ source: "class_wide_onescreen" }) }));
  });
  it("🔴 담당 반이 아닌 반이 하나라도 섞이면 통째로 거절 — 조용히 빼지 않고, 큐에 아무것도 안 올린다", async () => {
    const r = await sendClassWideNotice(input(["c1", "남의반"]));
    expect(r).toEqual({ ok: false, error: "담당 반에만 반 공지를 보낼 수 있습니다" });
    expect(m.inserted).toEqual([]);
    expect(m.log).not.toHaveBeenCalled();
  });
  it("🔴 '다른 강사 뷰'(열람 전용)에서는 못 보낸다 · 강사도 아니고 쓰기 권한도 없으면 거절", async () => {
    m.readonly.mockResolvedValue("다른 강사 화면은 열람 전용입니다");
    expect(await sendClassWideNotice(input(["c1"]))).toEqual({ ok: false, error: "다른 강사 화면은 열람 전용입니다" });
    m.readonly.mockResolvedValue(null);
    m.teacherId.mockResolvedValue(null);
    expect((await sendClassWideNotice(input(["c1"]))).error).toBe("공지 발송 권한이 없습니다");
    expect(m.inserted).toEqual([]);
  });
  it("사무실(쓰기 권한)은 담당 반 제한 없이 보낸다 · 반 보드 연결이 없는 반은 사유와 함께 뺀다", async () => {
    m.teacherId.mockResolvedValue(null);
    m.canWrite.mockResolvedValue(true);
    m.boards = [{ class_id: "c1" }];
    const r = await sendClassWideNotice(input(["c1", "c2"]));
    expect(r).toMatchObject({ ok: true, queued: 1, skipped: ["나반(ClassNote 반 연결 없음)"] });
    expect(m.teaching).not.toHaveBeenCalled();
    expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ source: "class_wide" }) }));
  });
  it("발송 스위치가 꺼져 있으면 큐에 올리지 않는다(dry-run)", async () => {
    m.sendOn = false;
    expect(await sendClassWideNotice(input(["c1"]))).toMatchObject({ ok: true, queued: 0, dryRun: true });
    expect(m.inserted).toEqual([]);
  });
});

describe("원스크린 반 공지 재료 — 보낼 수 있는 반", () => {
  it("강사 = 담당 반 안에서 ClassNote 반 보드가 연결된 활성 반만(재원 수와 함께, 이름순) + 내가 보낸 반 공지", async () => {
    m.chunks = [[{ class_id: "c2" }, { class_id: "c1" }], [{ id: "c2", class_name: "나반" }, { id: "c1", class_name: "가반" }]];
    m.paged = [[{ id: "e1", class_id: "c1" }, { id: "e2", class_id: "c1" }, { id: "e3", class_id: "c2" }]];
    m.mine = [{ id: "n1", title: "휴원", targets: [{ className: "가반" }], is_test: false, status: "success", results: [{ className: "가반", ok: false, note: "보드 원아 불일치" }], error: null, created_at: "2026-10-02T01:00:00Z" }];
    const r = await loadMyClassWideNotice();
    expect(r.classes).toEqual([{ id: "c1", name: "가반", studentCount: 2 }, { id: "c2", name: "나반", studentCount: 1 }]);
    expect(r.rows).toEqual([{ id: "n1", title: "휴원", classNames: ["가반"], isTest: false, status: "success", failures: ["가반: 보드 원아 불일치"], error: null, createdAt: "2026-10-02T01:00:00Z" }]);
    // 반 보드 연결은 **담당 반 id로** 좁혀 읽는다(남의 반 연결을 읽지 않는다)
    expect(m.chunkIds[0]).toEqual(["c1", "c2"]);
  });
  it("담당 반이 없거나 · 반 보드가 연결된 반이 없으면 빈 목록(화면이 토글을 감춘다)", async () => {
    m.teaching.mockResolvedValue({ own: [], delegated: [], all: [] });
    expect(await loadMyClassWideNotice()).toEqual({ ok: true, classes: [], rows: [] });
    m.teaching.mockResolvedValue({ own: ["c1"], delegated: [], all: ["c1"] });
    m.chunks = [[]];
    expect(await loadMyClassWideNotice()).toEqual({ ok: true, classes: [], rows: [] });
  });
  it("조회에 실패해도 던지지 않는다 — 반 공지만 감추고 원생 개별 공지 화면은 그대로 쓴다", async () => {
    m.chunkFail = true;
    expect(await loadMyClassWideNotice()).toEqual({ ok: true, classes: [], rows: [] });
  });
  it("강사도 아니고 쓰기 권한도 없으면 거절", async () => {
    m.teacherId.mockResolvedValue(null);
    expect((await loadMyClassWideNotice()).ok).toBe(false);
  });
});
