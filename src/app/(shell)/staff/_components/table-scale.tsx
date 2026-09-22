"use client";

import type { ReactNode } from "react";
import { Minus, Plus } from "@/components/icons/aywa-icon-compat";
import { CONTROL_H, CONTROL_LABEL } from "@/components/ui/control-scale";
import { TABLE_SCALE_MAX, TABLE_SCALE_MIN, TABLE_SCALE_STEP } from "@/features/staff/list-prefs";
import { useStaffViewPrefs } from "./staff-view-prefs";

/** 표 기본 글자 크기(px) — 배수의 기준. v5 본문(16). 안쪽 셀은 em이라 이 값만 키우면 함께 커진다(옛 13은 v5 바닥 아래). */
const BASE_PX = 16;

/**
 * 표 글자 크기 −/+ (원장 지시 2026-07-31: "텍스트 잘 안 보임").
 * 진실은 **계정**(`ui_prefs.staff.tableScale`, 원장 2026-08-04 "뷰 세팅은 계정 귀속") — 값·저장은 `StaffViewPrefsProvider`가
 * 든다(서버 시드로 첫 렌더부터 계정값, 클릭은 즉시 반영 + 단일 큐 저장). 치수는 control-scale(높이 = 라벨 + 4).
 */
export function StaffTableScaleControl() {
  const { view, setScale } = useStaffViewPrefs();
  const scale = view.tableScale;
  const pick = setScale;
  const btn = `${CONTROL_H} w-(--control-h) border-line bg-card text-text-dim hover:border-primary/40 hover:text-primary flex items-center justify-center rounded-lg border transition disabled:cursor-not-allowed disabled:opacity-40`;
  return (
    <div className="flex items-center gap-1" role="group" aria-label="표 글자 크기">
      <button
        type="button"
        className={btn}
        onClick={() => pick(scale - TABLE_SCALE_STEP)}
        disabled={scale <= TABLE_SCALE_MIN}
        aria-label="글자 작게"
      >
        <Minus className="size-4" />
      </button>
      <span className={`num text-text-dim ${CONTROL_LABEL} min-w-12 px-1 text-center whitespace-nowrap tabular-nums`}>{scale}%</span>
      <button
        type="button"
        className={btn}
        onClick={() => pick(scale + TABLE_SCALE_STEP)}
        disabled={scale >= TABLE_SCALE_MAX}
        aria-label="글자 크게"
      >
        <Plus className="size-4" />
      </button>
    </div>
  );
}

/** 표를 감싸 글자 크기를 적용 — 안쪽 셀 크기는 em이라 이 한 곳만 바꾸면 전부 따라온다. */
export function StaffTableScaleBox({ children, className }: { children: ReactNode; className?: string }) {
  const scale = useStaffViewPrefs().view.tableScale;
  return (
    <div className={className} style={{ fontSize: `${(BASE_PX * scale) / 100}px` }}>
      {children}
    </div>
  );
}
