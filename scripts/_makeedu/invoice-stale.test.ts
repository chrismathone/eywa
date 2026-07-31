import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

// 순수 분류기(CJS 스크립트 모듈) — 돈을 지우는 판정이라 단위테스트로 규칙을 못박는다.
const require_ = createRequire(import.meta.url);
type Agg = { count: number; total: number; discount: number; paid: number; points: number };
type ReconRow = {
  period: string;
  aggDiff: Record<string, number>;
  saveDiff: Record<string, number>;
  countDiff: number;
  ok: boolean;
};
const S = require_("./invoice-stale.cjs") as {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  classifyStale: (a: Record<string, unknown>) => Record<string, any>;
  buildWithdrawnIndex: (doc: unknown) => Set<string> | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  aggregateByPeriod: (rows: unknown[], pick: Record<string, (r: any) => unknown>) => Map<string, Agg>;
  reconcilePeriods: (a: { scraped: Map<string, Agg>; aggregated: Map<string, Agg>; stored: Map<string, Agg> }) => ReconRow[];
  reconcileSummary: (rows: ReconRow[] | null) => string | null;
  STALE_COVERAGE_MIN: number;
  STALE_MIN_ABSENT_DAYS: number;
  STALE_MAX_VOID_PER_RUN: number;
};

const NOW = "2026-07-30T09:00:00.000Z";
const daysAgo = (d: number) => new Date(Date.parse(NOW) - d * 86_400_000).toISOString();

/** makeedu형 라인(한글 kind) + 기본값. */
const row = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "i1",
  student_id: "s1",
  period: "2026-08",
  status: "unpaid",
  amount_total: 300_000,
  amount_paid: 0,
  amount_discount: 0,
  notes: null,
  line_items: [{ kind: "수업", description: "중등M", amount: 300_000, paid: 0, unpaid: 300_000 }],
  updated_at: daysAgo(10),
  name: "김학생",
  grade: "중2",
  ...over,
});

/**
 * 부재로 판정시키려면 scrapedKeys에서 빼고, present 채우기용 더미를 채운다(커버리지 가드 통과).
 * ⚠️ 더미 수가 부족하면 **커버리지 가드(80%)에 먼저 걸려** 검사하려던 가드까지 못 간다 —
 *    부재 행을 많이 넣는 테스트는 `filler`를 함께 키울 것.
 */
function classify(rows: ReturnType<typeof row>[], opts: Record<string, unknown> = {}) {
  const { filler: fillerCount = 40, ...rest } = opts as { filler?: number };
  const filler = Array.from({ length: fillerCount }, (_, i) =>
    row({ id: `f${i}`, student_id: `fs${i}` }),
  );
  const scrapedKeys = new Set(filler.map((f) => `${f.student_id}|${f.period}`));
  return S.classifyStale({
    existing: [...rows, ...filler],
    scrapedKeys,
    unmatchedNameKeys: new Set<string>(),
    normalizeName: (n: string) => n,
    activeStudentIds: new Set<string>(),
    now: NOW,
    ...rest,
  });
}

