/**
 * **오늘 이미 끝난 교시** 판정 — 출결 재촉 신호의 분모(순수·Vitest).
 *
 * 왜 필요한가(운영실 검토 2026-09-09, 세 검토자 3/3 1순위): 지금 운영실은 **어제** 미기록 반만 말한다.
 * 오늘 것은 헤더의 `처리 중 N/M` 합계 하나뿐이라 **어느 반·누구를 재촉할지** 알 수 없었다.
 *
 * 🔴 **아직 안 지난 교시를 세면 130반 규모의 거짓 경보가 된다** — 그래서 분모는 "오늘 배정된 교시"가 아니라
 *    **"오늘 이미 끝난 교시"**다. 수업 중에는 강사가 찍는 중일 수 있어 재촉이 아니라 소음이다.
 * ⚠️ 경계는 **종료 시각이 지났으면 곧바로**다(유예 0분). "끝나고 몇 분 뒤부터 재촉할지"는 업무 기준이라
 *    원장이 정할 값이고, 정해지면 이 파일의 판정 한 곳만 바꾼다(화면·쿼리는 안 건드린다).
 * ⚠️ 판정 단위는 **반**이다(그 반의 교시 중 하나라도 끝났으면 후보) — 출결 기록이 (학생,반,날짜)로 접히는
 *    기존 미기록 판정과 같은 grain을 쓰기 위해서다. 그래서 하루 두 교시 중 **앞 교시만 찍은 반**은
 *    잡히지 않는다(명단이 이미 한 번씩 채워졌다) — 어제 미기록 신호가 원래 갖고 있던 한계와 같다.
 */

export type PeriodSlotTime = {
  classId: string;
  /** `HH:MM` 또는 `HH:MM:SS`. */
  startTime: string | null;
  endTime: string | null;
};

/** `HH:MM(:SS)` → 자정부터의 분. 못 읽으면 null(추측하지 않는다). */
export function hhmmToMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const [hourText, minuteText] = value.slice(0, 5).split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  const total = hour * 60 + minute;
  return total >= 0 && total <= 24 * 60 ? total : null;
}

/**
 * 지금 기준으로 **교시가 하나라도 끝난 반**.
 * @param nowMinutes KST 자정부터의 분(`kstMinutesOfDay()`).
 * ⚠️ 종료 시각을 못 읽으면 **시작 시각으로 폴백**한다 — 시각을 통째로 모르는 슬롯은 후보에서 빠진다
 *    (모르는 것을 "끝났다"고 단정하지 않는다).
 */
export function classesWithFinishedPeriod(
  slots: readonly PeriodSlotTime[],
  nowMinutes: number,
): Set<string> {
  const finished = new Set<string>();
  for (const slot of slots) {
    const end = hhmmToMinutes(slot.endTime) ?? hhmmToMinutes(slot.startTime);
    if (end === null) continue;
    if (end <= nowMinutes) finished.add(slot.classId);
  }
  return finished;
}
