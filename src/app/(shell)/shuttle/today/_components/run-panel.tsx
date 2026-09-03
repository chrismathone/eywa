"use client";

import { Pill } from "@/components/atoms/pill";
import { EyIcon } from "@/components/icons/eywa-icons";
import { TONE_COLOR } from "@/lib/design/semantic-color";
import { cn } from "@/lib/utils";
import { SHUTTLE_ROW } from "@/features/shuttle/control-size";
import {
  DIRECTION_LABEL,
  runTimeRange,
  runShortTitle,
  type ShuttleRun,
  type ShuttleTrip,
} from "@/features/shuttle/types";
import type { RideRow } from "@/features/shuttle/roster";
import {
  firstTime,
  groupRowsByStop,
  progressState,
  stopGroupRemaining,
  type Progress,
} from "@/features/shuttle/today-board";
import { RideRowItem } from "./ride-row-item";
import { TripControl } from "./trip-control";

/**
 * 회차 한 판 — 머리(접기 + 출발/종료) + 정류장별 명단.
 *
 * 📐 **밀도 개선(2026-09-03, 원장 제보 *"한 페이지에 정보가 너무 많고 글자는 작고 기능은 많다"*)**:
 *   · **머리를 한 줄로** — 출발/종료가 따로 한 줄을 먹고 있었다(회차 16개 × 40px ≈ 640px 낭비).
 *     버튼 안에 버튼을 넣을 수 없으므로 **접기 버튼과 출발/종료를 형제로** 나란히 둔다.
 *   · **회차 제목에서 방향 글자를 뺀다** — 바로 옆 `[등원]` 배지가 이미 같은 말을 한다
 *     ("13:46 [등원] **1회차 등원**"). 인쇄·다른 표면이 쓰는 `runTitle`은 그대로 두고
 *     화면 전용 `runShortTitle`을 쓴다.
 *   · **명단을 정류장으로 묶는다** — 줄마다 반복되던 긴 정류장 이름이 묶음 머리 한 줄로 접히고,
 *     묶음이 곧 **기사가 도는 순서**가 된다(today-board.groupRowsByStop 주석).
 */
