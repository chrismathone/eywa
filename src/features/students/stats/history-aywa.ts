/**
 * '지난 기록'의 에이와 쪽 월별 값(원장 2026-10-20) — 청구·등록으로 달마다 센다(밤마다 `student_history_monthly`에 쓴다). 순수 함수(Vitest).
 * 메이크에듀 쪽(2025-12까지)과 **같은 뜻**이라야 두 선이 이어진다(2025-12 EiE 외 수업 337·EiE 90 → 2026-01 330·93 실측):
 *   수업료가 청구된 학생 = 그달 청구가 살아 있는(취소·환불 아님 · 미납 포함) 학생 중 **수업** 항목이 있는 학생 — 수업명이 `[EiE]`로
 *                          시작하면(대소문자 무시 — `isEieLesson`) EiE, 아니면 EiE 외 수업
 *   실제 신규 = 그달 등록 중 수업을 시작한 학생 — 운영실·원생 통계 등록 막대가 쓰는 **판정 결과 그대로**(`computeRecordCoverage().started`) ·
 *               병합·장부 정리만 남은 등록은 뺀다(등록 막대와 같은 모집단)
 */

import { isEieLesson, type LessonProgram } from "./lesson-program";
import { lastJudgedMonth, stoppedPayingByMonth } from "./stopped-paying";

export type HistoryInvoice = {
  student_id: string;
  period: string | null;
  status: string | null;
  category: string | null;
  line_items: unknown;
  amount_total?: number | null;
  /** 머리의 낸 돈 — 줄마다 낸 돈이 없는 청구서(손으로 만든 것)의 수업료 수납을 줄 금액 비율로 나눌 때만. */
  amount_paid?: number | null;
};
export type HistoryRegistration = { id: string; enrolledAt: string | null; merged: boolean; bookkeeping: boolean };

const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" ? Number(v) || 0 : 0);
/** 수업료 항목 — 메이크에듀 '수업' · 에이와 'tuition' · 종류 없는 옛 항목(수업료로 정규화되는 줄). 교재·차량비·원복·시험은 아니다. */
const isLessonKind = (kind: unknown) => kind === undefined || kind === null || kind === "" || kind === "수업" || kind === "tuition";

/** 청구 한 장의 수업 항목 — 금액이 있는 항목만 · 수업명이 `[EiE]`로 시작하면(대소문자 무시) EiE. 항목이 없는 청구는 수업료 한 줄(청구 표의 표시와 같은 뜻). */
export function lessonKinds(lineItems: unknown, amountTotal?: number | null): { general: boolean; eie: boolean } {
  const items = Array.isArray(lineItems) ? lineItems : [];
  if (!items.length) return { general: num(amountTotal) > 0, eie: false };
  const out = { general: false, eie: false };
  for (const x of items) {
    if (!x || typeof x !== "object") continue;
    const item = x as LessonItem;
    if (!isLessonKind(item.kind) || (num(item.amount) <= 0 && num(item.paid) <= 0)) continue;
    if (isEieLesson(lessonName(item))) out.eie = true;
    else out.general = true;
  }
  return out;
}

const lessonName = (item: { description?: unknown; label?: unknown; name?: unknown }) => String(item.description ?? item.label ?? item.name ?? "");
type LessonItem = { kind?: unknown; amount?: unknown; paid?: unknown; refunds?: unknown; sourceItems?: unknown; description?: unknown; label?: unknown; name?: unknown };
const UNKNOWN = "_unknown";

/**
 * 청구 한 장의 EiE 아닌 수업 줄의 프로그램(`lesson-program.ts` — 수업명으로) · 못 가르면 '모름'. 항목이 없는 청구는 '모름' 한 줄
 * (어느 수업인지 모른다). EiE 줄은 넣지 않는다 — EiE 칸(`lessonKinds`)이 따로 센다.
 */
