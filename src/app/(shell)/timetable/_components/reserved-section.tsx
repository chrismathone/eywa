"use client";

import { WindowLink } from "@/components/workspace/window-link";
import { RESERVED_BADGE_CLASS, type TimetableReservedLine } from "@/features/attendance/makeup-reservation";
import { HOLD_MAX_H } from "./class-cell";
import { NameMeta, metaLabel } from "./student-rows";
import { SectionLabelRow } from "./student-section";

/**
 * 반 칸 아래의 **'보강' 박스** — 대기·퇴원 박스와 **같은 부품·같은 모양**(원장 2026-09-14 *"퇴원블록처럼
 * 보강블록이 있으면 됨"*): 머리 줄(`보강` + 인원 수) + `이름/학교학년` 줄 하나씩.
 *
 * 🔴 줄에 교시·결석일을 적지 않는다 — 줄이 길어지면 퇴원 블록과 모양이 어긋난다(원장 지시).
 *    그 정보는 **마우스 오버**(줄 껍데기 `title` = `reservationTitle`)가 진다.
 * 🔴 단 **남의 반에서 온 줄엔 원반 이름을 글자로** 단다(`… · TP4E`, 적대 리뷰 2026-09-14) — 한 박스에 이 반
 *    예약과 남의 반 예약이 같은 모양으로 서면 어느 반 보강인지 알 수 없고, `title` 툴팁은 **모바일에서 없는 것과
 *    같다**(디자인 규약). 이 칸의 반에서 온 줄엔 안 붙인다(그 칸이 곧 그 반이라 군더더기).
 * 🔴 머리 줄·이름 조각은 대기·퇴원과 **같은 부품**([`SectionLabelRow`](./student-section.tsx) ·
 *    [`NameMeta`](./student-rows.tsx))이다 — 여기서 마크업을 다시 적으면 그 순간부터 박스들이 갈린다.
 *    줄 tone만 예약 보라(`RESERVED_BADGE_CLASS`)다(대기=파랑·퇴원=검정처럼 섹션마다 제 색을 쓰는 규약).
 * 🔴 드래그·요일 편집 대상이 아니다(예약은 수강이 아니다) — 이름을 누르면 원생 상세 창.
 * ⚠️ `WindowLink`의 `title`은 **창 제목**이라 툴팁 문장을 싣지 않는다(줄 껍데기 `title`이 툴팁).
 */
export function ReservedSection({ lines }: { lines: readonly TimetableReservedLine[] }) {
  if (lines.length === 0) return null;
  return (
    <div
      className="scrollbar-hide divide-line/40 shrink-0 divide-y overflow-y-auto border-t"
      style={{ maxHeight: HOLD_MAX_H }}
    >
      {/* 🔴 머리 tone은 **대기·퇴원과 같다**(`bg-bg-soft text-text-faint`) — 이 격자의 규약은 "머리는 공통,
          줄만 섹션 색"이다(대기=파랑 · 퇴원=검정). 머리까지 보라로 칠하면 세 섹션 중 보강만 튀어서 원장이
          캡처로 가리킨 *"퇴원블록처럼"*에서 오히려 멀어진다. 줄 색만 예약 단일 소스(`RESERVED_BADGE_CLASS`). */}
      <SectionLabelRow label="보강" count={lines.length} tone="bg-bg-soft text-text-faint" />
      {lines.map((r) => (
        <div
          key={r.id}
          title={r.title}
          className={`px-2 py-[3px] text-sm leading-tight select-none ${RESERVED_BADGE_CLASS}`}
        >
          <WindowLink
            href={`/students/${r.studentId}`}
            title={r.name}
            className="block overflow-hidden whitespace-nowrap text-clip hover:underline"
          >
            <NameMeta name={r.name} meta={metaLabel(r.school, r.grade)} />
            {/* 남의 반 줄의 꼬리표 — 좁으면 줄 껍데기(`overflow-hidden … text-clip`)가 옆 조각들과 같은 규약으로 자른다. */}
            {r.fromClassName ? <span className="opacity-75"> · {r.fromClassName}</span> : null}
          </WindowLink>
        </div>
      ))}
    </div>
  );
}
