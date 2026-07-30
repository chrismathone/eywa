import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

// 순수 분류기(CJS 스크립트 모듈) — 돈을 지우는 판정이라 단위테스트로 규칙을 못박는다.
const require_ = createRequire(import.meta.url);
const S = require_("./invoice-stale.cjs") as {
  classifyStale: (a: Record<string, unknown>) => Record<string, unknown[]>;
  STALE_COVERAGE_MIN: number;
  STALE_MIN_ABSENT_DAYS: number;
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

/** 부재로 판정시키려면 scrapedKeys에서 빼고, present 채우기용 더미를 채운다(커버리지 가드 통과). */
function classify(rows: ReturnType<typeof row>[], opts: Record<string, unknown> = {}) {
  const filler = Array.from({ length: 40 }, (_, i) =>
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
    ...opts,
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

  it("상수는 완화 금지 — 커버리지 0.8 · 최소 부재 7일", () => {
    expect(S.STALE_COVERAGE_MIN).toBe(0.8);
    expect(S.STALE_MIN_ABSENT_DAYS).toBe(7);
  });
});
