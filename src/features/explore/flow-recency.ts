import { kstDateOf } from "@/lib/date-kst";
import type { FlowDirection } from "./flow-insight";

/**
 * 원생 흐름 분석의 '지금' — 날짜 · 최근성 · 원생 상태(재원·휴원·퇴원). 원장 2026-11-06 *"이 상담이 4월 28일에 한 상담인데 '긍정적'이라는
 * 분석이 나와버림"* · *"이런 이상한 분석 판단을 하지 않도록"* · *"재원 퇴원 휴원 상태 구분해서 분석할 수 있도록"*.
 * 프롬프트 재료([`flow-insight.ts`](./flow-insight.ts) `buildFlowPrompt`) · 저장 직전 바로잡기(`settleDirection`) · 카드 배지·안내(`flowCardState`)가
 * 같은 판정을 쓴다(같은 날짜는 같은 함수 — 카드가 '판단 보류'인데 저장값은 '좋아지는 중'인 일이 없게).
 * ⚠️ `"use client"`도 `server-only`도 붙이지 말 것(#61·#81).
 */

/** 이 날수보다 오래된 기록만 있으면 '지금' 흐름을 판정하지 않는다 — 원생상담 기준이 담임 월 1회라 90일(석 달). 화면·프롬프트 문구도 '90일'(달력 석 달과 경계가 어긋나지 않게). */
export const FLOW_STALE_DAYS = 90;

/** 기록 시각(ISO 시각 또는 YYYY-MM-DD) → KST 날짜. 🔴 시각의 `slice(0, 10)`은 UTC 날짜라 쓰지 않는다(새벽 상담이 하루 어긋난다). */
export function recordDay(at: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(at) ? at : (kstDateOf(at) ?? at.slice(0, 10));
}

/** 오늘(KST) 이하의 기록만 — 예정 수강(시간표 가져오기의 적용일 등)은 아직 일어난 일이 아니라 흐름·최근성·반영 시점에 넣지 않는다. */
export function upToToday<T extends { at: string }>(records: readonly T[], today: string): T[] {
  return records.filter((r) => recordDay(r.at) <= today);
}

/** 반영 시점이 앞날로 적힌 분석(11-06 전 — 예정 수강을 기록으로 셌다) = 합산 기준이 못 되고 카드도 '그때까지의 흐름'으로 말할 수 없다. */
export function isFutureBasis(coveredThrough: string | null, today: string): boolean {
  return !!coveredThrough && recordDay(coveredThrough) > today;
}

/** 두 날짜(YYYY-MM-DD) 사이 날수(to − from). 형식이 틀리면 null. */
export function daysBetween(from: string, to: string): number | null {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Number.isNaN(a) || Number.isNaN(b) ? null : Math.round((b - a) / 86_400_000);
}

/** 경과 표기 — 오늘 · N일 전(60일 미만) · 약 N개월 전(한 달 = 30일) · 앞날이면 N일 뒤. */
export function elapsedLabel(days: number): string {
  if (days < 0) return `${-days}일 뒤`;
  if (days === 0) return "오늘";
  return days < 60 ? `${days}일 전` : `약 ${Math.floor(days / 30)}개월 전`;
}

export type FlowRecency = { lastOn: string; days: number; stale: boolean };
/** 마지막 기록의 최근성 — 오늘 기준 `FLOW_STALE_DAYS`를 넘으면 stale. 기록·날짜가 없으면 null. */
export function flowRecency(latest: string | null, today: string): FlowRecency | null {
  if (!latest) return null;
  const lastOn = recordDay(latest);
  const days = daysBetween(lastOn, today);
  return days === null ? null : { lastOn, days, stale: days > FLOW_STALE_DAYS };
}

/** 오늘 기준 `FLOW_STALE_DAYS` 안(오늘 이하)의 기록 수. */
export function recentCount(records: readonly { at: string }[], today: string): number {
  return records.filter((r) => {
    const d = daysBetween(recordDay(r.at), today);
    return d !== null && d >= 0 && d <= FLOW_STALE_DAYS;
  }).length;
}

/** 원생의 지금 상태 — `students.status`(재원 enrolled · 휴원 on_hold · 퇴원 withdrawn · 그 밖) + 퇴원일(KST 날짜). */
export type FlowStanding = { status: string; withdrawnOn: string | null };

/**
 * 저장 직전 바로잡기(프롬프트가 같은 규칙을 말하지만 모델이 어겨도 저장값은 이 판정을 따른다):
 *  · 마지막 기록이 90일보다 오래됐거나(stale) 퇴원생 = '좋아지는 중·유지·엇갈림'을 두지 않는다(판단 보류). 걱정(concern)은 **그때의 판단**으로 남긴다 —
 *    카드는 이 경우 배지를 '판단 보류'(퇴원은 상태 배지)로 두고 안내에 '그때 판단: 주의'를 적는다(`flowCardState` — 옛 걱정을 지금의 '주의'로 보이지 않는다).
 *  · 90일 안 기록이 둘보다 적으면 '좋아지는 중'을 두지 않는다(칭찬 한 번은 흐름이 아니다).
 */
