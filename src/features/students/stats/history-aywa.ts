/**
 * '지난 기록'의 에이와 쪽 월별 값(원장 2026-10-20) — 청구·등록으로 달마다 센다(밤마다 `student_history_monthly`에 쓴다). 순수 함수(Vitest).
 * 메이크에듀 쪽(2025-12까지)과 **같은 뜻**이라야 두 선이 이어진다(2025-12 EiE 외 수업 337·EiE 90 → 2026-01 330·93 실측):
 *   수업료가 청구된 학생 = 그달 청구가 살아 있는(취소·환불 아님 · 미납 포함) 학생 중 **수업** 항목이 있는 학생 — 수업명이 `[EiE]`로
 *                          시작하면 EiE, 아니면 EiE 외 수업
 *   실제 신규 = 그달 등록 중 수업을 시작한 학생 — 운영실·원생 통계 등록 막대가 쓰는 **판정 결과 그대로**(`computeRecordCoverage().started`) ·
 *               병합·장부 정리만 남은 등록은 뺀다(등록 막대와 같은 모집단)
 */

export type HistoryInvoice = { student_id: string; period: string | null; status: string | null; category: string | null; line_items: unknown; amount_total?: number | null };
export type HistoryRegistration = { id: string; enrolledAt: string | null; merged: boolean; bookkeeping: boolean };

const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" ? Number(v) || 0 : 0);
/** 수업료 항목 — 메이크에듀 '수업' · 에이와 'tuition' · 종류 없는 옛 항목(수업료로 정규화되는 줄). 교재·차량비·원복·시험은 아니다. */
const isLessonKind = (kind: unknown) => kind === undefined || kind === null || kind === "" || kind === "수업" || kind === "tuition";

/** 청구 한 장의 수업 항목 — 금액이 있는 항목만 · 수업명이 `[EiE]`로 시작하면 EiE. 항목이 없는 청구는 수업료 한 줄(청구 표의 표시와 같은 뜻). */
export function lessonKinds(lineItems: unknown, amountTotal?: number | null): { general: boolean; eie: boolean } {
  const items = Array.isArray(lineItems) ? lineItems : [];
  if (!items.length) return { general: num(amountTotal) > 0, eie: false };
  const out = { general: false, eie: false };
  for (const x of items) {
    if (!x || typeof x !== "object") continue;
    const item = x as { kind?: unknown; amount?: unknown; paid?: unknown; description?: unknown; label?: unknown; name?: unknown };
    if (!isLessonKind(item.kind) || (num(item.amount) <= 0 && num(item.paid) <= 0)) continue;
    if (String(item.description ?? item.label ?? item.name ?? "").trimStart().startsWith("[EiE]")) out.eie = true;
    else out.general = true;
  }
  return out;
}

/** 청구가 살아 있나 — 수업료 청구(분류 없음 = 수업료)이고 취소·환불이 아니다(`billedTuitionMonths`·등록 판정과 같은 뜻). */
export const isLiveTuition = (i: Pick<HistoryInvoice, "status" | "category" | "period">) =>
  (i.category ?? "tuition") === "tuition" && i.status !== "void" && i.status !== "refunded" && /^\d{4}-\d{2}$/.test(i.period ?? "");

/**
 * 달마다 값 — `months`(YYYY-MM, 오름차순)마다 한 줄. EiE 칸은 그 지점에 EiE 수업 청구가 하나라도 있을 때만 싣는다(없는 프로그램을 0으로 그리지 않게).
 * `started` = 수업을 시작한 등록(등록 막대와 같은 판정 결과 — 호출부가 `computeRecordCoverage`에서 받아 넘긴다).
 */
export function aywaHistoryMonths(input: {
  months: readonly string[];
  invoices: readonly HistoryInvoice[];
  registrations: readonly HistoryRegistration[];
  started: ReadonlySet<string>;
}): { month: string; data: Record<string, number> }[] {
  const general = new Map<string, Set<string>>();
  const eie = new Map<string, Set<string>>();
  const all = new Map<string, Set<string>>();
  let hasEie = false;
  const add = (m: Map<string, Set<string>>, month: string, id: string) => m.set(month, (m.get(month) ?? new Set()).add(id));
  for (const i of input.invoices) {
    if (!isLiveTuition(i)) continue;
    const k = lessonKinds(i.line_items, i.amount_total);
    if (!k.general && !k.eie) continue;
    const month = i.period!;
    if (k.general) add(general, month, i.student_id);
    if (k.eie) {
      add(eie, month, i.student_id);
      hasEie = true;
    }
    add(all, month, i.student_id);
  }
  const reg = new Map<string, number>();
  const real = new Map<string, number>();
  for (const r of input.registrations) {
    if (r.merged || r.bookkeeping || !r.enrolledAt) continue;
    const month = r.enrolledAt.slice(0, 7);
    reg.set(month, (reg.get(month) ?? 0) + 1);
    if (input.started.has(r.id)) real.set(month, (real.get(month) ?? 0) + 1);
  }
  return input.months.map((month) => {
    const data: Record<string, number> = {
      payingGeneral: general.get(month)?.size ?? 0,
      payingTotal: all.get(month)?.size ?? 0,
      newRegistered: reg.get(month) ?? 0,
      newReal: real.get(month) ?? 0,
    };
    if (hasEie) data.payingEie = eie.get(month)?.size ?? 0;
    return { month, data };
  });
}
