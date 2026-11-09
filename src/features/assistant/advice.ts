/**
 * 학원 비서 '제안 → 결과 → 학습' 1단계 — 비서 의견의 확인 지표 · 처리 상태(서버·화면 공용 · 순수 모듈).
 * 원장 2026-11-06 *"그 해결책이 어떤 결과를 가져왔는지에 대한 결과 피드백까지 할 수 있게해서 지속적인 학습이 이루어지도록"* ·
 * 2026-11-09 1단계 = '기록 + 처리 + 확인 지표'(재측정·판정·학습은 다음 단계). 설계 = docs/features/academy-assistant.md §7-5.
 *
 * 확인 지표 = 나중에 같은 조회문으로 다시 재어 의견의 효과를 볼 숫자 하나. 조회문 틀은 기간 자리 `{{시작}}`(포함)·`{{끝}}`(제외)를 담고,
 * 답할 때 [질문일 − 2일 − 기간, 질문일 − 2일)로 채워 기준값을 잰다(같은 읽기 전용 실행기 · agent.ts). 다시 잴 날 = 질문일 + checkAfterDays + 2일.
 * 🔴 두 쪽 모두 기간 끝 뒤 이틀(SETTLE_DAYS)을 비운다 — 출결 미입력·늦게 쓰는 보고서로 갓 지난 이틀은 덜 차 있어,
 *    기준값만 바로 재면 '오르면 좋은' 건수 지표가 저절로 좋아진 것처럼 보인다(적대 리뷰 2026-11-09).
 */
import { z } from "zod";
import { TARGET_KINDS, type AdviceTargets } from "./advice-targets";
import { addDays } from "@/lib/date-kst";

export const ADVICE_TOPICS = ["attendance", "homework", "grades", "retention", "enrollment", "billing", "teacher", "class_ops", "parent", "cost", "data", "other"] as const;
export const ADVICE_METHODS = ["call", "message", "meeting", "schedule", "staffing", "incentive", "process", "check", "other"] as const;
export const CHECK_UNITS = ["percent", "count", "won", "number"] as const;
export type AdviceTopic = (typeof ADVICE_TOPICS)[number];
export type AdviceMethod = (typeof ADVICE_METHODS)[number];
export type CheckUnit = (typeof CHECK_UNITS)[number];

export const START_TOKEN = "{{시작}}";
export const END_TOKEN = "{{끝}}";
/** 확인 지표를 받지 못한(AI가 빠뜨린) 의견 · 기준값을 재지 못한 의견에 서버가 적는 까닭. */
export const NO_CHECK_GIVEN = "확인 지표를 받지 못했습니다";
export const CHECK_FAILED = "확인 지표를 만들지 못했습니다";
/** 시간 상한·멈춤·'바로 결과 보기'로 기준값을 재지 않고 넘긴 지표(형식은 맞았다). */
export const CHECK_SKIPPED = "시간이 모자라 기준값을 재지 못했습니다";

export const AdviceCheckSchema = z.object({
  label: z.string().trim().min(1).max(60).describe("원장이 읽는 지표 이름 — 대상·기간을 넣는다(예: 'A반 최근 14일 결석률')"),
  sql: z
    .string()
    .trim()
    .min(1)
    .max(8000)
    .describe("SELECT 한 문장 — 기간은 {{시작}}(포함)·{{끝}}(제외) 자리로(따옴표 없이 — 서버가 날짜 글자로 채운다) · 결과는 한 줄 · 칸 값(필수) · 비율이면 표본(분모, 필수)"),
  unit: z.enum(CHECK_UNITS).describe("percent = 0~100 비율 · count = 건수·명수 · won = 원 · number = 그 밖의 숫자"),
  better: z.enum(["up", "down"]).describe("값이 오르면 좋은가(up) 내리면 좋은가(down)"),
  windowDays: z.union([z.literal(7), z.literal(14), z.literal(28)]).describe("한 번 잴 때의 기간(일)"),
  checkAfterDays: z.number().int().min(7).max(84).describe("며칠 뒤 다시 잴지 — windowDays 이상"),
});
export type AdviceCheck = z.infer<typeof AdviceCheckSchema>;

/** 기간 끝 뒤 비우는 날(늦게 들어오는 기록) — 기준값·재측정 모두. */
export const SETTLE_DAYS = 2;

