"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FaceTabs } from "@/components/face-tabs";
import { Pill } from "@/components/atoms/pill";
import { EyIcon } from "@/components/icons/eywa-icons";
import { TONE_COLOR } from "@/lib/design/semantic-color";
import { addDays, formatKoreanDate } from "@/lib/date-kst";
import {
  DIRECTION_LABEL,
  SEASONS,
  SEASON_LABEL,
  runTimeRange,
  runTitle,
  type Season,
  type ShuttleRun,
  type ShuttleVehicle,
} from "@/features/shuttle/types";
import { SHUTTLE_TODAY_PATH, shuttleFaces } from "@/features/shuttle/faces";
import { mergePlanAndLog, plannedRidesOn, type RideRow } from "@/features/shuttle/roster";
import type { BoardingLog } from "@/features/shuttle/server/queries";
import { RideRowItem } from "./ride-row-item";

/**
 * 오늘 등하원 — 회차마다 그날 예정 명단을 펼치고 한 줄씩 탑승/미탑승을 찍는다.
 *
 * 📱 **이 화면은 모바일이 1순위다**(원장 2026-08-19: *"셔틀 선생님은 모바일을 대부분 이용하시니까"*).
 *    · 날짜·시즌 칩은 `.toolbar-rail`로 눕힌다(좁은 화면에서 4줄로 감기던 자리).
 *    · 회차는 **접힌 채로 시작**하고 아직 안 찍은 회차만 펼친다 — 폰에서 7회차를 다 펼치면
 *      다 끝난 회차를 지나 스크롤해야 오늘 할 일이 나온다.
 *    · 진행 요약(찍은 수/전체)을 회차 머리에 둬서 **접힌 채로도 남은 일이 보인다**.
 *    PC는 2열 그리드 그대로 — 넓은 화면에선 한눈에 다 보이는 게 맞다.
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
}: {
  date: string;
  season: Season;
  vehicles: ShuttleVehicle[];
  runs: ShuttleRun[];
  logs: BoardingLog[];
  /** 그날 출결이 결석·사유결석인 학생 — 🔴 표시만(셔틀 배정·기록을 바꾸지 않는다). */
  absentStudentIds: string[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  /** 사람이 직접 접거나 편 회차 — 여기 없으면 "미기록이 남았나"로 자동 판정한다. */
  const [manualOpen, setManualOpen] = useState<Record<string, boolean>>({});

  const absentSet = useMemo(() => new Set(absentStudentIds), [absentStudentIds]);
  const vehicleName = useMemo(() => new Map(vehicles.map((v) => [v.id, v.name])), [vehicles]);

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

  const totals = useMemo(() => {
    let planned = 0;
    let boarded = 0;
    let missed = 0;
    for (const { rows } of byRun) {
      for (const r of rows) {
        planned += 1;
        if (r.status === "boarded" || r.status === "extra") boarded += 1;
        else if (r.status === "missed") missed += 1;
      }
    }
    return { planned, boarded, missed, unmarked: planned - boarded - missed };
  }, [byRun]);

  const href = (d: string, s: Season = season) => `/shuttle/today?d=${d}&season=${s}`;

  return (
    <div className="flex min-h-0 flex-col gap-3">
      {/* 면 전환 — 📱 폰엔 사이드바(하부탭)가 없다. 이 화면엔 PageHeader가 없어(세로 아끼기)
          여기가 "지금 어느 면인지"를 알려 주는 자리이기도 하다(faces.ts). */}
      <FaceTabs faces={shuttleFaces(season)} active={SHUTTLE_TODAY_PATH} ariaLabel="셔틀 면 전환" />

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

      <div className="toolbar-rail flex flex-wrap items-center gap-2 text-[12.5px]">
        <span className="text-text-dim whitespace-nowrap">
          예정 <span className="num text-text font-bold">{totals.planned}</span>명
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

      {byRun.length === 0 && (
        <div className="border-line bg-card text-text-dim rounded-2xl border border-dashed p-8 text-center text-sm">
          이 날짜에 타기로 되어 있는 학생이 없습니다.
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {byRun.map(({ run, rows }) => {
          const unmarked = rows.filter((r) => r.status === null).length;
          const open = manualOpen[run.id] ?? unmarked > 0;
          return (
            <RunPanel
              key={run.id}
              run={run}
              vehicleLabel={vehicleName.get(run.vehicleId) ?? ""}
              rows={rows}
              unmarked={unmarked}
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
    </div>
  );
}

function RunPanel({
  run,
  vehicleLabel,
  rows,
  unmarked,
  open,
  onToggle,
  absentSet,
  date,
  canWrite,
  onError,
  onDone,
}: {
  run: ShuttleRun;
  vehicleLabel: string;
  rows: RideRow[];
  unmarked: number;
  open: boolean;
  onToggle: () => void;
  absentSet: Set<string>;
  date: string;
  canWrite: boolean;
  onError: (msg: string | null) => void;
  onDone: () => void;
}) {
  const range = runTimeRange(run.stops);
  return (
    <section className="bg-card flex flex-col rounded-2xl shadow-[var(--shadow-card)]">
      {/* 회차 머리 = 접기 버튼. 접힌 채로도 "몇 명 중 몇 명 남았는지"가 보여야 한다. */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex min-h-12 flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2.5 text-left"
      >
        <Pill color={TONE_COLOR[run.direction === "in" ? "info" : "special"]}>
          {DIRECTION_LABEL[run.direction]}
        </Pill>
        <span className="text-text text-[13.5px] font-bold">
          {vehicleLabel} {runTitle(run)}
        </span>
        {range && <span className="text-text-faint num text-[11.5px]">{range}</span>}
        <span className="ml-auto flex items-center gap-1.5">
          {unmarked > 0 ? (
            <span className="text-amber text-[11.5px] font-bold">
              <span className="num">{unmarked}</span>명 남음
            </span>
          ) : (
            <span className="text-green text-[11.5px] font-bold">완료</span>
          )}
          {/* ⚠️ 접기 표시를 ▲/▼ **문자**로 쓰지 말 것 — 아이콘 자리에 글리프를 세우는 건
              가드 테스트(eywa-icon-mapping)가 막는다. 폰트·플랫폼마다 크기가 널뛴다. */}
          <EyIcon
            name={open ? "chevronUp" : "chevronDown"}
            size={14}
            className="text-text-faint"
          />
        </span>
      </button>

      {open && (
        <ul className="flex flex-col gap-1.5 px-2.5 pb-2.5">
          {rows.map((row) => (
            <RideRowItem
              key={row.key}
              row={row}
              absentToday={absentSet.has(row.studentId)}
              date={date}
              canWrite={canWrite}
              onError={onError}
              onDone={onDone}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
