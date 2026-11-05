"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { teacherOwnsStudent } from "@/features/onescreen/server/scope";
import { logAction } from "@/features/audit/server/log";
import { canResolveProgressAnomaly } from "../anomaly-gate";

type Result = { ok: boolean; error?: string };

/**
 * 진도 이상 "이상 없음 확인" 토글(0151a) — 신호를 끄거나(resolve) 되돌린다(unresolve).
 *
 * 진도 점프의 상당수는 정상이다(선행 시작·교재 건너뜀·반 이동). 확인해도 끌 수 없으면 같은 경고가 계속
 * 떠 있고, 끌 수 없는 경고는 결국 통째로 무시된다 → 확인 도장을 찍을 자리.
 * ⚠️ **삭제가 아니라 해소 표시** — 되돌리기 가능 + 누가 언제 확인했는지 남는다.
 * ⚠️ 컨테이너·진도 데이터는 건드리지 않는다. 진도 자체가 틀렸으면 그 수업보고서의 진도를 고치는 게 정답
 *    (재-ingest가 새 이벤트를 만든다). 여기서 끄는 건 **신호**뿐이다.
 */
export async function setProgressAnomalyResolved(eventId: string, resolved: boolean): Promise<Result> {
  // 담당 학생 판정·확인자(resolved_by)는 화면 주인 — 강사뷰면 검증된 대상 강사(2026-11-05 강사뷰 신원 점검).
  // 읽기 강사뷰는 수준이 readonly로 캡되어 아래 게이트(canResolveProgressAnomaly)가 거절한다. 감사로그는 실제 계정.
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { ok: false, error: "로그인이 필요합니다" };

  const supabase = await createClient();
  // 대상 이벤트 — RLS(tenant)로 이미 격리. 오류 2종만 확인 대상(forward/regression 등은 애초에 신호가 아님).
  const { data: event, error } = await supabase
    .from("progress_events")
    .select("id, student_id, event_type")
    .eq("id", eventId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!event) return { ok: false, error: "기록을 찾을 수 없습니다" };
  if (!["jump_error", "overlap_error"].includes(event.event_type as string)) {
    return { ok: false, error: "확인 대상이 아닌 기록입니다" };
  }

  // 게이트 — 화면 버튼 노출과 **같은 순수 함수**(#77). scoped(강사)는 담당 학생일 때만 소유 확인이 붙는다.
  const level = await accessLevelTenant(user.systemRole, "students");
  const owns = level === "scoped" ? await teacherOwnsStudent(supabase, user.id, event.student_id as string) : false;
  if (!canResolveProgressAnomaly(level, owns)) return { ok: false, error: "권한이 없습니다" };

  const { error: updateError } = await supabase
    .from("progress_events")
    .update(
      resolved
        ? { resolved_at: new Date().toISOString(), resolved_by: user.id }
        : { resolved_at: null, resolved_by: null }, // 되돌리기는 확인자까지 함께 비운다(반쪽 상태 금지)
    )
    .eq("id", eventId);
  if (updateError) return { ok: false, error: updateError.message };

  // 감사로그 — 경고 신호를 끄는(또는 되살리는) 판단이라 누가 했는지 남긴다. 학생 이름은 뷰어가 metadata.studentId로 푼다.
  await logAction({
    action: "progress_anomaly_resolve",
    targetType: "student",
    metadata: { eventId, studentId: event.student_id, eventType: event.event_type, resolved },
  });

  // 진도 탭(이 화면) + 원스크린 배지가 같은 신호를 읽으므로 둘 다 무효화.
  revalidatePath(`/students/${event.student_id}`);
  revalidatePath("/onescreen");
  return { ok: true };
}
