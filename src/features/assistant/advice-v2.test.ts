// 비서 의견 대상 고정·실행 지표(s2_0039 · 2026-11-09 답 검토 + 독립 리뷰) — {{대상}} 자리 · 일을 안 해도 좋아지는 지표 막기 · 실행 지표.
import { describe, expect, it } from "vitest";
import { adviceDrafts, adviceViewOf, CHECK_FAILED, type AdviceCheck, type AdviceRow } from "./advice";
import { AdviceTargetsSchema, checkIntegrityProblem, fillTargets } from "./advice-targets";
import { settleReport } from "./report";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const OUTCOME: AdviceCheck = {
  label: "대상 중 28일 동안 출석률 75% 이상인 학생 비율",
  sql: "select round(100.0 * count(*) filter (where r >= 75) / cardinality({{대상}}), 1) as 값, cardinality({{대상}}) as 표본 from x where id = any({{대상}}) and d >= {{시작}} and d < {{끝}}",
  unit: "percent",
  better: "up",
  windowDays: 28,
  checkAfterDays: 28,
};
const DONE: AdviceCheck = { ...OUTCOME, label: "대상 중 상담 기록이 생긴 학생", unit: "count", sql: "select count(distinct student_id) as 값 from student_consultations where student_id = any({{대상}}) and created_at >= {{시작}} and created_at < {{끝}}" };
const T = { kind: "student" as const, ids: [A, B] };

