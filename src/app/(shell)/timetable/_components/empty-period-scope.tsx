"use client";

import type { CSSProperties, ReactNode } from "react";
import { PERIOD_ROW_H } from "@/features/timetable/lib/empty-period-rows";
import { useTimetableEdit } from "./edit-context";

/**
 * '빈 교시 접기'와 편집 모드의 공존 래퍼 — 접힌 빈 교시 행은 곧 드래그 드롭 존이라, 편집 모드가
 * 켜지면 서버 리렌더 없이 **즉시** 펼쳐야 한다(편집 토글은 soft state — URL/서버를 안 거친다).
 * 접힌 행 높이는 CSS 변수(--tt-empty-h, 기본 36px)를 쓰므로 여기서 변수만 풀 높이로 올리면
 * 표 전체가 리렌더 없이 확장된다. display:contents라 레이아웃(flex 자식 관계)엔 개입하지 않고
 * CSS 변수 상속만 통과시킨다.
 */
export function EmptyPeriodScope({ children }: { children: ReactNode }) {
  const { editing } = useTimetableEdit();
  return (
    <div
      className="contents"
      style={editing ? ({ "--tt-empty-h": `${PERIOD_ROW_H}px` } as CSSProperties) : undefined}
    >
      {children}
    </div>
  );
}
