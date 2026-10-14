/**
 * 시간표 X 겹침의 **담임 판정**(순수 · Vitest) — '퇴원 0' 명단과 선생님 색이 쓰는 그 달 담임.
 *
 * 🔴 '퇴원 0'은 "이 선생님 반에서 이 달 센 퇴원이 없다"는 **단정**이다(강사평가에 쓰이는 화면). 그래서
 *    ① 같은 판정(`homeroomTeacherOnDate` — 반·날짜 → 담임 id)으로 **후보도 보고, 퇴원 줄의 반도 본다**
 *       (묶음 이름과만 대조하면 담임 미상·대리 작성자로 묶인 퇴원의 담임이 '퇴원 0'에 서는 모순이 났다 — 적대 리뷰 2026-10-14).
 *    ② 확인할 수 없으면 명단을 내지 않는다(null) — 틀린 0이 빈칸보다 나쁘다.
 * 🔑 담임을 바꾸는 길(폼 `class_update` · 인수인계 · 예약 적용)이 모두 기록을 남기게 된 날 = **2026-08-04**(폼 기록이
 *    이날 생겼다). 그래서 그날 이후 날짜는 '기록 없음 = 그동안 안 바뀜 = 지금 담임'으로 보고(출석부 강사 축과 같은
 *    `homeroomTeacherOnDate` 규약), 그 전 날짜는 그렇게 보지 않는다(9/1 부임자가 5월 담임으로 서는 문제 — 학생 상세가
 *    현재 담임으로 메우지 않는 까닭). ⚠️ 기록 쓰기는 best-effort라 드물게 빠질 수 있다.
 */
import { homeroomTeacherOnDate, type HomeroomPeriod } from "@/features/classes/teacher-as-of";
import type { PastTeacher } from "@/features/students/lib/past-class-teacher";
import { dayLabel, isExcludedExit } from "./exit-overlay-model";

const byKo = (a: string, b: string) => a.localeCompare(b, "ko");

/** 담임을 바꾸는 길이 모두 기록을 남기게 된 날(위 머리 주석). */
export const HOMEROOM_LOG_START = "2026-08-04";

export type OverlayClass = {
  id: string;
  teacherId: string | null;
  /** 반을 연 날(`created_at`의 KST 날짜). */
  openedOn: string;
  /** 종강일 — 없으면 null. */
  closedOn: string | null;
  /** 폐지되지 않았나(`is_active`). 폐지는 날짜를 남기지 않는다. */
  active: boolean;
  special: boolean;
};

export type HomeroomHistory = ReadonlyMap<string, readonly HomeroomPeriod[]>;

/** 그 달 한 줄의 담임 재료 — 사유 원문(제외 판정) · 반 · 그 반 마지막 수업일. */
export type MonthExit = { reasonRaw: string | null; classId: string | null; lastDate: string | null };

/**
 * '퇴원 0' 후보(담임 id) — 그 달 말(또는 종강일)에 정규 반의 담임이었고, **자기 반에서 센 퇴원이 없는** 선생님.
 * null = 가릴 수 없는 달: 담임 기록을 못 읽었거나, 센 퇴원 줄 가운데 **반·날짜·그날 담임을 몰라** 담임을 확인할 수 없는 줄이 있다.
 * (그 줄이 누구 반이었는지 모르면 어떤 선생님에게도 0이라고 말할 수 없다.)
 */
