import Link from "next/link";
import { AlertCircle } from "lucide-react";
import type { AbsenceRisk } from "@/features/dashboard/server/queries";

export function AbsenceRiskCard({ items }: { items: AbsenceRisk[] }) {
  return (
    <section className="bg-card border-border rounded-md border">
      <header className="border-border flex items-center justify-between border-b px-5 py-3">
        <div className="inline-flex items-center gap-2">
          <AlertCircle className="text-chart-4 size-4" />
          <h2 className="text-foreground text-sm font-semibold">결석 위험 학생</h2>
        </div>
        <p className="text-muted-foreground text-xs">최근 14일 결석 ≥3건</p>
      </header>
      {items.length === 0 ? (
        <p className="text-muted-foreground px-5 py-8 text-center text-sm">
          결석 위험 학생 없음
        </p>
      ) : (
        <ul className="divide-border max-h-72 divide-y overflow-auto">
          {items.slice(0, 8).map((r) => (
            <li key={r.studentId} className="flex items-center justify-between px-5 py-2.5">
              <Link
                href={`/students/${r.studentId}?tab=attendance`}
                className="text-foreground text-sm font-medium hover:underline"
              >
                {r.studentName}
              </Link>
              <span className="text-chart-4 num text-xs font-semibold">
                결석 {r.absences}회
              </span>
            </li>
          ))}
          {items.length > 8 ? (
            <li className="text-muted-foreground px-5 py-2 text-center text-xs">
              외 {items.length - 8}명
            </li>
          ) : null}
        </ul>
      )}
    </section>
  );
}
