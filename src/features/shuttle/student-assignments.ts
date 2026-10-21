/**
 * 노선 편성 **학생 풀에서 "이 아이가 어디에 배정됐나"**(순수 · Vitest) — 사용자 2026-10-21 *"배정된 아이를 클릭했을 때
 * 어디에 배정됐는지 바로 수정할 수 있게"*.
 *
 * 🔑 보드가 이미 실은 회차(그 시즌 전부)에서 접는다 — 추가 조회 0.
 * 🔑 한 아이가 여러 회차를 탄다(등원·하원, 요일별로 다른 차) — 배정마다 한 줄.
 * 🔑 순서 = 호차 편성 순서 → 회차 첫 시각 → 회차 번호. 보드의 회차 목록과 같은 감각으로 읽힌다.
 */
import { compactWeekdays } from "./roster";
import { firstTime } from "./today/today-board";
import { runShortTitle, type Direction, type ShuttleRider, type ShuttleRun, type ShuttleVehicle } from "./types";

export type StudentAssignment = {
  rider: ShuttleRider;
  runId: string;
  vehicleName: string;
  /** "1회차" 또는 회차 별칭. */
  runName: string;
  /** 회차 첫 시각("14:30") — 없으면 빈 문자열. */
  runTime: string;
  direction: Direction;
  runStopId: string;
  stopName: string;
  /** 그 정류장 시각("14:50") — 없으면 null. */
  stopTime: string | null;
  /** "평일" · "월수금" 같은 압축 요일. */
  daysLabel: string;
  /** 같은 회차의 정류장 — 정류장 옮기기 선택지(노선 순서). */
  runStops: { id: string; name: string; time: string | null }[];
};

export function studentAssignments(
  runs: readonly ShuttleRun[],
  vehicles: readonly ShuttleVehicle[],
): Map<string, StudentAssignment[]> {
  const order = new Map(vehicles.map((v, i) => [v.id, i]));
  const nameOf = new Map(vehicles.map((v) => [v.id, v.name]));
  const sortedRuns = [...runs].sort((a, b) => {
    const oa = order.get(a.vehicleId) ?? Infinity;
    const ob = order.get(b.vehicleId) ?? Infinity;
    if (oa !== ob) return oa - ob;
    const ta = firstTime(a);
    const tb = firstTime(b);
    if (ta !== tb) return !ta ? 1 : !tb ? -1 : ta < tb ? -1 : 1;
    return a.runNo - b.runNo;
  });

  const out = new Map<string, StudentAssignment[]>();
  for (const run of sortedRuns) {
    const stops = [...run.stops].sort((a, b) => a.sortOrder - b.sortOrder);
    const runStops = stops
      .filter((s) => s.kind === "stop")
      .map((s) => ({ id: s.id, name: s.stopName, time: s.atTime?.slice(0, 5) ?? null }));
    for (const stop of stops) {
      for (const rider of stop.riders) {
        const list = out.get(rider.studentId) ?? [];
        list.push({
          rider,
          runId: run.id,
          vehicleName: nameOf.get(run.vehicleId) ?? "(편성 없는 차)",
          runName: runShortTitle(run),
          runTime: firstTime(run),
          direction: rider.ioKind,
          runStopId: stop.id,
          stopName: stop.stopName,
          stopTime: stop.atTime?.slice(0, 5) ?? null,
          daysLabel: compactWeekdays(rider.weekdays),
          runStops,
        });
        out.set(rider.studentId, list);
      }
    }
  }
  return out;
}
