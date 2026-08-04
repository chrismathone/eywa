"use client";

import { useRouter } from "next/navigation";
import { Pill, type PillColor } from "@/components/atoms/pill";

export type ReviewTableRow = {
  id: string;
  date: string;
  teacherName: string;
  subjectLabel: string | null;
  subjectColor: PillColor | null;
  modeLabel: string;
  submitted: string; // "2/4"
  percent: string | null;
  grade: string | null;
};

/** 참관 목록 표 — **행 전체 클릭 = 상세 이동**(원장 지시 2026-08-04: 날짜만 클릭되던 것). */
export function ReviewTable({ rows }: { rows: ReviewTableRow[] }) {
  const router = useRouter();
  return (
    <div className="border-line bg-card overflow-x-auto rounded-2xl border shadow-card">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="border-line bg-bg-soft/60 border-b text-left">
            <th className="px-4 py-2.5 font-semibold">참관일</th>
            <th className="px-4 py-2.5 font-semibold">강사</th>
            <th className="px-4 py-2.5 font-semibold">과목</th>
            <th className="px-4 py-2.5 font-semibold">참관 방식</th>
            <th className="px-4 py-2.5 text-right font-semibold">제출</th>
            <th className="px-4 py-2.5 text-right font-semibold">환산점수</th>
            <th className="px-4 py-2.5 text-right font-semibold">등급</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              onClick={() => router.push(`/class-review/${r.id}`)}
              className="border-line/60 hover:bg-bg-soft/50 cursor-pointer border-b transition last:border-0"
            >
              <td className="num text-primary px-4 py-2.5 font-medium">{r.date || "—"}</td>
              <td className="px-4 py-2.5 font-medium">{r.teacherName || "—"}</td>
              <td className="px-4 py-2.5">
                {r.subjectLabel ? (
                  <Pill color={r.subjectColor ?? "neutral"} soft>
                    {r.subjectLabel}
                  </Pill>
                ) : (
                  "—"
                )}
              </td>
              <td className="text-text-dim px-4 py-2.5 text-xs">{r.modeLabel}</td>
              <td className="num px-4 py-2.5 text-right">{r.submitted}</td>
              <td className="num px-4 py-2.5 text-right font-semibold">{r.percent ?? "—"}</td>
              <td className="px-4 py-2.5 text-right">
                {r.grade ? (
                  <Pill color={r.grade === "재참관" ? "danger" : "primary"} soft>
                    {r.grade}
                  </Pill>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
