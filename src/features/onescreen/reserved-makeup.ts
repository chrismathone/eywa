/**
 * 원스크린의 **보강 예약**(0264a) — 줄 세우기·표식·합침 판정(순수 · Vitest).
 *
 * 원장 2026-10-22(전주율 건): *"보강 예약이 잘 되었나 안되었나 확인할 방법이 없네"* · *"왼쪽에 본 수업만 표시되어 있으니 보강 수업이
 * 배정되어 있는지도 시각적으로 확인 불가능"* · *"표 모드도 동일하게"* · *"사전에 보강 예약할때 '보강 추가'와 동일하게 보고서를 함께 발송할지
 * 따로 발송할지 코드를 맞출것"*.
 *
 * 예약이 서는 두 경우:
 *  · **정규 수업일**(그날 그 반 정규 명단에 있는 학생 — `regularKeys`): '+ 보강 학생 추가'의 합침/분리와 같다.
 *    - 합침(merge · 묻지 않은 옛 예약 포함) = 정규 줄 하나가 '정규+보강'(보고서 1건 · 제목 "(정규+보강)").
 *    - 분리(separate) = 정규 줄은 그대로 + '(보강)' 줄을 따로(보고서 2건). 시수는 어느 쪽이든 그 반 그날 칸 하나에 얹는다(이행 훅).
 *  · 정규 수업일이 아니면(다른 반·다른 요일) 종전대로 '(보강)' 줄(roster.ts 예약 루프) — 표식만 더한다.
 * 표식은 예약·이행 둘 다(이행 = '보강 완료') — 출석을 찍은 뒤 새로고침에 '정규+보강'·'(보강)' 줄이 사라지면 보고서가 정규로만 저장된다.
 */
import { effectiveReportMode, type MakeupReservation } from "@/features/attendance/makeup-reservation";
import { MERGEABLE_RAW } from "./makeup-merge-plan";
import type { OneScreenStudent, ReservedMakeup, Subject } from "./types";

export type ReservedMakeupPlan = {
  /** `학생|반` → 그 줄에 붙일 예약들(시작 시각 순). */
  byKey: Map<string, ReservedMakeup[]>;
  /** 정규 줄을 '정규+보강'으로 세울 `학생|반`. */
  merge: Set<string>;
  /** 정규 줄과 따로 '(보강)' 줄을 세울 (학생 · 반) — 정규 수업일 분리 예약. */
  separate: { studentId: string; classId: string }[];
};

const keyOf = (studentId: string, classId: string) => `${studentId}|${classId}`;

export function planReservedMakeup(
  reservations: readonly MakeupReservation[],
  /** 그날 그 반 **정규 명단**에 선 `학생|반`(수강 유효 · 등원 요일 · 오늘 도는 반). */
  regularKeys: ReadonlySet<string>,
): ReservedMakeupPlan {
  const byKey = new Map<string, ReservedMakeup[]>();
  const merge = new Set<string>();
  const separate: ReservedMakeupPlan["separate"] = [];
  const separateSeen = new Set<string>();
  const sorted = [...reservations].sort((a, b) => a.slotStart.localeCompare(b.slotStart));
  for (const r of sorted) {
    const key = keyOf(r.studentId, r.classId);
    const regular = regularKeys.has(key);
    const mode = regular ? effectiveReportMode(r.reportMode) : "separate";
    const list = byKey.get(key) ?? [];
    list.push({
      start: r.slotStart, end: r.slotEnd, absenceDate: r.absenceDate, mode, done: r.status === "done", date: r.makeupDate,
      ...(r.checkedAt !== undefined ? { checked: !!r.checkedAt } : {}),
    });
    byKey.set(key, list);
    if (!regular) continue;
    if (mode === "merge") merge.add(key);
    else if (!separateSeen.has(key)) {
      separateSeen.add(key);
      separate.push({ studentId: r.studentId, classId: r.classId });
    }
  }
  return { byKey, merge, separate };
}

/**
 * 한 학생 카드에 표식·합침을 입힌다 — **세션 복원 뒤에** 부를 것(세션은 줄마다 `makeup:false`를 늘 저장해 앞서 켠 값을 덮는다).
 *  · 정규 줄(반 있음): 그 반 예약 표식 + 합침이면 '정규+보강'(`makeupByReservation` — 합침 취소 대신 예약을 바꾸게).
 *    🔴 '+ 보강 학생 추가'의 합침과 같은 조건(`MERGEABLE_RAW` — 기록 없음·출석·지각·조퇴)에서만 켠다. 결석·공결 날은 보강이
 *    이행되지도 않고, 결석한 학생의 보고서 제목이 "(정규+보강)"이 되면 거짓이다.
 *  · '(보강)' 줄(반 없음 · 앵커 반): 앵커 반 예약 표식.
 * 나눔 받는 줄(`splitIn`)은 이 반 수강행이 없는 줄이라 건드리지 않는다.
 */
