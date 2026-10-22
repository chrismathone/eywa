"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { EmbedLink } from "@/components/embed-link";
import type { ExitStudent } from "@/features/enrollment/management-sheet";

/**
 * 관리현황 '등록 후 퇴원' 칸 — 숫자를 누르면 그 학생들(이름 · 퇴원일)이 뜨고, 이름을 누르면 그 학생의 **퇴원 상세**(퇴원 사유·퇴원보고서가
 * 있는 화면 `/withdrawals/[studentId]`)로 간다(원장 메모 *"퇴원보고서 연동 · 콜앤상담 연동"*). 0명이면 숫자만.
 */
export function ExitCohortCell({ students, title }: { students: readonly ExitStudent[]; title: string }) {
  const [open, setOpen] = useState(false);
  if (students.length === 0) return <span className="text-text-dim">0</span>;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-primary font-medium hover:underline" aria-label={`${title} — ${students.length}명 보기`}>
        {students.length}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>퇴원관리와 같은 기준의 퇴원일 · 이름을 누르면 퇴원 상세(사유·퇴원보고서)</DialogDescription>
          <ul className="divide-line-faint divide-y text-sm">
            {students.map((s) => (
              <li key={s.id} className="flex items-baseline justify-between gap-3 py-1.5">
                <EmbedLink href={`/withdrawals/${s.id}`} className="text-primary font-medium hover:underline">
                  {s.name}
                </EmbedLink>
                <span className="text-text-dim num text-xs whitespace-nowrap">
                  퇴원 {Number(s.withdrawnAt.slice(0, 4))}년 {Number(s.withdrawnAt.slice(5, 7))}월 {Number(s.withdrawnAt.slice(8, 10))}일
                </span>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}
