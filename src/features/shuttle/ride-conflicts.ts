/**
 * 탑승 학생 시간표의 **수업 ↔ 배차 겹침**(순수 · Vitest) — 사용자 2026-10-29 *"수업 시간이랑 차량 타는 시간이 동일 인물이 겹치는 일은
 * 없을 거야(차 타고 오고 차 타고 가니까). 근데 수업 시간이 바뀌거나 보강이 생기면 겹치는 경우가 있겠지 — 반짝이면서 '수정된 내용이
 * 있습니다'라고 관리자가 명확하게 인지하게"*.
 *
 * 그 학생이 차에 있는 시간 = 등원: 자기 정류장 시각 ~ 학원 도착 · 하원: 학원 출발 ~ 자기 정류장 시각(정류장 시각을 모르면 회차 시작·끝).
 * 같은 요일 그 학생의 수업(보강 포함)과 이 구간이 **겹치면**(끝이 맞닿는 건 겹침 아님) 두 카드 모두에 적는다.
 * 🔑 알리기만 한다. 시각을 모르는 쪽은 판정하지 않는다(지어내지 않는다).
 */
import type { RunCard } from "./run-cards";

type ClassLike = { id: string; day: string; start: string; end: string; className: string; makeup?: boolean; students: { id: string; name: string }[] };

const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));

export type RideConflict = {
  studentId: string;
  name: string;
  classId: string;
  runCardId: string;
  /** 사람이 읽는 한 줄 — "박도윤: 보강 수학 18:00~19:50 ↔ 하원 2호차 2회차 19:00~19:10". */
  text: string;
};

export function findRideConflicts(classes: readonly ClassLike[], runCards: readonly RunCard[]): RideConflict[] {
  const out: RideConflict[] = [];
  for (const r of runCards) {
    for (const s of r.riders) {
      const from = r.direction === "in" ? (s.stopTime ?? r.start) : r.academyTime;
      const to = r.direction === "in" ? r.academyTime : (s.stopTime ?? r.end);
      if (!from || !to) continue;
      const a = toMin(from);
      const b = toMin(to);
      for (const c of classes) {
        if (c.day !== r.day || !c.students.some((x) => x.id === s.id)) continue;
        if (!(toMin(c.start) < b && a < toMin(c.end))) continue;
        out.push({
          studentId: s.id,
          name: s.name,
          classId: c.id,
          runCardId: r.id,
          text: `${s.name}: ${c.makeup ? "보강 " : ""}${c.className} ${c.start}~${c.end} ↔ ${r.direction === "in" ? "등원" : "하원"} ${r.vehicleName} ${r.runName} ${from}~${to}`,
        });
      }
    }
  }
  return out;
}

/**
 * **등원보다 먼저 시작하는 수업**(사용자 2026-10-30 *"등원보다 수업이 먼저일 경우도 말이 안 되잖아 — 이것도 경고로"*).
 * 그 학생이 그날 타는 등원 차의 **학원 도착 시각보다 수업 시작이 이르면** 잡는다(같은 시각은 정상).
 * 🔑 바뀐 수업·보강만이 아니라 **모든 수업**을 본다 — 처음부터 시간표가 차와 안 맞는 경우다.
 * 학원 도착 시각을 모르면 판정하지 않는다.
 */
export function findClassBeforeArrival(classes: readonly ClassLike[], runCards: readonly RunCard[]): RideConflict[] {
  const out: RideConflict[] = [];
  for (const r of runCards) {
    if (r.direction !== "in" || !r.academyTime) continue;
    const arrive = toMin(r.academyTime);
    for (const s of r.riders) {
      for (const c of classes) {
        if (c.day !== r.day || !c.students.some((x) => x.id === s.id)) continue;
        if (!(toMin(c.start) < arrive)) continue;
        out.push({
          studentId: s.id,
          name: s.name,
          classId: c.id,
          runCardId: r.id,
          text: `${s.name}: ${c.makeup ? "보강 " : ""}${c.className} ${c.start} 시작 — 등원 ${r.vehicleName} ${r.runName} 학원 도착 ${r.academyTime}보다 먼저`,
        });
      }
    }
  }
  return out;
}

/**
 * **하원 뒤에 남은 수업**(사용자 2026-10-30 *"아이가 하원을 하는데 뒤에 수업이 있을 때 알람"*).
 * 그 학생이 그날 타는 하원 차의 **학원 출발 시각보다 수업이 늦게 끝나면**(출발 뒤에 시작하는 수업 포함) 잡는다(같은 시각에 끝나면 정상).
 * 🔑 모든 수업을 본다. 학원 출발 시각을 모르면 판정하지 않는다.
 */
export function findClassAfterDeparture(classes: readonly ClassLike[], runCards: readonly RunCard[]): RideConflict[] {
  const out: RideConflict[] = [];
  for (const r of runCards) {
    if (r.direction !== "out" || !r.academyTime) continue;
    const depart = toMin(r.academyTime);
    for (const s of r.riders) {
      for (const c of classes) {
        if (c.day !== r.day || !c.students.some((x) => x.id === s.id)) continue;
        if (!(toMin(c.end) > depart)) continue;
        out.push({
          studentId: s.id,
          name: s.name,
          classId: c.id,
          runCardId: r.id,
          text: `${s.name}: ${c.makeup ? "보강 " : ""}${c.className} ${c.start}~${c.end} — 하원 ${r.vehicleName} ${r.runName} 학원 출발 ${r.academyTime} 뒤에도 수업`,
        });
      }
    }
  }
  return out;
}
