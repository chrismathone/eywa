/**
 * **성적 확인 뷰의 열 모델** — 원장 2026-09-23: *"이 창은 기입창이고 확인하는 뷰페이지를 추가로"*.
 *
 * 입력 격자는 시험 **한 칸**을 세로로 적는 화면이고, 이 뷰는 그 학기의 **모든 시험을 가로로** 놓고
 * 사람이 눈으로 훑는 화면이다(읽기 전용). 그래서 열이 데이터에서 나온다:
 *  · 한 학기에 한 번인 시험(중간·기말·듣기평가·내신) = 열 하나.
 *  · 달마다 치는 월말평가 = **점수가 있는 달마다** 열 하나(0288a 월 축).
 * 🔴 **빈 열은 안 세운다** — 수학 2학기에 월말평가 6칸을 늘 세우면 아직 안 친 달까지 빈 열로 깔려
 *    표가 가로로 길어지고 "안 적은 것"과 "안 친 것"이 섞인다.
 * 🔴 과목은 **합쳐서 본다**(원장 2026-09-22: *"전체데이터 볼 때는 영어 하나로"*) — EiE/인재원 트랙은
 *    입력할 반을 고르는 축일 뿐이라 여기선 나누지 않는다.
 */

import { examSlotLabel, examSlotsFor, slotUsesMonth, type ExamSlotKey } from "./exam-slots";

/** 확인 뷰의 열 하나 — 시험 칸(+월). `key`는 셀 맵의 키이자 React key다. */
export type OverviewColumn = {
  key: string;
  slot: ExamSlotKey;
  /** 달마다 치는 시험만 1~12, 나머지는 0. */
  month: number;
  label: string;
  /** 그 과목에서 부르는 시험 이름(영어 월말 = Monthly Test) — 달 열 머리 위 작은 글자. */
  exam: string;
};

/** 한 칸의 값 — 점수가 없을 수도 있다('시험없음'으로 눌러 둔 칸). */
export type OverviewCell = {
  score: number | null;
  maxScore: number | null;
  noExam: boolean;
};

export type OverviewRow = {
  studentId: string;
  name: string;
  school: string | null;
  grade: string | null;
  /** 이 학기에 그 과목으로 들은 반(둘 이상이면 모두) — 사람이 "누구 반 학생인지"로 찾는다. */
  classNames: string[];
  cells: Record<string, OverviewCell>;
  /**
   * 제도상 **안 치는 시험 칸**(초등·중1 2학기의 중간·기말). 입력 격자는 그런 학생을 줄에서 빼지만
   * 확인 뷰는 다른 시험 때문에 줄이 남으므로, 그 칸만 `—`(미기입)와 **다르게** 그린다.
   * 🔴 안 그러면 초등이 절반인 반에서 거짓 공백 수백 칸이 "안 적음"으로 읽힌다([`applies.ts`](./applies.ts)).
   */
  skipKeys: string[];
  /** 적힌 점수의 평균(백분율 환산, 소수 1자리). 적은 칸이 없으면 null. */
  avgPct: number | null;
};

export function overviewColumnKey(slot: ExamSlotKey, month: number): string {
  return slotUsesMonth(slot) ? `${slot}:${month}` : slot;
}

/**
 * 그 과목의 시험 순서대로 열을 세운다 — **데이터에 있는 칸만**.
 * @param subjectKey 학원설정 과목 키(열 순서의 근거는 `examSlotsFor`)
 * @param present 실제로 값이 있는 `(slot, month)` 쌍
 */
export function buildOverviewColumns(
  subjectKey: string,
  present: readonly { slot: ExamSlotKey; month: number }[],
): OverviewColumn[] {
  const order = examSlotsFor(subjectKey);
  const seen = new Map<string, { slot: ExamSlotKey; month: number }>();
  for (const p of present) {
    if (!order.includes(p.slot)) continue; // 과목이 바뀌어 남은 옛 칸은 세우지 않는다
    const month = slotUsesMonth(p.slot) ? p.month : 0;
    seen.set(overviewColumnKey(p.slot, month), { slot: p.slot, month });
  }
  return [...seen.values()]
    .sort((a, b) => {
      const d = order.indexOf(a.slot) - order.indexOf(b.slot);
      if (d !== 0) return d;
      // 월은 **학기 순서**로 — 2학기는 9,10,11,12 다음이 이듬해 1,2월이다(숫자 순으로 세우면 1월이 맨 앞).
      return termMonthOrder(a.month) - termMonthOrder(b.month);
    })
    .map(({ slot, month }) => ({
      key: overviewColumnKey(slot, month),
      slot,
      month,
      label: slotUsesMonth(slot) && month > 0 ? `${month}월` : examSlotLabel(subjectKey, slot),
      exam: examSlotLabel(subjectKey, slot),
    }));
}

/** 1·2월은 학기의 **끝**이다(2학기가 이듬해 2월까지) — 그대로 정렬하면 맨 앞으로 온다. */
function termMonthOrder(month: number): number {
  return month <= 2 ? month + 12 : month;
}

/** 백분율 평균 — 만점이 칸마다 다를 수 있어 점수가 아니라 **비율**로 센다. */
export function overviewAvgPct(cells: readonly OverviewCell[]): number | null {
  const usable = cells.filter((c) => c.score != null && (c.maxScore ?? 0) > 0);
  if (usable.length === 0) return null;
  const sum = usable.reduce((acc, c) => acc + (c.score! / c.maxScore!) * 100, 0);
  return Math.round((sum / usable.length) * 10) / 10;
}
