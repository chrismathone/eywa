/**
 * 탑승 학생 시간표의 **배차 카드**(순수 · Vitest) — 사용자 2026-10-29 *"수업처럼 회차별로 노선이 있잖아. 거기 타는 아이들이 있으면
 * 시간표에 따로 보여 줘야 해 — 차량 배차를 따로 빼서"*.
 *
 * 회차 × 요일마다 카드 하나 — 그 요일에 그 회차를 타는 아이(정류장·정류장 시각과 함께). 아무도 안 타는 요일은 카드가 없다.
 * · 시각: 등원 = 첫 정류장 시각 ~ 학원 도착, 하원 = 학원 출발 ~ 마지막 정류장 시각. 칸 줄은 시작 시각으로 놓인다.
 * · 아이 순서 = 노선(정류장) 순서.
 * 🔑 요일을 안 고른 배정은 월~금 전부(편성 화면 규약). 시각을 모르면 "시각 미정"(지어내지 않는다).
 */
import { runShortTitle, type DayCode, type Direction, type ShuttleRun, type ShuttleVehicle } from "./types";

const WEEKDAYS: readonly DayCode[] = ["mon", "tue", "wed", "thu", "fri"];
const hm = (t: string | null | undefined) => (t ? t.slice(0, 5) : null);

export type RunCardRider = { id: string; name: string; schoolGrade: string; stopName: string; stopTime: string | null };
export type RunCard = {
  id: string;
  runId: string;
  vehicleId: string;
  vehicleName: string;
  runName: string;
  direction: Direction;
  day: DayCode;
  /** 칸 줄 시각 — 등원은 첫 정류장, 하원은 학원 출발. 모르면 null. */
  start: string | null;
  end: string | null;
  /** 학원 시각 — 등원 도착 · 하원 출발. */
  academyTime: string | null;
  riders: RunCardRider[];
};

export function buildRunCards(runs: readonly ShuttleRun[], vehicles: readonly ShuttleVehicle[]): RunCard[] {
  const vById = new Map(vehicles.map((v) => [v.id, v]));
  const out: RunCard[] = [];
  for (const run of runs) {
    const v = vById.get(run.vehicleId);
    if (!v) continue;
    const stops = [...run.stops].sort((a, b) => a.sortOrder - b.sortOrder);
    const stopTimes = stops.filter((s) => s.kind === "stop").map((s) => hm(s.atTime)).filter((t): t is string => !!t);
    const all = stops.map((s) => hm(s.atTime)).filter((t): t is string => !!t);
    const arrive = hm(stops.find((s) => s.kind === "arrive")?.atTime);
    const depart = hm(stops.find((s) => s.kind === "depart")?.atTime);
    /**
     * 🔴 **등원/하원은 학생 줄(`rider.ioKind`)로 가른다 — 회차의 `direction`이 아니다**(오늘 등하원 `filterByDirection`과 같은 규약).
     * 한 회차에 둘이 섞일 수 있다(학원 출발 → 정류장 → 학원 도착 순환: 등원 아이를 태우면서 하원 아이를 내려 준다).
     * 회차 성격 쪽은 종전 시각 그대로, 반대쪽은 그 아이들의 정류장 시각과 학원 출발·도착 칸만으로 잡는다(없으면 시각 미정 — 지어내지 않는다).
     * 사용자 2026-10-30 *"등원을 타고 왔는데 다음 차는 하원인데 학생 시간표는 둘 다 등원으로 찍힌다"*.
     */
    for (const io of run.direction === "in" ? (["in", "out"] as const) : (["out", "in"] as const)) {
      const primary = io === run.direction;
      const ioTimes = stops
        .filter((s) => s.riders.some((r) => r.ioKind === io))
        .map((s) => hm(s.atTime))
        .filter((t): t is string => !!t);
      const academyTime = io === "in" ? (arrive ?? (primary ? (all.at(-1) ?? null) : null)) : (depart ?? (primary ? (all[0] ?? null) : null));
      const start = io === "in" ? (primary ? (stopTimes[0] ?? all[0] ?? null) : (ioTimes[0] ?? null)) : academyTime;
      const end = io === "in" ? academyTime : primary ? (stopTimes.at(-1) ?? all.at(-1) ?? null) : (ioTimes.at(-1) ?? null);
      for (const day of WEEKDAYS) {
        const riders: RunCardRider[] = [];
        for (const s of stops)
          for (const r of s.riders) {
            if (r.ioKind !== io) continue;
            const days = r.weekdays.length ? r.weekdays : WEEKDAYS;
            if (!days.includes(day) || riders.some((x) => x.id === r.studentId)) continue;
            riders.push({ id: r.studentId, name: r.studentName, schoolGrade: r.schoolGrade, stopName: s.stopName, stopTime: hm(s.atTime) });
          }
        if (riders.length === 0) continue;
        out.push({
          // 회차 성격 쪽은 종전 id 그대로(확인한 경고 열쇠가 이어진다).
          id: primary ? `run:${run.id}:${day}` : `run:${run.id}:${io}:${day}`,
          runId: run.id,
          vehicleId: v.id,
          vehicleName: v.name,
          runName: runShortTitle(run),
          direction: io,
          day,
          start,
          end,
          academyTime,
          riders,
        });
      }
    }
  }
  return out;
}
