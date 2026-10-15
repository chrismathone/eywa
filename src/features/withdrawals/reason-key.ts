/**
 * 퇴원 사유 → 표준 키 · '강사 탓이 아닌 사유'(원장이 고른 사유) 판정 · 한 퇴원과 함께 끝난 수강 — **한 벌**(순수 · Vitest).
 *
 * 🔴 원장 2026-10-14 *"이사 졸업 이런건은 퇴원율로 잡지 않는다"* · *"모든 곳에서"* · *"수강종료 중에도 같은 사유(강사 귀책이 없는
 *    사유)들은 퇴원율에 포함시키지 않는다"* — 강사평가 퇴원율(`teacher-portfolio/model/churn.ts`) · 시간표 X 겹침
 *    (`exit-overlay-model.ts`) · 급여명세서 퇴원생률(`payroll/payslip-metrics.ts`)이 모두 이 판정을 쓴다. 고르는 사유 목록은
 *    강사평가 설정의 퇴원율 세는 법(`ChurnOptions.excludeReasons`, 기본 졸업·이사·질병·권고퇴원) 한 곳이다.
 */
import { LEGACY_REASON_LABELS, REASON_LABEL, normalizeReason, type WithdrawalReason } from "./types";

// 지금 라벨 + 바꾸기 전 라벨(2026-10-15 `수업 불만족` → `수업·강사` 등) — 글로 남은 옛 사유도 같은 키.
const LABEL_TO_KEY = new Map<string, WithdrawalReason>([
  ...(Object.entries(LEGACY_REASON_LABELS) as [string, WithdrawalReason][]),
  ...Object.entries(REASON_LABEL).map(([k, v]) => [v, k as WithdrawalReason] as [string, WithdrawalReason]),
]);

/**
 * 사유 원문 → 표준 키. 영문 코드 모양은 대소문자 없이 표준 키·별칭(`moved`)으로, 모르는 코드는 '기타'(옛 `codeOf`와 같다).
 * 사람이 **라벨과 같은 글**을 적은 것(`이사`)도 키로 본다. 그 밖의 자유 글(`종강`·`반 이동`)은 키가 아니다(null) — '기타'로
 * 뭉개면 제외 판정이 글자에 따라 흔들린다.
 */
export function reasonKeyOf(raw: string | null | undefined): WithdrawalReason | null {
  const text = raw?.trim();
  if (!text) return null;
  if (/^[a-z_]+$/i.test(text)) {
    const key = normalizeReason(text.toLowerCase());
    return key && Object.hasOwn(REASON_LABEL, key) ? key : "other";
  }
  return LABEL_TO_KEY.get(text) ?? null;
}

export function isExcludedExit(raw: string | null | undefined, reasons: readonly string[]): boolean {
  const key = reasonKeyOf(raw);
  return key != null && reasons.includes(key);
}

/** 여러 사유 칸(학생 퇴원 사유 · 수강 종료 사유 …) 중 **하나라도** 고른 사유면 그 키 — 없으면 null. */
export function excludedReasonOf(raws: readonly (string | null | undefined)[], reasons: readonly string[]): WithdrawalReason | null {
  for (const raw of raws) {
    const key = reasonKeyOf(raw);
    if (key && reasons.includes(key)) return key;
  }
  return null;
}

const shift = (ymd: string, days: number) => new Date(Date.parse(`${ymd.slice(0, 10)}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export type EndedRowRef = { classId: string; startDate: string | null; endDate: string | null };
export type ExitClassRef = { closedAt: string | null; regular: boolean };

/** 퇴원율이 그만둔 날로 보는 날 — 종료일과 반이 닫힌 날 중 이른 날 · 하루도 안 다닌 줄은 null(`buildStudentTracking`과 같은 규칙). */
export function exitDayOf(r: EndedRowRef, c: ExitClassRef | undefined): string | null {
  const day = [r.endDate?.slice(0, 10), c?.closedAt?.slice(0, 10)].filter((d): d is string => Boolean(d)).sort()[0];
  return day && (!r.startDate || day > r.startDate.slice(0, 10)) ? day : null;
}

/**
 * 한 퇴원(줄 날짜 `date`)과 함께 끝난 수강 — 기준 = 정규 반 중 그만둔 날이 마지막인 줄(줄 날짜 `lookbackDays`일 전 ~ 14일 뒤), 그 14일
 * 전부터 줄 날짜 14일 뒤까지 그만둔 수강 전부(특강·보강 포함 · 기준 수강이 시작하기 전에 끝난 줄은 빼고). 기준이 없으면 빈 배열.
 * 시간표 X(그 과목 수강 — 퇴원율에서 찾을 달 · 사유, 120일)와 급여명세서(이 선생님 반 수강 — 사유, 31일)가 같이 쓴다.
 * 🔴 기준은 정규 반에서 — 특강이 며칠 늦게 끝나면 정규 반의 '졸업'을 놓쳤다 · 하루도 안 다닌 줄(퇴원하며 닫힌 미리 등록한 반)은
 *    기준도 묶음도 아니다 · 기준 수강 전의 수강(졸업 뒤 다음 반에 다시 등록하고 그만둠의 '졸업')은 이번 퇴원의 사유가 아니다.
 * ⚠️ X가 31일이면 수강종료로 남아 있다가 한 달 넘게 뒤에 퇴원 처리된 학생의 선생님을 잃었다(적대 리뷰 2026-10-14) — X는 넓게,
 *    명세서는 좁게(한참 전에 끝난 이 선생님 반은 이번 퇴원의 사유가 아니다).
 */
export function endedWithExit<R extends EndedRowRef>(
  rows: readonly R[], date: string, classOf: (classId: string) => ExitClassRef | undefined, lookbackDays = 31,
): R[] {
  const lo = shift(date, -lookbackDays);
  const hi = shift(date, 14);
  const days = rows.map((r) => exitDayOf(r, classOf(r.classId)));
  let at = -1;
  rows.forEach((r, i) => {
    if (classOf(r.classId)?.regular && days[i] && days[i]! >= lo && days[i]! <= hi && (at < 0 || days[i]! > days[at]!)) at = i;
  });
  if (at < 0) return [];
  const floor = shift(days[at]!, -14);
  const since = rows[at]!.startDate?.slice(0, 10);
  return rows.filter((_, i) => !!days[i] && days[i]! >= floor && days[i]! <= hi && (i === at || !since || days[i]! > since));
}
