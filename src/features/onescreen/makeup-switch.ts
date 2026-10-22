/**
 * 보강 보고서 **합치기 ↔ 나누기** 전환(원장 2026-10-22 *"보강으로 분리되어있는 보고서도 선생님의 마음 변경으로 같이 보내고 싶을 수 있으니까
 * 보강건 보고서를 분리하거나 합칠 수 있게. 근데 하루에 본수업이 2회인 선생님도 있을 수 있기 때문에 … 스마트하게"*) — 판정(순수 · Vitest).
 *
 * 🔑 **합칠 정규 줄은 추측하지 않는다** — 보강 줄이 기록된 반(앵커 `makeupClassId`)과 **같은 반**의 오늘 정규 줄 하나뿐이다.
 *    하루에 정규 수업이 둘(다른 반)이어도 앵커가 답을 정한다. 같은 반 정규 줄이 없으면 막는다(다른 반에 합치면 보고서 반 ≠ 출석부 반 —
 *    원장 2026-09-30 *"보고서 반 = 출석부 반"*, 그리고 보강 시수가 다른 반 칸에 남는다).
 * 🔑 **시수는 손대지 않는다** — 같은 반이라 보강 시수는 이미 그 반 그날 칸 하나에 들어 있다('+ 보강 학생 추가'의 분리·합침 둘 다).
 * 🔴 이미 보냈거나 보내는 중인 보고서는 어느 쪽이든 막는다(학부모에게 나간 글은 되돌릴 수 없다).
 * 🔴 합칠 때 정규 줄 출결은 '+ 보강 학생 추가'의 합침과 같은 조건(`MERGEABLE_RAW` — 기록 없음·출석·지각·조퇴).
 * 내용(원장 결정 대기 → 잃지 않는 쪽 = 이어 붙이기): 오늘 과제·특이사항·멘트는 정규 줄 뒤에 잇고, 진도는 정규 줄이 비었을 때만 보강 줄 것을 쓴다
 * (진도는 진도맵이 읽는 값이라 두 줄을 이으면 망가진다). 테스트 점수·태도는 옮기지 않는다.
 */
import { MERGEABLE_RAW } from "./makeup-merge-plan";
import type { OneScreenStudent, Subject } from "./types";

export type MakeupSwitchBlock =
  /** 이미 보냈거나 보내는 중 */
  | "sent"
  /** 보강이 기록된 반의 오늘 정규 줄이 없다(다른 반·반 없이 기록한 보강 · 정규 수업이 없는 학생) */
  | "noRegular"
  /** 정규 줄 출결이 결석·공결·보강 */
  | "attendance"
  /** 그 반 정규 줄이 이미 '정규+보강' */
  | "alreadyMerged"
  /** 보고서를 보내지 않는 반·나눔 받는 줄 */
  | "optout"
  /** 같은 과목 보강 줄이 이미 있다(나누기) */
  | "hasSeparate"
  /** 그런 줄이 없다(화면이 그사이 바뀜) */
  | "gone";

/** 분리 → 합침 — 합칠 정규 줄. `isSent(이름)` = 그 줄 보고서를 보냈거나 보내는 중. */
export function planJoinMakeup(
  card: Pick<OneScreenStudent, "subjects">,
  makeupRowName: string,
  isSent: (rowName: string) => boolean,
): { ok: true; source: Subject; target: Subject } | { ok: false; reason: MakeupSwitchBlock } {
  const source = card.subjects.find((s) => s.name === makeupRowName && s.makeup && !s.classId);
  if (!source) return { ok: false, reason: "gone" };
  if (isSent(source.name)) return { ok: false, reason: "sent" };
  const anchor = source.makeupClassId;
  if (!anchor) return { ok: false, reason: "noRegular" };
  const sameClass = card.subjects.filter((s) => s.classId === anchor && (s.subjectKey ?? "") === (source.subjectKey ?? ""));
  if (sameClass.some((s) => s.makeup)) return { ok: false, reason: "alreadyMerged" };
  const target = sameClass.find((s) => !s.makeup);
  if (!target) return { ok: false, reason: "noRegular" };
  if (target.splitIn || target.reportOptout) return { ok: false, reason: "optout" };
  if (isSent(target.name)) return { ok: false, reason: "sent" };
  if (!MERGEABLE_RAW.has(target.attendanceRaw ?? "")) return { ok: false, reason: "attendance" };
  return { ok: true, source, target };
}

/** 합침 → 분리 — '정규+보강' 줄을 정규로 되돌리고 같은 반에 앵커를 둔 '(보강)' 줄을 따로 세운다. */
export function planSplitMakeup(
  card: Pick<OneScreenStudent, "subjects">,
  regularRowName: string,
  isSent: (rowName: string) => boolean,
): { ok: true; row: Subject } | { ok: false; reason: MakeupSwitchBlock } {
  const row = card.subjects.find((s) => s.name === regularRowName && s.makeup && !!s.classId);
  if (!row) return { ok: false, reason: "gone" };
  if (isSent(row.name)) return { ok: false, reason: "sent" };
  if (card.subjects.some((s) => s.makeup && !s.classId && (s.subjectKey ?? "") === (row.subjectKey ?? ""))) return { ok: false, reason: "hasSeparate" };
  return { ok: true, row };
}

/** 두 글을 잇는다 — 한쪽이 비면 다른 쪽, 둘 다 있고 같으면 하나. */
export function joinText(a: string | null | undefined, b: string | null | undefined, sep: string): string {
  const x = (a ?? "").trim();
  const y = (b ?? "").trim();
  if (!x) return y;
  if (!y || x === y) return x;
  return `${x}${sep}${y}`;
}

/**
 * 합칠 때 정규 줄에 덮을 값 — 오늘 과제·특이사항은 잇고, 진도는 정규 줄이 비었을 때만 보강 줄 것.
 * 특이사항은 줄 값이 없으면 학생 값(`studentNote`)으로 보이므로(row-fields.ts) 그 값 위에 잇는다. 보강 줄에 특이사항이 없으면 건드리지 않는다.
 */
export function joinMakeupContent(target: Subject, source: Subject, studentNote: string): Partial<Subject> {
  const out: Partial<Subject> = {};
  if (!(target.today ?? "").trim() && (source.today ?? "").trim()) out.today = source.today;
  const hw = joinText(target.homeworkToday, source.homeworkToday, " / ");
  if (hw !== (target.homeworkToday ?? "").trim()) out.homeworkToday = hw;
  if ((source.note ?? "").trim()) out.note = joinText(target.note ?? studentNote, source.note, "\n");
  return out;
}
