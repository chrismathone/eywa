/**
 * 강사 근태 — 그 달 **지각·결근·조퇴 횟수**(원장 결정 9 · 2026-10-15 *"추천으로 진행. 직원마다 일부 출근시간 퇴근시간 다른 직원이 있음"*). 순수 함수.
 *
 * - 원장이 그 달 횟수를 직접 넣었으면 그 값(계획서 '원장 월 입력').
 * - 아니면 출퇴근 기록(0365a — 연동 PC가 메이크에듀에서 시각만 가져온다)을 그날 기준(`punctuality-basis.ts`)과 견준다.
 *   메이크에듀엔 지각 표시가 없어서 aywa가 판정한다: 기준 출근 시각보다 늦게 찍으면 지각 · 기준 퇴근 시각보다 일찍 찍으면 조퇴(퇴근을 안 찍었으면 안 셈) ·
 *   기준이 있는 날 출근 기록이 없으면 결근 — 단 그날 직접 쓴 출결·보고서가 있으면 출근으로 본다.
 *   🔴 결재된 휴가(연차·반차·반반차)가 걸친 날은 '제외한 날'로 세지 않는다 — 법정 휴가로 감점하지 않는다(계획서 결정 9). 휴원일은 판정하지 않는다.
 *   다른 출처(키오스크·직접 입력)가 지각·결근·휴가를 적어 왔으면 그 표시가 이긴다.
 * - `checkIns`·`checkOuts` = 그 달 출근·퇴근 시각이 찍힌 날 수(같은 날 여러 줄은 하루) — 근거 화면이 기록 횟수로 보인다.
 * - 수치(raw) = 지각 × 지각 가중 + 결근 × 결근 가중 + 조퇴 × 조퇴 가중(학원 설정). 그 달 그 직원의 출퇴근 기록이 하나도 없으면 자료 없음
 *   (가져오기 전 달이 결근으로 채워지지 않게).
 */
import type { PunctualityOptions } from "../evaluation/options";
import { daysBetween, kstDateOf } from "./dates";
import { kstMinutesOf as kstMinutes, minutesOf, type DayBasis, type DayEvidence } from "./punctuality-basis";
import type { PunctualityRow, SnapshotLeave, SnapshotStaffDay } from "./source-types";
import type { PeriodWindow } from "./types";

export type PunctualityResult = {
  raw: number | null; late: number; absent: number; early: number; excused: number; days: number; checkIns: number; checkOuts: number;
  manual: boolean; detail: PunctualityRow[];
};

