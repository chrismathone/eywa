import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 연결 탐색의 '신규생 90일 점검' 문(2026-11-11 적대 리뷰) — 이 점검은 그 원생의 모든 과목 줄을 접어 보인다.
 * 신규생 관리를 지점 전체로 읽는 계정('전체' · '읽기')에게만 연다 — 강사 '담당'(자기가 담임인 과목 줄만 보는 계정)에게는 닫는다.
 */
const m = vi.hoisted(() => ({ all: vi.fn(), newcomers: vi.fn(), student: vi.fn(), disabled: [] as string[] }));
vi.mock("@/features/newcomers/server/scope", () => ({ readsAllNewcomers: m.all }));
vi.mock("@/features/newcomers/server/queries", () => ({ getNewcomers: m.newcomers }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: async () => ({ modules: { disabled: m.disabled } }) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: m.student }) }) }) }),
}));
vi.mock("./shared", () => ({ settle: async (_scope: string, run: PromiseLike<unknown>) => ({ ok: true, value: await run }) }));

import { loadCareChecks } from "./student-care-sector";

const TODAY = "2026-11-11";
beforeEach(() => {
  vi.clearAllMocks(); m.disabled = [];
  m.all.mockResolvedValue(true);
  m.student.mockResolvedValue({ data: { enrolled_at: "2026-10-20" }, error: null });
  m.newcomers.mockResolvedValue({ checksAvailable: true, rows: [], subjectRows: [] });
});

describe("loadCareChecks — 문", () => {
  it("🔴 담당 범위 계정(강사 '담당')에게는 닫는다 — 신규생 명단을 읽기 전에 거절한다", async () => {
    m.all.mockResolvedValue(false);
    expect(await loadCareChecks("student", TODAY)).toEqual({ state: "denied", enrolledOn: null, items: [] });
    expect(m.student).not.toHaveBeenCalled();
    expect(m.newcomers).not.toHaveBeenCalled();
  });
  it("지점 전체로 읽는 계정은 종전대로 신규생 명단에서 이 원생 줄을 찾는다", async () => {
    expect((await loadCareChecks("student", TODAY)).state).toBe("notNewcomer");
    expect(m.newcomers).toHaveBeenCalledTimes(1);
  });
  it("신규생 관리가 꺼진 지점이면 권한을 묻기 전에 칸 자체가 없다", async () => {
    m.disabled = ["newcomers"];
    expect((await loadCareChecks("student", TODAY)).state).toBe("off");
    expect(m.all).not.toHaveBeenCalled();
  });
});
