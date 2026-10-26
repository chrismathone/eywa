import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ admin: vi.fn(), log: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: m.admin }));
vi.mock("@/lib/supabase/db-error", () => ({ logDbError: m.log }));

import { isMissingRatingsTable, loadRatingPoints, loadReportRatings } from "./report-ratings";

type Result = { data: unknown[] | null; error: { message: string; code?: string } | null };

/** `from(t).select(c).eq(k, v).in(k, ids)` 사슬 — 호출을 기록하고 마지막에 결과를 돌려준다. */
function fakeAdmin(result: Result) {
  const calls: { table?: string; eq: [string, unknown][]; inIds: string[][] } = { eq: [], inIds: [] };
  const chain = {
    select: () => chain,
    eq: (k: string, v: unknown) => {
      calls.eq.push([k, v]);
      return chain;
    },
    in: (_k: string, ids: string[]) => {
      calls.inIds.push(ids);
      return Promise.resolve(result);
    },
  };
  m.admin.mockReturnValue({
    from: (t: string) => {
      calls.table = t;
      return chain;
    },
  });
  return calls;
}

const dbRow = { report_id: "r1", points: "3.30", items: [], parent_feeling: null, suggestion: null, claim: null, claim_reason: null, rated_on: "2026-10-22" };

beforeEach(() => vi.clearAllMocks());

describe("loadReportRatings — 평점 표 읽기", () => {
  it("🔴 admin으로 읽으니 tenant_id 필터를 반드시 건다(정책 0개 표, #104)", async () => {
    const calls = fakeAdmin({ data: [dbRow], error: null });
    const out = await loadReportRatings("tenant-a", ["r1", "r1", "r2"]);
    expect(calls.table).toBe("lesson_report_ratings");
    // 🔴 지금 기준(v6)으로 매긴 줄만 — 옛 기준 값은 원장이 '전혀 신뢰안가는 점수'라 한 값(2026-10-26)
    expect(calls.eq).toEqual([["tenant_id", "tenant-a"], ["rubric", "v6-owner44"]]);
    expect(calls.inIds).toEqual([["r1", "r2"]]);
    expect(out.get("r1")?.points).toBe(3.3);
    expect(out.has("r2")).toBe(false);
  });

  it("보고서가 없거나 지점을 모르면 표를 읽지 않는다", async () => {
    expect((await loadReportRatings("tenant-a", [])).size).toBe(0);
    expect((await loadReportRatings("", ["r1"])).size).toBe(0);
    expect(m.admin).not.toHaveBeenCalled();
  });

  it("표가 없으면(0450a 적용 전, #95) 조용히 빈 값 — 로그도 남기지 않는다", async () => {
    fakeAdmin({ data: null, error: { message: "Could not find the table 'public.lesson_report_ratings' in the schema cache", code: "PGRST205" } });
    expect((await loadReportRatings("tenant-a", ["r1"])).size).toBe(0);
    expect(m.log).not.toHaveBeenCalled();
  });

  it("그 밖의 오류는 로그를 남기고 빈 값 — 평점 때문에 목록이 막히지 않는다", async () => {
    fakeAdmin({ data: null, error: { message: "permission denied for table lesson_report_ratings" } });
    expect((await loadReportRatings("tenant-a", ["r1"])).size).toBe(0);
    expect(m.log).toHaveBeenCalledTimes(1);
    expect(m.log.mock.calls[0]![1]).toBe("report-admin.ratings");
  });

  it("표 없음 판정 — 코드 또는 (표 이름 + 문구)", () => {
    expect(isMissingRatingsTable({ code: "42P01" })).toBe(true);
    expect(isMissingRatingsTable(new Error('fetchInChunks: relation "public.lesson_report_ratings" does not exist'))).toBe(true);
    expect(isMissingRatingsTable(new Error('fetchInChunks: relation "public.other" does not exist'))).toBe(false);
    expect(isMissingRatingsTable(null)).toBe(false);
  });
});

/** `from(t).select(c).eq().eq().order().range(a, b)` — 페이지마다 다른 결과를 돌려준다(fetchAllPaged). */
function fakePagedAdmin(pages: Result[]) {
  const calls: { eq: [string, unknown][]; ranges: [number, number][] } = { eq: [], ranges: [] };
  const chain = {
    select: () => chain,
    eq: (k: string, v: unknown) => {
      calls.eq.push([k, v]);
      return chain;
    },
    order: () => chain,
    range: (a: number, b: number) => {
      calls.ranges.push([a, b]);
      return Promise.resolve(pages[calls.ranges.length - 1] ?? { data: [], error: null });
    },
  };
  m.admin.mockReturnValue({ from: () => chain });
  return calls;
}

describe("loadRatingPoints — 평점 정렬용 점수 전부", () => {
  it("🔴 tenant_id + 지금 기준만 · 1,000행 넘으면 다음 페이지까지(#54) · 범위 밖 값은 버린다", async () => {
    const first = Array.from({ length: 1000 }, (_, i) => ({ report_id: `r${i}`, points: (i % 5) + 1 }));
    const calls = fakePagedAdmin([{ data: first, error: null }, { data: [{ report_id: "x", points: "4" }, { report_id: "bad", points: 9 }], error: null }]);
    const out = await loadRatingPoints("tenant-a");
    expect(calls.eq).toContainEqual(["tenant_id", "tenant-a"]);
    expect(calls.eq).toContainEqual(["rubric", "v6-owner44"]);
    expect(calls.ranges.length).toBe(2);
    expect(out.size).toBe(1001);
    expect(out.get("x")).toBe(4);
    expect(out.has("bad")).toBe(false);
  });

  it("실패하면 로그만 남기고 빈 값 — 정렬은 '평점 없음'으로만 서고 목록은 뜬다", async () => {
    fakePagedAdmin([{ data: null, error: { message: "boom" } }]);
    expect((await loadRatingPoints("tenant-a")).size).toBe(0);
    expect(m.log).toHaveBeenCalled();
    expect((await loadRatingPoints("")).size).toBe(0);
  });
});
