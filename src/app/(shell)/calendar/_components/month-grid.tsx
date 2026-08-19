import { weekdayIndexOf } from "@/lib/date-kst";
import { holidayFor, holidayShortName } from "@/features/calendar/holidays";
import { eventDisplayColor, type CalendarEvent, type EventColor } from "@/features/calendar/types";

/**
 * 월 그리드 — 일~토 7열(한국 달력 관행: 일=빨강·토=파랑), 앞뒤 달 날짜는 흐리게, 오늘은 primary 원 배지.
 * 여러 날 일정은 걸치는 칸마다 칩을 반복한다(v1 — 가로 바 연결은 다음).
 * **법정공휴일**(holidays.ts 내장 테이블)은 날짜 숫자 빨강 + 칸 상단 공휴일명 라벨 — 일정이 아니라
 * 달력의 속성이므로 칩·클릭이 없다(DB 무관, 내장 범위 밖 연도는 표시 없음).
 *
 * ⚠️ Tailwind 동적 클래스 조립 금지 — 색→클래스는 아래 Record 한 곳(purge에 잡히게 전부 정적 문자열).
 * ⚠️ 페이지 가로 스크롤 금지 — 그리드는 w-full, 칸은 min-w-0 + 칩 truncate.
 */

export const CHIP_CLASS: Record<EventColor, string> = {
  primary: "bg-primary-soft text-primary",
  blue: "bg-blue-soft text-blue",
  green: "bg-green-soft text-green",
  amber: "bg-amber-soft text-amber",
  purple: "bg-purple-soft text-purple",
  rose: "bg-rose-soft text-rose",
  neutral: "bg-bg-soft text-text-dim",
};

const WEEKDAYS = [
  { label: "일", cls: "text-danger" },
  { label: "월", cls: "text-foreground" },
  { label: "화", cls: "text-foreground" },
  { label: "수", cls: "text-foreground" },
  { label: "목", cls: "text-foreground" },
  { label: "금", cls: "text-foreground" },
  { label: "토", cls: "text-blue" },
] as const;

const MAX_CHIPS = 3;