export function settleDirection(direction: FlowDirection, ctx: { stale: boolean; withdrawn: boolean; recent: number }): FlowDirection {
  if (ctx.stale || ctx.withdrawn) return direction === "concern" ? "concern" : "unknown";
  return direction === "improving" && ctx.recent < 2 ? "unknown" : direction;
}

/** 시각 비교(ISO 시각·날짜 모두) — 분석이 반영한 시점 **뒤**인가(같은 시각은 반영된 것). */
function isAfter(at: string, through: string): boolean {
  const a = Date.parse(at);
  const b = Date.parse(through);
  return Number.isNaN(a) || Number.isNaN(b) ? at > through : a > b;
}

export type FlowCardBadge = "status" | "unknown" | null;

/**
 * 카드(분석·판단) 바로잡기 — 저장된 분석이 오래됐어도 **보는 날** 기준으로 다시 판정한다(새 기록이 없으면 다시 분석하지 않으므로).
 *  · 퇴원생 · 휴원생(원생 전체) = 배지 자리에 그 상태('status' — 원생 상태 라벨·색 그대로) + "이 분석은 언제까지의 흐름" 안내.
 *  · 분석이 반영한 마지막 기록이 90일보다 오래됨(또는 앞날 — 11-06 전 분석) = '판단 보류' + 날짜 안내.
 *  · 분석 판단이 걱정(concern)이면 배지가 바뀌어도 안내에 남긴다('그때 판단: 주의' · 상태 배지면 '분석 판단: 주의').
 *  · `actualAts` = 화면이 **같은 표**에서 읽은 실제 기록 시각(상담 흐름 = 상담 조각) — 분석 뒤 기록이 **보이면** "아직 반영 전"을 알린다
 *    (분석 갱신을 부르지 않는 저장 경로가 있다 — 이탈 방어 · 성적 화면 상담 · 엑셀 가져오기). 🔴 없다는 단정은 하지 않는다 — 그 목록은 강사 범위로
 *    좁혀졌거나 조회 오류가 빈 목록으로 올 수 있다(그래서 안내는 늘 '분석이 본 날짜' 기준으로만 말한다).
 * `unit` = 상담 흐름 '상담' · 타임라인 흐름 '기록'(둘 다 받침 있는 말 — 조사 '을'·'이' 고정).
 */
export function flowCardState(args: {
  unit: string;
  direction: FlowDirection;
  coveredThrough: string | null;
  standing: FlowStanding;
  today: string;
  actualAts: readonly string[] | null;
}): { badge: FlowCardBadge; notice: string | null } {
  const { unit, direction, standing, today } = args;
  const rec = flowRecency(args.coveredThrough, today);
  const future = isFutureBasis(args.coveredThrough, today);
  const old = !!rec?.stale || future;
  const after = args.actualAts && args.coveredThrough ? args.actualAts.filter((at) => recordDay(at) <= today && isAfter(at, args.coveredThrough!)) : [];
  const newest = after.reduce<string | null>((max, at) => (max === null || isAfter(at, max) ? at : max), null);
  const behind = newest ? `그 뒤 ${unit} ${after.length}건(마지막 ${recordDay(newest)})은 아직 분석에 반영되지 않았습니다.` : null;
  const join = (...xs: (string | null)[]) => xs.filter(Boolean).join(" ") || null;
  const upto = !rec ? `반영된 ${unit}` : `${rec.lastOn}(${future ? "아직 오지 않은 날" : elapsedLabel(rec.days)})까지의 ${unit}`;
  const status = standing.status === "withdrawn" || standing.status === "on_hold";
  const judged = direction === "concern" ? (old ? "(그때 판단: 주의)" : status ? "(분석 판단: 주의)" : "") : "";
  if (standing.status === "withdrawn") {
    return { badge: "status", notice: join(`퇴원${standing.withdrawnOn ? `(${standing.withdrawnOn})` : ""} — 이 분석은 ${upto} 흐름입니다${judged}.`, behind) };
  }
  if (standing.status === "on_hold") return { badge: "status", notice: join(`지금 휴원 중입니다 — 이 분석은 ${upto} 흐름입니다${judged}.`, behind) };
  if (old) return { badge: "unknown", notice: join(`이 분석은 ${upto}을 본 것이라 지금 흐름은 판단하지 않습니다${judged}.`, behind) };
  return { badge: null, notice: behind };
}