export function applyReservedMakeup(os: OneScreenStudent, plan: ReservedMakeupPlan): void {
  for (const su of os.subjects) {
    if (su.classId) {
      if (su.splitIn) continue;
      const key = keyOf(os.id, su.classId);
      const list = plan.byKey.get(key);
      if (list) su.makeupReserved = list;
      if (plan.merge.has(key) && MERGEABLE_RAW.has(su.attendanceRaw ?? "")) {
        su.makeup = true;
        su.makeupByReservation = true;
      }
    } else if (su.makeup && su.makeupClassId) {
      const list = plan.byKey.get(keyOf(os.id, su.makeupClassId));
      if (list) su.makeupReserved = list;
    }
  }
}

/**
 * 표식을 **'보강 완료'** 로 보일까 — 모두 이행됐고(출결로 시수 반영) **예약 끝 시각이 지났을 때만**(원장 2026-10-27 *"bs2p가 실제 수업시간이
 * 16:20~18:10 일텐데. 권민서a는 그 후에 보강하는거고, 박지호는 그 전에 보강하는거야"*). 수학은 정규 출석 한 번에 이행되므로 정규 수업 뒤
 * 보강은 출석 시각엔 아직 하지 않은 것이다 — 그때까지는 '보강 예약'(툴팁: 시수 미리 반영). 판정만 바꾼다(시수·이행은 종전대로).
 * `now` = KST "YYYY-MM-DDTHH:MM"(`useLessonClock`) · null(시계 전) = 지나지 않은 것으로. 날짜가 없는 옛 값은 `done`만 본다.
 */
export function reservedShownDone(list: readonly ReservedMakeup[], now: string | null): boolean {
  if (list.length === 0 || !list.every((r) => r.done)) return false;
  return list.every((r) => !r.date || (now !== null && `${r.date}T${r.end}` <= now));
}

/**
 * 표식 상태(원장 2026-10-27 *"보강 예약을 누르면 보강을 했다 안했다 체크"* · *"보강 예약 시간 -> 보강 진행 여부 필요 로 라벨도 바뀌게"*).
 *  · `done`       = 선생님이 '보강 했음'으로 확인했다 → '보강 완료 HH:MM~HH:MM'
 *  · `needsCheck` = 확인 전인데 예약 끝 시각이 지났다 → '보강 진행 여부 확인해 주세요'(강조색 · 느린 깜빡임)
 *  · `booked`     = 그 밖 → '보강 예약 HH:MM~HH:MM'
 * 확인 칸(0458a)이 아직 없으면(`checked` 없음) 종전 판정 — 이행 + 끝 시각(`reservedShownDone`).
 */
export type ReservedTagState = "booked" | "needsCheck" | "done";

export function reservedTagState(list: readonly ReservedMakeup[], now: string | null): ReservedTagState {
  if (list.length === 0) return "booked";
  if (list.some((r) => r.checked === undefined)) return reservedShownDone(list, now) ? "done" : "booked";
  if (list.every((r) => r.checked)) return "done";
  const ended = (r: ReservedMakeup) => !r.date || (now !== null && `${r.date}T${r.end}` <= now);
  return list.some((r) => !r.checked && ended(r)) ? "needsCheck" : "booked";
}

/**
 * 이 줄의 보고서는 보강 확인 전이라 못 보낸다(원장 2026-10-27 *"보강체크를 하지 않으면 보고서 발송 비활성화"*) — 보강이 든 줄
 * (정규+보강 · '(보강)' 줄)에 확인 전 예약이 걸렸을 때. 정규 줄의 **분리** 예약은 따로 선 '(보강)' 줄의 몫이라 정규 보고서를 막지 않는다
 * (`makeup`이 꺼진 정규 줄). 확인 칸이 없으면(`checked` 없음) 요구하지 않는다. 서버(`saveAndQueueClassnote`)도 같은 판정.
 */
export function needsMakeupCheck(row: Pick<Subject, "makeup" | "makeupReserved" | "classId">): boolean {
  // 정규 줄(반 있음)은 합침 예약만 — 분리 예약은 따로 선 '(보강)' 줄의 몫이다(서버 `makeupCheckPending`과 같은 축).
  return !!row.makeup && (row.makeupReserved ?? []).some((r) => r.checked === false && (!row.classId || r.mode === "merge"));
}

/** 표식 글자의 시각 — "15:25~16:20"(여러 건이면 앞 것 + "+N" — 강사뷰 영어 화면에도 그대로 읽히게 낱말을 안 붙인다). */
export function reservedTimeText(list: readonly ReservedMakeup[]): string {
  const first = list[0];
  if (!first) return "";
  return list.length > 1 ? `${first.start}~${first.end} +${list.length - 1}` : `${first.start}~${first.end}`;
}

/** 한 학생의 모든 줄에서 예약을 모은다(왼쪽 목록 — 같은 예약이 정규 줄과 '(보강)' 줄에 함께 붙어도 한 번). */
export function studentReservations(os: Pick<OneScreenStudent, "subjects">): ReservedMakeup[] {
  const seen = new Set<string>();
  const out: ReservedMakeup[] = [];
  for (const su of os.subjects) {
    for (const r of su.makeupReserved ?? []) {
      const k = `${r.start}|${r.end}|${r.absenceDate}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(r);
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}
