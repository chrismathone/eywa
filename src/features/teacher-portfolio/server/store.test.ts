import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { PortfolioPeriod, PortfolioResult } from "../model/types";
import { closingSourceFor, isPortfolioTableMissing, loadOpenMonths, savePortfolioMonths } from "./store";

/** 🔴 마감한 달은 다시 쓰지 않는다 — 말일 이후의 보충이 지난달 점수를 바꾸면 안 된다(원장 2026-10-12). */
type Row = Record<string, unknown>;

/** 저장 표 하나만 흉내 내는 클라이언트 — 조회 조건을 그대로 적용하고 쓰기를 기록한다. */
function fakeAdmin(initial: Row[]) {
  const rows = initial.map((r) => ({ ...r }));
  const upserted: Row[] = [];
  const deleted: Row[] = [];
  const from = () => {
    const tests: ((r: Row) => boolean)[] = [];
    let removing = false;
    const match = () => rows.filter((r) => tests.every((t) => t(r)));
    const api = {
      select: () => api,
      order: () => api,
      eq: (k: string, v: unknown) => { tests.push((r) => r[k] === v); return api; },
      in: (k: string, vs: unknown[]) => { tests.push((r) => vs.includes(r[k])); return api; },
      is: (k: string, v: unknown) => { tests.push((r) => (r[k] ?? null) === v); return api; },
      gte: (k: string, v: string) => { tests.push((r) => String(r[k]) >= v); return api; },
      range: (a: number, b: number) => Promise.resolve({ data: match().slice(a, b + 1), error: null }),
      upsert: (batch: Row[]) => { upserted.push(...batch); return Promise.resolve({ error: null }); },
      delete: () => { removing = true; return api; },
      then: (resolve: (value: { data: Row[]; error: null }) => void) => {
        const hit = match();
        if (removing) deleted.push(...hit);
        resolve({ data: hit, error: null });
      },
    };
    return api;
  };
  return { admin: { from } as unknown as SupabaseClient, upserted, deleted };
}

const period = (month: string, partial: boolean): PortfolioPeriod => ({
  month, start: `${month}-01`, end: partial ? `${month}-11` : `${month}-30`, partial, subjects: ["math"], classes: ["반"], students: 1,
  items: [], knownCount: 8, knownScore: 40, knownMax: 100, total: 40, ownReportRecords: 0, holidays: [], dayStats: [],
});
const result = (teacherIds: string[]): PortfolioResult => ({
  tenant: "검증", capturedAt: "2026-10-12T09:00:00Z", from: "2026-09-01", end: "2026-10-11", subjectOrder: ["math"], months: [], preRecord: null,
  teachers: teacherIds.map((id) => ({ id, name: id, subjects: ["math"], periods: [period("2026-10", true), period("2026-09", false)] })),
});
const stored = (teacherId: string, month: string, closed: boolean): Row => ({ tenant_id: "t1", teacher_id: teacherId, month, closed_at: closed ? "2026-10-01T00:10:00Z" : null });
const now = new Date("2026-10-12T09:00:00Z");

describe("마감 상태", () => {
  it("달이 끝난 바로 다음 날 마감하면 말일 마감, 그보다 늦으면 재구성이다", () => {
    expect(closingSourceFor("2026-09-30", new Date("2026-09-30T15:10:00Z"))).toBe("month_end"); // 10월 1일 00:10 KST
    expect(closingSourceFor("2026-09-30", new Date("2026-10-02T00:00:00Z"))).toBe("reconstructed");
  });
  it("표가 아직 없다는 오류만 '집계 전'으로 읽는다", () => {
    expect(isPortfolioTableMissing({ code: "PGRST205" })).toBe(true);
    expect(isPortfolioTableMissing({ message: "fetchAllPaged: Could not find the table 'public.teacher_portfolio_months' in the schema cache" })).toBe(true);
    expect(isPortfolioTableMissing({ message: "permission denied for table teacher_portfolio_months" })).toBe(false);
  });
});

