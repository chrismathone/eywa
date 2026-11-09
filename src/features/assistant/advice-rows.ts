/**
 * 비서 의견 저장 줄 ↔ 화면(제안 → 결과 → 학습 · s2_0036 · s2_0038) — 의견 표(assistant_advice)에 넣을 줄과 화면이 읽는 모양. 순수 모듈.
 * advice.ts가 길어져 나눴다(지표 규칙은 advice.ts · 저장 모양은 여기).
 */
import {
  ADVICE_RATINGS,
  ADVICE_STATUSES,
  CHECK_FAILED,
  CHECK_SKIPPED,
  CHECK_UNITS,
  NO_CHECK_GIVEN,
  SETTLE_DAYS,
  TARGET_KINDS,
  nextCheckOn,
  num,
  type AdviceCheck,
  type AdviceMethod,
  type AdviceRating,
  type AdviceStatus,
  type AdviceTargets,
  type AdviceTopic,
  type AdviceView,
  type CheckUnit,
} from "./advice";
import { addDays, kstDateOf, kstToday } from "@/lib/date-kst";


type AdviceItemLike = { action: string; why: string; topic?: AdviceTopic; method?: AdviceMethod; noCheck?: string };
/** 확인 지표 한 의견의 결과 — 보고서 블록에서는 조회문을 뺐으므로(화면·저장으로 보내지 않는다) 지표 원문은 여기에만. */
export type AdviceCheckResult = {
  itemNo: number;
  check: AdviceCheck;
  baseline: { from: string; to: string; value: number; sample: number | null } | null;
  /** 재지 않고 넘겼다(시간 상한·멈춤·'바로 결과 보기') — 틀린 지표와 까닭을 가른다. */
  skipped?: boolean;
  /** 실행 지표와 기준값(s2_0038) — 못 쟀으면 baseline null(실행 지표는 기준값 없이도 남긴다 — 다시 잴 때 견줄 처음 값만 없다). */
  doneCheck?: { check: AdviceCheck; baseline: { from: string; to: string; value: number; sample: number | null } | null };
  /** 대상 명단 — 보고서 블록에서는 뺐으므로(화면·저장본으로 보내지 않는다) 여기에만. 결과 지표가 있는 의견만 싣는다. */
  targets?: AdviceTargets;
};

/** 의견 표(assistant_advice)에 넣을 줄 — 지점·답·대화·묻는 사람은 저장하는 쪽이 붙인다. 기준값을 못 잰 확인 지표는 까닭으로 바꾼다. */
export function adviceDrafts(items: readonly AdviceItemLike[], checks: readonly AdviceCheckResult[], askedOn: string) {
  return items.slice(0, 5).map((item, i) => {
    const result = checks.find((c) => c.itemNo === i);
    const baseline = result?.baseline ?? null;
    const check = result && baseline ? result.check : null;
    return {
      item_no: i,
      action: item.action.slice(0, 400),
      why: item.why.slice(0, 800),
      topic: item.topic ?? "other",
      method: item.method ?? null,
      check_label: check?.label ?? null,
      check_sql: check?.sql ?? null,
      check_unit: check?.unit ?? null,
      check_better: check?.better ?? null,
      window_days: check?.windowDays ?? null,
      check_after_days: check?.checkAfterDays ?? null,
      no_check_reason: check ? null : (result ? (result.skipped ? CHECK_SKIPPED : CHECK_FAILED) : (item.noCheck ?? NO_CHECK_GIVEN)).slice(0, 120),
      baseline_from: check ? baseline!.from : null,
      baseline_to: check ? baseline!.to : null,
      baseline_value: check ? baseline!.value : null,
      baseline_sample: check && baseline!.sample !== null && baseline!.sample >= 0 ? baseline!.sample : null,
      measure_state: check ? "waiting" : "none",
      next_check_on: check ? nextCheckOn(askedOn, check.checkAfterDays) : null,
      // 대상 명단·실행 지표는 결과 지표가 저장될 때만(지표 없이 명단만 남기지 않는다).
      target_kind: check && result?.targets ? result.targets.kind : null,
      target_ids: check && result?.targets ? [...new Set(result.targets.ids.map((id) => id.toLowerCase()))] : null,
      exec_check: check && result?.doneCheck ? execCheckJson(result.doneCheck) : null,
    };
  });
}

/** 실행 지표 저장 모양(jsonb exec_check) — 조회문 원문 + 기준값. */
function execCheckJson(d: NonNullable<AdviceCheckResult["doneCheck"]>) {
  const b = d.baseline;
  return {
    label: d.check.label,
    sql: d.check.sql,
    unit: d.check.unit,
    better: d.check.better,
    windowDays: d.check.windowDays,
    checkAfterDays: d.check.checkAfterDays,
    baseline: b ? { from: b.from, to: b.to, value: b.value, sample: b.sample !== null && b.sample >= 0 ? b.sample : null } : null,
  };
}

/** 화면이 읽는 칸(조회문 원문은 읽지 않는다). */
export const ADVICE_VIEW_COLUMNS =
  "id, message_id, item_no, status, status_at, status_memo, done_on, self_rating, check_label, check_unit, check_better, window_days, baseline_value, baseline_sample, baseline_from, baseline_to, next_check_on, no_check_reason, " +
  "created_at, target_kind, target_ids, acted_on, exec_label:exec_check->>label, exec_unit:exec_check->>unit, exec_better:exec_check->>better, exec_baseline:exec_check->baseline";

