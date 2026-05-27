import { EyIcon } from "@/components/icons/eywa-icons";
import { Pill, type PillColor } from "@/components/atoms/pill";
import { EmptyState } from "@/components/empty-state";
import { requireAccess } from "@/lib/auth/require-access";
import { getWeeklySchedule, type ScheduleSlot } from "@/features/timetable/server/queries";

export const metadata = { title: "시간표 — eywa" };

const DAYS: { key: string; label: string; date?: number }[] = [
  { key: "mon", label: "월" },
  { key: "tue", label: "화" },
  { key: "wed", label: "수" },
  { key: "thu", label: "목" },
  { key: "fri", label: "금" },
  { key: "sat", label: "토" },
];

type SubjectColor = "primary" | "blue" | "rose" | "purple" | "amber";

const SUBJECT_META: Record<string, { label: string; color: SubjectColor }> = {
  math: { label: "수학", color: "primary" },
  english: { label: "영어", color: "blue" },
  korean: { label: "국어", color: "rose" },
  science: { label: "과학", color: "purple" },
  arts: { label: "예술", color: "amber" },
};

const FALLBACK_META = { label: "수업", color: "primary" as SubjectColor };

const COLOR_DOT: Record<SubjectColor, string> = {
  primary: "bg-primary",
  blue: "bg-blue",
  rose: "bg-rose",
  purple: "bg-purple",
  amber: "bg-amber",
};

const COLOR_CARD: Record<SubjectColor, string> = {
  primary: "border-l-primary bg-primary-softer",
  blue: "border-l-blue bg-blue-soft",
  rose: "border-l-rose bg-rose-soft",
  purple: "border-l-purple bg-purple-soft",
  amber: "border-l-amber bg-amber-soft",
};

function shortTime(t: string) {
  return t.slice(0, 5);
}

function todayKey(): string {
  const map = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  return map[new Date().getDay()] ?? "mon";
}

export default async function TimetablePage() {
  await requireAccess("timetable");
  const slots = await getWeeklySchedule();

  if (slots.length === 0) {
    return (
      <div className="space-y-5">
        <EmptyState
          icon={() => <EyIcon name="leaf" size={32} />}
          title="시간표가 없습니다"
          description="시드 데이터를 확인하거나 반에 시간표를 추가하세요."
        />
      </div>
    );
  }

  const today = todayKey();
  const byDay = new Map<string, ScheduleSlot[]>();
  for (const s of slots) {
    if (!byDay.has(s.dayOfWeek)) byDay.set(s.dayOfWeek, []);
    byDay.get(s.dayOfWeek)!.push(s);
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => a.startTime.localeCompare(b.startTime));
  }

  // 컬러 범례 (활성 과목만)
  const subjectsInUse = Array.from(new Set(slots.map((s) => s.subject)));

  return (
    <div className="space-y-5">
      {/* Filter strip */}
      <div className="bg-card border-line shadow-card flex flex-wrap items-center justify-between gap-3 rounded-xl border px-5 py-3">
        <div className="flex items-center gap-2.5">
          <p className="micro">주간 일정</p>
          <span className="text-text-dim font-mono text-xs">
            총 {slots.length}개 슬롯
          </span>
        </div>
        <div className="flex items-center gap-3">
          {subjectsInUse.map((sub) => {
            const meta = SUBJECT_META[sub] ?? FALLBACK_META;
            return (
              <span key={sub} className="text-text-dim flex items-center gap-1.5 text-[11px]">
                <span className={`size-2 rounded-full ${COLOR_DOT[meta.color]}`} />
                {meta.label}
              </span>
            );
          })}
        </div>
      </div>

      {/* Weekly grid */}
      <div className="bg-card border-line shadow-card overflow-hidden rounded-2xl border">
        <div className="grid grid-cols-6 divide-x divide-(--line)">
          {DAYS.map((d) => {
            const list = byDay.get(d.key) ?? [];
            const isToday = d.key === today;
            return (
              <div key={d.key} className="flex min-h-[360px] flex-col">
                <header
                  className={`flex items-center justify-between px-3.5 py-3 ${
                    isToday ? "bg-primary-softer text-primary" : "bg-bg-soft text-text-dim"
                  }`}
                >
                  <span className="text-sm font-bold tracking-tight">{d.label}요일</span>
                  <span className="num font-mono text-[11px]">{list.length}건</span>
                </header>
                {list.length === 0 ? (
                  <div className="text-text-faint flex flex-1 items-center justify-center text-xs">
                    수업 없음
                  </div>
                ) : (
                  <ul className="flex-1 space-y-1.5 p-2">
                    {list.map((s) => {
                      const meta = SUBJECT_META[s.subject] ?? FALLBACK_META;
                      return (
                        <li
                          key={s.id}
                          className={`rounded-lg border-l-[3px] px-3 py-2.5 ${COLOR_CARD[meta.color]}`}
                        >
                          <p className="num text-foreground text-[11px] font-bold leading-none">
                            {shortTime(s.startTime)} – {shortTime(s.endTime)}
                          </p>
                          <p className="text-foreground mt-1.5 text-[12px] font-bold leading-tight">
                            {s.className}
                          </p>
                          <p className="text-text-dim mt-1 truncate text-[10px]">
                            {s.teacherName ? `${s.teacherName} 강사` : "담임 미정"}
                          </p>
                          <div className="text-text-faint mt-1 flex items-center justify-between gap-1 text-[10px]">
                            {s.classroomName ? (
                              <span className="font-mono">{s.classroomName}</span>
                            ) : (
                              <span />
                            )}
                            <Pill color={meta.color} className="!text-[9px]">
                              {s.studentCount}명
                            </Pill>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