describe("저장", () => {
  it("처음에는 진행 중인 달은 열어 두고 지난달은 마감해서 쓴다", async () => {
    const { admin, upserted } = fakeAdmin([]);
    const summary = await savePortfolioMonths(admin, "t1", result(["a"]), now);
    expect([summary.written, summary.closedMonths]).toEqual([2, ["2026-09"]]);
    const open = upserted.find((r) => r.month === "2026-10")!;
    const closed = upserted.find((r) => r.month === "2026-09")!;
    expect([open.closed_at, open.closing_source]).toEqual([null, null]);
    expect([closed.closed_at, closed.closing_source]).toEqual([now.toISOString(), "reconstructed"]);
    expect(upserted.every((r) => r.tenant_id === "t1")).toBe(true);
  });
  it("기준 달 평균을 쓴 달은 기준 달이 끝나기 전까지 열어 둔다", async () => {
    const { admin, upserted } = fakeAdmin([]);
    const r = result(["a"]);
    r.months = [{ month: "2026-10", start: "2026-10-01", end: "2026-10-11", partial: true }, { month: "2026-09", start: "2026-09-01", end: "2026-09-30", partial: false }];
    r.preRecord = { report: { before: "2026-10-05", reference: ["2026-11", "2026-12"] } };
    const sept = r.teachers[0].periods[1];
    sept.items = [{ id: "report", max: 20, value: null, basis: "", reason: "", detail: [], estimated: { since: "2026-10-05", targets: 3, reference: [] } }];
    const summary = await savePortfolioMonths(admin, "t1", r, now);
    expect(summary.closedMonths).toEqual([]);
    expect(upserted.find((row) => row.month === "2026-09")?.closed_at).toBeNull();
  });
  it("창의 가장 오래된 달은 기준 달을 기다리던 중이어도 마감한다 — 다음 실행에서 창 밖으로 밀려난다", async () => {
    const { admin } = fakeAdmin([]);
    const r = result(["a"]);
    r.months = [{ month: "2026-10", start: "2026-10-01", end: "2026-10-11", partial: true }, { month: "2026-09", start: "2026-09-01", end: "2026-09-30", partial: false }];
    r.preRecord = { report: { before: "2026-10-05", reference: ["2026-11", "2026-12"] } };
    const waiting = [{ id: "report" as const, max: 20, value: null, basis: "", reason: "", detail: [], estimated: { since: "2026-10-05", targets: 3, reference: [] } }];
    r.teachers[0].periods[1].items = waiting;
    r.teachers[0].periods.push({ ...period("2026-04", false), items: waiting });
    const summary = await savePortfolioMonths(admin, "t1", r, now);
    expect(summary.closedMonths).toEqual(["2026-04"]);
  });
  it("급여 비율을 일시 실패로 못 센 칸은 마감을 미룬다 — 0점으로 굳지 않게 다음 집계가 다시 센다", async () => {
    const { admin, upserted } = fakeAdmin([]);
    const summary = await savePortfolioMonths(admin, "t1", result(["a"]), now, { holdClose: (t, m) => t === "a" && m === "2026-09" });
    expect(summary.closedMonths).toEqual([]);
    expect(upserted.find((r) => r.month === "2026-09")?.closed_at).toBeNull();
  });
  it("🔴 이미 마감한 달은 다시 쓰지 않는다", async () => {
    const { admin, upserted } = fakeAdmin([stored("a", "2026-09", true), stored("a", "2026-10", false)]);
    const summary = await savePortfolioMonths(admin, "t1", result(["a"]), now);
    expect(upserted.map((r) => r.month)).toEqual(["2026-10"]);
    expect(summary.closedMonths).toEqual([]);
  });
  it("집계 대상에서 빠진 강사의 진행 중인 줄만 걷고, 마감한 줄은 남긴다", async () => {
    const { admin, deleted } = fakeAdmin([stored("gone", "2026-10", false), stored("gone", "2026-09", true), stored("a", "2026-10", false)]);
    const summary = await savePortfolioMonths(admin, "t1", result(["a"]), now);
    expect(summary.removed).toBe(1);
    expect(deleted.map((r) => `${r.teacher_id}|${r.month}`)).toEqual(["gone|2026-10"]);
  });
  it("마감 전 달은 창 안의 것만 읽는다 — 창 밖에 남은 줄이 퇴직자를 끝없이 붙들지 않게", async () => {
    const { admin } = fakeAdmin([stored("gone", "2026-03", false), stored("a", "2026-09", false), stored("a", "2026-10", false), stored("b", "2026-09", true)]);
    expect([...(await loadOpenMonths(admin, "t1", "2026-04"))]).toEqual([["a", ["2026-09", "2026-10"]]]);
  });
  it("다른 지점의 줄은 읽지도 지우지도 않는다", async () => {
    const other = { ...stored("x", "2026-10", false), tenant_id: "t2" };
    const { admin, deleted } = fakeAdmin([other]);
    await savePortfolioMonths(admin, "t1", result(["a"]), now);
    expect(deleted).toEqual([]);
  });
});
