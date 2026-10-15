"use client";

import { Pill } from "@/components/atoms/pill";
import { EyIcon } from "@/components/icons/aywa-icons";
import { TONE_COLOR } from "@/lib/design/semantic-color";
import { cn } from "@/lib/utils";
import { SHUTTLE_ROW } from "@/features/shuttle/control-size";
import {
  DIRECTION_LABEL,
  runTimeRange,
  runShortTitle,
  type Direction,
  type ShuttleRun,
  type ShuttleTrip,
} from "@/features/shuttle/types";
import type { RideRow } from "@/features/shuttle/roster";
import {
  firstTime,
  groupRowsByStop,
  progressState,
  splitRowsByIo,
  type Progress,
} from "@/features/shuttle/today/today-board";
import { tripState } from "@/features/shuttle/today/trip-state";
import { RideRowItem } from "./ride-row-item";
import { TripControl } from "./trip-control";
import { TripGpsSender } from "./trip-gps-sender";

/** 등원 = info(파랑) · 하원 = special(보라) — 회차 머리 배지가 원래 쓰던 색 그대로. */
const IO_TONE = { in: TONE_COLOR.info, out: TONE_COLOR.special } as const satisfies Record<Direction, unknown>;

/** 등원 = info(파랑) · 하원 = special(보라) — 회차 머리 배지가 원래 쓰던 색 그대로. */
const IO_TONE = { in: TONE_COLOR.info, out: TONE_COLOR.special } as const satisfies Record<Direction, unknown>;

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
 *
 * 🔑 **등·하원이 섞인 회차**(사용자 2026-10-06 "학생들마다 등원인지 하원인지 명확하게") —
 *   머리에 [등원][하원] 배지를 둘 다 띄우고, **정류장마다 그 안에서** 등원 / 하원으로 가른다(칸 머리 "[등원] N명", 왼쪽 띠 없음),
 *   줄마다 이름 옆에도 배지를 붙인다. 한쪽뿐인 회차는 예전 그대로다(배지를 반복하면 다시 글자 덩어리가 된다).
 */
