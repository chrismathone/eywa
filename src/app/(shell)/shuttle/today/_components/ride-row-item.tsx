"use client";

import { useState, useTransition } from "react";
import { Pill } from "@/components/atoms/pill";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TONE_COLOR } from "@/lib/design/semantic-color";
import {
  SHUTTLE_ACTION,
  SHUTTLE_CHIP,
  SHUTTLE_CHIP_OFF,
  SHUTTLE_INPUT,
  SHUTTLE_ROW_TEXT,
} from "@/features/shuttle/control-size";
import { BOARDING_STATUS_LABEL, type BoardingStatus } from "@/features/shuttle/types";
import type { RideRow } from "@/features/shuttle/roster";
import { clearBoarding, recordBoarding } from "@/features/shuttle/server/actions";

/**
 * 한 줄 = 그날 한 학생의 한 회차. [탑승][미탑승] 두 버튼이 전부다(makeedu의 승차/하차/미탑승 3버튼은
 * 승·하차가 이미 배정에 정해져 있어 매일 다시 고를 이유가 없었다).
 *
 * 📱 **폰에서 달리는 차 안에서 누른다**(원장 2026-08-19) — 그래서:
 *    · 크기는 [`control-size.ts`](@/features/shuttle/control-size) 한 곳에서 온다(폰 44px·입력 16px).
 *      ⚠️ 여기서 `h-…`/`text-…`를 직접 적지 말 것 — 그렇게 갈려서 "정렬이 떨어진다"가 나왔다.
 *    · 버튼은 좌우로 **꽉 차게** 나눠 오조작을 줄인다(desktop은 auto 폭).
 *    · 이름 줄과 버튼 줄을 **세로로 분리**(좁을 때) — 한 줄에 우겨넣으면 버튼이 손톱만 해진다.
 *
 * 🔴 **되돌릴 문을 잠그지 않는다**([[#103]]) — 이미 찍은 버튼을 다시 누르면 기록이 지워져
 *    '미기록'으로 돌아간다. 오클릭한 미탑승에서 빠져나올 길이 없으면 안 된다.
 * ⚠️ 미탑승 사유는 찍은 **뒤에** 적는다(사유를 먼저 요구하면 바쁜 아침에 아무도 안 찍는다).
 */
