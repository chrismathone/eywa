"use client";

import { useState } from "react";
import { ClassCell } from "./class-cell";
import type { ClassDetailQuick } from "@/components/class-detail-drawer";

const CELL_CAP = 5;

/**
 * 통합뷰 (요일×교시) 한 칸의 수업 목록 — 밀집 슬롯에서 8명 명단을 단 수업이 5개를 넘으면
 * 셀이 세로로 폭발한다. 기본 5개만 inline 렌더하고 "+N개 더"로 펼친다(≤5는 기존대로 드래그 유지).
 */
export function IntegratedCell({ slots }: { slots: ClassDetailQuick[] }) {
  const [showAll, setShowAll] = useState(false);
  // 빈 셀은 td가 틴트로 표시(텍스트 없음) — 호출측에서 빈 list는 렌더 안 함. 안전 가드로 null.
  if (slots.length === 0) return null;
  const visible = showAll ? slots : slots.slice(0, CELL_CAP);
  const rest = slots.length - visible.length;

  return (
    <div className="space-y-1.5">
      {visible.map((s) => (
        <ClassCell key={s.id} slot={s} />
      ))}
      {rest > 0 ? (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft w-full rounded-sm border border-dashed py-1 text-[10px] transition"
        >
          +{rest}개 더
        </button>
      ) : null}
    </div>
  );
}
