// 비서 의견 확인 지표 · 처리 상태(제안 → 결과 → 학습 1단계 · 2026-11-09) — 순수 함수.
import { describe, expect, it } from "vitest";
import {
  adviceDrafts,
  adviceViewOf,
  baselineWindow,
  CHECK_FAILED,
  CHECK_SKIPPED,
  checkTemplateProblem,
  fillWindow,
  formatCheckValue,
  monthDayLabel,
  nextCheckOn,
  NO_CHECK_GIVEN,
  readCheckRow,
  type AdviceCheck,
  type AdviceRow,
} from "./advice";
import { settleReport } from "./report";

const CHECK: AdviceCheck = {
  label: "A반 최근 14일 결석률",
  sql: "select round(100.0 * count(*) filter (where status = 'absent') / nullif(count(*), 0), 1) as 값, count(*) as 표본 from attendance where session_date >= {{시작}} and session_date < {{끝}}",
  unit: "percent",
  better: "down",
  windowDays: 14,
  checkAfterDays: 28,
};

describe("조회문 틀", () => {
  it("기간 자리 둘 다 · 따옴표 없이 · 다시 잴 날이 기간 이상", () => {
    expect(checkTemplateProblem(CHECK)).toBeNull();
    expect(checkTemplateProblem({ ...CHECK, sql: "select 1 as 값 where x >= {{시작}}" })).toMatch(/둘 다/);
    expect(checkTemplateProblem({ ...CHECK, sql: "select 1 as 값 where x >= '{{시작}}' and x < {{끝}}" })).toMatch(/따옴표/);
    expect(checkTemplateProblem({ ...CHECK, windowDays: 28, checkAfterDays: 14 })).toMatch(/이상/);
    // 주석 안에만 있는 자리는 조회에 안 든다 — 다시 재도 늘 같은 값
    expect(checkTemplateProblem({ ...CHECK, sql: "select 1 as 값 -- {{시작}} {{끝}}" })).toMatch(/주석 밖에/);
    expect(checkTemplateProblem({ ...CHECK, sql: "select 1 as 값 /* {{시작}} */ where x < {{끝}}" })).toMatch(/주석 밖에/);
  });
  it("날짜 글자로 채운다(여러 번 나와도 전부)", () => {
    expect(fillWindow("a >= {{시작}} and b >= {{시작}} and c < {{끝}}", "2026-10-26", "2026-11-09")).toBe("a >= '2026-10-26' and b >= '2026-10-26' and c < '2026-11-09'");
  });
  it("기준값 기간 = [질문일 − 2일 − 기간, 질문일 − 2일) · 다시 잴 날 = 질문일 + checkAfterDays + 2(양쪽 다 이틀 비운다)", () => {
    expect(baselineWindow("2026-11-09", 14)).toEqual({ from: "2026-10-24", to: "2026-11-07" });
    expect(nextCheckOn("2026-11-09", 28)).toBe("2026-12-09");
  });
});

describe("결과 한 줄 읽기", () => {
  it("한 줄 · 값 · 비율이면 표본 · 0~100", () => {
    expect(readCheckRow({ columns: ["값", "표본"], rows: [{ 값: "18.0", 표본: 50 }] }, "percent")).toEqual({ ok: true, value: 18, sample: 50 });
    expect(readCheckRow({ columns: ["값"], rows: [{ 값: 3 }] }, "count")).toEqual({ ok: true, value: 3, sample: null });
    expect(readCheckRow({ columns: ["값"], rows: [] }, "count")).toMatchObject({ ok: false, error: expect.stringMatching(/0줄/) });
    expect(readCheckRow({ columns: ["인원"], rows: [{ 인원: 3 }] }, "count")).toMatchObject({ ok: false, error: expect.stringMatching(/칸 '값'/) });
    expect(readCheckRow({ columns: ["값"], rows: [{ 값: null }] }, "count")).toMatchObject({ ok: false, error: expect.stringMatching(/숫자가 아닙니다/) });
    expect(readCheckRow({ columns: ["값"], rows: [{ 값: 12 }] }, "percent")).toMatchObject({ ok: false, error: expect.stringMatching(/표본/) });
    expect(readCheckRow({ columns: ["값", "표본"], rows: [{ 값: 0.18, 표본: 50 }] }, "percent")).toEqual({ ok: true, value: 0.18, sample: 50 });
    expect(readCheckRow({ columns: ["값", "표본"], rows: [{ 값: 180, 표본: 50 }] }, "percent")).toMatchObject({ ok: false, error: expect.stringMatching(/0~100/) });
    // 표본 0인 비율은 잴 대상이 없다 · 음수 표본은 버린다(DB 조건에 걸려 의견 줄 전체가 안 들어가지 않게)
    expect(readCheckRow({ columns: ["값", "표본"], rows: [{ 값: 0, 표본: 0 }] }, "percent")).toMatchObject({ ok: false, error: expect.stringMatching(/표본\(분모\)이 0/) });
    expect(readCheckRow({ columns: ["값", "표본"], rows: [{ 값: 5, 표본: -3 }] }, "count")).toEqual({ ok: true, value: 5, sample: null });
  });
});

