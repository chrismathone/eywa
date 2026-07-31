"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * 워크스페이스 사용자 설정(영속, localStorage "eywa-prefs").
 * animations=창 등장/퇴장/전환·교체 애니메이션 on/off. OFF면 즉시 전환(모션 0).
 * 이 설정이 **단일 기준** — 기본값만 OS '동작 줄이기'를 따르고, 한 번 토글하면 그 선택이
 * OS를 덮어쓴다(설정 ON이면 reduce-motion이어도 애니메이션을 보여줌). 토글은 UserMenu에서.
 *
 * sidebarExpanded=사이드바 펼침(아이콘+라벨)/접힘(아이콘만). 기본 접힘 — 컴팩트 레일 유지.
 * sidebarWidth=펼쳤을 때 너비(px). 오른쪽 경계선을 드래그해 조절하며(use-sidebar-resize),
 * 충분히 줄이면 접힘으로 스냅. 둘 다 새로고침해도 유지.
 */
/** 시간표 셀 색 강도(개인 설정) — vivid=시트처럼 쨍한 채움(기본), mid=중간, pastel=옛 옅은 파스텔. */
export type TimetableColorMode = "vivid" | "mid" | "pastel";

type PrefsState = {
  animations: boolean;
  setAnimations: (v: boolean) => void;
  sidebarExpanded: boolean;
  sidebarWidth: number;
  setSidebar: (expanded: boolean, width?: number) => void;
  toggleSidebar: () => void;
  /** 멀티윈도우 워크스페이스 첫 진입 코치마크를 봤는가(1회용). false면 데스크톱에서 안내 오버레이 노출. */
  onboarded: boolean;
  setOnboarded: (v: boolean) => void;
  /** 시간표 기본뷰 셀 색 강도 — 상단 토글에서 3중1택. 기본 vivid(쨍하게). */
  timetableColor: TimetableColorMode;
  setTimetableColor: (v: TimetableColorMode) => void;
  /**
   * 직원 목록 표 글자 크기(%) — 목록 위 −/+ 버튼(원장 지시 2026-07-31: 표 글씨가 작아 안 보임).
   * 100 = 기본 13px. 사람마다 화면·시력이 달라 개인 설정으로 둔다(영속).
   */
  staffTableScale: number;
  setStaffTableScale: (v: number) => void;
};

/** 표 글자 크기 허용 범위(%) — 너무 작으면 못 읽고, 너무 크면 열이 깨진다. */
export const TABLE_SCALE_MIN = 90;
export const TABLE_SCALE_MAX = 150;
export const TABLE_SCALE_STEP = 10;

export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      // SSR/첫 hydration은 결정적이어야 한다. 저장값이 없는 사용자의 OS 선호는 mount 뒤 아래 훅이 적용한다.
      animations: true,
      setAnimations: (animations) => set({ animations }),
      sidebarExpanded: false, // 기본 접힘(컴팩트 레일). 드래그/토글하면 영속.
      sidebarWidth: 216, // 펼침 기본 너비. 드래그로 조절.
      setSidebar: (sidebarExpanded, width) =>
        set((s) => ({ sidebarExpanded, sidebarWidth: width ?? s.sidebarWidth })),
      toggleSidebar: () => set((s) => ({ sidebarExpanded: !s.sidebarExpanded })),
      onboarded: false,
      setOnboarded: (onboarded) => set({ onboarded }),
      timetableColor: "vivid", // 기본 쨍하게(시트식). 개인이 상단 토글로 mid/pastel 선택 시 영속.
      setTimetableColor: (timetableColor) => set({ timetableColor }),
      staffTableScale: 100,
      setStaffTableScale: (v) =>
        set({ staffTableScale: Math.min(TABLE_SCALE_MAX, Math.max(TABLE_SCALE_MIN, Math.round(v))) }),
    }),
    { name: "eywa-prefs" },
  ),
);

/** 저장한 선택이 없는 최초 사용자에게만 mount 뒤 OS '동작 줄이기' 기본값을 적용한다. */
export function useApplyOsMotionDefault() {
  useEffect(() => {
    let hasStoredChoice = false;
    try {
      const raw = window.localStorage.getItem("eywa-prefs");
      if (raw) {
        const parsed = JSON.parse(raw) as { state?: { animations?: unknown } };
        hasStoredChoice = typeof parsed.state?.animations === "boolean";
      }
    } catch {
      // 손상된 저장값은 Zustand persist가 기본값으로 복구한다.
    }
    if (!hasStoredChoice && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      usePrefs.getState().setAnimations(false);
    }
  }, []);
}
