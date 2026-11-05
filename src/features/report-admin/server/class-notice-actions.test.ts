// 반 단체 공지 — 누가 어느 반에 보낼 수 있는가(강사는 담당 반만 · 열람 전용 강사뷰는 못 보낸다).
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  user: vi.fn(), canWrite: vi.fn(), teacherId: vi.fn(), readonly: vi.fn(), teaching: vi.fn(), settings: vi.fn(), log: vi.fn(),
  sendOn: true, classes: [] as { id: string; class_name: string }[], boards: [] as { class_id: string }[], inserted: [] as unknown[],
  // 반 공지 재료 조회(loadMyClassWideNotice)용 — 조회 헬퍼가 부른 순서대로 돌려준다.
  chunkIds: [] as string[][], chunks: [] as unknown[][], paged: [] as unknown[][], chunkFail: false, mine: [] as unknown[],
  workers: [] as unknown[],
  // 세션 클라이언트 조회의 .eq 인자(내가 보낸 반 공지의 '나' 확인용).
  eqs: [] as unknown[][],
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canWriteTenant: m.canWrite, canAccessTenant: async () => true }));
vi.mock("@/lib/auth/view-mode", () => ({ effectiveTeacherId: m.teacherId, readonlyTeacherViewError: m.readonly }));
vi.mock("@/features/classes/server/delegation", () => ({ getTeachingClassIds: m.teaching }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: m.settings }));
vi.mock("@/features/owner/classnote-gate", () => ({ classnoteSendOn: () => m.sendOn, classnoteModuleOn: (s: { modules?: { disabled?: string[] } }) => !s.modules?.disabled?.includes("classnote") }));
vi.mock("@/features/audit/server/log", () => ({ logAction: m.log }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    // 내가 보낸 반 공지 이력(classnote_class_notices) — 체인 끝의 limit이 결과를 돌려준다.
    from: (table: string) => {
      // 발송 PC 하트비트(이미지 롤아웃 가드) — select가 곧 결과다.
      if (table === "classnote_workers") return { select: async () => ({ data: m.workers, error: null }) };
      const q = { select: () => q, eq: (...a: unknown[]) => { m.eqs.push(a); return q; }, order: () => q, limit: async () => ({ data: m.mine, error: null }) };
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
  m.eqs = [];
  m.workers = [{ last_seen: new Date().toISOString(), last_results: { postMode: true, caps: { classNoticeImages: true } } }];
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
  it("🔴 강사뷰면 발송 명의(created_by)가 대상 강사 X — 실제 계정 A가 아니다", async () => {
    m.user.mockImplementation(async (o?: { teacherView?: boolean }) =>
      o?.teacherView ? { id: "x1", tenantId: "t1", systemRole: "teacher" } : { id: "a1", tenantId: "t1", systemRole: "master" });
    m.teacherId.mockResolvedValue("x1");
    expect(await sendClassWideNotice(input(["c1"]))).toMatchObject({ ok: true });
    expect(m.inserted[0]).toMatchObject({ created_by: "x1" });
    expect(m.user).toHaveBeenCalledWith({ teacherView: true });
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
    expect(r.rows).toEqual([{ id: "n1", title: "휴원", classNames: ["가반"], imageCount: 0, isTest: false, status: "success", failures: ["가반: 보드 원아 불일치"], error: null, createdAt: "2026-10-02T01:00:00Z" }]);
    // 반 보드 연결은 **담당 반 id로** 좁혀 읽는다(남의 반 연결을 읽지 않는다)
    expect(m.chunkIds[0]).toEqual(["c1", "c2"]);
  });
  it("🔴 강사뷰면 '내가 보낸 반 공지'의 나 = 대상 강사 X(발송 명의와 같은 사람)", async () => {
    m.user.mockImplementation(async (o?: { teacherView?: boolean }) =>
      o?.teacherView ? { id: "x1", tenantId: "t1", systemRole: "teacher" } : { id: "a1", tenantId: "t1", systemRole: "master" });
    m.teacherId.mockResolvedValue("x1");
    m.chunks = [[{ class_id: "c1" }], [{ id: "c1", class_name: "가반" }]];
    m.paged = [[]];
    await loadMyClassWideNotice();
    expect(m.eqs).toContainEqual(["created_by", "x1"]);
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

describe("반 공지 이미지", () => {
  const img = (name: string) => ({ path: `t1/report-attachments/${name}`, name, size: 100 });
  it("대상마다 같은 이미지 목록을 싣는다(새 칸 없이 targets 안에) · 감사로그에 장수", async () => {
    const r = await sendClassWideNotice({ ...input(["c1", "c2"]), attachments: [img("a.png"), img("b.jpg")] });
    expect(r).toMatchObject({ ok: true, queued: 2 });
    const row = m.inserted[0] as { targets: { classId: string; attachments: unknown[] }[] };
    expect(row.targets.map((t) => t.classId)).toEqual(["c1", "c2"]);
    for (const t of row.targets) expect(t.attachments).toEqual([img("a.png"), img("b.jpg")]);
    expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ images: 2 }) }));
  });
  it("이미지가 없으면 큐 행 모양이 예전과 똑같다(대상에 첨부 칸이 없다)", async () => {
    m.classes = [{ id: "c1", class_name: "가반" }];
    await sendClassWideNotice(input(["c1"]));
    expect(m.inserted[0]).toMatchObject({ targets: [{ classId: "c1", className: "가반" }] });
    expect((m.inserted[0] as { targets: object[] }).targets[0]).not.toHaveProperty("attachments");
  });
  it("테스트 발송도 이미지를 실어 보낸다 — 이미지를 나를 자리 하나(테스트반)", async () => {
    const r = await sendClassWideNotice({ classIds: [], title: "t", body: "b", test: true, attachments: [img("a.png")] });
    expect(r).toMatchObject({ ok: true, queued: 1 });
    expect(m.inserted[0]).toMatchObject({ is_test: true, targets: [{ classId: null, className: "[수학] 테스트반", attachments: [img("a.png")] }] });
    // 이미지 없는 테스트 발송은 예전 그대로(대상 없음)
    await sendClassWideNotice({ classIds: [], title: "t", body: "b", test: true });
    expect(m.inserted[1]).toMatchObject({ is_test: true, targets: [] });
  });
  it("🔴 남의 지점 경로·이미지가 아닌 파일·11장 이상은 거절 — 큐에 올리지 않는다", async () => {
    const foreign = await sendClassWideNotice({ ...input(["c1"]), attachments: [{ path: "다른지점/report-attachments/a.png", name: "a.png", size: 1 }] });
    expect(foreign.ok).toBe(false);
    expect(foreign.error).toContain("이미지를 확인하지 못했습니다");
    // 일부만 통과해도 막는다 — 통과한 것만 싣고 보내면 이미지가 조용히 빠진다
    const mixed = await sendClassWideNotice({ ...input(["c1"]), attachments: [img("a.png"), { path: "다른지점/report-attachments/b.png", name: "b.png", size: 1 }] });
    expect(mixed.error).toContain("이미지를 확인하지 못했습니다");
    const pdf = await sendClassWideNotice({ ...input(["c1"]), attachments: [img("a.pdf")] });
    expect(pdf.error).toContain("이미지(JPG·PNG·WebP)만");
    // 이름만 이미지처럼 적은 파일도 막는다 — 경로의 확장자(서버가 내용 형식을 확인하고 붙인 것)로만 판정한다
    const disguised = await sendClassWideNotice({ ...input(["c1"]), attachments: [{ path: "t1/report-attachments/a.pdf", name: "a.png", size: 1 }] });
    expect(disguised.error).toContain("이미지(JPG·PNG·WebP)만");
    const many = await sendClassWideNotice({ ...input(["c1"]), attachments: Array.from({ length: 11 }, (_, i) => img(`x${i}.png`)) });
    expect(many.error).toContain("최대 10장");
    expect(m.inserted).toEqual([]);
  });
  it("🔴 발송 PC가 이미지를 모르는 옛 판이면 막는다(글만 올리고 '발송 완료'로 적는다) — 이미지를 빼면 보낼 수 있다", async () => {
    m.workers = [{ last_seen: new Date().toISOString(), last_results: { postMode: true, caps: {} } }];
    const r = await sendClassWideNotice({ ...input(["c1"]), attachments: [img("a.png")] });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("아직 반 공지 이미지를 지원하지 않습니다");
    expect(m.inserted).toEqual([]);
    expect((await sendClassWideNotice(input(["c1"]))).ok).toBe(true);
  });
  it("발송 PC 판정 — 최근 7일 안에 보인 PC가 전부 지원해야 한다(지금 꺼져 있는 옛 판 PC도 다시 켜지면 집는다)", async () => {
    const send = () => sendClassWideNotice({ ...input(["c1"]), attachments: [img("a.png")] });
    const ago = (days: number) => new Date(Date.now() - days * 86400000).toISOString();
    const ok = { postMode: true, caps: { classNoticeImages: true } };
    // 새 판 PC가 켜져 있어도, 이틀 전까지 돌던 옛 판 PC가 있으면 막는다
    m.workers = [{ last_seen: ago(0), last_results: ok }, { last_seen: ago(2), last_results: { postMode: true, caps: {} } }];
    expect((await send()).ok).toBe(false);
    // 🔴 발송 표식이 없는 옛 판(표식보다 반 공지 처리가 먼저 나갔다)도 발송 PC로 센다
    m.workers = [{ last_seen: ago(0), last_results: ok }, { last_seen: ago(1), last_results: { caps: { classWideNotice: true } } }];
    expect((await send()).ok).toBe(false);
    m.workers = [{ last_seen: ago(0), last_results: ok }, { last_seen: ago(1), last_results: null }];
    expect((await send()).ok).toBe(false);
    // dry-run이라고 밝힌 PC는 큐를 집지 않으므로 세지 않는다 — 옛 판이어도 막지 않고, 새 판이어도 그것만으로는 못 연다
    m.workers = [{ last_seen: ago(0), last_results: ok }, { last_seen: ago(0), last_results: { postMode: false, caps: {} } }];
    expect((await send()).ok).toBe(true);
    m.workers = [{ last_seen: ago(0), last_results: { postMode: false, caps: { classNoticeImages: true } } }];
    expect((await send()).ok).toBe(false);
    // 7일 넘게 안 보인 옛 판 PC는 치운 PC로 본다 · 7일 안에 보인 PC가 없으면 가장 최근 PC로
    m.workers = [{ last_seen: ago(1), last_results: ok }, { last_seen: ago(30), last_results: { postMode: true, caps: {} } }];
    expect((await send()).ok).toBe(true);
    m.workers = [{ last_seen: ago(40), last_results: { postMode: true, caps: {} } }, { last_seen: ago(20), last_results: ok }];
    expect((await send()).ok).toBe(true);
    m.workers = [{ last_seen: ago(20), last_results: { postMode: true, caps: {} } }, { last_seen: ago(40), last_results: ok }];
    expect((await send()).ok).toBe(false);
    // 한 번도 없으면 막는다
    m.workers = [];
    expect((await send()).ok).toBe(false);
  });
  it("발송 스위치가 꺼져 있으면 이미지가 있어도 dry-run(발송 PC 판정보다 먼저)", async () => {
    m.sendOn = false;
    m.workers = [];
    expect(await sendClassWideNotice({ ...input(["c1"]), attachments: [img("a.png")] })).toMatchObject({ ok: true, dryRun: true });
  });
});
