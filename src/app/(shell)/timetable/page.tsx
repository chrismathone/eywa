import { Calendar, MapPin } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { getWeeklySchedule, type ScheduleSlot } from "@/features/timetable/server/queries";

export const metadata = { title: "시간표 — eywa" };

const DAYS: { key: string; label: string }[] = [
  { key: "mon", label: "월" },
  { key: "tue", label: "화" },
  { key: "wed", label: "수" },
  { key: "thu", label: "목" },
  { key: "fri", label: "금" },
  { key: "sat", label: "토" },
];

const SUBJECT_LABEL: Record<string, string> = {
  math: "수학",
  english: "영어",
  korean: "국어",
  science: "과학",
};

const SUBJECT_ACCENT: Record<string, string> = {
  math: "border-l-chart-1 bg-chart-1/5",
  english: "border-l-chart-3 bg-chart-3/5",
  korean: "border-l-chart-5 bg-chart-5/5",
  science: "border-l-chart-2 bg-chart-2/5",
};

function shortTime(t: string) {
  return t.slice(0, 5);
}

export default async function TimetablePage() {
  const slots = await getWeeklySchedule();

  if (slots.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="시간표" description="요일별 주간 시간표" />
        <EmptyState
          icon={Calendar}
          title="시간표가 없습니다"
          description="시드 데이터를 확인하거나 반에 시간표를 추가하세요."
        />
      </div>
    );
  }

  const byDay = new Map<string, ScheduleSlot[]>();
  for (const s of slots) {
    if (!byDay.has(s.dayOfWeek)) byDay.set(s.dayOfWeek, []);
    byDay.get(s.dayOfWeek)!.push(s);
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => a.startTime.localeCompare(b.startTime));
  }

  return (
    <div className="space-y-6">
      <PageHeader title="시간표" description={`주간 반복 일정 · 총 ${slots.length}개 슬롯`} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {DAYS.map((d) => {
          const list = byDay.get(d.key) ?? [];
          return (
            <div
              key={d.key}
              className="bg-card border-border flex min-h-[280px] flex-col rounded-lg border"
            >
              <header className="border-border flex items-center justify-between border-b px-3 py-2.5">
                <h3 className="text-foreground text-sm font-semibold">{d.label}요일</h3>
                <span className="text-muted-foreground num text-xs">{list.length}건</span>
              </header>
              {list.length === 0 ? (
                <div className="text-muted-foreground flex flex-1 items-center justify-center text-xs">
                  수업 없음
                </div>
              ) : (
                <ul className="space-y-1.5 p-2">
                  {list.map((s) => (
                    <li
                      key={s.id}
                      className={`rounded-md border-l-2 p-2.5 ${SUBJECT_ACCENT[s.subject] ?? "border-l-border"}`}
                    >
                      <p className="num text-foreground text-xs font-semibold leading-none">
                        {shortTime(s.startTime)} – {shortTime(s.endTime)}
                      </p>
                      <p className="text-foreground mt-1.5 text-sm font-medium leading-tight">
                        {s.className}
                      </p>
                      <p className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px]">
                        <span>{SUBJECT_LABEL[s.subject] ?? s.subject}</span>
                        {s.teacherName ? <span>· {s.teacherName}</span> : null}
                        {s.classroomName ? (
                          <span className="inline-flex items-center gap-0.5">
                            <MapPin className="size-2.5" />
                            {s.classroomName}
                          </span>
                        ) : null}
                        <span className="num">· {s.studentCount}명</span>
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