/** 조회문 틀의 문제(없으면 null) — 기간 자리 둘 다(주석 밖에) · 따옴표로 감싸지 않기 · 다시 잴 날이 기간 이상. */
export function checkTemplateProblem(check: Pick<AdviceCheck, "sql" | "windowDays" | "checkAfterDays">): string | null {
  // 주석 안의 자리는 채워도 조회에 안 든다 — 날짜를 직접 적은 조회는 다시 재도 늘 같은 값이다(적대 리뷰 2026-11-09).
  const code = check.sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  if (!code.includes(START_TOKEN) || !code.includes(END_TOKEN)) return `조회문에 기간 자리 ${START_TOKEN}·${END_TOKEN}가 둘 다 있어야 합니다(주석 밖에)`;
  if (/'\{\{(시작|끝)\}\}'/.test(check.sql)) return `기간 자리를 따옴표로 감싸지 마세요(서버가 '날짜' 글자로 채웁니다)`;
  if (check.checkAfterDays < check.windowDays) return `checkAfterDays(${check.checkAfterDays})는 windowDays(${check.windowDays}) 이상이어야 합니다 — 다시 잴 기간이 질문일 뒤에서 시작하게`;
  return null;
}

/** 기간 자리를 날짜 글자로 채운다(`'YYYY-MM-DD'` — 날짜·시각 칸 모두와 견줄 수 있다 · 조회 세션 시간대는 한국). */
export function fillWindow(sql: string, from: string, to: string): string {
  return sql.split(START_TOKEN).join(`'${from}'`).split(END_TOKEN).join(`'${to}'`);
}

/** 기준값 기간 = [질문일 − 2일 − days, 질문일 − 2일). */
export function baselineWindow(today: string, days: number): { from: string; to: string } {
  const to = addDays(today, -SETTLE_DAYS);
  return { from: addDays(to, -days), to };
}

/** 다시 잴 날 = 질문일 + checkAfterDays + 2일(재측정 기간 [질문일 + checkAfterDays − 기간, 질문일 + checkAfterDays) 뒤 이틀 기다린다). */
export function nextCheckOn(today: string, checkAfterDays: number): string {
  return addDays(today, checkAfterDays + SETTLE_DAYS);
}

const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};

/** 확인 지표 조회 결과 한 줄을 읽는다 — 한 줄 · 칸 `값`(숫자) · 비율이면 `표본`(1 이상 — 0이면 잴 대상이 없다) · 비율은 0~100 · 음수 표본은 버린다. */
export function readCheckRow(
  result: { columns: readonly string[]; rows: ReadonlyArray<Record<string, unknown>> },
  unit: CheckUnit,
): { ok: true; value: number; sample: number | null } | { ok: false; error: string } {
  if (result.rows.length !== 1) return { ok: false, error: `결과가 ${result.rows.length}줄입니다 — 한 줄로 집계해 주세요` };
  if (!result.columns.includes("값")) return { ok: false, error: `결과에 칸 '값'이 없습니다(칸: ${result.columns.join(", ") || "없음"})` };
  const row = result.rows[0]!;
  const value = num(row["값"]);
  if (value === null) return { ok: false, error: "'값'이 숫자가 아닙니다(비어 있으면 coalesce로 0을 주거나, 잴 대상이 없는 지표입니다)" };
  const raw = result.columns.includes("표본") ? num(row["표본"]) : null;
  const sample = raw !== null && raw >= 0 ? raw : null;
  if (unit === "percent") {
    if (sample === null) return { ok: false, error: "비율(percent) 지표에는 칸 '표본'(분모 — 0 이상의 숫자)이 필요합니다" };
    if (sample === 0) return { ok: false, error: "표본(분모)이 0입니다 — 지금 잴 대상이 없는 지표입니다" };
    if (value < 0 || value > 100) return { ok: false, error: `비율 '값'은 0~100이어야 합니다(지금 ${value})` };
  }
  return { ok: true, value, sample };
}

export const ADVICE_STATUSES = ["open", "adopted", "done", "on_hold", "declined"] as const;
export type AdviceStatus = (typeof ADVICE_STATUSES)[number];
export const ADVICE_STATUS_LABEL: Record<AdviceStatus, string> = { open: "처리 전", adopted: "채택", done: "완료", on_hold: "보류", declined: "안 함" };
export const ADVICE_RATINGS = ["good", "meh", "bad"] as const;
export type AdviceRating = (typeof ADVICE_RATINGS)[number];
export const ADVICE_RATING_LABEL: Record<AdviceRating, string> = { good: "좋았음", meh: "그저 그럼", bad: "별로" };

