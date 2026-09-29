"use client";

import { tipProps } from "@/components/hover-tip/tip";
import { cnTipCard, type CnMatch } from "../classnote-match";

/**
 * 'C.N' 알약 — ClassNote 반 보드 매칭 상태(원장 2026-09-29). 초록 = 매칭, 빨강 = 매칭 실패.
 * 마우스를 올리면 반·반 보드·원아·사유 카드가 뜬다(`data-tip` — 문서마다 한 장인 HoverTipLayer가 그린다).
 * 카드 모드(student-list)와 표 모드(grid-row)가 **같은 부품**을 쓴다(두 화면이 다른 말을 하지 않게).
 * ⚠️ 판정은 `cnLabelFor`(classnote-match.ts)가 한다 — 여기선 그리기만. label이 null이면 아무것도 안 그린다.
 */
export function CnBadge({
  label,
  className,
}: {
  label: { ok: boolean; match: CnMatch | null } | null;
  className?: string | null;
}) {
  if (!label) return null;
  return (
    <span
      {...tipProps(cnTipCard(label, className))}
      aria-label={label.ok ? "ClassNote 반 매칭됨" : "ClassNote 반 매칭 실패"}
      className={`shrink-0 rounded-full px-1.5 py-px text-xs font-bold whitespace-nowrap ${
        label.ok ? "bg-green-soft text-green" : "bg-danger-soft text-danger"
      }`}
    >
      C.N
    </span>
  );
}
