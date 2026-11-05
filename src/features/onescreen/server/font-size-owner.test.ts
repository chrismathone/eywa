/**
 * 원스크린 글씨 크기는 **보는 사람(실제 계정)** 행에 저장한다 — '다른 강사 뷰'에서도(2026-11-05 강사뷰 신원 적대 리뷰).
 * 결함 모양: getCurrentUser({ teacherView: true })로 대상 강사 X의 행에 써서, 관리자가 X의 화면에서 키운 글씨가 X의 원스크린 크기를 바꿨다.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const A = { id: "a-master", tenantId: "t1", email: "", displayName: "원장", jobTitle: null, systemRole: "master" as const };
const X = { id: "x-teacher", tenantId: "t1", email: "", displayName: "강사X", jobTitle: null, systemRole: "teacher" as const };

const m = vi.hoisted(() => ({ readonly: null as string | null, eqs: [] as unknown[][], updates: [] as unknown[] }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async (o?: { teacherView?: boolean }) => (o?.teacherView ? X : A) }));
vi.mock("@/lib/auth/view-mode", () => ({
  effectiveTeacherId: async () => X.id,
  viewAsTeacher: async () => ({ ...X, access: "full" }),
  readonlyTeacherViewError: async () => m.readonly,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = (k: string, v: unknown) => { m.eqs.push([k, v]); return q; };
      q.maybeSingle = async () => ({ data: { ui_prefs: { onescreen: { sort: "name" }, timetable: { zoom: 2 } } }, error: null });
      q.update = (row: unknown) => { m.updates.push(row); return q; };
      q.then = (r: (v: unknown) => void) => r({ error: null });
      return q;
    },
  }),
}));

import { setMyOnescreenFontSize } from "./actions";

beforeEach(() => {
  m.readonly = null;
  m.eqs = [];
  m.updates = [];
});

describe("setMyOnescreenFontSize — 강사뷰 중에도 실제 계정 행", () => {
  it("대상 강사 X가 아니라 실제 계정 A의 행에 쓰고, 형제 설정은 보존한다", async () => {
    expect(await setMyOnescreenFontSize("lg")).toEqual({ ok: true });
    expect(m.eqs).toContainEqual(["id", A.id]);
    expect(m.eqs.some(([, v]) => v === X.id)).toBe(false);
    expect(m.updates).toEqual([{ ui_prefs: { onescreen: { sort: "name", fontSize: "lg" }, timetable: { zoom: 2 } } }]);
  });

  it("읽기 강사뷰·지점 보기에선 저장하지 않는다(같은 화면의 표시 옵션·영상 마감 기본값과 같은 규약)", async () => {
    m.readonly = "읽기 전용입니다";
    expect(await setMyOnescreenFontSize("lg")).toEqual({ ok: false, error: "읽기 전용입니다" });
    expect(m.updates).toEqual([]);
  });
});
