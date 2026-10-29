"use client";

import { useState } from "react";

/**
 * 원비 칸 — 첫 줄(퇴원월 청구 합계·미수)만 보이고 [자세히]를 누르면 수납 청구 줄이 펼쳐진다
 * (원장 2026-10-29 *"원비는 [자세히] 버튼 추가할것. [자세히] 버튼 클릭시 리스트 펼쳐지게"*). 인쇄하면 늘 펼친다.
 */
export function TuitionDetail({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [head, ...rest] = text.split("\n");
  return <div>
    <div className="flex flex-wrap items-center gap-2">
      <span>{head}</span>
      {rest.length > 0 && <button type="button" aria-expanded={open} onClick={() => setOpen(v => !v)}
        className="text-primary rounded border px-1.5 py-0.5 text-xs hover:underline print:hidden">{open ? "접기" : "자세히"}</button>}
    </div>
    {rest.length > 0 && <div className={`whitespace-pre-line ${open ? "" : "hidden print:block"}`}>{rest.join("\n")}</div>}
  </div>;
}
