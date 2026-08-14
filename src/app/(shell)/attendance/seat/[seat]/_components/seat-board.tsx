"use client";

import Link from "next/link";
import { seatHasJjFields } from "@/features/attendance/seat/jj-fields";
import type { SeatClassRoster } from "@/features/attendance/seat/server/queries";
import type { SeatKey } from "@/features/attendance/seat/seat";
import { useSeatBoardSaves } from "./seat-board-saves";
import { SeatJjTable } from "./seat-jj-table";
import { SeatLabGrid } from "./seat-lab-grid";

type PeriodChip = { start: string; ends: string[]; classIds: string[] };

/**
 * 자리 출석부 본문 — 교시 하나의 명단(반 그룹)을 그리고 그 자리에서 출결을 찍는다.
 *
 * 🔴 미체크는 **결석이 아니다**(아직 안 온 것). 자동 결석 판정은 없고, 결석은 사람이 누를 때만 찍힌다.
 * ⚠️ 낙관적 반영 — 32명을 훑는 화면이라 왕복을 기다리면 입실 줄이 밀린다. 실패하면 그 카드만 되돌린다.
 * JJ실은 여기에 듣기 레벨·누적 암기 단어수가 붙는다(랩실은 출결만).
 */
export function SeatBoard({
  seat,
  date,
  periods,
  activeStart,
  rosters,
  readOnly,
  hrefFor,
}: {
  seat: SeatKey;
  date: string;
  periods: PeriodChip[];
  activeStart: string;
  rosters: SeatClassRoster[];
  readOnly: boolean;
  hrefFor: string;
}) {
  const { pending, error, statusOf, mergeFields, save, fill, saveField } = useSeatBoardSaves(
    seat,
    date,
    activeStart,
  );
  const showJj = seatHasJjFields(seat);
  const view = mergeFields(rosters);
  const all = view.flatMap((r) => r.students.map((s) => statusOf(r.classId, s)));
  const total = all.length;
  const checked = all.filter((v) => v !== null).length;
  const waiting = total - checked;
  const listenN = view.flatMap((r) => r.students).filter((s) => s.listeningLevel).length;
  const wordsN = view.flatMap((r) => r.students).filter((s) => s.memorizedWords).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="toolbar-rail flex shrink-0 items-center gap-1.5 overflow-x-auto">
        {periods.map((p) => (
          <Link
            key={p.start}
            href={`${hrefFor}${p.start}`}
            className={`shrink-0 rounded-full border px-3 py-1 text-[13px] font-semibold tabular-nums transition ${
              p.start === activeStart
                ? "border-primary bg-primary text-primary-foreground"
                : "border-line text-text-dim hover:bg-bg-soft"
            }`}
          >
            {p.start}
            <span className="ml-1.5 text-[11px] font-medium opacity-80">{p.classIds.length}개 반</span>
          </Link>
        ))}
      </div>

      <div className="bg-card shadow-card flex shrink-0 flex-wrap items-center gap-3 rounded-2xl px-4 py-2.5">
        <span className="text-foreground text-[15px] font-bold tabular-nums">
          {activeStart}
          {view.length > 0 ? (
            <span className="text-text-dim ml-2 text-xs font-medium">
              {view.length}개 반 · {total}명
            </span>
          ) : null}
        </span>
        <span className="text-text-dim text-xs">
          체크 <strong className="text-foreground tabular-nums">{checked}</strong> / {total}
          {waiting > 0 ? <span className="ml-2">대기 {waiting}명</span> : null}
          {showJj ? (
            <span className="ml-2">
              듣기 {listenN} · 단어 {wordsN}
            </span>
          ) : null}
        </span>
        {!readOnly && waiting > 0 ? (
          <div className="ml-auto flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => fill("present")}
              className="border-primary bg-primary text-primary-foreground rounded-lg border px-3 py-1 text-xs font-semibold disabled:opacity-50"
            >
              남은 {waiting}명 출석
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => fill("absent")}
              className="border-att-absent text-att-absent-ink rounded-lg border px-3 py-1 text-xs font-semibold disabled:opacity-50"
            >
              남은 {waiting}명 결석
            </button>
          </div>
        ) : null}
      </div>

      {showJj ? (
        <p className="text-text-dim px-1 text-[12px]">
          듣기 레벨·누적 암기 단어수는 영어 시트 JJ 칸과 같은 기록입니다.
        </p>
      ) : null}
      {readOnly ? (
        <p className="text-text-dim bg-bg-soft/60 border-line rounded-xl border px-3 py-2 text-xs">
          지난 날짜는 보기만 가능합니다 — 수정이 필요하면 관리자에게 요청하세요.
        </p>
      ) : null}
      {error ? (
        <p className="text-att-absent-ink bg-att-absent/30 border-att-absent rounded-xl border px-3 py-2 text-xs">
          {error}
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
        {showJj ? (
          <SeatJjTable
            rosters={view}
            statusOf={statusOf}
            onSave={save}
            onSaveField={saveField}
            onFillClass={(classId) => fill("present", classId)}
            readOnly={readOnly}
            pending={pending}
          />
        ) : (
          <SeatLabGrid
            rosters={view}
            statusOf={statusOf}
            onSave={save}
            onFillClass={(classId) => fill("present", classId)}
            readOnly={readOnly}
            pending={pending}
          />
        )}
      </div>
    </div>
  );
}
