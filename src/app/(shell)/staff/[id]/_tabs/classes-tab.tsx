import { WindowLink } from "@/components/workspace/window-link";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { Pill } from "@/components/atoms/pill";
import { EmptyState } from "@/components/empty-state";
import { GraduationCap } from "@/components/icons/aywa-icon-compat";
import { getStaffClasses, type WorkDay } from "@/features/staff/server/queries";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";

const DAY_LABEL: Record<WorkDay, string> = {
  mon: "월",
  tue: "화",
  wed: "수",
  thu: "목",
  fri: "금",
  sat: "토",
  sun: "일",
};

export async function ClassesTab({ staffId }: { staffId: string }) {
  const [classes, settings] = await Promise.all([getStaffClasses(staffId), getTenantSettings()]);
  const subjects = buildSubjectMaps(settings.operations.subjects);

  if (classes.length === 0) {
    return <EmptyState image="classes" icon={() => <GraduationCap size={32} strokeWidth={1.8} />} title="담당 수업이 없습니다" />;
  }

  return (
    <DragScrollArea className="bg-card border-line shadow-card rounded-2xl border">
      <table className="w-full min-w-[460px] text-sm">
        <thead>
          <tr className="border-line text-text-dim border-b text-left">
            <th className="px-4 py-2.5 font-medium">수업명</th>
            <th className="px-3 py-2.5 font-medium">과목</th>
            <th className="px-3 py-2.5 font-medium">요일·시간</th>
            <th className="px-3 py-2.5 text-right font-medium">인원</th>
            <th className="px-3 py-2.5 font-medium">상태</th>
          </tr>
        </thead>
        <tbody className="divide-line divide-y">
          {classes.map((c) => (
            <tr key={c.id} className="hover:bg-bg-soft transition">
              <td className="px-4 py-2.5">
                <WindowLink
                  href={`/classes/${c.id}`}
                  title={c.className}
                  className="text-foreground hover:text-primary font-medium hover:underline"
                >
                  {c.className}
                </WindowLink>
              </td>
              <td className="text-text-dim px-3 py-2.5">{subjects.labelOf(c.subject)}</td>
              <td className="px-3 py-2.5">
                {c.schedules.length === 0 ? (
                  <span className="text-text-faint text-xs">—</span>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {c.schedules.map((s, i) => (
                      <span key={i} className="border-line bg-bg-soft num rounded-sm border px-1.5 py-0.5 text-xs">
                        {DAY_LABEL[s.day]} {s.startTime}–{s.endTime}
                      </span>
                    ))}
                  </div>
                )}
              </td>
              <td className="tabular px-3 py-2.5 text-right">{c.studentCount}</td>
              <td className="px-3 py-2.5">
                {c.isActive ? (
                  <Pill color="primary" soft>
                    진행중
                  </Pill>
                ) : (
                  <Pill color="neutral" soft>
                    종료
                  </Pill>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </DragScrollArea>
  );
}
