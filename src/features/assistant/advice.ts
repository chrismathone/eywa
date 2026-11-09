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
import { addDays } from "@/lib/date-kst";

export const ADVICE_TOPICS = ["attendance", "homework", "grades", "retention", "enrollment", "billing", "teacher", "class_ops", "parent", "cost", "data", "other"] as const;
export const ADVICE_METHODS = ["call", "message", "meeting", "schedule", "staffing", "incentive", "process", "check", "other"] as const;
export const CHECK_UNITS = ["percent", "count", "won", "number"] as const;
export type AdviceTopic = (typeof ADVICE_TOPICS)[number];
export type AdviceMethod = (typeof ADVICE_METHODS)[number];
export type CheckUnit = (typeof CHECK_UNITS)[number];

export const START_TOKEN = "{{시작}}";
/** 대상 명단 자리 — 서버가 굳힌 대상 id를 uuid 배열 글자로 채운다(`id = any({{대상}})` · 분모 `cardinality({{대상}})`). */
export const TARGET_TOKEN = "{{대상}}";
export const UUID_SHAPE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
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

/** 의견의 대상 명단(s2_0038) — 이번 조회로 찾은 id 전부. 서버가 굳혀 두고, 다시 잴 때 같은 명단으로 본다. */
export const TARGET_KINDS = ["student", "class", "teacher", "consultation"] as const;
export const AdviceTargetsSchema = z.object({
  kind: z.enum(TARGET_KINDS).describe("대상 종류 — student 원생 · class 반 · teacher 강사 · consultation 상담"),
  // 버전 비트를 보지 않는 uuid 모양(옛 자료·다른 생성기의 id도 받는다 — 리뷰 2026-11-09).
  ids: z.array(z.string().regex(UUID_SHAPE, "uuid 모양이 아닙니다")).min(1).max(500).describe("대상 id 전부(이번 조회로 찾은 그대로)"),
});
export type AdviceTargets = z.infer<typeof AdviceTargetsSchema>;

const codeOf = (sql: string) => sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * 일을 안 해도 좋아지는 지표를 막는다(2026-11-09 답 검토 — '출석률 75% 미만 재원생 수'는 그 학생들이 퇴원해도 내려간다 · 리뷰 2026-11-09 우회 보강).
 * ① '오늘' 칸(on_roster_today · active_today)은 기간 지표에 못 쓴다(다시 잴 날의 오늘로 바뀐다) — 결과·실행 지표 모두.
 * ② 조회문에 uuid 글자가 있으면 대상 명단(targets)을 달아야 한다 — 명단은 `{{대상}}` 자리로 쓴다(결과·실행 지표 모두).
 * ③ 대상 명단을 달았으면 `{{대상}}` 자리를 써야 한다(서버가 굳힌 명단으로 채운다 — 90명이 넘어도 조회문이 길어지지 않게).
 * ④ 결과 지표 '내리면 좋음'은 지금 상태로 모집단을 거르면 안 된다 — 학생 상태(status·status_label · 재원·휴원·퇴원 값) · 퇴원 칸이 비었음
 *    (withdrawn_on·exit_kind is null) · 수업료 청구가 살아 있는 학생만(onto_tuition_months·invoices). 학생이 나가면 저절로 내려간다.
 * ⑤ 결과 지표 '오르면 좋음' 비율(percent)에 대상 명단이 있으면 분모는 대상 전원(`cardinality({{대상}})`) — 남은 학생·남은 수업만 분모로 두면
 *    나간 학생이 비율을 올린다(수업 단위 출석률도 같다 — 나간 학생의 수업이 빠진다).
 */
const STATE_FILTER =
  /\bstatus(?:_label)?\s*(?:::\s*text\s*)?(?:=|<>|!=|\bin\b|\bnot\s+in\b)\s*\(?\s*'(?:enrolled|on_hold|withdrawn|prospect|consulted|재원|휴원|퇴원|예비|상담완료)'|\b(?:withdrawn_on|withdrawn_at|exit_kind)\s+is\s+(?:not\s+)?null|\bon_hold\b|\bonto_tuition_months\b|\binvoices\b/i;
const UUID_IN_SQL = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export function checkIntegrityProblem(
  check: Pick<AdviceCheck, "sql" | "better" | "unit">,
  opts: { targets?: AdviceTargets | null; outcome: boolean },
): string | null {
  const code = codeOf(check.sql);
  if (/\b(on_roster_today|active_today)\b/i.test(code)) return "on_roster_today·active_today는 '오늘' 기준 칸이라 기간 지표에 쓸 수 없습니다 — 기간 명단 규칙으로 쓰세요";
  const usesTargets = code.includes(TARGET_TOKEN);
  if (opts.targets && !usesTargets) return `대상 명단을 달았으면 조회문에 ${TARGET_TOKEN} 자리를 쓰세요(예: s.id = any(${TARGET_TOKEN})) — 서버가 명단으로 채웁니다`;
  if (!opts.targets && usesTargets) return `${TARGET_TOKEN} 자리를 쓰려면 대상 명단(targets)을 달아야 합니다`;
  if (UUID_IN_SQL.test(code.split(TARGET_TOKEN).join("")) && !opts.targets) return "조회문에 id를 글자로 적었으면 그 대상을 targets로 달고 {{대상}} 자리로 쓰세요(다시 잴 때 같은 명단으로)";
  if (!opts.outcome) return null;
  if (check.better === "down" && STATE_FILTER.test(code)) {
    return "지금 상태(재원·휴원·퇴원 · 청구가 살아 있는 학생)로 거르는 '내리면 좋음' 지표는 학생이 나가도 내려가 좋아진 것처럼 보입니다 — 대상 명단을 고정하고 나간 학생도 나쁜 결과로 세세요";
  }
  if (check.better === "up" && check.unit === "percent" && opts.targets && !/cardinality\s*\(\s*\{\{대상\}\}\s*\)/.test(code)) {
    return `대상 명단이 있는 비율 지표는 분모를 대상 전원(cardinality(${TARGET_TOKEN}))으로 두세요 — 남은 학생만 분모로 두면 나간 학생이 비율을 올립니다`;
  }
  return null;
}

/** 대상 자리를 굳힌 명단으로 채운다(`array['…','…']::uuid[]`) — 명단은 uuid 모양만(검사를 지난 값) · 소문자. */
export function fillTargets(sql: string, ids: readonly string[] | null | undefined): string {
  if (!sql.includes(TARGET_TOKEN)) return sql;
  const safe = (ids ?? []).filter((id) => UUID_SHAPE.test(id)).map((id) => `'${id.toLowerCase()}'`);
  return sql.split(TARGET_TOKEN).join(`array[${safe.join(",")}]::uuid[]`);
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

export const num = (v: unknown): number | null => {
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
  /** 실행 지표(일을 했는지 — s2_0038) · 기준값. */
  doneCheck: { label: string; unit: CheckUnit; better: "up" | "down"; baseline: { value: number; sample: number | null } | null } | null;
  /** 굳혀 둔 대상 명단(종류 · 인원). */
  targets: { kind: AdviceTargets["kind"]; count: number } | null;
  /** 실행일 — 원장이 채택·완료로 처리한 날(다시 잴 날의 기준 · 질문일보다 앞이면 질문일). */
  actedOn: string | null;
  /** 질문일 — 완료 '한 날' 입력의 기본 하한. */
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
