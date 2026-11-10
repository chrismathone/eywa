import { DUTY_KINDS, NEWCOMER_ITEM_LABEL } from "./kinds";

/** 칸을 눌렀을 때 보이는 한 줄 — 장부의 의무 하나와 그 실제 기록. 클라·서버 공용(순수). */
export type CellItemState = "ontime" | "early" | "late_done" | "late" | "upcoming" | "expired";
export type CellItem = {
  id: string; kind: string; period: string; cycle: string; state: CellItemState; dueAt: string; doneAt: string | null;
  className: string | null;
  /** 실제 기록으로 가는 주소(출석부 그날 그 반 · 그 상담 기록 · 성적 입력 칸). 갈 화면이 없으면 null — 줄만 보인다. */
  href: string | null;
};
export const CELL_STATE_LABEL: Record<CellItemState, string> = { ontime: "준수", early: "조기 완료", late_done: "지연 완료", late: "지연", upcoming: "기한 전", expired: "미이행" };
const kstDay = (iso: string) => new Date(Date.parse(iso) + 9 * 3_600_000).toISOString().slice(0, 10);
const md = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
const hm = (iso: string) => new Date(Date.parse(iso) + 9 * 3_600_000).toISOString().slice(11, 16);

/**
 * 상태 — 집계(s2_0050 `rollup_rows`)와 같은 판정: 끝낸 것은 기한 안이면 준수 · 넘겼으면 지연 완료, 열린 것은 기한이 지났으면 지연, 미이행 확정은 그대로.
 * 🔴 기한이 **아직 안 온** 것을 미리 끝낸 것은 준수가 아니라 조기 완료다 — 집계의 준수(제때/기한 도래)에는 기한이 온 것만 든다(칸 숫자와 목록의 '준수' 수가 같아야 한다).
 */
export function cellItemState(it: { status: string; voidReason: string | null; dueAt: string; doneAt: string | null }, nowMs: number): CellItemState {
  if (it.status === "void") return "expired";
  if (it.status === "done") return Date.parse(it.dueAt) > nowMs ? "early" : it.doneAt && Date.parse(it.doneAt) > Date.parse(it.dueAt) ? "late_done" : "ontime";
  return Date.parse(it.dueAt) <= nowMs ? "late" : "upcoming";
}
/** 무엇을(종류 · 일간은 수업일 · 월간은 달 · 신규생 정착은 항목). */
export function cellItemTitle(it: Pick<CellItem, "kind" | "period" | "cycle">): string {
  const kind = (DUTY_KINDS as Record<string, { label: string }>)[it.kind]?.label ?? "업무";
  if (it.period === "daily") return `${md(it.cycle)} ${kind}`;
  if (it.period === "monthly") return `${Number(it.cycle.slice(5, 7))}월 ${kind}`;
  return `${kind} — ${NEWCOMER_ITEM_LABEL[it.cycle] ?? "항목"}`;
}
/** 언제 — 끝낸 것은 실제 기록 시각, 아니면 기한(기한은 '다음 날 0시'로 적혀 있어 사람에게는 그 전날). */
export function cellItemWhen(it: Pick<CellItem, "state" | "dueAt" | "doneAt" | "period">): string {
  // 건별(신규생 정착)은 체크한 **날**만 안다(시각은 지어낸 값) — 날짜만 적는다.
  if (it.doneAt && (it.state === "ontime" || it.state === "early" || it.state === "late_done")) return it.period === "case" ? `${md(kstDay(it.doneAt))} 기록` : `${md(kstDay(it.doneAt))} ${hm(it.doneAt)} 기록`;
  return `기한 ${md(kstDay(new Date(Date.parse(it.dueAt) - 1).toISOString()))}`;
}
