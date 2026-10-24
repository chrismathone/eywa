import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 운영실 '재원생 추이' 카드의 캐시 계약(적대 재리뷰 2026-10-20) — 청구 재료가 실패하면 **다른 키로 1분만** 캐시하고(정상 키를 대체값으로
 * 더럽히지 않는다 · 실패가 이어져도 원본은 분당 한 번), 청구가 있으면 정상 키로 5분. 계산값 캐시 안에서 다른 캐시를 부르지 않는다.
 */
// 키마다 값을 기억하는 가짜 캐시(성공한 값만 남긴다 — Next처럼) + 캐시 안에서 다른 캐시를 부르면 센다(Next는 안쪽 캐시를 건너뛴다).
const cacheCalls: { key: string[]; revalidate?: number }[] = [];
const store = new Map<string, unknown>();
let depth = 0;
let nested = 0;
vi.mock("next/cache", () => ({
  unstable_cache: (fn: () => Promise<unknown>, key: string[], opts?: { revalidate?: number }) => {
    cacheCalls.push({ key, revalidate: opts?.revalidate });
    return async () => {
      if (depth > 0) nested++;
      const k = key.join("|");
      if (store.has(k)) return store.get(k);
      depth++;
      try {
        const v = await fn();
        store.set(k, v);
        return v;
      } finally {
        depth--;
      }
    };
  },
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
const fetchAllPaged = vi.fn();
vi.mock("@/lib/supabase/batch", () => ({ fetchAllPaged: (...args: unknown[]) => fetchAllPaged(...args), fetchAllPagedInChunks: vi.fn() }));
const loadCleanupBilling = vi.fn();
vi.mock("./trend-billing-server", () => ({ loadCleanupBilling: (...args: unknown[]) => loadCleanupBilling(...args) }));
const loadRecordCoverage = vi.fn();
vi.mock("./record-coverage", () => ({ loadRecordCoverage: (...args: unknown[]) => loadRecordCoverage(...args) }));
const reportWarning = vi.fn();
vi.mock("@/lib/observability/report-error", () => ({ reportWarning: (...args: unknown[]) => reportWarning(...args) }));

const cleanupMeta = { reason: "other", memo: "데이터 정리 일괄 퇴원" };
// 원생 둘 — a는 재원, k는 수업 기록이 있는 장부 정리(퇴원일 7/3 · 청구는 3월만 살아 있다).
const students = [
  { id: "a", status: "enrolled", enrolled_at: "2026-01-05", withdrawn_at: null, notes: null, withdrawal_metadata: null },
  { id: "k", status: "withdrawn", enrolled_at: "2026-01-05", withdrawn_at: "2026-07-03", notes: null, withdrawal_metadata: cleanupMeta },
];
const enrollments = [
  { id: "e1", student_id: "a", start_date: "2026-01-06", end_date: null, is_transferred: false, class: { subject: "math" } },
  { id: "e2", student_id: "k", start_date: "2026-01-06", end_date: "2026-07-03", is_transferred: false, class: { subject: "math" } },
];

beforeEach(() => {
  cacheCalls.length = 0;
  store.clear();
  nested = 0;
  fetchAllPaged.mockReset();
  // loadTrendRaw가 원생 → 수강 순으로 부른다.
  fetchAllPaged.mockResolvedValueOnce(students).mockResolvedValueOnce(enrollments);
  loadCleanupBilling.mockReset();
  loadRecordCoverage.mockReset();
  loadRecordCoverage.mockResolvedValue({ billingFrom: "2026-01", started: [], trustFrom: null });
  reportWarning.mockReset();
});

const point = (rows: { key: string; count: number }[], key: string) => rows.find((p) => p.key === key)?.count;

describe("loadEnrolledTrend — 청구 재료가 있으면 정상 키 5분, 실패하면 다른 키 1분", async () => {
  const { loadEnrolledTrend } = await import("./enrolled-trend-server");

  it("청구가 있으면 'billed' 키 · 5분 — 장부 정리 학생은 청구가 살아 있는 달에만 센다", async () => {
    loadCleanupBilling.mockResolvedValue({ billingFrom: "2026-01", billed: [["k", ["2026-03"]]] });
    const v = await loadEnrolledTrend("t1", "2026-10-20");
    const card = cacheCalls.find((c) => c.key[0] === "dashboard-enrolled-trend-v8-subject");
    expect(card).toMatchObject({ key: ["dashboard-enrolled-trend-v8-subject", "t1", "2026-10-20", "[]", "billed", "-"], revalidate: 300 });
    expect(point(v.monthly, "2026-03")).toBe(2); // a + k(3월 청구)
    expect(point(v.monthly, "2026-05")).toBe(1); // k는 5월 청구가 없다(퇴원일 7/3 전이어도)
    // 강좌수 추이도 같은 원본으로 함께 센다(한 캐시) — 단 수강 행에 기대므로 수강 종료가 처음 기록된 달(이 원본은 2026-07) 전은 자른다
    // (그 전에 그만둔 학생은 수강 행이 없다 — 과목 선과 같은 경계, 적대 리뷰 2026-10-20).
    expect(v.courses!.monthly[0]!.key).toBe("2026-07");
    expect(v.courses!.trustFrom).toBe("2026-07");
    expect(point(v.courses!.monthly, "2026-07")).toBe(1); // k는 7월 청구가 없어 재원생이 아니다 → a의 수학 반 하나
    expect(v.courses!.monthly.at(-1)!.count).toBe(1); // 오늘 = a의 수학 반 하나
    expect(reportWarning).not.toHaveBeenCalled();
    // 다시 불러도 원본을 다시 읽지 않는다(센 값 캐시) · 캐시 안에서 다른 캐시를 부르지 않는다.
    await loadEnrolledTrend("t1", "2026-10-20");
    expect(fetchAllPaged).toHaveBeenCalledTimes(2);
    expect(nested).toBe(0);
  });

  it("🔴 청구 재료가 실패하면 던지지 않고 'fallback' 키 · 1분 — 종전 규칙(퇴원일)으로 센다 · 경고를 남긴다", async () => {
    loadCleanupBilling.mockRejectedValue(new Error("청구 건수: boom"));
    const v = await loadEnrolledTrend("t1", "2026-10-20");
    const card = cacheCalls.find((c) => c.key[0] === "dashboard-enrolled-trend-v8-subject");
    expect(card).toMatchObject({ key: ["dashboard-enrolled-trend-v8-subject", "t1", "2026-10-20", "[]", "fallback", "-"], revalidate: 60 });
    expect(point(v.monthly, "2026-05")).toBe(2); // 종전 규칙 — 퇴원일(7/3) 전이라 k도 센다
    expect(reportWarning).toHaveBeenCalledTimes(1);
    // 실패는 캐시에 남지 않아 청구는 다시 묻지만, 원본은 대체 키 캐시로 다시 읽지 않는다 · 중첩 없음.
    await loadEnrolledTrend("t1", "2026-10-20");
    expect(loadCleanupBilling).toHaveBeenCalledTimes(2);
    expect(fetchAllPaged).toHaveBeenCalledTimes(2);
    expect(nested).toBe(0);
  });

  it("에이와 수강 기록이 갖춰진 달(trustFrom)부터만 — 그 전 점은 빼고 키에 싣는다 · 기록 범위가 실패하면 자르지 않는다", async () => {
    loadCleanupBilling.mockResolvedValue({ billingFrom: "2026-01", billed: [["k", ["2026-03"]]] });
    loadRecordCoverage.mockResolvedValue({ billingFrom: "2026-01", started: [], trustFrom: "2026-04" });
    const v = await loadEnrolledTrend("t1", "2026-10-20");
    expect(v.trustFrom).toBe("2026-04");
    expect(v.monthlyFrom).toBe("2026-04");
    expect(v.monthly[0]!.key).toBe("2026-04");
    expect(v.yearly.map((p) => p.key)).toEqual(["2026"]);
    expect(cacheCalls.find((c) => c.key[0] === "dashboard-enrolled-trend-v8-subject")!.key.at(-1)).toBe("2026-04");
    store.clear();
    fetchAllPaged.mockResolvedValueOnce(students).mockResolvedValueOnce(enrollments);
    loadRecordCoverage.mockRejectedValue(new Error("boom"));
    const w = await loadEnrolledTrend("t1", "2026-10-20");
    expect(w.trustFrom).toBeNull();
    expect(w.monthly).toHaveLength(12);
  });

  it("시작 달이 창보다 앞이라 뺀 점이 없으면 시작 달을 싣지 않는다(카드 안내가 거짓이 되지 않게)", async () => {
    loadCleanupBilling.mockResolvedValue({ billingFrom: "2026-01", billed: [["k", ["2026-03"]]] });
    loadRecordCoverage.mockResolvedValue({ billingFrom: "2024-01", started: [], trustFrom: "2025-01" });
    const v = await loadEnrolledTrend("t1", "2026-10-20");
    expect(v.monthly).toHaveLength(12);
    expect(v.trustFrom).toBeNull();
    expect(v.monthlyFrom).toBeNull();
  });
});
