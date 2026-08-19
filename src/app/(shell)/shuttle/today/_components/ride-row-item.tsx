"use client";

import { useState, useTransition } from "react";
import { BOARDING_STATUS_LABEL, type BoardingStatus } from "@/features/shuttle/types";
import type { RideRow } from "@/features/shuttle/roster";
import { clearBoarding, recordBoarding } from "@/features/shuttle/server/actions";

/**
 * 한 줄 = 그날 한 학생의 한 회차. [탑승][미탑승] 두 버튼이 전부다(makeedu의 승차/하차/미탑승 3버튼은
 * 승·하차가 이미 배정에 정해져 있어 매일 다시 고를 이유가 없었다).
 *
 * 📱 **폰에서 달리는 차 안에서 누른다**(원장 2026-08-19) — 그래서:
 *    · 버튼 높이 44px(h-11), 좌우로 **꽉 차게** 나눠 오조작을 줄인다(desktop은 auto 폭).
 *    · 이름 줄과 버튼 줄을 **세로로 분리**(좁을 때) — 한 줄에 우겨넣으면 버튼이 손톱만 해진다.
 *    · 사유 입력은 `text-base`(16px) — iOS가 16px 미만 입력에 자동 확대를 건다.
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
          <span
            className="rounded-pill bg-danger-soft text-danger px-1.5 py-[2px] text-[10.5px] font-bold"
            title="오늘 출결이 결석입니다 — 셔틀 기록은 자동으로 찍히지 않습니다"
          >
            오늘 결석
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
          <button
            type="button"
            disabled={busy}
            onClick={() => mark("boarded")}
            aria-pressed={boarded}
            className={`rounded-pill h-11 flex-1 px-4 text-[13px] font-bold transition-colors sm:h-8 sm:flex-none sm:text-[11.5px] ${
              boarded
                ? "bg-green text-white"
                : "border-line text-text-dim hover:bg-muted border"
            }`}
          >
            탑승
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => mark("missed")}
            aria-pressed={row.status === "missed"}
            className={`rounded-pill h-11 flex-1 px-4 text-[13px] font-bold transition-colors sm:h-8 sm:flex-none sm:text-[11.5px] ${
              row.status === "missed"
                ? "bg-danger text-white"
                : "border-line text-text-dim hover:bg-muted border"
            }`}
          >
            미탑승
          </button>
          {row.status && row.logId && (
            <button
              type="button"
              disabled={busy}
              onClick={clear}
              title="기록을 지워 '미기록'으로 되돌립니다"
              className="text-text-faint hover:text-text h-11 shrink-0 px-2 text-[12px] sm:h-8"
            >
              취소
            </button>
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
          // 16px 미만이면 iOS가 포커스 시 화면을 확대한다 — 좁은 화면에서만 text-base.
          className="border-line focus:border-primary h-11 w-full rounded-lg border px-2.5 text-base outline-none sm:h-8 sm:w-44 sm:text-[11.5px]"
        />
      )}
      {row.status === "missed" && !canWrite && row.memo && (
        <span className="text-danger shrink-0 text-[11.5px]">{row.memo}</span>
      )}
    </li>
  );
}