/** "YYYY-MM-DD" + n일 — UTC 산술(클라 TZ 무관·결정적). */
function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(
    dt.getUTCDate(),
  ).padStart(2, "0")}`;
}

type Cell = { date: string; inMonth: boolean };

/** 그 달을 덮는 주 단위 칸(일요일 시작) — 앞뒤 달 날짜 포함, 7의 배수. */
function buildCells(month: string): Cell[] {
  const first = `${month}-01`;
  const offset = weekdayIndexOf(first); // 0=일
  const start = addDays(first, -offset);
  const cells: Cell[] = [];
  // 6주(42칸)면 어떤 달도 덮는다 — 마지막 주가 통째로 다음 달이면 잘라낸다.
  for (let i = 0; i < 42; i += 1) {
    const date = addDays(start, i);
    cells.push({ date, inMonth: date.slice(0, 7) === month });
  }
  const lastWeek = cells.slice(35);
  return lastWeek.every((c) => !c.inMonth) ? cells.slice(0, 35) : cells;
}

/** 그 날의 일정 — 종일 먼저, 그다음 시작 시간순(같으면 제목순). 하루 상세(DayListDialog)도 공유. */
export function eventsOn(events: CalendarEvent[], date: string): CalendarEvent[] {
  return events
    .filter((e) => e.startDate <= date && date <= e.endDate)
    .sort((a, b) => {
      if (!a.startTime !== !b.startTime) return a.startTime ? 1 : -1;
      if (a.startTime !== b.startTime) return (a.startTime ?? "").localeCompare(b.startTime ?? "");
      return a.title.localeCompare(b.title, "ko");
    });
}

export function MonthGrid({
  month,
  today,
  events,
  onEventClick,
  onDayClick,
  onMoreClick,
}: {
  month: string;
  today: string;
  events: CalendarEvent[];
  onEventClick: (e: CalendarEvent) => void;
  /** 빈 날짜 칸 클릭 = 그 날짜로 일정 등록(구글식). 쓰기 권한이 없으면 안 넘어와 칸이 반응하지 않는다. */
  onDayClick?: (ymd: string) => void;
  /** "+N개 더" 클릭 = 그 날 일정 전건 보기(하루 상세) — 열람이라 권한 무관 전원. */
  onMoreClick: (ymd: string) => void;
}) {
  const cells = buildCells(month);
  const weeks: Cell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  return (
    <div className="border-line-strong bg-card shadow-card w-full overflow-hidden rounded-2xl border">
      {/* 요일 머리 */}
      <div className="border-line-strong bg-bg-soft/50 grid grid-cols-7 border-b">
        {WEEKDAYS.map((w) => (
          <p key={w.label} className={`py-2 text-center text-[12px] font-bold ${w.cls}`}>
            {w.label}
          </p>
        ))}
      </div>

      {weeks.map((week, wi) => (
        <div key={wi} className="divide-line-strong border-line-strong grid grid-cols-7 divide-x border-b last:border-b-0">
          {week.map((cell) => {
            const dow = weekdayIndexOf(cell.date);
            const dayNum = Number(cell.date.slice(8, 10));
            const isToday = cell.date === today;
            const holiday = holidayFor(cell.date);
            const dayEvents = eventsOn(events, cell.date);
            const shown = dayEvents.slice(0, MAX_CHIPS);
            const more = dayEvents.length - shown.length;
            return (
              <div
                key={cell.date}
                onClick={onDayClick ? () => onDayClick(cell.date) : undefined}
                className={`min-h-[128px] min-w-0 p-1.5 ${dow === 0 || dow === 6 ? "bg-bg-soft/30" : ""} ${
                  onDayClick ? "hover:bg-primary-soft/20 cursor-pointer transition-colors" : ""
                }`}
              >
                <p className="mb-0.5 flex items-center justify-between gap-1">
                  {/* 공휴일명 — 일정 칩 위(좌측), 정식 명칭은 title 툴팁. 앞뒤 달은 흐림 규칙을 따른다. */}
                  {holiday ? (
                    <span
                      className={`min-w-0 truncate text-[11px] leading-none font-semibold ${
                        cell.inMonth ? "text-danger" : "text-text-faint"
                      }`}
                      title={holiday}
                    >
                      {holidayShortName(cell.date)}
                    </span>
                  ) : (
                    <span />
                  )}
                  <span
                    className={`flex size-6 shrink-0 items-center justify-center rounded-full text-[13px] ${
                      isToday
                        ? "bg-primary text-primary-foreground font-bold"
                        : !cell.inMonth
                          ? "text-text-faint"
                          : dow === 0 || holiday
                            ? "text-danger"
                            : dow === 6
                              ? "text-blue"
                              : "text-foreground"
                    } ${!isToday ? "font-semibold" : ""}`}
                  >
                    {dayNum}
                  </span>
                </p>
                <div className="space-y-0.5">
                  {shown.map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      onClick={(ev) => {
                        ev.stopPropagation(); // 칩 클릭이 칸(일정 등록) 클릭으로 번지지 않게
                        onEventClick(e);
                      }}
                      className={`block w-full truncate rounded px-1 py-0.5 text-left text-[12px] leading-tight font-medium transition hover:opacity-80 ${CHIP_CLASS[eventDisplayColor(e)]} ${
                        cell.inMonth ? "" : "opacity-50"
                      }`}
                      title={e.tag ? `[${e.tag.name}] ${e.title}` : e.title}
                    >
                      {e.startTime ? <span className="num mr-0.5">{e.startTime}</span> : null}
                      {e.title}
                    </button>
                  ))}
                  {more > 0 ? (
                    // 넘친 일정은 하루 상세에서 전건 — 칸 클릭(일정 등록)으로 번지지 않게 막는다.
                    <button
                      type="button"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onMoreClick(cell.date);
                      }}
                      className="text-text-dim hover:text-primary cursor-pointer px-1 text-left text-[11px] hover:underline"
                    >
                      +{more}개 더
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
