import "server-only";
/**
 * 알림 데이터 정리(prune) — 무한 성장 방지(Phase 3 리뷰 minor). cron이 하루 1회, 테넌트 루프와
 * **독립적으로 1회** 호출(전 테넌트 공통, service_role).
 *
 * 정리 대상·보존 기간의 근거:
 * - `notification_events`(dedup 부기): **180일** 초과만 삭제. ⚠️ dedup 행을 조건이 살아있는 동안 지우면
 *   다음 cron이 같은 (subject_key, bucket)을 재감지해 **재알림**한다. 그러나 대부분 버킷은 시간이 지나면
 *   재감지되지 않는다(후속조치 `날짜:due`·`날짜:overdue:지난주`, 성적 `과목:옛gradeId`는 새 점수가 최신이라
 *   재비교 안 됨). 유일한 재알림 여지 = 출결이 180일간 멈춰 결석 tier가 고정된 학생 — 6개월에 1회 재알림은
 *   스팸이 아니고 오히려 재상기가 합당. 그래서 180일 uniform 삭제가 안전하다.
 * - `notifications`(사용자 벨): **읽은(read_at not null) 것 중 90일** 초과만 삭제. **안 읽은 것은 영구 보존**
 *   (배지·정보 유실 방지). 벨 목록은 어차피 최신 20건만 노출(LIST_LIMIT)이라 과거 읽은 알림 삭제는 무해.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { reportWarning } from "@/lib/observability/report-error";
import { pruneCutoffs } from "../events-core";

/**
 * 오래된 dedup 이벤트·읽은 알림 삭제. best-effort(실패해도 cron 본 흐름을 안 막음, reportWarning만).
 * 반환은 관측용 삭제 건수.
 */
export async function pruneNotificationData(nowMs = Date.now()): Promise<{ events: number; notifications: number }> {
  const admin = createAdminClient();
  const { eventsBefore, readNotificationsBefore } = pruneCutoffs(nowMs);
  let events = 0;
  let notifications = 0;

  try {
    const { data, error } = await admin
      .from("notification_events")
      .delete()
      .lt("created_at", eventsBefore)
      .select("id");
    if (error) throw new Error(error.message);
    events = data?.length ?? 0;
  } catch (e) {
    reportWarning("notification_events 정리 실패", {
      scope: "notify.prune.events",
      error: e instanceof Error ? e.message : String(e),
    });
  }

  try {
    const { data, error } = await admin
      .from("notifications")
      .delete()
      .not("read_at", "is", null) // 안 읽은 것은 영구 보존
      .lt("read_at", readNotificationsBefore)
      .select("id");
    if (error) throw new Error(error.message);
    notifications = data?.length ?? 0;
  } catch (e) {
    reportWarning("notifications 정리 실패", {
      scope: "notify.prune.notifications",
      error: e instanceof Error ? e.message : String(e),
    });
  }

  return { events, notifications };
}