/** 화면이 그리는 의견 한 줄의 처리 상태 · 확인 지표(조회문 원문은 싣지 않는다). */
export type AdviceView = {
  id: string;
  itemNo: number;
  status: AdviceStatus;
  /** 낙관적 잠금 — 처리할 때 이 값을 같이 보낸다(그 사이 다른 곳에서 바꿨으면 거절). */
  statusAt: string;
  memo: string | null;
  doneOn: string | null;
  selfRating: AdviceRating | null;
  check: {
    label: string;
    unit: CheckUnit;
    better: "up" | "down";
    windowDays: number;
    baseline: { value: number; sample: number | null; from: string; to: string } | null;
    nextCheckOn: string | null;
  } | null;
  noCheck: string | null;
  /** 재측정 상태(2단계 · s2_0038) — waiting = 다시 잴 날을 기다림 · measured = 결과 있음 · broken = 여러 번 못 잼 · stopped = 재지 않음(지운 대화 등). */
  measureState: "none" | "waiting" | "measured" | "broken" | "stopped";
  /** 다시 잰 결과 — 같은 날 기준 기간도 다시 잰 값(`base`)과 재측정 기간 값(`value`). 판정 = 개선·변화 없음·악화·판정 보류. */
  result: {
    verdict: "improved" | "flat" | "worse" | "unknown";
    base: number;
    baseSample: number | null;
    value: number;
    sample: number | null;
    from: string;
    to: string;
    checkedAt: string;
    reason: string | null;
    /** 무엇을 기준으로 쟀나 — done = 원장이 '완료'한 날(`anchor`)부터 · asked = 의견을 낸 날부터(처리 표시와 상관없이). */
    basis: "done" | "asked";
    anchor: string;
    /** 판정 문턱(오차 범위) — '뚜렷한 차이 없음'일 때 ±값으로 보인다. 판정 보류면 null. */
    threshold: number | null;
  } | null;
  /** 실행 지표(일을 했는지 — s2_0039) · 기준값. */
  doneCheck: { label: string; unit: CheckUnit; better: "up" | "down"; baseline: { value: number; sample: number | null } | null } | null;
  /** 굳혀 둔 대상 명단(종류 · 인원 — s2_0039). */
  targets: { kind: AdviceTargets["kind"]; count: number } | null;
  /** 질문일 — 완료 '한 날' 입력의 하한(기준값 기간 끝 + 2일). */
  askedOn: string | null;
};

/** 화면 숫자 — 비율 18.0% · 원 12,000원 · 그 밖은 천 단위 쉼표(소수 한 자리까지). */
export function formatCheckValue(value: number, unit: CheckUnit): string {
  if (unit === "percent") return `${value.toFixed(1)}%`;
  const rounded = Math.round(value * 10) / 10;
  const text = rounded.toLocaleString("ko-KR", { maximumFractionDigits: 1 });
  return unit === "won" ? `${text}원` : text;
}

/** `2026-11-21` → `11월 21일`. */
export function monthDayLabel(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  return m ? `${Number(m[2])}월 ${Number(m[3])}일` : ymd;
}

// ───────────────────────────── 저장 줄 ↔ 화면 ─────────────────────────────

