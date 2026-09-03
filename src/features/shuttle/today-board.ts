/**
 * 오늘 등하원 화면의 **묶음·집계**(순수 · Vitest) — 화면은 그리기만 하고 판단은 여기서 한다.
 *
 * 📱 원장 2026-08-19: *"오늘 등하원을 모바일 뷰로 볼때 아주 필요한 기능만 잘 있도록 호차 구분 및
 * 시간 정리 등하원 체크 용이하게"* — 폰에서 회차가 평평하게 늘어서면 **지금 보는 게 몇 호차인지**가
 * 사라진다(차가 여럿이면 남의 차 회차를 자기 차로 착각한다). 그래서 호차로 접고, 호차마다 남은 수를 센다.
 *
 * 🔴 **'미기록'은 미탑승이 아니다** — 아직 안 찍은 줄은 남은 일이지 결과가 아니다(roster 규약). 여기서도
 *    `unmarked`를 따로 세고 `missed`와 절대 합치지 않는다.
 */
import type { Direction, ShuttleRun, ShuttleVehicle } from "./types";
import type { RideRow } from "./roster";

/** 화면이 넘겨주는 회차 한 덩이(회차 + 그날 줄). */
export type RunRows = { run: ShuttleRun; rows: RideRow[] };

/** 등하원 필터 — 아침엔 등원만, 저녁엔 하원만 본다(폰에서 목록이 절반이 된다). */
export type DirectionFilter = "all" | Direction;

/** 한 덩이의 진행 — 접힌 채로도 "남은 일"이 보이게. */
export type Progress = {
  planned: number;
  boarded: number;
  missed: number;
  /** 아직 안 찍은 줄 — 🔴 미탑승과 다르다. */
  unmarked: number;
};

/** 호차 한 칸 = 그 차의 회차들 + 그 차의 진행. */
export type VehicleGroup = {
  vehicleId: string;
  /** 차 이름 — 편성이 지워진 회차도 화면에서 사라지지 않게 폴백을 둔다. */
  vehicleName: string;
  driverName: string | null;
  driverPhone: string | null;
  runs: RunRows[];
  progress: Progress;
};

/**
 * 줄 묶음의 진행을 센다.
 *
 * 🔴 **오늘 안 타는 줄(`skipped`)은 세지 않는다**(0229a). 화면에는 회색으로 **남아 있지만**
 *    "할 일"이 아니다 — 빼지 않으면 `남음 1명`이 영원히 안 줄어 회차가 끝나지 않고, 그 회차는
 *    자동으로 계속 펼쳐진 채 남는다(RunPanel의 열림 판정이 `unmarked > 0`이다).
 * ⚠️ 그래서 `planned`도 함께 줄어든다 — `planned = boarded + missed + unmarked` 불변식을 지키려면
 *    한쪽만 빼면 안 된다. 세는 모수가 "오늘 실제로 태울 사람"이 되는 게 맞기도 하다.
 * ⚠️ 이미 찍힌 기록이 있는데 뒤늦게 skip이 들어오면 그 줄의 상태는 화면에 그대로 보이되 카운트
 *    밖으로 나간다(드문 경우 — 기록을 지우는 것보다 보이는 편이 안전하다).
 */
export function countProgress(rows: readonly RideRow[]): Progress {
  let planned = 0;
  let boarded = 0;
  let missed = 0;
  for (const r of rows) {
    if (r.dayKind === "skipped") continue;
    planned += 1;
    // 'extra'(예정에 없던 탑승)도 탄 것이다 — 남은 일에서 빼야 "완료"가 맞는다.
    if (r.status === "boarded" || r.status === "extra") boarded += 1;
    else if (r.status === "missed") missed += 1;
  }
  return { planned, boarded, missed, unmarked: planned - boarded - missed };
}

/**
 * 접힌 머리에 뭐라고 쓸지 — "남음 N명" / "완료" / "오늘 탑승 없음".
 *
 * 🔑 `none`이 따로 있는 이유: 그 회차 사람이 **전원 오늘만 안 탐**이면 `unmarked`가 0이라 그냥
 *    세면 "완료"가 된다. 아무도 안 탔는데 다 한 것처럼 읽히면 안 된다.
 */
