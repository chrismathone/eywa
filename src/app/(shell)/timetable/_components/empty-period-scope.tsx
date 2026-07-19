"use client";

import type { CSSProperties, ReactNode } from "react";
import { PERIOD_ROW_H } from "@/features/timetable/lib/empty-period-rows";
import { useTimetableEdit } from "./edit-context";

/**
 * '빈 교시 접기'와 편집 모드의 공존 래퍼 — 편집 토글은 soft state(URL/서버를 안 거침)라 서버
 * 리렌더 없이 접힌 행을 **즉시** 평소 격자로 되돌려야 한다. 드롭 존 자체는 점유 셀 안에만
 * 등록되므로(빈 셀은 드롭 대상 아님) 접기가 편집 기능을 깨진 않지만, 접힌 격자는 평소와 지형이
 * 달라 편집 시야를 왜곡한다 → 편집 중엔 원형 복원. 두 채널을 함께 올린다:
 * ① CSS 변수 --tt-empty-h(기본 36px)를 풀 높이로 → 접힌 행·라벨 셀 높이가 전부 펼쳐짐.
 * ② .tt-editing 클래스 → 접힌 교시 라벨이 평소 두 줄 스타일로 복원(weekday-group-tables의
 *    `[.tt-editing_&]` 변형이 소비 — 높이만 펼치면 라벨이 압축 스타일로 남아 이웃 라벨과
 *    어긋난다, 2026-07-19 적대 리뷰 확정 LOW).
 * display:contents라 레이아웃(flex 자식 관계)엔 개입하지 않고 변수 상속·선택자 조상 역할만 한다.
 */
export function EmptyPeriodScope({ children }: { children: ReactNode }) {
  const { editing } = useTimetableEdit();
  return (
    <div
      className={editing ? "tt-editing contents" : "contents"}
      style={editing ? ({ "--tt-empty-h": `${PERIOD_ROW_H}px` } as CSSProperties) : undefined}
    >
      {children}
    </div>
  );
}
