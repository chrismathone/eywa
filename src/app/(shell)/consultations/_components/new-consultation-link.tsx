"use client";

import type { ReactNode } from "react";
import { useOpenFormWindow } from "@/components/workspace/open-window-button";

/**
 * 학생을 고른 '새 상담 기록' 링크 — '상담 기록 추가' 버튼과 같은 길(`useOpenFormWindow`)로 연다. 녹음이 걸린 상담 작성 화면이
 * 있으면 새 작성 화면(창 = 새 작성 창 · 단일 화면 = `form=<id>`)이다(원장 2026-10-16). 종전 링크는 녹음 중인 작성 창으로
 * 옮기려다 막혔고, 단일 화면에서는 녹음이 걸린 작성 화면에 그대로 들어갔다. 새 탭으로 열기(가운데 클릭·Ctrl)는 브라우저에 맡긴다.
 */
export function NewConsultationLink({ studentId, className, children }: { studentId: string; className?: string; children: ReactNode }) {
  const open = useOpenFormWindow();
  const href = `/consultations/new?studentId=${encodeURIComponent(studentId)}`;
  return (
    <a
      href={href}
      className={className}
      onClick={(e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        open(href, "상담 기록 추가", e);
      }}
    >
      {children}
    </a>
  );
}