describe("의견 표 줄", () => {
  const items = [
    { action: "**A반** 학부모 전화", why: "결석 [[bad:18%]]", topic: "attendance" as const, method: "call" as const },
    { action: "규정 정하기", why: "기준이 없다", noCheck: "숫자로 다시 재기 어려운 일입니다" },
    { action: "지표 실패", why: "b" },
    { action: "지표 없음", why: "b" },
  ];
  const rows = adviceDrafts(
    items,
    [
      { itemNo: 0, check: CHECK, baseline: { from: "2026-10-24", to: "2026-11-07", value: 18, sample: 50 } },
      { itemNo: 2, check: CHECK, baseline: null },
    ],
    "2026-11-09",
  );
  it("기준값을 잰 지표는 기다림 · 다시 잴 날", () => {
    expect(rows[0]).toMatchObject({ item_no: 0, topic: "attendance", method: "call", check_label: CHECK.label, check_sql: CHECK.sql, window_days: 14, check_after_days: 28, baseline_value: 18, baseline_sample: 50, measure_state: "waiting", next_check_on: "2026-12-09", no_check_reason: null });
  });
  it("잴 수 없는 까닭 · 못 잰 지표 · 지표를 안 준 의견은 까닭으로", () => {
    expect(rows[1]).toMatchObject({ topic: "other", check_sql: null, no_check_reason: "숫자로 다시 재기 어려운 일입니다", measure_state: "none", next_check_on: null });
    expect(rows[2]).toMatchObject({ check_sql: null, check_label: null, no_check_reason: CHECK_FAILED, measure_state: "none" });
    expect(rows[3]).toMatchObject({ no_check_reason: NO_CHECK_GIVEN });
  });
  it("시간 상한·멈춤으로 재지 않고 넘긴 지표는 사실대로 '시간이 모자라'", () => {
    const [row] = adviceDrafts([{ action: "a", why: "b" }], [{ itemNo: 0, check: CHECK, baseline: null, skipped: true }], "2026-11-09");
    expect(row).toMatchObject({ check_sql: null, no_check_reason: CHECK_SKIPPED, measure_state: "none" });
  });
  it("저장 줄 → 화면(조회문 없이 · 숫자 글자도 숫자로)", () => {
    const row: AdviceRow = {
      id: "a1", message_id: "m1", item_no: 0, status: "done", status_at: "2026-11-09T06:00:00.123456+00:00", status_memo: "전화 3통", done_on: "2026-11-09", self_rating: "good",
      check_label: CHECK.label, check_unit: "percent", check_better: "down", window_days: 14, baseline_value: "18.0", baseline_sample: "50",
      baseline_from: "2026-10-26", baseline_to: "2026-11-09", next_check_on: "2026-12-09", no_check_reason: null,
      measure_state: "waiting", latest_verdict: null, latest_value: null, latest_sample: null, latest_base: null, latest_base_sample: null,
      latest_from: null, latest_to: null, latest_checked_at: null, latest_reason: null,
    };
    const v = adviceViewOf(row);
    expect(v).toMatchObject({ id: "a1", itemNo: 0, status: "done", memo: "전화 3통", selfRating: "good", noCheck: null });
    expect(v.check).toEqual({ label: CHECK.label, unit: "percent", better: "down", windowDays: 14, baseline: { value: 18, sample: 50, from: "2026-10-26", to: "2026-11-09" }, nextCheckOn: "2026-12-09" });
    expect(JSON.stringify(v)).not.toContain("select");
    expect(adviceViewOf({ ...row, status: "weird", self_rating: "x", check_label: null, no_check_reason: "까닭" })).toMatchObject({ status: "open", selfRating: null, check: null, noCheck: "까닭" });
    expect(v).toMatchObject({ measureState: "waiting", result: null });
    // 다시 잰 결과(2단계) — 숫자 글자도 숫자로 · 모르는 판정·상태는 결과 없음
    // 화면의 기준값 = 저장된 기준값(판정이 견준 값) — 같은 날 다시 잰 기준(latest_base 16)이 아니다
    const measured = adviceViewOf({ ...row, measure_state: "measured", latest_verdict: "worse", latest_value: "22.0", latest_sample: "40", latest_base: "16.0", latest_base_sample: "44", latest_from: "2026-11-23", latest_to: "2026-12-07", latest_checked_at: "2026-12-09T00:00:00+00:00", latest_reason: null, latest_threshold: "3.5" });
    expect(measured).toMatchObject({ measureState: "measured", result: { verdict: "worse", value: 22, sample: 40, base: 18, baseSample: 50, from: "2026-11-23", to: "2026-12-07", basis: "asked", anchor: "2026-11-11", threshold: 3.5 } });
    expect(adviceViewOf({ ...row, measure_state: "measured", latest_verdict: "flat", latest_value: 1, latest_from: "2026-11-20", latest_to: "2026-12-04", latest_checked_at: "x", measure_anchor: "2026-11-20" }).result).toMatchObject({ basis: "done", anchor: "2026-11-20" });
    expect(adviceViewOf({ ...row, measure_state: "x", latest_verdict: "great", latest_value: 1, latest_base: 1, latest_from: "a", latest_to: "b", latest_checked_at: "c" })).toMatchObject({ measureState: "none", result: null });
  });
});

