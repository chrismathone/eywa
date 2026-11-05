/**
 * ECS 표시 취향은 **보는 사람(실제 계정)** 것을 읽는다 — 쓰기(patchMyUiPrefs)가 실제 계정에 저장하므로(2026-11-05 강사뷰 신원 점검).
 * 관리자가 강사 X의 화면에서 글씨 크기를 바꾸면 자기 계정에 저장되는데, 읽기는 X의 행을 읽어 "눌러도 안 바뀌는" 토글이 됐다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ user: vi.fn(), eqs: [] as unknown[][] }));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = (k: string, v: unknown) => { m.eqs.push([k, v]); return q; };
      q.maybeSingle = async () => ({ data: { ui_prefs: { ecs: { fontSize: "lg" } } }, error: null });
      return q;
    },
  }),
}));

import { loadViewerUiPrefs } from "./viewer-prefs";

beforeEach(() => {
  vi.clearAllMocks();
  m.eqs = [];
  m.user.mockImplementation(async (o?: { teacherView?: boolean }) =>
    o?.teacherView ? { id: "x-teacher", tenantId: "t1" } : { id: "a-viewer", tenantId: "t1" });
});

describe("loadViewerUiPrefs", () => {
  it("강사뷰 중에도 실제 계정의 행을 읽는다(tenant까지 좁힌다)", async () => {
    expect(await loadViewerUiPrefs()).toEqual({ data: { ui_prefs: { ecs: { fontSize: "lg" } } } });
    expect(m.user).toHaveBeenCalledWith();
    expect(m.user).not.toHaveBeenCalledWith({ teacherView: true });
    expect(m.eqs).toEqual([["id", "a-viewer"], ["tenant_id", "t1"]]);
  });

  it("로그인이 없으면 조회하지 않고 빈 값", async () => {
    m.user.mockResolvedValue(null);
    expect(await loadViewerUiPrefs()).toEqual({ data: null });
    expect(m.eqs).toEqual([]);
  });
});

describe("배선 — ECS 표시 취향 읽기는 전부 이 함수 하나", () => {
  const read = (...p: string[]) => readFileSync(join(process.cwd(), "src", "features", "class-sheets", "server", ...p), "utf8");
  const READERS = ["today.ts", "queries.ts", "seat-day.ts", "goals-board.ts", "month-queries.ts"];

  it.each(READERS)("%s — 강사뷰 대상(user.id)의 ui_prefs를 직접 읽지 않는다", (file) => {
    const src = read(file);
    expect(src).toContain("loadViewerUiPrefs()");
    expect(src).not.toMatch(/select\("ui_prefs"\)\.eq\("id", (?:user|access\.user)\.id\)/);
  });

  it("반 순서만은 화면 주인(그 강사)이 저장한 값을 읽는다 — 원장 2026-09-05 '그 사람 뷰와 동일'", () => {
    for (const file of ["today.ts", "queries.ts"]) {
      const src = read(file);
      expect(src, file).toContain("orderOwner");
      expect(src, file).toMatch(/\.eq\("id", orderOwner\.id\)/);
    }
  });

  it("🔴 반 순서 저장은 '다른 강사 뷰'(전체 포함)면 서버도 거절한다 — 화면 canReorder = viewAs === null과 같은 판정", () => {
    const actions = read("actions.ts");
    for (const fn of ["setMyEcsTodayOrder", "setMyEcsLandingOrder"]) {
      const at = actions.indexOf(`export async function ${fn}(`);
      const body = actions.slice(at, actions.indexOf("\nexport async function ", at + 1));
      expect(body, fn).toContain("if (await viewAsTeacher()) return { ok: false, error: OTHER_TEACHER_ORDER_ERROR };");
      // 순서 거절 뒤에는 보는 사람 = 화면 주인이라 읽기(저장분)·쓰기(patchMyUiPrefs)가 같은 행이다.
      expect(body, fn).toContain("const user = await getCurrentUser();");
      expect(body, fn).not.toContain("getCurrentUser({ teacherView: true })");
    }
  });
});
