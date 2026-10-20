import { describe, expect, it } from "vitest";
import { CLEANUP_WITHDRAWAL_MEMO } from "@/features/withdrawals/system-bulk";
import { loadCleanupBilling } from "./trend-billing-server";

type Row = Record<string, unknown>;

/** 이 파일이 쓰는 PostgREST 꼴만 흉내 내는 가짜 클라이언트(eq · in · not in · like · gte · lte · order · limit · range · head 건수). */
function fakeDb(tables: Record<string, Row[]>, failWhen: (table: string, head: boolean, limited: boolean) => boolean = () => false) {
  const calls: string[] = [];
  const db = {
    from(table: string) {
      calls.push(table);
      const f = { eq: {} as Record<string, unknown>, in: null as [string, unknown[]] | null, notIn: null as [string, string[]] | null, gte: null as string | null, lte: null as string | null, like: false, head: false, limit: null as number | null, range: null as [number, number] | null };
      const q = {
        select: (_c: string, o?: { head?: boolean }) => ((f.head = !!o?.head), q),
        eq: (k: string, v: unknown) => ((f.eq[k] = v), q),
        in: (k: string, v: unknown[]) => ((f.in = [k, v]), q),
        not: (k: string, _op: "in", v: string) => ((f.notIn = [k, v.replace(/[()]/g, "").split(",")]), q),
        like: () => ((f.like = true), q),
        gte: (_k: string, v: string) => ((f.gte = v), q),
        lte: (_k: string, v: string) => ((f.lte = v), q),
        order: () => q,
        limit: (n: number) => ((f.limit = n), q),
        range: (a: number, b: number) => ((f.range = [a, b]), q),
        then(resolve: (v: unknown) => void) {
          if (failWhen(table, f.head, f.limit !== null)) return resolve({ data: null, error: { message: "boom", code: "XX000" }, count: null });
          let rows = (tables[table] ?? []).filter((r) => Object.entries(f.eq).every(([k, v]) => r[k] === v));
          if (f.in) rows = rows.filter((r) => f.in![1].includes(r[f.in![0]]));
          if (f.notIn) rows = rows.filter((r) => !f.notIn![1].includes(String(r[f.notIn![0]])));
          if (f.like) rows = rows.filter((r) => /^....-..$/.test(String(r.period)));
          if (f.gte) rows = rows.filter((r) => String(r.period) >= f.gte!);
          if (f.lte) rows = rows.filter((r) => String(r.period) <= f.lte!);
          if (table === "invoices") rows = [...rows].sort((a, b) => String(a.period).localeCompare(String(b.period)));
          if (f.head) return resolve({ data: null, error: null, count: rows.length });
          if (f.range) rows = rows.slice(f.range[0], f.range[1] + 1);
          if (f.limit !== null) rows = rows.slice(0, f.limit);
          return resolve({ data: rows, error: null, count: null });
        },
      };
      return q;
    },
  };
  return { db: db as never, calls };
}

const T = "t1";
const cleanup = { reason: "other", memo: CLEANUP_WITHDRAWAL_MEMO };
const students = [
  { tenant_id: T, id: "k", status: "withdrawn", withdrawal_metadata: cleanup },
  { tenant_id: T, id: "n", status: "withdrawn", withdrawal_metadata: cleanup }, // 청구가 하나도 없는 장부 정리 학생
  { tenant_id: T, id: "w", status: "withdrawn", withdrawal_metadata: { reason: "relocation", memo: "이사" } },
];
const month = (period: string, n: number): Row[] => Array.from({ length: n }, (_, i) => ({ tenant_id: T, student_id: `s${i}`, period, status: "paid", category: "tuition" }));
const bill = (period: string, status = "paid", tenant = T): Row => ({ tenant_id: tenant, student_id: "k", period, status, category: "tuition" });

