/**
 * 학생상담 후속조치 — 기한 경과/임박 건을 긴급도와 함께. 원장이 매일 챙길 학부모 후속 연락.
 */
import { Pill, type PillColor } from "@/components/atoms/pill";
import { WindowLink } from "@/components/workspace/window-link";
import { DashCard, DashEmpty } from "./dash-card";
import type { DashFollowUp } from "@/features/dashboard/server/queries";

const URGENCY: Record<DashFollowUp["urgency"], { label: string; color: PillColor }> = {
  overdue: { label: "기한 경과", color: "danger" },
  today: { label: "오늘", color: "amber" },
  soon: { label: "임박", color: "gold" },
  later: { label: "예정", color: "neutral" },
  done: { label: "완료", color: "primary" },
  none: { label: "-", color: "neutral" },
};

export function FollowUpCard({
  items,
  canOpenStudents,
  unavailable = false,
}: {
  items: DashFollowUp[];
  canOpenStudents: boolean;
  unavailable?: boolean;
}) {
  return (
    <DashCard title="상담 후속조치" count={items.length > 0 ? `${items.length}건` : undefined} href="/consultations">
      {unavailable ? (
        <DashEmpty>후속조치를 불러오지 못했습니다. 상담 화면에서 확인해 주세요.</DashEmpty>
      ) : items.length === 0 ? (
        <DashEmpty>임박한 후속조치가 없습니다</DashEmpty>
      ) : (
        <ul className="divide-border min-h-0 flex-1 divide-y overflow-y-auto">
          {items.map((f) => {
            const u = URGENCY[f.urgency];
            return (
              <li key={f.id} className="flex items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    {canOpenStudents ? (
                      <WindowLink
                        href={`/students/${f.studentId}`}
                        title={f.studentName}
                        className="text-foreground truncate text-[13px] font-medium hover:underline"
                      >
                        {f.studentName}
                      </WindowLink>
                    ) : (
                      <span className="text-foreground truncate text-[13px] font-medium">{f.studentName}</span>
                    )}
                  </div>
                  <p className="text-text-faint truncate text-[11px]">{f.followUpAction ?? "후속 연락"}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Pill color={u.color}>{u.label}</Pill>
                  {f.followUpDate ? (
                    <span className="text-text-faint num text-[10px]">{f.followUpDate.slice(5)}</span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </DashCard>
  );
}
