import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { reportError } from "@/lib/observability/report-error";
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

/**
 * 승인된 휴가 오버레이 — 캘린더에 "누가 언제 쉬는지"를 자동 표시(원장 2026-08-18, 캘린더 도입의 발단).
 *
 * 진실은 결재 문서(leave_forms + approval_documents.status='approved')이고 여기서 **조회 시점에
 * 합성**한다 — 캘린더에 복제 저장하지 않으므로 회수·데이터 정정이 자동 반영된다.
 * ⚠️ admin(RLS 우회)으로 읽는 이유: leave_forms RLS는 문서 관계자(기안자·결재선·참조·원장)만 열어서
 *    세션 클라이언트로는 일반 직원 캘린더에 남의 휴가가 안 뜬다. "누가 언제 쉬는지"는 학원 공용
 *    정보라 의도적으로 우회하되, **이름·기간·종류만** 내보낸다(사유·문서 내용은 안 내려보냄).
 *    tenant_id 명시 필터 필수([[#104]]).
 */
async function approvedLeaveOverlay(first: string, last: string): Promise<CalendarEvent[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("leave_forms")
    .select(
      "document_id, leave_kind, start_date, end_date, doc:approval_documents!leave_forms_document_id_fkey!inner(status), person:users!leave_forms_user_id_fkey(display_name)",
    )
    .eq("tenant_id", user.tenantId)
    .eq("doc.status", "approved")
    .lte("start_date", last)
    .gte("end_date", first)
    .limit(500); // 월당 휴가 수십 건 규모 — 절단 방지 명시 상한(B2)
  if (error || !data) {
    // 오버레이는 부가 정보 — 실패해도 수기 일정은 떠야 한다. 단 조용히 접으면 "휴가가 안 뜬다"를
    // 아무도 모른다([[#89]] 침묵 폴백) → 계측만 남기고 빈 값.
    if (error) reportError(error, { scope: "calendar.leaveOverlay" });
    return [];
  }

  return data.map((r) => {
    const person = r.person as { display_name?: string } | null;
    const kind = r.leave_kind === "half" ? "반차" : "연차";
    return {
      id: `leave-${String(r.document_id)}`,
      title: `${person?.display_name ?? "(이름 없음)"} ${kind}`,
      memo: null,
      startDate: String(r.start_date),
      endDate: String(r.end_date),
      startTime: null,
      endTime: null,
      color: "amber" as const, // 휴가 전용 톤 — 수기 일정과 구분
      createdByName: null,
      source: "leave" as const,
    };
  });
}

export async function getMonthEvents(month: string): Promise<CalendarMonth> {
  if (!MONTH_RE.test(month)) return { ready: true, events: [] };
  const { first, last } = monthRange(month);
  const supabase = await createClient();

  // 겹침 조건: start <= 월말 AND end >= 월초. 학원 일정은 월 수십 건 규모 — 상한 500(절단 방지 명시, B2).
  // 수기 일정과 휴가 오버레이는 서로 독립 — 병렬(B4).
  const [{ data, error }, leaveEvents] = await Promise.all([
    supabase
      .from("calendar_events")
      .select(
        "id, title, memo, start_date, end_date, start_time, end_time, color, creator:users!calendar_events_created_by_fkey(display_name)",
      )
      .lte("start_date", last)
      .gte("end_date", first)
      .order("start_date", { ascending: true })
      .limit(500),
    approvedLeaveOverlay(first, last),
  ]);

  if (error) {
    if (/PGRST205|42P01|does not exist|Could not find the table/i.test(`${error.code} ${error.message}`)) {
      return { ready: false, events: [] };
    }
    throw new Error(`일정 조회 실패 — ${error.message}`);
  }

  return {
    ready: true,
    events: [...leaveEvents, ...(data ?? []).map((r) => {
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
        source: "manual" as const,
      };
    })].sort((a, b) => a.startDate.localeCompare(b.startDate)),
  };
}
