// 강사 화면 언어 — '다른 강사 뷰'면 본인 선택(ui_prefs)은 보는 사람 A, 관리자 지정·이름 기본값은 대상 X(원장 2026-11-05 강사뷰 전수).
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  user: vi.fn(),
  shell: vi.fn(),
  rows: {} as Record<string, { ui_prefs?: unknown; teacher_view_lang?: string | null }>,
}));

vi.mock("server-only", () => ({}));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/auth/view-mode", () => ({ getShellView: m.shell }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: (col: string) => {
        let id = "";
        const q = {
          eq: (k: string, v: string) => { if (k === "id") id = v; return q; },
          maybeSingle: async () => ({ data: col === "ui_prefs" ? { ui_prefs: m.rows[id]?.ui_prefs ?? null } : { teacher_view_lang: m.rows[id]?.teacher_view_lang ?? null }, error: null }),
        };
        return q;
      },
    }),
  }),
}));

import { getTeacherViewLang } from "./lang";

const A = { id: "a1", tenantId: "t1", systemRole: "master", displayName: "김원장" };
const X = { id: "x1", tenantId: "t1", systemRole: "teacher", displayName: "Sarah" };

beforeEach(() => {
  vi.clearAllMocks();
  m.shell.mockResolvedValue("teacher");
  m.user.mockImplementation(async (o?: { teacherView?: boolean }) => (o?.teacherView ? X : A));
  m.rows = {};
});

describe("강사 화면 언어 — 강사뷰", () => {
  it("🔴 A가 고른 적이 없으면 X 화면의 기본 언어(이름 도출 · 원어민 = 영어)", async () => {
    expect(await getTeacherViewLang()).toBe("en");
  });

  it("🔴 관리자 지정은 대상 X의 값을 따른다(A의 지정이 아니다)", async () => {
    m.rows = { x1: { teacher_view_lang: "ko" }, a1: { teacher_view_lang: "en" } };
    expect(await getTeacherViewLang()).toBe("ko");
  });

  it("🔴 보는 사람 A가 스위치로 고른 값(A의 ui_prefs)이 맨 위 — 스위치가 A에게 쓰므로 A에게서 읽는다", async () => {
    m.rows = { a1: { ui_prefs: { teacherView: { lang: "ko" } } }, x1: { ui_prefs: { teacherView: { lang: "en" } }, teacher_view_lang: "en" } };
    expect(await getTeacherViewLang()).toBe("ko");
  });

  it("강사뷰가 아니면(대상 = 본인) 종전 그대로 · 관리자뷰면 한국어", async () => {
    m.user.mockResolvedValue(A);
    expect(await getTeacherViewLang()).toBe("ko");
    m.shell.mockResolvedValue("admin");
    m.user.mockImplementation(async (o?: { teacherView?: boolean }) => (o?.teacherView ? X : A));
    expect(await getTeacherViewLang()).toBe("ko");
  });
});
