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

/**
 * 그 주의 **그날만 변경**(`shuttle_ride_exceptions`) 표시 — 사용자 2026-11-04 "탑승 학생 시간표에서도 오늘만 수정".
 * · `skip`  = 평소 타는 아이가 그날 안 탄다(카드에 남기고 취소선)
 * · `moved` = 평소 자리 대신 다른 정류장·회차로 탄다(평소 카드에 남기고 '→ 바뀐 자리')
 * · `dayOnly` = 그날만 이 자리로 탄다(바뀐 쪽 카드에 더한다)
 */
export type RunCardRiderChange = { kind: "skip" } | { kind: "moved"; to: string } | { kind: "dayOnly" };
export type RunCardRider = {
  id: string;
  name: string;
  schoolGrade: string;
  stopName: string;
  stopTime: string | null;
  change?: RunCardRiderChange;
};

/** 그 주의 그날만 변경 한 줄 — 요일은 그 주 날짜에서 접은 값(한 주라 요일 ↔ 날짜가 1:1). */
export type WeekRideChange = {
  day: DayCode;
  studentId: string;
  studentName: string;
  schoolGrade: string;
  ioKind: Direction;
  kind: "skip" | "add";
  /** add만 — 그날 타는 자리. */
  runStopId: string | null;
};

/** 실제로 차에 있는 아이만(안 탐·자리 옮김 제외) — 수업 겹침 판정은 이 명단으로 한다. */
export function ridingRiders(card: RunCard): RunCardRider[] {
  return card.riders.filter((r) => !r.change || r.change.kind === "dayOnly");
}
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

export function buildRunCards(
  runs: readonly ShuttleRun[],
  vehicles: readonly ShuttleVehicle[],
  changes: readonly WeekRideChange[] = [],
): RunCard[] {
  const vById = new Map(vehicles.map((v) => [v.id, v]));
  /** 정류장 칸 → 사람이 읽는 자리("2호차 3회차 · 유진식당 17:40"). */
  const placeOf = new Map<string, string>();
  for (const run of runs) {
    const v = vById.get(run.vehicleId);
    for (const s of run.stops) placeOf.set(s.id, `${v?.name ?? ""} ${runShortTitle(run)} · ${s.stopName}${s.atTime ? ` ${s.atTime.slice(0, 5)}` : ""}`.trim());
  }
  const changeOf = new Map(changes.map((c) => [`${c.day}|${c.studentId}|${c.ioKind}`, c]));
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
        for (const s of stops) {
          for (const r of s.riders) {
            if (r.ioKind !== io) continue;
            const days = r.weekdays.length ? r.weekdays : WEEKDAYS;
            if (!days.includes(day) || riders.some((x) => x.id === r.studentId)) continue;
            const c = changeOf.get(`${day}|${r.studentId}|${io}`);
            const change: RunCardRiderChange | undefined =
              c?.kind === "skip"
                ? { kind: "skip" }
                : c?.kind === "add" && c.runStopId && c.runStopId !== s.id
                  ? { kind: "moved", to: placeOf.get(c.runStopId) ?? "다른 자리" }
                  : undefined;
            riders.push({ id: r.studentId, name: r.studentName, schoolGrade: r.schoolGrade, stopName: s.stopName, stopTime: hm(s.atTime), ...(change ? { change } : {}) });
          }
          // 그날만 이 정류장으로 오는 아이 — 노선 순서대로 그 정류장 자리에 끼운다.
          for (const c of changes) {
            if (c.kind !== "add" || c.runStopId !== s.id || c.day !== day || c.ioKind !== io) continue;
            // 같은 회차 안에서 정류장만 옮긴 아이는 평소 자리('→')와 바뀐 자리(그날만) 두 줄로 선다.
            if (riders.some((x) => x.id === c.studentId && x.change?.kind !== "moved")) continue;
            riders.push({ id: c.studentId, name: c.studentName, schoolGrade: c.schoolGrade, stopName: s.stopName, stopTime: hm(s.atTime), change: { kind: "dayOnly" } });
          }
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
