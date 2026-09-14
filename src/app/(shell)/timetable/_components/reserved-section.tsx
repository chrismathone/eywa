"use client";

import { WindowLink } from "@/components/workspace/window-link";
import { RESERVED_BADGE_CLASS, type TimetableReservedLine } from "@/features/attendance/makeup-reservation";
import { HOLD_MAX_H } from "./class-cell";
import { metaLabel } from "./student-rows";

/**
 * 반 칸 아래의 **'보강' 줄** — 대기·퇴원 박스와 같은 자리·같은 모양(원장 2026-09-14 *"하단에 '대기'나 '퇴원'처럼
 * '보강' 리스트"*). 그 요일 칸 날짜에 이 반으로 보강 예약된 학생 — 옅은 보라(예약 칸·배지와 같은 색), 교시 칩, 툴팁 = 보강 정보.
 * 🔴 드래그·요일 편집 대상이 아니다(예약은 수강이 아니다) — 이름을 누르면 원생 상세 창.
 * ⚠️ `WindowLink`의 `title`은 **창 제목**이라 툴팁 문장을 싣지 않는다(줄 껍데기 `title`이 툴팁).
 */
export function ReservedSection({ lines }: { lines: readonly TimetableReservedLine[] }) {
  if (lines.length === 0) return null;
  return (
    <div className="scrollbar-hide divide-line/40 shrink-0 divide-y overflow-y-auto border-t" style={{ maxHeight: HOLD_MAX_H }}>
      <div className={`flex items-center justify-between px-2 py-px text-xs font-bold tracking-wide ${RESERVED_BADGE_CLASS}`}>
        <span>보강</span>
        <span className="num">{lines.length}</span>
      </div>
      {lines.map((r) => (
        <div key={r.id} title={r.title} className={`truncate px-2 py-[3px] text-sm leading-tight select-none ${RESERVED_BADGE_CLASS}`}>
          {r.periodLabel ? (
            <span className="bg-purple/60 mr-0.5 inline-block shrink-0 rounded-[2px] px-0.5 align-middle num text-xs leading-tight font-bold text-white">
              {r.periodLabel}
            </span>
          ) : null}
          <WindowLink href={`/students/${r.studentId}`} title={r.name} className="hover:underline">
            <span className="font-bold">{r.name}</span>
            {metaLabel(r.school, r.grade) ? <span className="text-text-faint">/{metaLabel(r.school, r.grade)}</span> : null}
          </WindowLink>
        </div>
      ))}
    </div>
  );
}