describe("화면 글자", () => {
  it("비율 · 원 · 그 밖 · 날짜", () => {
    expect(formatCheckValue(18, "percent")).toBe("18.0%");
    expect(formatCheckValue(1234567, "won")).toBe("1,234,567원");
    expect(formatCheckValue(12.345, "count")).toBe("12.3");
    expect(monthDayLabel("2026-12-09")).toBe("12월 9일");
  });
});

describe("보고서 검사 — 확인 지표는 느슨하게(보고서 전체를 돌려보내지 않는다 · 적대 리뷰 2026-11-09)", () => {
  const settle = (item: Record<string, unknown>) =>
    settleReport({ title: "t", blocks: [{ type: "summary", text: "s" }, { type: "advice", items: [{ action: "a", why: "b", ...item }] }] }, new Map());
  const first = (r: ReturnType<typeof settle>) => {
    const b = r.ok ? r.report.blocks.find((x) => x.type === "advice") : undefined;
    return b?.type === "advice" ? b.items[0]! : null;
  };
  it("확인 지표와 까닭이 둘 다면 지표를 쓴다", () => {
    const r = settle({ check: CHECK, noCheck: "x" });
    expect(r.ok).toBe(true);
    expect(first(r)).toMatchObject({ check: CHECK });
    expect(first(r)?.noCheck).toBeUndefined();
  });
  it("틀린 지표(기간 자리 · 기간 값 · 형식)는 빼고 '만들지 못했습니다'", () => {
    for (const bad of [{ ...CHECK, sql: "select 1 as 값" }, { ...CHECK, windowDays: 10 }, { ...CHECK, checkAfterDays: 7 }, "select 1", 3]) {
      const r = settle({ check: bad });
      expect(r.ok).toBe(true);
      expect(first(r)?.check).toBeUndefined();
      expect(first(r)?.noCheck).toBe(CHECK_FAILED);
    }
  });
  it("목록 밖 주제·방법은 빼고 긴 까닭은 자른다", () => {
    const r = settle({ topic: "weird", method: 3, noCheck: "가".repeat(120) });
    expect(r.ok).toBe(true);
    expect(first(r)?.topic).toBeUndefined();
    expect(first(r)?.method).toBeUndefined();
    expect(first(r)?.noCheck).toHaveLength(80);
  });
  it("check: null은 지표가 없다는 뜻일 뿐 — 적어 둔 까닭을 지우지 않는다", () => {
    const r = settle({ check: null, noCheck: "사람을 뽑는 일입니다" });
    expect(r.ok).toBe(true);
    expect(first(r)).toMatchObject({ noCheck: "사람을 뽑는 일입니다" });
    expect(first(r) && "check" in first(r)!).toBe(false);
  });
  it("확인 지표·까닭이 없어도 통과(서버가 '받지 못했습니다'로 남긴다)", () => {
    expect(settle({}).ok).toBe(true);
    expect(settle({ check: CHECK, topic: "attendance", method: "call" }).ok).toBe(true);
  });
});
