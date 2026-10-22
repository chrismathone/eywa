/**
 * '강사뷰로 전환' — **버튼이 보이면 누르면 들어간다** (2026-09-11 메뉴·창 이동 전수검사).
 *
 * 노출(`canUseTeacherView`)은 오늘 위임받은 반(0173a)까지 자격으로 치는데, 전환 액션은 담당 반만 봤다.
 * 그래서 담당 반 0개 + 위임만 받은 관리자에게는 버튼이 서는데 눌러도 쿠키가 안 걸려 **아무 일도 안 일어났다**
 * (버튼이 잠깐 흐려졌다 풀리고 화면 그대로). 두 판정을 같은 함수로 묶었는지를 여기서 잠근다.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  user: null as { id: string; systemRole: string; tenantId: string } | null,
  ownClassIds: [] as string[],
  subjects: [] as string[],
  delegated: false,
  assistant: [] as string[],
  jar: { set: vi.fn(), delete: vi.fn(), get: vi.fn<(key: string) => { value: string } | undefined>() },
}));

vi.mock("next/headers", () => ({ cookies: async () => h.jar }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => h.user }));
vi.mock("@/lib/auth/teacher-scope", () => ({
  getTeacherScope: async () => ({ classIds: h.ownClassIds, studentIds: [], subjects: h.subjects }),
}));
vi.mock("@/features/classes/server/delegation", () => ({ hasActiveDelegation: async () => h.delegated }));
// 노출 판정의 담당 반 head 카운트 — 담당 반 목록과 같은 값을 돌려준다(둘은 같은 조건의 조회다).
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({ select: () => ({ eq: async () => ({ count: h.ownClassIds.length, error: null }) }) }),
  }),
}));
vi.mock("@/lib/auth/super-admin", () => ({ isCurrentUserSuperAdmin: async () => false }));
// 착지 규칙 자체는 teacher-home 쪽 테스트가 잠근다 — 여기선 **어떤 과목을 넘겼는지**만 본다.
vi.mock("@/lib/auth/teacher-home", () => ({
  teacherHomeForSubjects: async (s: string[]) => `home:${s.join("+") || "-"}`,
}));
vi.mock("@/features/class-sheets/server/access", () => ({ englishAssistantClassIdsOf: async () => h.assistant }));
vi.mock("@/features/audit/server/log", () => ({ logAction: async () => undefined }));
vi.mock("@/lib/supabase/batch", () => ({ fetchAllPaged: async () => [], fetchInChunks: async () => [] }));

/** React cache가 케이스 사이에 답을 들고 가지 않게 매번 새로 읽는다. */
async function load() {
  vi.resetModules();
  const actions = await import("./view-actions");
  const mode = await import("@/lib/auth/view-mode");
  return { ...actions, ...mode };
}

beforeEach(() => {
  h.user = { id: "u-mgr", systemRole: "manager", tenantId: "t1" };
  h.ownClassIds = [];
  h.subjects = [];
  h.delegated = false;
  h.assistant = [];
  h.jar.set.mockClear();
  h.jar.delete.mockClear();
  h.jar.get.mockReset().mockReturnValue(undefined);
});

describe("'강사뷰로 전환' — 노출과 진입이 같은 판정", () => {
  it("강사뷰에서는 다른 강사 목록과 전환 액션을 모두 닫는다", async () => {
    h.ownClassIds = ["c1"];
    h.jar.get.mockImplementation(key => key === "eywa-view" ? { value: "teacher" } : undefined);
    const { switchToOtherTeacherView, listTeacherViewTargets } = await load();
    expect(await switchToOtherTeacherView("someone-else")).toBeNull();
    expect(await listTeacherViewTargets()).toEqual([]);
    expect(h.jar.set).not.toHaveBeenCalled();
  });
  it("🔴 위임만 받은 관리자 — 버튼이 서고, 누르면 강사뷰 쿠키가 걸리며 착지 경로가 온다", async () => {
    h.delegated = true;
    const { canUseTeacherView, switchToTeacherView, VIEW_MODE_COOKIE } = await load();
    expect(await canUseTeacherView()).toBe(true);
    expect(await switchToTeacherView()).toBe("home:-");
    expect(h.jar.set).toHaveBeenCalledWith(VIEW_MODE_COOKIE, "teacher", expect.anything());
  });

  it("위임만 받았어도 부담임 영어 반이 있으면 영어 강사 홈 갈래로 착지한다(강사 홈 규칙과 같은 갈래)", async () => {
    h.delegated = true;
    h.assistant = ["c-eng"];
    const { switchToTeacherView } = await load();
    expect(await switchToTeacherView()).toBe("home:english");
  });

  it("담당 반이 있으면 종전 그대로 — 담당 과목으로 착지", async () => {
    h.ownClassIds = ["c1"];
    h.subjects = ["math"];
    const { switchToTeacherView } = await load();
    expect(await switchToTeacherView()).toBe("home:math");
  });

  it("담당 반도 위임도 없으면 — 버튼이 없고, 직접 불러도 쿠키를 걸지 않는다", async () => {
    const { canUseTeacherView, switchToTeacherView } = await load();
    expect(await canUseTeacherView()).toBe(false);
    expect(await switchToTeacherView()).toBeNull();
    expect(h.jar.set).not.toHaveBeenCalled();
  });

  it("🔑 담당 반 × 위임 네 조합 모두 — 버튼이 보이는 것과 전환되는 것이 같은 답이다", async () => {
    for (const own of [[], ["c1"]]) {
      for (const delegated of [false, true]) {
        h.ownClassIds = own;
        h.subjects = own.length ? ["math"] : [];
        h.delegated = delegated;
        const { canUseTeacherView, switchToTeacherView } = await load();
        const shown = await canUseTeacherView();
        const entered = (await switchToTeacherView()) !== null;
        expect(entered, `담당 반 ${own.length}개 · 위임 ${delegated}`).toBe(shown);
      }
    }
  });

  it("실 강사·학생은 전환 대상이 아니다(애초에 미니셸이라 버튼이 없다)", async () => {
    h.ownClassIds = ["c1"];
    for (const role of ["teacher", "student"]) {
      h.user = { id: "u1", systemRole: role, tenantId: "t1" };
      const { switchToTeacherView } = await load();
      expect(await switchToTeacherView()).toBeNull();
    }
  });
});
