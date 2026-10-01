"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { viewAsTeacher } from "@/lib/auth/view-mode";
import { getTenantSettings } from "@/features/owner/server/queries";
import { classnoteMinDate } from "../classnote-guard";
import { monthRange, type SendStatRow } from "../send-calendar";
import { classnoteSendOn } from "@/features/owner/classnote-gate";
import { logDbError } from "@/lib/supabase/db-error";

/**
 * 원스크린 "월간 발송" 달력 데이터 — 로그인 강사 **본인이 쓴** 보고서를 (날짜 × 발송상태)로 집계.
 * 귀속 기준은 "지난 보고서"(history-actions)와 동일한 `teacher_name`이라 달력 숫자와 날짜 상세가 일치한다.
 *
 * B2: 한 달치 행을 받아 JS에서 세지 않는다 — 0127a group-by RPC가 (날짜×상태) 수십 행만 돌려준다.
 * 집계는 DB, 버킷 판정은 앱 순수 함수(send-calendar.ts). RLS + RPC 내부 tenant 조건 이중격리.
 */
export async function getMySendCalendar(input: {
  /** "YYYY-MM" */
  month: string;
}): Promise<{ ok: boolean; rows?: SendStatRow[]; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  // '다른 강사 뷰'(열람 전용) = 그 강사의 달력 — "지난 보고서"(history-actions)와 같은 축(갈라지면 달력과 상세가 어긋난다).
  const viewAs = await viewAsTeacher();
  const teacherName = (viewAs ? viewAs.displayName : user.displayName)?.trim();
  if (!teacherName) return { ok: false, error: "강사 이름이 없습니다" };
  if (!/^\d{4}-\d{2}$/.test(input.month)) return { ok: false, error: "달 형식이 올바르지 않습니다" };

  const { from, to } = monthRange(input.month);
  const [supabase, settings] = await Promise.all([createClient(), getTenantSettings()]);
  // 발송 "대상" 판정은 발송 콘솔과 **같은 게이트**를 써야 한다(#77) — 과목 opt-in과 발송 허용 기한을
  // RPC로 넘겨 SQL에서 함께 판정한다. 여기서 따로 규칙을 짜면 화면과 실제 발송 가능 여부가 갈라진다.
  const { data, error } = await supabase.rpc("onescreen_send_calendar", {
    p_teacher_name: teacherName,
    p_from: from,
    p_to: to,
    p_subjects: settings.report.classnoteSubjects ?? null,
    p_min_date: classnoteMinDate(),
  });
  if (error) {
    logDbError(error, "onescreen.getMySendCalendar");
    return { ok: false, error: "달력을 불러오지 못했습니다" };
  }

  // 🔴 발송 스위치를 **먼저** 본다 — RPC(0128a)는 과목 게이트가 비면 전건 sendable=true로 연다(fail-open). ClassNote를 안 쓰는
  //    지점(스위치 OFF = 새 지점 기본값)의 강사에게 "보낼 수 있음 N건"이 뜨고, 같은 화면의 날짜 상세(history-actions)는 0건이라
  //    두 숫자가 갈렸다(적대 리뷰 2026-09-21). SQL을 고칠 필요 없이 여기서 같은 스위치를 곱한다(#77).
  const sendSwitchOn = classnoteSendOn(settings);

  return {
    ok: true,
    rows: (data ?? []).map((r: { report_day: string; status_key: string | null; sendable: boolean; cnt: number }) => ({
      // date 컬럼은 PostgREST가 "YYYY-MM-DD"로 주지만, 시각이 붙어 오더라도 달력 키가 어긋나지 않게 자른다.
      reportDay: String(r.report_day).slice(0, 10),
      statusKey: r.status_key ?? "",
      sendable: sendSwitchOn && r.sendable !== false, // 구버전 RPC(컬럼 부재) 대비 — 없으면 대상으로 본다(과소 표시 방지)
      cnt: r.cnt,
    })),
  };
}
