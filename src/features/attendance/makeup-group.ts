/**
 * 출석부의 **'보강' 임시 반** — 순수 판정(Vitest).
 *
 * 원장 2026-09-02: *"이런 보강 보고서 반에서 한 기록은 필요 없고 그냥 출석부에 '보강' 반을 임시로
 * 만들어서 그 아래에 학생이 있으면 돼. 그날만 출석한것처럼"* + *"어느 반에서 보강한건 모르지 당연히
 * 저렇게 보강하면 / 반 보강이 아니니까"*.
 *
 * 🔴 **어느 반에서 했는지 묻지 않는다.** 이건 반 보강이 아니라 그냥 보강이라 **호스트 반이 없다** —
 *    그래서 출결을 남의 반 출석부에 끼워 넣는 대신, 그 달의 보강만 모아 **가짜 반 한 덩어리**로 세운다.
 * 🔴 **DB에 아무것도 쓰지 않는다**(읽기 시점 파생 — [`derive-from-reports.ts`](./derive-from-reports.ts)와
 *    같은 규약). `attendance_records`는 시수·급여로 흘러가므로 파생값을 써넣으면 돈이 조용히 바뀐다.
 *    그래서 이 덩어리의 칸은 **입력을 안 받는다**(화면이 잠근다).
 * ⚠️ 그래서 시수 합계에도 안 들어간다 — 보강 시수를 세려면 반 있는 보강(`status='makeup'` 행)을 쓴다.
 */

/** 가짜 반 id — 실제 `classes.id`(uuid)와 절대 겹치지 않는 모양이라 저장 경로에 새어도 즉시 튄다. */
export const MAKEUP_GROUP_ID = "__makeup__";
export const MAKEUP_GROUP_NAME = "보강";
/** 칸 잠금 사유 — 화면이 이 문장을 그대로 띄운다(왜 못 고치는지 사람이 알아야 한다). */
export const MAKEUP_GROUP_LOCK =
  "보강 기록은 수업보고서에서 따온 표시입니다 — 여기서는 고칠 수 없습니다(보고서를 고치면 따라 바뀝니다)";

export type MakeupReportRow = {
  studentId: string;
  /** 보강을 한 날(YYYY-MM-DD). */
  date: string;
};

export type MakeupGroupRows = {
  /** 그 달에 보강이 하나라도 있는 학생 id — 입력 순서(호출부가 이름순으로 정렬해 넘긴다)를 지킨다. */
  studentIds: string[];
  /** studentId → date → true. 그 날만 '출석한 것처럼' 보이는 칸. */
  datesByStudent: Record<string, Record<string, true>>;
};

/**
 * 보강 보고서 행들을 '보강 반' 격자로 접는다.
 * ⚠️ 같은 학생이 같은 날 두 과목을 보강해도 **칸은 하나**다(출석부의 축이 학생×날짜라 그게 맞다).
 */
export function foldMakeupRows(rows: readonly MakeupReportRow[]): MakeupGroupRows {
  const datesByStudent: Record<string, Record<string, true>> = {};
  const order: string[] = [];
  for (const r of rows) {
    const date = String(r.date ?? "").slice(0, 10);
    if (!r.studentId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (!datesByStudent[r.studentId]) {
      datesByStudent[r.studentId] = {};
      order.push(r.studentId);
    }
    datesByStudent[r.studentId]![date] = true;
  }
  return { studentIds: order, datesByStudent };
}
