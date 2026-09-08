import {
  formatDays,
  formatMinutes,
  type ScheduleDayRow,
  type ScheduleSummary,
} from "@/features/classes/schedule-summary";
import { sheetDowLabel, sheetT, sheetTf, type SheetLang } from "@/features/teacher-view/i18n";

/**
 * 반 상세 '시간표' 카드 본문 — **요일이 줄의 주인**, 그 요일에 앉는 시간대가 오른쪽에 선다.
 *
 * 왜 이 모양인가:
 * · 2026-07-30 — `class_schedules` 한 행 = 한 줄이라 월~금 2교시 반이 25줄이었다(그중 15줄은 끝난 배치).
 *   묶어서 2줄로 줄였다. **이 압축은 유지한다.**
 * · 2026-09-07 — 원장 지시 *"요일을 기준으로 시간대를 표시해주면 좋을듯. 시간대를 기준으로 요일을
 *   표시하지말고"* → 축을 뒤집었다. 사람이 반을 떠올리는 순서가 "화요일엔 몇 시부터"라서다.
 *   ⚠️ **요일을 한 줄씩 세우지 않는다** — 시각 구성이 같은 요일은 묶는다(`groupByDay`). 안 그러면
 *      월~금 반이 5줄이 되어 2026-07-30에 줄인 것을 그대로 되돌린다.
 * ⚠️ 뺀 행(만료·예정)은 반드시 아래에 밝힌다 — 조용히 숨기면 "내가 넣은 교시가 왜 없지"가 된다.
 */
export function ScheduleSummaryView({
  schedule,
  lang,
}: {
  schedule: ScheduleSummary;
  lang: SheetLang;
}) {
  const { byDay, upcomingByDay, upcomingFrom, pastCount } = schedule;
  const weekly = formatMinutes(schedule.minutes, lang);

  if (byDay.length === 0 && upcomingByDay.length === 0) {
    return (
      <p className="text-muted-foreground py-2 text-sm">
        {sheetT(lang, "cls.sch.none")}
        {pastCount > 0 ? <PastNote count={pastCount} lang={lang} inline /> : null}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {byDay.length > 0 ? (
        <>
          <p className="text-muted-foreground text-xs">
            <span className="text-foreground font-medium">{formatDays(schedule.days, lang)}</span>
            {/* 붙은 교시를 이은 뒤라 '회' = 교시 수가 아니라 **앉는 횟수**(DP5 = 10교시가 아니라 주 5회).
                시수엔 '주'를 붙여 한 번 수업이 6시간 40분처럼 읽히지 않게 한다. */}
            <span className="num">{sheetTf(lang, "cls.sch.sessions", { n: schedule.sessions })}</span>
            {weekly ? <span className="num">{sheetTf(lang, "cls.sch.weekly", { v: weekly })}</span> : null}
          </p>
          <ul className="space-y-1.5">
            {byDay.map((row) => (
              <DayRowItem key={row.days.join(",")} row={row} lang={lang} />
            ))}
          </ul>
        </>
      ) : (
        <p className="text-muted-foreground text-xs">{sheetT(lang, "cls.sch.notStarted")}</p>
      )}

      {upcomingByDay.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-chart-1 text-xs font-medium">
            {upcomingFrom
              ? sheetTf(lang, "cls.sch.startsFrom", { md: monthDay(upcomingFrom) })
              : sheetT(lang, "cls.sch.startsSoon")}
          </p>
          <ul className="space-y-1.5">
            {upcomingByDay.map((row) => (
              <DayRowItem key={`up-${row.days.join(",")}`} row={row} lang={lang} upcoming />
            ))}
          </ul>
        </div>
      ) : null}

      {pastCount > 0 ? <PastNote count={pastCount} lang={lang} /> : null}
    </div>
  );
}

/**
 * 한 줄 = 요일 묶음(왼쪽) + 그 요일에 앉는 시간대들(오른쪽).
 * ⚠️ 요일 칩은 **이 줄의 요일만** 세운다 — 월~일 축을 통째로 깔면 다시 "시각이 주인, 요일은 표식"으로
 *    읽히고, 줄마다 같은 축이 반복돼 시간대가 밀린다.
 */
function DayRowItem({
  row,
  lang,
  upcoming,
}: {
  row: ScheduleDayRow;
  lang: SheetLang;
  upcoming?: boolean;
}) {
  return (
    <li
      className={`border-border flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border px-3 py-2 ${
        upcoming ? "bg-card border-dashed" : "bg-muted/30"
      }`}
    >
      <span className="flex items-center gap-1" aria-label={formatDays(row.days, lang)}>
        {row.days.map((d) => (
          <span
            key={d}
            aria-hidden
            /* ⚠️ 영어 요일은 세 글자라 20px 고정에 안 들어간다 — 목록 화면 알약과 같은 규약. */
            className="bg-primary text-primary-foreground inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs font-medium"
          >
            {sheetDowLabel(d, lang)}
          </span>
        ))}
      </span>
      <span className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
        {row.ranges.map((r) => (
          <span key={`${r.start}-${r.end}`} className="num text-foreground text-sm font-medium">
            {r.start} – {r.end}
          </span>
        ))}
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
