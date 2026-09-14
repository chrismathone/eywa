"use client";

/**
 * 시간표 **보강 탭**(원장 2026-09-14) — 그 주 요일 × 교시 칸에 **보강 예약**(0264a)된 학생을 세운다.
 * 마우스를 올리면 '보강 정보'(원반·결석일·시각·예약자·메모)가 뜬다.
 *
 * 🔴 **표시 전용** — 슬롯도 명단도 아니다. 드래그·인원·충돌·엑셀·시트·강사뷰 어디에도 안 들어간다(가드
 *    `makeup-tab-wiring.test.ts`). 예약이 이행되면(보강일 출결) 서버가 `done`으로 넘겨 여기서 사라진다.
 * 🔴 교시 행은 **학원설정 교시표**(평일 = 이 과목 표, 주말 = 주말 표)에서 온다 — 예약이 그 표의 시각으로만 잡히므로
 *    빈 행이 있어도 칸이 어긋나지 않는다. 표에 없는 시각(설정이 바뀐 뒤의 옛 예약)은 아래 '그 밖의 시각' 행으로 모은다.
 * ⚠️ 학생 이름은 창 링크가 아니다 — 이 탭의 목적은 "그 시간에 누가 오나"를 훑는 것이고, 고치는 자리는 출석부 칸이다.
 */
import { HoverCard } from "./hover-cards";
import { DAY_LABEL } from "@/features/timetable/lib/split-attendance";
import { RESERVED_BADGE_CLASS, RESERVED_CELL_LABEL } from "@/features/attendance/makeup-reservation";

/** 페이지가 만들어 내려보내는 예약 한 줄(직렬화 가능 · 이름까지 붙인 것). */
export type MakeupWeekEntry = {
  id: string;
  dayOfWeek: string;
  /** 그 요일 칸의 실제 날짜 "YYYY-MM-DD". */
  date: string;
  /** "HH:MM" */
  slotStart: string;
  slotEnd: string;
  periodLabel: string | null;
  /** 이 시각이 앉는 교시 행 키(`rows[].key`) — 표에 없는 시각이면 null(그 밖의 시각 행). */
  rowKey: string | null;
  studentName: string;
  studentLabel: string | null;
  className: string;
  teacherName: string | null;
  absenceDate: string;
  note: string | null;
  createdByName: string | null;
};

export type MakeupWeekRow = { key: string; label: string; time: string };

const WEEKDAY_DOWS = ["mon", "tue", "wed", "thu", "fri"] as const;
const WEEKEND_DOWS = ["sat", "sun"] as const;

function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return m && d ? `${Number(m)}/${Number(d)}` : iso;
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-text-dim shrink-0">{label}</span>
      <span className={`text-foreground text-right ${mono ? "num" : ""}`}>{value}</span>
    </div>
  );
}

/** '보강 정보' hover 카드 — 원반·담임·결석일·보강 시각·예약자·메모. */
function InfoCard({ e }: { e: MakeupWeekEntry }) {
  return (
    <div className="space-y-2 break-keep text-xs">
      <div className="flex items-start justify-between gap-2">
        <span className="text-foreground text-sm font-bold">{e.studentName}</span>
        {e.studentLabel ? <span className="text-text-dim shrink-0 text-xs">{e.studentLabel}</span> : null}
      </div>
      <div className={`rounded px-1.5 py-1 text-xs font-bold ${RESERVED_BADGE_CLASS}`}>{RESERVED_CELL_LABEL}</div>
      <div className="space-y-1">
        <Row label="원반" value={e.className} />
        {e.teacherName ? <Row label="담임" value={e.teacherName} /> : null}
        <Row label="결석일" value={shortDate(e.absenceDate)} mono />
        <Row
          label="보강"
          value={`${shortDate(e.date)}(${DAY_LABEL[e.dayOfWeek] ?? e.dayOfWeek}) ${e.periodLabel ? `${e.periodLabel} · ` : ""}${e.slotStart}~${e.slotEnd}`}
          mono
        />
        {e.createdByName ? <Row label="예약" value={e.createdByName} /> : null}
      </div>
      {e.note ? <p className="border-line text-foreground border-t pt-1.5">{e.note}</p> : null}
    </div>
  );
}

/** 칸 안 학생 칩 목록 — 이름 · 원반(+표 밖 시각이면 시각). hover = 보강 정보. */
function Cell({ list, showTime = false }: { list: MakeupWeekEntry[]; showTime?: boolean }) {
  if (list.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1">
      {list.map((e) => (
        <li key={e.id}>
          <HoverCard card={<InfoCard e={e} />} width={240}>
            <div
              className={`flex cursor-default items-baseline gap-1.5 rounded-md border border-dashed border-purple/40 px-1.5 py-0.5 ${RESERVED_BADGE_CLASS}`}
              title={`${e.studentName} · ${e.className} · ${shortDate(e.absenceDate)} 결석분`}
            >
              <span className="text-foreground truncate text-sm font-bold">{e.studentName}</span>
              <span className="text-text-dim min-w-0 truncate text-xs">{e.className}</span>
              {showTime ? <span className="num ml-auto shrink-0 text-xs">{e.slotStart}</span> : null}
            </div>
          </HoverCard>
        </li>
      ))}
    </ul>
  );
}

