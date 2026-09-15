"use client";

import { WindowLink } from "@/components/workspace/window-link";
import { tipProps } from "@/components/hover-tip/tip";
import {
  dowKoOf,
  RESERVED_BADGE_CLASS,
  reservationTipRows,
  type TimetableReservedLine,
} from "@/features/attendance/makeup-reservation";
import { HOLD_MAX_H } from "./class-cell";
import { NameMeta, metaLabel } from "./student-rows";
import { SectionLabelRow } from "./student-section";

/**
 * 반 칸 아래의 **'보강' 박스** — 대기·퇴원 박스와 **같은 부품·같은 모양**(원장 2026-09-14 *"퇴원블록처럼
 * 보강블록이 있으면 됨"*): 머리 줄(`보강` + 인원 수) + `이름/학교학년` 줄 하나씩.
 *
 * 🔴 줄에 교시·결석일을 적지 않는다 — 줄이 길어지면 퇴원 블록과 모양이 어긋난다(원장 지시).
 *    그 정보는 **hover 카드**(`tipProps` + [`reservationTipRows`](@/features/attendance/makeup-reservation))가 진다.
 *    🔴 `title`(브라우저 기본 툴팁)로 되돌리지 말 것 — 원장 2026-09-15 *"툴팁이 이렇게 생겼으면 좋겠어 메모같이
 *    생기지 않고"*(시간표 학생 카드 모양). 둘 다 달면 카드 옆에 회색 메모 상자가 겹쳐 뜬다.
 * 🔴 단 **남의 반에서 온 줄엔 원반 이름을 글자로** 단다(`… · TP4E`, 적대 리뷰 2026-09-14) — 한 박스에 이 반
 *    예약과 남의 반 예약이 같은 모양으로 서면 어느 반 보강인지 알 수 없고, hover는 **모바일에서 없는 것과
 *    같다**(디자인 규약). 이 칸의 반에서 온 줄엔 안 붙인다(그 칸이 곧 그 반이라 군더더기).
 * 🔴 **요일 표식**(`목`)은 이 칸이 **여러 요일을 덮을 때만** 붙는다(원장 2026-09-15 *"이렇게 붙어있는 수업은
 *    그냥 붙어있게 표시해줘"*) — 월+목 병합 칸은 쪼개지 않으므로, 어느 날 보강인지를 줄이 직접 말해야 한다.
 *    한 요일짜리 칸엔 안 붙인다(그 칸이 곧 그 요일이라 군더더기).
 * 🔴 머리 줄·이름 조각은 대기·퇴원과 **같은 부품**([`SectionLabelRow`](./student-section.tsx) ·
 *    [`NameMeta`](./student-rows.tsx))이다 — 여기서 마크업을 다시 적으면 그 순간부터 박스들이 갈린다.
 *    줄 tone만 예약 보라(`RESERVED_BADGE_CLASS`)다(대기=파랑·퇴원=검정처럼 섹션마다 제 색을 쓰는 규약).
 * 🔴 드래그·요일 편집 대상이 아니다(예약은 수강이 아니다) — 이름을 누르면 원생 상세 창.
 * ⚠️ `WindowLink`의 `title`은 **창 제목**이라 툴팁 문장을 싣지 않는다(카드가 툴팁이다).
 */
export function ReservedSection({
  lines,
  coveringDays,
}: {
  lines: readonly TimetableReservedLine[];
  /** 이 칸(병합 블록)이 덮는 요일 — 2일 이상이면 줄마다 **어느 요일 보강인지**를 적는다. */
  coveringDays?: string[];
}) {
  if (lines.length === 0) return null;
  const showDay = (coveringDays?.length ?? 0) >= 2;
  return (
    <div
      data-help="tt-makeup"
      className="scrollbar-hide divide-line/40 shrink-0 divide-y overflow-y-auto border-t"
      style={{ maxHeight: HOLD_MAX_H }}
    >
      {/* 🔴 머리 띠는 **보강만 쨍한 노랑**이다(원장 2026-09-15 *"보강은 다른것과 다르게 배경색을 쨍한 노란계열로"*).
          ⚠️ 09-14의 *"머리 tone은 대기·퇴원과 같다"*를 원장이 **뒤집은 것**이다 — 그때는 "퇴원블록처럼"이 근거였는데,
          화면을 보고 나니 보강은 오히려 **눈에 띄어야 하는 줄**이라고 정했다. 되돌리지 말 것.
          🔴 색은 전용 토큰 `--makeup-band`다 — 형광펜(`--marker`)은 "한 화면에 하나" 가드가 붙어 있어 못 빌린다.
          ⚠️ **이 칸에 서는 다른 노랑은 `--search-hit`**(#fff200, 검색에 걸린 원생 줄)이고 둘 다 굵다 — 서로 대비가
             1.11:1이라 **더 가까이 가면 한 덩어리로 읽힌다**. 띠 색을 더 쨍하게 올리자는 말이 나오면 이걸 볼 것.
          줄 색은 그대로 예약 단일 소스(`RESERVED_BADGE_CLASS`). */}
      <SectionLabelRow label="보강" count={lines.length} tone="bg-makeup-band text-foreground" />
      {lines.map((r) => {
        // 요일 한 글자는 **보강일에서** 뽑는다(요일 키를 따로 싣지 않는다 — 날짜가 진실이다).
        const day = showDay ? dowKoOf(r.makeupDate) : "";
        return (
          <div
            key={r.id}
            {...tipProps({ title: r.name, meta: metaLabel(r.school, r.grade), rows: reservationTipRows(r) })}
            className={`flex items-baseline justify-between gap-1.5 px-2 py-[3px] text-sm leading-tight select-none ${RESERVED_BADGE_CLASS}`}
          >
            {/* 🔴 보강 줄만 **굵게**(원장 2026-09-15 *"보강 학생도 글자 볼드 처리해주고"*) — 대기·퇴원 줄은 그대로다.
                조각(`NameMeta`)은 셋이 공유하므로 굵기는 **이 줄 껍데기에서만** 얹는다(조각을 건드리면 셋 다 굵어진다). */}
            <WindowLink
              href={`/students/${r.studentId}`}
              title={r.name}
              className="block min-w-0 overflow-hidden font-bold whitespace-nowrap text-clip hover:underline"
            >
              <NameMeta name={r.name} meta={metaLabel(r.school, r.grade)} />
              {/* 남의 반 줄의 꼬리표 — 좁으면 줄 껍데기(`overflow-hidden … text-clip`)가 옆 조각들과 같은 규약으로 자른다. */}
              {r.fromClassName ? <span className="opacity-75"> · {r.fromClassName}</span> : null}
            </WindowLink>
            {day ? <span className="shrink-0 text-xs font-bold">{day}</span> : null}
          </div>
        );
      })}
    </div>
  );
}
