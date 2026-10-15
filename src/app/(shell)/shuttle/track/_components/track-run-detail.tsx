"use client";

import { Pill } from "@/components/atoms/pill";
import { TONE_COLOR, TONE_SOFT, type SemanticTone } from "@/lib/design/semantic-color";
import { kstTimeOf } from "@/lib/date-kst";
import { cn } from "@/lib/utils";
import { SHUTTLE_ROW } from "@/features/shuttle/control-size";
import { progressLabel, type LiveRun, type LiveVehicle } from "@/features/shuttle/live/live-board";
import { isInactiveDay, type RideRow } from "@/features/shuttle/roster";
import { firstTime } from "@/features/shuttle/today/today-board";
import { RUN_ALERT_LABEL, RUN_ALERT_TONE, TRIP_STATE_LABEL, TRIP_TONE } from "@/features/shuttle/today/trip-state";
import { DIRECTION_LABEL, runShortTitle, runTimeRange } from "@/features/shuttle/types";

/**
 * 실시간 위치 — **한 호차의 회차별 보기**(사용자 2026-10-08 "각 호차마다 회차별 데이터도 볼 수 있게", 관리자 전용).
 *
 * 위: 그 차의 회차 칩(시각 · 등/하원 · 회차 · 운행 상태). 아래: 고른 회차의 **정류장 순서대로** 시각 · 아이별 상태.
 * 🔑 숫자·상태는 새로 세지 않는다 — 운행 현황과 같은 `LiveRun`(today-board · live-board 판정)을 그대로 그린다.
 * 🔴 '미기록'은 '미탑승'이 아니다(roster 규약) — 색도 다르다(회색 vs 빨강).
 */
export function TrackRunDetail({
  vehicle,
  runId,
  onPickRun,
  tripsReady,
}: {
  vehicle: LiveVehicle;
  /** 고른 회차 — 없으면 아무것도 고르지 않은 상태(위 칩만). */
  runId: string | null;
  onPickRun: (runId: string) => void;
  tripsReady: boolean;
}) {
  const picked = vehicle.runs.find((r) => r.run.id === runId) ?? null;

  return (
    <section className="bg-card flex flex-col gap-3 rounded-2xl p-3 shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h2 className="text-base font-bold">{vehicle.vehicleName}</h2>
        {vehicle.driverName && <span className="text-text-dim text-xs">기사 {vehicle.driverName}</span>}
        <span className="text-text-faint num ml-auto text-xs font-bold">오늘 {progressLabel(vehicle.progress)}</span>
      </div>

      {/* 회차 칩 — 누르면 그 회차의 정류장·아이들이 아래에 펼쳐지고 지도도 그 회차 정류장으로 좁혀진다. */}
      <div role="tablist" aria-label={`${vehicle.vehicleName} 회차`} className="flex flex-wrap gap-1.5">
        {vehicle.runs.map((r) => {
          const active = r.run.id === runId;
          return (
            <button
              key={r.run.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onPickRun(r.run.id)}
              className={cn(
                // 폰 44px 이상(SHUTTLE_ROW) — 셔틀 화면 컨트롤 크기 캐논.
                SHUTTLE_ROW,
                "flex cursor-pointer items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-left text-xs font-bold",
                active ? "border-primary bg-primary/10" : "border-line bg-card",
              )}
            >
              <span className="num text-sm">{firstTime(r.run) || "—"}</span>
              <span className="text-text-dim">{DIRECTION_LABEL[r.run.direction]}</span>
              <span>{runShortTitle(r.run)}</span>
              {r.progress.planned === 0 ? (
                <span className="text-text-faint font-medium">오늘 탑승 없음</span>
              ) : tripsReady ? (
                <Pill color={TONE_COLOR[TRIP_TONE[r.state]]}>{TRIP_STATE_LABEL[r.state]}</Pill>
              ) : null}
            </button>
          );
        })}
      </div>

      {picked ? <RunBody run={picked} tripsReady={tripsReady} /> : null}
    </section>
  );
}