type AdviceItemLike = { action: string; why: string; topic?: AdviceTopic; method?: AdviceMethod; noCheck?: string };
/** 확인 지표 한 의견의 결과 — 보고서 블록에서는 조회문을 뺐으므로(화면·저장으로 보내지 않는다) 지표 원문은 여기에만. */
export type AdviceCheckResult = {
  itemNo: number;
  check: AdviceCheck;
  baseline: { from: string; to: string; value: number; sample: number | null } | null;
  /** 재지 않고 넘겼다(시간 상한·멈춤·'바로 결과 보기') — 틀린 지표와 까닭을 가른다. */
  skipped?: boolean;
  /** 실행 지표와 기준값(s2_0039) — 못 쟀으면 baseline null(실행 지표는 기준값 없이도 남긴다). */
  doneCheck?: { check: AdviceCheck; baseline: { from: string; to: string; value: number; sample: number | null } | null };
  /** 대상 명단 — 보고서 블록에서는 뺐으므로 여기에만. 결과 지표가 저장될 때만 싣는다. */
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
      // 대상 명단·실행 지표(s2_0039)는 결과 지표가 저장될 때만(지표 없이 명단만 남기지 않는다).
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

/** 대상 명단·실행 지표(s2_0039) — 조회문 원문은 읽지 않고 이름·단위·기준값만. */
const TARGET_EXEC_COLUMNS = "target_kind, target_ids, exec_label:exec_check->>label, exec_unit:exec_check->>unit, exec_better:exec_check->>better, exec_baseline:exec_check->baseline";
/** 화면이 읽는 칸(조회문 원문은 읽지 않는다). */
export const ADVICE_VIEW_COLUMNS =
  "id, message_id, item_no, status, status_at, status_memo, done_on, self_rating, check_label, check_unit, check_better, window_days, baseline_value, baseline_sample, baseline_from, baseline_to, next_check_on, no_check_reason, measure_state, latest_verdict, latest_value, latest_sample, latest_base, latest_base_sample, latest_from, latest_to, latest_checked_at, latest_reason, measure_anchor, latest_threshold, " + TARGET_EXEC_COLUMNS;
/** 의견을 넣으며 돌려받는 칸 — 1단계 칸만(새 의견엔 결과가 없다 · 뒤 단계 칸이 없는 DB에서도 insert가 산다). */
export const ADVICE_INSERT_COLUMNS =
  "id, message_id, item_no, status, status_at, status_memo, done_on, self_rating, check_label, check_unit, check_better, window_days, baseline_value, baseline_sample, baseline_from, baseline_to, next_check_on, no_check_reason, measure_state, " + TARGET_EXEC_COLUMNS;

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
  measure_state: string;
  // 2단계 결과 칸(s2_0038) — 넣으며 돌려받을 때는 없다(ADVICE_INSERT_COLUMNS).
  latest_verdict?: string | null;
  latest_value?: number | string | null;
  latest_sample?: number | string | null;
  latest_base?: number | string | null;
  latest_base_sample?: number | string | null;
  latest_from?: string | null;
  latest_to?: string | null;
  latest_checked_at?: string | null;
  latest_reason?: string | null;
  measure_anchor?: string | null;
  latest_threshold?: number | string | null;
  // 대상 명단·실행 지표(s2_0039)
  target_kind?: string | null;
  target_ids?: string[] | null;
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
    measureState: isMeasureState(r.measure_state) ? r.measure_state : "none",
    result: resultOf(r),
    doneCheck: doneCheckOf(r),
    targets: r.target_kind && (TARGET_KINDS as readonly string[]).includes(r.target_kind) && r.target_ids?.length
      ? { kind: r.target_kind as AdviceTargets["kind"], count: r.target_ids.length }
      : null,
    askedOn: r.baseline_to ? addDays(r.baseline_to, SETTLE_DAYS) : null,
  };
}

function doneCheckOf(r: AdviceRow): AdviceView["doneCheck"] {
  const unit = r.exec_unit ?? null;
  const better = r.exec_better === "up" || r.exec_better === "down" ? r.exec_better : null;
  if (!r.exec_label || !isUnit(unit) || !better) return null;
  const value = num(r.exec_baseline?.value);
  return { label: r.exec_label, unit, better, baseline: value === null ? null : { value, sample: num(r.exec_baseline?.sample) } };
}

const MEASURE_STATES = ["none", "waiting", "measured", "broken", "stopped"] as const;
const isMeasureState = (v: string): v is AdviceView["measureState"] => (MEASURE_STATES as readonly string[]).includes(v);
const VERDICT_KEYS = ["improved", "flat", "worse", "unknown"] as const;

function resultOf(r: AdviceRow): AdviceView["result"] {
  const verdict = VERDICT_KEYS.find((v) => v === r.latest_verdict);
  const value = num(r.latest_value);
  const base = num(r.baseline_value);
  // latest_base(같은 날 다시 잰 기준)는 판정이 기준을 확인하는 데만 쓴다 — 화면의 '기준값'은 저장된 기준값(판정이 견준 값)이다.
  if (!verdict || value === null || base === null || !r.latest_from || !r.latest_to || !r.latest_checked_at) return null;
  const anchor = r.measure_anchor ?? (r.baseline_to ? addDays(r.baseline_to, SETTLE_DAYS) : r.latest_from);
  return {
    verdict,
    base,
    baseSample: num(r.baseline_sample),
    value,
    sample: num(r.latest_sample),
    from: r.latest_from,
    to: r.latest_to,
    checkedAt: r.latest_checked_at,
    reason: r.latest_reason ?? null,
    basis: r.measure_anchor ? "done" : "asked",
    anchor,
    threshold: num(r.latest_threshold),
  };
}
