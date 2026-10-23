// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAdmin, tenantOf, type FakeCall } from "./fake-admin.test-util";

/**
 * 칸 메모 저장 문 — **화면과 같은 `memoSheetAccess`를 서버가 다시 판정한다**(#77) · 모든 쓰기는 세션 지점으로 좁힌다(정책 0개 표, [[#104]]) ·
 * version이 다르면 덮지 않는다.
 */

const T = "11111111-1111-4111-8111-111111111111";
const MEMO = "33333333-3333-4333-8333-333333333333";
const m = vi.hoisted(() => ({
  user: null as unknown,
  access: { canView: true, canEdit: true },
  respond: (() => ({ data: null, error: null })) as (c: FakeCall) => { data: unknown; error: unknown },
  calls: [] as FakeCall[],
}));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => m.user }));
vi.mock("@/features/timetable-memo/server/access", () => ({ memoSheetAccess: async () => m.access }));
vi.mock("@/features/audit/server/log", () => ({ logAction: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fakeAdmin((c) => m.respond(c), m.calls).client }));

import { deleteCellMemo, resizeCellMemo, saveCellMemo } from "./actions";

const row = (over: Record<string, unknown> = {}) => ({
  id: MEMO, subject: "english", memo_date: "2026-10-22", teacher_key: "u:u-kim", teacher_label: "김태건", start_min: 980,
  body: "처음", box_w: null, box_h: null, version: 2, updated_at: "2026-10-22T09:40:00.000Z", updated_by: "u-kim", ...over,
});
const users = [{ id: "u-kim", display_name: "김태건", english_name: null, status: "active" }];
const writes = () => m.calls.filter((c) => c.table === "timetable_cell_memos" && c.op !== "select");
const save = (over: Record<string, unknown> = {}) =>
  saveCellMemo({ subject: "english", date: "2026-10-22", col: "김태건", startMin: 980, id: MEMO, baseVersion: 2, body: "고침", ...over });

beforeEach(() => {
  m.user = { id: "u-park", tenantId: T, displayName: "박소선", systemRole: "admin" };
  m.access = { canView: true, canEdit: true };
  m.calls = [];
  m.respond = (c) => {
    if (c.table === "users") return { data: users, error: null };
    if (c.table === "timetable_cell_memos" && c.op === "select") return { data: row(), error: null };
    if (c.table === "timetable_cell_memos") return { data: c.op === "delete" ? [{ id: MEMO }] : row({ body: "고침", version: 3 }), error: null };
    return { data: null, error: null };
  };
});

describe("🔴 권한 — 서버가 다시 판정한다", () => {
  it("편집 권한(시간표 '전체')이 없으면 저장·지우기·크기 모두 거절하고 DB에 손대지 않는다", async () => {
    m.access = { canView: true, canEdit: false };
    expect(await save()).toEqual({ ok: false, error: "메모를 고칠 권한이 없습니다" });
    expect(await deleteCellMemo({ id: MEMO, baseVersion: 2, col: "김태건" })).toMatchObject({ ok: false });
    expect(await resizeCellMemo({ id: MEMO, width: 300, height: 200 })).toMatchObject({ ok: false });
    expect(m.calls).toEqual([]);
  });
  it("로그인이 없으면 거절", async () => {
    m.user = null;
    expect(await save()).toEqual({ ok: false, error: "다시 로그인해 주세요" });
    expect(m.calls).toEqual([]);
  });
  it("영어가 아닌 과목·없는 날짜·빈 메모는 거절", async () => {
    expect(await save({ subject: "math" })).toMatchObject({ ok: false });
    expect(await save({ date: "2026-02-30" })).toMatchObject({ ok: false });
    expect(await save({ body: "   " })).toMatchObject({ ok: false });
    expect(writes()).toEqual([]);
  });
});

describe("🔴 지점 격리 — 모든 조회·쓰기는 세션 지점으로", () => {
  it("수정: 읽기·쓰기 모두 tenant_id = 내 지점 · version 조건을 건다", async () => {
    const res = await save();
    expect(res).toMatchObject({ ok: true, memo: { body: "고침", version: 3, updatedByName: "박소선" } });
    for (const c of m.calls.filter((x) => x.table === "timetable_cell_memos")) expect(tenantOf(c)).toBe(T);
    const upd = writes().find((c) => c.op === "update")!;
    expect(upd.filters).toEqual(expect.arrayContaining([["eq", "id", MEMO], ["eq", "version", 2]]));
    expect(upd.payload).toMatchObject({ body: "고침", version: 3, updated_by: "u-park" });
  });
  it("새 메모: 강사 열쇠는 이름이 아니라 users.id · 지점·작성자는 세션에서", async () => {
    m.respond = (c) =>
      c.table === "users" ? { data: users, error: null } : { data: row({ id: MEMO, version: 1, body: "새 메모" }), error: null };
    const res = await save({ id: null, baseVersion: 0, body: "새 메모" });
    expect(res).toMatchObject({ ok: true });
    const ins = writes().find((c) => c.op === "insert")!;
    expect(ins.payload).toMatchObject({ tenant_id: T, teacher_key: "u:u-kim", teacher_label: "김태건", created_by: "u-park", version: 1 });
    expect(tenantOf(m.calls.find((c) => c.table === "users")!)).toBe(T);
  });
  it("지우기·크기도 tenant_id로 좁힌다", async () => {
    await deleteCellMemo({ id: MEMO, baseVersion: 2, col: "김태건" });
    await resizeCellMemo({ id: MEMO, width: 300, height: 200 });
    expect(writes().map((c) => [c.op, tenantOf(c)])).toEqual([["delete", T], ["update", T]]);
  });
});

describe("🔴 동시 저장 — 늦게 저장한 쪽이 덮지 않는다", () => {
  it("들고 있던 version이 낡았으면 쓰지 않고 최신을 돌려준다", async () => {
    m.respond = (c) =>
      c.table === "users" ? { data: users, error: null } : { data: row({ version: 5, body: "남이 쓴 글" }), error: null };
    const res = await save({ baseVersion: 2 });
    expect(res).toMatchObject({ ok: false, conflict: true, latest: { body: "남이 쓴 글", version: 5, updatedByName: "김태건" } });
    expect(writes()).toEqual([]);
  });
  it("같은 칸에 동시에 새 메모 → 유니크 충돌(23505)이면 먼저 단 메모를 돌려준다", async () => {
    m.respond = (c) => {
      if (c.table === "users") return { data: users, error: null };
      if (c.op === "insert") return { data: null, error: { code: "23505", message: "duplicate key" } };
      return { data: row({ body: "먼저 단 메모" }), error: null };
    };
    expect(await save({ id: null, baseVersion: 0 })).toMatchObject({ ok: false, conflict: true, latest: { body: "먼저 단 메모" } });
  });
  it("크기 조절은 내용 수정이 아니다 — version·수정자를 건드리지 않는다", async () => {
    await resizeCellMemo({ id: MEMO, width: 9999, height: 10 });
    expect(writes()[0]!.payload).toEqual({ box_w: 640, box_h: 80 });
  });
  it("표가 아직 없으면(0395a 전) 한글 안내 — 원문 오류를 내보내지 않는다", async () => {
    m.respond = (c) =>
      c.table === "users"
        ? { data: users, error: null }
        : { data: null, error: { code: "PGRST205", message: "Could not find the table 'public.timetable_cell_memos'" } };
    const res = await save({ id: null, baseVersion: 0 });
    expect(res).toMatchObject({ ok: false });
    expect((res as { error: string }).error).not.toMatch(/PGRST|table/);
  });
});
