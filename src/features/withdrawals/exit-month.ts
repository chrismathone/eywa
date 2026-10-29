/**
 * **퇴원월 = 수강료를 낸 마지막 달** — 순수 규칙(Vitest).
 *
 * 원장 2026-10-29: *"퇴원처리는 10월 1일이지만 수강료는 9월 말까지 냈고 10월 수강료는 안 냈으니까 9월 퇴원생 · 반대로 10월 15일에
 * 퇴원처리했는데 수강료는 10월 내고 10월 일부분 환불했으면 10월 퇴원 · 수강료는 낸 기준으로 퇴원월이 정해져야 함 · 대시보드 및 퇴원관리
 * 시트 연동도 동일한 조건"*.
 *
 * 🔑 '낸 달' = 수업료(`category = tuition`) 청구 중 **수업 항목의 낸 돈 − 진행 중 환불이 0보다 큰** 달(`lessonPaid` — 수납 통계 '지난 기록'과
 *    같은 순액) · 취소(void)·환불(refunded) 상태도 뺀다. 🔴 환불은 청구 상태가 아니라 줄(`line_items[].refunds`)에 남는다 — 전액 환불한
 *    달도 상태는 `paid`라 상태만 보면 낸 달로 잘못 센다(적대 리뷰 2026-10-29). 일부 환불은 남은 돈이 있어 낸 달이다.
 *    퇴원일이 속한 달 **이하**에서 가장 늦은 달이 퇴원월이다.
 * 🔑 낸 달이 없으면(청구 기록 전 · 수업료를 안 낸 학생) 퇴원일이 속한 달 그대로(종전 규칙).
 * 🔑 퇴원일 뒤 달에 낸 기록(선납 뒤 환불 기록이 안 된 것)은 보지 않는다 — 아직 오지 않은 달을 퇴원월로 세지 않는다.
 * ⚠️ 표시하는 퇴원일은 그대로다 — 이 규칙은 **어느 달에 세느냐**만 정한다(`exitCountDate`).
 */

import { lessonLinesPaid, lessonPaid } from "@/features/students/stats/history-aywa";
import { lessonProgramClassifier } from "@/features/students/stats/lesson-program";
import { subjectGroupOf, type ProgramSubject } from "@/features/students/enrollment/program";

export type PaidTuitionRow = {
  student_id: string;
  period: string | null;
  status: string | null;
  category: string | null;
  amount_paid: number | string | null;
  /** 수업·교재 줄(환불 기록 포함) — 없으면 머리의 낸 돈만 본다. */
  line_items?: unknown;
};

/** 수업료를 낸 달(YYYY-MM, 오름차순) — 취소·환불 상태·수업 순액(낸 돈 − 진행 중 환불) 0 이하는 뺀다. */
export function paidTuitionMonths(rows: readonly Omit<PaidTuitionRow, "student_id">[]): string[] {
  const out = new Set<string>();
  for (const r of rows) {
    if (!r.period || !/^\d{4}-\d{2}$/.test(r.period)) continue;
    if ((r.category ?? "tuition") !== "tuition") continue;
    if (r.status === "void" || r.status === "refunded") continue;
    const net = lessonPaid(r.line_items, Number(r.amount_paid ?? 0));
    if (!(net.general + net.eie > 0)) continue;
    out.add(r.period);
  }
  return [...out].sort();
}

/** 퇴원월(YYYY-MM) — 퇴원일이 속한 달 이하에서 수업료를 낸 마지막 달, 없으면 퇴원일이 속한 달. */
export function exitMonthOf(withdrawnAt: string, paidMonths: readonly string[]): string {
  const month = withdrawnAt.slice(0, 7);
  let last: string | null = null;
  for (const m of paidMonths) if (m <= month && (!last || m > last)) last = m;
  return last ?? month;
}

const lastDayOf = (ym: string) =>
  new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).toISOString().slice(0, 10);

/**
 * 기간 판정에 쓰는 날짜 — 퇴원월이 퇴원일의 달이면 퇴원일 그대로, 앞 달이면 **그 달 말일**.
 * 기간 창(이번 달·직접 지정·월별 추이)은 이 날짜로 판정한다 — 퇴원월과 창의 달이 늘 맞는다.
 */
export function exitCountDate(withdrawnAt: string, paidMonths: readonly string[]): string {
  const date = withdrawnAt.slice(0, 10);
  const month = exitMonthOf(date, paidMonths);
  return month === date.slice(0, 7) ? date : lastDayOf(month);
}

