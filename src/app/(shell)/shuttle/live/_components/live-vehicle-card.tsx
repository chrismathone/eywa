"use client";

import { Pill } from "@/components/atoms/pill";
import { EyIcon } from "@/components/icons/aywa-icons";
import { TONE_COLOR } from "@/lib/design/semantic-color";
import { kstTimeOf } from "@/lib/date-kst";
import { cn } from "@/lib/utils";
import { SHUTTLE_ROW, SHUTTLE_ROW_TEXT } from "@/features/shuttle/control-size";
import { progressLabel, type LiveRun, type LiveVehicle } from "@/features/shuttle/live/live-board";
import {
  RUN_ALERT_LABEL,
  RUN_ALERT_TONE,
  TRIP_STATE_LABEL,
  TRIP_TONE,
} from "@/features/shuttle/today/trip-state";
import {
  BOARDING_STATUS_LABEL,
  DIRECTION_LABEL,
  runShortTitle,
} from "@/features/shuttle/types";
import { firstTime } from "@/features/shuttle/today/today-board";
import { isInactiveDay } from "@/features/shuttle/roster";

/**
 * 관제의 차 한 칸 — 차 머리 + 회차 줄. **읽기 전용**이다(찍는 버튼은 오늘 등하원 화면에 있다).
 *
 * 🔴 상태·경보 색은 [`TRIP_TONE`/`RUN_ALERT_TONE`](@/features/shuttle/today/trip-state)에서 온다 —
 *    여기서 상태→색 맵을 새로 만들면 오늘 화면과 다른 색으로 같은 상태를 말하게 된다(의미색 캐논).
 * ⚠️ 기사 전화는 **누르면 걸리게**(tel:) — 관제에서 이상한 차를 보면 바로 거는 자리다.
 */
