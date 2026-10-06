"use client";

import { WindowLink } from "@/components/workspace/window-link";
import { tipProps } from "@/components/hover-tip/tip";
import { TONE_SOFT } from "@/lib/design/semantic-color";
import { SPLIT_DAY_KO } from "@/features/class-splits/rules";
import { splitTag, splitTipRows, type TimetableSplitLine } from "@/features/class-splits/lines";
import { HOLD_MAX_H } from "./class-cell";
import { NameMeta, metaLabel } from "./student-rows";
import { SectionLabelRow } from "./student-section";

/**
 * 반 칸 아래의 **'나눔' 박스**(수업 나누기 0351a) — 대기·퇴원·보강 박스와 **같은 부품·같은 모양**.
 * 줄 = `이름/학교학년 · →유형숙 17:20`(이 반에서 그 시간 빠짐) 또는 `· ←이성우 17:20`(그 시간 이 반으로 옴).
 *
 * 🔴 꼬리표(방향·선생님·시각)는 **글자로** 단다 — 같은 박스에 나가는 줄과 들어오는 줄이 섞이고, hover는
 *    모바일에서 없는 것과 같다(디자인 규약). 기간·반 이름은 hover 카드(`splitTipRows`).
 * 🔴 색 = 의미색 `info`(남이 하는 중 — 다른 선생님 시간) 하나. 보강(노랑)·이동 대기(보라)와 갈라 읽힌다.
 * 🔴 드래그·요일 편집 대상이 아니다(나눔은 수강이 아니다) — 이름을 누르면 원생 상세 창.
 */
export function SplitSection({
  lines,
  coveringDays,
  inline = false,
}: {
  lines: readonly TimetableSplitLine[];
  /** 이 칸이 덮는 요일 — 2일 이상이면 줄마다 어느 요일인지 적는다. */
  coveringDays?: string[];
  /** 재원 스크롤 **안**에 둘 때 — 자체 높이 상한·스크롤을 두지 않는다(바깥 재원 스크롤이 맡는다, 2줄 잘림 방지). */
  inline?: boolean;
}) {
  if (lines.length === 0) return null;
  const showDay = (coveringDays?.length ?? 0) >= 2;
  return (
    <div
      data-help="tt-split"
      className={`divide-line/40 shrink-0 divide-y border-t ${inline ? "" : "scrollbar-hide overflow-y-auto"}`}
      style={inline ? undefined : { maxHeight: HOLD_MAX_H }}
    >
      <SectionLabelRow label="나눔" count={lines.length} tone={TONE_SOFT.info} />
      {lines.map((l) => (
        <div
          key={l.key}
          {...tipProps({ title: l.name, meta: metaLabel(l.school, l.grade), rows: splitTipRows(l) })}
          className={`flex items-baseline justify-between gap-1.5 px-2 py-[3px] text-sm leading-tight select-none ${
            l.dir === "out" ? "text-text-dim" : "text-blue font-bold"
          }`}
        >
          <WindowLink
            href={`/students/${l.studentId}`}
            title={l.name}
            className="block min-w-0 overflow-hidden whitespace-nowrap text-clip hover:underline"
          >
            <NameMeta name={l.name} meta={metaLabel(l.school, l.grade)} />
            <span className="opacity-85"> · {splitTag(l)}</span>
          </WindowLink>
          {showDay ? <span className="shrink-0 text-xs font-bold">{SPLIT_DAY_KO[l.day]}</span> : null}
        </div>
      ))}
    </div>
  );
}

