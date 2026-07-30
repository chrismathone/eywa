import {
  DAY_LABEL,
  DAY_ORDER,
  formatDays,
  formatMinutes,
  type DayKey,
  type ScheduleRow,
  type ScheduleSummary,
} from "@/features/classes/schedule-summary";

/**
 * 반 상세 '시간표' 카드 본문 — 시각으로 묶은 줄 + 요일 스트립.
 *
 * 왜 이 모양인가(2026-07-30): 전엔 `class_schedules` 한 행 = 한 줄이라 월~금 2교시 반이 25줄이었고,
 * 그중 15줄은 이미 끝난 배치였다. 시각으로 묶으면 2줄이고, 요일은 읽는 게 아니라 **보는** 편이 빠르다.
 * ⚠️ 뺀 행(만료·예정)은 반드시 아래에 밝힌다 — 조용히 숨기면 "내가 넣은 교시가 왜 없지"가 된다.
 */
export function ScheduleSummaryView({ schedule }: { schedule: ScheduleSummary }) {
  const { current, upcoming, upcomingFrom, pastCount } = schedule;
  const weekly = formatMinutes(schedule.minutes);
  // 주말을 쓰는 반만 토·일 칸을 편다(대부분 반은 평일뿐이라 빈 칸 두 개가 노이즈).
  const usesWeekend = [...current, ...upcoming].some((r) =>
    r.days.some((d) => d === "sat" || d === "sun"),
  );
  const axis = usesWeekend ? DAY_ORDER : DAY_ORDER.slice(0, 5);

  if (current.length === 0 && upcoming.length === 0) {
    return (
      <p className="text-muted-foreground py-2 text-sm">
        등록된 시간표가 없습니다
        {pastCount > 0 ? <PastNote count={pastCount} inline /> : null}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {current.length > 0 ? (
        <>
          <p className="text-muted-foreground text-xs">
            <span className="text-foreground font-medium">{formatDays(schedule.days)}</span>
            <span className="num"> · 주 {schedule.sessions}회</span>
            {weekly ? ` · ${weekly}` : ""}
          </p>
          <ul className="space-y-1.5">
            {current.map((row) => (
              <RowItem key={`${row.startTime}-${row.endTime}`} row={row} axis={axis} />
            ))}
          </ul>
        </>
      ) : (
        <p className="text-muted-foreground text-xs">아직 시작하지 않은 반입니다</p>
      )}

      {upcoming.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-chart-1 text-xs font-medium">
            {upcomingFrom ? `${monthDay(upcomingFrom)}부터` : "시작 예정"}
          </p>
          <ul className="space-y-1.5">
            {upcoming.map((row) => (
              <RowItem key={`up-${row.startTime}-${row.endTime}`} row={row} axis={axis} upcoming />
            ))}
          </ul>
        </div>
      ) : null}

      {pastCount > 0 ? <PastNote count={pastCount} /> : null}
    </div>
  );
}

function RowItem({
  row,
  axis,
  upcoming,
}: {
  row: ScheduleRow;
  axis: DayKey[];
  upcoming?: boolean;
}) {
  return (
    <li
      className={`border-border flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-md border px-3 py-2 ${
        upcoming ? "bg-card border-dashed" : "bg-muted/30"
      }`}
    >
      <span className="num text-foreground text-sm font-medium">
        {row.startTime} – {row.endTime}
      </span>
      <span className="flex items-center gap-1" aria-label={`${formatDays(row.days)} 수업`}>
        {axis.map((d) => {
          const on = row.days.includes(d);
          return (
            <span
              key={d}
              aria-hidden
              className={`inline-flex size-5 items-center justify-center rounded-full text-[10px] font-medium ${
                on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground/40"
              }`}
            >
              {DAY_LABEL[d]}
            </span>
          );
        })}
      </span>
    </li>
  );
}

/** 만료 행은 지난 배치의 이력 — 개수만 밝히고 편집 화면으로 안내(거기도 같은 범위만 편집한다). */
function PastNote({ count, inline }: { count: number; inline?: boolean }) {
  const text = `지난 배치 ${count}개는 숨김`;
  return (
    <span
      className={`text-muted-foreground text-[11px] ${inline ? "ml-1" : "block"}`}
      title="운영 종료일이 지난 시간표 행입니다. 기록으로 남아 있고 화면·편집에서는 빠집니다."
    >
      {inline ? `· ${text}` : text}
    </span>
  );
}

/** "2026-08-18" → "8/18". 이미 KST 날짜 문자열이라 파싱하지 않는다(타임존 되밀림 금지). */
function monthDay(iso: string): string {
  const [, m, d] = iso.split("-");
  return m && d ? `${Number(m)}/${Number(d)}` : iso;
}
