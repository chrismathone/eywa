/**
 * 시간표 X 겹침의 **퇴원율 판정**(순수 · Vitest) — 강사평가 퇴원율이 낸 값을 **읽기만** 한다. 2026-11-11부터 화면에 보이는 담당은
 * `exit-homeroom.ts`(그만둘 때 반의 담임)이고, 여기 판정은 '수강종료는 세지 않음'·'퇴원 0' 선생님에만 쓴다.
 *
 * 🔴 원장 2026-10-14 *"모든 데이터가 일치해야함. 이쪽만 다른 출력이 되면 안됨"* — 겹침은 담당을 새로 판정하지 않는다.
 *    서버가 강사평가 퇴원율(`buildChurnModel`, 그날 담임 + 교시 담당 · 지난달 절반 이상 맡은 학생)을 달마다 돌려
 *    `ChurnView`로 넘기고, 여기서는 줄 → 그 퇴원을 퇴원율에 넣은 선생님, 달 → 퇴원율 0인 선생님을 꺼낸다.
 *    (전에는 학생 상세 '지난 수업'의 추정 — 보고서 작성자·출결 — 을 썼다. 강사평가와 다른 선생님이 붙었다.)
 */
import { exitDayOf, type EndedRowRef, type ExitClassRef } from "./reason-key";

const byKo = (a: string, b: string) => a.localeCompare(b, "ko");

/**
 * 줄의 퇴원을 퇴원율에서 찾을 달 — 퇴원율이 그만둔 날로 보는 날(종료일과 반이 닫힌 날 중 이른 날 · 하루도 안 다닌 줄은 뺀다 —
 * `buildStudentTracking`과 같은 규칙) 중 마지막, 정규 반만(특강·보강 반은 퇴원율도 안 센다). 모르면 줄의 달.
 * 🔴 퇴원하며 함께 닫힌 다음 달 반(시작일 = 종료일)으로 달을 잡으면 퇴원율이 센 달과 어긋나 선생님이 빠졌다(적대 리뷰 2026-10-14).
 */
export function churnMonthOf(ended: readonly EndedRowRef[], date: string, classOf: (classId: string) => ExitClassRef | undefined): string {
  const days = ended.flatMap((r) => {
    const c = classOf(r.classId);
    const day = c?.regular ? exitDayOf(r, c) : null;
    return day ? [day] : [];
  });
  return (days.sort().at(-1) ?? date).slice(0, 7);
}

/** X가 '함께 끝난 수강'을 찾는 폭 — 퇴원일보다 넉 달 앞까지(수강종료로 남아 있다가 늦게 퇴원 처리된 학생). 재료는 그보다 넓게 읽는다. */
export const OVERLAY_LOOKBACK_DAYS = 120;

/**
 * 한 달 퇴원율 결과(`YYYY-MM` → …). 퇴원율은 **수강이 끝난 달**로 세므로 줄의 달(퇴원일)과 어긋날 수 있다 — 달은 물어볼 때
 * 계산한다(`server/exit-teacher-judge.ts`). 🔴 어느 달을 기준으로 열어도 같은 줄은 같은 선생님이어야 한다(적대 리뷰 2026-10-14)
 * → 재료의 끝은 서버가 이번 달 말일로 고정한다.
 */
export type ChurnMonth = {
  /** 선생님 id → 그 달 퇴원율 분자(학생 · 그 선생님에게서 끊은 과목). */
  detail: ReadonlyMap<string, readonly { studentId: string; subjects: readonly string[] }[]>;
  /** 분모가 있는 선생님 id → 분모 학생을 가르친 과목. */
  eligible: ReadonlyMap<string, ReadonlySet<string>>;
};
export type ChurnView = { get(month: string): ChurnMonth | undefined };

/** 이 학생의 이 과목 퇴원을 `month` 퇴원율에 넣은 선생님 id(가나다는 이름을 안 뒤에). 없으면 빈 배열 = 선생님 미반영. */
export function churnTeachersOf(view: ChurnView, studentId: string, subject: string, month: string): string[] {
  const m = view.get(month);
  if (!m) return [];
  const ids: string[] = [];
  for (const [teacherId, rows] of m.detail) {
    if (rows.some((r) => r.studentId === studentId && r.subjects.includes(subject))) ids.push(teacherId);
  }
  return ids;
}

/** 그 달 이 과목 퇴원율이 0인 선생님 id — 분모(이 과목 학생)가 있고 이 과목 분자가 없다. */
export function churnZeroIds(view: ChurnView, subject: string, month: string): string[] {
  const m = view.get(month);
  if (!m) return [];
  const ids: string[] = [];
  for (const [teacherId, subjects] of m.eligible) {
    if (!subjects.has(subject)) continue;
    if ((m.detail.get(teacherId) ?? []).some((r) => r.subjects.includes(subject))) continue;
    ids.push(teacherId);
  }
  return ids;
}

/** 시간표 색을 고르는 반 한 줄. */
export type OverlayClass = { id: string; teacherId: string | null; active: boolean; closedOn: string | null; special: boolean };

/** 오늘 담임(id) — 선생님 색의 기준. `owner` = 강사평가와 같은 그날 담임 판정. 석 달 묶음의 기준 달과 무관하다. */
export function currentHomeroomIds<C extends OverlayClass>(classes: readonly C[], owner: (c: C, day: string) => string | null, today: string): string[] {
  const ids = new Set<string>();
  for (const c of classes) {
    if (c.special || !c.active || (c.closedOn && c.closedOn < today)) continue;
    const t = owner(c, today);
    if (t) ids.add(t);
  }
  return [...ids];
}

/**
 * 선생님 색 — 시트 파스텔 16색을 **오늘 담임 가나다순**으로 하나씩(석 달 묶음을 넘겨도 지금 담임은 같은 색).
 * 지금 담임이 아닌 선생님(교시 담당·지난 담임)은 그 뒤에 이어 붙인다.
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