export function RunPanel({
  run,
  rows,
  progress,
  open,
  onToggle,
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
  // 회차 성격 쪽 칸이 먼저 온다. 칸이 둘이면 섞인 회차다.
  const ioSections = splitRowsByIo(rows, run.direction);
  const mixed = ioSections.length > 1;
  const headIos: Direction[] = mixed ? ioSections.map((sec) => sec.io) : [run.direction];
  /**
   * 🔒 **종료된 회차는 명단을 못 바꾼다**(사용자 2026-10-06 "회차가 종료됐을 경우에는 아이들 내용을 수정할 수 없게") —
   * 줄을 읽기 전용으로 그리고 판 위에 "운행이 종료됐습니다"를 띄운다. 되돌리는 문은 머리의 [종료 취소]다.
   * 서버(recordBoarding·clearBoarding)도 같은 판정을 다시 한다([[#77]]).
   */
  const ended = tripsReady && tripState(trip) === "done";
  const rowsWritable = canWrite && !ended;
  /**
   * 🔒 **[출발]이 눌려야 탑승·미탑승·하차를 찍는다**(사용자 2026-10-07). 출발 전엔 하원 체크·[등원/하원 안함]·[등하원 수정]만
   * 된다(체크는 출발 전에 하는 일이다). 운행 표가 없으면(0243a 미적용) 출발 버튼도 없으니, 오늘이 아닌 날(지난 기록 정정)도 잠그지 않는다([[#95]]).
   * 서버(recordBoarding)도 같은 판정을 다시 한다([[#77]]).
   */
  const departed = !tripsReady || date !== today || tripState(trip) !== "ready";

  return (
    // 🔘 **종료된 회차는 판 전체를 회색으로**(사용자 2026-10-07 "종료됐는지 확실히 표시") — 바탕을 죽이고 머리·명단을
    //    흑백으로 눌러 "지나간 것"(tone 캐논 inert)으로 읽히게 한다. ⚠️ [종료 취소]·종료 배지(TripControl)는 색을 남긴다 —
    //    되돌리는 문은 눈에 띄어야 하고, 종료(초록)와 출발 전(회색)이 한눈에 갈려야 한다(trip-state.ts TRIP_TONE).
    <section
      className={cn(
        "flex flex-col rounded-2xl",
        ended ? "bg-muted border-line border" : "bg-card shadow-[var(--shadow-card)]",
      )}
    >
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
            ended && "opacity-60 grayscale",
          )}
        >
          {start && (
            <span className={cn("num shrink-0 text-base font-bold", ended ? "text-text-dim" : "text-foreground")}>
              {start}
            </span>
          )}
          {ended && <span className="bg-neutral-fill rounded-full px-2 py-0.5 text-xs font-bold text-white">운행 종료</span>}
          {headIos.map((io) => (
            <Pill key={io} color={IO_TONE[io]}>
              {DIRECTION_LABEL[io]}
            </Pill>
          ))}
          {/* 방향 글자는 위 배지가 이미 말한다 — 제목은 "3회차"까지만. */}
          <span className="text-text-dim text-xs font-bold">{runShortTitle(run)}</span>
          {tail && <span className="text-text-faint num text-xs">{tail}</span>}
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {/* 🔴 전원이 '오늘 안 탐'인 회차를 "완료"로 쓰지 않는다(아무도 안 탔는데 다 한 것처럼 읽힌다)
                — 판정은 순수 `progressState` 한 곳에서 온다.
                📐 남은 명수는 **호차 머리 하나만** 말한다(사용자 2026-10-06 "남은 명수 표시가 너무 많아") —
                   회차·정류장 머리에서는 뺐다. */}
            {state === "remaining" ? null : state === "done" ? (
              <span className="text-green text-xs font-bold">완료</span>
            ) : (
              <span className="text-text-faint text-xs font-bold">오늘 탑승 없음</span>
            )}
            {/* ⚠️ 접기 표시를 ▲/▼ **문자**로 쓰지 말 것 — 아이콘 자리에 글리프를 세우는 건
                가드 테스트(aywa-icon-mapping)가 막는다. 폰트·플랫폼마다 크기가 널뛴다. */}
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
          rows={rows}
          onError={onError}
          onDone={onTripDone}
        />
      </div>

      {/* 📡 차량 위치 보내기(0369a) — 오늘 운행 중인 회차에, 기록 권한이 있을 때만. 접혀 있어도 보인다(보내는 중인지 늘 알아야 한다). */}
      {tripsReady && canWrite && date === today && tripState(trip) === "running" ? <TripGpsSender runId={run.id} date={date} /> : null}

      {open && (
        <div className="flex flex-col gap-3 px-2.5 pb-2.5">
          {ended && (
            <p role="status" className="bg-muted text-text-dim rounded-lg px-3 py-2 text-center text-sm font-bold">
              운행이 종료됐습니다{canWrite ? " — 바꾸려면 [종료 취소]를 누르세요" : ""}
            </p>
          )}
          {/* 🔑 **정류장(시각)이 먼저, 등·하원은 그 안에서**(사용자 2026-10-06 "같은 시간대를 두 번 나눠서
              봐야 하잖아") — 예전엔 등원 칸 / 하원 칸을 먼저 가르고 칸마다 정류장을 다시 묶어 같은 시각이 두 번 나왔다. */}
          {groupRowsByStop(rows).map((group) => (
            <div key={group.key} className={cn("flex flex-col gap-1", ended && "opacity-60 grayscale")}>
              {/* 정류장 머리 — 줄마다 반복되던 긴 이름이 여기 한 번만 온다.
                  🔑 묶음 순서가 곧 기사가 도는 순서라 "다음 정류장"이 그대로 읽힌다. */}
              <div className="border-line-faint flex items-baseline gap-1.5 border-b px-1 pb-1">
                {group.atTime && (
                  <span className="text-text-dim num shrink-0 text-xs font-bold">{group.atTime}</span>
                )}
                <span className="text-foreground min-w-0 flex-1 truncate text-xs font-bold">{group.stopName}</span>
              </div>
              {splitRowsByIo(group.rows, run.direction).map((sec) => (
                <div key={sec.io} className="flex flex-col gap-1">
                  {/* 섞인 회차의 칸 머리 — "[등원] 5명" / "[하원] 2명". 왼쪽 색 띠는 뺐다(사용자 2026-10-06). */}
                  {mixed && (
                    <div className="flex items-center gap-1.5 px-1 pt-0.5">
                      <Pill color={IO_TONE[sec.io]}>{DIRECTION_LABEL[sec.io]}</Pill>
                      <span className="text-text-dim text-xs font-bold">{sec.rows.length}명</span>
                    </div>
                  )}
                  {/* 📐 **넓으면 두 사람씩**(2026-09-03) — PC에서 이름과 [탑승]/[미탑승] 사이가 700px 가까이 비었다.
                      🔴 **폰은 그대로 한 줄**이다 — 두 열로 쪼개면 44px 버튼 두 개가 한 칸에 들어가지
                         못해 달리는 차 안에서 오조작이 난다(셔틀 결정: 탭 타겟 44px).
                      ⚠️ 기준을 `sm`(640px)으로 잡은 이유: 셔틀 창은 기본 480px로 열린다. */}
                  <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                    {sec.rows.map((row) => (
                      <RideRowItem
                        key={row.key}
                        row={row}
                        date={date}
                        season={run.season}
                        canWrite={rowsWritable}
                        departed={departed}
                        canEditException={canEditException && !ended}
                        ioBadge={mixed}
                        onError={onError}
                        onDone={onDone}
                      />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
