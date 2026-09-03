"use client";

import { useActionState, useState } from "react";
import { UserCheck, UserMinus } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import { deactivateStaff } from "@/features/staff/server/actions";
import type { AssistClassRow, HomeroomClassRow } from "@/features/staff/server/queries";
import { OffboardDialog, type HandoverTeacher } from "./offboard-dialog";

/**
 * 퇴사/재직복구 트리거.
 *
 * 담임 반이든 **교시로만 들어가는 반**이든 남아 있으면 인계까지 함께 끝내는 다이얼로그를 띄운다.
 * ⚠️ 담임 반 유무만 보면 안 된다 — 담임 반 0개인데 남의 반 교시만 맡는 강사가 실제로 있고(실측
 *    2026-08-03 injaewon 2명), 그 사람은 경고 없이 퇴사돼 시간표에 퇴직자로 남았다.
 */
export function DeactivateButton({
  staffId,
  displayName,
  currentStatus,
  homeroomClasses,
  assistClasses,
  teacherOptions,
}: {
  staffId: string;
  displayName: string;
  currentStatus: "active" | "inactive" | "pending";
  homeroomClasses: HomeroomClassRow[];
  assistClasses: AssistClassRow[];
  /** 인계 후보(배정 가능한 재직 강사) — 넘길 반이 있을 때만 쓰인다. */
  teacherOptions: HandoverTeacher[];
}) {
  const [state, action] = useActionState(deactivateStaff, undefined);
  const [open, setOpen] = useState(false);
  const isInactive = currentStatus === "inactive";
  // 퇴사일(원장 지시 2026-08-07) — 기본값 오늘. 계약 이력에 '퇴사 (날짜)' 줄로 남는다.
  // ⚠️ new Date()를 렌더 중 부르면 RSC lint(#11)에 걸리므로 클라 컴포넌트인 여기서 lazy 초기값으로.
  const [resignDate, setResignDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });

  if (!isInactive && homeroomClasses.length + assistClasses.length > 0) {
    return (
      <>
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
          <UserMinus className="size-3.5" />
          퇴사 처리
        </Button>
        {open ? (
          <OffboardDialog
            staffId={staffId}
            displayName={displayName}
            classes={homeroomClasses}
            assistClasses={assistClasses}
            teacherOptions={teacherOptions}
            defaultResignDate={resignDate}
            onClose={() => setOpen(false)}
          />
        ) : null}
      </>
    );
  }

  return (
    <form
      action={action}
      onSubmit={(e) => {
        const msg = isInactive
          ? `${displayName} 직원을 재직 복구할까요?`
          : `${displayName} 직원을 퇴사 처리할까요? 로그인·목록에서 비활성됩니다 (기록은 보존).`;
        if (!confirm(msg)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={staffId} />
      <input type="hidden" name="next" value={isInactive ? "active" : "inactive"} />
      {/* 퇴사일 — 계약 이력에 '퇴사 (날짜)' 줄로 남는다. 복구 때는 받지 않는다. */}
      {isInactive ? null : (
        <label className="mr-2 inline-flex items-center gap-1.5">
          <span className="text-text-dim text-xs">퇴사일</span>
          <input
            type="date"
            name="resignDate"
            value={resignDate}
            onChange={(e) => setResignDate(e.target.value)}
            className="border-line bg-card num rounded-lg border px-2 py-1 text-xs outline-none"
          />
        </label>
      )}
      <Button type="submit" variant="outline" size="sm">
        {isInactive ? <UserCheck className="size-3.5" /> : <UserMinus className="size-3.5" />}
        {isInactive ? "재직 복구" : "퇴사 처리"}
      </Button>
      {state?.error ? <span className="text-chart-4 ml-2 text-xs">{state.error}</span> : null}
      {/* 렌더 시점 목록이 stale해 경고 없이 지나갔는데 서버가 담임 반을 발견한 경우 — 사후 안내(차단 아님) */}
      {state?.ok && (state.homeroomCount ?? 0) > 0 ? (
        <span className="text-amber ml-2 text-xs">
          담임인 진행중 반 {state.homeroomCount}개가 남아 있습니다 — 각 반에서 강사 인수인계를
          진행하세요.
        </span>
      ) : null}
    </form>
  );
}
