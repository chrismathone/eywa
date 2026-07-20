"use client";

import { WindowLink } from "@/components/workspace/window-link";
import { Pill } from "@/components/atoms/pill";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import type { ConsultationListRow } from "@/features/enrollment/server/queries";
import { EditingBadge } from "@/features/presence/editing-badge";
import { relativeTimeKo } from "@/lib/relative-time";
import { outcomePill } from "./outcome-meta";

function ymd(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 등록상담 목록(테이블) 뷰 — 칸반의 대안. 정렬은 상담일 내림차순(쿼리), 행 클릭=상세 창. ijw 테이블 뷰 이식. */
export function EnrollmentTable({ rows }: { rows: ConsultationListRow[] }) {
  return (
    <DragScrollArea className="bg-card border-line shadow-card rounded-2xl border">
      <table className="w-full text-sm [&_td]:whitespace-nowrap">
        <thead className="border-line text-text-dim border-b text-left text-xs [&_th]:whitespace-nowrap">
          <tr>
            <th className="px-4 py-3 font-normal">이름</th>
            <th className="px-4 py-3 font-normal">학년 · 학교</th>
            <th className="px-4 py-3 font-normal">연락처</th>
            <th className="px-4 py-3 font-normal">상태</th>
            <th className="px-4 py-3 font-normal">상담사</th>
            <th className="px-4 py-3 font-normal">상담일</th>
            <th className="px-4 py-3 text-right font-normal">경과</th>
          </tr>
        </thead>
        <tbody className="divide-line divide-y">
          {rows.map((c) => {
            // 수업 배정된 카드는 "배정 완료"로(칸반 카드와 동일 기준).
            const pill =
              c.assignedClassCount >= 1
                ? { label: "배정 완료", color: "primary" as const }
                : outcomePill(c.outcome);
            return (
              <tr key={c.id} className="hover:bg-bg-soft/40">
                <td className="px-4 py-2.5">
                  <WindowLink
                    href={`/enrollment/${c.id}`}
                    title={c.prospectName}
                    className="text-foreground font-medium hover:underline"
                  >
                    {c.prospectName}
                  </WindowLink>
                  <EditingBadge scope={`consultation:${c.id}`} className="ml-1.5" />
                </td>
                <td className="text-text-dim px-4 py-2.5 text-xs">
                  {c.prospectGrade ?? "—"}
                  {c.prospectSchool ? ` · ${c.prospectSchool}` : ""}
                </td>
                <td className="text-text-dim num px-4 py-2.5 text-xs">{c.parentPhone ?? "—"}</td>
                <td className="px-4 py-2.5">
                  <Pill color={pill.color} soft>
                    {pill.label}
                  </Pill>
                </td>
                <td className="text-text-dim px-4 py-2.5 text-xs">{c.consultantName ?? "—"}</td>
                <td className="text-text-dim num px-4 py-2.5 text-xs">{ymd(c.consultedAt)}</td>
                <td className="text-text-faint num px-4 py-2.5 text-right text-xs">
                  {relativeTimeKo(c.consultedAt)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </DragScrollArea>
  );
}
