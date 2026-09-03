"use client";

import { useMemo, useState } from "react";
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
  runTitle,
  type Season,
  type ShuttleRun,
  type ShuttleTrip,
  type ShuttleVehicle,
} from "@/features/shuttle/types";
import {
  SHUTTLE_ACTION,
  SHUTTLE_CHIP,
  SHUTTLE_CHIP_OFF,
  SHUTTLE_CHIP_ON,
} from "@/features/shuttle/control-size";
import { SHUTTLE_LIVE_PATH, shuttleFaces } from "@/features/shuttle/faces";
import { mergePlanAndLog, plannedRidesOn, type RideException } from "@/features/shuttle/roster";
import { groupRunsByVehicle } from "@/features/shuttle/today-board";
import {
  alertRuns,
  buildLiveBoard,
  progressLabel,
  shouldExpand,
  summarizeLive,
} from "@/features/shuttle/live-board";
import { RUN_ALERT_LABEL, RUN_ALERT_TONE } from "@/features/shuttle/trip-state";
import { useShuttleLive } from "@/features/shuttle/use-shuttle-live";
import type { BoardingLog } from "@/features/shuttle/server/queries";
import { LiveVehicleCard } from "./live-vehicle-card";


/**
 * 운행 현황(관제) — 차 전체를 한눈에 보고 **이상한 것만** 짚는다. 읽기 전용이다.
 *
 * 원장(2026-09-02): 동승 선생님이 폰에서 찍은 것을 **관리자가 본다**. 그래서 두 가지가 이 화면의 전부다:
 *   ① 지금 어느 차가 돌고 있나(운행 상태 0243a) ② 지금 손봐야 할 회차가 있나(경보).
 *
 * 🔴 **찍는 버튼이 없다** — 탑승 체크·출발/종료는 전부 `/shuttle/today`에 있다. 관제에서 같은 일을
 *    또 할 수 있게 만들면 두 화면이 서로 다른 조작 축을 갖게 되고, 게이트도 두 벌이 된다.
 * 🔴 **집계를 여기서 손으로 세지 않는다** — 묶음·진행은 `today-board`, 상태 겹치기와 요약은
 *    `live-board`가 한다(Vitest). 같은 숫자가 두 화면에서 달라지면 어느 쪽이 진실인지 알 수 없다.
 * 🔑 **등하원 필터가 없다** — 오늘 화면은 아침에 등원만 보려고 반을 덜어내지만, 관제는 "빠진 게
 *    없나"를 보는 자리라 덜어내면 목적이 무너진다(숨겨진 회차가 그대로 미기록으로 끝난다).
 */
