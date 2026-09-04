"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { TOOLBAR_SELECT } from "@/components/toolbar-controls";
import { saveAttendanceSort } from "@/features/attendance/server/prefs-actions";
import {
  ATTENDANCE_SORT_KEYS,
  ATTENDANCE_SORT_LABEL,
  parseAttendanceSortKey,
  type AttendanceSortKey,
} from "@/features/attendance/sort-rows";

/**
 * 출석부 행 정렬 선택 — `정렬: 이름순` 드롭다운(지시서 §10, 2026-09-04 12단계: 옛 native `<select>` h-8·12px → 앱 공용 드롭다운 모양).
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
    <span className={`shrink-0 ${pending ? "opacity-60" : ""}`}>
      <SearchableSelect
        options={ATTENDANCE_SORT_KEYS.map((k) => ({ value: k, label: ATTENDANCE_SORT_LABEL[k] }))}
        value={value}
        onValueChange={(v) => {
          const next = parseAttendanceSortKey(v);
          if (next === value || pending) return;
          startTransition(async () => {
            await saveAttendanceSort(next);
            router.refresh();
          });
        }}
        ariaLabel="정렬 기준"
        valuePrefix="정렬"
        triggerClassName={TOOLBAR_SELECT}
        className="w-auto"
      />
    </span>
  );
}
