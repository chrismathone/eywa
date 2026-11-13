"use client";

import { useState } from "react";
import { EyIcon } from "@/components/icons/aywa-icons";
import { StaffTaskDialog } from "./staff-task-dialog";

/** 강사 홈 '내 할 일' 줄의 단추 — 화면 언어(한국어/English)를 따른다. 창 안 내용은 한국어(할 일은 한국어 기록이다). */
export function MyTasksStripButton({ open, late, lang, className = "" }: { open: number; late: number; lang: "ko" | "en"; className?: string }) {
  const [shown, setShown] = useState(false);
  const label = lang === "en"
    ? `My tasks ${open}${late ? ` · ${late} overdue` : ""}`
    : `내 업무 ${open.toLocaleString("ko-KR")}건${late ? ` · 기한 초과 ${late.toLocaleString("ko-KR")}` : ""}`;
  return <>
    <button type="button" onClick={() => setShown(true)}
      className={`border-line hover:bg-bg-soft flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm font-bold ${late ? "text-danger" : "text-foreground"} ${className}`}>
      <EyIcon name="clipboardCheck" size={15} className="shrink-0" />
      <span className="min-w-0 flex-1">{label}</span>
      <span className="text-text-dim text-xs font-medium">{lang === "en" ? "Open ›" : "열기 ›"}</span>
    </button>
    {shown ? <StaffTaskDialog target={{ scope: "mine" }} onClose={() => setShown(false)} /> : null}
  </>;
}