export function zeroCandidateIds(input: {
  window: { from: string; to: string };
  classes: readonly OverlayClass[];
  history: HomeroomHistory;
  historyFailed: boolean;
  exits: readonly MonthExit[];
}): Set<string> | null {
  if (input.historyFailed) return null;
  const byId = new Map(input.classes.map((c) => [c.id, c]));
  const busy = new Set<string>();
  for (const e of input.exits) {
    if (isExcludedExit(e.reasonRaw)) continue;
    const c = e.classId ? byId.get(e.classId) : undefined;
    if (!c || !e.lastDate || e.lastDate < HOMEROOM_LOG_START) return null;
    const h = input.history.get(c.id);
    const t = homeroomTeacherOnDate(h, c.teacherId, e.lastDate);
    if (t) busy.add(t);
    // 기록은 있는데 그 날짜를 덮지 못한다 = 그때 담임을 모른다(이전 담임을 남기기 전 9/22까지의 기록은 바뀐 날부터만 있다).
    // 기록이 아예 없고 지금 담임도 없는 반은 담임이 없던 반이다(후보 쪽과 같은 규약 — 모르는 것이 아니다).
    else if (h?.length) return null;
  }
  const { from, to } = input.window;
  const ids = new Set<string>();
  for (const c of input.classes) {
    // 폐지된 반은 언제 닫혔는지 모른다 — 후보에서 뺀다(빼는 것은 틀린 0을 만들지 않는다).
    if (c.special || (!c.active && !c.closedOn)) continue;
    if (c.openedOn > to || (c.closedOn && c.closedOn < from)) continue;
    const on = c.closedOn && c.closedOn < to ? c.closedOn : to;
    if (on < HOMEROOM_LOG_START) continue;
    const t = homeroomTeacherOnDate(input.history.get(c.id), c.teacherId, on);
    if (t && !busy.has(t)) ids.add(t);
  }
  return ids;
}

/** 오늘 담임(id) — 선생님 색의 기준. 석 달 묶음의 기준 달과 무관하다(넘겨도 같은 색). */
export function currentHomeroomIds(classes: readonly OverlayClass[], history: HomeroomHistory, today: string): string[] {
  const ids = new Set<string>();
  for (const c of classes) {
    if (c.special || !c.active || (c.closedOn && c.closedOn < today) || c.openedOn > today) continue;
    const t = homeroomTeacherOnDate(history.get(c.id), c.teacherId, today);
    if (t) ids.add(t);
  }
  return [...ids];
}

/** 추정한 선생님의 근거 한 줄 — 기록(담임 이력)으로 확인했으면 null. */
export function teacherNoteOf(p: PastTeacher | undefined): string | null {
  if (!p?.inferred) return null;
  if (p.source === "report") return `마지막 보고서 작성자 ${dayLabel(p.date)}`;
  if (p.source === "attendance") return `마지막 출결 입력 ${dayLabel(p.date)}`;
  return "담임 기록 없음 · 반을 연 날 수강이라 지금 담임";
}

/**
 * 선생님 색 — 시트 파스텔 16색을 **오늘 담임 가나다순**으로 하나씩(석 달 묶음을 넘겨도 지금 담임은 같은 색 —
 * 서버가 기준 달이 아니라 오늘로 담임을 가린다). 지금 담임이 아닌 선생님(그때 담임)은 그 뒤에 이어 붙인다.
 * 저장된 시간표 색은 쓰지 않는다 — 수학 담임 10명 중 5명은 색이 없고 3명은 같은 파랑이라 선생님끼리 가를 수
 * 없었다(실측 2026-10-14). 16명을 넘으면 색이 되풀이된다(이름이 늘 함께 적혀 있다).
 */
export const TEACHER_TINTS = [
  "#f4cccc", "#d9ead3", "#cfe2f3", "#fff2cc", "#d9d2e9", "#fce5cd", "#d0e0e3", "#ead1dc",
  "#c9daf8", "#e6b8af", "#b6d7a8", "#a2c4c9", "#ffe599", "#b4a7d6", "#f9cb9c", "#d5a6bd",
] as const;

export function teacherTints(current: readonly string[], others: readonly string[]): Record<string, string> {
  const order = [...new Set(current)].sort(byKo);
  for (const t of [...new Set(others)].sort(byKo)) if (!order.includes(t)) order.push(t);
  return Object.fromEntries(order.map((t, i) => [t, TEACHER_TINTS[i % TEACHER_TINTS.length]!]));
}
