import { GraduationCap, MapPin, MessagesSquare } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { TodaySlot } from "@/features/timetable/server/queries";

type EventStatus = "upcoming" | "ongoing" | "done";

const SUBJECT_META: Record<string, { icon: LucideIcon; label: string; colorClass: string }> = {
  math: { icon: GraduationCap, label: "수학", colorClass: "text-chart-1" },
  english: { icon: GraduationCap, label: "영어", colorClass: "text-chart-3" },
  korean: { icon: GraduationCap, label: "국어", colorClass: "text-chart-5" },
  science: { icon: GraduationCap, label: "과학", colorClass: "text-chart-2" },
};

const FALLBACK_META = {
  icon: MessagesSquare,
  label: "수업",
  colorClass: "text-muted-foreground",
} as const;

function shortTime(t: string) {
  return t.slice(0, 5);
}

function diffMinutes(start: string, end: string): number {
  const [sh, sm] = start.split(":");
  const [eh, em] = end.split(":");
  return Number(eh) * 60 + Number(em) - (Number(sh) * 60 + Number(sm));
}

export function TodayTimeline({ slots }: { slots: TodaySlot[] }) {
  const ongoing = slots.filter((s) => s.status === "ongoing").length;

  return (
    <section className="bg-card border-border flex h-full flex-col rounded-lg border">
      <header className="border-border flex items-center justify-between border-b px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">오늘의 일정</h2>
          <p className="text-muted-foreground mt-0.5 text-xs">
            <span className="num">총 {slots.length}건</span>
            {ongoing > 0 ? (
              <>
                {" "}· <span className="text-chart-4 num font-medium">진행 중 {ongoing}건</span>
              </>
            ) : null}
          </p>
        </div>
        <a
          href="/timetable"
          className="text-muted-foreground hover:text-foreground text-xs underline-offset-2 transition hover:underline"
        >
          시간표 →
        </a>
      </header>

      {slots.length === 0 ? (
        <div className="text-muted-foreground flex flex-1 items-center justify-center px-5 py-10 text-sm">
          오늘은 예정된 수업이 없습니다
        </div>
      ) : (
        <ol className="relative flex-1 px-5 py-3">
          <div className="bg-border absolute top-5 bottom-5 left-[5.625rem] w-px" aria-hidden />
          {slots.map((s) => (
            <TimelineRow key={s.id} slot={s} />
          ))}
        </ol>
      )}
    </section>
  );
}

function TimelineRow({ slot }: { slot: TodaySlot }) {
  const meta = SUBJECT_META[slot.subject] ?? FALLBACK_META;
  const Icon = meta.icon;

  const dotClass: Record<EventStatus, string> = {
    ongoing: "bg-chart-4 pulse-now",
    done: "bg-muted-foreground/25",
    upcoming: "bg-card border-border border-2",
  };

  const duration = diffMinutes(slot.startTime, slot.endTime);
  const rowClass = slot.status === "done" ? "opacity-55" : "";

  return (
    <li className={`grid grid-cols-[5rem_auto_1fr] items-start gap-3 py-3 ${rowClass}`}>
      <div className="num pt-0.5 text-right">
        <p
          className={`text-sm font-semibold ${
            slot.status === "done" ? "text-muted-foreground line-through" : "text-foreground"
          }`}
        >
          {shortTime(slot.startTime)}
        </p>
        <p className="text-muted-foreground text-[11px]">~{shortTime(slot.endTime)}</p>
      </div>

      <div className="flex flex-col items-center pt-1.5">
        <span className={`relative z-10 size-3 rounded-full ${dotClass[slot.status]}`} />
      </div>

      <div className="min-w-0 pb-1">
        <div className="flex items-baseline gap-2">
          <Icon className={`size-3.5 shrink-0 ${meta.colorClass}`} />
          <h3 className="truncate text-sm font-medium leading-tight">{slot.className}</h3>
        </div>
        <p className="text-muted-foreground mt-0.5 text-xs leading-snug">
          {slot.teacherName ? `${slot.teacherName} 강사` : "담임 미정"}
          {" · "}
          <span className="num">{slot.studentCount}명</span>
        </p>
        <div className="text-muted-foreground/80 mt-1.5 flex items-center gap-2.5 text-[11px]">
          {slot.classroomName ? (
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3" />
              {slot.classroomName}
            </span>
          ) : null}
          <span className="num">{duration}분</span>
        </div>
      </div>
    </li>
  );
}
