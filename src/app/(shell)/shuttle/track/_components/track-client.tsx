"use client";

import { useMemo } from "react";
import Link from "next/link";
import { FaceTabs } from "@/components/face-tabs";
import { Pill } from "@/components/atoms/pill";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Button } from "@/components/ui/button";
import { TONE_COLOR } from "@/lib/design/semantic-color";
import { addDays, formatKoreanDate, kstTimeOf } from "@/lib/date-kst";
import { cn } from "@/lib/utils";
import {
  SEASONS,
  SEASON_LABEL,
  hasCoords,
  type Season,
  type ShuttleRun,
  type ShuttleStop,
  type ShuttleTrip,
  type ShuttleVehicle,
} from "@/features/shuttle/types";
import {
  SHUTTLE_ACTION,
  SHUTTLE_CHIP,
  SHUTTLE_CHIP_OFF,
  SHUTTLE_CHIP_ON,
} from "@/features/shuttle/control-size";
import { SHUTTLE_TRACK_PATH, shuttleFaces } from "@/features/shuttle/faces";
import { mergePlanAndLog, plannedRidesOn, type RideException } from "@/features/shuttle/roster";
import { groupRunsByVehicle } from "@/features/shuttle/today-board";
import { buildLiveBoard, summarizeLive } from "@/features/shuttle/live-board";
import { useShuttleLive } from "@/features/shuttle/use-shuttle-live";
import type { BoardingLog } from "@/features/shuttle/server/queries";
import { TrackVehicleCard } from "./track-vehicle-card";

/**
 * 실시간 위치 — **차 한 대 = 카드 하나**, 그 안에 지도가 들어올 자리.
 *
 * 원장(2026-09-03): *"운행현황 옆에 버튼하나 더해서 실시간 위치 만들어서 쓸수있게 해주고"* +
 * *"지도키는 추후 개발예정이라 잡고 **영역만 만들어두려는것**"*.
 *
 * 🔴 **지금은 자리를 잡는 화면이다.** 위치를 보내는 기능도, 지도 키도 아직 없다 — 그래서 이 화면은
 *    차량 위치를 **아는 척하지 않고**, 무엇이 더 있어야 채워지는지를 말한다([`VehicleMapSlot`](./vehicle-map-slot)).
 * 🔴 **집계를 여기서 손으로 세지 않는다** — 묶음·진행은 `today-board`, 상태 겹치기는 `live-board`가
 *    한다(Vitest). 운행 현황 탭과 **같은 숫자**여야 어느 쪽이 진실인지 묻지 않게 된다.
 * 🔑 **찍는 버튼이 없다**(읽기 전용) — 출발/종료·탑승 체크는 전부 `/shuttle/today`에 있다.
 */