describe("classifyStale — 무효 후보 4중 가드", () => {
  it("기본: makeedu형 · 미완납 · 7일+ 부재 · 활성수강 없음 → voidable", () => {
    const b = classify([row()]);
    expect(b.voidable).toHaveLength(1);
    expect(b.holdRecent).toHaveLength(0);
    expect(b.holdActive).toHaveLength(0);
  });

  // 🔴 2026-07-30 실측 회귀 — 후보 18건 중 14건이 활성 수강을 가진 재원생이었다.
  // 그대로 void했으면 실재하는 미수 ₩4.2M이 화면에서 사라졌다.
  it("활성 수강이 있는 학생은 void하지 않는다(holdActive)", () => {
    const b = classify([row()], { activeStudentIds: new Set(["s1"]) });
    expect(b.voidable).toHaveLength(0);
    expect(b.holdActive).toHaveLength(1);
  });

  it("부재 7일 미만은 void하지 않는다(holdRecent — '한 번 못 잡힌 것'과 구분)", () => {
    const b = classify([row({ updated_at: daysAgo(1) })]);
    expect(b.voidable).toHaveLength(0);
    expect(b.holdRecent).toHaveLength(1);
    expect((b.holdRecent[0] as { absentDays: number }).absentDays).toBeCloseTo(1, 1);
  });

  it("경계: 정확히 7일이면 통과, 6.9일이면 보류", () => {
    expect(classify([row({ updated_at: daysAgo(7) })]).voidable).toHaveLength(1);
    expect(classify([row({ updated_at: daysAgo(6.9) })]).voidable).toHaveLength(0);
  });

  it("완납·환불은 부재해도 항상 보존(settled) — 돈 받은 기록", () => {
    const b = classify([row({ status: "paid", amount_paid: 300_000 })]);
    expect(b.voidable).toHaveLength(0);
    expect(b.settled).toHaveLength(1);
  });

  it("완납 판정이 부재일·활성수강 가드보다 먼저다(최근 완납이 holdRecent로 새지 않음)", () => {
    const b = classify([row({ status: "paid", amount_paid: 300_000, updated_at: daysAgo(0.5) })], {
      activeStudentIds: new Set(["s1"]),
    });
    expect(b.settled).toHaveLength(1);
    expect(b.holdRecent).toHaveLength(0);
    expect(b.holdActive).toHaveLength(0);
  });

  it("수동 청구(영문 kind·paid 없음)는 보류(holdManual)", () => {
    const b = classify([row({ line_items: [{ kind: "tuition", description: "수강료", amount: 300_000 }] })]);
    expect(b.voidable).toHaveLength(0);
    expect(b.holdManual).toHaveLength(1);
  });

  it("updated_at이 없으면 부재일 판정 불가 → 무한대로 보아 가드를 통과시킨다(구데이터)", () => {
    const b = classify([row({ updated_at: null })]);
    expect(b.voidable).toHaveLength(1);
  });

  it("커버리지 80% 미만이면 그 월 부재 전건 보류(heldPeriods)", () => {
    // present 1건 · absent 9건 = 10% 커버리지
    const absent = Array.from({ length: 9 }, (_, i) => row({ id: `a${i}`, student_id: `as${i}` }));
    const present = row({ id: "p", student_id: "ps" });
    const b = S.classifyStale({
      existing: [...absent, present],
      scrapedKeys: new Set([`${present.student_id}|${present.period}`]),
      unmatchedNameKeys: new Set<string>(),
      normalizeName: (n: string) => n,
      activeStudentIds: new Set<string>(),
      now: NOW,
    });
    expect(b.voidable).toHaveLength(0);
    expect(b.heldPeriods).toHaveLength(1);
  });

  it("상수는 완화 금지 — 커버리지 0.8 · 최소 부재 7일 · 한 실행 무효 한도 10건", () => {
    expect(S.STALE_COVERAGE_MIN).toBe(0.8);
    expect(S.STALE_MIN_ABSENT_DAYS).toBe(7);
    expect(S.STALE_MAX_VOID_PER_RUN).toBe(10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 대량 무효 서킷브레이커 — 개별 가드는 "이 한 건이 삭제인가"만 본다.
// 🔴 2026-07-31 실측: 스크랩 **범위를 넓힌 첫 실행**에서 17건이 한 번에 void됐다(₩5.4M).
//    새로 범위에 들어온 달의 행은 그동안 스크랩 밖이었다는 이유만으로 부재일이 길게 잡혀
//    ③가드를 전부 정상 통과한다 — 개별 가드로는 원리적으로 못 막는 상황이다.
// ─────────────────────────────────────────────────────────────────────────────
describe("classifyStale — 대량 무효 차단", () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) => row({ id: `v${i}`, student_id: `vs${i}` }));

  it("한도(10건) 이하면 그대로 무효 후보", () => {
    const b = classify(many(10));
    expect(b.voidable).toHaveLength(10);
    expect(b.holdBulk).toHaveLength(0);
  });

  it("한도를 넘으면 **전부** 보류한다(일부만 지우지 않는다)", () => {
    const b = classify(many(11), { filler: 200 });
    expect(b.voidable).toHaveLength(0);
    expect(b.holdBulk).toHaveLength(11);
  });

  it("사람이 확인한 뒤 --allow-bulk-void로 해제할 수 있다", () => {
    const b = classify(many(30), { allowBulkVoid: true, filler: 200 });
    expect(b.voidable).toHaveLength(30);
    expect(b.holdBulk).toHaveLength(0);
  });

  // 브레이커는 **개별 가드 뒤**에 온다 — 보류된 건은 애초에 후보가 아니므로 한도에 포함되지 않는다.
  it("개별 가드로 이미 걸러진 건은 한도 계산에 안 들어간다", () => {
    const b = classify([...many(9), ...many(9).map((r) => ({ ...r, id: `a${r.id}`, student_id: "act" }))], {
      activeStudentIds: new Set(["act"]),
      filler: 200,
    });
    expect(b.voidable).toHaveLength(9); // 활성수강 9건은 holdActive로 빠져 한도(10)를 안 넘는다
    expect(b.holdBulk).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5번째 가드 — makeedu 퇴원 목록. 정황(4중)만으로는 "삭제"와 "다른 청구월 이동"이 안 갈렸다.
// ─────────────────────────────────────────────────────────────────────────────
describe("classifyStale — 5번째 가드(makeedu 퇴원 목록)", () => {
  it("목록에 있으면 void 대상(makeedu가 퇴원이라고 확인해 준 경우)", () => {
    const b = classify([row({ makeedu_id: "10021" })], { withdrawnMakeeduIds: new Set(["10021"]) });
    expect(b.voidable).toHaveLength(1);
    expect(b.holdNotWithdrawn).toHaveLength(0);
  });

  // 🔴 실측 회귀 — 2026-07-30 부재 18건 중 2건은 06:00엔 있다가 18:00에 사라졌다.
  // 12시간 만의 이탈은 삭제보다 '다른 청구월로 이동'에 가깝다. 목록에 없으면 지우지 않는다.
  it("목록에 없으면 보류(holdNotWithdrawn) — 이동일 수 있다", () => {
    const b = classify([row({ makeedu_id: "10021" })], { withdrawnMakeeduIds: new Set(["99999"]) });
    expect(b.voidable).toHaveLength(0);
    expect(b.holdNotWithdrawn).toHaveLength(1);
  });

  // 이름 매칭은 동명이인·개명으로 틀리고, 틀리면 **남의 청구를 지운다**. 안전한 쪽으로 실패시킨다.
  it("makeedu_id가 없는 학생은 목록이 있어도 통과 못한다(안전한 실패)", () => {
    const b = classify([row({ makeedu_id: null })], { withdrawnMakeeduIds: new Set(["10021"]) });
    expect(b.voidable).toHaveLength(0);
    expect(b.holdNotWithdrawn).toHaveLength(1);
  });

  it("목록을 못 읽은 실행(null)은 가드가 꺼진 채 기존 4중 가드로 판정한다(무중단)", () => {
    const b = classify([row({ makeedu_id: "10021" })], { withdrawnMakeeduIds: null });
    expect(b.voidable).toHaveLength(1);
    expect(b.withdrawnGuard).toEqual({ enabled: false });
  });

  it("가드가 켜졌는지를 리포트가 알 수 있다(조용히 약해지지 않는다)", () => {
    const b = classify([row({ makeedu_id: "10021" })], { withdrawnMakeeduIds: new Set(["10021", "3"]) });
    expect(b.withdrawnGuard).toEqual({ enabled: true, size: 2 });
  });

  it("활성 수강 가드가 퇴원 목록 가드보다 먼저다(수업 다니는 학생은 목록에 있어도 보류)", () => {
    const b = classify([row({ makeedu_id: "10021" })], {
      activeStudentIds: new Set(["s1"]),
      withdrawnMakeeduIds: new Set(["10021"]),
    });
    expect(b.holdActive).toHaveLength(1);
    expect(b.holdNotWithdrawn).toHaveLength(0);
    expect(b.voidable).toHaveLength(0);
  });
});

describe("buildWithdrawnIndex — 퇴원 목록 파싱", () => {
  // ⚠️ 실측: 퇴원 목록은 `원생번호`, 재원 목록은 `원생고유번호`. 열 이름이 다르다.
  it("퇴원 목록(원생번호)과 재원 목록(원생고유번호) 둘 다 읽는다", () => {
    expect(S.buildWithdrawnIndex({ headers: ["원생번호", "원생명"], rows: [["101", "김"]] })).toEqual(new Set(["101"]));
    expect(S.buildWithdrawnIndex({ headers: ["원생고유번호"], rows: [["202"]] })).toEqual(new Set(["202"]));
  });

  it("공백을 제거하고 빈 칸은 버린다", () => {
    expect(S.buildWithdrawnIndex({ headers: ["원생번호"], rows: [[" 101 "], [""], [null]] })).toEqual(new Set(["101"]));
  });

  // 읽을 수 없으면 **null**이어야 한다 — 빈 Set을 주면 "아무도 퇴원 안 함"으로 읽혀 전건이 보류된다.
  it("헤더·행이 없으면 null(가드 비활성) — 빈 Set을 반환하지 않는다", () => {
    expect(S.buildWithdrawnIndex({ headers: ["이름"], rows: [["김"]] })).toBeNull();
    expect(S.buildWithdrawnIndex({ headers: ["원생번호"], rows: [] })).toBeNull();
    expect(S.buildWithdrawnIndex(null)).toBeNull();
    expect(S.buildWithdrawnIndex({ headers: ["원생번호"], rows: [[""]] })).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 층 2 — 대조. "동기화가 맞는지"의 측정 가능한 정의. 허용 오차 0원.
// ─────────────────────────────────────────────────────────────────────────────
describe("reconcilePeriods — 월별 3지점 대조", () => {
  const agg = (o: Partial<Agg>): Agg => ({ count: 0, total: 0, discount: 0, paid: 0, points: 0, ...o });
  const m = (o: Record<string, Partial<Agg>>) => new Map(Object.entries(o).map(([k, v]) => [k, agg(v)]));

  it("세 지점이 같으면 ok", () => {
    const a = { count: 2, total: 500, discount: 50, paid: 400, points: 10 };
    const r = S.reconcilePeriods({ scraped: m({ "2026-08": { ...a, count: 5 } }), aggregated: m({ "2026-08": a }), stored: m({ "2026-08": a }) });
    expect(r[0].ok).toBe(true);
  });

  it("건수는 집계↔저장만 본다(라인 수는 집계 건수와 다른 게 정상)", () => {
    const a = { count: 2, total: 500 };
    const r = S.reconcilePeriods({ scraped: m({ "2026-08": { count: 17, total: 500 } }), aggregated: m({ "2026-08": a }), stored: m({ "2026-08": a }) });
    expect(r[0].ok).toBe(true);
    expect(r[0].countDiff).toBe(0);
  });

  it("집계 버그(라인 합 ≠ 집계 합)를 잡는다", () => {
    const r = S.reconcilePeriods({
      scraped: m({ "2026-08": { total: 500 } }), aggregated: m({ "2026-08": { total: 480 } }), stored: m({ "2026-08": { total: 480 } }),
    });
    expect(r[0].ok).toBe(false);
    expect(r[0].aggDiff.total).toBe(-20);
    expect(r[0].saveDiff.total).toBe(0);
  });

  it("저장 버그(집계 합 ≠ DB 합)를 잡는다", () => {
    const r = S.reconcilePeriods({
      scraped: m({ "2026-08": { total: 500 } }), aggregated: m({ "2026-08": { total: 500 } }), stored: m({ "2026-08": { total: 499 } }),
    });
    expect(r[0].ok).toBe(false);
    expect(r[0].saveDiff.total).toBe(-1); // 🔴 1원도 통과시키지 않는다
  });

  it("저장 건수가 모자라면 잡는다(행이 조용히 안 들어간 경우)", () => {
    const r = S.reconcilePeriods({
      scraped: m({ "2026-08": {} }), aggregated: m({ "2026-08": { count: 10 } }), stored: m({ "2026-08": { count: 9 } }),
    });
    expect(r[0].ok).toBe(false);
    expect(r[0].countDiff).toBe(-1);
  });

  it("한쪽에만 있는 달도 빠뜨리지 않는다", () => {
    const r = S.reconcilePeriods({ scraped: m({ "2026-07": { total: 100 } }), aggregated: new Map(), stored: new Map() });
    expect(r.map((x) => x.period)).toEqual(["2026-07"]);
    expect(r[0].ok).toBe(false);
  });
});

describe("reconcileSummary — sync_state.error 한 줄", () => {
  const rows = (over: Partial<ReconRow>[]) =>
    over.map((o) => ({
      period: "2026-08", aggDiff: { total: 0, discount: 0, paid: 0, points: 0 },
      saveDiff: { total: 0, discount: 0, paid: 0, points: 0 }, countDiff: 0, ok: true, ...o,
    })) as ReconRow[];

  it("전부 일치면 null(요약에 아무것도 안 붙는다)", () => {
    expect(S.reconcileSummary(rows([{}, {}]))).toBeNull();
    expect(S.reconcileSummary([])).toBeNull();
    expect(S.reconcileSummary(null)).toBeNull();
  });

  it("불일치는 월·항목·금액을 한글로 말한다(raw 키 노출 금지)", () => {
    const out = S.reconcileSummary(
      rows([{ ok: false, saveDiff: { total: -12_000, discount: 0, paid: 0, points: 0 }, countDiff: -1 }]),
    );
    expect(out).toContain("2026-08");
    expect(out).toContain("건수 -1");
    expect(out).toContain("청구 -12,000원");
    expect(out).not.toContain("total"); // 영문 키가 화면 문구로 새지 않는다
  });
});
