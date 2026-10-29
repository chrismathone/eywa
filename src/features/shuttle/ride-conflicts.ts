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