export function RunPanel({
  run,
  rows,
  progress,
  open,
  onToggle,
  absentSet,
  date,
  canWrite,
  canEditException,
  onError,
  onDone,
  trip,
  tripsReady,
  today,
  onTripDone,
}: {
  run: ShuttleRun;
  rows: RideRow[];
  progress: Progress;
  open: boolean;
  onToggle: () => void;
  absentSet: Set<string>;
  date: string;
  canWrite: boolean;
  /** 일회성 변경(0229a)을 여기서 되돌릴 수 있나 — 적용 여부 × 오늘 이후 날짜. */
  canEditException: boolean;
  onError: (msg: string | null) => void;
  onDone: () => void;
  /** 그 회차의 운행 기록(0243a) — 아직 출발 안 했거나 표가 없으면 null. */
  trip: ShuttleTrip | null;
  /** 0243a 적용 여부. false면 출발/종료가 통째로 안 그려진다. */
  tripsReady: boolean;
  /** KST 오늘 — 출발·종료는 오늘 것만 찍는다. */
  today: string;
  /** 출발·종료가 성공했을 때(등하원 기록과 **다른 종류**라 신호를 따로 보낸다). */
  onTripDone: () => void;
}) {
  const state = progressState(progress);
  const start = firstTime(run);
  // 앞에 이미 출발 시각을 크게 세웠다 — 뒤 범위는 **끝시각만** 남긴다(같은 값을 두 번 읽히지 않게).
  const range = runTimeRange(run.stops);
  const tail = start && range.startsWith(start) ? range.slice(start.length) : range;
  const stopGroups = groupRowsByStop(rows);

  return (
    <section className="bg-card flex flex-col rounded-2xl shadow-[var(--shadow-card)]">
      {/* 회차 머리 = 접기 버튼 + 출발/종료. 접힌 채로도 "몇 명 중 몇 명 남았는지"가 보여야 한다.
          🔴 **출발 시각이 맨 앞**이다 — 기사는 회차 번호가 아니라 다음 출발 시각으로 움직인다. */}
      <div className="flex items-center gap-1.5 px-3 py-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className={cn(
            SHUTTLE_ROW,
            "flex min-w-0 flex-1 cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 text-left",
          )}
        >
          {start && <span className="text-foreground num shrink-0 text-[16px] font-bold">{start}</span>}
          <Pill color={TONE_COLOR[run.direction === "in" ? "info" : "special"]}>
            {DIRECTION_LABEL[run.direction]}
          </Pill>
          {/* 방향 글자는 위 배지가 이미 말한다 — 제목은 "3회차"까지만. */}
          <span className="text-text-dim text-[12.5px] font-bold">{runShortTitle(run)}</span>
          {tail && <span className="text-text-faint num text-[11.5px]">{tail}</span>}
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {/* 🔴 전원이 '오늘 안 탐'인 회차를 "완료"로 쓰지 않는다(아무도 안 탔는데 다 한 것처럼 읽힌다)
                — 판정은 순수 `progressState` 한 곳에서 온다. */}
            {state === "remaining" ? (
              <span className="text-amber text-[11.5px] font-bold">
                <span className="num">{progress.unmarked}</span>명 남음
              </span>
            ) : state === "done" ? (
              <span className="text-green text-[11.5px] font-bold">완료</span>
            ) : (
              <span className="text-text-faint text-[11.5px] font-bold">오늘 탑승 없음</span>
            )}
            {/* ⚠️ 접기 표시를 ▲/▼ **문자**로 쓰지 말 것 — 아이콘 자리에 글리프를 세우는 건
                가드 테스트(eywa-icon-mapping)가 막는다. 폰트·플랫폼마다 크기가 널뛴다. */}
            <EyIcon name={open ? "chevronUp" : "chevronDown"} size={14} className="text-text-faint" />
          </span>
        </button>

        {/* 출발/종료 — 접기 버튼의 **형제**다(버튼 안에 버튼을 넣을 수 없다).
            🔴 0243a 미적용이면 아무것도 안 그려진다 — 없는 기능을 약속하지 않는다([[#95]]). */}
        <TripControl
          trip={trip}
          ready={tripsReady}
          runId={run.id}
          date={date}
          today={today}
          canWrite={canWrite}
          onError={onError}
          onDone={onTripDone}
        />
      </div>

      {open && (
        <div className="flex flex-col gap-2 px-2.5 pb-2.5">
          {stopGroups.map((group) => {
            const remaining = stopGroupRemaining(group);
            return (
              <div key={group.key} className="flex flex-col gap-1">
                {/* 정류장 머리 — 줄마다 반복되던 긴 이름이 여기 한 번만 온다.
                    🔑 묶음 순서가 곧 기사가 도는 순서라 "다음 정류장"이 그대로 읽힌다. */}
                <div className="border-line-faint flex items-baseline gap-1.5 border-b px-1 pb-1">
                  {group.atTime && (
                    <span className="text-text-dim num shrink-0 text-[12.5px] font-bold">
                      {group.atTime}
                    </span>
                  )}
                  <span className="text-foreground min-w-0 flex-1 truncate text-[12.5px] font-bold">
                    {group.stopName}
                  </span>
                  <span className="text-text-faint shrink-0 text-[11.5px]">
                    {remaining > 0 ? (
                      <span className="text-amber font-bold">
                        <span className="num">{remaining}</span>명 남음
                      </span>
                    ) : (
                      <>
                        <span className="num">{group.rows.length}</span>명
                      </>
                    )}
                  </span>
                </div>
                <ul className="flex flex-col gap-1.5">
                  {group.rows.map((row) => (
                    <RideRowItem
                      key={row.key}
                      row={row}
                      absentToday={absentSet.has(row.studentId)}
                      date={date}
                      canWrite={canWrite}
                      canEditException={canEditException}
                      onError={onError}
                      onDone={onDone}
                    />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
