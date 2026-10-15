import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  cookie: undefined as string | undefined,
  cookiesThrow: false,
  /** 확인 읽기가 차례로 돌려줄 `ui_prefs` — 비면 `{}` */
  reads: [] as Array<Record<string, unknown>>,
  patches: [] as Array<{ ns: string; patch: Record<string, unknown> }>,
  patchOk: true,
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => {
    if (h.cookiesThrow) throw new Error("요청 밖");
    return { get: (name: string) => (name === "eywa-fseen" && h.cookie !== undefined ? { value: h.cookie } : undefined) };
  }),
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: vi.fn(async () => ({ id: "u1", tenantId: "t1" })) }));
vi.mock("@/lib/ui-prefs/patch", () => ({
  patchMyUiPrefs: vi.fn(async (ns: string, patch: Record<string, unknown>) => {
    h.patches.push({ ns, patch });
    return h.patchOk ? { ok: true } : { ok: false, error: "막힘" };
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { ui_prefs: h.reads.shift() ?? {} }, error: null }) }) }) }),
    }),
  }),
}));

import { freshRawUiPrefs, freshSavedFilters } from "./server";

const nowSec = () => Math.floor(Date.now() / 1000);
const saved = { subject: "math", grade: "중1", teacher: "all", field: "name", sort: "name", noenr: true };
const defaults = { subject: "all", grade: "all", teacher: "all", field: "all", sort: "grade", noenr: false };
const CLEAR_STUDENTS = { subject: undefined, grade: undefined, teacher: undefined, noenr: undefined };

beforeEach(() => {
  h.cookie = undefined;
  h.cookiesThrow = false;
  h.reads = [];
  h.patches = [];
  h.patchOk = true;
});

describe("필터 10분 초기화 — 서버 판정", () => {
  it("10분 안에 본 화면은 저장값 그대로 · 아무것도 지우지 않는다", async () => {
    h.cookie = `students:${nowSec() - 60}`;
    expect(await freshSavedFilters("students", saved, defaults)).toBe(saved);
    expect(h.patches).toHaveLength(0);
  });

  it("🔴 10분 넘게 안 봤으면(기록 없음 포함) 필터 키만 기본값 · 정렬·검색 범위는 그대로 · 저장값의 필터 키는 **그리는 도중에** 공용 쓰기로 지운다", async () => {
    h.cookie = `students:${nowSec() - 11 * 60}`;
    const out = await freshSavedFilters("students", saved, defaults);
    expect(out).toEqual({ subject: "all", grade: "all", teacher: "all", field: "name", sort: "name", noenr: false });
    // 응답 뒤(after)가 아니라 돌려주기 전에 끝났다 — 지점 보기 판정이 서는 자리
    expect(h.patches).toEqual([{ ns: "students", patch: CLEAR_STUDENTS }]);
  });

  it("🔴 지운 뒤 다른 창의 쓰기가 키를 되살렸으면 한 번 더 지운다 — 그래도 남으면 거기서 멈춘다", async () => {
    h.cookie = `students:0`;
    h.reads = [{ students: { grade: "중1" } }, { students: { grade: "중1" } }];
    await freshSavedFilters("students", saved, defaults);
    expect(h.patches).toHaveLength(2);
  });

  it("쓰기가 막히면(지점 보기 등) 확인·재시도 없이 그만둔다 — 화면은 이미 기본값", async () => {
    h.patchOk = false;
    const out = await freshSavedFilters("students", saved, defaults);
    expect(out.subject).toBe("all");
    expect(h.patches).toHaveLength(1);
  });

  it("'안 본 것'(0)으로 적힌 화면도 기본값 · 다른 화면 기록은 상관없다", async () => {
    h.cookie = `students:0~classes:${nowSec()}`;
    expect((await freshSavedFilters("students", saved, defaults)).subject).toBe("all");
  });

  it("저장값이 이미 기본값이면 지울 것이 없다(DB 쓰기 0)", async () => {
    expect(await freshSavedFilters("students", { ...defaults, sort: "name" }, defaults)).toEqual({ ...defaults, sort: "name" });
    expect(h.patches).toHaveLength(0);
  });

  it("쿠키를 못 읽는 자리(요청 밖)는 종전대로 저장값을 쓴다", async () => {
    h.cookiesThrow = true;
    expect(await freshSavedFilters("students", saved, defaults)).toBe(saved);
    expect(h.patches).toHaveLength(0);
  });

  it("원본을 읽는 화면(영어 시트) — 필터 키만 걷은 사본 · 순서 같은 다른 키는 그대로 · 원본은 건드리지 않는다", async () => {
    const raw = { ecs: { englishTrack: "eie", teacher: "t9", goalsRole: "sub", landingOrder: ["a"] }, other: 1 };
    h.cookie = `ecs:${nowSec() - 3600}`;
    expect(await freshRawUiPrefs("ecs", raw)).toEqual({ ecs: { landingOrder: ["a"] }, other: 1 });
    expect(raw.ecs.englishTrack).toBe("eie");
    expect(h.patches).toEqual([{ ns: "ecs", patch: { englishTrack: undefined, teacher: undefined, goalsRole: undefined } }]);
    h.cookie = `ecs:${nowSec()}`;
    expect(await freshRawUiPrefs("ecs", raw)).toBe(raw);
    expect(await freshRawUiPrefs("ecs", { ecs: { landingOrder: [] } })).toEqual({ ecs: { landingOrder: [] } });
    expect(await freshRawUiPrefs("ecs", null)).toBeNull();
    expect(h.patches).toHaveLength(1);
  });
});
