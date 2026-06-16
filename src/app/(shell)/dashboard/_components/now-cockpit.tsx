/**
 * ② 지금 진행 콕핏 — 진행중 수업을 크게(라이브 펄스), 완료는 흐리게, 예정은 작게.
 * 색/시간 로직은 subject-meta(구 today-timeline에서 추출) 재사용.
 */
import { Pill } from "@/components/atoms/pill";
import type { TodaySlot } from "@/features/timetable/server/queries";
import {
  SUBJECT_META,
  FALLBACK_META,
  COLOR_BORDER,
  shortTime,
  diffMinutes,
} from "@/features/dashboard/subject-meta";

const KO_TODAY = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric" });

export function NowCockpit({ slots }: { slots: TodaySlot[] }) {
  const ongoing = slots.filter((s) => s.status === "ongoing");
  const rest = slots.filter((s) => s.status !== "ongoing");
  const todayLabel = KO_TODAY.format(new Date());

  return (
    <section className="bg-card border-line shadow-card flex h-full flex-col overflow-hidden rounded-2xl border">
      <header className="flex items-center justify-between px-5 pt-4 pb-3">
        <div>
          <p className="text-primary font-mono text-[11px] tracking-wider uppercase">
            지금 · {todayLabel}
          </p>
          <h2 className="text-foreground mt-1 text-[15px] font-bold">오늘의 일정</h2>
        </div>
        {ongoing.length > 0 ? (
          <Pill color="primary">● 진행 중 {ongoing.length}건</Pill>
        ) : (
          <a href="/timetable" className="text-text-dim hover:text-foreground text-xs">
            시간표 →
          </a>
        )}
      </header>

      {slots.length === 0 ? (
        <div className="text-text-dim flex flex-1 items-center justify-center px-5 py-12 text-sm">
          오늘은 예정된 수업이 없습니다
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-3 px-5 pb-5">
          {ongoing.map((slot) => (
            <OngoingCard key={slot.id} slot={slot} />
          ))}
          {ongoing.length === 0 ? (
            <p className="text-text-faint px-1 text-xs">지금 진행 중인 수업은 없습니다.</p>
          ) : null}
          {rest.length > 0 ? (
            <ul className="space-y-1.5">
              {rest.map((slot) => (
                <CompactRow key={slot.id} slot={slot} />
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </section>
  );
}

function OngoingCard({ slot }: { slot: TodaySlot }) {
  const meta = SUBJECT_META[slot.subject] ?? FALLBACK_META;
  const duration = diffMinutes(slot.startTime, slot.endTime);
  return (
    <div className={`flex items-center gap-3.5 rounded-xl border-[1.5px] px-4 py-3.5 ${COLOR_BORDER[meta.color]}`}>
      <div className="w-[52px] shrink-0 text-center">
        <p className="num text-primary text-[15px] font-extrabold leading-none">
          {shortTime(slot.startTime)}
        </p>
        <p className="text-text-faint mt-1 font-mono text-[10px]">{duration}분</p>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="text-foreground truncate text-[15px] font-extrabold">{slot.className}</h3>
          <Pill color="primary">진행 중</Pill>
        </div>
        <p className="text-text-dim mt-1 truncate text-[12px]">
          {slot.teacherName ? `${slot.teacherName} 강사` : "담임 미정"}
          {slot.classroomName ? ` · ${slot.classroomName}` : ""}
          {" · "}
          <span className="num">{slot.studentCount}명</span>
        </p>
      </div>
      <span
        className="animate-pulse bg-primary size-2.5 shrink-0 rounded-full"
        style={{ boxShadow: "0 0 0 4px rgba(26,95,60,0.15)" }}
        aria-hidden="true"
      />
    </div>
  );
}

function CompactRow({ slot }: { slot: TodaySlot }) {
  const isDone = slot.status === "done";
  return (
    <li className={`flex items-center gap-3 px-1 ${isDone ? "opacity-55" : ""}`}>
      <span
        className={`num w-[46px] shrink-0 text-center font-mono text-[12px] ${
          isDone ? "text-text-faint" : "text-text-dim font-semibold"
        }`}
      >
        {shortTime(slot.startTime)}
      </span>
      <span className="text-foreground min-w-0 flex-1 truncate text-[13px]">
        {slot.className}
        <span className="text-text-faint">
          {slot.teacherName ? ` · ${slot.teacherName}` : ""}
          {slot.classroomName ? ` · ${slot.classroomName}` : ""}
        </span>
      </span>
      <span className="text-text-faint shrink-0 font-mono text-[10px]">
        {isDone ? "완료" : `예정 · ${slot.studentCount}명`}
      </span>
    </li>
  );
}
