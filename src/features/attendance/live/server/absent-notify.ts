import "server-only";
/**
 * 결석 입력 → **데스크 벨**. "출석하지 않은 학생이 데스크에 연동"의 즉시 경로(원장 2026-08-14).
 *
 * 왜 이벤트 훅인가: 강사가 결석을 찍는 **그 순간**이 가장 확실한 신호다. cron으로 훑으면 최대 주기만큼
 * 늦고(교시는 40~60분이라 늦으면 이미 하원 시간), 화면 폴링은 데스크가 그 화면을 열고 있어야만 는다.
 *
 * 규약(기존 이벤트 알림과 동일 — CLAUDE.md '새 이벤트 알림 추가 시'):
 *  · dedup bucket = **상태 전이 표현**(`날짜|교시`) — 앵커일을 섞지 않는다(섞으면 무한 재알림).
 *  · `upsert(onConflict, ignoreDuplicates).select()`로 **신규분만** 발송(한 행 충돌로 문장 전체가 실패하는
 *    bulk insert를 피한다).
 *  · 수신자 조회는 admin(RLS 우회)이라 **tenant 필터 필수**.
 *  · best-effort — 실패해도 출결 저장을 절대 막지 않는다.
 *
 * ⚠️ **인앱 벨만 보낸다**(`notifyUsers`). 휴대폰 웹 푸시 범위를 넓히는 것은 원장 결정 사항이라
 *    (2026-08-07: "셔틀 선생님으로 체크된 사용자만") 여기서 임의로 확대하지 않는다.
 * ⚠️ 수신자 = `users.attendance_alert_optin`을 켠 활성 계정. 새 토글을 만들지 않은 이유는 그것이 이미
 *    "출결 관련 알림을 받겠다"는 뜻이고, 토글이 둘이면 원장이 두 곳을 관리해야 하기 때문이다.
 *    🔴 아무도 안 켰으면 **아무 데도 안 간다** — 데스크 계정에서 켜야 이 경로가 산다(운영 조건).
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";
import { reportError } from "@/lib/observability/report-error";
import { notifyUsers } from "@/features/notifications/server/notify";
import { addDays, kstToday } from "@/lib/date-kst";
import { collectStudentNames, formatAttendanceNotifyNames } from "../notify-names";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const EVENT_TYPE = "attendance_absent_desk";

export async function notifyDeskOfAbsences(input: {
  tenantId: string;
  actorId: string | null;
  date: string;
  /** 방금 결석으로 기록된 (학생, 반, 교시) 목록. 교시는 없으면 null("그날 전체"). */
  cells: { studentId: string; classId: string; slotStart?: string | null }[];
}): Promise<void> {
  const { tenantId, actorId, date, cells } = input;
  try {
    if (!YMD.test(date) || cells.length === 0) return;
    // 오늘·어제 것만 알린다 — 지난 달 출결을 정정하는 건 "지금 확인해야 할 일"이 아니다(뒤늦은 벨 폭탄 방지).
    const today = kstToday();
    if (date > today || date < addDays(today, -1)) return;

    const admin = createAdminClient();

    // 수신자 먼저 — 받을 사람이 없는데 dedup만 태우면 나중에 토글을 켠 날 그 건은 영영 안 온다.
    const { data: recipients, error: recipientError } = await admin
      .from("users")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .eq("attendance_alert_optin", true);
    if (recipientError) throw recipientError;
    const targets = (recipients ?? []).map((r) => r.id as string).filter((id) => id !== actorId);
    if (targets.length === 0) return;

    // 전이 dedup — 같은 (학생, 날짜|교시)는 한 번만. 결석을 지웠다 다시 찍어도 재벨 없음.
    const { data: fresh, error: dedupError } = await admin
      .from("notification_events")
      .upsert(
        cells.map((c) => ({
          tenant_id: tenantId,
          event_type: EVENT_TYPE,
          subject_key: c.studentId,
          bucket: `${date}|${c.slotStart ?? ""}`,
          seeded: false,
        })),
        { onConflict: "tenant_id,event_type,subject_key,bucket", ignoreDuplicates: true },
      )
      .select("subject_key, bucket");
    if (dedupError) throw dedupError;
    if (!fresh?.length) return;

    // ⚠️ studentId만으로 거르면 같은 학생이 두 교시에 걸리고 **한쪽만 신규**일 때 이름이 두 번 들어가
    //    "외 1명"이 거짓이 된다(#89 계열) — bucket까지 맞춰 신규분만 남긴다.
    const freshKeys = new Set(fresh.map((f) => `${f.subject_key}|${f.bucket}`));
    const freshCells = cells.filter((c) => freshKeys.has(`${c.studentId}|${date}|${c.slotStart ?? ""}`));
    if (freshCells.length === 0) return;
    const freshIds = [...new Set(freshCells.map((c) => c.studentId))];

    // 이름 — 벨 본문에 학생 이름이 없으면 데스크가 링크를 눌러야만 무슨 일인지 안다.
    // 100에서 자르면 뒤 이름이 벨에서 사라진다(B3). 청크로 전건.
    const students = await fetchInChunks<{ id: string; name: string }>(freshIds, (chunk) =>
      admin.from("students").select("id, name").eq("tenant_id", tenantId).in("id", chunk),
    );
    const nameById = new Map(students.map((s) => [s.id, s.name]));
    const { names, missing } = collectStudentNames(freshIds, nameById);
    if (missing > 0) {
      reportError(new Error(`absent-notify names incomplete: ${names.length}/${freshIds.length}`), {
        scope: "attendance.absentNotify.names",
        expected: freshIds.length,
        resolved: names.length,
        missing,
      });
    }
    const { who, listedLabel } = formatAttendanceNotifyNames(names, freshIds.length);
    // ⚠️ 날짜를 안 쓰면 **어제 일로 오늘 전화**하게 된다 — 결석의 42.5%가 익일 이후 기록이다(실측).
    const whenLabel = date === today ? "" : ` (${date.slice(5).replace("-", "/")})`;
    const title = `결석${whenLabel} — ${who}`;

    await notifyUsers(
      targets.map((recipientId) => ({
        tenantId,
        recipientId,
        type: EVENT_TYPE,
        title,
        body: `${date} 수업에서 ${listedLabel} 학생이 결석으로 입력됐습니다 — 학부모 확인이 필요합니다.`,
        link: date === today ? "/attendance/live?tab=desk" : `/attendance/live?tab=desk&date=${date}`,
        actorId,
      })),
    );
  } catch (e) {
    reportError(e, { scope: "attendance.absentNotify", tenantId, date });
  }
}