export type AdviceRow = {
  id: string;
  message_id: string;
  item_no: number;
  status: string;
  status_at: string;
  status_memo: string | null;
  done_on: string | null;
  self_rating: string | null;
  check_label: string | null;
  check_unit: string | null;
  check_better: string | null;
  window_days: number | null;
  baseline_value: number | string | null;
  baseline_sample: number | string | null;
  baseline_from: string | null;
  baseline_to: string | null;
  next_check_on: string | null;
  no_check_reason: string | null;
  created_at?: string | null;
  target_kind?: string | null;
  target_ids?: string[] | null;
  acted_on?: string | null;
  exec_label?: string | null;
  exec_unit?: string | null;
  exec_better?: string | null;
  exec_baseline?: { value?: unknown; sample?: unknown } | null;
};

const isStatus = (v: string): v is AdviceStatus => (ADVICE_STATUSES as readonly string[]).includes(v);
const isRating = (v: string | null): v is AdviceRating => v !== null && (ADVICE_RATINGS as readonly string[]).includes(v);
const isUnit = (v: string | null): v is CheckUnit => v !== null && (CHECK_UNITS as readonly string[]).includes(v);

export function adviceViewOf(r: AdviceRow): AdviceView {
  const value = num(r.baseline_value);
  const better = r.check_better === "up" || r.check_better === "down" ? r.check_better : null;
  const check: AdviceView["check"] =
    r.check_label && isUnit(r.check_unit) && better
      ? {
          label: r.check_label,
          unit: r.check_unit,
          better,
          windowDays: r.window_days ?? 0,
          baseline: value !== null && r.baseline_from && r.baseline_to ? { value, sample: num(r.baseline_sample), from: r.baseline_from, to: r.baseline_to } : null,
          nextCheckOn: r.next_check_on,
        }
      : null;
  return {
    id: r.id,
    itemNo: r.item_no,
    status: isStatus(r.status) ? r.status : "open",
    statusAt: r.status_at,
    memo: r.status_memo,
    doneOn: r.done_on,
    selfRating: isRating(r.self_rating) ? r.self_rating : null,
    check,
    noCheck: check ? null : r.no_check_reason,
    doneCheck: doneCheckOf(r),
    targets: r.target_kind && (TARGET_KINDS as readonly string[]).includes(r.target_kind) && r.target_ids?.length
      ? { kind: r.target_kind as AdviceTargets["kind"], count: r.target_ids.length }
      : null,
    actedOn: r.acted_on ?? null,
    askedOn: askedOnOf(r),
  };
}

function doneCheckOf(r: AdviceRow): AdviceView["doneCheck"] {
  const unit = r.exec_unit ?? null;
  const better = r.exec_better === "up" || r.exec_better === "down" ? r.exec_better : null;
  if (!r.exec_label || !isUnit(unit) || !better) return null;
  const value = num(r.exec_baseline?.value);
  return { label: r.exec_label, unit, better, baseline: value === null ? null : { value, sample: num(r.exec_baseline?.sample) } };
}

type TimingRow = { acted_on: string | null; created_at: string; baseline_to: string | null; check_after_days: number | null; measure_state: string };

/** 질문일 — 기준값 기간 끝(= 질문일 − 2일)에서 되짚는다(서버가 잰 날 그대로) · 없으면 저장 시각의 한국 날짜. */
export function askedOnOf(row: { baseline_to?: string | null; created_at?: string | null }): string | null {
  if (row.baseline_to && /^\d{4}-\d{2}-\d{2}$/.test(row.baseline_to)) return addDays(row.baseline_to, SETTLE_DAYS);
  return kstDateOf(row.created_at);
}

/**
 * 실행일 · 다시 잴 날(s2_0038 · 2026-11-09 답 검토 — 다시 잴 날을 질문일이 아니라 실제로 한 날부터 센다).
 * 채택 = 처음 채택한 날(이미 있으면 그대로) · 완료 = 한 날 · 처리 전·보류·안 함 = 실행일 없음(질문일 기준으로 돌아간다).
 * 다시 잴 날은 아직 기다리는(waiting) 지표만 고친다 — 이미 잰 지표(다음 단계)는 건드리지 않는다.
 */
export function actedTiming(row: TimingRow, status: AdviceStatus, doneOn: string | null, today: string = kstToday()): { acted_on: string | null; next_check_on?: string } {
  const asked = askedOnOf(row) ?? today;
  const raw = status === "done" ? doneOn : status === "adopted" ? (row.acted_on ?? today) : null;
  // 🔴 질문일보다 앞선 실행일은 질문일로 올린다(리뷰 2026-11-09) — 한 날을 질문 전으로 적으면 재측정 기간이 기준값 기간과 겹치거나 앞선다.
  //    적어 준 한 날(done_on)은 그대로 둔다(사실) — 재측정 기준만 올린다.
  const acted = raw && raw < asked ? asked : raw;
  if (row.measure_state !== "waiting" || row.check_after_days === null) return { acted_on: acted };
  return { acted_on: acted, next_check_on: nextCheckOn(acted ?? asked, row.check_after_days) };
}
