"use client";

import { ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import { useEmbed, withEmbed } from "@/components/workspace/embed-context";
import type { ChecklistTarget } from "../types";

/** 시험 반 고르기 — 반을 바꾸면 그 반의 달 자료를 새로 읽는다(주소 `?class=`). 창 안에서는 embed를 지킨다([[#133]]). */
export function ClassPicker({ targets, current, month }: { targets: ChecklistTarget[]; current: string; month: string }) {
  const embed = useEmbed();
  const href = (id: string) => {
    const raw = `/before-class?class=${id}&month=${month}`;
    return embed ? withEmbed(raw) : raw;
  };
  return (
    <ToolbarSegment label="반" wrap>
      {targets.map((t) => (
        <ToolbarSegmentItem key={t.id} active={t.id === current} href={href(t.id)}>
          {t.name}
          {t.teacherName ? <span className="ml-1 font-normal opacity-80">· {t.teacherName}</span> : null}
        </ToolbarSegmentItem>
      ))}
    </ToolbarSegment>
  );
}
