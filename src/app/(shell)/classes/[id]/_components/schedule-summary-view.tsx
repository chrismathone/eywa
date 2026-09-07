import {
  DAY_ORDER,
  formatDays,
  formatMinutes,
  type DayKey,
  type ScheduleRow,
  type ScheduleSummary,
} from "@/features/classes/schedule-summary";
import { sheetDowLabel, sheetT, sheetTf, type SheetLang } from "@/features/teacher-view/i18n";

/**
 * 반 상세 '시간표' 카드 본문 — 시각으로 묶은 줄 + 요일 스트립.
 *
 * 왜 이 모양인가(2026-07-30): 전엔 `class_schedules` 한 행 = 한 줄이라 월~금 2교시 반이 25줄이었고,
 * 그중 15줄은 이미 끝난 배치였다. 시각으로 묶으면 2줄이고, 요일은 읽는 게 아니라 **보는** 편이 빠르다.
 * ⚠️ 뺀 행(만료·예정)은 반드시 아래에 밝힌다 — 조용히 숨기면 "내가 넣은 교시가 왜 없지"가 된다.
 */
export function ScheduleSummaryView({
  schedule,
  lang,
}: {
  schedule: ScheduleSummary;
  lang: SheetLang;
}) {
  const { current, upcoming, upcomingFrom, pastCount } = schedule;
  const weekly = formatMinutes(schedule.minutes, lang);
  // 주말을 쓰는 반만 토·일 칸을 편다(대부분 반은 평일뿐이라 빈 칸 두 개가 노이즈).
  const usesWeekend = [...current, ...upcoming].some((r) =>
    r.days.some((d) => d === "sat" || d === "sun"),
  );
  const axis = usesWeekend ? DAY_ORDER : DAY_ORDER.slice(0, 5);

  if (current.length === 0 && upcoming.length === 0) {
    return (
      <p className="text-muted-foreground py-2 text-sm">
        {sheetT(lang, "cls.sch.none")}
        {pastCount > 0 ? <PastNote count={pastCount} lang={lang} inline /> : null}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {current.length > 0 ? (
        <>
          <p className="text-muted-foreground text-xs">
            <span className="text-foreground font-medium">{formatDays(schedule.days, lang)}</span>
            {/* 붙은 교시를 이은 뒤라 '회' = 교시 수가 아니라 **앉는 횟수**(DP5 = 10교시가 아니라 주 5회).
                시수엔 '주'를 붙여 한 번 수업이 6시간 40분처럼 읽히지 않게 한다. */}
            <span className="num">{sheetTf(lang, "cls.sch.sessions", { n: schedule.sessions })}</span>
            {weekly ? <span className="num">{sheetTf(lang, "cls.sch.weekly", { v: weekly })}</span> : null}
          </p>
          <ul className="space-y-1.5">
            {current.map((row) => (
              <RowItem key={`${row.startTime}-${row.endTime}`} row={row} axis={axis} lang={lang} />
            ))}
          </ul>
        </>
      ) : (
        <p className="text-muted-foreground text-xs">{sheetT(lang, "cls.sch.notStarted")}</p>
      )}

      {upcoming.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-chart-1 text-xs font-medium">
            {upcomingFrom
              ? sheetTf(lang, "cls.sch.startsFrom", { md: monthDay(upcomingFrom) })
              : sheetT(lang, "cls.sch.startsSoon")}
          </p>
          <ul className="space-y-1.5">
            {upcoming.map((row) => (
              <RowItem key={`up-${row.startTime}-${row.endTime}`} row={row} axis={axis} lang={lang} upcoming />
            ))}
          </ul>
        </div>
      ) : null}

      {pastCount > 0 ? <PastNote count={pastCount} lang={lang} /> : null}
    </div>
  );
}

function RowItem({
  row,
  axis,
  lang,
  upcoming,
}: {
  row: ScheduleRow;
  axis: DayKey[];
  lang: SheetLang;
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
      <span
        className="flex items-center gap-1"
        aria-label={sheetTf(lang, "cls.sch.rowAria", { days: formatDays(row.days, lang) })}
      >
        {axis.map((d) => {
          const on = row.days.includes(d);
          return (
            <span
              key={d}
              aria-hidden
              /* ⚠️ 영어 요일은 세 글자라 20px 고정에 안 들어간다 — 목록 화면 알약과 같은 규약. */
              className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs font-medium ${
                on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground/40"
              }`}
            >
              {sheetDowLabel(d, lang)}
            </span>
          );
        })}
      </span>
    </li>
  );
}

/** 만료 행은 지난 배치의 이력 — 개수만 밝히고 편집 화면으로 안내(거기도 같은 범위만 편집한다). */
function PastNote({ count, lang, inline }: { count: number; lang: SheetLang; inline?: boolean }) {
  const text = sheetTf(lang, "cls.sch.pastHidden", { n: count });
  return (
    <span
      className={`text-muted-foreground text-xs ${inline ? "ml-1" : "block"}`}
      title={sheetT(lang, "cls.sch.pastTitle")}
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
