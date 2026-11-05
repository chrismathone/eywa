/**
 * 면 탭 치수 — 실물([`face-tabs.tsx`](./face-tabs.tsx))과 스켈레톤([`face-tabs-skeleton.tsx`](./face-tabs-skeleton.tsx))이 **같은 문자열**을 쓴다.
 * 🔴 2026-11-05 스켈레톤 2차 검수: 1차 면 탭이 09-11에 폭 전체 밑줄(`border-b pb-1`)로 바뀌었는데 스켈레톤들은 손으로 그린
 *    `w-72 rounded-lg` 상자를 계속 그려 5px 낮고 밑줄이 없었다. 치수를 여기 한 곳에 두면 실물을 고칠 때 스켈레톤도 따라온다.
 * 이 파일에 `"use client"`를 붙이지 말 것 — 서버 컴포넌트인 `loading.tsx`가 스켈레톤을 통해 읽는다.
 */
export const FACE_TABS_NAV = "scrollbar-hide border-line flex min-h-(--control-h) items-stretch gap-1 overflow-x-auto";

/** 1차 = 폭 전체 밑줄 · 2차 = 내용 폭 테두리 상자. */
export const FACE_TABS_NAV_LEVEL = {
  primary: "border-b pb-1",
  secondary: "w-fit max-w-full rounded-lg border bg-bg-soft/40 px-0.5",
} as const;

/** 탭 한 칸의 상자(높이·라운드·안쪽 여백) — 글자·색·상태는 실물이 따로 얹는다. */
export const FACE_TAB_ITEM = "inline-flex h-(--control-h) shrink-0 items-center rounded-md px-2";
