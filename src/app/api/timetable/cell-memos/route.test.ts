// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/** 칸 메모 조회 문 — 화면·저장과 같은 `memoSheetAccess`(보기 = 시간표 열람 · 강사 화면 없음) · 지점은 세션의 지점만. */

const m = vi.hoisted(() => ({
  user: null as unknown,
  access: { canView: true, canEdit: false },
  load: vi.fn(async () => ({ status: "ok", memos: [] })),
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => m.user }));
vi.mock("@/features/timetable-memo/server/access", () => ({ memoSheetAccess: async () => m.access }));
vi.mock("@/features/timetable-cell-memo/server/store", () => ({ loadWeekCellMemos: m.load }));
vi.mock("@/lib/observability/report-error", () => ({ reportError: vi.fn() }));

import { GET } from "./route";

const get = (q = "subject=english&week=2026-10-19") => GET(new Request(`https://aywa.test/api/timetable/cell-memos?${q}`));

beforeEach(() => {
  m.user = { id: "u1", tenantId: "t-mine", systemRole: "admin" };
  m.access = { canView: true, canEdit: false };
  m.load.mockClear();
});

describe("칸 메모 조회(GET)", () => {
  it("보기 권한이면 그 주(월요일) · 세션 지점으로 읽는다 · 캐시 금지", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(m.load).toHaveBeenCalledWith("t-mine", "english", "2026-10-19");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
  it("🔴 보기 권한이 없으면(강사 화면·시간표 열람 불가) 403 — 읽지 않는다", async () => {
    m.access = { canView: false, canEdit: false };
    expect((await get()).status).toBe(403);
    expect(m.load).not.toHaveBeenCalled();
  });
  it("로그인이 없으면 401", async () => {
    m.user = null;
    expect((await get()).status).toBe(401);
    expect(m.load).not.toHaveBeenCalled();
  });
  it("영어가 아니거나 주가 월요일이 아니면 400(지점 전체·임의 범위 조회 없음)", async () => {
    expect((await get("subject=math&week=2026-10-19")).status).toBe(400);
    expect((await get("subject=english&week=2026-10-22")).status).toBe(400);
    expect((await get("subject=english")).status).toBe(400);
    expect(m.load).not.toHaveBeenCalled();
  });
});
