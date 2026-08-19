"use client";

import { Pill } from "@/components/atoms/pill";
import { EyIcon } from "@/components/icons/eywa-icons";
import { TONE_COLOR } from "@/lib/design/semantic-color";
import { DIRECTION_LABEL, runTimeRange, runTitle, type ShuttleRun } from "@/features/shuttle/types";
import type { RideRow } from "@/features/shuttle/roster";
import { firstTime, type Progress } from "@/features/shuttle/today-board";
import { RideRowItem } from "./ride-row-item";

/**
 * 회차 한 판 — 머리(접기 버튼) + 그날 줄. 머리는 **접힌 채로도 남은 일이 보여야** 한다.
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
  onError,
  onDone,
}: {
  run: ShuttleRun;
  rows: RideRow[];
  progress: Progress;
  open: boolean;
  onToggle: () => void;
  absentSet: Set<string>;
  date: string;
  canWrite: boolean;
  onError: (msg: string | null) => void;
  onDone: () => void;
}) {
  const start = firstTime(run);
  // 앞에 이미 출발 시각을 크게 세웠다 — 뒤 범위는 **끝시각만** 남긴다(같은 값을 두 번 읽히지 않게).
  const range = runTimeRange(run.stops);
  const tail = start && range.startsWith(start) ? range.slice(start.length) : range;
  return (
    <section className="bg-card flex flex-col rounded-2xl shadow-[var(--shadow-card)]">
      {/* 회차 머리 = 접기 버튼. 접힌 채로도 "몇 명 중 몇 명 남았는지"가 보여야 한다.
          🔴 **출발 시각이 맨 앞**이다 — 기사는 회차 번호가 아니라 다음 출발 시각으로 움직인다. */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex min-h-12 flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2.5 text-left"
      >
        {start && <span className="text-text num shrink-0 text-[16px] font-bold">{start}</span>}
        <Pill color={TONE_COLOR[run.direction === "in" ? "info" : "special"]}>
          {DIRECTION_LABEL[run.direction]}
        </Pill>
        <span className="text-text-dim text-[12.5px] font-bold">{runTitle(run)}</span>
        {tail && <span className="text-text-faint num text-[11.5px]">{tail}</span>}
        <span className="ml-auto flex items-center gap-1.5">
          {progress.unmarked > 0 ? (
            <span className="text-amber text-[11.5px] font-bold">
              <span className="num">{progress.unmarked}</span>명 남음
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