describe("일을 안 해도 좋아지는 지표", () => {
  it("'오늘' 칸은 기간 지표에 못 쓴다 — 결과·실행 지표 모두", () => {
    const sql = "select count(*) as 값 from onto_enrollments where on_roster_today and x >= {{시작}} and x < {{끝}}";
    expect(checkIntegrityProblem({ sql, better: "up", unit: "count" }, { outcome: true })).toMatch(/오늘/);
    expect(checkIntegrityProblem({ sql, better: "up", unit: "count" }, { outcome: false })).toMatch(/오늘/);
  });
  it("'내리면 좋음'을 지금 상태로 거르면 거절 — status 조건 전반 · 퇴원 칸 비었음 · 휴원 · 청구 살아 있는 학생(리뷰 중3)", () => {
    const down = (sql: string) => checkIntegrityProblem({ sql, better: "down", unit: "count" }, { outcome: true });
    expect(down("select count(*) as 값 from students where status = 'enrolled'")).toMatch(/나가도/);
    expect(down("select count(*) as 값 from students where status in ('enrolled', 'on_hold')")).toMatch(/나가도/);
    expect(down("select count(*) as 값 from students where status <> 'withdrawn'")).toMatch(/나가도/);
    expect(down("select count(*) as 값 from onto_students where status_label = '재원'")).toMatch(/나가도/);
    expect(down("select count(*) as 값 from onto_students where withdrawn_on is null")).toMatch(/나가도/);
    expect(down("select count(*) as 값 from onto_students where exit_kind is null")).toMatch(/나가도/);
    expect(down("select count(*) as 값 from enrollments where not on_hold")).toMatch(/나가도/);
    expect(down("select count(*) as 값 from onto_tuition_months where month >= {{시작}}")).toMatch(/나가도/);
    expect(down("select count(*) as 값 from attendance where d >= {{시작}}")).toBeNull();
  });
  it("uuid 글자가 있는데 대상이 없으면 거절 · 대상이 있으면 {{대상}} 자리 필수(리뷰 중2·중3)", () => {
    expect(checkIntegrityProblem({ sql: `select 1 as 값 where id = '${A}'`, better: "up", unit: "count" }, { outcome: true })).toMatch(/targets/);
    expect(checkIntegrityProblem({ sql: `select 1 as 값 where id = '${A}'`, better: "up", unit: "count" }, { outcome: false })).toMatch(/targets/);
    expect(checkIntegrityProblem({ sql: `select 1 as 값 where id = '${A}'`, better: "up", unit: "count" }, { targets: T, outcome: true })).toMatch(/\{\{대상\}\} 자리/);
    expect(checkIntegrityProblem({ sql: "select 1 as 값 where id = any({{대상}})", better: "up", unit: "count" }, { outcome: true })).toMatch(/targets\)을 달아야/);
    // 반 id를 글자로 쓰는 것은 대상과 함께면 된다
    expect(checkIntegrityProblem({ sql: `select 1 as 값 where id = any({{대상}}) and class_id = '${B}'`, better: "up", unit: "count" }, { targets: T, outcome: true })).toBeNull();
  });
  it("'오르면 좋음' 비율 + 대상 = 분모는 대상 전원(리뷰 중3)", () => {
    expect(checkIntegrityProblem(OUTCOME, { targets: T, outcome: true })).toBeNull();
    const bad = { ...OUTCOME, sql: "select round(100.0 * sum(p) / nullif(count(*), 0), 1) as 값, count(*) as 표본 from att where student_id = any({{대상}}) and d >= {{시작}} and d < {{끝}}" };
    expect(checkIntegrityProblem(bad, { targets: T, outcome: true })).toMatch(/cardinality/);
    expect(checkIntegrityProblem({ ...bad, better: "down" }, { targets: T, outcome: true })).toBeNull();
  });
  it("대상 자리 채우기 — uuid 배열 글자(소문자) · 모양이 아닌 값은 버린다", () => {
    expect(fillTargets("x = any({{대상}}) and n = cardinality({{대상}})", [A, B.toUpperCase(), "bad'; drop"])).toBe(
      `x = any(array['${A}','${B}']::uuid[]) and n = cardinality(array['${A}','${B}']::uuid[])`,
    );
    expect(fillTargets("select 1", [A])).toBe("select 1");
  });
  it("대상 id는 버전 비트를 보지 않는다 · 500개까지(리뷰 낮음)", () => {
    expect(AdviceTargetsSchema.safeParse({ kind: "student", ids: ["12345678-1234-1234-1234-123456789abc"] }).success).toBe(true);
    expect(AdviceTargetsSchema.safeParse({ kind: "student", ids: ["x"] }).success).toBe(false);
    const many = Array.from({ length: 300 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`);
    // 300명이어도 조회문은 {{대상}} 한 자리 — 길이 상한에 안 걸린다(리뷰 중2)
    expect(checkIntegrityProblem(DONE, { targets: { kind: "student", ids: many }, outcome: false })).toBeNull();
  });
});

describe("보고서 검사(느슨하게)", () => {
  const settle = (item: Record<string, unknown>) =>
    settleReport({ title: "t", blocks: [{ type: "summary", text: "s" }, { type: "advice", items: [{ action: "a", why: "b", ...item }] }] }, new Map());
  const first = (r: ReturnType<typeof settle>) => {
    const b = r.ok ? r.report.blocks.find((x) => x.type === "advice") : undefined;
    return b?.type === "advice" ? b.items[0]! : null;
  };
  it("대상·결과·실행 지표가 맞으면 그대로", () => {
    expect(first(settle({ check: OUTCOME, doneCheck: DONE, targets: T }))).toMatchObject({ check: OUTCOME, doneCheck: DONE, targets: T });
  });
  it("대상 자리를 안 쓴 결과 지표는 빼고 까닭을 남긴다 — 답은 산다", () => {
    const r = settle({ check: { ...OUTCOME, sql: "select 1 as 값, 1 as 표본 where {{시작}} < {{끝}}" }, targets: T });
    expect(r.ok).toBe(true);
    expect(first(r)?.check).toBeUndefined();
    expect(first(r)?.noCheck).toBe(CHECK_FAILED);
  });
  it("틀린 실행 지표·명단은 그것만 뺀다(결과 지표는 산다)", () => {
    const item = first(settle({ check: { ...OUTCOME, unit: "count", sql: "select 1 as 값 where {{시작}} < {{끝}}" }, doneCheck: { ...DONE, sql: "select 1 as 값" }, targets: { kind: "student", ids: ["x"] } }));
    expect(item?.check).toBeDefined();
    expect(item?.doneCheck).toBeUndefined();
    expect(item?.targets).toBeUndefined();
  });
});

describe("저장 줄", () => {
  const base = { from: "2026-10-10", to: "2026-11-07", value: 2, sample: null };
  it("결과 지표를 잰 의견만 대상·실행 지표를 남긴다(id는 소문자 · 중복 제거 · 조회문은 틀 그대로)", () => {
    const [row] = adviceDrafts(
      [{ action: "a", why: "b" }],
      [{ itemNo: 0, check: OUTCOME, baseline: base, doneCheck: { check: DONE, baseline: { ...base, value: 0 } }, targets: { kind: "student", ids: [A, A.toUpperCase(), B] } }],
      "2026-11-09",
    );
    expect(row).toMatchObject({ target_kind: "student", target_ids: [A, B], check_sql: OUTCOME.sql });
    expect(row!.exec_check).toMatchObject({ label: DONE.label, sql: DONE.sql, baseline: { value: 0 } });
    const [none] = adviceDrafts([{ action: "a", why: "b" }], [{ itemNo: 0, check: OUTCOME, baseline: null, targets: T }], "2026-11-09");
    expect(none).toMatchObject({ target_kind: null, target_ids: null, exec_check: null, check_sql: null });
  });
  it("화면 모양 — 실행 지표 · 대상 인원 · 질문일(조회문은 싣지 않는다)", () => {
    const row = {
      id: "x", message_id: "m", item_no: 0, status: "adopted", status_at: "t", status_memo: null, done_on: null, self_rating: null,
      check_label: OUTCOME.label, check_unit: "percent", check_better: "up", window_days: 28, baseline_value: 50, baseline_sample: 2,
      baseline_from: "2026-10-10", baseline_to: "2026-11-07", next_check_on: "2026-12-09", no_check_reason: null, measure_state: "waiting",
      target_kind: "student", target_ids: [A, B], exec_label: DONE.label, exec_unit: "count", exec_better: "up", exec_baseline: { value: 0, sample: null },
    } satisfies AdviceRow;
    const view = adviceViewOf(row);
    expect(view.targets).toEqual({ kind: "student", count: 2 });
    expect(view.doneCheck).toEqual({ label: DONE.label, unit: "count", better: "up", baseline: { value: 0, sample: null } });
    // 질문일 = 기준값 기간 끝 + 2일 — 완료 '한 날' 입력의 하한(리뷰 중1)
    expect(view.askedOn).toBe("2026-11-09");
    expect(JSON.stringify(view)).not.toContain("select");
  });
});