function RunBody({ run, tripsReady }: { run: LiveRun; tripsReady: boolean }) {
  const p = run.progress;
  const startedAt = kstTimeOf(run.trip?.startedAt);
  const endedAt = kstTimeOf(run.trip?.endedAt);
  const stops = [...run.run.stops].sort((a, b) => a.sortOrder - b.sortOrder);
  const rowsByStop = new Map<string, RideRow[]>();
  const extra: RideRow[] = [];
  for (const row of run.rows) {
    if (!row.runStopId) {
      extra.push(row); // 예정에 없던 탑승 — 노선 칸이 없다
      continue;
    }
    const list = rowsByStop.get(row.runStopId) ?? [];
    list.push(row);
    rowsByStop.set(row.runStopId, list);
  }

  return (
    <div className="flex flex-col gap-2">
      {/* 회차 요약 — 시간대 · 운행 시각 · 진행. */}
      <div className="bg-bg-soft flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-3 py-2 text-xs">
        <span className="num font-bold">{runTimeRange(run.run.stops) || "시각 없음"}</span>
        {tripsReady && (startedAt || endedAt) ? (
          <span className="text-text-dim num">
            {startedAt ? `${startedAt} 출발` : ""}
            {endedAt ? ` · ${endedAt} 종료` : ""}
          </span>
        ) : null}
        {run.alert !== "none" && <Pill color={TONE_COLOR[RUN_ALERT_TONE[run.alert]]}>{RUN_ALERT_LABEL[run.alert]}</Pill>}
        <span className="ml-auto flex flex-wrap gap-x-2 font-bold">
          <span className="text-green">탑승 {p.boarded}</span>
          <span className="text-danger">미탑승 {p.missed}</span>
          <span className="text-text-dim">미기록 {p.unmarked}</span>
          <span className="text-text-faint">/ 예정 {p.planned}</span>
        </span>
      </div>

      {p.planned === 0 && (
        <p className="text-text-dim text-xs">오늘 이 회차에 타는 학생이 없습니다 — 편성된 노선만 보여 줍니다.</p>
      )}
      {/* 정류장 순서 — 기사가 도는 순서 그대로. 학원 출발·도착 칸도 시각 기준점이라 남긴다. */}
      <ol className="flex flex-col">
        {stops.map((s, i) => {
          const rows = rowsByStop.get(s.id) ?? [];
          const place = s.kind === "depart" ? "학원 출발" : s.kind === "arrive" ? "학원 도착" : s.stopName;
          return (
            <li key={s.id} className="border-line-faint flex gap-2 border-b py-1.5 last:border-b-0">
              <span className="text-text-faint num w-5 shrink-0 text-right text-xs font-bold">{i + 1}</span>
              <span className="num w-11 shrink-0 text-xs font-bold">{s.atTime?.slice(0, 5) ?? "—"}</span>
              <div className="min-w-0 flex-1">
                <p className={cn("text-sm font-bold", s.kind !== "stop" && "text-text-dim")}>{place}</p>
                {rows.length > 0 && (
                  <ul className="mt-1 flex flex-wrap gap-1">
                    {rows.map((row) => (
                      <RiderChip key={row.key} row={row} />
                    ))}
                  </ul>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {extra.length > 0 && (
        <div className="text-xs">
          <p className="text-text-dim font-bold">예정에 없던 탑승</p>
          <ul className="mt-1 flex flex-wrap gap-1">
            {extra.map((row) => (
              <RiderChip key={row.key} row={row} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** 아이 한 명의 그날 상태 — 하원의 '탑승'은 '하차'로 읽는다(오늘 등하원의 [하차] 버튼과 같은 말). */
function RiderChip({ row }: { row: RideRow }) {
  const off = isInactiveDay(row.dayKind);
  const [label, tone]: [string, SemanticTone] = off
    ? ["안 탐", "inert"]
    : row.status === "boarded" || row.status === "extra"
      ? [row.ioKind === "out" ? "하차" : "탑승", "positive"]
      : row.status === "missed"
        ? ["미탑승", "critical"]
        : ["미기록", "inert"];
  return (
    <li className={cn("rounded-full px-2 py-0.5 text-xs font-bold", TONE_SOFT[tone], off && "line-through")}>
      {row.studentName || "(추가 탑승)"} · {label}
    </li>
  );
}
