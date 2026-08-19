"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pill } from "@/components/atoms/pill";
import { TONE_COLOR } from "@/lib/design/semantic-color";
import { addDays, formatKoreanDate } from "@/lib/date-kst";
import {
  DIRECTION_LABEL,
  SEASONS,
  SEASON_LABEL,
  type Season,
  type ShuttleRun,
  type ShuttleVehicle,
} from "@/features/shuttle/types";
import { mergePlanAndLog, plannedRidesOn } from "@/features/shuttle/roster";
import { saveShuttleTodayPrefs } from "@/features/shuttle/server/today-prefs";
import {
  countProgress,
  filterByDirection,
  groupRunsByVehicle,
  sumProgress,
  type DirectionFilter,
} from "@/features/shuttle/today-board";
import type { BoardingLog } from "@/features/shuttle/server/queries";
import { RunPanel } from "./run-panel";
import { VehicleHeader } from "./vehicle-header";

/** 등하원 필터 칩 — 아침엔 등원만, 저녁엔 하원만 본다(폰에서 목록이 절반이 된다). */
const DIR_FILTERS: { value: DirectionFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "in", label: DIRECTION_LABEL.in },
  { value: "out", label: DIRECTION_LABEL.out },
];

/**
 * 오늘 등하원 — 회차마다 그날 예정 명단을 펼치고 한 줄씩 탑승/미탑승을 찍는다.
 *
 * 📱 **이 화면은 모바일이 1순위다**(원장 2026-08-19: *"셔틀 선생님은 모바일을 대부분 이용하시니까"*
 *    → *"아주 필요한 기능만 잘 있도록 호차 구분 및 시간 정리 등하원 체크 용이하게"*).
 *    · 날짜·시즌 칩은 `.toolbar-rail`로 눕힌다(좁은 화면에서 4줄로 감기던 자리).
 *    · **호차로 묶는다** — 차가 여럿이면 평평한 회차 목록에서 "지금 몇 호차를 보는지"가 사라져
 *      남의 차 회차를 자기 차로 착각한다. 호차 머리는 스크롤 중에도 붙어 있다(sticky).
 *    · **시각이 먼저다** — 기사는 회차 번호가 아니라 다음 출발 시각으로 움직인다(정렬도 시각 순).
 *    · **등원/하원 칩**으로 반을 덜어낸다 — 아침엔 등원만 보면 된다.
 *    · 회차는 **접힌 채로 시작**하고 아직 안 찍은 회차만 펼친다 — 폰에서 7회차를 다 펼치면
 *      다 끝난 회차를 지나 스크롤해야 오늘 할 일이 나온다.
 *    · 진행 요약(찍은 수/전체)을 호차·회차 머리에 둬서 **접힌 채로도 남은 일이 보인다**.
 *    PC는 2열 그리드 그대로 — 넓은 화면에선 한눈에 다 보이는 게 맞다.
 *
 * ⚠️ 묶음·정렬·집계는 순수 [`today-board.ts`](@/features/shuttle/today-board)가 한다(Vitest) —
 *    이 파일은 그리기만. 새 집계를 여기서 손으로 세지 말 것.
 *
 * 🔴 아직 안 찍은 줄은 **회색 '미기록'**이지 미탑승이 아니다 — 안 찍은 걸 미탑승으로 읽으면
 *    아침 내내 전원이 미탑승으로 보이고 그게 출결 신호로 새어나간다(roster 주석).
 */
