import { ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import { addDays } from "@/lib/date-kst";
import type { JjRange } from "../range";

/** 학습 기간 빠른 선택(학습일). 30일이 기본(주소에 기간이 없을 때와 같다). */
export const JJ_RANGE_PRESETS = [7, 30, 90] as const;

/**
 * 학생 상세 JJ 구역의 **기간 줄** — 7·30·90일 + 지금 기간. 기간은 주소(`jjFrom`·`jjTo`)에 실린다 —
 * 성적관리 JJ실이 학생으로 넘어올 때 같은 기간을 그대로 싣는다.
 * 🔑 링크에 `#anchor`를 붙인다 — 주소만 바뀌면 페이지 맨 위로 튀어서, 누른 자리(JJ 구역)를 다시 찾아야 했다.
 * 🔴 주소에서 온 기간을 고쳤으면(1년 초과·미래·뒤바뀜) 그 사실을 적는다 — 조용히 다른 기간을 보여 주지 않게.
 */
export function JjRangeBar({
  baseHref,
  range,
  today,
  anchor,
}: {
  baseHref: string;
  range: JjRange;
  today: string;
  anchor: string;
}) {
  const fixed = range.clamped || range.endCapped || range.swapped || range.startFuture;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <ToolbarSegment label="기간">
        {JJ_RANGE_PRESETS.map((n) => {
          const from = addDays(today, -(n - 1));
          return (
            <ToolbarSegmentItem
              key={n}
              active={range.to === today && range.from === from}
              href={`${baseHref}&jjFrom=${from}&jjTo=${today}#${anchor}`}
            >
              {n}일
            </ToolbarSegmentItem>
          );
        })}
      </ToolbarSegment>
      <p className="micro">
        <span className="num text-foreground font-bold">
          {range.from} ~ {range.to}
        </span>{" "}
        · 학습일 기준(새벽 3시에 날이 바뀝니다)
        {fixed ? <span className="text-amber ml-1 font-bold">· 기간을 고쳐서 보여 줍니다(최대 1년 · 오늘까지)</span> : null}
      </p>
    </div>
  );
}
