"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { usePrefs } from "@/components/workspace/use-prefs";
import {
  UI_FONT_SIZES,
  UI_FONT_SIZE_LABEL,
  UI_FONT_SIZE_ZOOM,
  type UiFontSize,
} from "@/lib/ui-prefs/font-size";
import { saveTimetableViewPrefs } from "@/features/timetable/server/view-prefs-actions";

// 시간표 글씨 크기(작음/보통/큼) — 원장 지시 2026-07-31 "ECS에 넣은 글씨 크기를 모든 시간표뷰에도.
// 지금을 작음(기본)으로". 색 강도 토글(color-mode-toggle)과 **완전히 같은 구조**다:
//   ① 클릭 = 스토어 즉시 반영(화면) + 계정 저장(영속, ui_prefs.timetable.fontSize)
//   ② 첫 렌더 = 서버가 내려준 계정값을 스토어에 주입(TimetableFontPrefSync)
// 그래서 다른 PC에서 열어도 같은 크기이고, 클릭 반응은 서버 왕복을 기다리지 않는다.

/**
 * 계정에 저장된 글씨 크기를 스토어에 주입(서버 → 클라 단방향).
 * ⚠️ 계정값이 **없으면(null) 손대지 않는다** — 기기 저장(localStorage)에 남은 선택을 지우지 않기 위해서.
 * ⚠️ zustand 스토어라 effect에서 set해도 `set-state-in-effect`(#25)에 걸리지 않는다(색 강도와 동일).
 */
export function TimetableFontPrefSync({
  fontSize,
}: {
  fontSize: UiFontSize | null;
}) {
  useEffect(() => {
    if (!fontSize) return;
    if (usePrefs.getState().timetableFontSize !== fontSize) {
      usePrefs.getState().setTimetableFontSize(fontSize);
    }
  }, [fontSize]);
  return null;
}

/** 뷰 설정 팝오버 '표시' 칸의 글씨 크기 3칩 — 색 강도 바로 아래. 모든 뷰에서 보인다. */
export function TimetableFontToggle() {
  const size = usePrefs((s) => s.timetableFontSize);
  const setSize = usePrefs((s) => s.setTimetableFontSize);
  // 같은 값 재저장 방지(연타·재렌더). ⚠️ 서버값으로 시드하지 말 것 — 팝오버가 닫힐 때 언마운트되는데
  // saveTimetableViewPrefs는 revalidate를 안 해서 stale한 값으로 다시 시드되고, 원래 값으로 되돌리는
  // 클릭이 막힌다(색 강도 토글에서 실제로 났던 회귀. 같은 이유로 null 시드).
  const sentRef = useRef<UiFontSize | null>(null);

  const pick = (next: UiFontSize) => {
    setSize(next); // ① 화면은 즉시
    if (sentRef.current === next) return;
    sentRef.current = next;
    // ⚠️ fontSize 키만 보낸다 — 저장은 부분 병합이라 다른 키를 함께 넘기면 그 값들이 덮인다.
    void saveTimetableViewPrefs({ fontSize: next }); // ② 계정에 영속(실패해도 화면은 안 막는다)
  };

  return (
    <div className="flex items-center gap-1">
      <span className="micro mr-1">글씨</span>
      {UI_FONT_SIZES.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => pick(s)}
          aria-pressed={size === s}
          title="모든 시간표 뷰의 글씨 크기(내 계정) — 다른 PC에서도 같은 크기로 열립니다"
          className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs transition ${
            size === s
              ? "border-primary bg-primary text-primary-foreground font-medium"
              : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
          }`}
        >
          {UI_FONT_SIZE_LABEL[s]}
        </button>
      ))}
    </div>
  );
}

/**
 * 시간표 판을 통째로 확대하는 래퍼 — 기본·통합·강사 **세 뷰 모두** 이걸로 감싼다.
 *
 * ⚠️ `font-size`가 아니라 **zoom**: 시간표는 교시 행 높이(px)·열 폭·셀 안 미니 라벨이 px로 짜인 격자라
 *    글자만 키우면 칸을 넘쳐 무너진다. zoom은 칸과 글자를 같은 비율로 키운다.
 * ⚠️ 기본('작음')은 배율 1이라 **style 자체를 안 붙인다** — 손대지 않은 사용자의 렌더는 완전 무변경
 *    (zoom 속성은 붙는 것만으로 새 formatting context를 만들어 sticky/overflow 계산을 바꿀 수 있다).
 * ⚠️ 기본뷰는 이 래퍼가 **DndContext 안쪽**에 있어야 한다 — 바깥에 두면 `position:fixed`인 DragOverlay가
 *    zoom 좌표계로 들어가 커서와 어긋난다. 안쪽이면 드롭 판정(rect·포인터 모두 뷰포트 좌표)은 그대로이고
 *    끌고 있는 칩만 1배로 남는다(표시상 차이).
 */
export function TimetableZoomArea({ children, scale }: { children: ReactNode; scale?: number }) {
  const fontZoom = UI_FONT_SIZE_ZOOM[usePrefs((s) => s.timetableFontSize)];
  const zoom = fontZoom * (scale ?? 1);
  if (zoom === 1) return <>{children}</>;
  return (
    // 🔴 `flex flex-col` 필수 — 안쪽 판(`min-h-0 flex-1` 스크롤 영역)이 높이를 받는 사슬이 여기서 끊기면
    //    표가 제 높이만큼 늘어나 **페이지가** 스크롤된다: 강사·요일 sticky 헤더가 안 붙고, 가로 스크롤바가
    //    표 맨 아래로 밀려난다(원장 제보 2026-10-06 — 글씨 크기를 키운 계정에서만 났다. 기본 '작음'은 이 래퍼가 없다).
    <div className="flex min-h-0 flex-1 flex-col" style={{ zoom }}>
      {children}
    </div>
  );
}
