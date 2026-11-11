/**
 * 퇴원·수강종료 줄의 **담당 선생님 = 그만둘 때 다니던 반의 그날 담임**(순수 · Vitest) — 퇴원관리 '강사별'·명단 '담당강사'·
 * 시간표 X가 이 한 벌을 쓴다(원장 2026-11-11 *"시트에 보면 담당 강사로 붙자나"* → 퇴원생 관리 차트의 '담당선생님'과 같은 기준).
 *
 * 🔴 강사평가 퇴원율이 그 퇴원을 넣은 선생님(`churnTeachersOf`)이 아니다 — 퇴원율은 지난달 분모라 한 달 늦게 붙고(10월 퇴원이
 *    9월 담당에게), 교시를 맡은 원어민·다른 선생님과 JJ반 담임까지 모두 붙어 시트와 7~10월 90줄 중 32줄만 맞았다(실측 2026-11-11).
 *    점수(퇴원율)는 그대로 두고 화면의 '담당'만 이 기준으로 보인다.
 * - 반 = 그 퇴원과 함께 끝난 정규 반 수강(`endedWithExit` — 특강·보강 반 제외) · 반 이동으로 닫힌 줄은 다른 줄이 있으면 뺀다.
 * - 수학 JJ(자습실) 반은 뺀다 — 시트도 JJ 반은 적지 않는다(`isSelfStudyClassName`). JJ 반만 남으면 그 반으로.
 * - 그날 담임 = (영어 반) 그날 유효한 시간표 칸에서 **가장 많이 들어가는 한국인 선생님**(영어 시트 가져오기가 담임을 정하는 규칙과 같다 —
 *   영어는 달마다 칸 선생님이 바뀌는데 담임 변경 기록이 안 남는다). 칸이 비었거나 동률이면 · 수학 반은 늘 담임 이력(`owner` — 호출부가 칸을 넘기지 않는다).
 * - 담임 이력이 비었으면(인계 기록에 이전 담임 없음 · 담임 칸 빈 채 닫힌 반) 그 반 보고서를 30일간 가장 많이 쓴 선생님(`reportWriterOn`).
 * - 날 = 마지막으로 다닌 날(종료일 하루 앞 — 종료일이 1일이면 그 전달 선생님이 가르쳤다).
 */
import { exitDayOf, endedWithExit, type EndedRowRef, type ExitClassRef } from "./reason-key";
import { isSelfStudyClassName } from "./withdrawal-sheet-model";

export type HomeroomRow = EndedRowRef & { transferred: boolean };
export type HomeroomClass = ExitClassRef & { name: string };
export type HomeroomSlot = { teacherId: string | null; validFrom: string | null; validTo: string | null };
/** 그 반 수업보고서 한 줄 — 담임 이력이 비었을 때만 쓰는 추정 근거(`reportWriterOn`). */
export type HomeroomReport = { teacherId: string; date: string };

/** 보고서로 보는 폭 — 마지막으로 다닌 날 앞 30일. */
export const REPORT_WINDOW_DAYS = 30;

/**
 * 그날 앞 30일 동안 그 반 보고서를 가장 많이 쓴 선생님 — 동률이거나 없으면 null.
 * 🔴 담임 이력(`owner`)이 **비었을 때만** 쓴다(인계 기록에 이전 담임이 없다 · 담임 칸이 빈 채 닫힌 반). 이력이 있으면 이력이 이긴다 —
 *    작성자는 담임이 아닐 수 있다(대리 작성 [[#93]]). 침산 실측: 중2 PS2S는 7/9 인계 기록에 이전 담임이 없어 6월까지 쓴 김화영
 *    선생님 대신 아무도 안 붙었다(원장 2026-11-11 *"김화영 7월만 봐도 10명 가까이 되는데"*).
 */
export function reportWriterOn(reports: readonly HomeroomReport[], day: string): string | null {
  const from = new Date(Date.parse(`${day}T00:00:00Z`) - REPORT_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  const counts = new Map<string, number>();
  for (const r of reports) if (r.date >= from && r.date <= day) counts.set(r.teacherId, (counts.get(r.teacherId) ?? 0) + 1);
  const ranked = [...counts].sort((a, b) => b[1] - a[1]);
  if (!ranked.length || (ranked[1] && ranked[1][1] === ranked[0]![1])) return null;
  return ranked[0]![0];
}

const prevDay = (ymd: string) => new Date(Date.parse(`${ymd}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/** 그날 유효한 칸에서 가장 많이 들어가는 한국인 선생님 — 없거나 동률이면 null. */
export function slotHomeroom(slots: readonly HomeroomSlot[], day: string, isKorean: (teacherId: string) => boolean): string | null {
  const counts = new Map<string, number>();
  for (const s of slots) {
    if (!s.teacherId || !isKorean(s.teacherId)) continue;
    if ((s.validFrom && s.validFrom.slice(0, 10) > day) || (s.validTo && s.validTo.slice(0, 10) < day)) continue;
    counts.set(s.teacherId, (counts.get(s.teacherId) ?? 0) + 1);
  }
  const ranked = [...counts].sort((a, b) => b[1] - a[1]);
  if (!ranked.length || (ranked[1] && ranked[1][1] === ranked[0]![1])) return null;
  return ranked[0]![0];
}

export function exitHomeroomIds(input: {
  rows: readonly HomeroomRow[];
  date: string;
  lookbackDays: number;
  classOf: (classId: string) => HomeroomClass | undefined;
  slotsOf: (classId: string) => readonly HomeroomSlot[];
  owner: (classId: string, day: string) => string | null;
  isKorean: (teacherId: string) => boolean;
  /** 담임 이력이 빈 반의 보고서(없으면 빈 배열) — `reportWriterOn`. */
  reportsOf?: (classId: string) => readonly HomeroomReport[];
  /**
   * 그날 재직 중인가(2026-11-11) — 칸 다수·보고서 작성자 후보도 재직 밖이면 뺀다(담임 이력 `owner`는 이미 거른다 · 강사평가와 같은 판정).
   * 시간표 이관이 교시 담당 시작일을 입사 전으로 적은 줄이 입사 전 퇴원을 그 선생님에게 붙이지 않게. 없으면 자르지 않는다.
   */
  employed?: (teacherId: string, day: string) => boolean;
}): string[] {
  const { classOf } = input;
  const ended = endedWithExit(input.rows, input.date, classOf, input.lookbackDays).filter((r) => classOf(r.classId)?.regular);
  const kept = ended.some((r) => !r.transferred) ? ended.filter((r) => !r.transferred) : ended;
  const notJJ = kept.filter((r) => !isSelfStudyClassName(classOf(r.classId)?.name));
  const picked = notJJ.length ? notJJ : kept;
  const ids = new Set<string>();
  for (const r of picked) {
    const exit = exitDayOf(r, classOf(r.classId));
    if (!exit) continue;
    const start = r.startDate?.slice(0, 10);
    const day = start && prevDay(exit) < start ? exit : prevDay(exit);
    const working = (id: string) => input.employed?.(id, day) ?? true;
    const id =
      slotHomeroom(input.slotsOf(r.classId), day, (t) => input.isKorean(t) && working(t)) ??
      input.owner(r.classId, day) ??
      reportWriterOn((input.reportsOf?.(r.classId) ?? []).filter((x) => working(x.teacherId)), day);
    if (id) ids.add(id);
  }
  return [...ids];
}