export type ProgressState = "remaining" | "done" | "none";
export function progressState(p: Progress): ProgressState {
  if (p.planned === 0) return "none";
  return p.unmarked > 0 ? "remaining" : "done";
}

/** 여러 덩이의 진행을 합친다. */
export function sumProgress(groups: readonly { progress: Progress }[]): Progress {
  return groups.reduce<Progress>(
    (acc, g) => ({
      planned: acc.planned + g.progress.planned,
      boarded: acc.boarded + g.progress.boarded,
      missed: acc.missed + g.progress.missed,
      unmarked: acc.unmarked + g.progress.unmarked,
    }),
    { planned: 0, boarded: 0, missed: 0, unmarked: 0 },
  );
}

/**
 * 등하원 필터 — 🔴 **줄의 `ioKind`로 거른다. 회차의 `direction`이 아니다.**
 *
 * 두 축은 다르다: `run.direction`은 그 회차의 *성격*이고(makeedu 이관은 **탑승자 다수결**로 정했다 —
 * `import-shuttle.cjs`의 `inn >= out ? "in" : "out"`), 학생 개인의 승/하차는 `rider.ioKind`가 따로 정한다
 * (types.ts: *"한 회차에 섞일 수 있다"*).
 * 회차 축으로 거르면 **승차 5·하차 2인 회차를 '하원'으로 보는 순간 그 2명이 화면에서 통째로 사라진다** —
 * 사라진 줄은 아무도 안 찍고, 어느 표면에도 단서가 없다. 저장할 땐 이미 `row.ioKind`를 쓰고 있었다.
 *
 * 그래서 **줄을 걸러내고**, 남은 줄이 있는 회차만 남긴다(섞인 회차는 양쪽 필터에 각자 제 몫만 보인다).
 */
export function filterByDirection(runs: readonly RunRows[], dir: DirectionFilter): RunRows[] {
  if (dir === "all") return [...runs];
  return runs
    .map(({ run, rows }) => ({ run, rows: rows.filter((r) => r.ioKind === dir) }))
    .filter(({ rows }) => rows.length > 0);
}

/**
 * 회차를 **호차로 묶는다** — 차 순서는 편성(sortOrder), 차 안에서는 **시각 순**이다.
 *
 * 🔴 시각으로 정렬하는 이유: 기사는 회차 번호가 아니라 **다음 출발 시각**으로 움직인다. 번호순이면
 *    "3회차 15:45"가 "1회차 13:46"보다 위에 오는 편성에서 폰을 위아래로 훑게 된다.
 * ⚠️ 시각이 없는 회차는 **뒤로** 보낸다(맨 앞에 오면 그날 첫 차처럼 읽힌다). 시각이 같으면 회차 번호로.
 * ⚠️ 차 목록에 없는 vehicleId(편성이 지워진 회차)도 **버리지 않는다** — 화면에서 조용히 사라지면
 *    그 줄은 아무도 안 찍는다. 이름만 폴백으로 둔다.
 */
