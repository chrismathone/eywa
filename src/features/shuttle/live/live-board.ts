/**
 * 셔틀 **관제**(운행 현황) 집계 — 순수 함수(IO 없음, Vitest). 화면은 그리기만 한다.
 *
 * 원장(2026-09-02): *"동승하는 선생님이 학생들이 해당 버스에 탔는지 안 탔는지 쉽게 체크하며 **그걸
 * 관리자**"* 가 본다. 오늘 등하원 화면(`/shuttle/today`)은 **찍는 화면**이라 회차를 펼쳐 한 줄씩
 * 다루는 모양인데, 관리자는 반대로 **차 전체를 한눈에** 보고 이상한 것만 짚어야 한다.
 *
 * 🔑 **묶음·정렬·진행은 새로 세지 않는다** — `today-board`의 것을 그대로 받는다(같은 숫자가 두 화면에서
 *    달라지면 어느 쪽이 진실인지 알 수 없다). 이 모듈이 더하는 것은 **운행 상태(0243a)를 겹치는 일**뿐이다.
 * 🔑 **차·회차 순서도 오늘 화면과 같다**(차 순 → 시각 순). 관제라고 경보를 위로 올리고 싶어지지만,
 *    그러면 볼 때마다 줄 순서가 바뀌어 "아까 그 차가 어디 갔지"가 된다. 경보는 **자리를 옮기지 않고
 *    표식과 상단 요약**으로 알린다.
 */
import { countProgress, firstTime, sumProgress, type Progress, type VehicleGroup } from "../today/today-board";
import { runAlert, tripState, type RunAlert, type TripState } from "../today/trip-state";
import type { RideRow } from "../roster";
import type { ShuttleRun, ShuttleTrip } from "../types";

export type LiveRun = {
  run: ShuttleRun;
  rows: RideRow[];
  progress: Progress;
  /** 0243a 기록. 아직 출발 안 했거나 표가 없으면 null. */
  trip: ShuttleTrip | null;
  state: TripState;
  alert: RunAlert;
};

export type LiveVehicle = {
  vehicleId: string;
  vehicleName: string;
  driverName: string | null;
  driverPhone: string | null;
  runs: LiveRun[];
  progress: Progress;
  /** 지금 도는 회차 수 — 차 머리에 "운행 중"을 띄우는 근거. */
  running: number;
  /** 그 차에서 사람이 봐야 할 회차 수. */
  alerts: number;
};

export type LiveSummary = {
  /** 오늘 도는 회차가 하나라도 있는 차 수(편성 전체가 아니라 **오늘** 기준). */
  vehicles: number;
  ready: number;
  running: number;
  done: number;
  alerts: number;
  progress: Progress;
};

/**
 * 오늘 명단 묶음(today-board) × 운행 기록(0243a) → 관제용 한 벌.
 *
 * ⚠️ `tripsByRun`이 비어 있어도 정상이다 — 0243a 적용 전이거나 아직 아무도 출발을 안 눌렀을 때다.
 *    그 경우 모든 회차가 `ready`가 되는데, **표가 없는 것과 출발 전인 것은 다른 사실**이라 화면이
 *    `tripsReady`로 그 둘을 가른다(여기서 판단하지 않는다 — 이 모듈은 숫자만 만든다).
 */
export function buildLiveBoard(
  groups: readonly VehicleGroup[],
  tripsByRun: ReadonlyMap<string, ShuttleTrip>,
): LiveVehicle[] {
  return groups.map((g) => {
    const runs: LiveRun[] = g.runs.map(({ run, rows }) => {
      const progress = countProgress(rows);
      const trip = tripsByRun.get(run.id) ?? null;
      const state = tripState(trip);
      return { run, rows, progress, trip, state, alert: runAlert(state, progress) };
    });
    return {
      vehicleId: g.vehicleId,
      vehicleName: g.vehicleName,
      driverName: g.driverName,
      driverPhone: g.driverPhone,
      runs,
      progress: g.progress,
      running: runs.filter((r) => r.state === "running").length,
      alerts: runs.filter((r) => r.alert !== "none").length,
    };
  });
}

/** 상단 요약 — 화면이 손으로 세지 않게. */
export function summarizeLive(vehicles: readonly LiveVehicle[]): LiveSummary {
  const runs = vehicles.flatMap((v) => v.runs);
  return {
    vehicles: vehicles.length,
    ready: runs.filter((r) => r.state === "ready").length,
    running: runs.filter((r) => r.state === "running").length,
    done: runs.filter((r) => r.state === "done").length,
    alerts: runs.filter((r) => r.alert !== "none").length,
    progress: sumProgress(vehicles),
  };
}

/**
 * 경보만 추린 목록 — 상단에 "지금 볼 것"을 몇 줄로 세울 때 쓴다.
 *
 * 🔴 **원래 목록에서 그 회차를 빼지 않는다**(호출부 규약) — 경보 줄은 아래 차 목록에도 그대로 있어야
 *    한다. 위로 뽑아 올리면서 아래에서 지우면, 처리한 순간 줄이 두 자리에서 동시에 사라져
 *    "방금 뭘 봤더라"가 된다.
 */
export function alertRuns(vehicles: readonly LiveVehicle[]): { vehicle: LiveVehicle; run: LiveRun }[] {
  return vehicles.flatMap((vehicle) =>
    vehicle.runs.filter((run) => run.alert !== "none").map((run) => ({ vehicle, run })),
  );
}

/** 회차 하나의 진행을 "9/12" 같은 사람 문구로 — 화면마다 만들지 않게. */
export function progressLabel(p: Progress): string {
  return `${p.boarded + p.missed}/${p.planned}`;
}

/** 그 회차를 지금 펼쳐 둘까 — 운행 중이거나 볼 것이 있으면 편다(끝난 회차는 접는다). */
export function shouldExpand(run: Pick<LiveRun, "state" | "alert">): boolean {
  return run.state === "running" || run.alert !== "none";
}

/**
 * 호차를 눌렀을 때 **기본으로 펼칠 회차**(사용자 2026-10-14 "현재 시간이랑 가장 가까운 회차를 기본으로") — 순수 함수.
 *
 * 1) 지금 **운행 중**인 회차 → 2) 출발 시각(`firstTime`)이 지금과 **가장 가까운** 회차(앞뒤 상관없이, 같으면 앞으로 올 회차)
 * → 3) 시각이 하나도 없으면 첫 회차. 날짜는 보지 않는다(오늘이 아닌 날을 볼 때도 같은 시각대 회차가 펼쳐지면 충분하다).
 */
export function nearestRunId(runs: readonly Pick<LiveRun, "run" | "state">[], nowMinutes: number): string | null {
  const running = runs.find((r) => r.state === "running");
  if (running) return running.run.id;
  let best: { id: string; gap: number; future: boolean } | null = null;
  for (const r of runs) {
    const t = firstTime(r.run);
    if (!/^\d{2}:\d{2}$/.test(t)) continue;
    const minutes = Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    const gap = Math.abs(minutes - nowMinutes);
    const future = minutes >= nowMinutes;
    if (!best || gap < best.gap || (gap === best.gap && future && !best.future)) best = { id: r.run.id, gap, future };
  }
  return best?.id ?? runs[0]?.run.id ?? null;
}