describe("loadCleanupBilling — 청구가 지점을 덮기 시작한 달 · 장부 정리 학생의 청구 달", () => {
  it("옛 청구월 오타(10년 전)는 보지 않고, 낱장 청구 달은 건너뛴다(그 뒤 6개월 중 가장 많은 달의 20% · 3건) · 취소·환불 청구는 시작 달 건수에도 안 든다", async () => {
    const invoices = [
      { tenant_id: T, student_id: "s0", period: "2016-03", status: "paid", category: "tuition" }, // 2026-03을 잘못 친 청구
      { tenant_id: T, student_id: "s1", period: "2024-02", status: "paid", category: "tuition" }, // 낱장 청구
      ...month("2026-01", 8),
      ...month("2026-02", 9),
      ...month("2026-03", 9), // 청구가 석 달 이어져야 시작 달이다(낱장·시범 청구 달 거르기)
      bill("2026-01"),
      bill("2026-02", "void"),
      bill("2026-03", "refunded"),
      bill("2026-04", "paid", "other"), // 다른 지점 줄은 안 읽는다
    ];
    const { db } = fakeDb({ students, invoices });
    const r = await loadCleanupBilling(db, T, "2026-10-20");
    expect(r.billingFrom).toBe("2026-01");
    expect(new Map(r.billed).get("k")).toEqual(["2026-01"]); // 취소·환불 청구는 빼고 · 다른 지점 줄 없음
    expect(new Map(r.billed).get("n")).toEqual([]); // 청구가 없어도 싣는다 — 실리지 않은 학생만 '모름'(종전 규칙)
  });

  it("학생이 늘어 온 지점도 첫 달을 놓치지 않는다(지금 인원이 아니라 그 뒤 6개월 중 가장 많은 달의 20%가 기준)", async () => {
    const { db } = fakeDb({ students, invoices: [...month("2026-04", 50), ...month("2026-05", 81), ...month("2026-06", 90), bill("2026-04")] });
    expect((await loadCleanupBilling(db, T, "2026-10-20")).billingFrom).toBe("2026-04");
  });

  it("🔴 취소된 청구만 몰린 달은 시작 달이 아니다(등록 판정·'지난 기록'과 같은 입력 — 적대 재리뷰 2026-10-20)", async () => {
    const voided = month("2025-12", 10).map((r) => ({ ...r, status: "void" }));
    const { db } = fakeDb({ students, invoices: [...voided, ...month("2026-01", 8), ...month("2026-02", 9), ...month("2026-03", 9)] });
    expect((await loadCleanupBilling(db, T, "2026-10-20")).billingFrom).toBe("2026-01");
  });

  it("장부 정리 학생이 없으면 청구는 읽지 않는다", async () => {
    const { db, calls } = fakeDb({ students: [students[2]!], invoices: month("2026-01", 8) });
    expect(await loadCleanupBilling(db, T, "2026-10-20")).toEqual({ billingFrom: null, billed: [] });
    expect(calls).toEqual(["students"]);
  });

  it("🔴 조회가 실패하면 던진다 — 캐시에 대체값을 굳히지 않는다(대체는 부르는 쪽이 그 요청에서만), 어느 조회인지와 오류 글이 남는다", async () => {
    const all = fakeDb({ students, invoices: month("2026-01", 8) }, () => true);
    await expect(loadCleanupBilling(all.db, T, "2026-10-20")).rejects.toThrow(/boom/);
    const counts = fakeDb({ students, invoices: month("2026-01", 8) }, (table, head) => table === "invoices" && head);
    await expect(loadCleanupBilling(counts.db, T, "2026-10-20")).rejects.toThrow(/청구 건수: boom/);
    const first = fakeDb({ students, invoices: month("2026-01", 8) }, (table, head, limited) => table === "invoices" && !head && limited);
    await expect(loadCleanupBilling(first.db, T, "2026-10-20")).rejects.toThrow(/청구 시작 달: boom/);
  });
});
