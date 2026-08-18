import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isEventColor, type CalendarEvent } from "../types";

/**
 * 캘린더 조회 — 월 단위(그 달과 **겹치는** 일정 전부: 여러 날짜에 걸친 일정 포함).
 * 읽기는 세션 클라이언트 + RLS(테넌트 전원). 쓰기는 서버 액션(actions.ts).
 * ⚠️ 표 미적용(0218a 전) 배포에서도 죽지 않는다 — ready:false로 접는다([[#95]]).
 */

export type CalendarMonth = {
  ready: boolean;
  events: CalendarEvent[];
};

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** 그 달의 [1일, 말일] — UTC 산술이라 서버 TZ와 무관. */
export function monthRange(month: string): { first: string; last: string } {
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return { first: `${month}-01`, last: `${month}-${String(lastDay).padStart(2, "0")}` };
}

export async function getMonthEvents(month: string): Promise<CalendarMonth> {
  if (!MONTH_RE.test(month)) return { ready: true, events: [] };
  const { first, last } = monthRange(month);
  const supabase = await createClient();

  // 겹침 조건: start <= 월말 AND end >= 월초. 학원 일정은 월 수십 건 규모 — 상한 500(절단 방지 명시, B2).
  const { data, error } = await supabase
    .from("calendar_events")
    .select(
      "id, title, memo, start_date, end_date, start_time, end_time, color, creator:users!calendar_events_created_by_fkey(display_name)",
    )
    .lte("start_date", last)
    .gte("end_date", first)
    .order("start_date", { ascending: true })
    .limit(500);

  if (error) {
    if (/PGRST205|42P01|does not exist|Could not find the table/i.test(`${error.code} ${error.message}`)) {
      return { ready: false, events: [] };
    }
    throw new Error(`일정 조회 실패 — ${error.message}`);
  }

  return {
    ready: true,
    events: (data ?? []).map((r) => {
      const creator = r.creator as { display_name?: string } | null;
      return {
        id: String(r.id),
        title: String(r.title),
        memo: (r.memo as string | null) ?? null,
        startDate: String(r.start_date),
        endDate: String(r.end_date),
        // DB time은 "HH:MM:SS" — 표시는 분까지.
        startTime: r.start_time ? String(r.start_time).slice(0, 5) : null,
        endTime: r.end_time ? String(r.end_time).slice(0, 5) : null,
        color: isEventColor(String(r.color)) ? (String(r.color) as CalendarEvent["color"]) : "primary",
        createdByName: creator?.display_name ?? null,
      };
    }),
  };
}