export function RideRowItem({
  row,
  absentToday,
  date,
  canWrite,
  onError,
  onDone,
}: {
  row: RideRow;
  /** 오늘 출결이 결석 — 🔴 표시만. 셔틀 기록을 자동으로 찍지 않는다(원장 2026-08-19 "신호만"). */
  absentToday: boolean;
  date: string;
  canWrite: boolean;
  onError: (msg: string | null) => void;
  onDone: () => void;
}) {
  const [busy, startTransition] = useTransition();
  const [memo, setMemo] = useState(row.memo ?? "");

  const boarded = row.status === "boarded" || row.status === "extra";

  function mark(status: BoardingStatus, nextMemo = memo) {
    onError(null);
    // 같은 버튼을 다시 누르면 = 취소(미기록으로 되돌리기). 미탑승은 사유를 적는 중일 수 있어 제외.
    if (row.status === status && row.logId && status !== "missed") {
      clear();
      return;
    }
    const fd = new FormData();
    fd.set("boardedOn", date);
    fd.set("studentId", row.studentId);
    fd.set("runId", row.runId);
    if (row.runStopId) fd.set("runStopId", row.runStopId);
    fd.set("ioKind", row.ioKind);
    fd.set("status", status);
    if (nextMemo.trim()) fd.set("memo", nextMemo.trim());
    startTransition(async () => {
      const res = await recordBoarding(fd);
      if (res?.error) onError(res.error);
      else onDone();
    });
  }

  function clear() {
    if (!row.logId) return;
    onError(null);
    const fd = new FormData();
    fd.set("id", row.logId);
    startTransition(async () => {
      const res = await clearBoarding(fd);
      if (res?.error) onError(res.error);
      else onDone();
    });
  }

  const tone = boarded
    ? "border-green/40 bg-green-soft"
    : row.status === "missed"
      ? "border-danger/40 bg-danger-soft"
      : "border-line";

  return (
    <li className={`flex flex-col gap-1.5 rounded-xl border p-2 sm:flex-row sm:items-center sm:gap-2 ${tone}`}>
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
        <span className="text-text text-[14px] font-bold sm:text-[12.5px]">
          {row.studentName || "(추가 탑승)"}
        </span>
        {absentToday && (
          // 배지는 수제로 그리지 않고 공용 `<Pill>` + tone 캐논(결석 = critical)에서 고른다 —
          // 화면 파일마다 배지를 깎으면 같은 뜻이 화면마다 다른 크기·색으로 갈린다(팔레트 v4).
          <span title="오늘 출결이 결석입니다 — 셔틀 기록은 자동으로 찍히지 않습니다">
            <Pill color={TONE_COLOR.critical}>오늘 결석</Pill>
          </span>
        )}
        <span className="text-text-faint min-w-0 truncate text-[11.5px]">
          {row.atTime && <span className="num">{row.atTime}</span>}
          {row.atTime && row.stopName && " · "}
          {row.stopName}
          {row.runStopId === null && " · 예정에 없던 탑승"}
        </span>
      </div>

      {canWrite ? (
        <div className="flex shrink-0 items-center gap-1.5">
          {/* 🔑 탑승·미탑승은 **상태가 남는 토글**이라 알약 칩이다(라운드 캐논: 눌러서 상태가 남으면
              칩, 동작만 하면 버튼) — 그래서 공용 `<Button>`이 아니라 `SHUTTLE_CHIP`을 쓴다.
              색은 의미색 캐논: 탄 것 = positive(초록) · 못 탄 것 = critical(빨강). */}
          <button
            type="button"
            disabled={busy}
            onClick={() => mark("boarded")}
            aria-pressed={boarded}
            className={cn(SHUTTLE_CHIP, "flex-1 sm:flex-none", boarded ? "bg-green text-white" : SHUTTLE_CHIP_OFF)}
          >
            탑승
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => mark("missed")}
            aria-pressed={row.status === "missed"}
            className={cn(
              SHUTTLE_CHIP,
              "flex-1 sm:flex-none",
              row.status === "missed" ? "bg-danger text-white" : SHUTTLE_CHIP_OFF,
            )}
          >
            미탑승
          </button>
          {row.status && row.logId && (
            // '취소'는 상태가 안 남는 **동작**이라 공용 `<Button>`(ghost)이다. 다만 줄 안 인라인
            // 액션이라 옆 칩과 같은 크기로 맞춘다(design-conventions의 "표/리스트 행 안" 예외).
            <Button
              variant="ghost"
              disabled={busy}
              onClick={clear}
              title="기록을 지워 '미기록'으로 되돌립니다"
              className={cn(SHUTTLE_ACTION, SHUTTLE_ROW_TEXT, "text-text-faint hover:text-text px-2")}
            >
              취소
            </Button>
          )}
        </div>
      ) : (
        <span className="text-text-dim shrink-0 text-[11.5px]">
          {row.status ? BOARDING_STATUS_LABEL[row.status] : "미기록"}
        </span>
      )}

      {row.status === "missed" && canWrite && (
        <input
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          onBlur={() => {
            if ((memo.trim() || null) !== (row.memo ?? null)) mark("missed", memo);
          }}
          maxLength={300}
          placeholder="미탑승 사유 (선택)"
          className={cn(SHUTTLE_INPUT, "w-full sm:w-44")}
        />
      )}
      {row.status === "missed" && !canWrite && row.memo && (
        <span className="text-danger shrink-0 text-[11.5px]">{row.memo}</span>
      )}
    </li>
  );
}