export function LiveVehicleCard({
  vehicle,
  tripsReady,
  openRuns,
  onToggleRun,
}: {
  vehicle: LiveVehicle;
  /** 0243a 적용 여부. false면 **상태·경보를 아예 안 그린다**(모르는 것을 '출발 전'이라 하지 않는다). */
  tripsReady: boolean;
  openRuns: Record<string, boolean>;
  onToggleRun: (runId: string, next: boolean) => void;
}) {
  return (
    <section className="flex flex-col gap-2">
      {/* 차 머리 — 스크롤 중에도 붙어 있다(오늘 화면 VehicleHeader와 같은 결).
          ⚠️ 토큰 이름은 `--bg-canvas`(화면 바탕)다(`bg-bg`는 정의가 없어 아무 색도 안 칠해진다 — 죽은 색 클래스). */}
      <div className="bg-bg-canvas/95 border-line sticky top-0 z-10 flex flex-wrap items-center gap-x-2 gap-y-1 border-b py-1.5 backdrop-blur">
        <h2 className="text-foreground text-base font-bold">{vehicle.vehicleName}</h2>
        {vehicle.driverName && (
          <span className="text-text-dim text-xs">
            기사 {vehicle.driverName}
            {vehicle.driverPhone && (
              <a href={`tel:${vehicle.driverPhone}`} className="text-primary ml-1 font-bold underline">
                {vehicle.driverPhone}
              </a>
            )}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          {tripsReady && vehicle.running > 0 && (
            <Pill color={TONE_COLOR.info}>운행 중 {vehicle.running}</Pill>
          )}
          {tripsReady && vehicle.alerts > 0 && (
            <Pill color={TONE_COLOR.critical}>확인 {vehicle.alerts}</Pill>
          )}
          <span className="text-text-faint text-xs font-bold">
            <span className="num">{progressLabel(vehicle.progress)}</span>
          </span>
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {vehicle.runs.map((live) => (
          <LiveRunPanel
            key={live.run.id}
            live={live}
            tripsReady={tripsReady}
            open={openRuns[live.run.id] ?? false}
            onToggle={() => onToggleRun(live.run.id, !(openRuns[live.run.id] ?? false))}
          />
        ))}
      </div>
    </section>
  );
}

/** 회차 한 줄 — 접힌 채로도 상태·진행이 보여야 한다(관제는 접힌 화면을 훑는 자리다). */
function LiveRunPanel({
  live,
  tripsReady,
  open,
  onToggle,
}: {
  live: LiveRun;
  tripsReady: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const { run, rows, progress, trip, state, alert } = live;
  const start = firstTime(run);
  const startedAt = kstTimeOf(trip?.startedAt);
  const endedAt = kstTimeOf(trip?.endedAt);

  return (
    <section className="bg-card flex flex-col rounded-2xl shadow-[var(--shadow-card)]">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn(
          SHUTTLE_ROW,
          "flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2.5 text-left",
        )}
      >
        {/* 🔴 출발 시각이 맨 앞 — 관리자도 "다음에 뭐가 뜨나"를 시각으로 읽는다(오늘 화면과 같은 규약). */}
        {start && <span className="text-foreground num shrink-0 text-base font-bold">{start}</span>}
        <Pill color={TONE_COLOR[run.direction === "in" ? "info" : "special"]}>
          {DIRECTION_LABEL[run.direction]}
        </Pill>
        {/* 방향은 바로 앞 배지가 이미 말한다 — 제목은 "3회차"까지만(2026-09-03 밀도 개선). */}
        <span className="text-text-dim text-xs font-bold">{runShortTitle(run)}</span>
        {/* 🔴 0243a가 없으면 상태를 말하지 않는다 — '출발 전'은 사실이 아니라 "모른다"이다. */}
        {tripsReady && <Pill color={TONE_COLOR[TRIP_TONE[state]]}>{state === "ready" ? "출발 기록 없음" : TRIP_STATE_LABEL[state]}</Pill>}
        {tripsReady && alert !== "none" && (
          <Pill color={TONE_COLOR[RUN_ALERT_TONE[alert]]}>{RUN_ALERT_LABEL[alert]}</Pill>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          <span className="text-text-faint num text-xs font-bold">
            {progressLabel(progress)}
          </span>
          <EyIcon name={open ? "chevronUp" : "chevronDown"} size={14} className="text-text-faint" />
        </span>
      </button>

      {/* 누가 언제 눌렀는지 — 관제에서 "누구한테 전화하지"의 답이 된다. 모르면 그 줄을 안 그린다. */}
      {tripsReady && (startedAt || endedAt) && (
        <div className="text-text-faint flex flex-wrap gap-x-2 px-3 pb-2 text-xs">
          {startedAt && (
            <span>
              <span className="num">{startedAt}</span> 출발
              {trip?.startedByName && ` · ${trip.startedByName}`}
            </span>
          )}
          {endedAt && (
            <span>
              <span className="num">{endedAt}</span> 종료
              {trip?.endedByName && ` · ${trip.endedByName}`}
            </span>
          )}
          {trip?.memo && <span className="text-text-dim">{trip.memo}</span>}
        </div>
      )}

      {open && (
        <ul className="flex flex-col gap-1 px-3 pb-2.5">
          {rows.map((row) => (
            <li
              key={row.key}
              className={cn(
                SHUTTLE_ROW_TEXT,
                "flex items-center gap-2",
                // 오늘 안 타는 줄·오늘만 승하차로 대체된 평소 줄은 회색으로 남긴다(지우지 않는다 — roster 규약).
                isInactiveDay(row.dayKind) && "opacity-50",
              )}
            >
              <span className="text-foreground font-bold">{row.studentName || "—"}</span>
              <span className="text-text-faint text-xs">{row.stopName}</span>
              <span className="ml-auto shrink-0">
                {/* 🔴 안 찍은 줄은 '미기록'이지 미탑승이 아니다 — 색도 뜻도 다르다. */}
                {row.status === null ? (
                  <Pill color={TONE_COLOR.inert}>미기록</Pill>
                ) : (
                  <Pill
                    color={TONE_COLOR[row.status === "missed" ? "critical" : "positive"]}
                  >
                    {BOARDING_STATUS_LABEL[row.status]}
                  </Pill>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
