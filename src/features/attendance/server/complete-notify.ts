import "server-only";
/**
 * 반 출석 완료 → 담당 강사 벨(G4 MVP) — "보고서 쓰기가 '가는 일'이 아니라 '오는 일'이 된다"의 트리거.
 * 출결 저장 액션(saveAttendance/setAttendanceCell)과 키오스크 등원 반영(reflectPresent)이 after()
 * 백그라운드로 호출(응답 안 막음, best-effort — 실패해도 출결 저장은 무사).
 *
 * - 전이 감지: 그 (반, 날짜)의 활성 수강생 전원 기록 = 완료(순수 판정 attendance-complete.ts).
 *   예정 명단은 처리현황(getDailyProcessingStatus)과 동일 규약 — isEnrollmentActiveOn +
 *   분리등원(enrollmentAttendsOnDay): 그 요일 비등원 학생 제외(안 그러면 분리등원 있는 반은
 *   완료 전이가 영원히 불가능 — 적대 리뷰 확정).
 * - dedup = notification_events(subject_key=classId, bucket=날짜) — (반,날짜)가 이 이벤트의 자연 정체성
 *   (마지막 학생을 지웠다 다시 찍어도 재벨 없음). ⚠️ 콜드스타트 시드는 **불필요** — cron처럼 과거 데이터를
 *   재스캔하는 경로가 아니라 저장 순간의 전이 훅이라, 과거 (반,날짜)는 애초에 발화하지 않는다.
 *   수신자(활성 강사) 확인은 **dedup보다 먼저** — 받을 사람 없는 순간에 dedup만 소모되는 것 방지.
 * - 수신자 = 그 반 담당 강사(활성). actorId=찍은 사람(키오스크=null) — notifyUsers가 수신자==actor를
 *   스킵하므로 **강사 본인이 찍으면 벨 없음**(자기 행동 소음 차단), 데스크·관리자·키오스크 완결 시만 도착.
 * - admin(RLS 우회) 경로라 모든 조회에 tenant 필터 필수(불변식). 조회 error는 삼키지 않고 throw →
 *   catch가 reportError(무발화 종료) — select 컬럼 오타가 기능을 소리 없이 죽였던 회귀 방지(적대 리뷰 확정).
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/observability/report-error";
import { enrollmentAttendsOnDay, isEnrollmentActiveOn } from "@/features/enrollments/eligibility";
import { notifyUsers } from "@/features/notifications/server/notify";
import { getTestStudentIds } from "@/features/students/server/test-students";
import { addDays, kstToday, weekdayIndexOf } from "@/lib/date-kst";
import { isClassAttendanceComplete } from "../attendance-complete";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const DOW_ENUM = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export async function notifyIfClassAttendanceComplete(input: {
  tenantId: string;
  classId: string;
  date: string; // YYYY-MM-DD(세션 날짜)
  actorId: string | null; // 출결을 저장한 사용자(키오스크=null) — 담당 강사 본인이면 벨 생략(notifyUsers 스킵 규약)
}): Promise<void> {
  const { tenantId, classId, date, actorId } = input;
  try {
    // 날짜 가드 — ① 비정규형(사전순 비교 오동작·dedup bucket 분열) ② 미래(아직 안 한 수업의 "완료" 벨 +
    // dedup 선소모로 실제 그 날의 벨까지 차단) ③ 최근 3일 밖(과거 정정·이관 보정)은 무발화. 옛 날짜 출결을
    // 고치는 건 "오늘 수업 완료" 전이가 아니라 데이터 정정이고, dedup bucket이 그 날짜론 처음이라
    // 가드 없이는 몇 달 전 완료 벨이 뒤늦게 울린다.
    if (!YMD.test(date)) return;
    const today = kstToday();
    if (date > today || date < addDays(today, -3)) return;

    const admin = createAdminClient();

    // 반 확인(테넌트·활성·담당 강사) — 담당 미지정이면 받을 사람이 없어 종료.
    const { data: klass, error: classError } = await admin
      .from("classes")
      .select("id, class_name, teacher_id, is_active")
      .eq("tenant_id", tenantId)
      .eq("id", classId)
      .maybeSingle();
    if (classError) throw classError;
    if (!klass?.is_active || !klass.teacher_id) return;

    // 활성 수강생 + 그 (반,날짜) 기록 + 담당 강사 활성 — 서로 독립이라 병렬(B4). 반 정원 수준(수십)이라 절단 없음.
    const [enrRes, recRes, teacherRes, testStudentIds] = await Promise.all([
      admin
        .from("enrollments")
        .select("student_id, start_date, end_date, on_hold, is_transferred, attendance_days")
        .eq("tenant_id", tenantId)
        .eq("class_id", classId),
      admin
        .from("attendance_records")
        .select("student_id")
        .eq("tenant_id", tenantId)
        .eq("class_id", classId)
        .eq("session_date", date),
      admin
        .from("users")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("id", klass.teacher_id)
        .eq("status", "active")
        .maybeSingle(),
      // 테스트 학생(`students.is_test`) 제외 축 — 아래 명단에서 뺀다(원장 2026-09-13). 독립 조회라 함께(B4).
      getTestStudentIds(admin, tenantId),
    ]);
    if (enrRes.error) throw enrRes.error;
    if (recRes.error) throw recRes.error;
    if (teacherRes.error) throw teacherRes.error;
    // 비활성(inactive·pending) 강사 — 받을 사람 없음. dedup 소모 전에 종료(수신자 조회 active 규약).
    if (!teacherRes.data) return;

    // 그 날짜 기준 예정 수강생 — 처리현황과 동일 규약(활성 + 분리등원 요일 포함 여부).
    const dayKey = DOW_ENUM[weekdayIndexOf(date)];
    const activeIds = (enrRes.data ?? [])
      .filter(
        (row) =>
          isEnrollmentActiveOn(
            {
              startDate: row.start_date,
              endDate: row.end_date,
              onHold: row.on_hold,
              isTransferred: row.is_transferred === true,
            },
            date,
          ) && enrollmentAttendsOnDay(row.attendance_days, dayKey),
      )
      .map((row) => row.student_id)
      // 🔴 테스트 학생은 예정 명단에서 뺀다(원장 2026-09-13) — 안 빼면 그 학생 한 칸 때문에 실제로 다 찍은
      //    반이 영원히 '미완료'로 남아 벨이 안 울린다. 그 학생만 있는 반은 명단이 비어
      //    `isClassAttendanceComplete`가 false를 돌려주므로 가짜 벨도 안 울린다(무의미 벨 방지 규약 그대로).
      .filter((studentId) => !testStudentIds.has(studentId));
    const recorded = new Set((recRes.data ?? []).map((row) => row.student_id));

    if (!isClassAttendanceComplete(activeIds, recorded)) return;

    // 전이 dedup — 신규 삽입일 때만 벨(이미 완료된 적 있는 (반,날짜)는 무발송).
    const { data: fresh, error: dedupError } = await admin
      .from("notification_events")
      .upsert(
        [{ tenant_id: tenantId, event_type: "attendance_complete", subject_key: classId, bucket: date, seeded: false }],
        { onConflict: "tenant_id,event_type,subject_key,bucket", ignoreDuplicates: true },
      )
      .select("bucket");
    if (dedupError) throw dedupError;
    if (!fresh?.length) return;

    // 링크 = 그 날짜 원스크린(오늘이면 깨끗한 URL — 창 기본 경로).
    await notifyUsers([
      {
        tenantId,
        recipientId: klass.teacher_id,
        type: "attendance_complete",
        title: "출석 입력 완료",
        body: `${klass.class_name} 반 출석이 모두 입력됐습니다 — 수업 보고서를 작성할 준비가 됐어요.`,
        link: date === today ? "/onescreen" : `/onescreen?date=${date}`,
        actorId,
      },
    ]);
  } catch (e) {
    reportError(e, { scope: "attendance.completeNotify", tenantId, classId, date });
  }
}
