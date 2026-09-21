"use client";

import { useState } from "react";
import { Printer, X } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";

// 회의록 인쇄 액션바 — 인쇄/닫기 + "전사 생략" 토글. 전사는 길어 본문(AI 8섹션)만 인쇄하고 싶을 때.
// 전사 섹션(#meeting-transcript)을 명령형으로 .hidden 토글(인쇄 페이지는 정적이라 안전·간단).
// embedded(창)면 window.close() 무효 → 닫기 숨김(창 X로 닫음).
export function MeetingPrintActions({
  embedded,
  hasTranscript,
}: {
  embedded?: boolean;
  hasTranscript?: boolean;
}) {
  const [omit, setOmit] = useState(false);
  function toggleTranscript(next: boolean) {
    setOmit(next);
    document.getElementById("meeting-transcript")?.classList.toggle("hidden", next);
  }
  return (
    <div className="sticky top-4 z-10 -mt-2 mb-8 flex flex-wrap items-center gap-2 print:hidden">
      {hasTranscript ? (
        <label className="border-line text-text-dim hover:bg-bg-soft mr-auto inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm">
          <input
            type="checkbox"
            checked={omit}
            onChange={(e) => toggleTranscript(e.target.checked)}
            className="accent-primary"
          />
          전사 생략
        </label>
      ) : null}
      <Button className={hasTranscript ? "" : "ml-auto"} onClick={() => window.print()}>
        <Printer className="size-4" /> 인쇄
      </Button>
      {embedded ? null : (
        <Button variant="secondary" onClick={() => window.close()}>
          <X className="size-4" /> 닫기
        </Button>
      )}
    </div>
  );
}
