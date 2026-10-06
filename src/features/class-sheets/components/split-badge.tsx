"use client";

import { TONE_SOFT } from "@/lib/design/semantic-color";

/**
 * 수업 나누기(0351a) 표식 — 이름 옆 작은 알약. `in`(그 시간 이 반으로 옴) = **나눔**, `out`(그 시간 다른 반) = **→ 다른 반**.
 * 🔴 문장(누가·언제·어디서)은 **글자로도** 남긴다(알약 옆 축약 + title) — hover는 모바일에서 없는 것과 같다.
 * 색은 시간표 '나눔' 박스와 같은 의미색 `info` 하나(같은 사실은 화면이 달라도 같은 색).
 */
export function SplitBadge({ split }: { split: { dir: "in" | "out"; note: string } | undefined }) {
  if (!split) return null;
  return (
    <span
      className={`ml-1 inline-block min-w-0 max-w-[14rem] truncate rounded-full whitespace-nowrap px-1.5 py-px text-xs font-bold ${TONE_SOFT.info}`}
      title={split.note}
    >
      {split.dir === "in" ? split.note : `나눔 ${split.note}`}
    </span>
  );
}