export function lessonPrograms(lineItems: unknown, amountTotal: number | null | undefined, classify: (name: string) => LessonProgram | null): Set<string> {
  const items = Array.isArray(lineItems) ? lineItems : [];
  const out = new Set<string>();
  if (!items.length) {
    if (num(amountTotal) > 0) out.add(UNKNOWN);
    return out;
  }
  for (const x of items) {
    if (!x || typeof x !== "object") continue;
    const item = x as LessonItem;
    if (!isLessonKind(item.kind) || (num(item.amount) <= 0 && num(item.paid) <= 0)) continue;
    const name = lessonName(item).trim();
    if (isEieLesson(name)) continue;
    out.add((name && classify(name)) || UNKNOWN);
  }
  return out;
}

/** 수업명 판정기의 재료 — 살아 있는 청구의 EiE 아닌 수업 줄 이름과 줄 수(`lessonProgramClassifier`가 강사 표시를 배운다). */
export function lessonNameWeights(invoices: readonly HistoryInvoice[]): { name: string; weight: number }[] {
  const counts = new Map<string, number>();
  for (const i of invoices) {
    if (!Array.isArray(i.line_items)) continue;
    for (const x of i.line_items) {
      if (!x || typeof x !== "object") continue;
      const item = x as LessonItem;
      if (!isLessonKind(item.kind) || (num(item.amount) <= 0 && num(item.paid) <= 0)) continue;
      const name = lessonName(item).trim();
      if (name && !isEieLesson(name)) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return [...counts].map(([name, weight]) => ({ name, weight }));
}

/**
 * 줄의 진행 중 환불 합(취소된 환불은 빼지 않는다) — 낸 돈에서 빼면 메이크에듀(환불 = 음수 줄)와 같은 순액이다.
 * 🔴 합쳐진 줄(`sourceItems` — 반 이동 합산 0267d · 자동 합산 0267c)은 환불이 **원본 줄마다** 있다(맨 위엔 없거나 첫 원본 것만) —
 *    원본이 있으면 원본들의 환불을 더한다(`receiptRefundState`와 같은 읽는 법 · 재리뷰 2026-10-21).
 */
function refundedOf(item: LessonItem): number {
  if (Array.isArray(item.sourceItems) && item.sourceItems.length) {
    return item.sourceItems.reduce<number>((s, x) => s + (x && typeof x === "object" ? refundedOf(x as LessonItem) : 0), 0);
  }
  return (Array.isArray(item.refunds) ? item.refunds : []).reduce<number>(
    (s, r) => s + (r && typeof r === "object" && (r as { status?: unknown }).status === "active" ? num((r as { amount?: unknown }).amount) : 0),
    0,
  );
}

/**
 * 청구 한 장의 **수업료 수납**(원 · 수납 통계 '지난 기록 — 수업료 수납') — EiE / 그 밖. 수업 항목만(교재·차량비 제외).
 * 줄마다 낸 돈이 있으면 그 값에서 진행 중 환불을 뺀 값, 없으면(손으로 만든 청구서) 머리의 낸 돈을 줄 금액 비율로 나눈 몫.
 * 항목이 없는 청구는 머리의 낸 돈 전부(수업료 한 줄 — `lessonKinds`와 같은 뜻).
 */
export function lessonPaid(lineItems: unknown, amountPaid: number | null | undefined): { general: number; eie: number } {
  const items = (Array.isArray(lineItems) ? lineItems : []).filter((x): x is LessonItem => !!x && typeof x === "object");
  if (!items.length) return { general: Math.round(num(amountPaid)), eie: 0 };
  const perLine = items.some((x) => x.paid !== undefined && x.paid !== null);
  const amountSum = items.reduce((s, x) => s + Math.max(0, num(x.amount)), 0);
  let general = 0;
  let eie = 0;
  for (const x of items) {
    if (!isLessonKind(x.kind)) continue;
    const paid = perLine ? num(x.paid) - refundedOf(x) : amountSum > 0 ? (num(amountPaid) * Math.max(0, num(x.amount))) / amountSum : 0;
    if (isEieLesson(lessonName(x))) eie += paid;
    else general += paid;
  }
  return { general: Math.round(general), eie: Math.round(eie) };
}

/** 프로그램 → 지난 기록 칸 — 수학 · 인재원 영어 · 그 밖의 과목(설정 과목 키) · 모름. EiE는 여기 오지 않는다. */
export function programField(program: string): "payingMath" | "payingInjaewon" | "payingOther" | "payingUnknown" {
  return program === "math" ? "payingMath" : program === "injaewon" ? "payingInjaewon" : program === UNKNOWN ? "payingUnknown" : "payingOther";
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
  /** 수업명 → 프로그램(`lessonProgramClassifier`) — 주면 프로그램 칸(수학·인재원 영어·그 밖·모름)도 센다. */
  classify?: (name: string) => LessonProgram | null;
}): { month: string; data: Record<string, number> }[] {
  const general = new Map<string, Set<string>>();
  const eie = new Map<string, Set<string>>();
  const all = new Map<string, Set<string>>();
  let hasEie = false;
  const programs = new Map<string, Map<string, Set<string>>>(); // 칸 → 달 → 학생
  const tuition = new Map<string, { general: number; eie: number }>(); // 달 → 수업료 수납(원)
  const paidMonths = new Map<string, Set<string>>(); // 학생 → 수업료 청구가 살아 있는 달(청구가 끊긴 학생 판정)
  const add = (m: Map<string, Set<string>>, month: string, id: string) => m.set(month, (m.get(month) ?? new Set()).add(id));
  for (const i of input.invoices) {
    if (!isLiveTuition(i)) continue;
    const k = lessonKinds(i.line_items, i.amount_total);
    if (!k.general && !k.eie) continue;
    const month = i.period!;
    (paidMonths.get(i.student_id) ?? paidMonths.set(i.student_id, new Set()).get(i.student_id)!).add(month);
    const paid = lessonPaid(i.line_items, i.amount_paid);
    const t = tuition.get(month) ?? tuition.set(month, { general: 0, eie: 0 }).get(month)!;
    t.general += paid.general;
    t.eie += paid.eie;
    if (k.general) add(general, month, i.student_id);
    if (k.eie) {
      add(eie, month, i.student_id);
      hasEie = true;
    }
    add(all, month, i.student_id);
    if (input.classify && k.general) {
      for (const p of lessonPrograms(i.line_items, i.amount_total, input.classify)) {
        const field = programField(p);
        add(programs.get(field) ?? programs.set(field, new Map()).get(field)!, month, i.student_id);
      }
    }
  }
  const reg = new Map<string, number>();
  const real = new Map<string, number>();
  for (const r of input.registrations) {
    if (r.merged || r.bookkeeping || !r.enrolledAt) continue;
    const month = r.enrolledAt.slice(0, 7);
    reg.set(month, (reg.get(month) ?? 0) + 1);
    if (input.started.has(r.id)) real.set(month, (real.get(month) ?? 0) + 1);
  }
  // 청구가 끊긴 학생 — 다음 두 달이 다 끝난 달만(이번 달의 세 달 전까지 · 그 뒤 달은 칸을 비운다).
  const lastMonth = input.months.at(-1);
  const stopped = lastMonth ? stoppedPayingByMonth(paidMonths, input.months, lastJudgedMonth(lastMonth)) : new Map<string, number>();
  return input.months.map((month) => {
    const data: Record<string, number> = {
      payingGeneral: general.get(month)?.size ?? 0,
      payingTotal: all.get(month)?.size ?? 0,
      newRegistered: reg.get(month) ?? 0,
      newReal: real.get(month) ?? 0,
    };
    if (hasEie) data.payingEie = eie.get(month)?.size ?? 0;
    // 수업료 수납(원) — 수납 통계 '지난 기록'. EiE 칸은 EiE 청구가 있는 지점만(학생 수 칸과 같은 규칙).
    data.tuitionPaidGeneral = tuition.get(month)?.general ?? 0;
    if (stopped.has(month)) data.stoppedPaying = stopped.get(month)!;
    if (hasEie) data.tuitionPaidEie = tuition.get(month)?.eie ?? 0;
    if (input.classify) {
      for (const field of ["payingMath", "payingInjaewon", "payingOther", "payingUnknown"] as const) data[field] = programs.get(field)?.get(month)?.size ?? 0;
    }
    return { month, data };
  });
}
