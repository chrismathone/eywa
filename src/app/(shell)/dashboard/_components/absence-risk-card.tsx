/**
 * 결석 위험 — 최근 14일 결석 ≥3건 학생 명단(이름 클릭=학생 상세 창). 카운트만 쓰던 데이터를 펼침.
 */
import { WindowLink } from "@/components/workspace/window-link";
import { DashCard, DashEmpty } from "./dash-card";
import type { AbsenceRisk } from "@/features/dashboard/server/queries";

const CAP = 6;

export function AbsenceRiskCard({ items }: { items: AbsenceRisk[] }) {
  const shown = items.slice(0, CAP);
  return (
    <DashCard
      title="결석 위험"
      count={items.length > 0 ? `${items.length}명` : undefined}
      href="/attendance"
      hrefLabel="출결 →"
    >
      {items.length === 0 ? (
        <DashEmpty>최근 14일 결석 위험 학생이 없습니다</DashEmpty>
      ) : (
        <ul className="divide-border min-h-0 flex-1 divide-y overflow-y-auto">
          {shown.map((s) => (
            <li key={s.studentId}>
              <WindowLink
                href={`/students/${s.studentId}?tab=attendance`}
                title={s.studentName}
                className="group flex items-center justify-between py-1.5"
              >
                <span className="text-foreground group-hover:text-primary text-[13px] font-medium">
                  {s.studentName}
                </span>
                <span className="text-danger num font-mono text-[11px]">14일 {s.absences}회</span>
              </WindowLink>
            </li>
          ))}
          {items.length > CAP ? (
            <li className="text-text-faint pt-2 text-[11px]">외 {items.length - CAP}명</li>
          ) : null}
        </ul>
      )}
    </DashCard>
  );
}