export function punctualityOf(input: {
  days: readonly SnapshotStaffDay[]; leaves: readonly SnapshotLeave[]; holidays: ReadonlySet<string>;
  teacherId: string; w: PeriodWindow; options: PunctualityOptions; manual: number | null;
  basisOn: (day: string) => DayBasis | null; evidenceOn: (day: string, basis: DayBasis) => DayEvidence;
  /** 메이크에듀 출퇴근의 가장 늦은 날짜 — 그날과 그 뒤는 아직 다 받지 않았을 수 있어 결근으로 세지 않는다(없으면 제한 없음). */
  latest?: string | null;
}): PunctualityResult {
  const { w, teacherId, options } = input;
  const leaveOn = (day: string) => input.leaves.some((l) => l.user_id === teacherId && l.start_date <= day && l.end_date >= day);
  // 같은 날 줄이 여럿이면(출처가 둘) 가장 이른 출근 · 가장 늦은 퇴근 · 가장 무거운 표시(결근 > 지각 > 그 밖).
  const weight = (s: SnapshotStaffDay["status"]) => (s === "absent" ? 3 : s === "late" ? 2 : s === "leave" || s === "off" ? 1 : 0);
  const byDay = new Map<string, SnapshotStaffDay>();
  for (const d of input.days) {
    if (d.user_id !== teacherId || d.work_date < w.start || d.work_date > w.end) continue;
    const was = byDay.get(d.work_date);
    if (!was) { byDay.set(d.work_date, d); continue; }
    const pick = <T,>(a: T | null | undefined, b: T | null | undefined, first: (x: T, y: T) => boolean) => (a == null ? b ?? null : b == null ? a : first(a, b) ? a : b);
    byDay.set(d.work_date, {
      ...(weight(d.status) > weight(was.status) ? d : was),
      check_in_at: pick(was.check_in_at, d.check_in_at, (a, b) => Date.parse(a) <= Date.parse(b)),
      check_out_at: pick(was.check_out_at, d.check_out_at, (a, b) => Date.parse(a) >= Date.parse(b)),
    });
  }
  const detail: PunctualityRow[] = [];
  for (const day of byDay.size ? daysBetween(w.start, w.end) : []) {
    const rec = byDay.get(day);
    // 휴원일은 나올 날이 아니다(시간표엔 수업이 서 있어도) — 판정하지 않는다. 결재된 휴가는 '제외한 날'로 남긴다(그날 수업이 있었다).
    if (input.holidays.has(day) || (rec && (rec.status === "leave" || rec.status === "off"))) continue;
    const basis = input.basisOn(day);
    if (!basis && !(rec && (rec.status === "late" || rec.status === "absent"))) continue;
    const excuse = leaveOn(day) ? "결재된 휴가" : null;
    const base = { day, checkIn: rec?.check_in_at ?? null, checkOut: rec?.check_out_at ?? null, basis: basis?.basis ?? null };
    // 출근도 퇴근도 안 찍은 날만 결근 후보 — 퇴근만 찍은 날 · 시각 없이 '출근'이라 적힌 날은 와 있던 날이다(늦었는지는 모른다).
    const noTag = !rec || (!rec.check_in_at && !rec.check_out_at && rec.status !== "present");
    const evidence = basis ? input.evidenceOn(day, basis) : { recorded: false, firstAt: null };
    if (rec?.status === "absent" || (noTag && rec?.status !== "late")) {
      if (rec?.status !== "absent" && evidence.recorded) detail.push({ ...base, status: "recorded", expected: basis?.start ?? null, minutes: null, counted: false, excuse: "그날 출결·보고서 기록" });
      else if (rec?.status === "absent" || !input.latest || day < input.latest) detail.push({ ...base, status: "absent", expected: basis?.start ?? null, minutes: null, counted: !excuse, excuse });
      continue;
    }
    if (rec?.status === "late") detail.push({ ...base, status: "late", expected: basis?.start ?? null, minutes: rec.late_minutes, counted: !excuse, excuse });
    else if (basis && rec?.check_in_at && kstDateOf(rec.check_in_at) === day) {
      // 도착 = 출근 태그와 그날 근무 시간대의 가장 이른 본인 출결·보고서 중 이른 쪽.
      const first = evidence.firstAt;
      const arrival = first && Date.parse(first) < Date.parse(rec.check_in_at) ? first : rec.check_in_at;
      const late = kstMinutes(arrival) - minutesOf(basis.start);
      if (late > options.graceMinutes) detail.push({ ...base, status: "late", expected: basis.start, minutes: late, counted: !excuse, excuse });
    }
    // 아직 다 받지 않은 날은 조퇴도 재지 않는다(그날 마지막 퇴근 태그가 다음 동기화에 올 수 있다).
    if (basis?.end && rec?.check_out_at && kstDateOf(rec.check_out_at) === day && (!input.latest || day < input.latest)) {
      const early = minutesOf(basis.end) - kstMinutes(rec.check_out_at);
      if (early > options.graceMinutes) detail.push({ ...base, status: "early", expected: basis.end, minutes: early, counted: !excuse, excuse });
    }
  }
  const count = (s: PunctualityRow["status"]) => detail.filter((r) => r.counted && r.status === s).length;
  const late = count("late"), absent = count("absent"), early = count("early");
  const excused = new Set(detail.filter((r) => !r.counted && r.status !== "recorded").map((r) => r.day)).size;
  const recs = [...byDay.values()];
  const result = {
    late, absent, early, excused, days: byDay.size, detail,
    checkIns: recs.filter((r) => r.check_in_at).length, checkOuts: recs.filter((r) => r.check_out_at).length,
  };
  if (input.manual !== null) return { raw: input.manual, manual: true, ...result };
  const raw = byDay.size ? Math.round((late * options.late + absent * options.absent + early * options.early) * 10) / 10 : null;
  return { raw, manual: false, ...result };
}
