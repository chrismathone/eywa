"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canManageTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { kstToday } from "@/lib/date-kst";
import { logAction } from "@/features/audit/server/log";
// 겹침·기간 오류의 한글 매핑은 배정 경로와 **같은 함수**를 쓴다(화면마다 문구가 갈리지 않게).
import { toKoreanDbError } from "./actions";

/**
 * **예약된 수강 변경의 수정·취소** — 학생 상세·반 상세 배너의 버튼이 부른다.
 *
 * 🔴 쓰기 대상은 언제나 **`enrollment.id`** 다. 배너가 보여 주는 "A → B 이동"은 날짜 인접으로 **추론한
 *    문구**이지 저장된 관계가 아니다([scheduled-changes.ts]) — 그 추론으로 쓰기 대상을 고르면 남의 행을
 *    건드린다(적대 리뷰 합의 R3). 그래서 클라가 두 id를 명시로 넘기고, 서버는 그 행들만 확인해 고친다.
 *
 * 🔴 **게이트는 이동을 '만드는' 것과 같다**(`canManageTenant("classes")` — `moveEnrollmentsBatch`와 동일).
 *    `updateEnrollmentDates`의 원장 전용 게이트를 쓰지 않는 이유: 그쪽은 **지난 이력 정정**(이미 찍힌
 *    출결·청구가 매달린 구간을 다시 쓰는 일)이고, 여기는 **아직 시작도 안 한 예약**이라 취소 후
 *    재생성과 정확히 같은 결과다. 같은 사람이 만들 수 있는 것은 같은 사람이 고칠 수 있어야 한다.
 *
 * 🔴 **이미 시작된 것은 서버가 거절한다** — 화면에서 버튼을 숨기는 것은 게이트가 아니다([[#77]]).
 *    시작된 뒤엔 그 사이 출결·보고서가 새 반에 붙어, 되돌리면 기록이 사라진 수강에 매달린다.
 */

export type ScheduledActionState = { error?: string; ok?: true };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

type Gate =
  | { error: string }
  | { user: { id: string; tenantId: string }; supabase: Awaited<ReturnType<typeof createClient>> };

async function gate(): Promise<Gate> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canManageTenant(user.systemRole, "classes"))) {
    return { error: "예약 변경은 관리자만 할 수 있습니다" };
  }
  return { user, supabase: await createClient() };
}

/** 그 수강이 **아직 시작 전**인지 서버에서 다시 확인한다. */
async function loadUpcoming(
  supabase: Awaited<ReturnType<typeof createClient>>,
  enrollmentId: string,
) {
  const { data, error } = await supabase
    .from("enrollments")
    .select("id, student_id, class_id, start_date, end_date, is_transferred")
    .eq("id", enrollmentId)
    .maybeSingle();
  if (error || !data) return { error: "수강 정보를 찾을 수 없습니다" as const };
  if (String(data.start_date) <= kstToday()) {
    return { error: "이미 시작된 수강은 예약으로 수정할 수 없습니다" as const };
  }
  return { row: data };
}

/**
 * 예약된 **합류/이동의 날짜·대상 반을 바꾼다.**
 *
 * 이동이면 옛 수강의 종료일도 **같은 날로 함께** 옮긴다 — 하나만 옮기면 두 수강 사이에 구멍이
 * 생기거나(옛 반이 먼저 끝남) 겹친다(옛 반이 늦게 끝남). GiST는 같은 반만 막으므로 다른 반이면
 * 조용히 이중 등록이 된다.
 */