export function groupRunsByVehicle(
  runs: readonly RunRows[],
  vehicles: readonly ShuttleVehicle[],
): VehicleGroup[] {
  // ⚠️ 순위는 **넘겨받은 배열 순서**다. `sortOrder`는 기본값이 0이라(0225a) 동점이 흔하고, 쿼리는
  //    `.order("sort_order").order("name")`으로 이미 2차 정렬까지 마쳐 내려준다 — 여기서 sortOrder만
  //    다시 보면 그 2차 정렬을 버려 편성 화면·인쇄와 호차 순서가 어긋난다.
  const order = new Map(vehicles.map((v, i) => [v.id, i]));
  const meta = new Map(vehicles.map((v) => [v.id, v]));

  const byVehicle = new Map<string, RunRows[]>();
  for (const item of runs) {
    const list = byVehicle.get(item.run.vehicleId) ?? [];
    list.push(item);
    byVehicle.set(item.run.vehicleId, list);
  }

  const groups: VehicleGroup[] = [];
  for (const [vehicleId, list] of byVehicle) {
    const v = meta.get(vehicleId);
    const sorted = [...list].sort((a, b) => {
      const ta = firstTime(a.run);
      const tb = firstTime(b.run);
      if (ta !== tb) {
        // 시각 없는 회차는 항상 뒤로.
        if (!ta) return 1;
        if (!tb) return -1;
        return ta < tb ? -1 : 1;
      }
      return a.run.runNo - b.run.runNo;
    });
    groups.push({
      vehicleId,
      vehicleName: v?.name || "(편성 없는 차)",
      driverName: v?.driverName ?? null,
      driverPhone: v?.driverPhone ?? null,
      runs: sorted,
      progress: countProgress(sorted.flatMap((r) => r.rows)),
    });
  }

  return groups.sort((a, b) => {
    const oa = order.get(a.vehicleId);
    const ob = order.get(b.vehicleId);
    // 편성에 없는 차는 맨 뒤(그래도 보이긴 한다).
    if (oa === undefined && ob === undefined) return a.vehicleName.localeCompare(b.vehicleName, "ko");
    if (oa === undefined) return 1;
    if (ob === undefined) return -1;
    return oa - ob;
  });
}

/** 그 회차의 첫 출발 시각("HH:MM") — 없으면 빈 문자열. */
export function firstTime(run: Pick<ShuttleRun, "stops">): string {
  let best = "";
  for (const s of run.stops) {
    const t = s.atTime?.slice(0, 5);
    if (!t) continue;
    if (!best || t < best) best = t;
  }
  return best;
}

/**
 * 그날 줄을 **정류장으로 묶는다** — 화면 밀도의 핵심.
 *
 * 원장(2026-09-03): *"한 페이지에 정보가 너무 많고 글자는 작고 기능은 많으니 처음 보는 사람들이
 * 쓰기 힘들지"*. 실화면을 재 보니 같은 정류장 이름이 **줄마다 반복**되고 있었다 —
 * `김효빈 14:00 · 대구오페라 스위첸아파트 봄날부동산 앞` 이 세 줄 연속. 이름(봐야 할 것)보다
 * 정류장 글자 덩어리가 훨씬 커서 위계가 뒤집혀 있었다.
 *
 * 🔑 **줄은 이미 노선 순서**다(`plannedRidesOn`이 정류장 sort_order로 훑는다) — 그래서 **연속된
 *    같은 정류장**만 묶으면 순서가 그대로 보존되고, 묶음이 곧 **기사가 도는 순서**가 된다.
 *    (정류장 이름으로 전역 그룹핑을 하면 노선 순서가 무너져 "다음 정류장"을 못 읽는다.)
 * ⚠️ 예정에 없던 기록(추가 탑승)은 `runStopId`가 null이라 이름으로 묶는다 — 같은 이름의 정류장이
 *    바로 앞에 있으면 그 묶음에 합쳐진다(그게 맞다: 같은 자리에서 탄 사람이다).
 */
export type StopGroup = {
  key: string;
  stopName: string;
  atTime: string | null;
  rows: RideRow[];
};

export function groupRowsByStop(rows: readonly RideRow[]): StopGroup[] {
  const out: StopGroup[] = [];
  for (const row of rows) {
    // 칸 id가 있으면 그것으로, 없으면(추가 탑승) 이름으로 — 연속된 것만 같은 묶음이다.
    const id = row.runStopId ?? `name:${row.stopName}`;
    const last = out[out.length - 1];
    if (last && last.key === id) {
      last.rows.push(row);
      continue;
    }
    out.push({ key: id, stopName: row.stopName, atTime: row.atTime, rows: [row] });
  }
  return out;
}

/** 그 정류장 묶음에서 아직 안 찍은 사람 수 — 묶음 머리에 "N명 남음"을 띄운다. */
export function stopGroupRemaining(group: Pick<StopGroup, "rows">): number {
  return countProgress(group.rows).unmarked;
}
