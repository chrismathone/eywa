"use client";

import { TOOLBAR_CHIP, TOOLBAR_CHIP_OFF, TOOLBAR_CHIP_ON } from "@/components/toolbar-controls";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveAttendanceHideRetired } from "@/features/attendance/server/prefs-actions";

/**
 * 퇴직 담임 숨김 칩 — 원장 지시 2026-08-14 *"퇴직자 출석부 숨기기 추가 헤더에"*.
 *
 * ⚠️ 계정 귀속 설정이다(`users.ui_prefs.attendance.hideRetired`) — URL 파라미터로 만들지 않는다.
 *    서버가 강사 선택지를 좁혀 내려주므로 저장 후 `router.refresh()`(sort-select·period-mode와 같은 규약).
 * ⚠️ **숨긴 인원을 칩에 적는다** — 조용히 사라지면 "강사가 없어졌다"가 된다. 0명이면 숫자를 안 붙인다.
 */
export function HideRetiredToggle({ hidden, count }: { hidden: boolean; count: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      aria-pressed={hidden}
      title={
        hidden
          ? "퇴직한 담임을 강사 목록에서 숨기는 중입니다 — 그 반은 반 목록에 그대로 있습니다"
          : "퇴직한 담임도 강사 목록에 표시합니다"
      }
      onClick={() =>
        startTransition(async () => {
          await saveAttendanceHideRetired(!hidden);
          router.refresh();
        })
      }
      className={`${TOOLBAR_CHIP} ${hidden ? TOOLBAR_CHIP_ON : TOOLBAR_CHIP_OFF} ${pending ? "opacity-60" : ""}`}
    >
      퇴직자 숨김{count > 0 ? ` ${count}` : ""}
    </button>
  );
}
