/**
 * Timeline — 시안 사양: [54px 시간 컬럼] [일정 카드]
 * 진행중: ${color}0d 배경 + 1.5px solid 보더
 * 완료: opacity 0.55
 * 그 외: bgSoft 배경 + line 보더
 */
import { EyIcon, type EywaIconName } from "@/components/icons/eywa-icons";
import { Pill } from "@/components/atoms/pill";
import type { TodaySlot } from "@/features/timetable/server/queries";

type SubjectColor = "primary" | "blue" | "rose" | "amber" | "purple";

const SUBJECT_META: Record<string, { color: SubjectColor; icon: EywaIconName; label: string }> = {
  math: { color: "primary", icon: "leaf", label: "수학" },
  english: { color: "blue", icon: "leaf", label: "영어" },
  korean: { color: "rose", icon: "leaf", label: "국어" },
  science: { color: "purple", icon: "leaf", label: "과학" },
};

const FALLBACK_META = { color: "primary" as SubjectColor, icon: "leaf" as EywaIconName, label: "수업" };

const COLOR_BORDER: Record<SubjectColor, string> = {
  primary: "border-primary bg-primary-softer",
  blue: "border-blue bg-blue-soft",
  rose: "border-rose bg-rose-soft",
  amber: "border-amber bg-amber-soft",
  purple: "border-purple bg-purple-soft",
};

const COLOR_ICON_BG: Record<SubjectColor, string> = {
  primary: "bg-primary-soft text-primary",
  blue: "bg-blue-soft text-blue",
  rose: "bg-rose-soft text-rose",
  amber: "bg-amber-soft text-amber",
  purple: "bg-purple-soft text-purple",
};

function shortTime(t: string) {
  return t.slice(0, 5);
}

function diffMinutes(start: string, end: string): number {
  const [sh, sm] = start.split(":");
  const [eh, em] = end.split(":");
  return Number(eh) * 60 + Number(em) - (Number(sh) * 60 + Number(sm));
}

const KO_TODAY = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric" });

export function TodayTimeline({ slots }: { slots: TodaySlot[] }) {
  const ongoing = slots.filter((s) => s.status === "ongoing").length;
  const todayLabel = KO_TODAY.format(new Date());

  return (
    <section className="bg-card border-line shadow-card flex h-full flex-col overflow-hidden rounded-2xl border">
      <header className="flex items-center justify-between px-6 pt-5 pb-3">
        <div>
          <p className="text-primary font-mono text-[11px] tracking-wider uppercase">
            오늘 · {todayLabel}
          </p>
          <h2 className="text-foreground mt-1 text-[17px] font-bold">오늘의 일정</h2>
        </div>
        {ongoing > 0 ? (
          <Pill color="rose">● 진행 중 {ongoing}건</Pill>
        ) : (
          <a href="/timetable" className="text-text-dim hover:text-foreground text-xs">
            시간표 →
          </a>
        )}
      </header>

      {slots.length === 0 ? (
        <div className="text-text-dim flex flex-1 items-center justify-center px-5 py-10 text-sm">
          오늘은 예정된 수업이 없습니다
        </div>
      ) : (
        <ul className="flex-1 space-y-2 px-5.5 pb-5">
          {slots.map((slot) => (
            <TimelineRow key={slot.id} slot={slot} />
          ))}
        </ul>
      )}
    </section>
  );
}

function TimelineRow({ slot }: { slot: TodaySlot }) {
  const meta = SUBJECT_META[slot.subject] ?? FALLBACK_META;
  const duration = diffMinutes(slot.startTime, slot.endTime);
  const isOngoing = slot.status === "ongoing";
  const isDone = slot.status === "done";

  const cardClass = isOngoing
    ? `border-[1.5px] ${COLOR_BORDER[meta.color]}`
    : isDone
      ? "border-line bg-bg-soft opacity-55"
      : "border-line bg-bg-soft";

  return (
    <li className={`flex items-stretch gap-3 ${isDone ? "" : ""}`}>
      <div className="w-[54px] shrink-0 pt-2 text-right">
        <p className="num text-foreground text-xs font-semibold">{shortTime(slot.startTime)}</p>
        <p className="text-text-faint mt-0.5 font-mono text-[10px]">{duration}분</p>
      </div>
      <div className={`flex flex-1 items-center gap-3 rounded-xl border px-3.5 py-2.5 ${cardClass}`}>
        <span
          className={`flex size-8 shrink-0 items-center justify-center rounded-md ${COLOR_ICON_BG[meta.color]}`}
        >
          <EyIcon name={meta.icon} size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-foreground truncate text-[13px] font-bold">{slot.className}</h3>
          <p className="text-text-dim truncate text-[11px]">
            {slot.teacherName ? `${slot.teacherName} 강사` : "담임 미정"}
            {" · "}
            <span className="num">{slot.studentCount}명</span>
          </p>
        </div>
        {slot.classroomName ? (
          <span className="text-text-faint shrink-0 font-mono text-[10px]">{slot.classroomName}</span>
        ) : null}
      </div>
    </li>
  );
}