export async function rescheduleEnrollment(input: {
  /** 도착지(새로 생길) 수강 id — 이 행의 `start_date`를 옮긴다. */
  enrollmentId: string;
  /** 이동이면 출발지 수강 id — 이 행의 `end_date`를 같은 날로 옮긴다. */
  pairedEnrollmentId?: string;
  /** 새 적용일. 미지정이면 날짜는 그대로 두고 반만 바꾼다. */
  date?: string;
  /** 새 도착지 반 id. 미지정이면 반은 그대로. */
  newClassId?: string;
}): Promise<ScheduledActionState> {
  const g = await gate();
  if ("error" in g) return g;
  const { supabase } = g;

  const found = await loadUpcoming(supabase, input.enrollmentId);
  if ("error" in found) return { error: found.error };
  const row = found.row;

  const nextDate = input.date?.trim() || String(row.start_date);
  if (!ISO.test(nextDate)) return { error: "날짜 형식이 올바르지 않습니다" };
  // 과거로 옮기면 이미 지난 구간을 소급 조작한다(moveEnrollmentsBatch와 같은 규칙).
  if (nextDate <= kstToday()) return { error: "적용일은 내일 이후여야 합니다" };
  const nextClassId = input.newClassId?.trim() || String(row.class_id);

  const patch: Record<string, string> = { start_date: nextDate, class_id: nextClassId };
  const { error: upErr } = await supabase.from("enrollments").update(patch).eq("id", row.id);
  if (upErr) return { error: toKoreanDbError(upErr, "예약을 수정하지 못했습니다") };

  // 짝(출발지)의 종료일을 같은 날로. ⚠️ 이 행도 '아직 안 끝난 반이동'일 때만 건드린다 —
  // 그 사이 진짜 퇴원 처리됐으면 종료일을 옮겨 퇴원을 미루는 셈이 된다.
  // 🔴 `student_id`를 함께 건다 — 짝 id는 **클라가 보낸 값**이라, 확인 없이 쓰면 아무 전출 행의
  //    종료일이나 바꿀 수 있다(같은 권한 안이라도 남의 행을 건드리는 건 다른 문제다).
  if (input.pairedEnrollmentId) {
    const { data: paired, error: pairErr } = await supabase
      .from("enrollments")
      .update({ end_date: nextDate })
      .eq("id", input.pairedEnrollmentId)
      .eq("student_id", row.student_id)
      .eq("is_transferred", true)
      .gt("end_date", kstToday())
      .select("id");
    // 🔴 **0행도 실패다.** PostgREST는 매치 0을 에러 없이 돌려주므로, 건수를 안 보면 새 시작일만
    //    바뀌고 옛 종료일은 그대로 남는다 — 다른 반이라 GiST가 안 막아 구멍·이중 등록이 된다.
    if (pairErr || (paired ?? []).length === 0) {
      return {
        error:
          "새 반의 시작일은 바꿨지만 이전 반의 종료일을 못 바꿨습니다 — 두 날짜가 어긋났습니다. " +
          "학생 상세 수업 탭에서 종료일을 확인하거나 다시 시도해 주세요.",
      };
    }
  }

  await logAction({
    action: "enrollment_reschedule",
    targetType: "student",
    metadata: {
      studentIds: [row.student_id],
      enrollmentId: row.id,
      pairedEnrollmentId: input.pairedEnrollmentId ?? null,
      from: { date: String(row.start_date), classId: String(row.class_id) },
      to: { date: nextDate, classId: nextClassId },
    },
  });

  revalidatePath(`/students/${row.student_id}`);
  revalidatePath(`/classes/${nextClassId}`);
  revalidatePath("/timetable");
  return { ok: true };
}

/**
 * 예약된 **합류/이동을 취소한다** — 그 학생의 그 한 건만(원장 2026-08-29 확정).
 *
 * 🔴 **순서 고정**: 새 수강 삭제 → 옛 수강 종료일 비우기. 반대로 하면 두 수강이 겹쳐
 *    GiST `enrollments_no_overlap`에 걸린다(0233a 롤백과 같은 순서).
 * 🔴 옛 수강은 **반 이동이 남긴 흔적일 때만** 되돌린다 — 그 사이 진짜 퇴원했으면 되살리지 않는다
 *    (되돌리기가 없던 재원생을 만들어서는 안 된다).
 */
export async function cancelScheduledEnrollment(input: {
  enrollmentId: string;
  pairedEnrollmentId?: string;
}): Promise<ScheduledActionState> {
  const g = await gate();
  if ("error" in g) return g;
  const { supabase } = g;

  const found = await loadUpcoming(supabase, input.enrollmentId);
  if ("error" in found) return { error: found.error };
  const row = found.row;

  const { error: delErr } = await supabase.from("enrollments").delete().eq("id", row.id);
  if (delErr) return { error: toKoreanDbError(delErr, "예약을 취소하지 못했습니다") };

  if (input.pairedEnrollmentId) {
    const { data: reopened, error: reopenErr } = await supabase
      .from("enrollments")
      .update({ end_date: null, is_transferred: false, withdrawal_reason: null })
      .eq("id", input.pairedEnrollmentId)
      // 🔴 짝 id는 클라가 보낸 값이라 **같은 학생인지** 확인한다(남의 행 복구 금지).
      .eq("student_id", row.student_id)
      .eq("is_transferred", true)
      .eq("withdrawal_reason", "반 이동")
      .gt("end_date", kstToday())
      .select("id");
    // 🔴 0행도 실패로 본다(위와 같은 이유) — 새 수강만 지우고 옛 반이 닫힌 채 남으면 그 학생은
    //    9/1부터 **어느 반에도 없다**. 그건 취소가 아니라 새로운 사고다.
    if (reopenErr || (reopened ?? []).length === 0) {
      return {
        error:
          "예약은 지웠지만 이전 반을 되살리지 못했습니다 — 그대로 두면 그 날짜부터 반이 없습니다. " +
          "학생 상세 수업 탭에서 종료일을 지워 주세요.",
      };
    }
  }

  await logAction({
    action: "enrollment_schedule_cancel",
    targetType: "student",
    metadata: {
      studentIds: [row.student_id],
      enrollmentId: row.id,
      pairedEnrollmentId: input.pairedEnrollmentId ?? null,
      canceled: { date: String(row.start_date), classId: String(row.class_id) },
    },
  });

  revalidatePath(`/students/${row.student_id}`);
  revalidatePath(`/classes/${String(row.class_id)}`);
  revalidatePath("/timetable");
  return { ok: true };
}
