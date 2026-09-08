"use client";

import type { CSSProperties, ReactNode } from "react";
import { periodRowFullHeight } from "@/features/timetable/lib/empty-period-rows";
import { useTimetableDragging } from "./drag-flag";

/**
 * '빈 교시 접기'와 드래그의 공존 래퍼 — **끄는 동안에만** 접힌 행을 평소 격자로 되돌린다(서버 리렌더 없이).
 * 드롭 존 자체는 점유 셀 안에만 등록되므로(빈 셀은 드롭 대상 아님) 접기가 이동을 깨진 않지만, 접힌 격자는
 * 평소와 지형이 달라 옮기는 동안 시야를 왜곡한다 → 그동안만 원형 복원.
 * ⚠️ 옛 '편집 모드'가 이 스위치였는데 모드가 사라졌다 — **권한(canDrag)으로 켜면 관리자에겐 접기가 영영
 *    안 걸린다**(설정을 켜도 화면이 안 접힌다). 그래서 판정은 `dragging`이다. 두 채널을 함께 올린다:
 * ① CSS 변수 --tt-empty-h(기본 36px)를 풀 높이로 → 접힌 행·라벨 셀 높이가 전부 펼쳐짐.
 * ② .tt-editing 클래스 → 접힌 교시 라벨이 평소 두 줄 스타일로 복원(weekday-group-tables의
 *    `[.tt-editing_&]` 변형이 소비 — 높이만 펼치면 라벨이 압축 스타일로 남아 이웃 라벨과
 *    어긋난다, 2026-07-19 적대 리뷰 확정 LOW).
 * display:contents라 레이아웃(flex 자식 관계)엔 개입하지 않고 변수 상속·선택자 조상 역할만 한다.
 */
export function EmptyPeriodScope({
  collapsed = false,
  hideStudents = false,
  children,
}: {
  collapsed?: boolean;
  /** 명단 접힘 — 펼칠 높이도 그 모드의 행 높이를 따라야 한다(안 그러면 빈 행만 176px로 튄다). */
  hideStudents?: boolean;
  children: ReactNode;
}) {
  // 접혀 있을 때만 구독한다 — 안 접힌 화면은 픽업에 아예 안 깨어난다(드래그 렉).
  const dragging = useTimetableDragging(collapsed);
  // ⚠️ **접혀 있을 때만** 켠다 — 안 접힌 화면에서 클래스를 붙였다 떼면 표 전체 스타일 재계산이 픽업 순간에
  //    몰린다(얻는 것은 0: 펼칠 접힌 행이 없다).
  const expand = dragging;
  return (
    <div
      className={expand ? "tt-editing contents" : "contents"}
      style={expand ? ({ "--tt-empty-h": `${periodRowFullHeight(hideStudents)}px` } as CSSProperties) : undefined}
    >
      {children}
    </div>
  );
}
