"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveAttendanceSort } from "@/features/attendance/server/prefs-actions";
import {
  ATTENDANCE_SORT_KEYS,
  ATTENDANCE_SORT_LABEL,
  parseAttendanceSortKey,
  type AttendanceSortKey,
} from "@/features/attendance/sort-rows";

/**
 * 출석부 행 정렬 선택.
 *
 * ⚠️ URL 파라미터가 아니라 **계정 설정**(`users.ui_prefs.attendance.sort`)에 저장한다 — 원장 상시 지시
 *    "모든 뷰 세팅은 계정 귀속". 다른 PC에서 열어도 같은 정렬로 열린다(localStorage는 포트 포함 origin
 *    단위라 "로그인은 그대로인데 설정만 리셋"으로 위장한다, #90).
 * ⚠️ 정렬은 **서버가 행 순서를 만들어** 내려주므로(격자 좌표와 같은 순서여야 방향키가 맞는다) 저장 후
 *    `router.refresh()`로 다시 받아야 한다 — 클라에서 다시 정렬하면 두 순서가 갈린다.
 */
export function AttendanceSortSelect({ value }: { value: AttendanceSortKey }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <select
      aria-label="정렬 기준"
      value={value}
      disabled={pending}
      onChange={(e) => {
        const next = parseAttendanceSortKey(e.target.value);
        if (next === value) return;
        startTransition(async () => {
          await saveAttendanceSort(next);
          router.refresh();
        });
      }}
      className="border-line bg-card text-foreground hover:bg-bg-soft h-8 rounded-lg border px-2 text-xs disabled:opacity-60"
    >
      {ATTENDANCE_SORT_KEYS.map((k) => (
        <option key={k} value={k}>
          {ATTENDANCE_SORT_LABEL[k]}
        </option>
      ))}
    </select>
  );
}