export function TrackClient({
  tenantId,
  date,
  season,
  vehicles,
  runs,
  logs,
  exceptions,
  stops,
  trips,
  tripsReady,
  today,
}: {
  tenantId: string;
  date: string;
  season: Season;
  vehicles: ShuttleVehicle[];
  runs: ShuttleRun[];
  logs: BoardingLog[];
  exceptions: RideException[];
  /** 정류장 마스터 — 좌표(0244a)가 실려 온다. 지도 준비 상태를 세는 재료다. */
  stops: ShuttleStop[];
  /** 그날 회차별 운행 기록(0243a). Map은 서버→클라 경계를 못 넘어 **엔트리 배열**로 받는다. */
  trips: [string, ShuttleTrip][];
  /** 0243a 적용 여부. false면 운행 상태를 **아예 안 그린다**([[#95]]). */
  tripsReady: boolean;
  /** KST 오늘(서버가 내려준다) — 지난 날짜면 실시간 채널을 안 연다. */
  today: string;
}) {
  // 남이 찍으면 이 화면이 스스로 갱신된다. 🔴 publish는 안 한다 — 여기선 아무것도 바꾸지 않는다.
  const { lastSignalAt } = useShuttleLive({
    tenantId,
    date,
    enabled: Boolean(tenantId) && date === today,
  });

  const tripsByRun = useMemo(() => new Map(trips), [trips]);

  /** 회차별 그날 줄 — 예정 × 기록(운행 현황·오늘 등하원과 **같은 함수**를 탄다). */
  const byRun = useMemo(() => {
    const logsByRun = new Map<string, BoardingLog[]>();
    for (const l of logs) {
      if (!l.runId) continue;
      const list = logsByRun.get(l.runId) ?? [];
      list.push(l);
      logsByRun.set(l.runId, list);
    }
    return runs
      .map((run) => ({
        run,
        rows: mergePlanAndLog(plannedRidesOn(run, date, exceptions), logsByRun.get(run.id) ?? []),
      }))
      .filter(({ rows }) => rows.length > 0);
  }, [runs, logs, date, exceptions]);

  const board = useMemo(
    () => buildLiveBoard(groupRunsByVehicle(byRun, vehicles), tripsByRun),
    [byRun, vehicles, tripsByRun],
  );
  const summary = useMemo(() => summarizeLive(board), [board]);

  /** 정류장 → 좌표 있음? 판정은 손으로 하지 않고 `hasCoords`(0244a check와 같은 규칙). */
  const coordByStop = useMemo(
    () => new Map(stops.map((s) => [s.id, hasCoords(s)])),
    [stops],
  );

  const href = (d: string, s: Season = season) => `${SHUTTLE_TRACK_PATH}?d=${d}&season=${s}`;

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <FaceTabs faces={shuttleFaces(season)} active={SHUTTLE_TRACK_PATH} ariaLabel="셔틀 면 전환" />

      {/* 날짜·시즌 — 다른 셔틀 면과 같은 모양(좁으면 가로 레일 한 줄). */}
      <div className="toolbar-rail flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          aria-label="어제"
          className={SHUTTLE_ACTION}
          render={<Link href={href(addDays(date, -1))} />}
        >
          <EyIcon name="chevronLeft" size={16} />
        </Button>
        <span className="text-foreground px-1 text-[14.5px] font-bold whitespace-nowrap">
          {formatKoreanDate(date)}
        </span>
        <Button
          variant="outline"
          aria-label="내일"
          className={SHUTTLE_ACTION}
          render={<Link href={href(addDays(date, 1))} />}
        >
          <EyIcon name="chevronRight" size={16} />
        </Button>
        {SEASONS.map((s) => (
          <Link
            key={s}
            href={href(date, s)}
            aria-current={s === season ? "page" : undefined}
            className={cn(SHUTTLE_CHIP, s === season ? SHUTTLE_CHIP_ON : SHUTTLE_CHIP_OFF)}
          >
            {SEASON_LABEL[s]}
          </Link>
        ))}
        {tripsReady && summary.running > 0 && (
          <Pill color={TONE_COLOR.info}>운행 중 {summary.running}</Pill>
        )}
        {/* 시각을 적는다 — "방금"은 10분 뒤에 거짓이 된다(신호가 온 적 없으면 아예 안 그린다). */}
        {lastSignalAt !== null && (
          <span className="text-green ml-auto text-[11.5px] font-bold whitespace-nowrap">
            <span className="num">{kstTimeOf(new Date(lastSignalAt))}</span> 갱신됨
          </span>
        )}
      </div>

      {/* 🔑 **왜 아직 비어 있는지를 한 번만** 말한다 — 카드마다 반복하면 잔소리가 된다. */}
      <div className="border-line bg-card text-text-dim rounded-2xl border border-dashed px-3 py-2.5 text-[12.5px] leading-relaxed">
        실시간 위치는 아직 <span className="text-foreground font-bold">자리만 잡혀</span> 있습니다.
        차량이 지도에 뜨려면 두 가지가 더 필요합니다 —{" "}
        <span className="text-foreground font-bold">① 운행 중 기사·동승 선생님 폰이 위치를 보내는 기능</span>{" "}
        <span className="text-foreground font-bold">② 카카오 지도 키</span>. 지금은{" "}
        <Link href={`/shuttle/live?d=${date}&season=${season}`} className="text-primary font-bold underline">
          운행 현황
        </Link>{" "}
        탭에서 어느 회차가 도는지·누가 탔는지를 볼 수 있습니다.
      </div>

      {/* 🔴 0243a 미적용 — 상태를 그리는 대신 **왜 안 보이는지**를 말한다(운행 현황과 같은 규약). */}
      {!tripsReady && (
        <div className="border-line bg-card text-text-dim rounded-2xl border border-dashed px-3 py-2 text-[12.5px]">
          운행 상태(출발·종료)는 마이그레이션 <span className="num">0243a</span>를 적용하면 보입니다.
        </div>
      )}

      {board.length === 0 && (
        <div className="border-line bg-card text-text-dim rounded-2xl border border-dashed p-8 text-center text-sm">
          이 날짜에 타기로 되어 있는 학생이 없습니다.
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {board.map((vehicle) => (
          <TrackVehicleCard
            key={vehicle.vehicleId}
            vehicle={vehicle}
            tripsReady={tripsReady}
            coordByStop={coordByStop}
          />
        ))}
      </div>
    </div>
  );
}
