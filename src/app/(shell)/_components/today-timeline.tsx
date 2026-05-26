import { Clock, GraduationCap, MapPin, MessagesSquare } from "lucide-react";
import type { LucideIcon } from "lucide-react";

type EventType = "class" | "consultation" | "meeting";
type EventStatus = "upcoming" | "ongoing" | "done";

type TimelineEvent = {
  id: string;
  time: string;
  endTime: string;
  type: EventType;
  title: string;
  context: string;
  room?: string;
  status: EventStatus;
  duration: number;
};

const EVENTS: TimelineEvent[] = [
  {
    id: "e1",
    time: "13:00",
    endTime: "14:30",
    type: "class",
    title: "중2 수학 심화 A반",
    context: "강민서 외 11명 · 박지훈 강사",
    room: "301호",
    status: "done",
    duration: 90,
  },
  {
    id: "e2",
    time: "14:40",
    endTime: "15:40",
    type: "consultation",
    title: "윤소율 학부모 등록상담",
    context: "예비 중1 · AI 분석 완료 · 김상담",
    status: "done",
    duration: 60,
  },
  {
    id: "e3",
    time: "16:00",
    endTime: "17:30",
    type: "class",
    title: "고1 영어 정규 B반",
    context: "정수아 외 9명 · 이연우 강사",
    room: "205호",
    status: "ongoing",
    duration: 90,
  },
  {
    id: "e4",
    time: "17:40",
    endTime: "18:40",
    type: "consultation",
    title: "이도현 학생 진로상담",
    context: "고2 · 담임 박지훈",
    status: "upcoming",
    duration: 60,
  },
  {
    id: "e5",
    time: "19:00",
    endTime: "20:30",
    type: "class",
    title: "중3 수학 심화 C반",
    context: "한지우 외 13명 · 박지훈 강사",
    room: "301호",
    status: "upcoming",
    duration: 90,
  },
  {
    id: "e6",
    time: "20:30",
    endTime: "21:00",
    type: "meeting",
    title: "주간 강사 회의",
    context: "전 강사 · 회의실",
    status: "upcoming",
    duration: 30,
  },
];

const TYPE_META: Record<EventType, { icon: LucideIcon; label: string; colorClass: string }> = {
  class: { icon: GraduationCap, label: "수업", colorClass: "text-chart-1" },
  consultation: { icon: MessagesSquare, label: "상담", colorClass: "text-chart-3" },
  meeting: { icon: Clock, label: "회의", colorClass: "text-chart-5" },
};

export function TodayTimeline() {
  const ongoing = EVENTS.filter((e) => e.status === "ongoing").length;
  return (
    <section className="bg-card border-border flex h-full flex-col rounded-lg border">
      <header className="border-border flex items-center justify-between border-b px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">오늘의 일정</h2>
          <p className="text-muted-foreground mt-0.5 text-xs">
            <span className="num">총 {EVENTS.length}건</span>
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

      <ol className="relative flex-1 px-5 py-3">
        <div className="bg-border absolute top-5 bottom-5 left-[5.625rem] w-px" aria-hidden />
        {EVENTS.map((e) => (
          <TimelineRow key={e.id} event={e} />
        ))}
      </ol>
    </section>
  );
}

function TimelineRow({ event: e }: { event: TimelineEvent }) {
  const meta = TYPE_META[e.type];
  const Icon = meta.icon;

  const dotClass =
    e.status === "ongoing"
      ? "bg-chart-4 pulse-now"
      : e.status === "done"
        ? "bg-muted-foreground/25"
        : "bg-card border-border border-2";

  const rowClass = e.status === "done" ? "opacity-55" : "";

  return (
    <li className={`grid grid-cols-[5rem_auto_1fr] items-start gap-3 py-3 ${rowClass}`}>
      <div className="num pt-0.5 text-right">
        <p
          className={`text-sm font-semibold ${
            e.status === "done" ? "text-muted-foreground line-through" : "text-foreground"
          }`}
        >
          {e.time}
        </p>
        <p className="text-muted-foreground text-[11px]">~{e.endTime}</p>
      </div>

      <div className="flex flex-col items-center pt-1.5">
        <span className={`relative z-10 size-3 rounded-full ${dotClass}`} />
      </div>

      <div className="min-w-0 pb-1">
        <div className="flex items-baseline gap-2">
          <Icon className={`size-3.5 shrink-0 ${meta.colorClass}`} />
          <h3 className="truncate text-sm font-medium leading-tight">{e.title}</h3>
        </div>
        <p className="text-muted-foreground mt-0.5 text-xs leading-snug">{e.context}</p>
        <div className="text-muted-foreground/80 mt-1.5 flex items-center gap-2.5 text-[11px]">
          {e.room ? (
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3" />
              {e.room}
            </span>
          ) : null}
          <span className="num">{e.duration}분</span>
        </div>
      </div>
    </li>
  );
}