export function DayBoardClient({
  date,
  season,
  vehicles,
  runs,
  logs,
  absentStudentIds,
  canWrite,
  initialDirection,
}: {
  date: string;
  season: Season;
  vehicles: ShuttleVehicle[];
  runs: ShuttleRun[];
  logs: BoardingLog[];
  /** 그날 출결이 결석·사유결석인 학생 — 🔴 표시만(셔틀 배정·기록을 바꾸지 않는다). */
  absentStudentIds: string[];
  canWrite: boolean;
  /** 계정에 저장된 등하원 보기(`users.ui_prefs.shuttleToday`) — 저녁마다 다시 누르지 않게. */
  initialDirection: DirectionFilter;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  /** 사람이 직접 접거나 편 회차 — 여기 없으면 "미기록이 남았나"로 자동 판정한다. */
  const [manualOpen, setManualOpen] = useState<Record<string, boolean>>({});
  /**
   * 등하원 보기 — 화면은 즉시 바꾸고 **계정 저장은 뒤따른다**(반응속도 1순위).
   * ⚠️ 주소에 안 싣는 이유는 서버 왕복(스켈레톤 깜빡임)을 피하기 위해서지만, 그렇다고 휘발시키면
   *    저녁마다 하원을 다시 눌러야 한다 → 보기 설정은 **계정 귀속**이 규칙이다(`users.ui_prefs`).
   */
  const [dirFilter, setDirFilter] = useState<DirectionFilter>(initialDirection);
  function pickDirection(next: DirectionFilter) {
    setDirFilter(next);
    // 저장 실패는 조용히 넘긴다 — 지금 화면은 이미 바뀌었고, 다음 방문에 옛 값으로 열릴 뿐이다.
    void saveShuttleTodayPrefs({ direction: next });
  }

  const absentSet = useMemo(() => new Set(absentStudentIds), [absentStudentIds]);

  /** 회차별 그날 줄 — 예정 × 기록. 기록은 회차 축으로 붙는다. */
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
        rows: mergePlanAndLog(plannedRidesOn(run, date), logsByRun.get(run.id) ?? []),
      }))
      .filter(({ rows }) => rows.length > 0);
  }, [runs, logs, date]);

  /** 화면에 실제로 그릴 것 — 등하원 필터를 먹인 뒤 호차로 묶는다(정렬·집계는 순수 모듈). */
  const groups = useMemo(
    () => groupRunsByVehicle(filterByDirection(byRun, dirFilter), vehicles),
    [byRun, dirFilter, vehicles],
  );
  /** 위 요약은 **보고 있는 것**의 합이다(필터를 걸면 같이 줄어야 "남은 일"이 맞는다). */
  const totals = useMemo(() => sumProgress(groups), [groups]);
  /** 필터 칩에 붙일 방향별 남은 수 — 누르기 전에 어느 쪽에 일이 남았는지 보인다. */
  const remainByDir = useMemo(() => {
    const of = (d: DirectionFilter) =>
      countProgress(filterByDirection(byRun, d).flatMap((r) => r.rows)).unmarked;
    return { all: of("all"), in: of("in"), out: of("out") };
  }, [byRun]);

  const href = (d: string, s: Season = season) => `/shuttle/today?d=${d}&season=${s}`;

  return (
    <div className="flex min-h-0 flex-col gap-3">
      {/* 날짜·시즌 — 좁은 화면에선 가로 레일 한 줄(감기지 않는다). 탭 타겟은 44px 이상. */}
      <div className="toolbar-rail flex flex-wrap items-center gap-2">
        <Link
          href={href(addDays(date, -1))}
          aria-label="어제"
          className="border-line hover:bg-muted flex h-11 items-center rounded-xl border px-3 text-[13px] font-bold"
        >
          ←
        </Link>
        <span className="text-text px-1 text-[14.5px] font-bold whitespace-nowrap">
          {formatKoreanDate(date)}
        </span>
        <Link
          href={href(addDays(date, 1))}
          aria-label="내일"
          className="border-line hover:bg-muted flex h-11 items-center rounded-xl border px-3 text-[13px] font-bold"
        >
          →
        </Link>
        {SEASONS.map((s) => (
          <Link
            key={s}
            href={href(date, s)}
            className={`rounded-pill flex h-11 items-center px-3.5 text-[13px] font-bold whitespace-nowrap ${
              s === season
                ? "bg-primary text-primary-foreground"
                : "border-line text-text-dim hover:bg-muted border"
            }`}
          >
            {SEASON_LABEL[s]}
          </Link>
        ))}
      </div>

      {/* 등하원 + 요약을 **한 레일**로 — 폰에서 상단 크롬이 세 줄이 되면 첫 호차까지 스크롤이 필요하다
          ("모바일 상단 크롬 = 한 줄" 규약 · 제보의 "아주 필요한 기능만"). 칩의 남은 수는 **필터와 무관한
          전체 기준**이라 누르기 전에 어느 쪽에 일이 있는지 보인다. */}
      <div className="toolbar-rail flex flex-wrap items-center gap-2 text-[12.5px]">
        <span className="flex items-center gap-1.5" role="radiogroup" aria-label="등하원 보기">
          {DIR_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              role="radio"
              aria-checked={dirFilter === f.value}
              onClick={() => pickDirection(f.value)}
              className={`rounded-pill flex h-11 items-center gap-1.5 px-3.5 text-[13px] font-bold whitespace-nowrap ${
                dirFilter === f.value
                  ? "bg-primary text-primary-foreground"
                  : "border-line text-text-dim hover:bg-muted border"
              }`}
            >
              {f.label}
              {remainByDir[f.value] > 0 && (
                <span className={`num text-[11.5px] ${dirFilter === f.value ? "" : "text-amber"}`}>
                  {remainByDir[f.value]}
                </span>
              )}
            </button>
          ))}
        </span>
        <span className="text-text-dim whitespace-nowrap">
          {/* 🔴 필터를 걸면 이 숫자는 **보고 있는 것**의 합이다 — 무엇의 합인지 밝히지 않으면 옆 칩의
              전체 기준 숫자와 어긋나 보인다. */}
          {dirFilter !== "all" && `${DIRECTION_LABEL[dirFilter]} `}예정{" "}
          <span className="num text-text font-bold">{totals.planned}</span>명
        </span>
        <Pill color={TONE_COLOR.positive}>탑승 {totals.boarded}</Pill>
        <Pill color={TONE_COLOR.critical}>미탑승 {totals.missed}</Pill>
        <Pill color={TONE_COLOR.inert}>미기록 {totals.unmarked}</Pill>
        {!canWrite && (
          <span className="text-text-faint whitespace-nowrap">열람 전용</span>
        )}
      </div>

      {error && (
        <div className="border-danger/30 bg-danger-soft text-danger rounded-xl border px-3 py-2 text-[12.5px]">
          {error}
        </div>
      )}

      {groups.length === 0 && (
        <div className="border-line bg-card text-text-dim rounded-2xl border border-dashed p-8 text-center text-sm">
          {/* 🔴 "없다"의 뜻을 가른다 — 필터 때문에 빈 것을 그날 아무도 안 탄 것처럼 말하지 않는다. */}
          {byRun.length === 0 || dirFilter === "all"
            ? "이 날짜에 타기로 되어 있는 학생이 없습니다."
            : `${DIRECTION_LABEL[dirFilter]}으로 타는 학생이 없습니다 — '전체'를 누르면 다 보입니다.`}
        </div>
      )}

      {groups.map((group) => (
        <section key={group.vehicleId} className="flex flex-col gap-2">
          <VehicleHeader group={group} dirFilter={dirFilter} />
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {group.runs.map(({ run, rows }) => {
              const progress = countProgress(rows);
              const open = manualOpen[run.id] ?? progress.unmarked > 0;
              return (
                <RunPanel
                  key={run.id}
                  run={run}
                  rows={rows}
                  progress={progress}
                  open={open}
                  onToggle={() => setManualOpen((m) => ({ ...m, [run.id]: !open }))}
                  absentSet={absentSet}
                  date={date}
                  canWrite={canWrite}
                  onError={setError}
                  onDone={() => router.refresh()}
                />
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
