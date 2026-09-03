"use client";

import type { ReactNode } from "react";
import { Minus, Plus } from "@/components/icons/eywa-icon-compat";
import {
  TABLE_SCALE_MAX,
  TABLE_SCALE_MIN,
  TABLE_SCALE_STEP,
  usePrefs,
} from "@/components/workspace/use-prefs";

/** 표 기본 글자 크기(px) — 배수의 기준. 안쪽 셀은 em이라 이 값만 키우면 함께 커진다. */
const BASE_PX = 13;

/**
 * 표 글자 크기 −/+ (원장 지시 2026-07-31: "텍스트 잘 안 보임").
 * 값은 개인 설정으로 영속(usePrefs) — 화면·시력이 사람마다 달라 학원 공통값으로 둘 수 없다.
 * SSR/첫 렌더는 기본 100%로 결정적이고, 저장값은 zustand persist가 mount 뒤 적용한다.
 */
export function StaffTableScaleControl() {
  const scale = usePrefs((s) => s.staffTableScale);
  const setScale = usePrefs((s) => s.setStaffTableScale);
  const btn =
    "border-line bg-card text-text-dim hover:border-primary/40 hover:text-primary flex size-7 items-center justify-center rounded-lg border transition disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div className="flex items-center gap-1" role="group" aria-label="표 글자 크기">
      <button
        type="button"
        className={btn}
        onClick={() => setScale(scale - TABLE_SCALE_STEP)}
        disabled={scale <= TABLE_SCALE_MIN}
        aria-label="글자 작게"
      >
        <Minus className="size-3.5" />
      </button>
      <span className="num text-text-dim w-10 text-center text-xs tabular-nums">{scale}%</span>
      <button
        type="button"
        className={btn}
        onClick={() => setScale(scale + TABLE_SCALE_STEP)}
        disabled={scale >= TABLE_SCALE_MAX}
        aria-label="글자 크게"
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}

/** 표를 감싸 글자 크기를 적용 — 안쪽 셀 크기는 em이라 이 한 곳만 바꾸면 전부 따라온다. */
export function StaffTableScaleBox({ children, className }: { children: ReactNode; className?: string }) {
  const scale = usePrefs((s) => s.staffTableScale);
  return (
    <div className={className} style={{ fontSize: `${(BASE_PX * scale) / 100}px` }}>
      {children}
    </div>
  );
}
