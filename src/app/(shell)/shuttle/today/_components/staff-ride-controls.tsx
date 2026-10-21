"use client";

import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { ReasonDialog } from "@/features/shuttle/parent/components/reason-dialog";
import { VehicleRouteDialog } from "@/features/shuttle/parent/components/vehicle-route-dialog";
import { DIRECTION_LABEL, type Direction, type Season } from "@/features/shuttle/types";
import {
  loadStaffRideEditor,
  staffAbsentRide,
  staffSkipRide,
  type StaffRideEditor,
} from "@/features/shuttle/ride-change/server/staff-ride-actions";

/**
 * 셔틀 '오늘 등하원' 줄의 **직원 수정** — [등하원 수정] · [등원 안함]/[하원 안함](사용자 2026-10-06) · [결석](2026-10-21).
 * 🔑 [결석] = 그날 **등원·하원 둘 다 안 탐** + 사유(월별 '관리자 수정하기'의 결석과 같은 `staffAbsentRide` — 출석부는 건드리지 않는다).
 * 🔑 학부모 '수정하기'·'타지 않기'와 **같은 창·같은 규칙**이고 저장만 직원 액션으로 간다(`staff-ride-actions.ts`).
 * 🔑 학부모 수정과 **명확히 구별** — 버튼은 이름 줄 오른쪽(수정 무채색 · 안함 빨강), 창 머리에 '직원 수정', 줄에는 "관리자 · 이름"/"셔틀 선생님 · 이름"이 남는다.
 * ⚡ 노선 전체는 [수정]을 누를 때만 읽는다(줄마다 미리 싣지 않는다 — 오늘 등하원은 매일 여는 화면).
 */
// size-guard-ok: 이름 줄 옆 보조 버튼 28px — 사용자 2026-10-06 "수정·등원안함 버튼도 좀 줄여"(탑승·미탑승보다 작아야 위계가 선다).
const STAFF_BTN =
  "flex h-7 shrink-0 cursor-pointer items-center justify-center rounded-md border px-1.5 text-xs font-bold disabled:opacity-40";
/** 등하원 수정 = 무채색(사용자 2026-10-06 "수정의 색을 좀 없애줘") · 안함 = 빨강 — 둘이 섞이지 않는다. */
const EDIT_BTN = `${STAFF_BTN} border-line bg-card text-text-dim hover:bg-muted`;
const SKIP_BTN = `${STAFF_BTN} border-danger/40 bg-danger-soft text-danger`;

export function StaffRideControls({
  studentId,
  studentName,
  runId,
  ioKind,
  date,
  season,
  showSkip,
  onError,
  onDone,
}: {
  studentId: string;
  studentName: string;
  runId: string;
  ioKind: Direction;
  date: string;
  season: Season;
  /** 이미 탔거나 안 타는 줄이면 '안함'을 띄우지 않는다(서버도 다시 막는다). */
  showSkip: boolean;
  onError: (msg: string | null) => void;
  onDone: () => void;
}) {
  const [editor, setEditor] = useState<Extract<StaffRideEditor, { leg: unknown }> | null>(null);
  const [loading, startLoading] = useTransition();
  const word = DIRECTION_LABEL[ioKind];

  function openEditor() {
    onError(null);
    startLoading(async () => {
      const res = await loadStaffRideEditor({ studentId, onDate: date, ioKind, runId, season });
      if ("error" in res) onError(res.error);
      else setEditor(res);
    });
  }

  return (
    <div className="flex items-center gap-1">
      <button type="button" onClick={openEditor} disabled={loading} className={EDIT_BTN} title={`${studentName} ${word} 정류장·시간 수정(직원)`}>
        {loading ? "…" : "등하원 수정"}
      </button>
      {showSkip ? (
        <ReasonDialog
          triggerClassName={cn(SKIP_BTN)}
          trigger={<>{word} 안함</>}
          title={`직원 수정 · ${studentName} ${word} 안함`}
          description={`관리자·셔틀 선생님이 바꾸는 거예요. 이유를 짧게 남겨 주세요 — 변경 내역에 직원으로 남고 학부모 화면에도 바로 보여요.`}
          confirmLabel={`${word} 안함으로 저장`}
          placeholder="예: 어머니 전화 — 오늘은 직접 데려가요"
          onSubmit={async (reason) => {
            const res = await staffSkipRide({ studentId, onDate: date, ioKind, reason });
            if (!("error" in res)) onDone();
            return res;
          }}
        />
      ) : null}
      {showSkip ? (
        <ReasonDialog
          triggerClassName={cn(SKIP_BTN)}
          trigger={<>결석</>}
          title={`직원 수정 · ${studentName} 결석`}
          description="오늘 등원·하원 둘 다 안 타는 것으로 바꿔요. 이유를 짧게 남겨 주세요 — 변경 내역에 직원으로 남고 학부모 화면에도 바로 보여요. 출석부는 바뀌지 않아요."
          confirmLabel="결석으로 저장"
          placeholder="예: 감기로 결석 — 어머니 전화"
          onSubmit={async (reason) => {
            const res = await staffAbsentRide({ studentId, onDate: date, reason });
            if (!("error" in res)) onDone();
            return res;
          }}
        />
      ) : null}
      {editor ? (
        <VehicleRouteDialog
          key={`${studentId}|${ioKind}|${date}`}
          staff
          open
          onOpenChange={(next) => {
            if (!next) setEditor(null);
          }}
          onSaved={onDone}
          leg={editor.leg}
          other={editor.other}
          fleet={editor.fleet}
          dayLabel={`${studentName} · ${editor.dayLabel}`}
          onDate={date}
          today={editor.today}
          editable
        />
      ) : null}
    </div>
  );
}