/**
 * **과목 수강종료**의 낸 달 — 과목 묶음(`subjectGroupOf` — 수학·영어(EiE·인재원 영어)·그 밖 과목 키)마다 그 과목 **수업 줄**의 순액이 0보다 큰 달.
 * 원장 2026-10-29(*"9월 퇴원생 여전히 10월퇴원으로 뜨는데"* — 10/1 수학 종료인데 9월까지만 수학을 냄): 수강종료도 퇴원과 같은 규칙을
 * 그 과목 수업료로 본다. 줄의 과목은 **수업명에 적힌 것만**(과목 이름·'중등M'·'[EiE]' 같은 머리글 — `lessonProgramClassifier([], …)`,
 * 강사 표시로 배우지 않는다) — 모르는 줄('[강아] 강의하는아이들 (OOO)')·항목 없는 청구는 어느 과목으로도 세지 않는다(지어내지 않는다).
 */
export function paidSubjectMonths(
  rows: readonly Omit<PaidTuitionRow, "student_id">[],
  subjects: readonly ProgramSubject[],
): Map<string, string[]> {
  const classify = lessonProgramClassifier([], subjects, []);
  const out = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.period || !/^\d{4}-\d{2}$/.test(r.period)) continue;
    if ((r.category ?? "tuition") !== "tuition") continue;
    if (r.status === "void" || r.status === "refunded") continue;
    const net = new Map<string, number>();
    for (const line of lessonLinesPaid(r.line_items, Number(r.amount_paid ?? 0)) ?? []) {
      const group = groupOfProgram(classify(line.name.trim()), subjects);
      if (group) net.set(group, (net.get(group) ?? 0) + line.paid);
    }
    for (const [group, paid] of net) if (paid > 0) (out.get(group) ?? out.set(group, new Set()).get(group)!).add(r.period);
  }
  return new Map([...out].map(([g, ms]) => [g, [...ms].sort()]));
}

/** 수업명 프로그램 → 과목 묶음(EiE·인재원 영어 = 영어). */
function groupOfProgram(program: string | null, subjects: readonly ProgramSubject[]): string | null {
  if (!program) return null;
  if (program === "eie" || program === "injaewon") return "english";
  return subjectGroupOf(program, subjects);
}

/**
 * 수강종료 줄의 기간 판정 날짜 — 그 과목 수업료를 낸 마지막 달(종료일의 달 이하) · 그 과목을 낸 기록이 없으면 종료일 그대로(종전 규칙).
 * `since`(그 과목을 마지막으로 이어 다닌 시작일 — `subjectRunStart`)의 달보다 앞선 납부는 보지 않는다(적대 리뷰 2026-10-29: 3월에 그만뒀다가
 * 9월에 다시 다닌 과목을 10/1에 끊으면 3월로 세던 것) — 남는 달이 없으면 종료일 그대로.
 */
export function subjectExitCountDate(
  endedAt: string,
  subject: string,
  paidBySubject: ReadonlyMap<string, readonly string[]>,
  subjects: readonly ProgramSubject[],
  since?: string | null,
): string {
  const group = subjectGroupOf(subject, subjects);
  const from = since?.slice(0, 7) ?? "";
  return exitCountDate(endedAt, ((group && paidBySubject.get(group)) || []).filter((m) => m >= from));
}

const DAY = 86_400_000;
/** 이어 다닌 것으로 보는 틈(일) — 반 이동·방학 사이의 짧은 공백. */
const RUN_GAP_DAYS = 31;

/**
 * 그 과목을 **마지막으로 이어 다닌 시작일** — 마지막으로 끝난 수강(`lastStart`)에서 거꾸로, 시작 전 31일 안에 끝났거나 아직 걸쳐 있던 같은 과목
 * 수강의 시작일로 넓혀 간다(반 이동 사슬). 시작일을 모르는 수강은 건너뛴다.
 */
export function subjectRunStart(rows: readonly { startDate: string | null; endDate: string | null }[], lastStart: string | null): string | null {
  if (!lastStart) return null;
  let start = lastStart;
  for (let moved = true; moved; ) {
    moved = false;
    const edge = new Date(Date.parse(`${start.slice(0, 10)}T00:00:00Z`) - RUN_GAP_DAYS * DAY).toISOString().slice(0, 10);
    for (const r of rows) {
      if (!r.startDate || r.startDate >= start) continue;
      if (r.endDate && r.endDate.slice(0, 10) < edge) continue;
      start = r.startDate;
      moved = true;
    }
  }
  return start;
}
