import "server-only";
/**
 * 반 출석 완료 → 담당 강사 벨(G4 MVP) — "보고서 쓰기가 '가는 일'이 아니라 '오는 일'이 된다"의 트리거.
 * 출결 저장 액션이 after() 백그라운드로 호출(응답 안 막음, best-effort — 실패해도 출결 저장은 무사).
 *
 * - 전이 감지: 그 (반, 날짜)의 활성 수강생 전원 기록 = 완료(순수 판정 attendance-complete.ts).
 * - dedup = notification_events(subject_key=classId, bucket=날짜) — (반,날짜)가 이 이벤트의 자연 정체성
 *   (마지막 학생을 지웠다 다시 찍어도 재벨 없음). ⚠️ 콜드스타트 시드는 **불필요** — cron처럼 과거 데이터를
 *   재스캔하는 경로가 아니라 저장 순간의 전이 훅이라, 과거 (반,날짜)는 애초에 발화하지 않는다.
 * - 수신자 = 그 반 담당 강사(활성). actorId=찍은 사람 — notifyUsers가 수신자==actor를 스킵하므로
 *   **강사 본인이 찍으면 벨 없음**(자기 행동 소음 차단), 데스크·관리자가 찍었을 때만 강사에게 도착.
 * - admin(RLS 우회) 경로라 모든 조회에 tenant 필터 필수(불변식).
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/observability/report-error";
import { isEnrollmentActiveOn } from "@/features/enrollments/eligibility";
import { notifyUsers } from "@/features/notifications/server/notify";
import { addDays, kstToday } from "@/lib/date-kst";
import { isClassAttendanceComplete } from "../attendance-complete";

export async function notifyIfClassAttendanceComplete(input: {
  tenantId: string;
  classId: string;
  date: string; // YYYY-MM-DD(세션 날짜)
  actorId: string; // 출결을 저장한 사용자 — 담당 강사 본인이면 벨 생략(notifyUsers 스킵 규약)
}): Promise<void> {
  const { tenantId, classId, date, actorId } = input;
  try {
    // 최근 3일 밖(과거 정정·이관 보정)은 무발화 — 옛 날짜 출결을 고치는 건 "오늘 수업 완료" 전이가 아니라
    // 데이터 정정이고, dedup bucket이 그 날짜론 처음이라 가드 없이는 몇 달 전 완료 벨이 뒤늦게 울린다.
    if (date < addDays(kstToday(), -3)) return;

    const admin = createAdminClient();

    // 반 확인(테넌트·활성·담당 강사) — 담당 미지정이면 받을 사람이 없어 종료.
    const { data: klass } = await admin
      .from("classes")
      .select("id, name, teacher_id, is_active")
      .eq("tenant_id", tenantId)
      .eq("id", classId)
      .maybeSingle();
    if (!klass?.is_active || !klass.teacher_id) return;

    // 활성 수강생 + 그 (반,날짜) 기록 — 서로 독립이라 병렬(B4). 반 정원 수준(수십)이라 절단 없음.
    const [{ data: enrollments }, { data: records }] = await Promise.all([
      admin
        .from("enrollments")
        .select("student_id, start_date, end_date, on_hold, is_transferred")
        .eq("tenant_id", tenantId)
        .eq("class_id", classId),
      admin
        .from("attendance_records")
        .select("student_id")
        .eq("tenant_id", tenantId)
        .eq("class_id", classId)
        .eq("session_date", date),
    ]);
    // 그 날짜 기준 활성 수강생 — 로스터·이벤트 라우팅과 동일 규약(isEnrollmentActiveOn).
    const activeIds = (enrollments ?? [])
      .filter((row) =>
        isEnrollmentActiveOn(
          { startDate: row.start_date, endDate: row.end_date, onHold: row.on_hold, isTransferred: row.is_transferred },
          date,
        ),
      )
      .map((row) => row.student_id);
    const recorded = new Set((records ?? []).map((row) => row.student_id));

    if (!isClassAttendanceComplete(activeIds, recorded)) return;

    // 전이 dedup — 신규 삽입일 때만 벨(이미 완료된 적 있는 (반,날짜)는 무발송).
    const { data: fresh, error: dedupError } = await admin
      .from("notification_events")
      .upsert(
        [{ tenant_id: tenantId, event_type: "attendance_complete", subject_key: classId, bucket: date, seeded: false }],
        { onConflict: "tenant_id,event_type,subject_key,bucket", ignoreDuplicates: true },
      )
      .select("bucket");
    if (dedupError || !fresh?.length) return;

    // 담당 강사 활성 확인 후 벨. 링크 = 그 날짜 원스크린(오늘이면 깨끗한 URL — 창 기본 경로).
    const { data: teacher } = await admin
      .from("users")
      .select("id, status")
      .eq("tenant_id", tenantId)
      .eq("id", klass.teacher_id)
      .maybeSingle();
    if (!teacher || teacher.status === "inactive") return;

    await notifyUsers([
      {
        tenantId,
        recipientId: klass.teacher_id,
        type: "attendance_complete",
        title: "출석 입력 완료",
        body: `${klass.name} 반 출석이 모두 입력됐습니다 — 수업 보고서를 작성할 준비가 됐어요.`,
        link: date === kstToday() ? "/onescreen" : `/onescreen?date=${date}`,
        actorId,
      },
    ]);
  } catch (e) {
    reportError(e, { scope: "attendance.completeNotify", tenantId, classId, date });
  }
}