export function LiveBoardClient({
  tenantId,
  date,
  season,
  vehicles,
  runs,
  logs,
  exceptions,
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
  /**
   * 그날 회차별 운행 기록(0243a). Map은 서버→클라 경계를 못 넘어 **엔트리 배열**로 받는다
   * (오늘 등하원 화면과 같은 모양 — 두 화면이 같은 재료를 다르게 받으면 한쪽만 고쳐진다).
   */
  trips: [string, ShuttleTrip][];
  /** 0243a 적용 여부. false면 상태·경보를 **아예 안 그린다**([[#95]]). */
  tripsReady: boolean;
  /** KST 오늘(서버가 내려준다) — 지난 날짜면 실시간 채널을 안 연다. */
  today: string;
}) {
  /** 사람이 직접 접거나 편 회차 — 여기 없으면 `shouldExpand`(운행 중·경보)로 자동 판정한다. */
  const [manualOpen, setManualOpen] = useState<Record<string, boolean>>({});

  // 남이 찍으면 이 화면이 스스로 갱신된다. 🔴 publish는 안 한다 — 여기선 아무것도 바꾸지 않는다.
  // 🔑 지난 날짜는 바뀔 일이 없어 채널을 안 연다(오늘 등하원 화면과 같은 판정).
  const { lastSignalAt } = useShuttleLive({
    tenantId,
    date,
    enabled: Boolean(tenantId) && date === today,
  });

  const tripsByRun = useMemo(() => new Map(trips), [trips]);

  /** 회차별 그날 줄 — 예정 × 기록(오늘 화면과 **같은 함수**를 탄다). */
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
  const alerts = useMemo(() => (tripsReady ? alertRuns(board) : []), [board, tripsReady]);

  const href = (d: string, s: Season = season) => `${SHUTTLE_LIVE_PATH}?d=${d}&season=${s}`;
  const openRuns = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const v of board) {
      for (const r of v.runs) map[r.run.id] = manualOpen[r.run.id] ?? shouldExpand(r);
    }
    return map;
  }, [board, manualOpen]);

  return (
    <div className="flex min-h-0 flex-col gap-3">
      {/* 📐 **면 전환 + 날짜 + 시즌을 한 줄로**(2026-09-03 밀도 개선) — 오늘 등하원 화면과 같은 모양.
          🔴 FaceTabs는 공용 컴포넌트라 손대지 않고 감싸는 자리만 바꾼다(min-w-0으로 줄어들고
             안에서 가로 스크롤한다). */}
      <div className="toolbar-rail flex flex-wrap items-center gap-2">
        <span className="min-w-0 basis-full sm:basis-auto">
          <FaceTabs faces={shuttleFaces(season)} active={SHUTTLE_LIVE_PATH} ariaLabel="셔틀 면 전환" />
        </span>
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
      </div>

      {/* 요약 — 숫자는 전부 `summarizeLive`에서 온다(여기서 세지 않는다). */}
      <div className="toolbar-rail flex flex-wrap items-center gap-2 text-[12.5px]">
        {/* 📐 **0인 숫자는 색 알약으로 강조하지 않는다**(2026-09-03) — 아침엔 여섯 알약 중 넷이 0이라
            아무 뜻 없이 눈을 끌었다. 관제에서 실제로 봐야 할 건 **지금 도는 것**(운행 중)과
            **남은 일**(미기록)이라, 그 둘만 색을 갖고 나머지는 0일 때 흐린 글자로 물러난다. */}
        {tripsReady && (
          <>
            {summary.running > 0 ? (
              <Pill color={TONE_COLOR.info}>운행 중 {summary.running}</Pill>
            ) : (
              <span className="text-text-faint whitespace-nowrap">
                운행 중 <span className="num">0</span>
              </span>
            )}
            <span className="text-text-dim whitespace-nowrap">
              출발 전 <span className="num">{summary.ready}</span>
            </span>
            <span className="text-text-dim whitespace-nowrap">
              종료 <span className="num">{summary.done}</span>
            </span>
            <span aria-hidden className="bg-line h-4 w-px shrink-0" />
          </>
        )}
        <span className="text-text-dim whitespace-nowrap">
          예정 <span className="num text-foreground font-bold">{summary.progress.planned}</span>명
        </span>
        {summary.progress.boarded > 0 && (
          <Pill color={TONE_COLOR.positive}>탑승 {summary.progress.boarded}</Pill>
        )}
        {summary.progress.missed > 0 && (
          <Pill color={TONE_COLOR.critical}>미탑승 {summary.progress.missed}</Pill>
        )}
        {summary.progress.unmarked > 0 && (
          <span className="text-amber whitespace-nowrap">
            <span className="num font-bold">{summary.progress.unmarked}</span>명 미기록
          </span>
        )}
        {/* 시각을 적는다 — "방금"은 10분 뒤에 거짓이 된다(신호가 온 적 없으면 아예 안 그린다). */}
        {lastSignalAt !== null && (
          <span className="text-green ml-auto text-[11.5px] font-bold whitespace-nowrap">
            <span className="num">{kstTimeOf(new Date(lastSignalAt))}</span> 갱신됨
          </span>
        )}
      </div>

      {/* 🔴 0243a 미적용 — 상태를 그리는 대신 **왜 안 보이는지**를 말한다(빈 화면은 고장으로 읽힌다). */}
      {!tripsReady && (
        <div className="border-line bg-card text-text-dim rounded-2xl border border-dashed px-3 py-2 text-[12.5px]">
          운행 상태(출발·종료)는 마이그레이션 <span className="num">0243a</span>를 적용하면 보입니다 —
          지금은 탑승 기록만 표시합니다.
        </div>
      )}

      {/* 지금 볼 것 — 🔴 아래 차 목록에서 이 회차를 **빼지 않는다**(두 자리에서 동시에 사라지면 안 된다). */}
      {alerts.length > 0 && (
        <section className="border-danger/30 bg-danger-soft flex flex-col gap-1.5 rounded-2xl border p-3">
          <h2 className="text-danger text-[13.5px] font-bold">지금 확인할 회차 {alerts.length}</h2>
          <ul className="flex flex-col gap-1">
            {alerts.map(({ vehicle, run }) => (
              <li key={run.run.id} className="flex flex-wrap items-center gap-2 text-[12.5px]">
                <span className="text-foreground font-bold">{vehicle.vehicleName}</span>
                <span className="text-text-dim">{runTitle(run.run)}</span>
                {run.alert !== "none" && (
                  <Pill color={TONE_COLOR[RUN_ALERT_TONE[run.alert]]}>
                    {RUN_ALERT_LABEL[run.alert]}
                  </Pill>
                )}
                <span className="text-text-faint num text-[11.5px]">
                  {progressLabel(run.progress)}
                </span>
                {vehicle.driverPhone && (
                  <a
                    href={`tel:${vehicle.driverPhone}`}
                    className="text-primary text-[11.5px] font-bold underline"
                  >
                    기사 전화
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {board.length === 0 && (
        <div className="border-line bg-card text-text-dim rounded-2xl border border-dashed p-8 text-center text-sm">
          이 날짜에 타기로 되어 있는 학생이 없습니다.
        </div>
      )}

      {board.map((vehicle) => (
        <LiveVehicleCard
          key={vehicle.vehicleId}
          vehicle={vehicle}
          tripsReady={tripsReady}
          openRuns={openRuns}
          onToggleRun={(runId, next) => setManualOpen((m) => ({ ...m, [runId]: next }))}
        />
      ))}
    </div>
  );
}