/** 요일 × 교시 판 하나(평일 / 주말). 정적 컴포넌트 — 렌더 안에서 만들면 매 렌더 새 타입이 된다(react-hooks/static-components). */
function MakeupTable({
  days,
  periodRows,
  title,
  byCell,
  orphanByDay,
  dateOf,
  today,
}: {
  days: readonly string[];
  periodRows: MakeupWeekRow[];
  title?: string;
  byCell: ReadonlyMap<string, MakeupWeekEntry[]>;
  orphanByDay: ReadonlyMap<string, MakeupWeekEntry[]>;
  dateOf: Record<string, string>;
  today: string;
}) {
  const orphanDays = days.filter((d) => (orphanByDay.get(d)?.length ?? 0) > 0);
  // "M/D" → 오늘인가(YYYY-MM-DD의 뒷부분과 대조).
  const isToday = (d: string) => {
    const date = dateOf[d];
    if (!date) return false;
    const [m, dd] = date.split("/");
    return today.endsWith(`-${String(m).padStart(2, "0")}-${String(dd).padStart(2, "0")}`);
  };
  return (
    <div className="border-line bg-card overflow-x-auto rounded-2xl border">
      <table className="w-full table-fixed border-collapse text-sm">
        <colgroup>
          <col style={{ width: 132 }} />
          {days.map((d) => (
            <col key={d} />
          ))}
        </colgroup>
        <thead>
          <tr className="bg-bg-soft">
            <th className="border-line text-text-dim border-r border-b px-2 py-1.5 text-left text-xs font-bold">
              {title ?? "교시"}
            </th>
            {days.map((d) => (
              <th
                key={d}
                className={`border-line border-r border-b px-2 py-1.5 text-center text-xs font-bold last:border-r-0 ${
                  isToday(d) ? "bg-primary text-primary-foreground" : d === "sun" ? "text-danger" : "text-foreground"
                }`}
              >
                {DAY_LABEL[d] ?? d}
                {dateOf[d] ? <span className="num ml-1 font-normal opacity-80">{dateOf[d]}</span> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {periodRows.map((row) => (
            <tr key={row.key} className="align-top">
              <td className="border-line border-r border-b px-2 py-1.5">
                <div className="text-foreground text-xs font-bold">{row.label || row.time}</div>
                {row.label ? <div className="text-text-dim num text-xs">{row.time}</div> : null}
              </td>
              {days.map((d) => (
                <td key={d} className="border-line border-r border-b p-1 last:border-r-0">
                  <Cell list={byCell.get(`${row.key}:${d}`) ?? []} />
                </td>
              ))}
            </tr>
          ))}
          {orphanDays.length > 0 ? (
            <tr className="align-top">
              <td className="border-line border-r px-2 py-1.5">
                <div className="text-foreground text-xs font-bold">그 밖의 시각</div>
                <div className="text-text-dim text-xs">교시표 밖</div>
              </td>
              {days.map((d) => (
                <td key={d} className="border-line border-r p-1 last:border-r-0">
                  <Cell list={orphanByDay.get(d) ?? []} showTime />
                </td>
              ))}
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

export function MakeupWeekView({
  rows,
  weekendRows,
  entries,
  dateOf,
  today,
}: {
  /** 평일 교시 행(이 과목 표). */
  rows: MakeupWeekRow[];
  /** 주말 교시 행(주말 표) — 주말 예약이 하나라도 있을 때만 그 판을 그린다. */
  weekendRows: MakeupWeekRow[];
  entries: MakeupWeekEntry[];
  /** 요일 → 그 주 날짜 "M/D". */
  dateOf: Record<string, string>;
  today: string;
}) {
  if (entries.length === 0) {
    return (
      <div className="border-line bg-card mx-auto max-w-xl rounded-2xl border px-5 py-8 text-center">
        <p className="text-foreground text-sm font-bold">이 주에 잡힌 보강 예약이 없습니다</p>
        <p className="text-text-dim mt-1 text-xs break-keep">
          출석부 칸을 우클릭해 &lsquo;보강 예약&rsquo;을 잡으면 그 요일·교시 칸에 학생이 섭니다. 보강이 끝나(출결이 찍히면)
          여기서 내려갑니다.
        </p>
      </div>
    );
  }
  const byCell = new Map<string, MakeupWeekEntry[]>();
  const orphanByDay = new Map<string, MakeupWeekEntry[]>();
  for (const e of entries) {
    const target = e.rowKey ? byCell : orphanByDay;
    const key = e.rowKey ? `${e.rowKey}:${e.dayOfWeek}` : e.dayOfWeek;
    (target.get(key) ?? target.set(key, []).get(key)!).push(e);
  }
  const hasWeekend = entries.some((e) => e.dayOfWeek === "sat" || e.dayOfWeek === "sun");
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <MakeupTable days={WEEKDAY_DOWS} periodRows={rows} byCell={byCell} orphanByDay={orphanByDay} dateOf={dateOf} today={today} />
      {hasWeekend ? (
        <MakeupTable
          days={WEEKEND_DOWS}
          periodRows={weekendRows}
          title="주말"
          byCell={byCell}
          orphanByDay={orphanByDay}
          dateOf={dateOf}
          today={today}
        />
      ) : null}
    </div>
  );
}
