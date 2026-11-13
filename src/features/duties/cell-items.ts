import { DUTY_KINDS, NEWCOMER_ITEM_LABEL, dutyJudgedAt } from "./kinds";

/** 칸을 눌렀을 때 보이는 한 줄 — 장부의 의무 하나와 그 실제 기록. 클라·서버 공용(순수). */
export type CellItemState = "ontime" | "early" | "late_done" | "late" | "upcoming" | "expired" | "waived" | "absent";
export type CellItem = {
  id: string; kind: string; period: string; cycle: string; state: CellItemState; dueAt: string; doneAt: string | null;
  /** 때가 된 업무인가(칸의 분모에 드는 줄) — 아니면 기한 전의 월간 · 건별(진행만). */
  judged: boolean;
  className: string | null;
  /** 실제 기록으로 가는 주소(출석부 그날 그 반 · 그 상담 기록 · 성적 입력 칸). 갈 화면이 없으면 null — 줄만 보인다. */
  href: string | null;
};
export const CELL_STATE_LABEL: Record<CellItemState, string> = { ontime: "기한 내 완료", early: "미리 완료", late_done: "기한 후 완료", late: "미처리", upcoming: "남음", expired: "미처리 확정", waived: "면제", absent: "결석" };
const kstDay = (iso: string) => new Date(Date.parse(iso) + 9 * 3_600_000).toISOString().slice(0, 10);
const md = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
const hm = (iso: string) => new Date(Date.parse(iso) + 9 * 3_600_000).toISOString().slice(11, 16);

/**
 * 상태 — 집계(s2_0091 `rollup_rows`)와 같은 판정이다(칸의 분자/분모와 목록의 줄이 같은 것을 말해야 한다).
 *   · 끝낸 것: **때가 된 업무**면 기한 안 = 기한 내 완료 · 넘겼으면 기한 후 완료. 아직 때가 안 된 것(기한 전의 월간 · 건별)을 끝냈으면 미리 완료(칸의 분자에 아직 안 든다).
 *     🔴 수업이 끝난 뒤 기한(+24시간) 안에 보낸 보고서는 '미리 완료'가 아니라 **기한 내 완료**다 — 수업이 끝났으니 때가 된 업무다.
 *   · 열린 것: 기한이 지났으면 미처리 · 아니면 남음(때가 됐든 아니든 아직 할 일).
 *   · 미처리 확정 · 면제 · 결석(업무 없음)은 그대로.
 */
export function isJudgedItem(it: { kind: string; period: string; dueAt: string }, nowMs: number): boolean {
  return dutyJudgedAt(it.kind, it.period, it.dueAt) <= nowMs;
}
export function cellItemState(it: { kind: string; period: string; status: string; voidReason: string | null; dueAt: string; doneAt: string | null }, nowMs: number): CellItemState {
  // 면제한 것은 집계에서 빠지지만 목록에는 보인다 — 높은 %가 면제로 만든 것인지 알 수 있게(Claude + Codex 합의 2026-11-11).
  // 결석으로 빠진 보고서 업무도 목록에 보인다 — 그날 보고서가 없는 까닭이 결석인지 겉으로 알 수 있게(원장 2026-11-11 · 집계에는 없다).
  if (it.status === "void") return it.voidReason === "waived" ? "waived" : it.voidReason === "absent" ? "absent" : "expired";
  if (it.status === "done") return !isJudgedItem(it, nowMs) ? "early" : it.doneAt && Date.parse(it.doneAt) > Date.parse(it.dueAt) ? "late_done" : "ontime";
  return Date.parse(it.dueAt) <= nowMs ? "late" : "upcoming";
}
/** 목록 제목의 건수 — 칸의 분모와 같은 수(때가 된 업무)를 먼저, 기한 전 업무 · 면제 · 결석으로 빠진 것은 따로 적는다. */
export function cellItemCounts(items: readonly Pick<CellItem, "state" | "judged">[]): string {
  const live = items.filter((it) => it.state !== "waived" && it.state !== "absent");
  const judged = live.filter((it) => it.judged).length, pending = live.length - judged;
  const waived = items.filter((it) => it.state === "waived").length, absent = items.filter((it) => it.state === "absent").length;
  return [judged || !pending ? `${judged}건` : "", pending ? `진행 ${pending}건` : "", waived ? `면제 ${waived}건` : "", absent ? `결석 ${absent}건` : ""].filter(Boolean).join(" · ");
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
  if (it.doneAt && (it.state === "ontime" || it.state === "early" || it.state === "late_done")) return it.period === "case" ? `${md(kstDay(it.doneAt))} 완료` : `${md(kstDay(it.doneAt))} ${hm(it.doneAt)} 완료`;
  if (it.state === "absent") return "업무 없음";
  return `기한 ${md(kstDay(new Date(Date.parse(it.dueAt) - 1).toISOString()))}`;
}
